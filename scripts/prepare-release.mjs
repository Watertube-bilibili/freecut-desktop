import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const env=process.env, mode=process.argv[2];
const repo=env.GITHUB_REPOSITORY, runId=env.BUILD_RUN_ID, tag=env.RELEASE_TAG;
assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo||''),'Invalid repository');
assert(/^[1-9][0-9]{0,19}$/.test(runId||''),'Invalid numeric build run ID');
assert(/^v\d+\.\d+\.\d+-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(tag||'') && tag.length<=100,'A safe prerelease tag is required');
const platforms=[['FreeCut-win-x64-unsigned','win32-x64',['win-x64-Setup.exe','win-x64-Portable.exe']],['FreeCut-mac-arm64-unsigned','darwin-arm64',['mac-arm64.dmg','mac-arm64.zip']],['FreeCut-mac-x64-unsigned','darwin-x64',['mac-x64.dmg','mac-x64.zip']]];
function command(exe,args,input){const result=spawnSync(exe,args,{input,encoding:'utf8',maxBuffer:32*1024*1024,shell:false,windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error(`${exe} failed: ${result.stderr}`);return result.stdout.trim();}
function api(endpoint,method='GET',body){return JSON.parse(command('gh',['api',`repos/${repo}/${endpoint}`,...(method==='GET'?[]:['--method',method,'--input','-'])],body===undefined?undefined:JSON.stringify(body)));}
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function tarDigest(file){const hash=crypto.createHash('sha256'),input=createReadStream(file),unzip=createGunzip();input.on('error',error=>unzip.destroy(error));input.pipe(unzip);try{for await(const chunk of unzip)hash.update(chunk);return hash.digest('hex');}finally{input.destroy();}}
async function walk(dir){const result=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert(!entry.isSymbolicLink(),'Artifact symlinks are forbidden');if(entry.isDirectory())result.push(...await walk(file));else{assert(entry.isFile(),'Unexpected artifact entry');result.push(file);}}return result;}
function one(files,test,label){const matches=files.filter(file=>test(path.basename(file)));assert.equal(matches.length,1,`Expected exactly one ${label}`);return matches[0];}
async function trustedRun(){const run=api(`actions/runs/${runId}`);assert.equal(run.repository.full_name,repo);assert.equal(run.head_repository.full_name,repo);assert.equal(run.event,'push');assert.equal(run.head_branch,'main');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.path,'.github/workflows/build.yml');assert(/^[a-f0-9]{40}$/.test(run.head_sha));const inventory=api(`actions/runs/${runId}/artifacts?per_page=100`);assert(inventory.total_count<=100,'Unexpected artifact inventory size');const artifacts=inventory.artifacts.filter(item=>/^FreeCut-.*-unsigned$/.test(item.name));assert.deepEqual(artifacts.map(item=>item.name).sort(),platforms.map(item=>item[0]).sort());assert(artifacts.every(item=>!item.expired),'A required artifact has expired');return run;}
const build=await trustedRun();
if(mode==='verify'){
  assert(env.GITHUB_OUTPUT,'GITHUB_OUTPUT is required');await fs.appendFile(env.GITHUB_OUTPUT,`head_sha=${build.head_sha}\n`);console.log(`Verified main push ${runId} at ${build.head_sha}`);
}else{
  assert.equal(env.HEAD_SHA,build.head_sha,'Build commit changed');
  const out=path.resolve(env.RELEASE_ROOT||'release-upload');
  if(mode==='prepare'){
    const artifacts=path.resolve(env.ARTIFACT_ROOT||'release-artifacts'),source=path.resolve(env.SOURCE_ROOT||'release-source');
    assert.equal(command('git',['-C',source,'rev-parse','HEAD']),build.head_sha,'License checkout differs from build');
    const {version}=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));assert(/^\d+\.\d+\.\d+$/.test(version),'Invalid source package version');assert(tag.startsWith(`v${version}-`),'Release tag differs from source package version');
    await fs.mkdir(out,{recursive:true});assert.equal((await fs.readdir(out)).length,0,'Release output must be empty');
    const assets=[],projectHashes=[];
    async function add(file,name=path.basename(file)){assert(/^[A-Za-z0-9_.-]+$/.test(name),'Unsafe asset name');assert(!assets.some(asset=>asset.name===name),'Duplicate release filename');await fs.copyFile(file,path.join(out,name));assets.push({name,size:(await fs.stat(file)).size,sha256:await digest(file)});}
    for(const [artifact,engine,suffixes]of platforms){
      const files=await walk(path.join(artifacts,artifact));
      for(const suffix of suffixes)await add(one(files,name=>name===`FreeCut-${version}-${suffix}`,'matching-version platform package'));
      const sourceName=`FreeCut-ffmpeg-source-${engine}.tar.gz`,bundle=one(files,name=>name===sourceName,'FFmpeg source bundle');
      const provenance=JSON.parse(await fs.readFile(one(files,name=>name==='provenance.json','engine provenance'),'utf8'));
      assert.equal(provenance.provider,'FreeCut source build');assert.equal(provenance.target,engine);assert.equal(provenance.sourceInputsComplete,true);assert.equal(provenance.sourceBundle,sourceName);assert.equal(provenance.sourceBundleSha256,await digest(bundle),'FFmpeg source hash mismatch');assert.equal(provenance.sourceBundleBytes,(await fs.stat(bundle)).size);await add(bundle);
      const project=one(files,name=>name===`FreeCut-project-source-${build.head_sha}.tar.gz`,'matching application source');projectHashes.push(await tarDigest(project));if(projectHashes.length===1)await add(project);
    }
    assert(projectHashes.every(hash=>hash===projectHashes[0]),'Application source archives differ between platforms');
    for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await add(path.join(source,name));
    await add(path.join(source,'docs','QUICKSTART.md'),'FreeCut-Quickstart-zh.md');
    assert.equal(assets.length,13);
    const sums=assets.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(asset=>`${asset.sha256}  ${asset.name}`).join('\n')+'\n';
    await fs.writeFile(path.join(out,'SHA256SUMS.txt'),sums);assets.push({name:'SHA256SUMS.txt',size:Buffer.byteLength(sums),sha256:await digest(path.join(out,'SHA256SUMS.txt'))});
    const notes=`自由剪辑 FreeCut 桌面编辑器预览版。提供多轨剪辑、电脑端关键帧、字幕、滤镜、本地配音和手工透明度叠化等已实现能力；完整范围与限制见对应源码文档，尚未达到剪映全部功能等价。\n\n包含 Windows x64 安装版/便携版，以及 macOS Apple Silicon/Intel 的 DMG/ZIP。Windows 未签名；Mac 使用临时签名、未公证。可选 AI 模型按各自许可单独下载；ChatTTS 模型为 CC BY-NC 4.0，不能视为可商用音色。\n\n发布前本地 75 项自动测试通过；本次选定的三平台构建工作流全部成功，包含构建、回归及打包验证。测试不能保证所有素材、设备及导出效果均无问题。构建记录：https://github.com/${repo}/actions/runs/${runId}\n源码提交：${build.head_sha}\n\n随附该提交的应用源码、三平台 FFmpeg 对应源码、LICENSE、THIRD_PARTY_NOTICES.md、中文使用教程 FreeCut-Quickstart-zh.md 和 SHA256SUMS.txt。\n`;
    await fs.writeFile(path.join(out,'release-notes.md'),notes);await fs.writeFile(path.join(out,'release-manifest.json'),JSON.stringify({runId,tag,head:build.head_sha,assets},null,2));console.log(`Prepared ${assets.length} verified assets`);
  }else if(mode==='publish'){
    const manifest=JSON.parse(await fs.readFile(path.join(out,'release-manifest.json'),'utf8'));assert.equal(manifest.runId,runId);assert.equal(manifest.tag,tag);assert.equal(manifest.head,build.head_sha);assert.equal(manifest.assets.length,14);
    for(const asset of manifest.assets){assert(/^[A-Za-z0-9_.-]+$/.test(asset.name));assert.equal(await digest(path.join(out,asset.name)),asset.sha256);}
    // A pre-existing tag must already resolve to this build. Never silently move a published git ref.
    const refs=api('git/matching-refs/tags/'+encodeURIComponent(tag)).filter(ref=>ref.ref===`refs/tags/${tag}`);
    if(refs.length){let object=refs[0].object;for(let i=0;object.type==='tag'&&i<5;i++)object=api(`git/tags/${object.sha}`).object;assert.equal(object.sha,build.head_sha,'Existing git tag targets a different commit');}
    const releases=JSON.parse(command('gh',['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`])).flat();const matches=releases.filter(release=>release.tag_name===tag);assert(matches.length<=1);let release=matches[0];if(release)assert.equal(release.draft,true,'Published releases cannot be overwritten');
    const body={tag_name:tag,target_commitish:build.head_sha,name:`FreeCut ${tag}`,body:await fs.readFile(path.join(out,'release-notes.md'),'utf8'),draft:true,prerelease:true};
    release=release?api(`releases/${release.id}`,'PATCH',body):api('releases','POST',body);
    assert.equal(release.draft,true);assert.equal(release.target_commitish,build.head_sha);
    // --clobber replaces only the explicitly named assets; unrelated draft assets remain intact.
    for(const asset of manifest.assets){assert.equal(api(`releases/${release.id}`).draft,true,'Draft was published during upload');command('gh',['release','upload',tag,path.join(out,asset.name),'--clobber','--repo',repo]);}
    const uploaded=JSON.parse(command('gh',['api','--paginate','--slurp',`repos/${repo}/releases/${release.id}/assets?per_page=100`])).flat();
    for(const asset of manifest.assets){const match=uploaded.filter(item=>item.name===asset.name);assert.equal(match.length,1);assert.equal(match[0].state,'uploaded');assert.equal(match[0].size,asset.size);if(match[0].digest)assert.equal(match[0].digest,`sha256:${asset.sha256}`);}
    assert.equal(api(`releases/${release.id}`).draft,true,'Draft was published during verification');const published=api(`releases/${release.id}`,'PATCH',{draft:false,prerelease:true,target_commitish:build.head_sha});assert.equal(published.draft,false);assert.equal(published.prerelease,true);console.log(published.html_url);
  }else throw Error('Usage: prepare-release.mjs verify|prepare|publish');
}

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
    await add(path.join(source,'docs','QUICKSTART.en.md'),'FreeCut-Quickstart-en.md');
    assert.equal(assets.length,14);
    const sums=assets.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(asset=>`${asset.sha256}  ${asset.name}`).join('\n')+'\n';
    await fs.writeFile(path.join(out,'SHA256SUMS.txt'),sums);assets.push({name:'SHA256SUMS.txt',size:Buffer.byteLength(sums),sha256:await digest(path.join(out,'SHA256SUMS.txt'))});
    const notes=`水管剪辑 / FreeCut ${version} 预览版 · 日常剪辑与恢复升级，我叫水管同学出品。

## 本次更新

- 桌面自动备份：编辑暂停 10 秒后创建恢复副本，连续编辑约每 30 秒检查一次。重启后可在首页选择历史版本恢复；编辑器底部也可打开历史备份。恢复后仍需手动保存工程，副本不覆盖原工程、不包含原始媒体。
- 流畅预览：预览区新增入口，为视频按需生成 540p 或 720p 代理，可随时切换原片预览；原始音频和最终导出继续使用原素材。可取消生成、清理缓存和选择存放位置，自动创建 FreeCut-MediaCache 子目录。代理生成本身需要时间，不承诺所有素材或设备都流畅。
- 时间线多选：Shift / Ctrl / Command 点选、空白处框选、Ctrl / Command+A 全选，支持整体移动、跨轨拖动、复制、剪切、粘贴、复制到末尾及删除；一次拖动只占一次撤销，Escape 或异常中断会回滚。锁轨不可修改，目标轨道类型必须兼容。
- 新增波纹删除（Shift+Delete）：关闭所选片段占用的时间区间并前移未锁定轨道后续片段；如果未选片段跨越该区间，会拒绝操作并提示，避免静默剪断其他内容。
- 视频缩略图与真实音频波形按可见片段在后台生成；单任务队列、缓存上限 2 GiB，每段素材最多 8 张缩略图、2048 个波形采样格。恢复副本最多每会话 8 个、总计 40 个 / 128 MiB；未保存会话的最后一份副本优先保留。
- 保留 0.5.0 的可调工作台、贝塞尔关键帧与符合条件的多层 FFmpeg 原生导出。复杂效果仍使用 Canvas/RGBA 合成；本次没有改为 GPU 编码，也不把代理生成称为导出加速。
- 保留双布局、普通关键帧、右键剪辑、预览拖动/缩放/旋转、蒙版、原创滤镜与音效、左右声道、自动字幕、ChatTTS、朗读模型自定义目录及异地邀请码协作。首次启动默认简体中文，可切换并记住 English；英文功能说明和教程同步更新。
- 全部功能永久免费，不设会员、不设付费解锁，导出无水印。

## English

FreeCut is a free, open-source desktop video editor created by a junior high school student using GPT-6 and Codex. All features are free forever, with no membership, paid unlocks or export watermark.

Desktop recovery now retains snapshots after a 10-second editing pause, with checkpoints during continuous editing. Restore a version from Home or the editor's backup history, then save it as a project. Recovery copies never overwrite the original project and do not include source media. Retention is bounded, with the latest unsaved copy of each session protected.

Smooth preview can generate 540p or 720p video proxies on demand. Switch between proxy and original previews, cancel work, clear generated cache, or choose a parent folder. Original audio and exports still use the original media; derived URLs are never saved in the project. Generating a proxy takes time and does not guarantee smooth performance on every device.

Select several clips with modifier clicks, a marquee, or Ctrl/Command+A. Move or drag the group across compatible tracks, copy/cut/paste, duplicate, or delete it. A completed drag is one undo step; Escape and interrupted gestures roll back. Locked tracks stay unchanged. Shift+Delete closes removed time ranges on unlocked tracks, refusing to cut through other unselected clips.

Visible clips gain real audio waveforms and video thumbnails through a bounded background queue and a 2 GiB cache. The 0.5.0 resizable workbench, cubic-bezier controls, eligible native layered exports, selected Concat-derived algorithms, speech tools, custom model storage and Internet invitations remain available. This update does not replace the export engine or add GPU encoding.

Original FreeCut code remains GPL-3.0-or-later; Concat-derived modules remain AGPL-3.0-or-later, copyright Jareer and Concat contributors. Their combination follows section 13 of both licenses, including the network-source requirement. Corresponding source, full licenses and modification notices accompany this release; the internal-code adaptations do not use Concat's plugin exception.

The first launch still defaults to Simplified Chinese: choose English in Home → Settings → Language, or the editor's language selector. The choice persists, and your project text is never translated automatically. Context menus, dual layouts, Easy keyframes, preview transforms, masks, color presets, sound effects, stereo routing, captions and local voice tools remain available.

Download one app package below. Windows: Setup for installation, Portable for a writable folder without installation. Mac: arm64 for Apple silicon, x64 for Intel; choose either DMG or ZIP. Read FreeCut-Quickstart-en.md and [English README](https://github.com/${repo}/blob/main/README.en.md). If FreeCut helps you, please give the repository a Star.

## 该下载哪个文件？

普通用户只需下载下表中适合自己电脑的一份文件。

| 你的电脑 / 使用方式 | 推荐下载 | 说明 |
| --- | --- | --- |
| Windows 10/11，日常使用 | FreeCut-${version}-win-x64-Setup.exe | 独立安装页面，选择 C/D 或自定义目录，创建快捷方式。 |
| Windows 10/11，希望免安装或随盘携带 | FreeCut-${version}-win-x64-Portable.exe | 便携版，放到可写文件夹后直接运行。设置、最近列表与默认模型保存在旁边的 FreeCutData，移动时一起保留；另选的朗读模型目录也需保留。 |
| Mac，Apple 芯片（M 系列） | FreeCut-${version}-mac-arm64.dmg | 打开 DMG，把 FreeCut 拖到 Applications。 |
| Mac，Intel 处理器 | FreeCut-${version}-mac-x64.dmg | 适用于 Intel Mac，安装方式同上。 |
| Mac，需要压缩包形式 | 对应芯片的 mac-arm64.zip 或 mac-x64.zip | 解压得到同一版本的 FreeCut.app；DMG 和 ZIP 任选其一。 |

Mac 可在「 → 关于本机」查看芯片。Windows 当前提供 x64 构建。手机风格是桌面内的布局，不是 Android/iOS 安装包。工程 .freecut 引用源素材，搬迁工程时也要保留媒体文件。

从可验证的旧 0.2.0 FreeCut 安装版迁移时，可以选择原目录覆盖升级，无需先卸载。新版检查旧程序的真实包身份，再仅替换新包对应程序路径；保留个人工程、模型、未知文件和旧卸载器。升级后请使用新版卸载入口，勿对新目录运行残留旧卸载器。Mac 自动更新需先把应用移出只读 DMG。

FreeCut-project-source-*.tar.gz 是本次应用完整对应源码，包含 GPL 原创部分、AGPL 派生模块、修改记录与构建脚本；FreeCut-ffmpeg-source-*.tar.gz 是各平台视频引擎的对应源码。普通使用无需下载源码，分发安装包时应同时保留并提供这些匹配源码和许可。FreeCut-Quickstart-zh.md / FreeCut-Quickstart-en.md 为中英文教程，SHA256SUMS.txt 用于校验下载完整性。

## 发布验证与说明

发布流程要求 Windows x64、Mac arm64、Mac x64 对应构建全部成功，并核验安装包、对应源码与上传散列。实际核心/宿主测试、桌面回归和打包应用导出结果以[本次构建记录](https://github.com/${repo}/actions/runs/${runId})及 docs/VERIFICATION-060.md 为准。算法来源和原生合成边界见 docs/WOLFCUT-INTEGRATION.md。历史异地协作结果仍见 docs/VERIFICATION-041.md，不冒充本版本重新完成的公网测试。源码提交：${build.head_sha}。

Windows 包未签名，Mac 使用临时签名且未公证。可选 AI 模型按各自许可另行下载，ChatTTS 官方模型为 CC BY-NC 4.0，仅限非商业用途；Mac 的可选模型推理仍需设备验收。本项目为持续开发的预览版，功能范围与尚未完成能力见 docs/FEATURE-MATRIX.md。

本次移植保留 Concat 的 AGPL-3.0-or-later、版权和修改说明，原 GPL 部分保留原许可，组合按两协议第 13 条分发；关于页和协作面板可打开源码与许可。精确来源、hash、原文许可及未引入的上游资产见 docs/third-party/concat/ 和 docs/WOLFCUT-INTEGRATION.md。此前品牌与专利边界排查见 docs/RELEASE-REVIEW-030.md；工程核查不等于商标核准、专利自由实施意见或零诉讼风险承诺。免费剪辑不改变第三方模型的用途限制。

既有 P2P 依赖的原始声明与原生子库来源随安装包提供，见[依赖清单](https://github.com/${repo}/blob/main/docs/third-party/p2p/README.md)。其中 noise-curve-ed 2.1.0 的上游只提供 ISC 元数据，完整版权人及许可原文仍待补充；清单如实保留该未解项，不宣称许可或专利风险为零。

欢迎下载体验和支持开源：[B站 @我叫水管同学](https://space.bilibili.com/390310418)。[爱发电自愿支持](https://afdian.com/a/watertube)不影响任何功能使用。
`;
    await fs.writeFile(path.join(out,'release-notes.md'),notes);await fs.writeFile(path.join(out,'release-manifest.json'),JSON.stringify({runId,tag,head:build.head_sha,assets},null,2));console.log(`Prepared ${assets.length} verified assets`);
  }else if(mode==='publish'){
    const manifest=JSON.parse(await fs.readFile(path.join(out,'release-manifest.json'),'utf8'));assert.equal(manifest.runId,runId);assert.equal(manifest.tag,tag);assert.equal(manifest.head,build.head_sha);assert.equal(manifest.assets.length,15);
    for(const asset of manifest.assets){assert(/^[A-Za-z0-9_.-]+$/.test(asset.name));assert.equal(await digest(path.join(out,asset.name)),asset.sha256);}
    // A pre-existing tag must already resolve to this build. Never silently move a published git ref.
    const refs=api('git/matching-refs/tags/'+encodeURIComponent(tag)).filter(ref=>ref.ref===`refs/tags/${tag}`);
    if(refs.length){let object=refs[0].object;for(let i=0;object.type==='tag'&&i<5;i++)object=api(`git/tags/${object.sha}`).object;assert.equal(object.sha,build.head_sha,'Existing git tag targets a different commit');}
    const releases=JSON.parse(command('gh',['api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`])).flat();const matches=releases.filter(release=>release.tag_name===tag);assert(matches.length<=1);let release=matches[0];if(release)assert.equal(release.draft,true,'Published releases cannot be overwritten');
    const body={tag_name:tag,target_commitish:build.head_sha,name:`水管剪辑 ${tag} · FreeCut · 日常剪辑与恢复升级`,body:await fs.readFile(path.join(out,'release-notes.md'),'utf8'),draft:true,prerelease:true};
    release=release?api(`releases/${release.id}`,'PATCH',body):api('releases','POST',body);
    assert.equal(release.draft,true);assert.equal(release.target_commitish,build.head_sha);
    // --clobber replaces only the explicitly named assets; unrelated draft assets remain intact.
    for(const asset of manifest.assets){assert.equal(api(`releases/${release.id}`).draft,true,'Draft was published during upload');command('gh',['release','upload',tag,path.join(out,asset.name),'--clobber','--repo',repo]);}
    const uploaded=JSON.parse(command('gh',['api','--paginate','--slurp',`repos/${repo}/releases/${release.id}/assets?per_page=100`])).flat();
    for(const asset of manifest.assets){const match=uploaded.filter(item=>item.name===asset.name);assert.equal(match.length,1);assert.equal(match[0].state,'uploaded');assert.equal(match[0].size,asset.size);if(match[0].digest)assert.equal(match[0].digest,`sha256:${asset.sha256}`);}
    assert.equal(api(`releases/${release.id}`).draft,true,'Draft was published during verification');const published=api(`releases/${release.id}`,'PATCH',{draft:false,prerelease:true,target_commitish:build.head_sha});assert.equal(published.draft,false);assert.equal(published.prerelease,true);console.log(published.html_url);
  }else throw Error('Usage: prepare-release.mjs verify|prepare|publish');
}

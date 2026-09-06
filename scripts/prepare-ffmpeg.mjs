import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'resources','ffmpeg');
const executableName=process.platform==='win32'?'ffmpeg.exe':'ffmpeg';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const run=promisify(execFile);
const sourceDirectory=process.env.FREECUT_FFMPEG_SOURCE_DIR?path.resolve(process.env.FREECUT_FFMPEG_SOURCE_DIR):null;
let binary,metadata,notices=[];
if(sourceDirectory){
  if(sourceDirectory===destination)throw Error('Source-built engine directory must differ from the prepared destination.');
  const manifest=JSON.parse(await fs.readFile(path.join(sourceDirectory,'source-manifest.json'),'utf8'));
  if(manifest.provider!=='FreeCut source build'||manifest.target!==`${process.platform}-${process.arch}`||manifest.executable!==executableName||manifest.sourceInputsComplete!==true)throw Error('Source-built FFmpeg manifest does not match this platform/architecture.');
  if(JSON.stringify(manifest.externalLibraries)!==JSON.stringify(['x264','zlib'])||manifest.patches?.length)throw Error('Unexpected source-built engine libraries or source patches.');
  binary=path.join(sourceDirectory,executableName);
  if(sha(await fs.readFile(binary))!==manifest.sha256)throw Error('Source-built FFmpeg binary SHA-256 does not match its manifest.');
  for(const name of ['FFMPEG-LICENSE.txt','X264-LICENSE.txt','ZLIB-LICENSE.txt','FFMPEG-BUILD.txt','SOURCE-NOTICE.txt','source-manifest.json','configure-command.txt','toolchain.txt','ffmpeg-config.mak','ffmpeg-config.log','x264-config.mak','protocols.txt'])notices.push([name,await fs.readFile(path.join(sourceDirectory,name))]);
  const sourceBundle=path.join(root,'artifacts',manifest.sourceBundle);
  const sourceBundleBytes=await fs.readFile(sourceBundle);
  metadata={...manifest,sourceBundleSha256:sha(sourceBundleBytes),sourceBundleBytes:sourceBundleBytes.length,sha256BeforePlatformCodeSigning:manifest.sha256};
}else{
  // Public CI never resolves or copies the npm-supplied executable.
  binary=require('ffmpeg-static');
  if(!binary)throw Error(`ffmpeg-static does not support ${process.platform}/${process.arch}`);
  const packageDirectory=path.dirname(require.resolve('ffmpeg-static/package.json'));
  const pkg=JSON.parse(await fs.readFile(path.join(packageDirectory,'package.json'),'utf8'));
  const supplierReadme=await fs.readFile(binary+'.README','utf8');
  const supplierLicense=await fs.readFile(binary+'.LICENSE');
  const sourceReference=supplierReadme.match(/Source Code:\s*(https:\/\/github\.com\/FFmpeg\/FFmpeg\/commit\/([a-f0-9]+))/i);
  const release=pkg['ffmpeg-static']['binary-release-tag'];
  notices.push(['FFMPEG-STATIC-LICENSE.txt',await fs.readFile(path.join(packageDirectory,'LICENSE'))],['SUPPLIER-README.txt',supplierReadme],['SUPPLIER-LICENSE.txt',supplierLicense]);
  const {stdout:licenseOut,stderr:licenseErr}=await run(binary,['-L'],{windowsHide:true,maxBuffer:1024*1024});
  notices.push(['FFMPEG-LICENSE.txt',licenseOut+licenseErr]);
  metadata={schema:1,provider:'ffmpeg-static supplier build',packageVersion:pkg.version,release,platform:process.platform,arch:process.arch,sha256:sha(await fs.readFile(binary)),binaryUrl:`https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/ffmpeg-${process.platform}-${process.arch}.gz`,supplierReadmeUrl:`https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/${process.platform}-${process.arch}.README`,supplierLicenseUrl:`https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/${process.platform}-${process.arch}.LICENSE`,ffmpegSourceReference:sourceReference?.[1]??null,ffmpegRevision:sourceReference?.[2]??null,sourceInputsComplete:false,distribution:'Local validation only. Public CI replaces this with a FreeCut source-built engine and the corresponding complete source-input bundle.'};
  notices.push(['source-manifest.json',JSON.stringify(metadata,null,2)],['SOURCE-NOTICE.txt',`LOCAL VALIDATION ENGINE: ffmpeg-static ${pkg.version}, release ${release}.\nOriginal supplier README/LICENSE are retained. FFmpeg source reference: ${metadata.ffmpegSourceReference??'consult supplier README and exact binary version'}.\nThis supplier binary includes external libraries whose complete matching build inputs have not been archived by FreeCut. Public CI must use FREECUT_FFMPEG_SOURCE_DIR and scripts/build-ffmpeg.sh.\nSee docs/ARCHITECTURE.md and THIRD_PARTY_NOTICES.md.\n`]);
}
await fs.access(binary);
// Replace only the known prepared-resource directory, never a supplied path.
if(path.relative(root,destination)!==path.join('resources','ffmpeg'))throw Error('Invalid prepared resource target');
await fs.rm(destination,{recursive:true,force:true});
await fs.mkdir(destination,{recursive:true});
const executable=path.join(destination,executableName);
await fs.copyFile(binary,executable);
if(process.platform!=='win32')await fs.chmod(executable,0o755);
for(const [name,bytes]of notices)await fs.writeFile(path.join(destination,name),bytes);
const {stdout,stderr}=await run(executable,['-hide_banner','-version'],{windowsHide:true,maxBuffer:1024*1024});
const {stdout:buildOut,stderr:buildErr}=await run(executable,['-hide_banner','-buildconf'],{windowsHide:true,maxBuffer:1024*1024});
await fs.writeFile(path.join(destination,'FFMPEG-BUILD.txt'),stdout+stderr+'\n'+buildOut+buildErr);
await fs.writeFile(path.join(destination,'provenance.json'),JSON.stringify(metadata,null,2));
console.log(`Prepared ${metadata.provider} for ${process.platform}/${process.arch}: ${executable}`);

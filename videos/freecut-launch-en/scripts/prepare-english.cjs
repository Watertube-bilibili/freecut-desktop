'use strict';
// Derive this independent English visual project from the frozen silent source.
// Never copy Chinese UI screenshots as stand-ins for the pending English captures.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const destination = path.resolve(__dirname, '..');
const source = path.resolve(destination, '..', 'shuiguan-launch-instrumental');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const phrases = {
  '让创作': 'MAKE IT', '自由一点': 'YOURS', '全部功能永久免费': 'All features free forever',
  '无水印导出': 'No export watermark', '不设会员 · 不设付费解锁': 'No memberships. No paid unlocks.',
  '一个初中生': 'A MIDDLE-SCHOOL STUDENT', '把想法做成了真的': 'Turned an idea into a real editor',
  '我叫水管同学出品': 'by @我叫水管同学',
  '水管剪辑应用图标': 'Original FreeCut app icon', '产品图标': 'FreeCut app icon',
  '关键帧属性面板的真实编辑器截图': 'Actual FreeCut keyframe panel in English',
  '预览选框与画面调整面板的真实编辑器截图': 'Actual English FreeCut preview selection and transform controls',
  '真实软件画面 · 截图演示': 'Real app screenshots', '记录当前画面': 'Capture a pose',
  '拖动 · 缩放 · 旋转': 'Drag / Scale / Rotate', '两种布局': 'TWO LAYOUTS', '一份灵感': 'One creative space',
  '桌面应用的手机风格布局': 'Mobile-style layout inside the desktop application',
  '手机风格布局': 'Mobile-style layout', '电脑布局': 'Desktop layout',
  '想做的效果': 'MORE TOOLS', '慢慢变成日常': 'For everyday creativity',
  '水管剪辑编辑器实际界面': 'Actual FreeCut editor with the English interface',
  '自动字幕 / 语音朗读': 'Auto captions / Text to speech', '按需下载 · 本地运行': 'Download once. Run locally.',
  '原创音效 / 左右声道': 'Original sounds / Stereo controls', '7 种蒙版 / 19 种原创调色': '7 masks / 19 original color looks',
  '部分模型有独立许可': 'Model licenses apply. ChatTTS: non-commercial.',
  '开源，也开放': 'OPEN SOURCE', '一起把它做得更好': 'Try it. Make it better.',
  '预览版，持续改进中': 'Preview release. Still improving.', '开源 · 试用 · 反馈': 'Explore / Try / Share feedback',
  '下载地址见简介': 'DOWNLOAD & STAR', '现在，轮到你的灵感': 'Your next edit starts here.',
  'B站 @我叫水管同学 · UID 390310418': 'FreeCut for Windows and macOS',
  'GitHub / Watertube-bilibili/freecut-desktop': 'github.com/Watertube-bilibili/freecut-desktop',
  '爱发电自愿赞助 · 不影响任何功能': 'Star the repository to follow new releases.',
  '水管剪辑': 'FreeCut',
};
const words = {
  '01-freedom': {'f01-let':'MAKE\u00a0','f01-create':'IT','f01-free':'YOU','f01-one':'R','f01-bit':'S'},
  '02-maker': {'f02-title-one':'A\u00a0','f02-title-chu':'MIDDLE-','f02-title-zhong':'SCHOOL\u00a0','f02-title-sheng':'STUDENT','f02-brand-shui':'F','f02-brand-guan':'ree','f02-brand-jian':'C','f02-brand-ji':'ut'},
  '03-control': {'f03-title-a':'KEY','f03-title-b':'FR','f03-title-c':'AMES','f03-support-a':'ONE\u00a0','f03-support-b':'EASY\u00a0','f03-support-c':'CLICK','f03-drag':'Drag','f03-scale':' / Scale','f03-rotate':' / Rotate'},
  '04-layout': {'f04-word-a':'TWO\u00a0','f04-word-b':'LAY','f04-word-c':'OUTS'},
  '05-tools': {'f05-title-anchor':'MORE\u00a0','f05-title-effect-first':'TO','f05-title-effect-last':'OLS'},
  '06-open': {'f06-title-anchor':'OPEN','f06-title-punctuation':'\u00a0','f06-title-link':'','f06-title-fragment-a':'SOUR','f06-title-fragment-b':'CE','f06-support-a':'TRY\u00a0','f06-support-b':'IT.\u00a0','f06-support-c':'MAKE\u00a0','f06-support-d':'IT\u00a0','f06-support-e':'BETTER.','f06-action-open':'Explore','f06-action-try':'· Try','f06-action-feedback':'· Share feedback'},
  '07-download': {'f07-word-download':'DOWN','f07-word-address':'LOAD\u00a0','f07-word-see':'&amp;\u00a0','f07-word-description-a':'ST','f07-word-description-b':'AR'},
};
const adjustments = {
  '01-freedom': '.f01-principal{left:15cqw;width:70cqw;font-size:7.2cqw}.f01-marker{left:27cqw;width:46cqw}.f01-freedom{font-size:7.2cqw}.f01-proof{font-size:1.75cqw;justify-content:center;padding:0 1cqw}.f01-proof-free{left:15cqw;width:39cqw}.f01-proof-export{left:56cqw;width:29cqw}',
  '02-maker': '.f02-title{font-size:4.35cqw;gap:.55cqw}.f02-title-mask{height:7cqw}.f02-title-layout{padding-top:2cqw}.f02-wordmark{font-size:5cqw}.f02-tools-box{left:24cqw;width:27cqw}.f02-credit-mask{left:54cqw;width:32cqw}.f02-credit{font-size:1.55cqw}',
  '03-control': '.f03-title{font-size:4.15cqw;padding-top:2.3cqw}.f03-title-mask{width:29cqw}.f03-support{font-size:1.75cqw}.f03-proof-line{font-size:1.65cqw;padding:0 1cqw}.f03-still-note{font-size:23px}',
  '04-layout': '.f04-title{font-size:5.8cqw}.f04-support{font-size:2.1cqw}.f04-label{font-size:1.55cqw}',
  '05-tools': '.f05-title{font-size:5.4cqw}.f05-support{font-size:1.75cqw}.f05-row-label{font-size:1.45cqw}.f05-license{left:59.375cqw;width:35.625cqw;font-size:1.12cqw;white-space:normal;line-height:1.4}',
  '06-open': '.f06-heading{font-size:5.6cqw;inset:14.5cqw 8cqw auto}.f06-punctuation-mask{width:2cqw}.f06-proof{left:23cqw;width:54cqw}.f06-proof-label{font-size:1.7cqw}.f06-actions{left:16cqw;right:16cqw;font-size:1.7cqw}',
  '07-download': '.f07-headline{font-size:6cqw}.f07-proof-row{font-size:1.7cqw}.f07-github{font-size:1.48cqw}.f07-wordmark{font-size:2.4cqw}',
};
function replaceLeaf(html, className, text) {
  const regex = new RegExp('(<(?:span|p|h[1-6]|div)\\b[^>]*class="[^"]*\\b'+className+'\\b[^"]*"[^>]*>)[^<]*(</(?:span|p|h[1-6]|div)>)');
  assert(regex.test(html), `Missing English leaf target: ${className}`);
  return html.replace(regex, (_,open,close) => open+text+close);
}
async function main() {
  const copied=[];
  const keep=['hyperframes.json','hyperframes.lock.json','LICENSE-GPL-3.0.txt','assets/icon.png','assets/fonts/NotoSansSC-Regular.otf','assets/fonts/NotoSansSC-Bold.otf','assets/fonts/LICENSE-NOTO.txt','assets/vendor/gsap.min.js','assets/vendor/LICENSE-GSAP.txt','compositions/components/logo-sting.html'];
  for(const relative of keep){const bytes=await fs.readFile(path.join(source,relative));const output=path.join(destination,relative);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,bytes);copied.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});}
  let index=await fs.readFile(path.join(source,'index.html'),'utf8');
  index=index.replace('lang="zh-CN"','lang="en"');
  assert(!/<audio\b|el-captions/.test(index));
  await fs.writeFile(path.join(destination,'index.html'),index);
  const originalFrames=JSON.parse(await fs.readFile(path.join(source,'frames.json'),'utf8'));
  const titles=['Make it yours','A middle-school student built FreeCut','Keyframes, one easy click','Two layouts, one creative space','More tools for everyday creativity','Open source, built together','Download and star FreeCut'];
  const modified=[];
  for(let i=0;i<originalFrames.length;i++){
    const frame=originalFrames[i];const relative=`compositions/frames/${frame.id}.html`;
    const before=await fs.readFile(path.join(source,relative),'utf8');let html=before;
    for(const [from,to] of Object.entries(phrases))html=html.replaceAll(from,to);
    for(const [cls,text] of Object.entries(words[frame.id]))html=replaceLeaf(html,cls,text);
    html=html.replaceAll('editor-keyframes-030.png','editor-keyframes-en.png').replaceAll('editor-transform-030.png','editor-transform-en.png').replaceAll('editor-030.png','editor-en.png').replaceAll('mobile-030.png','mobile-en.png');
    html=html.replace('</style>',`\n/* English copy fits the established scene; original motion is preserved. */\n${adjustments[frame.id]}\n</style>`);
    // Keep the inherited beat times independent of translated string length.
    if(i===0)html=html.replace('var frame = 1 / 60;','beats = [{start:0},{start:1.1},{start:3.3},{start:5}];\n      elapsed = 7;\n      var frame = 1 / 60;');
    if(i===1)html=html.replace('var tl = gsap.timeline','phases = [{start:0},{start:1.1},{start:3.3},{start:5}];\n      var tl = gsap.timeline');
    if(i===2)html=html.replace('const recordStart = SEQUENCE[1].start;','const recordStart = 1.1;').replace('const transformStart = SEQUENCE[2].start;','const transformStart = 3.3;').replace('tl.set(".f03-record", { visibility: "hidden" }, transformStart);','// The record clip ends at 3.3; framework-owned timing hides it.');
    if(i===3)html=html.replace('const supportAt = TIMELINE[0].start;','const supportAt = 1.1;').replace('const desktopAt = TIMELINE[1].start;','const desktopAt = 3.3;').replace('const mobileAt = TIMELINE[2].start;','const mobileAt = 4.9;');
    if(i===5){html=html.replace('const openingStart = TIMELINE[0].start + 0.06;','TIMELINE.forEach((entry,index) => { entry.start = [0,1.1,3.3][index]; });\n      const openingStart = TIMELINE[0].start + 0.06;');html=html.replace('ACTION_TIMELINE.forEach((entry) => {','ACTION_TIMELINE.forEach((entry,index) => {\n        entry.start = [4.05,4.75,5.45][index];');html=html.replaceAll('body: "开源"','body: "Explore"').replaceAll('body: "试用"','body: "Try"').replaceAll('body: "反馈"','body: "Share feedback"');}
    html=html.replaceAll('locked voiceover cues','inherited visual cues').replaceAll('spoken beat','visual beat').replaceAll('caption/watermark tracks','creator watermark track');
    const untranslated=html.replaceAll('我叫水管同学','').match(/[\u3400-\u9fff]+/g);assert(!untranslated,`${frame.id}: ${untranslated}`);
    assert(!/<audio\b|el-captions|afdian|390310418|B站/.test(html));
    await fs.mkdir(path.dirname(path.join(destination,relative)),{recursive:true});await fs.writeFile(path.join(destination,relative),html);
    modified.push({path:relative,sourceSha256:hash(Buffer.from(before)),englishSha256:hash(Buffer.from(html))});
  }
  const frames=originalFrames.map((frame,i)=>({id:frame.id,title:titles[i],start:frame.start,duration:frame.duration,type:frame.type}));
  await fs.writeFile(path.join(destination,'frames.json'),JSON.stringify(frames,null,2)+'\n');
  for(const name of ['package.json','package-lock.json']){const file=path.join(destination,name);const value=JSON.parse(await fs.readFile(file,'utf8'));value.name='freecut-launch-en';if(value.packages?.[''])value.packages[''].name='freecut-launch-en';await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');}
  await fs.writeFile(path.join(destination,'meta.json'),JSON.stringify({id:'freecut-launch-en',name:'FreeCut — English silent promo'},null,2)+'\n');
  await fs.writeFile(path.join(destination,'SOURCE-PROVENANCE.json'),JSON.stringify({sourceProject:'../shuiguan-launch-instrumental',operation:'Translate on-screen copy, adapt English text sizes, preserve seven visual scenes and 55 seconds; use only actual English screenshots; no audio or caption tracks; GitHub-only CTA.',copied,modified},null,2)+'\n');
  await fs.writeFile(path.join(destination,'assets','manifest.json'),JSON.stringify({files:copied.filter(item=>item.path.startsWith('assets/'))},null,2)+'\n');
  await fs.writeFile(path.join(destination,'SCREENSHOTS-PENDING.json'),JSON.stringify({status:'waiting-for-real-English-UI',expected:['editor-en.png','editor-keyframes-en.png','editor-transform-en.png','mobile-en.png'],minimumWidth:1920,minimumHeight:1080,renderAllowed:false},null,2)+'\n');
  console.log(JSON.stringify({prepared:true,scenes:7,duration:55,audio:0,rendered:false,pendingEnglishScreenshots:4},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

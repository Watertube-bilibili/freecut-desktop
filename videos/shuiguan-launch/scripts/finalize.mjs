import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skills=process.env.HYPERFRAMES_SKILLS_DIR||path.join(process.env.USERPROFILE||process.env.HOME,'.agents/skills');
const run=(file,args)=>{const r=spawnSync(process.execPath,[path.join(skills,file),...args],{cwd:project,stdio:'inherit',windowsHide:true});if(r.status!==0)throw Error(file+' failed');};
const frames=JSON.parse(fs.readFileSync(path.join(project,'frames.json'),'utf8'));
for(const f of frames){
 const file=path.join(project,'compositions/frames',f.id+'.html');
 let content=fs.readFileSync(file,'utf8');
 if(!content.trim().startsWith('<template')||!content.includes(`window.__timelines`))throw Error('Incomplete frame: '+f.id);
 // Immediate deterministic initial state prevents the zero-time flash caught by lint.
 content=content.replace(/tl\.set\(([^;]+?),\s*\{([^{}]*\bopacity:\s*0\b[^{}]*)\},\s*0\s*\);/g,'gsap.set($1, {$2});');
 content=content.replace(/(\s)id="(\d[^"]*)"/g,'$1id="f-$2"');
 let n=0;
 content=content.replace(/<([A-Za-z][\w-]*)(\s[^<>]*?\bdata-start=["'][^>]*?)>/g,(all,tag,attrs)=>/\sid\s*=/.test(attrs)?all:`<${tag} id="f-${f.id}-clip-${++n}"${attrs}>`);
 fs.writeFileSync(file,content);
}
fs.writeFileSync(path.join(project,'STORYBOARD.md'),fs.readFileSync(path.join(project,'STORYBOARD.md'),'utf8').replaceAll('- status: outline','- status: animated'));
run('product-launch-video/scripts/assemble-index.mjs',['--storyboard','STORYBOARD.md','--hyperframes','.']);
run('product-launch-video/scripts/transitions.mjs',['inject','--storyboard','STORYBOARD.md','--hyperframes','.']);
run('product-launch-video/scripts/transitions.mjs',['verify','--storyboard','STORYBOARD.md','--index','index.html']);
let html=fs.readFileSync(path.join(project,'index.html'),'utf8');
html=html.replaceAll('https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js','assets/vendor/gsap.min.js');
html=html.replace('</style>',`\n@font-face{font-family:'NotoSansSC';src:url('assets/fonts/NotoSansSC-Regular.otf')}\n.creator-watermark{position:absolute;right:100px;top:40px;color:#F4F3E8;background:#091C19;border:2px solid #78E4BC;padding:10px 22px;font:400 30px/1.4 'NotoSansSC';white-space:nowrap;}\n</style>`);
html=html.replace(/(<div[^>]*id="root"[^>]*>)/,`$1\n<div id="creator-watermark-layer" class="clip" data-start="0" data-duration="55" data-track-index="99" style="position:absolute;inset:0;z-index:999;pointer-events:none"><span class="creator-watermark">@我叫水管同学</span></div>`);
html=html.replace(/(id="el-[^"]*-voice")/g,'$1 data-audio-group="voiceover"');
fs.writeFileSync(path.join(project,'index.html'),html);
const caption=path.join(project,'compositions/captions.html');
let caps=fs.readFileSync(caption,'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr[^>]+><\/script>/g,'').replaceAll('GPT 六','GPT-6').replaceAll('text-transform: uppercase;','text-transform: none;');
caps=caps.replace('font-size: clamp(34px, 3.8vw, 52px);','font-size: 42px;').replace('line-height: 0.92;','line-height: 1.25;').replace('--cap-band-top: 900px;','--cap-band-top: 930px;').replace('--cap-band-height: 180px;','--cap-band-height: 150px;');
if (!caps.includes('.caption-line { line-height: 1.1 !important; }')) caps=caps.replace('</template>', '<style>.caption-line { line-height: 1.1 !important; }</style>\n</template>');
fs.writeFileSync(caption,caps);
run('hyperframes-audio/scripts/carve.mjs',['--comp',path.join(project,'index.html'),'--bed','el-bgm','--strength','0.25']);
console.log('Assembled, localized GSAP, full-film creator watermark and audio carve.');

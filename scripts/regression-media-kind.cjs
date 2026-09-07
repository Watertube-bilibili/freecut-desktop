'use strict';
// Run after npm run build. The real import/open/save IPC and editor UI operate
// on generated album artwork/audio only, with native dialogs and profile isolated.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const {_electron,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),run=promisify(execFile);
main().catch(error=>{console.error(error);process.exitCode=1;});
async function main(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-media-kind-'));
  const report={directory,checks:[],rendererErrors:[],passed:false};let app;
  try {
    const ffmpeg=path.join(root,'resources/ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
    const cover=path.join(directory,'cover.png'),file=path.join(directory,'covered.flac');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1','-y',cover],{windowsHide:true});
    await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-i',cover,'-map','0:a','-map','1:v','-c:a','flac','-c:v','copy','-disposition:v','attached_pic','-y',file],{windowsHide:true});
    const profile=path.join(directory,'profile'),bootstrap=path.join(directory,'launch.cjs');
    await fs.mkdir(profile);
    await fs.writeFile(bootstrap,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PORTABLE_EXECUTABLE_DIR;
    app=await _electron.launch({args:[bootstrap],cwd:root,env});
    await app.evaluate(({dialog})=>{
      globalThis.__mediaKindDialogs={open:[],save:[]};
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.__mediaKindDialogs.open.shift()});
      dialog.showSaveDialog=async()=>({canceled:false,filePath:globalThis.__mediaKindDialogs.save.shift()});
    });
    const page=await app.firstWindow();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>report.rendererErrors.push(error.message));
    await page.setViewportSize({width:1440,height:950});
    await page.getByRole('button',{name:/^新建项目/}).click();
    const skip=page.getByRole('button',{name:'跳过引导',exact:true});if(await skip.count())await skip.click();
    await app.evaluate((_,file)=>globalThis.__mediaKindDialogs.open.push([file]),file);
    await page.getByRole('button',{name:'导入素材',exact:true}).first().click();
    const card=page.locator('.asset-card').filter({hasText:'covered.flac'});
    await expect(card.locator('.asset-preview.audio')).toBeVisible();await card.dblclick();
    const clip=page.getByRole('button',{name:'片段 covered.flac',exact:true});await clip.click();
    await expect(page.getByRole('heading',{name:'调整声音',exact:true})).toBeVisible();
    await expect(page.locator('.preview-transform-handle')).toHaveCount(0);
    const saved=path.join(directory,'import.freecut');
    await app.evaluate((_,file)=>globalThis.__mediaKindDialogs.save.push(file),saved);
    await page.getByTitle('保存工程 Ctrl+S',{exact:true}).click();
    await expect.poll(()=>fs.readFile(saved,'utf8').catch(()=>'' )).not.toBe('');
    const project=JSON.parse(await fs.readFile(saved,'utf8'));
    assert.equal(project.assets[0].kind,'audio');assert.equal(project.clips[0].kind,'audio');
    assert.equal(project.tracks.find(track=>track.id===project.clips[0].trackId).kind,'audio');
    report.checks.push('covered FLAC imports into audio track with sound inspector and no transform handles');
    const original=structuredClone(project.clips[0]);
    project.name='Legacy FLAC';project.assets[0].kind='video';project.assets[0].width=32;project.assets[0].height=32;
    project.clips[0].kind='video';project.clips[0].trackId='video';
    const legacy=path.join(directory,'legacy.freecut');await fs.writeFile(legacy,JSON.stringify(project));
    await app.evaluate((_,file)=>globalThis.__mediaKindDialogs.open.push([file]),legacy);
    await page.getByTitle('打开工程 Ctrl+O',{exact:true}).click();
    await expect(page.getByLabel('工程名称',{exact:true})).toHaveValue('Legacy FLAC');
    await page.getByRole('button',{name:'片段 covered.flac',exact:true}).click();
    await expect(page.getByRole('heading',{name:'调整声音',exact:true})).toBeVisible();
    await expect(page.locator('.preview-transform-handle')).toHaveCount(0);
    const corrected=path.join(directory,'corrected.freecut');
    await app.evaluate((_,file)=>globalThis.__mediaKindDialogs.save.push(file),corrected);
    await page.getByTitle('保存工程 Ctrl+S',{exact:true}).click();
    await expect.poll(()=>fs.readFile(corrected,'utf8').catch(()=>'' )).not.toBe('');
    const result=JSON.parse(await fs.readFile(corrected,'utf8'));
    assert.equal(result.assets[0].kind,'audio');assert.equal(result.assets[0].width,undefined);
    assert.deepEqual(result.clips[0],{...original,kind:'audio',trackId:'video'});
    report.checks.push('legacy cover-as-video project restores as audio, preserves edits, and exposes no preview transforms');
    assert.deepEqual(report.rendererErrors,[]);report.passed=true;
    await page.screenshot({path:path.join(directory,'audio-inspector.png')});
  } finally {
    if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
    await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
}

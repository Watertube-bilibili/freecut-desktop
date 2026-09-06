'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createCloseGuard}=require('./close-guard.cjs');
function fixture(overrides={}){
  const requests=[],approvals=[];
  const guard=createCloseGuard({requestSnapshot:value=>requests.push(value),chooseAction:async()=> 'cancel',saveProject:async()=>null,validateProject:project=>assert.equal(typeof project.name,'string'),approve:reason=>approvals.push(reason),...overrides});
  return {guard,requests,approvals,respond:dirty=>guard.resolve({requestId:requests.at(-1).requestId,dirty,project:{name:'测试工程'}}),confirm:unchanged=>guard.confirm({requestId:requests.at(-1).requestId,unchanged})};
}
test('close attempts coalesce and an app quit upgrades a pending window close',async()=>{
  const state=fixture();state.guard.request('window');state.guard.request('window');state.guard.request('quit');
  assert.equal(state.requests.length,1);assert.deepEqual(await state.respond(false),{status:'ready',outcome:'clean'});
  assert.deepEqual(state.approvals,[]);assert.equal(state.confirm(true),true);assert.deepEqual(state.approvals,['quit']);
  assert.equal(state.guard.request('window'),true);state.guard.dispose();
});
test('save dialog cancellation keeps the window open and allows a fresh close attempt',async()=>{
  const state=fixture({chooseAction:async()=> 'save',saveProject:async()=>null});state.guard.request();
  assert.deepEqual(await state.respond(true),{status:'cancelled'});assert.equal(state.confirm(true),false);assert.deepEqual(state.approvals,[]);
  state.guard.request();assert.equal(state.requests.length,2);state.guard.dispose();
});
test('save failure keeps the window open and cannot be overridden by stale confirmation',async()=>{
  const state=fixture({chooseAction:async()=> 'save',saveProject:async()=>{throw Error('磁盘写入失败');}});state.guard.request();
  assert.deepEqual(await state.respond(true),{status:'failed',error:'磁盘写入失败'});assert.equal(state.confirm(true),false);assert.deepEqual(state.approvals,[]);
  state.guard.request();assert.equal(state.requests.length,2);state.guard.dispose();
});
test('cancel never saves; discard still requires confirmation of an unchanged snapshot',async()=>{
  let action='cancel',saves=0;const state=fixture({chooseAction:async()=>action,saveProject:async()=>{saves++;return '/saved.freecut';}});
  state.guard.request();assert.equal((await state.respond(true)).status,'cancelled');assert.equal(saves,0);
  action='discard';state.guard.request();assert.deepEqual(await state.respond(true),{status:'ready',outcome:'discarded'});
  assert.equal(state.confirm(false),false);assert.deepEqual(state.approvals,[]);state.guard.request();assert.equal(state.requests.length,3);state.guard.dispose();
});
test('saving uses an isolated snapshot and newer edits can veto closing after a successful save',async()=>{
  let finishSave,snapshot;const state=fixture({chooseAction:async()=> 'save',saveProject:project=>{snapshot=project;return new Promise(resolve=>{finishSave=resolve;});}});
  state.guard.request();const project={name:'旧工程'},id=state.requests[0].requestId;
  const saving=state.guard.resolve({requestId:id,dirty:true,project});await new Promise(setImmediate);project.name='后来修改';
  assert.equal(snapshot.name,'旧工程');assert.equal(state.guard.confirm({requestId:id,unchanged:true}),false);
  finishSave('/saved.freecut');assert.deepEqual(await saving,{status:'ready',outcome:'saved',path:'/saved.freecut'});
  assert.equal(state.confirm(false),false);assert.deepEqual(state.approvals,[]);state.guard.dispose();
});
test('cancel during a pending save cannot approve closure and repeated requests create no extra dialogs',async()=>{
  let finishSave,dialogs=0;const state=fixture({chooseAction:async()=>{dialogs++;return 'save';},saveProject:()=>new Promise(resolve=>{finishSave=resolve;})});
  state.guard.request();const result=state.respond(true);await new Promise(setImmediate);
  state.guard.cancel(state.requests[0].requestId);state.guard.request('quit');assert.equal(state.requests.length,1);assert.equal(dialogs,1);
  finishSave('/saved.freecut');assert.deepEqual(await result,{status:'cancelled'});assert.deepEqual(state.approvals,[]);state.guard.dispose();
});

// Exercise the actual main-process event wiring with a fake native window.
// This catches premature disposal in before-quit without launching a GUI.
async function mainHarness(platform,existingDirectory){
  const directory=existingDirectory??await fs.mkdtemp(path.join(os.tmpdir(),'freecut-close-main-'));
  const app=new EventEmitter(),ipc=new Map(),windows=[],messages=[];
  const counts={export:0,chattts:0,ai:0,quit:0,revealed:[]},choices={response:2,save:{canceled:true}};
  class Window extends EventEmitter {
    constructor(){super();this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){},send(channel,value){messages.push({channel,value});},isDestroyed:()=>this.destroyed});windows.push(this);}
    static getAllWindows(){return windows.filter(item=>!item.destroyed);}
    isDestroyed(){return this.destroyed;}
    loadURL(){return Promise.resolve();}loadFile(){return Promise.resolve();}show(){}
    close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(event.prevented)return;this.destroyed=true;this.emit('closed');if(!Window.getAllWindows().length)app.emit('window-all-closed');}
  }
  Object.assign(app,{isPackaged:false,getPath:()=>directory,getVersion:()=> 'test',whenReady:()=>Promise.resolve(),setPath(){},quit(){counts.quit++;const event={preventDefault(){this.prevented=true;}};app.emit('before-quit',event);if(!event.prevented)for(const item of Window.getAllWindows())item.close();}});
  const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>ipc.set(name,fn)},dialog:{showMessageBox:async()=>({response:choices.response}),showSaveDialog:async()=>choices.save},protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onHeadersReceived(){}}}},shell:{showItemInFolder:file=>counts.revealed.push(file)}};
  const nativeRequire=require;
  const customRequire=name=>{
    if(name==='electron')return electron;
    if(name==='./media.cjs')return {createMediaLibrary:()=>({}),MEDIA_EXTENSIONS:[],assertTrustedSender(){}};
    if(name==='./export.cjs')return {...nativeRequire('./export.cjs'),createExporter:()=>({dispose:async()=>{counts.export++;}})};
    if(name==='./ai.cjs')return {registerAI:options=>{assert.equal(options.app.on,undefined,'AI must not attach a premature before-quit listener');return {cancel:()=>{counts.ai++;}};}};
    if(name==='./chattts.cjs')return {registerChatTTS:()=>({dispose:async()=>{counts.chattts++;}})};
    return nativeRequire(name);
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'main.cjs'),'utf8'),{require:customRequire,__dirname,process:{platform,env:{},argv:[]},setImmediate,console,structuredClone});
  await new Promise(setImmediate);
  const project={version:1,id:'p',name:'退出测试',width:1920,height:1080,fps:30,tracks:[],clips:[],assets:[]};
  return {app,window:windows[0],choices,counts,messages,project,directory,invoke:(name,data)=>ipc.get(`freecut:${name}`)({},data),request:()=>messages.at(-1).value,cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
}
test('actual Windows close and app.quit wiring preserve exporter jobs on cancel/save failure, then dispose after approval',async()=>{
  const h=await mainHarness('win32');
  try{
    h.window.close();h.app.quit();assert.equal(h.messages.length,1);assert.equal(h.counts.export,0);
    let result=await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:true,project:h.project});assert.equal(result.status,'cancelled');assert.equal(h.window.destroyed,false);assert.equal(h.counts.export,0);
    h.window.close();h.choices.response=0;
    result=await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:true,project:h.project});assert.equal(result.status,'cancelled');assert.equal(h.counts.export,0);
    h.window.close();h.choices.save={canceled:false,filePath:path.join(h.directory,'missing-parent','save.freecut')};
    result=await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:true,project:h.project});assert.equal(result.status,'failed');assert.equal(h.window.destroyed,false);assert.equal(h.counts.export,0);
    h.window.close();h.choices.response=1;
    result=await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:true,project:h.project});assert.equal(result.status,'ready');assert.equal(h.counts.export,0);
    assert.equal(await h.invoke('confirm-close',{requestId:h.request().requestId,unchanged:true}),true);await new Promise(setImmediate);await new Promise(setImmediate);
    assert.equal(h.window.destroyed,true);assert.equal(h.counts.export,1);assert.equal(h.counts.ai,1);assert.equal(h.counts.chattts,1);
  }finally{await h.cleanup();}
});
test('actual Mac app.quit saves the latest snapshot, permits a race veto, and quits only after final confirmation',async()=>{
  const h=await mainHarness('darwin');
  try{
    h.app.quit();assert.equal(h.request().reason,'quit');h.choices.response=0;const output=path.join(h.directory,'saved.freecut');h.choices.save={canceled:false,filePath:output};
    const result=await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:true,project:h.project});assert.equal(result.status,'ready');assert.equal(result.outcome,'saved');assert.equal(JSON.parse(await fs.readFile(output,'utf8')).name,h.project.name);assert.equal(h.counts.export,0);
    assert.equal(await h.invoke('confirm-close',{requestId:h.request().requestId,unchanged:false}),false);assert.equal(h.window.destroyed,false);
    h.app.quit();await h.invoke('resolve-close',{requestId:h.request().requestId,dirty:false,project:h.project});
    await h.invoke('confirm-close',{requestId:h.request().requestId,unchanged:true});await new Promise(setImmediate);await new Promise(setImmediate);
    assert.equal(h.window.destroyed,true);assert.equal(h.counts.export,1);assert.equal(h.counts.chattts,1);assert.equal(h.counts.ai,1);
  }finally{await h.cleanup();}
});

test('actual show-item IPC permits persisted recent projects after restart while rejecting unselected paths',async()=>{
  const first=await mainHarness(process.platform);
  try{
    const file=path.join(first.directory,'recent.freecut');first.choices.save={canceled:false,filePath:file};await first.invoke('save-project',first.project);
    const fresh=await mainHarness(process.platform,first.directory),canonical=await fs.realpath(file);
    assert.equal((await fresh.invoke('get-info')).version,require('../package.json').version);
    await fresh.invoke('show-item',canonical);assert.deepEqual(fresh.counts.revealed,[canonical]);
    const other=path.join(first.directory,'private.txt');await fs.writeFile(other,'private');await assert.rejects(fresh.invoke('show-item',other),/选择/);
    await fresh.invoke('remove-recent-project',(await fresh.invoke('list-projects'))[0].id);await assert.rejects(fresh.invoke('show-item',canonical),/选择/);
    await fs.access(file);
  }finally{await first.cleanup();}
});

'use strict';
const {randomUUID}=require('node:crypto');

function createCloseGuard({requestSnapshot,chooseAction,saveProject,validateProject,approve,reportError=()=>{},timeoutMs=15000}) {
  let pending=null, approved=false;
  function clear(request) {
    if(request?.timer)clearTimeout(request.timer);
    if(pending===request)pending=null;
  }
  function request(reason='window') {
    if(approved)return true;
    if(pending){if(reason==='quit')pending.reason='quit';return false;}
    const entry={requestId:randomUUID(),reason,phase:'snapshot',cancelled:false,timer:null};
    pending=entry;
    entry.timer=setTimeout(()=>{
      if(pending!==entry||entry.phase!=='snapshot')return;
      clear(entry);reportError('暂时无法读取当前工程，窗口已保留。请等待编辑器响应后重试。');
    },timeoutMs);
    entry.timer.unref?.();
    try{requestSnapshot({requestId:entry.requestId,reason});}
    catch(error){clear(entry);reportError(error.message||'无法读取当前工程，窗口已保留。');}
    return false;
  }
  async function resolve(input) {
    const entry=pending;
    if(!entry||input?.requestId!==entry.requestId||entry.phase!=='snapshot')return {status:'failed',error:'关闭请求已失效，请重新尝试。'};
    clearTimeout(entry.timer);entry.phase='deciding';
    try{
      if(typeof input.dirty!=='boolean')throw Error('工程修改状态无效。');
      const project=structuredClone(input.project);validateProject(project);
      let outcome='clean',savedPath;
      if(input.dirty){
        const action=await chooseAction(project);
        if(entry.cancelled||action==='cancel'){clear(entry);return {status:'cancelled'};}
        if(action==='save'){
          savedPath=await saveProject(project);
          if(!savedPath||entry.cancelled){clear(entry);return {status:'cancelled'};}
          outcome='saved';
        }else if(action==='discard')outcome='discarded';
        else throw Error('关闭操作无效。');
      }
      if(entry.cancelled){clear(entry);return {status:'cancelled'};}
      entry.phase='ready';
      return {status:'ready',outcome,...(savedPath?{path:savedPath}:{})};
    }catch(error){clear(entry);return {status:'failed',error:error.message||'保存失败，窗口已保留。'};}
  }
  function confirm(input) {
    const entry=pending;
    if(!entry||input?.requestId!==entry.requestId||entry.phase!=='ready')return false;
    clear(entry);
    if(input.unchanged!==true)return false;
    approved=true;approve(entry.reason);return true;
  }
  function cancel(requestId) {
    if(!pending||pending.requestId!==requestId)return;
    if(pending.phase==='deciding')pending.cancelled=true;
    else clear(pending);
  }
  function dispose(){if(pending)clear(pending);}
  return {request,resolve,confirm,cancel,dispose,isApproved:()=>approved,resetApproval:()=>{approved=false;}};
}
module.exports={createCloseGuard};

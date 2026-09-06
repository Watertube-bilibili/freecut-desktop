'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

function createRecentProjects({userData,limit=100}) {
  const file=path.join(userData,'projects.json');
  let entries=null, loading=null, queue=Promise.resolve();
  const pathKey=value=>process.platform==='win32'?value.toLowerCase():value;
  function valid(entry){
    return entry&&typeof entry.id==='string'&&entry.id.length<128&&typeof entry.name==='string'&&entry.name.length<=256&&typeof entry.path==='string'&&path.isAbsolute(entry.path)&&typeof entry.updatedAt==='string'&&Number.isFinite(Date.parse(entry.updatedAt))&&['duration','width','height','clipCount'].every(key=>Number.isFinite(entry[key])&&entry[key]>=0);
  }
  async function load(){
    if(entries)return;
    if(loading)return loading;
    loading=(async()=>{
      let parsed;
      try{parsed=JSON.parse(await fs.readFile(file,'utf8'));}
      catch(error){
        if(error.code==='ENOENT'){entries=[];return;}
        if(error instanceof SyntaxError){await fs.rename(file,`${file}.invalid-${randomUUID()}`).catch(()=>{});entries=[];return;}
        throw error;
      }
      const values=parsed?.version===1&&Array.isArray(parsed.projects)?parsed.projects:[];
      const ids=new Set(),paths=new Set();
      entries=values.filter(entry=>{
        if(!valid(entry)||ids.has(entry.id)||paths.has(pathKey(entry.path)))return false;
        ids.add(entry.id);paths.add(pathKey(entry.path));return true;
      }).slice(0,limit).map(entry=>({...entry,missing:false}));
    })();
    try{await loading;}finally{loading=null;}
  }
  async function persist(next){
    await fs.mkdir(userData,{recursive:true});
    const temporary=path.join(userData,`.projects-${randomUUID()}.tmp`);
    try{
      const handle=await fs.open(temporary,'wx');
      try{await handle.writeFile(JSON.stringify({version:1,projects:next},null,2),'utf8');await handle.sync();}finally{await handle.close();}
      await fs.rename(temporary,file);entries=next;
    }finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  }
  function mutate(operation){const result=queue.then(async()=>{await load();return operation();});queue=result.catch(()=>{});return result;}
  async function list(){
    await queue;await load();
    return Promise.all(entries.map(async entry=>{
      const missing=!(await fs.stat(entry.path).then(stat=>stat.isFile(),()=>false));
      return {...entry,missing};
    }));
  }
  async function getPath(id){
    if(typeof id!=='string'||id.length>=128)throw Error('最近工程标识无效。');
    await queue;await load();const entry=entries.find(item=>item.id===id);
    if(!entry)throw Error('工程不在最近项目列表中。');
    return entry.path;
  }
  async function findPath(candidate){
    if(typeof candidate!=='string'||!path.isAbsolute(candidate))return null;
    await queue;await load();
    const key=pathKey(path.normalize(candidate));
    return entries.find(entry=>pathKey(path.normalize(entry.path))===key)?.path??null;
  }
  function remember(project,projectPath){return mutate(async()=>{
    const canonical=await fs.realpath(projectPath),stat=await fs.stat(canonical);
    if(!stat.isFile())throw Error('工程路径不是文件。');
    const previous=entries.find(entry=>pathKey(entry.path)===pathKey(canonical));
    const summary={id:previous?.id||randomUUID(),name:project.name,path:canonical,updatedAt:new Date().toISOString(),duration:Math.max(0,...project.clips.map(clip=>clip.start+clip.duration)),width:project.width,height:project.height,clipCount:project.clips.length,missing:false};
    const next=[summary,...entries.filter(entry=>entry.id!==summary.id)].slice(0,limit);
    await persist(next);return {...summary};
  });}
  function remove(id){return mutate(async()=>{
    if(typeof id!=='string'||id.length>=128)throw Error('最近工程标识无效。');
    await persist(entries.filter(entry=>entry.id!==id));
  });}
  return {list,getPath,findPath,remember,remove};
}
module.exports={createRecentProjects};

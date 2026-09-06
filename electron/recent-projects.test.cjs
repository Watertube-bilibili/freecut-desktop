'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createRecentProjects}=require('./recent-projects.cjs');
const project=name=>({name,width:1920,height:1080,clips:[{start:1,duration:4},{start:2,duration:2}]});
async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-recents-test-'));return {directory,store:createRecentProjects({userData:directory}),file:async name=>{const file=path.join(directory,`${name}.freecut`);await fs.writeFile(file,'{}');return file;},cleanup:()=>fs.rm(directory,{recursive:true,force:true})};}
test('recent projects survive reload, reuse canonical-path IDs and report project metadata',async()=>{
  const h=await fixture();try{
    const file=await h.file('中文工程'),first=await h.store.remember(project('第一次'),file),again=await h.store.remember(project('修改后'),file);
    assert.equal(again.id,first.id);assert.equal(again.path,await fs.realpath(file));
    const rows=await createRecentProjects({userData:h.directory}).list();assert.equal(rows.length,1);assert.equal(rows[0].name,'修改后');assert.equal(rows[0].duration,5);assert.equal(rows[0].clipCount,2);assert.equal(rows[0].missing,false);assert.ok(Number.isFinite(Date.parse(rows[0].updatedAt)));
  }finally{await h.cleanup();}
});
test('recent project lookup accepts only recorded IDs and removing a row never deletes its file',async()=>{
  const h=await fixture();try{
    const file=await h.file('保留'),entry=await h.store.remember(project('保留'),file);
    await assert.rejects(h.store.getPath(file),/列表/);await assert.rejects(h.store.getPath('../private.json'),/列表/);
    assert.equal(await h.store.getPath(entry.id),await fs.realpath(file));await h.store.remove(entry.id);assert.deepEqual(await h.store.list(),[]);await fs.access(file);await assert.rejects(h.store.getPath(entry.id),/列表/);
  }finally{await h.cleanup();}
});
test('missing files remain listed without losing their reference',async()=>{
  const h=await fixture();try{
    const file=await h.file('缺失'),entry=await h.store.remember(project('缺失'),file);await fs.unlink(file);
    assert.equal((await h.store.list())[0].missing,true);assert.equal(await h.store.getPath(entry.id),entry.path);
  }finally{await h.cleanup();}
});

test('file reveal authorization survives reload and accepts only a recorded absolute path',async()=>{
  const h=await fixture();try{
    const file=await h.file('可以定位'),other=await h.file('不能定位');await h.store.remember(project('可以定位'),file);
    const restored=createRecentProjects({userData:h.directory}),canonical=await fs.realpath(file);
    assert.equal(await restored.findPath(canonical),canonical);
    assert.equal(await restored.findPath(path.join(path.dirname(canonical),'.',path.basename(canonical))),canonical);
    assert.equal(await restored.findPath(other),null);assert.equal(await restored.findPath(path.basename(canonical)),null);
    assert.equal(await restored.findPath(canonical+'.secret'),null);assert.equal(await restored.findPath(null),null);
    await restored.remove((await restored.list())[0].id);assert.equal(await restored.findPath(canonical),null);await fs.access(canonical);
  }finally{await h.cleanup();}
});
test('concurrent recent-project updates serialize and the configured limit evicts only index rows',async()=>{
  const h=await fixture();try{
    const store=createRecentProjects({userData:h.directory,limit:2}),files=await Promise.all(['一','二','三'].map(name=>h.file(name)));
    await Promise.all(files.map((file,index)=>store.remember(project(String(index)),file)));
    assert.deepEqual((await store.list()).map(row=>row.name),['2','1']);for(const file of files)await fs.access(file);
    assert.equal(JSON.parse(await fs.readFile(path.join(h.directory,'projects.json'),'utf8')).projects.length,2);
  }finally{await h.cleanup();}
});
test('invalid JSON is preserved as a recovery copy and failed writes retain the previous index',async()=>{
  const h=await fixture();try{
    const index=path.join(h.directory,'projects.json');await fs.writeFile(index,'broken JSON');assert.deepEqual(await h.store.list(),[]);
    assert.ok((await fs.readdir(h.directory)).some(name=>name.startsWith('projects.json.invalid-')));
    await h.store.remember(project('原记录'),await h.file('原记录'));await fs.rename(index,path.join(h.directory,'original-index.json'));await fs.mkdir(index);
    await assert.rejects(h.store.remember(project('失败记录'),await h.file('失败记录')));
    assert.deepEqual((await h.store.list()).map(row=>row.name),['原记录']);
  }finally{await h.cleanup();}
});

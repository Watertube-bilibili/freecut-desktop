'use strict';
// Exercise real pointer capture across re-renders, cancellation and unmount.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { _electron, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-timeline-gesture-'));
  let app;
  try {
    await build({
      stdin: {
        loader: 'tsx',
        sourcefile: 'timeline-gesture-harness.tsx',
        resolveDir: root,
        contents: `
        import React,{useRef,useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import Timeline from './src/components/Timeline';
        import {createProject,createClip} from './src/core/project';
        const initial=createProject(); initial.clips=[createClip('shape','video',{start:1,duration:5,name:'Move this clip'})];
        window.__gesture={events:[],records:[],project:initial};
        document.addEventListener('pointerdown',event=>window.__pointerId=event.pointerId,true);
        function Harness(){
          const [project,setProject]=useState(initial),[visible,setVisible]=useState(true),[selected,select]=useState();
          window.__unmountTimeline=()=>{setProject(createProject());setVisible(false)};
          window.__gesture.project=project;
          return visible && <Timeline project={project} selected={selected} select={select} time={0} zoom={60} snap={false}
            seek={()=>{}} commit={update=>setProject(update)} setLive={setProject}
            record={snapshot=>{window.__gesture.events.push('record');window.__gesture.records.push(snapshot)}}
            onGestureChange={active=>window.__gesture.events.push(active?'lock':'unlock')}
            addAsset={()=>{}} addTrack={()=>{}} onClipContextMenu={()=>{}} onTrackContextMenu={()=>{}} onTimelineContextMenu={()=>{}}/>;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
      `,
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: path.join(directory, 'harness.js'),
      jsx: 'automatic',
    });
    await fs.writeFile(
      path.join(directory, 'index.html'),
      `<!doctype html><meta charset="utf-8"><style>
      body{margin:20px}.track-headers{display:none}.timeline-inner,.track-row{position:relative}.ruler{height:30px}.track-row{height:63px;background:#ddd}.timeline-clip{position:absolute;background:#267b69;touch-action:none}.trim-handle{position:absolute;top:0;bottom:0;width:8px}.left{left:0}.right{right:0}.playhead{pointer-events:none}
      </style><div id="root"></div><script src="harness.js"></script>`,
    );
    const bootstrap = path.join(directory, 'bootstrap.cjs');
    await fs.writeFile(
      bootstrap,
      `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({width:1100,height:650}).loadFile(${JSON.stringify(path.join(directory, 'index.html'))}));`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const clip = page.locator('.timeline-clip');
    await expect(clip).toBeVisible();
    async function drag() {
      await page.evaluate(() => {
        window.__gesture.events = [];
        window.__gesture.records = [];
      });
      const bounds = await clip.boundingBox();
      assert(bounds);
      const origin = { x: bounds.x + 25, y: bounds.y + 25 };
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await page.mouse.move(origin.x + 45, origin.y);
      await page.waitForTimeout(70);
      assert.deepEqual(
        await page.evaluate(() => window.__gesture.events),
        ['lock'],
        'A re-render ended the live gesture',
      );
      return origin;
    }
    await drag();
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.__gesture.events))
      .toEqual(['lock', 'record', 'unlock']);
    assert.equal(await page.evaluate(() => window.__gesture.records.length), 1);
    await drag();
    await clip.evaluate((element) =>
      element.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId: window.__pointerId, bubbles: true }),
      ),
    );
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.__gesture.events),
      ['lock', 'record', 'unlock'],
      'Pointer cancellation did not finish exactly once',
    );
    const origin = await drag();
    await clip.evaluate((element) => element.releasePointerCapture(window.__pointerId));
    await page.mouse.move(origin.x + 46, origin.y);
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.__gesture.events),
      ['lock', 'record', 'unlock'],
      'Lost capture did not release synchronization exactly once',
    );
    await drag();
    await page.evaluate(() => window.__unmountTimeline());
    await expect(clip).toHaveCount(0);
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.__gesture.events),
      ['lock', 'unlock'],
      'Unmount must unlock without inserting an old-project undo snapshot',
    );
    assert.equal(await page.evaluate(() => window.__gesture.records.length), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          directory,
          passed: true,
          checks: [
            'normal release records before unlocking',
            're-renders retain the gesture',
            'pointer cancel and lost capture end once',
            'unmount unlocks without stale undo',
          ],
          rendererErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
  }
}

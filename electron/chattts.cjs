'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = 'chattts-0.2.5-cpu-v1';
const REVISION = '1a3c04a8b0651689bd9242fbb55b1f4b5a9aef84';
const UV_VERSION = '0.8.22';
const RUNTIMES = {
  'win32-x64': ['uv-x86_64-pc-windows-msvc.zip', '5049375aa2a5162f132b2c1cb992e25d42d47d934cab8c174dbe6f60973dcc12'],
  'darwin-arm64': ['uv-aarch64-apple-darwin.tar.gz', '3f61099e261e449527141dbf125629fab33ad696468c8c90cebbac40185a306c'],
  'darwin-x64': ['uv-x86_64-apple-darwin.tar.gz', '76638fdcfa91357858771551a1c88de1f7c3b270b33ab1866f8a0618d9e442d8'],
  'linux-x64': ['uv-x86_64-unknown-linux-gnu.tar.gz', '741ff1f5742c5a4a25d2f829e8395355e43f7a5ae2ebc6368e9ae2df0efb69cf'],
};
const MODELS = [
  ['asset/DVAE.safetensors',60359112,'1d0b044a8368c0513100a2eca98456b289e6be6a18b7a63be1bcaa315ea874d9'],
  ['asset/Decoder.safetensors',103694920,'77aa55e0a977949c4733df3c6f876fa85860d3298cba63295a7bc6901729d4e0'],
  ['asset/Embed.safetensors',145598536,'2ff0be7134934155741b643b74e32fb6bf3eec41257984459b2ed60cdb4c48b0'],
  ['asset/Vocos.safetensors',54348240,'07e5561491cce41f7f90cfdb94b2ff263ff5742c3d89339db99b17ad82cc3f44'],
  ['asset/gpt/model.safetensors',853423872,'cd0806fd971f52f6a22c923ec64982b305e817bcc41ca83417fcf9141b984a0f'],
  ['asset/gpt/config.json',762,'0aaa1ecd96c49ad4f473459eb1982fa7ad79fa5de08cde2781bf6ad1f9a0c236'],
  ['asset/tokenizer/special_tokens_map.json',7847,'bd0ac9d9bb1657996b5c5fbcaa7d80f8de530d01a283da97f89deae5b1b8d011'],
  ['asset/tokenizer/tokenizer_config.json',11028,'43e9d658b554fa5ee8d8e1d763349323bfef1ed7a89c0794220ab8861387d421'],
  ['asset/tokenizer/tokenizer.json',448604,'843838a64e121e23e774cc75874c6fe862198d9f7dd43747914633a8fd89c20e'],
];
const PYTHON_RUNNER = String.raw`import os, sys, json, wave, logging
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
logging.basicConfig(level=logging.ERROR)
import numpy as np
import torch
import ChatTTS
torch.set_num_threads(min(8, max(1, os.cpu_count() or 1)))
request = json.loads(sys.stdin.buffer.read().decode('utf-8'))
torch.manual_seed(request['seed'])
print('FREECUT ' + json.dumps({'phase':'正在载入 ChatTTS 模型','progress':.12}), flush=True)
chat = ChatTTS.Chat()
if not chat.load(source='custom', custom_path=sys.argv[1], compile=False, device=torch.device('cpu')):
    raise RuntimeError('ChatTTS 模型校验或载入失败，请重新准备模型。')
speaker = chat.sample_random_speaker()
params = ChatTTS.Chat.InferCodeParams(spk_emb=speaker, prompt='[speed_%d]' % request['speed'], temperature=.3, top_P=.7, top_K=20, max_new_token=2048, show_tqdm=False, manual_seed=request['seed'])
print('FREECUT ' + json.dumps({'phase':'正在本地合成语音，CPU 处理需要一些时间','progress':.3}), flush=True)
parts = chat.infer([request['text']], skip_refine_text=True, do_text_normalization=False, do_homophone_replacement=False, params_infer_code=params, split_text=False)
if not parts: raise RuntimeError('模型未返回音频。')
audio = np.asarray(parts[0], dtype=np.float32).reshape(-1)
if audio.size < 2400 or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.00001:
    raise RuntimeError('模型生成了空白或无效音频，请更换音色种子后重试。')
if audio.size > 24000 * 300: raise RuntimeError('生成音频超过五分钟限制。')
pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2')
with wave.open(sys.argv[2], 'wb') as output:
    output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(pcm.tobytes())
print('FREECUT_RESULT ' + json.dumps({'duration':audio.size / 24000,'sampleRate':24000,'samples':int(audio.size)}), flush=True)
`;
const RUNNER_HASH = crypto.createHash('sha256').update(PYTHON_RUNNER).digest('hex');

function createChatTTS({ userData, importPath, emitProgress = () => {} }) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw new Error('ChatTTS 数据目录无效。');
  const root = path.resolve(userData, 'ai', VERSION);
  let task = null;
  let state = { ready: false, busy: false, phase: '尚未下载 ChatTTS', progress: 0 };
  const inside = (...parts) => {
    const result = path.resolve(root, ...parts), relative = path.relative(root, result);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ChatTTS 路径超出独立目录。');
    return result;
  };
  const python = () => inside('venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  const sameLocation = (value) => typeof value === 'string' && (process.platform === 'win32' ? value.toLowerCase() === root.toLowerCase() : value === root);
  const publish = (update) => { state = { ...state, ...update }; emitProgress({ ...state }); };
  const assertRunning = () => { if (!task || task.abort.signal.aborted) throw new Error('操作已取消。'); };
  async function safeDir(target) {
    inside(path.relative(root, target));
    await fsp.mkdir(root, { recursive: true });
    if ((await fsp.lstat(root)).isSymbolicLink()) throw new Error('ChatTTS 数据目录不能是符号链接。');
    const relative = path.relative(root, target);
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) { current = path.join(current, part); await fsp.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; }); if ((await fsp.lstat(current)).isSymbolicLink()) throw new Error('ChatTTS 子目录不能是符号链接。'); }
  }
  async function regular(file) {
    try {
      if ((await fsp.lstat(root)).isSymbolicLink()) return false;
      const resolved = await fsp.realpath(file), realRoot = await fsp.realpath(root), relative = path.relative(realRoot,resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
      return (await fsp.stat(resolved)).isFile();
    } catch { return false; }
  }
  async function digest(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) { if (task?.abort.signal.aborted) throw new Error('操作已取消。'); hash.update(chunk); } return hash.digest('hex'); }
  async function status() {
    let ready = false;
    try {
      const marker = JSON.parse(await fsp.readFile(inside('ready.json'), 'utf8'));
      ready = marker.version === VERSION && marker.revision === REVISION && marker.runnerHash === RUNNER_HASH && sameLocation(marker.root) && await regular(python()) && await regular(inside('runner.py'));
      if (ready) ready = (await Promise.all(MODELS.map(async([name,size]) => await regular(inside('models',name)) && (await fsp.stat(inside('models',name))).size === size))).every(Boolean);
    } catch {}
    state.ready = ready;
    if (!state.busy && ready && !state.error) state.phase = 'ChatTTS 已就绪，可离线使用';
    return { ...state };
  }
  function environment() {
    const env = {};
    for (const key of ['PATH','SystemRoot','WINDIR','COMSPEC','USERPROFILE','HOME','LOCALAPPDATA','APPDATA','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE']) if (process.env[key]) env[key] = process.env[key];
    return { ...env, TEMP:inside('tmp'), TMP:inside('tmp'), TMPDIR:inside('tmp'), UV_CACHE_DIR:inside('cache/uv'), UV_PYTHON_INSTALL_DIR:inside('python'), UV_PYTHON_BIN_DIR:inside('bin'), UV_TOOL_DIR:inside('tools'), UV_NO_MODIFY_PATH:'1', UV_PYTHON_PREFERENCE:'only-managed', UV_NO_PROGRESS:'1', HF_HOME:inside('cache/huggingface'), TORCH_HOME:inside('cache/torch'), XDG_CACHE_HOME:inside('cache'), NUMBA_CACHE_DIR:inside('cache/numba'), MPLCONFIGDIR:inside('cache/matplotlib'), PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8', PYTHONNOUSERSITE:'1', PIP_CONFIG_FILE:os.devNull, PIP_DISABLE_PIP_VERSION_CHECK:'1', HF_HUB_DISABLE_TELEMETRY:'1', DO_NOT_TRACK:'1' };
  }
  function run(executable, args, { input, onLine, timeout = 60 * 60 * 1000 } = {}) {
    if (!task || task.abort.signal.aborted) return Promise.reject(new Error('操作已取消。'));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd:root, env:environment(), shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['pipe','pipe','pipe'] });
      task.child = child;
      let stdout = '', stderr = '', buffer = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; kill(child); }, timeout);
      child.stdout.on('data', chunk => { const text = chunk.toString('utf8'); stdout = (stdout + text).slice(-512_000); buffer += text; const lines = buffer.split(/\r?\n/); buffer = lines.pop(); for (const line of lines) onLine?.(line); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-16_000); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); if (task?.child === child) task.child = null; if (task?.abort.signal.aborted) reject(new Error('操作已取消。')); else if (timedOut) reject(new Error('ChatTTS 处理超时，请检查网络或缩短文本后重试。')); else if (code === 0) resolve(stdout); else reject(new Error(`ChatTTS 子进程失败（${code}）：${stderr.slice(-2500) || stdout.slice(-1000)}`)); });
      child.stdin.on('error', () => {}); child.stdin.end(input ?? '');
    });
  }
  function kill(child) {
    if (!child?.pid) return;
    if (process.platform === 'win32') { const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'); const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, shell:false, stdio:'ignore' }); killer.on('error', () => child.kill()); }
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  }
  function allowedHost(host) { return ['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','huggingface.co','cdn-lfs.huggingface.co','cas-bridge.xethub.hf.co'].includes(host) || host.endsWith('.hf.co') || host.endsWith('.huggingface.co'); }
  async function officialResponse(address, headers = {}) {
    assertRunning();
    let response, current = address;
    for (let attempt = 0; attempt < 8; attempt++) {
      const url = new URL(current);
      if (url.protocol !== 'https:' || !allowedHost(url.hostname) || url.username || url.password) throw new Error('模型下载地址不在官方白名单内。');
      response = await fetch(current, { redirect:'manual', signal:AbortSignal.any([task.abort.signal, task.networkAbort.signal, AbortSignal.timeout(60 * 60 * 1000)]), headers:{'User-Agent':'FreeCut-ChatTTS/0.1',...headers} });
      if ([301,302,303,307,308].includes(response.status)) { current = new URL(response.headers.get('location'), current).href; await response.body?.cancel(); continue; }
      break;
    }
    if (!response?.ok || !response.body) throw new Error(`官方文件下载失败（HTTP ${response?.status ?? '?'}），请检查网络后重试。`);
    return response;
  }
  async function writeAll(file, chunk, position) {
    let offset = 0;
    while (offset < chunk.length) { const result = await file.write(chunk,offset,chunk.length-offset,position+offset); if (!result.bytesWritten) throw new Error('无法写入下载文件。'); offset += result.bytesWritten; }
  }
  async function scratchSize(file) { const info = await fsp.lstat(file).catch(() => null); if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('临时下载路径无效。'); return info?.size ?? 0; }
  async function downloadPart(address, fileName, from, to, totalSize, progress, forceRange = false) {
    for (let attempt = 0; ; attempt++) {
      try { return await downloadPartOnce(address,fileName,from,to,totalSize,progress,forceRange); }
      catch (error) { if (attempt >= 2 || task.abort.signal.aborted || task.networkAbort.signal.aborted) throw error; await new Promise(resolve => setTimeout(resolve,1000 * (attempt + 1))); }
    }
  }
  async function downloadPartOnce(address, fileName, from, to, totalSize, progress, forceRange = false) {
    const length = totalSize ? to - from + 1 : 0;
    let existing = await scratchSize(fileName);
    if ((!length && existing) || (length && existing > length)) { await fsp.rm(fileName,{force:true}); existing = 0; }
    if (length && existing === length) { progress(existing); return; }
    const range = forceRange || existing > 0, start = from + existing;
    const response = await officialResponse(address,range ? {Range:`bytes=${start}-${to}`} : {});
    if (range && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${to}/${totalSize}`)) { await response.body.cancel(); throw new Error('官方服务器未按要求返回续传范围，请重试。'); }
    const file = await fsp.open(fileName, await regular(fileName) ? 'r+' : 'wx'); let bytes = existing, last = 0;
    try {
      for await (const chunk of response.body) { assertRunning(); if (bytes + chunk.length > (length || 100_000_000)) throw new Error('下载文件超过预期大小。'); await writeAll(file,chunk,bytes); bytes += chunk.length; if (Date.now() - last > 150) { progress(bytes); last = Date.now(); } }
      await file.sync();
    } finally { await file.close(); }
    if (length && bytes !== length) throw new Error('下载被提前中断，可点击准备继续下载。');
    progress(bytes);
  }
  async function download(address, destination, hash, expectedSize, progress) {
    await safeDir(path.dirname(destination));
    if (await regular(destination) && await digest(destination) === hash) { progress?.(1); return; }
    const partial = `${destination}.partial`, cleanup = [partial];
    let completedFile = partial;
    if (expectedSize >= 256 * 1024 ** 2) {
      const size = Math.ceil(expectedSize / 4), loaded = [0,0,0,0], parts = Array.from({length:4},(_,index) => `${destination}.range-${index}`);
      const prefixSize = await scratchSize(partial);
      if (prefixSize > expectedSize) await fsp.rm(partial,{force:true});
      // Reuse a prefix from an older sequential download without trusting it until final SHA-256.
      for (let index = 0; index < 4; index++) {
        const begin = index * size, end = Math.min(expectedSize,begin+size), copied = await scratchSize(parts[index]), available = Math.min(prefixSize,end)-begin;
        if (available > copied && prefixSize <= expectedSize) {
          const file = await fsp.open(parts[index],await regular(parts[index]) ? 'r+' : 'wx'); let offset = copied;
          try { for await (const chunk of fs.createReadStream(partial,{start:begin+copied,end:begin+available-1})) { assertRunning(); await writeAll(file,chunk,offset); offset += chunk.length; } } finally { await file.close(); }
        }
      }
      let partFailure = null;
      await Promise.allSettled(parts.map((file,index) => downloadPart(address,file,index*size,Math.min(expectedSize,(index+1)*size)-1,expectedSize,bytes => {loaded[index]=bytes;progress?.(loaded.reduce((sum,value) => sum+value,0)/expectedSize);},true).catch(error => { if (!partFailure) partFailure = error; task.networkAbort.abort(); throw error; })));
      if (partFailure) throw partFailure;
      completedFile = `${destination}.assembling`; cleanup.push(...parts,completedFile);
      await scratchSize(completedFile); await fsp.rm(completedFile,{force:true});
      const output = await fsp.open(completedFile,'wx'); let offset = 0;
      try { for (const file of parts) for await (const chunk of fs.createReadStream(file)) { assertRunning(); await writeAll(output,chunk,offset); offset += chunk.length; } await output.sync(); } finally { await output.close(); }
    } else {
      await downloadPart(address,partial,0,expectedSize-1,expectedSize,bytes => progress?.(expectedSize ? bytes/expectedSize : 0));
    }
    assertRunning();
    if (await digest(completedFile) !== hash || (expectedSize && (await fsp.stat(completedFile)).size !== expectedSize)) { for (const file of cleanup) await fsp.rm(file,{force:true}); throw new Error('下载文件校验失败，未启用该文件。请重试。'); }
    if (await fsp.lstat(destination).catch(() => null)) await fsp.rm(destination, {force:true});
    await fsp.rename(completedFile,destination); for (const file of cleanup) await fsp.rm(file,{force:true}); progress?.(1);
  }
  async function atomic(file, value) { const temp = `${file}.${crypto.randomUUID()}.tmp`; await fsp.writeFile(temp, value, { flag:'wx' }); await fsp.rename(temp, file); }
  async function doGenerate(request, output, smoke = false) {
    const result = await run(python(), ['-I', '-X', 'utf8', inside('runner.py'), inside('models'), output], { input:JSON.stringify(request), timeout:20 * 60 * 1000, onLine:line => {
      if (line.startsWith('FREECUT ')) { try { const data = JSON.parse(line.slice(8)); publish({ phase:smoke ? `正在验证模型：${data.phase}` : data.phase, progress:smoke ? .95 + data.progress * .04 : data.progress }); } catch {} }
    } });
    const line = result.split(/\r?\n/).find(line => line.startsWith('FREECUT_RESULT '));
    if (!line || !(await regular(output))) throw new Error('ChatTTS 未产生有效的 WAV 文件。');
    const info = JSON.parse(line.slice(15));
    if (!Number.isFinite(info.duration) || info.duration <= .1 || info.duration > 300 || (await fsp.stat(output)).size < 4844) throw new Error('生成的 WAV 内容无效。');
    return info;
  }
  async function withTask(operation) {
    if (task) throw new Error('ChatTTS 正在处理另一项任务，请等待或取消。');
    const current = { abort:new AbortController(), networkAbort:new AbortController(), child:null, finished:null }; task = current;
    publish({ busy:true, error:undefined, progress:0 });
    const finished = (async() => { try { return await operation(); } catch (error) { publish({ error:current.abort.signal.aborted ? '操作已取消，可稍后重试。' : error.message, phase:current.abort.signal.aborted ? '已取消' : '处理失败' }); throw error; } finally { task = null; publish({ busy:false }); } })();
    current.finished = finished; return finished;
  }
  async function install() {
    if ((await status()).ready) return;
    return withTask(async() => {
      const platform = `${process.platform}-${process.arch}`, runtime = RUNTIMES[platform];
      if (!runtime) throw new Error('当前架构暂不支持 ChatTTS 自动安装；支持 Windows x64、Mac Intel/Apple Silicon。');
      await safeDir(root); for (const directory of ['tmp','downloads','runtime','cache','models','outputs']) await safeDir(inside(directory));
      if (typeof fsp.statfs === 'function') {
        const sitePackages = process.platform === 'win32' ? inside('venv','Lib','site-packages') : inside('venv','lib','python3.11','site-packages');
        const dependenciesReady = await regular(path.join(sitePackages,'ChatTTS','__init__.py'));
        let required = 6 * 1024 ** 3;
        if (dependenciesReady) { required = 512 * 1024 ** 2; for (const [name,size] of MODELS) if (!(await regular(inside('models',name)))) required += size; }
        const disk = await fsp.statfs(root);
        if (disk.bavail * disk.bsize < required) throw new Error(dependenciesReady ? `完成 ChatTTS 准备还需要约 ${(required / 1024 ** 3).toFixed(1)} GB 可用空间。` : '首次准备 ChatTTS 至少需要 6 GB 可用磁盘空间。');
      }
      publish({ phase:'下载经过校验的独立运行环境', progress:.01 });
      const archive = inside('downloads',runtime[0]); await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${runtime[0]}`, archive, runtime[1], 0, fraction => publish({progress:.01 + fraction * .04}));
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows','System32','tar.exe') : '/usr/bin/tar';
      await run(tar, ['-xf', archive, '-C', inside('runtime')], {timeout:120000});
      const uv = process.platform === 'win32' ? inside('runtime','uv.exe') : inside('runtime',runtime[0].replace(/\.tar\.gz$/,''),'uv');
      if (!(await regular(uv))) throw new Error('独立运行环境解压失败。');
      publish({ phase:'安装应用专用 Python 3.11，不修改系统 Python', progress:.06 });
      await run(uv, ['--no-config','python','install','3.11.13']);
      let venvLocation = null; try { venvLocation = JSON.parse(await fsp.readFile(inside('venv-location.json'),'utf8')).root; } catch {}
      if (await regular(python()) && !sameLocation(venvLocation)) {
        const target = inside('venv'), resolved = await fsp.realpath(target), realRoot = await fsp.realpath(root), relative = path.relative(realRoot,resolved);
        if (relative !== 'venv' || (await fsp.lstat(target)).isSymbolicLink()) throw new Error('无法安全重建迁移后的 Python 环境。');
        await fsp.rm(target,{recursive:true,force:true});
      }
      if (!(await regular(python()))) { await run(uv, ['--no-config','venv','--python','3.11.13',inside('venv')]); await atomic(inside('venv-location.json'),JSON.stringify({root})); }
      publish({ phase:'下载 CPU 推理依赖，首次准备可能需要数分钟', progress:.13 });
      const intelMac = platform === 'darwin-x64';
      const torchVersion = intelMac ? '2.2.2' : '2.5.1';
      const torchSpec = `${torchVersion}${process.platform === 'darwin' ? '' : '+cpu'}`;
      await run(uv, ['--no-config','pip','install','--python',python(),'--index-url',process.platform === 'darwin' ? 'https://pypi.org/simple' : 'https://download.pytorch.org/whl/cpu',`torch==${torchSpec}`,`torchaudio==${torchSpec}`]);
      publish({ phase:'安装固定版本的 ChatTTS 与语音依赖', progress:.24 });
      const constraints = inside('constraints.txt'); await fsp.writeFile(constraints,`torch==${torchSpec}\ntorchaudio==${torchSpec}\nnumpy==1.26.4\n`);
      const source = 'chattts @ https://files.pythonhosted.org/packages/03/82/dea1aceb28926f65b364a70b9e7a98d4b7aae392f3c32b6631e72c030937/chattts-0.2.5.tar.gz#sha256=ee800262c82f15cbdab22bf186abbf884c9c966585a1cc8fcd57793cee168582';
      await run(uv, ['--no-config','pip','install','--python',python(),'--index-url','https://pypi.org/simple','--constraint','constraints.txt',source,'numpy==1.26.4','transformers==4.46.3','tokenizers==0.20.3','huggingface-hub==0.26.2','safetensors==0.4.5','numba==0.60.0','pybase16384==0.3.8','vector-quantize-pytorch==1.14.24','vocos==0.1.0','einops==0.8.0','tqdm==4.67.1','soundfile==0.12.1','librosa==0.10.2.post1','scipy==1.14.1','torchmetrics==1.6.0']);
      const total = MODELS.reduce((sum,file) => sum + file[1],0), loaded = MODELS.map(() => 0); let next = 0, completed = 0, failure = null;
      publish({phase:`并行下载与校验语音模型 0/${MODELS.length}`,progress:.32});
      const worker = async() => {
        while (next < MODELS.length && !failure && !task.abort.signal.aborted) {
          const index = next++, [name,size,hash] = MODELS[index];
          try {
            await download(`https://huggingface.co/2Noise/ChatTTS/resolve/${REVISION}/${name}`,inside('models',name),hash,size,fraction => { loaded[index] = fraction * size; publish({progress:.32 + loaded.reduce((sum,bytes) => sum + bytes,0) / total * .62}); });
            completed++; publish({phase:`并行下载与校验语音模型 ${completed}/${MODELS.length}`});
          } catch (error) { if (!failure) failure = error; task.networkAbort.abort(); }
        }
      };
      await Promise.all([worker(),worker(),worker(),worker()]);
      if (failure) throw failure;
      if (task.abort.signal.aborted) throw new Error('操作已取消。');
      await fsp.writeFile(inside('runner.py'),PYTHON_RUNNER,'utf8');
      publish({ phase:'模型下载完成，正在实际合成短句验证', progress:.95 });
      const smoke = await doGenerate({text:'你好，欢迎使用自由剪辑。',seed:42,speed:5},inside('outputs','installation-test.wav'),true);
      assertRunning();
      await atomic(inside('ready.json'),JSON.stringify({version:VERSION,revision:REVISION,runnerHash:RUNNER_HASH,root,python:'3.11.13',torch:torchSpec,verifiedAt:new Date().toISOString(),smoke}));
      if (task.abort.signal.aborted) { await fsp.rm(inside('ready.json'),{force:true}); throw new Error('操作已取消。'); }
      publish({ready:true,phase:'ChatTTS 已就绪，可离线使用',progress:1,error:undefined});
    });
  }
  async function generate(request) {
    if (!(await status()).ready) throw new Error('请先一键准备 ChatTTS 运行环境和模型。');
    if (!request || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(request.text)) throw new Error('请输入 1–300 字的中文或英文配音文本。');
    if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 2147483647 || !Number.isInteger(request.speed) || request.speed < 1 || request.speed > 9) throw new Error('音色种子或语速参数无效。');
    return withTask(async() => {
      await safeDir(inside('outputs'));
      const output = inside('outputs',`chattts-${crypto.randomUUID()}.wav`);
      try { await doGenerate({text:request.text.trim(),seed:request.seed,speed:request.speed},output); assertRunning(); const asset = await importPath(output); assertRunning(); publish({phase:'配音已生成，可试听或加入时间线',progress:1}); return {...asset,name:`ChatTTS · ${request.text.trim().slice(0,18)}`}; }
      catch (error) { await fsp.rm(output,{force:true}).catch(() => {}); if (/模型校验|载入失败|ModuleNotFoundError|ImportError|DLL load failed|No such file/i.test(error.message)) { await fsp.rm(inside('ready.json'),{force:true}); publish({ready:false}); } throw error; }
    });
  }
  async function cancel() { const current = task; if (!current) return; current.abort.abort(); kill(current.child); await current.finished?.catch(() => {}); }
  return { status, install, generate, cancel, dispose:cancel, root };
}

function registerChatTTS({ipcMain,app,importPath,validateSender}) {
  let sender = null;
  const engine = createChatTTS({userData:app.getPath('userData'),importPath,emitProgress:data => { if(sender && !sender.isDestroyed())sender.send('freecut:chattts-progress',data); }});
  for (const [channel,callback] of [['status',() => engine.status()],['install',() => engine.install()],['generate',request => engine.generate(request)],['cancel',() => engine.cancel()]]) ipcMain.handle(`freecut:chattts-${channel}`,async(event,...args) => { validateSender(event); sender = event.sender; return callback(...args); });
  return engine;
}
module.exports = {registerChatTTS,createChatTTS,VERSION,REVISION,MODELS};

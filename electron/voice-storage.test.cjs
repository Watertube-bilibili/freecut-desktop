'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createVoiceStorage, createVoiceModelStorage } = require('./voice-storage.cjs');
const { createAIService, NATIVE, MODELS } = require('./ai.cjs');
const { createChatTTS } = require('./chattts.cjs');
const payload = Buffer.from('Known complete voice model fixture');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function eventually(check) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected asynchronous state did not arrive');
}
async function fixture(action, overrides = {}) {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-voice-storage-'),
  );
  const userData = path.join(directory, 'profile');
  await fs.mkdir(userData);
  const models = ['chattts', 'tts-zh'].map((id) => ({
    id,
    directory: id === 'chattts' ? 'chattts-0.2.5-cpu-v1/models' : 'tts-zh-v1',
    defaultCacheDirectory: 'downloads',
    files: async () => ['model.bin'],
    verify: async (folder) => {
      try {
        return digest(await fs.readFile(path.join(folder, 'model.bin'))) === digest(payload);
      } catch {
        return false;
      }
    },
    ...overrides,
  }));
  const create = () => createVoiceStorage({ userData, models });
  const storage = create();
  const seed = async () => {
    for (const model of models) {
      const folder = storage.modelPath(model.id);
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'model.bin'), payload);
    }
  };
  try {
    await action({ directory, userData, models, storage, create, seed });
  } finally {
    await storage.dispose();
    assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('voice model migration copies only validated models, persists after restart and retains ASR, runtimes and generated audio', async () => {
  await fixture(async ({ directory, userData, storage, create, seed }) => {
    await seed();
    const retained = [
      'ai/asr-sensevoice-v1/model.onnx',
      'ai/asr-zh-en-v1/model.onnx',
      'ai/runtime/engine',
      'ai/speech/old.wav',
      'ai/chattts-0.2.5-cpu-v1/venv/python',
      'ai/chattts-0.2.5-cpu-v1/outputs/old.wav',
    ];
    for (const relative of retained) {
      const file = path.join(userData, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'retained');
    }
    await fs.writeFile(path.join(storage.modelPath('chattts'), 'model.bin.partial'), 'unfinished');
    const old = storage.modelPath('chattts');
    const next = await storage.choose(path.join(directory, '中文 空格目录'));
    assert.equal(next.busy, false);
    assert.equal(next.custom, true);
    assert.equal(path.basename(next.path), 'FreeCut-VoiceModels');
    for (const id of ['chattts', 'tts-zh'])
      assert.deepEqual(await fs.readFile(path.join(storage.modelPath(id), 'model.bin')), payload);
    assert.deepEqual(await fs.readFile(path.join(old, 'model.bin')), payload);
    assert.equal(
      await fs.stat(path.join(storage.modelPath('chattts'), 'model.bin.partial')).catch(() => null),
      null,
    );
    for (const relative of retained)
      assert.equal(await fs.readFile(path.join(userData, relative), 'utf8'), 'retained');
    const fresh = create();
    assert.deepEqual(fresh.status(), next);
    assert.equal(fresh.cachePath('tts-zh'), path.join(next.path, 'downloads', 'tts-zh'));
    assert.deepEqual(
      await fresh.choose(next.path),
      next,
      'Selecting the same named folder must not nest it',
    );
    const restored = await fresh.reset();
    assert.equal(restored.custom, false);
    assert.equal(restored.path, path.join(userData, 'ai'));
    assert.equal(create().status().custom, false);
    assert.deepEqual(await fs.readFile(path.join(next.path, 'tts-zh-v1', 'model.bin')), payload);
  });
});

test('unknown destination model files are rejected even when no model is installed; sources and settings remain unchanged', async () => {
  await fixture(async ({ directory, userData, storage, seed }) => {
    const parent = path.join(directory, 'target');
    const personal = path.join(parent, 'FreeCut-VoiceModels', 'tts-zh-v1', 'personal.txt');
    await fs.mkdir(path.dirname(personal), { recursive: true });
    await fs.writeFile(personal, 'do not remove');
    await assert.rejects(storage.choose(parent), /未知模型文件/);
    assert.equal(storage.status().custom, false);
    assert.equal(await fs.stat(path.join(userData, 'voice-storage.json')).catch(() => null), null);
    await seed();
    await assert.rejects(storage.choose(parent), /未知模型文件/);
    assert.equal(await fs.readFile(personal, 'utf8'), 'do not remove');
    assert.deepEqual(
      await fs.readFile(path.join(storage.modelPath('tts-zh'), 'model.bin')),
      payload,
    );
  });
});

test('copy verification failure leaves the old setting and original files usable and cleans stages', async () => {
  await fixture(
    async ({ directory, storage, seed }) => {
      await seed();
      await assert.rejects(storage.choose(path.join(directory, 'target')), /校验失败/);
      assert.equal(storage.status().custom, false);
      assert.equal(storage.status().busy, false);
      const target = path.join(directory, 'target', 'FreeCut-VoiceModels', 'chattts-0.2.5-cpu-v1');
      assert.deepEqual(await fs.readdir(target), []);
      assert.deepEqual(
        await fs.readFile(path.join(storage.modelPath('chattts'), 'model.bin')),
        payload,
      );
    },
    {
      verify: async (folder) =>
        !folder.includes('.copy-') &&
        digest(await fs.readFile(path.join(folder, 'model.bin')).catch(() => Buffer.alloc(0))) ===
          digest(payload),
    },
  );
});

test('tasks and directory changes exclude each other synchronously; shutdown waits for copying', async () => {
  let resolveVerification,
    entered = false;
  const gate = new Promise((resolve) => {
    resolveVerification = resolve;
  });
  await fixture(
    async ({ directory, storage, seed }) => {
      await seed();
      const release = storage.beginTask();
      assert.equal(storage.status().busy, true);
      await assert.rejects(storage.choose(directory), /当前任务/);
      release();
      release();
      const changing = storage.choose(path.join(directory, 'target'));
      await eventually(() => entered);
      assert.equal(storage.status().busy, true);
      assert.throws(() => storage.beginTask(), /当前任务/);
      await assert.rejects(storage.reset(), /当前任务/);
      let disposed = false;
      const waiting = storage.dispose().then(() => {
        disposed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(disposed, false);
      resolveVerification();
      await changing;
      await waiting;
      assert.equal(storage.status().busy, false);
    },
    {
      verify: async (folder) => {
        entered = true;
        await gate;
        try {
          return digest(await fs.readFile(path.join(folder, 'model.bin'))) === digest(payload);
        } catch {
          return false;
        }
      },
    },
  );
});

test('storage rejects a junction at the app folder while accepting a selected parent alias', async () => {
  await fixture(async ({ directory, storage }) => {
    const outside = path.join(directory, 'outside'),
      parent = path.join(directory, 'parent');
    await fs.mkdir(outside);
    await fs.mkdir(parent);
    await fs.writeFile(path.join(outside, 'personal.txt'), 'preserved');
    await fs.symlink(
      outside,
      path.join(parent, 'FreeCut-VoiceModels'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(storage.choose(parent), /符号链接/);
    assert.equal(await fs.readFile(path.join(outside, 'personal.txt'), 'utf8'), 'preserved');
    const alias = path.join(directory, 'parent-alias');
    await fs.symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await storage.choose(alias);
    assert.equal(result.path, path.join(await fs.realpath(outside), 'FreeCut-VoiceModels'));
    const nested = path.join(result.path, 'tts-zh-v1');
    await fs.symlink(outside, nested, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(storage.assertModelWritable('tts-zh'), /符号链接/);
  });
});

test('a write permission failure has a useful message and does not persist the selected folder', async (t) => {
  await fixture(async ({ directory, userData, storage }) => {
    const write = fs.writeFile;
    t.mock.method(fs, 'writeFile', async (file, ...args) => {
      if (path.basename(file).startsWith('.freecut-write-'))
        throw Object.assign(Error('Access denied'), { code: 'EACCES' });
      return write(file, ...args);
    });
    await assert.rejects(storage.choose(path.join(directory, 'readonly')), /没有写入权限/);
    assert.equal(storage.status().custom, false);
    assert.equal(await fs.stat(path.join(userData, 'voice-storage.json')).catch(() => null), null);
  });
});

test('custom installer ownership rejects unknown files added after selection and permits its own partial model', async () => {
  await fixture(async ({ directory, storage }) => {
    await storage.choose(directory);
    const target = storage.modelPath('tts-zh');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'personal.txt'), 'keep');
    await assert.rejects(storage.assertModelWritable('tts-zh'), /未知模型文件/);
    assert.equal(await fs.readFile(path.join(target, 'personal.txt'), 'utf8'), 'keep');
    const chat = storage.modelPath('chattts');
    await storage.assertModelWritable('chattts');
    await storage.markModel('chattts');
    await fs.writeFile(path.join(chat, 'model.bin.partial'), 'owned unfinished download');
    await storage.assertModelWritable('chattts');
  });
});

test(
  'real AI and ChatTTS operations participate in the same storage lock and release it after cancellation',
  { skip: !NATIVE[`${process.platform}-${process.arch}`] },
  async (t) => {
    await fixture(async ({ directory, userData }) => {
      const storage = createVoiceModelStorage({ userData });
      let requests = 0;
      t.mock.method(fs, 'statfs', async () => ({ bavail: 10 ** 9, bsize: 4096 }));
      t.mock.method(
        global,
        'fetch',
        (_url, options) =>
          new Promise((_, reject) => {
            requests++;
            options.signal.addEventListener(
              'abort',
              () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })),
              { once: true },
            );
          }),
      );
      const ai = createAIService({ app: { getPath: () => userData }, voiceStorage: storage });
      const chat = createChatTTS({ userData, voiceStorage: storage });
      for (const service of [ai, chat]) {
        const initial = requests;
        const installing = service === ai ? ai.install('tts-zh', () => {}) : chat.install();
        const failed = assert.rejects(installing, /取消|cancelled/);
        await eventually(() => requests > initial);
        assert.equal(storage.status().busy, true);
        await assert.rejects(storage.choose(directory), /当前任务/);
        await service.cancel();
        await failed;
        assert.equal(storage.status().busy, false);
      }
    });
  },
);

test(
  'the production Chinese voice installer downloads, extracts and verifies models in the custom folder while retaining default ASR',
  { skip: !NATIVE[`${process.platform}-${process.arch}`] },
  async (t) => {
    await fixture(async ({ directory, userData }) => {
      const storage = createVoiceModelStorage({ userData });
      await storage.choose(path.join(directory, 'new model disk'));
      const runtime = path.join(
        userData,
        'ai',
        `runtime-1.13.7-${process.platform}-${process.arch}`,
      );
      await fs.mkdir(runtime, { recursive: true });
      const engine = Buffer.from('controlled ready runtime');
      await fs.writeFile(path.join(runtime, 'engine.fixture'), engine);
      await fs.writeFile(
        path.join(runtime, 'installed.json'),
        JSON.stringify({
          version: '1.13.7',
          files: [{ name: 'engine.fixture', size: engine.length, sha256: digest(engine) }],
        }),
      );
      const asr = path.join(userData, 'ai', 'asr-sensevoice-v1', 'model.int8.onnx');
      await fs.mkdir(path.dirname(asr), { recursive: true });
      await fs.writeFile(asr, 'existing subtitles');
      // A tiny genuine bzip2 tar containing voice/model.onnx. This exercises the
      // production download verifier and extractor without network or a real model.
      const archive = Buffer.from(
        'QlpoOTFBWSZTWUeqHGEAAIXbgM6AQAHvAEAAbmefQAgIIAB0GlHqAYh6jQND0nqCSUNBoNAAAPvXkSEGsiEIhzbOXVUTIEMMw2eg9oOE5ghGkhqDR7sao2ksg5oKO50JoJnWFtFh3+OMXTDCSv+SDJg2THsREB+LuSKcKEgj1Q4wgA==',
        'base64',
      );
      const previous = MODELS['tts-zh'].files;
      let downloads = 0;
      MODELS['tts-zh'].files = [
        {
          name: 'tts.tar.bz2',
          url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/controlled-fixture.tar.bz2',
          size: archive.length,
          sha256: digest(archive),
        },
      ];
      t.mock.method(global, 'fetch', async () => {
        downloads++;
        return new Response(archive, {
          status: 200,
          headers: { 'content-length': String(archive.length) },
        });
      });
      try {
        const ai = createAIService({ app: { getPath: () => userData }, voiceStorage: storage });
        const result = await ai.install('tts-zh', () => {});
        assert.equal(downloads, 1);
        assert.equal(result.models.find((model) => model.id === 'tts-zh').installed, true);
        assert.equal(
          await fs.readFile(path.join(storage.modelPath('tts-zh'), 'model.onnx'), 'utf8'),
          'controlled chinese voice model',
        );
        const receipt = JSON.parse(
          await fs.readFile(path.join(storage.modelPath('tts-zh'), 'installed.json'), 'utf8'),
        );
        assert.equal(
          receipt.files[0].sha256,
          digest(Buffer.from('controlled chinese voice model')),
        );
        assert.equal((await fs.readdir(storage.cachePath('tts-zh'))).length, 1);
        assert.equal(await fs.stat(path.join(userData, 'ai', 'tts-zh-v1')).catch(() => null), null);
        assert.equal(await fs.readFile(asr, 'utf8'), 'existing subtitles');
        assert.equal(storage.status().busy, false);
      } finally {
        MODELS['tts-zh'].files = previous;
      }
    });
  },
);

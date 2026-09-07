'use strict';
// Run after npm run build: node scripts/regression-language.cjs [--capture-promo]
// Default output stays in temporary QA storage; --capture-promo explicitly
// refreshes videos/freecut-launch-en/assets for the promotional video.
// Real Electron UI and native-dialog boundary checks. Only file choices and
// close-confirmation responses are redirected; actual IPC/guards remain active.
// The profile, sample project, original artwork, audio and diagnostics are
// isolated in a fresh canonical temporary folder. No external media or network.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { _electron, expect } = require('@playwright/test');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-language-'),
  );
  const profile = path.join(directory, 'profile');
  const capturePromo = process.argv.includes('--capture-promo');
  const output = capturePromo
    ? path.join(root, 'videos/freecut-launch-en/assets')
    : path.join(directory, 'screenshots');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(profile);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  const report = {
    directory,
    profile,
    startedAt: new Date().toISOString(),
    checks: [],
    rendererErrors: [],
    screenshots: [],
    capturePromo,
    passed: false,
  };
  let app, page;
  async function check(name, action) {
    console.log('RUN: ' + name);
    await action();
    report.checks.push({ name, passed: true });
    console.log('PASS: ' + name);
  }
  async function launch() {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1920, height: 1080 });
    const paths = await app.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    assert.deepEqual(paths, { userData: profile, sessionData: profile });
    await app.evaluate(({ dialog }) => {
      globalThis.__languageDialogs = { open: [], save: [], messages: [], response: 2 };
      dialog.showOpenDialog = async (_window, options) => {
        const files = globalThis.__languageDialogs.open.shift();
        if (!files) throw Error('Unexpected open dialog');
        globalThis.__languageDialogs.openOptions = options;
        return { canceled: false, filePaths: files };
      };
      dialog.showSaveDialog = async (_window, options) => {
        const filePath = globalThis.__languageDialogs.save.shift();
        if (!filePath) throw Error('Unexpected save dialog');
        globalThis.__languageDialogs.saveOptions = options;
        return { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_window, options) => {
        globalThis.__languageDialogs.messages.push(options);
        return { response: globalThis.__languageDialogs.response, checkboxChecked: false };
      };
    });
  }
  async function screenshot(name) {
    await expect(page.locator('.toast')).toHaveCount(0);
    // The fixture is intentionally authored entirely in English. A visible Han
    // character here is untranslated interface copy, not user media content.
    const text = await page.locator('.app').evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const visible = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        // Native selects expose every option in innerText even when closed;
        // these language names intentionally remain in their own language.
        if (!parent || parent.closest('option,script,style') || !parent.getClientRects().length)
          continue;
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (node.textContent.trim()) visible.push(node.textContent.trim());
      }
      return visible.join('\n');
    });
    assert(
      !/[\p{Script=Han}]/u.test(text),
      'Untranslated editor copy: ' + text.match(/[^\n]*[\p{Script=Han}][^\n]*/gu)?.join('\n'),
    );
    assert(!/ImportMedia|ImportAudio|\dclips\b/.test(text), 'Missing spaces in translated copy');
    const file = path.join(output, name + '.png');
    await page.screenshot({ path: file });
    report.screenshots.push(file);
    const png = await fs.readFile(file);
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
    console.log('SCREENSHOT: ' + file);
  }
  async function layoutCheck(label) {
    const boxes = await page.evaluate(() => {
      const selectors = [
        '.topbar',
        '.workspace',
        '.timeline-toolbar',
        '.statusbar',
        '.tool-nav',
        '.inspector',
      ];
      return {
        width: innerWidth,
        height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        panels: selectors.flatMap((selector) =>
          Array.from(document.querySelectorAll(selector))
            .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
            .map((e) => {
              const r = e.getBoundingClientRect();
              return {
                selector,
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
              };
            }),
        ),
      };
    });
    report.layouts ??= [];
    report.layouts.push({ label, ...boxes });
    assert(boxes.documentWidth <= boxes.width + 1, label + ' has page-level horizontal overflow');
    for (const b of boxes.panels)
      assert(
        b.x >= -1 && b.right <= boxes.width + 1,
        label + ' panel outside viewport: ' + JSON.stringify(b),
      );
  }
  try {
    await launch();
    await check(
      'Fresh profile defaults to Simplified Chinese, independent of system locale',
      async () => {
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await expect(page.getByLabel('简体中文 Language', { exact: true })).toHaveValue('zh-CN');
      },
    );
    await check('English switch updates Home and About without a donation request', async () => {
      await page.getByLabel('简体中文 Language', { exact: true }).selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'About', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Star on GitHub', exact: true })).toBeVisible();
      const content = await page.locator('.home-about').innerText();
      assert(content.includes('All features are free forever'));
      assert(!/donat|sponsor|afdian/i.test(content));
      await page.screenshot({ path: path.join(directory, 'about-en.png') });
    });
    await app.close();
    app = undefined;
    await launch();
    await check('English selection persists across a real Electron restart', async () => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => localStorage.getItem('freecut-language')), 'en');
    });
    await check(
      'Native locale IPC rejects unsupported values without changing the selected language',
      async () => {
        const error = await page.evaluate(async () => {
          try {
            await window.freecut.setLanguage('fr');
            return '';
          } catch (error) {
            return String(error);
          }
        });
        assert.match(error, /Unsupported interface language/);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      },
    );
    const drawings = await page.evaluate(() => {
      const palettes = [
        ['#f1bda0', '#f9dcb5', '#ae725d', '#587465', '#274f49'],
        ['#a0cad5', '#d6e8c6', '#76a0a3', '#548c88', '#275b65'],
        ['#d5b9bf', '#ead1c4', '#b78988', '#6a747c', '#3b515d'],
      ];
      return palettes.map((colors, index) => {
        const c = document.createElement('canvas');
        c.width = 1920;
        c.height = 1080;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 1900, 1000);
        g.addColorStop(0, colors[0]);
        g.addColorStop(1, colors[1]);
        x.fillStyle = g;
        x.fillRect(0, 0, 1920, 1080);
        x.fillStyle = '#fff2c9';
        x.beginPath();
        x.arc(1450, 320, 210, 0, Math.PI * 2);
        x.fill();
        x.strokeStyle = '#fff6da80';
        x.lineWidth = 3;
        for (const radius of [237, 267, 307]) {
          x.beginPath();
          x.arc(1450, 320, radius, Math.PI * 0.82, Math.PI * 1.9);
          x.stroke();
        }
        x.fillStyle = colors[2];
        x.beginPath();
        x.moveTo(0, 690);
        x.bezierCurveTo(330, 580, 550, 610, 760, 730);
        x.bezierCurveTo(1080, 820, 1220, 480, 1490, 560);
        x.bezierCurveTo(1680, 610, 1800, 760, 1920, 620);
        x.lineTo(1920, 1080);
        x.lineTo(0, 1080);
        x.fill();
        x.fillStyle = colors[3];
        x.beginPath();
        x.moveTo(0, 775);
        x.bezierCurveTo(370, 680, 490, 930, 830, 855);
        x.bezierCurveTo(1220, 770, 1440, 760, 1920, 880);
        x.lineTo(1920, 1080);
        x.lineTo(0, 1080);
        x.fill();
        x.fillStyle = colors[4];
        x.beginPath();
        x.moveTo(0, 900);
        x.bezierCurveTo(440, 795, 530, 1000, 880, 990);
        x.bezierCurveTo(1200, 980, 1550, 820, 1920, 920);
        x.lineTo(1920, 1080);
        x.lineTo(0, 1080);
        x.fill();
        const shade = x.createLinearGradient(0, 0, 1300, 0);
        shade.addColorStop(0, '#173f43c9');
        shade.addColorStop(1, '#173f4300');
        x.fillStyle = shade;
        x.fillRect(0, 0, 1600, 1080);
        x.fillStyle = '#f9f2df';
        x.font = '500 27px "Microsoft YaHei",sans-serif';
        x.fillText('THE EVERYDAY CUT', 210, 190);
        x.fillStyle = '#e9eedf';
        x.font = '32px "Microsoft YaHei",sans-serif';
        x.fillText(
          [
            'Make every frame your own.',
            'Slow down. See another side of everyday life.',
            'Give your story a timeline of its own.',
          ][index],
          218,
          760,
        );
        x.fillStyle = '#d1e5cb';
        x.fillRect(218, 808, 88, 4);
        x.font = '24px "Microsoft YaHei",sans-serif';
        x.fillText('ORIGINAL ARTWORK / FREECUT', 328, 820);
        x.fillStyle = '#ecf0df';
        x.font = '32px "Microsoft YaHei",sans-serif';
        x.fillText(`0${index + 1} / 03`, 1630, 980);
        return c.toDataURL('image/png');
      });
    });
    const names = ['Sunset hills', 'Coastal breeze', 'Evening glow'];
    const assets = [];
    for (let i = 0; i < drawings.length; i++) {
      const file = path.join(directory, `${names[i]}.png`);
      await fs.writeFile(file, Buffer.from(drawings[i].split(',')[1], 'base64'));
      assets.push({
        id: `scene${i}`,
        name: `${names[i]}.png`,
        kind: 'image',
        path: file,
        url: `freecut-media://asset/scene${i}`,
        duration: 4.5,
        width: 1920,
        height: 1080,
        thumbnail: drawings[i],
      });
    }
    const sampleRate = 22050,
      seconds = 13.5,
      count = Math.floor(sampleRate * seconds),
      pcm = Buffer.alloc(44 + count * 2);
    pcm.write('RIFF', 0);
    pcm.writeUInt32LE(pcm.length - 8, 4);
    pcm.write('WAVEfmt ', 8);
    pcm.writeUInt32LE(16, 16);
    pcm.writeUInt16LE(1, 20);
    pcm.writeUInt16LE(1, 22);
    pcm.writeUInt32LE(sampleRate, 24);
    pcm.writeUInt32LE(sampleRate * 2, 28);
    pcm.writeUInt16LE(2, 32);
    pcm.writeUInt16LE(16, 34);
    pcm.write('data', 36);
    pcm.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate,
        beat = t % 0.625,
        note = [220, 277.18, 329.63, 415.3][Math.floor(t / 1.25) % 4],
        v =
          Math.sin(2 * Math.PI * note * t) * Math.exp(-beat * 6) * 0.12 +
          Math.sin(2 * Math.PI * 110 * t) * 0.035;
      pcm.writeInt16LE(Math.round(v * Math.min(1, t * 2, (seconds - t) * 2) * 32767), 44 + i * 2);
    }
    const audio = path.join(directory, 'Original ambient beat.wav');
    await fs.writeFile(audio, pcm);
    assets.push({
      id: 'sound',
      name: 'Original ambient beat.wav',
      kind: 'audio',
      path: audio,
      url: 'freecut-media://asset/sound',
      duration: seconds,
    });
    const transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 };
    const effects = {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      hue: 0,
      blur: 0,
      grayscale: 0,
      sepia: 0,
      vignette: 0,
      pixelate: 0,
      chroma: false,
      chromaColor: '#00ff00',
      chromaThreshold: 80,
      flipX: false,
      flipY: false,
      mask: 'none',
      maskSize: 1,
      maskX: 0,
      maskY: 0,
      maskRotation: 0,
      maskFeather: 0,
      maskInvert: false,
    };
    const clip = (id, kind, trackId, extra) => ({
      id,
      name: id,
      kind,
      trackId,
      start: 0,
      duration: 4.5,
      inPoint: 0,
      speed: 1,
      transform: { ...transform },
      effects: { ...effects },
      keyframes: {},
      fadeIn: 0,
      fadeOut: 0,
      ...extra,
    });
    const project = {
      version: 1,
      id: 'original-showcase',
      name: 'Make room for your story',
      width: 1920,
      height: 1080,
      fps: 30,
      background: '#173f43',
      assets,
      tracks: [
        {
          id: 'title',
          name: 'Titles',
          kind: 'overlay',
          muted: false,
          hidden: false,
          locked: false,
        },
        {
          id: 'picture',
          name: 'Picture',
          kind: 'video',
          muted: false,
          hidden: false,
          locked: false,
        },
        { id: 'music', name: 'Audio', kind: 'audio', muted: false, hidden: false, locked: false },
      ],
      clips: [],
    };
    for (let i = 0; i < 3; i++) {
      project.clips.push(
        clip(`scene-${i}`, 'image', 'picture', {
          name: names[i],
          start: i * 4.5,
          assetId: `scene${i}`,
        }),
      );
      project.clips.push(
        clip(`title-${i}`, 'text', 'title', {
          name: [
            'Make room · For your story',
            'Everyday · A new perspective',
            'Create freely · Your way',
          ][i],
          start: i * 4.5,
          transform: { ...transform, x: -742, y: -30 },
          text: {
            text: [
              'Make room\nfor your story',
              'Everyday life\nA new perspective',
              'Create freely\nMake it yours',
            ][i],
            fontSize: 100,
            color: '#fff9e7',
            background: 'transparent',
            align: 'left',
            bold: true,
            stroke: false,
          },
          keyframes: {
            x: [
              { id: `x-${i}-0`, time: 0, value: -780, easing: 'ease-out' },
              { id: `x-${i}-1`, time: 1.5, value: -742, easing: 'linear' },
            ],
            opacity: [
              { id: `o-${i}-0`, time: 0, value: 0, easing: 'ease-out' },
              { id: `o-${i}-1`, time: 0.6, value: 1, easing: 'linear' },
            ],
          },
        }),
      );
    }
    project.clips.push(
      clip('music', 'audio', 'music', {
        name: 'Original ambient beat',
        assetId: 'sound',
        duration: 13.5,
        transform: { ...transform, volume: 0.6 },
        fadeIn: 0.8,
        fadeOut: 1,
      }),
    );
    const file = path.join(directory, 'english-showcase.freecut');
    await fs.writeFile(file, JSON.stringify(project));

    await app.evaluate((_, file) => globalThis.__languageDialogs.open.push([file]), file);
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const skip = page.getByRole('button', { name: 'Skip tour', exact: true });
    if (await skip.count()) await skip.click();
    await page.getByTitle('Open project Ctrl+O', { exact: true }).click();
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(project.name);
    const ruler = await page.locator('.ruler').boundingBox();
    await page.mouse.click(ruler.x + 2 * 65, ruler.y + 10);
    await page
      .getByRole('button', { name: 'Clip Make room · For your story', exact: true })
      .click();
    await expect.poll(() => page.locator('.time-readout b').textContent()).toContain('02:');
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Video preview"]');
      if (!c?.width) return false;
      const x = c.getContext('2d'),
        colors = new Set();
      for (let yy = 1; yy < 5; yy++)
        for (let xx = 1; xx < 8; xx++)
          colors.add(
            [
              ...x.getImageData(
                Math.floor((c.width * xx) / 8),
                Math.floor((c.height * yy) / 5),
                1,
                1,
              ).data,
            ].join(','),
          );
      return colors.size > 10;
    });
    await check('Real English demo renders in the desktop layout', async () => {
      await expect(page.locator('.library .panel-heading')).toContainText('Media workspace');
      await expect(page.getByRole('button', { name: 'Import media', exact: true })).toBeVisible();
      await expect(page.locator('.timeline-toolbar')).toContainText('7 clips');
      await expect(
        page.getByRole('button', { name: 'Record current frame', exact: true }),
      ).toBeVisible();
      await layoutCheck('Desktop 1920');
      await screenshot('editor-en');
    });
    await page.getByTitle('Switch keyframe editing mode', { exact: true }).click();
    await page
      .locator('.inspector-tabs')
      .getByRole('button', { name: 'Keyframes', exact: true })
      .click();
    await check('Professional keyframe properties, values and easing are in English', async () => {
      await expect(
        page.getByLabel('Position X keyframe value', { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByLabel('Easing', { exact: true }).first()).toBeVisible();
      await screenshot('editor-keyframes-en');
    });
    await page.getByTitle('Switch keyframe editing mode', { exact: true }).click();
    await page
      .locator('.inspector-tabs')
      .getByRole('button', { name: 'Basic', exact: true })
      .click();
    const selection = await page.getByTestId('preview-selection-box').boundingBox();
    await page.mouse.move(selection.x + selection.width / 2, selection.y + selection.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      selection.x + selection.width / 2 + 70,
      selection.y + selection.height / 2 + 15,
      { steps: 10 },
    );
    await page.mouse.up();
    await check('Direct preview transform produces real English controls', async () => {
      await expect(
        page.getByRole('button', { name: 'Rotate selected object', exact: true }),
      ).toBeVisible();
      await screenshot('editor-transform-en');
    });
    await page.keyboard.press('ControlOrMeta+z');
    await page.getByTitle('Switch desktop / mobile layout', { exact: true }).click();
    await page.locator('.tool-nav').getByRole('button', { name: 'Media', exact: true }).click();
    await check(
      'Mobile layout works in English at 1920 and a narrow desktop viewport',
      async () => {
        await layoutCheck('Mobile layout 1920');
        await screenshot('mobile-en');
        await page.setViewportSize({ width: 1024, height: 768 });
        await layoutCheck('Mobile layout 1024');
        await page.screenshot({ path: path.join(directory, 'mobile-en-1024.png') });
        await page.getByTitle('Switch desktop / mobile layout', { exact: true }).click();
        await layoutCheck('Desktop 1024');
        await page.screenshot({ path: path.join(directory, 'editor-en-1024.png') });
        await page.setViewportSize({ width: 1920, height: 1080 });
      },
    );
    await check(
      'Native save dialog receives English options and preserves English project text',
      async () => {
        const saved = path.join(directory, 'saved-english-showcase.freecut');
        await app.evaluate((_, saved) => globalThis.__languageDialogs.save.push(saved), saved);
        await page.getByTitle('Save project Ctrl+S', { exact: true }).click();
        await expect(page.getByText('Processing project file…', { exact: true })).toBeHidden();
        await expect
          .poll(() => fs.readFile(saved, 'utf8').catch(() => ''), { timeout: 15000 })
          .not.toBe('');
        const actual = JSON.parse(await fs.readFile(saved, 'utf8'));
        assert.equal(actual.name, project.name);
        assert.equal(
          actual.clips.find((c) => c.id === 'title-0').text.text,
          'Make room\nfor your story',
        );
        const options = await app.evaluate(() => globalThis.__languageDialogs.saveOptions);
        report.nativeSave = options;
        assert(options.title && !/[\p{Script=Han}]/u.test(options.title), JSON.stringify(options));
      },
    );
    await check(
      'Native quit guard asks to save in English; Cancel keeps the project open',
      async () => {
        await page.getByLabel('Project name', { exact: true }).fill('Unsaved English QA');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect
          .poll(() => app.evaluate(() => globalThis.__languageDialogs.messages.length))
          .toBe(1);
        const options = await app.evaluate(() => globalThis.__languageDialogs.messages[0]);
        report.nativeClose = options;
        assert.equal(options.title, 'Save changes');
        assert.deepEqual(options.buttons, ['Save and quit', 'Discard', 'Cancel']);
        assert(!/donat|sponsor|afdian/i.test(JSON.stringify(options)));
        await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(
          'Unsaved English QA',
        );
        await app.evaluate(() => {
          globalThis.__languageDialogs.response = 1;
        });
        const exited = app.waitForEvent('close');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await exited;
        app = undefined;
      },
    );
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
    const provenance = {
      capturedAt: new Date().toISOString(),
      applicationVersion: require('../package.json').version,
      script: 'scripts/regression-language.cjs',
      method:
        'Real Electron desktop screenshot with original locally drawn artwork, English text clips, and a synthesized audio fixture. No UI compositing.',
      resolution: [1920, 1080],
      checks: report.checks,
      screenshots: await Promise.all(
        report.screenshots.map(async (file) => {
          const data = await fs.readFile(file);
          return {
            file: path.basename(file),
            bytes: data.length,
            sha256: crypto.createHash('sha256').update(data).digest('hex'),
          };
        }),
      ),
    };
    await fs.writeFile(
      path.join(output, 'capture-provenance.json'),
      JSON.stringify(provenance, null, 2) + '\n',
    );
  } catch (error) {
    report.error = error.stack;
    await page?.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(directory, 'language-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log('REPORT: ' + path.join(directory, 'language-report.json'));
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
  }
}

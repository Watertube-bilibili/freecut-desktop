'use strict';
// Capture the real application with original, locally drawn sample artwork.
// No downloaded media or UI compositing. Re-run after npm run build.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron, expect } = require('@playwright/test');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function main() {
  const root = path.resolve(__dirname, '..'),
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-showcase-'));
  const output = path.join(root, 'docs/screenshots');
  await fs.mkdir(output, { recursive: true });
  const launch = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    launch,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(directory, 'profile'))});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  const app = await _electron.launch({ args: [launch], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.setViewportSize({ width: 1920, height: 1080 });
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
            '让每一帧，都有你的表达。',
            '慢下来，发现日常的另一种颜色。',
            '把故事，留在你自己的时间线上。',
          ][index],
          218,
          760,
        );
        x.fillStyle = '#d1e5cb';
        x.fillRect(218, 808, 88, 4);
        x.font = '24px "Microsoft YaHei",sans-serif';
        x.fillText('原创样例 / 水管剪辑', 328, 820);
        x.fillStyle = '#ecf0df';
        x.font = '32px "Microsoft YaHei",sans-serif';
        x.fillText(`0${index + 1} / 03`, 1630, 980);
        return c.toDataURL('image/png');
      });
    });
    const names = ['落日与山丘', '海风与远岸', '暮色与晚风'];
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
    const audio = path.join(directory, '原创氛围节拍.wav');
    await fs.writeFile(audio, pcm);
    assets.push({
      id: 'sound',
      name: '原创氛围节拍.wav',
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
      name: '把灵感，剪成故事',
      width: 1920,
      height: 1080,
      fps: 30,
      background: '#173f43',
      assets,
      tracks: [
        { id: 'title', name: '文字', kind: 'overlay', muted: false, hidden: false, locked: false },
        { id: 'picture', name: '画面', kind: 'video', muted: false, hidden: false, locked: false },
        { id: 'music', name: '声音', kind: 'audio', muted: false, hidden: false, locked: false },
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
          name: ['把灵感 · 剪成故事', '发现日常 · 新视角', '自由创作 · 由你定义'][i],
          start: i * 4.5,
          transform: { ...transform, x: -742, y: -30 },
          text: {
            text: ['把灵感\n剪成故事', '发现日常\n另一种视角', '自由创作\n由你定义'][i],
            fontSize: 118,
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
        name: '原创氛围节拍',
        assetId: 'sound',
        duration: 13.5,
        transform: { ...transform, volume: 0.6 },
        fadeIn: 0.8,
        fadeOut: 1,
      }),
    );
    const file = path.join(directory, '原创样例.freecut');
    await fs.writeFile(file, JSON.stringify(project));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, file);
    await page.getByRole('button', { name: /^新建项目/ }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(project.name);
    const ruler = await page.locator('.ruler').boundingBox();
    await page.mouse.click(ruler.x + 2 * 65, ruler.y + 10);
    await page.getByRole('button', { name: '片段 把灵感 · 剪成故事', exact: true }).click();
    await expect.poll(() => page.locator('.time-readout b').textContent()).toContain('02:');
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="视频预览"]');
      if (!c || !c.width) return false;
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
    await page.screenshot({ path: path.join(output, 'editor-030.png') });
    await page.getByTitle('切换关键帧操作模式', { exact: true }).click();
    await page
      .locator('.inspector-tabs')
      .getByRole('button', { name: '关键帧', exact: true })
      .click();
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'editor-keyframes-030.png') });
    await page.getByTitle('切换关键帧操作模式', { exact: true }).click();
    await page
      .locator('.inspector-tabs')
      .getByRole('button', { name: '基础', exact: true })
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
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'editor-transform-030.png') });
    await page.keyboard.press('ControlOrMeta+z');
    await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
    await page.locator('.tool-nav').getByRole('button', { name: '素材', exact: true }).click();
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'mobile-030.png') });
    console.log(`Screenshots: ${output}\nOriginal sample project: ${file}`);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

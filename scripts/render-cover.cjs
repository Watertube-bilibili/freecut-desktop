'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
async function main() {
  const root = path.resolve(__dirname, '..');
  const destination = path.join(root, 'renders', 'shuiguan-launch-cover.png');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const options = { headless: true };
  if (process.env.FREECUT_COVER_BROWSER) options.executablePath = process.env.FREECUT_COVER_BROWSER;
  else if (process.platform === 'win32') options.channel = 'chrome';
  const browser = await chromium.launch(options);
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(path.join(root, 'videos', 'shuiguan-launch', 'cover.html')).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
      if (
        document.documentElement.scrollWidth !== 1920 ||
        document.documentElement.scrollHeight !== 1080
      )
        throw Error('Cover exceeds its intended frame');
    });
    await page.screenshot({ path: destination });
    console.log(destination);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

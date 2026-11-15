// 앱 아이콘 만들기: build/icon.svg → build/icon.png (512×512, 투명 배경).
//
//   node scripts/render-icon.mjs                 아이콘을 다시 만든다
//   node scripts/render-icon.mjs --preview <폴더>  256·48·16 크기 미리보기도 함께 만든다(작은 크기에서 뭉개지지 않는지 확인용)
//
// 웹앱 쪽에 설치된 Playwright 의 Chromium 으로 그린다(`callsign/` 에서 npm install 이 되어 있어야 한다).
// Windows 용 .ico 는 electron-builder 가 이 PNG 에서 만든다.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(DESKTOP, 'build', 'icon.svg');
const PNG = path.join(DESKTOP, 'build', 'icon.png');
const SIZE = 512;

// @playwright/test 는 상위 폴더(callsign/node_modules)에 있다
const require = createRequire(path.join(DESKTOP, '..', 'package.json'));
const { chromium } = require('@playwright/test');

const previewAt = process.argv.indexOf('--preview');
const previewDir = previewAt >= 0 ? path.resolve(process.argv[previewAt + 1] ?? '') : null;

const svg = fs.readFileSync(SVG, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  fs.writeFileSync(PNG, png);
  console.log(`${path.relative(DESKTOP, PNG)}  ${SIZE}x${SIZE}  ${png.length} bytes`);

  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    // 512 PNG 를 줄여서 본다(.ico 를 만들 때와 같은 방향). 밝은 바탕과 어두운 바탕 위에 나란히 놓는다
    for (const size of [256, 48, 32, 16]) {
      const zoom = Math.max(1, Math.round(256 / size));
      await page.setViewportSize({ width: size * zoom * 2, height: size * zoom });
      await page.setContent(`<!doctype html><style>html,body{margin:0}canvas{display:block;image-rendering:pixelated;width:${size * zoom * 2}px;height:${size * zoom}px}</style><canvas width="${size * 2}" height="${size}"></canvas>`);
      await page.evaluate(async ({ dataUrl, size }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const ctx = document.querySelector('canvas').getContext('2d');
        ctx.fillStyle = '#f3f3f3';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#1f1f1f';
        ctx.fillRect(size, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        ctx.drawImage(img, size, 0, size, size);
      }, { dataUrl, size });
      const file = path.join(previewDir, `icon-${size}.png`);
      fs.writeFileSync(file, await page.screenshot());
      console.log(`preview ${file} (${zoom}x 확대)`);
    }
  }
} finally {
  await browser.close();
}

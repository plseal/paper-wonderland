import { chromium } from 'playwright';
const URL_ = process.argv[2] || 'http://localhost:4173/paper-wonderland/';
const OUT = '/tmp/kai/';
import fs from 'node:fs'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/home/box/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(URL_); await page.waitForSelector('#title:not(.hidden)'); await page.waitForTimeout(600);
await page.screenshot({ path: OUT + 'title.png' });
const t0 = Date.now();
await page.click('#kaiBtn');
await page.waitForFunction(() => window.__game.state().level === 'kai' && window.__game.state().state === 'play', null, { timeout: 120000 });
console.log('ready', Date.now() - t0);
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => window.__game.state());
console.log(JSON.stringify(await st()));
const views = JSON.parse(process.env.VIEWS || '[]');
for (const v of views) {
  await page.evaluate((v) => { const g = window.__game._game; if (v.tp) window.__game.teleport(...v.tp); const c = g.camera; if (v.yaw !== undefined) c.yaw = v.yaw; if (v.dist) c.dist = v.dist; if (v.pitch !== undefined) c.pitch = v.pitch; }, v);
  await page.waitForTimeout(v.wait || 1200);
  await page.screenshot({ path: OUT + v.name + '.png' });
  console.log(v.name, JSON.stringify((await st()).pos));
}
await browser.close();

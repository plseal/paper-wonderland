// Koiwa (小岩駅北口) sample level: loads, renders, collides, and can be cleared.
// Usage: node tests/koiwa.mjs [url]   (expects `vite preview --port 4173` running)
import { chromium } from 'playwright';
import fs from 'node:fs';

const GAME_URL = process.argv[2] || 'http://localhost:4173/paper-wonderland/';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[koiwa]', ...a);
const errors = [];
const browserCtxOpts = { acceptDownloads: true };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/home/box/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 }, ...browserCtxOpts });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const st = () => page.evaluate(() => window.__game.state());
const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
const sleep = (ms) => page.waitForTimeout(ms);
const assert = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); log('✓', msg); };
const cam = (yaw, dist, pitch) => page.evaluate(([y, d, p]) => { const c = window.__game._game.camera; c.yaw = y; c.dist = d; c.pitch = p; }, [yaw, dist, pitch]);
async function finishDialog() { for (let i = 0; i < 40; i++) { const s = await st(); if (!s.dialogOpen) return; await page.keyboard.press('KeyE'); await sleep(150); } }

try {
  await page.goto(GAME_URL, { waitUntil: 'load' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await sleep(800);
  assert(await page.isVisible('#koiwaBtn'), 'title has the こいわの まち button');
  assert((await page.textContent('#title')).includes('PLATEAU') && (await page.textContent('#title')).includes('OpenStreetMap'), 'title shows PLATEAU / OSM credits');
  await shot('11_koiwa_title');
  const t0 = Date.now();
  await page.click('#koiwaBtn');
  await page.waitForFunction(() => window.__game.state().level === 'koiwa' && window.__game.state().state === 'play', null, { timeout: 120000 });
  log('koiwa level ready in', Date.now() - t0, 'ms');
  await sleep(1500);
  let s = await st();
  assert(s.level === 'koiwa' && s.total === 3 && s.stars3d.length === 3, 'koiwa level loaded with 3 stars');
  assert(s.activeMeshes > 10, `scene renders meshes (${s.activeMeshes} active)`);
  assert((await page.textContent('#creditsLine')).includes('OpenStreetMap'), 'in-game attribution line visible');
  await shot('11_koiwa_start');

  // building / station collision: walk south-east into the station wall, must stop
  await page.keyboard.down('KeyW'); await sleep(4000); await page.keyboard.up('KeyW');
  s = await st();
  assert(s.pos.z > -3, `station wall blocks the bunny (pos ${s.pos.x.toFixed(1)}, ${s.pos.z.toFixed(1)})`);

  await page.keyboard.down('KeyA'); await sleep(1500); await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD'); await sleep(2500); await page.keyboard.up('KeyD');
  // talk to Kon
  const g = await page.evaluate(() => { const L = window.__game._game.level; return { x: L.interactables[0].pos.x, z: L.interactables[0].pos.z }; });
  await page.evaluate(([x, z]) => window.__game.teleport(x - 1.6, 0, z + 0.4), [g.x, g.z]);
  await sleep(500);
  await page.keyboard.press('KeyE');
  await sleep(600);
  await shot('11_koiwa_npc_dialog');
  await finishDialog();
  s = await st();
  assert(s.questStage === 1, 'talking to コン starts the quest');

  // collect the stars (teleport next to each, then walk onto it)
  for (const [i, star] of s.stars3d.entries()) {
    await page.evaluate(([x, z]) => window.__game.teleport(x, 0, z), [star.x, star.z]);
    await sleep(700);
    if (i === 1) { await cam(3.6, 16, 0.55); await sleep(1500); await shot('11_koiwa_star'); }
  }
  s = await st();
  assert(s.stars === 3 && s.questStage === 2, 'all 3 stars collected');
  await cam(0.7, 48, 0.8); await page.evaluate(() => window.__game.teleport(5, 0, 12)); await sleep(2500);
  await shot('11_koiwa_overview');
  await cam(2.3, 10, 0.26);
  await page.evaluate(([x, z]) => window.__game.teleport(x - 1.6, 0, z + 0.4), [g.x, g.z]);
  await sleep(600);
  await page.keyboard.press('KeyE');
  await sleep(600);
  await finishDialog();
  await page.waitForSelector('#clear:not(.hidden)', { timeout: 10000 });
  s = await st();
  assert(s.cleared && s.state === 'clear', 'returning to コン clears the level');
  await sleep(600);
  await shot('11_koiwa_clear');

  // shareable result card (Koiwa only)
  await page.waitForFunction(() => { const i = document.querySelector('#clearCard'); return i && i.complete && i.naturalWidth > 0 && !document.querySelector('#cardWrap').classList.contains('hidden'); }, null, { timeout: 20000 });
  const dims = await page.evaluate(() => { const i = document.querySelector('#clearCard'); return [i.naturalWidth, i.naturalHeight]; });
  assert(dims[0] === 1080 && dims[1] === 1350, `result card image rendered (${dims.join('x')})`);
  assert(await page.isVisible('#saveCardBtn') && await page.isVisible('#shareCardBtn') && await page.isVisible('#retryBtn') && await page.isVisible('#titleBtn'), 'card buttons: ほぞん / シェア / もういちど / ステージを えらぶ');
  const pathLen = await page.evaluate(() => window.__game._game.level.path.length / 2);
  assert(pathLen >= 3, `route recorded (${pathLen} points)`);
  await sleep(500);
  await page.screenshot({ path: SHOTS + '12_koiwa_card.png' });
  const dataUrl = await page.evaluate(() => window.__game._game.menu.card.dataUrl);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  assert(png.length > 50000 && png.subarray(1, 4).toString() === 'PNG', `PNG generated (${(png.length / 1024).toFixed(0)} KB)`);
  fs.writeFileSync(SHOTS + '12_koiwa_card_export.png', png);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#saveCardBtn')]);
  assert(dl.suggestedFilename() === 'sorachan-koiwa-clear.png', 'がぞうを ほぞん downloads the PNG');
  // share: headless has no file sharing → falls back to an X post intent
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await page.click('#shareCardBtn');
  await sleep(500);
  const opened = await page.evaluate(() => window.__opened);
  const hasShare = await page.evaluate(() => !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'a.png', { type: 'image/png' })] })));
  assert(hasShare || (opened.length === 1 && opened[0].startsWith('https://x.com/intent/post') && opened[0].includes(encodeURIComponent('https://plseal.github.io/paper-wonderland/'))), 'シェア uses Web Share or the X intent fallback');
  // phone-sized layout still shows the card + buttons
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  assert(await page.isVisible('#clearCard') && await page.isVisible('#shareCardBtn'), 'card fits a phone screen');
  await page.screenshot({ path: SHOTS + '12_koiwa_card_mobile.png' });
  await page.setViewportSize({ width: 1100, height: 640 });

  // back to title and the forest still works
  await page.click('#titleBtn');
  await page.waitForSelector('#title:not(.hidden)');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__game.state().level === 'forest' && window.__game.state().state === 'play', null, { timeout: 120000 });
  assert(true, 'can go back and start the forest level');

  const filtered = errors.filter((e) => !/favicon/.test(e));
  assert(filtered.length === 0, 'no console errors' + (filtered.length ? ': ' + filtered.join(' | ') : ''));
  log('ALL PASSED');
} catch (e) {
  console.error(e); console.error('errors:', errors);
  try { console.error('state:', JSON.stringify(await st())); } catch {}
  await shot('zz_koiwa_failure').catch(() => {});
  process.exitCode = 1;
} finally { await browser.close(); }

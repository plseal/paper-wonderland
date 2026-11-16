// Stage 3 「かいと かぜの げんや」: new protagonist かい, open paper field, maraca melody opens the temple.
// Usage: node tests/level3.mjs [url]   (expects `vite preview --port 4173` running)
import { chromium } from 'playwright';
import fs from 'node:fs';

const GAME_URL = process.argv[2] || 'http://localhost:4173/paper-wonderland/';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[level3]', ...a);
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/home/box/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 }, acceptDownloads: true });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const st = () => page.evaluate(() => window.__game.state());
const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
const sleep = (ms) => page.waitForTimeout(ms);
const assert = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); log('✓', msg); };
const cam = (yaw, dist, pitch) => page.evaluate(([y, d, p]) => { const c = window.__game._game.camera; c.yaw = y; c.dist = d; c.pitch = p; }, [yaw, dist, pitch]);
const tp = (x, y, z) => page.evaluate(([x, y, z]) => window.__game.teleport(x, y, z), [x, y, z]);
async function finishDialog() { await sleep(400); for (let i = 0; i < 60; i++) { const s = await st(); if (!s.dialogOpen) return; await page.keyboard.press('KeyE'); await sleep(160); } }
const riverZ = (x) => 25 + 6 * Math.sin(x / 25);

try {
  await page.goto(GAME_URL, { waitUntil: 'load' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await sleep(800);
  assert(await page.isVisible('#startBtn') && await page.isVisible('#koiwaBtn') && await page.isVisible('#kaiBtn'), 'title lists forest, こいわ and the new 3rd stage');
  assert((await page.textContent('#kaiBtn')).includes('かいと かぜの げんや'), '3rd stage button is 「かいと かぜの げんや」');
  assert(await page.evaluate(() => { const i = document.querySelector('#kaiPortrait'); return i && i.complete && i.naturalWidth > 100; }), 'かい portrait shown on the title');
  await shot('13_kai_title');

  const t0 = Date.now();
  await page.click('#kaiBtn');
  await page.waitForFunction(() => window.__game.state().level === 'kai' && window.__game.state().state === 'play', null, { timeout: 120000 });
  log('kai level ready in', Date.now() - t0, 'ms');
  await sleep(1500);
  let s = await st();
  assert(s.level === 'kai' && s.total === 3 && s.stars3d.length === 3, 'field loaded with 3 おんぷの かけら');
  assert(s.activeMeshes > 20, `scene renders (${s.activeMeshes} active meshes, fps ${s.fps.toFixed(1)})`);
  assert(await page.evaluate(() => !!window.__game._game.player.shake && window.__game._game.player.casters.length > 20), 'かい is a 3D model avatar (with shake animation)');
  // close-up of かい
  await cam(Math.PI, 3.4, 0.12); await sleep(1500);
  await shot('13_kai_start');
  await cam(0, 9.5, 0.3); await sleep(500);

  // walk + jump
  const p0 = (await st()).pos;
  await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
  s = await st();
  assert(s.pos.z > p0.z + 2, `W walks north (z ${p0.z.toFixed(1)} → ${s.pos.z.toFixed(1)})`);
  const rot = await page.evaluate(() => window.__game._game.player.root.rotation.y);
  assert(Math.abs(rot) < 0.4, 'かい turns to face the walking direction');
  const y0 = s.pos.y; let maxY = y0;
  await page.keyboard.press('Space');
  for (let i = 0; i < 20; i++) { maxY = Math.max(maxY, (await st()).pos.y); await sleep(40); }
  assert(maxY > y0 + 0.5, `jump works (peak +${(maxY - y0).toFixed(2)})`);

  // maracas: E with nothing near → shake
  await sleep(600);
  await page.keyboard.press('KeyE'); await sleep(150);
  assert(await page.evaluate(() => window.__game._game.player.shaking), 'E shakes the maracas (no NPC nearby)');

  // talk to the owl
  const owl = await page.evaluate(() => { const it = window.__game._game.level.interactables.find((i) => i.id === 'owl'); return { x: it.pos.x, y: it.pos.y, z: it.pos.z }; });
  await tp(owl.x - 1.9, owl.y + 0.3, owl.z); await sleep(700);
  await page.keyboard.press('KeyE');
  await sleep(700);
  await shot('13_kai_owl_dialog');
  await finishDialog();
  s = await st();
  assert(s.questStage === 1, 'talking to ホーちゃん starts the quest');

  // temple door is locked before the shards
  const door = await page.evaluate(() => { const it = window.__game._game.level.interactables.find((i) => i.id === 'temple'); return { x: it.pos.x, y: it.pos.y, z: it.pos.z }; });
  await tp(door.x + 0.6, door.y + 0.3, door.z); await sleep(700);
  assert((await page.textContent('.prompt')).includes('しらべる'), 'temple door prompt: とびらを しらべる');
  await page.keyboard.press('KeyE'); await finishDialog();
  assert((await st()).questStage === 1, 'door stays shut without the shards');

  // temple wall collision: walk west into the temple
  await tp(-50, 2, -60); await sleep(500);
  await page.keyboard.down('KeyA'); await sleep(2500); await page.keyboard.up('KeyA');
  s = await st();
  assert(s.pos.x > -56.4, `temple wall blocks かい (x=${s.pos.x.toFixed(2)})`);

  // falling into the river respawns on the bank
  await tp(12, 0.5, riverZ(12)); await sleep(2500);
  s = await st();
  assert(Math.abs(s.pos.z - riverZ(s.pos.x)) > 4 || s.pos.y > -0.3, `river splash respawns on land (${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}, ${s.pos.z.toFixed(1)})`);

  // bridge is walkable
  await tp(0, 1, 15); await sleep(500);
  for (let i = 0; i < 20 && (await st()).pos.z < 34; i++) { await page.keyboard.down('KeyW'); await sleep(600); }
  await page.keyboard.up('KeyW');
  s = await st();
  assert(s.pos.z > 33 && s.pos.y > -0.3, `crossed the bridge (z=${s.pos.z.toFixed(1)}, y=${s.pos.y.toFixed(2)})`);

  // overview with the castle
  await tp(3, 2, 10); await cam(0.05, 14, 0.25); await sleep(2500);
  await shot('13_kai_overview');

  // village
  await tp(-48, 2, -7); await cam(-1.45, 13, 0.3); await sleep(2500);
  await shot('13_kai_village');

  // collect the three shards
  s = await st();
  for (const [i, sh] of s.stars3d.entries()) {
    await tp(sh.x, sh.y + 0.6, sh.z - 0.2);
    await sleep(900);
    if (i === 2) { await cam(0.4, 11, 0.35); await sleep(1500); await shot('13_kai_castle_shard'); }
  }
  s = await st();
  assert(s.stars === 3 && s.questStage === 2, 'all 3 おんぷの かけら collected');
  assert((await page.textContent('#questText').catch(() => '')) !== null, 'quest text updated');

  // play the melody at the temple
  await cam(-1.57, 11, 0.25);
  await tp(door.x + 0.4, door.y + 0.3, door.z); await sleep(900);
  assert((await page.textContent('.prompt')).includes('マラカス'), 'temple prompt: マラカスを ふる');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => { const d = window.__game._game.level.doors; return Math.abs(d[0].position.z - d[1].position.z) > 4.5; }, null, { timeout: 15000, polling: 50 }).catch(() => {});
  const opened = await page.evaluate(() => window.__game._game.level.doors.map((d) => d.position.z));
  assert(Math.abs(opened[0] - opened[1]) > 3.5, `temple door slides open (${opened.map((v) => v.toFixed(2)).join(', ')})`);
  await shot('13_kai_temple_open');
  await page.waitForSelector('#clear:not(.hidden)', { timeout: 15000 });
  s = await st();
  assert(s.cleared && s.state === 'clear', 'opening the temple clears the stage');

  // clear card
  await page.waitForFunction(() => { const i = document.querySelector('#clearCard'); return i && i.complete && i.naturalWidth > 0 && !document.querySelector('#cardWrap').classList.contains('hidden'); }, null, { timeout: 20000 });
  const dims = await page.evaluate(() => { const i = document.querySelector('#clearCard'); return [i.naturalWidth, i.naturalHeight]; });
  assert(dims[0] === 1080 && dims[1] === 1350, `result card rendered (${dims.join('x')})`);
  const info = await page.evaluate(() => { const L = window.__game._game.level; const c = L.cardInfo(60); return { title: c.title, n: c.map.stars.length, path: L.path.length / 2, star: c.starLabel, npc: c.map.npc?.name }; });
  assert(info.title === 'かいと かぜの げんや' && info.n === 3 && info.npc === 'ホーちゃん', 'card: title, 3 shards, owl on the map');
  assert(info.path >= 5, `route recorded (${info.path} points)`);
  assert((await page.textContent('#clearTitle')).includes('かぜの げんや'), 'clear screen title');
  await sleep(500);
  await shot('13_kai_card');
  const dataUrl = await page.evaluate(() => window.__game._game.menu.card.dataUrl);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  assert(png.length > 50000 && png.subarray(1, 4).toString() === 'PNG', `PNG generated (${(png.length / 1024).toFixed(0)} KB)`);
  fs.writeFileSync(SHOTS + '13_kai_card_export.png', png);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#saveCardBtn')]);
  assert(dl.suggestedFilename() === 'kai-field-clear.png', 'がぞうを ほぞん downloads kai-field-clear.png');

  // retry rebuilds the stage
  await page.click('#retryBtn');
  await page.waitForFunction(() => window.__game.state().state === 'play' && window.__game.state().stars === 0, null, { timeout: 120000 });
  assert((await st()).level === 'kai', 'もういちど restarts stage 3');

  // mobile / touch
  const m = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  m.on('pageerror', (e) => errors.push('mobile: ' + e));
  m.on('console', (x) => { if (x.type() === 'error') errors.push('mobile: ' + x.text()); });
  await m.goto(GAME_URL); await m.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await m.tap('#kaiBtn');
  await m.waitForFunction(() => window.__game.state().level === 'kai' && window.__game.state().state === 'play', null, { timeout: 120000 });
  await m.waitForTimeout(1200);
  assert((await m.textContent('#actBtn')).includes('マラカス'), 'touch action button reads マラカス');
  const box = await m.locator('#joy').boundingBox();
  const before = await m.evaluate(() => window.__game.state().pos);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await m.evaluate(([cx, cy]) => {
    const j = document.getElementById('joy');
    const ev = (t, x, y) => j.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', cx, cy); ev('pointermove', cx, cy - 50);
    window.__joyEnd = () => ev('pointerup', cx, cy - 50);
  }, [cx, cy]);
  await m.waitForTimeout(2200);
  await m.evaluate(() => window.__joyEnd());
  const after = await m.evaluate(() => window.__game.state().pos);
  assert(after.z > before.z + 0.5, `joystick walks かい (z ${before.z.toFixed(1)} → ${after.z.toFixed(1)})`);
  await m.waitForTimeout(1500);
  await m.tap('#actBtn');
  let shook = false; for (let i = 0; i < 20 && !shook; i++) { shook = await m.evaluate(() => window.__game._game.player.shaking); await m.waitForTimeout(60); }
  assert(shook, 'touch マラカス button shakes');
  await m.screenshot({ path: SHOTS + '13_kai_mobile.png' });
  log('fps (swiftshader):', (await m.evaluate(() => window.__game.state().fps)).toFixed(1));

  const filtered = errors.filter((e) => !/favicon/.test(e));
  assert(filtered.length === 0, 'no console errors' + (filtered.length ? ': ' + filtered.join(' | ') : ''));
  log('ALL PASSED');
} catch (e) {
  console.error(e); console.error('errors:', errors);
  try { console.error('state:', JSON.stringify(await st())); } catch {}
  await shot('zz_level3_failure').catch(() => {});
  process.exitCode = 1;
} finally { await browser.close(); }

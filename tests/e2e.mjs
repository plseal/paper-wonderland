// End-to-end playthrough: drives the game ONLY with keyboard input (no teleports)
// and checks every acceptance item. Usage: node tests/e2e.mjs [url]
import { chromium } from 'playwright';
import fs from 'node:fs';

const GAME_URL = process.argv[2] || 'http://localhost:4173/paper-wonderland/';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);
const errors = [];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/home/box/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const st = () => page.evaluate(() => window.__game.state());
const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
const sleep = (ms) => page.waitForTimeout(ms);
const assert = (c, msg) => { if (!c) { throw new Error('ASSERT: ' + msg); } log('✓', msg); };

const held = new Set();
async function setKeys(want) {
  for (const k of [...held]) if (!want.includes(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
/** Walk to (x,z) using WASD only. Simple stuck recovery by side-stepping. */
async function goTo(x, z, { tol = 0.45, timeout = 25000, jumpAt = null, autoDialog = true } = {}) {
  const t0 = Date.now(); let last = null, lastT = Date.now(), side = 0;
  while (Date.now() - t0 < timeout) {
    const s = await st();
    if (s.dialogOpen || s.cutscene) { await setKeys([]); if (!autoDialog) return s; if (s.dialogOpen) await page.keyboard.press('KeyE'); await sleep(120); continue; }
    const dx = x - s.pos.x, dz = z - s.pos.z, d = Math.hypot(dx, dz);
    if (d < tol) { await setKeys([]); return s; }
    const keys = [];
    if (side) { keys.push(side > 0 ? 'KeyD' : 'KeyA'); side -= Math.sign(side); if (dz > 0.2) keys.push('KeyW'); }
    else {
      if (dz > 0.2) keys.push('KeyW'); if (dz < -0.2) keys.push('KeyS');
      if (dx > 0.2) keys.push('KeyD'); if (dx < -0.2) keys.push('KeyA');
    }
    await setKeys(keys);
    if (jumpAt && d < jumpAt && s.grounded) await page.keyboard.press('Space');
    if (last && Date.now() - lastT > 700) {
      if (Math.hypot(s.pos.x - last.x, s.pos.z - last.z) < 0.25) { side = (Math.random() < 0.5 ? -1 : 1) * 8; }
      last = s.pos; lastT = Date.now();
    }
    if (!last) last = s.pos;
    await sleep(40);
  }
  await setKeys([]);
  return await st();
}
async function finishDialog() {
  for (let i = 0; i < 40; i++) { const s = await st(); if (!s.dialogOpen) return; await page.keyboard.press('KeyE'); await sleep(150); }
}
/** Hold keys until the bunny stops moving (blocked) — robust to slow software-GL frame rates. */
async function holdUntilStill(keys, maxMs = 15000) {
  await setKeys(keys);
  const t0 = Date.now(); let ref = (await st()).pos, refT = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(150);
    const q = (await st()).pos;
    if (process.env.DEBUG) log('hold', keys.join('+'), q.x.toFixed(2), q.z.toFixed(2));
    if (Math.hypot(q.x - ref.x, q.z - ref.z) > 0.05) { ref = q; refT = Date.now(); }
    else if (Date.now() - refT > 1500) break;
  }
  await setKeys([]);
  return await st();
}
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await st(); if (fn(s)) return s; await sleep(100); } return await st(); }

try {
  const t0 = Date.now();
  await page.goto(GAME_URL, { waitUntil: 'load' });
  await page.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  log('loaded to title in', Date.now() - t0, 'ms');
  await sleep(600);
  await shot('01_title');
  assert((await st()).state === 'title', 'start screen shown');

  await page.click('#startBtn');
  await sleep(1200);
  let s = await st();
  assert(s.state === 'play', 'start → level (play state)');
  await shot('02_gameplay_start');

  // movement + camera follow
  const p0 = s.pos;
  await setKeys(['KeyW']); await sleep(900); await setKeys([]);
  s = await st();
  assert(s.pos.z > p0.z + 0.8, `W moves forward (z ${p0.z.toFixed(2)} → ${s.pos.z.toFixed(2)})`);
  await setKeys(['ArrowLeft']); await sleep(1200); await setKeys([]);
  const s2 = await st();
  assert(s2.pos.x < s.pos.x - 0.3, 'Arrow keys move too');
  await page.keyboard.press('Space');
  s = await waitFor((x) => x.pos.y > 0.2, 5000);
  assert(!s.grounded && s.pos.y > 0.2, `Space jumps (y=${s.pos.y.toFixed(2)})`);
  s = await waitFor((x) => x.grounded, 5000);
  assert(s.grounded && Math.abs(s.pos.y) < 0.01, 'lands back on the ground (ground collision)');

  // obstacle collision: walk into the house
  await goTo(-5.5, -3);
  s = await holdUntilStill(['KeyA']);
  assert(s.pos.x > -7.2, `house blocks the player (x=${s.pos.x.toFixed(2)})`);

  // star 1 & 3 (behind the house)
  await goTo(-5, -6);
  await goTo(-5.2, 1.8); await goTo(-9.5, 1.6);
  s = await st(); log('stars after meadow/house:', s.stars);
  // star 2 on the big stone: needs a jump
  await goTo(6.5, -4.4);
  s = await st();
  assert(s.groundId === 'ground-near', 'big stone blocks walking (must jump)');
  await goTo(6.5, -2, { jumpAt: 2.3, tol: 0.6 });
  s = await waitFor((x) => x.stars >= 3, 6000);
  log('on stone?', s.groundId, s.pos.y.toFixed(2), 'stars', s.stars);
  assert(s.stars === 3, `3 stars collected on the near side (got ${s.stars})`);
  await page.keyboard.press('KeyS'); await sleep(50);
  await goTo(6.5, -4.5);

  // NPC quest
  await goTo(2.3, 5.5);
  await page.keyboard.press('KeyE');
  s = await waitFor((x) => x.dialogOpen, 8000);
  await sleep(1500);
  assert(s.dialogOpen, 'pressing E near the fox opens Japanese dialogue');
  await shot('03_npc_dialog');
  await finishDialog();
  s = await st();
  assert(s.questStage === 1, 'quest accepted (stage 1)');

  // Bridge is a wall before folding: try to cross
  await goTo(0, 8.2);
  await shot('04_fold_before');
  s = await holdUntilStill(['KeyW']);
  assert(s.pos.z < 9.4 && !s.bridgeDown, `cannot cross before folding (z=${s.pos.z.toFixed(2)})`);

  // Falling in the river respawns you on the bank
  await goTo(5.5, 8.4);
  await setKeys(['KeyW']);
  s = await waitFor((x) => x.pos.y < -0.3, 10000);
  await setKeys([]);
  assert(s.pos.y < -0.3, 'walking off the bank drops into the paper river');
  s = await waitFor((x) => x.grounded && x.pos.y === 0, 10000);
  assert(s.pos.z < 9.5 && s.groundId === 'ground-near', `respawned on the near bank (z=${s.pos.z.toFixed(2)})`);

  // Pull lever
  await goTo(-3.0, 7.2);
  await page.keyboard.press('KeyE');
  await waitFor((x) => x.cutscene, 8000);
  await sleep(1800);
  await shot('05_fold_animating');
  s = await waitFor((x) => x.bridgeDown && !x.cutscene, 15000);
  assert(s.bridgeDown, 'lever folds the bridge down (90° fold)');
  await sleep(300);
  await shot('06_fold_after');

  // Cross the bridge
  await goTo(0, 9.0);
  let sawBridge = false;
  for (let i = 0; i < 400; i++) {
    await setKeys(['KeyW']); await sleep(60);
    const q = await st(); if (q.groundId === 'bridge') sawBridge = true;
    if (q.pos.z > 17.5) break;
  }
  await setKeys([]);
  s = await st();
  assert(sawBridge && s.pos.z > 16.5 && s.pos.y > -0.1, `walked across the folded bridge (z=${s.pos.z.toFixed(2)})`);
  await shot('07_across_bridge');

  // Far side stars
  await goTo(-6, 23);
  await goTo(7.5, 25.6);
  await goTo(7.5, 28, { jumpAt: 2.3, tol: 0.6, autoDialog: false });
  s = await waitFor((x) => x.stars === 5, 8000);
  assert(s.stars === 5, 'all 5 paper stars collected');
  await waitFor((x) => x.dialogOpen, 8000);
  await sleep(1200);
  await shot('08a_quest_complete_dialog');
  for (let i = 0; i < 40; i++) { const q = await st(); if (!q.dialogOpen) break; await page.keyboard.press('KeyE'); await sleep(250); }
  await waitFor((x) => x.cutscene, 8000);
  await sleep(1500);
  await shot('08_gate_unfolding');
  s = await waitFor((x) => x.gateOpen, 20000);
  assert(s.questStage === 2 && s.gateOpen, 'quest complete → scene unfolds, exit gate opens');
  await waitFor((x) => !x.cutscene, 20000);
  await shot('08b_gate_open');

  await goTo(0, 32.6);
  await setKeys(['KeyW']);
  s = await waitFor((x) => x.cleared, 15000);
  await setKeys([]);
  assert(s.cleared, 'walking into the gate clears the level');
  await page.waitForSelector('#clear:not(.hidden)', { timeout: 5000 });
  await sleep(700);
  await shot('09_clear');

  await page.click('#retryBtn');
  s = await waitFor((x) => x.state === 'play' && x.stars === 0, 20000);
  assert(s.state === 'play' && s.stars === 0 && !s.bridgeDown, 'もういちど restarts the level');
  log('fps (swiftshader):', s.fps.toFixed(1));

  // mobile / touch layout
  const m = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  m.on('pageerror', (e) => errors.push('mobile: ' + e));
  m.on('console', (x) => { if (x.type() === 'error') errors.push('mobile: ' + x.text()); });
  await m.goto(GAME_URL); await m.waitForSelector('#title:not(.hidden)', { timeout: 60000 });
  await m.tap('#startBtn'); await m.waitForTimeout(1200);
  const box = await m.locator('#joy').boundingBox();
  assert(box && box.width > 50, 'touch joystick visible on mobile');
  const before = await m.evaluate(() => window.__game.state().pos);
  // drag joystick up via pointer events
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await m.evaluate(([cx, cy]) => {
    const j = document.getElementById('joy');
    const ev = (t, x, y) => j.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', cx, cy); ev('pointermove', cx, cy - 50);
    window.__joyEnd = () => ev('pointerup', cx, cy - 50);
  }, [cx, cy]);
  await m.waitForTimeout(2500);
  await m.screenshot({ path: SHOTS + '10_mobile_touch.png' });
  await m.evaluate(() => window.__joyEnd());
  const after = await m.evaluate(() => window.__game.state().pos);
  assert(after.z > before.z + 0.5, `joystick moves the bunny (z ${before.z.toFixed(2)} → ${after.z.toFixed(2)})`);
  const y0 = await m.evaluate(() => window.__game.state().pos.y);
  await m.tap('#jumpBtn');
  let maxY = y0; for (let i = 0; i < 30; i++) { maxY = Math.max(maxY, await m.evaluate(() => window.__game.state().pos.y)); await m.waitForTimeout(50); }
  assert(maxY > y0 + 0.2, 'touch jump button works');

  const filtered = errors.filter((e) => !/favicon/.test(e));
  assert(filtered.length === 0, 'no console errors' + (filtered.length ? ': ' + filtered.join(' | ') : ''));
  log('ALL PASSED');
} catch (e) {
  console.error(e);
  console.error('console errors:', errors);
  try { console.error('state:', JSON.stringify(await st())); } catch {}
  await shot('zz_failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

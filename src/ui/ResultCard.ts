import soraUrl from '../assets/sora.webp';
import { paintPaper } from '../world/PaperTexture';

/** Everything the Koiwa clear card needs (map data in metres, x = east, z = north). */
export interface CardMap {
  radius: number;
  buildings: number[][];            // flat [x0,z0,x1,z1,...] polygons
  station: number[];
  roads: { v: number[]; i: number[] }; // triangles (metres)
  viaduct: { v: number[]; i: number[] };
  stars: { x: number; z: number }[];
  fox: { x: number; z: number };
  path: number[];                   // [x0,z0,x1,z1,...]
  water?: { v: number[]; i: number[] };
  labels?: { x: number; z: number; text: string }[];
  center?: { x: number; z: number };
  ground?: string;
  palette?: string[];
  /** NPC marker on the map (default: fox コン) */
  npc?: { name: string; kind: 'fox' | 'owl' };
}
export interface CardInfo {
  title: string; subtitle: string; secs: number; stars: number; total: number; url: string; credits: string; date: Date; map: CardMap;
  portrait?: string; mapCaption?: string; starLabel?: string; shareText?: string; fileName?: string;
}

export const CARD_W = 1080, CARD_H = 1350;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
const FONT = '"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", "Kosugi Maru", "Yu Gothic UI", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/** paper card: stacked offset sheets + drop shadow */
function paperPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, rot = 0) {
  c.save();
  c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2);
  c.fillStyle = 'rgba(74,63,107,0.18)'; roundRect(c, 8, 14, w, h, 26); c.fill();
  c.fillStyle = '#d3c9ee'; roundRect(c, 0, 8, w, h, 26); c.fill();
  c.fillStyle = fill; roundRect(c, 0, 0, w, h, 26); c.fill();
  c.strokeStyle = '#ffffff'; c.lineWidth = 4; roundRect(c, 2, 2, w - 4, h - 4, 24); c.stroke();
  c.restore();
}
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fillStyle = fill; c.fill();
  c.strokeStyle = 'rgba(160,110,20,0.5)'; c.lineWidth = Math.max(1.5, r * 0.08); c.stroke();
}

function drawMap(c: CanvasRenderingContext2D, m: CardMap, x: number, y: number, size: number) {
  c.save();
  roundRect(c, x, y, size, size, 22); c.clip();
  c.fillStyle = m.ground ?? '#f6efdf'; c.fillRect(x, y, size, size);
  const R = m.radius + 6, k = size / (2 * R), cx = x + size / 2, cy = y + size / 2;
  const ox = m.center?.x ?? 0, oz = m.center?.z ?? 0;
  const P = (px: number, pz: number): [number, number] => [cx + (px - ox) * k, cy - (pz - oz) * k];
  const tris = (t: { v: number[]; i: number[] }, col: string) => {
    c.fillStyle = col; c.beginPath();
    for (let n = 0; n < t.i.length; n += 3) {
      const [a, b, d] = [t.i[n], t.i[n + 1], t.i[n + 2]];
      c.moveTo(...P(t.v[a * 2], t.v[a * 2 + 1])); c.lineTo(...P(t.v[b * 2], t.v[b * 2 + 1])); c.lineTo(...P(t.v[d * 2], t.v[d * 2 + 1]));
    }
    c.fill();
  };
  if (m.water) tris(m.water, '#a9c6f2');
  tris(m.roads, m.ground ? '#f3e3bf' : '#d6d6ea');
  const poly = (pts: number[], fill: string, stroke = 'rgba(90,70,140,0.35)') => {
    c.beginPath(); for (let n = 0; n < pts.length; n += 2) c.lineTo(...P(pts[n], pts[n + 1])); c.closePath();
    c.fillStyle = 'rgba(74,63,107,0.12)'; c.save(); c.translate(3, 4); c.fill(); c.restore();
    c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 2; c.stroke();
  };
  const pal = m.palette ?? ['#fbe3d3', '#fde9c9', '#f6d6e2', '#dcefe0', '#e3defa', '#d8e8f8'];
  m.buildings.forEach((b, i) => poly(b, pal[i % pal.length]));
  if (m.station.length) poly(m.station, '#fff4dc');
  tris(m.viaduct, 'rgba(185,176,236,0.75)');
  // place labels
  c.font = `bold ${Math.round(size * 0.036)}px ${FONT}`; c.textAlign = 'center';
  for (const l of m.labels ?? []) {
    const sp = P(l.x, l.z);
    c.lineWidth = 6; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.strokeText(l.text, sp[0], sp[1]);
    c.fillStyle = '#5b4c94'; c.fillText(l.text, sp[0], sp[1]);
  }
  // route (dashed paper ribbon)
  if (m.path.length >= 4) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); for (let n = 0; n < m.path.length; n += 2) c.lineTo(...P(m.path[n], m.path[n + 1]));
    c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 11; c.stroke();
    c.setLineDash([16, 10]); c.strokeStyle = '#e2809f'; c.lineWidth = 6; c.stroke(); c.setLineDash([]);
    const s0 = P(m.path[0], m.path[1]);
    c.fillStyle = '#7a69d4'; c.beginPath(); c.arc(s0[0], s0[1], 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = `bold 13px ${FONT}`; c.fillText('S', s0[0], s0[1] + 5);
  }
  for (const s of m.stars) { const q = P(s.x, s.z); star(c, q[0], q[1], 20, '#ffd86b'); }
  const f = P(m.fox.x, m.fox.z);
  const npc = m.npc ?? { name: 'コン', kind: 'fox' as const };
  c.strokeStyle = '#fff'; c.lineWidth = 3;
  if (npc.kind === 'owl') {
    // little paper owl: round body, ear tufts, two big eyes
    c.fillStyle = '#a77a55';
    c.beginPath(); c.moveTo(f[0] - 14, f[1] - 10); c.lineTo(f[0] - 12, f[1] - 24); c.lineTo(f[0] - 4, f[1] - 14);
    c.lineTo(f[0] + 4, f[1] - 14); c.lineTo(f[0] + 12, f[1] - 24); c.lineTo(f[0] + 14, f[1] - 10); c.closePath(); c.fill();
    c.beginPath(); c.arc(f[0], f[1], 16, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#fff'; for (const d of [-6, 6]) { c.beginPath(); c.arc(f[0] + d, f[1] - 3, 5.5, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#3a2f4a'; for (const d of [-6, 6]) { c.beginPath(); c.arc(f[0] + d, f[1] - 3, 2.6, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#f0a33c'; c.beginPath(); c.moveTo(f[0] - 3, f[1] + 3); c.lineTo(f[0] + 3, f[1] + 3); c.lineTo(f[0], f[1] + 8); c.closePath(); c.fill();
  } else {
    // little paper fox head (no emoji fonts needed)
    c.fillStyle = '#f5ae6e';
    c.beginPath(); c.moveTo(f[0] - 16, f[1] - 12); c.lineTo(f[0] - 8, f[1] - 26); c.lineTo(f[0] - 2, f[1] - 12);
    c.lineTo(f[0] + 2, f[1] - 12); c.lineTo(f[0] + 8, f[1] - 26); c.lineTo(f[0] + 16, f[1] - 12); c.lineTo(f[0], f[1] + 12); c.closePath(); c.fill(); c.stroke();
  }
  c.fillStyle = '#5b4c94'; c.font = `bold 18px ${FONT}`; c.fillText(npc.name, f[0], f[1] + 34);
  // compass
  c.fillStyle = '#8f86c1'; c.font = `bold 22px ${FONT}`; c.fillText('N ▲', x + size - 50, y + 40);
  c.restore();
  c.strokeStyle = '#ffffff'; c.lineWidth = 6; roundRect(c, x, y, size, size, 22); c.stroke();
}

/** Render the shareable paper-craft result card. */
export async function renderResultCard(info: CardInfo): Promise<HTMLCanvasElement> {
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const c = cv.getContext('2d')!;
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
  paintPaper(c, CARD_W, CARD_H, '#e7e0fa', { seed: 7, creases: 4, blotches: 20, tints: ['rgba(255,255,255,0.45)', 'rgba(159,196,239,0.3)', 'rgba(244,184,207,0.3)'] });
  // confetti
  let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    c.save(); c.translate(r() * CARD_W, r() * CARD_H); c.rotate(r() * 6);
    c.fillStyle = ['#f4b8cf', '#9fc4ef', '#ffd86b', '#b9b0ec', '#bfe6c8'][i % 5]; c.globalAlpha = 0.55;
    c.fillRect(-9, -5, 18, 10); c.restore();
  }
  c.globalAlpha = 1;
  paperPanel(c, 60, 56, CARD_W - 120, CARD_H - 120, '#fbf8f2', -0.008);

  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#e8a93a'; c.font = `bold 34px ${FONT}`; c.fillText('★ ステージ クリア！ ★', CARD_W / 2, 140);
  c.fillStyle = '#d8d0f4'; c.font = `bold 70px ${FONT}`; c.fillText(info.title, CARD_W / 2 + 4, 230 + 4);
  c.fillStyle = '#5b4c94'; c.fillText(info.title, CARD_W / 2, 230);
  c.fillStyle = '#8f86c1'; c.font = `24px ${FONT}`; c.fillText(info.subtitle, CARD_W / 2, 276);

  // map (left) + bunny & stats (right)
  const mapX = 110, mapY = 320, mapS = 560;
  drawMap(c, info.map, mapX, mapY, mapS);
  c.fillStyle = '#8f86c1'; c.font = `22px ${FONT}`; c.textAlign = 'left';
  c.fillText(info.mapCaption ?? 'そらちゃんの あるいた みち（きたぐち ひろば）', mapX + 4, mapY + mapS + 40);

  const rx = 700, rw = 280;
  try {
    const img = await loadImage(info.portrait ?? soraUrl);
    const h = 260, w = (img.width / img.height) * h;
    c.save(); c.translate(rx + rw / 2, mapY + 150); c.rotate(-0.06);
    c.shadowColor = 'rgba(74,63,107,0.25)'; c.shadowOffsetX = 6; c.shadowOffsetY = 10; c.shadowBlur = 0;
    c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
  } catch { /* image optional */ }
  const stat = (y: number, label: string, value: string, col: string) => {
    paperPanel(c, rx, y, rw, 120, '#ffffff', 0.01);
    c.textAlign = 'center'; c.fillStyle = '#8f86c1'; c.font = `22px ${FONT}`; c.fillText(label, rx + rw / 2, y + 40);
    c.fillStyle = col; c.font = `bold 52px ${FONT}`; c.fillText(value, rx + rw / 2, y + 98);
  };
  stat(mapY + 300, 'クリア タイム', fmtTime(info.secs), '#5b4c94');
  stat(mapY + 440, info.starLabel ?? 'あつめた ほし', `${info.starLabel ? '♪' : '★'} ${info.stars} / ${info.total}`, '#e8a93a');

  // footer
  const fy = mapY + mapS + 100;
  c.strokeStyle = 'rgba(143,134,193,0.4)'; c.setLineDash([10, 8]); c.lineWidth = 3;
  c.beginPath(); c.moveTo(110, fy); c.lineTo(CARD_W - 110, fy); c.stroke(); c.setLineDash([]);
  const d = info.date;
  c.textAlign = 'left'; c.fillStyle = '#5b4c94'; c.font = `bold 30px ${FONT}`;
  c.fillText(`${d.getFullYear()}ねん ${d.getMonth() + 1}がつ ${d.getDate()}にち`, 110, fy + 56);
  c.textAlign = 'right'; c.fillStyle = '#8f86c1'; c.font = `24px ${FONT}`;
  c.fillText('PAPER WONDERLAND', CARD_W - 110, fy + 56);
  // URL as a paper ticket
  paperPanel(c, 110, fy + 90, CARD_W - 220, 96, '#efeafc', -0.004);
  c.textAlign = 'center'; c.fillStyle = '#7a69d4'; c.font = `bold 34px ${FONT}`;
  c.fillText('あそんでね → ' + info.url.replace(/^https?:\/\//, ''), CARD_W / 2, fy + 150);
  c.textAlign = 'left'; c.fillStyle = '#a69fcb'; c.font = `15px ${FONT}`;
  c.fillText(info.credits, 110, CARD_H - 92);
  return cv;
}

export function canvasToBlob(cv: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

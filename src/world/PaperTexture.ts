import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

/** Small deterministic PRNG so the forest looks the same every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PaperOpts {
  size?: number;
  /** number of random fold creases */
  creases?: number;
  /** regular grid creases (e.g. bridge planks) */
  grid?: [number, number];
  /** watercolor blotch tint colours */
  tints?: string[];
  blotches?: number;
  seed?: number;
  grain?: number;
}

/** Draws watercolor paper (grain, fibres, blotches, fold creases) on a 2D canvas context. */
export function paintPaper(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, o: PaperOpts = {}) {
  const r = rng(o.seed ?? 7);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // watercolor blotches
  const tints = o.tints ?? ['rgba(255,255,255,0.35)', 'rgba(170,150,230,0.18)', 'rgba(140,190,240,0.18)'];
  const n = o.blotches ?? 14;
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = (0.15 + r() * 0.35) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = tints[i % tints.length];
    g.addColorStop(0, c);
    g.addColorStop(0.6, c.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.5})`));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    // draw tiled (wrap) so textures repeat seamlessly-ish
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2); ctx.fill();
    }
  }
  // fibres
  ctx.lineWidth = 1;
  for (let i = 0; i < w * 0.6; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 3 + r() * 9;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(90,70,140,0.07)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  // grain
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data, gs = o.grain ?? 14;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * gs;
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
  // creases: a light ridge next to a dark valley
  const crease = (x1: number, y1: number, x2: number, y2: number) => {
    const nx = -(y2 - y1), ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
    const ox = (nx / len) * 1.5, oy = (ny / len) * 1.5;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(70,50,120,0.16)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.moveTo(x1 + ox, y1 + oy); ctx.lineTo(x2 + ox, y2 + oy); ctx.stroke();
  };
  for (let i = 0; i < (o.creases ?? 0); i++) {
    if (r() < 0.5) crease(r() * w, 0, r() * w, h); else crease(0, r() * h, w, r() * h);
  }
  if (o.grid) {
    const [gx, gy] = o.grid;
    for (let i = 1; i < gx; i++) crease((i * w) / gx, 0, (i * w) / gx, h);
    for (let j = 1; j < gy; j++) crease(0, (j * h) / gy, w, (j * h) / gy);
  }
}

export function paperTexture(scene: Scene, name: string, base: string, o: PaperOpts = {}) {
  const size = o.size ?? 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  paintPaper(ctx, size, size, base, o);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  return tex;
}

const cache = new Map<string, StandardMaterial>();

/** Matte paper material with a procedurally painted texture. Cached per scene+key. */
export function paperMat(scene: Scene, key: string, base: string, o: PaperOpts & { tile?: number; emissive?: number } = {}) {
  const k = scene.uid + key;
  const hit = cache.get(k);
  if (hit && !hit.getScene().isDisposed) return hit;
  const m = new StandardMaterial('paper-' + key, scene);
  const t = paperTexture(scene, 'tex-' + key, base, o);
  if (o.tile) { t.uScale = o.tile; t.vScale = o.tile; }
  m.diffuseTexture = t;
  m.specularColor = new Color3(0.04, 0.04, 0.05);
  m.emissiveColor = new Color3(1, 1, 1).scale(o.emissive ?? 0.12);
  cache.set(k, m);
  return m;
}

/** Texture from a silhouette drawn by `draw` (black = opaque), filled with paper. Alpha-tested cut-out paper. */
export function cutoutMat(scene: Scene, key: string, base: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D) => void, o: PaperOpts = {}) {
  const ck = scene.uid + 'cut' + key;
  const hit = cache.get(ck);
  if (hit && !hit.getScene().isDisposed) return hit;
  const tex = new DynamicTexture('cut-' + key, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  paintPaper(ctx, w, h, base, o);
  // draw the silhouette on its own canvas, then keep paper only inside it
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mctx = mask.getContext('2d')!;
  mctx.fillStyle = '#000';
  draw(mctx);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  tex.update();
  tex.hasAlpha = true;
  const m = new StandardMaterial('cutmat-' + key, scene);
  m.diffuseTexture = tex;
  m.useAlphaFromDiffuseTexture = true;
  m.transparencyMode = 1; // ALPHATEST
  m.alphaCutOff = 0.5;
  m.backFaceCulling = false;
  m.specularColor = new Color3(0.03, 0.03, 0.04);
  m.twoSidedLighting = true;
  m.emissiveColor = new Color3(0.3, 0.3, 0.32);
  cache.set(ck, m);
  return m;
}

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import { cutoutMat, paperMat, rng } from './PaperTexture';

/** Flat-shaded "folded paper" helper. */
export function flat<T extends Mesh>(m: T, mat?: Material): T {
  m.convertToFlatShadedMesh();
  if (mat) m.material = mat;
  return m;
}

export const easeOutBack = (t: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * A paper panel that folds around a crease (pivot). Children of `pivot` rotate with it.
 * `state` goes 0 → 1; angle = lerp(from, to, ease(state)).
 */
export class FoldPanel {
  pivot: TransformNode;
  t = 0;
  folding = false;
  done = false;
  onDone?: () => void;
  constructor(scene: Scene, name: string, public axis: 'x' | 'y' | 'z', public from: number, public to: number, public duration = 1.2) {
    this.pivot = new TransformNode(name, scene);
    this.pivot.rotation[axis] = from;
  }
  fold() { if (!this.folding && !this.done) this.folding = true; }
  update(dt: number) {
    if (!this.folding) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = easeOutBack(this.t);
    this.pivot.rotation[this.axis] = this.from + (this.to - this.from) * e;
    if (this.t >= 1) {
      this.folding = false; this.done = true;
      this.pivot.rotation[this.axis] = this.to;
      this.onDone?.();
    }
  }
  /** jump straight to folded (used by tests / resets) */
  snap(done: boolean) { this.t = done ? 1 : 0; this.done = done; this.folding = false; this.pivot.rotation[this.axis] = done ? this.to : this.from; }
}

/** Puffy origami star (10 rim verts + front/back apex). */
export function createStar(scene: Scene, name: string, mat: Material, r = 0.5, depth = 0.18) {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 === 0 ? r : r * 0.45;
    pos.push(Math.cos(a) * rr, Math.sin(a) * rr, 0);
  }
  pos.push(0, 0, -depth, 0, 0, depth); // 10 front, 11 back
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    idx.push(10, j, i, 11, i, j);
  }
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  return flat(m, mat);
}

/** Low-poly origami tree: stacked flat-shaded pyramids. */
export function createConeTree(scene: Scene, name: string, h: number, seed: number) {
  const r = rng(seed);
  const root = new TransformNode(name, scene);
  const greens = ['#9fd8b8', '#8ccfc0', '#b2d99c', '#9cc8e6', '#b8b0ec'];
  const g = greens[Math.floor(r() * greens.length)];
  const mat = paperMat(scene, 'tree' + g, g, { creases: 3, seed: seed % 5 });
  const trunk = flat(CreateCylinder(name + 't', { height: h * 0.3, diameter: 0.28, tessellation: 5 }, scene), paperMat(scene, 'trunk', '#c9a98e', { creases: 2 }));
  trunk.position.y = h * 0.15; trunk.parent = root;
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const s = 1 - i * 0.24;
    const c = flat(CreateCylinder(name + 'c' + i, { height: h * 0.42 * s, diameterTop: 0, diameterBottom: h * 0.62 * s, tessellation: 5 + (i % 2) }, scene), mat);
    c.position.y = h * (0.32 + i * 0.22);
    c.rotation.y = r() * Math.PI;
    c.parent = root;
  }
  return root;
}

/** Pop-up card tree: two crossed cut-out paper planes. */
export function createCardTree(scene: Scene, name: string, h: number, seed: number) {
  const r = rng(seed);
  const cols = ['#a7dcc0', '#c4b8f0', '#a9ccef', '#f2bfd3'];
  const col = cols[Math.floor(r() * cols.length)];
  const key = 'cardtree' + col;
  const mat = cutoutMat(scene, key, col, 128, 192, (ctx) => {
    // trunk
    ctx.fillRect(56, 140, 16, 52);
    // lollipop / cloud crown made of circles
    const blobs = [[64, 70, 46], [36, 92, 30], [92, 92, 30], [64, 40, 32], [64, 112, 30]];
    for (const [x, y, rr] of blobs) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
  }, { seed: 3, creases: 1, tints: ['rgba(255,255,255,0.4)', 'rgba(120,100,200,0.12)'] });
  const root = new TransformNode(name, scene);
  for (let i = 0; i < 2; i++) {
    const p = CreatePlane(name + 'p' + i, { width: h * 0.66, height: h }, scene);
    p.material = mat; p.position.y = h / 2; p.rotation.y = i * Math.PI / 2 + r(); p.parent = root;
  }
  return root;
}

export function createStone(scene: Scene, name: string, size: number, seed: number) {
  const s = flat(CreateIcoSphere(name, { radius: size, subdivisions: 1 }, scene), paperMat(scene, 'stone', '#cfcbe0', { creases: 4, seed: 11 }));
  const r = rng(seed);
  s.scaling.set(1 + r() * 0.3, 0.7 + r() * 0.2, 1 + r() * 0.3);
  s.rotation.y = r() * 6;
  return s;
}

/** Paper house: box walls + triangular-prism roof + door/window cut-outs. */
export function createHouse(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const wall = CreateBox(name + 'w', { width: 4, height: 2.6, depth: 4 }, scene);
  wall.material = paperMat(scene, 'housewall', '#fbf3e6', { creases: 3, seed: 21, tints: ['rgba(244,184,207,0.18)', 'rgba(255,255,255,0.4)'] });
  wall.position.y = 1.3; wall.parent = root;
  const roof = flat(CreateCylinder(name + 'r', { height: 4.6, diameter: 3.6, tessellation: 3 }, scene), paperMat(scene, 'roof', '#c3a7ec', { grid: [1, 4], seed: 22 }));
  roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 2;
  roof.rotation.set(0, 0, Math.PI / 2);
  roof.position.y = 2.6 + 0.85; roof.parent = root;
  roof.scaling.set(1, 1, 1.35);
  const doorMat = paperMat(scene, 'door', '#9cc0ec', { creases: 1, seed: 23 });
  const door = CreateBox(name + 'd', { width: 0.9, height: 1.5, depth: 0.06 }, scene);
  door.material = doorMat; door.position.set(0, 0.75, -2.02); door.parent = root;
  for (const x of [-1.25, 1.25]) {
    const win = CreateBox(name + 'win' + x, { width: 0.7, height: 0.7, depth: 0.06 }, scene);
    win.material = paperMat(scene, 'window', '#fff4b8', { seed: 24, emissive: 0.35 });
    win.position.set(x, 1.6, -2.02); win.parent = root;
  }
  const chimney = flat(CreateBox(name + 'ch', { width: 0.5, height: 1, depth: 0.5 }, scene), paperMat(scene, 'chimney', '#f4b8cf', { seed: 25 }));
  chimney.position.set(1, 3.6, 0.6); chimney.parent = root;
  return { root, meshes: [wall, roof, door, chimney] };
}

/** Origami fox NPC built from flat-shaded pyramids. */
export function createFox(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const orange = paperMat(scene, 'fox', '#f5ae6e', { creases: 3, seed: 31, tints: ['rgba(255,255,255,0.3)', 'rgba(240,120,90,0.15)'] });
  const white = paperMat(scene, 'foxwhite', '#fff8ef', { seed: 32 });
  const ink = paperMat(scene, 'ink', '#3d3456', { seed: 33, emissive: 0 });
  const body = flat(CreateCylinder(name + 'b', { height: 1.0, diameterTop: 0.35, diameterBottom: 0.95, tessellation: 4 }, scene), orange);
  body.position.y = 0.5; body.rotation.y = Math.PI / 4; body.parent = root;
  const chest = flat(CreateCylinder(name + 'chest', { height: 0.6, diameterTop: 0.0, diameterBottom: 0.5, tessellation: 3 }, scene), white);
  chest.position.set(0, 0.45, -0.3); chest.rotation.x = 0.35; chest.parent = root;
  const headNode = new TransformNode(name + 'hn', scene);
  headNode.parent = root; headNode.position.y = 1.15;
  const head = flat(CreateCylinder(name + 'h', { height: 0.65, diameterTop: 0, diameterBottom: 0.75, tessellation: 3 }, scene), orange);
  head.rotation.x = -Math.PI / 2; head.position.z = -0.2; head.parent = headNode; // snout points -z (toward camera by default)
  for (const s of [-1, 1]) {
    const ear = flat(CreateCylinder(name + 'ear' + s, { height: 0.45, diameterTop: 0, diameterBottom: 0.32, tessellation: 3 }, scene), orange);
    ear.position.set(0.22 * s, 0.3, 0.02); ear.rotation.z = -0.25 * s; ear.parent = headNode;
    const eye = CreateIcoSphere(name + 'eye' + s, { radius: 0.055, subdivisions: 1 }, scene);
    eye.material = ink; eye.position.set(0.14 * s, 0.1, -0.33); eye.parent = headNode;
  }
  const nose = CreateIcoSphere(name + 'nose', { radius: 0.05, subdivisions: 1 }, scene);
  nose.material = ink; nose.position.set(0, -0.05, -0.55); nose.parent = headNode;
  const tail = flat(CreateCylinder(name + 'tail', { height: 0.9, diameterTop: 0, diameterBottom: 0.4, tessellation: 3 }, scene), orange);
  tail.position.set(0, 0.5, 0.55); tail.rotation.x = 1.0; tail.parent = root;
  const tip = flat(CreateCylinder(name + 'tip', { height: 0.3, diameterTop: 0, diameterBottom: 0.2, tessellation: 3 }, scene), white);
  tip.position.set(0, 0.42, 0); tip.parent = tail;
  return { root, headNode, tail, meshes: [body, chest, head, tail, tip] };
}

export function pivotAt(scene: Scene, name: string, p: Vector3) {
  const t = new TransformNode(name, scene);
  t.position.copyFrom(p);
  return t;
}

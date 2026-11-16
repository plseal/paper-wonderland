import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CollisionWorld } from '../core/Collision';
import { PolyCollider } from '../core/PolyCollider';
import type { CameraController } from '../core/Camera';
import type { World } from '../world/World';
import { cutoutMat, paperMat, rng } from '../world/PaperTexture';
import { flat } from '../world/Origami';
import type { Interactable, LevelHost } from './ForestLevel';
import type { Level } from './Level';
import type { CardInfo } from '../ui/ResultCard';
import type { KaiPlayer } from '../player/KaiPlayer';
import kaiUrl from '../assets/kai.webp';

// ------------------------------------------------------------------ field layout (x = east, z = north)
const CASTLE = { x: 0, z: 78 };
const PLATEAU = 7, MOAT_R = 12.5, MOAT_BED = 4.4, MOAT_WATER = 5.5;
const RIVER_WATER = -0.75;
const riverZ = (x: number) => 25 + 6 * Math.sin(x / 25);
const START = { x: 0, z: -60 };
const OWL = { x: 4.5, z: -54 };
const VILLAGE = { x: -64, z: -4 };
const RANCH = { x: 58, z: -4, minX: 45, maxX: 71, minZ: -13, maxZ: 5 };
const TEMPLE = { minX: -70, maxX: -56, minZ: -62, maxZ: -50, doorX: -56, doorZ: -56 };
const BRIDGE = { minX: -2.4, maxX: 2.4, minZ: 16.5, maxZ: 33.5, top: 0.32 };
const DRAW = { minX: -2.1, maxX: 2.1, minZ: 62.6, maxZ: 68.4, top: PLATEAU + 0.12 };
const FLATS = [
  { x: START.x, z: START.z, r: 12 }, { x: VILLAGE.x, z: VILLAGE.z, r: 17 }, { x: RANCH.x, z: RANCH.z, r: 18 },
  { x: -63, z: -56, r: 14 }, { x: 0, z: -18, r: 6 },
];
const PATHS: number[][] = [
  [0, -60, 2, -46, -2, -31, 0, -18, 3, -5, 0, 7, 0, 16.6],
  [0, 33.4, 1.2, 44, 0, 54, 0, 62.7],
  [0, -60, -14, -63, -30, -60, -44, -57, -54, -56],
  [0, -18, -18, -14, -36, -10, -52, -6, -64, -4],
  [3, -5, 16, -8, 32, -6, 46, -4],
];
const SHARDS = [
  { x: VILLAGE.x, z: VILLAGE.z, label: 'かざぐるまの むら' },
  { x: 61, z: 21.5, label: 'ぼくじょうの かわべ' },
  { x: 0, z: 65.4, label: 'おしろの つりばし' },
];

const sstep = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** Height of the paper field at (x,z). */
export function fieldHeight(x: number, z: number) {
  let roll = 0.95 * Math.sin(x / 17 + 0.6) * Math.cos(z / 23 - 0.4) + 0.65 * Math.sin((x - z) / 29) + 0.55 * Math.cos((x + 2 * z) / 41) + 0.5;
  for (const f of FLATS) roll *= sstep(f.r, f.r + 14, Math.hypot(x - f.x, z - f.z));
  const dr = Math.abs(z - riverZ(x));
  roll *= sstep(6, 16, dr);
  let h = roll;
  const dc = Math.hypot(x - CASTLE.x, z - CASTLE.z);
  const hill = dc < 16 ? PLATEAU : PLATEAU * Math.exp(-(((dc - 16) / 10.5) ** 2));
  if (hill > h) h = hill;
  h -= 2.8 * (1 - sstep(2.5, 6, dr));
  if (dc < 16) h -= (PLATEAU - MOAT_BED) * (1 - sstep(1.5, 2.4, Math.abs(dc - MOAT_R)));
  const e = Math.max(Math.abs(x), Math.abs(z - 8));
  h += 18 * Math.pow(sstep(84, 120, e), 1.4);
  return h;
}

function hex(c: string) { return Color3.FromHexString(c); }

/** 「かいと かぜの げんや」: an original paper-craft open field with a castle, village, ranch and an old temple. */
export class KaiLevel implements Level {
  id = 'kai' as const;
  starTotal = 3;
  start = new Vector3(START.x, 0, START.z);
  introToast = 'ふくろうの ホーちゃんに はなしかけて みよう！';
  clearTitle = 'かぜの げんや クリア！';
  clearText = 'マラカスの メロディで しんでんの とびらが ひらいたよ。<br/>ホーちゃんも おおよろこび。ありがとう、かい！';
  idleActLabel = 'マラカス';
  col = new CollisionWorld();
  poly = new PolyCollider(8);
  stars: { mesh: Mesh; base: Vector3; got: boolean; label: string; beacon: Mesh }[] = [];
  interactables: Interactable[] = [];
  questStage = 0; // 0 talk to owl, 1 collect, 2 go to temple, 3 door opening
  cleared = false;
  path: number[] = [];
  private pathT = 0;
  private t = 0;
  private kai?: KaiPlayer;
  private arrow!: TransformNode;
  private owl!: { root: TransformNode; head: TransformNode; wings: TransformNode[] };
  private marker!: Mesh;
  private markerTex!: DynamicTexture;
  private blades!: TransformNode;
  private smoke!: Mesh;
  private doors: Mesh[] = [];
  private doorGlow!: Mesh;
  private doorT = -1;
  private clearAt = 0;
  private shakeCool = 0;
  private cows: { root: TransformNode; base: Vector3; ph: number }[] = [];
  private statics = new Map<Material, Mesh[]>();
  private footprints: number[][] = [];
  private roadTris: { v: number[]; i: number[] } = { v: [], i: [] };
  private waterTris: { v: number[]; i: number[] } = { v: [], i: [] };
  private dusk = 0;
  private duskTarget = 0;
  private hemi: HemisphericLight | null;

  static async create(scene: Scene, world: World, host: LevelHost, camera?: CameraController) {
    return new KaiLevel(scene, world, host, camera);
  }

  constructor(private scene: Scene, private world: World, private host: LevelHost, camera?: CameraController) {
    this.col.extras.push(this.poly);
    this.col.bounds = { minX: -104, maxX: 104, minZ: -96, maxZ: 108 };
    this.col.terrain = (x, z) => {
      const top = fieldHeight(x, z);
      const wet = Math.abs(z - riverZ(x)) < 7.5 || Math.abs(Math.hypot(x - CASTLE.x, z - CASTLE.z) - MOAT_R) < 3.2;
      return { top, id: wet ? 'bank' : 'ground-field' };
    };
    this.start.y = fieldHeight(START.x, START.z);
    this.hemi = scene.getLightByName('hemi') as HemisphericLight | null;

    scene.fogStart = 75; scene.fogEnd = 270;
    this.applySky(0);
    world.sun.direction = new Vector3(-0.4, -1, 0.5);
    // spread the paper mountain rings around the whole field
    world.backdrop.scaling.setAll(2.5);
    world.backdrop.position.set(0, -2, -14);
    if (camera) {
      camera.cam.maxZ = 700; camera.dist = 9.5; camera.pitch = 0.3; camera.yaw = 0;
      camera.clip = (a, b) => this.poly.clearFraction(a.x, a.y, a.z, b.x, b.y, b.z);
      camera.minY = (x, z) => Math.max(fieldHeight(x, z), RIVER_WATER);
    }

    this.buildTerrain();
    this.buildWater();
    this.buildPaths();
    this.buildBridge();
    this.buildCastle();
    this.buildVillage();
    this.buildRanch();
    this.buildTemple();
    this.buildNature();
    this.buildSky();
    this.buildShards();
    this.buildOwl();
    this.buildArrow();
    this.mergeStatics();
  }

  attachKai(k: KaiPlayer) { this.kai = k; }

  get starCount() { return this.stars.filter((s) => s.got).length; }

  questText() {
    if (this.cleared) return 'クリア！';
    if (this.questStage === 0) return 'ふくろうの ホーちゃんに はなしかけよう';
    if (this.questStage >= 2) return 'しんでんの とびらの まえで マラカスを ふろう！';
    const n = this.nearest();
    return `おんぷの かけらを あつめよう（あと ${this.starTotal - this.starCount}こ）${n ? '・ちかく：' + n.label : ''}`;
  }

  private lastP = new Vector3();
  private nearest(p = this.lastP) {
    let best: (typeof this.stars)[number] | null = null, bd = Infinity;
    for (const s of this.stars) {
      if (s.got) continue;
      const d = Math.hypot(s.base.x - p.x, s.base.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------------ helpers
  private mat(key: string, base: string, o: Parameters<typeof paperMat>[3] = {}) { return paperMat(this.scene, 'kai-' + key, base, { seed: key.length * 13 + 5, ...o }); }

  /** queue a static mesh for merging by material */
  private keep<T extends Mesh>(m: T, mat: Material): T {
    m.material = mat; m.isPickable = false;
    const l = this.statics.get(mat) ?? []; l.push(m); this.statics.set(mat, l);
    return m;
  }
  private box(name: string, w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, ry = 0) {
    const b = CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    b.position.set(x, y + h / 2, z); b.rotation.y = ry;
    return this.keep(b, mat);
  }
  private cyl(name: string, o: { h: number; d?: number; dt?: number; db?: number; tess?: number }, mat: Material, x: number, y: number, z: number, flatShade = true) {
    const c = CreateCylinder(name, { height: o.h, diameter: o.d, diameterTop: o.dt ?? o.d, diameterBottom: o.db ?? o.d, tessellation: o.tess ?? 10 }, this.scene);
    if (flatShade) c.convertToFlatShadedMesh();
    c.position.set(x, y + o.h / 2, z);
    return this.keep(c, mat);
  }
  private solidRect(minX: number, minZ: number, maxX: number, maxZ: number, top = 1e9, card = true) {
    const pts = [minX, minZ, maxX, minZ, maxX, maxZ, minX, maxZ];
    this.poly.add(pts, top);
    if (card) this.footprints.push(pts);
  }
  private solidCircle(x: number, z: number, r: number, top = 1e9, card = false) {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(x + Math.cos(a) * r, z + Math.sin(a) * r); }
    this.poly.add(pts, top);
    if (card) this.footprints.push(pts);
  }
  private mergeStatics() {
    for (const [mat, list] of this.statics) {
      if (list.length < 2) { list[0]?.freezeWorldMatrix(); continue; }
      const m = Mesh.MergeMeshes(list, true, true);
      if (m) { m.material = mat; m.isPickable = false; m.receiveShadows = true; m.freezeWorldMatrix(); }
    }
    this.statics.clear();
  }
  private signTexture(name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
    const t = new DynamicTexture(name + 'Tex', { width: w, height: h }, this.scene, true);
    draw(t.getContext() as unknown as CanvasRenderingContext2D); t.update();
    const m = new StandardMaterial(name + 'Mat', this.scene);
    m.diffuseTexture = t; m.emissiveColor = new Color3(0.55, 0.55, 0.55); m.specularColor = Color3.Black(); m.backFaceCulling = false;
    return m;
  }
  /** bake a prototype's child meshes into thin instances */
  private instance(proto: TransformNode, mats: Matrix[]) {
    for (const m of proto.getChildMeshes() as Mesh[]) {
      m.computeWorldMatrix(true);
      const local = m.getWorldMatrix().clone();
      m.parent = null;
      const buf = new Float32Array(mats.length * 16);
      mats.forEach((mm, k) => local.multiply(mm).copyToArray(buf, k * 16));
      m.position.setAll(0); m.rotation.setAll(0); m.scaling.setAll(1); m.rotationQuaternion = null;
      m.thinInstanceSetBuffer('matrix', buf, 16, true);
      m.isPickable = false; m.receiveShadows = true;
      m.alwaysSelectAsActiveMesh = true;
    }
    proto.dispose(true);
  }
  private distToPaths(x: number, z: number) {
    let best = Infinity;
    for (const ln of PATHS) for (let k = 0; k + 3 < ln.length; k += 2) {
      const ax = ln[k], az = ln[k + 1], bx = ln[k + 2], bz = ln[k + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  private applySky(k: number) {
    const day = { sky: [0.8, 0.9, 0.99], fog: [0.86, 0.92, 0.98], hemi: [1, 0.98, 0.98] };
    const dusk = { sky: [0.99, 0.79, 0.7], fog: [0.98, 0.84, 0.78], hemi: [1, 0.86, 0.76] };
    const L = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * k);
    const s = L(day.sky, dusk.sky), f = L(day.fog, dusk.fog), h = L(day.hemi, dusk.hemi);
    this.scene.clearColor = new Color4(s[0], s[1], s[2], 1);
    this.scene.fogColor = new Color3(f[0], f[1], f[2]);
    if (this.hemi) this.hemi.diffuse = new Color3(h[0], h[1], h[2]);
  }

  // ------------------------------------------------------------------ build
  private buildTerrain() {
    const scene = this.scene;
    const N = 132, SIZE = 264, cx = 0, cz = 6;
    const P: number[] = [], C: number[] = [], U: number[] = [], I: number[] = [];
    const r = rng(77);
    const g1 = hex('#a8dc8f'), g2 = hex('#8fcf86'), g3 = hex('#c4e59b'), sand = hex('#efe0b4'), rock = hex('#b9b3d6'), hillTop = hex('#9fd49a');
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = cx - SIZE / 2 + (i / N) * SIZE, z = cz - SIZE / 2 + (j / N) * SIZE;
      const y = fieldHeight(x, z);
      P.push(x, y, z); U.push(x / 23, z / 23);
      const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2) * Math.cos(z * 0.13);
      let c = Color3.Lerp(g1, n > 0.6 ? g3 : g2, Math.abs(n - 0.5) * 1.6);
      const dr = Math.abs(z - riverZ(x));
      if (dr < 7) c = Color3.Lerp(sand, c, sstep(4.5, 7, dr));
      const dc = Math.hypot(x - CASTLE.x, z - CASTLE.z);
      if (dc < 16.5) c = Color3.Lerp(Math.abs(dc - MOAT_R) < 2.6 ? rock : hillTop, c, 0.15);
      if (y > 6 && dc > 20) c = Color3.Lerp(c, hex('#cfe7b7'), Math.min(1, (y - 6) / 10));
      const jit = (r() - 0.5) * 0.05;
      C.push(c.r + jit, c.g + jit, c.b + jit, 1);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    const nor: number[] = [];
    VertexData.ComputeNormals(P, I, nor);
    const m = new Mesh('field', scene);
    const vd = new VertexData(); vd.positions = P; vd.indices = I; vd.normals = nor; vd.colors = C; vd.uvs = U;
    vd.applyToMesh(m);
    const gm = this.mat('grass', '#ffffff', { size: 512, creases: 1, blotches: 26, tints: ['rgba(255,255,255,0.35)', 'rgba(120,180,110,0.18)', 'rgba(250,240,190,0.15)'] });
    m.material = gm; m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();
  }

  private ring(name: string, cx: number, cz: number, r0: number, r1: number, y: number, mat: Material, seg = 48) {
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      P.push(cx + c * r0, y, cz + s * r0, cx + c * r1, y, cz + s * r1); N.push(0, 1, 0, 0, 1, 0); U.push(i / 4, 0, i / 4, 1);
      if (i < seg) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const m = new Mesh(name, this.scene);
    const vd = new VertexData(); vd.positions = P; vd.normals = N; vd.uvs = U; vd.indices = I; vd.applyToMesh(m);
    m.material = mat; m.isPickable = false;
    // card triangles
    const b0 = this.waterTris.v.length / 2;
    for (let i = 0; i < P.length / 3; i++) this.waterTris.v.push(P[i * 3], P[i * 3 + 2]);
    for (const k of I) this.waterTris.i.push(k + b0);
    return m;
  }

  private buildWater() {
    const wm = this.mat('water', '#9cc6f0', { creases: 1, emissive: 0.3, tints: ['rgba(255,255,255,0.4)', 'rgba(110,150,230,0.2)'] });
    wm.backFaceCulling = false;
    (wm.diffuseTexture as Texture).uScale = 6;
    // river ribbon following riverZ
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    const W = 5.2;
    for (let x = -132, k = 0; x <= 132; x += 2, k++) {
      const z = riverZ(x);
      const dz = (riverZ(x + 0.5) - riverZ(x - 0.5)), l = Math.hypot(1, dz), px = -dz / l, pz = 1 / l;
      P.push(x - px * W, RIVER_WATER, z - pz * W, x + px * W, RIVER_WATER, z + pz * W); N.push(0, 1, 0, 0, 1, 0); U.push(k / 4, 0, k / 4, 1);
      if (x < 132) { const b = k * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const m = new Mesh('river', this.scene);
    const vd = new VertexData(); vd.positions = P; vd.normals = N; vd.uvs = U; vd.indices = I; vd.applyToMesh(m);
    m.material = wm; m.isPickable = false;
    const b0 = this.waterTris.v.length / 2;
    for (let i = 0; i < P.length / 3; i++) this.waterTris.v.push(P[i * 3], P[i * 3 + 2]);
    for (const k of I) this.waterTris.i.push(k + b0);
    this.ring('moat', CASTLE.x, CASTLE.z, MOAT_R - 2.5, MOAT_R + 2.5, MOAT_WATER, wm);
    // white paper ripple stripes on the river
    const foam = this.mat('foam', '#ffffff', { emissive: 0.5, creases: 0 });
    const rr = rng(9);
    for (let i = 0; i < 46; i++) {
      const x = -110 + rr() * 220, z = riverZ(x) + (rr() - 0.5) * 6;
      const p = CreatePlane('ripple', { width: 1.6 + rr() * 1.4, height: 0.16 }, this.scene);
      p.rotation.x = Math.PI / 2; p.rotation.y = Math.atan2(1, (riverZ(x + 0.5) - riverZ(x - 0.5))) + Math.PI / 2;
      p.position.set(x, RIVER_WATER + 0.03, z);
      this.keep(p, foam);
    }
  }

  private buildPaths() {
    const pm = this.mat('path', '#f2dfae', { creases: 3, tints: ['rgba(255,255,255,0.3)', 'rgba(210,170,110,0.2)'] });
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    const W = 1.7;
    for (const ln of PATHS) {
      // resample at 1 unit
      const pts: number[][] = [];
      for (let k = 0; k + 3 < ln.length; k += 2) {
        const ax = ln[k], az = ln[k + 1], bx = ln[k + 2], bz = ln[k + 3], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L));
        for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
      }
      pts.push([ln[ln.length - 2], ln[ln.length - 1]]);
      let base = -1, v = 0;
      for (let q = 0; q < pts.length; q++) {
        const a = pts[Math.max(0, q - 1)], b = pts[Math.min(pts.length - 1, q + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = -dz, pz = dx, [x, z] = pts[q];
        const wob = W * (1 + 0.12 * Math.sin(q * 0.7));
        const lx = x - px * wob, lz = z - pz * wob, rx = x + px * wob, rz = z + pz * wob;
        const vi = P.length / 3;
        P.push(lx, fieldHeight(lx, lz) + 0.07, lz, rx, fieldHeight(rx, rz) + 0.07, rz);
        N.push(0, 1, 0, 0, 1, 0); U.push(0, v, 1, v); v += 0.5;
        if (base >= 0) I.push(base, vi, base + 1, base + 1, vi, vi + 1);
        base = vi;
        this.roadTris.v.push(lx, lz, rx, rz);
        const ci = this.roadTris.v.length / 2 - 2;
        if (q > 0) this.roadTris.i.push(ci - 2, ci, ci - 1, ci - 1, ci, ci + 1);
      }
    }
    const m = new Mesh('paths', this.scene);
    const vd = new VertexData(); vd.positions = P; vd.normals = N; vd.uvs = U; vd.indices = I; vd.applyToMesh(m);
    m.material = pm; pm.backFaceCulling = false; m.receiveShadows = true; m.isPickable = false; m.freezeWorldMatrix();
  }

  private buildBridge() {
    const wood = this.mat('plank', '#d8a978', { grid: [1, 8], creases: 2 });
    const dark = this.mat('plankDark', '#a8784f', { creases: 2 });
    const B = BRIDGE;
    this.col.addSurface({ id: 'bridge', ...B });
    this.box('bridgeDeck', B.maxX - B.minX, 0.3, B.maxZ - B.minZ, wood, 0, B.top - 0.3, (B.minZ + B.maxZ) / 2);
    for (const s of [-1, 1]) {
      const x = s * (B.maxX - 0.1);
      this.col.addBlocker({ kind: 'box', id: 'rail' + s, minX: x - 0.15, maxX: x + 0.15, minZ: B.minZ, maxZ: B.maxZ, top: B.top + 1.3 });
      this.box('rail' + s, 0.18, 0.16, B.maxZ - B.minZ, dark, x, B.top + 0.85, (B.minZ + B.maxZ) / 2);
      for (let z = B.minZ + 0.3; z <= B.maxZ; z += 2.1) this.box('rpost', 0.22, 1.05, 0.22, dark, x, B.top - 0.05, z);
      for (const z of [B.minZ + 1.5, B.maxZ - 1.5]) this.box('pier', 0.6, 2.2, 0.6, dark, x, RIVER_WATER - 1.3, z);
    }
    this.footprints.push([B.minX, B.minZ, B.maxX, B.minZ, B.maxX, B.maxZ, B.minX, B.maxZ]);
  }

  private buildCastle() {
    const stone = this.mat('castleStone', '#f1ebf8', { creases: 4, grid: [4, 3], tints: ['rgba(255,255,255,0.3)', 'rgba(170,160,220,0.18)'] });
    const stone2 = this.mat('castleStone2', '#e2dbf1', { creases: 3, grid: [3, 3] });
    const roof = this.mat('castleRoof', '#7f8ee0', { creases: 3, tints: ['rgba(255,255,255,0.25)'] });
    const wood = this.mat('drawWood', '#c9925f', { grid: [1, 6], creases: 2 });
    const dark = this.mat('gateDark', '#4b3f6b', { creases: 1 });
    const flagM = this.mat('flag', '#f08aa8', { creases: 1, emissive: 0.2 });
    const cx = CASTLE.x, cz = CASTLE.z, y0 = PLATEAU, H = 5;
    // curtain walls (8 x 8 inner yard, walls 1.2 thick)
    const S = 6.2;
    this.box('wallS1', S - 1.6, H, 1.2, stone, cx - (S + 1.6) / 2, y0, cz - S);
    this.box('wallS2', S - 1.6, H, 1.2, stone, cx + (S + 1.6) / 2, y0, cz - S);
    this.box('wallGateTop', 3.2, 1.6, 1.2, stone, cx, y0 + H - 1.6, cz - S);
    this.box('wallN', S * 2, H, 1.2, stone, cx, y0, cz + S);
    this.box('wallW', 1.2, H, S * 2, stone, cx - S, y0, cz);
    this.box('wallE', 1.2, H, S * 2, stone, cx + S, y0, cz);
    // crenellations
    for (let k = -S + 0.6; k <= S - 0.6; k += 1.3) {
      for (const [x, z] of [[cx + k, cz - S], [cx + k, cz + S], [cx - S, cz + k], [cx + S, cz + k]]) this.box('cren', 0.6, 0.6, 0.6, stone2, x, y0 + H, z);
    }
    this.solidRect(cx - S - 0.8, cz - S - 0.8, cx + S + 0.8, cz + S + 0.8);
    // gate: dark arch + portcullis bars + closed gate leaf
    const gate = this.box('gateHole', 3.0, 3.3, 0.2, dark, cx, y0, cz - S - 0.62);
    gate.scaling.y = 1;
    for (let k = -1.2; k <= 1.21; k += 0.6) this.box('bar', 0.1, 3.2, 0.08, wood, cx + k, y0, cz - S - 0.75);
    // corner towers
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + sx * S, z = cz + sz * S;
      this.cyl('tower', { h: H + 3.2, d: 3.0, tess: 10 }, stone2, x, y0, z);
      this.cyl('towerRoof', { h: 3.4, dt: 0, db: 3.8, tess: 10 }, roof, x, y0 + H + 3.2, z);
    }
    // keep + tall tower
    this.box('keep', 7.5, 9, 6, stone, cx, y0, cz + 1.5);
    this.cyl('keepRoofL', { h: 3.2, dt: 0, db: 3.4, tess: 8 }, roof, cx - 2.6, y0 + 9, cz - 0.5);
    this.cyl('keepRoofR', { h: 3.2, dt: 0, db: 3.4, tess: 8 }, roof, cx + 2.6, y0 + 9, cz - 0.5);
    this.cyl('bigTower', { h: 15, d: 3.8, tess: 12 }, stone2, cx, y0, cz + 2);
    this.cyl('bigRoof', { h: 5, dt: 0, db: 4.8, tess: 12 }, roof, cx, y0 + 15, cz + 2);
    // windows on keep / tower
    for (const [x, y] of [[-2, 4.5], [2, 4.5], [0, 7]]) this.box('win', 0.8, 1.2, 0.1, dark, cx + x, y0 + y, cz - 1.56);
    this.box('towerWin', 0.7, 1.1, 0.1, dark, cx, y0 + 11.5, cz + 0.08);
    // flag on top
    this.cyl('pole', { h: 2.2, d: 0.08, tess: 5 }, wood, cx, y0 + 20, cz + 2);
    const flag = CreatePlane('flag', { width: 1.5, height: 0.8 }, this.scene);
    flag.position.set(cx + 0.78, y0 + 21.7, cz + 2); this.keep(flag, flagM);
    flagM.backFaceCulling = false;
    // drawbridge (lowered) with chains
    const D = DRAW;
    this.col.addSurface({ id: 'drawbridge', ...D });
    this.box('drawbridge', D.maxX - D.minX, 0.28, D.maxZ - D.minZ, wood, cx, D.top - 0.28, (D.minZ + D.maxZ) / 2);
    for (const s of [-1, 1]) {
      const ch = CreateCylinder('chain', { height: 5.2, diameter: 0.07, tessellation: 4 }, this.scene);
      ch.position.set(cx + s * 1.9, D.top + 2.1, D.maxZ + 0.2); ch.rotation.x = -0.85; this.keep(ch, dark);
      this.col.addBlocker({ kind: 'box', id: 'dbrail' + s, minX: cx + s * 2.15 - 0.1, maxX: cx + s * 2.15 + 0.1, minZ: D.minZ, maxZ: D.maxZ, top: D.top + 1.2 });
    }
    // little banner sign at the hill foot
    const sign = this.signTexture('castleSign', 384, 96, (c) => {
      c.fillStyle = '#fbf6ea'; c.fillRect(0, 0, 384, 96); c.fillStyle = '#7f8ee0'; c.fillRect(0, 0, 384, 10); c.fillRect(0, 86, 384, 10);
      c.fillStyle = '#4b3f6b'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('かみの おしろ', 192, 50);
    });
    const sp = CreatePlane('castleSignP', { width: 3.6, height: 0.9 }, this.scene);
    sp.material = sign; sp.position.set(3.4, fieldHeight(3.4, 45) + 1.6, 45); sp.isPickable = false;
    this.cyl('signPost', { h: 1.4, d: 0.14, tess: 5 }, wood, 3.4, fieldHeight(3.4, 45), 45.06);
  }

  private hut(x: number, z: number, s: number, ry: number, wallC: string, roofC: string) {
    const y = fieldHeight(x, z);
    const wall = this.mat('hutWall' + wallC, wallC, { creases: 3 });
    const roof = this.mat('hutRoof' + roofC, roofC, { creases: 4, grid: [6, 1], tints: ['rgba(255,255,255,0.2)', 'rgba(160,100,60,0.2)'] });
    const dark = this.mat('hutDoor', '#8a6448', { creases: 1 });
    this.cyl('hut', { h: 2.6 * s, d: 4 * s, tess: 9 }, wall, x, y, z);
    this.cyl('hutRoof', { h: 2.6 * s, dt: 0, db: 5.2 * s, tess: 9 }, roof, x, y + 2.6 * s, z);
    const door = CreatePlane('hutDoorP', { width: 0.95 * s, height: 1.6 * s }, this.scene);
    door.position.set(x + Math.sin(ry) * 2.02 * s, y + 0.8 * s, z + Math.cos(ry) * 2.02 * s); door.rotation.y = ry + Math.PI;
    this.keep(door, dark); dark.backFaceCulling = false;
    this.solidCircle(x, z, 2.1 * s, y + 5 * s, true);
  }

  private buildVillage() {
    const V = VILLAGE;
    const huts: [number, number, number, string, string][] = [
      [-8, 6, 1, '#fff1d6', '#e9a86a'], [6, 7, 0.9, '#f7e3ef', '#d98d6c'], [-10, -6, 0.95, '#e8f1dd', '#e3b273'],
      [8, -7, 1.05, '#fdebd3', '#cf8f62'], [0, -11, 0.85, '#efe6fb', '#e2a46d'],
    ];
    for (const [dx, dz, s, w, r] of huts) this.hut(V.x + dx, V.z + dz, s, Math.atan2(-dx, -dz), w, r);
    // windmill
    const wx = V.x - 4, wz = V.z + 15, wy = fieldHeight(wx, wz);
    const body = this.mat('millBody', '#fbf3e4', { creases: 4, grid: [1, 4] });
    const cap = this.mat('millCap', '#d9705f', { creases: 2 });
    const sail = this.mat('millSail', '#fffaf0', { creases: 2, grid: [4, 1], emissive: 0.15 });
    const wood = this.mat('millWood', '#b88458', { creases: 1 });
    this.cyl('mill', { h: 8.5, dt: 2.6, db: 4, tess: 8 }, body, wx, wy, wz);
    this.cyl('millCap', { h: 2.4, dt: 0, db: 3.4, tess: 8 }, cap, wx, wy + 8.5, wz);
    const door = CreatePlane('millDoor', { width: 1.1, height: 1.8 }, this.scene);
    door.position.set(wx, wy + 0.9, wz - 1.96); this.keep(door, this.mat('hutDoor', '#8a6448'));
    this.solidCircle(wx, wz, 2.0, wy + 12, true);
    const hub = new TransformNode('millHub', this.scene);
    hub.position.set(wx, wy + 7.6, wz - 1.75);
    const axle = CreateCylinder('axle', { height: 0.6, diameter: 0.4, tessellation: 6 }, this.scene);
    axle.rotation.x = Math.PI / 2; axle.material = wood; axle.parent = hub;
    for (let i = 0; i < 4; i++) {
      const arm = new TransformNode('arm' + i, this.scene); arm.parent = hub; arm.rotation.z = (i * Math.PI) / 2;
      const spar = CreateBox('spar', { width: 0.18, height: 5, depth: 0.1 }, this.scene); spar.position.y = 2.5; spar.material = wood; spar.parent = arm;
      const sl = CreateBox('sail', { width: 1.25, height: 4, depth: 0.04 }, this.scene); sl.position.set(0.7, 2.9, -0.04); sl.material = sail; sl.parent = arm;
    }
    this.blades = hub;
    // well
    const stone = this.mat('wellStone', '#d9d4ea', { creases: 3, grid: [6, 2] });
    const qx = V.x + 7, qz = V.z + 1, qy = fieldHeight(qx, qz);
    this.cyl('well', { h: 1, d: 1.9, tess: 10 }, stone, qx, qy, qz);
    this.cyl('wellWater', { h: 0.05, d: 1.5, tess: 10 }, this.mat('water', '#9cc6f0'), qx, qy + 0.85, qz);
    for (const s of [-1, 1]) this.box('wellPost', 0.14, 1.9, 0.14, wood, qx + s * 0.8, qy + 0.9, qz);
    this.cyl('wellRoof', { h: 0.9, dt: 0, db: 2.4, tess: 4 }, cap, qx, qy + 2.7, qz);
    this.solidCircle(qx, qz, 1.0, qy + 1.0);
    // flower beds
    const fl = ['#f4a3c0', '#ffd86b', '#b9b0ec', '#ffffff'];
    const rr = rng(4);
    for (let i = 0; i < 40; i++) {
      const a = rr() * Math.PI * 2, d = 3 + rr() * 11, x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d;
      if (this.poly.blocked(x, z, 0.4) || this.distToPaths(x, z) < 2) continue;
      const f = CreateDisc('flower', { radius: 0.22, tessellation: 5 }, this.scene);
      f.rotation.x = Math.PI / 2; f.position.set(x, fieldHeight(x, z) + 0.08, z);
      this.keep(f, this.mat('flower' + (i % 4), fl[i % 4], { emissive: 0.3, creases: 0 }));
    }
    // village sign
    const sign = this.signTexture('villSign', 384, 96, (c) => {
      c.fillStyle = '#fff6d6'; c.fillRect(0, 0, 384, 96); c.fillStyle = '#e8a93a'; c.font = 'bold 42px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('かざぐるまの むら', 192, 50);
    });
    const sp = CreatePlane('villSignP', { width: 3.6, height: 0.9 }, this.scene);
    const sx = V.x + 14, sz = V.z - 4.5;
    sp.material = sign; sp.position.set(sx, fieldHeight(sx, sz) + 1.6, sz); sp.rotation.y = -Math.PI / 2 - 0.25; sp.isPickable = false;
  }

  private buildRanch() {
    const R = RANCH;
    const wood = this.mat('fence', '#f0d2a8', { creases: 2 });
    const post = CreateCylinder('fencePost', { height: 1.25, diameter: 0.2, tessellation: 5 }, this.scene);
    post.material = wood; post.isPickable = false;
    const mats: Matrix[] = [];
    const gate = (x: number, z: number) => x < R.minX + 0.1 && z > -7 && z < -1;
    const side = (ax: number, az: number, bx: number, bz: number) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.round(L / 2.4);
      let segStart: number[] | null = null;
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        const inGate = gate(x, z);
        if (!inGate) mats.push(Matrix.Translation(x, fieldHeight(x, z) + 0.62, z));
        if (k < n) {
          const x2 = ax + ((bx - ax) * (k + 1)) / n, z2 = az + ((bz - az) * (k + 1)) / n;
          if (gate((x + x2) / 2, (z + z2) / 2)) continue;
          const mx = (x + x2) / 2, mz = (z + z2) / 2, y = fieldHeight(mx, mz), len = Math.hypot(x2 - x, z2 - z);
          for (const hy of [0.45, 0.95]) {
            const rail = CreateBox('rail', { width: len, height: 0.14, depth: 0.08 }, this.scene);
            rail.position.set(mx, y + hy, mz); rail.rotation.y = -Math.atan2(z2 - z, x2 - x);
            this.keep(rail, wood);
          }
          const minX = Math.min(x, x2) - 0.15, maxX = Math.max(x, x2) + 0.15, minZ = Math.min(z, z2) - 0.15, maxZ = Math.max(z, z2) + 0.15;
          this.col.addBlocker({ kind: 'box', id: 'fence', minX, maxX, minZ, maxZ, top: y + 1.15 });
        }
        void segStart; segStart = null;
      }
    };
    side(R.minX, R.minZ, R.maxX, R.minZ); side(R.maxX, R.minZ, R.maxX, R.maxZ);
    side(R.maxX, R.maxZ, R.minX, R.maxZ); side(R.minX, R.maxZ, R.minX, R.minZ);
    const buf = new Float32Array(mats.length * 16); mats.forEach((m, k) => m.copyToArray(buf, k * 16));
    post.thinInstanceSetBuffer('matrix', buf, 16, true);
    this.footprints.push([R.minX, R.minZ, R.maxX, R.minZ, R.maxX, R.maxZ, R.minX, R.maxZ].map((v) => v));
    // barn
    const red = this.mat('barn', '#e07a66', { creases: 3, grid: [6, 1] });
    const white = this.mat('barnTrim', '#fffaf0', { creases: 1, emissive: 0.1 });
    const roof = this.mat('barnRoof', '#8b6f9e', { creases: 3 });
    const bx = 65, bz = -8.5, by = fieldHeight(bx, bz);
    this.box('barn', 7, 4, 6, red, bx, by, bz);
    const prism = CreateCylinder('barnRoof', { height: 7.4, diameter: 7.2, tessellation: 3 }, this.scene);
    prism.convertToFlatShadedMesh();
    prism.rotation.z = Math.PI / 2; prism.rotation.x = Math.PI / 2 + Math.PI / 6; prism.position.set(bx, by + 4 + 0.8, bz); prism.scaling.set(1, 1, 0.62);
    this.keep(prism, roof);
    this.box('barnDoor', 2.4, 2.8, 0.1, white, bx, by, bz - 3.02);
    this.box('barnX1', 0.2, 3.2, 0.12, red, bx, by - 0.1, bz - 3.1, 0).rotation.z = 0.7;
    this.box('barnX2', 0.2, 3.2, 0.12, red, bx, by - 0.1, bz - 3.1, 0).rotation.z = -0.7;
    this.solidRect(bx - 3.6, bz - 3.1, bx + 3.6, bz + 3.1, by + 7);
    // hay bales
    const hay = this.mat('hay', '#f4d47a', { creases: 2, grid: [4, 1] });
    for (const [x, z] of [[54, -10], [56, -11], [51, 1]]) {
      const h = this.cyl('hay', { h: 1.4, d: 1.4, tess: 10 }, hay, x, fieldHeight(x, z) + 0, z);
      h.rotation.z = Math.PI / 2; h.position.y += 0;
      this.solidCircle(x, z, 0.9, fieldHeight(x, z) + 1.4);
    }
    // cows
    const cw = this.mat('cow', '#fffaf2', { creases: 2, tints: ['rgba(40,30,60,0.0)'] });
    const spot = this.mat('cowSpot', '#4b3f5b', { creases: 1 });
    const pink = this.mat('cowNose', '#f4b8c4', { creases: 0 });
    [[52, -4], [60, 0], [57, -9]].forEach(([x, z], i) => {
      const root = new TransformNode('cow' + i, this.scene);
      const mk = (w: number, h: number, d: number, m: Material, px: number, py: number, pz: number) => {
        const b = CreateBox('cowPart', { width: w, height: h, depth: d }, this.scene); b.material = m; b.position.set(px, py, pz); b.parent = root; b.isPickable = false; return b;
      };
      mk(0.9, 0.75, 1.7, cw, 0, 0.95, 0);
      mk(0.92, 0.4, 0.5, spot, 0, 1.12, 0.25);
      mk(0.6, 0.6, 0.6, cw, 0, 1.25, 1.05);
      mk(0.5, 0.25, 0.2, pink, 0, 1.05, 1.38);
      for (const sx of [-1, 1]) { mk(0.18, 0.12, 0.12, spot, sx * 0.38, 1.55, 1.0); for (const sz of [-0.6, 0.6]) mk(0.18, 0.6, 0.18, cw, sx * 0.3, 0.3, sz); }
      root.position.set(x, fieldHeight(x, z), z); root.rotation.y = i * 2.1;
      this.cows.push({ root, base: new Vector3(x, fieldHeight(x, z), z), ph: i * 1.7 });
      this.col.addBlocker({ kind: 'circle', id: 'cow', x, z, r: 1.0, top: fieldHeight(x, z) + 1.6 });
    });
    const sign = this.signTexture('ranchSign', 384, 96, (c) => {
      c.fillStyle = '#fff6d6'; c.fillRect(0, 0, 384, 96); c.fillStyle = '#c86a52'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('もくもく ぼくじょう', 192, 50);
    });
    const sp = CreatePlane('ranchSignP', { width: 3.6, height: 0.9 }, this.scene);
    sp.material = sign; sp.position.set(R.minX - 0.4, fieldHeight(R.minX, 1) + 1.7, 0.6); sp.rotation.y = Math.PI / 2 + 0.3; sp.isPickable = false;
  }

  private buildTemple() {
    const T = TEMPLE;
    const st = this.mat('templeStone', '#cfc9e3', { creases: 5, grid: [5, 4], tints: ['rgba(255,255,255,0.25)', 'rgba(120,160,120,0.18)'] });
    const st2 = this.mat('templeStone2', '#b9b2d6', { creases: 4, grid: [3, 3] });
    const moss = this.mat('moss', '#9fcf8c', { creases: 2 });
    const y = fieldHeight(T.doorX, T.doorZ);
    const w = T.maxX - T.minX, d = T.maxZ - T.minZ, cx = (T.minX + T.maxX) / 2, cz = (T.minZ + T.maxZ) / 2;
    this.box('templeBase', w + 2, 0.5, d + 2, st2, cx, y - 0.25, cz);
    this.box('templeBody', w, 6, d, st, cx, y, cz);
    this.box('templeTop', w + 1, 0.8, d + 1, st2, cx, y + 6, cz);
    this.box('templeTop2', w - 3, 2.2, d - 3, st, cx, y + 6.8, cz);
    this.box('templeCap', w - 6, 1.2, d - 6, st2, cx, y + 9, cz);
    for (const [x, z, s] of [[cx - 4, T.maxZ + 0.1, 1], [cx + 3, T.minZ - 0.1, 0.8], [T.minX - 0.1, cz + 2, 1.2]]) this.box('mossPatch', 2.2 * s, 1.4 * s, 0.3, moss, x, y + 5 * s - 1, z);
    // porch columns + lintel
    for (const z of [T.doorZ - 4.5, T.doorZ - 2.2, T.doorZ + 2.2, T.doorZ + 4.5]) this.cyl('column', { h: 5.4, d: 0.9, tess: 8 }, st2, T.doorX + 1.7, y, z);
    this.box('lintel', 1.4, 0.8, 11, st2, T.doorX + 1.7, y + 5.4, T.doorZ);
    // steps
    for (let k = 0; k < 2; k++) this.box('step', 1, 0.2 + k * 0.0, 6 - k, st2, T.doorX + 3.2 - k * 0.6, y - 0.02, T.doorZ);
    // door frame + engraved note symbol + two panels
    const dark = this.mat('templeDark', '#3e3560', { creases: 0 });
    this.box('doorFrame', 0.3, 4.6, 4.4, st2, T.doorX + 0.15, y, T.doorZ);
    const glowM = new StandardMaterial('doorGlow', this.scene);
    glowM.emissiveColor = new Color3(1, 0.86, 0.55); glowM.diffuseColor = new Color3(1, 0.9, 0.6); glowM.disableLighting = true;
    this.doorGlow = CreatePlane('doorGlowP', { width: 3.4, height: 3.8 }, this.scene);
    this.doorGlow.material = dark; this.doorGlow.position.set(T.doorX + 0.32, y + 1.9, T.doorZ); this.doorGlow.rotation.y = -Math.PI / 2; this.doorGlow.isPickable = false;
    (this.doorGlow as Mesh & { _glow?: StandardMaterial })._glow = glowM;
    const panelM = cutoutMat(this.scene, 'templeDoor', '#a89cd2', 128, 256, (c) => {
      c.fillRect(0, 0, 128, 256);
      c.globalCompositeOperation = 'destination-out';
      c.lineWidth = 6; c.strokeRect(14, 14, 100, 228);
      c.beginPath(); c.arc(64, 150, 16, 0, Math.PI * 2); c.fill(); c.fillRect(76, 66, 6, 86); c.fillRect(76, 66, 26, 10);
      c.globalCompositeOperation = 'source-over';
    }, { seed: 41 });
    for (const s of [-1, 1]) {
      const p = CreateBox('templeDoor' + s, { width: 0.25, height: 3.8, depth: 1.72 }, this.scene);
      p.position.set(T.doorX + 0.42, y + 1.9, T.doorZ + s * 0.86);
      p.material = panelM; p.isPickable = false;
      this.doors.push(p);
    }
    this.solidRect(T.minX - 0.9, T.minZ - 0.9, T.maxX + 0.6, T.maxZ + 0.9, y + 11);
    for (const z of [T.doorZ - 4.5, T.doorZ - 2.2, T.doorZ + 2.2, T.doorZ + 4.5]) this.solidCircle(T.doorX + 1.7, z, 0.5, y + 6);
    // ruins scattered nearby
    const rr = rng(12);
    for (let i = 0; i < 7; i++) {
      const a = rr() * Math.PI * 2, dd = 10 + rr() * 6, x = cx + Math.cos(a) * dd, z = cz + Math.sin(a) * dd;
      if (this.distToPaths(x, z) < 2.6 || this.poly.blocked(x, z, 1)) continue;
      const h = 0.8 + rr() * 2.6;
      this.cyl('ruin', { h, d: 0.9, tess: 7 }, st2, x, fieldHeight(x, z), z);
      this.solidCircle(x, z, 0.55, fieldHeight(x, z) + h);
    }
    this.interactables.push({
      id: 'temple', pos: new Vector3(T.doorX + 3.2, y, T.doorZ), radius: 4.2,
      get label() { return ''; },
      action: () => this.templeAction(),
    });
    const it = this.interactables[this.interactables.length - 1];
    Object.defineProperty(it, 'label', { get: () => (this.questStage >= 2 ? 'マラカスを ふる' : 'とびらを しらべる') });
    const sign = this.signTexture('templeSign', 384, 96, (c) => {
      c.fillStyle = '#efeaf8'; c.fillRect(0, 0, 384, 96); c.fillStyle = '#5b4c94'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('おとの しんでん', 192, 50);
    });
    const sp = CreatePlane('templeSignP', { width: 3.6, height: 0.9 }, this.scene);
    sp.material = sign; sp.position.set(T.doorX + 2.45, y + 5.8, T.doorZ); sp.rotation.y = -Math.PI / 2; sp.isPickable = false;
  }

  private buildNature() {
    const scene = this.scene;
    const r = rng(21);
    // round paper trees + cone trees
    const trunkM = this.mat('trunk', '#c9a07e', { creases: 2 });
    const crownA = this.mat('crownA', '#7fc781', { creases: 4, tints: ['rgba(255,255,255,0.25)', 'rgba(60,140,90,0.2)'] });
    const crownB = this.mat('crownB', '#a4d67a', { creases: 4, tints: ['rgba(255,255,255,0.25)'] });
    const coneM = this.mat('coneTree', '#5fb08a', { creases: 3 });
    const roundProto = new TransformNode('roundTree', scene);
    const t1 = flat(CreateCylinder('rtTrunk', { height: 1.6, diameterTop: 0.25, diameterBottom: 0.4, tessellation: 5 }, scene), trunkM); t1.position.y = 0.8; t1.parent = roundProto;
    const c1 = flat(CreateIcoSphere('rtCrown', { radius: 1.5, subdivisions: 1 }, scene), crownA); c1.position.y = 2.6; c1.parent = roundProto;
    const roundProto2 = new TransformNode('roundTree2', scene);
    const t2 = flat(CreateCylinder('rtTrunk2', { height: 1.4, diameterTop: 0.22, diameterBottom: 0.36, tessellation: 5 }, scene), trunkM); t2.position.y = 0.7; t2.parent = roundProto2;
    const c2 = flat(CreateIcoSphere('rtCrown2', { radius: 1.25, subdivisions: 1 }, scene), crownB); c2.position.y = 2.2; c2.scaling.y = 1.2; c2.parent = roundProto2;
    const coneProto = new TransformNode('coneTree', scene);
    const t3 = flat(CreateCylinder('ctTrunk', { height: 1, diameter: 0.3, tessellation: 5 }, scene), trunkM); t3.position.y = 0.5; t3.parent = coneProto;
    for (let i = 0; i < 3; i++) { const c = flat(CreateCylinder('ctC' + i, { height: 1.8 - i * 0.3, diameterTop: 0, diameterBottom: 2.6 - i * 0.6, tessellation: 6 }, scene), coneM); c.position.y = 1.4 + i * 0.9; c.parent = coneProto; }
    const A: Matrix[] = [], B: Matrix[] = [], C: Matrix[] = [];
    const ok = (x: number, z: number, rad: number) => {
      if (Math.abs(z - riverZ(x)) < 8) return false;
      if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < 22) return false;
      if (this.distToPaths(x, z) < 3.2) return false;
      for (const f of FLATS) if (Math.hypot(x - f.x, z - f.z) < f.r) return false;
      if (x > RANCH.minX - 3 && x < RANCH.maxX + 3 && z > RANCH.minZ - 3 && z < RANCH.maxZ + 3) return false;
      if (Math.hypot(x - SHARDS[1].x, z - SHARDS[1].z) < 4) return false;
      return !this.poly.blocked(x, z, rad);
    };
    // groves: clusters + scattered
    const groves = [[-30, -38, 12], [30, -40, 12], [-36, 50, 14], [40, 52, 14], [-88, -30, 14], [86, -40, 12], [-20, 6, 7], [24, 8, 8], [-84, 40, 12], [80, 30, 10], [-40, -80, 12], [40, -80, 12]];
    let placed = 0;
    for (let n = 0; n < 900 && placed < 230; n++) {
      let x: number, z: number;
      if (n % 3 === 0) { x = -100 + r() * 200; z = -88 + r() * 190; }
      else { const g = groves[Math.floor(r() * groves.length)]; const a = r() * Math.PI * 2, d = Math.sqrt(r()) * g[2]; x = g[0] + Math.cos(a) * d; z = g[1] + Math.sin(a) * d; }
      if (!ok(x, z, 1.4)) continue;
      const y = fieldHeight(x, z), sc = 0.75 + r() * 0.7, kind = r();
      const m = Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.RotationYawPitchRoll(r() * 6, 0, 0), new Vector3(x, y - 0.05, z));
      (kind < 0.42 ? A : kind < 0.72 ? B : C).push(m);
      this.solidCircle(x, z, 0.45 * sc, y + 5);
      placed++;
    }
    this.instance(roundProto, A); this.instance(roundProto2, B); this.instance(coneProto, C);
    // grass tufts
    const grassM = this.mat('tuft', '#86d070', { creases: 1, emissive: 0.1 });
    const tuft = flat(CreateCylinder('tuft', { height: 0.6, diameterTop: 0, diameterBottom: 0.35, tessellation: 3 }, scene), grassM);
    const G: Matrix[] = [];
    for (let n = 0; n < 1400 && G.length < 650; n++) {
      const x = -95 + r() * 190, z = -85 + r() * 180;
      if (Math.abs(z - riverZ(x)) < 5.5 || this.distToPaths(x, z) < 2) continue;
      const dc = Math.hypot(x - CASTLE.x, z - CASTLE.z);
      if (dc < 15) continue;
      for (let k = 0; k < 3; k++) {
        const s = 0.6 + r() * 0.7, ox = (r() - 0.5) * 0.5, oz = (r() - 0.5) * 0.5;
        G.push(Matrix.Compose(new Vector3(s, s * (0.8 + r() * 0.6), s), Quaternion.RotationYawPitchRoll(r() * 6, (r() - 0.5) * 0.4, 0), new Vector3(x + ox, fieldHeight(x + ox, z + oz) + 0.2 * s, z + oz)));
      }
    }
    const buf = new Float32Array(G.length * 16); G.forEach((m, k) => m.copyToArray(buf, k * 16));
    tuft.thinInstanceSetBuffer('matrix', buf, 16, true); tuft.isPickable = false; tuft.alwaysSelectAsActiveMesh = true;
    // field flowers
    const flowerM = this.mat('fieldFlower', '#ffe6f0', { creases: 0, emissive: 0.35 });
    const fl = CreateDisc('fieldFlower', { radius: 0.18, tessellation: 5 }, scene); fl.material = flowerM; fl.isPickable = false;
    const F: Matrix[] = [];
    for (let n = 0; n < 600 && F.length < 260; n++) {
      const x = -90 + r() * 180, z = -80 + r() * 170;
      if (Math.abs(z - riverZ(x)) < 6 || this.distToPaths(x, z) < 2 || Math.hypot(x - CASTLE.x, z - CASTLE.z) < 15) continue;
      F.push(Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(0, Math.PI / 2, 0), new Vector3(x, fieldHeight(x, z) + 0.09, z)));
    }
    const fb = new Float32Array(F.length * 16); F.forEach((m, k) => m.copyToArray(fb, k * 16));
    fl.thinInstanceSetBuffer('matrix', fb, 16, true); fl.alwaysSelectAsActiveMesh = true;
    // big rocks
    const rockM = this.mat('rock', '#c8c2df', { creases: 3 });
    for (let i = 0; i < 18; i++) {
      const x = -95 + r() * 190, z = -80 + r() * 175;
      if (!ok(x, z, 1.6)) continue;
      const s = 0.8 + r() * 1.3;
      const rk = flat(CreateIcoSphere('rock', { radius: s, subdivisions: 0 }, scene));
      rk.position.set(x, fieldHeight(x, z) + s * 0.25, z); rk.rotation.set(r(), r() * 6, r()); rk.scaling.y = 0.7;
      this.keep(rk, rockM);
      this.solidCircle(x, z, s * 0.85, fieldHeight(x, z) + s);
    }
  }

  private buildSky() {
    const scene = this.scene;
    // far volcano-like mountain with a slowly turning smoke ring (original paper design)
    const vm = this.mat('volcano', '#b9a9dc', { creases: 6, tints: ['rgba(255,255,255,0.25)', 'rgba(220,120,140,0.15)'] });
    vm.fogEnabled = false; vm.emissiveColor = new Color3(0.35, 0.3, 0.4);
    const vx = -95, vz = 230;
    const vol = flat(CreateCylinder('volcano', { height: 95, diameterTop: 22, diameterBottom: 150, tessellation: 9 }, scene), vm);
    vol.position.set(vx, 40, vz); vol.isPickable = false;
    const lava = this.mat('volcanoTop', '#f08a7a', { creases: 1, emissive: 0.5 }); lava.fogEnabled = false;
    const topC = CreateCylinder('volcanoTop', { height: 1, diameter: 20, tessellation: 9 }, scene); topC.material = lava; topC.position.set(vx, 87.8, vz); topC.isPickable = false;
    const sm = new StandardMaterial('smokeMat', scene);
    sm.diffuseColor = new Color3(1, 1, 1); sm.emissiveColor = new Color3(0.85, 0.82, 0.92); sm.alpha = 0.92; sm.fogEnabled = false; sm.specularColor = Color3.Black();
    this.smoke = CreateTorus('smokeRing', { diameter: 34, thickness: 7, tessellation: 28 }, scene);
    this.smoke.convertToFlatShadedMesh();
    this.smoke.material = sm; this.smoke.position.set(vx, 104, vz); this.smoke.rotation.x = 0.18; this.smoke.isPickable = false;
    // a second, nearer green hill line in front of the paper mountains
    // sun disc
    const sunM = new StandardMaterial('sunDisc', scene);
    sunM.emissiveColor = new Color3(1, 0.93, 0.7); sunM.disableLighting = true; sunM.fogEnabled = false;
    const sun = CreateDisc('sunDisc', { radius: 14, tessellation: 24 }, scene);
    sun.material = sunM; sun.position.set(170, 150, 330); sun.billboardMode = Mesh.BILLBOARDMODE_ALL; sun.isPickable = false;
    const halo = CreateDisc('sunHalo', { radius: 22, tessellation: 24 }, scene);
    const hm = new StandardMaterial('sunHaloM', scene); hm.emissiveColor = new Color3(1, 0.95, 0.8); hm.alpha = 0.3; hm.disableLighting = true; hm.fogEnabled = false;
    halo.material = hm; halo.position.set(170, 150, 331); halo.billboardMode = Mesh.BILLBOARDMODE_ALL; halo.isPickable = false;
    // clouds are part of the World backdrop; push them up a bit
    for (const c of this.world.clouds) c.position.y += 4;
  }

  private buildShards() {
    const mat = this.mat('noteShard', '#ffcf5a', { emissive: 0.45, creases: 1, tints: ['rgba(255,255,255,0.45)', 'rgba(255,140,170,0.25)'] });
    const beamMat = new StandardMaterial('noteBeam', this.scene);
    beamMat.diffuseColor = new Color3(1, 0.85, 0.6); beamMat.emissiveColor = new Color3(1, 0.8, 0.6);
    beamMat.alpha = 0.36; beamMat.disableLighting = true; beamMat.fogEnabled = false; beamMat.backFaceCulling = false;
    SHARDS.forEach((s, i) => {
      const y = i === 2 ? DRAW.top : fieldHeight(s.x, s.z);
      const head = CreateSphere('noteHead', { diameter: 0.5, segments: 8 }, this.scene); head.scaling.set(1.2, 0.85, 0.6); head.rotation.z = -0.4; head.position.set(-0.12, -0.35, 0);
      const stem = CreateBox('noteStem', { width: 0.08, height: 0.95, depth: 0.1 }, this.scene); stem.position.set(0.12, 0.08, 0);
      const flag = CreateBox('noteFlag', { width: 0.34, height: 0.14, depth: 0.1 }, this.scene); flag.position.set(0.27, 0.5, 0); flag.rotation.z = -0.5;
      const m = Mesh.MergeMeshes([head, stem, flag], true)!;
      m.convertToFlatShadedMesh(); m.material = mat; m.isPickable = false;
      const base = new Vector3(s.x, y, s.z);
      m.position.set(s.x, y + 1.2, s.z);
      const beam = CreateCylinder('noteBeam' + i, { height: 46, diameterTop: 0.3, diameterBottom: 0.9, tessellation: 6 }, this.scene);
      beam.material = beamMat; beam.position.set(s.x, y + 23, s.z); beam.isPickable = false;
      this.stars.push({ mesh: m, base, got: false, label: s.label, beacon: beam });
      this.world.cast(m);
    });
  }

  private buildOwl() {
    const scene = this.scene;
    const brown = this.mat('owl', '#a77a55', { creases: 3, tints: ['rgba(255,255,255,0.2)'] });
    const cream = this.mat('owlBelly', '#f6e3c2', { creases: 1 });
    const beakM = this.mat('owlBeak', '#f0a33c', { creases: 0, emissive: 0.2 });
    const white = this.mat('owlEye', '#ffffff', { creases: 0, emissive: 0.4 });
    const black = this.mat('owlPupil', '#2b2733', { creases: 0 });
    const wood = this.mat('stump', '#b58a63', { creases: 2, grid: [1, 3] });
    const y0 = fieldHeight(OWL.x, OWL.z);
    const stump = flat(CreateCylinder('stump', { height: 1.1, diameterTop: 1.0, diameterBottom: 1.3, tessellation: 8 }, scene), wood);
    stump.position.set(OWL.x, y0 + 0.55, OWL.z); stump.isPickable = false;
    const root = new TransformNode('owl', scene); root.position.set(OWL.x, y0 + 1.1, OWL.z);
    const add = (m: Mesh, mt: Material, parent: TransformNode = root) => { m.material = mt; m.parent = parent; m.isPickable = false; this.world.cast(m); return m; };
    const body = add(flat(CreateIcoSphere('owlBody', { radius: 0.55, subdivisions: 2 }, scene)), brown); body.scaling.set(1, 1.15, 0.9); body.position.y = 0.55;
    const belly = add(CreateSphere('owlBelly', { diameter: 0.8, segments: 10 }, scene), cream); belly.scaling.set(0.9, 1.05, 0.5); belly.position.set(0, 0.45, 0.28);
    const head = new TransformNode('owlHead', scene); head.parent = root; head.position.y = 1.2;
    add(flat(CreateIcoSphere('owlHeadS', { radius: 0.48, subdivisions: 2 }, scene)), brown, head).scaling.set(1.1, 0.92, 0.95);
    for (const s of [-1, 1]) {
      const eye = add(CreateSphere('owlEyeW', { diameter: 0.34, segments: 10 }, scene), white, head); eye.scaling.z = 0.4; eye.position.set(s * 0.19, 0.04, 0.4);
      const pu = add(CreateSphere('owlPupil', { diameter: 0.16, segments: 8 }, scene), black, head); pu.scaling.z = 0.4; pu.position.set(s * 0.18, 0.04, 0.47);
      const tuft = add(flat(CreateCylinder('owlTuft', { height: 0.32, diameterTop: 0, diameterBottom: 0.18, tessellation: 4 }, scene)), brown, head); tuft.position.set(s * 0.32, 0.43, 0); tuft.rotation.z = -s * 0.5;
    }
    const beak = add(flat(CreateCylinder('owlBeak', { height: 0.2, diameterTop: 0, diameterBottom: 0.14, tessellation: 4 }, scene)), beakM, head); beak.rotation.x = Math.PI; beak.position.set(0, -0.1, 0.45);
    const wings: TransformNode[] = [];
    for (const s of [-1, 1]) {
      const w = new TransformNode('owlWing' + s, scene); w.parent = root; w.position.set(s * 0.5, 0.85, -0.05);
      const wm = add(flat(CreateIcoSphere('owlWingS', { radius: 0.36, subdivisions: 1 }, scene)), brown, w); wm.scaling.set(0.35, 1.1, 0.8); wm.position.y = -0.3;
      wings.push(w);
    }
    // little acorn hat
    const hat = add(flat(CreateCylinder('owlHat', { height: 0.22, diameterTop: 0.1, diameterBottom: 0.46, tessellation: 7 }, scene)), this.mat('owlHat', '#7f8ee0'), head); hat.position.y = 0.5;
    this.owl = { root, head, wings };
    this.solidCircle(OWL.x, OWL.z, 0.8, y0 + 3);
    // speech marker
    const tex = new DynamicTexture('owlMarkerTex', { width: 128, height: 128 }, scene, true); tex.hasAlpha = true;
    const marker = CreatePlane('owlMarker', { size: 0.85 }, scene);
    const mm = new StandardMaterial('owlMarkerMat', scene);
    mm.diffuseTexture = tex; mm.useAlphaFromDiffuseTexture = true; mm.transparencyMode = 1; mm.disableLighting = true; mm.emissiveColor = Color3.White();
    marker.material = mm; marker.billboardMode = Mesh.BILLBOARDMODE_ALL; marker.isPickable = false;
    marker.position.set(OWL.x, y0 + 3.4, OWL.z);
    this.marker = marker; this.markerTex = tex;
    this.drawMarker('！', '#f08a5d');
    this.interactables.push({ id: 'owl', pos: new Vector3(OWL.x, y0, OWL.z), radius: 2.8, label: 'ホーちゃんと はなす', action: () => this.talkOwl() });
  }

  private drawMarker(ch: string, color: string) {
    const c = this.markerTex.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = '#fbf5ea'; c.beginPath(); c.arc(64, 60, 50, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(50, 100); c.lineTo(64, 126); c.lineTo(78, 100); c.fill();
    c.fillStyle = color; c.font = 'bold 72px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(ch, 64, 64);
    this.markerTex.update();
  }

  private buildArrow() {
    const m = cutoutMat(this.scene, 'guideArrowKai', '#ffcf5a', 128, 128, (c) => {
      c.beginPath(); c.moveTo(64, 4); c.lineTo(118, 64); c.lineTo(84, 64); c.lineTo(84, 124); c.lineTo(44, 124); c.lineTo(44, 64); c.lineTo(10, 64); c.closePath(); c.fill();
    }, { seed: 99, tints: ['rgba(255,255,255,0.4)', 'rgba(240,140,90,0.2)'] });
    m.emissiveColor = new Color3(0.6, 0.55, 0.4);
    const node = new TransformNode('arrowNode', this.scene);
    const p = CreatePlane('guideArrowPlane', { size: 1.1 }, this.scene);
    p.material = m; p.rotation.x = Math.PI / 2; p.parent = node; p.isPickable = false;
    this.arrow = node;
  }

  // ------------------------------------------------------------------ story
  talkOwl() {
    const left = this.starTotal - this.starCount;
    if (this.questStage === 0) {
      this.questStage = 1;
      this.drawMarker('♪', '#e8a93a');
      this.host.dialog([
        { who: 'ホーちゃん', text: 'ホーホー！ よく きたね、かい。ここは かぜの げんやだよ。' },
        { who: 'ホーちゃん', text: 'にしの「おとの しんでん」の とびらは、ふしぎな メロディで しか ひらかないんだ。' },
        { who: 'ホーちゃん', text: `でも メロディが「おんぷの かけら」${this.starTotal}つに わかれて、げんやに ちらばっちゃった…` },
        { who: 'ホーちゃん', text: 'かざぐるまの むら、ぼくじょうの かわべ、それと おしろの つりばしの まえ。ひかる はしらが めじるしだよ。' },
        { who: 'かい', text: 'まかせて！ マラカスで おんがくを とりもどすね！' },
        { who: 'ホーちゃん', text: 'E キー（または ♪ ボタン）で マラカスを ふれるよ。ためしに ふって みて！' },
      ], () => { this.host.toast('きいろい やじるしの ほうへ いこう！', 2400); this.host.onProgress(); });
    } else if (this.questStage === 1) {
      const n = this.nearest();
      this.host.dialog([
        { who: 'ホーちゃん', text: `かけらは あと ${left}つ だよ。` },
        { who: 'ホーちゃん', text: n ? `いちばん ちかいのは「${n.label}」かな。` : 'がんばって！' },
      ]);
    } else if (this.questStage === 2) {
      this.host.dialog([
        { who: 'ホーちゃん', text: 'メロディが そろったね！ にしの しんでんへ いって、とびらの まえで マラカスを ふってごらん。' },
      ]);
    } else this.host.dialog([{ who: 'ホーちゃん', text: 'すてきな メロディだったよ！ ホーホー♪' }]);
  }

  private templeAction() {
    if (this.questStage < 2) {
      this.host.dialog([
        { who: 'かい', text: 'おおきな とびら…。おんぷの もようが かいてある。' },
        { who: 'かい', text: `おんぷの かけらを ${this.starTotal}つ あつめたら ひらくかも！（いま ${this.starCount} / ${this.starTotal}）` },
      ]);
      return;
    }
    if (this.questStage > 2) return;
    this.questStage = 3;
    this.kai?.shake(3.2);
    const dur = this.host.sfx.melody?.(true) ?? 2.8;
    const T = TEMPLE, y = fieldHeight(T.doorX, T.doorZ);
    this.host.focus(new Vector3(T.doorX + 1, y + 2, T.doorZ), Math.max(3.4, dur + 1.2));
    this.doorT = 0;
    this.clearAt = Math.max(3.4, dur + 1.4);
    this.host.toast('♪ ララ ラ〜 マラカスの メロディ！', 2200);
    this.host.onProgress();
  }

  onAct() {
    if (!this.kai || this.shakeCool > 0 || this.cleared) return;
    this.shakeCool = 1.2;
    this.kai.shake(1.1);
    this.host.sfx.melody?.(false);
    const p = this.kai.pos;
    this.host.effects.burst(new Vector3(p.x, p.y + 1.4, p.z), { count: 18, power: 2.5, life: 0.9, colors: [new Color4(1, 0.85, 0.4, 1), new Color4(1, 0.6, 0.8, 1)] });
  }

  isDrowning(p: Vector3) {
    if (Math.abs(p.z - riverZ(p.x)) < 5 && p.y < RIVER_WATER - 0.25) return true;
    const dc = Math.hypot(p.x - CASTLE.x, p.z - CASTLE.z);
    return Math.abs(dc - MOAT_R) < 2.3 && p.y < MOAT_WATER - 0.3;
  }

  // ------------------------------------------------------------------ tick
  update(dt: number, p: Vector3) {
    this.t += dt;
    this.lastP.copyFrom(p);
    this.shakeCool = Math.max(0, this.shakeCool - dt);
    this.pathT -= dt;
    if (!this.cleared && this.pathT <= 0) {
      this.pathT = 0.25;
      const n = this.path.length;
      if (n === 0 || Math.hypot(p.x - this.path[n - 2], p.z - this.path[n - 1]) > 1.2) this.path.push(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10);
    }
    this.blades.rotation.z += dt * (0.6 + (this.kai?.shaking ? 2.5 : 0));
    this.smoke.rotation.y += dt * 0.08;
    this.smoke.position.y = 104 + Math.sin(this.t * 0.4) * 1.5;
    // dusk deepens as the melody comes back
    this.dusk += (this.duskTarget - this.dusk) * Math.min(1, dt * 0.8);
    this.applySky(this.dusk);
    for (const c of this.cows) {
      const k = this.t * 0.25 + c.ph;
      c.root.position.x = c.base.x + Math.sin(k) * 0.4;
      c.root.rotation.y = c.ph * 2 + Math.sin(k * 0.6) * 0.5;
      c.root.position.y = c.base.y + (this.kai?.shaking && Math.hypot(p.x - c.base.x, p.z - c.base.z) < 12 ? Math.abs(Math.sin(this.t * 9)) * 0.35 : 0);
    }
    for (const s of this.stars) {
      if (s.got) continue;
      s.mesh.rotation.y += dt * 1.6;
      s.mesh.position.y = s.base.y + 1.2 + Math.sin(this.t * 2.2 + s.base.x) * 0.15;
      const dx = p.x - s.base.x, dz = p.z - s.base.z;
      if (dx * dx + dz * dz < 1.44 && Math.abs(p.y - s.base.y) < 2.2) {
        s.got = true;
        s.mesh.setEnabled(false); s.beacon.setEnabled(false);
        this.host.effects.burst(s.mesh.position, { count: 40 });
        this.host.sfx.star();
        const n = this.starCount;
        this.duskTarget = (n / this.starTotal) * 0.55;
        if (this.questStage === 0) this.questStage = 1;
        if (n < this.starTotal) this.host.toast(`おんぷの かけら ゲット！ 「${s.label}」 ${n} / ${this.starTotal}`, 2000);
        else { this.questStage = 2; this.drawMarker('！', '#7a69d4'); this.host.toast('メロディが そろった！ にしの「おとの しんでん」へ いこう', 2800); }
        this.host.onProgress();
      }
    }
    // owl looks at Kai and flaps a little
    const o = this.owl.root.position;
    const yaw = Math.atan2(p.x - o.x, p.z - o.z);
    this.owl.root.rotation.y += (((yaw - this.owl.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
    this.owl.head.rotation.z = Math.sin(this.t * 1.7) * 0.12;
    const flap = Math.max(0, Math.sin(this.t * 2.2)) ** 6;
    this.owl.wings[0].rotation.z = -flap * 0.9; this.owl.wings[1].rotation.z = flap * 0.9;
    this.marker.position.y = o.y + 2.3 + Math.sin(this.t * 3) * 0.1;
    // temple door opening sequence
    if (this.doorT >= 0) {
      this.doorT += dt;
      const k = sstep(0.8, 2.8, this.doorT);
      this.doors.forEach((d, i) => { d.position.z = TEMPLE.doorZ + (i ? 1 : -1) * (0.86 + k * 1.7); });
      if (this.doorT > 0.8 && this.doorGlow.material?.name !== 'doorGlow') {
        this.doorGlow.material = (this.doorGlow as Mesh & { _glow?: StandardMaterial })._glow!;
        const y = fieldHeight(TEMPLE.doorX, TEMPLE.doorZ);
        this.host.effects.burst(new Vector3(TEMPLE.doorX + 1, y + 2, TEMPLE.doorZ), { count: 90, power: 5, life: 1.6, colors: [new Color4(1, 0.9, 0.5, 1), new Color4(0.7, 0.8, 1, 1)] });
      }
      if (!this.cleared && this.doorT >= this.clearAt) {
        this.cleared = true;
        this.host.onClear();
      }
    }
    // guide arrow
    let target: { x: number; z: number } | null = null;
    if (this.questStage === 1) target = this.nearest(p)?.base ?? null;
    else if (this.questStage === 2) target = { x: TEMPLE.doorX + 3, z: TEMPLE.doorZ };
    else if (this.questStage === 0 && Math.hypot(p.x - OWL.x, p.z - OWL.z) > 4) target = OWL;
    if (target && !this.cleared && this.questStage < 3) {
      this.arrow.setEnabled(true);
      this.arrow.position.set(p.x, p.y + 2.55 + Math.sin(this.t * 4) * 0.08, p.z);
      this.arrow.rotation.y = Math.atan2(target.x - p.x, target.z - p.z);
    } else this.arrow.setEnabled(false);
  }

  nearestInteractable(p: Vector3): Interactable | null {
    let best: Interactable | null = null, bd = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
      if (d < it.radius && d < bd && Math.abs(p.y - it.pos.y) < 3) { best = it; bd = d; }
    }
    if (best?.id === 'temple' && this.questStage > 2) return null;
    return best;
  }

  respawnPoint(lastSafe: Vector3) {
    const q = lastSafe.clone();
    // never respawn inside the water: push out to the nearest dry bank
    const rz = riverZ(q.x);
    if (Math.abs(q.z - rz) < 8) q.z = rz + (q.z >= rz ? 8.5 : -8.5);
    const dx = q.x - CASTLE.x, dz = q.z - CASTLE.z, dc = Math.hypot(dx, dz) || 1;
    if (Math.abs(dc - MOAT_R) < 3.2) { q.x = CASTLE.x + (dx / dc) * (MOAT_R + 3.6); q.z = CASTLE.z + (dz / dc) * (MOAT_R + 3.6); }
    q.y = fieldHeight(q.x, q.z) + 0.3;
    return q;
  }

  cardInfo(secs: number): CardInfo {
    return {
      title: 'かいと かぜの げんや',
      subtitle: 'かみの げんや ― マラカスで とびらを ひらこう',
      secs, stars: this.starCount, total: this.starTotal,
      url: 'https://plseal.github.io/paper-wonderland/',
      credits: 'オリジナル ステージ ／ キャラクター原案: かい',
      date: new Date(),
      portrait: kaiUrl,
      mapCaption: 'かいの あるいた みち（かぜの げんや）',
      starLabel: 'あつめた おんぷ',
      map: {
        radius: 86, center: { x: -2, z: 8 },
        buildings: this.footprints,
        station: [],
        roads: this.roadTris,
        viaduct: { v: [], i: [] },
        water: this.waterTris,
        stars: this.stars.map((s) => ({ x: s.base.x, z: s.base.z })),
        fox: { x: OWL.x, z: OWL.z },
        npc: { name: 'ホーちゃん', kind: 'owl' },
        path: this.path.slice(),
        labels: [
          { x: 0, z: 94, text: 'おしろ' }, { x: VILLAGE.x, z: VILLAGE.z + 22, text: 'むら' },
          { x: RANCH.x, z: RANCH.minZ - 6, text: 'ぼくじょう' }, { x: -63, z: -70, text: 'しんでん' },
        ],
        ground: '#cfe9bf',
        palette: ['#fbe3d3', '#fde9c9', '#f6d6e2', '#e3defa', '#d8e8f8', '#fff3dc'],
      },
      shareText: 'かいと かぜの げんや を クリアしたよ！ ♪ #PaperWonderland',
      fileName: 'kai-field-clear.png',
    };
  }
}

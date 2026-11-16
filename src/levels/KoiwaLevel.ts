import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CollisionWorld } from '../core/Collision';
import { PolyCollider } from '../core/PolyCollider';
import type { CameraController } from '../core/Camera';
import type { World } from '../world/World';
import { cutoutMat, paintPaper, paperMat, rng } from '../world/PaperTexture';
import { createConeTree, createFox, createStar, flat } from '../world/Origami';
import type { DialogLine } from '../ui/Dialog';
import type { Interactable, LevelHost } from './ForestLevel';
import type { Level } from './Level';
import type { CardInfo } from '../ui/ResultCard';

/** 1 game unit = 1 m for the 50 m prototype sample. Data is in decimetres. */
const S = 1.0;
const Q = S / 10;
const VIADUCT_Y0 = 6.6 * S, VIADUCT_Y1 = 7.6 * S;
const STATION_H = 6.4 * S;

interface Tri { v: number[]; i: number[] }
interface Spot { x: number; z: number; label: string }
export interface KoiwaData {
  radius: number;
  buildings: number[][];
  roads: Tri; water: Tri; viaductDeck: Tri; platforms: Tri;
  areas: Record<string, Tri>;
  railViaduct: number[][]; railGround: number[][]; centerlines: number[][];
  station: number[];
  spots: Record<string, Spot>;
  labels: { name: string; x: number; z: number }[];
  credits: string[];
  stats: { buildings: number };
}

const WALL_COLORS = ['#fbe3d3', '#fde9c9', '#f6d6e2', '#dcefe0', '#e3defa', '#d8e8f8', '#fff3dc', '#f3e0f4', '#e9f3d4', '#fde2cf'];
const TALL_COLORS = ['#e7e3fb', '#dde9fb', '#f1ecff', '#e5f0f7', '#f6e9f3'];

function hex(c: string) { return Color3.FromHexString(c); }

/** 「そらちゃんと こいわの まち」: Koiwa Station north exit, 1 km radius, built from PLATEAU + OSM. */
export class KoiwaLevel implements Level {
  id = 'koiwa' as const;
  starTotal = 3;
  start: Vector3;
  introToast = 'えきまえの コンに はなしかけて みよう！';
  clearTitle = 'こいわ たんけん クリア！';
  clearText = 'こいわえき きたぐちの ほしが ぜんぶ そろったよ。<br/>コンも にっこり。ありがとう、そらちゃん！';
  col = new CollisionWorld();
  poly: PolyCollider;
  stars: { mesh: Mesh; base: Vector3; got: boolean; label: string; beacon: Mesh }[] = [];
  interactables: Interactable[] = [];
  questStage = 0; // 0 talk to Kon, 1 collect, 2 back to Kon
  cleared = false;
  buildingCount = 0;
  private chunks: { mesh: Mesh; x: number; z: number }[] = [];
  private fox!: ReturnType<typeof createFox>;
  private foxPos!: Vector3;
  private marker!: Mesh;
  private markerTex!: DynamicTexture;
  private arrow!: TransformNode;
  private train?: { cars: TransformNode[]; path: { x: number; z: number; s: number }[]; len: number; s: number; dir: number; wait: number; stopS: number; stopped: boolean };
  private t = 0;
  private cullT = 0;
  /** recorded route of the bunny (metres) for the clear card */
  path: number[] = [];
  private pathT = 0;

  static async create(scene: Scene, world: World, host: LevelHost, camera?: CameraController) {
    const url = `${import.meta.env.BASE_URL}data/koiwa.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('koiwa data ' + res.status);
    const data = (await res.json()) as KoiwaData;
    return new KoiwaLevel(scene, world, host, data, camera);
  }

  constructor(private scene: Scene, private world: World, private host: LevelHost, private d: KoiwaData, camera?: CameraController) {
    const R = d.radius * S;
    this.poly = new PolyCollider(6, R - 1);
    this.col.extras.push(this.poly);
    this.col.bounds = { minX: -R - 5, maxX: R + 5, minZ: -R - 5, maxZ: R + 5 };
    this.col.addSurface({ id: 'ground-city', minX: -R - 40, maxX: R + 40, minZ: -R - 40, maxZ: R + 40, top: 0 });
    const sp = d.spots.start;
    this.start = new Vector3(sp.x * S, 0, sp.z * S);

    // city atmosphere: softer, longer fog so streets fade into paper haze
    scene.fogStart = 45; scene.fogEnd = 130;
    scene.fogColor = new Color3(0.9, 0.87, 0.97);
    scene.clearColor = new Color4(0.86, 0.85, 0.98, 1);
    if (camera) { camera.cam.maxZ = 260; camera.dist = 10; camera.pitch = 0.26; camera.yaw = 2.3; camera.clip = (a, b) => this.poly.clearFraction(a.x, a.y, a.z, b.x, b.y, b.z); }
    world.sun.direction = new Vector3(-0.35, -1, 0.45);

    this.buildGround(R);
    this.buildBuildings();
    this.buildStation();
    this.buildRail();
    this.buildTrees();
    this.buildSigns();
    this.buildSkytree();
    this.buildStars();
    this.buildFox();
    this.buildArrow();
    this.updateCulling(this.start.x, this.start.z);
  }

  get starCount() { return this.stars.filter((s) => s.got).length; }

  questText() {
    if (this.cleared) return 'クリア！';
    if (this.questStage === 0) return 'えきまえの コンに はなしかけよう';
    if (this.questStage === 2) return 'コンの ところへ もどろう！（きたぐち）';
    const n = this.nearestStar();
    return `ほしを あつめよう（あと ${this.starTotal - this.starCount}こ）${n ? '・ちかく：' + n.label : ''}`;
  }

  private lastP = new Vector3();
  private nearestStar(p = this.lastP) {
    let best: (typeof this.stars)[number] | null = null, bd = Infinity;
    for (const s of this.stars) {
      if (s.got) continue;
      const dd = Math.hypot(s.base.x - p.x, s.base.z - p.z);
      if (dd < bd) { bd = dd; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------------ helpers
  private flatMesh(name: string, tri: Tri, y: number, mat: StandardMaterial, uvScale = 0.25) {
    if (!tri.i.length) return null;
    const n = tri.v.length / 2;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const x = tri.v[k * 2] * Q, z = tri.v[k * 2 + 1] * Q;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      nor[k * 3 + 1] = 1;
      uv[k * 2] = x * uvScale; uv[k * 2 + 1] = z * uvScale;
    }
    const m = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = tri.i.length > 65535 ? new Uint32Array(tri.i) : tri.i;
    vd.applyToMesh(m);
    m.material = mat;
    m.isPickable = false;
    m.freezeWorldMatrix();
    return m;
  }

  /** Extrude a triangulated footprint between y0 and y1 (top + side walls from boundary edges). */
  private extrude(name: string, tri: Tri, y0: number, y1: number, mat: StandardMaterial, opts: { bottom?: boolean; wallV?: number } = {}) {
    const n = tri.v.length / 2;
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    for (let k = 0; k < n; k++) { const x = tri.v[k * 2] * Q, z = tri.v[k * 2 + 1] * Q; P.push(x, y1, z); N.push(0, 1, 0); U.push(x * 0.2, z * 0.2); }
    I.push(...tri.i);
    if (opts.bottom) {
      const b = P.length / 3;
      for (let k = 0; k < n; k++) { P.push(tri.v[k * 2] * Q, y0, tri.v[k * 2 + 1] * Q); N.push(0, -1, 0); U.push(0, 0); }
      for (const i of tri.i) I.push(i + b);
    }
    // boundary edges = edges used by exactly one triangle (keep direction)
    const edges = new Map<string, [number, number]>();
    const V = tri.v;
    for (let t = 0; t < tri.i.length; t += 3) {
      const i0 = tri.i[t], i1 = tri.i[t + 1], i2 = tri.i[t + 2];
      const cr = (V[i1 * 2] - V[i0 * 2]) * (V[i2 * 2 + 1] - V[i0 * 2 + 1]) - (V[i1 * 2 + 1] - V[i0 * 2 + 1]) * (V[i2 * 2] - V[i0 * 2]);
      const tr = cr >= 0 ? [i0, i1, i2] : [i0, i2, i1]; // force CCW so boundary edges run CCW → outward normals
      for (let e = 0; e < 3; e++) {
        const a = tr[e], b = tr[(e + 1) % 3];
        const k = a < b ? a + ',' + b : b + ',' + a;
        if (edges.has(k)) edges.delete(k); else edges.set(k, [a, b]);
      }
    }
    for (const [a, b] of edges.values()) {
      const ax = tri.v[a * 2] * Q, az = tri.v[a * 2 + 1] * Q, bx = tri.v[b * 2] * Q, bz = tri.v[b * 2 + 1] * Q;
      let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const base = P.length / 3, len = Math.hypot(bx - ax, bz - az) * 0.25, vv = opts.wallV ?? 1;
      P.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      for (let q = 0; q < 4; q++) N.push(nx, 0, nz);
      U.push(0, 0, len, 0, len, vv, 0, vv);
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const m = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = P; vd.normals = N; vd.uvs = U; vd.indices = I;
    vd.applyToMesh(m);
    m.material = mat; m.isPickable = false; m.freezeWorldMatrix();
    return m;
  }

  /** Thin flat ribbon strips along polylines (paint lines, rails). */
  private ribbons(name: string, lines: number[][], y: number, width: number, mat: StandardMaterial, offset = 0, dash = 0) {
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    for (const ln of lines) {
      for (let k = 0; k + 3 < ln.length; k += 2) {
        let ax = ln[k] * Q, az = ln[k + 1] * Q, bx = ln[k + 2] * Q, bz = ln[k + 3] * Q;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 1e-3) continue;
        const ux = dx / L, uz = dz / L, px = -uz, pz = ux;
        ax += px * offset; az += pz * offset; bx += px * offset; bz += pz * offset;
        const segs: [number, number][] = dash > 0 ? [] : [[0, L]];
        if (dash > 0) for (let s = 0; s < L; s += dash * 2) segs.push([s, Math.min(L, s + dash)]);
        for (const [s0, s1] of segs) {
          const x0 = ax + ux * s0, z0 = az + uz * s0, x1 = ax + ux * s1, z1 = az + uz * s1, w = width / 2;
          const b = P.length / 3;
          P.push(x0 - px * w, y, z0 - pz * w, x0 + px * w, y, z0 + pz * w, x1 + px * w, y, z1 + pz * w, x1 - px * w, y, z1 - pz * w);
          N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          U.push(0, 0, 1, 0, 1, (s1 - s0) * 0.5, 0, (s1 - s0) * 0.5);
          I.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
    }
    if (!I.length) return null;
    const m = new Mesh(name, this.scene);
    const vd = new VertexData(); vd.positions = P; vd.normals = N; vd.uvs = U; vd.indices = I; vd.applyToMesh(m);
    m.material = mat; m.isPickable = false; m.freezeWorldMatrix();
    return m;
  }

  private mat(key: string, base: string, o: Parameters<typeof paperMat>[3] = {}) {
    const m = paperMat(this.scene, 'koiwa-' + key, base, o);
    m.backFaceCulling = false;
    return m;
  }

  // ------------------------------------------------------------------ build
  private buildGround(R: number) {
    const scene = this.scene;
    // diorama board: stacked paper discs
    const top = CreateDisc('cityBoard', { radius: R + 24, tessellation: 96 }, scene);
    top.rotation.x = Math.PI / 2;
    const gm = this.mat('ground', '#f5eedf', { size: 512, creases: 4, seed: 61, tints: ['rgba(255,255,255,0.4)', 'rgba(200,190,240,0.18)', 'rgba(250,210,190,0.15)'], blotches: 18 });
    (gm.diffuseTexture as Texture).uScale = (gm.diffuseTexture as Texture).vScale = 8;
    top.material = gm; top.receiveShadows = true; top.isPickable = false; top.freezeWorldMatrix();
    const edge = CreateCylinder('cityEdge', { diameter: (R + 24) * 2, height: 1.2, tessellation: 96 }, scene);
    edge.material = paperMat(scene, 'layer2', '#d9cff5', { seed: 5 });
    edge.position.y = -0.62; edge.isPickable = false; edge.freezeWorldMatrix();

    const road = this.mat('road', '#cfd0e4', { size: 256, creases: 2, seed: 62, tints: ['rgba(255,255,255,0.25)', 'rgba(160,150,220,0.15)'] });
    const rm = this.flatMesh('roads', this.d.roads, 0.02, road, 0.12);
    if (rm) rm.receiveShadows = true;
    const AREA: Record<string, [string, number]> = { park: ['#bfe6c8', 0.035], pitch: ['#cdebb5', 0.04], school: ['#f6e4cf', 0.03], temple: ['#f1d9e6', 0.03] };
    for (const [k, tri] of Object.entries(this.d.areas)) {
      if (k === 'water' || !AREA[k]) continue;
      const am = this.flatMesh('area-' + k, tri, AREA[k][1], this.mat('area-' + k, AREA[k][0], { seed: 63, creases: 3 }), 0.1);
      if (am) am.receiveShadows = true;
    }
    const wm = this.mat('water', '#a9c6f2', { seed: 64, creases: 1, emissive: 0.25, tints: ['rgba(255,255,255,0.35)', 'rgba(120,150,230,0.2)'] });
    this.flatMesh('water', this.d.water, 0.045, wm, 0.08);
    // dashed centre lines on the big streets
    const paint = this.mat('paint', '#ffffff', { seed: 65, emissive: 0.35 });
    this.ribbons('centerlines', this.d.centerlines, 0.06, 0.18, paint, 0, 1.6);
  }

  private buildBuildings() {
    const scene = this.scene;
    // facade paper: one floor (3 m) × 4 m bay with two little windows and a crease at the floor line
    const fac = new DynamicTexture('facadeTex', { width: 128, height: 128 }, scene, true);
    const c = fac.getContext() as unknown as CanvasRenderingContext2D;
    paintPaper(c, 128, 128, '#ffffff', { seed: 70, grain: 10, tints: ['rgba(255,255,255,0.3)'] });
    c.fillStyle = 'rgba(110,120,190,0.30)';
    c.fillRect(14, 30, 38, 46); c.fillRect(76, 30, 38, 46);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(14, 30, 38, 6); c.fillRect(76, 30, 38, 6);
    c.fillStyle = 'rgba(90,70,140,0.18)'; c.fillRect(0, 124, 128, 4);
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(0, 120, 128, 3);
    fac.update();
    fac.wrapU = fac.wrapV = Texture.WRAP_ADDRESSMODE;
    fac.anisotropicFilteringLevel = 4;
    const wallMat = new StandardMaterial('cityWall', scene);
    wallMat.diffuseTexture = fac;
    wallMat.specularColor = new Color3(0.03, 0.03, 0.04);
    wallMat.emissiveColor = new Color3(0.16, 0.16, 0.17);
    wallMat.backFaceCulling = false;
    const roofMat = this.mat('roof', '#ffffff', { size: 256, creases: 3, seed: 71, tints: ['rgba(255,255,255,0.3)', 'rgba(170,160,230,0.12)'] });
    roofMat.emissiveColor = new Color3(0.2, 0.2, 0.21);

    const CELL = 55;
    type Acc = { P: number[]; N: number[]; U: number[]; C: number[]; I: number[]; RP: number[]; RN: number[]; RU: number[]; RC: number[]; RI: number[]; sx: number; sz: number; n: number };
    const cells = new Map<string, Acc>();
    const r = rng(2026);
    for (const b of this.d.buildings) {
      const hM = Math.max(3.4, b[0] / 10);
      const h = hM * S;
      const n = b[1];
      const pts: number[] = new Array(n * 2);
      let cx = 0, cz = 0;
      for (let k = 0; k < n; k++) { pts[k * 2] = b[2 + k * 2] * Q; pts[k * 2 + 1] = b[3 + k * 2] * Q; cx += pts[k * 2]; cz += pts[k * 2 + 1]; }
      cx /= n; cz /= n;
      const nt = b[2 + n * 2];
      const idx = b.slice(3 + n * 2, 3 + n * 2 + nt);
      this.poly.add(pts, h);
      const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
      let a = cells.get(key);
      if (!a) cells.set(key, (a = { P: [], N: [], U: [], C: [], I: [], RP: [], RN: [], RU: [], RC: [], RI: [], sx: 0, sz: 0, n: 0 }));
      a.sx += cx; a.sz += cz; a.n++;
      const pal = hM > 18 ? TALL_COLORS : WALL_COLORS;
      const col = hex(pal[Math.floor(r() * pal.length)]);
      const shade = 0.96 + r() * 0.06;
      const roofCol = Color3.Lerp(col, Color3.White(), 0.45);
      // walls
      let u = r() * 4;
      const vTop = hM / 3;
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2], az = pts[k * 2 + 1], bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-4) continue;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        const base = a.P.length / 3;
        a.P.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
        for (let q = 0; q < 4; q++) a.N.push(nx, 0, nz);
        const u1 = u + L / (4 * S);
        a.U.push(u, 0, u1, 0, u1, vTop, u, vTop);
        u = u1;
        // alternate faces a touch darker → reads like folded paper facets
        const f = (k % 2 ? 0.93 : 1) * shade;
        for (let q = 0; q < 4; q++) a.C.push(col.r * f, col.g * f, col.b * f, 1);
        a.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // roof
      const rb = a.RP.length / 3;
      for (let k = 0; k < n; k++) {
        a.RP.push(pts[k * 2], h, pts[k * 2 + 1]); a.RN.push(0, 1, 0);
        a.RU.push(pts[k * 2] * 0.18, pts[k * 2 + 1] * 0.18);
        a.RC.push(roofCol.r, roofCol.g, roofCol.b, 1);
      }
      for (const i of idx) a.RI.push(i + rb);
      this.buildingCount++;
    }
    for (const [key, a] of cells) {
      const mk = (name: string, P: number[], N: number[], U: number[], C: number[], I: number[], mat: StandardMaterial) => {
        const m = new Mesh(name, scene);
        const vd = new VertexData();
        vd.positions = P; vd.normals = N; vd.uvs = U; vd.colors = C;
        vd.indices = P.length / 3 > 65535 ? new Uint32Array(I) : I;
        vd.applyToMesh(m);
        m.material = mat; m.isPickable = false; m.freezeWorldMatrix();
        m.doNotSyncBoundingInfo = true;
        this.chunks.push({ mesh: m, x: a.sx / a.n, z: a.sz / a.n });
        return m;
      };
      mk('bw' + key, a.P, a.N, a.U, a.C, a.I, wallMat);
      mk('br' + key, a.RP, a.RN, a.RU, a.RC, a.RI, roofMat);
    }
  }

  private signTexture(name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, emissive = 0.55) {
    const t = new DynamicTexture(name, { width: w, height: h }, this.scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    draw(c);
    t.update();
    const m = new StandardMaterial(name + 'Mat', this.scene);
    m.diffuseTexture = t; m.emissiveColor = new Color3(emissive, emissive, emissive);
    m.specularColor = new Color3(0, 0, 0); m.backFaceCulling = false;
    return m;
  }

  private buildStation() {
    const st = this.d.station;
    const n = st.length / 2;
    const pts = st.map((v) => v * Q);
    this.poly.add(pts, STATION_H);
    // simple fan-free triangulation: reuse the extruder via ear clipping in JS
    const idx = earClip(pts);
    const tri: Tri = { v: st, i: idx };
    const wall = this.mat('station', '#fff4dc', { seed: 80, grid: [6, 2], tints: ['rgba(255,255,255,0.35)', 'rgba(244,184,207,0.18)'] });
    this.extrude('station', tri, 0, STATION_H, wall, { wallV: 2 });
    // big 小岩駅 sign over the north exit, facing out (north-west)
    let best = 0, bd = Infinity;
    for (let k = 0; k < n; k++) { const dd = Math.hypot(pts[k * 2], pts[k * 2 + 1]); if (dd < bd) { bd = dd; best = k; } }
    // edge from the previous vertex to the nearest vertex (the long NW face)
    const pv = (best - 1 + n) % n;
    const ax = pts[pv * 2], az = pts[pv * 2 + 1], bx = pts[best * 2], bz = pts[best * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    const t = Math.max(0, 1 - 22 * S / L);
    const sx = ax + (bx - ax) * t + nx * 0.12, sz = az + (bz - az) * t + nz * 0.12;
    const sm = this.signTexture('stationSign', 512, 160, (c) => {
      c.fillStyle = '#fbf8f2'; c.fillRect(0, 0, 512, 160);
      c.fillStyle = '#7fbf6a'; c.fillRect(0, 0, 512, 22); c.fillRect(0, 138, 512, 22); // JR green stripes
      c.fillStyle = '#4a3f6b'; c.font = 'bold 84px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('小岩駅', 256, 72);
      c.font = 'bold 22px sans-serif'; c.fillStyle = '#8f86c1'; c.fillText('KOIWA  ・  きたぐち', 256, 122);
    }, 0.6);
    const sign = CreatePlane('stationSign', { width: 9, height: 2.8 }, this.scene);
    sign.material = sm;
    sign.position.set(sx, STATION_H - 1.6, sz);
    sign.rotation.y = Math.atan2(-nx, -nz);
    sign.isPickable = false;
    // little paper awning at the exit
    const aw = flat(CreateBox('awning', { width: 5, height: 0.12, depth: 1.6 }, this.scene), this.mat('awning', '#f4b8cf', { seed: 81, grid: [5, 1] }));
    aw.position.set(sx + nx * 0.8, 2.3, sz + nz * 0.8);
    aw.rotation.y = Math.atan2(nx, nz);
    this.world.receive(aw);
  }

  private buildRail() {
    const scene = this.scene;
    const deckMat = this.mat('deck', '#e6e1f4', { seed: 90, grid: [4, 1], tints: ['rgba(255,255,255,0.35)', 'rgba(150,140,220,0.18)'] });
    this.extrude('viaduct', this.d.viaductDeck, VIADUCT_Y0, VIADUCT_Y1, deckMat, { bottom: true });
    const pm = this.mat('platform', '#fff1c7', { seed: 91, grid: [1, 6] });
    if (this.d.platforms.i.length) {
      this.extrude('platform', this.d.platforms, VIADUCT_Y1, VIADUCT_Y1 + 0.55, pm);
      const roof = this.mat('canopy', '#c9bff0', { seed: 92, grid: [8, 1] });
      this.extrude('canopy', this.d.platforms, VIADUCT_Y1 + 2.0, VIADUCT_Y1 + 2.15, roof, { bottom: true });
    }
    // ballast + rails on top of the viaduct, and at grade for the freight line
    const ballast = this.mat('ballast', '#cbbfd8', { seed: 93, creases: 1 });
    const railM = this.mat('rails', '#7d6fb5', { seed: 94, emissive: 0.05 });
    const K = S * 2;
    this.ribbons('ballastV', this.d.railViaduct, VIADUCT_Y1 + 0.02, 1.5 * K, ballast);
    for (const o of [-0.28 * K, 0.28 * K]) this.ribbons('railV' + o, this.d.railViaduct, VIADUCT_Y1 + 0.05, 0.08 * K, railM, o);
    this.ribbons('ballastG', this.d.railGround, 0.05, 1.5 * K, ballast);
    for (const o of [-0.28 * K, 0.28 * K]) this.ribbons('railG' + o, this.d.railGround, 0.08, 0.08 * K, railM, o);

    // pillars every ~16 m under the viaduct (deduped across parallel tracks)
    const pillars: [number, number][] = [];
    for (const ln of this.d.railViaduct) {
      let acc = 8;
      for (let k = 0; k + 3 < ln.length; k += 2) {
        const ax = ln[k] * Q, az = ln[k + 1] * Q, bx = ln[k + 2] * Q, bz = ln[k + 3] * Q;
        const L = Math.hypot(bx - ax, bz - az);
        while (acc < L) {
          const x = ax + ((bx - ax) * acc) / L, z = az + ((bz - az) * acc) / L;
          if (!pillars.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.2)) pillars.push([x, z]);
          acc += 8;
        }
        acc -= L;
      }
    }
    const pillar = CreateBox('pillar', { width: 0.8, depth: 0.8, height: VIADUCT_Y0 }, scene);
    pillar.material = this.mat('pillar', '#d9d2f0', { seed: 95, creases: 1 });
    pillar.position.y = VIADUCT_Y0 / 2;
    pillar.bakeCurrentTransformIntoVertices();
    const buf = new Float32Array(pillars.length * 16);
    pillars.forEach(([x, z], k) => {
      Matrix.Translation(x, 0, z).copyToArray(buf, k * 16);
      this.poly.add([x - 0.4, z - 0.4, x + 0.4, z - 0.4, x + 0.4, z + 0.4, x - 0.4, z + 0.4], VIADUCT_Y1);
    });
    pillar.thinInstanceSetBuffer('matrix', buf, 16, true);
    pillar.isPickable = false;
    // (the 1 km version had a shuttling train; the 50 m sample keeps a parked one at the platform)
    this.buildTrain();
  }

  /** A little yellow-striped paper train (Sobu local line) shuttling along the viaduct. */
  private buildTrain() {
    const lines = this.d.railViaduct.map((ln) => {
      let L = 0; for (let k = 0; k + 3 < ln.length; k += 2) L += Math.hypot(ln[k + 2] - ln[k], ln[k + 3] - ln[k + 1]);
      return { ln, L };
    }).sort((a, b) => b.L - a.L);
    if (!lines.length) return;
    const ln = lines[0].ln;
    const path: { x: number; z: number; s: number }[] = [];
    let s = 0;
    for (let k = 0; k + 1 < ln.length; k += 2) {
      const x = ln[k] * Q, z = ln[k + 1] * Q;
      if (path.length) s += Math.hypot(x - path[path.length - 1].x, z - path[path.length - 1].z);
      path.push({ x, z, s });
    }
    const body = this.signTexture('trainTex', 256, 128, (c) => {
      paintPaper(c, 256, 128, '#f4f3fa', { seed: 96, grain: 8 });
      c.fillStyle = '#ffd23f'; c.fillRect(0, 74, 256, 18);             // yellow band
      c.fillStyle = 'rgba(90,110,170,0.55)';
      for (let x = 14; x < 256; x += 48) c.fillRect(x, 22, 30, 40);       // windows
      c.fillStyle = 'rgba(120,110,170,0.35)'; c.fillRect(0, 120, 256, 8);
    }, 0.35);
    const roofM = this.mat('trainRoof', '#d8d6e6', { seed: 97 });
    const cars: TransformNode[] = [];
    for (let i = 0; i < 4; i++) {
      const node = new TransformNode('car' + i, this.scene);
      node.scaling.setAll(2 * S);
      const b = CreateBox('carBody' + i, { width: 1.45, height: 1.7, depth: 9.6 }, this.scene);
      b.material = body; b.position.y = 0.95; b.parent = node;
      const rf = flat(CreateBox('carRoof' + i, { width: 1.3, height: 0.12, depth: 9.4 }, this.scene), roofM);
      rf.position.y = 1.86; rf.parent = node;
      cars.push(node);
    }
    // stop where the line passes the station platforms (nearest point to the origin)
    // platform centre ≈ centroid of the platform footprint
    const pv = this.d.platforms.v;
    let mx = 0, mz = 0; for (let k = 0; k < pv.length; k += 2) { mx += pv[k] * Q; mz += pv[k + 1] * Q; }
    mx /= Math.max(1, pv.length / 2); mz /= Math.max(1, pv.length / 2);
    let midS = path[0].s, bd = Infinity;
    for (let k = 0; k + 1 < path.length; k++) {
      for (let f = 0; f <= 1; f += 0.1) {
        const x = path[k].x + (path[k + 1].x - path[k].x) * f, z = path[k].z + (path[k + 1].z - path[k].z) * f;
        const dd = Math.hypot(x - mx, z - mz);
        if (dd < bd) { bd = dd; midS = path[k].s + (path[k + 1].s - path[k].s) * f; }
      }
    }
    this.train = { cars, path, len: s, s: midS + 30 * S, dir: 1, wait: 1e9, stopS: midS, stopped: true };
    this.placeTrain();
  }

  private trainAt(s: number) {
    const tr = this.train!;
    s = Math.max(0, Math.min(tr.len, s));
    const p = tr.path;
    let k = 0;
    while (k < p.length - 2 && p[k + 1].s < s) k++;
    const a = p[k], b = p[k + 1];
    const f = (s - a.s) / Math.max(1e-4, b.s - a.s);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }

  private placeTrain() {
    const tr = this.train!;
    tr.cars.forEach((c, i) => {
      const q = this.trainAt(tr.s - i * 20 * S * tr.dir);
      c.position.set(q.x, VIADUCT_Y1 + 0.08, q.z);
      c.rotation.y = q.yaw;
    });
  }

  private updateTrain(dt: number) {
    const tr = this.train;
    if (!tr) return;
    if (tr.wait > 0) { tr.wait -= dt; return; }
    const v = 9; // units/s
    const prev = tr.s;
    tr.s += tr.dir * v * dt;
    const stopAt = tr.stopS + 25 * tr.dir; // head position that centres the 6 cars on the platform
    if (!tr.stopped && (prev - stopAt) * (tr.s - stopAt) <= 0) { tr.s = stopAt; tr.stopped = true; tr.wait = 5; }
    const tail = 60;
    if (tr.s > tr.len + tail) { tr.dir = -1; tr.s = tr.len + tail; tr.wait = 3; tr.stopped = false; }
    if (tr.s < -tail) { tr.dir = 1; tr.s = -tail; tr.wait = 3; tr.stopped = false; }
    this.placeTrain();
  }

  private buildTrees() {
    // paper trees scattered in parks (and a few street trees on the big roads)
    const park = this.d.areas.park;
    if (!park || !park.i.length) return;
    const r = rng(31);
    const tris: { a: number[]; area: number }[] = [];
    let total = 0;
    for (let k = 0; k < park.i.length; k += 3) {
      const a = [0, 1, 2].map((j) => park.i[k + j]);
      const [x0, z0, x1, z1, x2, z2] = a.flatMap((i) => [park.v[i * 2] * Q, park.v[i * 2 + 1] * Q]);
      const area = Math.abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2;
      total += area; tris.push({ a, area });
    }
    const count = Math.min(420, Math.floor(total / 14));
    const proto = createConeTree(this.scene, 'parkTree', 2.4, 5);
    const ms = proto.getChildMeshes() as Mesh[];
    const mats: Matrix[] = [];
    for (let n = 0; n < count; n++) {
      let pick = r() * total, tt = tris[0];
      for (const t of tris) { pick -= t.area; if (pick <= 0) { tt = t; break; } }
      let u = r(), w = r(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const [x0, z0, x1, z1, x2, z2] = tt.a.flatMap((i) => [park.v[i * 2] * Q, park.v[i * 2 + 1] * Q]);
      const x = x0 + (x1 - x0) * u + (x2 - x0) * w, z = z0 + (z1 - z0) * u + (z2 - z0) * w;
      if (this.poly.blocked(x, z, 0.6)) continue;
      const sc = 0.7 + r() * 0.6;
      mats.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.RotationYawPitchRoll(r() * 6, 0, 0), new Vector3(x, 0, z)));
      this.poly.add([x - 0.25, z - 0.25, x + 0.25, z - 0.25, x + 0.25, z + 0.25, x - 0.25, z + 0.25]);
    }
    for (const m of ms) {
      m.computeWorldMatrix(true);
      const local = m.getWorldMatrix().clone();
      m.parent = null;
      const buf = new Float32Array(mats.length * 16);
      mats.forEach((mm, k) => local.multiply(mm).copyToArray(buf, k * 16));
      m.position.setAll(0); m.rotation.setAll(0); m.scaling.setAll(1); m.rotationQuaternion = null;
      m.thinInstanceSetBuffer('matrix', buf, 16, true);
      m.isPickable = false;
    }
    proto.dispose(true);
  }

  private buildSigns() {
    // hanging shopping-street banners / street name boards
    for (const lb of this.d.labels) {
      const name = lb.name;
      const w = Math.min(9, 1.2 + name.length * 0.62);
      const m = this.signTexture('lbl' + name, 512, 96, (c) => {
        c.fillStyle = '#fbf8f2'; c.fillRect(0, 0, 512, 96);
        c.fillStyle = '#f4b8cf'; c.fillRect(0, 0, 512, 10); c.fillRect(0, 86, 512, 10);
        c.fillStyle = '#5b4c94'; c.textAlign = 'center'; c.textBaseline = 'middle';
        let fs = 54; c.font = `bold ${fs}px sans-serif`;
        while (c.measureText(name).width > 490 && fs > 20) { fs -= 2; c.font = `bold ${fs}px sans-serif`; }
        c.fillText(name, 256, 50);
      });
      const p = CreatePlane('lbl-' + name, { width: w, height: w * 96 / 512 }, this.scene);
      p.material = m;
      p.position.set(lb.x * S, 4.2, lb.z * S);
      p.billboardMode = Mesh.BILLBOARDMODE_Y;
      p.isPickable = false;
    }
    // place-name cards at each star spot
    for (const k of this.starKeys()) {
      const s = this.d.spots[k];
      const m = this.signTexture('spot' + k, 384, 96, (c) => {
        c.fillStyle = '#fff6d6'; c.fillRect(0, 0, 384, 96);
        c.fillStyle = '#e8a93a'; c.textAlign = 'center'; c.textBaseline = 'middle';
        let fs = 40; c.font = `bold ${fs}px sans-serif`;
        while (c.measureText('★ ' + s.label).width > 360 && fs > 16) { fs -= 2; c.font = `bold ${fs}px sans-serif`; }
        c.fillText('★ ' + s.label, 192, 50);
      }, 0.5);
      const p = CreatePlane('spotSign' + k, { width: 4, height: 1 }, this.scene);
      p.material = m; p.position.set(s.x * S, 2.6, s.z * S); p.billboardMode = Mesh.BILLBOARDMODE_Y; p.isPickable = false;
    }
  }

  /** Tokyo Skytree silhouette on the horizon (it really is ~6.9 km WSW of Koiwa). */
  private buildSkytree() {
    const m = cutoutMat(this.scene, 'skytree', '#bdb3ea', 128, 512, (c) => {
      c.beginPath();
      c.moveTo(40, 512); c.lineTo(58, 120); c.lineTo(52, 118); c.lineTo(52, 100); c.lineTo(76, 100); c.lineTo(76, 118);
      c.lineTo(70, 120); c.lineTo(88, 512); c.closePath(); c.fill();
      c.fillRect(46, 170, 36, 14); c.fillRect(50, 240, 28, 12); c.fillRect(62, 0, 4, 100);
    }, { seed: 98 });
    m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); m.fogEnabled = false;
    const p = CreatePlane('skytree', { width: 9, height: 36 }, this.scene);
    p.material = m;
    const ang = Math.atan2(-6390, -2560); // direction from Koiwa to Skytree (x east, z north)
    p.parent = this.world.backdrop;
    p.position.set(Math.sin(ang) * 88, 15, Math.cos(ang) * 88 + 10);
    p.rotation.y = ang;
    p.isPickable = false;
  }

  private buildStars() {
    const mat = paperMat(this.scene, 'star', '#ffd86b', { seed: 40, emissive: 0.4, tints: ['rgba(255,255,255,0.5)', 'rgba(255,170,120,0.25)'] });
    const beamMat = new StandardMaterial('beam', this.scene);
    beamMat.diffuseColor = new Color3(1, 0.92, 0.55);
    beamMat.emissiveColor = new Color3(1, 0.88, 0.5);
    beamMat.alpha = 0.38; beamMat.disableLighting = true; beamMat.fogEnabled = false; beamMat.backFaceCulling = false;
    this.starKeys().forEach((k, i) => {
      const sp = this.d.spots[k];
      const p = new Vector3(sp.x * S, 0, sp.z * S);
      const s = createStar(this.scene, 'kstar' + i, mat, 0.42, 0.16);
      s.position.copyFrom(p).addInPlaceFromFloats(0, 0.95, 0);
      const beam = CreateCylinder('beam' + i, { height: 40, diameterTop: 0.25, diameterBottom: 0.7, tessellation: 6 }, this.scene);
      beam.material = beamMat; beam.position.set(p.x, 21, p.z); beam.isPickable = false;
      this.stars.push({ mesh: s, base: p, got: false, label: sp.label, beacon: beam });
    });
  }

  private starKeys() { return Object.keys(this.d.spots).filter((k) => /^star\d+$/.test(k)).sort(); }

  private buildFox() {
    const sp = this.d.spots.npc;
    const pos = new Vector3(sp.x * S, 0, sp.z * S);
    this.foxPos = pos;
    const fox = createFox(this.scene, 'kon');
    fox.root.position.copyFrom(pos);
    this.fox = fox;
    this.col.addBlocker({ kind: 'circle', id: 'fox', x: pos.x, z: pos.z, r: 0.65, top: 2 });
    const tex = new DynamicTexture('markerTex', { width: 128, height: 128 }, this.scene, true);
    tex.hasAlpha = true;
    const marker = CreatePlane('marker', { size: 0.8 }, this.scene);
    const mm = new StandardMaterial('markerMat', this.scene);
    mm.diffuseTexture = tex; mm.useAlphaFromDiffuseTexture = true; mm.transparencyMode = 1; mm.disableLighting = true; mm.emissiveColor = Color3.White();
    marker.material = mm; marker.billboardMode = Mesh.BILLBOARDMODE_ALL;
    marker.position.set(pos.x, 2.3, pos.z);
    this.marker = marker; this.markerTex = tex;
    this.drawMarker('！', '#f08a5d');
    this.interactables.push({ id: 'fox', pos, radius: 2.5, label: 'コンと はなす', action: () => this.talkFox() });
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

  /** Paper arrow that floats over そらちゃん and points to the next goal. */
  private buildArrow() {
    const m = cutoutMat(this.scene, 'guideArrow', '#ffcf5a', 128, 128, (c) => {
      c.beginPath(); c.moveTo(64, 4); c.lineTo(118, 64); c.lineTo(84, 64); c.lineTo(84, 124); c.lineTo(44, 124); c.lineTo(44, 64); c.lineTo(10, 64); c.closePath(); c.fill();
    }, { seed: 99, tints: ['rgba(255,255,255,0.4)', 'rgba(240,140,90,0.2)'] });
    m.emissiveColor = new Color3(0.6, 0.55, 0.4);
    const node = new TransformNode('arrowNode', this.scene);
    const p = CreatePlane('guideArrowPlane', { size: 1.1 }, this.scene);
    p.material = m;
    p.rotation.x = Math.PI / 2; // lie flat; texture "up" points along +z
    p.parent = node;
    p.isPickable = false;
    this.arrow = node;
  }

  // ------------------------------------------------------------------ story
  talkFox() {
    const left = this.starTotal - this.starCount;
    if (this.questStage === 0) {
      this.questStage = 1;
      this.drawMarker('★', '#e8a93a');
      this.host.dialog([
        { who: 'コン', text: 'あっ、そらちゃん！ ここは こいわえきの きたぐちだよ。' },
        { who: 'コン', text: `でんしゃを おりたら、かばんの ほしが ${this.starTotal}こ えきまえに とんで いっちゃった…` },
        { who: 'そらちゃん', text: 'まかせて！ えきまえを たんけんして さがしてくるね！' },
        { who: 'コン', text: 'ひかる はしらが めじるしだよ。あたまの うえの きいろい やじるしも みてね！' },
      ], () => { this.host.toast('きいろい やじるしの ほうへ いこう！', 2200); this.host.onProgress(); });
    } else if (this.questStage === 1) {
      const n = this.nearestStar();
      this.host.dialog([
        { who: 'コン', text: `ほしは あと ${left}こ だよ。` },
        { who: 'コン', text: n ? `いちばん ちかいのは「${n.label}」の あたりかな。` : 'がんばって！' },
      ]);
    } else if (this.questStage === 2) {
      this.drawMarker('♪', '#7a69d4');
      this.host.dialog([
        { who: 'コン', text: `わあ！ ほしが ${this.starTotal}こ そろったね！ ありがとう、そらちゃん！` },
        { who: 'そらちゃん', text: 'えきの かんばんも、イトーヨーカドーも、でんしゃも みたよ！' },
        { who: 'コン', text: 'こんどは もっと ひろい こいわの まちで あそぼうね！' },
      ], () => {
        this.cleared = true;
        this.host.effects.burst(new Vector3(this.foxPos.x, 1.5, this.foxPos.z), { count: 120, power: 6, colors: [new Color4(1, 0.7, 0.85, 1), new Color4(0.6, 0.8, 1, 1)], life: 1.6 });
        this.host.onClear();
      });
    } else {
      this.host.dialog([{ who: 'コン', text: 'また あそびに きてね！' }]);
    }
  }

  // ------------------------------------------------------------------ tick
  private updateCulling(px: number, pz: number) {
    const far = this.scene.fogEnd + 45;
    for (const c of this.chunks) {
      const on = Math.hypot(c.x - px, c.z - pz) < far;
      if (c.mesh.isEnabled() !== on) c.mesh.setEnabled(on);
    }
  }

  update(dt: number, p: Vector3) {
    this.t += dt;
    this.lastP.copyFrom(p);
    this.pathT -= dt;
    if (!this.cleared && this.pathT <= 0) {
      this.pathT = 0.2;
      const n = this.path.length, x = p.x / S, z = p.z / S;
      if (n === 0 || Math.hypot(x - this.path[n - 2], z - this.path[n - 1]) > 0.6) this.path.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
    }
    // keep the paper mountains / clouds / skytree around the player
    this.world.backdrop.position.set(p.x, 0, p.z - 10);
    this.cullT -= dt;
    if (this.cullT <= 0) { this.cullT = 0.3; this.updateCulling(p.x, p.z); }
    this.updateTrain(dt);
    for (const s of this.stars) {
      if (s.got) continue;
      s.mesh.rotation.y += dt * 1.6;
      s.mesh.position.y = s.base.y + 0.95 + Math.sin(this.t * 2.2 + s.base.x) * 0.12;
      const dx = p.x - s.base.x, dz = p.z - s.base.z;
      if (dx * dx + dz * dz < 1.0 && p.y < 2) {
        s.got = true;
        s.mesh.setEnabled(false); s.beacon.setEnabled(false);
        this.host.effects.burst(s.mesh.position, { count: 36 });
        this.host.sfx.star();
        const n = this.starCount;
        if (n < this.starTotal) this.host.toast(`ほし ゲット！ 「${s.label}」 ${n} / ${this.starTotal}`, 1800);
        else { this.questStage = 2; this.drawMarker('！', '#7a69d4'); this.host.toast('ぜんぶ あつめた！ コンの ところへ もどろう', 2600); }
        this.host.onProgress();
      }
    }
    // fox looks at the player & bobs
    const fx = this.fox.root.position;
    const yaw = Math.atan2(-(p.x - fx.x), -(p.z - fx.z));
    this.fox.root.rotation.y += (((yaw - this.fox.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
    this.fox.headNode.rotation.z = Math.sin(this.t * 2) * 0.08;
    this.fox.tail.rotation.z = Math.sin(this.t * 3) * 0.25;
    this.marker.position.y = 2.3 + Math.sin(this.t * 3) * 0.1;
    // guide arrow
    let target: Vector3 | null = null;
    if (this.questStage === 1) target = this.nearestStar(p)?.base ?? null;
    else if (this.questStage === 2 || (this.questStage === 0 && Math.hypot(p.x - fx.x, p.z - fx.z) > 4)) target = this.foxPos;
    if (target && !this.cleared) {
      this.arrow.setEnabled(true);
      this.arrow.position.set(p.x, p.y + 2.25 + Math.sin(this.t * 4) * 0.08, p.z);
      this.arrow.rotation.y = Math.atan2(target.x - p.x, target.z - p.z);
    } else this.arrow.setEnabled(false);
  }

  nearestInteractable(p: Vector3): Interactable | null {
    let best: Interactable | null = null, bd = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
      if (d < it.radius && d < bd) { best = it; bd = d; }
    }
    return best;
  }

  cardInfo(secs: number): CardInfo {
    const dm = (v: number) => v / 10;
    return {
      title: 'そらちゃんと こいわの まち',
      subtitle: 'こいわえき きたぐち ― かみの まちを たんけん',
      secs, stars: this.starCount, total: this.starTotal,
      url: 'https://plseal.github.io/paper-wonderland/',
      credits: '建物: 3D都市モデル PLATEAU 東京都23区（国土交通省）を加工 ／ 地図: © OpenStreetMap contributors',
      date: new Date(),
      map: {
        radius: this.d.radius,
        buildings: this.d.buildings.map((b) => b.slice(2, 2 + b[1] * 2).map(dm)),
        station: this.d.station.map(dm),
        roads: { v: this.d.roads.v.map(dm), i: this.d.roads.i },
        viaduct: { v: this.d.viaductDeck.v.map(dm), i: this.d.viaductDeck.i },
        stars: this.stars.map((s) => ({ x: s.base.x / S, z: s.base.z / S })),
        fox: { x: this.foxPos.x / S, z: this.foxPos.z / S },
        path: this.path.slice(),
        labels: [{ x: 18, z: -14, text: '小岩駅' }],
      },
      shareText: 'そらちゃんと こいわの まち を クリアしたよ！ ★ #PaperWonderland',
      fileName: 'sorachan-koiwa-clear.png',
    };
  }

  respawnPoint(lastSafe: Vector3) { const q = lastSafe.clone(); q.y = 0; return q; }
}

/** Minimal ear clipping for one simple polygon given as flat [x,z,...] (CCW or CW). */
function earClip(p: number[]): number[] {
  const n = p.length / 2;
  const idx = [...Array(n).keys()];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  const ccw = area > 0;
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) => (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2]);
  const inside = (a: number, b: number, c: number, q: number) => {
    const s1 = cross(a, b, q), s2 = cross(b, c, q), s3 = cross(c, a, q);
    return ccw ? s1 > 0 && s2 > 0 && s3 > 0 : s1 < 0 && s2 < 0 && s3 < 0;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const cr = cross(a, b, c);
      if (ccw ? cr <= 0 : cr >= 0) continue;
      if (idx.some((q) => q !== a && q !== b && q !== c && inside(a, b, c, q))) continue;
      out.push(a, b, c); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}


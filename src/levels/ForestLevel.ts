import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { CollisionWorld } from '../core/Collision';
import type { World } from '../world/World';
import type { Effects } from '../world/Effects';
import { cutoutMat, paperMat, paperTexture, rng } from '../world/PaperTexture';
import { FoldPanel, createCardTree, createConeTree, createFox, createHouse, createStar, createStone, easeOutBack, flat } from '../world/Origami';
import type { DialogLine } from '../ui/Dialog';
import type { Level } from './Level';

/** What the level needs from the game shell. */
export interface LevelHost {
  toast(msg: string, ms?: number): void;
  dialog(lines: DialogLine[], onDone?: () => void): void;
  focus(p: Vector3, seconds: number): void;
  sfx: { star(): void; fold(): void; splash(): void; melody?(full?: boolean): number; shaker?(delay?: number): void };
  effects: Effects;
  onProgress(): void;
  onClear(): void;
}

export interface Interactable { id: string; pos: Vector3; radius: number; label: string; action: () => void; }

export const STAR_TOTAL = 5;
export const START = new Vector3(0, 0, -14);
const RIVER = { minZ: 10, maxZ: 16 };
const HINGE_Z = 9.5;
const BRIDGE_LEN = 7, BRIDGE_W = 4;
const GATE_Z = 34;

export class ForestLevel implements Level {
  id = 'forest' as const;
  starTotal = STAR_TOTAL;
  start = START.clone();
  introToast = 'コンに はなしかけて みよう！';
  clearTitle = 'やったね！ クリア！';
  clearText = 'もりの もんが ひらいて、<br/>コンも にっこり。ありがとう、そらちゃん！';
  col = new CollisionWorld();
  stars: { mesh: Mesh; base: Vector3; got: boolean }[] = [];
  bridge: FoldPanel;
  lever: FoldPanel;
  gate: FoldPanel;
  popups: { panel: FoldPanel; delay: number }[] = [];
  interactables: Interactable[] = [];
  questStage = 0; // 0: not talked, 1: quest active, 2: all stars → gate open
  gateOpen = false;
  cleared = false;
  private water!: DynamicTexture;
  private fox: ReturnType<typeof createFox>;
  private marker: Mesh;
  private markerTex: DynamicTexture;
  private portal!: Mesh;
  private timers: { at: number; fn: () => void }[] = [];
  private t = 0;
  private statics: AbstractMesh[] = [];
  private lilies: Mesh[] = [];

  constructor(private scene: Scene, private world: World, private host: LevelHost) {
    this.buildGround();
    this.buildRiver();
    this.bridge = this.buildBridge();
    this.lever = this.buildLever();
    this.buildHouse();
    this.buildNature();
    this.buildStars();
    const fx = this.buildFox();
    this.fox = fx.fox; this.marker = fx.marker; this.markerTex = fx.tex;
    this.gate = this.buildGate();
    this.mergeStatics();
  }

  get starCount() { return this.stars.filter((s) => s.got).length; }
  get bridgeDown() { return this.bridge.done; }

  questText() {
    if (this.cleared) return 'クリア！';
    if (this.questStage === 0) return 'きつねの コンに はなしかけよう';
    if (this.questStage === 2) return 'ひらいた もんへ いこう！';
    if (!this.bridgeDown) return 'レバーで はしを おろそう ／ ほしを あつめよう';
    return `ほしを あつめよう（あと ${STAR_TOTAL - this.starCount}こ）`;
  }

  // ------------------------------------------------------------------ build
  private stat(...ms: AbstractMesh[]) { this.statics.push(...ms); }
  private noCast = new Set<AbstractMesh>();

  private slab(id: string, minX: number, maxX: number, minZ: number, maxZ: number) {
    const w = maxX - minX, d = maxZ - minZ, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    // stacked paper sheets → the cut edge shows layered colours like a diorama board
    const top = CreateBox(id + 'top', { width: w, height: 0.16, depth: d }, this.scene);
    const tm = paperMat(this.scene, 'grass', '#c9ead2', { size: 512, creases: 5, seed: 4, tile: 1,
      tints: ['rgba(255,255,255,0.35)', 'rgba(150,200,240,0.22)', 'rgba(190,170,240,0.2)', 'rgba(170,230,190,0.3)'], blotches: 22 });
    top.material = tm;
    top.position.set(cx, -0.08, cz);
    const l2 = CreateBox(id + 'l2', { width: w - 0.1, height: 0.5, depth: d - 0.1 }, this.scene);
    l2.material = paperMat(this.scene, 'layer2', '#d9cff5', { seed: 5 });
    l2.position.set(cx, -0.41, cz);
    const l3 = CreateBox(id + 'l3', { width: w - 0.2, height: 0.7, depth: d - 0.2 }, this.scene);
    l3.material = paperMat(this.scene, 'layer3', '#a9c6ee', { seed: 6 });
    l3.position.set(cx, -1.01, cz);
    this.world.receive(top);
    this.stat(top, l2, l3);
    [top, l2, l3].forEach((m) => this.noCast.add(m));
    this.col.addSurface({ id: 'ground-' + id, minX, maxX, minZ, maxZ, top: 0 });
    // bank walls stop you from walking "under" the ground when you fall into the river
    this.col.addBlocker({ kind: 'box', id: 'bank-' + id, minX, maxX, minZ, maxZ, top: 0, bottom: -5 });
  }

  private buildGround() {
    this.slab('near', -18, 18, -32, RIVER.minZ);
    this.slab('far', -18, 18, RIVER.maxZ, 42);
    // stepping-stone path of paper circles
    const pm = paperMat(this.scene, 'path', '#fbf5ea', { seed: 8, creases: 2 });
    const r = rng(5);
    const pts: [number, number][] = [];
    for (let z = -12; z < 9; z += 1.6) pts.push([Math.sin(z * 0.35) * 0.8, z]);
    for (let z = 18; z < GATE_Z - 1; z += 1.6) pts.push([Math.sin(z * 0.4) * 0.7, z]);
    for (const [x, z] of pts) {
      const d = CreateDisc('step', { radius: 0.45 + r() * 0.15, tessellation: 7 }, this.scene);
      d.material = pm; d.rotation.x = Math.PI / 2; d.rotation.y = r() * 6;
      d.position.set(x, 0.012, z);
      this.world.receive(d);
      this.stat(d); this.noCast.add(d);
    }
  }

  private buildRiver() {
    const size = 256;
    this.water = new DynamicTexture('water', { width: size, height: size }, this.scene, true);
    const ctx = this.water.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#8fb8ef'); g.addColorStop(0.5, '#a9c4f2'); g.addColorStop(1, '#9aa9ea');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const r = rng(77);
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.35})`;
      ctx.lineWidth = 2 + r() * 3;
      const y = r() * size, x0 = r() * size, len = 30 + r() * 70;
      ctx.beginPath();
      for (let x = 0; x <= len; x += 4) ctx.lineTo((x0 + x) % size, y + Math.sin(x * 0.15) * 3);
      ctx.stroke();
    }
    this.water.update();
    this.water.wrapU = this.water.wrapV = 1;
    this.water.uScale = 6; this.water.vScale = 1.2;
    const wm = new StandardMaterial('waterMat', this.scene);
    wm.diffuseTexture = this.water;
    wm.emissiveColor = new Color3(0.35, 0.38, 0.5);
    wm.specularColor = new Color3(0.4, 0.4, 0.5);
    wm.specularPower = 24;
    const w = CreatePlane('river', { width: 36, height: RIVER.maxZ - RIVER.minZ }, this.scene);
    w.rotation.x = Math.PI / 2;
    w.position.set(0, -0.55, (RIVER.minZ + RIVER.maxZ) / 2);
    w.material = wm;
    w.receiveShadows = true;
    const bed = CreateBox('bed', { width: 36, height: 0.3, depth: RIVER.maxZ - RIVER.minZ }, this.scene);
    bed.material = paperMat(this.scene, 'bed', '#7f8fd8', { seed: 12 });
    bed.position.set(0, -1.5, (RIVER.minZ + RIVER.maxZ) / 2);
    this.stat(bed); this.noCast.add(bed);
    // paper lily pads that bob on the water
    const lm = paperMat(this.scene, 'lily', '#a8e0bf', { seed: 13, creases: 2 });
    for (let i = 0; i < 9; i++) {
      const l = CreateDisc('lily' + i, { radius: 0.4 + r() * 0.25, tessellation: 9, arc: 0.88 }, this.scene);
      l.material = lm; l.rotation.x = Math.PI / 2; l.rotation.y = r() * 6;
      let x = -15 + r() * 30; if (Math.abs(x) < 3) x += 6;
      l.position.set(x, -0.5, RIVER.minZ + 0.8 + r() * 4.4);
      this.lilies.push(l);
    }
  }

  private buildBridge() {
    const scene = this.scene;
    const panel = new FoldPanel(scene, 'bridgePivot', 'x', -Math.PI / 2, 0, 1.4);
    panel.pivot.position.set(0, 0.0, HINGE_Z);
    const mat = paperMat(scene, 'bridge', '#f7dcb4', { grid: [1, 7], seed: 14, size: 256,
      tints: ['rgba(255,255,255,0.35)', 'rgba(244,184,207,0.25)'] });
    const deck = CreateBox('bridgeDeck', { width: BRIDGE_W, height: 0.14, depth: BRIDGE_LEN }, scene);
    deck.material = mat; deck.position.set(0, 0.07, BRIDGE_LEN / 2); deck.parent = panel.pivot;
    const railMat = paperMat(scene, 'rail', '#c3b4ef', { seed: 15, creases: 2 });
    const parts: Mesh[] = [deck];
    for (const s of [-1, 1]) {
      const rail = CreateBox('rail' + s, { width: 0.12, height: 0.12, depth: BRIDGE_LEN }, scene);
      rail.material = railMat; rail.position.set(s * (BRIDGE_W / 2 - 0.1), 0.65, BRIDGE_LEN / 2); rail.parent = panel.pivot;
      parts.push(rail);
      for (let i = 0; i < 5; i++) {
        const post = flat(CreateCylinder('post', { height: 0.6, diameter: 0.14, tessellation: 4 }, scene), railMat);
        post.position.set(s * (BRIDGE_W / 2 - 0.1), 0.36, 0.4 + i * 1.55); post.parent = panel.pivot;
        parts.push(post);
      }
    }
    this.world.cast(...parts);
    this.world.receive(deck);
    // dashed crease line on the ground where the bridge folds
    const crease = CreatePlane('crease', { width: BRIDGE_W + 0.6, height: 0.12 }, scene);
    const cm = cutoutMat(scene, 'creaseLine', '#7a69d4', 256, 8, (ctx) => { for (let x = 0; x < 256; x += 22) ctx.fillRect(x, 0, 12, 8); });
    crease.material = cm; crease.rotation.x = Math.PI / 2; crease.position.set(0, 0.015, HINGE_Z);
    // while folded up, the panel is a wall; once flat it is a walkable surface
    this.col.addBlocker({ kind: 'box', id: 'bridgeWall', minX: -BRIDGE_W / 2 - 0.05, maxX: BRIDGE_W / 2 + 0.05, minZ: HINGE_Z - 0.2, maxZ: HINGE_Z + 0.2, top: BRIDGE_LEN, enabled: () => !panel.done });
    this.col.addSurface({ id: 'bridge', minX: -BRIDGE_W / 2 + 0.1, maxX: BRIDGE_W / 2 - 0.1, minZ: HINGE_Z, maxZ: HINGE_Z + BRIDGE_LEN, top: 0.14, enabled: () => panel.done });
    // handrails keep kids from slipping off the side
    for (const s of [-1, 1]) this.col.addBlocker({ kind: 'box', id: 'rail' + s, minX: s * (BRIDGE_W / 2 - 0.1) - 0.06, maxX: s * (BRIDGE_W / 2 - 0.1) + 0.06, minZ: RIVER.minZ + 0.2, maxZ: RIVER.maxZ - 0.2, top: 0.8, bottom: -0.2, enabled: () => panel.done });
    panel.onDone = () => {
      this.host.effects.burst(new Vector3(0, 0.4, HINGE_Z + BRIDGE_LEN / 2), { count: 60, power: 4 });
      this.host.toast('パタン！ はしが できたよ！');
      this.host.onProgress();
    };
    return panel;
  }

  private buildLever() {
    const scene = this.scene;
    const pos = new Vector3(-3.4, 0, 8.3);
    const base = flat(CreateBox('leverBase', { width: 0.8, height: 0.35, depth: 0.6 }, scene), paperMat(scene, 'leverBase', '#c3b4ef', { seed: 16, creases: 2 }));
    base.position.set(pos.x, 0.175, pos.z);
    const lever = new FoldPanel(scene, 'leverPivot', 'z', 0.65, -0.65, 0.45);
    lever.pivot.position.set(pos.x, 0.35, pos.z);
    const stick = flat(CreateCylinder('leverStick', { height: 1.0, diameter: 0.1, tessellation: 5 }, scene), paperMat(scene, 'stick', '#fbf5ea', { seed: 17 }));
    stick.position.y = 0.5; stick.parent = lever.pivot;
    const knob = flat(CreateIcoSphere('leverKnob', { radius: 0.2, subdivisions: 1 }, scene), paperMat(scene, 'knob', '#f29bb9', { seed: 18 }));
    knob.position.y = 1.05; knob.parent = lever.pivot;
    // little sign card: 「はし」 with arrow
    const sign = CreatePlane('leverSign', { width: 0.9, height: 0.5 }, scene);
    const st = new DynamicTexture('signTex', { width: 180, height: 100 }, scene, true);
    const c = st.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#fbf5ea'; c.fillRect(0, 0, 180, 100);
    c.fillStyle = '#5b4c94'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('はし →', 90, 52); st.update();
    const sm = new StandardMaterial('signMat', scene); sm.diffuseTexture = st; sm.emissiveColor = new Color3(0.3, 0.3, 0.3); sm.backFaceCulling = false;
    sign.material = sm; sign.position.set(pos.x - 0.9, 0.8, pos.z - 0.2); sign.rotation.y = -0.3;
    const signPost = CreateBox('signPost', { width: 0.06, height: 0.6, depth: 0.06 }, scene);
    signPost.material = paperMat(scene, 'stick', '#fbf5ea', { seed: 17 }); signPost.position.set(pos.x - 0.9, 0.3, pos.z - 0.18);
    this.world.cast(base, stick, knob, sign);
    this.col.addBlocker({ kind: 'circle', id: 'lever', x: pos.x, z: pos.z, r: 0.45, top: 0.35 });
    lever.onDone = () => {
      this.bridge.fold();
      this.host.sfx.fold();
      this.host.focus(new Vector3(0, 1, HINGE_Z + 3), 2.4);
    };
    this.interactables.push({
      id: 'lever', pos, radius: 2.2, label: 'レバーを たおす',
      action: () => {
        if (this.lever.done || this.lever.folding) { this.host.toast('はしは もう おりているよ'); return; }
        this.lever.fold();
      },
    });
    return lever;
  }

  private buildHouse() {
    const { root, meshes } = createHouse(this.scene, 'house');
    root.position.set(-9.5, 0, -3);
    root.rotation.y = 0.25;
    root.computeWorldMatrix(true);
    meshes.forEach((m) => m.computeWorldMatrix(true));
    this.world.receive(...meshes);
    this.stat(...meshes);
    this.col.addBlocker({ kind: 'box', id: 'house', minX: -11.9, maxX: -7.1, minZ: -5.4, maxZ: -0.6, top: 5 });
    // mailbox
    const mb = flat(CreateBox('mailbox', { width: 0.4, height: 0.35, depth: 0.5 }, this.scene), paperMat(this.scene, 'mail', '#f29bb9', { seed: 26 }));
    mb.position.set(-6.8, 0.9, -5.6);
    const mp = CreateBox('mailpost', { width: 0.08, height: 0.75, depth: 0.08 }, this.scene);
    mp.material = paperMat(this.scene, 'trunk', '#c9a98e', { creases: 2 }); mp.position.set(-6.8, 0.37, -5.6);
    this.stat(mb, mp);
  }

  private bigStone(x: number, z: number, id: string) {
    const s = createStone(this.scene, id, 1.3, 3);
    s.scaling.set(1.15, 0.85, 1.15);
    s.position.set(x, 0, z);
    s.computeWorldMatrix(true); s.refreshBoundingInfo();
    const top = s.getBoundingInfo().boundingBox.maximumWorld.y;
    this.stat(s);
    const hw = 1.0;
    this.col.addSurface({ id: 'stone-' + id, minX: x - hw, maxX: x + hw, minZ: z - hw, maxZ: z + hw, top });
    this.col.addBlocker({ kind: 'box', id: 'stoneb-' + id, minX: x - hw, maxX: x + hw, minZ: z - hw, maxZ: z + hw, top });
    return top;
  }

  private stoneTops: Record<string, number> = {};

  private buildNature() {
    const scene = this.scene;
    this.stoneTops.a = this.bigStone(6.5, -2, 'a');
    this.stoneTops.b = this.bigStone(7.5, 28, 'b');
    const r = rng(2024);
    const placed: [number, number][] = [];
    const avoid = (x: number, z: number) => {
      if (Math.hypot(x - START.x, z - START.z) < 3.5) return true;
      if (Math.abs(x) < 7 && z < -10) return true; // keep the camera's view of the start clear
      if (Math.abs(x) < 3.4 && z > -17 && z < GATE_Z + 2) return true; // main path
      if (z > RIVER.minZ - 1.8 && z < RIVER.maxZ + 1.8) return true;
      if (x > -13 && x < -5.5 && z > -7 && z < 3.5) return true; // house + star
      if (Math.abs(x) < 7 && z > GATE_Z - 4 && z < GATE_Z + 4) return true;
      for (const [sx, sz] of [[6.5, -2], [7.5, 28], [-5, -6], [-6, 23], [3.4, 6.5], [-3.4, 8.3], [11, 6]]) if (Math.hypot(x - sx, z - sz) < 2.6) return true;
      for (const [px, pz] of placed) if (Math.hypot(x - px, z - pz) < 2.6) return true;
      return false;
    };
    const tree = (x: number, z: number, i: number, collide: boolean) => {
      const h = 2.6 + r() * 2.2;
      const node = r() < 0.6 ? createConeTree(scene, 'tree' + i, h, i * 13 + 1) : createCardTree(scene, 'ctree' + i, h * 0.9, i * 7 + 3);
      node.position.set(x, 0, z);
      node.computeWorldMatrix(true);
      const ms = node.getChildMeshes();
      ms.forEach((m) => m.computeWorldMatrix(true));
      this.stat(...ms);
      if (collide) this.col.addBlocker({ kind: 'circle', id: 'tree' + i, x, z, r: 0.45, top: 10 });
      placed.push([x, z]);
    };
    let i = 0;
    for (let tries = 0; tries < 400 && i < 46; tries++) {
      const far = i >= 26;
      const x = -15.5 + r() * 31, z = far ? RIVER.maxZ + 2 + r() * 21 : -19 + r() * 27;
      if (avoid(x, z)) continue;
      tree(x, z, i++, true);
    }
    // border rows (outside the walkable bounds) so the edge of the world is a forest
    for (let z = -30; z <= 40; z += 2.7) {
      if (z > RIVER.minZ - 1 && z < RIVER.maxZ + 1) continue;
      tree(-17.6 + r() * 0.6, z, i++, false); tree(17.4 + r() * 0.6, z, i++, false);
    }
    for (let x = -15; x <= 15; x += 2.8) tree(x + r(), -30 + r() * 0.5, i++, false);
    for (let x = -15; x <= 15; x += 3.2) if (Math.abs(x) > 4) tree(x + r(), 40.5 + r() * 0.5, i++, false);

    // small decorative stones
    for (let k = 0; k < 14; k++) {
      const x = -15 + r() * 30, z = r() < 0.6 ? -18 + r() * 26 : 18 + r() * 20;
      if (avoid(x, z)) continue;
      const s = createStone(scene, 'pebble' + k, 0.25 + r() * 0.2, k);
      s.position.set(x, 0.05, z); s.computeWorldMatrix(true); this.stat(s);
    }

    // grass + flowers as thin instances (2 draw calls for hundreds of paper bits)
    const grassMat = cutoutMat(scene, 'grassTuft', '#9ed6b0', 64, 64, (ctx) => {
      ctx.beginPath(); ctx.moveTo(4, 64); ctx.lineTo(14, 10); ctx.lineTo(24, 64); ctx.moveTo(20, 64); ctx.lineTo(32, 0); ctx.lineTo(44, 64); ctx.moveTo(40, 64); ctx.lineTo(52, 14); ctx.lineTo(60, 64); ctx.fill();
    }, { seed: 30 });
    const flowerMat = cutoutMat(scene, 'flower', '#f7c6da', 64, 64, (ctx) => {
      for (let p = 0; p < 5; p++) { const a = (p / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(32 + Math.cos(a) * 15, 26 + Math.sin(a) * 15, 11, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillRect(30, 30, 4, 34);
    }, { seed: 31, tints: ['rgba(255,240,180,0.6)', 'rgba(200,170,255,0.3)'] });
    const mk = (mat: StandardMaterial, n: number, size: number, seed: number) => {
      const a = CreatePlane('tuftA', { size }, scene), b = CreatePlane('tuftB', { size }, scene);
      b.rotation.y = Math.PI / 2; a.position.y = b.position.y = size / 2;
      const m = Mesh.MergeMeshes([a, b], true)!;
      m.material = mat;
      const rr = rng(seed);
      const mats: Matrix[] = [];
      for (let k = 0; k < n * 3 && mats.length < n; k++) {
        const x = -16 + rr() * 32, z = -19 + rr() * 58;
        if (z > RIVER.minZ - 0.3 && z < RIVER.maxZ + 0.3) continue;
        if (Math.abs(x) < 1.6 && z > -13) continue;
        const sc = 0.6 + rr() * 0.8;
        mats.push(Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.RotationYawPitchRoll(rr() * 6, 0, 0), new Vector3(x, 0, z)));
      }
      const buf = new Float32Array(mats.length * 16);
      mats.forEach((mm, k) => mm.copyToArray(buf, k * 16));
      m.thinInstanceSetBuffer('matrix', buf, 16, true);
      m.isPickable = false;
      return m;
    };
    mk(grassMat, 260, 0.55, 1);
    mk(flowerMat, 90, 0.6, 2);
  }

  private buildStars() {
    const mat = paperMat(this.scene, 'star', '#ffd86b', { seed: 40, emissive: 0.4, tints: ['rgba(255,255,255,0.5)', 'rgba(255,170,120,0.25)'] });
    const spots: Vector3[] = [
      new Vector3(-5, 0, -6),                         // meadow, on the way
      new Vector3(6.5, this.stoneTops.a, -2),         // on top of the big stone (jump!)
      new Vector3(-9.5, 0, 1.6),                      // hidden behind the house
      new Vector3(-6, 0, 23),                         // across the river
      new Vector3(7.5, this.stoneTops.b, 28),         // across the river, on a stone
    ];
    spots.forEach((p, i) => {
      const s = createStar(this.scene, 'star' + i, mat, 0.42, 0.16);
      s.position.copyFrom(p).addInPlaceFromFloats(0, 0.95, 0);
      this.world.cast(s);
      this.stars.push({ mesh: s, base: p.clone(), got: false });
    });
  }

  private buildFox() {
    const fox = createFox(this.scene, 'kon');
    fox.root.position.set(3.4, 0, 6.5);
    this.world.cast(...fox.meshes);
    this.col.addBlocker({ kind: 'circle', id: 'fox', x: 3.4, z: 6.5, r: 0.65, top: 2 });
    const tex = new DynamicTexture('markerTex', { width: 128, height: 128 }, this.scene, true);
    tex.hasAlpha = true;
    const marker = CreatePlane('marker', { size: 0.8 }, this.scene);
    const mm = new StandardMaterial('markerMat', this.scene);
    mm.diffuseTexture = tex; mm.useAlphaFromDiffuseTexture = true; mm.transparencyMode = 1; mm.disableLighting = true; mm.emissiveColor = Color3.White();
    marker.material = mm; marker.billboardMode = Mesh.BILLBOARDMODE_ALL;
    marker.position.set(3.4, 2.3, 6.5);
    this.interactables.push({ id: 'fox', pos: new Vector3(3.4, 0, 6.5), radius: 2.5, label: 'コンと はなす', action: () => this.talkFox() });
    this.drawMarker(tex, '！', '#f08a5d');
    return { fox, marker, tex };
  }

  private drawMarker(tex: DynamicTexture, ch: string, color: string) {
    const c = tex.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = '#fbf5ea'; c.beginPath(); c.arc(64, 60, 50, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(50, 100); c.lineTo(64, 126); c.lineTo(78, 100); c.fill();
    c.fillStyle = color; c.font = 'bold 72px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(ch, 64, 64);
    tex.update();
  }

  private buildGate() {
    const scene = this.scene;
    const gate = new FoldPanel(scene, 'gatePivot', 'x', Math.PI / 2 - 0.02, 0, 1.3);
    gate.pivot.position.set(0, 0.02, GATE_Z);
    const pink = paperMat(scene, 'gate', '#f4a9c6', { seed: 50, creases: 3 });
    const lav = paperMat(scene, 'gate2', '#a99bea', { seed: 51, creases: 2 });
    const parts: Mesh[] = [];
    for (const s of [-1, 1]) {
      const p = flat(CreateCylinder('pillar' + s, { height: 3.4, diameter: 0.45, tessellation: 4 }, scene), pink);
      p.position.set(s * 1.8, 1.7, 0); p.rotation.y = Math.PI / 4; p.parent = gate.pivot; parts.push(p);
    }
    const beam = flat(CreateBox('beam', { width: 5.0, height: 0.32, depth: 0.5 }, scene), lav);
    beam.position.set(0, 3.5, 0); beam.parent = gate.pivot; parts.push(beam);
    const beam2 = flat(CreateBox('beam2', { width: 4.2, height: 0.22, depth: 0.36 }, scene), pink);
    beam2.position.set(0, 2.85, 0); beam2.parent = gate.pivot; parts.push(beam2);
    // star emblem on the gate
    const emb = createStar(scene, 'gateStar', paperMat(scene, 'star', '#ffd86b', { seed: 40, emissive: 0.4 }), 0.42, 0.12);
    emb.position.set(0, 3.5, -0.3); emb.parent = gate.pivot; parts.push(emb);
    // shimmering paper portal (hidden until open)
    const portalTex = paperTexture(scene, 'portalTex', '#cdbdf6', { seed: 52, tints: ['rgba(255,255,255,0.6)', 'rgba(244,169,198,0.5)', 'rgba(159,196,239,0.5)'], blotches: 20 });
    const pm = new StandardMaterial('portalMat', scene);
    pm.diffuseTexture = portalTex; pm.emissiveColor = new Color3(0.75, 0.7, 0.9); pm.alpha = 0.0; pm.backFaceCulling = false; pm.disableLighting = true;
    this.portal = CreatePlane('portal', { width: 3.2, height: 2.7 }, scene);
    this.portal.material = pm; this.portal.position.set(0, 1.4, GATE_Z); this.portal.isVisible = false;
    this.world.cast(...parts);
    gate.onDone = () => { this.portal.isVisible = true; this.host.effects.burst(new Vector3(0, 2, GATE_Z), { count: 80, power: 5 }); };
    // pillars collide once the gate stands up
    for (const s of [-1, 1]) this.col.addBlocker({ kind: 'circle', id: 'pillar' + s, x: s * 1.8, z: GATE_Z, r: 0.35, top: 4, enabled: () => gate.done });

    // pop-up paper flowers around the gate that unfold with it
    const petal = cutoutMat(scene, 'bigFlower', '#f7c6da', 128, 160, (ctx) => {
      ctx.fillRect(60, 60, 8, 100);
      ctx.beginPath(); ctx.ellipse(40, 120, 26, 10, -0.6, 0, Math.PI * 2); ctx.fill();
      for (let p = 0; p < 6; p++) { const a = (p / 6) * Math.PI * 2; ctx.beginPath(); ctx.arc(64 + Math.cos(a) * 24, 48 + Math.sin(a) * 24, 20, 0, Math.PI * 2); ctx.fill(); }
    }, { seed: 53, tints: ['rgba(255,240,170,0.55)', 'rgba(185,176,236,0.4)'] });
    const fr = rng(9);
    const spots = [[-4.5, GATE_Z - 1], [4.5, GATE_Z - 1], [-3.2, GATE_Z + 1.5], [3.4, GATE_Z + 1.4], [-6, GATE_Z - 2.5], [6, GATE_Z - 2.6]];
    spots.forEach(([x, z], k) => {
      const fp = new FoldPanel(scene, 'pop' + k, 'x', Math.PI / 2 - 0.03, 0, 0.8);
      fp.pivot.position.set(x, 0.03, z);
      fp.pivot.rotation.y = 0; // fold axis = x
      const p = CreatePlane('popFlower' + k, { width: 1.4, height: 1.75 }, scene);
      p.material = petal; p.position.y = 0.87; p.rotation.y = (fr() - 0.5) * 0.6; p.parent = fp.pivot;
      this.world.cast(p);
      this.popups.push({ panel: fp, delay: 0.5 + k * 0.18 });
    });
    return gate;
  }

  /** Merge non-moving meshes per material → far fewer draw calls (fast on phones). */
  private mergeStatics() {
    const groups = new Map<string, Mesh[]>();
    for (const m of this.statics) {
      if (!(m instanceof Mesh) || !m.material) continue;
      const k = m.material.uniqueId + (m.receiveShadows ? 'r' : '') + (this.noCast.has(m) ? 'n' : '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(m);
    }
    for (const list of groups.values()) {
      const rs = list[0].receiveShadows;
      const cast = !this.noCast.has(list[0]);
      const merged = list.length > 1 ? Mesh.MergeMeshes(list, true, true) : list[0];
      if (!merged) continue;
      if (merged.parent) merged.setParent(null); // keep world transform
      merged.receiveShadows = rs;
      merged.isPickable = false;
      if (cast) this.world.cast(merged);
      merged.freezeWorldMatrix();
    }
    // empty tree roots left behind
    this.scene.transformNodes.filter((t) => t.getChildren().length === 0 && /^c?tree|^house/.test(t.name)).forEach((t) => t.dispose());
  }

  // ------------------------------------------------------------------ logic
  talkFox() {
    const left = STAR_TOTAL - this.starCount;
    if (this.questStage === 0) {
      this.questStage = 1;
      this.drawMarker(this.markerTex, '★', '#e8a93a');
      this.host.dialog([
        { who: 'コン', text: 'やあ、こんにちは！ ぼくは かみの きつね、コンだよ。' },
        { who: 'そらちゃん', text: 'こんにちは！ わたしは そらちゃん。' },
        { who: 'コン', text: 'たいへんなんだ。かぜで かみの ほしが ５こ、とんで いっちゃった。' },
        { who: 'コン', text: 'かわの むこうにも あるよ。でも はしが たたまれて いて わたれないんだ。' },
        { who: 'コン', text: 'そこの レバーを たおすと、はしが パタンと おりるよ！' },
        { who: 'そらちゃん', text: 'まかせて！ ほしを ぜんぶ あつめるね！' },
      ], () => this.host.onProgress());
    } else if (this.questStage === 1) {
      const lines: DialogLine[] = [{ who: 'コン', text: left > 0 ? `ほしは あと ${left}こ だよ。がんばって！` : 'ほしが そろったね！' }];
      if (!this.bridgeDown) lines.push({ who: 'コン', text: 'ひだりの レバーを たおしてね。はしが おりるよ。' });
      else if (left > 0) lines.push({ who: 'コン', text: 'おおきな いしの うえも みてごらん。ジャンプで のれるよ！' });
      this.host.dialog(lines);
    } else {
      this.host.dialog([{ who: 'コン', text: 'ありがとう、そらちゃん！ もりの もんが ひらいたよ。かわの むこうへ いってごらん！' }]);
    }
  }

  private allStars() {
    this.questStage = 2;
    this.drawMarker(this.markerTex, '♪', '#7a69d4');
    this.host.dialog([
      { who: 'コン', text: 'わあ！ ほしが ５こ そろったね！' },
      { who: 'コン', text: 'みて！ もりが ひらいて いくよ……！' },
    ], () => {
      this.host.focus(new Vector3(0, 1.8, GATE_Z), 4.5);
      this.after(0.4, () => { this.gate.fold(); this.host.sfx.fold(); });
      for (const p of this.popups) this.after(0.4 + p.delay, () => p.panel.fold());
      this.after(1.8, () => { this.gateOpen = true; this.host.toast('もんが ひらいた！'); this.host.onProgress(); });
    });
    this.host.onProgress();
  }

  private after(sec: number, fn: () => void) { this.timers.push({ at: this.t + sec, fn }); }

  /** Per-frame level update. `p` = player feet position. */
  update(dt: number, p: Vector3) {
    this.t += dt;
    for (const tm of this.timers.slice()) if (this.t >= tm.at) { this.timers.splice(this.timers.indexOf(tm), 1); tm.fn(); }
    this.bridge.update(dt); this.lever.update(dt); this.gate.update(dt);
    for (const pp of this.popups) pp.panel.update(dt);
    this.water.uOffset += dt * 0.03; this.water.vOffset = Math.sin(this.t * 0.4) * 0.02;
    this.lilies.forEach((l, i) => { l.position.y = -0.5 + Math.sin(this.t * 1.5 + i) * 0.03; l.rotation.y += dt * 0.05; });
    if (this.portal.isVisible) {
      const pm = this.portal.material as StandardMaterial;
      pm.alpha = Math.min(0.75, pm.alpha + dt);
      (pm.diffuseTexture as DynamicTexture).uOffset += dt * 0.1;
    }
    // stars
    for (const s of this.stars) {
      if (s.got) continue;
      s.mesh.rotation.y += dt * 2;
      s.mesh.position.y = s.base.y + 0.95 + Math.sin(this.t * 2.5 + s.base.x) * 0.12;
      const dx = p.x - s.base.x, dz = p.z - s.base.z, dy = p.y + 0.65 - s.mesh.position.y;
      if (dx * dx + dz * dz < 0.95 * 0.95 && Math.abs(dy) < 1.0) {
        s.got = true;
        s.mesh.setEnabled(false);
        this.host.effects.burst(s.mesh.position, { count: 36 });
        this.host.sfx.star();
        const n = this.starCount;
        if (n < STAR_TOTAL) this.host.toast(`ほし ゲット！ ${n} / ${STAR_TOTAL}`, 1300);
        if (n === STAR_TOTAL) this.allStars(); else this.host.onProgress();
      }
    }
    // fox looks at the player & bobs
    const fx = this.fox.root.position;
    const yaw = Math.atan2(-(p.x - fx.x), -(p.z - fx.z));
    this.fox.root.rotation.y += (((yaw - this.fox.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
    this.fox.headNode.rotation.z = Math.sin(this.t * 2) * 0.08;
    this.fox.tail.rotation.z = Math.sin(this.t * 3) * 0.25;
    this.marker.position.y = 2.3 + Math.sin(this.t * 3) * 0.1;
    // exit
    if (this.gateOpen && !this.cleared && Math.abs(p.x) < 1.5 && Math.abs(p.z - GATE_Z) < 0.8) {
      this.cleared = true;
      this.host.effects.burst(new Vector3(p.x, 1.5, p.z), { count: 120, power: 6, colors: [new Color4(1, 0.7, 0.85, 1), new Color4(0.6, 0.8, 1, 1)], life: 1.6 });
      this.host.onClear();
    }
  }

  nearestInteractable(p: Vector3): Interactable | null {
    let best: Interactable | null = null, bd = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
      if (d < it.radius && d < bd) { best = it; bd = d; }
    }
    return best;
  }

  /** Where to put the player back after falling into the river. */
  respawnPoint(lastSafe: Vector3) {
    const p = lastSafe.clone();
    if (p.z < (RIVER.minZ + RIVER.maxZ) / 2) p.z = Math.min(p.z, RIVER.minZ - 1.4);
    else p.z = Math.max(p.z, RIVER.maxZ + 1.4);
    p.y = 0;
    return p;
  }
}

export { easeOutBack };

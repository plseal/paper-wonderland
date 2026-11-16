import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDecal } from '@babylonjs/core/Meshes/Builders/decalBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { CollisionWorld } from '../core/Collision';
import { paperMat } from '../world/PaperTexture';
import { flat } from '../world/Origami';
import type { Avatar } from './Player';

export const KAI_RADIUS = 0.42;
export const KAI_HEIGHT = 1.3;
const SPEED = 5.6, JUMP_V = 7.4, GRAVITY = 20;

/**
 * かい: built from paper-craft primitives after the child's drawing —
 * black twin tails, warm round face with a big smile, purple A-line dress
 * with black trim, black puffy sleeves with red cuffs, two wooden maracas.
 * Model faces +z; turns toward the walking direction.
 */
export class KaiPlayer implements Avatar {
  root: TransformNode;
  body: TransformNode;
  pos = new Vector3();
  vel = new Vector3();
  vy = 0;
  grounded = true;
  groundId = '';
  lastSafe = new Vector3();
  casters: Mesh[] = [];
  yaw = 0;
  private t = 0;
  private walk = 0;
  private shakeT = 0;
  private land = 0;
  private legs: TransformNode[] = [];
  private arms: TransformNode[] = [];
  private tails: TransformNode[] = [];
  private head: TransformNode;
  private shadow: Mesh;

  static create(scene: Scene) { return new KaiPlayer(scene); }

  private constructor(scene: Scene) {
    const M = (k: string, c: string, o: Parameters<typeof paperMat>[3] = {}) => paperMat(scene, 'kai-' + k, c, { seed: 300 + k.length * 7, creases: 2, ...o });
    const skin = M('skin', '#f0b27e', { creases: 0, tints: ['rgba(255,255,255,0.25)', 'rgba(240,140,100,0.12)'] });
    const black = M('black', '#2b2733', { creases: 3, tints: ['rgba(255,255,255,0.08)'] });
    const purple = M('purple', '#8a5cc2', { creases: 4, tints: ['rgba(255,255,255,0.22)', 'rgba(110,60,180,0.25)'] });
    const red = M('red', '#c8413b', { creases: 1 });
    const wood = M('wood', '#b9784a', { creases: 3, grid: [2, 2], tints: ['rgba(255,220,180,0.25)'] });
    const stick = M('stick', '#e3b98a', { creases: 0 });
    black.emissiveColor = new Color3(0.06, 0.06, 0.07);

    this.root = new TransformNode('kai', scene);
    this.body = new TransformNode('kaiBody', scene); this.body.parent = this.root;
    const add = (m: Mesh, parent: TransformNode = this.body) => { m.parent = parent; this.casters.push(m); m.isPickable = false; return m; };

    // ---- legs + shoes (pivot at the hip) ----
    for (const s of [-1, 1]) {
      const hip = new TransformNode('kaiHip' + s, scene); hip.parent = this.body; hip.position.set(0.11 * s, 0.5, 0);
      const leg = add(CreateCylinder('kaiLeg' + s, { height: 0.42, diameter: 0.085, tessellation: 8 }, scene), hip);
      leg.material = skin; leg.position.y = -0.21;
      const cuff = add(CreateCylinder('kaiSock' + s, { height: 0.05, diameter: 0.12, tessellation: 10 }, scene), hip);
      cuff.material = red; cuff.position.y = -0.4;
      const shoe = add(CreateSphere('kaiShoe' + s, { diameter: 0.18, segments: 8 }, scene), hip);
      shoe.material = black; shoe.scaling.set(0.85, 0.6, 1.25); shoe.position.set(0, -0.46, 0.03);
      this.legs.push(hip);
    }
    // ---- A-line dress: purple cone with black hem + collar ----
    const dress = add(flat(CreateCylinder('kaiDress', { height: 0.62, diameterTop: 0.34, diameterBottom: 0.98, tessellation: 10 }, scene), purple));
    dress.position.y = 0.76;
    const hem = add(flat(CreateCylinder('kaiHem', { height: 0.08, diameterTop: 0.93, diameterBottom: 1.02, tessellation: 10 }, scene), black));
    hem.position.y = 0.48;
    const yoke = add(flat(CreateCylinder('kaiYoke', { height: 0.1, diameterTop: 0.3, diameterBottom: 0.4, tessellation: 10 }, scene), black));
    yoke.position.y = 1.06;
    const neck = add(CreateCylinder('kaiNeck', { height: 0.1, diameter: 0.1, tessellation: 8 }, scene));
    neck.material = skin; neck.position.y = 1.12;

    // ---- arms: puffy black sleeve + red cuff + skin arm + maraca (pivot at shoulder) ----
    for (const s of [-1, 1]) {
      const sh = new TransformNode('kaiShoulder' + s, scene); sh.parent = this.body; sh.position.set(0.2 * s, 1.02, 0);
      const sleeve = add(CreateSphere('kaiSleeve' + s, { diameter: 0.22, segments: 8 }, scene), sh);
      sleeve.material = black; sleeve.scaling.set(1, 0.9, 1);
      const cuffR = add(CreateCylinder('kaiCuff' + s, { height: 0.05, diameter: 0.15, tessellation: 10 }, scene), sh);
      cuffR.material = red; cuffR.position.y = -0.1;
      const arm = add(CreateCylinder('kaiArm' + s, { height: 0.34, diameter: 0.07, tessellation: 8 }, scene), sh);
      arm.material = skin; arm.position.y = -0.26;
      const handle = add(CreateCylinder('kaiStick' + s, { height: 0.16, diameter: 0.04, tessellation: 6 }, scene), sh);
      handle.material = stick; handle.position.y = -0.48;
      const ball = add(flat(CreateSphere('kaiMaraca' + s, { diameter: 0.2, segments: 6 }, scene), wood), sh);
      ball.position.y = -0.62;
      this.arms.push(sh);
    }

    // ---- head ----
    this.head = new TransformNode('kaiHead', scene); this.head.parent = this.body; this.head.position.y = 1.4;
    const h = CreateSphere('kaiFace', { diameter: 0.52, segments: 20 }, scene); // parented after the decal is projected
    h.material = skin; h.isPickable = false;
    const hair = add(CreateSphere('kaiHair', { diameter: 0.56, segments: 16 }, scene), this.head);
    hair.material = black; hair.position.set(0, 0.045, -0.07);
    // bangs: little folded paper triangles on the forehead
    for (const [x, rz, len] of [[-0.13, 0.35, 0.14], [0, 0, 0.16], [0.13, -0.35, 0.14], [-0.2, 0.6, 0.12], [0.2, -0.6, 0.12]] as const) {
      const b = add(flat(CreateCylinder('kaiBang', { height: len, diameterTop: 0.11, diameterBottom: 0, tessellation: 3 }, scene), black), this.head);
      b.position.set(x, 0.17, 0.2); b.rotation.set(-0.5, 0, rz); b.scaling.z = 0.4;
    }
    // face decals (eyes, mouth, cheeks) painted on one curved-ish plane
    const fTex = new DynamicTexture('kaiFaceTex', { width: 256, height: 256 }, scene, true);
    const c = fTex.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = 'rgba(240,120,110,0.55)'; for (const x of [52, 204]) { c.beginPath(); c.ellipse(x, 150, 24, 16, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#221d28'; for (const x of [80, 176]) { c.beginPath(); c.ellipse(x, 104, 24, 30, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#fff'; for (const x of [88, 184]) { c.beginPath(); c.arc(x, 92, 8, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#221d28'; c.lineWidth = 5; for (const [x, d] of [[56, -1], [200, 1]]) { c.beginPath(); c.moveTo(x, 84); c.lineTo(x + 12 * d, 76); c.stroke(); }
    c.fillStyle = '#5b1f2a'; c.beginPath(); c.moveTo(88, 150); c.quadraticCurveTo(128, 154, 168, 150); c.quadraticCurveTo(160, 214, 128, 214); c.quadraticCurveTo(96, 214, 88, 150); c.fill();
    c.fillStyle = '#ef7d88'; c.beginPath(); c.ellipse(128, 196, 22, 13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.fillRect(98, 150, 60, 8);
    fTex.hasAlpha = true; fTex.update();
    const fm = new StandardMaterial('kaiFaceMat', scene);
    fm.diffuseTexture = fTex; fm.useAlphaFromDiffuseTexture = true; fm.transparencyMode = 1; fm.alphaCutOff = 0.4;
    fm.specularColor = Color3.Black(); fm.emissiveColor = new Color3(0.25, 0.25, 0.25); fm.backFaceCulling = false;
    // project the face onto the head sphere so it follows the curve
    h.computeWorldMatrix(true);
    const decal = CreateDecal('kaiFaceDecal', h, { position: new Vector3(0, -0.03, 0.26), normal: new Vector3(0, 0, 1), size: new Vector3(0.44, 0.44, 0.6), angle: 0 });
    decal.material = fm; decal.isPickable = false;
    fm.zOffset = -2;
    h.parent = this.head; decal.parent = this.head; this.casters.push(h);
    // twin tails: flattened tapered ribbons hanging from both sides
    for (const s of [-1, 1]) {
      const pv = new TransformNode('kaiTailPivot' + s, scene); pv.parent = this.head; pv.position.set(0.26 * s, 0.12, -0.05);
      const tie = add(CreateSphere('kaiTie' + s, { diameter: 0.12, segments: 6 }, scene), pv); tie.material = red;
      const tail = add(flat(CreateCylinder('kaiTail' + s, { height: 0.78, diameterTop: 0.24, diameterBottom: 0.07, tessellation: 6 }, scene), black), pv);
      tail.scaling.z = 0.6; tail.position.set(0.12 * s, -0.36, 0); tail.rotation.z = 0.3 * s;
      const tip = add(flat(CreateCylinder('kaiTailTip' + s, { height: 0.3, diameterTop: 0.1, diameterBottom: 0, tessellation: 5 }, scene), black), pv);
      tip.scaling.z = 0.6; tip.position.set(0.26 * s, -0.78, 0); tip.rotation.z = 0.45 * s;
      pv.rotation.z = 0.35 * s;
      this.tails.push(pv);
    }

    // blob shadow
    const st = new DynamicTexture('kaiBlob', { width: 64, height: 64 }, scene, false);
    const sc = st.getContext() as unknown as CanvasRenderingContext2D;
    const g = sc.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(60,40,110,0.45)'); g.addColorStop(1, 'rgba(60,40,110,0)');
    sc.fillStyle = g; sc.fillRect(0, 0, 64, 64); st.hasAlpha = true; st.update();
    const sm = new StandardMaterial('kaiBlobMat', scene); sm.diffuseTexture = st; sm.useAlphaFromDiffuseTexture = true; sm.disableLighting = true; sm.emissiveColor = Color3.White();
    this.shadow = CreateDisc('kaiShadow', { radius: 0.55, tessellation: 18 }, scene);
    this.shadow.rotation.x = Math.PI / 2; this.shadow.material = sm; this.shadow.isPickable = false;
  }

  /** wave the maracas (seconds) */
  shake(sec = 1.4) { this.shakeT = sec; }
  get shaking() { return this.shakeT > 0; }

  teleport(p: Vector3) { this.pos.copyFrom(p); this.vy = 0; this.vel.setAll(0); this.lastSafe.copyFrom(p); }

  update(dt: number, move: { x: number; z: number }, jump: boolean, _camYaw: number, world: CollisionWorld) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 12);
    this.vel.x += (move.x * SPEED - this.vel.x) * k;
    this.vel.z += (move.z * SPEED - this.vel.z) * k;
    let jumped = false;
    if (jump && this.grounded) { this.vy = JUMP_V; this.grounded = false; jumped = true; }
    const prevY = this.pos.y;
    this.vy -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vy * dt;
    world.resolve(this.pos, KAI_RADIUS, KAI_HEIGHT, Math.max(prevY, this.pos.y));
    const ground = world.groundAt(this.pos.x, this.pos.z, Math.max(prevY, this.pos.y));
    const was = this.grounded;
    if (ground && this.pos.y <= ground.top + (was && this.vy <= 0 ? 0.3 : 0) && this.vy <= 0) {
      if (!was && this.vy < -6) this.land = 1;
      this.pos.y = ground.top; this.vy = 0; this.grounded = true; this.groundId = ground.id;
      if (ground.id.startsWith('ground')) this.lastSafe.copyFrom(this.pos);
    } else this.grounded = false;

    // ---- animation ----
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.4;
    if (moving) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let d = want - this.yaw; d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += d * (1 - Math.exp(-dt * 10));
    }
    this.walk = moving && this.grounded ? this.walk + dt * speed * 2.1 : this.walk * 0.85;
    const sw = Math.sin(this.walk) * Math.min(1, speed / SPEED);
    this.land = Math.max(0, this.land - dt * 4);
    const bob = moving && this.grounded ? Math.abs(Math.cos(this.walk)) * 0.06 : Math.sin(this.t * 2.5) * 0.01;
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.body.position.y = bob;
    this.body.scaling.set(1 + this.land * 0.1, 1 - this.land * 0.14, 1 + this.land * 0.1);
    this.legs[0].rotation.x = this.grounded ? sw * 0.7 : -0.5; this.legs[1].rotation.x = this.grounded ? -sw * 0.7 : 0.3;
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT > 0) {
      const w = Math.sin(this.t * 26) * 0.28;
      this.arms[0].rotation.set(w, 0, -2.5 + w * 0.4); this.arms[1].rotation.set(-w, 0, 2.5 - w * 0.4);
      this.head.rotation.z = Math.sin(this.t * 8) * 0.12;
    } else if (!this.grounded) {
      this.arms[0].rotation.set(0, 0, -2.2); this.arms[1].rotation.set(0, 0, 2.2); this.head.rotation.z = 0;
    } else {
      this.arms[0].rotation.set(-0.35 - sw * 0.7, 0, -0.85 - Math.sin(this.t * 2) * 0.04); this.arms[1].rotation.set(-0.35 + sw * 0.7, 0, 0.85 + Math.sin(this.t * 2) * 0.04);
      this.head.rotation.z = moving ? Math.sin(this.walk) * 0.06 : Math.sin(this.t * 1.6) * 0.04;
    }
    const tailSwing = moving ? Math.sin(this.walk * 2) * 0.18 : Math.sin(this.t * 1.8) * 0.06;
    const lift = !this.grounded ? (this.vy > 0 ? -0.3 : 0.35) : 0;
    this.tails[0].rotation.set(moving ? -0.35 * Math.min(1, speed / SPEED) : 0, 0, -0.35 - tailSwing - lift);
    this.tails[1].rotation.set(moving ? -0.35 * Math.min(1, speed / SPEED) : 0, 0, 0.35 - tailSwing + lift);
    const g2 = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.01);
    if (g2) {
      this.shadow.setEnabled(true); this.shadow.position.set(this.pos.x, g2.top + 0.03, this.pos.z);
      const s = Math.max(0.35, 1 - (this.pos.y - g2.top) * 0.25); this.shadow.scaling.set(s, s, s);
    } else this.shadow.setEnabled(false);
    return jumped;
  }
}

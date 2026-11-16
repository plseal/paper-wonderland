import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { CollisionWorld } from '../core/Collision';
import soraUrl from '../assets/sora.webp';

export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.3;
const SPEED = 5.2, JUMP_V = 7.4, GRAVITY = 20;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

/**
 * そらちゃん: the user's watercolor origami bunny as a real sheet of paper.
 * The photo cut-out is on the front & back, with several white "paper core"
 * layers in between so the edge thickness shows when the card turns.
 */
/** What Game needs from a playable character. */
export interface Avatar {
  pos: Vector3;
  grounded: boolean;
  groundId: string;
  lastSafe: Vector3;
  casters: Mesh[];
  teleport(p: Vector3): void;
  update(dt: number, move: { x: number; z: number }, jump: boolean, camYaw: number, world: CollisionWorld): boolean;
}

export class Player implements Avatar {
  root: TransformNode;
  card: TransformNode;
  pos = new Vector3(0, 0, 0);
  vel = new Vector3();
  vy = 0;
  grounded = true;
  groundId = '';
  facing = 0; // yaw offset relative to camera
  private t = 0;
  private hop = 0;
  private landSquash = 0;
  shadow: Mesh;
  casters: Mesh[] = [];
  lastSafe = new Vector3();

  static async create(scene: Scene) {
    const img = await loadImage(soraUrl);
    return new Player(scene, img);
  }

  private constructor(scene: Scene, img: HTMLImageElement) {
    this.root = new TransformNode('sora', scene);
    this.card = new TransformNode('soraCard', scene);
    this.card.parent = this.root;
    const h = PLAYER_HEIGHT, w = h * (img.width / img.height);

    const face = new Texture(soraUrl, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    face.hasAlpha = true;
    const faceMat = new StandardMaterial('soraFace', scene);
    faceMat.diffuseTexture = face;
    faceMat.useAlphaFromDiffuseTexture = true;
    faceMat.transparencyMode = 1;
    faceMat.alphaCutOff = 0.5;
    faceMat.specularColor = new Color3(0.05, 0.05, 0.06);
    faceMat.emissiveColor = new Color3(0.5, 0.5, 0.52);
    faceMat.twoSidedLighting = true;

    // paper core: silhouette of the bunny filled with off-white paper
    const core = new DynamicTexture('soraCore', { width: 256, height: 256 }, scene, true);
    const ctx = core.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(img, 0, 0, 256, 256);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#f3effa';
    ctx.fillRect(0, 0, 256, 256);
    core.hasAlpha = true;
    core.update();
    const coreMat = new StandardMaterial('soraCoreMat', scene);
    coreMat.diffuseTexture = core;
    coreMat.useAlphaFromDiffuseTexture = true;
    coreMat.transparencyMode = 1;
    coreMat.alphaCutOff = 0.5;
    coreMat.backFaceCulling = false;
    coreMat.emissiveColor = new Color3(0.35, 0.33, 0.4);
    coreMat.specularColor = Color3.Black();

    const thick = 0.07, layers = 6;
    for (let i = 0; i < layers; i++) {
      const z = -thick / 2 + (thick * i) / (layers - 1);
      const p = CreatePlane('soraL' + i, { width: w, height: h, sideOrientation: i === 0 || i === layers - 1 ? Mesh.FRONTSIDE : Mesh.DOUBLESIDE }, scene);
      p.position.set(0, h / 2, z);
      if (i === 0) { p.material = faceMat; this.casters.push(p); }
      else if (i === layers - 1) { p.material = faceMat; p.rotation.y = Math.PI; }
      else p.material = coreMat;
      p.parent = this.card;
      p.isPickable = false;
    }

    // soft blob shadow
    const dt = new DynamicTexture('blob', { width: 64, height: 64 }, scene, false);
    const c2 = dt.getContext() as unknown as CanvasRenderingContext2D;
    const g = c2.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(60,40,110,0.45)'); g.addColorStop(1, 'rgba(60,40,110,0)');
    c2.fillStyle = g; c2.fillRect(0, 0, 64, 64); dt.hasAlpha = true; dt.update();
    const sm = new StandardMaterial('blobMat', scene);
    sm.diffuseTexture = dt; sm.useAlphaFromDiffuseTexture = true; sm.disableLighting = true; sm.emissiveColor = Color3.White();
    this.shadow = CreateDisc('blobShadow', { radius: 0.6, tessellation: 20 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = sm;
    this.shadow.isPickable = false;
  }

  teleport(p: Vector3) { this.pos.copyFrom(p); this.vy = 0; this.vel.setAll(0); this.lastSafe.copyFrom(p); }

  /** Simulate one step. `move` is world-space desired direction (len ≤ 1). Returns true if jumped. */
  update(dt: number, move: { x: number; z: number }, jump: boolean, camYaw: number, world: CollisionWorld) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 12);
    this.vel.x += (move.x * SPEED - this.vel.x) * k;
    this.vel.z += (move.z * SPEED - this.vel.z) * k;
    let jumped = false;
    if (jump && this.grounded) { this.vy = JUMP_V; this.grounded = false; jumped = true; }
    const prevY = this.pos.y;
    this.vy -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    // use the higher of last/current feet height so gravity's tiny per-frame dip never counts as 'inside' the ground
    world.resolve(this.pos, PLAYER_RADIUS, PLAYER_HEIGHT, Math.max(prevY, this.pos.y));
    const ground = world.groundAt(this.pos.x, this.pos.z, Math.max(prevY, this.pos.y));
    const wasGrounded = this.grounded;
    if (ground && this.pos.y <= ground.top + (wasGrounded && this.vy <= 0 ? 0.3 : 0) && this.vy <= 0) {
      if (!wasGrounded && this.vy < -6) this.landSquash = 1;
      this.pos.y = ground.top; this.vy = 0; this.grounded = true; this.groundId = ground.id;
      if (ground.id.startsWith('ground')) this.lastSafe.copyFrom(this.pos);
    } else {
      this.grounded = false;
    }

    // ---- visuals: hop + squash + turn so the paper edge shows ----
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.4;
    this.hop = moving && this.grounded ? this.hop + dt * 11 : 0;
    const hopY = moving && this.grounded ? Math.abs(Math.sin(this.hop)) * 0.22 : 0;
    this.landSquash = Math.max(0, this.landSquash - dt * 4);
    // lateral component relative to camera → turn the card up to ~40°
    const right = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
    const lateral = speed > 0.1 ? (this.vel.x * right.x + this.vel.z * right.z) / SPEED : 0;
    const targetFacing = -lateral * 0.7 + Math.sin(this.t * 1.3) * 0.06;
    this.facing += (targetFacing - this.facing) * (1 - Math.exp(-dt * 8));
    this.root.position.set(this.pos.x, this.pos.y + hopY, this.pos.z);
    this.root.rotation.y = camYaw + this.facing;
    const breathe = moving ? 0 : Math.sin(this.t * 3) * 0.025;
    const stretch = !this.grounded ? 0.08 : 0;
    const sq = moving && this.grounded ? (1 - Math.abs(Math.sin(this.hop))) * 0.1 : 0;
    this.card.scaling.set(1 + sq * 0.6 + this.landSquash * 0.15, 1 - sq + breathe + stretch - this.landSquash * 0.2, 1);
    this.card.rotation.z = moving ? Math.sin(this.hop) * 0.08 : Math.sin(this.t * 1.7) * 0.03;
    this.card.rotation.x = moving ? 0.08 : 0;
    // blob shadow on whatever is below
    const g2 = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.01);
    if (g2) {
      this.shadow.setEnabled(true);
      this.shadow.position.set(this.pos.x, g2.top + 0.02, this.pos.z);
      const s = Math.max(0.35, 1 - (this.pos.y - g2.top) * 0.25);
      this.shadow.scaling.set(s, s, s);
    } else this.shadow.setEnabled(false);
    return jumped;
  }
}

import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { cutoutMat, paperMat, rng } from './PaperTexture';

/** Scene, soft pastel lighting, shadows, fog and the layered paper backdrop. */
export class World {
  scene: Scene;
  shadows: ShadowGenerator;
  sun: DirectionalLight;
  clouds: Mesh[] = [];
  /** Parent of the paper mountains + clouds; levels may move it to follow the player. */
  backdrop!: TransformNode;

  constructor(engine: Engine) {
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.84, 0.82, 0.97, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.35);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.86, 0.84, 0.97);
    scene.fogStart = 38; scene.fogEnd = 110;
    scene.skipPointerMovePicking = true;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), scene);
    hemi.intensity = 0.72;
    hemi.diffuse = new Color3(1, 0.98, 1);
    hemi.groundColor = new Color3(0.62, 0.58, 0.8);

    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.55), scene);
    this.sun.position = new Vector3(18, 40, -20);
    this.sun.intensity = 0.62;
    this.sun.diffuse = new Color3(1, 0.96, 0.9);
    this.sun.shadowMinZ = 1; this.sun.shadowMaxZ = 120;

    this.shadows = new ShadowGenerator(1024, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.004;
    this.shadows.normalBias = 0.02;
    this.shadows.darkness = 0.35;
    this.shadows.transparencyShadow = true;

    this.buildBackdrop();
  }

  cast(...meshes: AbstractMesh[]) {
    for (const m of meshes) {
      this.shadows.addShadowCaster(m, true);
    }
  }
  receive(...meshes: AbstractMesh[]) { for (const m of meshes) m.receiveShadows = true; }

  /** Diorama style: rings of cut-paper mountain silhouettes + paper clouds. */
  private buildBackdrop() {
    const scene = this.scene;
    this.backdrop = new TransformNode('backdrop', scene);
    const layers = [
      { r: 62, col: '#b6aee8', h: 15, seed: 1 },
      { r: 78, col: '#c7c0f0', h: 21, seed: 2 },
      { r: 95, col: '#d6d2f6', h: 28, seed: 3 },
    ];
    for (const L of layers) {
      const mat = cutoutMat(scene, 'mount' + L.seed, L.col, 512, 128, (ctx) => {
        const r = rng(L.seed * 99);
        ctx.beginPath(); ctx.moveTo(0, 128);
        let x = 0;
        while (x < 512) {
          const peak = 20 + r() * 70, wdt = 40 + r() * 80;
          ctx.lineTo(x + wdt / 2, peak); ctx.lineTo(x + wdt, 70 + r() * 40);
          x += wdt;
        }
        ctx.lineTo(512, 128); ctx.closePath(); ctx.fill();
      }, { seed: L.seed, tints: ['rgba(255,255,255,0.35)', 'rgba(120,110,210,0.15)'] });
      mat.disableLighting = true;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.fogEnabled = false;
      const n = 10;
      const ring: Mesh[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const w = 2 * L.r * Math.tan(Math.PI / n) * 1.02;
        const p = CreatePlane('mt', { width: w, height: L.h }, scene);
        p.material = mat;
        p.position.set(Math.sin(a) * L.r, L.h / 2 - 3, 10 + Math.cos(a) * L.r);
        p.rotation.y = a;
        ring.push(p);
      }
      const merged = Mesh.MergeMeshes(ring, true, true);
      if (merged) { merged.isPickable = false; merged.parent = this.backdrop; }
    }
    // clouds: soft paper discs
    const cm = paperMat(scene, 'cloud', '#ffffff', { seed: 9, emissive: 0.6, tints: ['rgba(200,190,255,0.25)'] });
    const r = rng(42);
    for (let i = 0; i < 9; i++) {
      const c = CreateDisc('cloud', { radius: 3 + r() * 3, tessellation: 7 }, scene);
      c.material = cm;
      c.scaling.y = 0.45;
      c.position.set(-50 + r() * 100, 16 + r() * 10, 30 + r() * 40);
      c.billboardMode = Mesh.BILLBOARDMODE_Y;
      c.isPickable = false;
      c.parent = this.backdrop;
      this.clouds.push(c);
    }
  }

  update(t: number) {
    this.clouds.forEach((c, i) => { c.position.x += Math.sin(t * 0.1 + i) * 0.004 + 0.006; if (c.position.x > 60) c.position.x = -60; });
  }
}

import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

/** Paper-confetti particle bursts (one shared texture, short-lived systems). */
export class Effects {
  private tex: DynamicTexture;
  constructor(private scene: Scene) {
    this.tex = new DynamicTexture('confetti', { width: 64, height: 64 }, scene, false);
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#fff';
    // little paper star
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 12 : 28;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    this.tex.hasAlpha = true;
    this.tex.update();
  }

  burst(at: Vector3, opts: { count?: number; colors?: [Color4, Color4]; power?: number; size?: number; life?: number; up?: number } = {}) {
    const ps = new ParticleSystem('burst', opts.count ?? 40, this.scene);
    ps.particleTexture = this.tex;
    ps.emitter = at.clone();
    ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
    ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
    const [c1, c2] = opts.colors ?? [new Color4(1, 0.86, 0.45, 1), new Color4(0.75, 0.68, 1, 1)];
    ps.color1 = c1; ps.color2 = c2; ps.colorDead = new Color4(1, 1, 1, 0);
    ps.minSize = (opts.size ?? 0.25) * 0.6; ps.maxSize = opts.size ?? 0.25;
    ps.minLifeTime = (opts.life ?? 0.9) * 0.6; ps.maxLifeTime = opts.life ?? 0.9;
    ps.manualEmitCount = opts.count ?? 40;
    ps.direction1 = new Vector3(-1, opts.up ?? 1.5, -1);
    ps.direction2 = new Vector3(1, (opts.up ?? 1.5) + 1, 1);
    ps.minEmitPower = (opts.power ?? 3) * 0.5; ps.maxEmitPower = opts.power ?? 3;
    ps.gravity = new Vector3(0, -6, 0);
    ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.targetStopDuration = (opts.life ?? 0.9) + 0.2;
    ps.disposeOnStop = true;
    ps.start();
    return ps;
  }
}

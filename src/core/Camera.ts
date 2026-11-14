import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

/** Third-person follow camera with smoothing, user yaw (Q/R keys or drag) and focus overrides for cut-scenes. */
export class CameraController {
  cam: FreeCamera;
  yaw = 0;
  pitch = 0.42;
  dist = 9.5;
  private target = new Vector3();
  private focus: { p: Vector3; until: number } | null = null;
  private time = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.cam = new FreeCamera('cam', new Vector3(0, 5, -10), scene);
    this.cam.fov = 0.9;
    this.cam.minZ = 0.1;
    this.cam.maxZ = 250;
    // drag to orbit (mouse / one finger outside the touch controls)
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.yaw += (e.clientX - lastX) * 0.006;
      lastX = e.clientX;
    });
  }

  /** Temporarily look at a point (e.g. the bridge folding or the gate opening). */
  showPoint(p: Vector3, seconds: number) { this.focus = { p: p.clone(), until: this.time + seconds }; }
  get inCutscene() { return !!this.focus; }

  update(dt: number, follow: Vector3, turn: number, snap = false) {
    this.time += dt;
    this.yaw += turn * dt * 1.8;
    let want = follow.add(new Vector3(0, 1.1, 0));
    let dist = this.dist;
    if (this.focus) {
      if (this.time > this.focus.until) this.focus = null;
      else { want = this.focus.p; dist = this.dist * 1.25; }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    this.target = Vector3.Lerp(this.target, want, k);
    const cp = Math.cos(this.pitch);
    const desired = this.target.add(new Vector3(-Math.sin(this.yaw) * cp * dist, Math.sin(this.pitch) * dist, -Math.cos(this.yaw) * cp * dist));
    this.cam.position = snap ? desired : Vector3.Lerp(this.cam.position, desired, k);
    this.cam.setTarget(this.target);
  }
}

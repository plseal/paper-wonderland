/** Keyboard + touch input merged into one axis + edge-triggered buttons. */
export class Input {
  keys = new Set<string>();
  touchAxis = { x: 0, y: 0 };
  private jumpQueued = false;
  private actQueued = false;
  camYawDelta = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter')) { e.preventDefault(); return; }
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'KeyF') this.actQueued = true;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  axis() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    x += this.touchAxis.x; y += this.touchAxis.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  /** Q / R orbit the camera (E is reserved for interacting). */
  camTurn() { let t = 0; if (this.keys.has('KeyQ')) t += 1; if (this.keys.has('KeyR')) t -= 1; return t; }
  pressJump() { this.jumpQueued = true; }
  pressAct() { this.actQueued = true; }
  consumeJump() { const j = this.jumpQueued; this.jumpQueued = false; return j; }
  consumeAct() { const a = this.actQueued; this.actQueued = false; return a; }
  clearEdges() { this.jumpQueued = false; this.actQueued = false; }
}

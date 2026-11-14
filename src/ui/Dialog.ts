export interface DialogLine { who: string; text: string; }

/** Paper speech box with typewriter text. Click / Space / E / Enter to advance. */
export class Dialog {
  el: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private lines: DialogLine[] = [];
  private i = 0;
  private shown = 0;
  private full = '';
  private acc = 0;
  private onDone?: () => void;
  open = false;
  onType?: () => void;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dialog paper-card hidden';
    this.el.innerHTML = '<div class="name"></div><div class="text"></div><div class="next">▼ つぎへ</div>';
    this.nameEl = this.el.querySelector('.name')!;
    this.textEl = this.el.querySelector('.text')!;
    this.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.advance(); });
    root.appendChild(this.el);
  }

  show(lines: DialogLine[], onDone?: () => void) {
    this.lines = lines; this.i = 0; this.onDone = onDone; this.open = true;
    this.el.classList.remove('hidden');
    this.setLine();
  }

  private setLine() {
    const l = this.lines[this.i];
    this.nameEl.textContent = l.who;
    this.nameEl.classList.toggle('sora', l.who === 'そらちゃん');
    this.full = l.text; this.shown = 0; this.acc = 0;
    this.textEl.textContent = '';
  }

  advance() {
    if (!this.open) return;
    if (this.shown < this.full.length) { this.shown = this.full.length; this.textEl.textContent = this.full; return; }
    this.i++;
    if (this.i >= this.lines.length) {
      this.open = false;
      this.el.classList.add('hidden');
      const cb = this.onDone; this.onDone = undefined; cb?.();
    } else this.setLine();
  }

  update(dt: number) {
    if (!this.open || this.shown >= this.full.length) return;
    this.acc += dt * 32;
    const n = Math.min(this.full.length, Math.floor(this.acc));
    if (n > this.shown) { this.shown = n; this.textEl.textContent = this.full.slice(0, n); if (n % 2 === 0) this.onType?.(); }
  }
}

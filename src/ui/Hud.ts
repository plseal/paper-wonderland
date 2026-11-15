import type { Input } from '../core/Input';

/** Star counter, quest line, contextual prompt, toasts, sound toggle and touch controls. */
export class Hud {
  el: HTMLDivElement;
  private stars: HTMLElement;
  private quest: HTMLElement;
  private prompt: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  touch: HTMLDivElement;
  private actBtn: HTMLButtonElement;
  touchMode: boolean;

  constructor(root: HTMLElement, input: Input, onMute: () => boolean) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="box paper-card stars">★ <b id="starCount">0</b> / <span id="starTotal">5</span></div>
      <div class="box paper-card quest"><small>やること</small><span id="questText"></span></div>
      <div class="right"><button class="icon-btn" id="muteBtn" aria-label="おと">🔊</button></div>`;
    root.appendChild(this.el);
    this.stars = this.el.querySelector('#starCount')!;
    this.quest = this.el.querySelector('#questText')!;
    const mute = this.el.querySelector('#muteBtn') as HTMLButtonElement;
    mute.addEventListener('click', () => { mute.textContent = onMute() ? '🔇' : '🔊'; });

    this.prompt = document.createElement('div');
    this.prompt.className = 'prompt paper-card hidden';
    root.appendChild(this.prompt);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast paper-card hidden';
    this.toastEl.id = 'toast';
    root.appendChild(this.toastEl);

    // ---- touch controls: virtual joystick + jump + interact ----
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch');
    this.touch = document.createElement('div');
    this.touch.className = 'touch';
    this.touch.innerHTML = `
      <div class="joy" id="joy"><div class="knob"></div></div>
      <button class="tbtn act" id="actBtn">はなす</button>
      <button class="tbtn jump" id="jumpBtn">ジャンプ</button>`;
    root.appendChild(this.touch);
    const joy = this.touch.querySelector('#joy') as HTMLDivElement, knob = joy.querySelector('.knob') as HTMLDivElement;
    let pid = -1;
    const setFrom = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2 - 10;
      let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy);
      if (l > max) { dx = (dx / l) * max; dy = (dy / l) * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / max, ny = -dy / max;
      const dead = Math.hypot(nx, ny) < 0.15;
      input.touchAxis.x = dead ? 0 : nx; input.touchAxis.y = dead ? 0 : ny;
    };
    joy.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { joy.setPointerCapture(pid); } catch { /* synthetic pointer */ } setFrom(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) setFrom(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; knob.style.transform = ''; input.touchAxis.x = input.touchAxis.y = 0; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    const jb = this.touch.querySelector('#jumpBtn') as HTMLButtonElement;
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.pressJump(); });
    this.actBtn = this.touch.querySelector('#actBtn') as HTMLButtonElement;
    this.actBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.pressAct(); });
  }

  show(on: boolean) {
    this.el.style.display = on ? 'flex' : 'none';
    this.touch.classList.toggle('on', on && this.touchMode);
    if (!on) this.setPrompt(null);
  }
  setStars(n: number, total = 5) {
    this.stars.textContent = String(n);
    const t = this.el.querySelector('#starTotal');
    if (t && t.textContent !== String(total)) t.textContent = String(total);
  }
  private creditsEl?: HTMLDivElement;
  /** Small map-style attribution line (bottom right) shown while playing. */
  setCredits(text: string) {
    if (!this.creditsEl) {
      this.creditsEl = document.createElement('div');
      this.creditsEl.className = 'credits-line';
      this.creditsEl.id = 'creditsLine';
      this.el.appendChild(this.creditsEl);
    }
    this.creditsEl.textContent = text;
    this.creditsEl.style.display = text ? '' : 'none';
  }
  setQuest(t: string) { if (this.quest.textContent !== t) this.quest.textContent = t; }
  setPrompt(label: string | null) {
    if (!label) { this.prompt.classList.add('hidden'); this.actBtn.classList.remove('ready'); this.actBtn.textContent = 'はなす'; return; }
    this.prompt.textContent = this.touchMode ? `🖐 ${label}` : `E： ${label}`;
    this.prompt.classList.remove('hidden');
    this.actBtn.classList.add('ready');
    this.actBtn.textContent = label.includes('レバー') ? 'つかう' : 'はなす';
  }
  toast(msg: string, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    // restart pop animation
    this.toastEl.style.animation = 'none'; void this.toastEl.offsetWidth; this.toastEl.style.animation = '';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }
}

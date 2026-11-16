import soraUrl from '../assets/sora.webp';
import type { LevelId } from '../levels/Level';

/** Title screen (with level choice) + clear screen (HTML overlays styled like paper cards). */
export class Menu {
  title: HTMLDivElement;
  clear: HTMLDivElement;
  loading: HTMLDivElement;
  constructor(root: HTMLElement, onStart: (id: LevelId) => void, onRetry: () => void, onTitle: () => void) {
    this.loading = document.createElement('div');
    this.loading.className = 'screen';
    this.loading.id = 'loading';
    this.loading.innerHTML = '<div class="panel paper-card"><p>よみこみ ちゅう…</p></div>';
    root.appendChild(this.loading);

    this.title = document.createElement('div');
    this.title.className = 'screen hidden';
    this.title.id = 'title';
    this.title.innerHTML = `
      <div class="panel paper-card">
        <img class="hero" src="${soraUrl}" alt="そらちゃん" />
        <h1>そらちゃんの<br/>かみの ぼうけん</h1>
        <div class="sub">PAPER WONDERLAND</div>
        <p>どこへ いく？ ステージを えらんでね。</p>
        <div class="stages">
          <button class="btn stage" id="startBtn"><span class="ico">🌲</span>かみの もり<small>コンの ほしを さがそう</small></button>
          <button class="btn stage city" id="koiwaBtn"><span class="ico">🚃</span>こいわの まち<small>こいわえき きたぐち 1km</small><em>NEW</em></button>
        </div>
        <p class="controls-hint">
          <kbd>W A S D</kbd> / <kbd>←↑↓→</kbd> いどう　<kbd>Space</kbd> ジャンプ<br/>
          <kbd>E</kbd> はなす・つかう　<kbd>Q</kbd><kbd>R</kbd> / ドラッグ カメラ
        </p>
        <p class="credits">「こいわの まち」の たてもの：3D都市モデル（Project PLATEAU）東京都23区（国土交通省）を加工して作成<br/>みち・せんろ・こうえん：© OpenStreetMap contributors (ODbL)</p>
      </div>`;
    root.appendChild(this.title);
    this.title.querySelector('#startBtn')!.addEventListener('click', () => onStart('forest'));
    this.title.querySelector('#koiwaBtn')!.addEventListener('click', () => onStart('koiwa'));

    this.clear = document.createElement('div');
    this.clear.className = 'screen hidden';
    this.clear.id = 'clear';
    this.clear.innerHTML = `
      <div class="panel paper-card">
        <img class="hero" src="${soraUrl}" alt="そらちゃん" />
        <h1 id="clearTitle">やったね！ クリア！</h1>
        <p id="clearText"></p>
        <div class="stats"><span>★ <b id="clearStars">5</b> / <span id="clearTotal">5</span></span><span>⏱ <b id="clearTime">0:00</b></span></div>
        <div class="card-wrap hidden" id="cardWrap">
          <img id="clearCard" alt="クリア カード" />
          <div class="card-btns">
            <button class="btn small save" id="saveCardBtn">がぞうを ほぞん</button>
            <button class="btn small share" id="shareCardBtn">シェア</button>
          </div>
        </div>
        <button class="btn" id="retryBtn">もういちど</button>
        <button class="btn sub-btn" id="titleBtn">ステージを えらぶ</button>
      </div>`;
    root.appendChild(this.clear);
    this.clear.querySelector('#retryBtn')!.addEventListener('click', onRetry);
    this.clear.querySelector('#titleBtn')!.addEventListener('click', onTitle);
    this.clear.querySelector('#saveCardBtn')!.addEventListener('click', () => this.saveCard());
    this.clear.querySelector('#shareCardBtn')!.addEventListener('click', () => this.shareCard());
  }

  /** current result card (PNG) – null for levels without a card */
  card: { blob: Blob; url: string; dataUrl: string } | null = null;
  private static FILE = 'sorachan-koiwa-clear.png';
  private static SHARE_TEXT = 'そらちゃんと こいわの まち を クリアしたよ！ ★ #PaperWonderland';
  private static SHARE_URL = 'https://plseal.github.io/paper-wonderland/';

  private async setCard(cv: HTMLCanvasElement | null) {
    const wrap = this.clear.querySelector('#cardWrap') as HTMLElement;
    if (this.card) URL.revokeObjectURL(this.card.url);
    this.card = null;
    this.clear.classList.toggle('with-card', !!cv);
    if (!cv) { wrap.classList.add('hidden'); return; }
    const { canvasToBlob } = await import('./ResultCard');
    const blob = await canvasToBlob(cv);
    const url = URL.createObjectURL(blob);
    this.card = { blob, url, dataUrl: cv.toDataURL('image/png') };
    (this.clear.querySelector('#clearCard') as HTMLImageElement).src = url;
    wrap.classList.remove('hidden');
  }

  saveCard() {
    if (!this.card) return;
    const a = document.createElement('a');
    a.href = this.card.url; a.download = Menu.FILE;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /** Web Share with the PNG when the browser supports files, otherwise an X (Twitter) post intent. */
  async shareCard() {
    const text = Menu.SHARE_TEXT, url = Menu.SHARE_URL;
    if (this.card && typeof File !== 'undefined' && navigator.canShare) {
      const file = new File([this.card.blob], Menu.FILE, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'そらちゃんと こいわの まち', text: text + ' ' + url }); return; }
        catch (e) { if ((e as Error).name === 'AbortError') return; }
      }
    }
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, '_blank', 'noopener');
  }
  ready() { this.loading.classList.add('hidden'); this.title.classList.remove('hidden'); }
  showLoading(on: boolean) { this.loading.classList.toggle('hidden', !on); }
  showTitle() { this.title.classList.remove('hidden'); }
  hideTitle() { this.title.classList.add('hidden'); }
  showClear(stars: number, secs: number, total = 5, title = 'やったね！ クリア！', text = '', card: HTMLCanvasElement | null = null) {
    void this.setCard(card);
    (this.clear.querySelector('#clearStars') as HTMLElement).textContent = String(stars);
    (this.clear.querySelector('#clearTotal') as HTMLElement).textContent = String(total);
    (this.clear.querySelector('#clearTitle') as HTMLElement).textContent = title;
    (this.clear.querySelector('#clearText') as HTMLElement).innerHTML = text;
    (this.clear.querySelector('#clearTime') as HTMLElement).textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
    this.clear.classList.remove('hidden');
  }
  hideClear() { this.clear.classList.add('hidden'); }
}

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
        <button class="btn" id="retryBtn">もういちど</button>
        <button class="btn sub-btn" id="titleBtn">ステージを えらぶ</button>
      </div>`;
    root.appendChild(this.clear);
    this.clear.querySelector('#retryBtn')!.addEventListener('click', onRetry);
    this.clear.querySelector('#titleBtn')!.addEventListener('click', onTitle);
  }
  ready() { this.loading.classList.add('hidden'); this.title.classList.remove('hidden'); }
  showLoading(on: boolean) { this.loading.classList.toggle('hidden', !on); }
  showTitle() { this.title.classList.remove('hidden'); }
  hideTitle() { this.title.classList.add('hidden'); }
  showClear(stars: number, secs: number, total = 5, title = 'やったね！ クリア！', text = '') {
    (this.clear.querySelector('#clearStars') as HTMLElement).textContent = String(stars);
    (this.clear.querySelector('#clearTotal') as HTMLElement).textContent = String(total);
    (this.clear.querySelector('#clearTitle') as HTMLElement).textContent = title;
    (this.clear.querySelector('#clearText') as HTMLElement).innerHTML = text;
    (this.clear.querySelector('#clearTime') as HTMLElement).textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
    this.clear.classList.remove('hidden');
  }
  hideClear() { this.clear.classList.add('hidden'); }
}

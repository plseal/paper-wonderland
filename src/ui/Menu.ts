import soraUrl from '../assets/sora.webp';

/** Title screen + clear screen (HTML overlays styled like paper cards). */
export class Menu {
  title: HTMLDivElement;
  clear: HTMLDivElement;
  loading: HTMLDivElement;
  constructor(root: HTMLElement, onStart: () => void, onRetry: () => void) {
    this.loading = document.createElement('div');
    this.loading.className = 'screen';
    this.loading.innerHTML = '<div class="panel paper-card"><p>よみこみ ちゅう…</p></div>';
    root.appendChild(this.loading);

    this.title = document.createElement('div');
    this.title.className = 'screen hidden';
    this.title.id = 'title';
    this.title.innerHTML = `
      <div class="panel paper-card">
        <img class="hero" src="${soraUrl}" alt="そらちゃん" />
        <h1>そらちゃんと<br/>かみの もり</h1>
        <div class="sub">PAPER WONDERLAND</div>
        <p>かみで できた もりで、<br/>とんで いった ほしを さがそう！</p>
        <button class="btn" id="startBtn">はじめる</button>
        <p class="controls-hint">
          <kbd>W A S D</kbd> / <kbd>←↑↓→</kbd> いどう　<kbd>Space</kbd> ジャンプ<br/>
          <kbd>E</kbd> はなす・つかう　<kbd>Q</kbd><kbd>R</kbd> / ドラッグ カメラ
        </p>
      </div>`;
    root.appendChild(this.title);
    this.title.querySelector('#startBtn')!.addEventListener('click', onStart);

    this.clear = document.createElement('div');
    this.clear.className = 'screen hidden';
    this.clear.id = 'clear';
    this.clear.innerHTML = `
      <div class="panel paper-card">
        <img class="hero" src="${soraUrl}" alt="そらちゃん" />
        <h1>やったね！ クリア！</h1>
        <p>もりの もんが ひらいて、<br/>コンも にっこり。ありがとう、そらちゃん！</p>
        <div class="stats"><span>★ <b id="clearStars">5</b> / 5</span><span>⏱ <b id="clearTime">0:00</b></span></div>
        <button class="btn" id="retryBtn">もういちど</button>
      </div>`;
    root.appendChild(this.clear);
    this.clear.querySelector('#retryBtn')!.addEventListener('click', onRetry);
  }
  ready() { this.loading.classList.add('hidden'); this.title.classList.remove('hidden'); }
  hideTitle() { this.title.classList.add('hidden'); }
  showClear(stars: number, secs: number) {
    (this.clear.querySelector('#clearStars') as HTMLElement).textContent = String(stars);
    (this.clear.querySelector('#clearTime') as HTMLElement).textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
    this.clear.classList.remove('hidden');
  }
  hideClear() { this.clear.classList.add('hidden'); }
}

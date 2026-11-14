import './style.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
(window as unknown as { __game: unknown }).__game = game.debug();
game.init().catch((e) => {
  console.error(e);
  ui.innerHTML = '<div class="screen"><div class="panel paper-card"><p>ごめんね、うまく ひらけなかったよ。<br/>ブラウザを かえて ためしてね。</p></div></div>';
});

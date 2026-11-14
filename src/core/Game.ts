import { Engine } from '@babylonjs/core/Engines/engine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Input } from './Input';
import { Sfx } from './Audio';
import { CameraController } from './Camera';
import { World } from '../world/World';
import { Effects } from '../world/Effects';
import { Player } from '../player/Player';
import { ForestLevel, START, STAR_TOTAL } from '../levels/ForestLevel';
import { Dialog, type DialogLine } from '../ui/Dialog';
import { Menu } from '../ui/Menu';
import { Hud } from '../ui/Hud';

type State = 'loading' | 'title' | 'play' | 'clear';

export class Game {
  engine: Engine;
  input = new Input();
  sfx = new Sfx();
  state: State = 'loading';
  world!: World;
  level!: ForestLevel;
  player!: Player;
  camera!: CameraController;
  effects!: Effects;
  dialog: Dialog;
  menu: Menu;
  hud: Hud;
  playTime = 0;
  private t = 0;

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.75));
    this.dialog = new Dialog(ui);
    this.dialog.onType = () => this.sfx.talk();
    this.menu = new Menu(ui, () => this.start(), () => this.retry());
    this.hud = new Hud(ui, this.input, () => (this.sfx.muted = !this.sfx.muted));
    window.addEventListener('resize', () => this.engine.resize());
  }

  async init() {
    await this.buildLevel();
    this.engine.runRenderLoop(() => this.frame());
    this.state = 'title';
    this.menu.ready();
  }

  private async buildLevel() {
    this.world = new World(this.engine);
    const scene = this.world.scene;
    this.effects = new Effects(scene);
    this.camera = new CameraController(scene, this.canvas);
    this.level = new ForestLevel(scene, this.world, {
      toast: (m, ms) => this.hud.toast(m, ms),
      dialog: (l, cb) => this.openDialog(l, cb),
      focus: (p, s) => this.camera.showPoint(p, s),
      sfx: this.sfx,
      effects: this.effects,
      onProgress: () => this.refreshHud(),
      onClear: () => this.clear(),
    });
    this.player = await Player.create(scene);
    this.world.cast(...this.player.casters);
    this.player.teleport(START);
    this.player.update(0.016, { x: 0, z: 0 }, false, 0, this.level.col);
    this.camera.update(0.016, this.player.pos, 0, true);
    await scene.whenReadyAsync();
  }

  private openDialog(lines: DialogLine[], cb?: () => void) { this.input.clearEdges(); this.dialog.show(lines, cb); }

  start() {
    this.sfx.unlock();
    this.menu.hideTitle();
    this.state = 'play';
    this.playTime = 0;
    this.hud.show(true);
    this.refreshHud();
    this.hud.toast('コンに はなしかけて みよう！', 2200);
    this.canvas.focus();
  }

  async retry() {
    this.menu.hideClear();
    this.engine.stopRenderLoop();
    this.world.scene.dispose();
    await this.buildLevel();
    this.engine.runRenderLoop(() => this.frame());
    this.start();
  }

  private clear() {
    this.state = 'clear';
    this.sfx.clear();
    this.hud.show(false);
    setTimeout(() => this.menu.showClear(this.level.starCount, this.playTime), 900);
  }

  refreshHud() {
    this.hud.setStars(this.level.starCount);
    this.hud.setQuest(this.level.questText());
  }

  private frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000 || 0.016);
    this.step(dt);
    this.world.scene.render();
  }

  /** One simulation step (exposed so tests can fast-forward deterministically). */
  step(dt: number) {
    this.t += dt;
    this.world.update(this.t);
    const playing = this.state === 'play';
    const frozen = !playing || this.dialog.open || this.camera.inCutscene;
    this.dialog.update(dt);
    if (this.dialog.open && (this.input.consumeAct() || this.input.consumeJump())) this.dialog.advance();

    let move = { x: 0, z: 0 }, jump = false;
    if (!frozen) {
      this.playTime += dt;
      const a = this.input.axis();
      const yaw = this.camera.yaw;
      move = { x: Math.sin(yaw) * a.y + Math.cos(yaw) * a.x, z: Math.cos(yaw) * a.y - Math.sin(yaw) * a.x };
      jump = this.input.consumeJump();
      const near = this.level.nearestInteractable(this.player.pos);
      this.hud.setPrompt(near ? near.label : null);
      if (this.input.consumeAct() && near) { this.hud.setPrompt(null); near.action(); }
    } else if (!this.dialog.open) this.input.clearEdges();
    if (frozen) this.hud.setPrompt(null);

    if (this.player.update(dt, move, jump, this.camera.yaw, this.level.col)) this.sfx.jump();
    if (this.player.pos.y < -1.6) {
      this.sfx.splash();
      this.effects.burst(new Vector3(this.player.pos.x, -0.4, this.player.pos.z), { count: 30, colors: [new Color4(0.75, 0.85, 1, 1), new Color4(1, 1, 1, 1)] });
      this.player.teleport(this.level.respawnPoint(this.player.lastSafe));
      this.hud.toast('ざぶん！ かわに おちちゃった');
    }
    this.level.update(dt, this.player.pos);
    this.camera.update(dt, this.player.pos, frozen ? 0 : this.input.camTurn());
    if (playing) this.refreshHud();
  }

  /** Debug / test hook (window.__game). */
  debug() {
    return {
      state: () => ({
        state: this.state, pos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z },
        grounded: this.player.grounded, groundId: this.player.groundId,
        stars: this.level.starCount, total: STAR_TOTAL, questStage: this.level.questStage,
        bridgeDown: this.level.bridgeDown, gateOpen: this.level.gateOpen, cleared: this.level.cleared,
        dialogOpen: this.dialog.open, cutscene: this.camera.inCutscene, camYaw: this.camera.yaw,
        stars3d: this.level.stars.map((s) => ({ x: s.base.x, y: s.base.y, z: s.base.z, got: s.got })),
        fps: this.engine.getFps(), activeMeshes: this.world.scene.getActiveMeshes().length, meshes: this.world.scene.meshes.length,
      }),
      teleport: (x: number, y: number, z: number) => this.player.teleport(new Vector3(x, y, z)),
      advanceDialog: () => this.dialog.advance(),
      _game: this,
    };
  }
}

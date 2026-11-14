# そらちゃんと かみの もり — Paper Wonderland (Level 1 MVP)

A 3D papercraft adventure for kids. The hero is **そらちゃん**, a real hand‑folded watercolor origami bunny, living in a forest made entirely of paper.

**Play:** https://plseal.github.io/paper-wonderland/

## Controls
| | Keyboard | Touch |
|---|---|---|
| Move | WASD / arrow keys | left joystick |
| Jump | Space | ジャンプ button |
| Talk / use | E (or Enter / F) | はなす / つかう button |
| Camera | Q / R, or drag | drag on the screen |

## Level 1: かみの もり
1. Talk to コン the paper fox → quest: find 5 paper stars.
2. The bridge is folded up like a card. Pull the lever → it folds 90° down across the river (only then is it walkable).
3. Collect the stars (one behind the house, two on top of big stones — jump!, two across the river).
4. With 5 stars the forest “unfolds”: a pop‑up gate and paper flowers stand up. Walk through the gate → クリア → もういちど.

## Tech
- Vite + TypeScript + Babylon.js (ES module imports, no physics engine; ~260 KB gzip JS).
- All scenery is procedural: low‑poly origami meshes + canvas‑painted paper textures (grain, fibres, watercolor blotches, fold creases), layered board edges, cut‑paper backdrop. Static meshes are merged per material.
- Custom lightweight collision (`src/core/Collision.ts`): walkable surfaces + blockers. The bridge is a `FoldPanel` (`src/world/Origami.ts`) rotating around a crease pivot; its wall/surface colliders swap when the fold finishes.

```
src/
  core/     Game, Camera, Input, Collision, Audio
  player/   Player (paper card bunny with layered edge thickness)
  world/    World (lights, shadows, backdrop), Origami (builders + FoldPanel), PaperTexture, Effects
  levels/   ForestLevel
  ui/       Menu, Dialog, Hud (+ touch controls)
```

## Dev
```
npm install
npm run dev        # local
npm run build      # dist/ (base = /paper-wonderland/)
npm run preview & npm test   # Playwright keyboard-only playthrough + screenshots in shots/
```

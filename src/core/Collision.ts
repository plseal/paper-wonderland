/**
 * Tiny custom collision world (no physics engine → small bundle, deterministic).
 * - Surfaces: axis-aligned walkable rectangles with a top height.
 * - Blockers: boxes / circles that push the player out horizontally while the
 *   player's feet are below the blocker's top (so low ones can be jumped onto).
 */
export type Enabled = () => boolean;

export interface Surface { id: string; minX: number; maxX: number; minZ: number; maxZ: number; top: number; enabled?: Enabled; }
export interface BoxBlocker { kind: 'box'; id: string; minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom?: number; enabled?: Enabled; }
export interface CircleBlocker { kind: 'circle'; id: string; x: number; z: number; r: number; top: number; bottom?: number; enabled?: Enabled; }
export type Blocker = BoxBlocker | CircleBlocker;

export const STEP = 0.35;

/** Extra collision provider (e.g. a spatially hashed set of city building footprints). */
export interface ExtraCollider { resolve(pos: { x: number; z: number }, radius: number, feetY: number): void; }

export class CollisionWorld {
  surfaces: Surface[] = [];
  blockers: Blocker[] = [];
  bounds = { minX: -16.5, maxX: 16.5, minZ: -19.5, maxZ: 39.5 };
  extras: ExtraCollider[] = [];

  addSurface(s: Surface) { this.surfaces.push(s); return s; }
  addBlocker(b: Blocker) { this.blockers.push(b); return b; }

  /** Highest enabled surface under (x,z) whose top is reachable from height y. */
  groundAt(x: number, z: number, y: number, r = 0): { top: number; id: string } | null {
    let best: { top: number; id: string } | null = null;
    for (const s of this.surfaces) {
      if (s.enabled && !s.enabled()) continue;
      if (x < s.minX - r || x > s.maxX + r || z < s.minZ - r || z > s.maxZ + r) continue;
      if (s.top > y + STEP) continue;
      if (!best || s.top > best.top) best = { top: s.top, id: s.id };
    }
    return best;
  }

  /** Push a cylinder (feet at y, given radius & height) out of blockers. Mutates pos. */
  resolve(pos: { x: number; y: number; z: number }, radius: number, height: number, feetY = pos.y) {
    for (let iter = 0; iter < 2; iter++) {
      for (const e of this.extras) e.resolve(pos, radius, feetY);
      for (const b of this.blockers) {
        if (b.enabled && !b.enabled()) continue;
        if (feetY >= b.top - 0.2) continue; // standing on / above it
        if (feetY + height <= (b.bottom ?? -100)) continue;
        if (b.kind === 'circle') {
          const dx = pos.x - b.x, dz = pos.z - b.z, d = Math.hypot(dx, dz), min = b.r + radius;
          if (d < min) {
            if (d > 1e-5) { const k = (min - d) / d; pos.x += dx * k; pos.z += dz * k; }
            else pos.x += min;
          }
        } else {
          const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
          const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
          const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
          if (d2 < radius * radius) {
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2), k = (radius - d) / d;
              pos.x += dx * k; pos.z += dz * k;
            } else {
              // centre inside the box: push out along the shallowest axis
              const pens = [
                [pos.x - b.minX + radius, -1, 0], [b.maxX - pos.x + radius, 1, 0],
                [pos.z - b.minZ + radius, 0, -1], [b.maxZ - pos.z + radius, 0, 1],
              ].sort((a, c) => a[0] - c[0])[0];
              pos.x += pens[0] * pens[1]; pos.z += pens[0] * pens[2];
            }
          }
        }
      }
    }
    const B = this.bounds;
    pos.x = Math.max(B.minX, Math.min(B.maxX, pos.x));
    pos.z = Math.max(B.minZ, Math.min(B.maxZ, pos.z));
  }
}

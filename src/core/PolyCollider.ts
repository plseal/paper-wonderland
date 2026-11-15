import type { ExtraCollider } from './Collision';

/**
 * Many static polygon footprints (city buildings, pillars) in a uniform grid.
 * Pushes the player's circle out of any polygon it overlaps. Also clamps the
 * player inside a circular play area.
 */
export class PolyCollider implements ExtraCollider {
  private polys: Float32Array[] = [];
  private tops: number[] = [];
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private frame = 1;
  constructor(private cell = 8, public limitR = Infinity) {}

  private key(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }

  /** pts: flat [x0,z0,x1,z1,...] (any winding) */
  add(pts: ArrayLike<number>, top = 1e9) {
    const id = this.polys.length;
    const p = Float32Array.from(pts as number[]);
    this.polys.push(p); this.tops.push(top);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
    }
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(id);
      }
    return id;
  }

  get count() { return this.polys.length; }

  /** true if (x,z) is inside (or within r of) any polygon */
  blocked(x: number, z: number, r = 0) {
    const q = { x, z };
    const ids = this.near(x, z, r);
    for (const id of ids) { const d = this.signedDist(this.polys[id], q.x, q.z); if (d < r) return true; }
    return false;
  }

  private near(x: number, z: number, r: number) {
    if (this.stamp.length < this.polys.length) this.stamp = new Uint32Array(this.polys.length + 64);
    this.frame++;
    const c = this.cell, out: number[] = [];
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const a = this.grid.get(this.key(ix, iz));
        if (!a) continue;
        for (const id of a) if (this.stamp[id] !== this.frame) { this.stamp[id] = this.frame; out.push(id); }
      }
    return out;
  }

  /** signed distance to polygon boundary (negative inside); also returns nearest point via this.nx/nz */
  private nx = 0; private nz = 0;
  private signedDist(p: Float32Array, x: number, z: number) {
    let inside = false, best = Infinity, bx = 0, bz = 0;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const ex = xi - xj, ez = zi - zj, l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - xj) * ex + (z - zj) * ez) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = xj + ex * t, cz = zj + ez * t, d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d2 < best) { best = d2; bx = cx; bz = cz; }
    }
    this.nx = bx; this.nz = bz;
    const d = Math.sqrt(best);
    return inside ? -d : d;
  }

  /** Fraction (0..1] of the segment a→b that is clear of polygons (3D, using polygon tops). */
  clearFraction(ax: number, ay: number, az: number, bx: number, by: number, bz: number, pad = 0.4) {
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(2, Math.ceil(L / 0.4));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
      for (const id of this.near(x, z, pad)) {
        if (y > this.tops[id] + pad) continue;
        if (this.signedDist(this.polys[id], x, z) < pad) return Math.max(0.15, (i - 1) / steps);
      }
    }
    return 1;
  }

  resolve(pos: { x: number; z: number }, radius: number, feetY: number) {
    for (const id of this.near(pos.x, pos.z, radius)) {
      if (feetY >= this.tops[id] - 0.2) continue;
      const d = this.signedDist(this.polys[id], pos.x, pos.z);
      if (d >= radius) continue;
      let dx = pos.x - this.nx, dz = pos.z - this.nz;
      const len = Math.hypot(dx, dz) || 1e-6;
      dx /= len; dz /= len;
      if (d < 0) { dx = -dx; dz = -dz; } // inside: nearest edge point lies outward
      const push = radius - d;
      pos.x += dx * push; pos.z += dz * push;
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > this.limitR) { pos.x *= this.limitR / r; pos.z *= this.limitR / r; }
  }
}

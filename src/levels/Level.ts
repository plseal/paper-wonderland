import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { CollisionWorld } from '../core/Collision';
import type { Interactable } from './ForestLevel';
import type { CardInfo } from '../ui/ResultCard';

export type LevelId = 'forest' | 'koiwa';

/** What Game needs from any level. */
export interface Level {
  id: LevelId;
  col: CollisionWorld;
  stars: { mesh: Mesh; base: Vector3; got: boolean }[];
  starTotal: number;
  start: Vector3;
  introToast: string;
  clearTitle: string;
  clearText: string;
  questStage: number;
  cleared: boolean;
  bridgeDown?: boolean;
  gateOpen?: boolean;
  readonly starCount: number;
  questText(): string;
  update(dt: number, p: Vector3): void;
  nearestInteractable(p: Vector3): Interactable | null;
  respawnPoint(lastSafe: Vector3): Vector3;
  /** Optional shareable clear card (Koiwa level only). */
  cardInfo?(secs: number): CardInfo;
}

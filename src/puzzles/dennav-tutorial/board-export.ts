import { clonePosition, positionCode, type Position, type Action } from './engine';
import { COLOUR_NAMES, OCTANT_NAMES } from '../navigation/create';
import type { BuildCheck } from './build-position';
import type { PlanCheck } from './planning';

export interface BoardExportContext {
  lesson: string;
  mode: string;
  feedback: string;
  phase: string;
  selectedRing: number;
  boardNumber?: number;
  seed?: number;
  initialPosition?: Position;
  action?: Action;
  validation?: BuildCheck | PlanCheck;
}

/** Keep both the portable board code and exact colours of already-wild targets. */
export function boardExport(position: Position, context: BoardExportContext): string {
  return JSON.stringify({
    format: 'dennav-tutorial-board', version: 1,
    legend: { colours: COLOUR_NAMES, rings: [4, 3, 2, 1], octants: OCTANT_NAMES, empty: -1 },
    code: positionCode(position), position: clonePosition(position),
    ...context,
  }, null, 2);
}

import { EMPTY, HEIGHT, PATTERNS, SailBoard, WIDTH, direction, oriented, shape, type Cell, type Target } from './board';

export type CreateTool = 'platform' | 'pair' | 'single' | 'blocker' | 'erase';
export interface Layout { cells: number[]; targets: Target[] }
export interface Brush { tool: CreateTool; colour: number; secondColour: number; direction: number; pattern: number }
export interface Placement { cells: Cell[]; target?: Target; error?: string }
export const blankLayout = (): Layout => ({ cells: Array<number>(WIDTH * HEIGHT).fill(EMPTY), targets: [] });
const clone = (layout: Layout): Layout => ({ cells: [...layout.cells], targets: layout.targets.map(t => ({ ...t })) });
const contains = (t: Target, x: number, y: number) => x >= t.x && x < t.x + shape(t)[0].length && y >= t.y - shape(t).length + 1 && y <= t.y;
const overlaps = (a: Target, b: Target) => a.x < b.x + shape(b)[0].length && b.x < a.x + shape(a)[0].length &&
  a.y - shape(a).length < b.y && b.y - shape(b).length < a.y;

/** Saved drafts must contain reciprocal connectors, including at board edges. */
export function readLayout(value: unknown): Layout | null {
  if (!value || typeof value !== 'object') return null;
  const { cells, targets } = value as Layout;
  if (!Array.isArray(cells) || cells.length !== WIDTH * HEIGHT || !cells.every(p => Number.isInteger(p) &&
    (p === EMPTY || (p >= 0 && p <= 245 && p % 8 <= 5 && (p & 24) <= 16)))) return null;
  if (!Array.isArray(targets) || targets.length > WIDTH * HEIGHT || !targets.every(t => t && Number.isInteger(t.type) &&
    t.type >= 0 && t.type < PATTERNS.length && Number.isInteger(t.x) && Number.isInteger(t.y) && t.enabled === true &&
    t.x >= 0 && t.x + shape(t)[0].length <= WIDTH && t.y < HEIGHT && t.y >= shape(t).length - 1)) return null;
  if (targets.some((t, i) => targets.slice(0, i).some(other => overlaps(t, other)))) return null;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const d = direction(cells[y * WIDTH + x]);
    if (d === EMPTY) continue;
    const nx = x + (d === 1 ? 1 : d === 5 ? -1 : 0), ny = y + (d === 3 ? 1 : d === 7 ? -1 : 0);
    if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT || direction(cells[ny * WIDTH + nx]) !== (d + 4) % 8) return null;
  }
  return clone({ cells, targets });
}

/** Draft edits never run gravity or clears. Replacing a half first disconnects its partner. */
export class SailingEditor {
  readonly board = new SailBoard(0, 0, false);
  private undoStack: Layout[] = [];
  private redoStack: Layout[] = [];
  constructor(layout = blankLayout()) { this.board.loadLayout(layout.cells, layout.targets); }
  snapshot(): Layout { return clone(this.board); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  preview(brush: Brush, x: number, y: number): Placement {
    if (!this.board.inBounds(x, y)) return { cells: [], error: 'Place inside the board.' };
    if (brush.tool === 'platform') {
      // The clicked cell is the top left of the pattern; the shelf sits beneath its bottom row.
      const target = { x, y: y + PATTERNS[brush.pattern].length - 1, type: brush.pattern, enabled: true };
      const rows = shape(target);
      const cells = rows.flatMap((row, dy) => row.flatMap((piece, dx) => piece === EMPTY ? [] : [{ x: x + dx, y: y + dy, piece }]));
      const error = x + rows[0].length > WIDTH || target.y >= HEIGHT ? 'The whole platform must fit on the board.' :
        this.board.targets.some(t => overlaps(t, target)) ? 'Platforms cannot overlap.' : undefined;
      return { cells, target, error };
    }
    if (brush.tool === 'erase') return { cells: [] };
    const cells = [{ x, y, piece: brush.colour * 8 + (brush.tool === 'blocker' ? 5 : 0) }];
    if (brush.tool === 'pair') {
      const d = brush.direction;
      cells[0].piece = oriented(cells[0].piece, d);
      cells.push({ x: x + (d === 1 ? 1 : d === 5 ? -1 : 0), y: y + (d === 3 ? 1 : d === 7 ? -1 : 0), piece: oriented(brush.secondColour * 8, (d + 4) % 8) });
    }
    return { cells, error: cells.some(c => !this.board.inBounds(c.x, c.y)) ? 'Both halves of the pair must fit on the board.' : undefined };
  }
  place(brush: Brush, x: number, y: number): string | null {
    const placement = this.preview(brush, x, y);
    if (placement.error) return placement.error;
    this.edit(() => {
      if (brush.tool === 'erase') {
        if (this.board.get(x, y) !== EMPTY) this.board.remove([{ x, y, piece: this.board.get(x, y) }]);
        else this.board.targets = this.board.targets.filter(t => !contains(t, x, y));
      } else if (placement.target) this.board.targets.push(placement.target);
      else {
        this.board.remove(placement.cells);
        for (const c of placement.cells) this.board.set(c.x, c.y, c.piece);
      }
    });
    return null;
  }
  clear(): void { this.edit(() => this.board.loadLayout(blankLayout().cells, [])); }
  undo(): void {
    const layout = this.undoStack.pop();
    if (layout) { this.redoStack.push(this.snapshot()); this.board.loadLayout(layout.cells, layout.targets); }
  }
  redo(): void {
    const layout = this.redoStack.pop();
    if (layout) { this.undoStack.push(this.snapshot()); this.board.loadLayout(layout.cells, layout.targets); }
  }
  private edit(change: () => void): void {
    const before = this.snapshot(); change();
    if (JSON.stringify(before) === JSON.stringify(this.snapshot())) return;
    this.undoStack.push(before); if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
}

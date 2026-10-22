import { BoardRandom } from '../forage/board';

export const COLS = 10;
export const ROWS = 11;
export const EMPTY = -1;
export const colourOf = (piece: number): number => piece & 15;
export const sparklesOf = (piece: number): number => piece >> 4;
export const emptyGrid = (): number[][] => Array.from({ length: ROWS }, () => Array<number>(COLS).fill(EMPTY));
export const copyGrid = (grid: number[][]): number[][] => grid.map(row => [...row]);

export interface Group { colour: number; cells: [number, number][]; sparkles: number[] }
export interface Motion { row: number; col: number; to: number; delay: number }
export interface Stage {
  reed: number;
  before: number[][];
  compressed: number[][];
  after: number[][];
  motions: Motion[];
  groups: Group[];
}
export interface Batten { stages: Stage[]; complete: boolean; booched: boolean }

export function difficultyInfo(level: number): { colours: number; target: number; gaps: boolean; special: boolean } {
  return { colours: level < 2 ? 2 : level < 5 ? 3 : 4,
    target: [5, 10, 15, 15, 25, 25, 25, 25, 25][level] ?? 25,
    gaps: level >= 3, special: level >= 4 };
}

/** A reed pushes every occupied column in a row together. The first blocked row stops it. */
export class WeaveBoard {
  /** Fixed for a dealt bolt; Freeplay can paste a loom from another difficulty. */
  difficulty: number;
  readonly rng: BoardRandom;
  pieces = emptyGrid();
  groupsCleared = 0;
  /** Freeplay mode: groups to finish the bolt instead of the difficulty's, Infinity for none. */
  goal: number | null = null;

  constructor(difficulty: number, seed: number | bigint) {
    this.difficulty = Math.max(0, Math.min(8, Math.trunc(difficulty)));
    this.rng = new BoardRandom(seed);
    for (let row = 7; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (this.rng.nextInt(6) === 0) this.pieces[row][col] = colourOf(this.nextPiece());
    }
    // The initial settlement also draws a shuttle; the opening draw replaces it.
    this.batten(0);
    this.groupsCleared = 0;
    this.fillShuttle();
  }

  get info() { return difficultyInfo(this.difficulty); }
  get target(): number { return this.goal ?? this.info.target; }
  get shuttle(): number[] { return this.pieces[0]; }
  get maxOffset(): number {
    for (let col = 3; col >= 0; col--) if (this.shuttle[col] !== EMPTY) return 9 - col;
    return 0;
  }

  private nextPiece(): number {
    const colour = this.rng.nextInt(this.info.colours);
    return colour | ((this.difficulty >= 4 && this.rng.nextInt(16) === 0 ? 4 : 0) << 4);
  }

  fillShuttle(): void {
    const row = this.shuttle;
    row.fill(EMPTY);
    row[0] = this.nextPiece();
    let size = 2 + Math.floor(this.rng.nextInt(5) / 2);
    if (this.difficulty === 0) size = 2;
    for (let i = 1; i < size; i++) {
      let col = i;
      if (this.difficulty >= 3) do { col = 1 + this.rng.nextInt(3); } while (row[col] !== EMPTY);
      row[col] = this.nextPiece();
    }
  }

  canBatten(row: number): boolean {
    return this.pieces[row].every((piece, col) => piece === EMPTY || this.pieces.slice(row + 1).some(r => r[col] === EMPTY));
  }

  isBattenable(offset: number): boolean {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.maxOffset) return false;
    const shuttle = this.shuttle;
    this.pieces[0] = Array.from({ length: COLS }, (_, col) => shuttle[col - offset] ?? EMPTY);
    const legal = this.canBatten(0);
    this.pieces[0] = shuttle;
    return legal;
  }

  isBooched(): boolean {
    for (let offset = 0; offset <= this.maxOffset; offset++) if (this.isBattenable(offset)) return false;
    return true;
  }

  private compress(): { reed: number; motions: Motion[] } {
    const ids = this.pieces.map((row, r) => row.map((p, c) => p === EMPTY ? -1 : r * COLS + c));
    const paths = new Map<number, Motion>();
    const push = (row: number, col: number, delay: number): void => {
      if (this.pieces[row][col] === EMPTY) return;
      if (this.pieces[row + 1][col] !== EMPTY) push(row + 1, col, delay);
      const id = ids[row][col];
      let path = paths.get(id);
      if (!path) { path = { row, col, to: row + 1, delay }; paths.set(id, path); }
      path.to = row + 1;
      this.pieces[row + 1][col] = this.pieces[row][col];
      this.pieces[row][col] = EMPTY;
      ids[row + 1][col] = id;
      ids[row][col] = -1;
    };
    let reed = 0;
    for (; reed < ROWS && this.canBatten(reed); reed++) {
      for (let col = 0; col < COLS; col++) push(reed, col, reed);
    }
    return { reed, motions: [...paths.values()] };
  }

  private destroyGroups(): Group[] {
    const visited = new Set<number>();
    const groups: Group[] = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (this.pieces[row][col] === EMPTY || visited.has(row * COLS + col)) continue;
      const group: Group = { colour: colourOf(this.pieces[row][col]), cells: [], sparkles: [] };
      const visit = (r: number, c: number): void => {
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS || visited.has(r * COLS + c) ||
          this.pieces[r][c] === EMPTY || colourOf(this.pieces[r][c]) !== group.colour) return;
        visited.add(r * COLS + c);
        group.cells.push([r, c]);
        const sparkle = sparklesOf(this.pieces[r][c]);
        if (sparkle > 0) group.sparkles.push(sparkle);
        visit(r - 1, c); visit(r + 1, c); visit(r, c - 1); visit(r, c + 1);
      };
      visit(row, col);
      if (group.cells.length >= 4) groups.push(group);
    }
    for (const group of groups) for (const [row, col] of group.cells) this.pieces[row][col] = EMPTY;
    return groups;
  }

  /** Resolve every chain, including surplus groups on the last move, before dealing again. */
  batten(offset: number): Batten {
    const shuttle = this.shuttle;
    this.pieces[0] = Array.from({ length: COLS }, (_, col) => shuttle[col - offset] ?? EMPTY);
    const stages: Stage[] = [];
    for (;;) {
      const before = copyGrid(this.pieces);
      const { reed, motions } = this.compress();
      const compressed = copyGrid(this.pieces);
      const groups = this.destroyGroups();
      stages.push({ reed, before, compressed, after: copyGrid(this.pieces), motions, groups });
      this.groupsCleared += groups.length;
      if (!groups.length) break;
    }
    const complete = this.groupsCleared >= this.target;
    if (!complete) this.fillShuttle();
    return { stages, complete, booched: !complete && this.isBooched() };
  }
}

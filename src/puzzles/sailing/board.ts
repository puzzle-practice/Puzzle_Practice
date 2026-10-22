import { BoardRandom } from '../forage/board';

export const WIDTH = 8, HEIGHT = 16, EMPTY = -1;
export const TARGET_MIN = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6];
export const TARGET_MAX = [1, 2, 3, 4, 5, 6, 6, 7, 7, 7];
export const FIXED_COUNT = [0, 0, 2, 4, 6, 7, 9, 10, 11, 13];
export const BONUS_SETS: readonly (readonly number[])[] = [[], [1, 2, 3, 4], [1, 2, 3, 4, 7]];
export const BONUS_NAMES = ['None', 'Circle', 'Diamond', 'Plus', 'Cross', 'Ring', 'Star', 'Blade'];
/** Rows run from top to bottom; a platform's y is its bottom row. */
export const PATTERNS: readonly (readonly (readonly number[])[])[] = [
  [[-1,0],[0,-1],[-1,0],[0,-1]], [[-1,8],[8,-1],[-1,8],[8,-1]], [[-1,16],[16,-1],[-1,16],[16,-1]],
  [[16,-1],[-1,16],[16,-1]], [[8,-1],[-1,8],[8,-1]], [[0,-1],[-1,0],[0,-1]],
  [[16,0],[0,16],[16,0]], [[0,8],[8,0],[0,8]], [[8,0],[0,8],[8,0]],
  [[16,8],[8,16],[16,8]], [[0,16],[16,0],[0,16]], [[8,16],[16,8],[8,16]],
  [[0,0],[0,0]], [[8,8],[8,8]], [[16,16],[16,16]],
  [[-1,-1,16],[-1,16,16],[16,16,16]], [[-1,-1,8],[-1,8,8],[8,8,8]], [[-1,-1,0],[-1,0,0],[0,0,0]],
  [[8,16],[16,8]], [[0,16],[16,0]], [[8,0],[0,8]], [[16,8],[8,16]], [[16,0],[0,16]], [[0,8],[8,0]],
  [[0,0],[8,8],[16,16]], [[0,0],[16,16],[8,8]], [[8,8],[0,0],[16,16]],
  [[8,8],[16,16],[0,0]], [[16,16],[0,0],[8,8]], [[16,16],[8,8],[0,0]],
  [[16,-1,-1],[8,16,-1],[0,8,16]], [[16,-1,-1],[0,16,-1],[8,0,16]],
  [[8,-1,-1],[16,8,-1],[0,16,8]], [[8,-1,-1],[0,8,-1],[16,0,8]],
  [[0,-1,-1],[16,0,-1],[8,16,0]], [[0,-1,-1],[8,0,-1],[16,8,0]],
];
export interface Target { x: number; y: number; type: number; enabled: boolean }
export interface Cell { x: number; y: number; piece: number }
export interface Fall extends Cell { to: number }
export interface Run { cells: Cell[]; bonus: number }
export const colour = (p: number) => p === EMPTY ? EMPTY : (p & 24) / 8;
export const bonus = (p: number) => p === EMPTY ? 0 : (p & 8160) >> 5;
export const fixed = (p: number) => p !== EMPTY && p % 8 === 5;
export const direction = (p: number) => [EMPTY, 3, 7, 5, 1][p % 8] ?? EMPTY;
export function oriented(p: number, d: number): number {
  return p % 8 < 5 ? Math.floor(p / 8) * 8 + ({ '-1': 0, 1: 4, 3: 1, 5: 3, 7: 2 }[d] ?? 0) : p;
}
export const shape = (t: Target) => PATTERNS[t.type];
export function targetCells(t: Target): Cell[] {
  const rows = shape(t);
  return rows.flatMap((row, dy) => row.flatMap((piece, dx) => piece === EMPTY ? [] : [{ x: t.x + dx, y: t.y - rows.length + 1 + dy, piece }]));
}
function targetPiece(t: Target, x: number, y: number): number {
  return shape(t)[y - t.y + shape(t).length - 1]?.[x - t.x] ?? EMPTY;
}
function touches(t: Target, other: Target): boolean {
  const rows = shape(t);
  for (let dy = 0; dy < rows.length; dy++) for (let dx = 0; dx < rows[0].length; dx++) {
    const x = t.x + dx, y = t.y - rows.length + 1 + dy;
    if ([[x,y],[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([a,b]) => targetPiece(other,a,b) !== EMPTY)) return true;
  }
  return false;
}

export class SailBoard {
  cells = Array<number>(WIDTH * HEIGHT).fill(EMPTY);
  targets: Target[] = [];
  readonly rng: BoardRandom;
  bonusMode = 0;
  desiredBonus = -1;
  next: number[] | null = null;
  private lastUnfilled = 0;

  constructor(seed: number, readonly difficulty: number, populate = true) {
    this.rng = new BoardRandom(seed);
    if (populate) this.populate();
  }
  get(x: number, y: number): number { return this.cells[y * WIDTH + x]; }
  set(x: number, y: number, p: number): void { this.cells[y * WIDTH + x] = p; }
  inBounds(x: number, y: number): boolean { return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT; }
  /** Install a draft and count only progress made after play starts. */
  loadLayout(cells: readonly number[], targets: readonly Target[]): void {
    this.cells = [...cells]; this.targets = targets.map(t => ({ ...t }));
    this.lastUnfilled = this.unfilled();
  }
  get remaining(): number { return this.targets.filter(t => t.enabled).length; }
  get blocked(): boolean { return this.get(3,0) !== EMPTY || this.get(4,0) !== EMPTY; }
  populate(): void {
    const min = TARGET_MIN[this.difficulty], range = TARGET_MAX[this.difficulty] - min;
    const count = min + (range > 0 ? this.rng.nextInt(range) : 0);
    for (let i = 0; i < count; i++) {
      let retries = 0;
      for (;;) {
        const type = this.rng.nextInt(PATTERNS.length), rows = PATTERNS[type];
        const t = { x: this.rng.nextInt(WIDTH - rows[0].length + 1),
          y: rows.length + 3 + this.rng.nextInt(HEIGHT - 4 - rows.length + 1), type, enabled: true };
        if (!this.targets.some(other => touches(other, t))) { this.targets.push(t); break; }
        if (retries++ > 30) break;
      }
    }
    this.lastUnfilled = this.unfilled();
    let countFixed = FIXED_COUNT[this.difficulty];
    if (countFixed > 0) countFixed += this.rng.nextInt(2);
    for (let i = 0; i < countFixed; i++) {
      let tries = 0;
      const piece = this.rng.nextInt(3) * 8 + 5;
      for (;;) {
        const x = this.rng.nextInt(WIDTH), y = this.rng.nextInt(HEIGHT - 4) + 4;
        if (tries++ > 30) return;
        if (this.get(x,y) !== EMPTY || this.targets.some(t => targetPiece(t,x,y) !== EMPTY)) continue;
        let vertical = 1, horizontal = 1;
        for (let a=y-1; a>=0 && this.get(x,a)===piece; a--) vertical++;
        for (let a=y+1; a<HEIGHT && this.get(x,a)===piece; a++) vertical++;
        for (let a=x-1; a>=0 && this.get(a,y)===piece; a--) horizontal++;
        for (let a=x+1; a<WIDTH && this.get(a,y)===piece; a++) horizontal++;
        if (vertical >= 4 || horizontal >= 4) continue;
        this.set(x,y,piece); break;
      }
    }
  }
  generatePair(): number[] {
    const pair = [this.rng.nextInt(3)*8, this.rng.nextInt(3)*8], set = BONUS_SETS[this.bonusMode] ?? [];
    if (set.length) {
      // The probability check still consumes a double when its probability is one.
      this.rng.next(26); this.rng.next(27);
      const token = set[this.rng.nextInt(set.length)];
      pair[this.rng.nextInt(2)] |= token << 5;
    }
    return pair;
  }
  nextPair(): number[] {
    const pair = this.next ?? this.generatePair();
    this.next = this.generatePair();
    return pair;
  }
  beneathTarget(x: number, y: number): boolean {
    return this.targets.some(t => t.enabled && x >= t.x && x < t.x + shape(t)[0].length && y === t.y + 1);
  }
  dropDistance(x: number, y: number): number {
    if (direction(this.get(x,y)) === 7 && this.beneathTarget(x,y)) return 0;
    let distance = 0;
    for (let row = y+1; row < HEIGHT; row++) {
      if (this.get(x,row) !== EMPTY || this.beneathTarget(x,row)) break;
      distance++;
    }
    return distance;
  }
  gravity(): Fall[] {
    const falls: Fall[] = [];
    for (let y=HEIGHT-1; y>=0; y--) for (let x=0; x<WIDTH; x++) {
      const p = this.get(x,y);
      if (p === EMPTY || fixed(p)) continue;
      const d = direction(p), left = d === 5 ? x-1 : x, right = d === 1 ? x+1 : x;
      let distance = HEIGHT-1;
      for (let col=left; col<=right; col++) distance = Math.min(distance, this.dropDistance(col,y));
      if (!distance) continue;
      for (let col=left; col<=right; col++) {
        const piece = this.get(col,y);
        this.set(col,y,EMPTY); this.set(col,y+distance,piece);
        falls.push({ x: col, y, to: y+distance, piece });
      }
    }
    return falls;
  }
  breakConstraint(x: number, y: number): void {
    const p = this.get(x,y), d = direction(p);
    if (d === EMPTY) return;
    this.set(x,y,oriented(p,EMPTY));
    const nx = x + (d===1 ? 1 : d===5 ? -1 : 0), ny = y + (d===3 ? 1 : d===7 ? -1 : 0);
    if (this.inBounds(nx,ny)) this.set(nx,ny,oriented(this.get(nx,ny),EMPTY));
  }
  remove(cells: readonly Cell[]): void {
    for (const {x,y} of cells) if (this.get(x,y) !== EMPTY) { this.breakConstraint(x,y); this.set(x,y,EMPTY); }
  }
  completed(): Target[] {
    return this.targets.filter(t => t.enabled && targetCells(t).every(c => colour(this.get(c.x,c.y)) === colour(c.piece)));
  }
  lines(): Run[] {
    const runs: Run[] = [];
    const scan = (x: number, y: number, dx: number, dy: number): number => {
      const cells: Cell[] = [], p = this.get(x,y);
      if (p === EMPTY) return 1;
      for (; this.inBounds(x,y) && colour(this.get(x,y)) === colour(p); x+=dx,y+=dy) cells.push({x,y,piece:this.get(x,y)});
      if (cells.length >= 4) runs.push({cells, bonus:this.chooseBonus(cells, dy !== 0)});
      return cells.length;
    };
    for (let y=HEIGHT-1;y>=0;y--) for (let x=0;x<=WIDTH-4;) x+=scan(x,y,1,0);
    for (let x=0;x<WIDTH;x++) for (let y=HEIGHT-1;y>2;) y-=scan(x,y,0,-1);
    return runs;
  }
  /** Each platform or straight line selects at most one pair of matching shapes. */
  chooseBonus(cells: readonly Cell[], verticalLine = false): number {
    const candidates: number[] = [], sorted = [...cells].sort((a,b) => a.y-b.y || a.x-b.x);
    const at = new Map(cells.map(c => [c.y*WIDTH+c.x, bonus(this.get(c.x,c.y))]));
    for (const [dx,dy] of verticalLine ? [[0,1]] : [[1,0],[0,1]]) {
      // Finding the requested shape ends only the current row; later rows still add candidates.
      let skipRow = Number.NaN;
      for (const c of sorted) {
        if (c.y === skipRow) continue;
        const b = at.get(c.y*WIDTH+c.x) ?? 0;
        if (b && c.x+dx < WIDTH && b === at.get((c.y+dy)*WIDTH+c.x+dx)) {
          candidates.push(b);
          if (b === this.desiredBonus) { if (verticalLine) break; skipRow = c.y; }
        }
      }
    }
    if (!candidates.length) return 0;
    return candidates.includes(this.desiredBonus) ? candidates.at(-1)! : candidates[this.rng.nextInt(candidates.length)];
  }
  unfilled(): number {
    return this.targets.filter(t=>t.enabled).reduce((n,t) => n+targetCells(t).filter(c=>colour(this.get(c.x,c.y))!==colour(c.piece)).length,0);
  }
  newlyFilled(): number {
    const now = this.unfilled(), diff = this.lastUnfilled-now;
    this.lastUnfilled=now; return diff;
  }
  blockEmpty(x: number, y: number, width: number, height: number): boolean {
    for (let row=y;row>y-height;row--) for (let col=x;col<x+width;col++) {
      if (col<0 || col>=WIDTH || row>=HEIGHT || this.get(col,Math.max(0,row))!==EMPTY) return false;
    }
    return true;
  }
  /** Sideways movement rounds halfway down; rotations round only after halfway. */
  move(x:number,bottom:number,width:number,height:number,dx:number,fraction:number):boolean {
    return this.blockEmpty(x+dx,bottom+(fraction>=0.5?1:0),width,height);
  }
  rotate(x: number, y: number, orient: number, clockwise: boolean, fraction=0): number[] | null {
    const dx = clockwise ? [-1,0,0,1] : [-1,1,0,0];
    const dy = clockwise ? [0,0,-1,1] : [-1,0,0,1];
    for (let i=0;i<4;i++) {
      x+=dx[Math.floor(orient/2)]; y+=dy[Math.floor(orient/2)];
      orient=(orient+(clockwise?2:6))%8;
      const idx=Math.floor(orient/2), left=x+[-1,0,0,0][idx], bottom=y+[0,0,0,1][idx];
      for (const kick of [0,1,-1]) {
        const empty=this.blockEmpty(left+kick,bottom+(fraction>0.5?1:0),[2,1,2,1][idx],[1,2,1,2][idx]);
        if (empty) return [orient,x+kick,y,0];
      }
    }
    return null;
  }
}

export class ClearScore {
  chain = 0;
  ordinary = 0;
  platform = 0;
  combo = 0;
  fixed = 0;
  constructor(readonly difficulty: number) {}
  add(cells: readonly Cell[], platform: boolean): void {
    let ordinary = 0;
    const unique = new Map(cells.map(c => [c.y*WIDTH+c.x,c]));
    for (const c of unique.values()) {
      if (fixed(c.piece)) this.fixed++;
      else if (platform) this.platform++;
      else ordinary++;
    }
    this.ordinary+=Math.min(4,ordinary); this.combo+=Math.max(0,ordinary-4); this.chain++;
  }
  get points(): number {
    const cap=2*this.difficulty, mult=this.chain>cap ? cap+0.5*(this.chain-cap) : this.chain;
    return Math.floor((this.ordinary+4*this.platform+2*this.combo+5*this.fixed)*mult);
  }
}

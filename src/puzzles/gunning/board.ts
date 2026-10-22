// The gunning board, recreated from the game's rules: pieces leave a turning barrel in the middle of the deck,
// follow the arrows the player lays down and are loaded into the cannons on either side as powder, wad, then shot.
import { BoardRandom } from '../forage/board';

export const WIDTH = 13, BARREL_ROW = 6, MAX_HEIGHT = 17;
/** Each cannon row holds two cannons, one per side. */
export const CANNON_ROWS = [3, 9, 13];
export const CANNON_COUNTS = [2, 4, 6];
export const SWAB = 20, SHOT = 21, POWDER = 22, WAD = 23;
/** Cannon cells: the muzzle is the outer end, where pieces enter; the breech is the inner end. */
export const MUZZLE = 30, MIDDLE = 31, BREECH = 32, CRATE = 40, HOLE = 41;
/** Arrow codes; a piece's direction is the arrow code less 10. */
export const UP = 10, RIGHT = 11, DOWN = 12, LEFT = 13;
export const ARROWS = 3;
/** Mirrored circuits on a normal four-gun deck; supply limits apply to each side. */
export const LOOP = { front: 12, back: 7, top: 0, bottom: 12, rows: [3, 9], perType: 3, pieces: 12, refillDelayMs: 750 } as const;
export const LOOP_SIDES = [
  { front: LOOP.front, back: LOOP.back, barrel: 8, guns: [0, 1], left: false },
  { front: 0, back: WIDTH - 1 - LOOP.back, barrel: 4, guns: [2, 3], left: true },
] as const;
export const LOOP_PATH: readonly (readonly [number, number])[] = [
  ...Array.from({ length: 13 }, (_, i) => [LOOP.front, LOOP.top + i] as const),
  ...Array.from({ length: 5 }, (_, i) => [LOOP.front - 1 - i, LOOP.bottom] as const),
  ...Array.from({ length: 12 }, (_, i) => [LOOP.back, LOOP.bottom - 1 - i] as const),
  ...Array.from({ length: 4 }, (_, i) => [LOOP.back + 1 + i, LOOP.top] as const),
];
/** The example's right-hand circuit mirrored across a central dividing wall. */
export const LOOP_DECK = [
  '......c......', '......c......', '......c......', '.===..c..===.',
  '....c.c.c....', '....c.c.c....', '......c......', '....c.c.c....',
  '....c.c.c....', '.===..c..===.', '......c......', '......c......', '......c......',
].join('');
/** Cannon states. */
export const EMPTY = 0, PARTIAL = 1, LOADED = 2, SWAB_IN = 3, WASHING = 4, FIRING = 5;
/** What each slot, from the breech out, needs for a correct load. */
const LOAD_ORDER = [POWDER, WAD, SHOT];

export const heightFor = (cannons: number) => cannons === 6 ? 17 : cannons === 4 ? 13 : 9;
const element = (raw: number) => raw & 0xff;
const cannonOf = (raw: number) => raw >> 8 & 0xff;
const restingOf = (raw: number) => raw >> 16 & 0xff;
const arrowOf = (raw: number) => raw >>> 24 & 0xff;

/** What the board tells the game about as it plays. */
export interface BoardListener {
  pieceAdded?(piece: Piece): void;
  /** A piece reached its slot in a cannon; `correct` when every slot up to it holds the right piece. */
  pieceLoaded?(cannon: number, correct: boolean, type: number): void;
  cannonChanged?(cannon: Cannon): void;
  /** A piece fell down a hole or left the deck (`overboard`), or a swab went into a clean, empty cannon. */
  pieceLost?(piece: Piece, overboard: boolean): void;
  pieceRemoved?(piece: Piece, stuck: boolean): void;
}

export class Piece {
  /** The cell the piece is on, and the one it moves to on the next tick. */
  nx: number;
  ny: number;
  /** Half bounce: the piece goes halfway toward its next cell and comes back. */
  half = false;
  hx = 0;
  hy = 0;
  /** Inside a cannon but not loading it: drawn above the cannon. */
  inCannon = false;

  constructor(readonly type: number, public x: number, public y: number, public dir: number) {
    this.nx = x; this.ny = y;
    this.aim();
  }

  private aim(): void {
    this.nx = this.x; this.ny = this.y;
    if (this.dir === 0) this.ny--;
    else if (this.dir === 1) this.nx++;
    else if (this.dir === 2) this.ny++;
    else if (this.dir === 3) this.nx--;
  }

  /** Moves onto the next cell: 'gone' when it leaves the deck or comes to rest in a cannon, 'stuck' when it can't move on. */
  step(board: GunneryBoard): 'gone' | 'stuck' | null {
    this.x = this.nx; this.y = this.ny; this.half = false;
    const here = board.element(this.x, this.y);
    if (here === HOLE) { board.lose(this, true); return 'gone'; }
    if (here === MUZZLE || here === MIDDLE || here === BREECH) {
      const cannon = board.cannons[board.cannonId(this.x, this.y)];
      if (board.loop && here === MUZZLE) {
        if (!cannon.accept(this, true)) { this.dir = cannon.left ? 3 : 1; this.nx = this.x + (cannon.left ? -1 : 1); this.ny = this.y; this.inCannon = false; return null; }
        if (this.type === SWAB) cannon.startWash(board.time);
        else {
          if (this.type === SHOT) cannon.checkLoaded(true);
          const slot = cannon.slots.indexOf(this);
          if (slot >= 0 && !cannon.busy) board.setResting(cannon.left ? 3 - slot : 9 + slot, this.y, this.type);
        }
        return 'gone';
      }
      if (this.type === SWAB) {
        if (here === BREECH) { cannon.startWash(board.time); return 'gone'; }
      } else if (cannon.holds(here, this)) {
        if (!cannon.busy) board.setResting(this.x, this.y, this.type);
        return 'gone';
      }
    }
    return this.route(board, true) ? 'stuck' : null;
  }

  /** Picks the next cell, turning right, then left, then back when blocked; true when stuck. */
  route(board: GunneryBoard, arrows: boolean): boolean {
    if (board.loop) this.inCannon = false;
    if (arrows) {
      const arrow = board.arrow(this.x, this.y);
      if (arrow >= UP && arrow <= LEFT) this.dir = arrow - UP;
    }
    const base = this.dir;
    for (let tries = 1; ; tries++) {
      let blocked = false;
      this.aim();
      // Off the side of a cannon row is the open gunport: nothing stops the piece going overboard there.
      if ((this.nx >= 0 && this.nx < WIDTH) || !board.isCannonRow(this.ny)) {
        if (this.nx >= 0 && this.ny >= 0 && this.nx < WIDTH && this.ny < board.height) {
          const next = board.element(this.nx, this.ny);
          if (next === MUZZLE) {
            const cannon = board.cannons[board.cannonId(this.nx, this.ny)];
            if (board.loop) {
              if ((this.dir === 3 || this.dir === 1) && (cannon.state === EMPTY || cannon.state === PARTIAL) &&
                (this.type === SWAB || cannon.slots.some(slot => slot === null))) { this.inCannon = true; return false; }
              blocked = true;
            } else {
              if ((this.dir === 3 || this.dir === 1) && cannon.accept(this, true)) {
                const loaded = this.type === SHOT && cannon.checkLoaded(true);
                if (!loaded) this.inCannon = true;
                return false;
              }
              blocked = true;
            }
          } else if (next === MIDDLE) {
            if (board.element(this.x, this.y) === MUZZLE) return false;
            blocked = true;
          } else if (next === BREECH) {
            if (board.element(this.x, this.y) === MIDDLE) return false;
            blocked = true;
          } else if (next === CRATE) blocked = true;
          else blocked = board.barrels.some(barrel => barrel.blocks(this.x, this.y, this.nx, this.ny));
        } else blocked = true;
      }
      if (!blocked) return false;
      if (tries === 1) this.dir = (base + 1) % 4;
      else if (tries === 2) this.dir = (base + 3) % 4;
      else if (tries === 3) this.dir = (base + 2) % 4;
      else return true;
    }
  }

  /** Two pieces trading cells turn round. */
  bounce(board: GunneryBoard, arrows: boolean): void {
    this.dir = (this.dir + 2) % 4;
    this.route(board, arrows);
  }

  /** Two pieces heading for one cell both stay put this tick, facing the other way; a second call undoes it. */
  halfBounce(): void {
    this.dir = (this.dir + 2) % 4;
    if (this.half) {
      this.half = false; this.nx = this.hx; this.ny = this.hy;
    } else {
      this.half = true; this.hx = this.nx; this.hy = this.ny; this.nx = this.x; this.ny = this.y;
    }
  }

  swapsWith(o: Piece): boolean { return this.x === o.nx && this.y === o.ny && this.nx === o.x && this.ny === o.y; }
  sameTarget(o: Piece): boolean { return this.nx === o.nx && this.ny === o.ny; }
}

export class Cannon {
  state = EMPTY;
  /** Fired and not yet washed out. */
  fouled = false;
  washStart = 0;
  slots: (Piece | null)[] = [null, null, null];

  constructor(readonly id: number, private readonly board: GunneryBoard) {}

  get busy(): boolean { return this.state === LOADED || this.state === FIRING; }
  get left(): boolean { return this.board.loop ? this.id >= 2 : this.id % 2 === 0; }

  /** The drill leaves a fired cannon clean and ready to load again. */
  reset(): void {
    this.slots = [null, null, null]; this.fouled = false;
    this.board.clearResting(this.id); this.set(EMPTY);
  }

  /** After firing, or when a viking gun starts: empty and needing a wash. */
  foul(): void {
    this.slots = [null, null, null]; this.fouled = true;
    this.set(PARTIAL);
  }

  accept(piece: Piece, notify: boolean): boolean {
    if (this.state !== EMPTY && this.state !== PARTIAL) return false;
    if (piece.type === SWAB) {
      this.set(SWAB_IN);
      if (!this.fouled && !this.slots[0]) this.board.lose(piece, false);
      return true;
    }
    for (let i = this.fouled ? 1 : 0; i < 3; i++) {
      if (this.slots[i]) continue;
      this.slots[i] = piece;
      if (notify) this.board.listener?.pieceLoaded?.(this.id, this.correctTo(i), piece.type);
      if (this.state === EMPTY) this.set(PARTIAL);
      return true;
    }
    return false;
  }

  /** Every slot from the breech up to `slot` holds the right piece. */
  correctTo(slot: number): boolean {
    for (let i = slot; i >= 0; i--) if (this.slots[i]?.type !== LOAD_ORDER[i]) return false;
    return true;
  }

  holds(cell: number, piece: Piece): boolean { return this.slots[cell === MUZZLE ? 2 : cell === MIDDLE ? 1 : 0] === piece; }
  startWash(time: number): void { this.washStart = time; this.set(WASHING); }

  finishWash(): boolean {
    if (this.state !== WASHING) return false;
    this.slots = [null, null, null];
    this.board.clearResting(this.id);
    this.fouled = false;
    this.set(EMPTY);
    return true;
  }

  checkLoaded(notify: boolean): boolean {
    if (!this.correctTo(2)) return false;
    this.board.clearResting(this.id);
    this.set(LOADED, notify);
    return true;
  }

  fire(): void { if (this.state === LOADED) this.set(FIRING); }
  finishFiring(): boolean {
    if (this.state !== FIRING) return false;
    this.foul();
    return true;
  }

  private set(state: number, notify = true): void {
    this.state = state;
    if (!notify) return;
    if (state === LOADED) this.board.ballLoaded();
    this.board.listener?.cannonChanged?.(this);
  }
}

/**
 * The barrel turns a quarter at a time, putting out a piece each way (up, right, down, left) when there's room,
 * and slides along its row while the ship moves.
 */
export class Barrel {
  row = BARREL_ROW;
  col = BARREL_ROW;
  /** The column it blocks pieces on. */
  shown = BARREL_ROW;
  /** 1 right, -1 left. */
  dir = 1;
  ticks = 0;
  target = -1;
  moving = false;
  /** 0, 2, 4, 6 face up, right, down, left; odd states are turning; 8 is sliding. */
  state = 0;

  constructor(private readonly board: GunneryBoard) {}

  setMoving(right: boolean): void {
    const prev = this.dir;
    this.dir = right ? 1 : -1;
    switch (this.state) {
      case 0: case 4: this.state = -1; // falls through
      case 2: case 6: this.target = this.ticks + 1; // falls through
      case 1: case 3: case 5: case 7: this.moving = true; break;
      case 8:
        if (prev !== this.dir) {
          const r = this.ticks % 3;
          if (r !== 0) { this.col += prev; this.ticks = 3 - r; } else this.ticks = 0;
        }
        this.target = -1;
    }
  }

  stop(): void {
    if (this.state === 8) this.target = 3 * (1 + Math.floor(this.ticks / 3));
    else this.moving = false;
  }

  inserted(): void { if (this.state !== 8) this.target = this.ticks + 1; }
  /** Column, with the fraction of a cell it has slid. */
  get pos(): number { return this.state === 8 ? this.col + this.dir * ((this.ticks % 3) / 3) : this.col; }

  /** Direction a new piece leaves in (0 up, 1 right, 2 down, 3 left), trying the opposite side if blocked, or -1. */
  exit(): number {
    let dx = 0, dy = 0;
    switch (this.state) {
      case 2: dx = 1; break;
      case 4: dy = 1; break;
      case 6: dx = -1; break;
      case 8: if (this.ticks % 3 !== 0) return -1; dy = -1; break;
      case 0: dy = -1; break;
      default: return -1;
    }
    if (!this.open(dx, dy)) {
      dx = -dx; dy = -dy;
      if (!this.open(dx, dy)) return -1;
    }
    return dx === 0 ? (dy === -1 ? 0 : 2) : dx === -1 ? 3 : 1;
  }

  private open(dx: number, dy: number): boolean {
    return !this.board.isBlocked(this.col + dx, this.row + dy) && !this.board.piecesBlockInsert(this.col + dx, this.row + dy);
  }

  blocks(x: number, y: number, nx: number, ny: number): boolean {
    if (nx === this.shown && ny === this.row) return true;
    return this.state === 8 && y === this.row && ny === this.row && x === this.shown;
  }

  private advance(): void {
    if (this.state === 7 || this.state === 8) this.state = 0;
    else this.state++;
    if (this.moving) {
      if (this.state === 0 || this.state === 4) {
        this.moving = false;
        if (!this.blockedAhead()) this.state = 8;
      } else if (this.state === 2 || this.state === 6) this.state++;
    }
    this.ticks = 0;
    this.target = this.state % 2 === 1 ? 2 : -1;
  }

  tick(): void {
    this.ticks++;
    if (this.state === 8) {
      if (this.ticks % 3 === 0) {
        this.col += this.dir;
        if (this.blockedAhead()) this.target = this.ticks;
      }
      this.shown = Math.floor(this.pos + 0.5);
    }
    if (this.ticks === this.target) this.advance();
  }

  private blockedAhead(): boolean { return this.board.isBlocked(this.col + this.dir, this.row); }

  /** Frame of barrel.png. */
  get frame(): number {
    switch (this.state) {
      case 1: case 5: return this.ticks === 0 ? 6 : 5;
      case 2: case 6: return 9;
      case 3: case 7: return this.ticks === 0 ? 4 : 3;
      case 8: return this.ticks % 4 === 1 ? 0 : this.ticks % 4 === 3 ? 1 : 2;
      default: return 2;
    }
  }
}

export class GunneryBoard {
  readonly height: number;
  readonly cells: number[];
  readonly cannons: Cannon[];
  readonly barrel: Barrel;
  /** Freeplay and normal Gunning keep one barrel; the drill has an independent barrel per side. */
  readonly barrels: Barrel[];
  /** Cells holding the arrows, newest first; -1 for none. */
  readonly arrows: number[];
  pieces: Piece[] = [];
  /** Board time: two a tick. */
  time = 0;
  /** Cannonballs the ship has left, and shot pieces out on the deck. */
  balls: number;
  ballsOut = 0;
  listener: BoardListener | null = null;
  readonly rng: BoardRandom;
  /** Ready supply and consumed pieces waiting to be mixed back in, on the active game clock. */
  private loopSupply: number[][] = [[], []];
  private loopPending: number[][] = [[], []];
  private loopRefillAt: (number | null)[] = [null, null];
  private loopRng: BoardRandom[] = [];
  private loopNow = 0;

  constructor(readonly numCannons: number, seed: number, balls = Number.MAX_SAFE_INTEGER, readonly maxArrows = ARROWS, readonly loop = false) {
    if (!CANNON_COUNTS.includes(numCannons)) throw new Error('Gunnery needs 2, 4 or 6 cannons');
    if (loop && numCannons !== 4) throw new Error('The mirrored loop drill needs four cannons');
    this.height = loop ? heightFor(4) : heightFor(numCannons);
    this.balls = balls;
    this.barrel = new Barrel(this);
    this.barrels = [this.barrel];
    this.arrows = Array(maxArrows).fill(-1);
    this.cannons = Array.from({ length: numCannons }, (_, i) => new Cannon(i, this));
    this.cells = Array(WIDTH * this.height).fill(0);
    this.rng = new BoardRandom(seed);
    if (loop) {
      for (let i = 0; i < LOOP_DECK.length; i++) if (LOOP_DECK[i] === 'c') this.cells[i] = CRATE;
      this.barrels.push(new Barrel(this));
      for (const [side, circuit] of LOOP_SIDES.entries()) {
        for (const [row, id] of circuit.guns.entries()) {
          const y = LOOP.rows[row], tag = id << 8, direction = circuit.left ? 1 : -1;
          for (const [dx, part] of [MUZZLE, MIDDLE, BREECH].entries()) this.cells[y * WIDTH + circuit.front + direction * (1 + dx)] = part | tag;
        }
        const barrel = this.barrels[side];
        barrel.col = barrel.shown = circuit.barrel; barrel.state = circuit.left ? 2 : 6;
        this.loopRng.push(new BoardRandom((seed ^ (side ? 0x9e3779b9 : 0)) >>> 0));
        this.loopSupply[side] = this.shuffleLoopPieces([SWAB, SHOT, POWDER, WAD].flatMap(type => Array<number>(LOOP.perType).fill(type)), side);
      }
      return;
    }
    let id = 0;
    for (let row = 0; row < numCannons / 2; row++) {
      const y = CANNON_ROWS[row];
      for (const [start, step] of [[1, 1], [11, -1]]) {
        const tag = id++ << 8;
        this.cells[y * WIDTH + start] = MUZZLE | tag;
        this.cells[y * WIDTH + start + step] = MIDDLE | tag;
        this.cells[y * WIDTH + start + 2 * step] = BREECH | tag;
      }
    }
    for (let i = 0; i < numCannons * 4; i++) this.cells[this.freeCell()] = CRATE;
  }

  /** A random cell where a crate or hole may go: clear of the barrel's rows, the cannons' lanes and the gunports. */
  private freeCell(): number {
    for (;;) {
      const i = this.rng.nextInt(this.cells.length);
      if (this.obstacleOk(i)) return i;
    }
  }

  addHole(): number {
    const i = this.freeCell();
    this.cells[i] = HOLE;
    return i;
  }

  isCannonRow(y: number): boolean {
    if (this.loop) return LOOP.rows.some(row => row === y);
    for (let row = 0; row < this.numCannons / 2; row++) if (CANNON_ROWS[row] === y) return true;
    return false;
  }

  private obstacleOk(i: number): boolean {
    if (this.cells[i] !== 0) return false;
    const y = Math.floor(i / WIDTH), x = i % WIDTH;
    if (y === 5 || y === 6 || y === 7) return false;
    if (this.isCannonRow(y)) return x !== 0 && x !== 12 && x !== 4 && x !== 8;
    if (this.isCannonRow(y + 1)) return x !== 0 && x !== 12;
    return !this.isCannonRow(y - 1) || (x > 4 && x < 8);
  }

  /** The raw cell value; one column past either edge reads the neighbouring row, as the game does. */
  raw(x: number, y: number): number { return this.cells[y * WIDTH + x] ?? 0; }
  /** Out past the first column beyond the deck counts as a hole: the piece is overboard. */
  element(x: number, y: number): number {
    return x >= -1 && x <= WIDTH && y >= -1 && y <= this.height ? element(this.raw(x, y)) : HOLE;
  }
  cannonId(x: number, y: number): number { return cannonOf(this.raw(x, y)); }
  resting(x: number, y: number): number { return restingOf(this.raw(x, y)); }
  arrow(x: number, y: number): number { return arrowOf(this.raw(x, y)); }
  arrowAt(i: number): number { return arrowOf(this.cells[i]); }

  isBlocked(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= WIDTH || y >= this.height) return true;
    const e = this.element(x, y);
    return e === MUZZLE || e === MIDDLE || e === BREECH || e === CRATE;
  }

  piecesBlockInsert(x: number, y: number): boolean {
    return this.pieces.some(p => p.nx === x && p.ny === y);
  }

  canPlaceArrow(x: number, y: number): boolean {
    return x >= 0 && x < WIDTH && y >= 0 && y < this.height && this.element(x, y) === 0 &&
      !this.barrels.some(barrel => x === barrel.shown && y === barrel.row);
  }

  /** 0 for the newest arrow, up to maxArrows - 1 for the oldest; -1 if none there. */
  arrowOrder(i: number): number { return this.arrows.indexOf(i); }

  /** Lays an arrow; a fourth takes away the oldest, and re-laying one makes it the newest. */
  setArrow(x: number, y: number, dir: number): void {
    const i = y * WIDTH + x, max = this.maxArrows, order = this.arrowOrder(i);
    if (order === -1) {
      const oldest = this.arrows[max - 1];
      if (oldest !== -1) this.cells[oldest] &= 0xffffff;
    }
    let skip = order === -1 ? 1 : 0;
    for (let k = max - 1; ; k--) {
      let j = k - skip;
      if (j === order) { skip++; j--; }
      if (j < 0) break;
      this.arrows[k] = this.arrows[j];
    }
    this.arrows[0] = i;
    this.cells[i] = (this.cells[i] & 0xffffff) | dir << 24;
  }

  setResting(x: number, y: number, type: number): void {
    const i = y * WIDTH + x;
    this.cells[i] = (this.cells[i] & ~0xff0000) | type << 16;
  }

  clearResting(cannon: number): void {
    const y = this.loop ? LOOP.rows[cannon % 2] : CANNON_ROWS[cannon >> 1];
    for (let x = 0; x < WIDTH; x++) if (this.cannonId(x, y) === cannon && element(this.raw(x, y)) >= MUZZLE) this.setResting(x, y, 0);
  }

  lose(piece: Piece, overboard: boolean): void { this.listener?.pieceLost?.(piece, overboard); }
  ballLoaded(): void { this.balls--; }

  private allCannonsBusy(): boolean { return this.cannons.every(c => c.busy); }

  /** At most one new piece a tick, of a type there are fewest of, while there's room for it. */
  private addPiece(count: number): void {
    if (count === this.numCannons * 2 || this.allCannonsBusy()) return;
    const dir = this.barrel.exit();
    if (dir === -1) return;
    const type = this.nextPiece(count);
    if (!type) return;
    const piece = new Piece(type, Math.floor(this.barrel.pos + 0.5), this.barrel.row, dir);
    this.pieces.push(piece);
    this.barrel.inserted();
    this.listener?.pieceAdded?.(piece);
  }

  private nextPiece(count: number): number {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) counts[this.pieces[i].type - SWAB]++;
    if (this.balls <= this.ballsOut) counts[1] = Number.MAX_SAFE_INTEGER;
    const least = Math.min(...counts), fewest = counts.flatMap((n, i) => n === least ? [i] : []);
    const pick = fewest[this.rng.nextInt(fewest.length)];
    if (counts[pick] === this.numCannons / 2) return 0;
    if (pick + SWAB === SHOT) this.ballsOut++;
    return pick + SWAB;
  }

  private remove(index: number, stuck: boolean): void {
    const [piece] = this.pieces.splice(index, 1);
    if (piece.type === SHOT) this.ballsOut--;
    if (this.loop) {
      const side = piece.x < WIDTH / 2 ? 1 : 0;
      this.loopPending[side].push(piece.type);
      this.loopRefillAt[side] = this.loopNow + LOOP.refillDelayMs;
    }
    this.listener?.pieceRemoved?.(piece, stuck);
  }

  private shuffleLoopPieces(pieces: number[], side: number): number[] {
    const shuffled = [...pieces];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.loopRng[side].nextInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // A mixed batch must change order, even when the random shuffle picks the original permutation.
    if (shuffled.every((type, i) => type === pieces[i])) {
      const different = shuffled.findIndex(type => type !== shuffled[0]);
      if (different > 0) [shuffled[0], shuffled[different]] = [shuffled[different], shuffled[0]];
    }
    return shuffled;
  }

  private addLoopPiece(side: number): void {
    const barrel = this.barrels[side], supply = this.loopSupply[side];
    const index = supply.findIndex(type => this.pieces.filter(p => p.type === type && (p.x < WIDTH / 2) === (side === 1)).length < LOOP.perType);
    if (index < 0) return;
    const [type] = supply.splice(index, 1);
    const p = new Piece(type, barrel.shown, barrel.row, 0);
    this.pieces.push(p);
    if (p.type === SHOT) this.ballsOut++;
    // Leave the barrel sideways, then merge upwards into its return lane.
    p.nx = LOOP_SIDES[side].back; p.ny = barrel.row; p.dir = 0;
    this.listener?.pieceAdded?.(p);
  }

  private tickLoop(nowMs: number): void {
    this.loopNow = nowMs;
    this.time++;
    for (let i = 0; i < this.pieces.length; i++) {
      const leaves = this.pieces[i].step(this);
      if (leaves) { this.remove(i, leaves === 'stuck'); i--; }
    }
    for (const [side, circuit] of LOOP_SIDES.entries()) {
      const readyAt = this.loopRefillAt[side], barrel = this.barrels[side];
      if (readyAt !== null && nowMs >= readyAt) {
        this.loopSupply[side].push(...this.shuffleLoopPieces(this.loopPending[side], side));
        this.loopPending[side] = []; this.loopRefillAt[side] = null;
      }
      // Consecutive feeds are safe when no piece is entering the join or moving back towards the barrel.
      if (this.pieces.filter(p => (p.x < WIDTH / 2) === (side === 1)).length < LOOP.pieces && !this.pieces.some(p =>
        (p.nx === circuit.back && p.ny === barrel.row) ||
        (p.x === circuit.back && p.y === barrel.row && p.nx === barrel.shown && p.ny === barrel.row))) {
        this.addLoopPiece(side);
      }
    }
    this.directBounces(); this.halfBounces();
    this.time++;
  }

  tick(nowMs = this.time * 125): void {
    if (this.loop) { this.tickLoop(nowMs); return; }
    this.time++;
    this.barrel.tick();
    let count = this.pieces.length;
    this.addPiece(count);
    for (let i = 0; i < count; i++) {
      // A piece that turned every way and still couldn't move is deleted.
      const leaves = this.pieces[i].step(this);
      if (leaves) { this.remove(i, leaves === 'stuck'); i--; count--; }
    }
    this.directBounces();
    this.halfBounces();
    this.time++;
  }

  private directBounces(): void {
    const n = this.pieces.length, max = Math.max(16, n * n);
    let bouncing: Piece[] = [], count = 0, iteration = 0;
    do {
      for (let i = 0; i < n; i++) {
        const a = this.pieces[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.pieces[j];
          if (a.swapsWith(b)) { bouncing.push(a, b); break; }
        }
      }
      count = bouncing.length;
      for (const p of bouncing) p.bounce(this, iteration === 0);
      bouncing = [];
      if (iteration++ === max) { this.removeOverlapping(); break; }
    } while (count > 0);
  }

  private halfBounces(): void {
    const n = this.pieces.length, max = Math.max(16, n * n);
    let bouncing: Piece[] = [], count = 0, iteration = 0;
    do {
      for (let x = 0; x < WIDTH; x++) {
        for (let y = 0; y < this.height; y++) {
          let first: Piece | null = null, clash = false;
          for (let k = 0; k < n; k++) {
            const p = this.pieces[k];
            if (p.nx !== x || p.ny !== y) continue;
            if (!first) first = p;
            else { bouncing.push(p); clash = true; }
          }
          if (clash) bouncing.push(first!);
        }
      }
      count = bouncing.length;
      for (const p of bouncing) p.halfBounce();
      bouncing = [];
      if (iteration++ === max) { this.removeOverlapping(); break; }
    } while (count > 0);
  }

  private removeOverlapping(): boolean {
    let found = false;
    for (let i = 0; i < this.pieces.length; i++) {
      for (let j = i + 1; j < this.pieces.length; j++) {
        if (!this.pieces[i].sameTarget(this.pieces[j])) continue;
        this.remove(j, false); j--; found = true;
      }
    }
    return found;
  }
}

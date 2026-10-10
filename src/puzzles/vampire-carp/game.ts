// Vampire carpentry's play, from the game's CarpentryController and CarpentryBoardView with their
// sprites (carpentry/p holes, r pieces, s putty): picking pieces from the toolbox, the tentative
// placement you can still nudge, nailing pieces in, neglect (rattling and flying pieces, blinking
// and growing holes), hole ratings, and the board scrolling in new holes. Nothing here draws;
// index.ts draws what's here. Positions are in the board view's pixels, 414x558 at (18, 34) on
// the panel; the board's own pixels ("world") move under it when it scrolls.
//
// Speed is the Vampire Carp simulator's mode: small holes that a set number of
// pieces fill, dealt with the pieces to fill them, without neglect or scrolling.
import { PyRandom } from '../../core/pyrandom';
import {
  BoardRandom,
  type Cell,
  CarpentryBoard,
  Hole,
  HOLES_PER_LEVEL,
  MAX_HOLE,
  MAX_NEGLECT,
  NUM_HOLES,
  NUM_TOOLS,
  Piece,
  PIECE_LETTERS,
  PUTTY_TOOL,
  VAMPIRE_DIFFICULTY,
} from './board';
import { THREE_PIECE_HOLES, TWO_PIECE_HOLES, TWO_PIECE_HOLES_WITH_X } from './holes';
import { createSmallHole, holesWith, PIECE_WEIGHTS_NO_PUTTY, PIECES_NO_PUTTY } from './shapes';

/** Cell size, and the view: 23x31 cells (CarpentryBoardView.a, b, c, d, e). */
export const CELL = 18;
export const VIEW_X = 18;
export const VIEW_Y = 34;
export const VIEW_W = 414;
export const VIEW_H = 558;
export const COLS = Math.trunc(VIEW_W / CELL);
export const ROWS = Math.trunc(VIEW_H / CELL);
/** Each hole's 10x10 box, in cells (CarpentryBoardView.m). */
const HOLE_BOX: Cell[] = [
  [1, 1],
  [12, 1],
  [1, 20],
  [12, 20],
];
/** How far the board scrolls for a column or a row of holes (CarpentryBoardView.o, n). */
export const COL_STEP = (HOLE_BOX[1][0] - HOLE_BOX[0][0]) * CELL;
export const ROW_STEP = (HOLE_BOX[2][1] - HOLE_BOX[0][1]) * CELL;
/** The toolbox's cells, for picking (CarpentryBoardView.f), and its picture at (42, 215). */
const TOOLBOX = { x: 4, y: 14, w: 15, h: 5 };
export const TOOLBOX_AT: Cell = [42, 215];
/** Holes for a full star meter: 17 at the Vampire Lair's difficulty. */
export const LEVEL_HOLES = HOLES_PER_LEVEL[VAMPIRE_DIFFICULTY];

/** Floating messages last 1.5s (media/animation/u). */
export const TEXT_MS = 1500;
/** A scroll takes 1s, or 1.414s diagonally (CarpentryBoardView.e). */
const SCROLL_MS = 1000;
const DIAGONAL_MS = 1414;
/** A piece that falls off flies out of the view in 250ms (CarpentryBoardView.a(r)). */
export const FLY_MS = 250;
/** The rating's sound follows its message by 640ms (CarpentryController.a(Hole, int)). */
const RANK_SOUND_DELAY = 640;
/** After the "Nice work!" scroll, the board waits half a second (CarpentryBoardView.b(String)). */
const LEVEL_PAUSE = 500;
/** Hole blinks: every 500, 250, then 125ms over the last three moves before it grows. */
const BLINKS = [125, 250, 500];

export type SoundName =
  | 'fanfare'
  | 'piece_place_perfect'
  | 'piece_place_overlap'
  | 'putty_use'
  | 'hole_masterpiece'
  | 'hole_craftsmanship'
  | 'hole_pigs_breakfast'
  | 'piece_rattle_warning_slow'
  | 'piece_rattle_warning_fast'
  | 'piece_fly_off'
  | 'hole_grows'
  | 'hole_blinky_warning_slow'
  | 'hole_blinky_warning_medium'
  | 'hole_blinky_warning_fast';

/** Vampire ratings (m.vampirate_rank0-2), their sounds and their points. */
export const RANKS = [
  { text: 'Vampire Proof!', sound: 'hole_masterpiece', points: 2 },
  { text: 'Creaky Coffin', sound: 'hole_craftsmanship', points: 1 },
  { text: 'Slipshod', sound: 'hole_pigs_breakfast', points: -1 },
] as const;

/**
 * A piece's look: a wood texture (wood_pieces tile 0-7) cropped at random, drawn in the
 * orientation it was dealt in and turned with the piece.
 */
export interface Look {
  texture: number;
  crop: Cell;
  baseOrient: number;
}

export interface PieceSprite {
  piece: Piece;
  /**
   * Outline colour by state (index.ts LOOKS): 0 in the toolbox, 1 picked or over the toolbox,
   * 2 fits, 3 doesn't fit, 4 placed but can still be moved, 5 nailed in.
   */
  state: number;
  /** Held pieces are drawn at 60% (putty at 80%). */
  held: boolean;
  look: Look;
  /** Orientation when it was placed, restored if a nudge is cancelled. */
  saved: number;
  /** Rattling: jitter of `amp` px, a new one every `period` ms. */
  shake: { amp: number; period: number; next: number; offset: Cell } | null;
  /** Putty spreads out from where it was poured, about 10ms a pixel. */
  pour: { start: number; radius: number } | null;
}

export interface HoleSprite {
  hole: Hole;
  /** World pixels of the hole's cell (0, 0). */
  pos: Cell;
  /** Black cells, [x][y], as dealt and as grown. */
  cells: boolean[][];
  /** Splinters cut from the hole's ends: [x, y, w] one pixel high, in the hole's pixels. */
  ragged: [number, number, number][];
  /** Extra black rectangles from growing, in the hole's pixels. */
  grown: [number, number, number, number][];
  blink: { period: number; next: number; on: boolean } | null;
  countdown: number;
  /** Pieces in this hole, each at its hole cell. */
  pieces: { sprite: PieceSprite; at: Cell }[];
}

export interface Flyer {
  sprite: PieceSprite;
  from: Cell;
  to: Cell;
  start: number;
}

export interface FloatText {
  text: string;
  /** A smaller second line under it (yellow), unused by vampire ratings. */
  colour: string;
  size: number;
  /** World pixels of its centre. */
  at: Cell;
  start: number;
}

export interface SpeedConfig {
  holes: number;
  size: number;
  /** Index into PIECES_NO_PUTTY, or 12 for any piece. */
  letter: number;
}

export interface Stats {
  found: Record<string, number>;
  placed: number;
  replaced: number;
  flips: number;
  spins: number;
  mousePicks: number;
  keyPicks: number;
  focus: number[];
  pDrought: [number, number];
  holeTimes: [number, number];
  scrolls: [number, number];
  animating: number;
  /** Slipshod, Creaky Coffin, Vampire Proof. */
  grades: [number, number, number];
  holesFilled: number;
}

export function newStats(): Stats {
  return {
    found: {},
    placed: 0,
    replaced: 0,
    flips: 0,
    spins: 0,
    mousePicks: 0,
    keyPicks: 0,
    focus: [],
    pDrought: [0, 0],
    holeTimes: [0, 999999999],
    scrolls: [0, 0],
    animating: 0,
    grades: [0, 0, 0],
    holesFilled: 0,
  };
}

export interface Hooks {
  sound(name: SoundName, delay?: number): void;
  /** The board's 17 holes are done and it has scrolled away: deal the next. */
  levelDone(): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const randInt = (n: number) => (n <= 0 ? 0 : Math.floor(Math.random() * n));

/** Where a hole's cell (0, 0) sits in the view, in cells: centred in its 10x10 box (CarpentryBoardView.b). */
export function holeCell(index: number, hole: Hole): Cell {
  const [bx, by] = HOLE_BOX[index];
  return [bx + Math.trunc((MAX_HOLE - hole.width) / 2), by + Math.trunc((MAX_HOLE - hole.height) / 2)];
}

/** The letter Jared's stats use for a piece ('b' for the putty). */
const statLetter = (kind: number) => (kind === 12 ? 'b' : PIECE_LETTERS[kind]);

export class Game {
  board: CarpentryBoard;
  holeSprites: HoleSprite[] = [];
  /** Toolbox sprites; null for an empty slot (speed). */
  tools: (PieceSprite | null)[] = [null, null, null];
  /** The piece in hand and the slot it came from (-1 for a cheat piece). */
  held: PieceSprite | null = null;
  heldSlot = -1;
  /** The selected toolbox slot (CarpentryController.r). */
  selected = 0;
  /** The cursor cell: where a held piece's first cell sits (CarpentryController.q). */
  cursor: Cell = [0, 0];
  /** A placed piece that can still be moved a cell or turned until the next piece is picked. */
  tentative: { sprite: PieceSprite; slot: number } | null = null;
  tentativeAt: Cell | null = null;
  flyers: Flyer[] = [];
  texts: FloatText[] = [];
  /** World pixels at the view's top-left. */
  view: Cell = [0, 0];
  private scroll: { from: Cell; to: Cell; start: number; ms: number; then: () => void } | null = null;
  /** Placing waits while a finished hole's message plays before a scroll (CarpentryController.x). */
  private waiting = false;
  /** "Nice work!" when the board's holes are all done, in world pixels. */
  levelText: { at: Cell } | null = null;
  /** Holes filled on this board (CarpentryController.t). */
  filled = 0;
  private timers: { at: number; fn: () => void }[] = [];
  /** When each hole (by id) got its first piece. */
  private startedAt = new Map<number, number>();
  /** Press point and whether it's become a drag (CarpentryController.z, y). */
  private press: Cell | null = null;
  private dragging = false;
  now = 0;

  // Speed.
  private speedNeeded = new Map<number, string[]>();
  private speedCodes = new Map<number, string>();
  private speedSeed = 0;
  private piecesUntilRefresh = 0;
  private speedHoleDone = false;

  constructor(
    seed: number,
    private readonly orientRng: BoardRandom,
    readonly stats: Stats,
    private readonly hooks: Hooks,
    readonly speed: SpeedConfig | null,
    private readonly prng: PyRandom,
    now: number,
  ) {
    this.now = now;
    this.board = new CarpentryBoard(seed);
    if (speed) this.setUpSpeed();
    else for (let i = 0; i < NUM_TOOLS; i++) this.countFound(this.board.toolbox[i]);
    // CarpentryController.j: fanfare, a fresh toolbox, and the holes scroll in.
    hooks.sound('fanfare');
    for (let i = 0; i < NUM_TOOLS; i++) this.newTool(i);
    this.scrollIn();
  }

  // ---- Sprites ----

  private makeSprite(tool: number): PieceSprite {
    const piece = new Piece(tool, this.speed || this.board.difficulty >= 2 ? 2 * this.orientRng.nextInt(4) + (tool & 1) : 1);
    const cells = piece.cells();
    const w = Math.max(...cells.map((c) => c[0])) - Math.min(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1])) + 1;
    return {
      piece,
      state: 0,
      held: false,
      look: { texture: randInt(8), crop: [randInt(5 * CELL - w * CELL), randInt(3 * CELL - h * CELL)], baseOrient: piece.orient },
      saved: piece.orient,
      shake: null,
      pour: null,
    };
  }

  /** A fresh sprite for toolbox slot i (CarpentryController.c). */
  private newTool(slot: number): void {
    const tool = this.board.toolbox[slot];
    this.tools[slot] = tool < 0 ? null : this.makeSprite(tool);
    this.resetTool(slot);
  }

  /** Puts slot i's sprite back in the toolbox (CarpentryController.d). */
  private resetTool(slot: number): void {
    const s = this.tools[slot];
    if (!s) return;
    s.state = slot === this.selected ? 1 : 0;
    s.held = false;
  }

  /** The cell where toolbox slot i's piece sits. */
  static toolCell(slot: number): Cell {
    return [TOOLBOX.x + slot * 5 + 2, TOOLBOX.y + 2];
  }

  private holeSprite(hole: Hole, pos: Cell): HoleSprite {
    const cells = hole.empty.map((col) => [...col]);
    const sprite: HoleSprite = { hole, pos, cells, ragged: [], grown: [], blink: null, countdown: MAX_NEGLECT, pieces: [] };
    for (let y = 0; y < hole.height; y++) {
      let first = -1;
      let last = 0;
      for (let x = 0; x < hole.width; x++) {
        if (!cells[x][y]) continue;
        if (first < 0) first = x;
        last = x;
      }
      if (first >= 0) this.splinter(sprite, true, first, y);
      this.splinter(sprite, false, last, y);
    }
    return sprite;
  }

  /** Two times in three, cuts splinters 0-6px deep into one end of a row (carpentry/p.a(boolean, int, int)). */
  private splinter(sprite: HoleSprite, left: boolean, x: number, y: number): void {
    if (randInt(3) === 0) return;
    let w = randInt(4);
    for (let row = 0; row < CELL; row++) {
      w = randInt(5) === 0 ? randInt(4) : Math.max(0, Math.min(6, w + randInt(3) - 1));
      sprite.ragged.push([left ? x * CELL : x * CELL + CELL - w, y * CELL + row, w]);
    }
  }

  private layOut(index: number, shift: Cell): void {
    const hole = this.board.holes[index];
    const [cx, cy] = holeCell(index, hole);
    this.holeSprites.push(this.holeSprite(hole, [this.view[0] + cx * CELL + shift[0], this.view[1] + cy * CELL + shift[1]]));
  }

  spriteFor(hole: Hole): HoleSprite | undefined {
    return this.holeSprites.find((s) => s.hole === hole);
  }

  // ---- Scrolling ----

  get scrolling(): boolean {
    return this.scroll !== null;
  }

  private startScroll(shift: Cell, then: () => void): number {
    const ms = shift[0] !== 0 && shift[1] !== 0 ? DIAGONAL_MS : SCROLL_MS;
    const from: Cell = [...this.view];
    this.scroll = { from, to: [from[0] + shift[0], from[1] + shift[1]], start: this.now, ms, then };
    return ms;
  }

  /** The holes come in from two boards away on a random side (CarpentryBoardView.s). */
  private scrollIn(): void {
    const shift = this.randomShift();
    this.holeSprites = [];
    for (let i = 0; i < NUM_HOLES; i++) this.layOut(i, shift);
    this.stats.animating += this.startScroll(shift, () => this.endScroll());
  }

  private randomShift(): Cell {
    switch (randInt(4)) {
      case 0:
        return [2 * COL_STEP, 0];
      case 1:
        return [0, 2 * ROW_STEP];
      case 2:
        return [-2 * COL_STEP, 0];
      default:
        return [0, -2 * ROW_STEP];
    }
  }

  /** Drops holes no longer on the board (CarpentryBoardView.t). */
  private endScroll(): void {
    this.holeSprites = this.holeSprites.filter((s) => this.board.holes.includes(s.hole));
  }

  // ---- Toolbox and hand ----

  private blocked(): boolean {
    return this.levelText !== null;
  }

  inToolbox(cell: Cell): boolean {
    return cell[0] >= TOOLBOX.x && cell[0] < TOOLBOX.x + TOOLBOX.w && cell[1] >= TOOLBOX.y && cell[1] < TOOLBOX.y + TOOLBOX.h;
  }

  private select(slot: number): void {
    if (slot < 0 || slot >= NUM_TOOLS || slot === this.selected) return;
    if (this.tools[this.selected]) this.tools[this.selected]!.state = 0;
    this.selected = slot;
    if (this.tools[slot]) this.tools[slot]!.state = 1;
  }

  /** Moves the hand to a cell, a cell at most from a placed piece being nudged (CarpentryController.b). */
  private moveHeld(x: number, y: number): void {
    if (this.tentativeAt) {
      x = Math.min(this.tentativeAt[0] + 1, Math.max(this.tentativeAt[0] - 1, x));
      y = Math.min(this.tentativeAt[1] + 1, Math.max(this.tentativeAt[1] - 1, y));
    }
    this.cursor = [Math.min(COLS, Math.max(0, x)), Math.min(ROWS, Math.max(0, y))];
    this.updateHeldState();
  }

  /** 1 over the toolbox, 2 where it fits, 3 where it doesn't (CarpentryController.r). */
  private updateHeldState(): void {
    if (!this.held) return;
    if (this.inToolbox(this.cursor)) {
      this.held.state = 1;
      return;
    }
    const target = this.target(this.cursor, this.held.piece);
    this.held.state = target && target.hole.checkPiece(this.held.piece, target.at[0], target.at[1]) !== 0 ? 2 : 3;
  }

  /**
   * The hole a piece at a view cell would go in, and the cell in that hole: the quarter of the
   * view it's in, if every cell of the piece is within a cell of that hole's box (CarpentryBoardView.a(Point, q)).
   */
  target(cell: Cell, piece: Piece): { index: number; hole: Hole; at: Cell } | null {
    let index = 0;
    if (cell[0] >= Math.trunc(COLS / 2)) index++;
    if (cell[1] >= Math.trunc(ROWS / 2)) index += 2;
    if (!piece.isPutty) {
      const dx = cell[0] - HOLE_BOX[index][0];
      const dy = cell[1] - HOLE_BOX[index][1];
      for (const [cx, cy] of piece.cells()) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < -1 || y < -1 || x > MAX_HOLE || y > MAX_HOLE) return null;
      }
    }
    const hole = this.board.holes[index];
    const [hx, hy] = holeCell(index, hole);
    return { index, hole, at: [cell[0] - hx, cell[1] - hy] };
  }

  /** Picks up the selected piece, or whichever slot (CarpentryController.c and g). */
  private pickUp(slot: number, viaKey: boolean): void {
    if (!this.tools[slot] && !(this.held && this.heldSlot === slot)) return;
    this.commitTentative();
    const previous = this.selected;
    if (this.held) {
      if (this.heldSlot === slot) return;
      if (this.heldSlot >= 0) this.resetTool(this.heldSlot);
    } else if (this.tools[previous]) {
      this.tools[previous]!.state = 0;
    }
    if (viaKey) this.stats.keyPicks++;
    else this.stats.mousePicks++;
    this.selected = slot;
    this.held = this.tools[slot];
    this.heldSlot = slot;
    this.held!.held = true;
    if (viaKey) this.moveHeld(this.cursor[0], this.cursor[1]);
    else {
      this.cursor = Game.toolCell(slot);
      this.updateHeldState();
    }
  }

  /** A cheat: hold any piece (not from the toolbox). */
  holdCheat(kind: number): void {
    if (this.blocked()) return;
    this.commitTentative();
    if (this.held && this.heldSlot >= 0) this.resetTool(this.heldSlot);
    const tool = kind === 12 ? PUTTY_TOOL : (kind << 1) | 1;
    this.held = this.makeSprite(tool);
    this.held.piece.orient = tool & 1;
    this.held.look.baseOrient = this.held.piece.orient;
    this.held.held = true;
    this.heldSlot = -1;
    this.updateHeldState();
  }

  flip(): void {
    if (!this.held || this.blocked() || this.held.piece.isPutty) return;
    this.held.piece.flip();
    this.stats.flips++;
    this.updateHeldState();
  }

  rotate(clockwise: boolean): void {
    if (!this.held || this.blocked() || this.held.piece.isPutty) return;
    this.held.piece.rotate(clockwise);
    this.stats.spins++;
    this.updateHeldState();
  }

  /** A toolbox key: picks that slot's piece, putting back the one in hand (CarpentryController.g). */
  keyPick(slot: number): void {
    if (this.blocked()) return;
    this.pickUp(slot, true);
  }

  // ---- Mouse (carpentry/g) ----

  static viewCell(px: number, py: number): Cell {
    return [Math.floor((px - VIEW_X) / CELL), Math.floor((py - VIEW_Y) / CELL)];
  }

  pointerMove(px: number, py: number): void {
    if (this.blocked()) return;
    if (this.press && !this.dragging && Math.hypot(px - this.press[0], py - this.press[1]) > 15) this.dragging = true;
    const cell = Game.viewCell(px, py);
    if (this.held) this.moveHeld(cell[0], cell[1]);
    else if (this.inToolbox(cell)) this.select(Math.trunc((cell[0] - TOOLBOX.x) / 5));
    else this.cursor = cell;
  }

  pointerDown(button: number, px: number, py: number): void {
    if (this.blocked()) return;
    if (button === 1) {
      this.press = [px, py];
      const cell = Game.viewCell(px, py);
      if (!this.held && this.tentative && this.tentativeAt && this.tentativeHit(cell)) {
        // Picks the placed piece back up to nudge it.
        this.held = this.tentative.sprite;
        this.heldSlot = this.tentative.slot;
        this.held.held = true;
        this.held.state = 2;
        this.detachTentative();
        this.moveHeld(cell[0], cell[1]);
      } else {
        this.click(true, cell);
      }
    } else if (button === 2) this.rotate(true);
    else if (button === 3) this.flip();
    else if (button === 4) this.rotate(false);
    else if (button === 5) this.rotate(true);
  }

  pointerUp(button: number): void {
    if (button !== 1) return;
    if (this.dragging && !this.blocked()) this.click(true, this.cursor);
    this.dragging = false;
    this.press = null;
  }

  /** The place key: as if clicked where the mouse is. */
  placeKey(px: number, py: number): void {
    const press = this.press;
    this.pointerDown(1, px, py);
    this.press = press;
  }

  /** CarpentryController.c(boolean). */
  private click(mouse: boolean, cell: Cell): void {
    if (this.held) {
      if (this.inToolbox(this.cursor)) {
        if (this.heldSlot < 0 || this.tentativeAt) {
          // A cheat piece or a nudged piece has no slot to go back to.
          if (this.tentativeAt) this.commitTentative();
          else this.held = null;
          return;
        }
        this.resetTool(this.heldSlot);
        this.held = null;
      } else {
        this.place();
      }
      return;
    }
    if (mouse && !this.inToolbox(cell)) return;
    this.pickUp(this.selected, false);
  }

  private tentativeHit(cell: Cell): boolean {
    const t = this.tentative!;
    const hs = this.holeSprites.find((s) => s.pieces.some((p) => p.sprite === t.sprite));
    if (!hs) return false;
    const entry = hs.pieces.find((p) => p.sprite === t.sprite)!;
    const [hx, hy] = this.holeViewCell(hs);
    return t.sprite.piece.cells().some(([x, y]) => x + entry.at[0] + hx === cell[0] && y + entry.at[1] + hy === cell[1]);
  }

  /** A hole sprite's cell (0, 0) in view cells. */
  holeViewCell(hs: HoleSprite): Cell {
    return [Math.round((hs.pos[0] - this.view[0]) / CELL), Math.round((hs.pos[1] - this.view[1]) / CELL)];
  }

  private detachTentative(): void {
    for (const hs of this.holeSprites) hs.pieces = hs.pieces.filter((p) => p.sprite !== this.tentative!.sprite);
    this.tentative = null;
  }

  // ---- Placing (CarpentryController.t, u, w) ----

  private place(): void {
    if (this.waiting || this.scrolling || !this.held) return;
    const nudging = this.tentativeAt !== null;
    const piece = this.held.piece;
    const target = this.target(this.cursor, piece);
    if (!target) return;
    const covers = target.hole.checkPiece(piece, target.at[0], target.at[1]);
    if (covers === 0) return;
    this.hooks.sound(piece.isPutty ? 'putty_use' : covers === 5 ? 'piece_place_perfect' : 'piece_place_overlap');
    const sprite = this.held;
    const slot = this.heldSlot;
    this.held = null;
    this.tentative = { sprite, slot };
    this.tentativeAt = [...this.cursor];
    sprite.saved = piece.orient;
    sprite.held = false;
    const hs = this.spriteFor(target.hole)!;
    if (!nudging) {
      this.stats.placed++;
      this.recordFocus();
      if (!this.startedAt.has(target.hole.id)) this.startedAt.set(target.hole.id, this.now);
      if (!this.speed) this.board.pieceWillApply(target.index);
      this.neglectSprites(hs, sprite, target.at);
      if (slot >= 0) this.refill(slot);
    } else {
      this.stats.replaced++;
      hs.pieces.push({ sprite, at: target.at });
    }
    if (!nudging && !piece.isPutty && !target.hole.wouldFinish(piece, target.at[0], target.at[1]) && !this.mustCommit()) {
      sprite.state = 4;
    } else {
      this.commit();
    }
  }

  /** Speed: with nothing left in the toolbox, a placement is final. */
  private mustCommit(): boolean {
    return this.speed !== null && this.tools.every((t) => t === null);
  }

  /** Nails in the placed piece, moving it back first if it was picked up to nudge (CarpentryController.u). */
  commitTentative(): void {
    if (!this.tentativeAt) return;
    if (!this.tentative && this.held) {
      const sprite = this.held;
      sprite.piece.orient = sprite.saved;
      this.held = null;
      const target = this.target(this.tentativeAt, sprite.piece);
      if (target) this.spriteFor(target.hole)?.pieces.push({ sprite, at: target.at });
      this.tentative = { sprite, slot: this.heldSlot };
    }
    this.commit();
  }

  private commit(): void {
    const t = this.tentative!;
    const at = this.tentativeAt!;
    this.tentative = null;
    this.tentativeAt = null;
    const target = this.target(at, t.sprite.piece);
    if (!target) return;
    const covered = target.hole.placePiece(t.sprite.piece, target.at);
    if (covered === 0) return;
    t.sprite.state = 5;
    t.sprite.held = false;
    if (t.sprite.piece.isPutty) this.startPour(t.sprite);
    if (target.hole.filled) this.holeFilled(target.hole, target.index);
    else if (this.speed) this.speedAfterCommit();
  }

  private startPour(sprite: PieceSprite): void {
    let r = 0;
    for (const [x, y] of sprite.piece.cells()) for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) r = Math.max(r, Math.hypot(cx - 0.5, cy - 0.5) * CELL);
    sprite.pour = { start: this.now, radius: Math.ceil(r) };
  }

  /** Deals the slot a new piece (CarpentryBoard.populateNextTool), or Jared's speed refill. */
  private refill(slot: number): void {
    if (this.speed) {
      this.board.toolbox[slot] = -1;
      this.tools[slot] = null;
      this.speedRefill(slot);
      return;
    }
    this.board.populateNextTool(slot);
    this.countFound(this.board.toolbox[slot]);
    this.newTool(slot);
  }

  private countFound(tool: number): void {
    const letter = statLetter(tool >> 1);
    this.stats.found[letter] = (this.stats.found[letter] ?? 0) + 1;
    const d = this.stats.pDrought;
    if (letter === 'p') {
      if (d[1] > d[0]) d[0] = d[1];
      d[1] = 0;
    } else d[1]++;
  }

  /** Average pieces in the holes still open, at each placement. */
  private recordFocus(): void {
    const open = this.board.holes.filter((h) => h.size > 0 && !h.filled);
    if (open.length) this.stats.focus.push(open.reduce((a, h) => a + h.piecesUsed, 0) / open.length);
  }

  // ---- Neglect (carpentry/p.c and CarpentryBoardView.a(int, r)) ----

  private neglectSprites(target: HoleSprite, sprite: PieceSprite, at: Cell): void {
    target.pieces.push({ sprite, at });
    target.countdown = MAX_NEGLECT;
    this.stopShake(target);
    target.blink = null;
    if (this.speed) return;
    for (const hs of [...this.holeSprites]) {
      if (hs === target || !this.board.holes.includes(hs.hole)) continue;
      const lost = this.neglect(hs);
      if (lost) {
        this.flyOff(hs, lost);
        this.text('Wasteful...', '#ff0000', 30, this.board.holes.indexOf(hs.hole));
      }
    }
  }

  private neglect(hs: HoleSprite): { sprite: PieceSprite; at: Cell } | null {
    const hole = hs.hole;
    if (hole.filled) return null;
    if (hs.pieces.length === 0) {
      const f = --hs.countdown;
      if (f === 3) {
        if (hole.knock) {
          this.hooks.sound('hole_blinky_warning_slow');
          hs.blink = { period: BLINKS[2], next: this.now, on: false };
        } else hs.countdown = Infinity;
      } else if (f === 2 && hs.blink) {
        this.hooks.sound('hole_blinky_warning_medium');
        hs.blink.period = BLINKS[1];
      } else if (f === 1 && hs.blink) {
        this.hooks.sound('hole_blinky_warning_fast');
        hs.blink.period = BLINKS[0];
      } else if (f === 0) {
        this.hooks.sound('hole_grows');
        hs.blink = null;
        // The board already grew the hole at its knock cell (Hole.pieceNotApplied).
        const k = this.lastKnock(hs);
        if (k) this.grow(hs, k);
        hs.countdown = MAX_NEGLECT;
      }
      return null;
    }
    const f = --hs.countdown;
    if (f === 0) {
      this.hooks.sound('piece_fly_off');
      this.stopShake(hs);
      hs.countdown = MAX_NEGLECT;
      return hs.pieces.pop()!;
    }
    const last = hs.pieces[hs.pieces.length - 1].sprite;
    if (f === 1) {
      this.hooks.sound('piece_rattle_warning_fast');
      last.shake = { amp: 2, period: 1, next: this.now, offset: [0, 0] };
    } else if (f === 2) {
      this.hooks.sound('piece_rattle_warning_slow');
      last.shake = { amp: 1, period: 100, next: this.now, offset: [0, 0] };
    }
    return null;
  }

  /** The cell the hole just grew at: open in the hole, not yet black in the sprite. */
  private lastKnock(hs: HoleSprite): Cell | null {
    const h = hs.hole;
    for (let x = 0; x < h.width; x++) for (let y = 0; y < h.height; y++) if (h.origEmpty[x][y] && !hs.cells[x][y]) return [x, y];
    return null;
  }

  /** The hole's black grows a 2-cell bar across the new cell (carpentry/p.a(Point)). */
  private grow(hs: HoleSprite, [kx, ky]: Cell): void {
    hs.cells[kx][ky] = true;
    const left = kx < Math.trunc(hs.hole.width / 2);
    const x = left ? kx : kx - 1;
    hs.grown.push([x * CELL, ky * CELL, 2 * CELL, CELL]);
    hs.ragged = hs.ragged.filter(([rx, ry]) => !(ry >= ky * CELL && ry < ky * CELL + CELL && rx >= x * CELL && rx < x * CELL + 2 * CELL));
    this.splinter(hs, left, kx, ky);
  }

  private stopShake(hs: HoleSprite): void {
    for (const p of hs.pieces) p.sprite.shake = null;
  }

  /** Flies a lost piece off a random side of the view (CarpentryBoardView.a(r)). */
  private flyOff(hs: HoleSprite, lost: { sprite: PieceSprite; at: Cell }): void {
    const from: Cell = [hs.pos[0] + lost.at[0] * CELL, hs.pos[1] + lost.at[1] * CELL];
    const cells = lost.sprite.piece.cells();
    const w = (Math.max(...cells.map((c) => c[0])) - Math.min(...cells.map((c) => c[0])) + 1) * CELL;
    const h = (Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1])) + 1) * CELL;
    const minX = Math.min(...cells.map((c) => c[0])) * CELL;
    const minY = Math.min(...cells.map((c) => c[1])) * CELL;
    const tx = this.view[0] + (Math.random() < 0.5 ? -(w + 1) : VIEW_W + 1) - minX;
    const ty = this.view[1] + randInt(VIEW_H + h + 1) - (h + 1) - minY;
    lost.sprite.shake = null;
    this.flyers.push({ sprite: lost.sprite, from, to: [tx, ty], start: this.now });
  }

  /** A message rising from the middle of hole `index` (CarpentryBoardView.a(String,...)). */
  private text(text: string, colour: string, size: number, index: number): void {
    const hole = this.board.holes[index];
    const hs = hole ? this.spriteFor(hole) : undefined;
    const at: Cell = hs
      ? [hs.pos[0] + (hole.width * CELL) / 2, hs.pos[1] + (hole.height * CELL) / 2]
      : [this.view[0] + VIEW_W / 2, this.view[1] + VIEW_H / 2];
    this.texts.push({ text, colour, size, at, start: this.now });
  }

  // ---- Finished holes (CarpentryController.a(Hole, int)) ----

  private holeFilled(hole: Hole, index: number): void {
    const rank = Math.min(2, hole.rank);
    const grade = 2 - rank;
    this.stats.grades[grade]++;
    this.stats.holesFilled++;
    const started = this.startedAt.get(hole.id);
    if (started !== undefined) {
      const took = this.now - started;
      if (took > this.stats.holeTimes[0]) this.stats.holeTimes[0] = took;
      if (took < this.stats.holeTimes[1]) this.stats.holeTimes[1] = took;
    }
    this.filled++;
    if (this.speed) {
      this.clearSpeedHole(index);
      if (this.speed.size > 1) this.speedHoleDone = true;
      this.speedAfterCommit();
      return;
    }
    this.text(RANKS[rank].text, '#ffffff', 36, index);
    this.hooks.sound(RANKS[rank].sound, RANK_SOUND_DELAY);
    const [dx, dy] = this.board.checkForNewHoles(LEVEL_HOLES - this.filled);
    if (this.filled >= LEVEL_HOLES) {
      this.waiting = true;
      this.later(TEXT_MS, () => this.levelUp());
    } else if (dx !== 0 || dy !== 0) {
      this.waiting = true;
      const ms = dx !== 0 && dy !== 0 ? DIAGONAL_MS : SCROLL_MS;
      this.stats.animating += TEXT_MS + ms;
      this.stats.scrolls[dx !== 0 && dy !== 0 ? 1 : 0]++;
      this.later(TEXT_MS, () => {
        this.waiting = false;
        this.scrollNewHoles(dx, dy);
      });
    }
  }

  /** New holes come in beside the ones that stay, and the view scrolls to them (CarpentryBoardView.d). */
  private scrollNewHoles(dx: number, dy: number): void {
    const shift: Cell = [-dx * COL_STEP, -dy * ROW_STEP];
    for (let i = 0; i < NUM_HOLES; i++) if (!this.holeSprites.some((s) => s.hole === this.board.holes[i])) this.layOut(i, shift);
    this.startScroll(shift, () => this.endScroll());
  }

  /** "Nice work!" scrolls in, then the board's done (CarpentryController k, CarpentryBoardView.b(String)). */
  private levelUp(): void {
    const shift = this.randomShift();
    this.levelText = { at: [this.view[0] + VIEW_W / 2 + shift[0], this.view[1] + VIEW_H / 4 + shift[1]] };
    if (this.held && this.heldSlot >= 0) this.resetTool(this.heldSlot);
    this.held = null;
    const ms = this.startScroll(shift, () => {
      this.holeSprites = [];
    });
    this.stats.animating += TEXT_MS + ms + LEVEL_PAUSE;
    this.later(ms + LEVEL_PAUSE, () => this.hooks.levelDone());
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push({ at: this.now + ms, fn });
  }

  // ---- Each frame ----

  update(now: number, updateVisualEffects = true): void {
    this.now = now;
    const due = this.timers.filter((t) => t.at <= now);
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) t.fn();
    if (this.scroll) {
      const s = this.scroll;
      const t = Math.min(1, (now - s.start) / s.ms);
      this.view = [lerp(s.from[0], s.to[0], t), lerp(s.from[1], s.to[1], t)];
      if (t >= 1) {
        this.view = [...s.to];
        this.scroll = null;
        s.then();
      }
    }
    if (updateVisualEffects) {
      for (const hs of this.holeSprites) {
        if (hs.blink && now >= hs.blink.next) {
          hs.blink.on = !hs.blink.on;
          hs.blink.next = now + hs.blink.period;
        }
        for (const p of hs.pieces) {
          const sh = p.sprite.shake;
          if (sh && now >= sh.next) {
            let o: Cell;
            do o = [randInt(sh.amp * 2 + 1) - sh.amp, randInt(sh.amp * 2 + 1) - sh.amp];
            while (o[0] === sh.offset[0] && o[1] === sh.offset[1]);
            sh.offset = o;
            sh.next = now + sh.period;
          }
        }
      }
    }
    this.flyers = this.flyers.filter((f) => now - f.start < FLY_MS);
    this.texts = this.texts.filter((t) => now - t.start < TEXT_MS);
  }

  /** Where a flyer is now, in world pixels. */
  flyerAt(f: Flyer): Cell {
    const t = Math.min(1, (this.now - f.start) / FLY_MS);
    return [lerp(f.from[0], f.to[0], t), lerp(f.from[1], f.to[1], t)];
  }

  /** The star meter's fill, 0-100 (CarpentryController: holes x 100 / 17); speed goes round again. */
  get meter(): number {
    const filled = this.speed ? this.filled % LEVEL_HOLES : this.filled;
    return Math.min(100, Math.trunc((filled * 100) / LEVEL_HOLES));
  }

  // ---- Speed (Jared's simulator) ----

  private setUpSpeed(): void {
    const speed = this.speed!;
    this.speedSeed = this.prng.randintN(0, 999999999999999);
    this.board.holes = this.board.holes.map(() => Hole.blank(++this.board.holesGenerated));
    this.board.toolbox.fill(-1);
    const order = this.prng.shuffle([0, 1, 2, 3]);
    let made = 0;
    for (const z of order) if (made < speed.holes) {
      this.makeSmallHole(z);
      made++;
    }
    if (speed.size === 1) {
      const needed = this.prng.shuffle(this.board.holes.flatMap((h) => this.speedNeeded.get(h.id) ?? []));
      const dealt = Math.min(3, speed.holes);
      for (let z = 0; z < dealt; z++) this.setTool(z, needed[z]);
      for (let z = dealt; z < 3; z++) this.setTool(z, this.randomLetter());
    } else {
      this.piecesUntilRefresh = speed.size;
      this.dealCombination();
    }
  }

  private requiredLetter(): string {
    return this.speed!.letter < 12 ? PIECES_NO_PUTTY[this.speed!.letter] : '';
  }

  private smallHoleTable() {
    const letter = this.requiredLetter();
    if (this.speed!.size === 2) return letter === 'x' ? [...TWO_PIECE_HOLES_WITH_X] : holesWith(TWO_PIECE_HOLES, letter);
    return holesWith(THREE_PIECE_HOLES, letter);
  }

  /** A small hole into spot z (hole_creation_small), trimmed to its cells. */
  private makeSmallHole(z: number): void {
    const codes = this.board.holes.map((h) => this.speedCodes.get(h.id) ?? '');
    const [small, next] = createSmallHole(this.prng, this.speed!.size, codes, this.smallHoleTable(), this.speedSeed);
    this.speedSeed = next;
    const rows = small.grid;
    const ys = rows.map((row, y) => (row.some((v) => v === 1) ? y : -1)).filter((y) => y >= 0);
    const xs = rows[0].map((_, x) => (rows.some((row) => row[x] === 1) ? x : -1)).filter((x) => x >= 0);
    const cells = Array.from({ length: Math.max(...xs) - Math.min(...xs) + 1 }, (_, x) =>
      Array.from({ length: Math.max(...ys) - Math.min(...ys) + 1 }, (_, y) => rows[y + Math.min(...ys)][x + Math.min(...xs)] === 1),
    );
    const hole = Hole.shaped(cells, ++this.board.holesGenerated);
    this.board.holes[z] = hole;
    this.speedNeeded.set(hole.id, small.needed);
    this.speedCodes.set(hole.id, small.code);
  }

  private randomLetter(): string {
    return this.prng.choiceWeighted(PIECES_NO_PUTTY, PIECE_WEIGHTS_NO_PUTTY);
  }

  private setTool(slot: number, letter: string): void {
    const kind = PIECE_LETTERS.indexOf(letter as (typeof PIECE_LETTERS)[number]);
    const grain = 'ilny'.includes(letter) ? 1 : this.orientRng.nextInt(2);
    this.board.toolbox[slot] = (kind << 1) | grain;
    this.countFound(this.board.toolbox[slot]);
  }

  /** Sizes 2-3: the toolbox holds one way to fill one of the holes. */
  private dealCombination(): void {
    const pools = this.board.holes.map((h, i) => ((this.speedNeeded.get(h.id) ?? []).length ? i : -1)).filter((i) => i >= 0);
    if (!pools.length) return;
    const pool = this.prng.choicesUniform(pools);
    const combination = this.prng.choicesUniform(this.speedNeeded.get(this.board.holes[pool].id)!);
    const letters = this.prng.shuffle(combination.split('').concat(Array(3 - combination.length).fill('')));
    letters.forEach((letter, slot) => (letter ? this.setTool(slot, letter) : (this.board.toolbox[slot] = -1)));
  }

  /** Size 1: a used slot gets another piece a hole needs (topUpToolbox). */
  private speedRefill(slot: number): void {
    const speed = this.speed!;
    if (speed.size !== 1) {
      this.piecesUntilRefresh--;
      return;
    }
    const needed = this.prng.shuffle(this.board.holes.flatMap((h) => this.speedNeeded.get(h.id) ?? []));
    if (speed.holes === 1) {
      const order = this.prng.shuffle([0, 1, 2]);
      if (needed.length) this.setTool(order[0], needed[0]);
      for (const other of order.slice(1)) this.setTool(other, this.randomLetter());
      for (let i = 0; i < NUM_TOOLS; i++) if (i !== slot) this.newTool(i);
    } else {
      const inToolbox: string[] = this.board.toolbox.map((t) => (t >= 0 ? PIECE_LETTERS[t >> 1] : ''));
      const pick = needed.find((letter) => !inToolbox.includes(letter));
      this.setTool(slot, pick ?? this.randomLetter());
    }
    this.newTool(slot);
  }

  /** Empties spot z and deals a new small hole into a free spot (clearSpeedHole). */
  private clearSpeedHole(z: number): void {
    const old = this.board.holes[z];
    this.speedNeeded.delete(old.id);
    this.speedCodes.delete(old.id);
    this.board.holes[z] = Hole.blank(++this.board.holesGenerated);
    const free = [0, 1, 2, 3].filter((i) => this.board.holes[i].size === 0);
    if (4 - free.length < this.speed!.holes) this.makeSmallHole(this.prng.shuffle(free)[0]);
    this.relayOut();
  }

  /** Speed holes appear where they're dealt, without scrolling. */
  private relayOut(): void {
    const kept = this.holeSprites.filter((s) => this.board.holes.includes(s.hole));
    this.holeSprites = kept;
    for (let i = 0; i < NUM_HOLES; i++) if (!kept.some((s) => s.hole === this.board.holes[i])) this.layOut(i, [0, 0]);
  }

  /** Sizes 2-3: after the last piece, a new combination or one more random piece (speedRefresh). */
  private speedAfterCommit(): void {
    const speed = this.speed!;
    if (speed.size === 1) return;
    if (this.piecesUntilRefresh > 0 && !this.speedHoleDone) return;
    if (!this.speedHoleDone) {
      // Out of pieces without finishing: one more random piece.
      this.piecesUntilRefresh++;
      const slot = this.prng.choicesUniform([0, 1, 2]);
      this.setTool(slot, this.randomLetter());
      this.newTool(slot);
      return;
    }
    this.speedHoleDone = false;
    // Holes left half-filled count as Slipshod and are replaced.
    this.board.holes.forEach((hole, z) => {
      if (hole.size === 0 || hole.filled || hole.piecesUsed === 0) return;
      this.stats.grades[0]++;
      this.clearSpeedHole(z);
    });
    this.piecesUntilRefresh = speed.size;
    this.dealCombination();
    for (let i = 0; i < NUM_TOOLS; i++) this.newTool(i);
  }
}

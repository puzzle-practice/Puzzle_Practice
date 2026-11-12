// The Dennav tutorial's engine: plays a position under Dennav rules, reads back what kind of chain a
// move set off, and makes new positions (recoloured, turned, mirrored and reshuffled examples, and
// boards scrambled back to an earlier stage). Every board it hands out is checked by playing it.
import { NavigationGame, DEFAULT_SETTINGS, type NavigationSettings, type Scene } from '../navigation/game';
import { EMPTY, NaviBoard, type Run, type Target } from '../navigation/logic';
import { readBoardCode } from '../navigation/create';
import { Random } from '../../core/random';

export const RINGS = 4;
/** Ring indices count from the outside, as in the game: 3 is the innermost ring. */
export const INNER = 3, MIDDLE = 2, TOP = 1, EXTRA = 0;
/** The player's ring numbers: ring 1 is the innermost, ring 4 the extra outer ring. */
export const ringName = (ring: number): string => `ring ${RINGS - ring}`;

export const SETTINGS: NavigationSettings = { ...DEFAULT_SETTINGS, mode: 'ww-test', extraRing: true, wildTargets: true, timerMs: 0, clears: false, dismissDelayMs: 0, slowDrop: true, create: true };

export interface Position { cells: number[]; targets: Target[]; entry: { colour: number; octant: number } }
export type Action = { kind: 'rotate'; ring: number; clockwise: boolean } | { kind: 'drop' };

export function readPosition(code: string): Position {
  const read = readBoardCode(code);
  if (!read || read.rings !== RINGS) throw new Error(`Bad board: ${code}`);
  return { cells: read.cells, targets: read.targets, entry: read.entry };
}
export function positionCode(p: Position): string {
  const cells = p.cells.map((c) => (c === EMPTY ? '.' : String(c))).join('');
  const targets = p.targets.map((t) => `${t.ring}${t.octant}${t.wild ? '*' : t.colour}`).join(',');
  return `N${RINGS}:${cells}:${targets}:${p.entry.colour}${p.entry.octant}`;
}
export const clonePosition = (p: Position): Position => ({ cells: [...p.cells], targets: p.targets.map((t) => ({ ...t })), entry: { ...p.entry } });

/** A game with the position on it, as Freeplay plays a painted board. */
export function gameAt(p: Position, seed = 1): NavigationGame {
  const game = new NavigationGame(SETTINGS, seed);
  p.cells.forEach((c, i) => { game.board.cells[i] = c; });
  game.targets = p.targets.map((t) => ({ ...t }));
  game.entry = { ...p.entry };
  return game;
}
export function positionOf(game: NavigationGame): Position {
  return { cells: [...game.board.cells], targets: game.targets.map((t) => ({ ...t })), entry: { ...game.entry } };
}
export function act(game: NavigationGame, action: Action): Scene[] {
  return action.kind === 'drop' ? game.drop() : game.rotate(action.ring, action.clockwise);
}

/** One clear in a chain: a pass of star runs, or the constellation charted. */
export interface Link {
  kind: 'run' | 'target';
  chain: number;
  runs: Run[];
  /** Targets this pass turned wild. */
  wilded: Target[];
  /** After a constellation was charted in the same move (a cascade). */
  afterChart: boolean;
  scene: Scene;
}
export interface Outcome {
  links: Link[];
  /** The chain the (first) constellation was charted in: 1 single, 2 double, 3 triple, 4 bingo, 5 donkey, 6+ vegas. */
  charted: number | null;
  /** The constellation dealt after charting starts with its inner targets wild. */
  nextInnerWild: boolean;
  after: Position;
}

function boardOf(cells: number[]): NaviBoard {
  const board = new NaviBoard(RINGS, 4, 1, true);
  cells.forEach((c, i) => { board.cells[i] = c; });
  return board;
}

/** Reads a move's scenes back into the links of its chain. */
export function outcome(scenes: Scene[], after: Position): Outcome {
  const links: Link[] = [];
  let previous: Target[] | null = null, charted: number | null = null;
  for (const scene of scenes) {
    if (scene.clear) {
      if (scene.clear.kind === 'target') {
        if (charted === null) charted = scene.clear.chain;
        links.push({ kind: 'target', chain: scene.clear.chain, runs: [], wilded: [], afterChart: charted !== null && links.some((l) => l.kind === 'target'), scene });
      } else {
        const runs = boardOf(scene.cells).findRuns();
        const before = previous ?? scene.targets;
        const wilded = scene.targets.filter((t) => t.wild && !before.some((b) => b.ring === t.ring && b.octant === t.octant && b.wild));
        links.push({ kind: 'run', chain: scene.clear.chain, runs, wilded, afterChart: charted !== null, scene });
      }
    }
    previous = scene.targets;
  }
  const inner = after.targets.filter((t) => t.ring === INNER);
  return { links, charted, nextInnerWild: charted !== null && inner.length > 0 && inner.every((t) => t.wild), after };
}

export function play(p: Position, action: Action): Outcome {
  const game = gameAt(p);
  const scenes = act(game, action);
  return outcome(scenes, positionOf(game));
}

export const horizontalIn = (link: Link | undefined, ring: number): boolean => !!link && link.runs.some((r) => r.direction === 0 && r.ring === ring);
/** A vertical run through rings 1, 2 and 3 (from the innermost ring out). */
export const verticalThroughInner = (link: Link | undefined): boolean => !!link && link.runs.some((r) => r.direction === 1 && r.ring === INNER && r.length >= 3);
export const chainName = (chain: number): string => chain >= 6 ? `Vegas${chain > 6 ? ` ${chain - 5}` : ''}` : ['', 'Single', 'Double', 'Triple', 'Bingo', 'Donkey'][chain];

/** Whether the position could be on the board waiting for a move: settled, no runs, not yet charted. */
export function settled(p: Position): boolean {
  const game = gameAt(p);
  return !game.unsettled && game.targets.length > 0;
}

/** Moves the next star over a free column if it would land on a star (and booch). */
export function freeEntry(p: Position, rng?: Random): Position {
  if (p.cells[p.entry.octant] === EMPTY) return p;
  const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((o) => p.cells[o] === EMPTY);
  if (free.length) p.entry.octant = free[rng ? rng.integer(0, free.length - 1) : 0];
  return p;
}

// --- Making new examples ---------------------------------------------------------------------

/** Turns every ring by `steps` octants and optionally mirrors the board, keeping the move the same move. */
export function transform(p: Position, action: Action, steps: number, mirror: boolean, colours: number[]): { position: Position; action: Action } {
  const octant = (o: number) => ((mirror ? 8 - o : o) + steps + 16) % 8;
  const cells = Array<number>(RINGS * 8).fill(EMPTY);
  for (let ring = 0; ring < RINGS; ring++) for (let o = 0; o < 8; o++) {
    const c = p.cells[ring * 8 + o];
    cells[ring * 8 + octant(o)] = c === EMPTY ? EMPTY : colours[c];
  }
  const targets = p.targets.map((t) => ({ ...t, octant: octant(t.octant), colour: colours[t.colour] }));
  const entry = { colour: colours[p.entry.colour], octant: octant(p.entry.octant) };
  return { position: { cells, targets, entry }, action: action.kind === 'rotate' && mirror ? { ...action, clockwise: !action.clockwise } : action };
}

export function shuffle<T>(rng: Random, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = rng.integer(0, i); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The top star of each column can change colour, go, or have one more put on it; a target can move round its ring or change colour. */
function mutate(rng: Random, p: Position): Position {
  const next = clonePosition(p);
  const kind = rng.integer(0, 5);
  const octant = rng.integer(0, 7);
  const column = [0, 1, 2, 3].map((ring) => next.cells[ring * 8 + octant]);
  const top = column.findIndex((c) => c !== EMPTY);
  if (kind <= 1) {
    // Recolour any star.
    const filled = next.cells.map((c, i) => c === EMPTY ? -1 : i).filter((i) => i >= 0);
    if (filled.length) next.cells[filled[rng.integer(0, filled.length - 1)]] = rng.integer(0, 4);
  } else if (kind === 2) {
    if (top >= 0) next.cells[top * 8 + octant] = EMPTY;
  } else if (kind === 3) {
    const ring = top === -1 ? RINGS - 1 : top - 1;
    if (ring >= 1) next.cells[ring * 8 + octant] = rng.integer(0, 4);
  } else if (kind === 4) {
    const t = next.targets[rng.integer(0, next.targets.length - 1)];
    if (!next.targets.some((u) => u !== t && u.ring === t.ring && u.octant === octant)) t.octant = octant;
    // A moved target that isn't wild takes the colour of the star it moved onto half the time, so it stays filled.
    const star = next.cells[t.ring * 8 + t.octant];
    if (!t.wild && star !== EMPTY && rng.integer(0, 1)) t.colour = star;
  } else {
    const t = next.targets[rng.integer(0, next.targets.length - 1)];
    if (!t.wild) t.colour = rng.integer(0, 4);
  }
  return next;
}

export interface Example { position: Position; action: Action }

/**
 * A fresh example of a strategy from one of its seed boards: new colours, turned and maybe mirrored,
 * then reshuffled one change at a time, keeping only changes after which the move still sets off
 * the same strategy.
 */
export function generate(seed: Example, accepts: (o: Outcome) => boolean, rng: Random, changes = 60): Example {
  const colours = shuffle(rng, [0, 1, 2, 3, 4]);
  const base = transform(seed.position, seed.action, rng.integer(0, 7), rng.integer(0, 1) === 1, colours);
  let position = base.position;
  const ok = (p: Position) => settled(p) && accepts(play(p, base.action));
  if (!ok(position)) return { position: seed.position, action: seed.action };
  for (let i = 0, accepted = 0; i < changes * 6 && accepted < changes; i++) {
    const next = mutate(rng, position);
    if (ok(next)) { position = next; accepted++; }
  }
  return { position: freeEntry(position, rng), action: base.action };
}

function rotateCells(p: Position, ring: number, clockwise: boolean): Position {
  const board = boardOf(p.cells);
  board.rotate(ring, clockwise);
  return { ...clonePosition(p), cells: [...board.cells] };
}

/**
 * An earlier stage of an example: `moves` ring turns away from the move that sets the strategy off.
 * Returns the board and the turns that solve it, in order (the strategy's own move last).
 */
export function scramble(example: Example, moves: number, accepts: (o: Outcome) => boolean, rng: Random): { position: Position; solution: Action[] } | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    let position = clonePosition(example.position);
    const undo: Action[] = [];
    let lastRing = -1, ok = true;
    for (let m = 0; m < moves; m++) {
      const rings = [0, 1, 2, 3].filter((r) => r !== lastRing && position.cells.slice(r * 8, r * 8 + 8).some((c) => c !== EMPTY));
      if (!rings.length) { ok = false; break; }
      const ring = rings[rng.integer(0, rings.length - 1)];
      const clockwise = rng.integer(0, 1) === 1;
      // Don't scramble by turning the trigger ring straight back to where it was: that would be the move itself.
      if (example.action.kind === 'rotate' && m === 0 && ring === example.action.ring && clockwise !== example.action.clockwise) { ok = false; break; }
      position = rotateCells(position, ring, clockwise);
      undo.unshift({ kind: 'rotate', ring, clockwise: !clockwise });
      lastRing = ring;
      if (!settled(position)) { ok = false; break; }
    }
    if (!ok) continue;
    // Replaying the solution must reach the example and set it off.
    const game = gameAt(position);
    let clean = true;
    for (const step of undo) if (act(game, step).some((s) => s.clear)) clean = false;
    if (!clean) continue;
    if (!accepts(outcome(act(game, example.action), positionOf(game)))) continue;
    return { position, solution: [...undo, example.action] };
  }
  return null;
}

// --- Spot the mistake ---------------------------------------------------------------------------

export interface Mistake extends Example {
  /** The cell (ring * 8 + octant) holding the wrong star, and the colour that works there. */
  cell: number;
  fix: number;
  /** What the move does with the wrong star: charts lower, or doesn't set the strategy off at all. */
  result: Outcome;
}

/** Recolours one star so the strategy breaks or charts lower, keeping the board one the game could show. */
export function makeMistake(example: Example, accepts: (o: Outcome) => boolean, rng: Random): Mistake | null {
  const good = play(example.position, example.action);
  const options: Mistake[] = [];
  example.position.cells.forEach((colour, cell) => {
    if (colour === EMPTY) return;
    for (let other = 0; other < 5; other++) {
      if (other === colour) continue;
      const position = clonePosition(example.position);
      position.cells[cell] = other;
      if (!settled(position)) continue;
      const result = play(position, example.action);
      if (accepts(result)) continue;
      // A mistake should spoil the move, not make it better.
      if ((result.charted ?? 0) > (good.charted ?? 0)) continue;
      options.push({ position, action: example.action, cell, fix: colour, result });
    }
  });
  if (!options.length) return null;
  // Prefer stars the chain actually uses: ones that clear or fill a target in the working move.
  const used = new Set(good.links.flatMap((l) => l.scene.clear?.cells.map((c) => c.ring * 8 + c.octant) ?? []));
  const key = options.filter((m) => used.has(m.cell));
  const pool = key.length && rng.integer(0, 3) ? key : options;
  return pool[rng.integer(0, pool.length - 1)];
}

/** Whether recolouring the star in `cell` (to some colour) would make the move work again. */
export function fixes(mistake: Example, cell: number, accepts: (o: Outcome) => boolean): boolean {
  if (mistake.position.cells[cell] === EMPTY) return false;
  for (let colour = 0; colour < 5; colour++) {
    if (colour === mistake.position.cells[cell]) continue;
    const position = clonePosition(mistake.position);
    position.cells[cell] = colour;
    if (settled(position) && accepts(play(position, mistake.action))) return true;
  }
  return false;
}

// --- Building a board up, move by move ---------------------------------------------------------

/** How a board was built: the board before each move (a drop's falling star is its entry), then the finished board. */
export interface Build {
  boards: Position[];
  moves: Action[];
  /** Moves whose clears were meant: junk stars cleared out of the way. */
  junk: number[];
}

/** Plays a build's moves from its first board, each drop with its own star. Null if a drop booches. */
export function replayBuild(build: { boards: Position[]; moves: Action[] }, entries = dropEntries(build)): { boards: Position[]; clears: number[][] } | null {
  const game = gameAt(build.boards[0]);
  const boards: Position[] = [];
  const clears: number[][] = [];
  let next = 0;
  for (const move of build.moves) {
    if (move.kind === 'drop') {
      const entry = entries[next++];
      if (!entry) return null;
      game.entry = { ...entry };
      if (game.board.get(entry.octant, 0) !== EMPTY) return null;
    }
    boards.push(positionOf(game));
    const scenes = act(game, move);
    clears.push(scenes.flatMap((s) => s.clear?.kind === 'run' ? s.clear.cells.map((c) => c.ring * 8 + c.octant) : []));
    if (scenes.some((s) => s.clear?.kind === 'target')) clears[clears.length - 1].push(-1);
  }
  boards.push(positionOf(game));
  return { boards, clears };
}
export const dropEntries = (build: { boards: Position[]; moves: Action[] }) =>
  build.moves.map((m, i) => (m.kind === 'drop' ? build.boards[i].entry : null)).filter((e): e is Position['entry'] => !!e);

/**
 * Works a finished board backwards into the last `drops` stars that built it, as the game deals them:
 * each star falls in a random column and the player turns its ring to take it where it belongs
 * (turning that ring's other stars with it). Now and then a junk star is cleared out of the way:
 * two of a colour waiting in a ring, and the third dropped beside them.
 */
export function buildUp(final: Position, rng: Random, drops: number): Build | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    let board = clonePosition(final);
    const units: { board: Position; moves: Action[]; junk: boolean }[] = [];
    for (let tries = 0; units.length < drops && tries < drops * 30; tries++) {
      const unit = rng.integer(0, 3) === 0 ? junkUnit(board, rng) : dropUnit(board, rng);
      if (!unit) continue;
      units.unshift(unit);
      board = unit.board;
    }
    if (units.length < drops) continue;
    const boards: Position[] = [], moves: Action[] = [], junk: number[] = [];
    for (const unit of units) {
      unit.moves.forEach((move, i) => {
        if (i === 0) boards.push(unit.board);
        else boards.push(clonePosition(unit.board));
        if (unit.junk) junk.push(moves.length);
        moves.push(move);
      });
    }
    const build: Build = { boards: [...boards, clonePosition(final)], moves, junk };
    const played = replayBuild(build);
    if (!played || played.boards.at(-1)!.cells.some((c, i) => c !== final.cells[i])) continue;
    if (played.clears.some((c, i) => c.length > 0 && !junk.includes(i))) continue;
    // Keep the boards as played, each drop's board showing its falling star.
    const entries = dropEntries(build);
    let next = 0;
    build.boards = played.boards.map((b, i) => ({ ...b, entry: build.moves[i]?.kind === 'drop' ? { ...entries[next++] } : b.entry }));
    build.boards[build.boards.length - 1] = { ...build.boards[build.boards.length - 1], entry: { ...final.entry } };
    return build;
  }
  return null;
}

/** Undoes one star: it fell in a random column, then its ring turned it to where it is now. */
function dropUnit(board: Position, rng: Random): { board: Position; moves: Action[]; junk: boolean } | null {
  const tops = [0, 1, 2, 3, 4, 5, 6, 7].map((octant) => ({ octant, ring: [0, 1, 2, 3].find((r) => board.cells[r * 8 + octant] !== EMPTY) ?? -1 })).filter((t) => t.ring >= 0);
  if (!tops.length) return null;
  const { octant: p, ring: r } = tops[rng.integer(0, tops.length - 1)];
  const e = rng.integer(0, 7);
  const diff = (e - p + 8) % 8;
  // Turning clockwise takes a star one octant down; the shorter way round.
  const clockwise = diff <= 4, steps = clockwise ? diff : 8 - diff;
  let before = clonePosition(board);
  for (let i = 0; i < steps; i++) before = rotateCells(before, r, !clockwise);
  if (before.cells[r * 8 + e] !== board.cells[r * 8 + p]) return null;
  if ([0, 1, 2, 3].some((q) => q < r && before.cells[q * 8 + e] !== EMPTY)) return null;
  if (r < RINGS - 1 && before.cells[(r + 1) * 8 + e] === EMPTY) return null;
  const colour = before.cells[r * 8 + e];
  before.cells[r * 8 + e] = EMPTY;
  before.entry = { colour, octant: e };
  if (!settled(before)) return null;
  return { board: before, moves: [{ kind: 'drop' }, ...Array.from({ length: steps }, () => ({ kind: 'rotate' as const, ring: r, clockwise }))], junk: false };
}

/** Undoes a junk clear: two stars of a colour wait side by side in a ring, and the third drops in beside them. */
function junkUnit(board: Position, rng: Random): { board: Position; moves: Action[]; junk: boolean } | null {
  const open = (ring: number, octant: number) => board.cells[ring * 8 + octant] === EMPTY &&
    (ring === RINGS - 1 || board.cells[(ring + 1) * 8 + octant] !== EMPTY) && [0, 1, 2, 3].every((q) => q >= ring || board.cells[q * 8 + octant] === EMPTY);
  const slots: { ring: number; octant: number }[] = [];
  for (let ring = 1; ring < RINGS; ring++) for (let a = 0; a < 8; a++) if ([0, 1, 2].every((k) => open(ring, (a + k) % 8))) slots.push({ ring, octant: a });
  if (!slots.length) return null;
  const { ring, octant } = slots[rng.integer(0, slots.length - 1)];
  const colour = rng.integer(0, 4), missing = rng.integer(0, 2);
  const before = clonePosition(board);
  [0, 1, 2].forEach((k) => { if (k !== missing) before.cells[ring * 8 + (octant + k) % 8] = colour; });
  before.entry = { colour, octant: (octant + missing) % 8 };
  if (!settled(before)) return null;
  return { board: before, moves: [{ kind: 'drop' }], junk: true };
}

/** A build with one wrong move in it. */
export interface BadBuild extends Build {
  /** The wrong move (index into `moves`) and what it should have been (null: no move). */
  culprit: number;
  meant: Action | null;
  /** The planned turn was left out: `culprit` is the move made in its place. */
  skipped: boolean;
  kind: 'clear' | 'target';
  /** Clears each move set off as played: cells, and -1 for a charted constellation. */
  clears: number[][];
  result: Outcome;
}

const ROTATIONS: Action[] = [0, 1, 2, 3].flatMap((ring) => [true, false].map((clockwise) => ({ kind: 'rotate' as const, ring, clockwise })));
const sameMove = (a: Action | null, b: Action | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Spoils a build with one wrong turn, as players do: a turn the wrong way or of the wrong ring, a
 * turn too few, or an extra one before a drop. The rest of the build is played as planned. Kept only
 * if the wrong turn sets off a clear that wasn't meant (an accidental clear), or quietly leaves a
 * target it should have filled wrong; either way the trigger no longer sets the strategy off.
 */
export function spoilBuild(build: Build, trigger: Action, accepts: (o: Outcome) => boolean, rng: Random, want?: 'clear' | 'target'): BadBuild | null {
  const entries = dropEntries(build);
  const good = replayBuild(build, entries)!;
  const goodFinal = good.boards.at(-1)!;
  const filled = (p: Position, t: Target) => t.wild ? p.cells[t.ring * 8 + t.octant] !== EMPTY : p.cells[t.ring * 8 + t.octant] === t.colour;
  for (let attempt = 0; attempt < 120; attempt++) {
    const i = rng.integer(Math.floor(build.moves.length / 3), build.moves.length - 1);
    const planned = build.moves[i];
    const options: (Action | null)[] = planned.kind === 'rotate' ? [null, ...ROTATIONS.filter((r) => !sameMove(r, planned))] : ROTATIONS;
    const wrong = options[rng.integer(0, options.length - 1)];
    // A wrong turn before a drop is an extra move; otherwise it replaces the planned move.
    const moves = planned.kind === 'drop' ? [...build.moves.slice(0, i), wrong!, ...build.moves.slice(i)]
      : [...build.moves.slice(0, i), ...(wrong ? [wrong] : []), ...build.moves.slice(i + 1)];
    if (!wrong && i >= moves.length) continue;
    const played = replayBuild({ boards: build.boards, moves }, entries);
    if (!played) continue;
    const final = played.boards.at(-1)!;
    if (!settled(final)) continue;
    const result = play(final, trigger);
    if (accepts(result)) continue;
    // The move to point at: the wrong turn itself, or for a missing turn, the move that came instead.
    const culprit = i;
    const junkPlayed = new Set(build.junk.map((j) => (planned.kind === 'drop' && j >= i ? j + 1 : !wrong && j > i ? j - 1 : j)));
    const accidental = played.clears.some((c, k) => k >= culprit && c.length > 0 && !junkPlayed.has(k));
    const missed = final.targets.some((t) => filled(goodFinal, t) && !filled(final, t));
    const kind = accidental ? 'clear' : missed ? 'target' : null;
    if (!kind || (want && kind !== want)) continue;
    // An accidental clear should come from the wrong move itself, not long after it.
    if (kind === 'clear' && !(played.clears[culprit]?.length)) continue;
    const meant = planned.kind === 'drop' ? null : planned;
    let next = 0;
    const boards = played.boards.map((b, k) => ({ ...b, entry: moves[k]?.kind === 'drop' ? { ...entries[next++] } : b.entry }));
    return { boards, moves, junk: [...junkPlayed], culprit, meant, skipped: !wrong, kind, clears: played.clears, result };
  }
  return null;
}

/**
 * The stars, by their cell before the move, that a move's star runs clear (constellation stars aside).
 * Follows each star through the move's turn, falls and clears.
 */
export function runStars(p: Position, action: Action): number[] {
  const game = gameAt(p);
  const scenes = act(game, action);
  const ids = p.cells.map((c, i) => (c === EMPTY ? -1 : i));
  const used = new Set<number>();
  for (const scene of scenes) {
    if (scene.rotation) {
      const { ring, clockwise } = scene.rotation;
      const row = ids.slice(ring * 8, ring * 8 + 8);
      for (let i = 0; i < 8; i++) ids[ring * 8 + i] = row[(i + (clockwise ? 1 : 7)) % 8];
    }
    for (const f of scene.falls ?? []) { ids[f.ring * 8 + f.octant] = ids[f.from * 8 + f.octant]; ids[f.from * 8 + f.octant] = -1; }
    if (scene.clear) for (const c of scene.clear.cells) {
      const id = ids[c.ring * 8 + c.octant];
      if (scene.clear.kind === 'run' && id >= 0) used.add(id);
      ids[c.ring * 8 + c.octant] = -1;
    }
  }
  return [...used];
}

/** The longest build-up it can find of up to `drops` stars (at least 3). */
export function buildUpAtMost(final: Position, rng: Random, drops: number): Build | null {
  for (let n = drops; n >= 3; n--) {
    const build = buildUp(final, rng, n);
    if (build) return build;
  }
  return null;
}

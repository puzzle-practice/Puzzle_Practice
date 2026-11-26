// The Solo Dnav Planner's search: the fastest lines one pirate can play to clear each Woodhallow werewolf
// wave, found the same way as Gizmo's Dnav strategies.

export const START_BOARD = 71;
export const BOOCH_BOARD = 125;
export const TRIPLE_BOARD = 173;
/** Points per werewolf. A wave is cleared once less than half a werewolf is left. */
export const WOLF_POINTS = 200;

export type TimeId = 'booch' | 'single' | 'cascade' | 'double' | 'triple' | 'bingo' | 'donkey' | 'vegas';
/** Seconds each move takes; 0 or less means the move isn't used. */
export type Times = Record<TimeId, number>;

/** The moves the player times. Only the Booch has a default; the rest are the player's to fill in. Blank means not used. */
export const TIME_FIELDS: { id: TimeId; label: string; def: number | '' }[] = [
  { id: 'booch', label: 'Booch', def: 9 },
  { id: 'cascade', label: 'Cascade single', def: '' },
  { id: 'single', label: 'Finishing single', def: '' },
  { id: 'double', label: 'Double', def: '' },
  { id: 'triple', label: 'Triple', def: '' },
  { id: 'bingo', label: 'Bingo', def: '' },
  { id: 'donkey', label: 'Donkey', def: '' },
  { id: 'vegas', label: 'Vegas', def: '' },
];

interface Move {
  id: Exclude<TimeId, 'booch'>;
  label: string;
  mult: number;
  leaves: number;
  /** Brings its own Booch, so it scores off a Booch board and takes the Booch time too. */
  booch?: boolean;
  /** Only ever the last move: nothing is set up to keep playing after it. */
  final?: boolean;
}

const MOVES: Move[] = [
  { id: 'single', label: 'Single', mult: 1, leaves: BOOCH_BOARD, final: true },
  { id: 'cascade', label: 'Cascade single', mult: 1, leaves: BOOCH_BOARD },
  { id: 'double', label: 'Double', mult: 2, leaves: BOOCH_BOARD },
  { id: 'triple', label: 'Triple', mult: 3, leaves: TRIPLE_BOARD },
  { id: 'bingo', label: 'Bingo', mult: 4, leaves: TRIPLE_BOARD },
  { id: 'donkey', label: 'Booch-donkey', mult: 5, leaves: TRIPLE_BOARD, booch: true },
  { id: 'vegas', label: 'Booch-Vegas', mult: 6, leaves: TRIPLE_BOARD, booch: true },
];

interface State {
  board: number;
  pts: number;
  t: number;
  /** Opened with a Booch. */
  booch: boolean;
  /** Used a Booch-donkey or Booch-Vegas. */
  special: boolean;
  prev: State | null;
  move: string | null;
}

export interface Step {
  /** "Triple 2": the move, numbered when it repeats. */
  what: string;
  move: string;
  /** Seconds into the Dnav when the move is done. */
  t: number;
  /** Points scored so far. */
  pts: number;
}

export interface Line {
  t: number;
  pts: number;
  booch: boolean;
  special: boolean;
  steps: Step[];
}

export interface Wave {
  /** The real pack size times the werewolf share, unrounded. */
  wolves: number;
  /** How many werewolves the fray can have: the game rounds the pack, partly at random. The Dnav needed doesn't change. */
  shown: number[];
  total: number;
  need: number;
  /** How long the Dnav lasts, in seconds. */
  time: number;
}

/**
 * The wave before a fray (6 is the lair). The Dnav before fray 2 lasts 2:00; after that it lasts
 * 2:00 + 3:00 \u00d7 survivors \u00f7 crew, so each death takes time off.
 */
export function wave(crew: number, fray: number, deaths = 0): Wave {
  const pack = Math.max(crew, 4) * 1.3 ** (fray - 1);
  const share = 0.4 + 0.1 * fray;
  const wolves = pack * share;
  const total = WOLF_POINTS * wolves;
  const lo = Math.floor(pack);
  const shown = [...new Set([Math.floor(lo * share + 0.5), Math.floor((lo + 1) * share + 0.5)])];
  return { wolves, shown, total, need: total - WOLF_POINTS / 2, time: fray === 2 ? 120 : 120 + (180 * (crew - deaths)) / crew };
}

/** A small binary heap, fastest first, more points on a tie. */
class Heap {
  readonly items: State[] = [];
  private static before(x: State, y: State): boolean {
    return x.t !== y.t ? x.t < y.t : x.pts > y.pts;
  }
  push(value: State): void {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): State {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.before(a[l], a[m])) m = l;
        if (r < a.length && Heap.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Which clears a line plays and how often, ignoring order, Booches and the kind of single: "Single×6,Triple×1". */
function movesOf(s: State): string {
  const counts = new Map<string, number>();
  for (let n: State | null = s; n?.prev; n = n.prev) {
    if (n.move === 'Booch') continue;
    // A cascade single and a finishing single are the same clear, just played differently.
    const move = n.move === 'Cascade single' ? 'Single' : n.move!;
    counts.set(move, (counts.get(move) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([move, n]) => `${move}\u00d7${n}`).join();
}

/**
 * The `count` fastest lines that score `need` points, whatever moves they use, fastest first (more points on
 * a tie). Lines that play the same moves count once, at their fastest, so a line that only adds a Booch to a
 * faster one, or plays the same moves in a slower order, is left out.
 */
export function plan(need: number, times: Times, count = 3): Line[] {
  const heap = new Heap();
  const fastest = new Map<string, number>();
  const found: State[] = [];
  const played = new Set<string>();
  const start: State = { board: START_BOARD, pts: 0, t: 0, booch: false, special: false, prev: null, move: null };
  heap.push(start);
  if (times.booch > 0) {
    heap.push({ board: BOOCH_BOARD, pts: 0, t: times.booch, booch: true, special: false, prev: start, move: 'Booch' });
  }
  const keyOf = (s: State) => `${s.board}|${s.pts}|${s.booch}|${s.special}`;
  while (heap.items.length && found.length < count) {
    const s = heap.pop();
    const seen = fastest.get(keyOf(s));
    if (seen !== undefined && seen < s.t) continue;
    if (s.pts >= need) {
      const moves = movesOf(s);
      if (!played.has(moves)) {
        played.add(moves);
        found.push(s);
      }
      continue;
    }
    for (const m of MOVES) {
      if (times[m.id] <= 0 || (m.booch && times.booch <= 0)) continue;
      const next = step(s, m, times);
      // A finishing single only ends a line.
      if (m.final && next.pts < need) continue;
      const key = keyOf(next);
      const prevT = fastest.get(key);
      if (prevT === undefined || next.t < prevT) {
        fastest.set(key, next.t);
        heap.push(next);
      }
    }
  }
  return found.map(toLine);
}

function step(s: State, m: Move, times: Times, pts = s.pts + m.mult * (m.booch ? BOOCH_BOARD : s.board)): State {
  return {
    board: m.leaves,
    pts,
    t: s.t + times[m.id] + (m.booch ? times.booch : 0),
    booch: s.booch,
    special: s.special || !!m.booch,
    prev: s,
    move: m.label,
  };
}

/**
 * The line that scores the most points within `limit` seconds, for a wave that can't be cleared in time.
 * What a line can score next depends only on the board it leaves, so for each moment only the best line
 * ending on each board is kept. A finishing single may end it, since nothing comes after. Null when no timed move fits in the time.
 */
export function mostWithin(limit: number, times: Times): Line | null {
  limit = Math.floor(limit);
  const at: Map<number, State>[] = Array.from({ length: limit + 1 }, () => new Map());
  const keep = (s: State) => {
    if (s.t > limit) return;
    // A line that ended on a finishing single can't go on, so it's kept apart from one that can.
    const key = s.move === 'Single' ? -s.board : s.board;
    const held = at[s.t].get(key);
    if (!held || s.pts > held.pts) at[s.t].set(key, s);
  };
  const start: State = { board: START_BOARD, pts: 0, t: 0, booch: false, special: false, prev: null, move: null };
  keep(start);
  if (times.booch > 0) keep({ board: BOOCH_BOARD, pts: 0, t: times.booch, booch: true, special: false, prev: start, move: 'Booch' });
  let best: State | null = null;
  for (let t = 0; t <= limit; t++) {
    for (const s of at[t].values()) {
      if (s.pts > 0 && (!best || s.pts > best.pts)) best = s;
      if (s.move === 'Single') continue;
      for (const m of MOVES) {
        if (times[m.id] <= 0 || (m.booch && times.booch <= 0)) continue;
        keep(step(s, m, times));
      }
    }
  }
  return best && toLine(best);
}

function toLine(end: State): Line {
  const path: State[] = [];
  for (let n: State | null = end; n?.prev; n = n.prev) path.push(n);
  path.reverse();
  const totals: Record<string, number> = {};
  for (const n of path) totals[n.move!] = (totals[n.move!] ?? 0) + 1;
  const counts: Record<string, number> = {};
  const steps = path.map((n) => {
    const move = n.move!;
    counts[move] = (counts[move] ?? 0) + 1;
    // Numbered only when the move repeats; "Cascade single" is shortened to fit the table.
    const short = move === 'Cascade single' ? 'Cascade' : move;
    const what = totals[move] > 1 ? `${short} ${counts[move]}` : short;
    return { what, move, t: n.t, pts: n.pts };
  });
  return { t: end.t, pts: end.pts, booch: end.booch, special: end.special, steps };
}

/** "Booch, 3 Triples, 1 Single": runs of the same move grouped, as Gizmo names its strategies. */
export function lineName(line: Line): string {
  const parts: { move: string; n: number }[] = [];
  for (const step of line.steps) {
    const last = parts[parts.length - 1];
    if (last && last.move === step.move) last.n++;
    else parts.push({ move: step.move, n: 1 });
  }
  return parts
    .map(({ move, n }) => {
      if (move === 'Booch') return move;
      if (n === 1) return move.startsWith('Booch-') ? move : `1 ${move}`;
      return `${n} ${move}${move === 'Booch-Vegas' ? 'es' : 's'}`;
    })
    .join(', ');
}

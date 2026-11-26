// Optional practice stats for the board-by-board drills (Donkey Build Ring 1, Donkey from scratch).
// An attempt is one board. A session is one stint in a mode: it ends on leaving the mode, on a reload
// (the open session is kept in the store and closed on the next load), or after 30 minutes without a move.

/**
 * Reset time added for each fail, in seconds. A fail usually comes well up the board, so this assumes
 * half the 9 s booch time on average: a starting estimate.
 */
export const FAIL_PENALTY_S = 4.5;
const FAIL_PENALTY_MS = FAIL_PENALTY_S * 1000;
/** A session ends after this long without a move. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Finished sessions kept per mode. */
export const SESSIONS_KEPT = 60;

export interface Session {
  start: number;
  /** When the last move or attempt was made. */
  last: number;
  attempts: number;
  fails: number;
  passes: number;
  /** Total time of the passed boards, from their first move to the pass. */
  passMs: number;
  /** Total time of the failed boards, from their first move to the fail (missing in sessions saved before it was kept). */
  failMs?: number;
  /** The quickest and slowest pass (missing in sessions saved before they were kept). */
  fastestMs?: number | null;
  slowestMs?: number | null;
}

export interface Stats {
  attempts: number;
  fails: number;
  /** Fails over attempts, or null with no attempts. */
  failRate: number | null;
  /** Mean time to a pass, over passes only. */
  completionMs: number | null;
  /** Mean time to a fail, over fails with a time. */
  failAvgMs: number | null;
  /** The quickest and slowest pass. */
  fastestMs: number | null;
  slowestMs: number | null;
  /** Expected time per pass: all pass and fail time plus the fail penalty per fail, over the passes. */
  totalMs: number | null;
}

export interface ModeStats { current: Session | null; history: Session[] }

export const newSession = (now: number): Session => ({ start: now, last: now, attempts: 0, fails: 0, passes: 0, passMs: 0, failMs: 0, fastestMs: null, slowestMs: null });

/** The stats of one or more sessions taken together. */
export function statsOf(sessions: Session[]): Stats {
  const attempts = sessions.reduce((n, s) => n + s.attempts, 0);
  const fails = sessions.reduce((n, s) => n + s.fails, 0);
  const passes = sessions.reduce((n, s) => n + s.passes, 0);
  const passMs = sessions.reduce((n, s) => n + s.passMs, 0);
  const completionMs = passes ? passMs / passes : null;
  const fastest = sessions.map((s) => s.fastestMs).filter((ms): ms is number => typeof ms === 'number');
  const slowest = sessions.map((s) => s.slowestMs).filter((ms): ms is number => typeof ms === 'number');
  // Fail times only exist in sessions saved since they were kept; older sessions are left out of these.
  const timed = sessions.filter((s) => typeof s.failMs === 'number');
  const timedFails = timed.reduce((n, s) => n + s.fails, 0);
  const timedFailMs = timed.reduce((n, s) => n + (s.failMs ?? 0), 0);
  const timedPasses = timed.reduce((n, s) => n + s.passes, 0);
  const timedPassMs = timed.reduce((n, s) => n + s.passMs, 0);
  return {
    attempts, fails,
    failRate: attempts ? fails / attempts : null,
    completionMs,
    failAvgMs: timedFails ? timedFailMs / timedFails : null,
    fastestMs: fastest.length ? Math.min(...fastest) : null,
    slowestMs: slowest.length ? Math.max(...slowest) : null,
    totalMs: timedPasses ? (timedPassMs + timedFailMs + timedFails * FAIL_PENALTY_MS) / timedPasses : null,
  };
}

/** A mode's stats as loaded: a session left open by a reload or a closed page is finished now. */
export function loadModeStats(saved: ModeStats | null | undefined): ModeStats {
  const history = Array.isArray(saved?.history) ? [...saved!.history] : [];
  if (saved?.current && saved.current.attempts > 0) history.push(saved.current);
  return { current: null, history: history.slice(-SESSIONS_KEPT) };
}

/** Ends the open session, keeping it if anything was attempted. */
export function endSession(stats: ModeStats): ModeStats {
  const history = stats.current && stats.current.attempts > 0 ? [...stats.history, stats.current] : stats.history;
  return { current: null, history: history.slice(-SESSIONS_KEPT) };
}

/** The open session, starting a new one if there is none or the last was idle for 30 minutes. */
function open(stats: ModeStats, now: number): ModeStats {
  if (stats.current && now - stats.current.last <= SESSION_IDLE_MS) return stats;
  return { ...endSession(stats), current: newSession(now) };
}

/** A move on the board: keeps the session alive (or starts a new one after 30 idle minutes). */
export function noteMove(stats: ModeStats, now: number): ModeStats {
  const next = open(stats, now);
  return { ...next, current: { ...next.current!, last: now } };
}

/** A board finished, passed or failed, `ms` after its first move. */
export function noteAttempt(stats: ModeStats, now: number, passed: boolean, ms = 0): ModeStats {
  const next = open(stats, now);
  const s = next.current!;
  return { ...next, current: { ...s, last: now, attempts: s.attempts + 1, fails: s.fails + (passed ? 0 : 1), passes: s.passes + (passed ? 1 : 0), passMs: s.passMs + (passed ? ms : 0),
    ...(typeof s.failMs === 'number' ? { failMs: s.failMs + (passed ? 0 : ms) } : {}),
    fastestMs: passed ? Math.min(ms, s.fastestMs ?? Infinity) : s.fastestMs ?? null,
    slowestMs: passed ? Math.max(ms, s.slowestMs ?? -Infinity) : s.slowestMs ?? null } };
}

/** Rate as a percentage, and times in seconds, for the panel. */
export const percent = (r: number | null): string => (r === null ? '–' : `${Math.round(r * 100)}%`);
export const seconds = (ms: number | null): string => (ms === null ? '–' : `${(ms / 1000).toFixed(1)}s`);

import type { Run } from './records';

export interface IgnoredRun {
  id: string;
  expedition: Run['expedition'];
  ocean: Run['ocean'];
  startedAt: Run['startedAt'];
  crewSize: Run['crewSize'];
}

/** Dates identify the voyage even if a parser fix changes its crew or loot. */
export function runId(run: Run): string {
  let undated = 2166136261;
  const text = run.source?.text ?? JSON.stringify([run.players, run.loot, run.frays]);
  if (run.startedAt === null) for (const char of text) undated = Math.imul(undated ^ char.charCodeAt(0), 16777619);
  return JSON.stringify([run.expedition, run.ocean, run.startedAt ?? `undated:${undated >>> 0}`]);
}

export function ignoredRun(run: Run): IgnoredRun {
  return { id: runId(run), expedition: run.expedition, ocean: run.ocean, startedAt: run.startedAt, crewSize: run.crewSize };
}

export function withoutIgnoredRuns(runs: Run[], ignored: IgnoredRun[]): Run[] {
  const ids = new Set(ignored.map((run) => run.id));
  return runs.filter((run) => !ids.has(runId(run)));
}

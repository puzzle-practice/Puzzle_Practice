// A puzzle's past games on the panel's History tab: how many were played with the current
// settings, and the most recent ones, newest first. The games come from Store.history / Store.addHistory.
// A game saved with a duty report (its `duty` field) has a button that shows the report again.
import { decodeReport, showsDutyReport, type DutyReport } from './duty/report';
import { sessionAverages } from './duty/desk';
import type { Panel, RowAction } from './panel';
import type { GameRecord } from './storage';

export interface HistoryColumn {
  label: string;
  value: (game: GameRecord) => string;
}

const reports = new WeakMap<GameRecord, DutyReport | null>();
/** A game's saved duty report, decoded once. */
function reportOf(game: GameRecord | undefined): DutyReport | null {
  if (!game) return null;
  if (!reports.has(game)) {
    const report = decodeReport(game.duty);
    reports.set(game, report && showsDutyReport(report) ? report : null);
  }
  return reports.get(game)!;
}

/** How many recent games the table lists. */
const SHOWN = 10;

function when(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * Adds a card to the History tab. `games` returns the history for the settings in use (or null when the
 * current mode keeps none, which hides the card).
 */
export function historyGroup(
  panel: Panel,
  games: () => readonly GameRecord[] | null,
  columns: readonly HistoryColumn[],
  title = 'Past games',
  replayAction?: { available: (game: GameRecord) => boolean; play: (game: GameRecord) => void },
  showReports = true,
): void {
  const hidden = () => games() === null;
  const shownGames = () => (games() ?? []).slice(-SHOWN).reverse();
  panel
    .tab('History')
    .group(title, { hidden })
    .note(() => {
      const n = games()?.length ?? 0;
      return n ? `${n} game${n === 1 ? '' : 's'} with these settings` : 'No games yet with these settings';
    })
    .stats(
      ['', ...columns.map((c) => c.label)],
      () => shownGames().map((game) => [when(game.at), ...columns.map((c) => c.value(game))]),
      {},
      [
        ...(showReports ? [{
          label: '📜',
          title: 'Show this game’s duty report',
          onClick: (index: number) => {
            const report = reportOf(shownGames()[index]);
            const game = shownGames()[index];
            // Its session's games: the browser session it was played in (older games have none).
            const session = (games() ?? []).filter((g) => g === game || (game.session !== undefined && g.session === game.session));
            if (report) panel.showReport(report, () => sessionAverages(session, {
              scoreLabel: report.score.label,
              lowerIsBetter: report.puzzle === 'forage' && report.score.label === 'Moves',
            }));
          },
          disabled: (index: number) => !reportOf(shownGames()[index]),
        }] : []),
        ...(replayAction ? [{
          label: '▶',
          title: 'Play this game replay',
          onClick: (index: number) => { const game = shownGames()[index]; if (game) replayAction.play(game); },
          disabled: (index: number) => { const game = shownGames()[index]; return !game || !replayAction.available(game); },
        }] : []),
      ] satisfies RowAction[],
    );
}

// Shipwrightery's Freeplay mode: painting the board, choosing the pattern cards, and reading both as
// text. A board's text is W, a digit a square (0 wood, 1 iron, 2 rope, 3 cloth, 4 gold) row by row
// from the top, then a colon and the cards' patterns in slot order, separated by commas.
import { GOLD, PATTERNS, ShipBoard, STYLES, type Pattern } from './logic';

export const MATERIAL_NAMES = ['Wood', 'Iron', 'Rope', 'Cloth', 'Gold'];
/** Card slots on the panel below the board. */
export const SLOTS = 6;

/** Paints a square. Returns false when nothing changed. */
export function paint(board: ShipBoard, x: number, y: number, material: number): boolean {
  if (x < 0 || x >= 5 || y < 0 || y >= 5 || !Number.isInteger(material) || material < 0 || material > GOLD) return false;
  if (board.cells[x * 5 + y] === material) return false;
  board.cells[x * 5 + y] = material;
  return true;
}

export function fill(board: ShipBoard, material: number): boolean {
  if (!Number.isInteger(material) || material < 0 || material > GOLD) return false;
  board.cells.fill(material);
  return true;
}

/** Patterns the game can deal at this difficulty: the tutorial's three, otherwise every pattern of a size it deals. */
export function cardChoices(difficulty: number): Pattern[] {
  const style = STYLES[difficulty];
  if (style.intro) return PATTERNS.filter((p) => ['cannon', 'rigging', 'sail'].includes(p.id));
  return PATTERNS.filter((p) => style.counts[p.tier] > 0);
}

/** Puts a pattern on a card. Patterns already on another card can't be chosen, as the game never deals two alike. */
export function setCard(board: ShipBoard, slot: number, id: string): boolean {
  const pattern = PATTERNS.find((p) => p.id === id);
  if (!pattern || slot < 0 || slot >= board.numAvailable || board.available[slot] === pattern) return false;
  if (board.available.some((p, i) => i !== slot && i < board.numAvailable && p === pattern)) return false;
  board.available[slot] = pattern;
  return true;
}

export function boardCode(board: ShipBoard): string {
  let code = 'W';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) code += board.cells[x * 5 + y];
  return `${code}:${board.available.slice(0, board.numAvailable).map((p) => p.id).join(',')}`;
}

export interface BoardText { cells: number[]; patterns: Pattern[] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^W([0-4]{25}):([a-z]+(?:,[a-z]+){0,5})$/i.exec(text.trim());
  if (!m) return null;
  const cells = Array<number>(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) cells[x * 5 + y] = Number(m[1][y * 5 + x]);
  const patterns = m[2].toLowerCase().split(',').map((id) => PATTERNS.find((p) => p.id === id));
  if (patterns.some((p) => !p) || new Set(patterns).size !== patterns.length) return null;
  return { cells, patterns: patterns as Pattern[] };
}

/** Puts a board read from text onto the board, with as many cards as it lists. */
export function load(board: ShipBoard, read: BoardText): void {
  board.cells = [...read.cells];
  board.available = [...read.patterns];
  board.numAvailable = read.patterns.length;
  board.combo = 0;
}

/** Ways a painted board differs from one that could come up in the game at this difficulty. */
export function boardIssues(board: ShipBoard, difficulty: number): string[] {
  const issues: string[] = [];
  const style = STYLES[difficulty];
  if (!style.gold && board.cells.includes(GOLD)) issues.push(`Difficulty ${difficulty} deals no gold.`);
  const cards = board.available.slice(0, board.numAvailable);
  const tiers = [0, 1, 2].map((tier) => cards.filter((p) => p.tier === tier).length);
  if (style.intro) {
    if (cards.some((p) => !['cannon', 'rigging', 'sail'].includes(p.id))) issues.push('The tutorial only deals the cannon, rigging and sail.');
  } else if (tiers.some((n, tier) => n > style.counts[tier])) {
    issues.push(`Difficulty ${difficulty} deals at most ${style.counts.map((n, tier) => `${n} of ${tier + 3} pieces`).join(', ')}.`);
  }
  return issues;
}

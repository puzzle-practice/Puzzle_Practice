// In-puzzle text drawn the way the game draws it (research-fonts/FONT_NOTES.md):
// - Big text is DellaRobbia BT from a shared size table, stretched 1.1x wide (the game on Windows).
// - Small text is the "Dialog" font, which is Arial on Windows.
// - Outlined labels get a 1px outline on all 8 sides with the fill at (+1, +1), drawn twice.
// - Grayscale antialiasing, no kerning, and every glyph advance rounded to a whole pixel.
// - Score popups last 1500 ms, rise 30 px in a straight line and fade over their second half.
import { loadFont } from './fonts';
import delarobbUrl from './fonts/delarobb.ttf?url';

export const GAME_FONT = 'DellaRobbia BT';
const DIALOG = 'Arial, "Liberation Sans", Helvetica, sans-serif';

/** The game's popup font table: index 0..5 = DellaRobbia 24..68 px. */
export const GAME_FONT_SIZES = [24, 30, 36, 42, 52, 68] as const;
/** The board font: pause labels and Weaving popups (Swordfight and Rumble use BOARD_FONT_SMALL). */
export const BOARD_FONT = 52;
export const BOARD_FONT_SMALL = 42;

/** Popup colours shared by most puzzles. */
export const TEXT_WHITE = '#ffffff';
export const TEXT_YELLOW = '#ffff00';

/** DellaRobbia metrics, as fractions of the size (measured with the game's font code). */
const ASCENT = 23.11 / 24;
const DESCENT = 5.66 / 24;
/** Arial metrics. */
const DIALOG_ASCENT = 0.905;
const DIALOG_DESCENT = 0.212;
const STRETCH = 1.1;

export function loadGameFont(): Promise<void> {
  return loadFont(GAME_FONT, delarobbUrl);
}

/** GameFonts.get(i): px for index 0..5, clamped. */
export function gameFont(index: number): number {
  return GAME_FONT_SIZES[Math.max(0, Math.min(GAME_FONT_SIZES.length - 1, Math.trunc(index)))];
}

/** GameFonts.get(value, max): bigger text for a bigger score. */
export function gameFontFor(value: number, max: number): number {
  return gameFont(Math.min(Math.trunc((value * 6) / max), 5));
}

export interface GameTextStyle {
  /** Size in px. */
  px: number;
  /** 'game' = DellaRobbia (default), 'dialog' = Arial. */
  family?: 'game' | 'dialog';
  bold?: boolean;
  fill?: string;
  /** Outline colour (1px, 8 sides). null for plain text. Default black. */
  outline?: string | null;
  /** Shadow colour: shadow at (0, +1), text at (+1, 0). Ignored when outlined. */
  shadow?: string;
  /** Where x is: the left edge (default), the centre or the right edge of the label box. */
  align?: 'left' | 'center' | 'right';
  alpha?: number;
}

const isGame = (s: GameTextStyle) => (s.family ?? 'game') === 'game';

function cssFont(s: GameTextStyle): string {
  return isGame(s) ? `${s.px}px "${GAME_FONT}"` : `${s.bold ? 'bold ' : ''}${s.px}px ${DIALOG}`;
}

/** Extra box size from the label style: outline 2px, shadow 1px, plain 0. */
function extra(s: GameTextStyle): number {
  if (s.outline !== null) return 2;
  return s.shadow ? 1 : 0;
}

const advances = new Map<string, number>();

/** The whole-pixel advances of each character, as the game lays text out without fractional metrics. */
function glyphAdvances(ctx: CanvasRenderingContext2D, text: string, s: GameTextStyle): number[] {
  const font = cssFont(s);
  const scale = isGame(s) ? STRETCH : 1;
  ctx.font = font;
  const out: number[] = [];
  for (const ch of text) {
    const key = `${font}|${ch}`;
    let a = advances.get(key);
    if (a === undefined) {
      a = Math.round(ctx.measureText(ch).width * scale);
      // Measure again once the font has really loaded, in case this was the fallback face.
      if (!isGame(s) || (typeof document !== 'undefined' && document.fonts?.check(font))) advances.set(key, a);
    }
    out.push(a);
  }
  return out;
}

/** Width of one line of text, without the outline. */
export function gameTextWidth(ctx: CanvasRenderingContext2D, text: string, s: GameTextStyle): number {
  ctx.save();
  const w = glyphAdvances(ctx, text, s).reduce((a, b) => a + b, 0);
  ctx.restore();
  return w;
}

export function gameAscent(s: GameTextStyle): number {
  return Math.ceil(s.px * (isGame(s) ? ASCENT : DIALOG_ASCENT));
}

/** Height of one line of the label: ascent + descent (+2 outlined, +1 shadowed). */
export function gameLineHeight(s: GameTextStyle): number {
  const ratio = isGame(s) ? ASCENT + DESCENT : DIALOG_ASCENT + DIALOG_DESCENT;
  return Math.ceil(s.px * ratio) + extra(s);
}

/** The label box of a line of text: width and height including the outline. */
export function gameTextBox(ctx: CanvasRenderingContext2D, text: string, s: GameTextStyle): { w: number; h: number } {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => gameTextWidth(ctx, l, s))) + extra(s);
  return { w, h: gameLineHeight(s) * lines.length };
}

function drawRun(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number, adv: number[], scale: number): void {
  // Each glyph starts on a whole pixel; the 1.1x stretch scales the glyphs, not their positions.
  if (scale !== 1) {
    ctx.save();
    ctx.scale(scale, 1);
  }
  let pen = x;
  let i = 0;
  for (const ch of text) {
    if (ch !== ' ') ctx.fillText(ch, pen / scale, baseline);
    pen += adv[i++];
  }
  if (scale !== 1) ctx.restore();
}

/**
 * Draws a label the way the game's Label does: (x, y) is the top of the box, and x is its left
 * edge, centre or right edge by `align`. Multi-line text ('\n') centres each line in the box.
 * Returns the box.
 */
export function drawGameText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: GameTextStyle): { x: number; y: number; w: number; h: number } {
  const s = style;
  const lines = text.split('\n');
  const outline = s.outline === undefined ? '#000000' : s.outline;
  const scale = isGame(s) ? STRETCH : 1;
  const lineH = gameLineHeight(s);
  ctx.save();
  if (s.alpha !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, s.alpha));
  ctx.font = cssFont(s);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if ('fontKerning' in ctx) ctx.fontKerning = 'none';
  const runs = lines.map((l) => ({ text: l, adv: glyphAdvances(ctx, l, s) }));
  const widths = runs.map((r) => r.adv.reduce((a, b) => a + b, 0));
  const ex = extra(s);
  const w = Math.max(...widths) + ex;
  const h = lineH * lines.length;
  const left = Math.trunc(s.align === 'center' ? x - w / 2 : s.align === 'right' ? x - w : x);
  const top = Math.trunc(y);
  const ascent = gameAscent(s);
  runs.forEach((r, i) => {
    const lx = left + Math.trunc((w - ex - widths[i]) / 2);
    const base = top + i * lineH + ascent;
    if (outline !== null) {
      ctx.fillStyle = outline;
      for (const [dx, dy] of OUTLINE) drawRun(ctx, r.text, lx + dx, base + dy, r.adv, scale);
      ctx.fillStyle = s.fill ?? TEXT_WHITE;
      drawRun(ctx, r.text, lx + 1, base + 1, r.adv, scale);
      drawRun(ctx, r.text, lx + 1, base + 1, r.adv, scale);
    } else if (s.shadow) {
      ctx.fillStyle = s.shadow;
      drawRun(ctx, r.text, lx, base + 1, r.adv, scale);
      ctx.fillStyle = s.fill ?? TEXT_WHITE;
      drawRun(ctx, r.text, lx + 1, base, r.adv, scale);
    } else {
      ctx.fillStyle = s.fill ?? TEXT_WHITE;
      drawRun(ctx, r.text, lx, base, r.adv, scale);
    }
  });
  ctx.restore();
  return { x: left, y: top, w, h };
}

const OUTLINE = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2], [1, 1]] as const;

/** FloatingTextAnimation: 1500 ms by default, 30 px up (or down), opaque for the first half. */
export const FLOAT_MS = 1500;
export const FLOAT_PX = 30;

/** How far a popup has moved and how opaque it is, `age` ms after it appeared. */
export function floatAt(age: number, duration = FLOAT_MS, down = false): { dy: number; alpha: number } {
  const t = Math.max(0, Math.min(1, age / duration));
  return {
    dy: (down ? 1 : -1) * Math.trunc(FLOAT_PX * t),
    alpha: t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2),
  };
}

/** Breaks text into lines no wider than `maxW`, at spaces, as the game's labels wrap at the board width. */
export function wrapGameText(ctx: CanvasRenderingContext2D, text: string, s: GameTextStyle, maxW: number): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && gameTextWidth(ctx, next, s) + extra(s) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** The pause label: board font, white with a black outline, wrapped to the board and centred on it. */
export function drawPauseLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, boardW: number, px = BOARD_FONT): { x: number; y: number; w: number; h: number } {
  const s: GameTextStyle = { px, align: 'center' };
  const wrapped = wrapGameText(ctx, text, s, boardW);
  const { h } = gameTextBox(ctx, wrapped, s);
  return drawGameText(ctx, wrapped, cx, cy - h / 2, s);
}

// Paints an HTML element onto a 2D canvas as it looks on screen: backgrounds, borders, canvases,
// images and text, at their laid-out positions. A video export uses it to put the duty report
// (HTML over the board) into the video. It's deliberately small: no shadows, gradients, transforms
// or pseudo-elements. Folded <details> and buttons are left out, since a video can't open or press them.

interface Area { left: number; top: number; scale: number }

const visible = (colour: string) => !!colour && colour !== 'transparent' && !/rgba?\(.*,\s*0\)$/.test(colour) && !/\/\s*0\)$/.test(colour);

/**
 * Draws `element` into `ctx` so that the screen rectangle `frame` (the canvas's own place on the page)
 * maps onto the whole canvas.
 */
export function drawElement(ctx: CanvasRenderingContext2D, element: Element, frame: DOMRect, width: number): void {
  // Lay the element out again without the parts a video leaves out, so it doesn't keep their space.
  const hidden = [...element.querySelectorAll<HTMLElement>('details, button')].map(node => [node, node.style.display] as const);
  for (const [node] of hidden) node.style.display = 'none';
  try {
    const area: Area = { left: frame.left, top: frame.top, scale: width / frame.width };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    paint(ctx, element, area, 1);
    ctx.restore();
  } finally {
    for (const [node, display] of hidden) node.style.display = display;
  }
}

function paint(ctx: CanvasRenderingContext2D, element: Element, area: Area, opacity: number): void {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  opacity *= Number(style.opacity) || (style.opacity === '0' ? 0 : 1);
  if (opacity <= 0) return;
  const rect = element.getBoundingClientRect();
  const x = (rect.left - area.left) * area.scale, y = (rect.top - area.top) * area.scale;
  const w = rect.width * area.scale, h = rect.height * area.scale;
  ctx.globalAlpha = opacity;

  if (visible(style.backgroundColor)) {
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, (parseFloat(style.borderTopLeftRadius) || 0) * area.scale);
    ctx.fill();
  }
  for (const [side, bx, by, bw, bh] of [
    ['Top', x, y, w, 0], ['Bottom', x, y + h, w, 0], ['Left', x, y, 0, h], ['Right', x + w, y, 0, h],
  ] as const) {
    const size = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
    const colour = style.getPropertyValue(`border-${side.toLowerCase()}-color`);
    if (!size || style.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none' || !visible(colour)) continue;
    const s = size * area.scale;
    ctx.fillStyle = colour;
    ctx.fillRect(side === 'Right' ? bx - s : bx, side === 'Bottom' ? by - s : by, bw || s, bh || s);
  }
  const outline = parseFloat(style.outlineWidth) || 0;
  if (outline && style.outlineStyle !== 'none' && visible(style.outlineColor)) {
    const d = ((parseFloat(style.outlineOffset) || 0) + outline / 2) * area.scale;
    ctx.strokeStyle = style.outlineColor; ctx.lineWidth = outline * area.scale;
    ctx.strokeRect(x - d, y - d, w + 2 * d, h + 2 * d);
  }
  if (element instanceof HTMLCanvasElement || element instanceof HTMLImageElement) {
    try { ctx.drawImage(element, x, y, w, h); } catch { /* not loaded */ }
    return;
  }

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) paintText(ctx, child as Text, style, area, opacity);
    else if (child instanceof Element) paint(ctx, child, area, opacity);
  }
}

/** Text, a word at a time so wrapped lines land where the page put them. */
function paintText(ctx: CanvasRenderingContext2D, node: Text, style: CSSStyleDeclaration, area: Area, opacity: number): void {
  const text = node.data;
  if (!text.trim()) return;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = style.color;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * area.scale}px ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  const range = document.createRange();
  const words = /\S+/g;
  for (let match = words.exec(text); match; match = words.exec(text)) {
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    const rect = range.getBoundingClientRect();
    if (!rect.width) continue;
    const metrics = ctx.measureText(match[0]);
    const ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
    const x = (rect.left - area.left) * area.scale;
    const top = (rect.top - area.top) * area.scale, height = rect.height * area.scale;
    ctx.fillText(match[0], x, top + (height - ascent - descent) / 2 + ascent);
  }
}

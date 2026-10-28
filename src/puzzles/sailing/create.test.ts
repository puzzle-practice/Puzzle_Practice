import { describe, expect, it } from 'vitest';
import { EMPTY, HEIGHT, PATTERNS, WIDTH, direction, fixed, targetCells } from './board';
import { SailingEditor, blankLayout, readLayout, type Brush } from './create';
import { DEFAULT_SETTINGS, SailingGame } from './game';

const brush = (overrides: Partial<Brush> = {}): Brush => ({ tool: 'single', colour: 0, secondColour: 1, direction: 1, pattern: 12, ...overrides });

describe('Sailing create board', () => {
  it('places every platform pattern with a top-left anchor and rejects overlaps and clipping', () => {
    for (let pattern = 0; pattern < PATTERNS.length; pattern++) {
      const editor = new SailingEditor(), tool = brush({ tool: 'platform', pattern });
      expect(editor.place(tool, 2, 3)).toBeNull();
      const target = editor.board.targets[0];
      expect(Math.min(...targetCells(target).map(c => c.y))).toBe(3);
      expect(target.y).toBe(3 + PATTERNS[pattern].length - 1);
      const before = editor.snapshot();
      expect(editor.place(tool, 2, 3)).toMatch(/overlap/);
      expect(editor.place(tool, WIDTH - 1, HEIGHT - 1)).toMatch(/fit/);
      expect(editor.snapshot()).toEqual(before);
      expect(editor.board.cells.every(p => p === EMPTY)).toBe(true);
    }
  });
  it.each([1, 3, 5, 7])('creates a reciprocal pair in direction %s and moves its halves together', d => {
    const editor = new SailingEditor();
    expect(editor.place(brush({ tool: 'pair', colour: 2, direction: d }), 3, 5)).toBeNull();
    const cells = editor.preview(brush({ tool: 'pair', direction: d }), 3, 5).cells;
    expect(direction(editor.board.get(3, 5))).toBe(d);
    expect(direction(editor.board.get(cells[1].x, cells[1].y))).toBe((d + 4) % 8);
    expect(readLayout(editor.snapshot())).toEqual(editor.snapshot());
    editor.board.gravity();
    expect(editor.board.cells.filter(p => p !== EMPTY)).toHaveLength(2);
    expect(readLayout(editor.snapshot())).not.toBeNull();
  });
  it('rejects an out-of-bounds pair atomically and detaches old partners when painting or erasing', () => {
    const editor = new SailingEditor();
    editor.place(brush({ tool: 'pair' }), 6, 8);
    const before = editor.snapshot();
    expect(editor.place(brush({ tool: 'pair' }), 7, 8)).toMatch(/fit/);
    expect(editor.snapshot()).toEqual(before);
    editor.place(brush({ tool: 'blocker', colour: 2 }), 6, 8);
    expect(editor.board.get(7, 8)).toBe(8);
    expect(fixed(editor.board.get(6, 8))).toBe(true);
    editor.place(brush({ tool: 'pair', direction: 7 }), 2, 8);
    editor.place(brush({ tool: 'erase' }), 2, 8);
    expect(editor.board.get(2, 7)).toBe(8);
    expect(editor.board.get(2, 8)).toBe(EMPTY);
  });
  it('lets pieces fill a platform and erases pieces before the platform beneath them', () => {
    const editor = new SailingEditor();
    editor.place(brush({ tool: 'platform' }), 1, 8);
    editor.place(brush(), 1, 8);
    editor.place(brush({ tool: 'erase' }), 1, 8);
    expect(editor.board.targets).toHaveLength(1);
    editor.place(brush({ tool: 'erase' }), 1, 8);
    expect(editor.board.targets).toHaveLength(0);
  });
  it('keeps singles unjoined and blockers stationary in all colours', () => {
    const editor = new SailingEditor();
    for (let colour = 0; colour < 3; colour++) {
      editor.place(brush({ colour }), colour, 4);
      editor.place(brush({ tool: 'blocker', colour }), colour + 4, 4);
    }
    editor.board.gravity();
    for (let colour = 0; colour < 3; colour++) {
      expect(editor.board.get(colour, 15)).toBe(colour * 8);
      expect(editor.board.get(colour + 4, 4)).toBe(colour * 8 + 5);
    }
  });
  it('undoes and redoes a whole pair, platform or clear and owns its snapshots', () => {
    const editor = new SailingEditor();
    editor.place(brush({ tool: 'platform' }), 0, 10);
    editor.place(brush({ tool: 'pair' }), 0, 10);
    const layout = editor.snapshot(); editor.clear(); expect(editor.snapshot()).toEqual(blankLayout());
    editor.undo(); expect(editor.snapshot()).toEqual(layout);
    editor.undo(); expect(editor.board.cells.every(p => p === EMPTY)).toBe(true);
    editor.redo(); expect(editor.snapshot()).toEqual(layout);
    editor.undo(); editor.place(brush(), 7, 15); expect(editor.canRedo).toBe(false);
    layout.cells.fill(99); expect(editor.board.get(7, 15)).toBe(0);
  });
  it('validates saved drafts, rejecting malformed cells, dangling joins and invalid platforms', () => {
    expect(readLayout(blankLayout())).toEqual(blankLayout());
    for (const value of [null, {}, { cells: [], targets: [] }, { ...blankLayout(), targets: [{ x: 0, y: 0, type: 99, enabled: true }] }]) expect(readLayout(value)).toBeNull();
    for (const piece of [4, 6, 24, 256, -2, NaN]) {
      const layout = blankLayout(); layout.cells[7] = piece; expect(readLayout(layout)).toBeNull();
    }
  });
});

describe('Playing a Sailing draft', () => {
  it('starts custom progress at zero and keeps platform-free boards for line practice', () => {
    const game = new SailingGame(DEFAULT_SETTINGS, 42, true), editor = new SailingEditor();
    editor.place(brush({ tool: 'platform' }), 0, 14);
    game.board.loadLayout(editor.board.cells, editor.board.targets); game.active = null;
    game.resolve(); expect(game.points).toBe(0);
    game.board.loadLayout(blankLayout().cells, []);
    for (let x = 0; x < 4; x++) game.board.set(x, 15, 0);
    game.resolve();
    for (let i = 0; i < 100 && game.scenes.length; i++) game.step(100, false);
    expect(game.points).toBe(4); expect(game.boards).toBe(0);
    expect(game.board.targets).toEqual([]); expect(game.active).not.toBeNull();
  });
  it('holds a built board with gravity off until the first Fall faster', () => {
    const game = new SailingGame(DEFAULT_SETTINGS, 42, true), editor = new SailingEditor();
    editor.place(brush({ tool: 'single' }), 2, 5);
    game.board.loadLayout(editor.board.cells, []); game.hold();
    for (let i = 0; i < 20; i++) game.step(100, true);
    expect(game.board.get(2, 5)).not.toBe(EMPTY); expect(game.active).toBeNull();
    expect(game.release()).toBe(true);
    for (let i = 0; i < 100 && game.scenes.length; i++) game.step(100, false);
    expect(game.board.get(2, 5)).toBe(EMPTY); expect(game.board.get(2, HEIGHT - 1)).not.toBe(EMPTY);
    expect(game.moves).toBe(0); expect(game.active).not.toBeNull();
    expect(game.release()).toBe(false);
  });
  it('keeps a blocked custom board instead of dealing over it', () => {
    const game = new SailingGame(DEFAULT_SETTINGS, 42, true), editor = new SailingEditor();
    editor.place(brush({ tool: 'blocker' }), 3, 0);
    game.board.loadLayout(editor.board.cells, []); game.active = null; game.resolve();
    expect(game.board.get(3, 0)).toBe(5); expect(game.active).toBeNull();
    expect(game.booches).toBe(0); expect(game.message).toMatch(/Spawn blocked/);
  });
});

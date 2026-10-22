import { describe, expect, it } from 'vitest';
import { SailBoard, ClearScore } from './board';
import fixtures from './fixtures/rules.json';

describe('Sailing rule reference cases', () => {
  it('recreates boards and the next twelve pairs at all ten difficulties and token modes', () => {
    for (const f of fixtures.boards) {
      const b = new SailBoard(f.seed,f.difficulty); b.bonusMode=f.mode;
      expect(b.targets.map(t=>[t.x,t.y,t.type]), `seed ${f.seed}, difficulty ${f.difficulty}`).toEqual(f.targets);
      expect(b.cells).toEqual(f.cells);
      expect(Array.from({length:12},()=>b.nextPair())).toEqual(f.pairs);
    }
  });
  it('preserves pair support, fixed pieces, and shelves in 120 gravity cases', () => {
    for (const f of fixtures.gravity) {
      const b = new SailBoard(0,0,false); b.cells=[...f.cells];
      b.targets=f.targets.map(([x,y,type])=>({x,y,type,enabled:true}));
      b.gravity(); expect(b.cells).toEqual(f.expected);
    }
  });
  it('matches 960 forgiving rotations, including blocked rotations and wall kicks', () => {
    for (const f of fixtures.rotations) {
      const b = new SailBoard(0,0,false); b.cells=[...f.cells];
      expect(b.rotate(f.x,f.y,f.orient,f.clockwise,f.fraction)).toEqual(f.expected);
    }
  });
  it('clears overlapping lines once and reproduces line scores', () => {
    for (const f of fixtures.clears) {
      const b = new SailBoard(f.seed,f.difficulty); b.cells=[...f.cells]; b.desiredBonus=f.desired;
      const runs=b.lines(), cells=runs.flatMap(r=>r.cells), score=new ClearScore(f.difficulty);
      if (runs.length) score.add(cells,false);
      b.remove(cells);
      expect(b.cells).toEqual(f.expected); expect(score.points).toBe(f.points);
      expect(runs.map(r=>r.bonus)).toEqual(f.bonuses);
    }
  });
});

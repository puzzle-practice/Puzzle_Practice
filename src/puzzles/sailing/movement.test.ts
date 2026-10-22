import { describe, expect, it, vi } from 'vitest';
import { SailBoard, EMPTY, HEIGHT } from './board';
import { DEFAULT_SETTINGS, SailingGame, pairCells } from './game';
import reference from './fixtures/gaps.json';

function emptyGame(): SailingGame {
  const g=new SailingGame(DEFAULT_SETTINGS,42);
  g.board=new SailBoard(42,5,false);
  g.board.targets=[{x:6,y:15,type:12,enabled:true}];
  return g;
}
function settle(g:SailingGame):void {
  for(let i=0;i<200&&g.moves===0;i++)g.step(17,false);
  expect(g.moves).toBe(1);
}

describe('Sailing forgiving gap movement',()=>{
  it('matches recorded gap moves and rotations at eight fall fractions in all four orientations',()=>{
    for(const layout of reference)for(const sample of layout.cases)for(const action of ['left','right','cw','ccw'] as const){
      const g=emptyGame();
      for(const [x,y] of layout.obstacles)g.board.set(x,y,21);
      g.active={x:3,y:sample.y,orient:sample.orient,pieces:[0,8],fraction:sample.fraction};
      const expected=sample[action];
      if(action==='left'||action==='right'){
        expect(g.move(action==='left'?-1:1)).toBe(expected);
        expect(g.active.x).toBe(3+(expected?(action==='left'?-1:1):0));
      }else{
        expect(g.rotate(action==='cw')).toBe(expected!==null);
        if(Array.isArray(expected))expect([g.active.orient,g.active.x,g.active.y,0]).toEqual(expected);
      }
      expect(g.active.fraction).toBe(sample.fraction);
    }
  });
  it('slides one half into a one-cell gap between stationary pieces above and below',()=>{
    const g=emptyGame();g.board.set(4,4,21);g.board.set(4,6,13);
    g.active={x:2,y:5,orient:5,pieces:[0,8],fraction:0.25};
    expect(g.move(1)).toBe(true);expect(g.active.x).toBe(3);
    g.step(0,false);expect(g.isLanding).toBe(true);expect(g.active.fraction).toBe(0);
    settle(g);
    expect(g.board.get(4,5)).toBe(11);
    expect(g.board.get(4,4)).toBe(21);expect(g.board.get(4,6)).toBe(13);
  });
  it('inserts a vertical pair late in a row without overwriting the upper stationary piece',()=>{
    const g=emptyGame();g.board.set(4,4,21);g.board.set(4,7,21);
    g.active={x:3,y:5,orient:3,pieces:[0,8],fraction:0.75};
    expect(g.move(1)).toBe(true);expect(g.active.y).toBe(5);expect(g.active.fraction).toBe(0.75);
    settle(g);
    expect(g.board.get(4,5)).toBe(9);expect(g.board.get(4,6)).toBe(2);
    expect(g.board.get(4,4)).toBe(21);expect(g.board.get(4,7)).toBe(21);
  });
  it('rotates into a tight horizontal gap using the first legal position',()=>{
    const g=emptyGame();g.board.set(4,4,21);g.board.set(4,6,21);
    g.active={x:3,y:5,orient:3,pieces:[0,8],fraction:0.25};
    expect(g.rotate(true)).toBe(true);
    expect([g.active.orient,g.active.x,g.active.y,g.active.fraction]).toEqual([5,3,5,0.25]);
    settle(g);
    expect(g.board.get(4,5)).toBe(11);
    expect(g.board.get(4,4)).toBe(21);expect(g.board.get(4,6)).toBe(21);
  });
  it('drops a vertical pair through a one-column gap between stationary walls',()=>{
    const g=emptyGame();
    for(let y=4;y<HEIGHT;y++)for(const x of [2,4])g.board.set(x,y,5+8*(y%3));
    g.active={x:3,y:3,orient:3,pieces:[0,8],fraction:0};
    for(let i=0;i<200&&g.moves===0;i++)g.step(17,true);
    expect(g.moves).toBe(1);expect(g.board.get(3,14)).toBe(9);expect(g.board.get(3,15)).toBe(2);
  });
  it('rejects an insertion when the selected grid row is occupied',()=>{
    const g=emptyGame();g.board.set(4,5,21);
    g.active={x:2,y:5,orient:5,pieces:[0,8],fraction:0.25};
    expect(g.move(1)).toBe(false);expect(g.active.x).toBe(2);
    g.active.fraction=0.75;g.board.set(4,6,21);
    expect(g.move(1)).toBe(false);expect(g.active.x).toBe(2);
  });
  it('keeps the fall fraction and rotation-square position through a full turn in open space',()=>{
    for(const clockwise of [false,true])for(const fraction of [0,0.01,0.25,0.5,0.75,0.99]){
      const g=emptyGame();g.active={x:3,y:6,orient:5,pieces:[0,8],fraction};
      const before=structuredClone(g.active);
      for(let i=0;i<4;i++)expect(g.rotate(clockwise)).toBe(true);
      expect(g.active).toEqual(before);
    }
  });
  it('catches a shelf before halfway but permits a late slide beneath its edge',()=>{
    for(const fraction of [0.25,0.75]){
      const g=emptyGame();g.board.targets=[{x:4,y:5,type:12,enabled:true}];
      g.active={x:3,y:5,orient:3,pieces:[0,8],fraction};
      expect(g.move(1)).toBe(true);g.step(0,false);
      expect(g.isLanding).toBe(fraction<0.5);
      if(fraction>0.5){g.step(300,false);expect(g.active!.y).toBe(6);expect(g.isLanding).toBe(false);}
    }
  });
  it('never commits a falling pair over an occupied cell in generated-board sessions',()=>{
    const land=SailingGame.prototype.land;
    const spy=vi.spyOn(SailingGame.prototype,'land').mockImplementation(function(this:SailingGame){
      for(const c of pairCells(this.active!))if(this.board.inBounds(c.x,c.y))expect(this.board.get(c.x,c.y)).toBe(EMPTY);
      land.call(this);
    });
    try{
      for(const seed of [19,42,12345]){
        const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9},seed);
        for(let frame=0;frame<15000;frame++){
          if(frame%13===0)g.move(frame%2?-1:1);
          if(frame%19===0)g.rotate(frame%2===0);
          g.step(17,true);
        }
        expect(g.moves).toBeGreaterThan(100);
      }
    }finally{spy.mockRestore();}
  });
});

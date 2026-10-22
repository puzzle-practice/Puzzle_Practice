import { describe, expect, it } from 'vitest';
import { EMPTY, SailBoard, ClearScore, targetCells } from './board';
import { DEFAULT_SETTINGS, Performance, SailingGame, feedbackText, pairCells, readSettings } from './game';

const advance=(g:SailingGame)=>{for(let i=0;i<1000&&g.scenes.length;i++)g.step(100,false);};
const blank=(g:SailingGame)=>{g.board=new SailBoard(42,g.settings.difficulty,false);g.board.targets=[{x:6,y:15,type:12,enabled:true}];g.board.newlyFilled();};
const filledZigzag=(g:SailingGame,y:number)=>{
  const t={x:0,y,type:5,enabled:true};g.board.targets.push(t);
  for(let row=y-2;row<=y;row++){
    g.board.set(0,row,(row===y-1?8:0)+4);g.board.set(1,row,(row===y-1?0:8)+3);
  }
  return t;
};

describe('Sailing cascades and practice sessions',()=>{
  it('clears only marked platform cells and releases pieces in its blank spaces',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9,tokens:0},42);blank(g);
    const t=filledZigzag(g,15);
    g.resolve();advance(g);
    expect(t.enabled).toBe(false);expect(g.platforms).toBe(1);
    expect(g.board.cells.filter(p=>p===8)).toHaveLength(3);
    expect(g.board.get(1,15)).toBe(8);
    expect(g.points).toBe(12);
  });
  it('counts simultaneous platforms as one chain step and applies the final multiplier to the whole cascade',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9,tokens:0},7);blank(g);
    const a={x:0,y:15,type:12,enabled:true},b={x:3,y:15,type:13,enabled:true};
    g.board.targets.push(a,b);
    for(const t of [a,b])for(const c of targetCells(t))g.board.set(c.x,c.y,c.piece);
    g.resolve();advance(g);expect(g.lastChain).toBe(1);expect(g.platforms).toBe(2);expect(g.points).toBe(32);
  });
  it('chains a platform into a line, retaining the pieces in blank target positions',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9,tokens:0},7);blank(g);
    filledZigzag(g,14);
    g.board.set(2,15,8);g.board.set(3,15,8);
    g.resolve();advance(g);
    expect(g.lastChain).toBe(2);expect(g.points).toBe(32);
    expect(g.board.get(0,15)).toBe(EMPTY);expect(g.board.get(3,15)).toBe(EMPTY);
  });
  it('scores fixed cells once where lines cross and discounts chains above twice difficulty',()=>{
    const s=new ClearScore(1), cells=Array.from({length:5},(_,x)=>({x,y:15,piece:x===0?5:0}));
    s.add([...cells,cells[0]],false);expect(s.points).toBe(9);
    s.add([{x:0,y:0,piece:0}],true);s.add([{x:1,y:0,piece:8}],true);
    expect(s.chain).toBe(3);expect(s.points).toBe(42);
    const easy=new ClearScore(0);easy.add(cells,false);expect(easy.points).toBe(4);
  });
  it('selects one matching token pair per platform, preferring the requested shape',()=>{
    const b=new SailBoard(9,9,false),cells=targetCells({x:0,y:15,type:12,enabled:true});
    b.desiredBonus=2;
    for(const c of cells)b.set(c.x,c.y,c.piece|((c.y===14?1:2)<<5));
    expect(b.chooseBonus(cells)).toBe(2);
    b.set(0,15,0);b.set(1,15,0);expect(b.chooseBonus(cells)).toBe(1);
  });
  it('keeps scanning later platform rows after the requested shape and takes the last pair found',()=>{
    const b=new SailBoard(9,9,false),cells=targetCells({x:0,y:15,type:12,enabled:true});
    b.desiredBonus=3;
    for(const c of cells)b.set(c.x,c.y,c.piece|((c.y===14?3:2)<<5));
    expect(b.chooseBonus(cells)).toBe(2);
  });
  it('stops a vertical line scan at the requested shape',()=>{
    const b=new SailBoard(9,9,false),cells=[12,13,14,15].map(y=>({x:0,y,piece:0}));
    b.desiredBonus=3;
    [3,3,2,2].forEach((t,i)=>b.set(0,12+i,t<<5));
    expect(b.chooseBonus(cells,true)).toBe(3);
  });
  it('requires shapes to belong to the same clear and rejects diagonal matches',()=>{
    const b=new SailBoard(9,9,false),cells=targetCells({x:0,y:15,type:12,enabled:true});
    b.set(0,14,32);b.set(1,15,32);b.set(7,15,32);expect(b.chooseBonus(cells)).toBe(0);
  });
  it('awards double practice units for a matching token pair on the third chain step',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9},4);blank(g);
    filledZigzag(g,14);
    // Rope platform -> water line -> wind line.
    g.board.set(2,15,8+2);g.board.set(3,15,8+2);
    g.board.set(2,14,(16|64)+1);g.board.set(3,14,(16|64)+1);g.board.set(4,15,16);g.board.set(5,15,16);
    g.resolve();advance(g);
    expect(g.lastChain).toBe(3);expect(g.tokenMatches[2]).toBe(1);expect(g.tokenUnits[2]).toBe(2);
  });
  it('keeps horizontal pairs attached when one half hangs over a shelf',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,7);blank(g);
    g.board.set(2,14,5);g.active={x:2,y:13,orient:5,pieces:[8,16],fraction:0};g.land();advance(g);
    expect(g.board.get(2,13)%8).toBe(4);expect(g.board.get(3,13)%8).toBe(3);
    g.board.remove([{x:2,y:13,piece:12}]);g.board.gravity();expect(g.board.get(3,15)).toBe(16);
  });
  it('charges a booch only after resolving clears and preserves the selected difficulty',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:7},19);blank(g);g.board.set(3,0,5);
    g.resolve();advance(g);expect(g.booches).toBe(1);expect(g.points).toBe(-20);expect(g.board.difficulty).toBe(7);
    expect(g.active?.x).toBe(3);expect(g.active?.y).toBe(-1);
  });
  it('adds no separate board-clear bonus and deals a new board automatically',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9},19);blank(g);
    for(const c of targetCells(g.board.targets[0]))g.board.set(c.x,c.y,c.piece);
    g.resolve();advance(g);expect(g.boards).toBe(1);expect(g.points).toBe(20);expect(g.board.remaining).toBeGreaterThan(0);
  });
  it('does not turn Space into an instant drop, allowing movement while falling quickly',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,99),before=pairCells(g.active!);
    g.step(16,true);expect(g.active).not.toBeNull();expect(g.moves).toBe(0);
    expect(g.move(-1)).toBe(true);expect(pairCells(g.active!)[0].x).toBe(before[0].x-1);
  });
  it('repeats the same long session from its seed and frame inputs',()=>{
    const play=()=>{
      const g=new SailingGame(DEFAULT_SETTINGS,12345);
      for(let i=0;i<15000;i++){
        if(i%37===0)g.move(i%2?-1:1);if(i%53===0)g.rotate(i%2===0);
        g.performance.advance(i*17);g.step(17,true);
      }
      return {cells:g.board.cells,points:g.points,moves:g.moves,tokens:g.tokenUnits,boards:g.boards,booches:g.booches,active:g.active};
    };
    const first=play();expect(first.moves).toBeGreaterThan(100);expect(play()).toEqual(first);
  });
  it('charges inactivity and expires the rolling performance window',()=>{
    const p=new Performance();p.add(40,2);expect(p.value).toBe(20);
    p.advance(20000);expect(p.value).toBeCloseTo(40/3);
    p.advance(190000);expect(p.value).toBe(0);
  });
  it('validates saved settings and replay settings',()=>{
    expect(readSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    for(const patch of [{difficulty:10},{difficulty:-1},{difficulty:NaN},{tokens:8},{desired:6},{indicatorMax:0},{timerMs:-1}])
      expect(readSettings({...DEFAULT_SETTINGS,...patch})).toBeNull();
  });
  it('shows the game\'s feedback text for each kind of clear',()=>{
    const scene={cells:[],targets:[],duration:0};
    const line=(size:number,chain=1,bonuses:number[]=[])=>feedbackText({...scene,kind:'line',size,chain,bonuses});
    expect(line(4).label).toBe('');expect(line(5).label).toBe('Great!');expect(line(7).label).toBe('Excellent!');
    expect(feedbackText({...scene,kind:'platform',size:1,chain:1}).label).toBe('Target Bonus!');
    expect(feedbackText({...scene,kind:'platform',size:3,chain:1}).label).toBe('Ultra Target Bonus!');
    expect(feedbackText({...scene,kind:'platform',size:6,chain:1}).label).toBe('Mega Target Bonus!');
    expect(line(5,2).label).toBe('Double!');expect(line(4,9).label).toBe('Vegas!');
    expect(line(4,2,[1]).bonus).toBe('');expect(line(4,3,[1]).bonus).toBe('Double Bonus!');
  });
});

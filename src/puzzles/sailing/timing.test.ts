import { describe, expect, it } from 'vitest';
import { SailBoard, targetCells } from './board';
import { DEFAULT_SETTINGS, SailingGame } from './game';
import { FallingClock, LANDING_DELAY_MS, NORMAL_FALL_SPEED, FAST_FALL_SPEED, cascadeDuration, boardClearDuration } from './timing';
import reference from './fixtures/timing.json';

describe('Sailing timing',()=>{
  it('matches recorded falling positions, including Space press/release and both display scales',()=>{
    for(const sample of reference){
      const clock=new FallingClock();let row=-1;
      clock.setFast(sample.mode===1);
      for(let t=0;t<=4000;t+=10){
        const change=sample.mode===2&&(t===500||t===900)?t===500:undefined;
        row+=clock.advance(t?10:0,change);
        if(t%100!==0)continue;
        const recorded=sample.samples[t/100];
        expect(row,`mode ${sample.mode}, t=${t}`).toBe(recorded[1]);
        const pixels=row*sample.height+Math.trunc(Math.fround(sample.height*clock.fraction));
        // The doubled display rounds its own speed conversion by at most one pixel.
        expect(Math.abs(pixels-recorded[2]),`mode ${sample.mode}, height ${sample.height}, t=${t}`).toBeLessThanOrEqual(sample.height===34?0:1);
      }
    }
  });
  it('keeps normal falling at 30 logical pixels per second and Space at 800 before row rounding',()=>{
    const normal=new FallingClock();normal.advance(1000);
    expect(Math.fround(normal.fraction*34)).toBe(30);
    const fast=new FallingClock();fast.setFast(true);fast.advance(20);
    expect(Math.fround(fast.fraction*34)).toBe(16);
    expect(NORMAL_FALL_SPEED).toBe(Math.fround(0.03));expect(FAST_FALL_SPEED).toBe(Math.fround(0.8));
  });
  it('preserves the partial row when Space is pressed and released',()=>{
    const c=new FallingClock();c.advance(500);const before=c.fraction;
    c.setFast(true);c.advance(0);expect(Math.abs(c.fraction-before)*34).toBeLessThan(1);
    c.advance(10);const fast=c.fraction;c.setFast(false);c.advance(0);
    expect(Math.abs(c.fraction-fast)*34).toBeLessThan(0.04);
  });
  it('waits the verified 141ms landing grace before committing a supported pair',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,42);g.board=new SailBoard(42,5,false);
    g.board.targets=[{x:6,y:15,type:12,enabled:true}];
    g.active={x:2,y:15,orient:5,pieces:[0,8],fraction:0};
    g.step(0,true);expect(g.isLanding).toBe(true);expect(g.moves).toBe(0);
    g.step(140,true);expect(g.moves).toBe(0);
    g.step(1,true);expect(g.moves).toBe(1);expect(LANDING_DELAY_MS).toBe(141);
  });
  it('allows movement away from a shelf during landing grace without immediately dropping again',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,42);g.board=new SailBoard(42,5,false);
    g.board.targets=[{x:6,y:15,type:12,enabled:true}];g.board.set(2,10,5);
    g.active={x:2,y:9,orient:5,pieces:[0,8],fraction:0};
    g.step(0,true);expect(g.move(1)).toBe(true);
    g.step(140,true);expect(g.active!.fraction).toBe(0);
    g.step(1,true);expect(g.moves).toBe(0);expect(g.active!.fraction).toBeGreaterThan(0);
  });
  it('locks at once when a pair touches down again on the row of its expired grace',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,42);g.board=new SailBoard(42,5,false);
    g.board.targets=[{x:6,y:15,type:12,enabled:true}];g.board.set(2,10,5);
    g.active={x:2,y:8,orient:5,pieces:[0,8],fraction:0};
    g.step(0,false);for(let i=0;i<200&&!g.isLanding;i++)g.step(10,false);
    expect(g.isLanding).toBe(true);expect(g.active!.y).toBe(9);
    expect(g.move(1)).toBe(true);g.step(141,false);
    expect(g.isLanding).toBe(false);expect(g.moves).toBe(0);
    expect(g.move(-1)).toBe(true);g.step(0,false);
    expect(g.moves).toBe(1);expect(g.active!.y).toBe(-1);
  });
  it('gives a fresh grace when the next touchdown is on a different row',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,42);g.board=new SailBoard(42,5,false);
    g.board.targets=[{x:6,y:15,type:12,enabled:true}];g.board.set(2,10,5);
    g.active={x:2,y:8,orient:5,pieces:[0,8],fraction:0};
    g.step(0,false);for(let i=0;i<200&&!g.isLanding;i++)g.step(10,false);
    expect(g.move(1)).toBe(true);g.step(141,false);
    for(let i=0;i<2000&&!g.isLanding;i++)g.step(10,false);
    expect(g.isLanding).toBe(true);expect(g.moves).toBe(0);expect(g.active!.y).toBe(15);
  });
  it('uses the faster cascade rate and difficulty-dependent board-clear pause',()=>{
    expect(cascadeDuration(1)).toBe(28);expect(cascadeDuration(6)).toBe(170);
    expect(boardClearDuration(0)).toBe(1500);expect(boardClearDuration(5)).toBe(1750);expect(boardClearDuration(9)).toBe(2750);
  });
  it('banks the completed board before its pause and deals only after the pause expires',()=>{
    const g=new SailingGame({...DEFAULT_SETTINGS,difficulty:9},42);g.board=new SailBoard(42,9,false);
    g.active=null;g.board.targets=[{x:6,y:15,type:12,enabled:true}];
    g.board.newlyFilled();
    for(const c of targetCells(g.board.targets[0]))g.board.set(c.x,c.y,c.piece);
    g.resolve();g.step(500,false);
    expect(g.scenes[0].message).toBe('Board Cleared');expect(g.points).toBe(20);
    expect(g.active).toBeNull();expect(g.boards).toBe(0);
    g.step(2749,false);expect(g.active).toBeNull();
    g.step(1,false);expect(g.boards).toBe(1);expect(g.active).not.toBeNull();expect(g.points).toBe(20);
  });
  it('does not consume a second row when applying input after a delayed animation frame',()=>{
    const g=new SailingGame(DEFAULT_SETTINGS,42);g.board=new SailBoard(42,5,false);
    g.step(200,true);expect(g.active!.y).toBe(0);
    g.step(0,true);expect(g.active!.y).toBe(0);
  });
});

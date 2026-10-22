import { describe, expect, it } from 'vitest';
import { clearPiece, clearSparks, fadeOpacity, sparkMotion } from './animation';
import { SailBoard, EMPTY, targetCells } from './board';
import { DEFAULT_SETTINGS, SailingGame } from './game';
import { drawBoard, LEFT, TOP, CELL, type SailingImages } from './render';
import reference from './fixtures/animation.json';

function blank():SailingGame {
  const g=new SailingGame(DEFAULT_SETTINGS,42);g.active=null;g.board=new SailBoard(42,5,false);
  g.board.targets=[{x:6,y:15,type:12,enabled:true}];
  return g;
}
function completed():SailingGame {
  const g=blank(),t={x:0,y:15,type:12,enabled:true};g.board.targets.push(t);
  for(const c of targetCells(t))g.board.set(c.x,c.y,c.piece);
  // One cleared half is joined to a surviving water piece.
  g.board.set(1,15,4);g.board.set(2,15,11);
  g.resolve();return g;
}
function rendered(g:SailingGame){
  const draws:Array<{name:string;args:number[];alpha:number}>=[];let alpha=1;const stack:number[]=[];
  const ctx=new Proxy({
    get globalAlpha(){return alpha;},set globalAlpha(value:number){alpha=value;},
    save:()=>stack.push(alpha),restore:()=>{alpha=stack.pop()!;},
    drawImage:(image:{name:string},...args:number[])=>draws.push({name:image.name,args,alpha}),
  },{get:(target,key)=>key in target?target[key as keyof typeof target]:()=>{}}) as unknown as CanvasRenderingContext2D;
  const images={get:(name:string)=>({name})} as unknown as SailingImages;
  drawBoard(ctx,images,g);return draws;
}

describe('Sailing clear animations',()=>{
  it('matches recorded opacity during the 500ms piece fade',()=>{
    for(const [age,alpha] of reference.fades)expect(fadeOpacity(age)).toBeCloseTo(alpha,7);
  });
  it('matches recorded glow trajectories and opacity over their 900ms lifetime',()=>{
    for(const trace of reference.sparks)for(const [age,x,y,alpha] of trace.samples){
      const actual=sparkMotion(age,trace.angle);
      expect([actual.x,actual.y]).toEqual([x,y]);expect(actual.alpha).toBeCloseTo(alpha,7);
    }
  });
  it('uses filled target images for completed platforms, and unjoined pieces for line breaks',()=>{
    for(const piece of [0,1,2,3,4,5,8,11,21,32,67,245]){
      expect(clearPiece(piece,true)%8).toBe(7);
      expect(clearPiece(piece,true)>>5).toBe(piece>>5);
      expect(clearPiece(piece,false)%8).toBe(piece%8<5?0:piece%8);
    }
  });
  it('removes a completed shelf and surviving connectors at the start of the fade',()=>{
    const g=completed(),scene=g.scenes[0];
    expect(scene.kind).toBe('platform');expect(scene.duration).toBe(500);
    expect(scene.targets.find(t=>t.x===0)?.enabled).toBe(false);
    expect(scene.cells[15*8+2]).toBe(8);expect(scene.cells[15*8]).toBe(EMPTY);
    g.step(250,false);
    const draws=rendered(g);
    const target=draws.filter(d=>d.name==='piece_rope'&&d.args[4]<LEFT+2*CELL);
    expect(target).toHaveLength(4);
    expect(target.every(d=>d.args[0]===7*CELL&&d.alpha===0.5)).toBe(true);
    expect(draws.filter(d=>d.name==='platform').every(d=>d.args[4]>=LEFT+6*CELL)).toBe(true);
    expect(draws.some(d=>d.name==='piece_water'&&d.args[0]===0&&d.args[4]===LEFT+2*CELL&&d.alpha===1)).toBe(true);
  });
  it('keeps glows visible when the fade finishes and falling resumes',()=>{
    const g=blank();
    for(let x=0;x<4;x++)g.board.set(x,15,0);
    g.board.set(0,14,8);g.resolve();
    expect(g.effects).toHaveLength(1);expect(clearSparks(g.effects[0])).toHaveLength(12);
    g.step(500,false);expect(g.scenes[0].falls).toHaveLength(1);
    expect(g.effects[0].age).toBe(500);
    expect(rendered(g).filter(d=>d.name==='glow_rope')).toHaveLength(12);
    g.step(28,false);expect(g.active).not.toBeNull();expect(g.effects[0].age).toBe(528);
    g.step(371,false);expect(clearSparks(g.effects[0])).toHaveLength(12);
    g.step(1,false);expect(g.effects).toHaveLength(0);
  });
  it('shows an unfinished target again as soon as a line breaks within it',()=>{
    const g=blank();g.board.targets.push({x:0,y:15,type:12,enabled:true});
    for(let x=0;x<4;x++)g.board.set(x,15,5);
    g.resolve();g.step(250,false);
    const draws=rendered(g).filter(d=>d.name==='piece_rope'&&d.args[4]===LEFT&&d.args[5]===TOP+15*CELL);
    expect(draws.map(d=>[d.args[0],d.alpha])).toEqual([[5*CELL,0.5],[6*CELL,1]]);
  });
  it('changes an incoming target to its filled artwork only when that piece arrives',()=>{
    const g=blank();g.board.targets.push({x:0,y:15,type:12,enabled:true});g.board.set(0,13,0);
    g.resolve();
    const atTarget=()=>rendered(g).filter(d=>d.name==='piece_rope'&&d.args[4]===LEFT&&d.args[5]===TOP+15*CELL);
    expect(atTarget()).toHaveLength(0);
    g.step(55,false);expect(atTarget()).toHaveLength(0);
    g.step(1,false);expect(atTarget().at(-1)?.args[0]).toBe(7*CELL);
  });
  it('starts each chain burst once and keeps earlier glows through the following clear',()=>{
    const g=completed();
    // Give the following clear a different colour to distinguish the two bursts.
    const next={...g.snapshot(),cleared:[{x:0,y:15,piece:8}],chain:2,kind:'line' as const,duration:500};
    g.scenes.splice(1,g.scenes.length-1,next);
    g.step(510,false);g.step(0,false);
    expect(g.effects.map(e=>e.age)).toEqual([510,10]);
    expect(clearSparks(g.effects[1])).toHaveLength(4);
  });
});

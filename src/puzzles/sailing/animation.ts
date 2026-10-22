import { oriented, type Cell } from './board';

export const CLEAR_FADE_MS=500;
export const SPARK_LIFETIME_MS=900;
export interface ClearEffect { cells:Cell[]; chain:number; age:number; seed:number }
const f=Math.fround;
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const round=(value:number)=>Math.floor(value+0.5);

export const clearPiece=(piece:number,platform:boolean):number=>platform?Math.floor(piece/8)*8+7:oriented(piece,-1);
export const fadeOpacity=(age:number):number=>clamp(f(1+f(age*f(-0.002))));

/** The glow remains opaque for 200 ms, then fades while curving downward. */
export function sparkMotion(age:number,angle:number):{x:number;y:number;alpha:number} {
  const t=Math.max(0,Math.trunc(age)),late=Math.max(0,t-200);
  const vx=f(Math.cos(angle)*f(0.12)),vy=f(Math.sin(angle)*f(0.12));
  return {
    x:round(f(f(t*vx)+f(f(f(0.00003)*late)*late))),
    y:round(f(t*f(vy+f(f(0.0001)*t)))),
    alpha:clamp(f(1-f(late/700))),
  };
}

/** Decorative angles are reproducible without consuming the board's random sequence. */
export function clearSparks(effect:ClearEffect):Array<Cell&{alpha:number}> {
  if(effect.age>=SPARK_LIFETIME_MS)return [];
  const count=effect.chain+2;
  return effect.cells.flatMap((cell,index)=>{
    let hash=Math.imul(effect.seed^(index+1),0x45d9f3b);hash=Math.imul(hash^(hash>>>16),0x45d9f3b);
    const initial=((hash^(hash>>>16))>>>0)/0x100000000*Math.PI*2;
    return Array.from({length:count},(_,i)=>{
      const p=sparkMotion(effect.age,initial+i*Math.PI*2/count);
      return {x:cell.x*34+p.x,y:cell.y*34+p.y,piece:cell.piece,alpha:p.alpha};
    });
  });
}

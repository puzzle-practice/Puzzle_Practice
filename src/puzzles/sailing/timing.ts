/** Logical pixels per millisecond. Display scaling changes both pixels and cell height. */
export const CELL_SIZE=34;
export const NORMAL_FALL_SPEED=Math.fround(0.03);
export const FAST_FALL_SPEED=Math.fround(0.8);
export const CASCADE_FALL_SPEED=Math.fround(FAST_FALL_SPEED*1.5);
export const LANDING_DELAY_MS=Math.trunc(Math.fround(CELL_SIZE*0.125/NORMAL_FALL_SPEED));
export const cascadeDuration=(rows:number)=>Math.trunc(Math.fround(CELL_SIZE*rows/CASCADE_FALL_SPEED));
export const boardClearDuration=(difficulty:number)=>Math.max(250*(difficulty+1)+250,1500);

/** The row timer retains its phase when speed changes and truncates each row's duration. */
export class FallingClock {
  private elapsed=0;
  private speed=NORMAL_FALL_SPEED;
  fraction=0;
  private phase():number{return Math.fround(Math.fround(this.elapsed*this.speed)/CELL_SIZE);}
  rebase(fraction:number):void {
    this.elapsed=Math.trunc(Math.fround(Math.fround(fraction*CELL_SIZE)/this.speed));
    this.fraction=fraction;
  }
  setFast(fast:boolean):void {
    const speed=fast?FAST_FALL_SPEED:NORMAL_FALL_SPEED;
    if(speed===this.speed)return;
    const pixels=Math.fround(this.phase()*CELL_SIZE);
    this.elapsed=Math.trunc(Math.fround(pixels/speed));
    this.speed=speed;
  }
  /** One row event per animation tick, including a delayed tick, as in the game. */
  advance(ms:number,fast?:boolean):number {
    this.elapsed+=ms;
    if(fast!==undefined)this.setFast(fast);
    const phase=this.phase();
    if(phase>=1){
      this.elapsed-=Math.trunc(Math.fround(CELL_SIZE/this.speed));
      this.fraction=Math.min(1,Math.fround(phase-1));
      return 1;
    }
    this.fraction=phase;
    return 0;
  }
}

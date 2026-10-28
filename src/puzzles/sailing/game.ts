import { SailBoard, ClearScore, EMPTY, WIDTH, HEIGHT, oriented, targetCells, type Cell, type Fall, type Target } from './board';
import { FallingClock, LANDING_DELAY_MS, cascadeDuration, boardClearDuration } from './timing';
import { CLEAR_FADE_MS, SPARK_LIFETIME_MS, type ClearEffect } from './animation';

export interface SailingSettings {
  difficulty: number;
  tokens: number;
  desired: number;
  timerMs: number;
  indicatorMax: number;
}
export const DEFAULT_SETTINGS: SailingSettings = { difficulty: 5, tokens: 1, desired: 3, timerMs: 0, indicatorMax: 7.48 };
export const DEFAULT_LEVELS=[0,1.02,2.04,2.38,3.06,3.4,3.74,4.08,4.08,4.42,4.76,4.76,5.1,5.1,5.44,5.78,5.78,6.12,6.8,7.48];
export function indicatorStep(value:number,max=7.48):number {
  const i=DEFAULT_LEVELS.findIndex(n=>value<=n*max/7.48);
  return i===-1?20:i;
}
export function readSettings(value: unknown): SailingSettings | null {
  if (!value || typeof value !== 'object') return null;
  const s=value as SailingSettings;
  return Number.isInteger(s.difficulty) && s.difficulty>=0 && s.difficulty<=9 &&
    [0,1,2].includes(s.tokens) && [-1,1,2,3,4,7].includes(s.desired) &&
    [0,120000,300000,600000].includes(s.timerMs) && Number.isFinite(s.indicatorMax) && s.indicatorMax>=1 && s.indicatorMax<=1000 ? {...s} : null;
}
export const settingsKey = (s: SailingSettings) => `d${s.difficulty}-t${s.tokens}-r${s.desired}-${s.timerMs}-i${s.indicatorMax}`;
export interface Pair { x: number; y: number; orient: number; pieces: number[]; fraction: number }
export interface Scene {
  cells: number[];
  targets: Target[];
  duration: number;
  falls?: Fall[];
  cleared?: Cell[];
  chain?: number;
  kind?: 'platform' | 'line';
  bonuses?: number[];
  /** Platforms completed together, or the longest line, for the step's feedback text. */
  size?: number;
  message?: string;
}
const TARGET_TEXT=['','Target Bonus!','Super Target Bonus!','Ultra Target Bonus!','Mega Target Bonus!'];
const CHAIN_TEXT=['','','Double!','Triple!','Bingo!','Donkey!','Vegas!'];
/** The game's feedback: target or long-line text on the first step only, chain names after it, Double Bonus from step three. */
export function feedbackText(scene: Scene): { label: string; bonus: string } {
  const chain=scene.chain??0, size=scene.size??0;
  const label=!chain?'':chain>1?CHAIN_TEXT[Math.min(chain,6)]:
    scene.kind==='platform'?TARGET_TEXT[Math.min(Math.max(size,1),4)]:size>=6?'Excellent!':size===5?'Great!':'';
  return {label,bonus:chain>=3&&scene.bonuses?.some(Boolean)?'Double Bonus!':''};
}
export const pairCells = (p: Pair): Cell[] => [
  {x:p.x,y:p.y,piece:oriented(p.pieces[0],(p.orient+4)%8)},
  {x:p.x+(p.orient===1?-1:p.orient===5?1:0),y:p.y+(p.orient===3?-1:p.orient===7?1:0),piece:oriented(p.pieces[1],p.orient)},
];

/** Eighteen ten-second intervals; idle intervals count as one unproductive move. */
export class Performance {
  private buckets=Array.from({length:18},()=>({points:0,moves:0}));
  private slot=0;
  private time=0;
  advance(ms: number): void {
    while (this.time+10000<=ms) {
      if (!this.buckets[this.slot].moves) this.buckets[this.slot].moves=1;
      this.time+=10000; this.slot=(this.slot+1)%18; this.buckets[this.slot]={points:0,moves:0};
    }
  }
  add(points: number, moves: number): void { this.buckets[this.slot].points+=points; this.buckets[this.slot].moves+=moves; }
  get value(): number {
    const moves=this.buckets.reduce((n,b)=>n+b.moves,0);
    return moves ? Math.max(0,this.buckets.reduce((n,b)=>n+b.points,0)/moves) : 0;
  }
}

export class SailingGame {
  board: SailBoard;
  active: Pair | null=null;
  scenes: Scene[]=[];
  sceneElapsed=0;
  effects:ClearEffect[]=[];
  points=0;
  moves=0;
  boards=0;
  booches=0;
  platforms=0;
  longestChain=0;
  lastChain=0;
  lastPoints=0;
  tokenMatches=Array<number>(8).fill(0);
  tokenUnits=Array<number>(8).fill(0);
  performance=new Performance();
  message='';
  private boardNumber=0;
  private pendingBoard: 'clear' | 'booch' | null=null;
  private pendingPoints=0;
  private fallClock=new FallingClock();
  private clockPair:Pair|null=null;
  private contactMs:number|null=null;
  private contactRow:number|null=null;
  private atSpawn=false;
  private effectScene:Scene|null=null;
  constructor(readonly settings: SailingSettings, readonly seed: number, readonly sandbox = false) {
    this.board=this.deal(); this.spawn();
  }
  private deal(): SailBoard {
    // Fresh boards use a deterministic practice seed sequence for portable replays.
    const seed=this.boardNumber ? (this.seed+Math.imul(this.boardNumber,0x9e3779b9))>>>0 : this.seed;
    const b=new SailBoard(seed,this.settings.difficulty); b.bonusMode=this.settings.tokens; b.desiredBonus=this.settings.desired;
    return b;
  }
  snapshot(): Scene { return {cells:[...this.board.cells],targets:this.board.targets.map(t=>({...t})),duration:0}; }
  private spawn(): void { this.active={x:3,y:-1,orient:5,pieces:this.board.nextPair(),fraction:0}; }
  get isLanding():boolean{return this.contactMs!==null;}
  /** Freeplay: a built board waits with gravity off and no pair until the first Fall faster. */
  held=false;
  hold():void{this.active=null;this.held=true;this.message='Fall faster (Space) turns gravity on';}
  /** Freeplay's first Fall faster: the built board falls and clears as it stands, then the first pair spawns. */
  release():boolean{
    if(!this.held||this.scenes.length)return false;
    this.held=false;this.message='';this.resolve();return true;
  }
  /** A clear is still playing out, or its sparks are still fading. */
  get busy():boolean{return this.scenes.length>0||this.effects.length>0;}
  /** After time's up: plays out what's clearing without moving the falling pair. */
  playOut(delta:number):void{
    if(this.scenes.length){this.step(delta,false);return;}
    for(const effect of this.effects)effect.age+=delta;
    this.effects=this.effects.filter(effect=>effect.age<SPARK_LIFETIME_MS);
  }
  private syncClock(p:Pair):void {
    if(this.clockPair===p)return;
    this.clockPair=p;this.fallClock=new FallingClock();this.fallClock.rebase(p.fraction);this.contactMs=null;
    this.contactRow=null;this.atSpawn=true;
  }
  /** Touching down again on the row of an expired grace locks at once; the spawn check never records a row. */
  private touchDown(p:Pair):void {
    const row=Math.max(...pairCells(p).map(c=>c.y)), record=!this.atSpawn;
    this.atSpawn=false;
    if(record&&row===this.contactRow){this.land();return;}
    if(record)this.contactRow=row;
    p.fraction=0;this.contactMs=0;
    this.fallClock=new FallingClock();
  }
  move(dx: number): boolean {
    const p=this.active; if (!p) return false;
    const cells=pairCells(p), left=Math.min(...cells.map(c=>c.x)), bottom=Math.max(...cells.map(c=>c.y));
    const vertical=p.orient===3||p.orient===7;
    if (!this.board.move(left,bottom,vertical?1:2,vertical?2:1,dx,p.fraction)) return false;
    p.x+=dx; return true;
  }
  rotate(clockwise: boolean): boolean {
    const p=this.active; if (!p) return false;
    const rotation=this.board.rotate(p.x,p.y,p.orient,clockwise,p.fraction);
    if (!rotation) return false;
    [p.orient,p.x,p.y]=rotation; return true;
  }
  canFall(p: Pair): boolean {
    const cells=pairCells(p), bottom=Math.max(...cells.map(c=>c.y));
    return cells.every(c=>c.y<HEIGHT-1 && (c.y+1<0 || this.board.get(c.x,c.y+1)===EMPTY) &&
      !(p.fraction<0.5 && c.y===bottom && this.board.beneathTarget(c.x,c.y+1)));
  }
  step(delta: number, fast: boolean): void {
    for(const effect of this.effects)effect.age+=delta;
    this.effects=this.effects.filter(effect=>effect.age<SPARK_LIFETIME_MS);
    if (this.scenes.length) {
      this.sceneElapsed+=delta;
      while (this.scenes.length && this.sceneElapsed>=this.scenes[0].duration) {
        this.sceneElapsed-=this.scenes.shift()!.duration;
        this.enterScene();
      }
      if(this.scenes[0]?.message)this.bankMoveScore();
      if (!this.scenes.length) { this.finishMove(); this.sceneElapsed=0; }
      return;
    }
    const p=this.active; if (!p) return;
    this.syncClock(p);
    if(this.contactMs!==null){
      this.contactMs+=delta;this.fallClock.advance(delta);
      if(this.contactMs>=LANDING_DELAY_MS){
        if(!this.canFall(p)){this.land();return;}
        this.contactMs=null;p.fraction=this.fallClock.fraction;
      }
      return;
    }
    this.fallClock.setFast(fast);
    if(!this.canFall(p)){this.touchDown(p);return;}
    this.atSpawn=false;
    // Input changes at the current timestamp must not consume another animation tick.
    if(delta===0)return;
    if(this.fallClock.advance(delta)){
      p.y++;p.fraction=0;
      if(!this.canFall(p)){this.touchDown(p);return;}
    }
    p.fraction=this.fallClock.fraction;
  }
  private enterScene():void {
    const scene=this.scenes[0]??null;
    if(scene===this.effectScene)return;
    this.effectScene=scene;
    if(scene?.cleared&&this.sceneElapsed<SPARK_LIFETIME_MS)this.effects.push({
      cells:scene.cleared,chain:scene.chain!,age:this.sceneElapsed,
      seed:(this.seed+Math.imul(this.moves+1,0x9e3779b9)+scene.chain!)>>>0,
    });
  }
  land(): void {
    if (!this.active) return;
    const cells=pairCells(this.active), clipped=cells.some(c=>c.y<0);
    for (const c of cells) if (this.board.inBounds(c.x,c.y)) this.board.set(c.x,c.y,clipped?oriented(c.piece,EMPTY):c.piece);
    this.moves++; this.performance.add(0,1); this.active=null;
    this.resolve();
  }
  /** Gravity, platforms, then lines; each successful phase restarts at gravity. */
  resolve(): void {
    const score=new ClearScore(this.settings.difficulty);
    for (let safety=0;safety<512;safety++) {
      let scene=this.snapshot();
      const falls=this.board.gravity();
      if (falls.length) { this.scenes.push({...scene,falls,duration:cascadeDuration(Math.max(...falls.map(f=>f.to-f.y)))}); continue; }
      const completed=this.board.completed();
      let cells: Cell[]=[], bonuses: number[]=[], kind: 'platform'|'line'='platform', size=completed.length;
      if (completed.length) {
        for (const t of completed) {
          const target=targetCells(t); bonuses.push(this.board.chooseBonus(target));
          cells.push(...target.map(c=>({...c,piece:this.board.get(c.x,c.y)})));
          this.board.remove(target); t.enabled=false;
        }
        this.platforms+=completed.length;
      } else {
        const runs=this.board.lines(); kind='line';
        if (!runs.length) break;
        const unique=new Map(runs.flatMap(r=>r.cells).map(c=>[c.y*WIDTH+c.x,c]));
        cells=[...unique.values()]; bonuses=runs.map(r=>r.bonus); size=Math.max(...runs.map(r=>r.cells.length)); this.board.remove(cells);
      }
      score.add(cells,kind==='platform');
      for (const token of bonuses) if (token) {
        this.tokenMatches[token]++; this.tokenUnits[token]+=score.chain>=3?2:1;
      }
      // Surviving halves lose their connectors and completed shelves disappear immediately.
      scene=this.snapshot();
      this.scenes.push({...scene,cleared:cells,kind,chain:score.chain,bonuses,size,duration:CLEAR_FADE_MS});
    }
    this.lastChain=score.chain; this.longestChain=Math.max(this.longestChain,score.chain);
    this.lastPoints=score.points+this.board.newlyFilled(); this.pendingPoints=this.lastPoints;
    if (this.board.blocked && !this.sandbox) { this.pendingBoard='booch'; this.pendingPoints-=20; }
    else if (!this.board.remaining && !this.sandbox) {
      this.pendingBoard='clear';
      this.scenes.push({...this.snapshot(),duration:boardClearDuration(this.settings.difficulty),message:'Board Cleared'});
    }
    if(this.scenes[0]?.message)this.bankMoveScore();
    this.enterScene();
    if (!this.scenes.length) this.finishMove();
  }
  private bankMoveScore():void {
    this.points+=this.pendingPoints;this.performance.add(this.pendingPoints,0);this.pendingPoints=0;
  }
  private finishMove(): void {
    this.contactMs=null;
    this.bankMoveScore();
    if (this.pendingBoard) {
      const cleared=this.pendingBoard==='clear';
      if (cleared) this.boards++; else this.booches++;
      this.message=cleared?'Board Cleared':'Ye Booched It!';
      this.boardNumber++; this.board=this.deal(); this.pendingBoard=null;
    }
    if (this.sandbox && this.board.blocked) { this.active=null; this.message='Spawn blocked · return to editor'; }
    else this.spawn();
  }
  get efficiency(): number { return this.moves ? this.points/this.moves : 0; }
  /** For a landing preview only; it never advances randomness or scoring. */
  landing(): Cell[] {
    if (!this.active) return [];
    const p={...this.active};
    while (this.canFall(p)){p.y++;p.fraction=0;}
    return pairCells(p);
  }
}

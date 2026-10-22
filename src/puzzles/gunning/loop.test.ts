import { describe, expect, it, vi } from 'vitest';
import { CRATE, DOWN, EMPTY, FIRING, LEFT, LOOP, LOOP_DECK, LOOP_PATH, LOOP_SIDES, MUZZLE, PARTIAL, POWDER, Piece, RIGHT, SHOT, SWAB, UP, WAD, WIDTH } from './board';
import { BLAST_MS, DEFAULT_SETTINGS, FIRE_MS, GunningGame, WASH_MS, readSettings, settingsKey } from './game';
import { drawGame } from './render';

const make = (seed = 42) => new GunningGame({ ...DEFAULT_SETTINGS, mode: 'loop' }, seed);
const tick = (g: GunningGame) => g.step(g.tickAt + g.interval - g.now);
const onCircuit = (x: number, y: number) => LOOP_PATH.some(([px, py]) => (x === px || x === WIDTH - 1 - px) && y === py);
const sidePieces = (g:GunningGame,side:number) => g.board.pieces.filter(p=>(p.x<WIDTH/2)===(side===1));

function feed(g: GunningGame, type: number, gun = 0) {
  const row = LOOP.rows[gun%2],circuit=LOOP_SIDES[gun<2?0:1];
  g.board.pieces = [new Piece(type, circuit.front, row - 1, 2)];
  g.board.ballsOut = type === SHOT ? 1 : 0;
  g.placeArrow(circuit.front, row, circuit.left?RIGHT:LEFT);
  tick(g); tick(g);
}

/** Pick the next wanted piece before it reaches an entrance, using persistent arrows. */
function pickLoopPieces(g: GunningGame, side=0, oneGun=false): void {
  const circuit=LOOP_SIDES[side];
  for (const [i, gun] of circuit.guns.entries()) {
    if(oneGun&&i>0)break;
    const row=LOOP.rows[i];
    const cannon = g.board.cannons[gun];
    const pending = g.board.pieces.some(p => p.nx === circuit.front + (circuit.left?1:-1) && p.ny === row);
    const approaching = g.board.pieces.find(p => p.nx === circuit.front && p.ny === row);
    const need = [POWDER, WAD, SHOT][cannon.slots.findIndex(slot => slot === null)];
    g.placeArrow(circuit.front, row, !pending && approaching?.type === need ? (circuit.left?RIGHT:LEFT) : DOWN);
  }
}

describe('Gunning loop drill', () => {
  it('feeds consecutive pieces without mandatory gaps and fills the circuit without collisions', () => {
    const g = make();
    for(let count=1;count<=LOOP.pieces;count++){
      tick(g);
      expect(g.board.pieces).toHaveLength(count*2);
      expect(new Set(g.board.pieces.map(p=>`${p.x}:${p.y}`)).size).toBe(count*2);
      expect(new Set(g.board.pieces.map(p=>`${p.nx}:${p.ny}`)).size).toBe(count*2);
      for(const side of [0,1])for(const type of [SWAB,SHOT,POWDER,WAD]) expect(sidePieces(g,side).filter(p=>p.type===type).length).toBeLessThanOrEqual(3);
      for(const p of g.board.pieces) expect(g.board.pieces.some(other=>other!==p&&p.swapsWith(other))).toBe(false);
    }
    expect(g.board.pieces.some(p=>g.board.pieces.some(other=>other!==p&&p.nx===other.x&&p.ny===other.y))).toBe(true);
    for(const side of [0,1])expect([SWAB,SHOT,POWDER,WAD].map(type=>sidePieces(g,side).filter(p=>p.type===type).length)).toEqual([3,3,3,3]);
  });

  it('holds a completed load briefly and shuffles its pieces before returning them, reproducibly for the seed', () => {
    function loadAndRefill(seed:number){
      const g=new GunningGame({...DEFAULT_SETTINGS,mode:'loop',speed:100},seed);
      for(let i=0;i<LOOP.pieces;i++)tick(g);
      const right=sidePieces(g,0),order=[POWDER,WAD,SHOT], selected=order.map(type=>right.find(p=>p.type===type)!);
      const others=right.filter(p=>!selected.includes(p));
      others.forEach((p,i)=>{p.x=p.nx=LOOP.back;p.y=LOOP.bottom-i;p.ny=p.y-1;p.dir=0;});
      selected.forEach((p,i)=>{p.x=p.nx=LOOP.front;p.y=2-i;p.ny=p.y+1;p.dir=2;});
      const added:{type:number;at:number}[]=[];
      g.board.listener!.pieceAdded=p=>{if(p.x>WIDTH/2)added.push({type:p.type,at:g.now});};
      g.placeArrow(LOOP.front,LOOP.rows[0],LEFT);
      for(let i=0;i<4;i++)tick(g);
      expect(g.stats.loaded).toBe(1);expect(g.stats.wrong).toBe(0);
      expect(sidePieces(g,0)).toHaveLength(9);
      const loadedAt=g.now;
      g.placeArrow(LOOP.front,LOOP.rows[0],DOWN);
      g.step(LOOP.refillDelayMs-1);
      expect(added).toEqual([]);
      g.step(500);
      expect(added.map(p=>p.type).sort()).toEqual([...order].sort());
      expect(added.map(p=>p.type)).not.toEqual(order);
      expect(added.every(p=>p.at>=loadedAt+LOOP.refillDelayMs)).toBe(true);
      expect([SWAB,SHOT,POWDER,WAD].map(type=>sidePieces(g,0).filter(p=>p.type===type).length)).toEqual([3,3,3,3]);
      return added;
    }
    for(const seed of [1,42,123,999])expect(loadAndRefill(seed)).toEqual(loadAndRefill(seed));
  });
  it('mirrors the deck and barrels for two clean guns per side and keeps unpicked pieces circulating', () => {
    const g = new GunningGame({ ...DEFAULT_SETTINGS, mode: 'loop', cannons: 6, firing: 'viking', holes: 4, shipMoves: true, balls: 10 }, 42);
    const b = g.board;
    expect(b.cannons).toHaveLength(4);
    expect(b.barrels).toHaveLength(2);
    expect(b.barrels.map(barrel=>[barrel.shown,barrel.row])).toEqual([[8,6],[4,6]]);
    expect(b.height).toBe(13);
    expect(b.cannons.every(c => c.state === EMPTY && !c.fouled)).toBe(true);
    expect(b.cannons.map(c=>c.left)).toEqual([false,false,true,true]);
    expect(b.cells.map(raw => (raw & 255) === CRATE ? 'c' : (raw & 255) >= MUZZLE ? '=' : '.').join('')).toBe(LOOP_DECK);
    for (const circuit of LOOP_SIDES)for (const [i,gun] of circuit.guns.entries()) {
      const x=circuit.front+(circuit.left?1:-1),row=LOOP.rows[i];
      expect(b.element(x, row)).toBe(MUZZLE);
      expect(b.cannonId(x, row)).toBe(gun);
    }
    for(let y=0;y<b.height;y++)for(let x=0;x<WIDTH;x++)expect(b.element(x,y)).toBe(b.element(WIDTH-1-x,y));
    expect(b.pieces).toHaveLength(0);
    for (let i = 0; i < LOOP_PATH.length; i++) tick(g);
    const pieces = [...b.pieces], initial = pieces.map(p => [p.type, p.x, p.y]);
    for (let i = 0; i < LOOP_PATH.length * 5; i++) {
      tick(g);
      expect(new Set(b.pieces.map(p => `${p.x}:${p.y}`)).size).toBe(LOOP.pieces*2);
      expect(b.pieces.every(p => onCircuit(p.x, p.y) && onCircuit(p.nx, p.ny))).toBe(true);
    }
    expect(b.pieces).toEqual(pieces);
    expect(b.pieces.map(p => [p.type, p.x, p.y])).toEqual(initial);
    expect(g.stats.overboard + g.stats.stuck + g.stats.fired).toBe(0);
  });

  it.each([0, 1, 2, 3])('fires gun %i after a correct load and finishes clean with no ghost pieces', gun => {
    const g = make(), cannon = g.board.cannons[gun], row = LOOP.rows[gun%2],circuit=LOOP_SIDES[gun<2?0:1];
    feed(g, POWDER, gun);
    expect(cannon.state).toBe(PARTIAL);
    expect(g.board.resting(cannon.left?3:9, row)).toBe(POWDER);
    feed(g, WAD, gun); feed(g, SHOT, gun);
    expect(g.stats.loaded).toBe(1);
    expect(cannon.state).toBe(FIRING);
    expect(g.stats.fired).toBe(1);
    expect(g.anims).toContainEqual({cannon:gun,kind:'fire',start:g.now});
    expect([1, 2, 3].map(dx => g.board.resting(circuit.front+(circuit.left?dx:-dx), row))).toEqual([0, 0, 0]);
    g.placeArrow(circuit.front,row,DOWN);
    g.step(FIRE_MS-1);expect(cannon.state).toBe(FIRING);
    g.step(1);expect(cannon.state).toBe(EMPTY);
    expect(cannon.slots).toEqual([null,null,null]);
    expect(cannon.fouled).toBe(false);
    expect(g.anims.some(a=>a.cannon===gun)).toBe(false);
    feed(g, POWDER, gun); feed(g, WAD, gun); feed(g, SHOT, gun);
    expect(g.stats.loaded).toBe(2);
    expect(g.loadsPerMinute).toBe(120000 / g.now);
    g.placeArrow(circuit.front, row, DOWN); g.step(10000);
    expect(cannon.state).toBe(EMPTY);
    expect(cannon.fouled).toBe(false);
    expect(g.stats.fired).toBe(2);
    expect(g.board.pieces.every(p => onCircuit(p.x, p.y))).toBe(true);
  });

  it('retains diversion arrows until changed and lets a swab clear a mistaken load', () => {
    const g = make(), c = g.board.cannons[0];
    feed(g, WAD);
    expect(g.stats.wrong).toBe(1);
    expect(c.slots[0]?.type).toBe(WAD);
    expect(g.board.arrow(LOOP.front, LOOP.rows[0])).toBe(LEFT);
    feed(g, SWAB);
    g.placeArrow(LOOP.front, LOOP.rows[0], DOWN);
    expect(g.stats.washes).toBe(1);
    g.step(WASH_MS);
    expect(c.state).toBe(EMPTY);
    expect(c.slots).toEqual([null, null, null]);
    expect(g.board.arrow(LOOP.front, LOOP.rows[0])).toBe(DOWN);
  });

  it.each([0,1])('supports sustained picking on side %i without losses or supply starvation', side => {
    const g = make();
    for (let i = 0; i < 600; i++) {
      pickLoopPieces(g,side); tick(g);
      expect(g.board.pieces.length).toBeLessThanOrEqual(LOOP.pieces*2);
      expect(g.board.pieces.length).toBeGreaterThan(0);
      for(const circuit of [0,1])for(const type of [SWAB,SHOT,POWDER,WAD]) expect(sidePieces(g,circuit).filter(p=>p.type===type).length).toBeLessThanOrEqual(3);
      expect(new Set(g.board.pieces.map(p => `${p.nx}:${p.ny}`)).size).toBe(g.board.pieces.length);
    }
    expect(g.stats.loaded).toBeGreaterThan(20);
    expect(g.stats.wrong + g.stats.overboard + g.stats.stuck).toBe(0);
    for (const circuit of LOOP_SIDES)for (const row of LOOP.rows) g.placeArrow(circuit.front, row, DOWN);
    for (let i = 0; i <= LOOP_PATH.length; i++) tick(g);
    expect(g.board.pieces).toHaveLength(LOOP.pieces*2);
  });

  it('is seeded, independent of render step size, and keeps drill scores apart from ordinary gunning', () => {
    const a = make(), b = make(), other = make(123);
    a.step(8000); b.step(8000); other.step(8000);
    expect(a.board.pieces).toEqual(b.board.pieces);
    expect(a.board.pieces.map(p => p.type)).not.toEqual(other.board.pieces.map(p => p.type));
    a.placeArrow(LOOP.front, LOOP.rows[0], LEFT); b.placeArrow(LOOP.front, LOOP.rows[0], LEFT);
    a.step(30000);
    for (let i = 0; i < 3000; i++) b.step(10);
    expect([a.stats, a.board.cells, a.board.pieces, a.now]).toEqual([b.stats, b.board.cells, b.board.pieces, b.now]);
    expect(settingsKey(a.settings)).not.toBe(settingsKey(DEFAULT_SETTINGS));
    expect(readSettings({ cannons: 2 })?.mode).toBe('normal');
    expect(readSettings({ mode: 'unknown' })).toBeNull();
    expect(a.placeArrow(LOOP.back, LOOP.top, RIGHT)).toBe(true);
    a.moveCursor(0, 1); expect(a.cursor.y).toBe(LOOP.rows[0]+1);
    a.moveCursor(0, -1); expect(a.cursor.y).toBe(LOOP.rows[0]);
  });

  it('obeys arrows anywhere on the open deck, with all four directions and the normal three-arrow limit', () => {
    const g=make(),p=new Piece(POWDER,7,1,0);g.board.pieces=[p];
    expect(g.placeArrow(7,0,DOWN)).toBe(true);
    tick(g);expect([p.x,p.y,p.nx,p.ny]).toEqual([7,0,7,1]);
    expect(g.placeArrow(1,1,UP)).toBe(true);
    expect(g.placeArrow(2,1,RIGHT)).toBe(true);
    expect(g.placeArrow(3,1,DOWN)).toBe(true);
    expect(g.board.arrow(7,0)).toBe(0);
    expect(g.placeArrow(6,0,LEFT)).toBe(false);
    expect(g.placeArrow(11,3,LEFT)).toBe(false);
    expect(g.placeArrow(6,6,LEFT)).toBe(false);
    expect(g.placeArrow(4,6,LEFT)).toBe(false);
    expect(g.placeArrow(8,6,LEFT)).toBe(false);
    g.selectArrow(UP);g.turnArrow(1);expect(g.nextArrow).toBe(RIGHT);
  });

  it('keeps the right supply repeatable when the left guns are used',()=>{
    const a=new GunningGame({...DEFAULT_SETTINGS,mode:'loop',speed:100},42);
    const b=new GunningGame({...DEFAULT_SETTINGS,mode:'loop',speed:100},42);
    for(let i=0;i<600;i++){
      pickLoopPieces(a,0);pickLoopPieces(b,0);pickLoopPieces(b,1,true);
      tick(a);tick(b);
      expect(sidePieces(a,0)).toEqual(sidePieces(b,0));
    }
    expect(b.stats.loaded).toBeGreaterThan(a.stats.loaded);
  });

  it('draws the firing blast and smoke at both sides, then leaves all four guns clean',()=>{
    const g=make();
    for(const cannon of g.board.cannons)for(const type of [POWDER,WAD,SHOT]){
      cannon.accept(new Piece(type,0,0,0),true);
      if(type===SHOT)cannon.checkLoaded(true);
    }
    const draw=vi.fn((..._args:unknown[])=>{});
    const fills:string[]=[];
    const surface:Record<string,unknown>={drawImage:draw,fillStyle:'',fillRect:()=>fills.push(String(surface.fillStyle))};
    const ctx=new Proxy(surface,{get:(target,key)=>typeof key==='string'&&key in target?target[key]:()=>{}}) as unknown as CanvasRenderingContext2D;
    const images={get:(asset:string)=>({asset,width:450,height:600}) as unknown as HTMLImageElement};
    const calls=(asset:string)=>draw.mock.calls.filter(call=>(call[0] as {asset:string}).asset===asset);
    g.step(100);drawGame(ctx,images,g,true);
    expect(fills.filter(color=>color==='rgba(22,16,14,.58)')).toHaveLength(4);
    expect(calls('blast_left').map(call=>call.slice(1))).toEqual([[-1,203],[-1,395]]);
    expect(calls('blast_right').map(call=>call.slice(1))).toEqual([[401,203],[401,395]]);
    draw.mockClear();g.step(BLAST_MS+400);drawGame(ctx,images,g,true);
    expect(calls('smoke')).toHaveLength(4);
    fills.length=0;g.step(FIRE_MS-g.now-1);drawGame(ctx,images,g,true);
    expect(fills.filter(color=>color==='rgba(22,16,14,.58)')).toHaveLength(4);
    draw.mockClear();fills.length=0;g.step(1);drawGame(ctx,images,g,true);
    expect(calls('smoke')).toHaveLength(0);
    expect(fills).not.toContain('rgba(22,16,14,.58)');
    expect(g.board.cannons.every(c=>c.state===EMPTY&&!c.fouled)).toBe(true);
  });
});

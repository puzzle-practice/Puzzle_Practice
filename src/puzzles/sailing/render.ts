import type { Images } from '../../core/assets';
import { EMPTY, WIDTH, HEIGHT, colour, bonus, shape, targetCells } from './board';
import { SailingGame, pairCells } from './game';
import { cascadeDuration } from './timing';
import { clearPiece, clearSparks, fadeOpacity } from './animation';

export const CELL=34, LEFT=88, TOP=42;
export type SailingImages=Pick<Images,'get'>;
export function drawPiece(ctx:CanvasRenderingContext2D,images:SailingImages,p:number,x:number,y:number,tile?:number,alpha=1):void {
  if(p===EMPTY)return;
  ctx.save();ctx.globalAlpha=alpha;
  ctx.drawImage(images.get(`piece_${['rope','water','wind'][colour(p)]}`),(tile??p%8)*CELL,0,CELL,CELL,x,y,CELL,CELL);
  const token=bonus(p);
  if(token)ctx.drawImage(images.get('bonus'),token*CELL,0,CELL,CELL,x,y,CELL,CELL);
  ctx.restore();
}

export function drawBoard(ctx:CanvasRenderingContext2D,images:SailingImages,game:SailingGame,showLanding=false):void {
  const scene=game.scenes[0]??game.snapshot();
  const falling=new Map(scene.falls?.map(f=>[f.y*WIDTH+f.x,f]));
  const destinations=new Map(scene.falls?.map(f=>[f.to*WIDTH+f.x,f]));
  const piece=(p:number,x:number,y:number,tile?:number,alpha=1)=>drawPiece(ctx,images,p,x,y,tile,alpha);
  ctx.save();ctx.beginPath();ctx.rect(LEFT,TOP,WIDTH*CELL,HEIGHT*CELL);ctx.clip();
  for(const t of scene.targets.filter(t=>t.enabled)){
    const width=shape(t)[0].length;
    for(let x=0;x<width;x++)ctx.drawImage(images.get('platform'),(x===0?0:x===width-1?2:1)*CELL,0,CELL,4,LEFT+(t.x+x)*CELL,TOP+(t.y+1)*CELL-1,CELL,4);
  }
  if(showLanding&&game.active&&!game.scenes.length)for(const c of game.landing())piece(c.piece,LEFT+c.x*CELL,TOP+c.y*CELL,undefined,0.22);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const p=scene.cells[y*WIDTH+x],fall=falling.get(y*WIDTH+x);
    const progress=fall?Math.min(1,game.sceneElapsed/cascadeDuration(fall.to-fall.y)):0;
    piece(p,LEFT+x*CELL,TOP+(fall?y+(fall.to-y)*progress:y)*CELL);
  }
  for(const c of scene.cleared??[])piece(clearPiece(c.piece,scene.kind==='platform'),LEFT+c.x*CELL,TOP+c.y*CELL,undefined,fadeOpacity(game.sceneElapsed));
  for(const t of scene.targets.filter(t=>t.enabled))for(const c of targetCells(t)){
    const index=c.y*WIDTH+c.x,arrival=destinations.get(index);
    if(arrival&&game.sceneElapsed<cascadeDuration(arrival.to-arrival.y))continue;
    const p=arrival?.piece??(falling.has(index)?EMPTY:scene.cells[index]);
    piece(c.piece|(bonus(p)<<5),LEFT+c.x*CELL,TOP+c.y*CELL,colour(p)===colour(c.piece)?7:6);
  }
  if(game.active&&!game.scenes.length)for(const c of pairCells(game.active))piece(c.piece,LEFT+c.x*CELL,TOP+c.y*CELL+Math.trunc(Math.fround(game.active.fraction*CELL)));
  for(const effect of game.effects)for(const spark of clearSparks(effect)){
    ctx.save();ctx.globalAlpha=spark.alpha;
    ctx.drawImage(images.get(`glow_${['rope','water','wind'][colour(spark.piece)]}`),LEFT+spark.x,TOP+spark.y);
    ctx.restore();
  }
  ctx.restore();
}

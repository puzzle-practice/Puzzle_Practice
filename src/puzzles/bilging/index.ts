import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { drawGameText, drawPauseLabel, floatAt, gameFont, gameFontFor, loadGameFont, TEXT_WHITE } from '../../core/game-text';
import { SoundBank } from '../../core/audio';
import { SessionPause } from '../../core/pause';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import { historyGroup } from '../../core/history';
import { dutyDesk } from '../../core/duty/desk';
import { LEARNING } from '../../core/duty/ratings';
import { keyMatches } from '../../core/controls';
import { copyText, pasteText } from '../../core/clipboard';
import type { InputEvent, Point } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import { BONUS_NAMES, BONUS_SETS, HEIGHT, LEVEL_POINTS, WIDTH } from './board';
import {
  BilgingGame, DEFAULT_SETTINGS, PAINTABLE, WATER_LEVELS, boardCode, boardIssues, indicatorStep, readBoardCode, readSettings, settingsKey, withToken,
  type BilgingSettings, type Mode, type Scene,
} from './game';
import { drawBoard, drawPiece, drawToken, CELL, LEFT, TOP } from './render';

const TOKENS=[{value:0,label:'Off'},{value:1,label:'Normal shapes'},{value:2,label:'Normal shapes + blades'}];
const DIFFICULTIES=Array.from({length:10},(_,value)=>({value,label:`${value} · ${value+1} ${value?'stars':'star'}`}));
const WATER=WATER_LEVELS.map(value=>({value,label:`${value} rows`}));
const TIMER=[{value:0,label:'No timer'},{value:120000,label:'2 minutes'},{value:300000,label:'5 minutes'},{value:600000,label:'10 minutes'}];
const MODES:{value:Mode,label:string}[]=[{value:'normal',label:'Normal'},{value:'create',label:'Freeplay'}];
const PIECE_NAMES=['Colour 1','Colour 2','Colour 3','Colour 4','Colour 5','Colour 6','Colour 7','Puffer','Crab','Jellyfish'];
/** Freeplay mode paints with keys 1–7 (the colours), 8 (puffer), 9 (crab) and 0 (jellyfish) held over the board. */
const PAINT_KEYS=['1','2','3','4','5','6','7','8','9','0'].map((key,i)=>({id:`paint${i+1}`,label:`Paint ${PIECE_NAMES[i].toLowerCase()} (Freeplay)`,defaultKey:key,piece:PAINTABLE[i]}));
/** Token halves Freeplay can add to a colour: each shape's lower and upper half. */
const TOKEN_HALVES=[{value:0,label:'None'},...BONUS_SETS[2].flatMap(shape=>[0,1].map(upper=>({value:shape*2+upper,label:`${BONUS_NAMES[shape]}, ${upper?'upper':'lower'} half`})))];
const KEYS=[{id:'left',label:'Cursor left',defaultKey:'arrowleft'},{id:'right',label:'Cursor right',defaultKey:'arrowright'},
  {id:'up',label:'Cursor up',defaultKey:'arrowup'},{id:'down',label:'Cursor down',defaultKey:'arrowdown'},
  {id:'swap',label:'Swap pieces',defaultKey:'space'},{id:'pause',label:'Pause',defaultKey:'escape'},
  ...PAINT_KEYS.map(({id,label,defaultKey})=>({id,label,defaultKey}))];
const MOVES:Record<string,[number,number]>={left:[-1,0],right:[1,0],up:[0,1],down:[0,-1]};
/** The game's sound names and the recordings each one plays. */
const SOUNDS:Record<string,string[]>={
  piece_swap:['piece_swap','piece_swap2','piece_swap3'],piece_land:['piece_land','piece_land2'],
  piece_destroy:['piece_land'],piece_destroy_arrr:['piece_destroy_bingo'],piece_destroy_bingo:['piece_destroy_bingo'],
  piece_destroy_bonus:['piece_destroy_bonus'],piece_destroy_good:['piece_destroy_arrr'],piece_destroy_great:['piece_destroy_yarrr'],
  piece_destroy_har:['piece_destroy_sea_donkey'],piece_destroy_sea_donkey:['piece_destroy_sea_donkey'],piece_destroy_super:['piece_destroy_super'],
  piece_destroy_vegas:['piece_destroy_vegas'],piece_destroy_yarrr:['piece_destroy_vegas'],
};
const validSeed=(s:unknown):s is number=>Number.isInteger(s)&&Number(s)>=0&&Number(s)<=0xffffffff;
const onBoard=([x,y]:Point)=>x>=LEFT&&y>=TOP&&x<LEFT+WIDTH*CELL&&y<TOP+HEIGHT*CELL;
const boardCell=([x,y]:Point)=>({x:Math.floor((x-LEFT-CELL/2)/CELL),y:HEIGHT-1-Math.floor((y-TOP)/CELL)});
/** The single space under the pointer, for painting (the cursor covers two). */
const paintCell=([x,y]:Point)=>({x:Math.floor((x-LEFT)/CELL),y:HEIGHT-1-Math.floor((y-TOP)/CELL)});

export default (async ({screen,input,panel,store,ticks:rawTicks,setReplayTime:rawReplayTime}) => {
  const pause=new SessionPause(rawTicks,rawReplayTime), {ticks,setReplayTime}=pause;
  const [images]=await Promise.all([Images.load(import.meta.glob<string>('./media/*.png',{eager:true,query:'?url',import:'default'})),loadGameFont()]);
  let replays!: ReplayRecorder;
  const sounds=new SoundBank(import.meta.glob<string>('./sounds/*.mp3',{eager:true,query:'?url',import:'default'}),()=>replays?.isSeeking??false);
  let settings=readSettings(store.get('settings',DEFAULT_SETTINGS))??{...DEFAULT_SETTINGS};
  let liveSettings={...settings}, savedSettings:BilgingSettings|null=null;
  let game=new BilgingGame(settings,42), running=false, finished=false;
  let startAt=0,endAt=0,lastAt=0,soundTurn=0;
  let commands:string[]=[], held=new Set<string>(), repeats=new Map<string,number>();
  let altArt=store.get('altArt',false), lastMouse:Point=[-1,-1];
  let lastScene:Scene|null=null, callout:{label:string,points?:number,at:number}|null=null;
  /** Freeplay mode: the palette piece a left click places, the piece a held key paints, and the token half added to colours. */
  let palettePiece:number|null=null, paintWith:number|null=null, paintToken=0, painting=false, pasteNote='';
  const ctx=screen.ctx;
  const duty=dutyDesk(panel,store,'bilging','Bilging',[]);
  const busy=()=>running||(replays?.isPlaying??false);
  const elapsed=()=>Math.max(0,(running?ticks():endAt)-startAt);
  const save=()=>store.set('settings',settings);
  const history=()=>store.history(settingsKey(settings));
  const queue=(action:string)=>{if(running&&!pause.paused&&!replays.isPlaying)commands.push(action);};
  const resetInput=()=>{held.clear();repeats.clear();};
  const key=(name:string,id:string,fallback:string)=>keyMatches(name,'bilging',id,fallback);
  const play=(name:string)=>{const files=SOUNDS[name]??[name];sounds.play(files[soundTurn++%files.length]);};
  const creating=()=>running&&liveSettings.mode==='create';
  const timerMs=()=>liveSettings.mode==='create'?0:liveSettings.timerMs;
  const withHalf=(piece:number)=>withToken(piece,paintToken>>1,paintToken&1);
  /** Paints the space under the pointer, recording only real changes. */
  const paintAt=(pos:Point,piece:number)=>{if(!onBoard(pos))return;const c=paintCell(pos);if(game.board.get(c.x,c.y)!==piece)queue(`paint:${c.x},${c.y},${piece}`);};
  /** Freeplay records every move as a command, so painting and swapping replay in order; Normal replays its input. */
  const live=(id:string)=>{if(liveSettings.mode==='create')queue(id);else action(id);};

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed=seedMode.next()):void { seedMode.remember(seed);
    pause.resume(); liveSettings={...settings}; game=new BilgingGame(liveSettings,seed);
    running=true;finished=false;startAt=endAt=lastAt=ticks(); duty.clear(); resetInput();commands=[];
    lastScene=null;callout=null;paintWith=null;painting=false;pasteNote='';
    replays.begin(liveSettings,seed); play('fanfare');
  }
  function end(reason:string):void {
    if(!running)return;
    game.settle();
    running=false;finished=true;endAt=ticks();resetInput();commands=[];
    const report=duty.end({mode:liveSettings.mode==='create'?'Freeplay':liveSettings.tokens?'Token practice':'Normal',performance:LEARNING,
      score:{label:'Points / swap',value:game.efficiency.toFixed(2)}});
    const tape=replays.finish(`${reason} · ${game.efficiency.toFixed(2)} points/swap`,report);
    // Freeplay is a sandbox and keeps no history.
    if(!replays.isPlaying&&liveSettings.mode!=='create')store.addHistory(settingsKey(liveSettings),{
      score:game.efficiency,points:game.points,moves:game.moves,levels:game.levels,crabs:game.crabs,
      chain:game.longestChain,tokens:game.tokens,seconds:elapsed()/1000,...duty.fields(report),
      ...(tape?{replayAt:tape.at,replayId:tape.runId??''}:{})});
  }
  function action(id:string):void {
    if(!running||pause.paused)return;
    const move=MOVES[id];
    if(move)game.moveCursor(...move);
    if(id==='swap'){const result=game.swap();if(result==='crab')play('crab_angry');}
    if(id.startsWith('at:')){const [x,y]=id.slice(3).split(',').map(Number);game.pointAt(x,y);}
    if(id.startsWith('paint:')){const [x,y,piece]=id.slice(6).split(',').map(Number);game.paint(x,y,piece);}
    if(id.startsWith('fill:'))game.fill(Number(id.slice(5)));
    if(id.startsWith('load:'))game.load(id.slice(5));
    if(id==='generate')game.generate();
  }
  /** Outlined text from its top: the game font at 24px and up, bold Dialog below. */
  function text(value:string,x:number,y:number,size=14,fill='#fff6d4',center=false,alpha?:number):void {
    drawGameText(ctx,value,x,y,{px:size,family:size>=24?'game':'dialog',bold:true,fill,align:center?'center':'left',alpha});
  }
  function draw(now:number):void {
    screen.blit(images.get('background'),0,0);
    drawBoard(ctx,images,game,running&&!pause.paused,altArt);
    const performance=indicatorStep(game.performance.value,liveSettings.indicatorMax);
    const level=Math.round(performance/20*6);
    const frame=performance?Math.floor(now/(1000/(20*performance/20)))%7:0;
    ctx.drawImage(images.get(`feedback${level}`),frame*43,0,43,43,383,544,43,43);
    // Progress toward the level-up, drawn where the game keeps its stars meter.
    const target=LEVEL_POINTS[liveSettings.difficulty], filled=Math.min(1,Math.max(0,game.levelPoints)/target);
    ctx.fillStyle='rgba(16,36,58,.75)';ctx.fillRect(18,380,62,14);
    ctx.fillStyle='#ffd34d';ctx.fillRect(20,382,58*filled,10);
    text(`D${liveSettings.difficulty}`,20,360,14);
    if(liveSettings.tokens){
      text('Tokens',405,70,12,'#fff3b1',true);
      BONUS_SETS[liveSettings.tokens].forEach((token,i)=>{
        const y=92+i*59;
        ctx.drawImage(images.get('bonus_background'),0,0,60,50,382,y,46,38);
        drawToken(ctx,images,token,389,y+3,32);
        text(String(game.tokenCounts[token]),405,y+38,12,'#fff3b1',true);
      });
    }
    if(callout&&now-callout.at<1500){
      // Popups float 30px up over 1500 ms; level-up is 42px, the rest grow with their points.
      const {dy,alpha}=floatAt(now-callout.at);
      const px=callout.points===undefined?gameFont(3):gameFontFor(callout.points,100);
      text(callout.label,224,250+dy,px,TEXT_WHITE,true,alpha);
      if(callout.points)text(`+${callout.points}`,224,250+dy+px+4,24,'#ffec9b',true,alpha);
    }
    if(!running&&!finished){ctx.fillStyle='rgba(10,22,36,.55)';ctx.fillRect(LEFT,TOP,WIDTH*CELL,HEIGHT*CELL);const box=drawPauseLabel(ctx,'Ready to pump',224,250,WIDTH*CELL);text(settings.mode==='create'?'Start, then paint any board':'Press Start to begin',224,box.y+box.h+6,18,'#fff3b1',true);}
    if(pause.paused){ctx.fillStyle='rgba(8,18,30,.65)';ctx.fillRect(LEFT,TOP,WIDTH*CELL,HEIGHT*CELL);drawPauseLabel(ctx,'Paused',224,TOP+HEIGHT*CELL/2,WIDTH*CELL);}
  }
  function sceneStarted(scene:Scene,now:number):void {
    if(scene.sound)play(scene.sound);
    if(scene.kind==='level'){callout={label:scene.label!,at:now};return;}
    if(scene.label||scene.points)callout={label:scene.label??'',points:scene.points,at:now};
  }
  function frame(events:InputEvent[]):void {
    const resumed=pause.input(events,'bilging',running);
    if(!resumed){resetInput();draw(ticks());return;}
    const liveCommands=replays.isPlaying?[]:commands.splice(0);
    for(const command of liveCommands)replays.command(command);
    const routed=replays.frame(resumed,input.mouse,ticks());
    if(routed.renderOnly){draw(ticks());return;}
    const now=ticks(), delta=Math.max(0,now-lastAt);lastAt=now;
    if(running){
      game.performance.advance(elapsed());
      game.step(delta);
      for(const command of [...liveCommands,...routed.commands])action(command);
      // A Freeplay replay is all commands, so its recorded input is not applied again.
      if(!(liveSettings.mode==='create'&&replays.isPlaying))handleInput(routed.events,routed.mouse,now);
      const scene=game.scenes[0]??null;
      if(scene!==lastScene){if(scene)sceneStarted(scene,now);lastScene=scene;}
      if(timerMs()&&elapsed()>=timerMs())end('Time up');
    }
    if(!replays.isSeeking&&!replays.isAdvancing)draw(now);
  }

  function handleInput(events:InputEvent[],mouse:Point,now:number):void {
    const moved=mouse[0]!==lastMouse[0]||mouse[1]!==lastMouse[1];
    if(creating()&&moved){
      if(paintWith!==null)paintAt(mouse,withHalf(paintWith));
      else if(painting&&palettePiece!==null)paintAt(mouse,withHalf(palettePiece));
    }
    if(moved&&onBoard(mouse)){const c=boardCell(mouse);if(c.x!==game.cursor.x||c.y!==game.cursor.y)live(`at:${c.x},${c.y}`);}
    lastMouse=[mouse[0],mouse[1]];
    for(const event of events){
      if(creating()&&event.type==='mousedown'&&event.button===1&&palettePiece!==null){paintAt(event.pos,withHalf(palettePiece));painting=true;continue;}
      if(creating()&&event.type==='mouseup'&&event.button===1&&painting){painting=false;continue;}
      if(creating()&&event.type==='mousedown'&&(event.button===4||event.button===5)){
        // The wheel cycles the piece under the pointer.
        if(onBoard(event.pos)){
          const c=paintCell(event.pos),i=PAINTABLE.indexOf(game.board.get(c.x,c.y)&15),step=event.button===4?1:-1;
          queue(`paint:${c.x},${c.y},${PAINTABLE[(i+step+PAINTABLE.length)%PAINTABLE.length]}`);
        }
        continue;
      }
      if(event.type==='mousedown'&&event.button===1&&onBoard(event.pos)){
        const c=boardCell(event.pos);live(`at:${c.x},${c.y}`);live('swap');continue;
      }
      if(event.type!=='keydown'&&event.type!=='keyup')continue;
      const paint=PAINT_KEYS.find(p=>key(event.key,p.id,p.defaultKey));
      if(paint){
        if(!creating())continue;
        if(event.type==='keydown'){paintWith=paint.piece;paintAt(mouse,withHalf(paint.piece));}
        else if(paintWith===paint.piece)paintWith=null;
        continue;
      }
      for(const binding of KEYS){
        if(binding.id==='pause'||binding.id.startsWith('paint')||!key(event.key,binding.id,binding.defaultKey))continue;
        if(event.type==='keydown'){held.add(binding.id);repeats.set(binding.id,now+150);live(binding.id);}
        else{held.delete(binding.id);repeats.delete(binding.id);}
      }
    }
    for(const id of Object.keys(MOVES))if(held.has(id)&&now>=(repeats.get(id)??Infinity)){live(id);repeats.set(id,now+75);}
  }

  panel.clock(()=>running||finished?{label:timerMs()?'Time left':'Time',ms:timerMs()?Math.max(0,timerMs()-elapsed()):elapsed(),countdown:!!timerMs()}:null);
  const session=panel.session();
  session.select('Mode',MODES,()=>settings.mode,value=>{settings.mode=value;save();preview();},{disabled:busy});
  session.button('Start',()=>{if(replays.isPlaying)replays.stop();if(running)end('Stopped');else start();},{variant:'primary',label:()=>running&&!replays.isPlaying?'Stop':'Start'});
  pause.install(panel,()=>running&&!replays.isPlaying);
  panel.score().stats(['','Now'],()=>[['Points / swap',game.efficiency.toFixed(2)]]);
  const tokenStats=panel.group('Maneuver practice',{hidden:()=>!settings.tokens});
  tokenStats.stats(['Shape','Completed'],()=>BONUS_SETS[liveSettings.tokens].map(token=>[BONUS_NAMES[token],String(game.tokenCounts[token])]));
  tokenStats.hint(()=>'A token counts when its lower half sits directly beneath its matching upper half. These count your contribution; a ship maneuver also needs the other duty stations.');
  const disabled=()=>!running||pause.paused||replays.isPlaying;
  panel.controlSettings.group('Cursor').button('←',()=>queue('left'),{disabled}).button('↑',()=>queue('up'),{disabled}).button('↓',()=>queue('down'),{disabled}).button('→',()=>queue('right'),{disabled});
  panel.controlSettings.group().button('Swap',()=>queue('swap'),{disabled:()=>disabled()||game.busy});
  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly=()=>settings.mode!=='create';
  const editing=()=>!creating()||pause.paused||replays.isPlaying||game.busy;
  const boardGroup=panel.group('Board');
  boardGroup.button('Copy',()=>copyText(boardCode(game.board),'Copy this board:'),{title:'Copy the board'});
  boardGroup.button('Paste',()=>void pasteText('Paste a board:').then(text=>{
    if(text===null)return;
    if(readBoardCode(text)){pasteNote='';queue(`load:${text.trim()}`);}
    else pasteNote='That isn’t a bilging board. Boards copied here start with B.';
  }),{hidden:createOnly,disabled:editing,title:'Play a board from a pasted copy'});
  boardGroup.button('Generate',()=>{queue('generate');window.setTimeout(()=>copyText(boardCode(game.board),'Copy this board:'),50);},
    {hidden:createOnly,disabled:editing,title:'Deal a new board and copy it'});
  const palette=document.createElement('div');
  palette.className='piece-palette';
  PAINTABLE.forEach((piece,i)=>{
    const button=document.createElement('button');
    button.type='button';button.className='panel-button';
    const icon=document.createElement('canvas');
    icon.width=icon.height=CELL;icon.setAttribute('aria-hidden','true');
    const iconCtx=icon.getContext('2d')!;
    let iconArt:boolean|null=null;
    button.append(icon,document.createTextNode(`${(i+1)%10} · ${PIECE_NAMES[i]}`));
    button.addEventListener('click',()=>{palettePiece=palettePiece===piece?null:piece;panel.used();});
    panel.addSync(()=>{
      button.disabled=!creating();button.setAttribute('aria-pressed',String(palettePiece===piece));
      if(iconArt!==altArt){iconArt=altArt;iconCtx.clearRect(0,0,CELL,CELL);drawPiece(iconCtx,images,piece,0,0,1,altArt);}
    });
    palette.append(button);
  });
  boardGroup.append(palette,{hidden:createOnly});
  boardGroup.select('Token on colours',TOKEN_HALVES,()=>paintToken,value=>{paintToken=value;},{hidden:createOnly});
  boardGroup.button('Fill board',()=>queue(`fill:${withHalf(palettePiece??0)}`),{hidden:createOnly,disabled:editing,title:'Make every space the selected piece'});
  boardGroup.note(()=>pasteNote||'Hold 1–7 for a colour, 8 for a puffer, 9 for a crab or 0 for a jellyfish to paint, or select a piece above and left-click to place it. Select it again to deselect and swap. Scroll to cycle the piece under the pointer. Freeplay never levels up or ends by itself, and keeps no history.',{hidden:createOnly});
  boardGroup.note(()=>{const issues=boardIssues(game.board,liveSettings);return issues.length?`Not a board the game could deal: ${issues.join(' ')}`:'This board could come up in the game at these settings.';},{hidden:()=>createOnly()||!running});
  const options=panel.settings.group('Game');
  options.select('Difficulty',DIFFICULTIES,()=>settings.difficulty,value=>{settings.difficulty=value;save();preview();},{disabled:busy});
  options.select('Tokens',TOKENS,()=>settings.tokens,value=>{settings.tokens=value;save();preview();},{disabled:busy});
  options.select('Water level',WATER,()=>settings.water,value=>{settings.water=value;save();preview();},{disabled:busy});
  options.select('Timer (Normal)',TIMER,()=>settings.timerMs,value=>{settings.timerMs=value;save();},{disabled:busy});
  options.toggle('Alternate piece art',()=>altArt,on=>{altArt=on;store.set('altArt',on);});
  options.hint(()=>'Water level is set by the ship’s damage in the game: crabs leave once they float above it and pay 5 points per flooded row, and swaps above the water are quicker. Difficulty stays at your selected level after each level-up. Token practice gives a fifth of the coloured pieces a token half from the game’s selected pool.');
  const approximations=panel.settings.group('Approximations');
  approximations.number('Top indicator threshold (approx.)',()=>settings.indicatorMax,value=>{settings.indicatorMax=value;save();preview();},{min:1,max:1000,step:0.01,disabled:busy});
  approximations.hint(()=>'The indicator uses the game’s default threshold curve (top 8.4 points/swap), which may differ from live play. Reports use Learning until live ratings are verified. Token availability is forced for practice; ship maneuver conversion is not simulated.');
  panel.controls('bilging',KEYS);
  historyGroup(panel,history,[{label:'Points / swap',value:g=>g.score.toFixed(2)},{label:'Chain',value:g=>String(g.chain)},{label:'Tokens',value:g=>String(g.tokens)}],'Past games',{
    available:g=>typeof g.replayAt==='number'&&(replays?.hasPlayableAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined)??false),
    play:g=>{if(typeof g.replayAt==='number')void replays.playAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined);},
  });
  panel.results(()=>finished&&!running?{title:'Bilging results',report:duty.last,rows:[
    ['Points / swap',game.efficiency.toFixed(2)],['Points',String(game.points)],['Swaps',String(game.moves)],
    ['Levels',String(game.levels)],['Crabs',String(game.crabs)],['Longest chain',String(game.longestChain)],['Tokens',String(game.tokens)],
  ]}:null);
  const codec:ReplaySettingsCodec={currentVersion:1,simulatorVersion:1,migrate:(version,value)=>version===1?readSettings(value):null};
  replays=new ReplayRecorder('bilging',store,panel,ticks,tape=>{
    savedSettings??={...settings};settings=readSettings(tape.settings)!;start(tape.seed as number);
  },()=>{
    running=false;finished=false;resetInput();commands=[];duty.clear();
    if(savedSettings){settings=savedSettings;savedSettings=null;}preview();
  },validSeed,setReplayTime,()=>frame([]),codec,()=>!running||replays.isPlaying);
  replays.setStopLive(()=>{if(running)end('Stopped');});
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver=()=>{savedSettings=null;};
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint=()=>stateText(game,running,finished,startAt,endAt,lastMouse,[...held],[...repeats]);
  function preview():void {if(!running){liveSettings={...settings};game=new BilgingGame(settings,42);finished=false;}}
  const blur=()=>{resetInput();if(running&&!replays.isPlaying&&!pause.paused)pause.toggle();};
  window.addEventListener('blur',blur);
  return {frame,dispose:()=>{if(running)end('Stopped');window.removeEventListener('blur',blur);replays.dispose();sounds.dispose();}};
}) satisfies PuzzleFactory;

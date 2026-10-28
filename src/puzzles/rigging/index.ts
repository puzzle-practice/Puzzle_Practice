import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { drawGameText, drawPauseLabel, floatAt, gameLineHeight, loadGameFont, FLOAT_MS, TEXT_WHITE } from '../../core/game-text';
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
import { BONUS_NAMES, BONUS_SETS, SKIPS_FOR_PENALTY } from './board';
import {
  DEFAULT_SETTINGS, DRAG_START, PAINTABLE, RiggingGame, boardCode, cellAt, dragAxis, indicatorStep, projection, readBoardCode, readSettings, repaint, reshape,
  settingsKey, slideFor, type Mode, type RiggingSettings, type Scene,
} from './game';
import { PIECE, drawActivated, drawBoard, drawCoils, drawPiece } from './render';

const TOKENS=[{value:0,label:'Off'},{value:1,label:'4 Tokens'},{value:2,label:'5 Tokens'}];
const DIFFICULTIES=Array.from({length:10},(_,value)=>({value,label:`${value} · ${value+1} ${value?'stars':'star'}`}));
const TIMER=[{value:0,label:'No timer'},{value:120000,label:'2 minutes'},{value:300000,label:'5 minutes'},{value:600000,label:'10 minutes'}];
const DIR:Record<string,number>={nw:2,ne:4,w:1,e:5,sw:0,se:6};
const MODES:{value:Mode,label:string}[]=[{value:'normal',label:'Normal'},{value:'create',label:'Freeplay'}];
const PIECE_NAMES=['Orange','Yellow','Black','Purple','Cyan','White','Blue','Tan','Wild','Tar','Gaff','Splice ↔','Splice ↗','Splice ↘'];
/** Freeplay mode paints with keys 1–8 (the colours), 9 (wild) and 0 (tar) held over the board. */
const PAINT_KEYS=['1','2','3','4','5','6','7','8','9','0'].map((key,i)=>({id:`paint${i+1}`,label:`Paint ${PIECE_NAMES[i].toLowerCase()} (Freeplay)`,defaultKey:key,piece:PAINTABLE[i]}));
const PULLEY_NAMES=['Top','Upper right','Lower right','Bottom','Lower left','Upper left'];
const BOOCHING=Array.from({length:SKIPS_FOR_PENALTY},(_,value)=>({value,label:String(value)}));
const SHAPES=[{value:0,label:'No token'},...[1,2,3,4,7].map(value=>({value,label:BONUS_NAMES[value]}))];
/** The game's keys: W E A D Z X move the cursor (or nudge a selected rope), S selects and lets go, Space cancels. */
const KEYS=[{id:'nw',label:'Up-left',defaultKey:'w'},{id:'ne',label:'Up-right',defaultKey:'e'},{id:'w',label:'Left',defaultKey:'a'},
  {id:'e',label:'Right',defaultKey:'d'},{id:'sw',label:'Down-left',defaultKey:'z'},{id:'se',label:'Down-right',defaultKey:'x'},
  {id:'select',label:'Select / slide',defaultKey:'s'},{id:'cancel',label:'Cancel slide',defaultKey:'space'},{id:'pause',label:'Pause',defaultKey:'escape'},
  ...PAINT_KEYS.map(({id,label,defaultKey})=>({id,label,defaultKey}))];
const ROPE_SOUNDS=['rope_1','rope_2','rope_3','rope_4','rope_5'];
const validSeed=(s:unknown):s is number=>Number.isInteger(s)&&Number(s)>=0&&Number(s)<=0xffffffff;

export default (async ({screen,input,panel,store,ticks:rawTicks,setReplayTime:rawReplayTime}) => {
  const pause=new SessionPause(rawTicks,rawReplayTime), {ticks,setReplayTime}=pause;
  const [images]=await Promise.all([Images.load(import.meta.glob<string>('./media/*.png',{eager:true,query:'?url',import:'default'})),loadGameFont()]);
  let replays!: ReplayRecorder;
  const sounds=new SoundBank(import.meta.glob<string>('./sounds/*.mp3',{eager:true,query:'?url',import:'default'}),()=>replays?.isSeeking??false);
  let settings=readSettings(store.get('settings',DEFAULT_SETTINGS))??{...DEFAULT_SETTINGS};
  let liveSettings={...settings}, savedSettings:RiggingSettings|null=null;
  let game=new RiggingGame(settings,42), running=false, finished=false;
  let startAt=0,endAt=0,lastAt=0,glowSince=0,lastPulley=-1,nextRope=0;
  let commands:string[]=[], held=new Set<string>(), repeats=new Map<string,number>();
  let drag:{at:{x:number,y:number},from:Point,axis:number}|null=null, lastMouse:Point=[-1,-1];
  let lastScene:Scene|null=null, callouts:{text:string,size:number,at:[number,number],from:number}[]=[];
  /** Freeplay mode: the palette piece or token a left click paints, and the piece a held key paints. */
  let palettePiece:number|null=null, paletteShape:number|null=null, paintWith:number|null=null, painting=false, pasteNote='';
  const ctx=screen.ctx;
  const duty=dutyDesk(panel,store,'rigging','Rigging',[]);
  const busy=()=>running||(replays?.isPlaying??false);
  const elapsed=()=>Math.max(0,(running?ticks():endAt)-startAt);
  const save=()=>store.set('settings',settings);
  const history=()=>store.history(settingsKey(settings));
  const queue=(action:string)=>{if(running&&!pause.paused&&!replays.isPlaying)commands.push(action);};
  const resetInput=()=>{held.clear();repeats.clear();drag=null;};
  const key=(name:string,id:string,fallback:string)=>keyMatches(name,'rigging',id,fallback);
  const play=(name:string)=>sounds.play(name);
  const creating=()=>running&&liveSettings.mode==='create';
  const timerMs=()=>liveSettings.mode==='create'?0:liveSettings.timerMs;
  /** Paints the space under the pointer, recording only real changes. Pieces keep their token; tokens keep their piece. */
  const paintAt=(pos:Point,next:(old:number)=>number)=>{const c=cellAt(pos[0],pos[1]);if(!c)return;const old=game.board.get(c),piece=next(old);if(old!==piece)queue(`paint:${c.x},${c.y},${piece}`);};
  const pieceBrush=(piece:number)=>(old:number)=>repaint(old,piece);
  const paletteBrush=()=>palettePiece!==null?pieceBrush(palettePiece):paletteShape!==null?(old:number)=>reshape(old,paletteShape!):null;
  const rope=()=>{play(ROPE_SOUNDS[Math.floor(Math.random()*ROPE_SOUNDS.length)]);nextRope=ticks()+1000+Math.random()*1000;};

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed=seedMode.next()):void { seedMode.remember(seed);
    pause.resume(); liveSettings={...settings}; game=new RiggingGame(liveSettings,seed);
    running=true;finished=false;startAt=endAt=lastAt=glowSince=ticks(); duty.clear(); resetInput();commands=[];
    lastScene=null;callouts=[];lastPulley=-1;paintWith=null;painting=false;pasteNote='';
    replays.begin(liveSettings,seed); play('intro');
  }
  function end(reason:string):void {
    if(!running)return;
    game.settle();
    running=false;finished=true;endAt=ticks();resetInput();commands=[];
    const report=duty.end({mode:liveSettings.mode==='create'?'Freeplay':liveSettings.tokens?'Token practice':'Normal',performance:LEARNING,
      score:{label:'Points / slide',value:game.efficiency.toFixed(2)}});
    const tape=replays.finish(`${reason} · ${game.efficiency.toFixed(2)} points/slide`,report);
    // Freeplay is a sandbox and keeps no history.
    if(!replays.isPlaying&&liveSettings.mode!=='create')store.addHistory(settingsKey(liveSettings),{
      score:game.efficiency,points:game.points,moves:game.moves,levels:game.levels,pieces:game.pieces,
      biggest:game.biggestPull,maneuvers:game.maneuvers,seconds:elapsed()/1000,...duty.fields(report),
      ...(tape?{replayAt:tape.at,replayId:tape.runId??''}:{})});
  }
  /** Every change to the game goes through a recorded command, so replays repeat it exactly. */
  function action(id:string):void {
    if(!running||pause.paused)return;
    const before=game.moves, coils=game.board.cache, skips=game.board.skipsRemaining;
    if(id in DIR)game.key(DIR[id]);
    else if(id==='select'){if(!game.selecting&&!game.busy)rope();game.select();}
    else if(id==='cancel')game.cancel();
    else if(id.startsWith('at:')){const [x,y]=id.slice(3).split(',').map(Number);game.pointAt({x,y});}
    else if(id.startsWith('slide:')){const [x,y,dir,amount]=id.slice(6).split(',').map(Number);game.slide(x,y,dir,amount);}
    else if(id.startsWith('paint:')){const [x,y,piece]=id.slice(6).split(',').map(Number);game.paint({x,y},piece);}
    else if(id.startsWith('fill:'))game.fill(Number(id.slice(5)));
    else if(id.startsWith('load:'))game.load(id.slice(5));
    else if(id==='generate')game.generate();
    else if(id==='pulley')game.nextPulley();
    else if(id.startsWith('pulley:'))game.setPulley(Number(id.slice(7)));
    else if(id.startsWith('booch:'))game.setBooching(Number(id.slice(6)));
    if(game.moves>before&&game.lastMove?.skipped){
      if(game.board.cache<coils)play('cache_penalty');
      else if(game.board.skipsRemaining<=1&&skips>1&&game.board.cache>0)play('cache_penalty_warning');
    }
  }
  /** Outlined text from its middle: the game font at 24px and up, bold Dialog below. */
  function text(value:string,x:number,y:number,size=14,fill='#fff6d4',center=false,alpha?:number):void {
    drawGameText(ctx,value,x,y-Math.trunc(gameLineHeight({px:size,family:size>=24?'game':'dialog'})/2),{px:size,family:size>=24?'game':'dialog',bold:true,fill,align:center?'center':'left',alpha});
  }
  function draw(now:number):void {
    screen.blit(images.get('background'),0,0);
    const live=running&&!pause.paused;
    if(!game.busy&&game.board.nextPulley!==lastPulley){lastPulley=game.board.nextPulley;glowSince=now;}
    drawBoard(ctx,images,game,live,now,glowSince);
    if(!game.busy&&game.board.potential.size)drawActivated(ctx,images,[...game.board.potential].sort(),game.board.nextPulley);
    drawCoils(ctx,images,game,live&&!game.busy&&game.board.skipsRemaining<=1&&game.board.cache>0,now);
    ctx.drawImage(images.get('title'),158,8);
    const performance=indicatorStep(game.performance.value,liveSettings.indicatorMax);
    const level=Math.round(performance/20*6);
    const frame=performance?Math.floor(now/(1000/(20*performance/20)))%7:0;
    ctx.drawImage(images.get(`feedback${level}`),frame*42,0,42,42,400,10,42,42);
    // Progress toward the level-up: pieces pulled against the level's target.
    const filled=Math.min(1,game.levelPieces/game.levelTarget);
    ctx.fillStyle='rgba(16,36,58,.75)';ctx.fillRect(356,540,72,12);
    ctx.fillStyle='#ffd34d';ctx.fillRect(358,542,68*filled,8);
    text(`D${liveSettings.difficulty}`,358,528,14);
    callouts=callouts.filter(c=>now-c.from<FLOAT_MS);
    for(const c of callouts){
      const {dy,alpha}=floatAt(now-c.from);
      text(c.text,c.at[0],c.at[1]+dy,c.size,TEXT_WHITE,true,alpha);
    }
    if(!running&&!finished){ctx.fillStyle='rgba(10,22,36,.55)';ctx.fillRect(14,74,422,500);const box=drawPauseLabel(ctx,'Ready to rig',225,280,422);text(settings.mode==='create'?'Start, then paint any board':'Press Start to begin',225,box.y+box.h+16,18,'#fff3b1',true);}
    if(pause.paused){ctx.fillStyle='rgba(8,18,30,.65)';ctx.fillRect(14,74,422,500);drawPauseLabel(ctx,'Paused',225,324,422);}
  }
  function sceneStarted(scene:Scene,now:number):void {
    for(const s of scene.sounds??[])play(s);
    for(const l of scene.labels??[])callouts.push({...l,from:now});
  }
  /** The live drag, shown on the board until the button is let go. */
  function updateDrag(mouse:Point):void {
    if(!drag)return;
    const dx=mouse[0]-drag.from[0], dy=mouse[1]-drag.from[1];
    if(drag.axis<0){if(Math.hypot(dx,dy)<DRAG_START)return;drag.axis=dragAxis(dx,dy);}
    game.preview={at:drag.at,axis:drag.axis,offset:projection(drag.axis,dx,dy)};
  }
  function frame(events:InputEvent[]):void {
    const resumed=pause.input(events,'rigging',running);
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
      if(!replays.isPlaying){
        const mouse=routed.mouse;
        const moved=mouse[0]!==lastMouse[0]||mouse[1]!==lastMouse[1];
        if(creating()&&moved){
          const brush=paletteBrush();
          if(paintWith!==null)paintAt(mouse,pieceBrush(paintWith));
          else if(painting&&brush)paintAt(mouse,brush);
        }
        if(drag)updateDrag(mouse);
        else if((mouse[0]!==lastMouse[0]||mouse[1]!==lastMouse[1])&&!game.selecting){const c=cellAt(mouse[0],mouse[1]);if(c&&(c.x!==game.cursor.x||c.y!==game.cursor.y))queue(`at:${c.x},${c.y}`);}
        lastMouse=[mouse[0],mouse[1]];
        for(const event of routed.events){
          if(creating()&&event.type==='mousedown'&&event.button===1&&paletteBrush()){paintAt(event.pos,paletteBrush()!);painting=true;continue;}
          if(creating()&&event.type==='mouseup'&&event.button===1&&painting){painting=false;continue;}
          if(creating()&&event.type==='mousedown'&&(event.button===4||event.button===5)){
            // The wheel cycles the piece under the pointer.
            const c=cellAt(event.pos[0],event.pos[1]);
            if(c){const old=game.board.get(c),i=PAINTABLE.indexOf(old&15),step=event.button===4?1:-1;queue(`paint:${c.x},${c.y},${repaint(old,PAINTABLE[(i+step+PAINTABLE.length)%PAINTABLE.length])}`);}
            continue;
          }
          if(event.type==='mousedown'&&event.button===1){
            const c=cellAt(event.pos[0],event.pos[1]);
            // A Freeplay board just painted is pulled as it stands by the next click, before any slide.
            if(c&&!game.busy&&!game.selecting&&creating()&&game.built){queue('select');continue;}
            if(c&&!game.busy&&!game.selecting){queue(`at:${c.x},${c.y}`);drag={at:c,from:[...event.pos],axis:-1};rope();}
            continue;
          }
          if(event.type==='mousedown'&&event.button===3){if(drag){drag=null;game.preview=null;}else queue('cancel');continue;}
          if(event.type==='mouseup'&&event.button===1&&drag){
            updateDrag(event.pos);
            const pv=game.preview;game.preview=null;
            if(pv){const {dir,amount}=slideFor(pv.axis,pv.offset);if(amount)queue(`slide:${pv.at.x},${pv.at.y},${dir},${amount}`);}
            drag=null;continue;
          }
          if(event.type!=='keydown'&&event.type!=='keyup')continue;
          const paint=PAINT_KEYS.find(p=>key(event.key,p.id,p.defaultKey));
          if(paint){
            if(!creating())continue;
            if(event.type==='keydown'){paintWith=paint.piece;paintAt(mouse,pieceBrush(paint.piece));}
            else if(paintWith===paint.piece)paintWith=null;
            continue;
          }
          for(const binding of KEYS){
            if(binding.id==='pause'||binding.id.startsWith('paint')||!key(event.key,binding.id,binding.defaultKey))continue;
            if(event.type==='keydown'){held.add(binding.id);repeats.set(binding.id,now+150);queue(binding.id);}
            else{held.delete(binding.id);repeats.delete(binding.id);}
          }
        }
        for(const id of Object.keys(DIR))if(held.has(id)&&now>=(repeats.get(id)??Infinity)){queue(id);repeats.set(id,now+75);}
        // Commands queued this frame are recorded and applied together at the start of the next.
      }
      if((game.preview||game.selecting)&&now>=nextRope&&!replays.isPlaying)rope();
      const scene=game.scenes[0]??null;
      if(scene!==lastScene){if(scene)sceneStarted(scene,now);lastScene=scene;}
      if(timerMs()&&elapsed()>=timerMs())end('Time up');
    }
    if(!replays.isSeeking&&!replays.isAdvancing)draw(now);
  }

  panel.clock(()=>running||finished?{label:timerMs()?'Time left':'Time',ms:timerMs()?Math.max(0,timerMs()-elapsed()):elapsed(),countdown:!!timerMs()}:null);
  const session=panel.session();
  session.select('Mode',MODES,()=>settings.mode,value=>{settings.mode=value;save();preview();},{disabled:busy});
  session.button('Start',()=>{if(replays.isPlaying)replays.stop();if(running)end('Stopped');else start();},{variant:'primary',label:()=>running&&!replays.isPlaying?'Stop':'Start'});
  pause.install(panel,()=>running&&!replays.isPlaying);
  panel.score().stats(['','Now'],()=>[['Points / slide',game.efficiency.toFixed(2)]]);
  const tokenStats=panel.group('Maneuver practice',{hidden:()=>!settings.tokens});
  tokenStats.stats(['Shape','Completed'],()=>BONUS_SETS[liveSettings.tokens].map(token=>[BONUS_NAMES[token],String(game.maneuverCounts[token])]));
  tokenStats.hint(()=>'Pulling a shape activates it for the next pull, shown by the next pulley. Pulling the same shape on that pull completes it. These count your share; the ship maneuver also needs the other stations.');
  const disabled=()=>!running||pause.paused||replays.isPlaying;
  panel.controlSettings.group('Slide').button('Select / slide',()=>queue('select'),{disabled}).button('Cancel',()=>queue('cancel'),{disabled});
  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly=()=>settings.mode!=='create';
  const editing=()=>!creating()||pause.paused||replays.isPlaying||game.busy;
  const boardGroup=panel.group('Board');
  boardGroup.button('Copy',()=>copyText(boardCode(game.board),'Copy this board:'),{title:'Copy the board, with its active pulley and turns since the last clear'});
  boardGroup.button('Paste',()=>void pasteText('Paste a board:').then(text=>{
    if(text===null)return;
    if(readBoardCode(text)){pasteNote='';queue(`load:${text.trim()}`);}
    else pasteNote='That isn’t a rigging board. Boards copied here start with R.';
  }),{hidden:createOnly,disabled:editing,title:'Play a board from a pasted copy'});
  boardGroup.button('Generate',()=>{queue('generate');window.setTimeout(()=>copyText(boardCode(game.board),'Copy this board:'),50);},
    {hidden:createOnly,disabled:editing,title:'Deal a new board and copy it'});
  boardGroup.select('Active pulley',PULLEY_NAMES.map((label,value)=>({value,label})),()=>game.board.nextPulley,value=>queue(`pulley:${value}`),{hidden:createOnly,disabled:editing});
  boardGroup.select('Turns since last clear',BOOCHING,()=>game.board.skipped,value=>queue(`booch:${value}`),{hidden:createOnly,disabled:editing,title:'Pulls in a row that cleared nothing. A third costs 5 coils and starts the count again.'});
  const palette=document.createElement('div');
  palette.className='piece-palette';
  PAINTABLE.forEach((piece,i)=>{
    const button=document.createElement('button');
    button.type='button';button.className='panel-button';
    const icon=document.createElement('canvas');
    icon.width=icon.height=PIECE;icon.setAttribute('aria-hidden','true');
    drawPiece(icon.getContext('2d')!,images,piece,PIECE/2,PIECE/2);
    button.append(icon,document.createTextNode(i<10?`${(i+1)%10} · ${PIECE_NAMES[i]}`:PIECE_NAMES[i]));
    button.addEventListener('click',()=>{palettePiece=palettePiece===piece?null:piece;paletteShape=null;panel.used();});
    panel.addSync(()=>{button.disabled=!creating();button.setAttribute('aria-pressed',String(palettePiece===piece));});
    palette.append(button);
  });
  boardGroup.append(palette,{hidden:createOnly});
  // Tokens are their own palette, painted onto colours without changing them.
  const tokenPalette=document.createElement('div');
  tokenPalette.className='piece-palette';
  SHAPES.forEach(({value,label})=>{
    const button=document.createElement('button');
    button.type='button';button.className='panel-button';
    const icon=document.createElement('canvas');
    icon.width=icon.height=PIECE;icon.setAttribute('aria-hidden','true');
    if(value)icon.getContext('2d')!.drawImage(images.get('bonus'),value*PIECE,0,PIECE,PIECE,0,0,PIECE,PIECE);
    button.append(icon,document.createTextNode(label));
    button.addEventListener('click',()=>{paletteShape=paletteShape===value?null:value;palettePiece=null;panel.used();});
    panel.addSync(()=>{button.disabled=!creating();button.setAttribute('aria-pressed',String(paletteShape===value));});
    tokenPalette.append(button);
  });
  boardGroup.append(tokenPalette,{hidden:createOnly});
  boardGroup.button('Fill board',()=>queue(`fill:${palettePiece??0}`),{hidden:createOnly,disabled:editing,title:'Make every space the selected piece'});
  boardGroup.note(()=>pasteNote||'After you paint, the next click or S pulls the board as it stands at the active pulley.',{hidden:createOnly});
  const options=panel.settings.group('Game');
  options.select('Difficulty',DIFFICULTIES,()=>settings.difficulty,value=>{settings.difficulty=value;save();preview();},{disabled:busy});
  options.select('Tokens',TOKENS,()=>settings.tokens,value=>{settings.tokens=value;save();preview();},{disabled:busy});
  options.select('Timer (Normal)',TIMER,()=>settings.timerMs,value=>{settings.timerMs=value;save();},{disabled:busy});
  options.hint(()=>'Difficulty sets the colours (6, 7 from 2 stars, 8 from 4) and which specials can appear: gaff from difficulty 3, tar from 5 and splices from 6; below that they come as wilds. Difficulty stays at your selected level after each board is cleared.');
  const approximations=panel.settings.group('Approximations');
  approximations.number('Top indicator threshold (approx.)',()=>settings.indicatorMax,value=>{settings.indicatorMax=value;save();preview();},{min:1,max:1000,step:0.01,disabled:busy});
  approximations.hint(()=>'The indicator uses the game’s default threshold curve (top 7.48 points/slide), which may differ from live play. Reports use Learning until live ratings are verified. Token availability is forced for practice; ship maneuver conversion is not simulated.');
  panel.controls('rigging',KEYS);
  historyGroup(panel,history,[{label:'Points / slide',value:g=>g.score.toFixed(2)},{label:'Biggest',value:g=>String(g.biggest)},{label:'Maneuvers',value:g=>String(g.maneuvers)}],'Past games',{
    available:g=>typeof g.replayAt==='number'&&(replays?.hasPlayableAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined)??false),
    play:g=>{if(typeof g.replayAt==='number')void replays.playAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined);},
  });
  panel.results(()=>finished&&!running?{title:'Rigging results',report:duty.last,rows:[
    ['Points / slide',game.efficiency.toFixed(2)],['Points',String(game.points)],['Slides',String(game.moves)],
    ['Pieces pulled',String(game.pieces)],['Biggest pull',String(game.biggestPull)],['Levels',String(game.levels)],['Maneuvers',String(game.maneuvers)],
  ]}:null);
  const codec:ReplaySettingsCodec={currentVersion:1,simulatorVersion:1,migrate:(version,value)=>version===1?readSettings(value):null};
  replays=new ReplayRecorder('rigging',store,panel,ticks,tape=>{
    savedSettings??={...settings};settings=readSettings(tape.settings)!;start(tape.seed as number);
  },()=>{
    running=false;finished=false;resetInput();commands=[];duty.clear();
    if(savedSettings){settings=savedSettings;savedSettings=null;}preview();
  },validSeed,setReplayTime,()=>frame([]),codec,()=>!running||replays.isPlaying);
  replays.setStopLive(()=>{if(running)end('Stopped');});
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  // A replay plays its moves as commands, so the pointer and keys start afresh with the player's.
  replays.onTakeOver=()=>{savedSettings=null;resetInput();};
  // What decides how the game goes on; replays check it after every recorded input. A mouse drag's
  // preview is the player's alone until it is let go as a slide.
  replays.fingerprint=()=>stateText({...game,preview:null},running,finished,startAt,endAt);
  function preview():void {if(!running){liveSettings={...settings};game=new RiggingGame(settings,42);finished=false;}}
  const blur=()=>{resetInput();game.preview=null;if(running&&!replays.isPlaying&&!pause.paused)pause.toggle();};
  window.addEventListener('blur',blur);
  return {frame,dispose:()=>{if(running)end('Stopped');window.removeEventListener('blur',blur);replays.dispose();sounds.dispose();}};
}) satisfies PuzzleFactory;

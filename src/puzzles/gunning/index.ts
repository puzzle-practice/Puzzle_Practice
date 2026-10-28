import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { drawGameText, drawPauseLabel, loadGameFont } from '../../core/game-text';
import { SoundBank } from '../../core/audio';
import { SessionPause } from '../../core/pause';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import { historyGroup } from '../../core/history';
import { dutyDesk } from '../../core/duty/desk';
import { EndHold } from '../../core/end-hold';
import { LEARNING } from '../../core/duty/ratings';
import { keyMatches } from '../../core/controls';
import { Group } from '../../core/panel';
import type { InputEvent, Point } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import { DOWN, LEFT as ARROW_LEFT, RIGHT, UP, WIDTH } from './board';
import {
  BALLS, DEFAULT_SETTINGS, GunningGame, HOLES, MAX_TICK, MIN_TICK, TIMERS, VOLLEYS, readSettings, settingsKey,
  type Firing, type GunningSettings,
} from './game';
import { CELL, boardView, drawGame } from './render';
import { copyText, pasteText } from '../../core/clipboard';
import { barrelFacing, boardCode, boardIssues, faceBarrel, load as loadDeck, paint as paintCell, PAINTS, PAINT_NAMES, readBoardCode, type Paint } from './create';

const CANNONS=[2,4,6].map(value=>({value,label:`${value} cannons`}));
const FIRING:{value:Firing;label:string}[]=[{value:'volley',label:'Ship broadsides'},{value:'loaded',label:'As soon as loaded'},{value:'viking',label:'Viking expedition'}];
const VOLLEY=VOLLEYS.map(value=>({value,label:`Every ${value/1000} seconds`}));
const BALL=BALLS.map(value=>({value,label:value?`${value} cannonballs`:'No limit'}));
const HOLE=HOLES.map(value=>({value,label:value?`${value} ${value===1?'hole':'holes'}`:'None'}));
const TIMER=TIMERS.map(value=>({value,label:value?`${value/60000} minutes`:'No timer'}));
const MODES = [{ value: 'normal', label: 'Normal' }, { value: 'loop', label: 'Loop drill' }, { value: 'create', label: 'Freeplay' }] as const;
const KEYS=[{id:'left',label:'Cursor left',defaultKey:'arrowleft'},{id:'right',label:'Cursor right',defaultKey:'arrowright'},
  {id:'up',label:'Cursor up',defaultKey:'arrowup'},{id:'down',label:'Cursor down',defaultKey:'arrowdown'},
  {id:'arrUp',label:'Select up arrow',defaultKey:'w'},{id:'arrRight',label:'Select right arrow',defaultKey:'d'},
  {id:'arrDown',label:'Select down arrow',defaultKey:'s'},{id:'arrLeft',label:'Select left arrow',defaultKey:'a'},
  {id:'place',label:'Place arrow',defaultKey:'space'},{id:'pause',label:'Pause',defaultKey:'escape'}];
/** Freeplay mode paints with keys 1-9 held over the deck. */
const PAINT_KEYS=PAINTS.map((paint,n)=>({id:`paint${n+1}`,label:`Paint ${PAINT_NAMES[paint].toLowerCase()} (Freeplay)`,defaultKey:String(n+1),paint}));
const FACINGS=['Up','Right','Down','Left'].map((label,value)=>({value,label}));
const MOVES:Record<string,[number,number]>={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
const SELECT:Record<string,number>={arrUp:UP,arrRight:RIGHT,arrDown:DOWN,arrLeft:ARROW_LEFT};
/** The game's sound names and the recordings each one plays. */
const SOUNDS:Record<string,string[]>={place_arrow:['place_arrow','place_arrow2']};
/** How far the mouse has to be dragged before it picks the arrow's direction. */
const DRAG=4;
const validSeed=(s:unknown):s is number=>Number.isInteger(s)&&Number(s)>=0&&Number(s)<=0xffffffff;
/** The speed slider runs fast to the right, like the game's: its value is 600 less the tick time. */
const sliderOf=(ms:number)=>MIN_TICK+MAX_TICK-ms;

export default (async ({screen,input,panel,store,ticks:rawTicks,setReplayTime:rawReplayTime}) => {
  const pause=new SessionPause(rawTicks,rawReplayTime), {ticks,setReplayTime}=pause;
  const [images]=await Promise.all([Images.load(import.meta.glob<string>('./media/*.png',{eager:true,query:'?url',import:'default'})),loadGameFont()]);
  let replays!: ReplayRecorder;
  const sounds=new SoundBank(import.meta.glob<string>('./sounds/*.mp3',{eager:true,query:'?url',import:'default'}),()=>replays?.isSeeking??false);
  let settings=readSettings(store.get('settings',DEFAULT_SETTINGS))??{...DEFAULT_SETTINGS};
  let liveSettings={...settings}, savedSettings:GunningSettings|null=null;
  let game=new GunningGame(settings,42), running=false, finished=false, timeUp=false;
  let startAt=0,endAt=0,lastAt=0,soundTurn=0;
  let commands:string[]=[], held=new Set<string>(), repeats=new Map<string,number>();
  let dragFrom:Point|null=null, lastMouse:Point=[-1,-1];
  /** Freeplay mode: the deck holds still while frozen; the palette choice a left click paints (recorded, so replays click the same way), the key held, the deck as it was when it last ran, and pasted-text errors. */
  let frozen=false, palette:Paint|null=null, paintWith:Paint|null=null, painting=false, movingBarrel=false, setup='', pasteNote='';
  const creating=()=>running&&liveSettings.mode==='create';
  const ctx=screen.ctx;
  const duty=dutyDesk(panel,store,'gunning','Gunning',[]);
  const busy=()=>running||(replays?.isPlaying??false);
  const elapsed=()=>Math.min(liveSettings.mode!=='create'&&liveSettings.timerMs||Infinity,Math.max(0,(running?ticks():endAt)-startAt));
  const hold=new EndHold(ticks);
  const save=()=>store.set('settings',settings);
  const history=()=>store.history(settingsKey(settings));
  const queue=(action:string)=>{if(running&&!timeUp&&!pause.paused&&!replays.isPlaying)commands.push(action);};
  const resetInput=()=>{held.clear();repeats.clear();dragFrom=null;movingBarrel=false;};
  const key=(name:string,id:string,fallback:string)=>keyMatches(name,'gunning',id,fallback);
  const play=(name:string)=>{const files=SOUNDS[name]??[name];sounds.play(files[soundTurn++%files.length]);};
  const cellAt=([x,y]:Point)=>{const v=boardView(game);return {x:Math.floor((x-v.left)/v.cell),y:Math.floor((y-v.top)/v.cell)};};
  const onBoard=(p:Point)=>{const c=cellAt(p);return c.x>=0&&c.x<WIDTH&&c.y>=0&&c.y<game.board.height;};

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed=seedMode.next()):void { seedMode.remember(seed);
    pause.resume(); liveSettings={...settings}; game=new GunningGame(liveSettings,seed);
    running=true;finished=false;timeUp=false;hold.clear();startAt=endAt=lastAt=ticks(); duty.clear(); resetInput();commands=[];
    // Freeplay starts frozen, so the deck can be set up before anything moves.
    frozen=liveSettings.mode==='create';palette=paintWith=null;painting=false;setup='';pasteNote='';
    replays.begin(liveSettings,seed); play('fanfare');
  }
  function end(reason:string):void {
    if(!running)return;
    running=false;finished=true;timeUp=false;endAt=ticks();resetInput();commands=[];
    if(reason==='Time up')hold.start();
    const s=game.stats, rate=game.loadsPerMinute;
    const report=duty.end({mode:liveSettings.mode==='loop'?'Loop drill':FIRING.find(f=>f.value===liveSettings.firing)!.label,performance:LEARNING,
      score:{label:'Guns / minute',value:rate.toFixed(2)},
      cleared:[{label:'Cannons Loaded',items:[{icon:'cannonball',label:'Cannons',count:s.loaded}]}]});
    const tape=replays.finish(`${reason} · ${s.loaded} loaded · ${rate.toFixed(2)}/min`,report);
    // Freeplay is a sandbox and keeps no history.
    if(!replays.isPlaying&&liveSettings.mode!=='create')store.addHistory(settingsKey(liveSettings),{
      score:rate,loaded:s.loaded,fired:s.fired,correct:s.correct,wrong:s.wrong,overboard:s.overboard,stuck:s.stuck,
      washes:s.washes,wastedSwabs:s.wastedSwabs,arrows:s.arrows,seconds:elapsed()/1000,...duty.fields(report),
      ...(tape?{replayAt:tape.at,replayId:tape.runId??''}:{})});
  }
  function action(id:string):void {
    if(!running||timeUp||pause.paused)return;
    const move=MOVES[id];
    if(move)game.moveCursor(...move);
    if(id in SELECT)game.selectArrow(SELECT[id]);
    if(id==='place')game.placeArrow();
    if(id.startsWith('speed:'))game.setSpeed(Number(id.slice(6)));
    if(creating())createCommand(id);
  }
  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(id:string):void {
    const [name,value='']=id.split(':',2) as [string,string?];
    if(name==='palette')palette=PAINTS.includes(value as Paint)?value as Paint:null;
    else if(name==='freeze')frozen=true;
    else if(name==='run'){if(frozen){frozen=false;setup=boardCode(game.board);}}
    else if(name==='facing')faceBarrel(game.board,Number(value));
    else if(name==='load'||name==='reset'||name==='generate'){
      const read=readBoardCode(name==='load'?id.slice(5):setup);
      if(name!=='generate'&&!read)return;
      const next=new GunningGame({...liveSettings,cannons:read?.cannons??liveSettings.cannons},game.board.rng.nextInt(0x7fffffff));
      if(read)loadDeck(next.board,read);
      Object.assign(next.stats,game.stats);next.cursor=game.cursor;next.nextArrow=game.nextArrow;next.setSpeed(game.speed);
      liveSettings={...liveSettings,cannons:next.board.numCannons};game=next;frozen=true;
    }
  }
  function paintAt(pos:Point,paint:Paint):void {
    if(!onBoard(pos))return;
    const c=cellAt(pos);
    if(paintCell(game.board,c.x,c.y,paint,game.nextArrow-UP))play('place_arrow');
  }
  /** Dragging away from where the button went down picks the arrow: the way the mouse went. */
  function dragArrow([x,y]:Point):number {
    const dx=dragFrom![0]-x, dy=dragFrom![1]-y;
    if(Math.hypot(dx,dy)<=DRAG)return game.nextArrow;
    if(dx===0)return dy<0?DOWN:UP;
    const slope=dy/Math.abs(dx);
    return slope>1?UP:slope>-1?(dx<0?RIGHT:ARROW_LEFT):DOWN;
  }
  /** Outlined text from its top: the game font at 24px and up, bold Dialog below. */
  function text(value:string,x:number,y:number,size=14,fill='#fff6d4',center=false,alpha?:number):void {
    drawGameText(ctx,value,x,y,{px:size,family:size>=24?'game':'dialog',bold:true,fill,align:center?'center':'left',alpha});
  }
  function draw():void {
    drawGame(ctx,images,game,!pause.paused);
    const title=images.get('title');
    ctx.drawImage(title,Math.floor((450-title.width)/2),4);
    text(`Loaded ${game.stats.loaded}`,20,566,14);
    text(`Tick ${Math.round(game.tickTime)} ms`,350,566,14);
    if(liveSettings.mode!=='loop'&&liveSettings.balls){const left=Math.max(0,game.board.balls);text(left?`${left} balls`:'Out of cannonballs!',225,566,14,left?'#fff6d4':'#ffb0a0',true);}
    if(!running&&!finished){ctx.fillStyle='rgba(30,18,6,.55)';ctx.fillRect(0,42,450,544);const box=drawPauseLabel(ctx,liveSettings.mode==='loop'?'Loop drill':'Man the guns!',225,250,450);text(settings.mode==='create'?'Start, then paint any deck':'Press Start',225,box.y+box.h+6,18,'#fff3b1',true);}
    if(creating()&&frozen)text('Frozen',225,566,14,'#9fd8ff',true);
    if(pause.paused){ctx.fillStyle='rgba(30,18,6,.65)';ctx.fillRect(0,42,450,544);drawPauseLabel(ctx,'Paused',225,314,450);}
  }
  function frame(events:InputEvent[]):void {
    const resumed=pause.input(events,'gunning',running);
    if(!resumed){resetInput();draw();return;}
    const liveCommands=replays.isPlaying?[]:commands.splice(0);
    for(const command of liveCommands)replays.command(command);
    const routed=replays.frame(resumed,input.mouse,ticks());
    if(routed.renderOnly){draw();return;}
    const now=ticks(), delta=Math.max(0,now-lastAt);lastAt=now;
    if(running){
      for(const command of [...liveCommands,...routed.commands])action(command);
      const mouse=routed.mouse;
      if(timeUp){/* The deck has stopped. */}
      else if(dragFrom)game.selectArrow(dragArrow(mouse));
      else if((mouse[0]!==lastMouse[0]||mouse[1]!==lastMouse[1])&&onBoard(mouse)){
        const c=cellAt(mouse);game.pointAt(c.x,c.y);
        const paint=paintWith??(painting?palette:null);
        if(creating()&&paint)paintAt(mouse,paint);
      }
      lastMouse=[mouse[0],mouse[1]];
      for(const event of timeUp?[]:routed.events){
        if(creating()){
          if(event.type==='mousedown'&&event.button===1&&!palette){
            const c=cellAt(event.pos);
            if(c.x===game.board.barrel.shown&&c.y===game.board.barrel.row){movingBarrel=true;continue;}
          }
          if(event.type==='mouseup'&&event.button===1&&movingBarrel){movingBarrel=false;paintAt(event.pos,'barrel');continue;}
          const paintKey=event.type==='keydown'||event.type==='keyup'?PAINT_KEYS.find(k=>key(event.key,k.id,k.defaultKey)):undefined;
          if(paintKey){
            if(event.type==='keyup'){if(paintWith===paintKey.paint)paintWith=null;}
            else{paintWith=paintKey.paint;paintAt(mouse,paintKey.paint);}
            continue;
          }
          if(event.type==='mousedown'&&event.button===1&&palette&&onBoard(event.pos)){painting=true;paintAt(event.pos,palette);continue;}
          if(event.type==='mouseup'&&event.button===1&&painting){painting=false;continue;}
        }
        if(event.type==='mousedown'){
          if(event.button===1&&onBoard(event.pos)){const c=cellAt(event.pos);game.pointAt(c.x,c.y);dragFrom=event.pos;}
          else if(event.button===3)dragFrom=null;
          else if(event.button===4||event.button===5)game.turnArrow(event.button===5?1:-1);
          continue;
        }
        if(event.type==='mouseup'){
          if(event.button===1&&dragFrom){game.selectArrow(dragArrow(event.pos));action('place');dragFrom=null;}
          continue;
        }
        if(event.type!=='keydown'&&event.type!=='keyup')continue;
        for(const binding of KEYS){
          if(binding.id==='pause'||!key(event.key,binding.id,binding.defaultKey))continue;
          if(event.type==='keydown'){held.add(binding.id);repeats.set(binding.id,now+150);action(binding.id);}
          else{held.delete(binding.id);repeats.delete(binding.id);}
        }
      }
      for(const id of Object.keys(MOVES))if(held.has(id)&&now>=(repeats.get(id)??Infinity)){action(id);repeats.set(id,now+75);}
      if(timeUp)game.playOut(delta);
      else if(!frozen)game.step(liveSettings.mode==='loop'&&liveSettings.timerMs?Math.min(delta,Math.max(0,liveSettings.timerMs-game.now)):delta);
      for(const sound of game.sounds.splice(0))play(sound);
      // Time's up: the deck stops, and the session ends once washes and firing have finished.
      if(liveSettings.timerMs&&liveSettings.mode!=='create'&&elapsed()>=liveSettings.timerMs&&!timeUp){timeUp=true;resetInput();}
      if(timeUp&&!game.busy)end('Time up');
    }
    if(!replays.isSeeking&&!replays.isAdvancing)draw();
  }

  const timed=()=>!!liveSettings.timerMs&&liveSettings.mode!=='create';
  panel.clock(()=>running||finished?{label:timed()?'Time left':'Time',ms:timed()?Math.max(0,liveSettings.timerMs-elapsed()):elapsed(),countdown:timed()}:null);
  const session=panel.session();
  const hideInDrill=()=>settings.mode==='loop';
  session.select('Mode',MODES,()=>settings.mode,value=>{settings.mode=value;save();preview();},{disabled:busy});
  session.select('Cannons',CANNONS,()=>settings.cannons,value=>{settings.cannons=value;save();preview();},{disabled:busy,hidden:hideInDrill});
  session.select('Firing',FIRING,()=>settings.firing,value=>{settings.firing=value;save();preview();},{disabled:busy,hidden:hideInDrill});
  session.button('Start',()=>{if(replays.isPlaying)replays.stop();if(running)end('Stopped');else start();},{variant:'primary',label:()=>running&&!replays.isPlaying?'Stop':'Start'});
  pause.install(panel,()=>running&&!replays.isPlaying);
  panel.score().stats(['','Now'],()=>[['Guns / minute',game.loadsPerMinute.toFixed(2)]]);
  const speedFooter=document.createElement('div');speedFooter.className='gunning-speed';
  if(screen.canvas?.parentElement){screen.canvas.parentElement.append(speedFooter);
    new Group(panel,speedFooter).range('Speed',()=>sliderOf(running?game.speed:settings.speed),value=>{
      const ms=sliderOf(value);settings.speed=ms;save();if(running&&!replays.isPlaying)queue(`speed:${ms}`);else if(!running)preview();
    },{min:MIN_TICK,max:MAX_TICK,step:10,formatValue:value=>`${sliderOf(value)} ms`,outputWidth:7,disabled:()=>replays?.isPlaying??false});
  }
  const disabled=()=>!running||pause.paused||replays.isPlaying;
  panel.controlSettings.group('Cursor').button('←',()=>queue('left'),{disabled}).button('↑',()=>queue('up'),{disabled}).button('↓',()=>queue('down'),{disabled}).button('→',()=>queue('right'),{disabled});
  panel.controlSettings.group('Arrow').button('⇧',()=>queue('arrUp'),{disabled}).button('⇨',()=>queue('arrRight'),{disabled}).button('⇩',()=>queue('arrDown'),{disabled}).button('⇦',()=>queue('arrLeft'),{disabled})
    .button('Place',()=>queue('place'),{disabled});
  // Freeplay mode's deck panel: the deck's text, freezing it, and the paint palette.
  const createOnly=()=>settings.mode!=='create';
  const editing=()=>!creating()||pause.paused||replays.isPlaying;
  const deck=panel.group('Deck',{hidden:createOnly});
  deck.button('Copy',()=>copyText(boardCode(game.board),'Copy this deck:'),{title:'Copy the deck, its pieces, cannons and arrows'});
  deck.button('Paste',()=>void pasteText('Paste a deck:').then(text=>{
    if(text===null)return;
    if(readBoardCode(text)){pasteNote='';queue(`load:${text.trim()}`);}
    else pasteNote='That isn’t a gunning deck. Decks copied here start with G.';
  }),{disabled:editing,title:'Play a deck from a pasted copy'});
  deck.button('Generate',()=>{queue('generate');},{disabled:editing,title:'Deal a new deck'});
  const paletteEl=document.createElement('div');
  paletteEl.className='piece-palette';
  PAINT_KEYS.forEach(({paint,defaultKey})=>{
    const button=document.createElement('button');
    button.type='button';button.className='panel-button';
    // Crates, holes and the four pieces use their own art.
    const art:[string,number,number]|null=paint==='barrel'?['barrel',9,40]:paint==='crate'?['crates',0,CELL]:paint==='hole'?['holes',0,52]:paint==='swab'?['pieces',0,CELL]:paint==='shot'?['pieces',1,CELL]:paint==='powder'?['pieces',2,CELL]:paint==='wad'?['pieces',3,CELL]:null;
    if(art){const [name,index,size]=art,icon=document.createElement('canvas');icon.width=icon.height=size;icon.setAttribute('aria-hidden','true');
      icon.getContext('2d')!.drawImage(images.get(name),index*size,0,size,size,0,0,size,size);button.append(icon);}
    button.append(document.createTextNode(`${defaultKey} · ${PAINT_NAMES[paint]}`));
    button.addEventListener('click',()=>{queue(`palette:${palette===paint?'-':paint}`);panel.used();});
    panel.addSync(()=>{button.disabled=!creating()||replays.isPlaying;button.setAttribute('aria-pressed',String(palette===paint));});
    paletteEl.append(button);
  });
  deck.append(paletteEl);
  deck.button('Freeze',()=>queue(frozen?'run':'freeze'),{label:()=>frozen&&creating()?'Run':'Freeze',disabled:editing,title:'Hold the deck still to set it up, or let it run'});
  deck.button('Back to setup',()=>queue('reset'),{disabled:()=>editing()||!setup,title:'Put the deck back as it was when it last ran'});
  deck.select('Barrel faces',FACINGS,()=>barrelFacing(game.board),value=>queue(`facing:${value}`),{disabled:editing});
  deck.note(()=>pasteNote);
  deck.note(()=>{const issues=boardIssues(game.board);return issues.length?`Not a deck the game could deal: ${issues.join(' ')}`:'';},{hidden:()=>!creating()});
  const options=panel.settings.group('Game');
  options.select('Broadside every',VOLLEY,()=>settings.volleyMs,value=>{settings.volleyMs=value;save();preview();},{disabled:busy,hidden:()=>hideInDrill()||settings.firing!=='volley'});
  options.select('Cannonballs',BALL,()=>settings.balls,value=>{settings.balls=value;save();preview();},{disabled:busy,hidden:hideInDrill});
  options.select('Holes in the deck',HOLE,()=>settings.holes,value=>{settings.holes=value;save();preview();},{disabled:busy,hidden:hideInDrill});
  options.toggle('Ship moves',()=>settings.shipMoves,on=>{settings.shipMoves=on;save();preview();},{disabled:busy,hidden:hideInDrill});
  options.select('Timer',TIMER,()=>settings.timerMs,value=>{settings.timerMs=value;save();},{disabled:busy});
  options.hint(()=>settings.mode==='loop'?'Practise either mirrored side. Point an arrow towards a muzzle to load it; Down keeps pieces circulating. Darkened guns cannot accept pieces; they brighten when ready. Place arrows on any open cell; the three newest remain. A powder, wad, shot load fires, then leaves the gun clean. Swabs clear mistakes. Each barrel keeps three of each piece on its side and returns consumed pieces in delayed, shuffled batches.':'Pieces come out of the barrel and follow your arrows. Load each cannon through its open end with powder, then wad, then shot. Swab a cannon after it fires, or to clear a wrong load. Only your three newest arrows stay on the deck.');
  const approximations=panel.settings.group('Approximations');
  approximations.hint(()=>'In the game the ship decides when loaded cannons fire, when it turns and when the deck takes holes. Here broadsides come on a fixed timer, the ship turns at random every few seconds, and holes are only placed at the start. Viking firing follows the game: every cannon fires each time all of them have been loaded. Reports show Learning because the game doesn’t show how it rates gunning.');
  panel.controls('gunning',[...KEYS,...PAINT_KEYS.map(({id,label,defaultKey})=>({id,label,defaultKey}))]);
  historyGroup(panel,history,[{label:'Guns / min',value:g=>g.score.toFixed(2)},{label:'Loaded',value:g=>String(g.loaded)},{label:'Overboard',value:g=>String(g.overboard)}],'Past games',{
    available:g=>typeof g.replayAt==='number'&&(replays?.hasPlayableAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined)??false),
    play:g=>{if(typeof g.replayAt==='number')void replays.playAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined);},
  });
  panel.results(()=>finished&&!running&&!hold.holding&&liveSettings.mode!=='create'?{title:'Gunning results',report:duty.last,rows:liveSettings.mode==='loop'?[
    ['Guns / minute',game.loadsPerMinute.toFixed(2)],['Guns loaded',String(game.stats.loaded)],
    ['Active time',`${(game.activeTime/1000).toFixed(2)}s`],['Wrong pieces',String(game.stats.wrong)],['Washes',String(game.stats.washes)],
  ]:[
    ['Cannons loaded',String(game.stats.loaded)],['Guns / minute',game.loadsPerMinute.toFixed(2)],['Fired',String(game.stats.fired)],
    ['Correct pieces',String(game.stats.correct)],['Wrong pieces',String(game.stats.wrong)],['Lost overboard',String(game.stats.overboard)],
    ['Stuck and removed',String(game.stats.stuck)],['Washes',String(game.stats.washes)],['Swabs into clean cannons',String(game.stats.wastedSwabs)],
    ['Arrows placed',String(game.stats.arrows)],
  ]}:null);
  const codec:ReplaySettingsCodec={currentVersion:6,simulatorVersion:6,migrate:(version,value)=>version>=1&&version<=6?readSettings(value):null};
  replays=new ReplayRecorder('gunning',store,panel,ticks,tape=>{
    savedSettings??={...settings};settings=readSettings(tape.settings)!;start(tape.seed as number);
  },()=>{
    running=false;finished=false;timeUp=false;resetInput();commands=[];duty.clear();
    if(savedSettings){settings=savedSettings;savedSettings=null;}preview();
  },validSeed,setReplayTime,()=>frame([]),codec,()=>!running||replays.isPlaying);
  replays.setStopLive(()=>{if(running)end('Stopped');});
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver=()=>{savedSettings=null;};
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint=()=>stateText(game,running,finished,startAt,endAt,frozen,setup,dragFrom,movingBarrel,[...held],[...repeats]);
  function preview():void {if(!running){liveSettings={...settings};game=new GunningGame(settings,42);finished=false;}}
  const blur=()=>{resetInput();if(running&&!replays.isPlaying&&!pause.paused)pause.toggle();};
  window.addEventListener('blur',blur);
  return {frame,dispose:()=>{if(running)end('Stopped');speedFooter.remove?.();window.removeEventListener('blur',blur);replays.dispose();sounds.dispose();}};
}) satisfies PuzzleFactory;

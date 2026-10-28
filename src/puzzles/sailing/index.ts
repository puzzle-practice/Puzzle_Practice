import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { drawGameText, drawPauseLabel, gameFont, loadGameFont, TEXT_WHITE, TEXT_YELLOW } from '../../core/game-text';
import { SoundBank } from '../../core/audio';
import { SessionPause } from '../../core/pause';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import { historyGroup } from '../../core/history';
import { dutyDesk } from '../../core/duty/desk';
import { EndHold } from '../../core/end-hold';
import { LEARNING } from '../../core/duty/ratings';
import { keyMatches } from '../../core/controls';
import type { InputEvent } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import { BONUS_NAMES, BONUS_SETS, PATTERNS, WIDTH, HEIGHT, EMPTY, oriented } from './board';
import { SailingEditor, readLayout, type Brush, type CreateTool } from './create';
import { SailingGame, DEFAULT_SETTINGS, feedbackText, indicatorStep, readSettings, settingsKey, type SailingSettings } from './game';
import { drawBoard, drawPiece, CELL, LEFT, TOP } from './render';

const TOKENS=[{value:0,label:'Off'},{value:1,label:'4 Tokens'},{value:2,label:'5 Tokens'}];
const DIFFICULTIES=Array.from({length:10},(_,value)=>({value,label:`${value} · ${value+1} ${value?'stars':'star'}`}));
const TIMER=[{value:0,label:'No timer'},{value:120000,label:'2 minutes'},{value:300000,label:'5 minutes'},{value:600000,label:'10 minutes'}];
const COLOURS=[{value:0,label:'Rope (yellow)'},{value:1,label:'Water (blue)'},{value:2,label:'Wind (white)'}];
const KEYS=[{id:'left',label:'Move left',defaultKey:'arrowleft'},{id:'right',label:'Move right',defaultKey:'arrowright'},
  {id:'cw',label:'Rotate clockwise',defaultKey:'arrowdown'},{id:'ccw',label:'Rotate counterclockwise',defaultKey:'arrowup'},
  {id:'drop',label:'Fall faster (hold)',defaultKey:'space'},{id:'pause',label:'Pause',defaultKey:'escape'}];
// Left and right repeat seven times a second after a 300 ms hold; rotations and Space never repeat.
const REPEAT_DELAY_MS=300, REPEAT_INTERVAL_MS=Math.trunc(1000/7);
const validSeed=(s:unknown):s is number=>Number.isInteger(s)&&Number(s)>=0&&Number(s)<=0xffffffff;

export default (async ({screen,input,panel,store,ticks:rawTicks,setReplayTime:rawReplayTime}) => {
  const pause=new SessionPause(rawTicks,rawReplayTime), {ticks,setReplayTime}=pause;
  const [images]=await Promise.all([Images.load(import.meta.glob<string>('./media/*.png',{eager:true,query:'?url',import:'default'})),loadGameFont()]);
  let replays!: ReplayRecorder;
  const sounds=new SoundBank(import.meta.glob<string>('./sounds/*.mp3',{eager:true,query:'?url',import:'default'}),()=>replays?.isSeeking??false);
  let settings=readSettings(store.get('settings',DEFAULT_SETTINGS))??{...DEFAULT_SETTINGS};
  let liveSettings={...settings}, savedSettings:SailingSettings|null=null;
  let mode=store.get<string>('mode','Normal')==='Create'?'Create':'Normal', liveCreate=false, editing=false;
  const editor=new SailingEditor(readLayout(store.get('createBoard',null))??undefined);
  const brush:Brush={tool:'platform',colour:0,secondColour:1,direction:1,pattern:12};
  const creating=()=>liveCreate&&!replays?.isPlaying;
  const editable=()=>creating()&&running&&editing;
  const saveDraft=()=>{store.set('createBoard',editor.snapshot());showDraft();};
  let game=new SailingGame(settings,42), running=false, finished=false, timeUp=false;
  let startAt=0,endAt=0,lastAt=0;
  let commands:string[]=[], held=new Set<string>(), repeats=new Map<string,number>();
  let fast=false, fastUntil=0, showLanding=store.get('landingPreview',false);
  let message='', messageUntil=0, lastScene:unknown=null, lastMoves=0, lastBoards=0, lastBooches=0;
  const ctx=screen.ctx;
  const duty=dutyDesk(panel,store,'sailing','Sailing',[]);
  const busy=()=>running||(replays?.isPlaying??false);
  const elapsed=()=>Math.min(!creating()&&liveSettings.timerMs||Infinity,Math.max(0,(running?ticks():endAt)-startAt));
  const hold=new EndHold(ticks);
  const save=()=>store.set('settings',settings);
  const history=()=>store.history(settingsKey(settings));
  const queue=(action:string)=>{if(running&&!timeUp&&!pause.paused&&!replays.isPlaying)commands.push(action);};
  const resetInput=()=>{held.clear();repeats.clear();fast=false;fastUntil=0;};
  const key=(name:string,id:string,fallback:string)=>keyMatches(name,'sailing',id,fallback);

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed=seedMode.next(),asCreate=mode==='Create'):void { seedMode.remember(seed);
    liveCreate=asCreate;editing=asCreate;
    pause.resume(); liveSettings={...settings}; game=new SailingGame(liveSettings,seed);
    running=true;finished=false;timeUp=false;hold.clear();startAt=endAt=lastAt=ticks(); duty.clear(); resetInput();commands=[];
    lastScene=null;lastMoves=lastBoards=lastBooches=0;message='';messageUntil=0;
    if(asCreate)showDraft();else replays.begin(liveSettings,seed);
    sounds.play('fanfare');
  }
  function end(reason:string):void {
    if(!running)return;
    running=false;finished=true;timeUp=false;endAt=ticks();resetInput();commands=[];
    if(reason==='Time up')hold.start();
    if(liveCreate){finished=false;preview();return;}
    const report=duty.end({mode:liveSettings.tokens?'Token practice':'Normal',performance:LEARNING,
      score:{label:'Points / pair',value:game.efficiency.toFixed(2)}});
    const tape=replays.finish(`${reason} · ${game.efficiency.toFixed(2)} points/pair`,report);
    if(!replays.isPlaying)store.addHistory(settingsKey(liveSettings),{
      score:game.efficiency,points:game.points,moves:game.moves,boards:game.boards,booches:game.booches,
      chain:game.longestChain,tokens:game.tokenUnits.reduce((a,b)=>a+b,0),seconds:elapsed()/1000,...duty.fields(report),
      ...(tape?{replayAt:tape.at,replayId:tape.runId??''}:{})});
  }
  function action(id:string):void {
    if(!running||timeUp||pause.paused)return;
    if(id==='left')game.move(-1);
    if(id==='right')game.move(1);
    if(id==='cw')game.rotate(true);
    if(id==='ccw')game.rotate(false);
    if(id==='drop'&&!game.release())fastUntil=ticks()+250;
  }
  function showDraft():void {
    if(!liveCreate)return;
    game=new SailingGame(liveSettings,42,true);
    game.board.loadLayout(editor.board.cells,editor.board.targets);game.active=null;
  }
  function playDraft():void {
    if(!editable())return;
    game=new SailingGame(liveSettings,crypto.getRandomValues(new Uint32Array(1))[0],true);
    game.board.loadLayout(editor.board.cells,editor.board.targets);game.hold();
    editing=false;lastAt=startAt=ticks();resetInput();commands=[];message='';
    lastScene=null;lastMoves=lastBoards=lastBooches=0;
  }
  function editDraft():void {
    if(!creating()||!running)return;
    pause.resume();editing=true;resetInput();commands=[];showDraft();
  }
  function editInput(events:InputEvent[]):void {
    for(const event of events){
      if(event.type!=='mousedown'||(event.button!==1&&event.button!==3))continue;
      const x=Math.floor((event.pos[0]-LEFT)/CELL),y=Math.floor((event.pos[1]-TOP)/CELL);
      if(!editor.board.inBounds(x,y))continue;
      const error=editor.place(event.button===3?{...brush,tool:'erase'}:brush,x,y);
      message=error??'';messageUntil=ticks()+2500;
      if(!error)saveDraft();
    }
  }
  function drawEditor():void {
    ctx.save();ctx.strokeStyle='rgba(255,241,190,.2)';ctx.lineWidth=1;
    for(let x=0;x<=WIDTH;x++){ctx.beginPath();ctx.moveTo(LEFT+x*CELL,TOP);ctx.lineTo(LEFT+x*CELL,TOP+HEIGHT*CELL);ctx.stroke();}
    for(let y=0;y<=HEIGHT;y++){ctx.beginPath();ctx.moveTo(LEFT,TOP+y*CELL);ctx.lineTo(LEFT+WIDTH*CELL,TOP+y*CELL);ctx.stroke();}
    const x=Math.floor((input.mouse[0]-LEFT)/CELL),y=Math.floor((input.mouse[1]-TOP)/CELL);
    if(editable()&&editor.board.inBounds(x,y)){
      const placement=editor.preview(brush,x,y);
      ctx.beginPath();ctx.rect(LEFT,TOP,WIDTH*CELL,HEIGHT*CELL);ctx.clip();
      for(const c of placement.cells)piece(c.piece,LEFT+c.x*CELL,TOP+c.y*CELL,placement.target?6:undefined,.55);
      const w=placement.target?PATTERNS[brush.pattern][0].length:1,h=placement.target?PATTERNS[brush.pattern].length:1;
      ctx.strokeStyle=placement.error?'#ff7777':'#ffe569';ctx.lineWidth=2;
      ctx.strokeRect(LEFT+x*CELL+1,TOP+y*CELL+1,w*CELL-2,h*CELL-2);
    }
    ctx.restore();
  }
  function piece(p:number,x:number,y:number,tile?:number,alpha=1):void {
    drawPiece(ctx,images,p,x,y,tile,alpha);
  }
  /** Outlined text from its top: the game font at 24px and up, bold Dialog below. */
  function text(value:string,x:number,y:number,size=14,fill='#fff6d4',center=false,alpha?:number):void {
    drawGameText(ctx,value,x,y,{px:size,family:size>=24?'game':'dialog',bold:true,fill,align:center?'center':'left',alpha});
  }
  function draw(now:number):void {
    screen.blit(images.get('background'),0,0);
    const scene=game.scenes[0]??game.snapshot();
    drawBoard(ctx,images,game,showLanding);
    const next=game.board.next;
    if(next&&!editing){piece(oriented(next[0],1),7,14);piece(oriented(next[1],5),41,14);}
    // The scale is adjustable because live performance thresholds vary by ocean.
    const performance=indicatorStep(game.performance.value,liveSettings.indicatorMax);
    const level=Math.round(performance/20*6);
    const frame=performance?Math.floor(now/(1000/(20*performance/20)))%7:0;
    ctx.drawImage(images.get(`feedback${level}`),frame*42,0,42,42,389,14,42,42);
    text('SAILING',225,10,24,'#ffec9b',true);
    text(`D${liveSettings.difficulty}`,24,373,14);
    // As in the game: up to nine stars stacked from the bottom; progress spans difficulty+1 boards.
    const boardsPerCycle=liveSettings.difficulty+1, targets=Math.max(1,game.board.targets.length);
    const percent=Math.trunc(((game.boards%boardsPerCycle)*targets+targets-game.board.remaining)*100/(boardsPerCycle*targets));
    const stars=Math.min(9,boardsPerCycle), total=percent*stars, full=Math.trunc(total/100), part=total%100;
    for(let i=0;i<stars;i++){
      const tile=i<full?2:i===full&&part>0?1:0;
      ctx.drawImage(images.get('stars'),tile*21,0,21,21,30,405+(8-i)*19,21,21);
    }
    if(liveSettings.tokens){
      text('Tokens',400,70,12,'#fff3b1',true);
      BONUS_SETS[liveSettings.tokens].forEach((token,i)=>{
        const y=92+i*59;
        if(token===liveSettings.desired){ctx.strokeStyle='#ffe569';ctx.lineWidth=2;ctx.strokeRect(382,y-2,42,53);}
        ctx.drawImage(images.get('bonus_background'),0,0,60,50,382,y,40,34);
        ctx.drawImage(images.get('bonus'),token*CELL,0,CELL,CELL,385,y,34,34);
        text(String(game.tokenUnits[token]),403,y+34,12,'#fff3b1',true);
      });
    }
    if(scene.chain){
      const {label,bonus}=feedbackText(scene);
      // Chains are yellow and grow with the chain; target and long-line text is white.
      const chained=scene.chain>1;
      if(label)text(label,224,260,gameFont(chained?scene.chain-1:Math.max(0,(scene.size??1)-1)),chained?TEXT_YELLOW:TEXT_WHITE,true);
      if(bonus)text(bonus,224,310,gameFont(1),TEXT_WHITE,true);
    }
    if(message&&now<messageUntil)text(message,224,340,18,'#fff3b1',true);
    if(scene.message)text(scene.message,224,265,gameFont(1),TEXT_WHITE,true);
    if(creating()&&editing)drawEditor();
    if(creating()&&!editing&&game.message)text(game.message,224,340,17,'#fff3b1',true);
    if(!running&&!finished){ctx.fillStyle='rgba(22,18,12,.55)';ctx.fillRect(LEFT,TOP,272,544);const box=drawPauseLabel(ctx,liveCreate?'Build a sailing board':'Ready to sail',224,250,272);text(liveCreate?'Press Start to edit your board':'Press Start to begin',224,box.y+box.h+6,18,'#fff3b1',true);}
    if(pause.paused){ctx.fillStyle='rgba(18,15,9,.65)';ctx.fillRect(LEFT,TOP,272,544);drawPauseLabel(ctx,'Paused',224,TOP+272,272);}
  }
  function frame(events:InputEvent[]):void {
    if(editable()){editInput(events);draw(ticks());return;}
    const resumed=pause.input(events,'sailing',running);
    if(!resumed){resetInput();draw(ticks());return;}
    const liveCommands=replays.isPlaying?[]:commands.splice(0);
    if(!creating())for(const command of liveCommands)replays.command(command);
    const routed=creating()?{events:resumed,commands:[],renderOnly:false}:replays.frame(resumed,input.mouse,ticks());
    if(routed.renderOnly){draw(ticks());return;}
    const now=ticks(), delta=Math.max(0,now-lastAt);lastAt=now;
    if(running){
      game.performance.advance(elapsed());
      // Elapsed time belongs to the previous input state, before this frame's key changes.
      const previousPair=game.active;
      if(timeUp)game.playOut(delta);
      else game.step(delta,fast||now<fastUntil);
      // The game starts every new pair at normal speed, even while Space remains held.
      if(game.active!==previousPair||game.isLanding){fast=false;fastUntil=0;}
      for(const command of [...liveCommands,...routed.commands])action(command);
      for(const event of routed.events){
        if(event.type!=='keydown'&&event.type!=='keyup')continue;
        for(const binding of KEYS){
          if(!key(event.key,binding.id,binding.defaultKey))continue;
          if(event.type==='keydown'){
            held.add(binding.id);repeats.set(binding.id,now+REPEAT_DELAY_MS);
            if(binding.id==='drop'){if(!game.release())fast=true;}else action(binding.id);
          }else{held.delete(binding.id);repeats.delete(binding.id);if(binding.id==='drop')fast=false;}
        }
      }
      for(const id of ['left','right'])if(held.has(id)&&now>=(repeats.get(id)??Infinity)){
        action(id);repeats.set(id,now+REPEAT_INTERVAL_MS);
      }
      if(!timeUp)game.step(0,fast||now<fastUntil);
      const scene=game.scenes[0];
      if(scene!==lastScene&&scene){
        if(scene.cleared)sounds.play(scene.kind==='platform'?'platform_destroy':'piece_destroy');
        if(scene.message)sounds.play('board_cleared');
        lastScene=scene;
      }
      if(game.moves!==lastMoves){sounds.play('piece_drop');lastMoves=game.moves;}
      if(game.boards!==lastBoards||game.booches!==lastBooches){
        if(game.booches!==lastBooches){message=game.message;messageUntil=now+1800;sounds.play('booched');}
        lastBoards=game.boards;lastBooches=game.booches;
      }
      // Time's up: no more moves, and the session ends once the board has settled.
      if(!creating()&&liveSettings.timerMs&&elapsed()>=liveSettings.timerMs)timeUp=true;
      if(timeUp&&!game.busy)end('Time up');
    }
    if(!replays.isSeeking&&!replays.isAdvancing)draw(now);
  }

  panel.clock(()=>!creating()&&(running||finished)?{label:liveSettings.timerMs?'Time left':'Time',ms:liveSettings.timerMs?Math.max(0,liveSettings.timerMs-elapsed()):elapsed(),countdown:!!liveSettings.timerMs}:null);
  const session=panel.session();
  session.select('Mode',[{value:'Normal',label:'Normal'},{value:'Create',label:'Freeplay'}],()=>mode,value=>{mode=value;store.set('mode',mode);preview();},{disabled:busy});
  session.button('Start',()=>{if(replays.isPlaying)replays.stop();if(running)end('Stopped');else start();},{variant:'primary',label:()=>running&&!replays.isPlaying?'Stop':'Start'});
  panel.group(undefined,{hidden:()=>creating()&&editing}).button('Pause',()=>{if(running&&!replays.isPlaying&&!editing)pause.toggle();},{label:()=>pause.paused?'Resume':'Pause',disabled:()=>!running||replays.isPlaying||editing});
  const create=panel.group('Freeplay board',{hidden:()=>!creating()});
  create.button('Play board',playDraft,{variant:'primary',disabled:()=>!editable()});
  create.button('Back to editor',editDraft,{disabled:()=>!creating()||!running||editing});
  const editorControls=panel.group('Board tools',{hidden:()=>!creating()||!editing});
  const editDisabled=()=>!editable();
  editorControls.select<CreateTool>('Tool',[{value:'platform',label:'Platform'},{value:'pair',label:'Joined pair'},{value:'single',label:'Single piece'},{value:'blocker',label:'Blocker (fixed piece)'},{value:'erase',label:'Eraser'}],()=>brush.tool,value=>{brush.tool=value;},{disabled:editDisabled});
  editorControls.select('Platform pattern',PATTERNS.map((rows,value)=>({value,label:`${value+1} · ${rows.map(row=>row.map(p=>p===EMPTY?'·':['R','B','W'][p/8]).join('')).join(' / ')}`})),()=>brush.pattern,value=>{brush.pattern=value;},{hidden:()=>brush.tool!=='platform',disabled:editDisabled});
  editorControls.note(()=>'Pattern key: R = yellow rope, B = blue water, W = white wind, · = empty. Hover over the board to preview.',{hidden:()=>brush.tool!=='platform'});
  editorControls.select('Colour',COLOURS,()=>brush.colour,value=>{brush.colour=value;},{hidden:()=>brush.tool==='platform'||brush.tool==='erase',disabled:editDisabled});
  editorControls.select('Second colour',COLOURS,()=>brush.secondColour,value=>{brush.secondColour=value;},{hidden:()=>brush.tool!=='pair',disabled:editDisabled});
  editorControls.select('Second half',[{value:1,label:'Right →'},{value:3,label:'Below ↓'},{value:5,label:'Left ←'},{value:7,label:'Above ↑'}],()=>brush.direction,value=>{brush.direction=value;},{hidden:()=>brush.tool!=='pair',disabled:editDisabled});
  editorControls.button('Undo',()=>{if(editable()){editor.undo();saveDraft();}},{disabled:()=>!editable()||!editor.canUndo});
  editorControls.button('Redo',()=>{if(editable()){editor.redo();saveDraft();}},{disabled:()=>!editable()||!editor.canRedo});
  editorControls.button('Clear board',()=>{if(editable()){editor.clear();saveDraft();}},{disabled:editDisabled});
  panel.score('Score',{hidden:()=>creating()&&editing}).stats(['','Now'],()=>[['Points / pair',game.efficiency.toFixed(2)]]);
  const tokenStats=panel.group('Maneuver practice',{hidden:()=>!settings.tokens||(creating()&&editing)});
  tokenStats.stats(['Shape','Matches','Units'],()=>BONUS_SETS[liveSettings.tokens].map(token=>[BONUS_NAMES[token],String(game.tokenMatches[token]),String(game.tokenUnits[token])]));
  tokenStats.hint(()=>'One unit per match, two from chain step 3 onward. These count your contribution; a ship maneuver also needs the other duty stations.');
  const disabled=()=>!running||editing||pause.paused||replays.isPlaying||!game.active;
  const moveOptions={hidden:()=>creating()&&editing};
  panel.controlSettings.group('Move',moveOptions).button('← Left',()=>queue('left'),{disabled}).button('Right →',()=>queue('right'),{disabled});
  panel.controlSettings.group('Rotate',moveOptions).button('↻ Clockwise',()=>queue('cw'),{disabled}).button('↺ Counterclockwise',()=>queue('ccw'),{disabled});
  panel.controlSettings.group(undefined,moveOptions).button('Fall faster',()=>queue('drop'),{disabled});
  const options=panel.settings.group('Game');
  options.select('Difficulty',DIFFICULTIES,()=>settings.difficulty,value=>{settings.difficulty=value;save();preview();},{disabled:busy});
  options.select('Tokens',TOKENS,()=>settings.tokens,value=>{settings.tokens=value;save();preview();},{disabled:busy});
  options.select('Timer',TIMER,()=>settings.timerMs,value=>{settings.timerMs=value;save();},{disabled:busy});
  options.select('Requested shape',[{value:-1,label:'No request'},...[1,2,3,4,7].map(value=>({value,label:BONUS_NAMES[value]}))],()=>settings.desired,value=>{settings.desired=value;save();preview();},{disabled:busy});
  options.toggle('Landing preview',()=>showLanding,on=>{showLanding=on;store.set('landingPreview',on);});
  options.hint(()=>'Difficulty stays at your selected level across boards. Token practice puts one shape on every pair, using the game’s selected token pool.');
  const approximations=panel.settings.group('Approximations');
  approximations.number('Top indicator threshold (approx.)',()=>settings.indicatorMax,value=>{settings.indicatorMax=value;save();preview();},{min:1,max:1000,step:0.01,disabled:busy});
  approximations.hint(()=>'The indicator uses the game’s default threshold curve (top 7.48 points/pair), which may differ from live play. Reports use Learning until live ratings are verified. Token availability is forced for practice; ship maneuver conversion is not simulated.');
  panel.controls('sailing',KEYS);
  historyGroup(panel,history,[{label:'Points / pair',value:g=>g.score.toFixed(2)},{label:'Chain',value:g=>String(g.chain)},{label:'Token units',value:g=>String(g.tokens)}],'Past games',{
    available:g=>typeof g.replayAt==='number'&&(replays?.hasPlayableAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined)??false),
    play:g=>{if(typeof g.replayAt==='number')void replays.playAt(g.replayAt,typeof g.replayId==='string'?g.replayId:undefined);},
  });
  panel.results(()=>finished&&!running&&!hold.holding?{title:'Sailing results',report:duty.last,rows:[
    ['Points / pair',game.efficiency.toFixed(2)],['Points',String(game.points)],['Pairs',String(game.moves)],
    ['Boards cleared',String(game.boards)],['Longest chain',String(game.longestChain)],['Token units',String(game.tokenUnits.reduce((a,b)=>a+b,0))],
  ]}:null);
  const codec:ReplaySettingsCodec={currentVersion:1,simulatorVersion:1,migrate:(version,value)=>version===1?readSettings(value):null};
  replays=new ReplayRecorder('sailing',store,panel,ticks,tape=>{
    savedSettings??={...settings};settings=readSettings(tape.settings)!;start(tape.seed as number,false);
  },()=>{
    running=false;finished=false;timeUp=false;resetInput();commands=[];duty.clear();
    if(savedSettings){settings=savedSettings;savedSettings=null;}preview();
  },validSeed,setReplayTime,()=>frame([]),codec,()=>!running||replays.isPlaying);
  replays.setStopLive(()=>{if(running)end('Stopped');});
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver=()=>{savedSettings=null;};
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint=()=>stateText(game,running,finished,startAt,endAt,fast,fastUntil,[...held],[...repeats]);
  function preview():void {if(!running){liveSettings={...settings};liveCreate=mode==='Create';editing=liveCreate;game=new SailingGame(settings,42);if(liveCreate)showDraft();finished=false;}}
  preview();
  const blur=()=>{resetInput();if(running&&!editing&&!replays.isPlaying&&!pause.paused)pause.toggle();};
  window.addEventListener('blur',blur);
  return {frame,dispose:()=>{if(running)end('Stopped');window.removeEventListener('blur',blur);replays.dispose();sounds.dispose();}};
}) satisfies PuzzleFactory;

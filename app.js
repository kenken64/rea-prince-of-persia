import {NativeRenderer,ROOM_WIDTH,ROOM_HEIGHT} from './native-renderer.js?v=guards-20261015';
const $ = s => document.querySelector(s);
const canvas = $('#game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
let game, campaign, actors, nativeTiles, palettes, renderer, started = false, paused = false, ready = false;
let camera = 8, cameraTick = -1, cameraRoom = null;
let fullRoom = true;
let selectedRoom = 1, keyboard = 0, touch = 0, lastTime = 0, accumulator = 0, lastRoom = 0;
const names = ['Empty','Floor','Spikes','Pillar','Gate','Stuck plate','Closing plate','Tapestry','Pillar base','Pillar top','Potion','Loose floor','Tapestry top','Mirror','Rubble','Opening plate','Exit left','Exit right','Chopper','Torch','Wall','Skeleton','Sword','Balcony','Lattice pillar','Lattice support','Small lattice','Lattice left','Lattice right','Torch rubble'];
const stateNames = ['STANDING','RUNNING','CROUCHING','JUMPING','FALLING','HANGING','CLIMBING','HURT','FALLEN','SWORD READY','ATTACKING','DRINKING','LEVEL COMPLETE','LOWERING','RELEASING'];
const g = (name, ...args) => game[`game_${name}`](...args);
const levelData = () => campaign.levels[ready ? g('get_level') : 0];
const roomData = room => levelData().rooms.find(r => r.id === room);
const rawAt = (room, pos, live) => live && ready ? g('get_tile', room, pos) : (roomData(room)?.tiles_raw[pos] ?? 0);


function roomDraw(c,room,live=false,tick=0){renderer.drawRoom(c,room,live,tick);renderer.drawObjects(c,room,live,tick);}
function draw() {
  const tick=ready?g('get_tick'):0,room=ready?g('get_room'):1;
  const world=renderer.world,w=world.getContext('2d');w.imageSmoothingEnabled=false;
  roomDraw(w,room,true,tick);
  if(ready)for(let i=0;i<g('get_effect_count');i++)if(g('get_effect_value',i,0)&&g('get_effect_value',i,1)===room)renderer.drawLooseFloor(w,g('get_effect_value',i,2),g('get_effect_value',i,3));
  if(ready&&g('get_guard_visible',room))renderer.drawActor(w,g('get_guard_render_x',room),g('get_guard_render_y',room),g('get_guard_facing',room),g('get_guard_state',room),g('get_guard_animation',room),true,g('get_guard_native_frame',room));
  if(ready&&(!g('get_player_invulnerable')||tick%8<5))renderer.drawActor(w,g('get_player_render_x'),g('get_player_render_y'),g('get_player_facing'),g('get_player_state'),g('get_player_animation'),false,g('get_player_native_frame'));
  // Display profile: crop8 overscan lines from each end of the native240-line image.
  ctx.save();ctx.translate(0,-8);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,240);
  // Bank5 $87E9..$884E: clamp scroll8..80, approach by4px/update.
  const actorX=g('get_player_render_x');
  const desired=Math.max(8,Math.min(80,(actorX&~3)-120));
  const scene=`${g('get_level')}:${room}`;
  if(cameraRoom!==scene||tick<cameraTick){camera=desired;cameraRoom=scene;}
  else if(tick!==cameraTick)camera+=Math.sign(desired-camera)*Math.min(Math.abs(desired-camera),4*Math.min(6,Math.max(1,tick-cameraTick)));
  cameraTick=tick;
  // Full-room view keeps every column visible without changing world geometry.
  ctx.drawImage(world,fullRoom?0:camera,0,canvas.width,208,0,0,canvas.width,208);
  if(ready){
    // HUD glyph source remains unresolved. These pixel icons are reconstructed
    // at the original PPU coordinates, using original background palette3.
    const healthRows=[0,64,112,124,126,124,112,64];
    const healthIcon=(x,y,filled,guard=false)=>{
      ctx.fillStyle=renderer.colors(false,3)[guard?2:1];
      for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++)if(healthRows[yy]&(1<<(7-xx))){
        const interior=yy>0&&yy<7&&xx>0&&xx<7&&(healthRows[yy-1]&(1<<(7-xx)))&&(healthRows[yy+1]&(1<<(7-xx)))&&(healthRows[yy]&(1<<(8-xx)))&&(healthRows[yy]&(1<<(6-xx)));
        if(filled||!interior)ctx.fillRect(x+(guard?7-xx:xx),y+yy,1,1);
      }
    };
    for(let i=0;i<g('get_max_health');i++)healthIcon(16+i*8,216,i<g('get_health'));
    if(g('get_guard_active',room))for(let i=0;i<g('get_guard_health',room);i++)healthIcon(canvas.width-16-i*8,216,true,true);
    if(g('get_flags')&1){ctx.fillStyle='#000c';ctx.fillRect(canvas.width/2-103,78,206,68);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='10px monospace';ctx.fillText('PRESS R TO RESTART',canvas.width/2,113);ctx.textAlign='start';}
    if(g('get_flags')&4){ctx.fillStyle='#000d';ctx.fillRect(canvas.width/2-103,78,206,68);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='10px monospace';ctx.fillText('THE PALACE AWAITS',canvas.width/2,113);ctx.textAlign='start';}
  }
  ctx.restore();
}

function refreshHud() {
  if(!ready)return;
  const level=g('get_level'),room=g('get_room'),sec=g('get_time_left');
  $('#timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  $('#health').textContent=Array.from({length:g('get_max_health')},(_,i)=>i<g('get_health')?'♥':'♡').join(' ');
  $('#room-label').textContent=`LEVEL ${String(level+1).padStart(2,'0')} / ROOM ${String(room).padStart(2,'0')}`;
  $('#level-badge').textContent=`${String(level+1).padStart(2,'0')} / 14`;
  $('.panel-title h2').textContent=g('get_theme')?'The palace':'The dungeon';
  $('#game-status').textContent=!started?'READY WHEN YOU ARE':paused?'JOURNEY PAUSED':g('get_flags')&1?'THE PRINCE HAS FALLEN':'THE JOURNEY CONTINUES';
  $('#runtime-state').textContent=!started?'C / WASM · READY':`${stateNames[g('get_player_state')]??'EXPLORING'} · ${g('get_has_sword')?'SWORD EQUIPPED':'FIND YOUR SWORD'}`;
  if($('#level-select').value!==String(level)){$('#level-select').value=String(level);selectedRoom=room;renderMap();}
  if(lastRoom!==room){lastRoom=room;document.querySelectorAll('.room-tile').forEach(el=>el.classList.toggle('current',+el.dataset.room===room));}
}
function frame(time) {
  const dt=Math.min(100,time-(lastTime||time));lastTime=time;
  if(ready&&started&&!paused){accumulator+=dt;let steps=0;while(accumulator>=1000/60&&steps++<6){g('set_input',keyboard|touch);g('step');accumulator-=1000/60;}}
  else accumulator=0;
  if(ready){draw();refreshHud();}
  requestAnimationFrame(frame);
}
function focusGame(){canvas.focus({preventScroll:true});}
function revealGame(){
  if(!document.fullscreenElement)window.scrollTo({top:window.scrollY+$('#game-card').getBoundingClientRect().top-12,behavior:'instant'});
}
function setFullRoom(value){
  fullRoom=value;canvas.width=fullRoom?ROOM_WIDTH:256;ctx.imageSmoothingEnabled=false;
  $('#screen-wrap').style.setProperty('--game-aspect',`${canvas.width} / ${canvas.height}`);
  $('#camera-mode').textContent=fullRoom?'Full room':'Follow prince';
  $('#camera-mode').setAttribute('aria-pressed',String(fullRoom));
  $('#camera-mode').title=fullRoom?'Switch to the original scrolling camera':'Show the whole room without scrolling';
  if(ready)draw();
}
function setPause(value){if(!started)return;paused=value;g('set_paused',+paused);$('#pause').textContent=paused?'▶ Resume':'Ⅱ Pause';$('#screen-wrap').classList.toggle('paused',paused);keyboard=touch=0;}
function start(){if(!ready)return;started=true;$('#game-overlay').hidden=true;$('#pause').disabled=$('#restart').disabled=false;setPause(false);revealGame();focusGame();}
$('#start').addEventListener('click',start);
$('#pause').addEventListener('click',()=>{setPause(!paused);focusGame();});
$('#restart').addEventListener('click',()=>{g('reset');setPause(false);focusGame();});
$('#camera-mode').addEventListener('click',()=>{setFullRoom(!fullRoom);if(started)revealGame();focusGame();});
$('#fullscreen').addEventListener('click',async()=>{
  if(document.fullscreenElement)await document.exitFullscreen();else await $('#game-card').requestFullscreen?.();focusGame();
});
document.addEventListener('fullscreenchange',()=>{
  const label=document.fullscreenElement?'Exit full screen':'Enter full screen';
  $('#fullscreen').title=label;$('#fullscreen').setAttribute('aria-label',label);
  if(!document.fullscreenElement&&started)revealGame();
});
window.addEventListener('resize',()=>{
  const card=$('#game-card').getBoundingClientRect();
  if(started&&card.bottom>0&&card.top<innerHeight)revealGame();
});
const keyMap={ArrowLeft:1,KeyA:1,ArrowRight:2,KeyD:2,ArrowUp:4,KeyW:4,ArrowDown:8,KeyS:8,Space:16,ShiftLeft:32,ShiftRight:32,KeyX:32,KeyR:64};
window.addEventListener('keydown',e=>{
  const active=document.activeElement;if(active?.tagName==='SELECT'||active?.tagName==='INPUT'||active?.tagName==='TEXTAREA')return;
  if(keyMap[e.code]&&(started||active===canvas)){e.preventDefault();keyboard|=keyMap[e.code];}
  if(e.code==='KeyP'&&started&&!e.repeat){e.preventDefault();setPause(!paused);}
  if(e.code==='Enter'&&!started&&ready){e.preventDefault();start();}
});
window.addEventListener('keyup',e=>{if(keyMap[e.code])keyboard&=~keyMap[e.code];});
window.addEventListener('blur',()=>{keyboard=touch=0;if(started)setPause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keyboard=touch=0;if(started)setPause(true);}});
document.querySelectorAll('[data-key]').forEach(button=>{
  const bit=+button.dataset.key;
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(!started)start();button.setPointerCapture(e.pointerId);touch|=bit;});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>{touch&=~bit;});
});

function renderMap() {
  if(!campaign)return;
  const data=levelData();$('#map-level-label').textContent=`LEVEL ${String(data.number).padStart(2,'0')} · ${data.theme.toUpperCase()}`;
  const grid=$('#room-grid');grid.replaceChildren();
  for(const room of data.rooms){
    const b=document.createElement('button');b.className=`room-tile${room.id===selectedRoom?' selected':''}${!room.present?' absent':''}${ready&&g('get_room')===room.id?' current':''}`;b.dataset.room=room.id;b.setAttribute('aria-label',`Inspect room ${room.id}${room.present?'':' (empty)'}`);
    const label=document.createElement('span');label.textContent=`ROOM ${String(room.id).padStart(2,'0')}`;b.append(label);
    const mini=document.createElement('canvas');mini.width=ROOM_WIDTH;mini.height=ROOM_HEIGHT;const c=mini.getContext('2d');c.imageSmoothingEnabled=false;roomDraw(c,room.id,false);b.append(mini);
    b.addEventListener('click',()=>{selectedRoom=room.id;renderMap();});grid.append(b);
  }
  renderInspector();
}
function renderInspector(){
  const room=roomData(selectedRoom);if(!room)return;
  $('#inspect-title').textContent=`ROOM ${String(room.id).padStart(2,'0')}${room.id===levelData().start.room?' · START':''}`;
  const c=$('#room-preview').getContext('2d');roomDraw(c,room.id,false);
  const ofs=room.file_offset?.toString(16).toUpperCase();
  $('#inspect-data').textContent=room.present?`ROM $${ofs} · ${room.encoded_length} BYTES · ${room.tiles_raw.filter(t=>(t&31)===4).length} GATES`:'EMPTY ROOM · ORIGINAL $FF MARKER';
  const links=room.links??{};$('#inspect-links').replaceChildren();
  for(const [i,key] of ['left','right','up','down'].entries()){
    const target=Array.isArray(links)?links[i]:links[key];const s=document.createElement('span');s.textContent=`${['←','→','↑','↓'][i]} ${target||'—'}`;$('#inspect-links').append(s);
  }
  $('#visit-room').disabled=!room.present;
}
$('#visit-room').addEventListener('click',()=>{
  const data=roomData(selectedRoom);if(!data?.present)return;
  let pos=data.tiles_raw.findIndex(t=>![0,9,12,20,25,26,27,28,30,31].includes(t&31));if(pos<0)pos=0;
  g('set_player',selectedRoom,(pos%10)*32+16,Math.floor(pos/10)*64+56,1);g('set_health',g('get_max_health'));start();
});
$('#level-select').addEventListener('change',()=>{g('select_level',+$('#level-select').value);selectedRoom=g('get_room');lastRoom=0;renderMap();if(started){setPause(false);focusGame();}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));
  for(const name of ['map','graphics','code'])$(`#${name}-panel`).hidden=name!==b.dataset.tab;
  if(b.dataset.tab==='graphics')renderActorAtlas();
}));
function renderActorAtlas(){
  const target=$('#actor-atlas'),c=target.getContext('2d');c.imageSmoothingEnabled=false;c.fillStyle='#000';c.fillRect(0,0,target.width,target.height);
  const frames=actors.frames.filter(f=>f.actor==='prince'&&f.pixels?.length);
  [15,0,1,2,3,4,5,6,7,8,9,10].forEach((id,i)=>{const f=frames.find(f=>f.frame_index===id);if(!f)return;c.drawImage(renderer.frameImage(f),8+(i%6)*62,8+Math.floor(i/6)*75);c.fillStyle='#aaa';c.font='7px monospace';c.fillText(`FRAME ${id}`,8+(i%6)*62,72+Math.floor(i/6)*75);});
  const n=$('#native-atlas').getContext('2d');n.imageSmoothingEnabled=false;n.fillStyle='#000';n.fillRect(0,0,384,480);
  const theme=renderer.theme();theme.tiles.filter(t=>t.pixels?.length).forEach((t,i)=>{
    const image=document.createElement('canvas');image.width=t.width;image.height=t.height;const tc=image.getContext('2d'),data=tc.createImageData(t.width,t.height);
    const colors=renderer.colors(false,t.type===20?1:0);
    for(let k=0;k<t.pixels.length;k++)if(t.write_mask[k]&&t.pixel_known_mask?.[k]!==0){const color=colors[t.pixels[k]];data.data[k*4]=parseInt(color.slice(1,3),16);data.data[k*4+1]=parseInt(color.slice(3,5),16);data.data[k*4+2]=parseInt(color.slice(5,7),16);data.data[k*4+3]=255;}
    tc.putImageData(data,0,0);const x=(i%6)*64,y=Math.floor(i/6)*96;n.drawImage(image,x,y);n.fillStyle='#aaa';n.font='7px monospace';n.fillText(`TYPE ${t.type}`,x,y+89);
  });
}

async function boot(){
  const [wasmResponse,levelsJson,actorsJson,paletteJson,nativeJson,animationJson]=await Promise.all([fetch('game.wasm?v=guards-20261015'),fetch('assets/levels.json').then(r=>r.json()),fetch('assets/actor-frames.json').then(r=>r.json()),fetch('assets/palettes.json').then(r=>r.json()),fetch('assets/native-metatiles.json').then(r=>r.json()),fetch('assets/background-animations.json').then(r=>r.json())]);
  if(!wasmResponse.ok)throw new Error(`Wasm fetch returned ${wasmResponse.status}`);
  const {instance}=await WebAssembly.instantiate(await wasmResponse.arrayBuffer(),{});
  game=instance.exports;campaign=levelsJson;actors=actorsJson;palettes=paletteJson;nativeTiles=nativeJson;
  renderer=new NativeRenderer(nativeTiles,palettes,actors,campaign,game,animationJson);
  g('init');ready=true;
  const select=$('#level-select');for(const level of campaign.levels){const o=document.createElement('option');o.value=level.level_index;o.textContent=`Level ${String(level.number).padStart(2,'0')} · ${level.theme==='palace'?'Palace':'Dungeon'}`;select.append(o);}select.disabled=false;
  $('#start').disabled=false;selectedRoom=g('get_room');renderMap();draw();refreshHud();
  // Exposed only for reproducible browser QA and console exploration.
  window.popStudy={game,campaign,actors,renderer,get ready(){return ready;},start,draw,renderMap,get started(){return started;}};
  requestAnimationFrame(frame);
}
$('#start').disabled=true;
boot().catch(error=>{console.error(error);$('#runtime-state').textContent='The game could not load. Serve this folder over HTTP.';$('#game-status').textContent='LOAD ERROR';$('#start').textContent='Unable to load';});

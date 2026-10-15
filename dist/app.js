const $ = s => document.querySelector(s);
const canvas = $('#game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
const WIDTH = 240, HEIGHT = 192, OX = 8, OY = 24;
let game, campaign, actors, textures, nativeTiles, started = false, paused = false, ready = false;
let selectedRoom = 1, keyboard = 0, touch = 0, lastTime = 0, accumulator = 0, lastRoom = 0;
const spriteCache = new Map(), textureCache = new Map();
const paletteActor = ['#000000', '#372d37', '#c99875', '#efe5ce'];
const paletteGuard = ['#000000', '#342c40', '#ce9674', '#8969af'];
const dungeon = { background:'#090e18', mortar:'#101c2a', brick:'#243b55', light:'#405c77', edge:'#7a94a6', floor:'#586d80', shade:'#142438', accent:'#b4ac91', texture:['#101c2a','#243b55','#405c77','#6b8197'] };
const palace = { background:'#120f1c', mortar:'#221c2c', brick:'#4e3c57', light:'#72566f', edge:'#b39298', floor:'#8d7582', shade:'#36293d', accent:'#d6bc8f', texture:['#221c2c','#4e3c57','#72566f','#b39298'] };
const names = ['Empty','Floor','Spikes','Pillar','Gate','Stuck plate','Closing plate','Tapestry','Pillar base','Pillar top','Potion','Loose floor','Tapestry top','Mirror','Rubble','Opening plate','Exit left','Exit right','Chopper','Torch','Wall','Skeleton','Sword','Balcony','Lattice pillar','Lattice support','Small lattice','Lattice left','Lattice right','Torch rubble'];
const stateNames = ['STANDING','RUNNING','CROUCHING','JUMPING','FALLING','HANGING','CLIMBING','HURT','FALLEN','SWORD READY','ATTACKING','DRINKING','LEVEL COMPLETE'];
const g = (name, ...args) => game[`game_${name}`](...args);
const levelData = () => campaign.levels[ready ? g('get_level') : 0];
const roomData = room => levelData().rooms.find(r => r.id === room);
const rawAt = (room, pos, live) => live && ready ? g('get_tile', room, pos) : (roomData(room)?.tiles_raw[pos] ?? 0);
const currentTheme = () => levelData()?.theme_raw ? palace : dungeon;

function indexedImage(id, pixels, w, h, palette, transparent = true, mask = null) {
  const key = `${id}:${palette.join()}:${transparent}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const image = document.createElement('canvas'); image.width = w; image.height = h;
  const c = image.getContext('2d'), data = c.createImageData(w, h);
  for (let i = 0; i < pixels.length; i++) {
    const color = palette[pixels[i]] ?? '#ff00ff';
    data.data[i*4] = parseInt(color.slice(1,3),16); data.data[i*4+1] = parseInt(color.slice(3,5),16); data.data[i*4+2] = parseInt(color.slice(5,7),16);
    data.data[i*4+3] = mask ? (mask[i] ? 255 : 0) : transparent && pixels[i] === 0 ? 0 : 255;
  }
  c.putImageData(data,0,0); spriteCache.set(key,image); return image;
}
function texture(name, theme) {
  const item = textures?.visual_candidates?.find(x => x.id === name);
  return item ? indexedImage(`texture:${name}`,item.pixels,item.width,item.height,theme.texture,false) : null;
}
function nativeTile(type, theme) {
  const themeId=theme===palace?'palace':'dungeon';
  const item=nativeTiles?.themes.find(t=>t.id===themeId)?.tiles.find(t=>t.type===type);
  if(!item)return null;
  return {item,image:indexedImage(`native:${themeId}:${type}`,item.pixels,item.width,item.height,theme.texture,false,item.write_mask)};
}
function brick(c,x,y,w,h,p) {
  c.fillStyle=p.mortar;c.fillRect(x,y,w,h);
  for(let r=0;r<Math.ceil(h/16);r++) {
    const yy=y+r*16, offset=(r&1)?-12:0;
    for(let k=-1;k<Math.ceil(w/24)+1;k++) {
      const xx=x+k*24+offset, left=Math.max(x,xx+1), right=Math.min(x+w,xx+24);
      if(right<=left)continue;
      c.fillStyle=p.brick;c.fillRect(left,yy+1,right-left,Math.min(14,y+h-yy-1));
      c.fillStyle=p.light;c.fillRect(left,yy+1,right-left,1);
      if((r+k)%3===0){c.fillStyle=p.mortar;c.fillRect(left+3,yy+8,Math.max(0,Math.min(5,right-left-3)),1);}
    }
  }
}
function floorTile(c,x,y,p,t,shake=0) {
  const yy=y+56+shake;
  c.fillStyle=p.shade;c.fillRect(x,yy,24,8);
  c.fillStyle=p.edge;c.fillRect(x,yy,24,2);
  c.fillStyle=p.floor;c.fillRect(x+1,yy+2,22,3);
  c.fillStyle=p.mortar;c.fillRect(x+2,yy+6,21,1);
  const strip=texture('surface_edge_strip',p);
  if(strip)c.drawImage(strip,x,yy);
  // Native floor composition advances 32 original pixels. The independent
  // renderer compresses horizontal room pitch to24; preserve its write mask,
  // including opaque background-color pixels, rather than treating0 as alpha.
  const recovered=nativeTile(1,p);
  if(recovered)c.drawImage(recovered.image,x,y+shake,recovered.item.width*24/32,recovered.item.height);
  if(t===11){c.fillStyle=p.background;c.fillRect(x+8,yy,1,2);c.fillRect(x+9,yy+2,5,1);}
}
function roomDraw(c,room,live=false,tick=0) {
  const p=currentTheme();c.fillStyle=p.background;c.fillRect(0,0,WIDTH,HEIGHT);
  // Background composition is independent; the room tiles and graphic pixels
  // are recovered data. This renderer does not claim original NES metatiles.
  for(let pos=0;pos<30;pos++) {
    const raw=rawAt(room,pos,live),t=raw&31,x=(pos%10)*24,y=Math.floor(pos/10)*64;
    if(t===20){brick(c,x,y,24,64,p);continue;}
    const noFloor=[0,9,12,25,26,27,28,30,31].includes(t);
    if(!noFloor){
      const loose=live?g('get_tile_state',room,pos):-1;
      floorTile(c,x,y,p,t,t===11&&loose>0?Math.sin(tick*2)*1:0);
    }
    if([3,8,9,24,25].includes(t)) {
      c.fillStyle=p.shade;c.fillRect(x+13,y,8,56);c.fillStyle=p.light;c.fillRect(x+14,y,3,56);c.fillStyle=p.brick;c.fillRect(x+18,y,2,56);
      c.fillStyle=p.edge;c.fillRect(x+10,y+5,13,3);c.fillRect(x+11,y+50,11,3);
      const col=texture('column_texture_strip',p);if(col)for(let yy=12;yy<48;yy+=8)c.drawImage(col,0,0,8,8,x+13,y+yy,8,8);
    }
    if(t===4) {
      const open=live?g('get_gate',room,pos):((raw>>5)===1?64:0);
      c.fillStyle='#675e68';c.fillRect(x+1,y,3,56);c.fillRect(x+21,y,3,56);
      const bottom=Math.max(0,56-open);c.fillStyle='#96939a';
      for(let xx=6;xx<23;xx+=5)c.fillRect(x+xx,y,2,bottom);
      for(let yy=0;yy<bottom;yy+=10)c.fillRect(x+5,y+yy,18,2);
    }
    if(t===2) {c.fillStyle='#afb3bd';for(let k=0;k<5;k++){c.beginPath();c.moveTo(x+k*5,y+56);c.lineTo(x+k*5+2,y+44);c.lineTo(x+k*5+4,y+56);c.fill();}}
    if(t===6||t===15){c.fillStyle=t===15?'#baa06e':'#885b59';c.fillRect(x+4,y+53,17,3);c.fillStyle='#4a3a32';c.fillRect(x+7,y+54,2,1);}
    if(t===10) {c.fillStyle='#c6aa8a';c.fillRect(x+12,y+39,2,4);c.fillStyle=(raw>>5)===2?'#8f4b84':'#b7484d';c.fillRect(x+9,y+44,8,10);c.fillStyle='#e9b4b1';c.fillRect(x+10,y+44,2,4);c.fillStyle='#d0bb97';c.fillRect(x+10,y+42,6,2);}
    if(t===19||t===29) {
      c.fillStyle='#6d5a4a';c.fillRect(x+11,y+26,3,17);c.fillStyle='#d47738';c.fillRect(x+9,y+16,7,12);c.fillStyle='#e9b664';c.fillRect(x+11+(Math.floor(tick/7)%2),y+13,3,12);c.fillStyle='#f4d9a0';c.fillRect(x+12,y+20,2,5);
      c.fillStyle='#2e211e';c.fillRect(x+7,y+29,11,2);
    }
    if(t===16||t===17) {
      c.fillStyle='#242a31';c.fillRect(x+2,y+13,22,43);c.fillStyle=p.accent;c.fillRect(x+2,y+12,22,3);c.fillRect(x+2,y+15,3,41);
      if(t===17)c.fillRect(x+20,y+15,3,41);
      const opened=live?g('get_gate',room,pos)>45:false;
      c.fillStyle=opened?'#594b37':'#171c25';c.fillRect(x+6,y+17,14,38);
      c.fillStyle='#30353e';for(let k=0;k<5;k++)c.fillRect(x+7,y+47+k*2,13,1);
    }
    if(t===18) {
      const closed=(tick+pos*7)%100<20;c.fillStyle='#7f878b';c.fillRect(x+10,y+2,3,closed?49:21);c.fillStyle='#b8b8b5';c.fillRect(x+8,y+(closed?47:20),8,4);c.fillStyle='#9f4b43';c.fillRect(x+11,y+52,4,3);
    }
    if(t===21){c.fillStyle='#bebba6';for(let k=0;k<4;k++)c.fillRect(x+4+k*4,y+52-(k%2),3,2);c.fillRect(x+4,y+49,4,3);}
    if(t===22){c.fillStyle='#d6ddde';c.fillRect(x+6,y+49,14,2);c.fillStyle='#c4a266';c.fillRect(x+5,y+47,2,6);c.fillRect(x+2,y+49,4,2);}
    if(t===13){c.fillStyle='#a68c84';c.fillRect(x+9,y+13,12,43);c.fillStyle='#50808c';c.fillRect(x+11,y+15,8,38);c.fillStyle='#a1c5c6';c.fillRect(x+12,y+20,1,25);}
    if(t===14||t===29){c.fillStyle=p.light;for(let k=0;k<5;k++)c.fillRect(x+2+k*4,y+53-(k%3),3,2);}
    if([7,12,26,27,28].includes(t)){c.fillStyle=p.brick;for(let xx=4;xx<24;xx+=5)c.fillRect(x+xx,y+10,1,43);c.fillStyle=p.light;c.fillRect(x+3,y+10,21,2);}
  }
}

function actor(c,x,y,facing,state,animation,guard=false) {
  const frame=actors?.frames[state===1?(1+Math.floor(animation/6)%2):0];if(!frame)return;
  const image=indexedImage(frame.id,frame.pixels,16,40,guard?paletteGuard:paletteActor);
  c.save();c.translate(Math.round(x),Math.round(y));if(facing<0)c.scale(-1,1);
  if(state===8){c.rotate(-Math.PI/2);c.drawImage(image,-8,-26,16,26);}
  else if(state===2){c.drawImage(image,0,0,16,40,-8,-25,16,25);}
  else if(state===5){c.drawImage(image,-8,-30);}
  else c.drawImage(image,-8,-40);
  if(state===9||state===10){c.fillStyle='#e0e2d8';c.fillRect(4,-21,state===10?23:15,2);c.fillStyle='#c9a85c';c.fillRect(3,-24,2,8);}
  c.restore();
}

function draw() {
  const tick=ready?g('get_tick'):0, room=ready?g('get_room'):1,p=currentTheme();
  ctx.fillStyle='#070b12';ctx.fillRect(0,0,256,240);
  ctx.save();ctx.translate(OX,OY);roomDraw(ctx,room,true,tick);
  if(ready&&g('get_guard_active',room))actor(ctx,g('get_guard_x',room),g('get_guard_y',room),g('get_guard_facing',room),g('get_guard_state',room)===2?10:9,tick,true);
  if(ready){
    for(let i=0;i<g('get_effect_count');i++)if(g('get_effect_value',i,0)&&g('get_effect_value',i,1)===room){ctx.fillStyle=p.floor;ctx.fillRect(g('get_effect_value',i,2)-10,g('get_effect_value',i,3),20,5);}
    if(!g('get_player_invulnerable')||tick%8<5)actor(ctx,g('get_player_x'),g('get_player_y'),g('get_player_facing'),g('get_player_state'),g('get_player_animation'));
  }
  ctx.restore();
  ctx.font='6px monospace';ctx.fillStyle='#8b8e99';ctx.fillText('PRINCE OF PERSIA',8,13);
  ctx.fillStyle='#b49a6c';ctx.fillText(`LEVEL ${String(ready?g('get_level')+1:1).padStart(2,'0')}`,192,13);
  if(ready){
    ctx.fillStyle='#bb625a';for(let i=0;i<g('get_max_health');i++){ctx.fillStyle=i<g('get_health')?'#bb625a':'#3a303a';ctx.fillRect(9+i*10,226,6,6);ctx.fillRect(10+i*10,225,2,1);ctx.fillRect(13+i*10,225,2,1);}
    const sec=g('get_time_left');ctx.fillStyle='#a9a494';ctx.fillText(`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} LEFT`,190,231);
    if(g('get_has_sword')){ctx.fillStyle='#cdbb91';ctx.fillRect(85,228,15,1);ctx.fillRect(88,225,1,7);}
    if(g('get_flags')&1){ctx.fillStyle='#080b12c9';ctx.fillRect(25,78,206,68);ctx.fillStyle='#dfc391';ctx.textAlign='center';ctx.font='13px Georgia';ctx.fillText('The journey is not over.',128,103);ctx.font='6px monospace';ctx.fillStyle='#c3c1b8';ctx.fillText('PRESS R OR RESTART TO TRY AGAIN',128,123);ctx.textAlign='start';}
    if(g('get_flags')&4){ctx.fillStyle='#080b12df';ctx.fillRect(25,78,206,68);ctx.fillStyle='#dfc391';ctx.textAlign='center';ctx.font='13px Georgia';ctx.fillText('You have reached the palace.',128,105);ctx.textAlign='start';}
  }
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
function setPause(value){if(!started)return;paused=value;g('set_paused',+paused);$('#pause').textContent=paused?'▶ Resume':'Ⅱ Pause';$('#screen-wrap').classList.toggle('paused',paused);keyboard=touch=0;}
function start(){if(!ready)return;started=true;$('#game-overlay').hidden=true;$('#pause').disabled=$('#restart').disabled=false;setPause(false);focusGame();}
$('#start').addEventListener('click',start);
$('#pause').addEventListener('click',()=>{setPause(!paused);focusGame();});
$('#restart').addEventListener('click',()=>{g('reset');setPause(false);focusGame();});
$('#fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await $('#screen-wrap').requestFullscreen?.();focusGame();});
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
    const mini=document.createElement('canvas');mini.width=240;mini.height=192;const c=mini.getContext('2d');c.imageSmoothingEnabled=false;roomDraw(c,room.id,false);b.append(mini);
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
  g('set_player',selectedRoom,(pos%10)*24+12,Math.floor(pos/10)*64+56,1);g('set_health',g('get_max_health'));start();$('#play').scrollIntoView({behavior:'smooth'});focusGame();
});
$('#level-select').addEventListener('change',()=>{g('select_level',+$('#level-select').value);selectedRoom=g('get_room');lastRoom=0;renderMap();if(started){setPause(false);focusGame();}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));
  for(const name of ['map','graphics','code'])$(`#${name}-panel`).hidden=name!==b.dataset.tab;
  if(b.dataset.tab==='graphics')renderActorAtlas();
}));
function renderActorAtlas(){
  const c=$('#actor-atlas').getContext('2d');c.fillStyle='#0b1119';c.fillRect(0,0,384,160);actors.frames.forEach((f,i)=>{const image=indexedImage(f.id,f.pixels,16,40,paletteActor);c.drawImage(image,40+i*115,17,40,100);c.fillStyle='#a6acb3';c.font='8px monospace';c.fillText(f.id.toUpperCase(),32+i*115,139);});
  const target=$('#native-atlas');if(!target)return;const n=target.getContext('2d');n.imageSmoothingEnabled=false;n.fillStyle='#0b1119';n.fillRect(0,0,target.width,target.height);
  nativeTiles.themes.forEach((theme,row)=>{const palette=row?palace:dungeon;n.fillStyle='#b2a68f';n.font='8px monospace';n.fillText(theme.id.toUpperCase(),10,row*116+12);theme.tiles.forEach((tile,col)=>{const img=nativeTile(tile.type,palette);n.drawImage(img.image,10+col*74,row*116+20);n.fillStyle='#919ba4';n.font='7px monospace';n.fillText(`TYPE ${tile.type}`,10+col*74,row*116+109);});});
}

async function boot(){
  const [wasmResponse,levelsJson,actorsJson,textureJson,nativeJson]=await Promise.all([fetch('game.wasm'),fetch('assets/levels.json').then(r=>r.json()),fetch('assets/actors.json').then(r=>r.json()),fetch('assets/background-tiles.json').then(r=>r.json()),fetch('assets/native-metatiles.json').then(r=>r.json())]);
  if(!wasmResponse.ok)throw new Error(`Wasm fetch returned ${wasmResponse.status}`);
  const {instance}=await WebAssembly.instantiate(await wasmResponse.arrayBuffer(),{});
  game=instance.exports;campaign=levelsJson;actors=actorsJson;textures=textureJson;nativeTiles=nativeJson;
  g('init');ready=true;
  const select=$('#level-select');for(const level of campaign.levels){const o=document.createElement('option');o.value=level.level_index;o.textContent=`Level ${String(level.number).padStart(2,'0')} · ${level.theme==='palace'?'Palace':'Dungeon'}`;select.append(o);}select.disabled=false;
  $('#start').disabled=false;selectedRoom=g('get_room');renderMap();draw();refreshHud();
  // Exposed only for reproducible browser QA and console exploration.
  window.popStudy={game,campaign,actors,get ready(){return ready;},start,draw,renderMap,get started(){return started;}};
  requestAnimationFrame(frame);
}
$('#start').disabled=true;
boot().catch(error=>{console.error(error);$('#runtime-state').textContent='The game could not load. Serve this folder over HTTP.';$('#game-status').textContent='LOAD ERROR';$('#start').textContent='Unable to load';});

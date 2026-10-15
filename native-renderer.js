// Original indexed graphics, layout write masks, PPU origins and attribute rules.
// Native scroll geometry is recovered. C supplies recovered ledge frames and
// anchors together. Guard sequences are recovered; other mappings remain reconstructed.
export const ROOM_WIDTH = 360, ROOM_HEIGHT = 208;
export class NativeRenderer {
  constructor(tiles, palettes, actors, campaign, game, animations) {
    Object.assign(this,{tiles,palettes,actors,campaign,game,animations});
    this.cache=new Map();this.spriteCache=new Map();
    this.world=document.createElement('canvas');this.world.width=ROOM_WIDTH;this.world.height=ROOM_HEIGHT;
  }
  level(){return this.campaign.levels[this.game.game_get_level()];}
  palette(){return this.palettes.levels[this.game.game_get_level()];}
  colors(sprite=false,group=0){return (sprite?this.palette().sprites:this.palette().background)[group].map(i=>this.palettes.hex64[i]);}
  room(id){return this.level().rooms.find(r=>r.id===id);}
  tile(room,pos,live){return live?this.game.game_get_tile(room,pos):(this.room(room)?.tiles_raw[pos]??0);}
  theme(){return this.tiles.themes.find(t=>t.id===(this.level().theme_raw?'palace':'dungeon'));}
  variant(id){return this.theme().variants.find(t=>t.id===id);}
  roomImage(room,live=false,tick=0){
    const neighbors=this.room(room)?.links??{};
    const link=k=>Array.isArray(neighbors)?neighbors[['left','right','up','down'].indexOf(k)]:neighbors[k];
    const signature=[this.game.game_get_level(),room,live?Math.floor(tick/8):0];
    for(const id of [room,link('left'),link('up'),link('down')])if(id)for(let p=0;p<30;p++)signature.push(this.tile(id,p,live));
    if(live)for(let p=0;p<30;p++){
      const type=this.tile(room,p,true)&31;
      if(type===4)signature.push(this.game.game_get_gate(room,p));
      if(type===2)signature.push(+(this.game.game_get_tile_state(room,p)>0));
      if(type===18)signature.push(this.chomperFrame(this.game.game_get_tile_state(room,p)));
    }
    const key=signature.join(',');if(this.cache.has(key))return this.cache.get(key);
    const indices=new Uint8Array(ROOM_WIDTH*ROOM_HEIGHT),qw=Math.ceil(ROOM_WIDTH/16),attributes=new Uint8Array(qw*Math.ceil(ROOM_HEIGHT/16));
    const setAttribute=(x,y,p)=>{if(x>=0&&x<ROOM_WIDTH&&y>=0&&y<ROOM_HEIGHT)attributes[(y>>4)*qw+(x>>4)]=p;};
    let wallCounter=0;
    const paint=(item,x,y,{wall=false,top=0,bottom=80,paletteGroup=null}={})=>{
      if(!item?.pixels?.length)return;
      for(let yy=top;yy<Math.min(bottom,item.height);yy++)for(let xx=0;xx<item.width;xx++){
        const i=yy*item.width+xx,dx=x+xx,dy=y+yy;
        if(dx<0||dx>=ROOM_WIDTH||dy<0||dy>=ROOM_HEIGHT||!item.write_mask[i]||item.pixel_known_mask?.[i]===0)continue;
        indices[dy*ROOM_WIDTH+dx]=item.pixels[i];
        if(wall&&xx<32)setAttribute(dx,dy,1);
        if(paletteGroup!==null)setAttribute(dx,dy,paletteGroup);
      }
    };
    const cell=(id,pos,x,y,normal=true,clip={})=>{
      const raw=this.tile(id,pos,live),type=raw&31,modifier=raw>>5;
      const leftType=pos%10?this.tile(id,pos-1,live)&31:(this.room(id)?.links?.left?this.tile(this.room(id).links.left,pos+9,live)&31:0);
      let item=this.theme().tiles.find(t=>t.type===type);
      if(type===20&&((++wallCounter)&3)!==1)item=this.variant('wall_repeated')??item;
      if(type===13)item=this.variant('mirror_inactive_background')??item;
      if(type===12&&y<0)item=this.variant('clipped_type12')??item;
      if(type===12&&normal&&[26,27,28,29].includes(leftType))item=this.variant('left_neighbor_26_to29')??item;
      paint(item,x,y,{wall:normal&&type===20,...clip});
      if(normal&&type===0&&modifier===3)paint(this.variant('empty_modifier3_overlay'),x,y);
      if(normal&&modifier===1&&[0,1,10,11,22].includes(type))paint(this.variant('modifier1_floor_overlay'),x,y);
      if(normal){
        const belowType=pos<20?this.tile(id,pos+10,live)&31:(this.room(id)?.links?.down?this.tile(this.room(id).links.down,pos-20,live)&31:0);
        const rightType=pos%10<9?this.tile(id,pos+1,live)&31:(this.room(id)?.links?.right?this.tile(this.room(id).links.right,pos-9,live)&31:0);
        for(const overlay of this.theme().overlays??[]){
          const rule=overlay.selector_rule;
          if(rule.current_type!==type)continue;
          if(overlay.side==='left_front'?rule.left_type!==leftType:rule.below_type!==belowType||!rule.right_type_in.includes(rightType))continue;
          paint(overlay,x+overlay.origin_x,y+overlay.origin_y,{bottom:overlay.height});
        }
      }
    };
    const left=link('left'),down=link('down'),up=link('up');
    if(left)for(let row=2;row>=0;row--)cell(left,row*10+9,-16,row*64,false);
    if(down)for(let col=0;col<10;col++)cell(down,col,16+32*col,192,false,{bottom:16});
    for(const pos of this.tiles.native_layout.draw_order)cell(room,pos,16+(pos%10)*32,Math.floor(pos/10)*64);
    if(up)for(let col=0;col<10;col++)cell(up,20+col,16+32*col,-64,false);
    // AE6D/AD56 apply queued attribute updates after the static room passes.
    let torchOrdinal=0;
    for(const pos of this.tiles.native_layout.draw_order)if((this.tile(room,pos,live)&31)===19){
      const right=pos%10<9?this.tile(room,pos+1,live)&31:0;
      if(right!==18){
        const x=16+(pos%10)*32+40,y=Math.floor(pos/10)*64+16;
        setAttribute(x,y,2);
        const flames=this.palettes.torch_animation;
        if(flames){
          const elapsed=Math.floor(tick/8),initial=this.level().theme_raw?0:++torchOrdinal;
          const phase=initial===0?(elapsed===0?0:1+(elapsed-1)%4):1+(initial-1+elapsed)%4;
          const f=flames.frames[phase];paint({...f,width:8,height:16},x,y);
        }
      }
    }
    // Recovered background-object maps; the C engine chooses their visible state.
    const binding=this.animations.normal_bindings[this.theme().id];
    for(const pos of this.tiles.native_layout.draw_order){
      const raw=this.tile(room,pos,live),type=raw&31,x=16+(pos%10)*32,y=Math.floor(pos/10)*64;
      let id,phase=0;
      if(type===4){id=binding.gate;const open=live?this.game.game_get_gate(room,pos):((raw>>5)===1?64:0);phase=Math.round(open*23/64);}
      if(type===2){id=binding.spikes;phase=live&&this.game.game_get_tile_state(room,pos)>0?(this.level().theme_raw?3:2):10;}
      if(type===18){const leftType=pos%10?this.tile(room,pos-1,live)&31:0;id=leftType===3?binding.chomper_left_pillar:binding.chomper;phase=this.chomperFrame(live?this.game.game_get_tile_state(room,pos):0);}
      if(id===undefined)continue;
      const pattern=this.animations.patterns.find(p=>p.pattern_id===id),frame=this.animations.frames[pattern.frame_ids[phase]];
      paint(frame,x+pattern.origin_offset_pixels[0],y+pattern.origin_offset_pixels[1],{bottom:pattern.height,paletteGroup:pattern.palette_group});
    }
    const image=document.createElement('canvas');image.width=ROOM_WIDTH;image.height=ROOM_HEIGHT;
    const c=image.getContext('2d'),data=c.createImageData(ROOM_WIDTH,ROOM_HEIGHT);
    const palettes=this.palette().background.map(q=>q.map(i=>{const h=this.palettes.hex64[i];return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}));
    for(let y=0;y<ROOM_HEIGHT;y++)for(let x=0;x<ROOM_WIDTH;x++){
      const i=y*ROOM_WIDTH+x,color=palettes[attributes[(y>>4)*qw+(x>>4)]][indices[i]];
      data.data[i*4]=color[0];data.data[i*4+1]=color[1];data.data[i*4+2]=color[2];data.data[i*4+3]=255;
    }
    c.putImageData(data,0,0);this.cache.set(key,image);if(this.cache.size>160)this.cache.delete(this.cache.keys().next().value);return image;
  }
  drawRoom(c,room,live=false,tick=0){c.imageSmoothingEnabled=false;c.drawImage(this.roomImage(room,live,tick),0,0);}
  chomperFrame(phase){return phase>=12&&phase<21?4:(phase>=8&&phase<25?2:0);}
  frameImage(frame){
    const key=`${this.game.game_get_level()}:${frame.id}`;if(this.spriteCache.has(key))return this.spriteCache.get(key);
    const image=document.createElement('canvas');image.width=frame.width;image.height=frame.height;
    const c=image.getContext('2d'),data=c.createImageData(frame.width,frame.height);
    for(let i=0;i<frame.pixels.length;i++){
      if(!frame.pixels[i])continue;const group=frame.palette_groups?.[i]??1,color=this.colors(true,group)[frame.pixels[i]];
      data.data[i*4]=parseInt(color.slice(1,3),16);data.data[i*4+1]=parseInt(color.slice(3,5),16);data.data[i*4+2]=parseInt(color.slice(5,7),16);data.data[i*4+3]=255;
    }
    c.putImageData(data,0,0);this.spriteCache.set(key,image);return image;
  }
  drawLooseFloor(c,x,y){
    const tile=this.theme().tiles.find(t=>t.type===11);if(!tile?.pixels?.length)return;
    const key=`loose:${this.game.game_get_level()}`;
    let image=this.spriteCache.get(key);
    if(!image){
      image=document.createElement('canvas');image.width=tile.width;image.height=tile.height;
      const tc=image.getContext('2d'),data=tc.createImageData(tile.width,tile.height),colors=this.colors();
      for(let i=0;i<tile.pixels.length;i++)if(tile.write_mask[i]&&tile.pixel_known_mask?.[i]!==0){
        const color=colors[tile.pixels[i]];data.data[i*4]=parseInt(color.slice(1,3),16);data.data[i*4+1]=parseInt(color.slice(3,5),16);data.data[i*4+2]=parseInt(color.slice(5,7),16);data.data[i*4+3]=255;
      }
      tc.putImageData(data,0,0);this.spriteCache.set(key,image);
    }
    c.drawImage(image,Math.round(x),Math.round(y)-56);
  }
  drawObjects(c,room,live=false,tick=0){
    const draw=(id,x,y,mirrored=false)=>{
      const f=this.actors.frames.find(f=>f.actor==='object'&&f.frame_index===id);if(!f)return;
      c.save();c.translate(x,y);if(mirrored){c.translate(8,0);c.scale(-1,1);}
      c.drawImage(this.frameImage(f),f.origin_x,f.origin_y);c.restore();
    };
    for(let pos=0;pos<30;pos++){
      const raw=this.tile(room,pos,live),type=raw&31,x=(pos%10)*32,y=Math.floor(pos/10)*64;
      if(type===22)draw(Math.floor(tick/8)%22===10?162:161,x,y,true);
      if(type===10){draw(raw&0x40?163:150,x,y);draw(151+Math.floor(tick/8)%6,x,y);}
    }
  }
  drawActor(c,x,y,facing,state,animation,guard=false,nativeFrame=-1){
    const actor=guard?'guard':'prince',frames=this.actors.frames.filter(f=>f.actor===actor&&f.pixels?.length);
    const map=this.actors.pose_sequences??{};
    const action=guard?(['ready','approach','attack','parry','hurt','dead'][state]??'ready'):['stand','run','crouch','jump','fall','hang','climb','hurt','dead','ready','attack','drink','stand'][state]??'stand';
    const seq=map[actor]?.[action]??map[actor]?.[action==='ready'?(guard?'stand':'sword'):action==='fall'?'jump':action==='hurt'?'stand':'stand']??[15];
    // Ledge and guard actions supply the frame chosen by C. Their
    // frame changes and anchor moves must happen in the same simulation tick.
    const n=nativeFrame>=0?nativeFrame:seq[Math.floor(animation/6)%seq.length],frame=frames.find(f=>f.frame_index===n)??frames[0];if(!frame)return;
    c.save();c.translate(Math.round(x),Math.round(y));
    // B419 reflects an8px tile anchor: flippedOrigin=8-origin-width.
    if(facing>0){c.translate(8,0);c.scale(-1,1);}
    c.drawImage(this.frameImage(frame),frame.origin_x??0,frame.origin_y??-37);c.restore();
  }
}

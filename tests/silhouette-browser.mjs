import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=resolve(dirname(fileURLToPath(import.meta.url)),'../../analysis/validation');
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.popStudy?.ready);
  const result=await page.evaluate(()=>{
    const original=popStudy.renderer,results=[];
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const canvas=()=>{const c=document.createElement('canvas');c.width=360;c.height=208;return c;};
    const pixels=c=>c.getContext('2d').getImageData(0,0,360,208).data;
    for(const theme of ['dungeon','palace']){
      const level=original.campaign.levels.findIndex(l=>!!l.theme_raw===(theme==='palace'));
      let open=0;
      const tiles=Array.from({length:30},(_,p)=>p>=10&&p<20?1:0);
      const room={id:1,tiles_raw:tiles,links:{left:0,right:0,up:0,down:0}};
      const campaign={levels:original.campaign.levels.map(l=>({...l,rooms:[room]}))};
      const game={game_get_level:()=>level,game_get_tile:(_,p)=>tiles[p],game_get_gate:()=>open,game_get_tile_state:()=>0};
      const r=new original.constructor(original.tiles,original.palettes,original.actors,campaign,game,original.animations);
      tiles[13]=3;
      const pillar=r.roomImage(1,true,0),mask=pixels(pillar.foregroundMask);
      // The front column hides the prince; the farther post / shadow does not.
      const frontX=theme==='dungeon'?122:130;
      check(mask[(104*360+frontX)*4+3]===255,`${theme}: front pillar missing`);
      check(mask[(104*360+150)*4+3]===0,`${theme}: distant scenery occludes prince`);
      const back=pixels(pillar);
      for(const facing of [-1,1]){
        let hiddenCount=0,visibleCount=0;
        for(const x of [118,126,134,142,154]){
          const actor=canvas(),rendered=canvas();
          r.drawActor(actor.getContext('2d'),x,128,facing,0,0,false,15);
          const c=rendered.getContext('2d');c.drawImage(pillar,0,0);r.drawPrince(c,1,0,x,128,facing,0,0,15);
          const a=pixels(actor),actual=pixels(rendered);
          for(let i=0;i<a.length;i+=4){
            const hidden=a[i+3]&&mask[i+3];
            if(a[i+3]){if(hidden)hiddenCount++;else visibleCount++;}
            for(let k=0;k<3;k++){
              const expected=hidden?back[i+k]*0.4+[16,16,24][k]*0.6:a[i+3]?a[i+k]:back[i+k];
              check(Math.abs(actual[i+k]-expected)<=1,`${theme}, facing ${facing}: wrong pixel at ${i/4}`);
            }
          }
        }
        check(hiddenCount>0&&visibleCount>0,`${theme}: missing partial overlap / uncovered body`);
        results.push({theme,facing,hiddenCount,visibleCount});
      }
      // A plain wall is scenery, not a global "background is nonblack" mask.
      tiles[13]=20;const wall=pixels(r.roomImage(1,true,0).foregroundMask);
      for(let y=80;y<120;y++)for(let x=112;x<144;x++)check(!wall[(y*360+x)*4+3],`${theme}: wall face incorrectly masks actor`);
      // Gates must expose gaps and erase stale coverage as they rise.
      tiles[13]=4;open=0;const shut=pixels(r.roomImage(1,true,0).foregroundMask);
      open=64;const raised=pixels(r.roomImage(1,true,0).foregroundMask);
      let shutBars=0,raisedBars=0,gaps=0;
      for(let y=88;y<120;y++)for(let x=144;x<160;x++){
        const i=(y*360+x)*4+3;shutBars+=!!shut[i];raisedBars+=!!raised[i];gaps+=!shut[i];
      }
      check(shutBars>raisedBars&&gaps>0,`${theme}: gate mask fails to follow bars / openings`);
      open=0;check(pixels(r.roomImage(1,true,0).foregroundMask).every((v,i)=>v===shut[i]),`${theme}: cached closed mask changed`);
      results.push({theme,shutBars,raisedBars,gaps});
      // Every supported vertical decoration with known pixels has coverage.
      for(const type of theme==='palace'?[7,8,9,12,13,16,17,18,23,24,25,26,27,28,29]:[8,9,12,16,17,18]){
        tiles[13]=type;
        check(pixels(r.roomImage(1,true,0).foregroundMask).some(v=>v),`${theme}: scenery ${type} missing`);
      }
    }
    return results;
  });
  // Exercise the actual app draw path, including camera crop and palette switch.
  for(const level of [0,3]){
    await page.selectOption('#level-select',String(level));
    await page.evaluate(()=>{
      const {game:g,draw}=popStudy,l=g.game_get_level();
      for(let p=0;p<30;p++)g.game_edit_tile(l,1,p,p>=10&&p<20?1:0);
      for(let d=0;d<4;d++)g.game_edit_link(l,1,d,0);
      g.game_edit_tile(l,1,13,3);g.game_edit_guard(l,1,255);g.game_reset();
      g.game_set_player(1,110,120,1);document.querySelector('#game-overlay').hidden=true;draw();
    });
    await page.locator('#game').screenshot({path:resolve(output,`silhouette-${level===0?'dungeon':'palace'}.png`)});
    for(let mode=0;mode<2;mode++){
      const aligned=await page.evaluate(()=>{
        popStudy.draw();const c=document.querySelector('#game'),full=c.width===360;
        const world=popStudy.renderer.world.getContext('2d'),display=c.getContext('2d');
        const b=display.getImageData(0,0,c.width,200).data;
        // The recovered camera eases toward its target, so its current offset
        // can differ from the destination immediately after a QA teleport.
        const offsets=full?[0]:Array.from({length:19},(_,i)=>8+4*i);
        return offsets.some(x=>world.getImageData(x,8,c.width,200).data.every((v,i)=>v===b[i]));
      });
      assert.equal(aligned,true,'silhouette stays aligned in full room and follow camera');
      await page.click('#camera-mode');
    }
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,'silhouette-browser.json'),JSON.stringify({passed:true,result,errors},null,2)+'\n');
  console.log(JSON.stringify({passed:true,result,errors},null,2));
}finally{await browser.close();}

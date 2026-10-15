import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=resolve(dirname(fileURLToPath(import.meta.url)),'../../analysis/validation');
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.popStudy?.ready);
  await page.locator('#game-overlay').evaluate(e=>e.hidden=true);
  await page.evaluate(()=>{
    const{game:g,renderer:r}=popStudy;
    window.guardArena=(x=70)=>{
      g.game_init();for(let p=0;p<30;p++)g.game_edit_tile(0,1,p,p>=20?1:0);
      for(let d=0;d<4;d++)g.game_edit_link(0,1,d,0);
      g.game_edit_guard(0,1,25);g.game_reset();g.game_set_has_sword(1);g.game_set_player(1,x,184,x<176?1:-1);g.game_set_input(0);
    };
    window.guardSnapshot=()=>{
      const image=document.createElement('canvas');image.width=128;image.height=96;
      r.drawActor(image.getContext('2d'),64,64+g.game_get_guard_render_y(1)-g.game_get_guard_y(1)-8,g.game_get_guard_facing(1),g.game_get_guard_state(1),g.game_get_guard_animation(1),true,g.game_get_guard_native_frame(1));
      const pixels=image.getContext('2d').getImageData(0,0,128,96).data;
      let hash=2166136261,visible=0;for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619);if(i%4===3&&pixels[i])visible++;}
      return {frame:g.game_get_guard_native_frame(1),x:g.game_get_guard_x(1),state:g.game_get_guard_state(1),facing:g.game_get_guard_facing(1),animation:g.game_get_guard_animation(1),hash:hash>>>0,pixels:visible,visible:g.game_get_guard_visible(1),active:g.game_get_guard_active(1)};
    };
  });
  const walking=await page.evaluate(()=>{
    const{game:g,draw}=popStudy;guardArena();g.game_step();const poses=[guardSnapshot()];
    for(let i=0;i<4;i++){g.game_update(4);poses.push(guardSnapshot());}draw();return poses;
  });
  assert.deepEqual(walking.map(p=>p.frame),[164,165,158,170,171]);
  assert.equal(new Set(walking.map(p=>p.x)).size,1,'foot poses animate at a planted anchor');
  assert.equal(new Set(walking.map(p=>p.hash)).size,2,'original five-step advance uses two distinct images');
  assert.equal(walking[0].hash,walking[1].hash,'ROM frames 164 and 165 share artwork');
  assert.equal(walking[2].hash,walking[3].hash);
  assert.equal(walking[3].hash,walking[4].hash,'ROM frames 158, 170 and 171 share artwork');
  assert.notEqual(walking[0].hash,walking[2].hash,'walking visibly changes the guard pose');
  assert.ok(walking.every(p=>p.pixels>100&&p.visible===1));
  await page.locator('#game').screenshot({path:resolve(output,'guard-walking.png')});
  const secondStep=await page.evaluate(()=>{popStudy.game.game_update(4);popStudy.draw();return guardSnapshot();});
  assert.equal(secondStep.frame,164);assert.equal(secondStep.x,walking[0].x-12);
  const mirrored=await page.evaluate(()=>{guardArena(280);popStudy.game.game_step();popStudy.draw();return guardSnapshot();});
  assert.equal(mirrored.facing,1);assert.equal(mirrored.x,188);assert.equal(mirrored.frame,164);
  assert.notEqual(mirrored.hash,walking[0].hash,'right-facing guard is actually mirrored');
  const paused=await page.evaluate(()=>{const g=popStudy.game;g.game_set_paused(1);g.game_update(80);const p=guardSnapshot();g.game_set_paused(0);return p;});
  assert.deepEqual(paused,mirrored);
  const blocked=await page.evaluate(()=>{guardArena();const g=popStudy.game;g.game_edit_tile(0,1,24,20);g.game_update(60);return guardSnapshot();});
  assert.equal(blocked.state,0);assert.equal(blocked.x,176);assert.equal(blocked.frame,171);
  const attack=await page.evaluate(()=>{
    guardArena(150);const g=popStudy.game;let wait=0;while(wait++<80&&g.game_get_guard_state(1)!==2)g.game_step();
    const poses=[guardSnapshot()];for(let i=0;i<9;i++){g.game_update(4);poses.push(guardSnapshot());}popStudy.draw();return poses;
  });
  assert.deepEqual(attack.map(p=>p.frame),[151,152,153,154,155,156,157,158,170,171]);
  assert.equal(new Set(attack.map(p=>p.hash)).size,7,'original ten-step attack uses seven distinct images');
  const parry=await page.evaluate(()=>{
    guardArena(150);const g=popStudy.game;let wait=0;while(wait++<80&&g.game_get_guard_state(1)!==2)g.game_step();
    g.game_set_input(4);g.game_update(8);const poses=[guardSnapshot()];g.game_update(4);poses.push(guardSnapshot());return poses;
  });
  assert.deepEqual(parry.map(p=>p.frame),[167,155]);assert.ok(parry.every(p=>p.state===3));
  const death=await page.evaluate(()=>{
    guardArena(150);const g=popStudy.game;const hurt=[];
    for(let i=0;i<6&&g.game_get_guard_active(1);i++){
      g.game_set_health(3);g.game_set_player(1,g.game_get_guard_x(1)-26,184,1);
      g.game_set_input(0);g.game_step();g.game_set_input(32);g.game_step();g.game_set_input(4);g.game_update(5);
      if(g.game_get_guard_active(1)){hurt.push(guardSnapshot());g.game_update(34);}
    }
    const poses=[guardSnapshot()];for(let i=0;i<5;i++){g.game_update(4);poses.push(guardSnapshot());}popStudy.draw();return {hurt,poses};
  });
  assert.ok(death.hurt.every(p=>p.state===4&&p.frame===172));
  assert.deepEqual(death.poses.map(p=>p.frame),[179,180,181,182,183,183]);
  assert.ok(death.poses.every(p=>p.active===0&&p.visible===1&&p.pixels>100),'death stays drawn after collision is disabled');
  await page.locator('#game').screenshot({path:resolve(output,'guard-defeated.png')});
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['five-step ROM advance with two distinct images','step follows full footwork','mirrored movement','pause freezes animation','wall blocks stepping','ten-step ROM attack with seven distinct images','persistent parry','hurt reaction','death animation and persistent corpse'],walking,secondStep,mirrored,blocked,attack,parry,death,errors};
  writeFileSync(resolve(output,'guard-browser.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks:result.checks,walkFrames:walking.map(p=>p.frame),uniqueWalkImages:new Set(walking.map(p=>p.hash)).size,errors},null,2));
} catch(error){console.error('Browser diagnostics:',errors);throw error;}
finally{await browser.close();}

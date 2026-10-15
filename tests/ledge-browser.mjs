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
  page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.popStudy?.ready);
  await page.locator('#game-overlay').evaluate(e=>e.hidden=true);
  const catchPose=await page.evaluate(()=>{
    const{game:g,draw,renderer}=popStudy;
    g.game_init();g.game_set_player(1,86,120,1);g.game_set_input(0);g.game_update(2);
    g.game_set_input(48);g.game_step();g.game_set_input(32);
    let steps=0;while(steps++<70&&g.game_get_player_state()!==5)g.game_step();
    draw();
    const x=g.game_get_player_render_x(),y=g.game_get_player_render_y();
    const c=renderer.world.getContext('2d'),hand=[...c.getImageData(x+5,y-58,3,1).data];
    const skin=renderer.colors(true,1)[1];
    return {state:g.game_get_player_state(),frame:g.game_get_player_native_frame(),x,y,hand,skin};
  });
  assert.equal(catchPose.state,5);assert.equal(catchPose.frame,91);
  assert.equal(catchPose.x,121);assert.equal(catchPose.y,127);
  const handColor='#'+catchPose.hand.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
  assert.equal(handColor,catchPose.skin,'original hand pixels are rendered at ledge (126..128,69)');
  await page.locator('#game').screenshot({path:resolve(output,'ledge-after-catch.png')});
  const climb=await page.evaluate(()=>{
    const{game:g,draw,actors}=popStudy;
    const snap=()=>{const frame=g.game_get_player_native_frame();const f=actors.frames.find(f=>f.actor==='prince'&&f.frame_index===(frame<0?15:frame));return {frame,state:g.game_get_player_state(),x:g.game_get_player_render_x(),y:g.game_get_player_render_y(),imageTop:g.game_get_player_render_y()+f.origin_y};};
    g.game_set_input(36);g.game_step();const start=snap();g.game_set_input(0);g.game_update(20);const before=snap();draw();return {start,before};
  });
  assert.deepEqual([climb.start.frame,climb.start.x,climb.start.y],[135,120,128]);
  assert.deepEqual([climb.before.frame,climb.before.x,climb.before.y],[140,120,128]);
  await page.locator('#game').screenshot({path:resolve(output,'ledge-climb-140.png')});
  const after=await page.evaluate(()=>{const{game:g,draw,actors}=popStudy;g.game_update(4);draw();const frame=g.game_get_player_native_frame(),f=actors.frames.find(f=>f.actor==='prince'&&f.frame_index===frame);return {frame,x:g.game_get_player_render_x(),y:g.game_get_player_render_y(),imageTop:g.game_get_player_render_y()+f.origin_y};});
  assert.deepEqual([after.frame,after.x,after.y],[141,130,65]);
  assert.equal(after.imageTop-climb.before.imageTop,-1,'63px anchor transfer cancels the artwork origin change');
  await page.locator('#game').screenshot({path:resolve(output,'ledge-climb-141.png')});
  const finish=await page.evaluate(()=>{const{game:g,draw}=popStudy;g.game_update(32);draw();return {state:g.game_get_player_state(),x:g.game_get_player_render_x(),y:g.game_get_player_render_y(),grounded:g.game_get_player_grounded()};});
  assert.deepEqual(finish,{state:0,x:132,y:65,grounded:1});
  await page.locator('#game').screenshot({path:resolve(output,'ledge-after-climb.png')});
  const mirrored=await page.evaluate(()=>{
    const{game:g,draw}=popStudy;g.game_init();
    for(let p=0;p<30;p++)g.game_edit_tile(0,1,p,p>=20?1:0);
    for(let d=0;d<4;d++)g.game_edit_link(0,1,d,0);
    g.game_edit_tile(0,1,15,1);g.game_edit_guard(0,1,255);g.game_reset();
    g.game_set_player(1,202,184,-1);g.game_set_input(0);g.game_update(2);g.game_set_input(48);g.game_step();g.game_set_input(32);
    let steps=0;while(steps++<70&&g.game_get_player_state()!==5)g.game_step();draw();
    return {frame:g.game_get_player_native_frame(),x:g.game_get_player_render_x(),y:g.game_get_player_render_y()};
  });
  assert.deepEqual(mirrored,{frame:91,x:216,y:191});
  await page.locator('#game').screenshot({path:resolve(output,'ledge-after-left-catch.png')});
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['Level1 actual ledge catch','frame91 hand pixels at recovered native anchor','original pre-climb snap','four-tick poses','frame140/141 visual continuity','standing endpoint','mirrored catch'],catchPose,climb,after,finish,mirrored,errors};
  writeFileSync(resolve(output,'ledge-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} catch(error) {console.error('Browser diagnostics:',errors);throw error;}
finally {await browser.close();}

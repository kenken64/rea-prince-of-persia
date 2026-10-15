import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=mkdtempSync(join(tmpdir(),'prince-c-tests-'));
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
try {
  const binary=join(scratch,'game_test');
  run(process.env.CC||'clang',['-std=c11','-Wall','-Wextra','-Werror','-pedantic','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer','-Isrc','src/game.c','tests/game_test.c','-o',binary]);
  run(binary,[]);
  if(existsSync(join(root,'dist/game.wasm'))){
    const module=new WebAssembly.Module(readFileSync(join(root,'dist/game.wasm')));
    assert.deepEqual(WebAssembly.Module.imports(module),[],'Wasm must be independent of a host emulator/runtime');
    const g=new WebAssembly.Instance(module,{}).exports;g.game_init();
    assert.equal(g.game_get_level_count(),14);
    let count=0,events=0;
    for(let l=0;l<14;l++){
      assert.equal(g.game_select_level(l),1);events+=g.game_get_event_count();
      for(let r=1;r<=24;r++)count+=g.game_get_room_present(r);
      for(let t=0;t<6000;t++){g.game_set_input(((t%160)<70?2:1)|((t%83)<12?16:0)|((t%97)<8?32:0));g.game_step();}
      assert.ok(g.game_get_room()>=1&&g.game_get_room()<=24);
    }
    assert.equal(count,271);assert.equal(events,146);
    console.log('Wasm: no imports; all 14 levels / 271 rooms / 146 events; 84,000 simulation ticks passed.');
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }

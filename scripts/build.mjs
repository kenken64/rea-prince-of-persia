import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
let sdk = process.env.WASI_SDK_PATH;
const location = resolve(root, '../analysis/tooling/wasi-sdk-location.json');
if (!sdk && existsSync(location)) sdk = JSON.parse(readFileSync(location)).path;
const compiler = process.env.WASM_CC || (sdk && join(sdk, 'bin/clang'));
if (!compiler || !existsSync(compiler)) {
  throw new Error('Set WASI_SDK_PATH to an extracted official wasi-sdk, or WASM_CC to a clang with its wasm-ld. See BUILD.txt.');
}
mkdirSync(dist, { recursive: true });
const sources = readdirSync(join(root, 'src')).filter(x => x.endsWith('.c')).map(x => join('src', x));
run(compiler, ['--target=wasm32', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fno-builtin', '-nostdlib',
  ...sources, '-Isrc', '-Wl,--no-entry', '-Wl,--export-all', '-Wl,--export-memory',
  '-Wl,--initial-memory=2097152', '-Wl,--max-memory=16777216', '-Wl,-z,stack-size=131072', '-o', join(dist, 'game.wasm')]);
for (const name of ['index.html', 'style.css', 'app.js', 'native-renderer.js', 'BUILD.txt']) copyFileSync(join(root, name), join(dist, name));
rmSync(join(dist, 'assets'), {recursive:true,force:true});
mkdirSync(join(dist, 'assets'), { recursive: true });
for (const name of readdirSync(join(root, 'assets'))) copyFileSync(join(root, 'assets', name), join(dist, 'assets', name));
rmSync(join(dist, 'source'), {recursive:true,force:true});
mkdirSync(join(dist, 'source'), { recursive: true });
for (const name of readdirSync(join(root, 'src'))) copyFileSync(join(root, 'src', name), join(dist, 'source', name));
const m = new WebAssembly.Module(readFileSync(join(dist, 'game.wasm')));
const imports = WebAssembly.Module.imports(m);
if (imports.length) throw new Error(`Standalone module unexpectedly imports: ${JSON.stringify(imports)}`);
writeFileSync(join(dist, 'build.json'), JSON.stringify({language:'C11', target:'wasm32', simulation:'independent C gameplay', imports, source_files:sources}, null, 2)+'\n');
run('python3', ['-c', 'import pathlib,zipfile; r=pathlib.Path("."); z=zipfile.ZipFile("dist/editable-source.zip","w",zipfile.ZIP_DEFLATED); [z.write(p,p.as_posix()) for d in ["src","scripts","tests","assets"] for p in sorted((r/d).rglob("*")) if p.is_file() and not p.name.startswith("test_game")]; [z.write(p,p) for p in ["package.json","index.html","style.css","app.js","native-renderer.js","BUILD.txt"]]; z.close()']);
console.log('Built dist/game.wasm; verified standalone Wasm with no imports.');

# Prince of Persia — NES Reconstruction

An independent, editable **C11 game compiled to WebAssembly**, built around graphics and level data recovered from the NES version of Prince of Persia using Rea. JavaScript handles Canvas rendering, browser input, and the cartridge explorer.

**[Play in the browser](https://prince-of-persia-nes-reconstruction.wiry-eagle-9459.chatgpt.site/#play)** · **[Build notes](BUILD.txt)** · **[Original game / ROM page](https://www.emu-land.net/en/consoles/dendy/roms/prince-of-persia)**

The hosted game uses the site's access settings and may require sign-in and permission. The included browser build also runs locally.

## Features

- **14 recovered levels, 271 rooms, and 146 active events**, with original room connections and spawn data.
- **296 exported sprite frames**, indexed palettes, background compositions, torches, and animated traps.
- C gameplay for running, jumping, crouching, ledge grabs, climbing, sword combat, gates, pressure plates, potions, and loose floors.
- Full-room view without horizontal camera scrolling, plus a **Follow prince** option for the scrolling camera.
- Responsive display, fullscreen controls, keyboard input, and touch buttons.
- Translucent silhouettes keep the prince visible behind pillars, gates, and foreground scenery.
- Room-map exploration, graphics inspection, retained Rea evidence, and an editable-source download.

## Run locally

The repository includes a built version in `dist/`. To play it, install Node.js/npm and Python 3, then run:

```sh
git clone https://github.com/kenken64/rea-prince-of-persia.git
cd rea-prince-of-persia
npm run dev
```

Open **[http://localhost:8000](http://localhost:8000)** and select **Begin journey**. Serve the files over HTTP; opening `index.html` directly does not support the game's asset loading.

No npm dependency installation or ROM file is required to run the included build.

## Build from source

Install Node.js/npm, Python 3, and a host-compatible [wasi-sdk release](https://github.com/WebAssembly/wasi-sdk/releases). From the repository root, use the following commands in a macOS/Linux shell:

```sh
export WASI_SDK_PATH="/absolute/path/to/wasi-sdk"
npm run build
npm run dev
```

The build compiles the C sources into `dist/game.wasm`, copies the browser assets, and creates `dist/editable-source.zip`. The Wasm module has no imports; JavaScript calls its exported game functions. `WASM_CC` can override the compiler path when using a suitably configured Clang and Wasm linker.

## Controls

| Input | Action |
| --- | --- |
| Left / Right or A / D | Move |
| Space | Jump |
| Up or W | Jump, climb, or interact depending on context; parry during sword combat |
| Down or S | Crouch, pick up items, lower from an edge, or release a ledge |
| Hold Shift or X | Move cautiously or catch and hold a ledge; attack during combat |
| Up while hanging | Climb onto the ledge |
| Release Shift / X while hanging | Let go |
| P | Pause / resume |
| R | Restart the current level |
| Enter | Begin the game |

Touch controls appear on touch devices. Use **Full room / Follow prince** to switch camera modes and **⛶** to enter or exit fullscreen. The level selector and room explorer let you inspect the recovered campaign.

## How it works

The browser advances a deterministic, fixed-point C simulation at 60 ticks per second. The C core exposes player, guard, tile, and event state through [src/game.h](src/game.h). [native-renderer.js](native-renderer.js) composes the recovered artwork, and [app.js](app.js) handles input, display, and the explorer.

| Path | Purpose |
| --- | --- |
| [src/game.c](src/game.c) | Movement, collision, combat, hazards, triggers, and room traversal |
| [src/level_data.h](src/level_data.h) | Recovered campaign data compiled into the game |
| [src/ledge_sequences.h](src/ledge_sequences.h) | Recovered ledge frames and coordinate changes |
| [src/guard_sequences.h](src/guard_sequences.h) | Recovered guard animation sequences |
| [assets/](assets/) | Exported graphics, palettes, levels, findings, and evidence |
| [scripts/](scripts/) | Wasm build and native/Wasm test runners |
| [tests/](tests/) | C mechanics tests and browser checks |
| [dist/](dist/) | Built static website, Wasm module, and downloadable source |

Ground running is tuned to **93.75 pixels per second**, with ten simulation ticks per running pose. These are playability settings in the reconstruction; [BUILD.txt](BUILD.txt) describes the movement and animation choices in more detail.

The silhouette is a reconstruction-specific visibility aid. Foreground masks follow the recovered artwork and animated gate positions using independently defined layering rules; they do not establish the original NES sprite priority. Only covered prince pixels receive the translucent tint. Exposed pixels retain their original colors.

## Recovery status

The C code is independently written. This project does **not** recover the original author's source code or execute the ROM through an NES emulator.

| Area | Status |
| --- | --- |
| Level streams, room links, spawn records, and events | Extracted and checked against the supplied ROM; level payloads round-trip to their original bytes |
| Graphics | Original layouts, pixels, palettes, and many background compositions recovered; some entries and contextual behavior remain incomplete |
| Hanging and climbing | Frame sequences and anchors recovered; bounded original-ROM runs checked both climb directions and the tested cadence |
| Guard animation | Stepping, attacks, parries, hit reactions, and death sequences recovered; exact cadence and full AI remain reconstructed |
| General physics and collision | Independent C implementation |
| Audio, cutscenes, story scripts, and full-game equivalence | Incomplete or unverified |

The presence of all level layouts does not establish that the entire original campaign behaves identically or is fully completable.

## Validation

With a native Clang installation supporting AddressSanitizer and UndefinedBehaviorSanitizer:

```sh
npm run build
npm test
```

The test runner checks native gameplay, campaign bounds, collisions, jumps, combat, events, ledges, and stress simulations. It also instantiates the built Wasm module, verifies that it has no imports, and runs 84,000 simulation ticks across the fourteen levels.

Optional browser checks use Playwright. Install its test dependencies locally, start `npm run dev` in another terminal, and run the suites sequentially:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.mjs
node tests/ledge-browser.mjs
node tests/guard-browser.mjs
node tests/silhouette-browser.mjs
```

`TEST_URL` overrides the local server URL. `CHROME_PATH` selects an existing Chrome executable, and `PLAYWRIGHT_MODULE` can point to an existing Playwright module. Browser reports and screenshots are written to `../analysis/validation/` relative to the repository root.

## References and evidence

- [Prince of Persia ROM page — Emu-Land](https://www.emu-land.net/en/consoles/dendy/roms/prince-of-persia)
- [Rea findings](assets/rea-findings.json) and [retained evidence archive](assets/rea-evidence.zip), including selected extraction and verification scripts
- [Recovered level data](assets/levels.json)
- [Ledge findings](assets/ledge-findings.json) and [guard animation findings](assets/guard-animation-findings.json)

The original game, characters, and artwork remain the work of their respective creators. No open-source license is currently declared for this repository.

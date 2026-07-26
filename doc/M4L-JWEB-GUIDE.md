# Building m4l-gugelhupf with M4L-JWEB

This is a **[M4L-JWEB](https://github.com/alienmind/m4l-jweb)** device repo: one `src/app/<device>/` folder per device (`App.tsx`, `protocol.ts`, `surface.ts`), each building into its own `.amxd` with its own UI bundle - a device ships what it is, not what its sibling is. `patcher/devices.mjs` is the manifest; `wrapper/device.ts` holds the shared `[js]` extensions. A device's Live parameters are declared **once**, in its `surface.ts`, and the build generates the `live.*` objects, their wiring and their message selectors from that one declaration. Everything else - the `.amxd` container writer, the generated patchers, the `[js]` lifecycle, the ES5 gate, the per-device build plumbing (`scripts/dev.mjs`, `scripts/build-ui.mjs`) - comes from the published `@m4l-jweb/bridge`, `@m4l-jweb/surface` and `@m4l-jweb/build` packages.

If you were setting this repo up from scratch today, this is the path:

1. **Scaffold the repo.**
   ```bash
   pnpm dlx @m4l-jweb/build init m4l-gugelhupf
   cd m4l-gugelhupf && pnpm install
   ```
   This gives you a working one-device `hello-midi` build: `src/app/midi/` (`App.tsx`, `protocol.ts`, `surface.ts`), `patcher/devices.mjs`, all the vite/tsconfig plumbing - the exact shape this repo still has today.

2. **Pull in the real engine.** `git submodule add` the upstream Strudel repo at `strudel/`, and bundle `@strudel/core` + `mini` + `transpiler` + `tonal` from it via vite aliases (see `vite.config.ts` / `vitest.config.ts`).

3. **Grow `patcher/devices.mjs` to four devices.** One manifest entry per device (the two MIDI devices as `type: "midi"`; `-sample-browser` and `-fx` as `type: "audio"`, the browser with `mode: "sample-browser"`), each with a `ui` field naming its `src/app/` folder and its `chains` - the packaged `midiout`, `samples` and `download`, or one of this project's own (`strudel-delay`, `strudel-room`) registered via `patcher/chains.mjs`. Push-visible parameters are NOT declared here: they live in each device's `surface.ts`.

4. **Add a folder per device.** `src/app/midi/App.tsx` becomes the pattern editor, `src/app/sample-browser/App.tsx` the sample browser - each with its own `protocol.ts` (spreading `DEVICE_IN`/`CHAIN_OUT` from `@m4l-jweb/bridge` rather than retyping them) and `surface.ts`. The engine itself runs in a Web Worker (`src/app/shared/engine.worker.js`, MIDI-only - the browser never needed it), so pattern evaluation never blocks the UI thread.

5. **Extend the wrapper.** `wrapper/device.ts` adds everything genuinely device-specific on top of `@m4l-jweb/wrapper`'s packaged lifecycle: mode resolution from `jsarguments`, Live 12 scale observers and clip-availability polling - hooking into `onDeviceReady`/`onUiReady`. One wrapper file for the whole repo, shared by every device's `[js]` glue.

6. **Declare what must survive the set.** A `state` slot in `surface.ts` (the drums device's map, the FX device's line) compiles to a `[dict]` + `[pattr]` Live saves with the SET, bound two-way with `useStateSync()`. Live parameters carry numbers; a slot carries the things a number cannot be.

7. **Build.** `pnpm build` runs `scripts/build-ui.mjs` (one Vite build per device, `dist/ui/<device>/index.html`) then `m4l-jweb build` - `.amxd` containers generated entirely from Node scripts, no manual Max editing, on a machine that has never opened Max.

Four devices, four independent UI bundles, one wrapper. Live's transport is fed in as messages via `[plugsync~]`, the engine queries pattern events ahead of time, and Max's `[pipe]`/`[makenote]` apply the precise timing.

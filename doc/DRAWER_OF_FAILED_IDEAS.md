# The drawer of failed ideas

Things we tried and that do not work - kept so nobody spends a second afternoon
rediscovering the same wall. Ideas that WORKED are not here; they live in
[README.md](../README.md) and [ARCHITECTURE.md](ARCHITECTURE.md) (native `live.*`
controls and Push banks, the macro-mappable transport, clip I/O that reaches the track
even inside a Rack).

---

## Translate / Adopt mode - `.lpf()` drives the user's own Auto Filter

**Verdict: abandoned. It does not work, and it was not worth making work.**

This descends from an old grand plan: make these devices a "dumb controller" that
TRANSLATES Strudel's language onto Ableton's own native controls, and lets Live do the
sound, instead of reimplementing effects. Parts of that plan landed - native dials,
native transport, documented above. This part never will.

The idea (R4-d in the old plan): a device-wide "Translate" toggle so that instead of the
FX device's OWN built-in filter, `.lpf(800)` would bind and drive a **sibling** Auto
Filter the user placed in the rack - the "dumb controller translating to native devices"
plan taken to its logical end.

It was built end to end - an upstream `get_sibling_param` LOM walk in the wrapper, a
`resolveSiblingParam` bridge call returning the foreign parameter's id and range, a
reconciler (`useAdopt`) that bound/streamed/released like the pattern-modulation path,
value-scaling through the foreign `min`/`max`, and a UI toggle with per-stage status -
then **removed**, because the idea itself is wrong:

- **The device already HAS a cutoff filter.** Binding `.lpf()` to a *second*, external
  filter to do the same job is nonsensical - it is not translating a capability the
  device lacks, it is duplicating one it has.
- **Live already does this natively.** Anything the user would want to macro-map or
  automate on their own Auto Filter, they can map in Ableton directly. The device added
  nothing but a confusing indirection.
- And in practice it did not even bind reliably (sibling resolution across rack/track
  nesting and class-name matching was fragile).

The lesson that survives: the "translate onto native controls" plan is right ONLY where
the device would otherwise reimplement something Live does better - and it already paid
off there (native `live.dial` parameters, Push banks, the macro-mappable transport, all
shipped). Reaching out to CONTROL other devices' parameters is a bridge too far: it has
no user value the native mapping does not already give, and it fights Live's own model.

## The "super-device" and the single unified app - superseded, not built

**Verdict: dropped. The Rack made both unnecessary.**

Two shapes from the same old plan, neither built because the shipped design is better:

- **One "super-device" with a mode toggle** (sequencer + instrument + fx in a single
  draggable device, flipped by a runtime switch). Impossible AND unwanted: a device's
  container type (`mmmm` MIDI / `aaaa` audio / instrument) is stamped into the `.amxd`
  at build time and Live enforces placement by it - no runtime toggle crosses that line.
- **Merging every device into one `src/app/unified/` app** shipped into several
  containers by `mode`. This was the plan's route to the super-device feel with one
  codebase.

What shipped instead - separate, properly-typed devices the user groups into a Rack
themselves - stays hand-composable (swap the instrument, remove the fx, add your own) and
costs one drag more. A preset of that arrangement DID ship for a while and was withdrawn
in 1.0.0: a Live rack embeds a copy of every device inside it, so it goes stale the moment
a device is rebuilt. Either way the unified merge bought nothing over the devices as they
are, and was dropped. The devices stay separate,
sharing code only where it already pays (`src/app/shared/`, `ui:` reuse), not forced into
one bundle.

## Drag a sample from the browser directly into a Live clip (DownloadURL)

**Verdict: abandoned. `[jweb]`'s embedded Chromium (CEF) strips the `DownloadURL` payload, making it impossible.**

We attempted to use the `DownloadURL` Chromium drag type so that dragging a sample browser row onto Live's audio lane would prompt Chromium to download the file to `%TEMP%` and pass it to Live as a native `CF_HDROP` file drag. We tested passing the remote `https://` URL in the payload, but the file handoff did not occur. The drop target in Live (and even notepad.exe) only received the raw text payload, proving that the CEF runtime inside Max 8 strips the `DownloadURL` data entirely.

The drag itself stays dead: without native file drop from the webview there is no way to make a ROW draggable into Live.

**But the sentence that used to follow this one was wrong, and it cost months.** It read "there is no scripted way to create an audio clip from a file path in Ableton Live (LOM only supports `ClipSlot.create_clip` for MIDI)". `create_clip` is the MIDI one; **`ClipSlot.create_audio_clip(path)` and `Track.create_audio_clip(path, position)` also exist**, in Live 12.0.5 and newer, and take an absolute path to an audio file. Nobody re-read the LOM entry after finding the MIDI-only note on its neighbour, and the copy-path workaround was built on that. The design lives in [TODO.md](TODO.md) and in m4l-jweb's backlog.

Until that ships, the answer remains the **copy-path** button: the user pastes the full file path into Explorer/Finder and drags from there. It began as **"Show folder"** - see the reveal entry below for why that could not be made to work.

## Superdough rendering (Route B) - walls hit during the spikes (2026-07-19)

The feature works; these are the specific things that DID NOT, kept so the next round does
not rediscover them.

- **`superdough`'s `initAudio()` hangs in an OfflineAudioContext.** It `await`s
  `initKabelsalat()` (a SalatRepl) unconditionally, which never resolves offline (worklets
  loaded, "[superdough] ready" never printed). Use `loadWorklets()` + `setMaxPolyphony()`
  directly; kabelsalat is only for the `kabel` synth. In `src/lib/render/offline.ts`.
- **Synth sounds are NOT registered on import.** `s("sawtooth")` throws "sound not found"
  until you call the exported `registerSynthSounds()` once. The design assumed import-time
  registration.
- **`saveToFile` to a SUBDIRECTORY fails the atomic place with `-1 bytes`.** Max's `[js]`
  `File` and `[maxurl]` (libcurl) resolve `render/x.wav` differently: `File` writes the
  `.part` where `fileSize` agrees, but maxurl cannot reach the subdir. Keep render
  filenames FLAT in the device folder (the `download` chain always did).
- **`[plugsync~]` is a dead end for transport here.** Outlet 6 (song-position-in-beats)
  measured stuck at **0** in Live while the transport played, so a boundary detector timed
  off it left the device silent. The shipping transport source is the wrapper's LiveAPI
  poll (`is_playing` + `current_song_time` -> `tick`), not `[plugsync~]`. `transport.mjs`'s
  comment claiming plugsync is the source is stale.
- **Per-loop hard re-sync (`0` to `[groove~]` every boundary) clicks.** Restarting the loop
  at control rate (~10 ms) lands a discontinuity at the seam every loop. A rate-1 `@loop`
  loop is already seamless; only re-align when you must (start / relocate), not per loop.
- **Re-applying the crossfade gains on EVERY boundary ticks.** `[line~]` re-triggering a
  ramp each loop (even to the same value) is audible. Apply gains only on the boundary that
  follows an arm/load - a pending `[gate]` does this, and it also makes `stop` stay stopped
  (otherwise the next boundary re-raises the gain).
- **STILL OPEN, deferred:** the loop is self-clocked (not bar-locked - the transport-sync
spike is next), and a faint `[groove~]` loop-point tick remains on a pure
  sine (inaudible on real content).

## Not possible - measured, so nobody re-opens it

- **The LOM cannot create an audio clip from a file on disk.** `ClipSlot.create_clip`
  is MIDI-only (it takes a length, makes an empty MIDI clip); there is no LOM call
  that points a clip slot at a WAV. It is a drag-and-drop operation in the
  application, not an API. The sample browser therefore goes as far as the API
  allows: the file is on disk at a known path, the row is a drag source, and
  reveal-in-folder is the answer (the drag-into-Live spike was tried and failed - CEF
  strips the `DownloadURL` payload; see [DRAWER_OF_FAILED_IDEAS.md](DRAWER_OF_FAILED_IDEAS.md)).
- **Live's Browser is unreachable from `[js]`** (the R2 spike, 2026-07-17).
  `new LiveAPI("live_app browser")` resolves to id 0 -
  `jsliveapi: component 'browser' is not an object`. The Browser (`load_item`,
  hotswap) is exposed to control-surface Python scripts only, so a device can never
  INSTANTIATE another device. (This was one leg of the "Translate mode" idea, whose
  other leg - a device CONTROLLING a sibling it did not create - was built and then
  abandoned as pointless; see doc/DRAWER_OF_FAILED_IDEAS.md.)

## Deliberate limitations - decided, not open work

Possible to build, chosen against on purpose. Recorded here so they are not
re-opened as backlog.

- **Scale/pitch in full Strudel code is not matched** (TODO item 4, closed 0.9.0).
  Full JS code does not see the Octave/Shift controls or the Live Scale toggle; it is
  passed through untouched, so `note("c5")` there is scientific MIDI 72 while `c5` in
  bare mini-notation follows the octave convention. Rewriting a user's JS would be
  worse than the mismatch, so the UI warns in amber and does not fix it (Studio window
  banner `StudioWindow.tsx`; MIDI device-view line `useStrudel.ts`; dialect detection
  `isBareMini()` in `strudelCode.ts`). Not a bug - the honest ceiling.
- **Playhead highlighting for full Strudel code is deferred** (TODO item 5, deferred
  0.9.0). The playhead highlights bare mini-notation only, from our own AST whose
  tokens carry source positions (`src/lib/mini/playhead.ts`, painted in
  `PatternEditor.tsx`). Full code would need CodeMirror in `PatternEditor` plus
  forwarding hap `context.locations` through the worker postMessage boundary (the
  worker discards them today, `engine.worker.js`) and wiring the vendored
  `highlightMiniLocations`. That is a large change to the editor every device shares,
  for a feature that only matters in the dialect that already lacks it. Deliberately
  deferred, not open work.

## Verified in Live - claims worth re-checking

Each of these was confirmed by hand, and each could quietly stop being true. What to
re-check, and when:

- **Instance-scoped buffers** (if buffer naming in m4l-jweb's `chains.mjs` changes):
  two copies of Strudel Samples on two tracks, different samples - each must keep its
  own sound. `---` scopes per device; `#0` was tried first and never expands in an
  `.amxd`.
- **Chain neutrality** (if the fx chains change): `.hpf(0)` and `.crush(24)` must be
  SILENT - bit-for-bit the dry signal, A/B'd against bypass. `.lpf(18000)`, `.gain(1)`,
  `.delay(0)`, `.room(0)` likewise.
- **Modulation** (if useModulation, the `remote` chain, or the surface ranges
  change): `.lpf(sine.range(200, 2000))` + play must sweep Cutoff between the actual
  200 Hz and 2 kHz once per bar, with the automation lane EMPTY; replacing the line
  with `.lpf(800)` must give the dial back; save/close/reopen must restore the line
  and resume the sweep on play.
- **Editor persistence** (if state slots or the engine's restore path change): an
  empty editor is a VALUE - select-all-and-cut, save, reopen must come back empty,
  not restore the default. Multi-space runs in a pattern must survive verbatim.
- **One scheduler** (if the Studio window changes): however many views are open,
  exactly ONE stream of notes. The device view alone receives `tick`.
- **Sampler polyphony and scope** (if the `instrument` chain or the name->slot allocator
  changes): run a pattern layering several sounds - each rings out on its own voice, none
  stolen mid-tail; two Sampler instances in one set keep separate samples (`---`
  device-scoped buffers). Confirmed 0.9.0 - the bank-based rewrite plays the selected
  machine, `.bank()` overrides per-hap, auto-download works, and a MIDI sequencer drives it.
- **Clip I/O from inside a Rack** (if `ownTrack()` or the clip paths change): a MIDI device
  inside an Instrument Rack reads and writes clips on the Rack's track, same as on a bare
  track, with no 1/s `jsliveapi` error. Confirmed 0.9.0.
- **Macro-map the native Play/Stop** (if the transport param or the native panel change): a
  Rack macro / Push button mapped to the transport starts and stops the sequencer, web
  Run/Stop stays in sync. The panel is reached from About > Advanced > Controls. Confirmed 0.9.0.
- **About > Advanced (Controls + Full Studio)** (if `AboutPanel` or the window entries
  change): the panel scrolls so the Advanced buttons are reachable in the 169px view;
  **Controls** reveals the native panel and its Back returns; **Full Studio** opens the
  child editor window that edits the same `code` slot as the device view (one scheduler,
  the device view). On MIDI, Drums MIDI, Drums Sampler. Confirmed 0.9.0.
- **Sampler samples folder** (if the wrapper's `HAS_SAMPLES_FOLDER` gate or `deviceFolder()`
  change): the `drums-sampler` mode resolves, so the device receives `device_folder` and the
  **Copy folder path** button enables after a download.
- **Push banks** (if the fx surface `banks` change): on a Push, the FX encoders page as
  **Tone** and **Space**, named - not "Bank 1"/"Bank 2". Confirmed 0.9.0.
- **State-default seeding** (if the surface state slots or m4l-jweb's seeding change): a
  fresh Strudel MIDI shows the demo pattern, a fresh FX device is not blank; a saved
  pattern restores over the default. Confirmed 0.9.0.
- **Engine boot / timing / preview / persistence** - the four gates in §6 above.

## The end of `[node.script]`

Early versions of the MIDI engine and the Sample browser ran on Node for Max (`[node.script]`). In field testing, Node for Max proved unstable when embedded inside Live, leading to silent non-starts and hard crashes on device load. Everything previously running in Node has been migrated: the engine now runs in a Web Worker inside Chromium, and network operations use native `fetch` or `[maxurl]`. `[node.script]` is completely banned.

## Two Parsers

Initially, there was a local parser for the UI preview and the live engine for execution. This caused drift where the two understood tokens differently. We now use a single resolver (`src/lib/mini/resolve.ts`) that transforms mini-notation into absolute MIDI pitches, ensuring that both preview and execution paths always read the exact same data. We also moved "To Clip" export purely into the engine worker so it supports all advanced Strudel transformations directly.

## The "Instrument" Device

An earlier device attempted to act as an instrument by driving a `[poly~]` synth, but it ended up reinventing a crude oscillator without utilizing Strudel's real audio capabilities. This was removed entirely in favor of the Audio FX device which processes track audio natively.

## Normalized (0-1) Parameters

A previous design mapped all audio parameters to a 0-1 range and applied scaling secretly inside the Max patch. This broke Live automation lanes and Push controllers, which displayed meaningless 0-1 values instead of real units (e.g. Hz). All parameters are now declared in their real units.

## The `ui:` merge that must not happen (the "unified app")

Sharing one `ui:` folder between the midi and fx devices was specified and then rejected on mechanism: the build loads ONE SURFACE per UI folder and generates a `live.*` object for every param in it, for every device using it - so the MIDI device would ship nine audio dials that drive nothing, and the FX device a Play toggle that does nothing, all visible in automation lanes and on Push. The stated intent ("share CODE across container types while each device keeps its identity") is what `src/app/shared/` already does. Revisit only if the library ever separates a device's surface from its UI folder.

## `#0` buffer scoping

The first attempt at instance-scoped buffer names used `#0`, documented for abstractions. An `.amxd` device patcher does not count as one: the token stayed literal everywhere, writer and reader agreed on one global name, and the collision survived silently. Replaced by Live's `---` device-scoped prefix (verified). The wrapper-minted-id route was ruled out earlier still: a `[buffer~]` takes its name from its creation argument and has no documented runtime rename, so a name minted after load cannot reach a box frozen at build time.

## Can our devices "maximize" like EQ Eight?

Status: exploratory. Nothing here is implemented. This document records what Live
actually offers, what it does not, and a preliminary design for the closest thing
we can build, split between m4l-jweb (the library) and m4l-gugelhupf (the devices).

### 1. The question

EQ Eight, Spectrum, Wavetable, Operator, Meld and a few other native devices have
a small arrow button in the device title bar ("Toggle Expanded View"). Clicking it
opens a large editor panel in Live's MAIN window, docked above the device chain,
sized by Live itself. Can a Max for Live device get that button?

### 2. The answer: no, and it is not close

The expanded view is a native-device feature. Live draws that panel itself; there
is no hook for it anywhere a Max for Live device can reach:

- The Live Object Model exposes no "expanded view" on Device, DeviceView or
  MaxDevice. There is nothing to call.
- The patcher inspector has no flag for it. Max for Live devices get exactly one
  rectangle in the chain: fixed height (169 px at 100% zoom), width taken from the
  presentation rects.
- Ableton's own Max for Live production guidelines list the full menu of "more
  space" techniques, and the main-window panel is not on it. What is on it:
  fold-out width (the device grows WIDER when an arrow button is clicked), tabbed
  views, overlay views, and pop-out windows opened with [pcontrol] - which the
  guidelines explicitly recommend setting to floating mode.
- The Cycling '74 forum thread asking for exactly this ("Expand height like
  Spectrum") ends where we do: not possible, people fake it with floating windows
  or dummy native devices, nobody has a real mechanism.

Nothing in Live 12.x changed this. Live 12.2 added the Max for Live device EDIT
button behavior (opens the patcher in Max), which is unrelated. So there is no
m4l-jweb feature that can conjure the real thing; the design below is about
building the best imitation Live permits.

Sources:
- https://cycling74.com/forums/expand-height-like-spectrum
- https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md
- https://www.ableton.com/en/live-manual/12/max-for-live-devices/

### 3. What IS available, honestly ranked

#### 3a. A large floating [jweb] window (what we already have, grown up)

m4l-jweb 0.7.x already builds this: `windows:` in surface.ts compiles to a
subpatcher holding its own [jweb], opened by [pcontrol], floated by
[thispatcher] `window flags float`. The `?` reference window and the Strudel
Studio window are this feature.

This is the ceiling Live allows, and it is genuinely close to the goal if we stop
treating it as an auxiliary popup and start treating it as THE expanded device:

- It can be any size, including near-fullscreen. Today's windows are fixed-size
  and small (420x620); nothing prevents a large, resizable one.
- Max windows remember where the user put them, so "my expanded view lives on my
  second monitor" works for free.
- The one hard limit we already measured and documented (HelpWindow.tsx): it
  cannot be ANCHORED to the device. Nothing reports where the device view sits
  on screen, so it can never look docked the way EQ Eight's panel does.
- The one architectural limit: a window is a separate Chromium context. It shares
  nothing with the device view except `state()` slots and Live parameters. An
  expanded view that mirrors the whole UI needs every piece of mirrored state to
  live in one of those two channels. The Studio window already proved the pattern
  (the `code` slot); an expanded view is the same pattern with more slots.

#### 3b. Fold-out width (the in-chain arrow button)

A real, Ableton-endorsed pattern: an arrow button on the device that widens the
device view in place, used by Surround Panner and others. It gives horizontal
space only; height stays 169 px. Worth having for the fx device (more dials, a
wider text line), useless for "a big pattern editor".

Caveat from our own history: runtime reflow of native live.* objects in a frozen
device did not work for us (fx surface.ts, the two-screens note); only hide/show
did. The fold-out pattern sidesteps this by pre-placing objects in the folded-out
area and scripting only the PATCHER width, but this needs a spike in a frozen
.amxd before we promise it. Treat as unproven until Phase 0 says otherwise.

#### 3c. Overlay / tabs inside the 169 px

Already effectively in use (the fx device's two layered screens). No new space,
just reuse. Not part of this design.

### 4. Preliminary design: "Expanded" as a first-class m4l-jweb feature

Goal: one arrow button on the device that opens a single large window containing
the FULL device UI, replacing the current scatter of special-purpose child
windows (`?` reference, Strudel Studio) with one "maximized device". The library
grows a small amount; the devices mostly reshuffle React code they already have.

#### 4a. m4l-jweb changes (C:\Users\jaime\src\m4l-jweb)

1. **Window spec grows sizing options** (packages/surface/src/index.ts).

   ```ts
   window({
     title: "Strudel Studio",
     entry: "Expanded",
     width: 1100, height: 700,   // initial size, as today
     resizable: true,            // NEW: user can drag-resize
     alwaysOnTop: true,
   })
   ```

   `resizable` compiles (packages/build/src/surface.mjs) to the subpatcher's
   window attributes: keep `float` in the `window flags` list, drop `nogrow`
   (or send `window flags grow`), then `window exec`. Today's windows are
   fixed-size; for a maximized-device window the user must be able to size it.

2. **Window open/close state reported back to the app** (packages/build +
   packages/wrapper + packages/surface).

   The device UI needs its arrow button to reflect reality (window closed by its
   own close box must un-press the button). Wire a [closebang] inside the
   generated window subpatcher to a message the wrapper forwards to all views as
   `window_<id>_closed`. Surface side: `useWindow(id)` hook returning
   `{ open, close, toggle, isOpen }` instead of today's fire-and-forget open.

3. **A transient (non-persisted) state channel** (packages/wrapper +
   packages/surface).

   Mirroring a whole UI across two Chromium contexts needs more shared state, and
   most of it is UI-only (caret token, active tab, selection). Today every slot
   persists into the Live set - already a named wart for `helpQuery`
   (src/app/shared/surface.ts). Add `state({ transient: true })`: broadcast to
   all views through the same [dict] path, excluded from the saved payload.

4. **Optional sugar: `expanded:` in the surface** - declares one window as THE
   expanded view and generates a native arrow button (live.text, top corner of
   the native panel) wired directly to the [pcontrol] open, so the device can be
   expanded even while the web UI is still loading. Nice-to-have; items 1-3 are
   the substance.

Non-goals for the library: docking, following the Live window, any use of the
LOM to find screen coordinates (measured dead end), and the fold-out width
pattern (device-side technique, not a library feature, pending the Phase 0
spike).

#### 4b. m4l-gugelhupf changes (this repo)

1. **One `expanded` window per device replaces the two windows the MIDI devices
   have today.** The Expanded entry composes what already exists: the pattern
   editor (StudioWindow's textarea), the ReferencePanel, and per-device extras
   (drum map for midi-drums, the fx line + dial readouts for fx). The `?` button
   stays but opens the expanded window scrolled to the reference panel, or the
   help window simply becomes a panel inside Expanded - one window to manage,
   not three.

2. **Device UI gets the arrow button** in the top corner of each App.tsx,
   mirroring EQ Eight's placement, driven by `useWindow("expanded")`. Pressed
   state tracks `isOpen` (library item 2).

3. **State audit per device**: everything the expanded view must mirror moves to
   slots if it is not already there. `code` already is. `helpQuery` flips to
   `transient: true`. Candidates to check: fx `named` (already a slot), sampler
   browser selection, drum map (already a slot).

4. **Engine stays in the device view.** Unchanged and non-negotiable
   (StudioWindow.tsx header comment): windows never receive `tick`, never
   schedule, never sound. The expanded view is an editor with a big screen, not
   a second engine.

#### 4c. Phasing

- **Phase 0 (spikes, half a day)**: (a) confirm `window flags grow` sticks in a
  frozen .amxd on Windows and Mac; (b) confirm [closebang] fires in a window
  subpatcher when the user closes it; (c) the fold-out width spike from 3b,
  which can fail without hurting the rest.
- **Phase 1 (m4l-jweb)**: items 1-3, new minor version.
- **Phase 2 (m4l-gugelhupf)**: consume it, starting with ONE device (midi) to
  shake out the state audit, then the rest.
- **Phase 3 (optional)**: fold-out width for the fx device if the spike worked;
  the `expanded:` sugar if the arrow button placement bothers us.

### 5. What to tell users

The honest framing for docs/ABOUT: "Live does not let plugins open EQ Eight
style panels in the main window; the arrow opens the device full-size in a
floating window instead, and it remembers where you put it." Setting the
expectation kills the bug report before it is filed.

## Offline superdough rendering and the double-buffered WAV loop - superseded by jweb~

**Verdict: parked for good. Not wrong, just obsolete: Max 9's [jweb~] made the whole
pipeline unnecessary.**

The problem it solved was real. [jweb] has no signal outlets, so a page that plays
audio is heard past the track, the fader and the monitor cue - the one sound in the
set Live cannot touch. The Route B design ("SUPERDOUGH Rendering") answered that wall
with a full offline pipeline:

- the page rendered one loop period of the pattern OFFLINE with the real superdough
  (OfflineAudioContext plus the DSP worklets), encoded it to WAV;
- saveToFile placed the WAV next to the device via [maxurl] (write .part, then a
  file:// GET as the atomic move);
- the `renderplay` chain looped it Max-side through a double-buffered pair of
  [buffer~]/[groove~] slots, crossfading to a fresh render at the loop boundary,
  pinned to Live's transport phase via render_sync;
- a conductor state machine in the app tracked which slot played and which loaded,
  with progress UI, sliders re-rendering at boundaries, and a determinism notice for
  random patterns (each audible cycle was one frozen roll of the dice).

It shipped, it worked, and it carried the project to 0.9.x. Its costs were structural,
not bugs: every edit took a render round-trip to be heard, disk I/O per render, a
whole Max-side transport-lock/crossfade mechanism to keep loops seamless, and a
conductor whose state machine was the hardest code in the repo.

Then [jweb~] (Max 9) gave the embedded browser SIGNAL outlets. The page's Web Audio
output now flows straight into the device's signal path (the `webaudio` chain sums it
in), so superdough plays LIVE in the page and Live hears it through the track. No
render, no WAV, no buffers, no conductor. The same discovery also retired the
`samples` chain ([buffer~]/[groove~] preview) and the `instrument` chain ([poly~]
voice allocation over buffer keymaps): decoding and playing in the page does the same
job in a fraction of the code.

What survives from the era: saveToFile and the `download` chain (a file on disk is
still the sample browser's drag-out handle), and the lesson that the engine clock and
the page's audio clock are different clocks - the offline renderer dodged that by
rendering against its own timeline, and the live path has to clamp against it
(src/app/superdough/useSuperdoughRender.ts).

The removed implementation, for archaeology: m4l-jweb's `renderplay`, `samples` and
`instrument` chains and their bridge APIs (renderLoad/renderArm/renderSync/
onRenderReady, loadSample/playVoice), and m4l-gugelhupf's src/lib/render/offline.ts,
src/lib/render/conductor.ts and their tests. All in git history before the 0.9.9
webaudio rewrite.

## Revealing a folder in the OS file manager (2026-07-21)

**What we wanted.** A "Show folder" button that opens Explorer/Finder on the folder a
device writes into, so the user can drag the file into Live.

**Why it cannot be done from a device.** The page cannot open a file manager, so it has
to ask Max, and Max offers exactly one door: `; max launchbrowser <arg>`, which hands the
argument to the OS default handler. On Windows 11, in Live, across three rounds of
testing:

- A percent-encoded `file:///C:/...%20...` URL DOES reach the shell - pointed at a
  non-existent folder it raised a real "Windows cannot find the file" dialog naming the
  path. Pointed at a folder that exists, it opened nothing and reported nothing.
- A native backslash path (`C:\Music\...`) behaved the same: silence.

`[js]` has no shell call and no delete call; there is no second Max object that reveals a
path. So there was no further form to try.

**What shipped instead.** "Copy folder path" - the page puts the folder on the clipboard
and the user pastes it into Explorer/Finder. It needs no Max message and nothing
platform-specific. It came with a tar pit of its own; see the next entry.

**IT IS THE ARGUMENT, NOT THE CALL (measured 2026-07-22).** `launchbrowser` works
perfectly for an `http(s)://` URL: every device's About panel opens github.com and
strudel.cc in the user's real browser through it, outside Live. So the door is open and
only `file://` paths fall through it - do not read this entry as "launchbrowser is
dead". Opening a web page from a device is a solved problem
(`src/app/shared/openExternal.ts`); revealing a FOLDER is the part that is not.

**The transferable lesson.** `launchbrowser` failing silently is the trap. It is fire and
forget - no reply, no error - so a device that relies on it looks correct in code, logs
nothing, and simply does nothing. Prefer a mechanism that can report its own outcome, even
a cruder one.

## Copying to the clipboard from a device page (2026-07-21)

**What we wanted.** The replacement for the reveal above: click a button, the folder path
lands on the system clipboard.

**Every mechanism a `file://` page has, and how each one failed:**

- **`navigator.clipboard.writeText()`** - gated on a SECURE CONTEXT. A device page is
  loaded from `file://`, which is not one, so the API is typically absent altogether.
- **`navigator.clipboard?.writeText(...)` with optional chaining** - the trap that made
  the absence WORSE than useless. On a page with no clipboard API the expression is
  `undefined`, `await undefined` resolves happily, and the code reported a successful
  copy having called nothing at all. An API that might not exist has to be tested for,
  not chained through.
- **`document.execCommand("copy")`** - no secure-context gate, works in plenty of CEF
  builds, and **returned `true` in Live while putting nothing on the system clipboard**.
  This is the bad one: a false success, in a device that then told the user "Path
  copied" over an empty clipboard.
- **Reading it back to check** - `navigator.clipboard.readText()` needs the same secure
  context the write did. There is no verification path. A copy can be CLAIMED but never
  CONFIRMED from inside the page.

**What shipped instead.** Inside jweb, no claim is trusted. The programmatic copy is still
attempted (it costs nothing and does work in some builds), and then the path is shown in a
focused, pre-selected field over the device; the browser's own `copy` event is taken as the
confirmation, because that one fires only when a copy really happens. The status line says
"Path copied" for a confirmed copy and "Not copied - the folder is <path>" otherwise, so
the path is reachable either way.

**UNVERIFIED as of 1.0.0.** Export failed before writing a file (`could not place save: -1
bytes`), and the Copy button only appears once something has been written - so the whole
mechanism is still untested in Live. TODO items 0 and 1.

**The transferable lesson, and it is the same one twice:** in a frozen device page, prefer
the mechanism that can report its own outcome. Where none can, do not invent a reassuring
message - make the user's own action the confirmation.

## Mirroring the Studio's canvas into the device view (2026-07-22)

The device view should show what the Studio DRAWS - a `.scope()`, a `.pianoroll()`,
a hydra sketch - not a visual of our own. Three routes were considered and all three
are closed:

- **Share the audio.** `[jweb~]` is "Web browser with audio output": one control
  inlet, no signal inlet (Max 9 reference). No page can be handed audio, so the device
  view cannot compute a scope of the Studio's sound.
- **Share the pixels.** Two Chromium contexts share no memory, there is no server, and
  jweb offers no frame grab.
- **Re-run the code.** Mirroring the evaluated text and running hydra again in the
  device view reproduces HYDRA and nothing else - not `.scope()`, not `.pianoroll()`,
  which strudel draws from its own scheduler state.

The one transport that would work is shipping JPEG frames of the Studio's canvas as
Max messages (`toDataURL` -> a symbol -> an `<img>`). NOT BUILT, deliberately:
`toDataURL` is a synchronous GPU read, and it would run inside the page that is making
the sound, so a stall there is an audio dropout rather than a dropped frame. Not worth
it for a picture.

What shipped instead: a `[peakamp~]` tap on the window's outlets at 10 ms, drawn by the
device view as its own trace. Honest at that rate, and it costs two floats per report.
If the mirrored picture is ever wanted badly enough, measure the frame cost on the
AUDIO page first - that is the number that decides it, not the message size.

## Three non-fixes for the choppy Studio (2026-07-23)

The Studio's dropouts had one cause - the unset `[jweb~]` `latency` (now shipped at 66,
see ARCHITECTURE 4k). A spike matrix on branch feat/strudel-performance tested three
other suspects against a sustained tone; each is recorded here so none is re-run:

- **Slower level tap.** Raising `[peakamp~]` from 10 ms to 50 ms (5x less message
  traffic into `[js]`) changed nothing audible - the tap was never the load. The tap
  stays at 10 ms.
- **`rendermode: 0` (onscreen).** The Max reference calls offscreen "slower", so onscreen
  looked like a free win. It HALTS the audio graph within seconds. The default `1`
  (offscreen) is not a mistake to fix; it is required.
- **Withholding the device-page engine.** The device view boots its own superdough for
  the scratchpad, a second AudioContext alongside the Studio's; leaving it un-booted until
  the scratchpad is played was expected to free the audio thread. It HALTS the Studio's
  sound outright within 3-4 s. The two graphs are not independent the way the model
  assumed, and the device-page engine boots at load as before.

Method note: none of these could be told apart from inside the page. `outputLatency`
sits upstream of the `[jweb~]` ring buffer, so the console's `drift` numbers looked
identical across all four while only `latency` mattered. A sustained tone and the ear
were the instrument that resolved it; a dense pattern hid the dropouts entirely.

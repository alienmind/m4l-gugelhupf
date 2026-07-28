# m4l-gugelhupf - Architecture

One repo → six self-contained Max for Live devices, each with its own React UI bundle, built on the [M4L-JWEB](https://github.com/alienmind/m4l-jweb) library.

This document describes the high-level architecture, the build pipeline, the runtime anatomy, the message protocol, and exactly how we integrate with upstream Strudel. For the underlying M4L-JWEB approach itself (the `.amxd` container writer, generated patchers, the `[js]` lifecycle, the Surface) see [m4l-jweb's own doc/ARCHITECTURE.md](https://github.com/alienmind/m4l-jweb/blob/main/doc/ARCHITECTURE.md).

> **0.9.9 - now migrated to `jweb~`.** Max 9's `[jweb~]` is an audio-capable browser object.
> Until 0.9.5 used older [jweb] and everything was built on the assumption that a page could not put
> sound on the track so lots of nasty workarounds were in place.
> `[jweb~]` has signal outlets, so the page's Web Audio output *is* the device's
> audio now.

```
┌──────────────────────────── one repo ────────────────────────────┐
│  src/app/midi/          the MIDI device's UI                      │
│  src/app/drums-midi/    the Drums MIDI device's UI                │
│  src/app/drums-sampler/ the Drums Sampler device's UI             │
│  src/app/sample-browser/ the sample browser's UI                  │
│  src/app/strudel/       the main Strudel device's UI               │
│  src/app/synth/         the Synth device's UI                      │
│  src/app/fx/            the Audio FX device's UI                  │
│  src/app/shared/        engine hook + worker + webaudio + Button  │
│  src/lib/mini/          the mini-notation parser + resolver       │
│  src/lib/fx.ts          the effects-line reader                   │
│  src/lib/samples.ts     the sample-map catalog (fetched in page)  │
│  src/lib/render/        the offline bounce (Export audio)         │
│  src/max/shared/        engine.mjs, transport.mjs (engine devices)│
│  wrapper/device.ts      [js] glue shared by all devices, ES5      │
│  patcher/devices.mjs    the manifest; patcher/chains.mjs: chains  │
│  strudel/               upstream Strudel (git submodule)          │
└──────────────────────────────┬────────────────────────────────────┘
                          pnpm build
                 (@m4l-jweb/build under the hood)
                               ▼
                    seven self-contained .amxd
                               │
   ├── alienmind-gugelhupf.amxd                (instrument)
   ├── alienmind-gugelhupf-synth.amxd          (instrument)
   ├── alienmind-gugelhupf-drums-sampler.amxd  (instrument)
   ├── alienmind-gugelhupf-sample-browser.amxd (instrument)
   ├── alienmind-gugelhupf-midi.amxd           (MIDI)
   ├── alienmind-gugelhupf-drums-midi.amxd     (MIDI)
   └── alienmind-gugelhupf-fx.amxd             (audio)
```

`alienmind-gugelhupf` is the main device and carries the plain name; it was
`alienmind-gugelhupf-superdough` until 1.0.0 (the engine is still superdough, but the
device is the whole language). Every other device keeps its suffix.

An **instrument** originates sound and fills a track's instrument slot (strudel, the
synth, the drums sampler, and the sample browser - a preview is a sound source, not a
process).
An **audio** effect processes what is already on the track (fx).
A **MIDI** device emits notes and has no signal path at all (midi, drums-midi).

## 1. The Build Pipeline

`pnpm build` runs three stages, all plain Node scripts, with no manual Max steps:

```bash
tsc -b                          # typecheck every device's app + the scripts
scripts/build-ui.mjs            # ONE vite build per device → dist/ui/<device>/index.html
m4l-jweb build                  # @m4l-jweb/build: wrapper compile + patcher generation + amxd writer
```

This repo defines the manifest (`patcher/devices.mjs`), custom chains (`patcher/chains.mjs`), LiveAPI extensions (`wrapper/device.ts`), and the React UI (`src/app/<device>/`). The complex lifting of generating patchers and writing `.amxd` containers is handled by `@m4l-jweb/build`.

### Engine Bundling

The engine (`@strudel/{core,mini,transpiler,tonal}`) is aliased directly into the `strudel/` git submodule. For the MIDI devices, `engine.worker.js` is imported with `?worker&inline`, so the entire engine is compiled into an inlined module-worker blob inside the UI bundle. The Audio FX and Sample Browser devices never import this file, keeping their payloads very small.

### The `.amxd` Container Writer

The build writes self-contained `.amxd` files from scratch. The UI html (and inlined worker) is frozen into the container as a dependency file, and it is appended to `wrapper.js` as a base64 payload. This is extracted to a real file on first load, since the embedded Chromium cannot read Max's virtual filesystem.

## 2. Runtime Anatomy of a Device

Every device runs entirely within `[jweb~]` and `[js] wrapper.js`. **We do not use `[node.script]` anywhere in this repository.**

```
 [live.thisdevice] ─▶ [js wrapper.js <mode>]  (ES5, LiveAPI work - wrapper/device.ts
                          │ outlet0 ▲          on top of @m4l-jweb/wrapper's core.ts/liveapi.ts)
                          ▼         │ (unmatched [route] output: ui_ready, write_clip, read_notes)
                      [jweb~] ──────┘  outlet 2 = messages
                    ╱  │  ╲   ▲
       outlet 0 ───╯   │    ╲ └── ticks + tempo from [js] (LiveAPI poll/observer)
       outlet 1 ────╲  │     ╲
      (signal L/R)   ╲ ▼      ╲
                      React UI (+ engine worker)
                       │
                       ├── audio devices: signal L/R ─▶ [+~] ─▶ ... ─▶ [plugout~]
                       │                                (`webaudio` chain)
                       └── MIDI devices: [route midinote flush] (`midiout` chain)
                                            │
                              pipe→makenote→midiformat→midiout
```

- **`[jweb~]`**: Hosts each device's own React UI bundle, and carries the page's Web Audio output on its two signal outlets. The MIDI devices and the pattern devices also run the Strudel engine in a dedicated Web Worker (`engine.worker.js`).
- **`[js] wrapper.js`**: Owns the lifecycle, payload extraction, and transport observers. `wrapper/device.ts` extends this with specific mode resolution, clip I/O, and Live 12 scale observers. It also responds to `fetch_to_file` and the `save_*` (saveToFile) requests from the page.
- **Transport Ticks**: The wrapper polls Live's transport and emits `tick <playing> <beats>` into the page. Every device sequences against those ticks.

### 2c. Audio: `[jweb~]` and the `webaudio` chain

**`[jweb~]` capabilities.** It has **three** outlets - signal L, signal R, then messages -
so the browser's Web Audio output lands *in Max's audio graph*. Two consequences the build
must honour:

- **The message stream moved to outlet 2.** Everything in the bridge that read `[jweb, 0]`
  now reads `[jweb~, 2]` (`claimAppMessages` in m4l-jweb's `chains.mjs`). This is the one
  breaking change for any device built on the framework.
- **A new `webaudio` chain** takes signal outlets 0 and 1 and sums them into the device's
  signal path with `[+~]`, then hands the path on (`ctx.setAudioOut`). Summing rather than
  claiming means an audio effect stays a pass-through of what the track already carries,
  while an instrument simply has silence to sum onto. Max-side chains still compose after
  it: `chains: ["webaudio", "lowpass"]` is the page's audio through a `[onepole~]`.

**Simplifications after migrating from [jweb] to [jweb~]** The `renderplay`, `samples` and
`instrument` chains and their bridge APIs are gone from m4l-jweb; `offline.ts`'s loop-playback
role, the conductor state machine, the double buffer, the transport-locked crossfade and
the render progress UI are gone from here. Sample playback is `decodeAudioData` + `AudioBufferSourceNode`
in the page (`src/app/shared/webaudio.ts`); polyphony is the browser's problem,
which is to say it is not a problem.

**The one new hazard: two clocks.** The engine worker schedules haps against *Live's*
transport (or its own free-run timer when the transport is stopped) and hands each event a
`delayMs`. The page's `AudioContext` under `[jweb~]` runs on a *different* clock. They
drift. Superdough refuses to schedule an event whose target time is already in the past, so
unbounded drift silently turns into silence once it exceeds the lookahead window - the
audio appears to "collapse" after a while. The sink therefore **clamps**: an event that
arrives late plays at `currentTime + 10 ms` instead of being dropped, and sustained lateness
is logged to the jweb console (`[superdough-sink] N late events, worst Xms`) so the drift is
visible rather than mysterious. If that warning shows *growing* lateness in Live, suspect a
sample-rate mismatch between the page's `AudioContext` and Live's audio driver before
anything else.

**Devices that stayed on Max DSP, deliberately.** The fx device's graph is unchanged. Its
whole point is native `live.dial` parameters that automate, MIDI-map and reach Push; that is
a Max-side property, not an audio-quality one, so there is nothing to gain by moving its
DSP into the page.

**Two side consequences:**

- **MIDI-only devices keep `[jweb~]` too.** They have no signal path and their audio outlets
  simply go unconnected. This is just simplification.

### Transport → Pattern Scheduling

`LiveTransport` converts incoming ticks to Strudel time (1 cycle = 1 bar of 4/4). On each tick, it extends a lookahead window (120-150 ms) and asks the engine for new events in that slice. The worker posts this batch to the UI thread, which dispatches `midinote` events through `@m4l-jweb/bridge`. Delay amounts are applied Max-side by `[pipe]` to ensure precise timing, eliminating Chromium timer jitter.

### The `$:` Collector

Strudel's `$:` assignment is not part of the standard engine build. We implement this collector inside `engine.mjs`, registering `$:` patterns and evaluating them together at `compile()`. Check this against `strudel/packages/core/repl.mjs` when updating the submodule.

### 2d. Writing files: the `download` chain is not about downloading

Learned the hard way while building Export, and it generalises well past this repo.

**`download` owns `[maxurl]`, so ANY device that writes a file needs that chain** - even
one that never downloads anything. `saveToFile` runs in three phases: `[js] File` writes
the bytes to a scratch file, the wrapper verifies the byte count, and phase three asks
`[maxurl]` to place the scratch file over the destination with a `file://` GET. The first
two phases need no chain at all, so a device without `download` writes its bytes
perfectly and then fails **silently** at the last step: the request leaves on an aux
outlet with nothing on the other end, no reply ever comes, the promise never settles, and
the UI sits on "Rendering..." forever beside a `.part` file that looks almost right. That
is exactly how the main Strudel device shipped for a day.

**Why the place step exists: atomicity.** The destination is not touched until the bytes
on disk have been counted and match what the app promised. A crash, a Live quit or a
short write leaves the scratch file behind and the real filename either absent or still
holding its previous, valid contents - never a half-written WAV that Live will try to
load.

**The scratch file is one fixed name per folder, not `<dest>.part`.** `[js]` cannot
delete a file - there is no such call in Max's JS API - so a spent scratch file is
truncated to zero bytes and left behind. Naming it after the destination was fine while
the only writer was the sample browser, whose filenames come from the sample's URL: the
same sample re-fetched reused the same scratch file. An audio export names its file after
the moment it was rendered, so every bounce stranded another zero-byte
`strudel-export-<timestamp>.wav.part` next to the real one, accumulating forever. The
wrapper uses one `m4l-jweb-save.part` per device folder now - reused, overwritten, and at
worst a single stray empty file however many exports are made. (Upstream in
`@m4l-jweb/wrapper`; `tests/wrapper-max.test.mjs` pins it.)

**OPEN, 1.0.0: `could not place save: -1 bytes at destination`.** Export on the Strudel
device renders and then fails at exactly this last step, in Live. `-1` is the wrapper's
"cannot size the destination file at all", so the scratch file was never placed over the
target - not placed short. The save protocol is the library's, so the fault may be
upstream; m4l-jweb 1.0.0 carries a related fix (one reused scratch file per folder) that
landed after this was seen, and re-testing against it comes before debugging anything
here. Diagnostic order: does the `.part` exist at the right size after `save_end`; does
`deviceFolder()` resolve to a real writable directory (an unsaved patcher has none); is
the `download` chain - which owns [maxurl], and therefore the place step - really wired.
Tracked as TODO item 1. It NO LONGER blocks the clipboard item behind it: the Copy
button used to appear only once a file had been written, so a device whose Export was
failing could never be used to test the copy at all. The folder is known at `ui_ready`,
independently of any write, and the button now follows the folder.

**The rule that used to be carried by hand, and is now declared.** A device that wrote a
file needed `download` in its chain list AND `HAS_DEVICE_FOLDER` in `wrapper/device.ts` -
two facts about one device, kept in step by memory, with a silent failure if either was
missed. Both come from `src/app/<device>/files.ts` now (`defineFiles({ saves: true })`,
upstream in 1.3.0): the build derives the chain, and the packaged wrapper sends
`device_folder` itself. `wrapper/device.ts` has no `sendFolder()` any more, and the
manifest entries list no `download`.

Where a device writes is still its own business, and the copy affordance must agree with
it: the sample browser downloads into a `samples/` subfolder and offers that path, the
exporters write flat into the device folder and offer that. A path offered for a folder
nobody created is not a no-op, it is an OS error dialog - which is why the browser's
button still waits for a first download while the exporters' do not.

**Rendering while playing: superdough is a singleton, so a bounce is a handover.**
`getAudioContext()`, the output controller and the node pool are all module-level in
superdough, and the node pool is keyed by node type ACROSS contexts. `renderCycles`
swaps the context for an `OfflineAudioContext`, so anything the live path does in that
window - a hap the sink schedules, or a node it pooled beforehand - can end up connecting
across two contexts: *"cannot connect to an AudioNode belonging to a different audio
context"*. It presents as intermittent, because whether it throws depends on what the
pool happens to be holding. The fix is a deliberate handover rather than a lock: the
sink stands down for the render (`bouncing`), the pool is cleared on BOTH sides of it,
and the previous context and controller are put back afterwards - not set to `null`,
which would make the next `getAudioContext()` build a fresh realtime context and leave
a `[jweb~]` device playing out of a context that reaches no signal outlet. Playback goes
quiet for the length of the bounce, re-anchors, and resumes.

## 3. Message Protocol (jweb ⇄ js)

Each device defines its selectors in `src/app/<device>/protocol.ts`, extending `@m4l-jweb/bridge` base events.

| Direction | Message | Meaning |
|---|---|---|
| UI → js (all) | `ui_ready` | handshake |
| js → UI (all) | `mode`, `build`, `tick <playing> <beats>`, `tempo <bpm>` | `DEVICE_IN`, sent by the packaged wrapper |
| UI → js (midi) | `write_clip ...`, `read_notes` | clip I/O |
| js → UI (midi) | `notes ...`, `clip_available`, `read_error`, `write_error`, `scale` | clip replies + Live scale (`*_error` carry `no_track`/`no_clip`/`no_slot`) |
| UI → Max (midi) | `midinote ...`, `flush` | scheduled engine output, via `sendNote()`/`flushNotes()` |
| UI ⇄ worker (pattern devices) | `code`/`hush`/`tick` in, `ready`/`evalok`/`evalerr`/`notes`/`voices`/`doughEvents`/`flush` out | postMessage, not Max messages |
| UI ⇄ Max (browser, strudel) | `fetch_to_file` / `fetch_done`, `save_begin`/`save_chunk`/`save_end` / `save_done` | the `download` chain: file acquisition and `saveToFile` |
| UI ⇄ js (drums, fx) | `sync_state <id> <json>`, `state_<id> <json>` | state slots, via `useStateSync()` |

Audio itself is **not** in this table any more: it leaves the page as a signal on
`[jweb~]`'s outlets 0 and 1, not as messages. The `buffer_load`/`buffer_play`/`voice_play`
selectors of the 0.9.x `samples` and `instrument` chains no longer exist.

## 4. Device Features

### 4a. MIDI Devices: The Resolver and Clip Export

The MIDI devices support both bare mini-notation (`0 [2 ~] bd*2`) and full Strudel code (`note("c3").fast(2)`).

**The Resolver:** `src/lib/mini/resolve.ts` ensures Live Play and To Clip always agree. It rewrites bare mini-notation into absolute MIDI numbers in place (e.g. `"0 [2 ~] bd*2"` becomes `"60 [64 ~] 36*2"`). Live Play and To Clip then compile the exact same string, eliminating any divergence in scale degrees or octaves. The active scale is maintained in `src/lib/mini/scales.ts` and synced with Live's active scale.

**To Clip Export:** The clip exporter uses the Strudel engine. The UI sends the code to the Web Worker, which evaluates it, computes the true loop length (`patternCycles()`), and queries the whole window at once. Because the engine handles it, all Strudel transformations (`.jux()`, `.transpose()`, `.add()`) are fully supported when exporting.

**Macro-mappable transport.** `play` is a real Live parameter (a `live.text` "Play/Stop" button), so a Rack macro or a Push button can start and stop the sequencer. A Live parameter is only *mappable* if it has a presentation rect - an invisible parameter cannot be clicked in map mode - so the MIDI device reveals it in a native panel behind a view switch, exactly like the FX device's knob panel (`layout.native` with `panel: true` + `switch`, driven by `useNativePanel`). The web editor stays the default view; the "Macro" button flips to the native panel to expose the button for mapping, and its "Back" switch returns. (Only the MIDI device places it natively today; the Drums device shares the parameter but not the panel.)

**Clip I/O inside a Rack.** Clip read/write target the device's *track*, but `this_device canonical_parent` is the **Chain**, not the Track, when the device sits in an Instrument/Audio Rack - a Chain has no `clip_slots`, so the naive path both broke `getcount` (a `jsliveapi: invalid property name` once a second from the availability poll) and would have written to the wrong object. The wrapper's `ownTrack()` therefore climbs `canonical_parent` until it reaches a `Track` (no hop on a bare track, one in a rack, several when nested). Where no track resolves at all, `read_notes`/`write_clip` reply `read_error`/`write_error` with reason `no_track`, and the UI disables **both** clip buttons with a tooltip - the "disable on first fail" fallback - distinct from `no_clip` (nothing to read) and `no_slot` (track full), which are transient, not structural. (Fix lives upstream in `@m4l-jweb/wrapper` `liveapi.ts`.)

### 4b. Audio FX Device: The Frozen Graph

`src/lib/fx.ts` reads effect lines (e.g. `.lpf(800).gain(1.2)`) and produces parameter values. There is no parser; method chaining is evaluated against a recorder object.

**Real Units:** Parameters are defined in real units (`Hz`, `dB`), not normalized 0-1 ranges. `.lpf(800)` always means 800 Hz. The scaling curve is configured in the `Surface` parameter definition (`src/app/fx/surface.ts`).

**The Frozen Graph Law:** The Max patcher DSP graph is generated at build time. The JS only provides values.
- Every effect always exists in the graph. Setting an effect means altering its values. Missing effects are disabled by setting their parameter to a neutral state.
- The order of effects is frozen (`lowpass, hpf, drive, crush, delay, reverb, gain`). Typing `.gain(1.2).lpf(800)` produces the same routing as `.lpf(800).gain(1.2)`.
- All nine stages make sound: `.lpf()`, `.hpf()`, `.drive()`, `.crush()`, `.delay()` (+ time/feedback), `.room()` and `.gain()`, all confirmed audible in Live.
- **`hpf` is the lowpass's COMPLEMENT, not a highpass object.** Max's `onepole~` is lowpass-only, and a one-pole highpass is exactly `dry - lowpass(dry)`. That is what makes 0 Hz a TRUE neutral: a lowpass at 0 Hz passes nothing, so the subtraction returns the dry signal bit-for-bit. A highpass object would rest at its cutoff floor, still turning DC - an always-on colouration the frozen-graph law forbids.
- **`crush` rests at 24 bits, NOT Strudel's 16.** Strudel calls `.crush(16)` "minimum crush", but 16-bit quantisation is a quiet crush, not a wire, and a stage always in the path needs a setting where it does nothing. `.crush(16)` still gives 16-bit quantisation exactly as superdough does.

**Pattern modulation (`.lpf(sine.range(200, 2000))`):** a signal argument parses into a `patterned` stage carrying the Strudel pattern AND its source text; `src/app/fx/useModulation.ts` makes it move, on the library's `remote` chain (one `live.remote~` per slot, `remotes: 9` in the manifest, mapped by RACK index - no allocator). Verified end to end in Live. The design in one paragraph:

- **The clock**: one cycle = one 4/4 bar (`beats/4`), locked to `current_song_time` from the wrapper's 20 Hz `tick` - sweeps land on the downbeat at any tempo and survive loop jumps. No cps to honour: a one-line fx chain has no `setcpm()`.
- **Bind/stream/release**: `resolveParamId()` + `bindRemote()` when a stage becomes modulated; `queryFxPattern()` + `writeRemote()` per tick while the transport runs; `bindRemote(slot, 0)` when the stage stops - a bound `live.remote~` owns the parameter exclusively and would freeze the dial. LOM ids are resolved on mount and never persisted (a set reload reloads the page, so the hook re-resolves; ids do not survive a reload).
- **The units warp**: `live.remote~` takes knob TRAVEL, not the parameter's units (measured upstream - see m4l-jweb's ARCHITECTURE.md). `toRemote()` clamps into the dial's range and aims the travel at `norm(v)^(1/exponent)` so Live's re-applied exponent lands where the pattern asked. Exponent-1 dials pass through untouched.
- **Source persistence**: a modulated stage's expression is the only record of what the user asked for - a Pattern cannot say what it was written as, and the parameter holds only where the sweep last was. The `sources` state slot (param -> expression) persists it; without it a committed `.lpf(sine.range(200, 2000))` reprinted as `.lpf(18000)`.

**The Two-Screen Native UI (m4l-jweb 0.7.0):** The nine fx parameters are NATIVE `live.dial` objects, declared in `src/app/fx/surface.ts` via `layout: { native: { ..., panel: true, switch: "knobs" } }`. This shed the HTML sliders, so the dials automate, MIDI-map and hit Push like any factory device. Nine dials broke the Push bank budget (8 per page - the library throws on a ninth), so the banks split where the rack splits: **Tone** (cutoff, hpfreq, drive, crush) and **Space** (delay, delaytime, delayfeedback, room, gain).

Because a frozen M4L device can hide/show native objects at runtime but **cannot reposition them**,
the device is not one reflowing view but **two layered screens**, flipped by `useNativePanel`:
- **Web mode** — the `[jweb~]` (full width) shows the Strudel line UI; all dials hidden.
- **Knob panel** — the `[jweb~]` is hidden, revealing all nine dials in two rows, plus a "Back" `button` (a `live.text`, top-right) that returns to the web UI. The web UI paints a matching "Knobs" button at the same spot.

**Defensive state coercion:** `App.tsx` coerces the `named` slot to an array and `sources` to an object before use. The two bugs that motivated it are both fixed upstream (the `[dict]` envelope, and state-default seeding - see m4l-jweb's ARCHITECTURE.md), but the coercion stays: a malformed slot must degrade to "nothing named yet", not unmount the device to a black screen.

### 4b-2. The reference and help windows

The three Strudel-taking devices have a `?` (shared `HelpButton`) opening a "Supported Strudel features" window - **our reference, not a link to strudel.cc**, because a Live set is often open with no internet, and because strudel.cc documents Strudel while this documents THESE DEVICES: `.crush()` is real here, `.vowel()` silently is not, and a bare number is a scale degree in our mini-notation but a raw MIDI pitch in full code. Each entry carries a `status` (works / not yet / syntax) and the list is filtered per device; `only` is REQUIRED on every entry so a new one cannot be added without answering which devices it belongs to. The sample browser has no `?`, deliberately: it takes no Strudel at all. `src/lib/__tests__/reference.test.ts` ties the data to the code it describes - every RACK stage must be listed as working, and nothing marked working may be an effect the parser refuses.

The floating window is pinned (`alwaysOnTop`) and follows the caret: the device view writes the token being typed into a `helpQuery` state slot and the window narrows to it. It is a HEURISTIC, not a parser - half-typed code does not parse, and that is exactly when help is wanted. The wart, named: the slot persists, so the last word typed about is saved with the set - the library has no transient channel between views. Window placement stops at "420 px wide, remembers where you drag it": nothing reports where Live draws a device on screen.

The **Full Studio window** is the same pattern grown up: a big editor over the same `code` state slot, so the window and device view are two views of ONE pattern. An EDITOR, not an engine - the device view alone receives `tick`, so there is one scheduler however many views are open (the claim to re-check: exactly ONE stream of notes; doubled notes mean the window has grown an engine).

### 4c. Sample Browser: Downloader and Preview

The sample browser browses, downloads, and previews Strudel sample maps. An **instrument**:
it originates the preview and processes nothing.

- **The Catalog:** A `fetch()` request directly in the page reads `strudel.json` data, resolving pseudo-URLs into fully qualified absolute URLs.
- **The Preview:** One `fetch()` per audition, `decodeAudioData` into an `AudioBuffer`, played through `playBuffer()` (`src/app/shared/webaudio.ts`) - and therefore out of `[jweb~]` into the track, past the fader and the monitor cue. Previews are still quantized to Live's `clip_trigger_quantization` grid and loop on a whole number of bars at the current tempo.
- **The Download:** the same bytes are also written to disk via `saveToFile()` (the `download` chain's `[maxurl]` atomic place). Playback no longer needs the file - but the *drag-out handle* will potentially need it. A row you can drag into a Simpler is the point of the device, and that requires a real file. The save is not awaited before playing: the preview should not wait on the disk.

Auditioning is still acquiring - there is no separate Download button, because previewing a sample writes it, and two buttons would imply two outcomes. Decoded samples are cached per path in memory, so re-auditioning replays instantly.

### 4d. Strudel Drums Sampler: a code-driven, bank-based sampler

`alienmind-gugelhupf-drums-sampler` (`src/app/drums-sampler/`) is an INSTRUMENT device (`type: "instrument"`) on the `webaudio` + `midiin` chains: samples are fetched, decoded and played *in the page*, and it keeps its MIDI input ports (an instrument does). It is NOT a pad rack: sounds are keyed by NAME, and the device is driven by CODE first.

- **`s()` -> sound, via a bank.** The CODE screen runs a Strudel `s("bd sd, hh*8")` pattern through the shared engine (`voiceSink`, §3a) - bare mini-notation (`bd sd, hh!6`) is wrapped in `s(...)` by `asSampleCode`, not resolved to pitches. Each hap's sample name resolves against the selected BANK - a tidal-drum-machine, strudel's `bank()` prefix: `bd` with bank `RolandTR909` is the catalog key `RolandTR909_bd`. A `.bank("AkaiLinn")` in the pattern overrides the dropdown per-hap. The catalog is strudel's own generated `tidal-drum-machines.json` (`DRUM_MACHINES_URL` in `lib/samples.ts`, base rewritten ritchse->geikha for the moved repo).
- **MIDI notes drive it too.** A note into the track maps to a drum sound by the Drum Rack / General MIDI convention (`NOTE_SOUND`: 36 = bd, 38 = sd, 42 = hh, ...) and plays the selected bank's sample for it - so a MIDI sequencer (or the Drums MIDI device) in front of the Sampler plays the same bank.
- **Auto-load, decoded in the page.** The first time a sound is named it is fetched and decoded to an `AudioBuffer` (deadlined at 30 s, deduped by an in-flight set so a repeated hap does not fire a second download); it sounds from the next cycle. Up to `MAX_RESIDENT` (64) decoded sounds stay in memory, LRU past that - a full drum machine and change, against the 16 the `[poly~]` era could hold. Playback is one `AudioBufferSourceNode` per hit with velocity as gain, so **polyphony is free**: no voice allocation, no stealing, no slot bookkeeping. Nothing touches the disk for playback; the only file this device writes is an Export.
- **Instances are naturally independent.** Each device instance is its own page with its own cache, so two Samplers in one set cannot collide - the `---`-scoped buffer names that used to guarantee this are no longer needed.

### 4e. Shared device chrome

Every device draws from one set of parts, so the six faces read as one product rather than six apps:

- **`shared/Button.tsx`** - one black-and-white (grey) button, built on shadcn's shape without shadcn's palette: a `class-variance-authority` (`cva`) recipe of `variant` (`solid`/`ghost`/`link`) and `size`, with `cn` merging the caller's classes, but every colour token resolves through this repo's monochrome theme (index.css, each falling back to a `--live-*` variable) so a device reads as part of Live. `active` is the only lift (a faint primary wash, e.g. Run while playing), applied as a `cva` compound variant; there are no accent/primary/destructive colours. Primary actions sit in the top bar, the `?` (`HelpButton`) rightmost. Adopting the `cva` shape here is the shadcn migration the backlog once tracked - the primitive's structure is conventional, the palette stays ours; the other chrome parts follow the same pattern as they are touched, not in a big-bang rewrite.
- **`shared/AboutPanel.tsx`** - the title opens it. It carries an **Advanced** section with the device's set-once, native affordances so they do not clutter the top bar: **Full Studio** (the pattern devices' big editor window, `onOpenStudio`) and **Controls** (`onShowControls`, revealing the native panel - the MIDI device's mappable Play/Stop). The FX device is the exception: its native **Knobs** panel is the primary interaction, so it keeps that button in the top bar.
- **`shared/PatternEditor.tsx` + `lib/highlight.ts`** - the device view's scratchpad is a `<textarea>` with a painted layer behind it, and `lib/highlight.ts` is a single-pass regex tokenizer (strings, numbers, comments, called methods, keywords, punctuation) that colours it. NOT a parser and deliberately not CodeMirror: the view is 169 px tall and what it needs is legibility, not a grammar. A double-quoted string earns the strongest colour because in Strudel it is mini notation - the pattern itself. The tokenizer never throws and never drops a character (the concatenation of all runs equals the input, pinned by `highlight.test.ts`); a lost character would silently corrupt what the user sees they typed. Bracket matching or scope-aware completion would be the reason to move this view to CodeMirror rather than to grow the tokenizer.

### 4f. The Strudel device: all of Strudel, live

`alienmind-gugelhupf` is the REAL superdough - every synth, sample, orbit and
effect strudel.cc plays, because it *is* superdough, not a port - running live in the page
and heard through the track. An instrument on the `webaudio` chain alone.

- **The split: worker schedules, page sounds.** The engine worker owns pattern time exactly
  as it does for the MIDI devices - it compiles, queries a lookahead window per transport
  tick, and posts events out. The only new sink is `superdough`: each hap goes over as
  `{value, durMs, delayMs, cps, cycle}` and the UI thread calls the real `superdough()` with
  it. `cps` and `cycle` are carried deliberately: without them superdough assumes 0.5 cps and
  tempo-synced effects (`.delay()`, phaser) run at the wrong rate.
- **Scheduling is clamped, not trusted.** See §2c - the worker's clock and the page's
  `AudioContext` are different clocks, and superdough drops events scheduled in the past.
  `useStrudelRender.ts` clamps a late event to `currentTime + 10 ms` and reports
  sustained lateness to the console.
- **The eval scope.** A pattern written on strudel.cc reaches for helpers the headless engine
  does not have (`setcps`, `slider`, `_scope`, draw params). `installReplShims()` in
  `engine.mjs` supplies them from `bootScope()`, so *every* compile path gets them - the
  worker, the export renderer, and the node tests - with no per-caller opt-in. Covered by the
  "repl eval shims" tests in `src/max/__tests__/engine.test.mjs`.
- **Sounds must be registered.** `registerSynthSounds()` for the oscillators, then strudel's
  six prebaked sample maps (the same URLs as `strudel/packages/repl/prebake.mjs`) loaded in
  the background with `allSettled` - a dead map cannot silence the others, and synth patterns
  never wait on the network. Persistent caching of those fetches is open (TODO item 2).
- **Export audio: the one surviving offline render.** `src/lib/render/offline.ts` is the
  0.9.x renderer kept for a *bounce*, not for playback: `exportAudio()` compiles the pattern
  fresh on the main thread (the worker's pattern lives in another thread and cannot be
  transferred), takes `renderPeriod()` capped at 32 cycles, renders through an
  `OfflineAudioContext` at the page's own sample rate, and `saveToFile`s a flat
  `strudel-export-<timestamp>.wav` into the device folder. Three details in that renderer
  are hard-won and must not be "simplified":
  - `loadWorklets()` + `setMaxPolyphony()`, **never** `initAudio()` - the latter awaits
    `initKabelsalat()` unconditionally, which hangs under `OfflineAudioContext`.
  - Renders are **serialized**: superdough's context and output controller are module-level
    singletons, so two overlapping renders connect nodes across contexts ("cannot connect to
    an AudioNode belonging to a different audio context").
  - `clearNodePools()` in the `finally`: the pool is keyed by node type, *not* by context, so
    a node from one render's context would otherwise be handed to the next and throw.
  - **Loop period is `renderPeriod` (`determinism.ts`), not engine.mjs `patternCycles`.** The
    latter signatures haps by MIDI pitch, so `s("bd <sd cp>")` (no pitch) and `.lpf("<400
    800>")` (effect-only variation) both collapse to period 1.
- **Why there is no Freeze.** Live's Freeze bounces a device offline and faster than
  realtime. A `[jweb~]` page is a live Chromium instance that does neither, so Freeze
  silences the device - a structural limit, not a bug we can fix. Export (or resampling the
  track) is the answer.
- **Wrapper mode.** `wrapper/device.ts` gates the clip poll and scale observers OFF for mode
  `strudel` - an instrument with no clips and no MIDI pitches; running the MIDI defaults
  threw LiveAPI noise.
- **Slider knobs.** Eight native dials `s1..s8` (a static pool in the panel behind the
  transport switch): each `slider()` in the code binds to one, in source order, through
  `shared/useSliderKnobs.ts`. **The pool itself is the library's as of 1.2.1** - the
  surfaces declare `...knobPool(KNOB_POOL)` and the hook is a thin wrapper over
  `useControls()`, which owns the borrowing, the `describeParam` handshake, whether Live
  took the range, and the seeding. What is left in this repo is the two Strudel-specific
  halves: reading a control's NAME out of the source text (`sliderLabels`) and pushing
  the values back into the pattern. Values travel NORMALIZED 0..1 - a dial's travel is
  stamped at build time while a slider's range belongs to the code - and turning one feeds
  `setSliderOverrides` into the next compile, so the pattern is re-evaluated with the new
  value. `engine.mjs` holds the capture (`beginSliderCapture`/`getSliderSpecs`) for the
  worker; `lib/render/scope.ts` carries the same for the main-thread export renderer. What
  the dials still do NOT carry is a NAME or a RANGE (TODO item 5.3). Two findings from the 0.9.x version worth keeping:
  the wrapper's rename takes on the DEVICE PANEL but never reaches the Rack macro / Live
  parameter registry (those stay `s1..s8`), and a first attempt to carry each slider's real
  min..max via runtime `_parameter_range` was reverted. **The range half is SOLVED as of
  2026-07-22** - see 4k.

### 4k. The Studio: the real strudel.cc owns the engine and the audio

The device's sound is not made in the device view. It is made by a full local
strudel.cc - the app itself, built offline from the `strudel/` submodule by
`scripts/build-repl.mjs` - running in a floating window declared
`window({ audio: true, site: "dist/repl-site" })`. The window's `[jweb~]` L/R are
summed into the device's signal path, so evaluating a pattern there IS the track.

Facts this shape rests on, all measured in Live (2026-07-22):

- **A windowed `[jweb~]` page loads at DEVICE load and keeps running with the window
  closed.** It has to be pulsed open-then-closed once by a `loadbang`, or a page in a
  window nobody opened never loads at all and the device is silent. The library does
  that pulse; see m4l-jweb's `applyWindows`.
- **jweb's CEF loads ES modules from `file://`,** where plain Chrome refuses without
  `--allow-file-access-from-files`. A multi-file site therefore works from a folder,
  which is why the REPL ships as a SIDECAR next to the `.amxd` (17 MB, far too big for
  the base64-in-`[js]` payload every other window uses) rather than inlined.
- **`[jweb~]` has no signal INLET** - the Max 9 reference calls it "Web browser with
  audio output". No page can be handed audio. That is why the device view's visualizer
  is fed by a `[peakamp~]` tap on the window's own outlets, as messages, and why a
  `scope()` typed in the device view can only ever show the device view's OWN sound.
- **A window shown in PRESENTATION cannot be resized at runtime.** Writing a box's
  rect is accepted and never redrawn. A resizable window therefore shows its PATCHING
  canvas with the page at the origin and the plumbing parked above it, and the wrapper
  polls the window size and fits the page to it.
- **`[jweb~]` needs its `latency` attribute set, or it underruns.** The object carries a
  ring buffer between Chromium's audio thread and MSP, and its default (the ~21 ms
  minimum at 48 kHz) drops out within ~30 s on a sustained tone. The Studio window ships
  `latency: 66` - the documented maximum, 3x the minimum, which jweb clamps to - and the
  buffer then absorbs Chromium's scheduling hiccups. The cost is ~66 ms of output delay,
  which Live's look-ahead hides for an instrument. `rendermode` stays at its default `1`
  (offscreen): `0` (onscreen) halts the graph outright, as does withholding the
  device-page engine (doc/DRAWER_OF_FAILED_IDEAS.md). The option lives on the library's
  `window({ audio: true, latency })` primitive.

`src/app/strudel/repl-shim/m4l-shim.js` is the only line of ours inside that app: it
arms the audio (the REPL waits for a `mousedown` that a hidden window never gets),
pins the output device (`setSinkId` would steer the sound away from the `jweb~`
outlets), persists the pattern to the `code` state slot so it saves with the LIVE SET,
and maps Play/Stop and the eight dials onto the REPL. The submodule is never patched.

**Telling a dial what it IS, at runtime.** A pattern can describe a control -
`m4lKnob(1, { name: 'cutoff', unit: 'Hz', range: [200, 2200] })` - and all three take:
the panel shows `cutoff`, the readout prints Hz, and the dial travels 200..2200.
`_parameter_range` was never the obstacle; it always applied. What broke the earlier
attempt is that the parameter then REPORTS IN THE NEW DOMAIN while the page went on
normalizing 0..1 - two scalings fighting, knob pinned at its minimum. The wrapper now
answers whether each range took (`param_range_ok` / `param_range_failed`) and the
borrower scales exactly once. The mechanism is the library's, not this repo's:
`describeParam()` / `onParamRange()` / `useControls()` in `@m4l-jweb`.

**The pattern's own `slider()` calls reach the dials too, and that is the preferred
idiom** - a Strudel coder should not have to learn one of ours to reach a knob. It needs
no change to strudel: after each evaluation `strudelMirror.widgets` carries every slider
(`{ id, from, to, value, min, max }`, `id` being the character range of the first
argument, ascending `from` being source order), and
`window.postMessage({ type: 'cm-slider', id, value })` sets the value the pattern's
`ref()` reads on its next query. The first eight take `s1..s8`.

A dial deliberately does NOT rewrite the code text, which is the other half of what
dragging the inline widget does (`view.dispatch({ changes })`): automation moves a dial
dozens of times a second, and rewriting the document at that rate would fight the typing
and keep the set dirty. The number in the code is the DECLARED value; the widget's thumb
is nudged in the DOM so the page does not look frozen.

Names and units come from an optional options object -
`slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' })` - which already RUNS in stock
strudel (the transpiler reads four arguments, `sliderWithID` ignores the rest) but is
dropped before anything can read it back. Until that lands upstream
(doc/FEAT-SLIDERS.md) the shim parses it out of the code, failing soft. A slot is
released when its slider stops existing, and only if a slider held it - a dial named by
`m4lKnob()` is not the slider layer's to reset.

**Still not renameable:** Live's parameter registry and the Rack macro picker keep
`S1..S8`. A frozen device cannot rename a parameter there, so any UI of ours renders
the name itself rather than relying on the dial to carry it.

**A knob must be a SIGNAL, not a number.** A pattern is evaluated once and then plays,
so `m4lKnob(1)` returning a plain number is read at evaluation time and frozen -
the dial then does nothing until the pattern is evaluated again. It returns a strudel
signal, queried per cycle, and the idiom is pattern arithmetic:
`.lpf(m4lKnob(1).range(200, 2200))`.

### 4g. Synth device: one superdough voice, played by MIDI

`alienmind-gugelhupf-synth` is the smallest instrument here: no pattern, no transport, no
engine worker, no scheduler. `src/app/synth/useSynth.ts` is the whole device.

- **The spec is a VALUE, not a pattern.** `s("sawtooth").lpf(800)` is compiled through the
  same `engine.mjs` `compile()` the other devices use - Strudel has no other parser - and
  then QUERIED for its first hap. That hap's value IS the superdough control object. A spec
  with structure in it (`s("<sawtooth square>")`) therefore collapses to its first event.
- **`note` and `n` are stripped from the spec.** They belong to the keyboard: a spec that
  named a note would make every key play the same pitch.
- **Notes in.** The `midiin` chain's `onNote` plays one voice per note-on, at
  `currentTime + 20 ms` - past the bridge and React, "now" is already the past.
- **Note-off is not a release, and cannot be.** `superdough(value, t, duration)` schedules
  the whole envelope up front and returns no handle, so a voice cannot be cut short. A
  note's length is decided WHEN IT STARTS, from the spec's `sustain` (default 0.6 s).
  Note-offs are tracked only as a re-trigger guard. A real gate needs a voice handle
  upstream in superdough.
- **Knobs.** Same eight-dial pool as the main device, through `useSliderKnobs`; a knob turn
  recompiles the spec with `setSliderOverrides`.
- **Wrapper mode `synth`.** No clips, no scale observers, and NOT in the transport follow of
  §4h - its notes are its trigger, so there is nothing to start or stop.

### 4h. Following Live's transport

A sequencing device should start when the music starts, and until 1.0.0 the Play parameter
was the only way in. There is no single LOM property for "should this device be playing",
so `wrapper/device.ts` observes two and picks between them:

- `playing_slot_index >= 0` - a session clip is running on this device's track.
- `live_set is_playing` - the global transport is running.

Either one starts the device; it stops when both are false. An earlier version asked whether
the track held any clip and, if it did, followed only the clips - which left a Drums Sampler
silent on Play whenever a clip merely SAT in a slot unlaunched. The cost of the union is the
other direction: stopping a clip while the transport runs leaves the device playing, which is
the honest reading of "the transport is running".

Both are observed, never polled; the page receives `transport_play <0|1>` on the EDGES only
(plus one forced send at `ui_ready`, where the page has heard nothing yet). The page writes
it into the Play PARAMETER rather than calling run()/hush() directly, so there is still
exactly one source of truth for "is this device playing": a click, an automation lane and a
launched clip all move the same automatable control, and the last one to move it wins.

### 4i. The offline sample cache

superdough fetches samples at PLAY time, so with no network `s()` patterns are silent while
synths are unaffected. Chromium blocks `fetch()` of `file://`, so reading bytes back off
disk is not available - but jweb IS Chromium, so the page has storage of its own.

`src/lib/sampleCache.ts` wraps the global `fetch` before any device code runs
(`sampleCache.install.ts`, imported above the app in `main.tsx` - import order is execution
order). Sample bytes are served **cache first** (a sample at a URL is immutable in practice,
and a hit costs no network at all); sample MAPS are **network first** with a cache fallback,
so a map that gains sounds upstream is not pinned to the first copy stored. Everything else
passes through untouched. Storage is IndexedDB with a synchronous in-memory layer in front
of it - the memory copy lands the moment the bytes exist, because the same sample asked for
twice in quick succession is what a pattern does. No storage failure escapes the wrapper: a
disabled or partitioned IndexedDB degrades to a session cache.

Whether the CEF profile PERSISTS that storage across a Live restart is the one thing this
cannot decide for itself; `sampleCacheStatus()` reports the entry count and the main
device's status line names it, which is the spike.

### 4j. Copying a path out of a device page

A device that writes a file has to hand the user a way to reach it, and Max cannot open a
file manager from a frozen device (`; max launchbrowser` was tried three ways and does
nothing on Windows 11 - see DRAWER_OF_FAILED_IDEAS.md). So the page copies the path
instead, and that turned out to be its own small tar pit.

**A device page cannot confirm a copy.** `navigator.clipboard` needs a secure context and
the page is `file://`; `document.execCommand("copy")` has no such gate but **returns true
in jweb while putting nothing on the system clipboard**, and there is no read-back to
catch it with (`readText()` needs the same secure context). A claim is therefore just a
claim, and the first version of this shipped a status line that said "Path copied" over an
empty clipboard.

`copyPath()` treats the two paths differently by environment: outside jweb a successful
write is believed, inside jweb nothing is. It attempts the copy anyway, then shows the
path in a focused, pre-selected field and waits for the browser's own `copy` event -
which fires only when a copy really happens, and is the only honest confirmation
available. `copyMessage()` turns the outcome into one wording shared by the three
devices that write files, and the "not copied" wording still names the folder, so the
path is never unreachable.

**It lives in `@m4l-jweb/bridge` as of 1.2.1**, not here. Three devices had rediscovered
the same trap, and the failure mode is a lie in the UI rather than a crash - which is
the test for whether something is the library's. `src/app/shared/clipboard.ts` is
deleted; the devices import `copyPath` / `copyMessage` from the bridge and behave
exactly as before.

**Unverified as of 1.0.0**, because Export never produced a file to copy the folder of
(§2d). TODO item 1.

## 5. Strudel Integration

We consume Strudel by bundling `@strudel/core`, `mini`, `transpiler`, `tonal`, `webaudio` and `superdough` directly from a pinned git submodule.
The submodule points to our own fork (`https://github.com/alienmind/strudel.git`) instead of upstream, for one patch: a `clearNodePools()` export on `@strudel/superdough`'s `nodePools.mjs`. The export renderer builds a new `OfflineAudioContext` per bounce, and because superdough's node pool is a module-level singleton keyed by node type (not by audio context), nodes from a previous pass linger and throw a cross-context error when handed to the next. Our fork lets the host clear the pool between contexts. To be dropped once there is an upstream solution.

- **No runtime dependency on strudel.cc** for code execution. The sample-taking devices do fetch sample packs and map JSON over the network.
- **No npm dependencies on `@strudel/*`.**

**Audio generation inside Chromium is now the primary path.** This reverses the rule that
governed the project until 0.9.5 ("all sound is handled natively via Max MIDI streams or Max
DSP objects"), and the reversal is the whole point of the `jweb~` rewrite - see §2c. What
remains true is the division of labour: **Max still owns MIDI** (the `midiout` chain, with
`[pipe]` applying delays so note timing never depends on a Chromium timer), and Max still
owns the fx device's DSP, because native `live.dial` parameters are what make it automatable
and Push-mappable.

## 6. Verification Gates

When testing manually, ensure:
1. **Engine boot**: The MIDI device's status line must show *Strudel engine ready* shortly after load.
2. **Timing**: `[pipe]` inside `midiout` must successfully route delay amounts to correctly synchronize notes.
3. **Sample browser preview**: Auditioning a sample must play through the track's native fader in Live (not the OS output), and the file must be draggable out afterwards.
4. **State persistence**: Edited settings must survive a full save/close/reopen of the Live set.
5. **Web Audio reaches the track**: superdough must be audible on the track, respond to the fader, and RECORD when the track is resampled - the proof that `[jweb~]`'s signal outlets are really in the signal path.
6. **No collapse over time**: a pattern left playing for several minutes must not fade into silence. If it does, check the jweb console for `[superdough-sink] ... late events` and treat growing lateness as the two-clock drift of §2c.
7. **Export audio**: the Export button must write a non-silent WAV next to the device, for a synth pattern and for a sample pattern.

## 7. File Map

```
├── patcher/
│   ├── chains.mjs             # repo-specific max chains
│   └── devices.mjs            # the device manifest
├── scripts/                   # build scripts
├── src/
│   ├── app/
│   │   ├── fx/                # the Audio FX device: App.tsx, protocol.ts, surface.ts
│   │   ├── midi/              # the MIDI device: App.tsx, useStrudel.ts
│   │   ├── drums-midi/        # the Drums device: App.tsx, useStrudel.ts, DrumMapPanel.tsx
│   │   ├── drums-sampler/     # the Drums Sampler: App.tsx, surface.ts
│   │   ├── sample-browser/    # the sample browser: App.tsx, protocol.ts, surface.ts
│   │   ├── strudel/           # the main Strudel device: App.tsx, useStrudelRender.ts
│   │   ├── synth/             # the Synth device: App.tsx, useSynth.ts
│   │   └── shared/            # shared engine and UI: PatternEditor.tsx, engine.worker.js,
│   │                          #   useStrudelEngine.ts, webaudio.ts (decode + play), surface.ts
│   ├── lib/
│   │   ├── mini/              # the mini-notation parser & resolver logic
│   │   ├── render/            # the Export-audio bounce: offline.ts, wav.ts,
│   │   │                      #   determinism.ts (renderPeriod), scope.ts (slider capture)
│   │   ├── fx.ts              # the effects line -> parameter values (a recorder, not a parser)
│   │   ├── sampleCache.ts     # the persistent fetch cache (+ sampleCache.install.ts)
│   │   ├── sampleMaps.ts      # the prebaked sample-map list, shared by the sound devices
│   │   ├── samples.ts         # sample map URL resolution and fetch logic
│   │   └── strudelCode.ts     # bare mini vs code; wraps mini in note(...)
│   └── max/
│       └── shared/
│           ├── engine.mjs     # headless engine eval scope + repl shims
│           └── transport.mjs  # LiveTransport tick processing
├── strudel/                   # upstream Strudel monorepo (git submodule)
└── wrapper/
    └── device.ts              # [js] glue (ES5) extensions
```


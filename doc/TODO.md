# M4L-STRUDEL: what is left to do

The backlog for the devices themselves. Anything that belongs to the *library* - patcher codegen, the Surface, fetch-to-disk, the chain vocabulary - lives in `m4l-jweb`'s own [doc/TODO.md](https://github.com/alienmind/m4l-jweb/blob/main/doc/TODO.md), not here.

Ideas tried and abandoned are in [DRAWER_OF_FAILED_IDEAS.md](DRAWER_OF_FAILED_IDEAS.md);
what was built and how it works is in [ARCHITECTURE.md](ARCHITECTURE.md).

Anything finished has been REMOVED from this file rather than left as a done-list -
git history is the record of what shipped.

---

1.1.0 shipped the Studio and the device view around it - the real local strudel.cc as
the track's instrument, the pattern saved with the set, Live's transport and dials
reaching it, and the three-view panel (ARCHITECTURE.md 4k). None of that is here any
more; what follows is what 1.3 has to answer.

## Waiting on the library

Two things, both named in the items below: `createAudioClip()` (item 2) and a save that
a WINDOW page can make (item 3d) - the Studio cannot write a file today, so it cannot
bounce its own pattern even once strudel can render one.

`defineFiles()` shipped upstream and this repo consumes it:
`src/app/{strudel,drums-sampler,sample-browser}/files.ts` is the single declaration that
a device writes to disk, and the `download` chain, the device-folder message and the
`save_*` selectors are all derived from it. `patcher/devices.mjs` lists no `download`
and `wrapper/device.ts` has no `sendFolder()`.

`useControls()` + `knobPool()` were adopted in 1.2.1, and the folder-path helper shipped
as `copyPath()` in `@m4l-jweb/bridge`.

## Open Tasks

### 1. TEST - one transport, one engine

The Strudel device has two engines that both sound into the same track, and one `play`
parameter used to start both, so the track carried the sum of the Studio's pattern and
the device page's scratchpad. It is XOR now: `src/app/strudel/transport.ts` gives the
transport to the Studio whenever the Studio's pattern has content, and to the scratchpad
otherwise. The loser STANDS DOWN - it goes quiet without clearing `play`, because the
parameter belongs to whichever engine is sounding.

The predicate is the Studio's PATTERN and not whether its window is open. A window is
shut to see the mixer and opened again a minute later, and the Studio's page sounds
whether or not it is showing, so keying on visibility would mean the audio changed when
a window was dragged. `wind.visible` is readable in the wrapper (it already polls it in
`fitWindowPage`) if this ever needs revisiting.

**A handover does not inherit the press**, which the first build got wrong and Live
caught: `play` is still down when ownership moves, so the scratchpad started on the
empty pattern it held at that instant, went `live` on silence, and could not be started
again (typing does not re-evaluate). Both sides latch now, and `run()` refuses an empty
pattern. ARCHITECTURE section 4k has it.

**The exact next test:** on `alienmind-gugelhupf`, press Run with the Studio's default
pattern in it - only the Studio sounds. Clear the Studio (the sound stops), type a
pattern in the device view's scratchpad, press Run - only the scratchpad sounds. Type
into the Studio again while the scratchpad plays - the scratchpad goes quiet within a
second, and Run then starts the Studio. The device page posts `[transport] studio has
it` / `[transport] scratchpad has it` on every handover, so the Max console says whether
a failure is a handover that did not happen or an engine that did not start.

### 2. FEAT - Export straight into a Live clip

**The workaround can go.** Export writes a WAV and hands the user a path to paste into
Explorer and drag back in, because it was believed Live had no scripted way to make an
audio clip. That was wrong: `ClipSlot.create_audio_clip(<absolute path>)` puts a WAV in a
Session slot and `Track.create_audio_clip(<path>, <position>)` puts one in the
Arrangement, from Live 12.0.5 onward. See
[DRAWER_OF_FAILED_IDEAS.md](DRAWER_OF_FAILED_IDEAS.md) for how the wrong premise got
recorded, and m4l-jweb's TODO item 1 for the library half - **this repo cannot start
until that lands**, because the call belongs in the wrapper, not here.

**The design problem is WHERE the clip goes.** Both calls print an error unless the
target is an audio track that is not frozen and not recording - and every device here
that can Export (`alienmind-gugelhupf`, `alienmind-gugelhupf-drums-sampler`) is an
INSTRUMENT, so it sits on a MIDI track and can never write into its own. Three options,
and this needs a decision before code:

| Where | Behaviour | Cost |
|---|---|---|
| The highlighted slot | Bounce lands where the cursor is | Fails unless the user selected an audio track first - has to be explained, and `has_audio_input` checked before calling |
| A new audio track | `create_audio_track(-1)`, then its first slot | Always works, never asks - but a device that spawns tracks is a device that surprises people |
| Remembered target | Ask once, keep the track index in a state slot | Best behaviour, most to build, and a track index goes stale when tracks move |

Lean towards the highlighted slot with a clear message when it is not an audio track, and
a "bounce to a new track" as the explicit second button rather than a silent fallback.

**Set the clip up after creating it**, using what the render already knows: `name` (the
pattern, not `gugelhupf-export-1785343077706`), `warping` on with `warp_mode`, and the
loop points from the exact cycle count that was rendered. The device knows the cps it
rendered at, so the clip can be right rather than warped by guess.

**Keep the copy-path button.** Live 12.0.4 and older have no such call, and the path is
still the honest answer there.

**What it bounces is settled: THIS PAGE's pattern, the scratchpad's.** The Studio's is
not bounced, because it compiles in the Studio's own runtime and cannot be re-created
faithfully in the device page's scope. Item 3 is the route to bouncing the Studio, and
it goes through strudel itself rather than through this repo.

### 3. FEAT (upstream strudel) - render the pattern to a WAV, from strudel.cc itself

**The goal is a strudel feature, not an m4l one.** Strudel has no way to render a
pattern to audio; the renderer this repo carries (`src/lib/render/offline.ts`,
`determinism.ts`, `wav.ts`) is general and belongs upstream. Done there, the Studio can
bounce its own pattern with nothing of ours in the payload, and `alienmind-gugelhupf`
stops being able to export only the scratchpad.

**Hard constraint: no dependency on anything outside strudel, in either direction.**
The commits must be mergeable upstream on their own merits, and this repo must keep
building against STOCK strudel - the shim asks for what may not be there and fails soft,
exactly as it already does for `slider()` metadata.

#### 3a. The renderer, in `superdough`

A new `packages/superdough/render.mjs`, which is `src/lib/render/offline.ts` with the
m4l-shaped edges taken off. Everything it needs is already exported by superdough
(`setAudioContext`, `getSuperdoughAudioController`, `setSuperdoughAudioController`,
`clearNodePools`, `resetGlobalEffects`, `loadWorklets`), so this is assembly, not new
API:

```js
renderPattern(pattern, { cps, cycles, begin = 0, sampleRate = 44100 }) -> AudioBuffer
```

The four things that make it work, and which a fresh attempt gets wrong:

- **`loadWorklets()`, never `initAudio()`.** `initAudio` awaits `initKabelsalat()`
  unconditionally and that hangs under an `OfflineAudioContext`. kabelsalat is only
  needed for the `kabel` synth type.
- **`clearNodePools()` on BOTH sides of the render.** The pool is keyed by node type
  across contexts, so a node pooled by the realtime path is handed to the offline one
  and throws "cannot connect to an AudioNode belonging to a different audio context" -
  intermittently, depending on what was pooled.
- **`await` each `superdough()` call.** That is what makes sample fetch and
  `decodeAudioData` finish before `startRendering()`, so sample patterns are not
  rendered as silence.
- **Serialize renders behind a promise queue, and restore the previous context in
  `finally`.** The context and the output controller are module-level singletons; a
  second render swaps them under the first. Nulling instead of restoring makes the next
  `getAudioContext()` build a fresh realtime context - which under `[jweb~]` means the
  page comes back silent.

`packages/superdough/wav.mjs` carries the 16-bit PCM encoder (`src/lib/wav.ts`,
dependency-free as it stands). The loop length comes from `renderPeriod()`
(`src/lib/render/determinism.ts`) - it queries the pattern at growing cycle counts until
the haps repeat, capped - so the UI does not have to ask "how many cycles".

#### 3b. The UI, in the website

**Put it in the panel, not next to Play.** A render is the one action in strudel that
can take seconds and touch the network (unloaded samples), and the transport bar is
where reflexes live. A `render` tab in `website/src/repl/components/panel/Panel.jsx` -
cycles (defaulting to the detected period), sample rate, a Render button, the resulting
length - can say what it is about to do. Promote it to the main bar later if it earns it.

#### 3c. The seam that lets m4l save the file, with strudel knowing nothing about m4l

The website's default delivery is a browser download - `URL.createObjectURL` and an
`<a download>`. Before doing it, dispatch a CANCELABLE event:

```js
const ev = new CustomEvent('strudel:render', {
  detail: { blob, buffer, seconds, cycles, cps, sampleRate, name },
  cancelable: true,
});
if (window.dispatchEvent(ev)) downloadBlob(blob, name);   // nobody claimed it
```

Stock strudel downloads. Our shim adds a listener, calls `preventDefault()`, and writes
the bytes with `saveToFile()` instead. No m4l symbol appears upstream, and the hook is
useful to any embedder. Expose `window.strudelRender(opts)` alongside it so a host can
START a render too - that is what lets the device view's Export button bounce the
STUDIO's pattern rather than its own.

#### 3d. What is blocked here until the library moves

The Studio is a floating window, and **a window page cannot save today**. The wrapper's
`window()` dispatch passes `ui_ready`/`get_state`/`sync_state`/`param_*` through and
sends everything else to `onWindowMessage`; worse, `replyWindow` is restored when the
dispatch returns, while a save's final place step comes back later from `[maxurl]` - so
a window-originated save would write the file and reply `save_ok` to the DEVICE view.
The library has to record the origin window on the pending request instead. Until then
3a-3c stand on their own (they download), and only the m4l wiring waits.

### 4. FEAT (upstream strudel) - a Sliders pane in the sidebar

Same shape as item 3 and the same constraint: it is a strudel feature that this repo
happens to want. A pattern's `slider()` calls are already gathered here - the shim reads
`strudelMirror.widgets` after each evaluation and puts the first eight on the device's
S1..S8 dials - and strudel.cc itself has nowhere to see them but inline in the code.

**The design is written: [FEAT-SLIDERS.md](FEAT-SLIDERS.md).** Sections 1 and 2 are the
upstream halves - carry an options object (`{ name, unit, order }`) through
`sliderTranspilerPlugin` into `sliderConfig`, then a `sliders` tab in `Panel.jsx` with a
`SlidersTab.jsx` that sorts by `order` then `from` and posts the same
`{ type: 'cm-slider', id, value }` message the inline widget posts. What that document
does not carry, and this item adds:

- **The transpiler must never throw on half-typed code** - it runs on every keystroke.
  Non-literal properties are skipped, not rejected.
- **The metadata stays optional and the drop stays silent.** `slider(0.5)` is unchanged
  and a fifth argument already runs in stock strudel (it is parsed and discarded), so
  the same pattern text plays identically with or without these commits.
- **Keep the shim's local parse** (FEAT-SLIDERS.md section 4) after this lands. It reads
  the options out of the code text, and it is what keeps this repo working against a
  stock submodule. It prefers `w.name` when the transpiler provides it, so it retires
  itself only when the fork is the only thing anyone builds against.

### 5. FEAT - native MIDI input (`midiIn`/`kb()`) and MIDI output

Wanted in the device view's SCRATCHPAD as much as in the main pattern: the point of a
second instance is control code, and `midiin` is not on this device's chain list yet.

**Assessment.** Valid, and cheaper than when written: the `midiin` chain already
exists (the Drums Sampler uses it - `onNote()` delivers the track's MIDI to the
page), and the note sink already turns haps into MIDI-shaped events for the midi
devices. What is missing is (in) feeding live notes into the pattern scope and
(out) letting the SUPERDOUGH device emit MIDI alongside audio.

**Preliminary design.**
- **In:** add `midiin` to the superdough manifest; `onNote()` forwards
  `{t:'midi', pitch, velocity}` to the worker; the worker keeps a small held-notes
  set and publishes strudel's expected accessors (`kb()`, `midiIn` stream) into the
  pattern scope before compile. Latency is one tick (fine for chords/drones, not
  for playing leads - say so in help).
- **Out:** compile-time split of the pattern's haps: haps carrying `.midichan()`
  (or a `.midi()` tag) route to the existing note sink -> `midiout` chain (add the
  chain to the manifest), everything else to the superdough sink. Channel comes
  from `.midichan(n)`, so one pattern sequences external gear and plays superdough
  at once. The two sinks already coexist in the worker protocol; this is a per-hap
  dispatch, not a new engine mode.

  NOTE: For this one, I would need examples on how to use (concrete strudel patterns) for midi routing from within the device

### 6. FEAT - orbit() support (multichannel out)

**Assessment.** Valid, UNVERIFIED at its foundation. superdough can already render
orbits to separate channel pairs (`initAudio({ multiChannelOrbits: true })` exists),
so the whole question is whether jweb~ carries more than 2 signal outlets. The
0.9.9 template uses the stereo default. If jweb~ has a channel-count attribute
(check its Max 9 reference page - do NOT assume), the rest is plumbing; if not,
this needs a different transport (worklet -> shared buffer -> [mc.] tricks) and
stops being worth it.

**Preliminary design (contingent on the spike).** SPIKE FIRST: a bare Max patcher
with jweb~ @channels (or whatever the attribute is) and a test page playing on
channels 3/4; scope~ the outlets. If it passes: manifest grows `orbits: N`, the
build emits jweb~ with 2N channels and the `webaudio` chain fans pairs to
`[send~ <device-scope>-orbit-M]`; a Rack preset catches them on parallel chains.
`duck()` then works inside superdough with no Max help at all (it is orbit-level
DSP in the page). If the spike fails: park in the drawer with the finding.

### 7. FEAT - cross-device coordination in the Rack

**Assessment.** Valid, big, and last for a reason: it depends on nothing above but
informs its value. Two separable halves that the original text mixed: (a) a
track-scoped message channel between our devices, (b) the product feature on top
(one expression spanning sequencer + fx, `.lpf()` delegated to the fx device's
native dials instead of baked into the page's audio). Half of (b)'s old rationale
died with the WAV pipeline - effects are no longer "baked into the render", they
are live - so the remaining value is: native dials/Push/automation on effects while
superdough only sequences. Re-validate that this is still wanted before building.

**Preliminary design (sketch, revisit later).** Channel: `[send]`/`[receive]`
with a name derived from the track (the wrapper reads its own track id via LOM at
init - ids are session-stable, and re-derived on load, never persisted). Protocol:
the superdough device broadcasts per-stage effect values (`fx cutoff 800`), the fx
device consumes them exactly like its app's own `set_<id>` writes (the fan-in
already exists in `fanParamInto`). A Rack the user builds maps its 16 macros
across both devices' dials. Explicitly out of scope: any cross-TRACK routing.

### 8. TEST - verify offline behavior in Live

**Assessment.** Partly done. The persistent page-side cache shipped in 1.0.0 and was
verified in Live: a sample played once online still plays after a restart with the
network off (ARCHITECTURE §4i). What has NOT been swept is the rest of the checklist -
the timeouts and the UI's behaviour while a fetch is failing.

**Checklist (network OFF in Live):**
- **Responsiveness**: UI thread not blocked (list/search must not stutter).
- **Catalog timeout**: fails within ~12 s with a clear message.
- **Download timeout**: fetches fail within ~30 s, row/status unsticks from "Fetching...".
- **Synths offline**: superdough synth patterns play with no network at all.
- **Session cache**: a sound already auditioned this session still plays.
- **Persistent cache (DONE)**: previously played samples survive a Live restart.
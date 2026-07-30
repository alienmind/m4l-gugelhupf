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

One thing: a save that a WINDOW page can make (item 6d). The Studio cannot write a file
today, so it cannot bounce its own pattern even once strudel can render one.

`createAudioClip()` shipped upstream in 1.3.0 and this repo consumes it - Export puts the
rendered WAV straight into a clip slot (ARCHITECTURE 2e), and the copy-path button stays
for Live 12.0.4 and older.

`defineFiles()` shipped upstream and this repo consumes it:
`src/app/{strudel,drums-sampler,sample-browser}/files.ts` is the single declaration that
a device writes to disk, and the `download` chain, the device-folder message and the
`save_*` selectors are all derived from it. `patcher/devices.mjs` lists no `download`
and `wrapper/device.ts` has no `sendFolder()`.

`useControls()` + `knobPool()` were adopted in 1.2.1, and the folder-path helper shipped
as `copyPath()` in `@m4l-jweb/bridge`.

## Open Tasks

### 1. FEAT - Export the pattern as a MIDI CLIP, from the instrument flavour

**The audio half shipped.** `alienmind-gugelhupf-audio` bounces its pattern into a clip
on its own track (ARCHITECTURE 2e). The INSTRUMENT flavour cannot: it sits on a MIDI
track, so the file lands and a new audio track is offered. But a MIDI track takes a MIDI
clip, and this device already knows every note it is about to play - so Export on the
instrument should write notes, not offer to leave.

**The notes are already there, before superdough, and no `midiOut()` is needed.** A
Strudel pattern is queried into HAPS and only then handed to a sink; the note devices'
engine turns the same haps into MIDI, and the superdough sink is one branch of that same
dispatch. So capture is a per-hap fan-out at the sink, not a rewrite of anything:

- The bounce path already compiles the pattern on the main thread and picks the loop
  period (`renderPeriod`), so it can query the same window it renders and map each hap.
- `writeClip(lengthBeats, notes)` exists in `@m4l-jweb/bridge` today and writes into the
  first empty slot on the device's OWN track - which for the instrument is a MIDI track.
  Nothing new is needed on the Max side.
- Export therefore becomes container-appropriate rather than conditional: the audio
  flavour writes audio, the instrument writes notes, and neither has a disabled button.

**What does NOT survive the translation, and has to be said in the UI rather than
discovered:** a hap with no pitch (`s("bd sd")` names a sample, not a note) needs a drum
map or is dropped - the drums-midi device already carries one worth reusing; `n` is a
sample INDEX when `s` selects a bank and a pitch when it does not, so it needs the same
disambiguation the MIDI devices do; and effects (`lpf`, `room`, `pan`) have no MIDI
representation at all. A pattern that is mostly samples and effects exports a clip that
is mostly empty, which is honest and still needs saying.

**REJECTED: injecting code to turn the pattern into a MIDI stream.** Rewriting the user's
text to nuke the audio output changes what is heard to get at what is played, is fragile
against any pattern shape not anticipated, and is unnecessary - the haps exist before
superdough sees them. The `.midichan()` split sketched in item 3 is the same mechanism
seen from the live side, and the two should land as one dispatch rather than two.

### 2. FEAT - a selectable TAIL on the bounce, so a reverb is not cut off

**The click is real and it is the loop point, not the renderer.** `renderCycles` renders
exactly `renderPeriod()` cycles and stops, so anything still sounding at that instant -
`.room()`, a long `.delay()`, a slow release - is truncated mid-sample. The clip then
loops from a non-zero sample straight back to silence, which is the click. Nothing is
wrong with the render; it is rendering what it was asked for.

**The shape.** Keep the computed period as the DEFAULT - it is right for the majority of
patterns, and a bounce that silently ran twice as long as asked would be its own
surprise. Add an extra rendered span past it, and mix it back:

- render `cycles + tail` and keep the whole thing, so the decay is audible where the loop
  ends but the clip's `loop_end` still sits at `cycles * beatsPerCycle` (Live plays a
  clip's material past its loop end when the loop is off, and cuts at it when it is on -
  which is why this needs testing before choosing between "leave the tail as material"
  and "wrap it round").
- the honest alternative, if that does not work: render the tail and SUM it onto the
  first `tail` worth of samples of the bounce, so the loop is seamless in the way a
  hardware sampler's is. More correct, more DSP, and it changes the first bar.

**Where the control goes: About, not the top bar.** The device view is one row of icons
in 169 px and this is set once per pattern at most. A number in About (seconds, or
cycles) beside the existing debug readout, defaulting to 0 - and the status line already
says how many cycles were rendered, so it can say the tail too.

Do not make it a Live parameter. It is not automatable, it is not on Push, and it is read
once per bounce - `state()` is what carries it with the set.

### 3. FEAT - native MIDI input (`midiIn`/`kb()`) and MIDI output

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

### 4. FEAT - orbit() support (multichannel out)

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

### 5. TEST - verify offline behavior in Live

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

### 6. FEAT (upstream strudel) - render the pattern to a WAV, from strudel.cc itself

**Down here on purpose, and it is the one upstream item that costs something to defer.**
It blocks nothing - Export works, and now lands a clip - but it is the last correctness
gap in the bounce: the device page compiles the same TEXT in a different scope from the
Studio that is playing it, so a pattern leaning on something only the Studio's runtime
provides bounces differently, or not at all. That was a mild wart while the output was a
file somebody dragged in; it is sharper now that the output is a clip in the track, which
reads as "what you heard". Everything above is a feature that does not exist yet; this is
a feature that exists and can lie.

**The goal is a strudel feature, not an m4l one.** Strudel has no way to render a
pattern to audio; the renderer this repo carries (`src/lib/render/offline.ts`,
`determinism.ts`, `wav.ts`) is general and belongs upstream. Done there, the Studio can
bounce its own pattern with nothing of ours in the payload, and `alienmind-gugelhupf`
stops rendering its pattern in a scope that is not the one playing it.

**Hard constraint: no dependency on anything outside strudel, in either direction.**
The commits must be mergeable upstream on their own merits, and this repo must keep
building against STOCK strudel - the shim asks for what may not be there and fails soft,
exactly as it already does for `slider()` metadata.

#### 6a. The renderer, in `superdough`

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

#### 6b. The UI, in the website

**Put it in the panel, not next to Play.** A render is the one action in strudel that
can take seconds and touch the network (unloaded samples), and the transport bar is
where reflexes live. A `render` tab in `website/src/repl/components/panel/Panel.jsx` -
cycles (defaulting to the detected period), sample rate, a Render button, the resulting
length - can say what it is about to do. Promote it to the main bar later if it earns it.

#### 6c. The seam that lets m4l save the file, with strudel knowing nothing about m4l

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

#### 6d. What is blocked here until the library moves

The Studio is a floating window, and **a window page cannot save today**. The wrapper's
`window()` dispatch passes `ui_ready`/`get_state`/`sync_state`/`param_*` through and
sends everything else to `onWindowMessage`; worse, `replyWindow` is restored when the
dispatch returns, while a save's final place step comes back later from `[maxurl]` - so
a window-originated save would write the file and reply `save_ok` to the DEVICE view.
The library has to record the origin window on the pending request instead. Until then
2a-2c stand on their own (they download), and only the m4l wiring waits.

### 7. FEAT (upstream strudel) - a Sliders pane in the sidebar

**Blocks nothing at all**, which is why it is last: the shim already parses `name`, `unit`
and `order` out of the code text and the dials carry them today. What lands upstream is
the same thing done properly, for everyone.

Same shape as item 6 and the same constraint: it is a strudel feature that this repo
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

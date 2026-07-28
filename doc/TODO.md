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

Nothing, as of 1.3.0. `defineFiles()` shipped upstream and this repo consumes it:
`src/app/{strudel,drums-sampler,sample-browser}/files.ts` is the single declaration that
a device writes to disk, and the `download` chain, the device-folder message and the
`save_*` selectors are all derived from it. `patcher/devices.mjs` lists no `download`
and `wrapper/device.ts` has no `sendFolder()`.

`useControls()` + `knobPool()` were adopted in 1.2.1, and the folder-path helper shipped
as `copyPath()` in `@m4l-jweb/bridge`.

## Open Tasks

### 1. FIXME - Export renders, then places nothing

**Seen in Live on 1.0.0.** Export renders and fails at the last step with
`could not place save: -1 bytes at destination`. `-1` is what the wrapper reports when
it cannot size the destination at all, so the `.part` was never placed over the target.

**Re-tested on 1.2.1: still fails.** The save protocol is the library's (`save_begin` /
`save_chunk` / `save_end`, then a `file://` place through `[maxurl]`), and the upstream
fix that landed after this was first seen did not change the outcome. So it is not the
version, and the triage below is live.

**Step 3 is ruled out permanently now**, not just checked: `[maxurl]` is derived from
`src/app/strudel/files.ts`, so the device cannot be built without it. Two candidates
remain.

1. Does the `.part` exist next to the device, at the right size, after `save_end`? Then
   only the place step is broken.
2. Does the device folder resolve to a real writable directory? An UNSAVED patcher has
   no folder at all, and every path is then relative to nowhere. Worth checking FIRST -
   it is one console line, and `-1 bytes at destination` is what a path relative to
   nowhere would produce. The wrapper now posts
   `patcher is not saved - no device folder, and every relative path resolves against
   nowhere` at ui_ready when that is the case, so the console answers this without a
   separate test.
3. ~~Is the `download` chain on the device?~~ Derived from the declaration.

**The exact next test:** run Export and capture the Max console for the whole attempt.
Nothing above can be narrowed without it - the console from a device that merely LOADED
says nothing about a save.

**Also unresolved: WHOSE pattern Export bounces.** It renders the scratchpad's, because
that is the engine the device page has, and the music now lives in the Studio. Either it
moves behind the shim (the Studio renders and saves) or it is cut. Decide before it is
fixed - there is no point fixing a bounce of the wrong thing.

### 2. FIXME - does the sample browser's save reach a subdirectory at all?

**Unverified, and found by reading rather than by a failure report.** `localPath()`
(`src/lib/samples.ts`) writes to `samples/<pack>/<name>_<n>.wav`, two levels down. The
drawer records the opposite as measured fact:

> **`saveToFile` to a SUBDIRECTORY fails the atomic place with `-1 bytes`.** Max's `[js]`
> `File` and `[maxurl]` (libcurl) resolve `render/x.wav` differently.

Both cannot be true. Either the browser's downloads have been failing at the place step
(and the row's "Saved nothing" is the symptom nobody has reported), or the drawer entry
is narrower than it reads. It is the SAME `-1` as item 1, from the same code path, so
the two are probably one question.

**The exact next test:** audition one sound in `alienmind-gugelhupf-sample-browser`,
then check whether `samples/<pack>/` next to the .amxd holds the file or a `.part`, and
capture the Max console. Nothing has been changed on a guess - the destination is still
`samples/...`, because moving it flat would change the paths users drag from.

### 3. TEST - the path on the clipboard, still unwatched

Never verified end to end. It was blocked on item 1 - the copy button only appeared once
something had been written, so a device whose Export failed could never be used to test
the copy. **That coupling is gone**: `device_folder` arrives at `ui_ready` from the
library's `defineFiles()` plumbing, and the button on `alienmind-gugelhupf` and
`alienmind-gugelhupf-drums-sampler` follows the folder rather than the export. (The
sample browser's still waits for a download, and correctly: it offers `samples/`, which
does not exist until something lands in it.)

What is known: `document.execCommand("copy")` **returns true in a device page and copies
nothing**, and the page cannot detect it - `navigator.clipboard.readText()` needs a
secure context and a device page is `file://`. So a copy can be claimed but never read
back. `copyPath()` in `@m4l-jweb/bridge` therefore trusts no claim: it attempts the copy,
then shows the path in a focused, pre-selected field, and treats the browser's own `copy`
event as the only confirmation.

**The exact next test:** load `alienmind-gugelhupf`, press the copy button WITHOUT
exporting anything, and paste into Explorer/Finder. If the manual field turns out not to
receive Ctrl+C inside jweb either, then a device page cannot reach the system clipboard
at all and the answer is a Max-side one, or none. History of what does not work:
[DRAWER_OF_FAILED_IDEAS.md](DRAWER_OF_FAILED_IDEAS.md).

### 4. FEAT - native MIDI input (`midiIn`/`kb()`) and MIDI output

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

### 5. FEAT - orbit() support (multichannel out)

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

### 6. FEAT - cross-device coordination in the Rack

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

### 7. TEST - verify offline behavior in Live

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
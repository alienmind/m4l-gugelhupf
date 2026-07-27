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
more; what follows is what 1.2 has to answer.

## Waiting on the library

One thing in this backlog is m4l-jweb's to solve, and the entry below says so rather
than describing a device-side workaround twice. See
[m4l-jweb's TODO](https://github.com/alienmind/m4l-jweb/blob/main/doc/TODO.md).

| Upstream | What it gives this repo |
|---|---|
| `defineFiles()` (item 1) | The `download` chain, the device-folder plumbing and the `save_*` selectors as ONE declaration. Item 1 below is what happens when those three drift apart. |

The other two rows are gone. `useControls()` + `knobPool()` are adopted as of 1.2.1 -
`src/app/shared/useSliderKnobs.ts` is now the Strudel-specific half alone (reading a
name out of the source text, pushing values back into the pattern), and the borrowing,
the naming, the range handshake and the seeding are the library's. The folder-path
helper shipped as `copyPath()` in `@m4l-jweb/bridge`, and `src/app/shared/clipboard.ts`
is deleted; what remains here is the VERIFICATION, which item 2 below still owns.

## Open Tasks

### 1. FIXME - Export renders, then places nothing

**Seen in Live on 1.0.0.** Export renders and fails at the last step with
`could not place save: -1 bytes at destination`. `-1` is what the wrapper reports when
it cannot size the destination at all, so the `.part` was never placed over the target.

**Re-test on 1.1.0 before debugging anything here** - the save protocol is the library's
(`save_begin` / `save_chunk` / `save_end`, then a `file://` place through `[maxurl]`),
and a related fix landed upstream after this was seen.

If it still fails, in order:

1. Does the `.part` exist next to the device, at the right size, after `save_end`? Then
   only the place step is broken.
2. Does the device folder resolve to a real writable directory? An UNSAVED patcher has
   no folder at all, and every path is then relative to nowhere.
3. Is the `download` chain on the device? It owns `[maxurl]`, and without it the place
   request leaves on an aux outlet with nothing on the other end - no error, no reply,
   the promise never settles. This is exactly the failure `defineFiles()` exists to make
   impossible.

**Also unresolved: WHOSE pattern Export bounces.** It renders the scratchpad's, because
that is the engine the device page has, and the music now lives in the Studio. Either it
moves behind the shim (the Studio renders and saves) or it is cut. Decide before it is
fixed - there is no point fixing a bounce of the wrong thing.

### 2. FIXME - the path on the clipboard, still unconfirmed

Never verified end to end, because Export never wrote a file (item 1): the button that
reveals the path only appears once something has been written.

What is known: `document.execCommand("copy")` **returns true in a device page and copies
nothing**, and the page cannot detect it - `navigator.clipboard.readText()` needs a
secure context and a device page is `file://`. So a copy can be claimed but never read
back. `src/app/shared/clipboard.ts` therefore trusts no claim: it attempts the copy, then
shows the path in a focused, pre-selected field, and treats the browser's own `copy`
event as the only confirmation.

**The fix landed upstream in 1.2.1**: `copyPath()` / `copyMessage()` in
`@m4l-jweb/bridge`, and this repo's copy is deleted - all three devices now import the
library's. Behaviour is unchanged on purpose, so this item is still open for the same
reason it always was: nobody has watched it work.

What remains is the VERIFICATION, once item 1 writes a file: if the manual field turns
out not to receive Ctrl+C inside jweb either, then a device page cannot reach the system
clipboard at all and the answer is a Max-side one, or none. History of what does not
work: [DRAWER_OF_FAILED_IDEAS.md](DRAWER_OF_FAILED_IDEAS.md).

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

### 5. FEAT - cross-device coordination in the Rack

**Assessment.** Valid, big, and last for a reason: it depends on nothing above but
informs its value. Two separable halves that the original text mixed: (a) a
track-scoped message channel between our devices, (b) the product feature on top
(one expression spanning sequencer + fx, `.lpf()` delegated to the fx device's
native dials instead of baked into the page's audio). Half of (b)'s old rationale
died with the WAV pipeline - effects are no longer "baked into the render", they
are live - so the remaining value is: native dials/Push/automation on effects while
superdough only sequences. Re-validate that this is still wanted before building.

**Preliminary design (sketch, revisit after 8).** Channel: `[send]`/`[receive]`
with a name derived from the track (the wrapper reads its own track id via LOM at
init - ids are session-stable, and re-derived on load, never persisted). Protocol:
the superdough device broadcasts per-stage effect values (`fx cutoff 800`), the fx
device consumes them exactly like its app's own `set_<id>` writes (the fan-in
already exists in `fanParamInto`). A Rack the user builds maps its 16 macros
across both devices' dials. Explicitly out of scope: any cross-TRACK routing.

### 6. TEST - verify offline behavior in Live

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
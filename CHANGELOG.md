# Changelog

High-level history of m4l-gugelhupf, grouped by milestone release. Up to 1.0.0 each
minor version was a milestone of its own. Newest first.

## 1.3.0 - a bounce lands in a clip

**Export puts the WAV straight into a clip slot.** It renders as before, and then calls
`createAudioClip()` (new upstream in m4l-jweb 1.3.0): the clip is named, warped, and
looped over exactly the cycles that were rendered, because the page chose the cycle count
and the cps and Live would otherwise infer a grid from transients. The five manual steps
between a render and a clip - copy the path, paste it into Explorer, find the file, drag
it in - are gone. The copy-path button stays, for Live 12.0.4 and older where the call
exists and does nothing.

**`alienmind-gugelhupf-audio`** - the same device, the same Studio and the same pattern,
declared as an AUDIO EFFECT. Live puts an audio clip on an audio track and nowhere else,
and an instrument on a MIDI track can never target another one from its own view: a
device's view is only on screen while its track is selected, so the highlighted clip slot
is always one of its own. On an audio track that stops being a problem - the bounce lands
in the track the device is already on. `webaudio` sums the page onto the device input, so
whatever the track carried still passes through. The instrument flavour writes the file
and offers one button: bounce to a new audio track.

**Export writes a MIDI clip on a MIDI track.** The instrument flavour gets a second export
button: the pattern's notes into the first empty slot on its own track. The notes are
queried from the pattern's haps before superdough sees them - the same `exportNotes()` /
`patternCycles()` pair the MIDI device's To Clip has always used, including the rule that
`n` is a sample index when `s` names a sound - so nothing is injected into the user's code
and nothing about the sound changes. Which button appears comes from `onTrackKind()`
(upstream), so Live decides, not the build.

**A transport FOLLOW switch**, and bouncing turns it off. A clip in the device's own
track is the pattern already recorded, so the next Play would sound both a few
milliseconds apart. `follow` is a real Live parameter - automatable, mappable, saved with
the set - and it gates only Live's transport starting the pattern, never Run and never
automation written against `play`.

## 1.1.0 - 2026-07-22

**The Studio is the instrument.** The Strudel device's sound is no longer made in the
device view: it is made by a full local strudel.cc - the app itself, built offline from
the `strudel/` submodule - running in a floating window whose `[jweb~]` output IS the
track. Its editor, its scheduler, its superdough, its visualisers, all of it. Evaluating
a pattern there is what the track plays, and closing the window does not stop it.

`scripts/build-repl.mjs` builds that bundle and overlays it for `file://`: it prunes to
the REPL page, rewrites root-absolute URLs (including Astro's island attributes, without
which the page renders a shell and hydrates nothing), drops the service worker, vendors
hydra-synth, and injects one script of ours. The submodule is never patched. The result
is 17 MB and ships as a folder beside the `.amxd`.

**The shim** (`src/app/strudel/repl-shim/m4l-shim.js`) is that one script: it arms the
audio (the REPL waits for a `mousedown` a hidden window never gets), pins the output
device so `setSinkId` cannot steer the sound off the `jweb~` outlets, persists the
pattern to the `code` state slot so it saves with the LIVE SET, and maps Play/Stop and
the eight dials onto the REPL.

**A pattern can describe a dial:**

    note("c3 e3").s("sawtooth").lpf(m4lKnob(1, { name: 'cutoff', unit: 'Hz', range: [200, 2200] }))

The panel reads `cutoff`, the value reads in Hz, and the dial travels 200..2200. It
returns a SIGNAL, not a number - a pattern is evaluated once and then plays, so a plain
number would be frozen at evaluation and the knob would do nothing until you evaluated
again.

**The device view has three faces**, on a strip down the left: a visualizer fed by the
window's level (the default - it answers "is this playing" when the Studio is shut), a
bank of vertical faders carrying whatever the pattern named, and a code scratchpad on
its own state slot. It switches itself to the faders when a control first appears.

**Gone:** the hand-rolled Studio editor window and the online redirect to strudel.cc,
both replaced by the real thing. The device view's engine now runs the scratchpad only,
which is why the device no longer plays two patterns at once.

**Native panel:** Play alone on the top row, then two rows of four dials.

The findings are in [ARCHITECTURE.md](doc/ARCHITECTURE.md) 4k and the closed routes in
[DRAWER_OF_FAILED_IDEAS.md](doc/DRAWER_OF_FAILED_IDEAS.md).

## 1.0.0 - 2026-07-21

The v1.0.0 backlog, cleared: the transport drives the devices, samples survive going
offline, there is a MIDI-played synth, and the main device gets its plain name.

- **`alienmind-gugelhupf-superdough` is now `alienmind-gugelhupf`.** The engine is still
  superdough; the DEVICE is the whole language, so it carries the plain name. Every
  parameter and state slot name is unchanged. An existing Live set embeds its own copy
  of the old device and keeps working - re-add the device to move a set onto the new
  name.
- **No Instrument Racks in the distribution.** Both `.adg` presets are withdrawn: a Live
  rack embeds a copy of every device it holds, so a shipped rack is a snapshot that goes
  stale the moment a device is rebuilt. The devices are the distribution.
- **The transport starts the device.** Launching a clip on the track starts the pattern
  and stopping it stops the pattern; on a track with no clips, Live's global Play does
  the same. The wrapper resolves which signal applies and the page writes it into the
  automatable Play parameter, so a click, an automation lane and a launched clip all move
  one control.
- **Offline sample cache.** Every sample and sample map fetched by any device is stored
  in the page (IndexedDB, with a session fallback) and served cache first, so a set
  reopened with no network still plays the sounds it played before.
- **Strudel Synth** (`alienmind-gugelhupf-synth`): one superdough sound - `s("sawtooth")
  .lpf(800).room(.3)`, a value rather than a pattern - played by the track's MIDI. The
  eight native slider knobs work here too. Note length is decided at trigger time
  (superdough schedules a whole envelope up front), so holding a key does not hold the
  note.
- **Clipboard copy stopped lying.** "Copy folder path" reported success on a page that
  had copied nothing - `execCommand("copy")` returns true in jweb and writes nothing, and
  a `file://` page cannot read the clipboard back to check. No claim is trusted inside
  jweb now: the path is shown pre-selected and the browser's own `copy` event is the
  confirmation. **Still unverified in Live** - see below.
- **Shared device chrome.** The top-bar buttons (Run/Stop, Clip, Controls, Export) are one
  shared component each, icon-only on every device, so a control learnt on one device is
  the same control on the next. The slider row no longer draws a scrollbar over itself.
- **`pnpm build` cleans `dist/` first.** It never did, so a renamed device left its old
  `.amxd` behind and `install:device` faithfully copied the ghost into the User Library.

**Known issues in 1.0.0**

- **Export fails on the Strudel device**: `could not place save: -1 bytes at destination`.
  The render completes; the file never lands. Tracked as TODO item 0.
- **The clipboard copy is untested**, because the Copy button only appears once Export has
  written something. TODO item 1.

## 0.9.5 - 2026-07-19

All of Strudel as the track's audio: the **Strudel Superdough** instrument.

- **Strudel Superdough** (`alienmind-gugelhupf-superdough`): write anything strudel.cc plays
  - multi-line `$:`, samples, synths, orbits, superdough's real effects - and the device
  renders it **offline with the real superdough engine** into a WAV that Max loops on the
  track, locked to Live's transport, crossfading to each fresh render at the loop boundary.
  Deterministic patterns loop one period; random patterns drop to **rolling mode** (one
  realization per loop, with a visible notice). Edits fade in at the next boundary.
- **Follows Live's tempo.** The pattern speeds up / slows with the BPM and the loop stays
  bar-locked at any tempo; a re-render on tempo change keeps the lock. A `setcpm()` in the
  code OVERRIDES this to pin the pattern's own rate - default follows Live, `setcpm` is your
  own clock.
- **Slider knobs.** Every `slider()` in the code becomes a web slider AND binds to
  one of eight native dials (S1..S8) - macro-mappable, on Push - auto-bound by order; a turn
  re-renders. The dial takes the code's name for it (`lpf`, `gain`) on the device panel.
- **Fixes this pass:** serialized renders now also clear superdough's cross-context node
  pool (kills the intermittent "cannot connect to an AudioNode belonging to a different
  audio context" on rapid Play/Stop); dials reset their name when a slider is removed; the
  Controls button moved to the top bar and the debug readout to About.
- Reverted: a runtime `_parameter_range` spike to carry the slider's real range on the
  native dial - it shifts the value domain and breaks the normalized knob math. The dials
  stay 0..1; the app denormalises. The general fix (a Surface-declared native-knob pool) is
  in the m4l-jweb backlog.

## 0.9.1 - 2026-07-19

Pattern as a first-class signal, a bank-based sampler, and one consistent chrome.

- **Drums Sampler** (was Sampler): code-driven. `s("bd sd, hh*8")` plays a
  drum-machine **bank** (strudel's `bank()`), samples auto-download from the
  tidal-drum-machines repo, 16 voices with an LRU name->slot allocator, and a MIDI
  sequencer in front drives it. Accepts bare expressions (`bd sd, hh!6`) and has its
  own `?` reference.
- **One device chrome**: a single grey `Button` across every device; the `?` sits
  rightmost; the native panels (MIDI Play/Stop) and Full Studio moved into
  **About > Advanced** (FX keeps its top-bar Knobs). MIDI options (octave/shift/scale)
  demoted to a small bottom row.
- **Renames**: `midi-drums` -> `drums-midi`, `sampler` -> `drums-sampler`,
  `sampler-browser` -> `sample-browser` (screen + disk).
- Pattern-driven modulation: patterns drive fx parameters on the tick, with
  remote values pre-warped for the knob exponent.
- fx: `.hpf()` and `.crush()` promoted to real stages; a line that takes signals.
- The Full Studio window, with the pattern kept as state that survives the set.
- A reference window listing which Strudel features each device supports.
- Drag-a-sample-into-a-clip: tried (`DownloadURL`) and failed - CEF strips the
  payload; parked. "Show folder" is the answer.
- Runs on m4l-jweb 0.9.1.

## 0.8.x - 2026-07-13 to 2026-07-16

Native Live surfaces, a real engine, and a shipping pipeline.

- fx device sheds HTML sliders for native Live dials (two-screen web UI vs.
  native knob panel, reflowed via useNativeLayout / useNativePanel).
- Drum-rack editor; empty-map silence fixed.
- Per-device surfaces, set-persistent state, and tempo-aware clip export.
- Sampler browser drops [node.script] and previews through the track.
- midi-drums split into its own device; `s("bd:3")` plays the pad, not note 3.
- Native theming: Live CSS variables mapped to Tailwind.
- Play state exposed as a native Live parameter, synced with the UI.
- User-facing warnings for MAX_CYCLES capping and MIDI structure flattening.
- CI/CD pipeline (ci.yml + release.yml).
- Consumes @m4l-jweb 0.6.x / 0.7.0 from npm.

## 0.7.0 - 2026-07-13

Scale awareness and the Surface.

- Scale awareness, full-loop clip export, drum racks, and a live playhead.
- Strudel Audio FX: a real audio effect on the Surface.
- Upgraded to @m4l-jweb 0.3.0 / 0.4.0 (the Surface); dynamic sliders and an
  add-effect overlay panel.

## 0.6.0 - 2026-07-12

The engine leaves node.script; transport goes live.

- Strudel engine moves from [node.script] to a jweb Web Worker.
- Migrate to m4l-jweb 0.2.0: per-device bundles; the Instrument device dropped.
- LiveAPI transport polling plus a free-run clock; tempo observable.
- Fixes for dead LiveAPI observers (the loadbang loading-context trap), stale
  instances, and plugsync~ outlet mapping.
- Licensed AGPL-3.0-or-later; uses published @m4l-jweb packages.

## 0.1.0 - 2026-07-07 to 2026-07-11

First devices.

- Initial Max for Live MIDI device: Strudel mini-notation to MIDI clip and back,
  on the track it is dropped on.
- Headless Strudel engine plus a multi-device build pipeline.
- Three devices: MIDI sequencer, sample fetcher, and audio instrument (poly~
  synth voice).
- Self-contained .amxd with the UI embedded as a base64 payload in wrapper.js.
- node -> jweb return path, makenote flush, and 3-device installers.

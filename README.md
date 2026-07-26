# m4l-gugelhupf - A Hybrid Live Coding Experiment

<p align="center">
  <img src="doc/logo.png" alt="m4l-gugelhupf logo" width="400" />
</p>

> **[UNOFFICIAL NOTE]** - This project was formerly known as `m4l-strudel` but has been renamed to avoid confusion. It is neither an official project nor a component of Strudel, but rather an independent, AGPL-licensed derivative product based on its engine (see [LICENSE](https://github.com/alienmind/m4l-gugelhupf/blob/main/LICENSE)). For the original Strudel source code, please visit [https://codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel).

This started as a fun experiment: *How cool is Strudel! Can I connect it to Ableton and control it from the Push to create the ultimate hybrid workflow?*

The result is a set of **Max for Live devices** that bring [Strudel](https://strudel.cc) - the JavaScript port of TidalCycles' pattern language - natively into Ableton Live. No browser tab, no virtual MIDI cables, no sync hacks: the real `@strudel/core` engine runs headlessly inside each device, locked to Live's transport, and fully mappable to Ableton Push for hands-on control!

![Devices overview - Gugelhupf MIDI, Drums MIDI, Drums Sampler, Audio FX and the sample browser](doc/screenshot-all-devices.png)

> **New here? Start with the [user guide](doc/ABOUT.md)** - every control of every device explained.

## Download

You can download the pre-built `.amxd` devices ready for Ableton Live from:
- **[Download Latest Release](https://github.com/alienmind/m4l-gugelhupf/releases/latest)**
- **[Gumroad](https://alienmindzzz.gumroad.com/l/m4l-gugelhupf-devices)**

## Install

Once downloaded, simply extract the ZIP file and copy the `.amxd` devices into your Ableton **User Library** (e.g. `User Library/Max For Live/m4l-gugelhupf/`).

> ⚠️ **Highly Experimental Limitation:** This is not ready for real music production, just a fun experiment. Sound can be choppy and timing is unreliable. The main instrument (**Gugelhupf**) plays the real superdough engine live in the device, so edits and knob turns are audible immediately - but performance is still not ideal and can go out of sync with the track.

## What this project does

- **Generative sequencing in one line.** `note("c3 e3 g3 b3").sometimesBy(.3, x=>x.fast(2))` is a whole evolving part. Euclidean rhythms, polymeter, per-cycle alternation - things that are tedious to click into a piano roll are one expression in Strudel.
- **The ultimate hybrid workflow.** By exposing Strudel's engine states directly to Live, you can map them to your **Ableton Push** or external MIDI controllers. Start and stop complex algorithmic sequences with physical hardware!

![Strudel driving a drum rack and effects](doc/screenshot-strudel-drum-rack-and-effects.gif)
- **A dedicated drum machine.** The new **Gugelhupf Drums MIDI** device brings Strudel's generative drum language (`bd`, `sd`, `hh`) straight to your Ableton Drum Racks. It features a visual **Kit** mapper that natively persists in your Live set, letting you easily route algorithmic sequences to any custom kit!

![Gugelhupf Drums MIDI Kit Mapping](doc/screenshot-midi-drums-mapping.png)

- **A code-driven drum sampler.** The **Gugelhupf Drums Sampler** plays samples itself: write `s("bd sd, hh*8")`, pick a drum-machine **bank**, and it fetches and plays that machine's sounds - sixteen voices, driven by code (or by MIDI notes in front of it).

- **It's really Live-native.** Launch a clip on the device's track and the pattern starts; stop it and the pattern stops. On a track with no clips, Live's own Play does the same. Patterns start on the bar, follow tempo automation, and notes land on the track the device sits on. Everything renders inside the device UI.
- **From sketch to clip.** The MIDI device can freeze any pattern into a regular MIDI clip (and read clips back into mini-notation), so generative sketches become ordinary arrangeable material. It also doubles as a two-way translator for *understanding* Strudel: freeze a pattern you cannot quite read into a clip and **see** it in the piano roll, or drop a clip you already know and read its mini-notation - each side explains the other.

![Exporting MIDI and applying effects](doc/screenshot-strudel-midi-export-and-effects.gif)

- **Room to type, help that follows you.** A **Full Studio** floating window (from **About > Advanced**) is a big editor over the same pattern as the device view (one pattern, one scheduler), and every Gugelhupf-taking device has a `?` opening a pinned reference of exactly what THESE devices support - per device, offline, with an honest works / not-yet status on every entry, narrowing to whatever your caret is on.
- **A synth you play with your hands.** The **Gugelhupf Synth** takes a SOUND rather than a pattern - `s("sawtooth").lpf(800).room(.3)` - and every MIDI note the track sends plays it. Your clip, your keyboard or another Gugelhupf device in front is the trigger, and any `slider()` in the sound lands on a native knob, so the timbre automates and reaches Push.
- **It keeps its sounds when the network goes.** Every sample and sample map any device fetches is cached in the device page, so a set reopened offline still plays the sounds it played before. Synths never needed the network at all.
- **A sample library browser with taste.** The community sample maps behind strudel.cc (hundreds of drum machines, folk instruments, found sound) become browsable, beat-synced-previewable, and downloadable straight into your User Library workflow.

## What's in the box

![The Gugelhupf device - a full Strudel expression playing as the track's audio](doc/screenshot-strudel.png)

The main deliverable is one mini instrument **Gugelhupf** (`alienmind-gugelhupf`) that understands the full Strudel language (with some exceptions, see [STRUDEL-SUPPORT.md](doc/STRUDEL-SUPPORT.md)) and sequences notes, sounds and effects natively with the superdough engine, in sync with Ableton's transport clock.

We also deliver **additional utility instruments** that showcase different capabilities, and are just some tools in the toolset for any curious and adventurous producer:

| Device | Type | What it does for you |
|---|---|---|
| **Gugelhupf** (`alienmind-gugelhupf.amxd`) | Instrument | **ALL of Strudel as the track's audio.** Its Studio window is the REAL local strudel.cc - the whole app, offline, with its own editor, scheduler and visualisers - and what you evaluate there IS the track. The pattern saves with your Live set, Live's transport drives it, and a `slider()` or `m4lKnob()` in the pattern lands on a native dial carrying its own name, unit and range. The device view is a panel: a visualizer, a bank of faders, and a small scratchpad. |
| **Gugelhupf MIDI** (`alienmind-gugelhupf-midi.amxd`) | MIDI effect | Allows you to sequence notes and pass it to any instrument. It also allows you to translate Strudel patterns to the piano roll and vice versa. It streams live MIDI tempo-locked to Live, following tempo changes, multi-channel via `.midichan()`. Scale-aware (follows Live 12's key). |
| **Gugelhupf Drums MIDI** (`alienmind-gugelhupf-drums-midi.amxd`) | MIDI effect | Allows you to map drum patterns that would normally sound as sounds into MIDI notes that can be sequenced to a drum rack. A dedicated mapping UI routes drum words (`bd`, `sd`, `hh`) to specific Drum Rack pads, and the map travels with your set. |
| **Gugelhupf Synth** (`alienmind-gugelhupf-synth.amxd`) | Instrument | **One superdough sound, played by your MIDI.** Type a sound rather than a pattern - `s("sawtooth").lpf(800).room(.3)` - and every note the track sends plays it. No transport and no Play button: your clip, your keyboard or another Gugelhupf device in front is the trigger. Any `slider()` in the sound lands on a native knob (S1..S8), so the timbre automates and reaches Push. |
| **Gugelhupf Drums Sampler** (`alienmind-gugelhupf-drums-sampler.amxd`) | Instrument | Allows you to actually play sounds from the hundreds of Strudel drum machines available in the standard sound packs. It's a polyphonic instrument and accepts MIDI in. Write `s("bd sd, hh*8")`, and a bank picks which machine plays. Sounds auto-download in the background. |
| **Gugelhupf Audio FX** (`alienmind-gugelhupf-fx.amxd`) | Audio effect | Write **one line** of Strudel's effect vocabulary - `.lpf(800).hpf(120).crush(8).gain(1.2)` - and it applies to whatever audio is already on the track. Nine stages, each a real Live parameter: automatable, MIDI-mappable, native dials. Patterns modulate too (`.lpf(sine.range(200, 2000))`). |
| **Gugelhupf Samples** (`alienmind-gugelhupf-sample-browser.amxd`) | Instrument | Allows you to explore the collections of community samples, and play them in sync with your beat. Auditioning downloads the file next to the device; drag it out into a Simpler, a Drum Rack or a track. |


## Controls: your sliders on Ableton's knobs

![Strudel playing with Studio and sliders](doc/screenshot-strudel-play-and-studio-with-sliders.gif)

A `slider()` in your pattern becomes one of the device's eight native dials, in source
order - automatable, MIDI-mappable, on Push:

```js
s("sawtooth").lpf(slider(500, 100, 1000))
```

As an extension to slider(), we can give it units and a name, and the dial says so too:

```js
s("sawtooth").lpf(slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' }))
```

## Quick Examples

If you are eager to jump in, here are a few valid patterns you can drop straight into the respective devices to get started immediately:

**Gugelhupf MIDI**
```js
<c3 c3 <c3 c#3>>*16
```

**Gugelhupf Drums MIDI**
```js
s("bd hh sd hh")
```

**Gugelhupf** (the main device - anything strudel.cc plays)
```js
note("<c3 eb3 g3 bb3>*4").s("sawtooth").lpf(600).room(.3)
```

**Gugelhupf Synth** (a sound, not a pattern - the notes come from Live)
```js
s("sawtooth").lpf(800).room(.3)
```

**Gugelhupf Audio FX**
```js
.lpf(800).gain(1.2)
```

## Notes for producers: How to get a tight sync: correct the Studio's output delay!

The main device buffers its audio by ~66 ms so it never drops out (the sound
engine runs in a browser inside Live, and a buffer that small stutters). That delay is
constant and predictable, so it is trivial to cancel for a perfectly tight mix: set the
track's **Track Delay to -66 ms**.

- The field is in the track header (right-click the track > **Show/Hide Track Delay**, or
  it is under the track name in the mixer). It takes milliseconds, negative to pull the
  track EARLIER.
- `-66` matches what the device adds. If you hear it slightly ahead or behind against
  other tracks, nudge a few ms either way - your interface adds a little of its own.
- It only matters when Strudel plays ALONGSIDE other tracks. Solo, or as the only
  instrument, the offset is inaudible and you can leave it at 0.
- Track Delay is not automatable and not saved to a clip - it is a per-track setting, so
  set it once per track that hosts the device.


## Build & test

```bash
pnpm install
git submodule update --init   # strudel/ - the engine is bundled from here
pnpm test          # vitest: mini-notation parser + headless engine tests
pnpm build         # → dist/m4l-gugelhupf/alienmind-gugelhupf.amxd + the six -<name>.amxd
                    #   + dist/m4l-gugelhupf.zip (release archive incl. installers)
pnpm dev:midi       # browser dev for the MIDI device, mocked Live beside it
pnpm dev:drums-midi # browser dev for the Drums MIDI device
pnpm dev:sample-browser # browser dev for the sample browser
pnpm dev:fx         # browser dev for the Audio FX device
pnpm dev:gugelhupf    # browser dev for the main Gugelhupf device
pnpm dev:synth      # browser dev for the Synth device
pnpm install:device # automatically copy the compiled devices to your local Ableton User Library)
```

For full details on building these devices with the underlying framework from scratch, read [doc/M4L-JWEB-GUIDE.md](doc/M4L-JWEB-GUIDE.md). Detailed architecture diagrams and concepts are found in [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

## License

**AGPL-3.0-or-later**, matching [Strudel's own license](https://strudel.cc/technical-manual/project-start/). This project bundles the real `@strudel/core` engine (via the `strudel/` git submodule) and runs it directly, which makes it a derivative work under Strudel's AGPL terms. See [LICENSE](LICENSE) for the full text.

---
*\* What's a Gugelhupf? Just like a Strudel, a Gugelhupf is a famous, traditional, and delicious Central European pastry!*

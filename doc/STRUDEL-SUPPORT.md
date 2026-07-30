# What Strudel does, and what these devices do with it

Strudel is a language for making **sound**. This project brings it into Ableton Live two
different ways, and how much of the language you get depends entirely on which device you
are holding.

- **The Gugelhupf devices** (`alienmind-gugelhupf`, `-audio`) run the REAL engine.
  Everything strudel.cc plays, they play, because it *is* superdough.
- **The micro devices** (MIDI, Drums MIDI, Audio FX, Drums Sampler) do not synthesise.
  They translate Strudel into native Ableton MIDI or into a Max DSP chain, so the pattern
  *language* is fully supported and the *sound engine* is not.

## Preliminary question: why not just run Strudel's audio engine in real time?

It does, and that is the main device. The answer used to be that it could not: Chromium's
`AudioContext` went to the system output, outside Live entirely - not down the track, not
through your effects, not into your render - so the engine rendered offline to a WAV and
Max played the file back.

**That is history.** `[jweb~]` is a browser view whose Web Audio output is a signal on the
device's outlets, so the page's sound IS the track: through the fader, the sends, the
meters, and into a resample. The offline renderer survives for one job only - **Export**,
which bounces the pattern to a file and drops it in a clip.

What has not changed is the direction of travel: `[jweb~]` has audio OUT and no audio IN.
A page can never be handed the track's audio, which is why the FX device processes sound
in Max rather than in a page.

---

## 1. Gugelhupf (the main instrument)

**Gugelhupf** (`alienmind-gugelhupf`, and `alienmind-gugelhupf-audio`) uses Strudel's real audio engine to render audio directly into your Ableton track.

### Supported: Almost Everything

Because it uses the real `@strudel/superdough` engine under the hood, **everything you can do on strudel.cc is supported.**
- **Full Synthesis:** `s("sawtooth")`, `s("supersaw")`, `s("triangle")` - all oscillators work.
- **Samples:** `s("bd sd")`, `s("gabba")` - sample fetching and playback works.
- **Audio Effects:** `.room()`, `.lpf()`, `.crush()`, `.delay()` - all pattern-attached audio effects work exactly as they do on the web.
- **Multi-line:** `$:`, `stack()`, orbits, etc.

That claim is stronger than it sounds, and it is structural rather than a promise to keep
up: the sound is made by a **full local strudel.cc** - the actual app, built offline,
running in the Studio window - and the device view is a second view of the same pattern.
There is no second implementation of the language here to fall behind.

### Controls: `slider()`, and what m4l adds to it

A `slider()` in your pattern lands on one of the device's eight native dials
(`S1..S8`), in source order, so it automates, MIDI-maps and reaches Push:

```js
s("sawtooth").lpf(slider(500, 100, 1000))
```

Turning it changes the sound immediately, with no re-evaluation, exactly as dragging the
inline slider does.

**The dial itself travels 0..1, and the page does the scaling.** It used to take the
slider's real 100..1000, until that was measured to cost the dial its automation lane and
any Rack macro mapped to it - Live binds those against the parameter as the frozen device
declares it, so widening the domain underneath them leaves a macro writing 0.5 into a
control that now spans 100..1000. The fader and the readout in the device view show the
real value; the dial is the one place that reads 0.44. That trade is deliberate: a
labelled control you cannot automate is worth less than an automatable one.

A slider can also say what it IS, with an optional options object:

```js
s("sawtooth").lpf(slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' }))
```

| Option | What it does |
|---|---|
| `name` | Names the dial on the device panel and the fader in the device view |
| `unit` | How Live prints the value - `Hz`, `dB`, `ms`, `%`, `st`, or any string |
| `order` | Overrides source order when assigning dials |

**This is not a fork of Strudel.** That call runs unchanged on strudel.cc: the
transpiler reads the first four arguments and ignores the rest, so the options are
simply dropped there. It is proposed upstream (doc/FEAT-SLIDERS.md); until it lands,
this device parses them out of your code itself.

Two honest limits:

- **The code text does not change when you turn a dial.** Dragging the inline slider
  rewrites the number in your source; a Live dial does not, because automation moves it
  dozens of times a second and rewriting the document at that rate would fight your
  typing. The number in the code stays the DECLARED value; the sound follows the dial.
- **Live's parameter registry keeps `S1..S8`.** The name reaches the device panel but
  not the Rack macro picker - a frozen Max device cannot rename a parameter there.

`m4lKnob(n, { name, unit, range })` still exists and does the same job for patterns that
want a dial without declaring a slider.

### Two flavours, and only one of them can bounce into a clip

`alienmind-gugelhupf` is an INSTRUMENT and lives on a MIDI track.
`alienmind-gugelhupf-audio` is the same page, the same Studio and the same pattern
declared as an AUDIO EFFECT, so it lives on an audio track and whatever the track already
carries passes straight through with the pattern added to it.

The difference that matters is Export. Live puts an audio clip on an audio track and
nowhere else, and a device can only ever act on the track it is on - a device's view is
only on screen while its own track is selected, so the clip slot Live calls "highlighted"
is always one of its own. So the audio flavour bounces into the slot you clicked; the
instrument writes the file and offers one button, which makes a new audio track and puts
it there.

### Limitations & Exceptions

- **Not Yet MIDI Aware:** this device does not currently process inbound MIDI notes from
  Ableton (doc/TODO.md item 3). For that today, use **Gugelhupf Synth**.
- **Freeze does not work.** Live freezes a track by rendering it offline and faster than
  real time; this device's sound comes from a live browser engine that cannot run in that
  pass, so a frozen track goes silent. Export, or resample the track.
- **Export renders the pattern in the DEVICE PAGE's scope**, not in the Studio's runtime.
  It is the same pattern text, but a pattern leaning on something only the Studio provides
  bounces differently, or not at all. doc/TODO.md item 6.
- **A long tail is cut off.** The bounce renders exactly the cycles the pattern repeats
  over, so a `.room()` or a long `.delay()` is truncated at the loop point and the clip
  clicks. doc/TODO.md item 2.

---

## 2. The Micro Devices (MIDI, FX, Sampler)

The micro devices (`Gugelhupf MIDI`, `Gugelhupf Drums MIDI`, `Gugelhupf Audio FX`, `Gugelhupf Drums Sampler`) do not use the superdough synthesis engine. Instead, they translate Strudel code into native Ableton MIDI or Max DSP.

For these devices, the *pattern language* is 100% supported, but the *sound engine* is **not**.

### A. Gugelhupf MIDI

If the pattern produces notes, this device plays them and can freeze them into a clip.

**Supported: everything that makes notes**

| | |
|---|---|
| **Mini-notation** | sequences, `[]` subdivision, `~` rests, `*` speed, `!` replication, `@` elongation, `<>` alternation, `,` stacks, `{}%` polymeter, `()` euclid |
| **Note transforms** | `.transpose()`, `.scale()`, `.add()`, `.sub()`, `.arp()`, `.off()`, `.rev()`, `.jux()`, `.fast()`, `.slow()`, `.struct()`, `.superimpose()`, `.sometimesBy()`, `.degradeBy()`, `.chunk()`, ... |
| **Chords / voicings** | `.chord()`, `.voicing()`, `.rootNotes()` |
| **Randomness** | `.sometimes*`, `.rarely`, `.often`, `irand`, `choose`, ... |
| **Multiple parts** | `$:` lines, stacked and played together |
| **Signals** | `sine`, `saw`, `perlin`, ... wherever they feed a *note* value |

All of it also **exports to a MIDI clip**, because To Clip runs the engine rather than a parser of ours.

**The trap that catches everyone**

```js
s("bd sd bd sd")     // on a MIDI device: silence. no notes, no error.
sound("bd*4")        // same.
```

A pattern built with `s()` / `sound()` names a **sample**, not a note. On the **MIDI devices**, there is no sample engine. A pattern with no notes produces **no MIDI**, and the device sits there looking broken.

**On the MIDI devices, write notes instead:**
```js
note("36 38 36 38")  // The same thing, as code
bd sd bd sd          // Bare mini-notation maps drum words to Drum Rack pads
```

**The three controls that reach MIDI:**
| Strudel | Becomes |
|---|---|
| `note` / `n` | the MIDI pitch |
| `.gain()` / `.velocity()` | MIDI velocity (`gain(0.5)` -> velocity 64) |
| `.midichan(n)` | the MIDI channel |

**Silently ignored (they are sound-engine controls):**
`.s()`, `.bank()`, `.room()`, `.lpf()`, `.hpf()`, `.delay()`, `.crush()`, `.pan()`, `.speed()`, `.attack()`, `.release()`, `.vowel()`, `.coarse()`, `.shape()`, `.dist()`...
These do not error. The pattern plays; the property is dropped because there is no synthesiser here. `note("c3").room(0.5)` is just `note("c3")`. If you want reverb, put a native Ableton reverb plugin after the device!

### B. Gugelhupf Audio FX

One line of Strudel's effect vocabulary, applied to the audio already on the track. 

**The Frozen-Graph Law:**
The DSP graph is written when the device is built. **Your line only chooses values.** 
- `.lpf(800).gain(1.2)` and `.gain(1.2).lpf(800)` produce the *same* signal path, because there is only one fixed internal path (e.g., lowpass → drive → delay → room → gain).
- **Supported:** `.lpf(hz)` / `.cutoff(hz)`, `.hpf(hz)` / `.hcutoff(hz)`, `.drive(x)`, `.crush(bits)`, `.delay(x)`, `.delaytime(ms)`, `.delayfeedback(x)`, `.room(x)`, `.gain(x)`. Values are in real units and modulate in real time!
- **Refused:** `.pan()`, `.distort()`, `.reverb()`, `.shape()`, `.coarse()`, `.vowel()`, `.phaser()`. These are recognised as real Strudel effects but have no Max chain behind them yet. The device will tell you it's refused. Modulated values like `.lpf(sine)` are also supported, but complex modulations might be refused if unsupported by the bridge.

### C. Gugelhupf Drums Sampler

The one micro device where `s()` is not a footgun but the whole point. It plays samples itself from a **drum-machine bank**.

**Supported: `s()` and `bank()`**

| Feature | Example | What happens |
|---|---|---|
| **Sample names** | `s("bd sd, hh*8")` | Each name plays a drum sound from the selected bank; commas layer (polyphony). Bare `bd sd, hh!6` works too. |
| **Bank** | `s("bd").bank("AkaiLinn")` | Picks the drum machine (strudel's `bank()` prefix). Overrides the bank dropdown, per-hap. |
| **Everything structural** | `s("bd(3,8)")`, `s("[bd hh]*2")`, `s("<bd cp>")` | Full mini-notation and code - it is the same `@strudel/core`, just routed to samples instead of MIDI. |
| **MIDI notes in** | (a sequencer in front) | Notes map to drum sounds by the Drum Rack layout (36 = `bd` ...) and play the bank. |

**Not Supported:**
Audio effects like `.lpf()` or `.room()` do not apply here. Use an FX device after it on the track.
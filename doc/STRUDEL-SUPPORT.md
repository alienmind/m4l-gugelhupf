# What Strudel does, and what these devices do with it

Strudel is a language for making **sound**. This project brings Strudel to Ableton Live through two distinct paradigms: the monolithic **Superdough** device, and the **Micro Devices** (MIDI, FX, Sampler).

The level of support depends entirely on which device you are using.


## Preliminary question: Why not just run Strudel's audio engine in real-time so we support everything?

The engine runs inside `[jweb]`, which is an embedded Chromium view, and Chromium has a perfectly good `AudioContext`. It is the obvious idea and it does not work: **Chromium's audio graph and Live's signal chain do not touch.** 

Sound produced in the device's browser view goes directly to your system output device, outside Ableton entirely - not down the track, not through your effects, not into your render.

That is why this project takes two paths:
1. **Superdough** renders the audio *offline* to a hidden WAV file, loads it into a Max `[buffer~]`, and plays it back through the track.
2. **Micro Devices** avoid audio generation entirely, instead translating Strudel math into native MIDI notes or Max DSP parameters that Live understands in real-time.


---

## 1. Strudel (The Main Instrument)

The **Strudel** device (`alienmind-gugelhupf`) uses Strudel's real audio engine to render audio directly into your Ableton track.

### Supported: Almost Everything

Because it uses the real `@strudel/superdough` engine under the hood, **everything you can do on strudel.cc is supported.**
- **Full Synthesis:** `s("sawtooth")`, `s("supersaw")`, `s("triangle")` - all oscillators work.
- **Samples:** `s("bd sd")`, `s("gabba")` - sample fetching and playback works.
- **Audio Effects:** `.room()`, `.lpf()`, `.crush()`, `.delay()` - all pattern-attached audio effects work exactly as they do on the web.
- **Multi-line:** `$:`, `stack()`, orbits, etc.

### Controls: `slider()`, and what m4l adds to it

A `slider()` in your pattern lands on one of the device's eight native dials
(`S1..S8`), in source order, so it automates, MIDI-maps and reaches Push:

```js
s("sawtooth").lpf(slider(500, 100, 1000))
```

The dial takes the slider's REAL range - it travels 100..1000, not 0..1 - and starts at
the value the code declares. Turning it changes the sound immediately, with no
re-evaluation, exactly as dragging the inline slider does.

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

### Limitations & Exceptions

- **Not Yet MIDI Aware:** this device does not currently process inbound MIDI notes from
  Ableton (see doc/TODO.md).
- **Export bounces the device view's scratchpad**, not the Studio's pattern - the two run
  separate engines. Being resolved; see doc/TODO.md.

---

## 2. The Micro Devices (MIDI, FX, Sampler)

The micro devices (`Strudel MIDI`, `Strudel Drums MIDI`, `Strudel Audio FX`, `Strudel Drums Sampler`) do not use the superdough synthesis engine. Instead, they translate Strudel code into native Ableton MIDI or Max DSP.

For these devices, the *pattern language* is 100% supported, but the *sound engine* is **not**.

### A. Strudel MIDI

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

### B. Strudel Audio FX

One line of Strudel's effect vocabulary, applied to the audio already on the track. 

**The Frozen-Graph Law:**
The DSP graph is written when the device is built. **Your line only chooses values.** 
- `.lpf(800).gain(1.2)` and `.gain(1.2).lpf(800)` produce the *same* signal path, because there is only one fixed internal path (e.g., lowpass → drive → delay → room → gain).
- **Supported:** `.lpf(hz)` / `.cutoff(hz)`, `.hpf(hz)` / `.hcutoff(hz)`, `.drive(x)`, `.crush(bits)`, `.delay(x)`, `.delaytime(ms)`, `.delayfeedback(x)`, `.room(x)`, `.gain(x)`. Values are in real units and modulate in real time!
- **Refused:** `.pan()`, `.distort()`, `.reverb()`, `.shape()`, `.coarse()`, `.vowel()`, `.phaser()`. These are recognised as real Strudel effects but have no Max chain behind them yet. The device will tell you it's refused. Modulated values like `.lpf(sine)` are also supported, but complex modulations might be refused if unsupported by the bridge.

### C. Strudel Drums Sampler

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
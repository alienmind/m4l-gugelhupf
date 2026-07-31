<div class="titlepage">

![Gugelhupf](logo-print.png)

# Gugelhupf - Generative Max 4 Live device (which is not like a Strudel)

## v1.3.2-beta2

*"A Gugelhupf, like a Strudel, is a traditional Central European cake."*

</div>

# The manual

Strudel, the live-coding pattern language, as ordinary Max for Live devices. You write a
line of code; Live plays it, records it, automates it and maps it to your Push.

**Two devices are the instrument**, and they are the same instrument in the two containers
Live offers: **Gugelhupf** on a MIDI track and **Gugelhupf Audio** on an audio track. Both
run the whole language. Everything else in the box is a small utility - useful, much
smaller, and deliberately not the full engine.

This manual walks through all of them: what each is for, which button does what, and the
things that will otherwise surprise you. It is written to be read in order once, and used
as a reference afterwards.

---

## 1. Install

1. Extract the release ZIP.
2. Copy the `m4l-gugelhupf` folder into your Ableton **User Library**, under
   `User Library/Max For Live/`. On Windows the installer script `install-windows.ps1`
   does it for you; on macOS, `install-mac.sh`.
3. In Live, find the devices under **User Library > Max For Live > m4l-gugelhupf**.

**On macOS, run the installer as `bash install-mac.sh`** - from Terminal, in the folder
you unzipped:

```bash
cd ~/Downloads/m4l-gugelhupf-1.3.2-beta2   # the ZIP carries its version
bash install-mac.sh
```

Two things there are macOS's, and the script handles both:

- **`bash`, not `./`.** Archive Utility does not reliably keep the executable bit the ZIP
  records, so `./install-mac.sh` can answer `permission denied`.
- **Quarantine.** Everything unpacked from a downloaded ZIP is marked
  `com.apple.quarantine` - the `.amxd` files and every file inside a `-site` folder. The
  script clears it on what it installed. **If you copy the folder by hand instead, clear
  it yourself**, or the devices may load with an empty page:

  ```bash
  xattr -dr com.apple.quarantine "$HOME/Music/Ableton/User Library/Max For Live/m4l-gugelhupf"
  ```

The script prints the User Library it chose and lists what it installed. If it chose
wrong, name the folder yourself:

```bash
bash install-mac.sh m4l-gugelhupf ./m4l-gugelhupf "/Users/you/Music/Ableton/User Library"
```

**Keep the `-site` folders next to the `.amxd` files.** Two devices open a full local copy
of strudel.cc in a window, and that copy is a folder rather than something hidden inside
the device. A device whose folder is missing still plays, but its Studio window opens
empty.

**Updating: delete and re-drag.** Live copies a device into your Set when you drag it in,
so an instance already on a track keeps the old version forever. To update a Set, remove
the device from the track and drag the new one in from the browser.

You need Live 12 with Max for Live. Putting a rendered bounce straight into a clip needs
**Live 12.0.5 or newer**; on anything older that one button falls back to giving you the
file's path.

---

## 2. Which device do I want?

![All the devices](screenshot-all-devices.png)

### The instrument, in two containers

This is the one that runs **all of Strudel**: every synth, sample, orbit and effect
strudel.cc plays, because it *is* the same engine. Pick the flavour that matches the track
you want it on.

| Device | Goes on | Why this one |
|---|---|---|
| **Gugelhupf** | a **MIDI track** | The default. The full language as the track's instrument, and it can write its pattern out as a MIDI clip |
| **Gugelhupf Audio** | an **audio track** | The same device, same Studio, same pattern - and the one that can **bounce its pattern into an audio clip**, because Live only puts audio clips on audio tracks |

They are not two products. One page, one engine, one set of controls; the container is the
only difference, and it decides what Export can hand you (section 5).

### The utilities

Small tools and curiosities, for when you do NOT want Strudel generating the audio. Each
does one thing with a fraction of the weight - none of them carries the sound engine, so
none of them plays a `s("sawtooth")` or a sample the way the instrument above does.

| Device | Goes on | What it is for |
|---|---|---|
| **Gugelhupf MIDI** | MIDI track, before an instrument | Strudel patterns as plain MIDI notes, into any Ableton instrument or Drum Rack. Also converts patterns to and from MIDI clips |
| **Gugelhupf Drums MIDI** | MIDI track, before a Drum Rack | The same, written in drum words (`bd sd hh`), with a visual mapper onto Drum Rack pads |
| **Gugelhupf Drums Sampler** | MIDI track | Plays drum-machine samples straight from code. A sampler, not a synthesiser |
| **Gugelhupf Synth** | MIDI track | One Strudel SOUND, played by incoming notes. No pattern, no transport |
| **Gugelhupf Audio FX** | audio track | Strudel's effect vocabulary over audio that already exists - as Max DSP, not as Strudel's own (see section 8) |
| **Gugelhupf Samples** | MIDI track | Browses and downloads the community sample packs |

They combine. A typical track: **Gugelhupf MIDI** writing notes -> **Gugelhupf Synth**
turning them into sound -> **Gugelhupf Audio FX** filtering the result. Every value in that
chain is a real Live parameter.

---

## 3. The controls every device shares

The device view in Live is a fixed strip about 169 pixels tall and it does not scroll, so
the top bar is icons with tooltips rather than words. Hover anything you do not recognise.

| Icon | Name | What it does |
|---|---|---|
| Play / Stop | **Run** | Evaluates the pattern and starts it. Lifts while it is running. Ctrl+Enter in the editor does the same |
| Download | **Export** | Renders the pattern (see section 5) |
| Sliders | **Controls** | Flips to the NATIVE panel - the mappable Play/Stop and the eight dials. Its own **Back** switch returns |
| **?** | **Help** | A floating reference of exactly what these devices support, filtering itself to whatever your caret is on |
| Clipboard | **Copy path** | Puts a file path on the clipboard - the last export, or the device's folder |

**The name in the top-left corner opens About**, which carries the build number, a health
readout, and the link to the Studio.

### The eight knobs, and how your code reaches them

Any `slider()` in your pattern lands on one of eight native dials, **S1..S8**, in the order
the sliders appear in your code:

```js
s("sawtooth").lpf(slider(500, 100, 1000))
```

Turn S1 and the filter moves immediately - no re-evaluation, exactly like dragging the
inline slider on strudel.cc. Because they are real Live parameters, they record automation,
MIDI-map, and appear on Push.

You can say what a slider IS, and the device view will show it:

```js
s("sawtooth").lpf(slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' }))
```

Two things worth knowing:

- **Turning a dial does not rewrite your code.** The number in the text is the value the
  pattern was written with; the dial is what the sound follows. (Automation moves a dial
  dozens of times a second, and rewriting the document at that rate would fight your
  typing.)
- **Live's own parameter list keeps the names `S1..S8`.** A frozen Max device cannot rename
  a parameter there, so a Rack macro picker shows `S1`, while the device view shows
  `cutoff`.

![The device's faders](screenshot-gugelhupf-knobs.png)

---

## 4. Gugelhupf - the main instrument

`alienmind-gugelhupf.amxd` - drop it on a **MIDI track**, in the instrument slot.

This is the whole of Strudel as the track's sound. Not a re-implementation: the device runs
a **full local copy of strudel.cc** - its editor, its scheduler, its synths, its
visualisers - and that copy's audio *is* your track. Everything that plays on the website
plays here, offline.

![The device and its Studio](screenshot-gugelhupf-and-studio.png)

### The two views of one pattern

- **The device view** is the small strip in Live: a code editor, a bank of faders and a
  level meter, on a strip of icons down the left.
- **The Studio** is the real strudel.cc, in a floating window. Open it with **REPL** in the
  top bar.

They edit **the same pattern**. Type in one, it appears in the other. The pattern is saved
inside your Live Set, so reopening the Set brings your code back.

The Studio is what makes the sound, and it keeps playing **with its window closed** - shut
it to see your mixer without stopping the music.

### The three faces of the device view

The icon strip down the left switches between them:

| Icon | View | For |
|---|---|---|
| Pulse | **Visualizer** | Is it playing, and how loud - the thing you cannot see when the Studio is shut |
| Faders | **Controls** | Whatever your pattern's sliders are, full size |
| Code | **Code** | A small editor over the same pattern the Studio holds |

### Playing it

- **Run** evaluates and starts. It also tells the Studio to re-evaluate, so pressing Run
  after an edit is how you hear the edit.
- **Launching a clip on this track starts the pattern too**, and stopping it stops the
  pattern. On a track with no clips, Live's global Play does the same.
- **The link icon (Follow)** decides whether Live's transport is allowed to start the
  pattern. It matters after you bounce - see section 5.
- **Play/Stop is a real parameter**, so a Rack macro, an automation lane or a Push button
  can drive it. Whatever moved it last wins.

### What it will not do

- **Freeze does not work.** Live's Freeze renders a track offline and faster than real
  time, and this device's sound comes from a live browser engine that cannot run in that
  pass - a frozen track goes silent. Use Export, or resample the track. This is how Live
  freezes, not something the device can work around.
- **It does not play incoming MIDI notes.** It sequences its own pattern. For playing notes
  from a keyboard or a clip, use **Gugelhupf Synth**.
- **Timing needs one setting from you** if it plays alongside other tracks - see section 9.

---

## 5. Export - getting a pattern out as audio or notes

Export is the same button on both flavours of the main device, and what it produces depends
on the kind of track it is on. The device asks Live which kind that is, so you never have
to tell it.

### On an audio track: a clip, in one press

`alienmind-gugelhupf-audio.amxd` is the same device declared as an **audio effect**, so it
sits on an **audio track**. Whatever the track already carries passes straight through, and
the pattern is added to it.

1. Click an **empty clip slot on that track**.
2. Press **Export**.

The pattern is rendered and the clip is in that slot - warped, and looped over exactly the
cycles that were rendered, so it plays in time rather than being warped by guesswork. The
`.wav` also sits next to the device on disk, so you can reuse it anywhere.

![Export straight into a clip](screenshot-gugelhupf-audio-clip.png)

**Bouncing switches Follow off.** The clip in your track is now the pattern, recorded;
with Follow on, pressing Play would sound the clip AND the live pattern a few milliseconds
apart. Click the link icon to follow the transport again.

### On a MIDI track: the file, or the notes

The main device on a MIDI track cannot make an audio clip - Live only puts those on audio
tracks. It offers two things instead:

- **Export** renders the `.wav` next to the device and offers **one extra button**: bounce
  it to a **new audio track**. Nothing is created until you press it.
- **The notes button** writes the pattern as an ordinary **MIDI clip** in the first empty
  slot on the track. Everything Strudel does to notes comes through - `.transpose()`,
  `.arp()`, `.jux()`, alternation, euclidean rhythms - because the notes are read from the
  pattern itself rather than from a simplified copy of it.

![The same pattern written as a MIDI clip](screenshot-gugelhupf-midi-clip.png)

**Samples and effects have no MIDI form.** `s("bd sd")` names *samples*, not pitches, so a
pattern made of them writes no notes at all - the device says so rather than leaving you an
empty clip. `lpf`, `room`, `pan` and the rest are dropped too; put a real Ableton effect
after the device instead.

### Things to expect from a bounce

- **A long reverb or delay tail is cut off** at the loop point, which can click. Keep tails
  short in a pattern you intend to bounce, or bounce a longer pattern and trim it.
- **The file is referenced where it lies**, next to the device, exactly as a file you
  dragged in would be. Use Live's **Collect All and Save** before moving the Set to another
  machine.
- **The copy-path button** is always there, and is the answer on Live 12.0.4 and older: it
  puts the export's full path on the clipboard, to paste into Explorer or Finder.

---

## 6. The utilities: the MIDI devices

### Gugelhupf MIDI

`alienmind-gugelhupf-midi.amxd` - a **MIDI effect**, in front of any instrument.

Write a pattern, press **Run**, and it streams live MIDI into whatever follows it - an
Ableton instrument, a Drum Rack, a hardware synth. It follows Live's tempo, including tempo
automation, and `.midichan(n)` picks the channel.

The **Clip** button opens a second screen with two jobs:

- **To Clip** - freeze the pattern into a regular MIDI clip on this track.
- **From Clip** - read a clip back into mini-notation, in the editor.

![Clip export and import](screenshot-midi-export-import.png)

That pair is also the best way to *learn* Strudel: freeze a pattern you cannot quite read
and look at it in the piano roll, or drop in a clip you know and read its notation.

**The trap that catches everyone:**

```js
s("bd sd bd sd")   // on a MIDI device: silence. No notes, no error.
```

`s()` and `sound()` name samples, and there is no sample engine here. Write notes instead:

```js
note("36 38 36 38")
bd sd bd sd        // bare mini-notation maps drum words to Drum Rack pads
```

Three things reach MIDI: `note` / `n` become the pitch, `.gain()` / `.velocity()` become
the velocity, and `.midichan(n)` the channel. Everything else - `.room()`, `.lpf()`,
`.speed()`, `.vowel()` - is silently dropped, because there is no synthesiser in this
device.

![MIDI export driving effects](screenshot-gugelhupf-midi-export-and-effects.gif)

### Gugelhupf Drums MIDI

`alienmind-gugelhupf-drums-midi.amxd` - the same idea, aimed at Drum Racks.

Write drum words rather than pitches (`bd sd hh`), and the **Kit** button opens a visual
mapper that routes each word to a Drum Rack pad. The map is saved inside your Live Set.

![The Kit mapper](screenshot-midi-drums-mapping.png)

---

## 7. The utilities: the small instruments

### Gugelhupf Synth

`alienmind-gugelhupf-synth.amxd` - an instrument on a **MIDI track**.

It takes a **sound**, not a pattern:

```js
s("sawtooth").attack(0.2).lpf(800).room(.3)
```

Press the tick (or Ctrl+Enter) and every MIDI note the track receives plays that sound -
from a clip, your keyboard, or a Gugelhupf MIDI device in front of it. There is no
Play/Stop, because the notes are the trigger.

Two things to know:

- **Structure collapses.** `s("<sawtooth square>")` is a pattern; this device keeps its
  first event only. Patterns belong in the main device.
- **Holding a key does not hold the note.** Length is decided when the note starts, from
  `.sustain(seconds)` (0.6 s by default). The sound engine schedules a whole envelope up
  front and cannot cut it short.

### Gugelhupf Drums Sampler

`alienmind-gugelhupf-drums-sampler.amxd` - an instrument on a **MIDI track**.

The one device where `s()` is the whole point. Pick a drum machine from the **bank**
dropdown, write `s("bd sd, hh*8")`, press Run. Sounds download in the background the first
time you name them, and the **Sounds** screen lets you audition a bank.

![The Sounds screen](screenshot-drums-sampler-2.png)

`.bank("AkaiLinn")` overrides the dropdown from inside the pattern. MIDI notes coming in
play the bank by the Drum Rack layout (36 = `bd`, and so on). Audio effects do not apply
here - put an FX device after it.

### Gugelhupf Samples

`alienmind-gugelhupf-sample-browser.amxd` - an instrument on a **MIDI track** (it makes the
preview sound, so it needs an instrument slot).

Browse the community sample maps behind strudel.cc, audition them in time with your
project, and download what you want. An auditioned file is written next to the device;
**Copy path** gives you its location, to drag into a Simpler, a Drum Rack or a track.

Previews start on your project's own launch quantization - if Live is set to **1 Bar**, a
preview waits for the downbeat.

---

## 8. The utilities: Gugelhupf Audio FX

`alienmind-gugelhupf-fx.amxd` - an **audio effect**, on any audio track.

One line of Strudel's effect vocabulary, applied to whatever audio the track already
carries:

```js
.lpf(800).hpf(120).crush(8).room(0.3).gain(1.2)
```

Each value becomes a real Live dial beside the text - automatable, MIDI-mappable, on Push.
Patterns work too: `.lpf(sine.range(200, 2000))` sweeps in time with the transport. The
`(+)` button appends a stage.

**It EMULATES those effects; it does not run Strudel's.** There is no sound engine in this
device. Each name is mapped to the Max DSP object that resembles it - `.lpf()` is a
`[onepole~]`, `.room()` is Max's own reverb, `.crush()` a bit reducer - so the control is
the one you know from Strudel and the SOUND is Max's. Expect a family resemblance rather
than a match: the same line through the main instrument, where the real engine runs, will
not sound identical. That trade is what buys you native dials, automation and Push on a
track the device never generated.

**The order you type does not change the signal path.** The internal chain is fixed
(lowpass -> high-pass -> drive -> crush -> delay -> reverb -> gain), so `.lpf(800).gain(2)`
and `.gain(2).lpf(800)` sound identical. Your line chooses values, not routing.

**Supported:** `.lpf()` / `.cutoff()`, `.hpf()` / `.hcutoff()`, `.drive()`, `.crush()`,
`.delay()`, `.delaytime()`, `.delayfeedback()`, `.room()`, `.gain()`.

**Refused, with a message:** `.pan()`, `.distort()`, `.reverb()`, `.shape()`, `.coarse()`,
`.vowel()`, `.phaser()`. They are real Strudel effects with no Max stage behind them yet.

---

## 9. Getting a tight mix

The two sounding devices buffer their audio by about **66 ms** so they never drop out - the
engine runs in a browser inside Live, and a smaller buffer stutters. The delay is constant,
so it cancels exactly:

**Set the track's Track Delay to -66 ms.**

Right-click the track and choose **Show/Hide Track Delay**, or find it under the track name
in the mixer. Negative pulls the track earlier. Nudge it a few ms if your interface adds
some of its own.

It only matters when a Gugelhupf device plays alongside other tracks. Solo, or as the only
instrument, leave it at 0. Track Delay is per track and is not automatable, so set it once
on each track that hosts a device.

---

## 10. When something is wrong

| What you see | What it is |
|---|---|
| Updated the device, nothing changed | Live embedded a copy in your Set. Delete it from the track and re-drag it from the browser |
| Run does nothing | Check the status line. Remember the transport has to be running for a sequencing device |
| A red outline round the editor | The message underneath names the parse or evaluation error |
| `s("bd sd")` is silent on a MIDI device | It names samples, and MIDI devices have no sample engine. Write `note(...)`, or use the Drums Sampler |
| No sound from `s("bd")` offline | Samples are fetched when first played. Anything played once online is cached and works offline afterwards; synths never need the network |
| The Studio window opens empty | Its `-site` folder is not next to the `.amxd`. Reinstall the whole folder |
| macOS: a device loads but its page stays blank | Most likely quarantine on the unzipped files. Run the `xattr -dr` line in section 1 on the installed folder, then delete and re-drag the device |
| macOS: `permission denied` running the installer | Run it as `bash install-mac.sh` |
| A frozen track went silent | Freeze cannot render a browser engine. Use Export, or resample |
| The Synth is silent | It only plays incoming MIDI. Check something is sending notes to the track |
| Export says a MIDI track takes no audio clip | Correct - use Gugelhupf Audio on an audio track, or press the offered new-track button |
| A bounced clip clicks at the loop | A reverb or delay tail was cut at the loop point. Shorten the tail or bounce more cycles |

**The Max console is where a device speaks.** In Live: **View > Max Console** (or the Max
window on macOS). Every device logs what it loaded, what it saved and where.

Every load opens with a diagnostics block - the device's own path, the folder it derived,
the URL it handed its page, and a listing of what it actually found beside itself:

```
m4l-jweb: --- diagnostics (build 1.3.1, mode instrument) ---
m4l-jweb: patcher.filepath = '...'
m4l-jweb: device folder = '...'
m4l-jweb: ui url = file:///...
m4l-jweb: folder listing (12): alienmind-gugelhupf.amxd, ...
```

**Paste that block into any bug report.** It is the difference between a guess and a
diagnosis, and on macOS it is currently the only evidence there is.

---

## 11. Licence and credits

AGPL-3.0-or-later, matching Strudel's own licence. These devices bundle and run the real
Strudel engine, which makes them a derivative work under its terms.

Strudel is at [strudel.cc](https://strudel.cc); its source is at
[codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel). This project is independent
of it and not official.


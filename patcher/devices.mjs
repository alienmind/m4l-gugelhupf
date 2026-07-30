/**
 * devices.mjs - the device manifest. Read by @m4l-jweb/build, which generates a
 * patcher per entry and writes the .amxd.
 *
 * `type` is the container tag Live sees; `mode` is what the wrapper is told it
 * is; `ui` is the folder under src/app/ holding the device's UI (defaults to
 * `name`, which is why the two devices here set it - `alienmind-gugelhupf-midi`
 * would otherwise look for a folder of that exact name).
 */
export default [
	{
		name: "alienmind-gugelhupf-midi",
		ui: "midi",
		type: "midi", // 'mmmm' MIDI effect
		chains: ["midiout"], // packaged chain: the engine's note stream -> MIDI out
		unmatchedTo: "js", // ui_ready / write_clip / read_notes reach the wrapper
	},
	{
		name: "alienmind-gugelhupf-drums-midi",
		ui: "drums-midi",
		type: "midi", // 'mmmm' MIDI effect
		chains: ["midiout"],
		unmatchedTo: "js",
	},
	{
		/**
		 * The sample browser - an instrument that browses Strudel's sample-map
		 * universe, downloads what you pick, and previews it through the track.
		 *
		 * `webaudio` is the preview: the page decodes and plays the sample, jweb~
		 * sums it into the track's signal path. Writing the auditioned file next to
		 * the device - the drag-out handle - is declared in
		 * src/app/sample-browser/files.ts, which derives the `download` chain.
		 *
		 * type "instrument": the browser ORIGINATES sound (the preview) and
		 * processes nothing, so it fills a track's instrument slot rather than
		 * posing as an effect on audio it never touches.
		 */
		name: "alienmind-gugelhupf-sample-browser",
		ui: "sample-browser",
		type: "instrument",
		mode: "sample-browser",
		chains: ["webaudio"],
		// The same ring buffer the main device and the synth take. It is a [jweb~]
		// property, not a superdough one: any page whose audio reaches the track
		// through the webaudio chain underruns on the object default (~21 ms at
		// 48 kHz), whatever produced the samples. A preview is the least sensitive
		// place to spend 66 ms - nobody plays this device in time.
		latency: 66,
		unmatchedTo: "js",
	},
	{
		name: "alienmind-gugelhupf-fx",
		ui: "fx",
		type: "audio",
		chains: ["lowpass", "hpf", "drive", "crush", "delay", "reverb", "gain", "remote"],
		remotes: 9,
		unmatchedTo: "js",
	},
	{
		/**
		 * Strudel Drums Sampler - polyphonic, code-driven sampler over drum-machine
		 * banks. Samples are fetched and decoded IN THE PAGE and played through the
		 * `webaudio` chain; `midiin` keeps the instrument's MIDI input so a sequencer
		 * in front drives the same bank. The old [poly~]/[buffer~] slots are gone
		 * (doc/DRAWER_OF_FAILED_IDEAS.md).
		 */
		name: "alienmind-gugelhupf-drums-sampler",
		ui: "drums-sampler",
		type: "instrument",
		mode: "drums-sampler",
		chains: ["webaudio", "midiin"],
		// Same ring buffer as the other webaudio devices. This one PAYS for it: it is
		// played live from a keyboard or a sequencer, and 66 ms on a drum hit is
		// audible where it is not on a sustained tone. Correct it with Track Delay
		// (doc/README.md); drop it back if the trade turns out to be the wrong way
		// round for percussion.
		latency: 66,
		unmatchedTo: "js",
	},
	{
		/**
		 * Strudel - the MAIN device of this repo: ALL of Strudel, as the track's real
		 * audio. It was `alienmind-gugelhupf-superdough` until 1.0.0; the engine is still
		 * superdough, but the DEVICE is the whole language, so it carries the plain name.
		 * The page runs the real superdough engine LIVE (synths, samples, orbits, effects -
		 * everything strudel.cc plays, because it IS superdough) and jweb~ routes
		 * its Web Audio output into the track. The offline WAV render pipeline this
		 * device used to need is parked in doc/DRAWER_OF_FAILED_IDEAS.md.
		 *
		 * type "instrument": it fills the Rack's instrument slot - the sound source
		 * of the track, not an effect on one.
		 */
		name: "alienmind-gugelhupf",
		ui: "strudel",
		type: "instrument",
		mode: "strudel",
		// Export is declared in src/app/strudel/files.ts, and [maxurl] comes from there.
		chains: ["webaudio"],
		// The device page's own ring buffer, the same 66 ms the Studio window asks for
		// (src/app/strudel/surface.ts). The page makes no sound of its own any more, but
		// its `[jweb~]` is still summed into the track, and the object default (~21 ms at
		// 48 kHz) underruns within ~30 s.
		latency: 66,
		unmatchedTo: "js",
	},
	{
		/**
		 * Strudel on an AUDIO track - the same device, in the one container that can
		 * bounce into a clip.
		 *
		 * `ClipSlot.create_audio_clip` refuses any target that is not an audio track, and
		 * an INSTRUMENT can never satisfy that: it sits on a MIDI track, and the clip slot
		 * Live calls highlighted is always one of its own, because pressing a button in a
		 * device's view requires that device's track to be selected. Targeting some other
		 * track is therefore not a UI to be designed - it is unreachable.
		 *
		 * As an audio effect the question does not arise. Its own track has audio clip
		 * slots, so a bounce lands where the device already is. `webaudio` SUMS [jweb~]
		 * onto the device input rather than replacing it, so whatever the track was
		 * carrying still passes through and the pattern is added to it.
		 *
		 * Same `ui` and same `mode` as the instrument: one page, one wrapper path. What
		 * differs is asked of Live at runtime (`has_audio_input` on its own track), never
		 * inferred from the mode - one device that can bounce and one that cannot is a
		 * distinction the LOM already carries.
		 */
		name: "alienmind-gugelhupf-audio",
		ui: "strudel",
		type: "audio",
		mode: "strudel",
		chains: ["webaudio"],
		latency: 66,
		unmatchedTo: "js",
	},
	{
		/**
		 * Strudel Synth - one superdough sound, played by the track's MIDI (TODO item 3).
		 *
		 * The smallest instrument here: no pattern, no transport, no engine worker. The
		 * page compiles a superdough VALUE once and plays it per incoming note, so
		 * `midiin` is the trigger and `webaudio` carries the result into the track. No
		 * `download` chain - it writes no files.
		 */
		name: "alienmind-gugelhupf-synth",
		ui: "synth",
		type: "instrument",
		mode: "synth",
		chains: ["webaudio", "midiin"],
		// Same ring buffer as the main device. This one sustains too - a held MIDI note
		// is exactly the tone the object default (~21 ms at 48 kHz) underruns on.
		latency: 66,
		unmatchedTo: "js",
	},
];

/**
 * Files that ride along in the release ZIP without belonging to any device.
 *
 * The manual, in both forms. The markdown is the source and is always there; the PDF is
 * rendered by `scripts/build-manual.mjs` and is skipped on a machine with no Chromium, so
 * the packaging step treats a missing doc as a warning rather than a failure.
 */
export const docs = ["doc/USERSMANUAL.md", "dist/manual/USERSMANUAL.pdf"];

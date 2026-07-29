/**
 * surface.ts (strudel) - the main device's Live parameters.
 *
 * The MIDI device's surface minus what does not apply: no scale (nothing here is a
 * MIDI pitch) and no clip I/O (the output is the track's audio, not notes). What
 * remains is the transport pair - the macro-mappable Play/Stop and the native panel
 * that makes it clickable - plus the code slot and the three windows.
 */
import { button, defineSurface, knobPool, state, window } from "@m4l-jweb/surface";
import { KNOB_POOL, codeSlot, helpQuerySlot, transportParams } from "../shared/surface";
import { DEFAULT_OWNER } from "./transport";

/**
 * THE SLIDER KNOBS. strudel.cc renders `slider(0.571, 0, 1)` as an inline widget; here
 * the same role falls to eight native dials - slider N in the code (source order) maps
 * to knob N. NORMALIZED 0..1 deliberately: a slider's range is declared by the CODE and
 * changes per pattern, while a live.dial's range is stamped at build time - so the dial
 * carries the travel and the app denormalizes into the slider's own min..max on each
 * re-render. Automatable, macro-mappable, on Push - a knob turn re-renders the pattern
 * with the new value (one render of latency, the honest cost of pre-rendered audio).
 *
 * `knobPool(8)` is the library's word for exactly this: a fixed set of interchangeable
 * dials, lent out to controls that are not known until the user's code runs. Emits the
 * same s1..s8 at 0..1 the eight hand-written declarations did.
 */

/**
 * The pattern this device opens with. Full Strudel, synth-only on purpose: it renders
 * with no network (samples need their map fetched first), so the very first Run makes
 * sound anywhere. Deterministic, so it lands in loop mode.
 */
export const INITIAL_TEXT = `note("<c3 eb3 g3 bb3>*4").s("sawtooth").lpf(600).room(.3)`;

export default defineSurface({
	params: {
		...transportParams,
		/**
		 * THE VIEW SWITCH - same mechanism as the MIDI device: a native `live.text` button
		 * that flips between the web editor and the native transport panel where the
		 * macro-mappable Play/Stop lives.
		 */
		transport: button({ default: false, label: "Back", short: "Back" }),
		...knobPool(KNOB_POOL),
	},

	/**
	 * The native panel behind the view switch: the macro-mappable Play/Stop plus the
	 * eight slider knobs - the FX device's knob-panel mechanism, two rows.
	 */
	layout: {
		native: {
			params: ["play", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
			// Play alone on the first row, then all eight dials in ONE row - the same
			// left-to-right order as the faders in the device view, so a hand moving
			// between the two surfaces does not have to re-learn the layout.
			rows: [1, 8],
			panel: true,
			switch: "transport",
		},
	},

	/** The pattern, saved with the set and shared with the Studio window. */
	state: {
		code: codeSlot(INITIAL_TEXT),
		/**
		 * The device view's scratchpad - EMPTY by default, and empty is its normal
		 * state. It is not where the music is written (that is `code`, in the Studio):
		 * it is where a `scope()` or a control snippet goes, and it runs on the device
		 * page's own engine so it can draw and sound in its own right.
		 */
		miniCode: codeSlot(""),
		/**
		 * WHICH ENGINE LIVE'S TRANSPORT DRIVES - "studio" or "scratchpad", claimed by
		 * whichever was started last, and saved so a set reopens playing the same one.
		 * Both pages write it: the device view when Run is pressed, the Studio's shim
		 * when the user evaluates there. See transport.ts.
		 */
		engine: state<string>({ default: DEFAULT_OWNER }),
		/** What the caret is on, so the floating help can follow the typing. */
		helpQuery: helpQuerySlot(),
	},

	windows: {
		/** The reference, one `?` away. This device runs ALL of Strudel, so it lists everything. */
		help: window({ title: "Strudel Reference", width: 420, height: 620, entry: "Help", alwaysOnTop: true }),
		/**
		 * THE STUDIO: the real local strudel.cc, and this device's SOUND.
		 *
		 * `site:` is the whole app, built offline by scripts/build-repl.mjs - its own
		 * editor, its own scheduler, its own superdough, its own visualisers - and
		 * `audio: true` makes the page a `[jweb~]` whose output IS the track. It runs
		 * whether or not the window is open.
		 *
		 * It replaced a hand-rolled editor window and an online redirect to
		 * strudel.cc, both deleted once this had parity.
		 */
		repl: window({
			title: "Strudel Studio",
			width: 1100,
			height: 760,
			audio: true,
			// The [jweb~] ring buffer between Chromium's audio thread and MSP. At the
			// object's default (the ~21 ms minimum at 48 kHz) the Studio underran within
			// ~30 s - audible dropouts on a sustained tone. 66 ms asks for the documented
			// maximum (3x the minimum, jweb clamps); the buffer then rides out Chromium's
			// scheduling hiccups and the sound is clean. The cost is ~66 ms of output
			// delay, which Live's look-ahead absorbs for an instrument.
			//
			// Measured on branch feat/strudel-performance against a spike matrix: raising
			// the level-tap interval did nothing, and BOTH `rendermode: 0` (onscreen) and
			// not booting the device-page engine HALTED the audio graph outright. See
			// doc/DRAWER_OF_FAILED_IDEAS.md.
			latency: 66,
			site: "dist/repl-site",
			// This is a window you WORK in while the set plays, so the default -
			// falling behind Live the moment Live is clicked - is wrong for it.
			alwaysOnTop: true,
		}),
	},
});

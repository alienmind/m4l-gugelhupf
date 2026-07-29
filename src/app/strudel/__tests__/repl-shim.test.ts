/**
 * repl-shim.test.ts - what the shim does to a page it does not own.
 *
 * The shim is the only code of ours inside the local strudel.cc, it runs in a
 * window nobody may ever look at, and everything it does is a side effect on two
 * globals it did not create. That combination is exactly what goes wrong silently
 * in Live: a mis-sent selector, a restore that fires before the REPL has finished
 * booting, a knob that never arrives - none of them raise anything, they just
 * leave the device quiet or the pattern lost.
 *
 * So the page is faked here and the shim is run against it: the file is loaded as
 * source and evaluated with `window`, `document` and `localStorage` stubbed, which
 * is what a browser would hand it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHIM = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "repl-shim", "m4l-shim.js");
const source = readFileSync(SHIM, "utf8");

/** The REPL's placeholder buffer, before its own load has settled. */
const LOADING = "// LOADING";

type Handler = (...args: unknown[]) => void;

function makePage() {
	const outlets: unknown[][] = [];
	const inlets: Record<string, Handler> = {};
	const store: Record<string, string> = {};
	const dispatched: string[] = [];

	const posted: unknown[] = [];
	const editor = {
		widgets: [] as Record<string, unknown>[],
		code: LOADING,
		setCode: vi.fn((c: string) => {
			editor.code = c;
		}),
		evaluate: vi.fn(),
		stop: vi.fn(),
	};

	const max = {
		outlet: (...args: unknown[]) => outlets.push(args),
		bindInlet: (selector: string, fn: Handler) => {
			inlets[selector] = fn;
		},
	};

	const g = globalThis as Record<string, unknown>;
	g.window = { max: undefined, strudelMirror: undefined };
	g.document = {
		dispatchEvent: (e: { type: string }) => dispatched.push(e.type),
		getElementById: () => null,
	};
	g.localStorage = {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
	};
	g.MouseEvent = class {
		type: string;
		constructor(type: string) {
			this.type = type;
		}
	};

	(g.window as Record<string, unknown>).postMessage = (m: unknown) => posted.push(m);
	return { outlets, inlets, store, dispatched, posted, editor, max, win: g.window as Record<string, unknown> };
}

/** Everything the shim sent, by selector. */
const sent = (outlets: unknown[][], selector: string) => outlets.filter((o) => o[0] === selector);

describe("m4l-shim", () => {
	let page: ReturnType<typeof makePage>;

	beforeEach(() => {
		vi.useFakeTimers();
		page = makePage();
		// The page loads the shim BEFORE the REPL has mounted - that is the real
		// order, and the reason the shim waits rather than reading the editor now.
		new Function(source)();
	});

	afterEach(() => {
		vi.useRealTimers();
		for (const k of ["window", "document", "localStorage", "MouseEvent"]) delete (globalThis as Record<string, unknown>)[k];
	});

	/** Set the buffer, and mark the restore as settled so the poll gets past it. */
	const editor = {
		get code() {
			return page.editor.code;
		},
		codeIs(text: string) {
			page.editor.code = text;
			page.inlets.state_code(JSON.stringify(text));
		},
	};

	/** Hand the shim the two globals it waits for, and let its poll notice. */
	function mount() {
		page.win.max = page.max;
		page.win.strudelMirror = page.editor;
		vi.advanceTimersByTime(200);
	}

	it("pins the audio output device before the app can read the setting", () => {
		// A leftover device name makes initAudio call setSinkId, which would steer the
		// sound to a sound card and away from the jweb~ outlets that ARE the track.
		expect(page.store["strudel-settingsaudioDeviceName"]).toBe("System Standard");
	});

	it("arms the audio with no click, because a hidden window never gets one", () => {
		mount();
		expect(page.dispatched).toContain("mousedown");
	});

	it("asks for the pattern the Live set is holding", () => {
		mount();
		expect(sent(page.outlets, "get_state")).toEqual([["get_state", "code"]]);
	});

	it("waits for the REPL's own load to settle before restoring the set's pattern", () => {
		mount();
		page.inlets.state_code(JSON.stringify('note("c3")'));

		// The REPL is still showing its placeholder: writing now would be overwritten
		// a moment later by its own initCode(), and the set's pattern would be lost.
		expect(page.editor.setCode).not.toHaveBeenCalled();

		page.editor.code = "// whatever the REPL loaded itself";
		vi.advanceTimersByTime(1000);
		expect(page.editor.setCode).toHaveBeenCalledWith('note("c3")');
	});

	it("persists the buffer to the code slot when it changes, evaluated or not", () => {
		mount();
		page.inlets.state_code(JSON.stringify("old"));
		page.editor.code = "old";
		vi.advanceTimersByTime(1000);

		// Typing that has not been evaluated is still work a musician expects to
		// survive a save, so the poll follows the buffer rather than the evaluate.
		page.editor.code = 'note("e3")';
		vi.advanceTimersByTime(1000);
		expect(sent(page.outlets, "sync_state").pop()).toEqual([
			"sync_state",
			"code",
			JSON.stringify({ __value: 'note("e3")' }),
		]);
	});

	/**
	 * THE SLOT IS ENVELOPED, and this file has to speak that format by hand - nothing
	 * bundles into it. It did not, once, and the failure was silent in the worst way:
	 * the shim read `{"__value": ...}` as "not a string" and ignored every slot it was
	 * sent, so it never marked itself restored and never wrote the pattern back. The
	 * Studio stopped saving with the set and nothing said so.
	 */
	it("reads the enveloped slot Live actually sends", () => {
		mount();
		page.editor.code = "// whatever the REPL loaded itself";
		page.inlets.state_code(JSON.stringify({ __value: 'note("c3")' }));
		vi.advanceTimersByTime(1000);
		expect(page.editor.setCode).toHaveBeenCalledWith('note("c3")');
	});

	it("still reads a set written before the envelope", () => {
		mount();
		page.editor.code = "// whatever the REPL loaded itself";
		page.inlets.state_code(JSON.stringify('note("c3")'));
		vi.advanceTimersByTime(1000);
		expect(page.editor.setCode).toHaveBeenCalledWith('note("c3")');
	});

	it("escapes the spaces in a pattern, which Max would otherwise split on", () => {
		mount();
		page.inlets.state_code(JSON.stringify({ __value: "old" }));
		page.editor.code = "old";
		vi.advanceTimersByTime(1000);

		page.editor.code = 's("bd  sd")'; // two spaces: one atom, or the pattern changes
		vi.advanceTimersByTime(1000);
		const [, , payload] = sent(page.outlets, "sync_state").pop() as string[];
		expect(payload).not.toMatch(/ /);
		expect(payload).toBe('{"__value":"s(\\"bd\\u0020\\u0020sd\\")"}');
	});

	it("does not write the slot again when nothing changed", () => {
		mount();
		page.inlets.state_code(JSON.stringify("same"));
		page.editor.code = "same";
		vi.advanceTimersByTime(5000);
		expect(sent(page.outlets, "sync_state")).toHaveLength(0);
	});

	it("turns the device's Play/Stop into evaluate and stop", () => {
		// The shim WRAPS evaluate (to claim the transport), so the spy to assert on is
		// the one the page had before mounting, not what `editor.evaluate` is now.
		const evaluate = page.editor.evaluate;
		mount();
		page.inlets.set_play(1);
		expect(evaluate).toHaveBeenCalled();
		page.inlets.set_play(0);
		expect(page.editor.stop).toHaveBeenCalled();
	});

	/**
	 * ONE TRACK, TWO ENGINES. The device page has a scratchpad engine of its own and
	 * both sum into the same track, so exactly one may sound. The `engine` slot says
	 * which, and starting is what claims it.
	 */
	it("claims the transport when the user evaluates here", () => {
		mount();
		page.editor.evaluate(); // the REPL's own play button, or Ctrl+Enter
		expect(sent(page.outlets, "sync_state")).toContainEqual([
			"sync_state",
			"engine",
			JSON.stringify({ __value: "studio" }),
		]);
	});

	it("does not claim it when the evaluation is Live's transport arriving", () => {
		// set_play is forwarded FROM the device page, which already knows who owns the
		// transport. Claiming here would make the Studio steal it every time Live played.
		mount();
		page.inlets.set_play(1);
		expect(sent(page.outlets, "sync_state").filter((m) => m[1] === "engine")).toEqual([]);
	});

	it("exposes the native dials as a SIGNAL, so a moving knob moves the sound", () => {
		// The failure this pins, seen in Live: m4lKnob() returned a plain number, the
		// pattern read it once at evaluation and froze it, and the dial did nothing
		// until you evaluated again. A signal is queried per cycle instead.
		const queried: unknown[] = [];
		(globalThis as Record<string, unknown>).signal = (fn: () => number) => ({ query: () => queried.push(fn()) });
		mount();
		page.inlets.set_s1(0.25);

		const knob = (page.win.m4lKnob as (n: number) => { query: () => void })(1);
		knob.query();
		page.inlets.set_s1(0.9); // the hand moves AFTER the pattern was evaluated
		knob.query();
		expect(queried).toEqual([0.25, 0.9]);

		delete (globalThis as Record<string, unknown>).signal;
	});

	it("falls back to a plain number before the REPL has loaded its modules", () => {
		// `signal` only reaches globalThis when the REPL calls evalScope, which is
		// after this file runs. A number is the honest answer until then.
		mount();
		page.inlets.set_s1(0.75);
		const m4lKnob = page.win.m4lKnob as (n: number) => number;
		expect(m4lKnob(1)).toBe(0.75);
	});

	it("asks for no widening, and still scales exactly once if it ever happens", () => {
		// The shim does NOT widen a dial any more: a dial whose range was widened at
		// runtime stops following its automation lane and any macro mapped to it
		// (m4l-jweb doc/MAX-FACTS.md). The travel goes to the device view instead, on
		// `slider_range`, and this page keeps the scaling.
		//
		// The `param_range_ok` path below stays tested because the double-scaling it
		// guards against is the reason an earlier attempt at all this was reverted: if
		// anything ever does widen the dial, the value must not be scaled twice.
		const queried: number[] = [];
		(globalThis as Record<string, unknown>).signal = (fn: () => number) => ({ query: () => queried.push(fn()) });
		mount();

		const knob = (page.win.m4lKnob as (n: number, o: unknown) => { query: () => void })(1, { name: "cutoff", range: [200, 2200] });
		expect(sent(page.outlets, "param_range")).toEqual([]);
		expect(sent(page.outlets, "slider_range")).toEqual([["slider_range", "s1", 200, 2200]]);

		page.inlets.set_s1(0.5); // still 0..1: the device has not answered yet
		knob.query();

		page.inlets.param_range_ok("s1"); // Live took it - values now arrive in real units
		page.inlets.set_s1(600);
		knob.query();

		expect(queried).toEqual([1200, 600]);
		delete (globalThis as Record<string, unknown>).signal;
	});

	it("scales the signal itself when the pattern declares a range", () => {
		const queried: number[] = [];
		(globalThis as Record<string, unknown>).signal = (fn: () => number) => ({ query: () => queried.push(fn()) });
		mount();
		page.inlets.set_s1(0.5);

		const knob = (page.win.m4lKnob as (n: number, o: unknown) => { query: () => void })(1, { range: [200, 2200] });
		knob.query();
		expect(queried).toEqual([1200]);

		delete (globalThis as Record<string, unknown>).signal;
	});

	it("carries a dial's name and unit to the device, once per change", () => {
		mount();
		const m4lKnob = page.win.m4lKnob as (n: number, o?: unknown) => unknown;

		m4lKnob(1, { name: "cutoff", unit: "Hz" });
		m4lKnob(1, { name: "cutoff", unit: "Hz" }); // a re-evaluation, same name
		// The unit is NOT in the name - a dial is a few characters wide, and Live has
		// its own attribute for what makes a readout say "600 Hz".
		expect(sent(page.outlets, "param_label")).toEqual([["param_label", "s1", "cutoff"]]);
		expect(sent(page.outlets, "param_unit")).toEqual([["param_unit", "s1", "Hz"]]);

		// A dial with no description says nothing rather than clearing the name.
		m4lKnob(2);
		expect(sent(page.outlets, "param_label")).toHaveLength(1);

		m4lKnob(1, { name: "room" });
		expect(sent(page.outlets, "param_label").pop()).toEqual(["param_label", "s1", "room"]);
	});

	it("names a dial even when the REPL turned the name into a pattern", () => {
		// Seen in Live as `knob_label param-s1 'S1' -> '[object Object]'`: in the REPL
		// a double-quoted string is mini notation, so `{ name: "cutoff" }` reaches the
		// shim as a Pattern, not a string.
		mount();
		const pattern = { queryArc: () => [{ value: "cutoff" }] };
		const m4lKnob = page.win.m4lKnob as (n: number, o?: unknown) => unknown;

		m4lKnob(1, { name: pattern, unit: { queryArc: () => [{ value: "Hz" }] } });
		expect(sent(page.outlets, "param_label")).toEqual([["param_label", "s1", "cutoff"]]);
		expect(sent(page.outlets, "param_unit")).toEqual([["param_unit", "s1", "Hz"]]);
	});

	it("reads an untouched or out-of-range dial as 0, never undefined", () => {
		// A pattern doing arithmetic on it must not get NaN.
		mount();
		const raw = page.win.m4lKnobValue as (n: number) => number;
		expect(raw(8)).toBe(0);
		expect(raw(99)).toBe(0);
	});


	/* ------------------------------------------------------------------ *
	 * The pattern's own slider() calls
	 * ------------------------------------------------------------------ */

	/** A slider as the transpiler leaves it: id is the range of the first argument. */
	const widget = (from: number, to: number, value: number, min: number, max: number) => ({
		type: "slider",
		id: `${from}:${to}`,
		from,
		to,
		value,
		min,
		max,
	});

	it("puts the pattern's sliders on the dials, in source order", () => {
		mount();
		// `slider(500, 100, 1000)` then `slider(0.3, 0, 1)`.
		editor.codeIs('s("saw").lpf(slider(500, 100, 1000)).gain(slider(0.3, 0, 1))');
		page.editor.widgets = [widget(48, 51, 0.3, 0, 1), widget(17, 20, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);

		expect(sent(page.outlets, "slider_range")).toEqual([
			["slider_range", "s1", 100, 1000],
			["slider_range", "s2", 0, 1],
		]);
		// The travel is described, never written onto the Live dial - that costs the
		// dial its automation lane and its macro.
		expect(sent(page.outlets, "param_range")).toEqual([]);
		// No name given, so the WRAPPING METHOD is the name: the user already wrote
		// `lpf`, and making them repeat it in an options object to avoid a dial called
		// "slider 1" is asking twice.
		expect(sent(page.outlets, "param_label").map((o) => o[2])).toEqual(["lpf", "gain"]);
	});

	it("names a bare slider after the method it is an argument to", () => {
		// `sliderWithID`'s id carries the source POSITION, not a name, so there is
		// nothing in the value to show a user. The surrounding method is the term the
		// user already thinks in.
		mount();
		editor.codeIs('s("saw").lpf(slider(500, 100, 1000)).room(slider(0.3))');
		const lpf = (editor.code as string).indexOf("500");
		const room = (editor.code as string).indexOf("0.3");
		page.editor.widgets = [widget(lpf, lpf + 3, 500, 100, 1000), widget(room, room + 3, 0.3, 0, 1)];
		vi.advanceTimersByTime(1000);

		expect(sent(page.outlets, "param_label").map((o) => o[2])).toEqual(["lpf", "room"]);
	});

	it("an explicit name beats the method, and a slider with no method still gets one", () => {
		mount();
		// `.lpf(...)` is right there, and is deliberately NOT what the dial is called:
		// the user asked for "cutoff".
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000, 1, { name: 'cutoff' }))");
		const named = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(named, named + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);
		expect(sent(page.outlets, "param_label").pop()).toEqual(["param_label", "s1", "cutoff"]);

		// A slider that is an argument to nothing has no name to borrow, and an
		// unlabelled fader is worse than a numbered one.
		editor.codeIs("const x = slider(0.5)");
		const bare = (editor.code as string).indexOf("0.5");
		page.editor.widgets = [widget(bare, bare + 3, 0.5, 0, 1)];
		vi.advanceTimersByTime(1000);
		expect(sent(page.outlets, "param_label").pop()).toEqual(["param_label", "s1", "slider 1"]);
	});

	it("reads a name and a unit out of the code, since the transpiler drops them", () => {
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' }))");
		// The id's `to` is the end offset of the FIRST argument - that is what ties
		// the parsed options back to the widget.
		const code = editor.code as string;
		const from = code.indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);

		expect(sent(page.outlets, "param_label").pop()).toEqual(["param_label", "s1", "cutoff"]);
		expect(sent(page.outlets, "param_unit").pop()).toEqual(["param_unit", "s1", "Hz"]);
		// The library's param_unit reaches LIVE and is echoed to no page, so the
		// device view is told separately - it draws "600 Hz" under its own fader.
		expect(sent(page.outlets, "slider_unit").pop()).toEqual(["slider_unit", "s1", "Hz"]);
	});

	it("asks the device to seed the dial from the value the code declares", () => {
		// Otherwise a dial keeps whatever the last pattern left on it, and the first
		// touch jumps the sound.
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000))");
		const from = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);
		expect(sent(page.outlets, "slider_seed").pop()).toEqual(["slider_seed", "s1", 500]);
	});

	it("a dial moves the slider through the channel the inline widget uses", () => {
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000))");
		const from = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);

		// A DIAL VALUE IS A POSITION. The dials travel 0..1 (widening one costs it its
		// automation lane), so the slider's own 100..1000 is applied here.
		page.inlets.set_s1(0.5);
		// `cm-slider` sets sliderValues[id], which the pattern's ref() reads on its
		// next query - so the sound changes without re-evaluating.
		expect(page.posted.pop()).toEqual({ type: "cm-slider", id: `${from}:${from + 3}`, value: 550 });
	});

	it("a dial at the bottom of its travel reaches the slider's MIN, not zero", () => {
		// The bug this pins: the position was passed through unscaled, so an lpf whose
		// code says 100..1000 received 0.02 - i.e. 0.02 Hz. The sound cut out in one
		// step and NO dial position brought it back, because the entire 0..1 travel
		// was inaudible. Silent, binary, and not visible anywhere as an error.
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000))");
		const from = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);

		page.inlets.set_s1(0);
		expect(page.posted.pop()).toMatchObject({ value: 100 });
		page.inlets.set_s1(1);
		expect(page.posted.pop()).toMatchObject({ value: 1000 });
	});

	it("a dial Live DID widen is passed through, not scaled twice", () => {
		// Nothing here asks for widening any more, but the wrapper still answers if
		// something ever does, and the value would already be in real units.
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000))");
		const from = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(1000);

		page.inlets.param_range_ok("s1");
		page.inlets.set_s1(750);
		expect(page.posted.pop()).toMatchObject({ value: 750 });
	});

	it("does not re-describe the dials while the pattern's controls are unchanged", () => {
		// describeParam writes Live parameter attributes; a pattern is re-evaluated
		// constantly while it is being worked on.
		mount();
		editor.codeIs("s(\"saw\").lpf(slider(500, 100, 1000))");
		const from = (editor.code as string).indexOf("500");
		page.editor.widgets = [widget(from, from + 3, 500, 100, 1000)];
		vi.advanceTimersByTime(3000);
		expect(sent(page.outlets, "slider_range")).toHaveLength(1);
		expect(sent(page.outlets, "param_label")).toHaveLength(1);
	});

	it("ignores a half-typed slider call rather than throwing", () => {
		mount();
		editor.codeIs('s("saw").lpf(slider(500, 100');
		page.editor.widgets = [];
		expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
	});

	it("says it is ready, so the wrapper's log shows the page came up", () => {
		mount();
		expect(sent(page.outlets, "shim_ready")).toEqual([["shim_ready", 1]]);
	});
});

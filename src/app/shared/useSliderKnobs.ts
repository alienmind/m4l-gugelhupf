import { useEffect, useMemo } from "react";
import { useControls } from "@m4l-jweb/surface/react";
import { KNOB_IDS, KNOB_POOL } from "./surface";
import type { SliderSpec } from "./useStrudelEngine";

/**
 * Bind the `slider()` calls in a pattern to the device's native knob POOL (S1..S8).
 *
 * strudel.cc renders `slider(500, 100, 1000)` as a codemirror widget you drag. There is
 * no codemirror here, and a widget would be the wrong answer anyway: a value a musician
 * wants to move during a take has to be a REAL Live parameter, so it automates, MIDI-maps
 * and reaches Push. So each slider the code declares is bound, in source order, to one
 * of eight native dials.
 *
 * The pool is STATIC - eight dials exist in the patcher whether the code uses them or
 * not - because a frozen device cannot grow a parameter at runtime. Source order is the
 * mapping: the first `slider()` in the text is S1, the second is S2. Nothing to
 * configure, and re-editing the line keeps the same knob on the same slider.
 *
 * BORROWING A POOL IS THE LIBRARY'S PROBLEM, not this device's. `useControls()` owns the
 * whole handshake - which dial carries which control, telling Live its name and range,
 * whether Live took that range (if it did, the dial reports REAL units and normalizing
 * again would scale twice and stick the knob at its minimum), and seeding a dial from
 * the control's own default. What is left here is the two things that are actually about
 * Strudel: reading a name out of the source text, and pushing the values back into the
 * pattern.
 */

export { KNOB_POOL };

export interface SliderKnob {
	/** What to call it in the UI - the code's own term where we can infer one. */
	label: string;
	min: number;
	max: number;
	/** How Live prints it ("Hz", "dB"), when the pattern said. Drawn next to the value. */
	unit?: string;
	/** Position 0..1, which is what the native dial holds. */
	norm: number;
	/** The value the pattern actually sees. */
	raw: number;
	/** Move it: takes a normalized 0..1 position. */
	set: (norm: number) => void;
	/** Which native dial this one is on (1-based), for the tooltip. */
	knob: number;
}

/**
 * `sliderWithID`'s id carries the source position, not a name, so there is nothing in it
 * to show a user. Where the code reads `.lpf(slider(...))` the surrounding method IS the
 * name the user thinks in, so the device passes the source text and we look backwards
 * from each occurrence for the method that wraps it.
 */
export function sliderLabels(code: string, count: number): string[] {
	const labels: string[] = [];
	const re = /\.([a-zA-Z_$][\w$]*)\s*\(\s*[^)]*?slider/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null && labels.length < count) labels.push(m[1]);
	while (labels.length < count) labels.push(`slider ${labels.length + 1}`);
	return labels;
}

export function useSliderKnobs(
	surface: unknown,
	specs: SliderSpec[],
	code: string,
	setSliderValues: (values: (number | null)[]) => void,
	/**
	 * Whether this page is the one that NAMES the dials.
	 *
	 * The Strudel device has two PAGES against one pool - the device view and the Studio
	 * window - and both used to describe it, so a dial the Studio had named `lpf` was
	 * renamed `slider 1` (or reset to `S1`) by whichever page re-rendered last. The
	 * Studio runs the pattern, so the Studio owns the names; the device view claims them
	 * only when the Studio has declared nothing. Devices with a single page leave this
	 * alone.
	 */
	describe = true,
): SliderKnob[] {
	const labels = useMemo(() => sliderLabels(code, specs.length), [code, specs.length]);

	// What each dial is being asked to carry. `value` is the code's own default, which
	// the library writes onto the dial the first time a given control takes the slot -
	// so an untouched knob reads what the text says rather than 0.
	const controls = useMemo(
		() =>
			specs.slice(0, KNOB_POOL).map((spec, i) => ({
				name: labels[i],
				min: spec.min,
				max: spec.max,
				value: spec.value,
			})),
		[specs, labels],
	);

	// `widenRange` is left off (the library's default): asking Live to widen a dial's
	// travel at runtime costs that dial its automation lane and any macro mapped to it,
	// so the dials stay 0..1 and the scaling happens here.
	const pooled = useControls(surface as never, controls, KNOB_IDS as never, { describe });

	// Push the current knob positions back into the pattern. Runs whenever a dial moves -
	// from the web slider, an automation lane, a Push encoder or a macro, since all four
	// write the same parameter. Keyed on the VALUES rather than the array, which
	// useControls rebuilds every render by design.
	const signature = pooled.map((c) => c.raw).join(",");
	useEffect(() => {
		if (!pooled.length) return;
		setSliderValues(pooled.map((c) => c.raw));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [signature, pooled.length]);

	return pooled.map((c) => ({
		label: c.name,
		min: c.min,
		max: c.max,
		unit: c.unit,
		norm: c.norm,
		raw: c.raw,
		set: c.set,
		knob: c.slot,
	}));
}

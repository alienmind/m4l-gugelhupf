import { useEffect, useMemo, useRef, useState } from "react";
import { bindInlet } from "@m4l-jweb/bridge";
import { useParam } from "@m4l-jweb/surface/react";
import { KNOB_IDS } from "../shared/surface";
import type { SliderKnob } from "../shared/useSliderKnobs";
import surface from "./surface";

/** `s3` -> 2. The library talks in parameter ids; the dials are a numbered pool. */
const knobIndexOf = (id: unknown) => KNOB_IDS.indexOf(String(id) as (typeof KNOB_IDS)[number]);

/** What a pattern said about one dial: `m4lKnob(1, { name, unit, range })`. */
interface KnobDesc {
	label: string;
	min: number;
	max: number;
	/** What Live prints it in, when the pattern said - "Hz", "dB". */
	unit?: string;
	/** Whether Live took the range onto the dial itself - see wrapper/device.ts. */
	real: boolean;
}

/**
 * The dials the STUDIO's pattern declared, as faders this view can draw.
 *
 * The Studio owns the engine, so it is the Studio's pattern that knows a dial is a
 * cutoff in Hz. That description reaches Live through the wrapper (knob_label /
 * knob_range) and is echoed here, because a device view with its Studio window shut
 * still has to be playable - and a row of eight anonymous 0..1 faders is not.
 *
 * The VALUES are not echoed: they are the Live parameters themselves, read with
 * useParam like any other control, so dragging a fader here writes exactly what a
 * Push encoder or an automation lane writes. One control, several views of it.
 */
export function useReplKnobs(): { faders: SliderKnob[]; declared: boolean } {
	const [descs, setDescs] = useState<Record<number, KnobDesc>>({});
	/** Slider seeds waiting to be written, and what has already been written. */
	const seeded = useRef<string[]>([]);
	const pending = useRef<{ index: number; value: number }[]>([]);
	const [seedTickValue, setSeedTick] = useState(0);

	/* eslint-disable react-hooks/rules-of-hooks */
	const params = KNOB_IDS.map((id) => useParam(surface, id));
	/* eslint-enable react-hooks/rules-of-hooks */

	useEffect(() => {
		// The wrapper echoes what a page told Live about a parameter, keyed by the
		// parameter's own id - `s3`, not an index into a pool.
		bindInlet("param_desc", (id: unknown, ...rest: unknown[]) => {
			const i = knobIndexOf(id);
			const label = rest.join(" ");
			if (!(i >= 0 && i < 8) || !label) return;
			setDescs((prev) => ({ ...prev, [i]: { ...(prev[i] ?? { min: 0, max: 1, real: false }), label } }));
		});
		// The library's `param_unit` reaches LIVE and is not echoed to any page, so the
		// Studio sends this one for our own fader to draw.
		bindInlet("slider_unit", (id: unknown, unit: unknown) => {
			const i = knobIndexOf(id);
			if (i < 0 || !String(unit)) return;
			setDescs((prev) => ({ ...prev, [i]: { ...(prev[i] ?? { label: `S${i + 1}`, min: 0, max: 1, real: false }), unit: String(unit) } }));
		});
		// The pattern dropped this slider: forget the fader, or one that drives nothing
		// stays on screen.
		bindInlet("slider_clear", (id: unknown) => {
			const i = knobIndexOf(id);
			if (i < 0) return;
			seeded.current[i] = "";
			setDescs((prev) => {
				if (!prev[i]) return prev;
				const next = { ...prev };
				delete next[i];
				return next;
			});
		});
		bindInlet("param_desc_range", (id: unknown, lo: unknown, hi: unknown, took: unknown) => {
			const i = knobIndexOf(id);
			if (!(i >= 0 && i < 8)) return;
			setDescs((prev) => ({
				...prev,
				[i]: { ...(prev[i] ?? { label: `S${i + 1}` }), min: Number(lo), max: Number(hi), real: Number(took) === 1 },
			}));
		});

		// The pattern says where its slider STARTS; the dial should land there rather
		// than keep whatever the last pattern left on it. Seeded once per slider, so
		// re-evaluating does not yank a dial out from under a hand that moved it.
		bindInlet("slider_seed", (id: unknown, value: unknown) => {
			const i = knobIndexOf(id);
			if (i < 0) return;
			const key = `${String(id)}:${Number(value)}`;
			if (seeded.current[i] === key) return;
			seeded.current[i] = key;
			pending.current.push({ index: i, value: Number(value) });
			setSeedTick((n) => n + 1);
		});
	}, []);

	const faders = useMemo(() => {
		const out: SliderKnob[] = [];
		for (let i = 0; i < KNOB_IDS.length; i++) {
			const desc = descs[i];
			if (!desc) continue;
			const [value, setValue] = params[i];
			const v = typeof value === "number" ? value : 0;
			const span = desc.max - desc.min;
			// When Live took the range onto the dial, the parameter already IS the real
			// value and the fader only has to place it; otherwise the dial is 0..1 and
			// the real value is derived. Exactly the split the shim makes.
			const norm = desc.real ? (span ? (v - desc.min) / span : 0) : v;
			const raw = desc.real ? v : desc.min + v * span;
			out.push({
				label: desc.label,
				min: desc.min,
				max: desc.max,
				unit: desc.unit,
				norm,
				raw,
				set: (n: number) => setValue(desc.real ? desc.min + n * span : n),
				knob: i + 1,
			});
		}
		return out;
		// `params` is rebuilt every render by design (eight useParam hooks), so it
		// cannot be a dependency without spinning; the values it carries are.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [descs, ...params.map(([v]) => v)]);

	// Written in an effect, not in the inlet handler: the handler runs outside React
	// and the parameter setters below are rebuilt every render.
	useEffect(() => {
		if (!pending.current.length) return;
		const queue = pending.current.splice(0);
		for (const { index, value } of queue) {
			const desc = descs[index];
			const span = desc ? desc.max - desc.min : 1;
			const [, setValue] = params[index];
			setValue(desc?.real ? value : span ? (value - (desc?.min ?? 0)) / span : value);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seedTickValue, descs]);

	return { faders, declared: faders.length > 0 };
}

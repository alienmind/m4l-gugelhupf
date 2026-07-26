import { useCallback, useEffect, useMemo, useState } from "react";
import { bindInlet } from "@m4l-jweb/bridge";
import {
	DEFAULT_SCALE,
	isKnownScale,
	ROOT_NAMES,
	strudelAgrees,
	strudelScaleName,
	type Scale,
} from "@/lib/mini/scales";
import { isBareMini } from "@/lib/strudelCode";
import { miniNoteTokens } from "@/lib/mini/resolve";
import type { Surface } from "@m4l-jweb/surface";
import { useStrudelEngine, type EngineState } from "../shared/useStrudelEngine";
import { INITIAL_TEXT } from "./surface";
import { IN } from "../shared/protocol";
import { transportParams } from "../shared/surface";
import surface from "./surface";

/**
 * The MIDI device: a pure note generator. What it adds to the shared engine (see
 * shared/useStrudelEngine.ts) is one idea - LIVE'S SCALE - and everything here is
 * about that: reading it off the wrapper, deciding whether it applies, and warning
 * when the user is about to get the other implementation of it than they think.
 *
 * Drum words belong to the drums device, and are not known here.
 */
export interface StrudelState extends EngineState {
	/** Live 12's global scale, as reported by the wrapper. */
	scale: Scale;
	/** Apply it? When on, bare numbers are degrees of Live's scale. When off, they
	 *  are raw MIDI pitches and the pattern may set its own scale in code. */
	liveScale: boolean;
	setLiveScale: (on: boolean) => void;
}

export function useStrudel(): StrudelState {
	const [scale, setScale] = useState<Scale>(DEFAULT_SCALE);
	const [liveScale, setLiveScaleState] = useState<boolean>(() => loadLiveScale());

	useEffect(() => {
		// Live 12's global scale: `scale <root 0-11> <name...>`. The name arrives as
		// separate words ("Harmonic", "Minor"), because Max messages are space-
		// separated - rejoin them before looking the scale up.
		bindInlet(IN.scale, (root, ...name) => {
			const nm = name.join(" ").trim();
			setScale({
				root: Math.max(0, Math.min(11, Math.round(Number(root) || 0))),
				name: nm || DEFAULT_SCALE.name,
			});
		});
	}, []);

	/** `scale` is omitted entirely when the toggle is off: no scale, no degrees. */
	const ctx = useMemo(() => ({ scale: liveScale ? scale : undefined }), [scale, liveScale]);
	/** Live's scale in Strudel's own spelling, published to the pattern scope as
	 *  `liveScale` whether or not the toggle is on - code may want it either way. */
	const liveScaleName = useMemo(() => strudelScaleName(scale), [scale]);

	const engine = useStrudelEngine({
		// This device's surface declares MORE than the transport (a `transport` view-switch
		// for the native Play/Stop panel). The engine only reads `play`; `Surface` is
		// invariant in its param map, so pass it through as the narrower transport view.
		surface: surface as unknown as Surface<typeof transportParams>,
		initialText: INITIAL_TEXT,
		ctx,
		liveScale: liveScaleName,
	});

	const warning = engine.warning ?? scaleWarning(engine.text, { scale, liveScale });

	const setLiveScale = useCallback((on: boolean) => {
		setLiveScaleState(on);
		saveLiveScale(on);
	}, []);

	return { ...engine, scale, liveScale, setLiveScale, warning };
}

/** The scale, as the header shows it: "C Major", or a warning when Live named a
 *  scale whose intervals we do not know (degrees then fall back to Major). */
export function scaleLabel(scale: Scale): { text: string; known: boolean } {
	return {
		text: `${ROOT_NAMES[scale.root] ?? "C"} ${scale.name}`,
		known: isKnownScale(scale.name),
	};
}

/**
 * The amber line along the bottom: where the two scale implementations can bite.
 *
 * There are two of them, and the toggle picks which one is in force. Ours resolves
 * degrees before Strudel ever sees them, so it always matches what To Clip writes.
 * Strudel's own `.scale()` is reachable from code via the `liveScale` global, and
 * it does not always agree - see strudelAgrees(). Neither is wrong; the user just
 * has to know which one they are getting.
 */
export function scaleWarning(text: string, opts: { scale: Scale; liveScale: boolean }): string | null {
	const bare = isBareMini(text);
	const usesStrudelScale = !bare && /\.scale\s*\(/.test(text);

	if (usesStrudelScale && !strudelAgrees(opts.scale.name)) {
		return `This pattern calls Strudel's own .scale(), which disagrees with Ableton on "${opts.scale.name}" - and mis-reads any scale name containing a space.`;
	}
	if (opts.liveScale && !bare) {
		return "Live Scale applies to bare mini-notation only. In code, write .scale(liveScale) to opt into Strudel's own version of it.";
	}
	if (!opts.liveScale && bare && hasBareNumber(text)) {
		return "Live Scale is off: a bare number is a raw MIDI pitch, so 2 is a D-2. Turn it on to read numbers as scale degrees.";
	}
	return null;
}

function hasBareNumber(text: string): boolean {
	return miniNoteTokens(text).some((t) => /^-?\d+$/.test(t));
}

const LIVE_SCALE_KEY = "m4l-gugelhupf.liveScale";

function loadLiveScale(): boolean {
	try {
		// Default ON: reading a bare number as a scale degree is what a Live user
		// expects, and what the bug report asked for.
		return localStorage.getItem(LIVE_SCALE_KEY) !== "0";
	} catch {
		return true;
	}
}

function saveLiveScale(on: boolean): void {
	try {
		localStorage.setItem(LIVE_SCALE_KEY, on ? "1" : "0");
	} catch {
		// Storage disabled: the toggle still works, it just will not be remembered.
	}
}

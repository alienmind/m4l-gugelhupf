import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bindInlet, flushNotes, inJweb, outlet, sendNote, uiReady } from "@m4l-jweb/bridge";
import { useParam, useStateSync } from "@m4l-jweb/surface/react";
import type { Surface } from "@m4l-jweb/surface";
import { renderPattern, toFlatList, type NoteEvent } from "@/lib/mini/render";
import { eventsToMini, type RawNote } from "@/lib/mini/unparse";
import type { NoteContext, OctaveConvention } from "@/lib/mini/notes";
import { isBareMini } from "@/lib/strudelCode";
import { detectCps, suggestBeatsPerCycle } from "@/lib/tempo";
import { activeSpans, parseForPlayhead, type Span } from "@/lib/mini/playhead";
import type { transportParams } from "./surface";
import EngineWorker from "./engine.worker.js?worker&inline";
import { IN, OUT } from "./protocol";

/**
 * useStrudelEngine - everything the MIDI devices do that has nothing to do with
 * what a note MEANS.
 *
 * The engine worker's lifecycle, the transport ticks, the note stream out to the
 * `midiout` chain, the playhead, To Clip / From Clip, the eval-on-context-change
 * rule, the Play parameter, the health readout. None of it differs between the
 * MIDI device and the drums device, and it was duplicated between them - 352 of
 * the drums hook's 383 lines were a byte-identical copy, so every fix to the
 * engine had to be made twice and any missed one would drift in silence.
 *
 * WHAT THE DEVICES DIFFER ON is only how a token becomes a pitch, and that is
 * exactly the NoteContext: the MIDI device contributes Live's scale (bare numbers
 * are degrees), the drums device contributes the drum map (bare words are Drum
 * Rack pads). Neither the engine nor the exporter ever learns which is which -
 * tokens are resolved to absolute MIDI before compile (ARCHITECTURE §3a), which
 * is the same reason Live Play and To Clip cannot disagree.
 */

interface EngineNote {
	pitch: number;
	velocity: number;
	durMs: number;
	chan: number;
	delayMs: number;
}

/**
 * One scheduled SAMPLE VOICE, the Sampler's counterpart to EngineNote. The engine
 * emits these instead of notes when a `voiceSink` is supplied: `s` names the pad,
 * `n` picks a variation, `rate` repitches (1 for a drum pad), `velocity` is the gain.
 */
export interface VoiceEvent {
	s: string;
	/** The strudel `bank()` prefix from the pattern, or null - the Sampler falls back to
	 *  its selected bank and resolves `<bank>_<s>` to a drum-machine sample. */
	bank: string | null;
	n: number;
	velocity: number;
	rate: number;
	durMs: number;
	delayMs: number;
}

/** A clip note, in cycles - the exporter's units (see engine.mjs). */
interface ClipNote {
	pitch: number;
	velocity: number;
	start: number;
	duration: number;
}

type EngineMessage =
	| { t: "ready" }
	| { t: "evalok" }
	| { t: "evalerr"; message: string }
	| { t: "notes"; notes: EngineNote[] }
	| { t: "voices"; voices: VoiceEvent[] }
	| {
			t: "doughEvents";
			doughEvents: {
				value: Record<string, any>;
				durMs: number;
				delayMs: number;
				cps: number;
				cycle: number;
			}[];
	  }
	| { t: "sliders"; specs: SliderSpec[] }
	| { t: "clip"; notes: ClipNote[]; cycles: number }
	| { t: "exporterr"; message: string }
	| { t: "phase"; cycle: number }
	| { t: "flush" }
	| { t: "clock"; free: boolean };

/** The clip's meter, when the user has not picked one. */
const DEFAULT_BEATS_PER_BAR = 4;

export interface EngineOptions {
	/**
	 * The DEVICE's surface - the one its own surface.ts declares, not a shared one.
	 *
	 * It is passed in rather than imported here because the two devices' surfaces are
	 * no longer the same object (the drums device declares a drumMap state slot), and
	 * a bundle holding two Surfaces that both declare `play` would have them fight
	 * over one bridge selector. See shared/surface.ts.
	 *
	 * Typed to the transport params alone - the one thing this engine reads is `play`. A
	 * device that declares MORE parameters (the midi device adds a `transport` view-switch)
	 * passes its surface through here as this narrower view; `Surface` is invariant in its
	 * parameter map, so that widening is a cast at the call site, not a silent coercion.
	 */
	surface: Surface<typeof transportParams>;
	/** The pattern the device opens with - its own idiom, not a shared one. */
	initialText: string;
	/**
	 * Which state slot holds this engine's text. Defaults to `code`.
	 *
	 * The Strudel device has TWO texts now: the Studio's pattern, which is the music
	 * and lives in `code`, and the device view's scratchpad, which is where a scope
	 * or a control snippet goes. They must not share a slot - one would overwrite the
	 * other on every keystroke - so the device view names its own.
	 */
	slot?: "code" | "miniCode";
	/**
	 * Whether this engine is the one Live's transport drives. Default true - only the
	 * Strudel device has a second engine to lose the transport to (app/strudel/transport.ts).
	 *
	 * False does NOT mean the `play` parameter stops working: the parameter is Live's,
	 * shared, and automation must keep writing it. It means this engine stands down -
	 * it goes quiet and stays quiet - while the other one sounds. Standing down never
	 * clears `play`, because that would stop the engine that legitimately owns it.
	 */
	transport?: boolean;
	/**
	 * What this device adds to the NoteContext: `scale`, or `drumMap`. MUST be
	 * memoized by the caller - it keys the recompile below, so a fresh object every
	 * render would re-evaluate the pattern on every render.
	 */
	ctx: Omit<NoteContext, "conv" | "octaveOffset">;
	/**
	 * Live's scale in Strudel's own spelling ("C4:major"), published into the
	 * pattern scope so code can call `.scale(liveScale)` on purpose. The drums
	 * device has no scale and passes nothing.
	 */
	liveScale?: string;
	/** The device's own amber line. The MAX_CYCLES warning below outranks it. */
	warning?: string | null;
	/**
	 * THE SAMPLER SINK. When set, the engine routes each scheduled hap to this callback
	 * (which plays the named sample in the page) INSTEAD of out to the midiout chain via
	 * sendNote - the code-driven Sampler. Its presence flips the worker's `sink` to "voice",
	 * so a hap that names a sample (`s("bd")`) survives instead of being dropped for having
	 * no pitch. Absent for the MIDI devices, which stay note-shaped.
	 */
	voiceSink?: (voice: VoiceEvent) => void;
	/**
	 * THE SUPERDOUGH SINK. When set, the engine routes each scheduled hap to this callback
	 * (with all raw Strudel properties) for Jweb to play natively via the Web Audio API.
	 */
	superdoughSink?: (event: {
		value: Record<string, any>;
		durMs: number;
		delayMs: number;
		cps: number;
		cycle: number;
	}) => void;
}

/** One `slider()` occurrence in the code: its default and range, in source order.
 *  The id is the transpiler's widget id; only ORDER matters to a device. */
export interface SliderSpec {
	id: string;
	value: number;
	min: number;
	max: number;
}

export interface EngineState {
	text: string;
	setText: (t: string) => void;
	/** How many of Live's beats one Strudel cycle occupies in an exported clip.
	 *  Auto-derived from the pattern's setcpm/setcps and Live's tempo, but editable. */
	beatsPerCycle: number;
	setBeatsPerCycle: (n: number) => void;
	/** Whether beatsPerCycle is still tracking the detected tempo (true) or the user
	 *  has typed an override (false). */
	bpcAuto: boolean;
	/** Drop an override and snap beatsPerCycle back to the detected-tempo suggestion. */
	resetBeatsPerCycle: () => void;
	/** The clip's meter (4 = 4/4). Bar-counting and From-Clip reading only - it does
	 *  not enter the cycle-to-beat scaling, which beatsPerCycle owns. */
	beatsPerBar: number;
	setBeatsPerBar: (n: number) => void;
	grid: number;
	setGrid: (n: number) => void;
	conv: OctaveConvention;
	setConv: (c: OctaveConvention) => void;
	octaveOffset: number;
	setOctaveOffset: (n: number) => void;
	noteCount: number;
	errors: { pos: number; msg: string }[];
	status: string;
	/** Whether the device's track has a clip that From Clip could read. */
	clipAvailable: boolean;
	/** Whether clip I/O is possible at all here - false once the wrapper reports it cannot
	 *  reach a track (`no_track`). Disables both clip buttons rather than failing silently. */
	clipSupported: boolean;
	toMidi: () => void;
	fromMidi: () => void;
	/** An amber note - the device's own, or the MAX_CYCLES cap, or null. */
	warning: string | null;
	/** Source ranges of the step(s) sounding right now, for the editor highlight.
	 *  Empty for full Strudel code, which has no link back to the typed text. */
	playing: Span[];
	/** Real Strudel engine, running live in a Web Worker. */
	live: boolean;
	/** Whether Live's transport drives this engine at all - false while the other one
	 *  owns it, when `live` is false for a reason that is not "stopped". */
	transport: boolean;
	evalError: string | null;
	run: () => void;
	hush: () => void;
	/** One-line health readout: engine state, ticks received, notes sent. */
	debug: string;
	/** BUILD_STAMP of the .amxd wrapper driving this page ("?" until reported).
	 *  Differing from __APP_VERSION__ means a mixed/stale install. */
	amxdBuild: string;
	/** The resolved NoteContext, for a device that needs to read it back. */
	noteCtx: NoteContext;
	/** Live's transport tempo in BPM (120 until the first tempo message). Read by the
	 *  audio-export path to render a bounce at the right cps. */
	tempo: number;
	/** Every `slider()` the last compile declared, in source order. Empty for code that
	 *  uses none. A device maps these onto its native knobs. */
	sliderSpecs: SliderSpec[];
	/** Substitute values for those sliders, by source order (`null` = keep the code's
	 *  own). Recompiles the current pattern with them. */
	setSliderValues: (values: (number | null)[]) => void;
}

export function useStrudelEngine(opts: EngineOptions): EngineState {
	const { ctx, liveScale, initialText, surface } = opts;
	// The Sampler passes a voiceSink; the MIDI devices do not. Presence alone selects the
	// worker's sink mode. The ref keeps the (bound-once) worker handler reading the current
	// callback rather than the one it closed over at mount.
	const sink = opts.voiceSink ? "voice" : opts.superdoughSink ? "superdough" : "note";
	/** Does Live's transport drive THIS engine? See the option's own note. */
	const transport = opts.transport ?? true;
	const voiceSinkRef = useRef(opts.voiceSink);
	voiceSinkRef.current = opts.voiceSink;
	const superdoughSinkRef = useRef(opts.superdoughSink);
	superdoughSinkRef.current = opts.superdoughSink;
	/** What the last compile declared. The device turns these into knobs. */
	const [sliderSpecs, setSliderSpecs] = useState<SliderSpec[]>([]);
	const setSliderValues = useCallback((values: (number | null)[]) => {
		workerRef.current?.postMessage({ t: "sliders", values });
	}, []);
	const [playParam, setPlayParam] = useParam(surface, "play");
	/**
	 * THE PATTERN, from the `code` state slot - not component state.
	 *
	 * Two things follow, and both are the reason for it: the pattern now SURVIVES THE
	 * SET (it used to be `useState`, so reopening a set silently restored the built-in
	 * default over whatever the user wrote), and the Studio window edits the same slot,
	 * so the two views are two faces of one pattern rather than two editors racing.
	 *
	 * It needed an upstream fix to work at all: a Max [dict] is a key/value map and
	 * cannot hold a bare string, so a `state<string>` used to round-trip to `{}` no
	 * matter what was written. Every value now travels in an envelope - see the state
	 * store in @m4l-jweb/surface. The `typeof` guard stays because a slot can still
	 * legitimately have nothing in it: a fresh instance Live has never saved.
	 */
	const [savedText, setSavedText] = useStateSync(surface, opts.slot ?? "code");
	/**
	 * AN EMPTY BOX IS A VALUE, NOT A MISSING ONE - and this line used to disagree.
	 *
	 * It read `savedText.length ? savedText : initialText`, so the instant the editor
	 * was empty - select-all and cut, or deleting the last character on the way to
	 * rewriting a line - the pattern "had no value" and the device helpfully restored
	 * its default over the top. You could not cut and paste, and you could not clear the
	 * box to start again: it healed back to `<c1 c1 ...>` under your hands.
	 *
	 * A pattern editor must let you type something broken, or empty, and LEAVE IT THERE
	 * for you to fix. Nothing here gets to decide the user meant something else.
	 *
	 * There is no length check to replace it with, either: the slot's default IS
	 * `initialText` (see the device's surface.ts), so a fresh instance already arrives
	 * holding the opening pattern. The `typeof` guard is only for a slot that is not a
	 * string at all - which now means a genuine failure, not an empty editor.
	 */
	const text = typeof savedText === "string" ? savedText : initialText;
	const setText = setSavedText;
	const [beatsPerBar, setBeatsPerBar] = useState(DEFAULT_BEATS_PER_BAR);
	const [grid, setGrid] = useState(16);
	const [conv, setConv] = useState<OctaveConvention>("strudel");
	const [octaveOffset, setOctaveOffset] = useState(0);
	const [status, setStatus] = useState("Ready");
	// Outside Max (browser dev) there is no wrapper to report availability, so
	// default to enabled there and let the wrapper drive it inside Live.
	const [clipAvailable, setClipAvailable] = useState(!inJweb);
	// Whether clip I/O is even POSSIBLE here. It is, until the wrapper reports `no_track`
	// (a read or write from somewhere no track can be resolved) - then clip import/export
	// is disabled with a reason, per the "disable on first fail" fallback. In a Rack a
	// track IS reachable (the wrapper climbs canonical_parent to it), so this stays true
	// there; it only trips where clip I/O genuinely cannot work.
	const [clipSupported, setClipSupported] = useState(true);

	const [amxdBuild, setAmxdBuild] = useState("?");
	// Live's transport tempo. The ref feeds the worker (no re-render on every tick);
	// the state drives the beats-per-cycle suggestion, which must recompute when the
	// tempo changes.
	const [tempo, setTempo] = useState(120);
	const tempoRef = useRef(120);
	const workerRef = useRef<Worker | null>(null);

	/**
	 * Beats per cycle: the cycle-to-beat scale the clip export uses. It is derived
	 * from the pattern's own tempo (setcpm/setcps, which the headless engine ignores)
	 * and Live's transport, so a `setcpm(120)` pattern no longer lands one cycle in a
	 * whole bar. The suggestion tracks the tempo until the user types an override.
	 */
	const detectedCps = useMemo(() => detectCps(text), [text]);
	const suggestedBpc = useMemo(() => suggestBeatsPerCycle(detectedCps, tempo), [detectedCps, tempo]);
	const [beatsPerCycle, setBpcState] = useState(suggestedBpc);
	const bpcOverridden = useRef(false);
	useEffect(() => {
		if (!bpcOverridden.current) setBpcState(suggestedBpc);
	}, [suggestedBpc]);
	const setBeatsPerCycle = useCallback((n: number) => {
		bpcOverridden.current = true;
		setBpcState(n > 0 ? n : 1);
	}, []);
	const resetBeatsPerCycle = useCallback(() => {
		bpcOverridden.current = false;
		setBpcState(suggestedBpc);
	}, [suggestedBpc]);

	/** Everything a mini-notation token needs to become a pitch. Both paths - the
	 *  live engine and the clip exporter - resolve tokens through this, which is
	 *  what keeps them agreeing. */
	// Keyed on the ctx's CONTENTS, not its identity. A device that passes an inline
	// `ctx={{}}` hands us a new object on every render, and noteCtx is a dependency of
	// the recompile effect below - so identity-keying made the engine re-evaluate the
	// pattern on every keystroke, which is exactly what Ctrl+Enter exists to avoid.
	// The object is a handful of scalars; stringifying it is cheaper than the bug.
	const ctxKey = JSON.stringify(ctx ?? {});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const noteCtx = useMemo<NoteContext>(() => ({ conv, octaveOffset, ...ctx }), [conv, octaveOffset, ctxKey]);

	// The clip exporter reads these inside a worker callback; a ref keeps that
	// callback from having to be rebuilt (and the worker restarted) on every edit.
	const exportRef = useRef({ beatsPerCycle, text: "" });
	exportRef.current.beatsPerCycle = beatsPerCycle;

	useEffect(() => {
		// The [js] side pushes `clip_available 0/1` (polled once a second).
		bindInlet(IN.clip_available, (avail) => {
			setClipAvailable(Number(avail) === 1);
		});
		bindInlet(IN.build, (stamp) => setAmxdBuild(String(stamp).split(" ")[0]));
		/**
		 * FOLLOW LIVE'S TRANSPORT (TODO item 0).
		 *
		 * Launching a clip on this device's track - or pressing Play, on a track that has
		 * no clips to launch - starts the pattern, and stopping it stops the pattern. The
		 * wrapper decides WHICH of those two signals applies (it can see the track; this
		 * page cannot) and sends the resolved answer on the edges only.
		 *
		 * It is written into the Play PARAMETER rather than calling run()/hush() directly,
		 * so there is still exactly one source of truth for "is this device playing": the
		 * automatable parameter. Clicking Play in the device, an automation lane and a
		 * launched clip all move the same control, and the last one to move it wins.
		 */
		bindInlet(IN.transport_play, (on) => setPlayParam(Number(on) === 1));
		// Tempo must be bound BEFORE ui_ready goes out - the wrapper replies
		// with the current tempo immediately, and the worker effect below runs
		// after this one. The ref carries the value across that gap.
		bindInlet(IN.tempo, (bpm) => {
			if (Number(bpm) > 0) {
				tempoRef.current = Number(bpm);
				setTempo(Number(bpm));
				workerRef.current?.postMessage({ t: "tempo", bpm: Number(bpm) });
			}
		});
		uiReady();
	}, []);

	// The note-count readout while typing: local, instant, bare-mini only. The
	// engine is what actually renders the clip (toMidi below).
	const { noteCount, errors, capped } = useMemo(() => {
		// bars is cosmetic here: the readout counts notes and cycles, which the
		// cycle-to-beat scale does not change. The engine renders the real clip.
		const r = renderPattern(text, { bars: 1, ...noteCtx });
		return { noteCount: r.notes.length, errors: r.errors, capped: r.capped };
	}, [text, noteCtx]);

	// From MIDI: the [js] side replies `notes <loopEndBeats> <n> <p s d> ...`
	useEffect(() => {
		bindInlet(IN.notes, (...args) => {
			const loopEnd = Number(args[0]);
			const n = Number(args[1]);
			const raw: RawNote[] = [];
			for (let k = 0; k < n; k++) {
				const o = 2 + k * 3;
				raw.push({
					pitch: Number(args[o]),
					start: Number(args[o + 1]),
					duration: Number(args[o + 2]),
				});
			}
			const barsRead = Math.max(1, Math.round(loopEnd / beatsPerBar));
			const mini = eventsToMini(raw, { bars: barsRead, grid, conv, octaveOffset, beatsPerBar });
			setText(mini);
			setStatus(`Read ${n} notes → ${barsRead} bar(s) (Structure is flattened)`);
		});
		bindInlet(IN.read_error, (reason) => {
			if (String(reason) === "no_track") {
				setClipSupported(false);
				setStatus("MIDI clips unavailable here - this device cannot reach a track");
			} else {
				setStatus("No clip found on this track - create or play a MIDI clip first");
			}
		});
		bindInlet(IN.write_error, (reason) => {
			const r = String(reason);
			if (r === "no_track") {
				setClipSupported(false);
				setStatus("MIDI clips unavailable here - this device cannot reach a track");
			} else if (r === "no_slot") {
				setStatus("No empty clip slot on this track - free a slot and try again");
			} else {
				setStatus("Could not write the clip - see the Max console");
			}
		});
	}, [grid, conv, octaveOffset, beatsPerBar]);

	/**
	 * To Clip. The pattern is rendered by the Strudel engine, not by the local
	 * mini parser, so everything Strudel can do - .transpose(), .scale(), .arp(),
	 * .jux(), full JS chains - exports to MIDI exactly as it plays. The engine
	 * also measures the pattern's true loop length, so `<a b>` writes both cycles
	 * instead of being cut off after the first.
	 */
	const toMidi = useCallback(() => {
		if (isBareMini(text) && errors.length > 0) {
			setStatus(`Parse error at ${errors[0].pos}: ${errors[0].msg}`);
			return;
		}
		exportRef.current.text = text;
		workerRef.current?.postMessage({ t: "export", code: text, ctx: noteCtx, beatsPerCycle, liveScale });
		setStatus("Rendering the pattern…");
	}, [text, noteCtx, beatsPerCycle, liveScale, errors]);

	const fromMidi = useCallback(() => {
		outlet(OUT.read_notes);
		setStatus("Reading the playing/first clip on this track…");
	}, []);

	// A truncated export is the more urgent thing to say: the clip on disk will not
	// be the pattern the user wrote.
	const warning = useMemo(
		() =>
			capped
				? "Pattern loop length exceeds MAX_CYCLES (64). Export will be truncated."
				: (opts.warning ?? null),
		[capped, opts.warning],
	);

	// The playhead. The worker posts a cycle position ~20x a second; the AST is
	// parsed once per edit, and only the (cheap) schedule lookup runs per frame.
	const [phase, setPhase] = useState(-1);
	const playAst = useMemo(() => parseForPlayhead(text), [text]);
	const playing = useMemo<Span[]>(
		() => (playAst && phase >= 0 ? activeSpans(playAst, phase) : []),
		[playAst, phase],
	);

	const [live, setLive] = useState(false);
	const [evalError, setEvalError] = useState<string | null>(null);
	const [debug, setDebug] = useState("");

	// The Strudel engine runs in a Web Worker inside jweb. Max feeds transport
	// ticks in as messages; the worker replies with scheduled note events that
	// we forward to the packaged `midiout` chain via sendNote().
	useEffect(() => {
		const counters = { engine: "booting", ticks: 0, sent: 0, playing: 0, beats: 0, clock: "stop" };
		const worker: Worker = new EngineWorker();
		workerRef.current = worker;
		// Deliver whatever tempo already arrived before this worker existed.
		worker.postMessage({ t: "tempo", bpm: tempoRef.current });
		worker.onmessage = (e: MessageEvent<EngineMessage>) => {
			const m = e.data;
			if (m.t === "ready") {
				counters.engine = "ready";
				setStatus("Strudel engine ready");
			} else if (m.t === "evalok") {
				setEvalError(null);
				setStatus("Pattern running");
			} else if (m.t === "evalerr") {
				counters.engine = "error";
				setEvalError(m.message);
				setStatus("Eval error");
			} else if (m.t === "notes") {
				counters.sent += m.notes.length;
				for (const n of m.notes) {
					sendNote({
						pitch: n.pitch,
						velocity: n.velocity,
						durationMs: n.durMs,
						channel: n.chan,
						delayMs: n.delayMs,
					});
				}
			} else if (m.t === "voices") {
				counters.sent += m.voices.length;
				const play = voiceSinkRef.current;
				if (play) for (const voice of m.voices) play(voice);
			} else if (m.t === "sliders") {
				setSliderSpecs(m.specs);
			} else if (m.t === "doughEvents") {
				counters.sent += m.doughEvents.length;
				const play = superdoughSinkRef.current;
				if (play) for (const ev of m.doughEvents) play(ev);
			} else if (m.t === "clip") {
				// Cycles -> beats. One cycle occupies `beatsPerCycle` of Live's beats -
				// derived from the pattern's tempo (see tempo.ts) or the user's override.
				const bpc = exportRef.current.beatsPerCycle;
				const notes: NoteEvent[] = m.notes.map((n) => ({
					pitch: n.pitch,
					velocity: n.velocity,
					start: n.start * bpc,
					duration: n.duration * bpc,
				}));
				const lengthBeats = m.cycles * bpc;
				outlet(OUT.write_clip, ...toFlatList(notes, lengthBeats));
				setStatus(
					`Wrote ${notes.length} notes over ${lengthBeats} beats (${m.cycles} cycle${m.cycles === 1 ? "" : "s"})`,
				);
			} else if (m.t === "exporterr") {
				setStatus(`Cannot export: ${m.message}`);
			} else if (m.t === "phase") {
				setPhase(m.cycle);
			} else if (m.t === "flush") {
				flushNotes();
			} else if (m.t === "clock") {
				counters.clock = m.free ? "free" : "live";
				if (m.free) setStatus("Running on the free clock - press Play in Live to lock to the grid");
				else setStatus("Pattern running (locked to Live)");
			}
		};
		bindInlet(IN.tick, (playing, beats) => {
			counters.ticks++;
			counters.playing = Number(playing);
			counters.beats = Number(beats);
			worker.postMessage({ t: "tick", playing: Number(playing), beats: Number(beats) });
		});
		// Health readout, refreshed 1x/s: instantly shows which hop is dead.
		// ticks stay 0 -> the plugsync~ chain or jweb inbound messages are
		// broken (ticks flow even with the transport stopped); beats frozen /
		// playing 0 while Live plays -> plugsync~ outlet mapping; sent stays
		// 0 while playing -> engine/pattern side; sent counts up but silence
		// -> the Max-side pipe/makenote chain.
		const iv = setInterval(
			() =>
				setDebug(
					`${counters.engine} / t ${counters.ticks} / play ${counters.playing} / clk ${counters.clock} ` +
						`/ beat ${counters.beats.toFixed(1)} / bpm ${Math.round(tempoRef.current)} / sent ${counters.sent}`,
				),
			1000,
		);
		return () => {
			clearInterval(iv);
			worker.terminate();
			workerRef.current = null;
		};
	}, []);

	/**
	 * Re-evaluate, keeping the transport where it is. The worker swaps the pattern
	 * object and leaves its clock alone, so the new pattern is picked up at the
	 * point in the cycle we are already at - it does not restart from zero. That is
	 * what makes Ctrl+Enter feel like strudel.cc, and it is also what lets the
	 * effect below re-evaluate on a context change without a stutter.
	 */
	const run = useCallback(() => {
		// Refuse a bare pattern that does not parse. The rewrite resolves the tokens
		// it DID understand and leaves the rest, which turns a typo into a pattern
		// that plays something else entirely - "bd!4" once became "36!67", 67 kicks
		// a cycle. A red error the user can ignore is not enough; do not run it.
		//
		// The voice sink is exempt: its bare tokens are SAMPLE NAMES, not pitches, so the
		// note-mini parser's "errors" (it cannot resolve `bd`) do not apply - asSampleCode
		// wraps the raw text in s(), and an unknown sound is reported by the sink, not here.
		// Not this engine's transport: still WRITE the parameter, because the button was
		// pressed and the other engine is listening to it - just do not start here.
		if (!transport) {
			setPlayParam(true);
			return;
		}
		// An empty pattern must not go LIVE. It makes no sound, and `live` is what the
		// transport effect and the Run button read - a silent engine that believes it is
		// playing cannot be started, only stopped and started again.
		if (!text.trim()) {
			setStatus("Nothing to run - the pattern is empty");
			return;
		}
		if (sink === "voice" || !isBareMini(text) || errors.length === 0) {
			workerRef.current?.postMessage({ t: "code", code: text, ctx: noteCtx, liveScale, sink });
			setLive(true);
			setPlayParam(true);
			return;
		}
		setStatus(`Parse error at ${errors[0].pos}: ${errors[0].msg}`);
	}, [text, noteCtx, liveScale, errors, setPlayParam, sink, transport]);

	// Live 12's scale, the drum map, the octave/shift controls: all must reach a
	// pattern that is ALREADY PLAYING. They are baked into the code the worker
	// compiled, so a change to any of them means recompiling - otherwise the pattern
	// keeps playing in the key (or on the pads) it was started with until the user
	// stops and starts again.
	//
	// `text` is deliberately NOT a dependency: re-evaluating on every keystroke is
	// not what a live coder wants (that is what Ctrl+Enter is for), so the current
	// text is read from a ref.
	const textRef = useRef(text);
	textRef.current = text;
	const firstEval = useRef(true);
	useEffect(() => {
		if (firstEval.current) {
			firstEval.current = false;
			return;
		}
		if (!live) return;
		workerRef.current?.postMessage({ t: "code", code: textRef.current, ctx: noteCtx, liveScale, sink });
	}, [noteCtx, liveScale, live, sink]);

	/** Go quiet WITHOUT touching `play` - for losing the transport, not for stopping. */
	const standDown = useCallback(() => {
		workerRef.current?.postMessage({ t: "hush" });
		setLive(false);
	}, []);

	const hush = useCallback(() => {
		standDown();
		setPlayParam(false);
	}, [standDown, setPlayParam]);

	/**
	 * May a `play` that is ALREADY DOWN start this engine?
	 *
	 * True at mount, so a set saved while playing comes back playing. False from the
	 * moment this engine loses the transport, and true again only once `play` has been
	 * released - so an engine that gains the transport mid-press waits for the next
	 * press instead of inheriting the one the other engine was started by.
	 */
	const armed = useRef(true);

	useEffect(() => {
		// Ownership can flip while this engine is sounding - the Studio's pattern is
		// typed into an empty slot, or cleared out of a full one - so silence it here
		// rather than only at the next transport change.
		if (!transport) {
			armed.current = false;
			if (live) standDown();
			return;
		}
		// INHERITING THE PRESS IS THE BUG THIS PREVENTS. The scratchpad takes over from
		// an emptied Studio while `play` is still on, so it would start on whatever it
		// holds at that instant - nothing, since the pattern is typed afterwards. It
		// would then be an engine that believes it is playing silence, and no keystroke
		// re-evaluates (that is what Run is for), so nothing could be heard again.
		if (!armed.current) {
			if (playParam) return;
			armed.current = true;
		}

		if (playParam && !live) run();
		else if (!playParam && live) hush();
	}, [transport, playParam, live, run, hush, standDown]);

	return {
		text,
		setText,
		beatsPerCycle,
		setBeatsPerCycle,
		bpcAuto: !bpcOverridden.current,
		resetBeatsPerCycle,
		beatsPerBar,
		setBeatsPerBar,
		grid,
		setGrid,
		conv,
		setConv,
		octaveOffset,
		setOctaveOffset,
		noteCount,
		errors,
		status,
		clipAvailable,
		clipSupported,
		toMidi,
		fromMidi,
		warning,
		playing,
		live,
		transport,
		evalError,
		run,
		hush,
		debug,
		amxdBuild,
		noteCtx,
		tempo,
		sliderSpecs,
		setSliderValues,
	};
}

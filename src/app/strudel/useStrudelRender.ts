import { useCallback, useEffect, useRef, useState } from "react";
import {
	registerSynthSounds,
	samples,
	setGainCurve,
	superdough,
	initAudio,
	getAudioContext,
} from "superdough";
import { bindInlet, copyMessage, copyPath, saveToFile } from "@m4l-jweb/bridge";

import { bootScope, compile } from "../../max/shared/engine.mjs";
import { renderPeriod } from "../../lib/render/determinism";
import { renderCycles } from "../../lib/render/offline";
import { asStrudelCode } from "../../lib/strudelCode";
import { withDeadline } from "../../lib/samples";
import { sampleCacheStatus } from "../../lib/sampleCache";
import { SAMPLE_MAPS, loadSampleMaps } from "../../lib/sampleMaps";
import { useStrudelEngine } from "../shared/useStrudelEngine";
import { useSliderKnobs } from "../shared/useSliderKnobs";
import surface from "./surface";

/**
 * The native Web Audio sink for the Strudel device.
 *
 * TWO CLOCKS, AND WHY delayMs IS THE WRONG BRIDGE BETWEEN THEM. The worker schedules
 * against Live's transport and hands each hap a `delayMs` measured from the beat
 * position of the TICK it was queried in. That works for the MIDI devices because Max's
 * [pipe] applies the delay on Max's own scheduler - the number never leaves the clock it
 * was computed on. Here it does: by the time the event has crossed postMessage and
 * React, an unknown slice of that delay is already spent, and `currentTime + delayMs`
 * quietly means something later than it says.
 *
 * The first attempt clamped a late event to "now" so superdough would not drop it (it
 * refuses to schedule in the past). That is worse than dropping: once the clocks drift
 * past the lookahead window EVERY event clamps to the same instant, so a bar's worth of
 * notes fires simultaneously - which is exactly the reported symptom, audio that starts,
 * collapses, spikes the CPU and distorts, then loosely resumes.
 *
 * So do not convert a delay at all. Anchor the pattern's own timeline to the audio
 * clock ONCE, and derive every event from it: `t = anchorTime + (cycle - anchorCycle) /
 * cps`. Spacing then comes from the pattern (exact, jitter-free) rather than from
 * message arrival times, and superdough is handed strictly increasing future times.
 *
 * The anchor is re-taken only when it is genuinely meaningless: the first event, a
 * tempo change, or a computed time that has fallen behind or run absurdly ahead -
 * transport start/stop, a loop jump, a scrub, or the page being throttled. Each re-anchor
 * is a one-off timing seam, so they are counted and reported rather than hidden.
 */
/** How far ahead of `currentTime` a fresh anchor places its first event. Comfortably
 *  inside the worker's 150 ms lookahead, comfortably past message jitter. */
const ANCHOR_LEAD_S = 0.08;
/** Below this much lead, the mapping has fallen behind the audio clock: re-anchor. */
const MIN_LEAD_S = 0.005;
/** Further ahead than this and the mapping is nonsense (a jump backwards): re-anchor. */
const MAX_AHEAD_S = 2;

/** Longest bounce we render, in cycles - a pattern whose period does not settle is
 *  capped here rather than rendering forever. */
const MAX_EXPORT_CYCLES = 32;

/** The engine's NoteContext is empty here: superdough takes the code verbatim, so there
 *  is no octave convention or drum map to resolve. MODULE-LEVEL, so its identity is
 *  stable - an inline `{}` would be a new object every render. */
const EMPTY_CTX = {} as const;

export function useStrudelRender() {
	const [samplesNote, setSamplesNote] = useState<string | null>("Loading samples...");
	const initialized = useRef(false);
	/** Pattern time pinned to audio time: events derive from this, not from delayMs. */
	const anchor = useRef<{ cycle: number; time: number; cps: number } | null>(null);
	const reanchors = useRef({ count: 0, lastLogged: 0 });
	const [exporting, setExporting] = useState(false);
	const [exportNote, setExportNote] = useState<string | null>(null);
	/** Where the export lands, as the wrapper resolved it. The page cannot know its own
	 *  device's folder; the wrapper sends it once at ui_ready (wrapper/device.ts). */
	const [folder, setFolder] = useState<string | null>(null);
	/** True while a bounce holds superdough's context. A ref, not the `exporting` state:
	 *  the sink closes over its render's values and must see the flag the instant it flips. */
	const bouncing = useRef(false);

	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;
		Promise.all([initAudio(), registerSynthSounds()])
			.then(() => {
				// Synths are ready now; sample maps load in the background so a slow (or
				// offline) fetch never holds up synth patterns. allSettled: one dead map
				// must not silence the rest.
				setSamplesNote("Loading sample maps...");
				void loadSampleMaps((m) => samples(m)).then(async (failed) => {
					if (!failed) return setSamplesNote(null);
					// Offline is not necessarily silence any more: every sample fetched in a
					// previous session is served from the page-side cache (lib/sampleCache.ts).
					// Say which of the two situations this is, because they sound different.
					const cache = await sampleCacheStatus();
					const stored = cache.entries
						? ` - ${cache.entries} cached sound${cache.entries === 1 ? "" : "s"} still play`
						: " - synths still play";
					setSamplesNote(`${failed}/${SAMPLE_MAPS.length} sample maps offline${stored}`);
				});
			})
			.catch((e) => setSamplesNote("Failed to load sounds: " + e.message));
	}, []);

	const engine = useStrudelEngine({
		surface: surface as any,
		// The device view's engine is the SCRATCHPAD's, not the music's: the pattern
		// lives in the Studio and in the `code` slot, and this one starts EMPTY and
		// stays empty unless somebody types a scope or a control snippet into it.
		// Sharing the slot meant hearing both engines at once, which is what it did.
		slot: "miniCode",
		initialText: "",
		ctx: EMPTY_CTX,
		liveScale: "C4:major",
		superdoughSink: (ev) => {
			if (!initialized.current) return;
			// A bounce owns superdough's singleton context for its duration (renderCycles).
			// A live hap scheduled into that OfflineAudioContext is the "cannot connect to
			// an AudioNode belonging to a different audio context" failure, so playback
			// stands down for the render and re-anchors when it comes back.
			if (bouncing.current) return;
			const ac = getAudioContext();
			const now = ac.currentTime;
			let a = anchor.current;

			// A tempo change re-scales the whole mapping, so the old anchor no longer
			// describes this pattern's timeline.
			if (a && a.cps !== ev.cps) a = null;

			let t = a ? a.time + (ev.cycle - a.cycle) / ev.cps : now + ANCHOR_LEAD_S;

			// Behind the audio clock, or absurdly ahead: the thread between pattern time
			// and audio time is lost (start/stop, loop jump, scrub, a throttled page).
			// Re-pin it here rather than firing a pile-up at "now".
			if (!a || t < now + MIN_LEAD_S || t > now + MAX_AHEAD_S) {
				t = now + ANCHOR_LEAD_S;
				anchor.current = { cycle: ev.cycle, time: t, cps: ev.cps };
				if (a) {
					const s = reanchors.current;
					s.count++;
					const wall = Date.now();
					if (wall - s.lastLogged > 5000) {
						s.lastLogged = wall;
						console.warn(
							`[superdough-sink] re-anchored ${s.count}x - transport jump, tempo change or clock drift`,
						);
					}
				}
			}

			superdough(ev.value, t, ev.durMs / 1000, ev.cps, ev.cycle);
		},
	});

	useEffect(() => {
		bindInlet("device_folder", (path) => setFolder(String(path)));
	}, []);

	/** Put the export folder on the clipboard - the honest replacement for a reveal that
	 *  Max cannot perform (doc/TODO.md item 1). */
	const copyFolder = useCallback(async () => {
		if (!folder) return;
		setExportNote(
			copyMessage(await copyPath(folder), folder),
		);
	}, [folder]);

	// Every slider() in the pattern, on a native S1..S8 dial.
	const sliders = useSliderKnobs(surface, engine.sliderSpecs, engine.text, engine.setSliderValues);

	// Stopping ends the timeline. Without this the next Run maps its first cycle against
	// an anchor from minutes ago, which is guaranteed to be behind the audio clock - one
	// wasted re-anchor, and a first note that lands late.
	useEffect(() => {
		if (!engine.live) anchor.current = null;
	}, [engine.live]);

	/**
	 * Export the current pattern to a WAV next to the device (TODO item 3).
	 *
	 * A one-shot BOUNCE, not the retired loop pipeline: compile fresh on this thread
	 * (the worker's pattern lives in another one), find the true loop period, render
	 * it offline with the real superdough, and saveToFile the WAV. The file lands
	 * flat in the device folder - the same drag-out handle the sample browser writes.
	 *
	 * IT TAKES THE ENGINE OVER FOR THE DURATION, and that is structural. superdough's
	 * audio context and output controller are MODULE-LEVEL singletons (audioContext.mjs,
	 * superdough.mjs) and renderCycles swaps both to an OfflineAudioContext; the node
	 * pool is shared across contexts on top of that. Live playback drives the same
	 * singletons, so without a handover a live hap gets scheduled into the offline
	 * context - "cannot connect to an AudioNode belonging to a different audio context",
	 * intermittently, depending on what the pool happens to be holding. `bouncing` stands
	 * the sink down for the render; renderCycles clears the pool on both sides and puts
	 * the live context back. Playback therefore goes quiet for the bounce and resumes.
	 */
	const exportAudio = useCallback(async () => {
		if (exporting) return;
		bouncing.current = true;
		// The seam is unavoidable: pattern time has moved on while the sink was down, so
		// the next event must re-pin rather than derive from a stale anchor.
		anchor.current = null;
		setExporting(true);
		setExportNote("Compiling...");
		try {
			await bootScope();
			// The real gain curve, so a pattern's setGainCurve() shapes the bounce (bootScope
			// installs a no-op; the audio thread's superdough owns the real one).
			(globalThis as Record<string, unknown>).setGainCurve = setGainCurve;
			const cps = engine.tempo / 60 / engine.beatsPerCycle;
			const pat = await compile(asStrudelCode(engine.text, engine.noteCtx));
			const cycles = renderPeriod(pat, cps, MAX_EXPORT_CYCLES);
			setExportNote(`Rendering ${cycles} cycle${cycles === 1 ? "" : "s"}...`);
			// Render at the page's own rate, so the bounce matches what Live is running
			// rather than forcing a resample on import.
			const { wav, seconds } = await renderCycles(pat, cps, 0, cycles, getAudioContext().sampleRate);
			const name = `strudel-export-${Date.now()}.wav`;
			// Deadlined: saveToFile settles only when the wrapper replies, and a request
			// that never reaches [maxurl] gets no reply at all - which showed up as a
			// status stuck on "Rendering..." forever while a .part sat on disk. A bounded
			// wait turns a silent hang into a message that says where to look.
			await withDeadline(saveToFile(name, wav), 30_000, `Saving ${name}`);
			setExportNote(`Exported ${name} (${seconds.toFixed(1)}s) - drag from the device folder`);
		} catch (e) {
			setExportNote("Export failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			bouncing.current = false;
			anchor.current = null;
			setExporting(false);
		}
	}, [exporting, engine.tempo, engine.beatsPerCycle, engine.text, engine.noteCtx]);

	// The shape App.tsx reads: the engine's own fields, plus the few the device adds.
	return {
		...engine,
		samplesNote,
		sliders,
		status: { phase: engine.status, message: engine.debug },
		beats: 0,
		beatsPerCycle: engine.beatsPerCycle,
		playing: engine.live,
		exportAudio,
		exporting,
		exportNote,
		folder,
		copyFolder,
	};
}

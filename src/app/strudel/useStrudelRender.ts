import { useCallback, useEffect, useRef, useState } from "react";
import { registerSynthSounds, samples, setGainCurve, initAudio, getAudioContext } from "superdough";
import { copyMessage, copyPath, onDeviceFolder, saveToFile } from "@m4l-jweb/bridge";

import { bootScope, compile } from "../../max/shared/engine.mjs";
import { renderPeriod } from "../../lib/render/determinism";
import { renderCycles } from "../../lib/render/offline";
import { asStrudelCode } from "../../lib/strudelCode";
import { withDeadline } from "../../lib/samples";
import { sampleCacheStatus } from "../../lib/sampleCache";
import { SAMPLE_MAPS, loadSampleMaps } from "../../lib/sampleMaps";
import { useStrudelEngine } from "../shared/useStrudelEngine";
import { useSliderKnobs } from "../shared/useSliderKnobs";
import surface, { INITIAL_TEXT } from "./surface";

/**
 * The Strudel device's editor and its bounce - NOT an engine.
 *
 * THIS PAGE MAKES NO SOUND. The Studio window is the device's engine (ARCHITECTURE 4k):
 * it is the real strudel.cc, it runs from device load whether or not its window is open,
 * and its `[jweb~]` is the track. This page edits the SAME `code` slot and shows the
 * same pattern, so it is a second view of one thing rather than a second instrument.
 *
 * It used to have an engine of its own, on a separate `miniCode` slot - the "scratchpad".
 * Two engines summing into one track meant one transport starting both, and three
 * attempts at giving the transport to exactly one of them (see the drawer) were all
 * worse than deleting the second engine. What went with it: a `scope()` typed here can
 * no longer draw, because `[jweb~]` has no signal inlet and this page therefore cannot
 * see the Studio's audio - the Visualizer's `[peakamp~]` tap is what remains.
 *
 * `useStrudelEngine` is still mounted, with `transport: false` so it never sounds. It is
 * what reads Live's tempo, tracks beats-per-cycle and parses the text; the bounce below
 * needs all three, and none of them make noise.
 */

/** Longest bounce we render, in cycles - a pattern whose period does not settle is
 *  capped here rather than rendering forever. */
const MAX_EXPORT_CYCLES = 32;

/** The engine's NoteContext is empty here: superdough takes the code verbatim, so there
 *  is no octave convention or drum map to resolve. MODULE-LEVEL, so its identity is
 *  stable - an inline `{}` would be a new object every render. */
const EMPTY_CTX = {} as const;

export function useStrudelRender(
	/**
	 * Whether this page names the S1..S8 dials, or leaves them to the Studio. False
	 * whenever the Studio's pattern has declared faders of its own - it owns the pool
	 * then, and a second writer just renames its dials from under it.
	 */
	describeKnobs = true,
) {
	const [samplesNote, setSamplesNote] = useState<string | null>("Loading samples...");
	const initialized = useRef(false);
	const [exporting, setExporting] = useState(false);
	const [exportNote, setExportNote] = useState<string | null>(null);
	/** Where the export lands, as the wrapper resolved it. The page cannot know its own
	 *  device's folder; the wrapper sends it once at ui_ready (wrapper/device.ts). */
	const [folder, setFolder] = useState<string | null>(null);
	/** The last file this device wrote, so the copy button can offer its full path. */
	const [exported, setExported] = useState<string | null>(null);

	// The sounds the BOUNCE needs. Nothing here plays: superdough is loaded in this page
	// only so an offline render can resolve `s("bd")` and the synth waveforms, and the
	// sample maps are fetched for the same reason.
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
		// THE SAME SLOT THE STUDIO EDITS. One pattern, two views of it - this page is
		// not a second instrument, and there is no second text to keep in step.
		slot: "code",
		// Never sounds. The Studio is the engine; this mount is for the tempo, the
		// beats-per-cycle tracking and the parse that the bounce needs.
		transport: false,
		initialText: INITIAL_TEXT,
		ctx: EMPTY_CTX,
		liveScale: "C4:major",
	});

	// The library's, from this device's files.ts declaration - it arrives at ui_ready,
	// whether or not anything has been exported yet.
	useEffect(() => onDeviceFolder(setFolder), []);

	/**
	 * Put the exported FILE's full path on the clipboard - the folder only until there
	 * is one.
	 *
	 * The file, not the folder, because the path is what the user does the drag with:
	 * a device page cannot hand Live a file (CEF strips the DownloadURL payload, see
	 * doc/DRAWER_OF_FAILED_IDEAS.md), so the clipboard IS the handoff, and a folder path
	 * still leaves them hunting for the newest .wav in it.
	 */
	const copyFolder = useCallback(async () => {
		if (!folder) return;
		const path = exported ? `${folder}/${exported}` : folder;
		setExportNote(copyMessage(await copyPath(path), path));
	}, [folder, exported]);

	// Every slider() in the pattern, on a native S1..S8 dial.
	const sliders = useSliderKnobs(surface, engine.sliderSpecs, engine.text, engine.setSliderValues, describeKnobs);

	/**
	 * Export the current pattern to a WAV next to the device.
	 *
	 * A one-shot BOUNCE: compile fresh on this thread, find the true loop period, render
	 * it offline with the real superdough, and saveToFile the WAV. The file lands flat in
	 * the device folder - the same drag-out handle the sample browser writes.
	 *
	 * It does not disturb the music. The Studio is a different Chromium context with its
	 * own superdough singletons, so swapping this page's context for an OfflineAudioContext
	 * is invisible to the audio on the track. What it cannot do is bounce what the Studio
	 * would actually play: this page compiles the same TEXT in its own scope, so a pattern
	 * leaning on something only the Studio's runtime provides renders differently or not at
	 * all. The fix is a renderer in strudel itself - doc/TODO.md item 2.
	 */
	const exportAudio = useCallback(async () => {
		if (exporting) return;
		if (!engine.text.trim()) {
			setExportNote("Nothing to export - the pattern is empty");
			return;
		}
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
			const name = `gugelhupf-export-${Date.now()}.wav`;
			// Deadlined: saveToFile settles only when the wrapper replies, and a request
			// that never reaches [maxurl] gets no reply at all - which showed up as a
			// status stuck on "Rendering..." forever while a .part sat on disk. A bounded
			// wait turns a silent hang into a message that says where to look.
			await withDeadline(saveToFile(name, wav), 30_000, `Saving ${name}`);
			setExported(name);
			setExportNote(`Exported ${name} (${seconds.toFixed(1)}s) - copy the path and drag it in`);
		} catch (e) {
			setExportNote("Export failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
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

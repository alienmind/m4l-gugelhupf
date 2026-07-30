import { useCallback, useEffect, useRef, useState } from "react";
import { registerSynthSounds, samples, setGainCurve, initAudio, getAudioContext } from "superdough";
import { AudioClipError, copyMessage, copyPath, createAudioClip, onDeviceFolder, onTrackKind, saveToFile, type TrackKind } from "@m4l-jweb/bridge";
import { useParam } from "@m4l-jweb/surface/react";

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
 *
 * Its engine WORKER does exist, and is not idle scaffolding any more: nothing ever posts
 * `code` to it from this page (Run goes to the Studio), so it compiles nothing and plays
 * nothing - but `toMidi()` posts a one-off `export`, which compiles the pattern in the
 * worker and queries its haps. That is what writes a MIDI clip on the instrument flavour,
 * and it is the same query the MIDI device's To Clip runs.
 */

/** Longest bounce we render, in cycles - a pattern whose period does not settle is
 *  capped here rather than rendering forever. */
const MAX_EXPORT_CYCLES = 32;

/** The engine's NoteContext is empty here: superdough takes the code verbatim, so there
 *  is no octave convention or drum map to resolve. MODULE-LEVEL, so its identity is
 *  stable - an inline `{}` would be a new object every render. */
const EMPTY_CTX = {} as const;

/**
 * Live's warp mode 0 - Beats.
 *
 * The bounce was rendered at Live's own tempo over a whole number of cycles, so warping
 * is an identity transform and the mode only decides what happens when the SET's tempo
 * later moves. Beats is right for that: this is loop material with a known grid, which is
 * exactly what Beats assumes and Complex does not.
 */
const WARP_BEATS = 0;

/** What a landed bounce needs to become a clip - the file, plus what the render knows. */
interface AudioClipSpec {
	file: string;
	name: string;
	/** The loop end in beats: whole cycles times beats-per-cycle, never guessed. */
	loopEnd: number;
}

/**
 * What a bounced clip is called.
 *
 * Not the pattern, which was tried first and is wrong twice over: a Session slot draws a
 * name in about 90 px, so a line of Strudel is a truncated fragment of syntax, and the
 * text is the one thing the user can already read in the device above it. Not the
 * filename either - `gugelhupf-export-1785343077706` names the millisecond it was
 * rendered. A short constant leaves the slot renameable, which is what a musician does
 * with a clip anyway.
 */
const CLIP_NAME = "Gugelhupf tune";

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
	/**
	 * The bounce landed on disk but not in a clip, because this device is on a MIDI
	 * track. Offering a NEW audio track is the one target that cannot fail there - and it
	 * is offered rather than done, because a device that spawns tracks unasked surprises
	 * people.
	 */
	const [offerNewTrack, setOfferNewTrack] = useState<AudioClipSpec | null>(null);
	// Bouncing into our own track means the clip is now the sound; playing the pattern
	// underneath it as well is the doubling this switches off. It is a real Live
	// parameter, so it persists with the set and can be mapped - see surface.ts.
	const [follow, setFollow] = useParam(surface, "follow");
	/**
	 * Which container this instance is in, from Live rather than from the build.
	 *
	 * The two flavours are one page: an audio track takes the audio bounce, a MIDI track
	 * takes a MIDI clip, and neither takes the other. Asking Live means the page cannot be
	 * wrong about which build it is, and a device dragged onto the wrong kind of track says
	 * so instead of failing at the call.
	 */
	const [trackKind, setTrackKind] = useState<TrackKind>("none");
	useEffect(() => onTrackKind(setTrackKind), []);

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
		// ...but it is still this mount that writes the Play parameter when Live's
		// transport moves, and Play is what the Studio follows. So the follow gate
		// belongs here even though nothing here makes a sound.
		follow,
		// The MIDI clip export's outcome, straight into the one notice row this device
		// has. The engine reports it as prose too, which is what the MIDI device's clip
		// panel prints; this page would have to pattern-match that string.
		onClipWritten: (notes, beats) =>
			setExportNote(
				notes === 0
					? "No notes in this pattern - a MIDI clip needs note(), or bare mini-notation. s(\"bd sd\") names samples, not pitches"
					: `MIDI clip written - ${notes} note${notes === 1 ? "" : "s"} over ${beats} beats`,
			),
		onClipError: setExportNote,
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

	/**
	 * The bounce into a clip slot, and the reason it is one call and not a UI.
	 *
	 * `target: "selected"` is Live's highlighted clip slot, which - in a device's own view
	 * - is always a slot on the device's OWN track: a device's UI is on screen only while
	 * its track is selected, so there is no reachable moment at which the highlighted slot
	 * belongs to somebody else. That makes the audio-effect flavour of this device the one
	 * that can bounce (its own track takes audio clips) and the instrument flavour the one
	 * that cannot, and it is why `not_audio_track` is answered with an OFFER rather than a
	 * silent hop to another track.
	 */
	const placeClip = useCallback(
		async (spec: AudioClipSpec, where: "selected" | "new") => {
			try {
				await createAudioClip(spec.file, where === "new" ? { target: "new" } : { target: "selected" }, {
					name: spec.name,
					warp: true,
					warpMode: WARP_BEATS,
					loopEnd: spec.loopEnd,
				});
				setOfferNewTrack(null);
				// The clip IS the sound now. Leaving the follow on means the next Play sounds
				// both, a few milliseconds apart - which is what this device did before the
				// parameter existed.
				setFollow(false);
				setExportNote(
					`Clip created - ${spec.loopEnd} beat${spec.loopEnd === 1 ? "" : "s"}, warped. Transport follow off, so the clip plays and not the pattern`,
				);
				return true;
			} catch (e) {
				const reason = e instanceof AudioClipError ? e.reason : "failed";
				// Only ONE of the failures has a way out, and it is the common one: this
				// device is an instrument on a MIDI track.
				setOfferNewTrack(reason === "not_audio_track" ? spec : null);
				setExportNote(
					reason === "not_audio_track"
						? `Exported ${spec.file} - a MIDI track takes no audio clip. Bounce it to a new audio track, or copy the path`
						: reason === "needs_live_1205"
							? `Exported ${spec.file} - clips need Live 12.0.5 or newer; copy the path and drag it in`
							: `Exported ${spec.file} - could not make a clip: ${e instanceof Error ? e.message : String(e)}`,
				);
				return false;
			}
		},
		[setFollow],
	);

	/**
	 * The pattern as a MIDI CLIP, on this device's own track.
	 *
	 * The instrument flavour sits on a MIDI track, which takes no audio clip - but it takes
	 * a MIDI one, and this device already knows every note it is about to play. The notes
	 * are captured from the pattern's HAPS, before superdough ever sees them, so nothing is
	 * injected into the user's code and nothing about the sound changes: it is the same
	 * query the MIDI device's To Clip does (`exportNotes` / `patternCycles` in engine.mjs),
	 * including the `n`-is-a-sample-index rule that keeps `s("bd:3")` from becoming note 3.
	 *
	 * What has no MIDI form is dropped rather than approximated: a hap with no pitch
	 * (`s("bd sd")` names a sample), and every effect (`lpf`, `room`, `pan`). A pattern made
	 * of samples therefore writes an EMPTY clip, which is why zero notes is reported as a
	 * sentence rather than as a success.
	 */
	const exportMidiClip = useCallback(() => {
		if (!engine.text.trim()) {
			setExportNote("Nothing to export - the pattern is empty");
			return;
		}
		setOfferNewTrack(null);
		setExportNote("Rendering the pattern to notes...");
		engine.toMidi();
	}, [engine.text, engine.toMidi]);

	/** The offered escape, taken: a fresh audio track, and the bounce in its first slot. */
	const bounceToNewTrack = useCallback(async () => {
		if (!offerNewTrack) return;
		setExportNote("Creating an audio track...");
		await placeClip(offerNewTrack, "new");
	}, [offerNewTrack, placeClip]);

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
			setExportNote(`Exported ${name} (${seconds.toFixed(1)}s) - making a clip...`);
			// STRAIGHT INTO A CLIP. This is the whole point of the feature: the file on
			// disk, the drag through Explorer and the copied path were five manual steps
			// between a render and a clip, and the clip is what was wanted every time. The
			// loop length is `cycles * beatsPerCycle` - EXACT, because this page chose the
			// cycle count and the cps it rendered at, where Live would infer a grid from
			// transients. The copy-path button stays for the targets that cannot take a
			// clip and for Live 12.0.4 and older.
			await placeClip({ file: name, name: CLIP_NAME, loopEnd: cycles * engine.beatsPerCycle }, "selected");
		} catch (e) {
			setExportNote("Export failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setExporting(false);
		}
	}, [exporting, engine.tempo, engine.beatsPerCycle, engine.text, engine.noteCtx, placeClip]);

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
		/** Non-null when the last bounce could not become a clip here, and a new track would. */
		offerNewTrack: Boolean(offerNewTrack),
		bounceToNewTrack,
		exportMidiClip,
		/** What Live says this instance is sitting on - which decides what clips it can make. */
		trackKind,
	};
}

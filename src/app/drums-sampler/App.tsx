import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardCopy, LayoutGrid } from "lucide-react";
import { bindInlet, copyMessage, copyPath, onNote, saveToFile, uiReady } from "@m4l-jweb/bridge";
import { audioContext, decodeSample, playBuffer, type DecodedSample } from "../shared/webaudio";

import { bootScope, compile, queryWindow, hapToVoice } from "../../max/shared/engine.mjs";
import { renderPeriod } from "../../lib/render/determinism";
import { audioBufferToWav } from "../../lib/render/wav";
import { asSampleCode } from "../../lib/strudelCode";
import { IN } from "./protocol";
import { useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { cn } from "@/lib/utils";
import { tokenAtCaret } from "@/lib/reference";
import {
	DRUM_MACHINES_URL,
	banksOf,
	isPlayable,
	loadSampleMap,
	soundKey,
	soundToken,
	variationUrl,
	withDeadline,
	type Sound,
} from "@/lib/samples";
import { AboutPanel } from "../shared/AboutPanel";
import { Button } from "../shared/Button";
import { ExportButton, RunButton } from "../shared/DeviceButtons";
import { HelpButton } from "../shared/HelpButton";
import { PatternEditor } from "../shared/PatternEditor";
import { useStrudelEngine, type VoiceEvent } from "../shared/useStrudelEngine";
import surface, { INITIAL_BANK, INITIAL_TEXT } from "./surface";

/**
 * How many decoded samples stay resident before the least-recently-used one is
 * dropped. Drum hits decode to a few hundred kB each; 64 is a full machine and
 * change, far past the 16 the old Max-side [poly~] could hold.
 */
const MAX_RESIDENT = 64;

/** Longest bounce Export renders, in cycles - a pattern whose period does not settle is
 *  capped here rather than rendering forever. */
const MAX_EXPORT_CYCLES = 32;

/**
 * MIDI note -> drum sound token, so a sequencer in front of the Sampler drives it (this is
 * what the C1/C#1 pad layout was always for). It follows Live's Drum Rack / General MIDI
 * convention: 36 = bd, 38 = sd, 42 = hh... The token is then resolved against the selected
 * bank, exactly like a name in an s() pattern - so `note 36` plays the bank's `bd`.
 */
const NOTE_SOUND: Record<number, string> = {
	36: "bd", 37: "rim", 38: "sd", 39: "cp", 40: "sd", 41: "lt", 42: "hh", 43: "lt",
	44: "hh", 45: "mt", 46: "oh", 47: "mt", 48: "ht", 49: "cr", 50: "ht", 51: "rd",
	52: "cr", 53: "rd", 54: "tb", 55: "cr", 56: "cb", 57: "cr", 59: "rd",
};

/** A resident sound: the decoded audio, and when it last played (LRU eviction). */
interface Loaded {
	sample: DecodedSample;
	lastUsed: number;
}

/**
 * Strudel Sampler - a polyphonic, CODE-DRIVEN sampler over drum-machine BANKS.
 *
 * NOT a MIDI pad rack. It PROCESSES Strudel code: the CODE screen runs an `s(...)` pattern
 * (or a bare `bd sd, hh*8`, wrapped in `s()` for you) through the shared engine, and each
 * hap names a SOUND that a BANK - a tidal-drum-machine, strudel's `bank()` prefix -
 * resolves to a real sample (`RolandTR909_bd`), fetched automatically in the background.
 * It ALSO takes MIDI notes, so a sequencer (or the Drums MIDI device) in front of it plays
 * the same bank. Sounds are keyed by NAME; there are no per-pad MIDI notes to configure.
 *
 * TWO SCREENS: CODE (pattern + bank picker + Run) and SOUNDS (the bank's sounds, to
 * audition). Samples decode into page AudioBuffers and play through jweb~ (the
 * `webaudio` chain) - no Max [poly~], no disk. LRU keeps MAX_RESIDENT sounds decoded.
 */
export default function App() {
	const [view, setView] = useState<"code" | "browse">("code");
	const [bank, setBank] = useStateSync(surface, "bank");
	const bankName = typeof bank === "string" && bank ? bank : INITIAL_BANK;

	const [status, setStatus] = useState("Loading drum machines...");
	const [showAbout, setShowAbout] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportNote, setExportNote] = useState<string | null>(null);
	/** The device's folder on disk, so "Copy folder path" has something to hand over. */
	const [folder, setFolder] = useState<string | null>(null);

	/** The drum-machine catalog (one big map, keys `Machine_sound`), loaded once. */
	const [dmSounds, setDmSounds] = useState<Sound[]>([]);

	/** key -> its decoded sample. The occupancy source of truth. */
	const loadedRef = useRef<Map<string, Loaded>>(new Map());
	/** key -> in-flight load, so a repeated hap does not fire a second download. */
	const loadingRef = useRef<Set<string>>(new Set());
	/** A monotonic clock for LRU. */
	const seq = useRef(0);
	const [, setLoadedTick] = useState(0);
	const bumpLoaded = useCallback(() => setLoadedTick((t) => t + 1), []);

	/** A brief visual flash per sounding key (Sounds view). */
	const [struck, setStruck] = useState<Set<string>>(() => new Set());
	const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const flash = useCallback((key: string) => {
		setStruck((s) => new Set(s).add(key));
		const existing = flashTimers.current.get(key);
		if (existing) clearTimeout(existing);
		flashTimers.current.set(
			key,
			setTimeout(() => {
				flashTimers.current.delete(key);
				setStruck((s) => {
					const next = new Set(s);
					next.delete(key);
					return next;
				});
			}, 120),
		);
	}, []);

	// The (bound-once) voiceSink and MIDI handler read the current bank + catalog through a
	// ref, never the snapshot they closed over.
	const dmByName = useMemo(() => new Map(dmSounds.map((s) => [s.name, s])), [dmSounds]);
	const ctxRef = useRef({ bankName, dmByName });
	ctxRef.current = { bankName, dmByName };

	const missingRef = useRef<Set<string>>(new Set());
	const [missing, setMissing] = useState<string[]>([]);
	const reportMissing = useCallback((label: string) => {
		if (missingRef.current.has(label)) return;
		missingRef.current.add(label);
		setMissing([...missingRef.current]);
	}, []);

	/** Resolve a sound name against the bank (`bd` -> `RolandTR909_bd`). A pattern's own
	 *  `.bank()` overrides the dropdown. Null when no sample answers the name. */
	const resolve = useCallback(
		(s: string, bankOverride: string | null): { key: string; sound: Sound; label: string } | null => {
			const { bankName, dmByName } = ctxRef.current;
			const name = soundKey(bankOverride ?? bankName, s);
			const sound = dmByName.get(name);
			if (!sound) return null;
			return { key: name, sound, label: name };
		},
		[],
	);

	const play = useCallback(
		(loaded: Loaded, key: string, velocity: number, rate: number) => {
			loaded.lastUsed = ++seq.current;
			playBuffer(loaded.sample.buffer, { rate, gain: velocity / 127 });
			flash(key);
		},
		[flash],
	);

	/** Past MAX_RESIDENT decoded sounds, drop the least recently played one. */
	const evictLru = useCallback(() => {
		if (loadedRef.current.size < MAX_RESIDENT) return;
		let lruKey: string | null = null;
		let lruUsed = Infinity;
		for (const [k, l] of loadedRef.current) {
			if (l.lastUsed < lruUsed) {
				lruUsed = l.lastUsed;
				lruKey = k;
			}
		}
		if (lruKey !== null) loadedRef.current.delete(lruKey);
	}, []);

	/** Fetch (first reference, cached) and decode a sound; return it resident, or null
	 *  while it is still loading / on a failure the status line explains. */
	const ensureLoaded = useCallback(
		async (key: string, sound: Sound, n: number): Promise<Loaded | null> => {
			const already = loadedRef.current.get(key);
			if (already) return already;
			if (loadingRef.current.has(key)) return null;
			loadingRef.current.add(key);
			try {
				const url = variationUrl(sound, n);
				if (!isPlayable(url)) {
					reportMissing(`${sound.name} (not WAV/AIFF)`);
					return null;
				}
				setStatus(`Fetching ${sound.name}...`);
				// Deadlined, so no network cannot leave the status on "Fetching..." forever.
				const bytes = await withDeadline(
					fetch(url).then((r) => {
						if (!r.ok) throw new Error(`HTTP ${r.status}`);
						return r.arrayBuffer();
					}),
					30_000,
					`Download of ${sound.name}`,
				);
				evictLru();
				const loaded: Loaded = { sample: await decodeSample(bytes), lastUsed: ++seq.current };
				loadedRef.current.set(key, loaded);
				bumpLoaded();
				setStatus(`Loaded ${sound.name}`);
				return loaded;
			} catch (err) {
				setStatus(`Error loading ${sound.name}: ${message(err)}`);
				return null;
			} finally {
				loadingRef.current.delete(key);
			}
		},
		[evictLru, bumpLoaded, reportMissing],
	);

	/** Trigger a sound by name: play it if resident, else background-load it (sounds from the
	 *  next cycle). Shared by the CODE sink and by incoming MIDI. */
	const trigger = useCallback(
		(s: string, bankOverride: string | null, n: number, velocity: number, rate: number) => {
			const r = resolve(s, bankOverride);
			if (!r) {
				reportMissing(bankOverride ? `${bankOverride}:${s}` : s);
				return;
			}
			const loaded = loadedRef.current.get(r.key);
			if (loaded) {
				play(loaded, r.key, velocity, rate);
				return;
			}
			void ensureLoaded(r.key, r.sound, n);
		},
		[resolve, reportMissing, play, ensureLoaded],
	);

	const voiceSink = useCallback((v: VoiceEvent) => trigger(v.s, v.bank, v.n, v.velocity, v.rate), [trigger]);

	/** Audition a sound from the Sounds screen: load if needed, then play once. */
	const audition = useCallback(
		async (sound: Sound, key: string) => {
			const loaded = loadedRef.current.get(key) ?? (await ensureLoaded(key, sound, 0));
			if (loaded) play(loaded, key, 100, 1);
		},
		[ensureLoaded, play],
	);

	const engine = useStrudelEngine({ surface, initialText: INITIAL_TEXT, ctx: EMPTY_CTX, voiceSink });

	/**
	 * Export the pattern to a WAV next to the device.
	 *
	 * Rendered through THIS device's own sound path, not superdough: what it plays is
	 * decoded AudioBuffers, so the bounce is the same buffers scheduled into an
	 * OfflineAudioContext. That keeps the export honest (it is what you hear) and keeps
	 * superdough - a large dependency this device does not otherwise carry - out of the
	 * bundle. Decoded AudioBuffers are not bound to the context that decoded them, so
	 * the ones already in memory can be reused directly.
	 */
	const exportAudio = useCallback(async () => {
		if (exporting) return;
		setExporting(true);
		setExportNote("Compiling...");
		try {
			await bootScope();
			const cps = engine.tempo / 60 / engine.beatsPerCycle;
			const pat = await compile(asSampleCode(engine.text));
			const cycles = renderPeriod(pat, cps, MAX_EXPORT_CYCLES);
			const seconds = cycles / cps;
			const sampleRate = audioContext().sampleRate;

			// Every sound the pattern names has to be resident BEFORE rendering starts -
			// an offline context runs faster than realtime and will not wait for a fetch.
			setExportNote("Loading sounds...");
			const haps = queryWindow(pat, 0, cycles, cps);
			const voices = haps.map((h: unknown) => hapToVoice(h, cps)).filter(Boolean);
			for (const v of voices) {
				const r = resolve(v.s, v.bank);
				if (r) await ensureLoaded(r.key, r.sound, v.n ?? 0);
			}

			setExportNote(`Rendering ${cycles} cycle${cycles === 1 ? "" : "s"}...`);
			const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
			for (const v of voices) {
				const r = resolve(v.s, v.bank);
				const loaded = r && loadedRef.current.get(r.key);
				if (!loaded) continue;
				const src = ctx.createBufferSource();
				src.buffer = loaded.sample.buffer;
				src.playbackRate.value = v.rate ?? 1;
				const amp = ctx.createGain();
				amp.gain.value = (v.velocity ?? 100) / 127;
				src.connect(amp);
				amp.connect(ctx.destination);
				src.start(Math.max(0, v.beginCycle / cps));
			}
			const wav = audioBufferToWav(await ctx.startRendering());
			const name = `drums-export-${Date.now()}.wav`;
			await withDeadline(saveToFile(name, wav), 30_000, `Saving ${name}`);
			setExportNote(`Exported ${name} (${seconds.toFixed(1)}s) - copy the folder path to find it`);
		} catch (e) {
			setExportNote("Export failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setExporting(false);
		}
	}, [exporting, engine.tempo, engine.beatsPerCycle, engine.text, resolve, ensureLoaded]);

	/** The export folder on the clipboard - Max cannot open a file manager (TODO item 1). */
	const copyFolder = useCallback(async () => {
		if (!folder) return;
		setExportNote(copyMessage(await copyPath(folder), folder));
	}, [folder]);

	const helpWindow = useWindow(surface, "help");
	const strudelWindow = useWindow(surface, "strudel");
	const [, setHelpQuery] = useStateSync(surface, "helpQuery");

	// A bank change can satisfy a name that was missing a moment ago; clear the report.
	useEffect(() => {
		if (missingRef.current.size === 0) return;
		missingRef.current.clear();
		setMissing([]);
	}, [bankName]);

	useEffect(() => {
		bindInlet(IN.device_folder, (path) => setFolder(String(path)));
		// A MIDI note from a sequencer in front of the Sampler plays the bank's sound for
		// that note (Drum Rack convention). Bound once; reads the current bank via refs.
		onNote((pitch, velocity) => {
			const token = NOTE_SOUND[pitch];
			if (token) trigger(token, null, 0, velocity, 1);
		});
		uiReady();
	}, [trigger]);

	// Load the drum-machine catalog once. The ref guards React 18's double-mount in dev.
	const booted = useRef(false);
	useEffect(() => {
		if (booted.current) return;
		booted.current = true;
		void (async () => {
			try {
				// The catalog's `_base` still names ritchse/tidal-drum-machines, which was
				// renamed to geikha/ and only 301-redirects. Rewrite it so the download does
				// not depend on [maxurl] following the redirect.
				const found = (await loadSampleMap(DRUM_MACHINES_URL)).map((s) => ({
					...s,
					urls: s.urls.map((u) => u.replace("/ritchse/tidal-drum-machines/", "/geikha/tidal-drum-machines/")),
				}));
				setDmSounds(found);
				setStatus(`${banksOf(found).length} drum machines. Pick a bank, write s("bd sd"), Run.`);
			} catch (err) {
				setStatus(`Could not load drum machines: ${message(err)}`);
			}
		})();
	}, []);

	const banks = useMemo(() => banksOf(dmSounds), [dmSounds]);

	/** The sounds of the selected bank, for the Sounds grid: `bd`, `sd`, ... + variations. */
	const bankSounds = useMemo(() => {
		const prefix = `${bankName}_`;
		return dmSounds
			.filter((s) => s.name.startsWith(prefix))
			.map((s) => ({ sound: s, token: soundToken(s.name), key: s.name }));
	}, [dmSounds, bankName]);

	if (showAbout) {
		return <AboutPanel amxdBuild={__APP_VERSION__} onOpenStrudel={strudelWindow.open} onClose={() => setShowAbout(false)} />;
	}

	const codeStatus =
		missing.length > 0
			? `No sample for ${missing.map((m) => `"${m}"`).join(", ")} in ${bankName} - try another bank or name`
			: engine.status;

	return (
		<div className="device flex h-full w-full flex-col gap-1.5 bg-background p-2 text-foreground">
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>
					Gugelhupf Drums Sampler
				</button>
				{view === "code" ? (
					<>
						<select
							value={bankName}
							onChange={(e) => setBank(e.target.value)}
							title="The drum machine that bare s() names play from - strudel's bank()"
							className="ml-auto max-w-[36%] rounded bg-input/50 px-1 py-0.5"
						>
							{banks.map((b) => (
								<option key={b} value={b}>
									{b}
								</option>
							))}
						</select>
						<RunButton live={engine.live} onRun={engine.run} onStop={engine.hush} />
						<ExportButton onExport={exportAudio} busy={exporting} />
						<Button icon={LayoutGrid} onClick={() => setView("browse")} title="Sounds: browse the bank" />
						<HelpButton onOpen={helpWindow.open} />
					</>
				) : (
					<Button className="ml-auto" icon={ArrowLeft} onClick={() => setView("code")} title="Back to the code screen" />
				)}
			</div>

			{view === "code" ? (
				<div className="flex min-h-0 flex-1 flex-col gap-1.5">
					<PatternEditor
						value={engine.text}
						onChange={engine.setText}
						onCaret={(caret) => setHelpQuery(tokenAtCaret(engine.text, caret))}
						onRun={engine.run}
						spans={engine.playing}
						invalid={engine.evalError !== null}
					/>
					{engine.evalError && (
						<span className="shrink-0 truncate text-[10px] text-destructive" title={engine.evalError}>
							{engine.evalError}
						</span>
					)}
				</div>
			) : (
				/* THE SOUNDS SCREEN: the bank's sounds as tokens - the words you type in s("..."). */
				<div className="flex min-h-0 flex-1 flex-col gap-1.5">
					<select
						value={bankName}
						onChange={(e) => setBank(e.target.value)}
						className="shrink-0 rounded bg-input/50 px-1 py-0.5 text-[11px]"
					>
						{banks.map((b) => (
							<option key={b} value={b}>
								{b}
							</option>
						))}
					</select>
					<div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-input/20 p-1">
						<div className="grid grid-cols-4 gap-1">
							{bankSounds.map(({ sound, token, key }) => (
								<button
									key={token}
									onClick={() => void audition(sound, key)}
									className={cn(
										"flex h-10 flex-col items-start justify-center rounded-sm border px-1.5 transition-colors",
										struck.has(key)
											? "border-primary bg-primary/40"
											: loadedRef.current.has(key)
												? "border-primary/50 bg-primary/15"
												: "border-input bg-input/30 hover:bg-input/50",
									)}
									title={`s("${token}") - ${sound.urls.length} variation${sound.urls.length === 1 ? "" : "s"} - click to audition`}
								>
									<span className="font-mono text-[11px] font-semibold">{token}</span>
									<span className="font-mono text-[8px] text-muted-foreground">{sound.urls.length}</span>
								</button>
							))}
							{bankSounds.length === 0 && (
								<div className="col-span-4 p-2 text-[11px] text-muted-foreground">
									{dmSounds.length === 0 ? "Loading drum machines..." : "No sounds in this bank."}
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			<div className="flex items-center gap-2">
				<span
					className={cn("flex-1 truncate text-[10px]", missing.length > 0 ? "text-amber-500" : "text-muted-foreground")}
					title={exportNote ?? (view === "code" ? codeStatus : status)}
				>
					{exportNote ?? (view === "code" ? codeStatus : status)}
				</span>
				{/* Enabled once something has been written: before the first Export the
				    folder may not exist yet, and a path to nothing is worse than no button. */}
				<Button
					icon={ClipboardCopy}
					onClick={copyFolder}
					disabled={!exportNote || !folder}
					title={
						folder
							? "Copy the device folder path to the clipboard, to paste into Explorer/Finder"
							: "Export something first"
					}
				/>
			</div>
		</div>
	);
}

/** The engine's NoteContext is empty here: sounds are named by `s()`, not resolved to
 *  pitches. Stable, so the engine does not recompile. */
const EMPTY_CTX = {} as const;

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCopy, GripVertical, Search, Square } from "lucide-react";
import { bindInlet, copyMessage, copyPath, onDeviceFolder, saveToFile, uiReady } from "@m4l-jweb/bridge";
import { decodeSample, playBuffer } from "../shared/webaudio";

import { cn } from "@/lib/utils";
import {
	DEFAULT_QUANT,
	isPlayable,
	loadSampleMap,
	localPath,
	msUntilNextBoundary,
	variationUrl,
	withDeadline,
	type Sound,
} from "@/lib/samples";
import { IN } from "./protocol";
import { AboutPanel } from "../shared/AboutPanel";
import { Button } from "../shared/Button";
import { CustomMapPanel } from "./CustomMapPanel";
import { PRESET_MAPS } from "./banks";

/** The value the dropdown carries for its last entry, "Custom...". Not a URL - picking it
 *  opens the custom-map screen rather than loading anything. */
const CUSTOM = "__custom__";

/** 4/4, as everything else in this repo assumes. A "bar" for the loop below. */
const BEATS_PER_BAR = 4;

interface RowState {
	/** Which variation - `bd:3`. */
	n: number;
	/** Relative path, once this variation is on disk. */
	path: string | null;
	/** What [info~] measured, once it has been loaded. Null until then - and that is
	 *  honest: a duration cannot be known without fetching the file. */
	durationMs: number | null;
	channels: number | null;
}

/**
 * Gugelhupf Samples - browse Strudel's sample maps, hear them, drag them out.
 *
 * THE PREVIEW plays through the TRACK: under jweb~ the page's Web Audio output is
 * the device's signal path (the `webaudio` chain), so an AudioBufferSourceNode here
 * is heard past the fader and the monitor cue like any other device. The [buffer~]/
 * [groove~] round-trip this device used to need is gone with [jweb]'s missing signal
 * outlets (doc/DRAWER_OF_FAILED_IDEAS.md).
 *
 * The DOWNLOAD stays: auditioning still writes the file next to the device
 * (saveToFile, the `download` chain's [maxurl] atomic place), because the file on
 * disk is the drag-out handle. One fetch feeds both: the bytes are decoded for
 * playback AND saved for the library.
 *
 * WHICH IS WHY THERE IS NO "DOWNLOAD" BUTTON. There used to be one, next to a play
 * button, and the pair was a lie: previewing a sample downloads it, permanently, to
 * the same folder - there is no other way to hear it. Two buttons implied two
 * outcomes. So auditioning IS acquiring, a row is a single click (or an arrow key),
 * and what you get afterwards is a HANDLE ON THE FILE: drag it into a Simpler, a Drum
 * Rack, or a track.
 */
export default function App() {
	const [mapUrl, setMapUrl] = useState(PRESET_MAPS[0].url);
	const [loading, setLoading] = useState(false);
	const [sounds, setSounds] = useState<Sound[]>([]);
	const [query, setQuery] = useState("");
	const [rows, setRows] = useState<Record<string, RowState>>({});
	/** The row the keyboard is on, and the row that is sounding: the same row. Moving
	 *  the cursor auditions - that is the whole interaction. */
	const [cursor, setCursor] = useState(0);
	const [playing, setPlaying] = useState<string | null>(null);
	const [status, setStatus] = useState("Loading...");
	const [folder, setFolder] = useState<string | null>(null);
	/** Whether anything has been fetched this session - the "Copy folder path" button has
	 *  nothing to reveal until then, and the folder itself does not exist yet. */
	const [downloaded, setDownloaded] = useState(false);
	const [showAbout, setShowAbout] = useState(false);
	/** The custom-map secondary screen. Picking "Custom..." opens it; Cancel/back close it. */
	const [showCustom, setShowCustom] = useState(false);

	const transport = useTransport();
	/** Paths already fetched in this session, so re-auditioning does not re-download.
	 *  The file outlives the session; this only remembers what we know is there. */
	const onDisk = useRef(new Set<string>());
	/** Decoded audio per path, so re-auditioning replays from memory. */
	const decoded = useRef(new Map<string, Awaited<ReturnType<typeof decodeSample>>>());
	/** Stop function of the currently sounding voice, if any. */
	const voice = useRef<(() => void) | null>(null);
	/** The pending "play on the grid" timer, so moving the cursor twice quickly plays
	 *  the second sample, not both. */
	const armed = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** The loop: once the first hit lands on the grid, re-fire every whole number of
	 *  bars that contains the sample, so the preview repeats IN TIME with the track. */
	const looper = useRef<ReturnType<typeof setInterval> | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	/** Silence and unschedule whatever is playing. Both timers, always together: a
	 *  stray interval is a preview that will not stop. */
	const clearPreview = useCallback(() => {
		if (armed.current) clearTimeout(armed.current);
		if (looper.current) clearInterval(looper.current);
		armed.current = null;
		looper.current = null;
		voice.current?.();
		voice.current = null;
	}, []);

	useEffect(() => {
		onDeviceFolder(setFolder);
		uiReady();
		return clearPreview; // a device view that goes away must not leave a loop running
	}, [clearPreview]);

	/** The downloads folder on the clipboard. `samples/` is where localPath() puts every
	 *  file, so that subfolder is the useful path here - not the device folder itself. */
	const copyFolder = useCallback(async () => {
		if (!folder) return;
		const path = `${folder}/samples`;
		setStatus(copyMessage(await copyPath(path), path));
	}, [folder]);

	/** The list actually on screen. The cursor indexes THIS, not the catalog: a
	 *  filtered list whose arrow keys walked the unfiltered one would be unusable. */
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? sounds.filter((s) => s.name.toLowerCase().includes(q)) : sounds;
	}, [sounds, query]);

	/**
	 * Fetch a map and show its sounds. There is no Load BUTTON any more - picking a map
	 * from the dropdown (or committing one on the custom screen) loads it at once, which
	 * is what "load" always meant. A button that only repeated the dropdown's own choice
	 * was a step with nothing behind it.
	 */
	const load = useCallback(
		async (url: string) => {
			clearPreview();
			setPlaying(null);
			setMapUrl(url);
			setLoading(true);
			setSounds([]);
			setQuery("");
			setStatus(`Loading ${url}...`);
			try {
				const found = await loadSampleMap(url);
				setSounds(found);
				setRows(
					Object.fromEntries(
						found.map((s) => [s.name, { n: 0, path: null, durationMs: null, channels: null }]),
					),
				);
				setCursor(0);
				const playable = found.filter((s) => s.urls.some(isPlayable)).length;
				setStatus(
					playable === found.length
						? `${found.length} sounds. Click a row (or use the arrow keys) to hear it.`
						: `${found.length} sounds - ${found.length - playable} cannot be previewed (not WAV/AIFF)`,
				);
			} catch (err) {
				setStatus(`Error: ${message(err)}`);
			} finally {
				setLoading(false);
			}
		},
		[clearPreview],
	);

	// Load the default map on open, so the device shows something to click rather than an
	// empty list and an instruction. Once - the ref guards React 18's double-mount in dev.
	const booted = useRef(false);
	useEffect(() => {
		if (booted.current) return;
		booted.current = true;
		void load(PRESET_MAPS[0].url);
	}, [load]);

	/**
	 * Hear a sound: fetch it if it is not already here, read it into the buffer, start it
	 * on the user's grid, and LOOP it in time with the track.
	 *
	 * This is also the download. There is no separate one, and there is no undoing it -
	 * which is fine, because a sample you listened to is a sample you were considering.
	 *
	 * THE LOOP is what makes this a preview "in the context of a track" rather than a
	 * one-shot audition: it repeats every whole number of bars that CONTAINS the sample.
	 * A 1 s hit at a 0.6 s/bar tempo loops every 2 bars (1.2 s), so it always restarts on
	 * a downbeat and never chops itself off mid-tail. `groove~` itself is a one-shot
	 * (`@loop 0` in the library chain), so the repeat is ours: the first hit lands on the
	 * grid, and an interval re-fires it from there.
	 */
	const audition = useCallback(
		async (sound: Sound, n: number) => {
			const url = variationUrl(sound, n);
			// decodeAudioData reads more than [buffer~] ever did, but the gate stays: a
			// format the map should not carry is still worth saying no to up front.
			if (!isPlayable(url)) {
				setStatus(`Cannot preview ${sound.name}: not WAV/AIFF (${extLabel(url)})`);
				return;
			}
			clearPreview();
			setPlaying(sound.name);
			const path = localPath(sound, n, mapUrl);
			try {
				let s = decoded.current.get(path);
				if (!s) {
					setStatus(`Fetching ${sound.name}:${n}...`);
					// Deadlined, so no network cannot leave the row on "Fetching..." forever.
					const bytes = await withDeadline(
						fetch(url).then((r) => {
							if (!r.ok) throw new Error(`HTTP ${r.status}`);
							return r.arrayBuffer();
						}),
						30_000,
						`Download of ${sound.name}:${n}`,
					);
					s = await decodeSample(bytes);
					decoded.current.set(path, s);
					// The same bytes go to disk too - the file is the drag-out handle. Not
					// awaited before playing: the preview should not wait on the disk.
					if (!onDisk.current.has(path)) {
						void saveToFile(path, bytes)
							.then(() => {
								onDisk.current.add(path);
								setDownloaded(true);
								setRows((r) => ({ ...r, [sound.name]: { ...r[sound.name], path } }));
							})
							.catch((err) => setStatus(`Saved nothing: ${message(err)}`));
					}
				}
				setRows((r) => ({
					...r,
					[sound.name]: {
						...r[sound.name],
						n,
						path: onDisk.current.has(path) ? path : r[sound.name]?.path ?? null,
						durationMs: s.durationMs,
						channels: s.channels,
					},
				}));

				// Round the sample up to whole bars, so the loop restarts on a downbeat.
				const barMs = transport.barMs();
				const loopBars = Math.max(1, Math.ceil(s.durationMs / barMs));
				const periodMs = loopBars * barMs;
				const wait = transport.msUntilGrid();

				setStatus(
					`${sound.name}:${n} - ${fmtMs(s.durationMs)}, ` +
						`${s.channels === 1 ? "mono" : `${s.channels} ch`} - loop ${loopBars} bar${loopBars === 1 ? "" : "s"}`,
				);
				// First hit on the grid; the loop is anchored to it, so every repeat lands on
				// a bar line too. setInterval drifts over minutes, which no audition lasts.
				const fire = () => {
					voice.current?.();
					voice.current = playBuffer(s!.buffer);
				};
				armed.current = setTimeout(() => {
					fire();
					looper.current = setInterval(fire, periodMs);
				}, wait);
			} catch (err) {
				setPlaying(null);
				setStatus(`Error: ${message(err)}`);
			}
		},
		[mapUrl, transport, clearPreview],
	);

	/** Move the cursor, and audition what it lands on. The cursor IS the preview. */
	const moveCursor = useCallback(
		(to: number) => {
			if (!shown.length) return;
			const i = Math.max(0, Math.min(shown.length - 1, to));
			setCursor(i);
			const sound = shown[i];
			void audition(sound, rows[sound.name]?.n ?? 0);
			listRef.current?.querySelectorAll("tr")[i]?.scrollIntoView({ block: "nearest" });
		},
		[shown, rows, audition],
	);

	/** The variation arrows: change WHICH take, and audition it - same interaction. */
	const stepVariation = (sound: Sound, delta: number) => {
		const n = ((rows[sound.name]?.n ?? 0) + delta + sound.urls.length) % sound.urls.length;
		setRows((r) => ({
			...r,
			[sound.name]: { ...r[sound.name], n, path: null, durationMs: null, channels: null },
		}));
		void audition(sound, n);
	};

	const stop = useCallback(() => {
		clearPreview();
		setPlaying(null);
	}, [clearPreview]);

	/**
	 * The arrow keys, from ANYWHERE in the device - not only the search box.
	 *
	 * A window listener, because the list rows are not focusable and Live's device view
	 * has nowhere natural for keyboard focus to sit. A <select> is left alone (its own
	 * arrows change the option), and so is a secondary screen (there is no list to walk).
	 * The search box is deliberately NOT excluded - typing two letters and then arrowing
	 * through the matches is the whole point of it.
	 */
	useEffect(() => {
		if (showCustom || showAbout) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
			if (document.activeElement?.tagName === "SELECT") return;
			e.preventDefault();
			moveCursor(cursor + (e.key === "ArrowDown" ? 1 : -1));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [moveCursor, cursor, showCustom, showAbout]);

	if (showAbout) {
		return <AboutPanel amxdBuild={__APP_VERSION__} onClose={() => setShowAbout(false)} />;
	}

	if (showCustom) {
		return (
			<CustomMapPanel
				initial={PRESET_MAPS.some((p) => p.url === mapUrl) ? "" : mapUrl}
				onLoad={(url) => {
					setShowCustom(false);
					void load(url);
				}}
				onClose={() => setShowCustom(false)}
			/>
		);
	}

	return (
		<div className="device flex h-full w-full flex-col gap-1.5 bg-background p-2 text-foreground">
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>
					Strudel Samples
				</button>
				{/* Picking a map loads it - there is no Load button. "Custom..." is not a URL;
				    it opens a screen of its own, because a free-text field wedged in next to
				    two presets never made it clear which one was live. The `value` shows the
				    custom entry whenever the active map is not one of the presets. */}
				<select
					value={PRESET_MAPS.some((p) => p.url === mapUrl) ? mapUrl : CUSTOM}
					onChange={(e) => {
						if (e.target.value === CUSTOM) setShowCustom(true);
						else void load(e.target.value);
					}}
					disabled={loading}
					className="ml-auto flex-1 rounded bg-input/50 px-1 py-0.5 disabled:opacity-60"
				>
					{PRESET_MAPS.map((p) => (
						<option key={p.url} value={p.url}>
							{p.label}
						</option>
					))}
					<option value={CUSTOM}>
						{PRESET_MAPS.some((p) => p.url === mapUrl) ? "Custom..." : `Custom: ${mapUrl}`}
					</option>
				</select>
			</div>

			{/* Search. A sample map is 100+ sounds and the device view is ~169 px: without
			    this, finding "cp" means scrolling past everything that is not "cp". */}
			<div className="flex items-center gap-1 text-[11px]">
				<div className="flex flex-1 items-center gap-1 rounded bg-input/40 px-1.5">
					<Search className="size-3 shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setCursor(0);
						}}
						placeholder="Search sounds - arrow keys to audition"
						className="w-full bg-transparent py-0.5 outline-none"
					/>
				</div>
				{playing && <Button icon={Square} onClick={stop} title="Stop the preview" />}
			</div>

			<div ref={listRef} className="min-h-12 flex-1 overflow-y-auto rounded-md bg-input/20">
				{sounds.length === 0 ? (
					<div className="p-2 text-[11px] text-muted-foreground">
						{loading ? "Loading..." : "No sounds in this map."}
					</div>
				) : shown.length === 0 ? (
					<div className="p-2 text-[11px] text-muted-foreground">Nothing matches "{query}".</div>
				) : (
					<table className="w-full text-[11px]">
						<tbody>
							{shown.map((sound, i) => {
								const row = rows[sound.name] ?? { n: 0, path: null, durationMs: null, channels: null };
								const playable = isPlayable(variationUrl(sound, row.n));
								const draggable = Boolean(row.path && folder);
								return (
									<tr
										key={sound.name}
										onClick={() => moveCursor(i)}
										// The WHOLE ROW is the drag source once the sample is on disk - not a
										// tiny handle you have to aim for. A click still auditions; the browser
										// tells a click from a drag by whether the pointer moved.
										draggable={draggable}
										onDragStart={draggable ? (e) => startFileDrag(e, folder!, row.path!) : undefined}
										className={cn(
											"cursor-pointer border-b border-input/30 last:border-0 hover:bg-input/40",
											i === cursor && "bg-input/60",
											playing === sound.name && "text-primary",
											!playable && "opacity-40",
										)}
										title={
											playable
												? "Click to hear it. Once loaded, drag the row out to a track."
												: "WAV/AIFF only"
										}
									>
										<td className="px-1.5 py-1 font-mono">
											{sound.name}
											{sound.pitched && (
												<span className="ml-1 rounded bg-accent/40 px-1 text-[9px] text-accent-foreground">
													pitched
												</span>
											)}
										</td>

										{/* The duration, once we know it - and we only know it by fetching the
										    file and asking [info~]. There is NO one-shot/loop flag in a sample
										    map, so length is the only honest signal, and it is shown as one. */}
										<td className="px-1 py-1 text-right font-mono text-muted-foreground">
											{row.durationMs !== null ? fmtMs(row.durationMs) : ""}
											{row.channels === 1 && <span className="ml-1 text-[9px]">mono</span>}
										</td>

										<td className="whitespace-nowrap px-1 py-1 text-right text-muted-foreground">
											<button
												onClick={(e) => {
													e.stopPropagation();
													stepVariation(sound, -1);
												}}
												className="rounded px-0.5 hover:bg-input/50"
												title="Previous variation"
											>
												<ChevronLeft className="size-3" />
											</button>
											{row.n + 1}/{sound.urls.length}
											<button
												onClick={(e) => {
													e.stopPropagation();
													stepVariation(sound, 1);
												}}
												className="rounded px-0.5 hover:bg-input/50"
												title="Next variation"
											>
												<ChevronRight className="size-3" />
											</button>
										</td>

										{/* A grip, purely as an affordance: it says "this row can be dragged". It
										    is NOT a link - an <a href="file://..."> here navigated the whole jweb
										    view to the file (a browser file page, with its own transport), and the
										    only way back was a right-click menu. The row's own draggable does the
										    work; this just shows where. */}
										<td className="w-5 px-1 py-1 text-muted-foreground">
											{draggable && <GripVertical className="size-3 cursor-grab" />}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>

			<div className="flex items-center gap-2">
				<span className="flex-1 truncate text-[10px] text-muted-foreground" title={status}>
					{status}
				</span>
				{/* The answer to "where did my sample go": neither the page nor Max can open a
				    file manager (doc/TODO.md item 1), so the path goes on the clipboard to
				    paste into one. Enabled once a sample is on disk - before that the folder
				    does not exist. The drag-into-Live alternative was tried and failed
				    (doc/DRAWER_OF_FAILED_IDEAS.md). */}
				<Button
					icon={ClipboardCopy}
					onClick={copyFolder}
					disabled={!downloaded || !folder}
					title={
						downloaded
							? "Copy the samples folder path to the clipboard, to paste into Explorer/Finder"
							: "Audition a sample first - the folder appears once something is downloaded"
					}
				/>
			</div>
		</div>
	);
}

/**
 * Live's transport and its grid: when a preview is allowed to start.
 *
 * `tick` arrives ~20x a second, which is not often enough to schedule against on its
 * own - so it is a FIX, not a clock: the last known beat position and when it was
 * heard, extrapolated forward with the tempo. That is what the deleted node process
 * did with the same two messages, and it is the same 5-10 ms of jitter, which is fine
 * for auditioning; it just no longer needs a process to live in.
 *
 * The GRID is Live's own `clip_trigger_quantization`, forwarded by the wrapper. The
 * user already answered "when should things start?" in the transport bar, and a device
 * that invents a second answer to that question is a device fighting the set.
 */
function useTransport() {
	const fix = useRef({ beats: 0, at: Date.now(), playing: false, bpm: 120, quant: DEFAULT_QUANT });

	useEffect(() => {
		bindInlet(IN.tick, (playing, beats) => {
			fix.current = { ...fix.current, beats: Number(beats), playing: Number(playing) >= 0.5, at: Date.now() };
		});
		bindInlet(IN.tempo, (bpm) => {
			if (Number(bpm) > 0) fix.current.bpm = Number(bpm);
		});
		bindInlet(IN.quantization, (q) => {
			fix.current.quant = Number(q);
		});
	}, []);

	const msUntilGrid = useCallback(() => {
		const t = fix.current;
		const elapsedBeats = ((Date.now() - t.at) / 1000) * (t.bpm / 60);
		return msUntilNextBoundary({ beats: t.beats + elapsedBeats, playing: t.playing, bpm: t.bpm }, t.quant);
	}, []);

	/** One bar in milliseconds, at the current tempo. The loop rounds to a whole of it. */
	const barMs = useCallback(() => (BEATS_PER_BAR * 60000) / fix.current.bpm, []);

	return useMemo(() => ({ msUntilGrid, barMs }), [msUntilGrid, barMs]);
}

/**
 * Put a downloaded sample onto a drag, in every shape a drop target might read.
 *
 * SPIKE CLOSED - FAILED (doc/DRAWER_OF_FAILED_IDEAS.md): [jweb]'s CEF hands an HTML5 drag
 * to the OS as TEXT, but strips the `DownloadURL` payload, so no real file ever drops into
 * Live's audio lane (and LOM has no create-audio-clip). Parked for good; **Copy folder path** is
 * the shipping answer. This drag stays as a best-effort text handoff (a native Windows path
 * on `text/plain`, the `file://` URI on `text/uri-list`) - harmless where it lands as text,
 * never a clip.
 */
function startFileDrag(e: React.DragEvent, folder: string, relPath: string): void {
	const url = fileUrl(folder, relPath);
	const abs = absPath(folder, relPath);
	e.dataTransfer.setData("text/uri-list", url);
	// A native Windows path (backslashes), the shape a Windows file drop target reads.
	// notepad accepted the forward-slash form; Live did not - a drop target is stricter
	// than a text field, so hand it the OS-native path.
	e.dataTransfer.setData("text/plain", winPath(abs));
	e.dataTransfer.effectAllowed = "copy";
}

/** An absolute path in native Windows form: backslashes, no leading slash. */
function winPath(abs: string): string {
	return abs.replace(/\//g, "\\").replace(/^\\+/, "");
}

/** The device's folder is absolute and may contain spaces; a URL must encode them. */
function fileUrl(folder: string, relPath: string): string {
	return encodeURI("file:///" + absPath(folder, relPath).replace(/^\/+/, ""));
}

function absPath(folder: string, relPath: string): string {
	return folder + "/" + relPath;
}

function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function extLabel(url: string): string {
	const dot = url.split(/[?#]/)[0].lastIndexOf(".");
	return dot < 0 ? "that format" : url.slice(dot).split(/[?#]/)[0];
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

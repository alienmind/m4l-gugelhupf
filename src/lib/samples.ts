/**
 * samples.ts - Strudel's sample-map universe, resolved in the PAGE.
 *
 * This is the catalog half of the sample browser: turn `github:tidalcycles/dirt-samples`
 * or `shabda:piano` into a list of sounds and the absolute URLs behind them. It used
 * to live in a [node.script] process, for one reason only - nothing else in the stack
 * could reach the network. [jweb] is Chromium and has always had fetch(); the catalog
 * is small JSON and it belongs in the UI that renders it.
 *
 * The pseudo-URL resolution is ported from strudel/packages/superdough/sampler.mjs
 * (`processSampleMap`). Keep it in step by hand; it is tiny.
 *
 * WHAT IS NOT HERE: downloading, and playing. Those cannot happen in the page - the
 * file has to be on DISK for Max to read it ([maxurl] writes it), and audio the page
 * plays for itself goes to the OS output device rather than through the track. See
 * doc/ARCHITECTURE.md section 3d.
 */

/** A sound in a sample map: a name, and the variations behind it. */
export interface Sound {
	name: string;
	/** Absolute URLs, one per variation - `bd:3` is `urls[3]`. */
	urls: string[];
	/** A pitched map (`{ "c3": "piano/c3.wav" }`), where a variation is a NOTE, not a
	 *  timbre. Strudel picks by pitch; the browser only says so. */
	pitched: boolean;
}

/**
 * The formats we will preview, which is SHORTER than the list a sample map may name.
 *
 * This began as [buffer~]'s list (WAV, AIFF, Next/Sun - never MP3), because Max was
 * what played the audio. The page's `decodeAudioData` is more permissive, but the gate
 * stays: these are the formats the sample universe actually ships, an unexpected one
 * is far more likely to be a broken entry than a deliberate MP3, and saying so up front
 * beats a decode error after a download. tidal-drum-machines and dirt-samples are WAV
 * throughout; a shabda result may not be.
 */
const PLAYABLE = [".wav", ".aif", ".aiff", ".au", ".snd"];

export function isPlayable(url: string): boolean {
	const ext = extensionOf(url);
	return PLAYABLE.indexOf(ext) >= 0;
}

/** The file extension of a URL's path, lowercased, with the dot. "" when it has none. */
export function extensionOf(url: string): string {
	const path = url.split(/[?#]/)[0];
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/** `github:user/repo` (branch optional) -> the raw.githubusercontent base for it. */
export function githubUrl(pseudo: string, subpath = ""): string {
	let p = pseudo.split("github:")[1] ?? "";
	if (p.endsWith("/")) p = p.slice(0, -1);
	// user/repo -> user/repo/main. A bare pair names no branch, and raw.
	// githubusercontent needs one.
	if (p.split("/").length === 2) p += "/main";
	return `https://raw.githubusercontent.com/${p}/${subpath}`;
}

/**
 * The tidal-drum-machines catalog - strudel's own `bank()` universe.
 *
 * A single strudel.json whose keys are `<Machine>_<sound>` (`AkaiLinn_bd`,
 * `RolandTR909_hh`), the shape strudel's `bank()` control resolves against:
 * `s("bd").bank("RolandTR909")` looks up `RolandTR909_bd`. This is the generated
 * catalog strudel.cc itself loads (felixroos/dough-samples); its `_base` points at the
 * machine WAVs in geikha/tidal-drum-machines. loadSampleMap() reads it like any other
 * map - the names just happen to carry a bank prefix, which banksOf()/soundKey() split.
 */
export const DRUM_MACHINES_URL = "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json";

/** The sample name a bank + sound resolve to: strudel's `<bank>_<sound>` convention. */
export function soundKey(bank: string, sound: string): string {
	return `${bank}_${sound}`;
}

/** The distinct BANKS (machine prefixes) in a drum-machine catalog, sorted. A key is
 *  `<Machine>_<sound>`; the bank is everything before the LAST underscore, because a
 *  sound name never contains one but a machine name can (`RolandTR808`, none do today,
 *  but split on the last `_` keeps `AkaiMPC60_bd` -> `AkaiMPC60`). */
export function banksOf(sounds: Sound[]): string[] {
	const set = new Set<string>();
	for (const s of sounds) {
		const cut = s.name.lastIndexOf("_");
		if (cut > 0) set.add(s.name.slice(0, cut));
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

/** The sound token of a `<bank>_<sound>` key (`AkaiLinn_bd` -> `bd`). */
export function soundToken(name: string): string {
	const cut = name.lastIndexOf("_");
	return cut > 0 ? name.slice(cut + 1) : name;
}

/** The URL a pseudo-URL's catalog JSON actually lives at. */
export function catalogUrl(pseudo: string): string {
	const url = pseudo.trim();
	if (url.startsWith("github:")) return githubUrl(url, "strudel.json");
	if (url.startsWith("shabda:")) return `https://shabda.ndre.gr/${url.split("shabda:")[1]}.json?strudel=1`;
	return url;
}

/**
 * A strudel.json map -> the sounds in it, with absolute URLs.
 *
 * Values come in three shapes, and all three are real: a list of files, a single
 * file, or an object keyed by note (a PITCHED map - a piano, where each variation is
 * a different pitch rather than a different take). Keys starting with `_` are
 * metadata (`_base`), not sounds.
 */
export function parseSampleMap(json: Record<string, unknown>, base: string): Sound[] {
	const sounds: Sound[] = [];
	for (const [name, value] of Object.entries(json)) {
		if (name.startsWith("_")) continue;
		if (Array.isArray(value)) {
			sounds.push({ name, urls: value.map((u) => base + String(u)), pitched: false });
		} else if (typeof value === "string") {
			sounds.push({ name, urls: [base + value], pitched: false });
		} else if (value && typeof value === "object") {
			const urls = Object.values(value as Record<string, unknown>)
				.flat()
				.map((u) => base + String(u));
			sounds.push({ name, urls, pitched: true });
		}
	}
	return sounds;
}

/**
 * Fetch and parse a sample map. `_base` in the JSON wins; otherwise the catalog's own
 * folder is the base, which is how a relative `bd/BT0A0A7.wav` resolves.
 *
 * TIME-LIMITED, because there is no network to promise otherwise. `fetch()` does not
 * block jweb's UI thread - it is a promise - but with no route to the host it can hang
 * for the OS connect timeout (a minute or more), and a device that says "Loading..."
 * for a minute reads as broken. An AbortController turns that into a clean, fast failure
 * the UI can report.
 */
export async function loadSampleMap(pseudo: string, timeoutMs = 12_000): Promise<Sound[]> {
	const url = catalogUrl(pseudo);
	const res = await fetchWithTimeout(url, timeoutMs);
	if (!res.ok) throw new Error(`${res.status} loading ${url}`);
	const json = (await res.json()) as Record<string, unknown>;
	const base = typeof json._base === "string" ? json._base : url.split("/").slice(0, -1).join("/") + "/";
	return parseSampleMap(json, base);
}

/**
 * `fetch()` with a deadline, since the platform's has none.
 *
 * A bare `fetch()` to an unreachable host does not reject promptly - it waits out the
 * OS-level connect timeout - so every caller here goes through this. AbortController is
 * the supported way to cut a fetch short; the abort surfaces as a rejected promise, which
 * is what the callers already handle. This does NOT unblock the UI thread (the thread was
 * never blocked - fetch is async); it bounds how long a caller waits before it can say so.
 */
export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} catch (err) {
		// A timeout and a real network failure land here alike; name the timeout so the
		// UI can tell "offline" from "404".
		if (err instanceof DOMException && err.name === "AbortError") {
			throw new Error(`no response in ${Math.round(timeoutMs / 1000)}s (offline?): ${url}`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Race a promise against a deadline, for the ones that cannot be aborted.
 *
 * `saveToFile()` crosses the bridge into Max, and there is no handle to cancel a
 * `[maxurl]` request in flight. So this does not STOP the work - it stops the app
 * WAITING on it, which is the part the user sees: a row stuck on "Fetching..." with no
 * network unsticks, the status can say "offline", and the list stays usable. If the
 * abandoned work does eventually finish, its resolver falls on the floor harmlessly
 * (see the bridge). The UI thread was never blocked; this bounds the wait.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label}: no response in ${Math.round(ms / 1000)}s (offline?)`)),
			ms,
		);
	});
	return Promise.race([p, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Where a variation lands on disk, RELATIVE to the device's folder.
 *
 * Relative, and that is the contract: saveToFile() writes next to the .amxd, and the
 * wrapper resolves the relative path on the Max side. Build an absolute path in the
 * app instead and the two will not agree - the app cannot know where Live put the
 * device, and a real install has spaces in that path ("Ableton Library"), which a Max
 * message would split into atoms.
 *
 * FLAT, with the pack folded into the filename. A save's destination cannot be a
 * subdirectory at all: the wrapper writes the `.part` through `[js]`'s `File` and
 * places it through `[maxurl]`, and the two resolve `samples/x.wav` to different
 * places, so the place finds nothing and reports `-1 bytes`. This wrote to
 * `samples/<pack>/` for a long time and every download failed at that last step.
 *
 * The extension is carried over from the URL, not assumed: renaming an .aiff to .wav
 * on the way to disk helps nobody who later opens it.
 */
export function localPath(sound: Sound, n: number, pseudo: string): string {
	const pack = pseudo.replace(/[^a-z0-9-]+/gi, "_");
	const safe = sound.name.replace(/[^a-z0-9-]+/gi, "_");
	const i = n % sound.urls.length;
	return `${pack}_${safe}_${i}${extensionOf(sound.urls[i]) || ".wav"}`;
}

/** The URL of variation `n` of a sound - `bd:3`, wrapping like Strudel's own `n`. */
export function variationUrl(sound: Sound, n: number): string {
	return sound.urls[n % sound.urls.length];
}

/* ------------------------------------------------------------------ *
 * When a preview starts
 * ------------------------------------------------------------------ */

/**
 * Live's `clip_trigger_quantization`, in BEATS.
 *
 * The preview launches on the grid the USER already chose, in Live's transport bar -
 * not on a grid this device invented. If they have set `1 Bar`, a clip waits for the
 * downbeat and so should an audition; if they have set `None`, they want it now.
 *
 * The property is an ENUM INDEX, not a duration - `4` means "1 Bar", not four of
 * anything - and the order is Live's own, from its LOM reference. Do not rearrange it
 * or read a number out of it: index 1 is EIGHT bars, and getting this backwards makes
 * the shortest setting the longest wait.
 *
 * Beats, not bars, because that is the unit `tick` reports. The bar-length entries
 * assume 4/4, as Live's own defaults do.
 */
const QUANT_BEATS = [
	0, //  0  None
	32, //  1  8 Bars
	16, //  2  4 Bars
	8, //  3  2 Bars
	4, //  4  1 Bar
	2, //  5  1/2
	4 / 3, //  6  1/2T
	1, //  7  1/4  - a beat
	2 / 3, //  8  1/4T
	0.5, //  9  1/8
	1 / 3, // 10  1/8T
	0.25, // 11  1/16
	1 / 6, // 12  1/16T
	0.125, // 13  1/32
];

/** Live's default is 1 Bar, and so is ours when nothing has told us otherwise. */
export const DEFAULT_QUANT = 4;

export function quantBeats(index: number): number {
	return QUANT_BEATS[Math.round(index)] ?? 0;
}

/**
 * How long to wait before playing, so the sample lands on the user's grid.
 *
 * With the transport stopped there is no grid to land on, and with quantization set
 * to None there is no grid at all: both mean "now". The small floor is not a delay,
 * it is the message reaching Max.
 */
export function msUntilNextBoundary(
	now: { beats: number; playing: boolean; bpm: number },
	quantIndex: number,
): number {
	const grid = quantBeats(quantIndex);
	if (!now.playing || grid <= 0) return 30;
	const msPerBeat = 60000 / now.bpm;
	// The next multiple of the grid, strictly ahead: a preview fired exactly ON a
	// boundary must wait for the NEXT one, not fire twice.
	const next = Math.floor(now.beats / grid + 1e-9) * grid + grid;
	return Math.max(10, (next - now.beats) * msPerBeat);
}

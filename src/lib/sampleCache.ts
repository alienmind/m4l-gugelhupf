/**
 * sampleCache.ts - a persistent, page-side cache in front of `fetch()`.
 *
 * WHY IT EXISTS (doc/TODO.md item 2). There is no render step any more: superdough
 * fetches its samples at PLAY time, so a device with no network plays synths and goes
 * silent on every `s("bd")`. Reading the bytes back off disk is not an option either -
 * Chromium blocks `fetch()` of `file://` - so the only storage a device page can reach
 * is the browser's own. jweb IS Chromium, so it has that storage; whether the CEF
 * profile keeps it across a Live restart is the one thing this file cannot decide for
 * itself (see the spike note at the bottom).
 *
 * WHAT IT DOES. `installSampleCache()` wraps the global `fetch`. Sample bytes are
 * served CACHE FIRST - a sample at a given URL is immutable in practice, and a hit
 * costs no network at all, which is as good for a slow connection as it is for none.
 * Sample MAPS (the .json manifests) are fetched NETWORK FIRST and fall back to the
 * cache, so a map that gains sounds upstream is not pinned to whatever was stored
 * first. Everything else passes straight through untouched.
 *
 * WHAT IT REFUSES TO DO. It never turns a failure into a silent success and it never
 * throws out of the wrapper: every storage operation is wrapped, and a broken (or
 * disabled, or partitioned) IndexedDB degrades to an in-memory cache for the session.
 * A cache that can take the page down with it is worse than no cache.
 */

/** IndexedDB names. Bumping the version drops nothing - the store is keyed by URL. */
const DB_NAME = "m4l-gugelhupf-cache";
const DB_VERSION = 1;
const STORE = "responses";

/** What a cached response is: the bytes, plus enough to rebuild a usable Response. */
interface CachedResponse {
	url: string;
	body: ArrayBuffer;
	type: string;
	stored: number;
}

/** Audio, by extension - the immutable half, served cache first. */
const AUDIO_RE = /\.(wav|mp3|ogg|flac|m4a|aif|aiff|opus|webm)(\?.*)?$/i;
/** Sample maps - refreshed when the network allows, served from the cache when not. */
const MAP_RE = /\.json(\?.*)?$/i;

type Mode = "audio" | "map" | "passthrough";

function classify(url: string): Mode {
	if (!/^https?:/i.test(url)) return "passthrough";
	if (AUDIO_RE.test(url)) return "audio";
	if (MAP_RE.test(url)) return "map";
	return "passthrough";
}

/* ------------------------------------------------------------------ *
 * Storage: IndexedDB, with an in-memory stand-in
 * ------------------------------------------------------------------ */

/** The session fallback. Also the read-through cache for IDB hits, so a repeated
 *  sample in one pattern does not go back to storage on every hap. */
const memory = new Map<string, CachedResponse>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** Whether persistent storage is actually working, for the UI note and the spike. */
let persistent = false;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase | null>((resolve) => {
		try {
			if (typeof indexedDB === "undefined") return resolve(null);
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "url" });
			};
			req.onsuccess = () => {
				persistent = true;
				resolve(req.result);
			};
			req.onerror = () => resolve(null);
			// A `file://` origin can leave the request hanging rather than failing: without
			// this the first sample would wait forever instead of just going to the network.
			setTimeout(() => resolve(persistent ? req.result : null), 3000);
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
}

async function readStored(url: string): Promise<CachedResponse | null> {
	const hit = memory.get(url);
	if (hit) return hit;
	const db = await openDb();
	if (!db) return null;
	return new Promise<CachedResponse | null>((resolve) => {
		try {
			const req = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
			req.onsuccess = () => {
				const value = req.result as CachedResponse | undefined;
				if (value) memory.set(url, value);
				resolve(value ?? null);
			};
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/** The memory half, SYNCHRONOUS - and that matters. Storing only after IndexedDB had
 *  settled left a window in which the same sample, asked for twice in quick succession
 *  (which is what a pattern does), went to the network twice and cached neither in
 *  time. The memory copy lands the moment the bytes exist; the disk copy follows. */
function cacheNow(entry: CachedResponse): void {
	memory.set(entry.url, entry);
	void writeStored(entry);
}

async function writeStored(entry: CachedResponse): Promise<void> {
	const db = await openDb();
	if (!db) return;
	try {
		db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
	} catch {
		/* the memory copy still stands */
	}
}

/** Rebuild a Response from stored bytes. `slice()` because a body can only be read
 *  once and the same sample is fetched again on the next pattern. */
function toResponse(entry: CachedResponse): Response {
	return new Response(entry.body.slice(0), {
		status: 200,
		statusText: "OK (cached)",
		headers: { "content-type": entry.type || "application/octet-stream" },
	});
}

/* ------------------------------------------------------------------ *
 * The wrapper
 * ------------------------------------------------------------------ */

let installed = false;

export function installSampleCache(): void {
	if (installed || typeof fetch !== "function") return;
	installed = true;
	const original = fetch.bind(globalThis);

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		const mode = method === "GET" ? classify(url) : "passthrough";
		if (mode === "passthrough") return original(input as RequestInfo, init);

		if (mode === "audio") {
			const cached = await readStored(url);
			if (cached) return toResponse(cached);
		}

		try {
			const res = await original(input as RequestInfo, init);
			if (res.ok) {
				// Clone before anyone reads it: the caller gets the live response, the cache
				// gets its own copy, and neither consumes the other's body. The copy is read
				// to completion HERE rather than in a detached promise, so the next request
				// for the same URL - which for a repeating pattern is milliseconds away -
				// already finds it.
				try {
					const copy = res.clone();
					const body = await copy.arrayBuffer();
					cacheNow({ url, body, type: copy.headers.get("content-type") ?? "", stored: Date.now() });
				} catch {
					/* an unreadable body is still a good response for the caller */
				}
				return res;
			}
			const fallback = await readStored(url);
			return fallback ? toResponse(fallback) : res;
		} catch (e) {
			const fallback = await readStored(url);
			if (fallback) return toResponse(fallback);
			throw e;
		}
	};
}

/**
 * What the cache can currently promise, for the device's status line.
 *
 * `persistent` is only true once IndexedDB has actually opened, which is why this is
 * async: asking before the first fetch would always answer "session only".
 *
 * THE SPIKE THIS ANSWERS: store a sample, restart Live, reopen the set, and read
 * `entries` back. A non-zero count on a cold start is the proof that jweb's CEF
 * profile persists page storage - and with it, that TODO item 2 needs no bridge-side
 * `readFile` at all.
 */
export async function sampleCacheStatus(): Promise<{ persistent: boolean; entries: number }> {
	const db = await openDb();
	if (!db) return { persistent: false, entries: memory.size };
	return new Promise((resolve) => {
		try {
			const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
			req.onsuccess = () => resolve({ persistent: true, entries: Number(req.result) });
			req.onerror = () => resolve({ persistent: true, entries: 0 });
		} catch {
			resolve({ persistent: false, entries: memory.size });
		}
	});
}

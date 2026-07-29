import { describe, expect, it } from "vitest";
import {
	catalogUrl,
	extensionOf,
	githubUrl,
	isPlayable,
	localPath,
	msUntilNextBoundary,
	parseSampleMap,
	quantBeats,
	variationUrl,
	withDeadline,
	type Sound,
} from "../samples";

/**
 * The catalog, which used to be a [node.script] process and is now a module in the
 * page. Moving it here is what makes it testable at all: none of this was under test
 * before, because it only ran inside Node for Max inside Live.
 */

describe("pseudo-URLs", () => {
	it("defaults a github map to the main branch", () => {
		expect(githubUrl("github:tidalcycles/dirt-samples")).toBe(
			"https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/",
		);
	});

	it("keeps an explicit branch", () => {
		expect(githubUrl("github:user/repo/dev", "strudel.json")).toBe(
			"https://raw.githubusercontent.com/user/repo/dev/strudel.json",
		);
	});

	it("points a github map at its strudel.json", () => {
		expect(catalogUrl("github:felixroos/dough-samples")).toBe(
			"https://raw.githubusercontent.com/felixroos/dough-samples/main/strudel.json",
		);
	});

	it("turns shabda: into a shabda query", () => {
		expect(catalogUrl("shabda:piano")).toBe("https://shabda.ndre.gr/piano.json?strudel=1");
	});

	it("passes a plain URL through untouched", () => {
		expect(catalogUrl("https://example.com/kit/strudel.json")).toBe("https://example.com/kit/strudel.json");
	});
});

describe("parseSampleMap", () => {
	const base = "https://example.com/kit/";

	it("reads a list of variations", () => {
		const [bd] = parseSampleMap({ bd: ["bd/1.wav", "bd/2.wav"] }, base);
		expect(bd).toEqual({ name: "bd", urls: [`${base}bd/1.wav`, `${base}bd/2.wav`], pitched: false });
	});

	it("reads a lone string as a one-variation sound", () => {
		const [cp] = parseSampleMap({ cp: "cp.wav" }, base);
		expect(cp.urls).toEqual([`${base}cp.wav`]);
	});

	it("flags a note-keyed map as pitched", () => {
		const [piano] = parseSampleMap({ piano: { c3: "piano/c3.wav", e3: "piano/e3.wav" } }, base);
		expect(piano.pitched).toBe(true);
		expect(piano.urls).toEqual([`${base}piano/c3.wav`, `${base}piano/e3.wav`]);
	});

	it("skips metadata keys", () => {
		// `_base` is where the base itself came from. It is not a sound, and shipping
		// it as one would put a row called "_base" in the browser.
		const sounds = parseSampleMap({ _base: base, bd: ["bd.wav"] }, base);
		expect(sounds.map((s) => s.name)).toEqual(["bd"]);
	});
});

describe("what the preview will actually play", () => {
	it("takes WAV and AIFF", () => {
		expect(isPlayable("https://x/bd.wav")).toBe(true);
		expect(isPlayable("https://x/bd.AIFF")).toBe(true);
	});

	it("refuses MP3 and friends - the formats a sample map should not be carrying", () => {
		// The gate is inherited from [buffer~]'s format list and kept on purpose: an
		// unexpected extension in a sample map is far more often a broken entry than a
		// deliberate MP3, and refusing it up front beats a decode error after the download.
		expect(isPlayable("https://x/bd.mp3")).toBe(false);
		expect(isPlayable("https://x/bd.ogg")).toBe(false);
		expect(isPlayable("https://x/bd.flac")).toBe(false);
	});

	it("ignores a query string when reading the extension", () => {
		expect(extensionOf("https://x/bd.wav?token=1")).toBe(".wav");
		expect(isPlayable("https://x/bd.wav?token=1")).toBe(true);
	});

	it("is not fooled by a dot in a directory name", () => {
		expect(extensionOf("https://x/v1.2/bd")).toBe("");
	});
});

describe("launch quantization - Live's grid, not ours", () => {
	// The property is an ENUM INDEX. Index 1 is EIGHT bars and index 7 is a beat; a
	// device that read the number as a duration would make the shortest setting the
	// longest wait. These are Live's own, from the LOM reference.
	it("reads Live's enum, not a number of anything", () => {
		expect(quantBeats(0)).toBe(0); // None
		expect(quantBeats(1)).toBe(32); // 8 Bars
		expect(quantBeats(4)).toBe(4); // 1 Bar - Live's default
		expect(quantBeats(7)).toBe(1); // 1/4, a beat
		expect(quantBeats(11)).toBe(0.25); // 1/16
	});

	const playing = (beats: number) => ({ beats, playing: true, bpm: 120 });

	it("waits for the next bar at Live's default", () => {
		// 120 bpm: a beat is 500 ms. At beat 5.0, the next bar (beat 8) is 3 beats off.
		expect(msUntilNextBoundary(playing(5), 4)).toBeCloseTo(1500);
	});

	it("plays now when quantization is None", () => {
		expect(msUntilNextBoundary(playing(5.4), 0)).toBe(30);
	});

	it("plays now when the transport is stopped - there is no grid to land on", () => {
		expect(msUntilNextBoundary({ beats: 5.4, playing: false, bpm: 120 }, 4)).toBe(30);
	});

	it("waits a WHOLE grid when it is fired exactly on a boundary", () => {
		// Not zero: a preview fired on the downbeat must land on the NEXT one, or it
		// fires immediately and the quantization did nothing.
		expect(msUntilNextBoundary(playing(8), 4)).toBeCloseTo(2000);
	});

	it("scales with the tempo", () => {
		// 60 bpm: a beat is 1000 ms, so the same half-beat wait takes twice as long.
		expect(msUntilNextBoundary({ beats: 3.5, playing: true, bpm: 60 }, 7)).toBeCloseTo(500);
	});
});

describe("offline resilience - a bounded wait, not a blocked thread", () => {
	it("passes a value through when it beats the deadline", async () => {
		await expect(withDeadline(Promise.resolve("loaded"), 1000, "x")).resolves.toBe("loaded");
	});

	it("gives up when the deadline beats the promise, and says offline", async () => {
		// A promise that never settles is exactly the offline case: [maxurl] hanging on a
		// host it cannot reach. The deadline is what unsticks the row.
		await expect(withDeadline(new Promise<never>(() => {}), 10, "Download of bd:0")).rejects.toThrow(
			/offline/,
		);
	});

	it("names the operation in the timeout, so the status line is useful", async () => {
		await expect(withDeadline(new Promise<never>(() => {}), 10, "Download of bd:0")).rejects.toThrow(
			/Download of bd:0/,
		);
	});
});

describe("where a sample lands", () => {
	const sound: Sound = { name: "bd", urls: ["https://x/a.wav", "https://x/b.aiff"], pitched: false };

	it("is a RELATIVE path - the wrapper is the only thing that may resolve it", () => {
		const p = localPath(sound, 0, "github:tidalcycles/dirt-samples");
		expect(p.startsWith("/")).toBe(false);
		expect(p).toBe("github_tidalcycles_dirt-samples_bd_0.wav");
	});

	// Not a style choice. A save whose destination has a separator in it fails the
	// atomic place with `-1 bytes` - [js]'s File and [maxurl] disagree about where a
	// subdirectory is - so every download went missing while this returned `samples/...`.
	it("is FLAT - a subdirectory never survives the place step", () => {
		for (const n of [0, 1, 2]) {
			expect(localPath(sound, n, "github:x/y")).not.toContain("/");
		}
	});

	it("carries the source file's extension over", () => {
		expect(localPath(sound, 1, "github:x/y")).toBe("github_x_y_bd_1.aiff");
	});

	it("wraps the variation index, as `bd:3` does", () => {
		expect(variationUrl(sound, 2)).toBe("https://x/a.wav");
		expect(localPath(sound, 2, "github:x/y")).toBe("github_x_y_bd_0.wav");
	});
});

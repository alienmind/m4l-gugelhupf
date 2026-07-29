/**
 * transport.test.ts - which engine Live's transport drives.
 *
 * Two engines sound into one track and there is one `play` parameter, so the rule that
 * keeps them from playing at once is worth pinning. It is a CLAIM, stored in a slot -
 * deriving it from whether the Studio's pattern was empty meant the only way to hear
 * the scratchpad was to delete the music.
 */
import { describe, expect, test } from "vitest";
import { DEFAULT_OWNER, transportOwner } from "@/app/strudel/transport";

describe("transportOwner", () => {
	test("the slot is the answer when it holds one", () => {
		expect(transportOwner("scratchpad")).toBe("scratchpad");
		expect(transportOwner("studio")).toBe("studio");
	});

	test("a set that predates the slot plays the Studio", () => {
		// The state store hands back the declared default, `{}` from a dict Live has
		// never saved, or nothing at all before the first sync.
		expect(transportOwner(undefined)).toBe(DEFAULT_OWNER);
		expect(transportOwner({})).toBe(DEFAULT_OWNER);
		expect(transportOwner("")).toBe(DEFAULT_OWNER);
	});

	test("a value nobody wrote is not honoured", () => {
		expect(transportOwner("both")).toBe(DEFAULT_OWNER);
		expect(transportOwner(1)).toBe(DEFAULT_OWNER);
	});
});

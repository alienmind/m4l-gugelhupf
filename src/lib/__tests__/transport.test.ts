/**
 * transport.test.ts - which engine Live's transport drives.
 *
 * Two engines sound into one track and there is one `play` parameter, so the rule
 * that keeps them from playing at once is worth pinning: it is the Studio's PATTERN
 * that decides, not its window.
 */
import { describe, expect, test } from "vitest";
import { transportOwner } from "@/app/strudel/transport";

describe("transportOwner", () => {
	test("a Studio holding a pattern owns the transport", () => {
		expect(transportOwner('note("c3 e3")')).toBe("studio");
	});

	test("an emptied Studio hands it to the scratchpad", () => {
		expect(transportOwner("")).toBe("scratchpad");
		// Whitespace is what select-all-and-delete leaves behind, and it is not a pattern.
		expect(transportOwner("  \n\t ")).toBe("scratchpad");
	});

	test("a slot Live has never saved is not a Studio pattern", () => {
		// The state store hands back whatever came out of the set - `{}` on a fresh
		// instance, undefined before the first sync.
		expect(transportOwner(undefined)).toBe("scratchpad");
		expect(transportOwner({})).toBe("scratchpad");
	});
});

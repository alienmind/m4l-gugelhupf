/**
 * transport.ts - which of the device's two engines Live's transport drives.
 *
 * The Strudel device has two engines that both make sound into the same track: the
 * Studio's (the real strudel.cc, the `code` slot) and the device page's scratchpad
 * (the `miniCode` slot). Live's transport is ONE parameter, so before this it started
 * both and the track carried the sum of two patterns.
 *
 * XOR, and the predicate is the Studio's own pattern rather than whether its window
 * happens to be open. A window is closed to see the mixer and opened again a minute
 * later; the pattern is what the set saves and what the musician thinks of as "the
 * music". The Studio's page sounds whether or not its window is showing, so keying on
 * visibility would also mean the audio changed when a window was dragged shut.
 */
export type TransportOwner = "studio" | "scratchpad";

/**
 * Who the transport drives, given what the Studio has in it.
 *
 * The Studio holds a pattern by default (surface.ts's INITIAL_TEXT), so a fresh
 * device is Studio-owned - which is what it already sounded like. The scratchpad
 * takes over only once the Studio has been emptied, and an empty scratchpad then
 * plays nothing, which is the honest result of having written nothing anywhere.
 */
export function transportOwner(studioText: unknown): TransportOwner {
	return typeof studioText === "string" && studioText.trim() ? "studio" : "scratchpad";
}

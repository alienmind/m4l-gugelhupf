/**
 * transport.ts - which of the device's two engines Live's transport drives.
 *
 * The Strudel device has two engines that both make sound into the same track: the
 * Studio's (the real strudel.cc, the `code` slot) and the device page's scratchpad
 * (the `miniCode` slot). Live's transport is ONE parameter, so before this it started
 * both and the track carried the sum of two patterns.
 *
 * XOR, and the owner is WHOEVER WAS STARTED LAST. Pressing Run in the device view
 * gives the transport to the scratchpad; evaluating in the Studio takes it back. It is
 * a saved slot rather than something derived, for a reason measured in Live: the first
 * build derived it from whether the Studio's pattern was empty, which meant the only
 * way to hear the scratchpad was to DELETE the Studio's music. Ownership is a choice
 * the musician makes, so it is stored as one.
 *
 * Not the window's visibility either: a window is shut to see the mixer and opened
 * again a minute later, and the Studio's page sounds whether or not it is showing.
 */
export type TransportOwner = "studio" | "scratchpad";

/** What a set that predates the slot - or a fresh instance - starts as. The Studio is
 *  where the music is, and it is what a device with nothing typed anywhere plays. */
export const DEFAULT_OWNER: TransportOwner = "studio";

/** Read the slot, tolerating anything a set can legitimately hand back. */
export function transportOwner(slot: unknown): TransportOwner {
	return slot === "scratchpad" || slot === "studio" ? slot : DEFAULT_OWNER;
}

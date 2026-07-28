/**
 * protocol.ts (sampler) - every selector that crosses this device's bridge.
 *
 * Almost nothing, and less than it used to be. The sampler's audio work happens
 * entirely in the page since 0.9.9: samples are fetched with `fetch()`, decoded with
 * `decodeAudioData`, and played through the `webaudio` chain's signal path. The
 * `buffer_load` / `voice_play` exchange with a Max-side [poly~] is gone, and with it
 * the samples folder - nothing is DOWNLOADED here any more. What still needs the
 * wrapper is `device_folder`: Export writes a WAV next to the device, and only Max
 * knows where that is. That one is the library's, spread in from FILES_IN - it comes
 * with the files.ts declaration, not from anything typed here.
 *
 * What else crosses the bridge is MIDI in:
 *
 *   onNote(pitch, velocity)         notein                        (midiin chain)
 *
 * The app calls that helper by name; it never types the selector.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN, FILES_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
	...DEVICE_IN,
	...CHAIN_IN,
	...FILES_IN,
} as const;

/** UI -> device. */
export const OUT = {
	...CHAIN_OUT,
	/** UI -> wrapper: page ready; send me the current state. */
	ui_ready: "ui_ready",
} as const;

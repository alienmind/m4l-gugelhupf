/**
 * protocol.ts (sample-browser) - every selector that crosses this device's bridge.
 *
 * There is almost nothing left to declare, and that is the whole story of this
 * release. This device used to own a private protocol - `catalog`, `downloaded`,
 * `progress`, `fetcherr`, `engine_ready`, `preview` - because it talked to a
 * [node.script] process of its own that did the fetching, the downloading and the
 * previewing, and every reply came back base64-encoded through it.
 *
 * Fetching and previewing are the page's own work now - `fetch()` for the bytes,
 * `decodeAudioData` + an AudioBufferSourceNode for the sound, out through the
 * `webaudio` chain's signal path. The only job still crossing the bridge is WRITING
 * the audited file to disk, so it can be dragged into a track: `save_begin` /
 * `save_chunk` / `save_end` / `save_done` (the `download` chain), which CHAIN_OUT and
 * CHAIN_IN carry and `saveToFile()` wraps. The app never types those names.
 *
 * What is left is genuinely this device's own: Live's global scale, which the
 * browser shows so a pitched sample map can be read in the key of the set.
 */
import { CHAIN_IN, CHAIN_OUT, DEVICE_IN, FILES_IN } from "@m4l-jweb/bridge";

/** Device -> UI. */
export const IN = {
	...DEVICE_IN,
	...CHAIN_IN,
	...FILES_IN,
	/**
	 * wrapper -> UI: Live's global clip-trigger quantization, as an ENUM INDEX
	 * (4 = 1 Bar, 0 = None). A preview launches on the grid the user already chose
	 * in the transport bar. See quantBeats() in lib/samples.ts - the index is not a
	 * duration, and reading it as one makes the shortest setting the longest wait.
	 */
	quantization: "quantization",
} as const;

/** There is no `scale` here any more. Live's scale reached this device, was shown in
 *  the corner, and did NOTHING - a preview plays the file untransposed, at rate 1.0.
 *  A badge that implies the set's key affects what you are hearing, when it does not,
 *  is worse than no badge. It belongs to the MIDI device, where degrees are real. */

/** UI -> device. */
export const OUT = {
	...CHAIN_OUT,
	/** UI -> wrapper: page ready; send me the current state. */
	ui_ready: "ui_ready",
} as const;

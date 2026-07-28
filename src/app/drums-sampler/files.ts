/**
 * files.ts - what the Drums Sampler does with disk.
 *
 * Nothing is DOWNLOADED here: the banks are fetched and decoded in the page since
 * 0.9.9, and the [poly~]/[buffer~] slots that once needed files on disk are gone.
 * What remains is Export, which writes a WAV bounce next to the .amxd - so it
 * saves, and needs [maxurl] for the place.
 */
import { defineFiles } from "@m4l-jweb/surface";

export default defineFiles({
	saves: true,
});

/**
 * files.ts - what the sample browser does with disk.
 *
 * It SAVES rather than fetches, and the distinction is real: the page downloads the
 * sample itself (it has to decode the bytes to preview them) and hands the SAME bytes
 * to Max to write. A second trip through [maxurl] would download the file twice.
 *
 * The file on disk is the point - it is what makes a row draggable into a Simpler.
 */
import { defineFiles } from "@m4l-jweb/surface";

export default defineFiles({
	saves: true,
});

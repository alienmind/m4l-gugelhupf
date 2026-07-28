/**
 * files.ts - what the main Strudel device does with disk.
 *
 * Export renders the pattern offline and writes the WAV next to the .amxd, so it
 * SAVES: the page holds the bytes. It fetches nothing - samples are downloaded and
 * decoded in the page's own Chromium, and never touch a file.
 *
 * The `download` chain used to be listed by hand in patcher/devices.mjs with a
 * comment explaining that a device which downloads nothing still needs [maxurl],
 * because a save's last step is a `file://` place through it. That comment is now
 * this declaration.
 */
import { defineFiles } from "@m4l-jweb/surface";

export default defineFiles({
	saves: true,
});

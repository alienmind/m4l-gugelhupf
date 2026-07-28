/**
 * build-ui.mjs - bundle one self-contained UI per device, plus one per WINDOW.
 *
 * Emits dist/ui/<device>/index.html (the device view) and, for every window a
 * device declares in its surface.ts, dist/ui/<device>/<winId>.html. `m4l-jweb
 * build` then embeds all of them into the matching .amxd as base64 payloads.
 *
 * Sequential, not parallel: vite reads DEVICE from the environment, and two
 * concurrent builds would race on it.
 *
 * THE RENAME DANCE around the window builds is load-bearing. Vite always writes
 * its entry as index.html, so a window build lands on top of the device view we
 * just produced - and emptyOutDir cannot be left on for it either (vite.config.ts
 * gates it on WINDOW), or the window build wipes the folder. So the device view
 * is moved aside, the windows are built and renamed one by one, and it is moved
 * back.
 *
 * THE ICON BARREL IS GENERATED FIRST. Each of the runs below parsed ~1785 modules, and
 * 1545 of them were lucide-react's - one module per icon, for the handful a device
 * draws. prebundleDeps() writes a barrel of just the ones in use and M4L_PREBUNDLE
 * points vite.config.ts's alias at it. The per-device split is untouched: a device still
 * ships its own app and none of its siblings', and every bundle comes out the size it
 * was.
 */
import { build } from "vite";
import { loadSurface } from "@m4l-jweb/build/surface";
import { renameSync } from "node:fs";
import path from "node:path";
import { root, uiDirs } from "./devices.mjs";
import { prebundleDeps } from "./prebundle-deps.mjs";

prebundleDeps();
process.env.M4L_PREBUNDLE = "1";

for (const dir of uiDirs) {
	process.env.DEVICE = dir;
	delete process.env.WINDOW; // ...so this build empties the out dir and is the device view
	delete process.env.WINDOW_ENTRY;
	console.log(`\nm4l-jweb: bundling UI for ${dir}`);
	await build();

	const outDir = path.join(root, "dist", "ui", dir);
	const surface = await loadSurface(root, dir);
	// A `site:` window has no component of ours to bundle - its content is a
	// prebuilt directory (scripts/build-repl.mjs), delivered as a sidecar folder
	// rather than an embedded page. Vite has nothing to do for it.
	const windows = (surface?.windows ? Object.keys(surface.windows) : []).filter(
		(id) => !surface.windows[id].site,
	);
	if (!windows.length) continue;

	renameSync(path.join(outDir, "index.html"), path.join(outDir, "../_device.html"));
	for (const winId of windows) {
		process.env.WINDOW = winId;
		process.env.WINDOW_ENTRY = surface.windows[winId].entry;
		console.log(`\nm4l-jweb: bundling window ${winId} for ${dir}`);
		await build();
		renameSync(path.join(outDir, "index.html"), path.join(outDir, `${winId}.html`));
	}
	renameSync(path.join(outDir, "../_device.html"), path.join(outDir, "index.html"));
}

console.log(`\nm4l-jweb: ${uiDirs.length} UI bundle(s) -> dist/ui/`);

import { defineConfig, type UserConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
// Turns superdough's `./worklets.mjs?audioworklet` import into a base64 data: URL, so
// the DSP worklets survive the single-file jweb bundle and load into an
// OfflineAudioContext (superdough render path). No-op for imports without ?audioworklet.
import bundleAudioWorklet from "./strudel/packages/vite-plugin-bundle-audioworklet/vite-plugin-bundle-audioworklet.js";
import pkg from "./package.json";
import { devices, uiDir } from "./scripts/devices.mjs";

const strudelPkg = (p: string) => fileURLToPath(new URL(`./strudel/packages/${p}`, import.meta.url));
const prebundled = (name: string) => fileURLToPath(new URL(`./dist/prebundle/${name}.js`, import.meta.url));

/**
 * Take the icons from dist/prebundle/ instead of walking lucide's whole barrel.
 *
 * `scripts/prebundle-deps.mjs` writes it, and build-ui.mjs sets this before its 17 vite
 * runs. Unset - `pnpm dev:*`, vitest, a bare `vite build` - the real package is used, so
 * an icon added to the source is available immediately without regenerating anything.
 */
const PREBUNDLE = !!process.env.M4L_PREBUNDLE;

/**
 * The dependency aliases.
 *
 * ONE ENTRY PER PACKAGE, matched exactly. A plain-string prefix alias would rewrite
 * `superdough/superdoughoutput.mjs` into `.../index.mjs/superdoughoutput.mjs`, which is
 * why the two superdough entries are regexes and why the subpath is matched first.
 *
 * THE ENGINE IS NOT PREBUNDLED, on measurement. Compiling the Strudel submodule with
 * esbuild first was the obvious move and it bought nothing - a full UI build went
 * 40.6s -> 41.1s, inside the noise, because the engine is 12 modules of the graph and
 * not the 1600 the plan assumed - while costing every bundle its size, up to +151 KB
 * on the main device, since esbuild's output is opaque to rollup's tree-shaking.
 * lucide-react is the one that pays.
 */
const engineAliases = [
	{ find: "@strudel/core/fraction.mjs", replacement: strudelPkg("core/fraction.mjs") },
	{ find: "@strudel/core", replacement: strudelPkg("core/index.mjs") },
	{ find: "@strudel/mini", replacement: strudelPkg("mini/index.mjs") },
	{ find: "@strudel/transpiler", replacement: strudelPkg("transpiler/index.mjs") },
	{ find: "@strudel/tonal", replacement: strudelPkg("tonal/index.mjs") },
	{ find: "@strudel/webaudio", replacement: strudelPkg("webaudio/index.mjs") },
	{ find: "@strudel/draw", replacement: strudelPkg("draw/draw.mjs") },
	{ find: "supradough", replacement: strudelPkg("supradough/index.mjs") },
	// superdough: the REAL synths/samples/effects, rendered offline into WAV
	// (see doc SUPERDOUGH Rendering). The renderer imports both the barrel
	// ("superdough") and a subpath ("superdough/superdoughoutput.mjs"), so match
	// each precisely - a plain-string prefix alias would rewrite the subpath to
	// .../index.mjs/superdoughoutput.mjs.
	{ find: /^superdough$/, replacement: strudelPkg("superdough/index.mjs") },
	{ find: /^superdough\/(.*)$/, replacement: strudelPkg("superdough/$1") },
	// The icons, from the generated barrel of the ones actually used. Unset, the
	// package's own barrel is taken - 1545 modules for a handful of them.
	...(PREBUNDLE ? [{ find: /^lucide-react$/, replacement: prebundled("lucide-react") }] : []),
];

/**
 * ONE BUILD PER DEVICE.
 *
 * This repo ships two devices (MIDI, Samples), each `.amxd` embeds its OWN UI
 * bundle, and a device should ship what it is - not its sibling's code. So the
 * app to bundle is chosen here, by DEVICE, and src/main.tsx imports it through
 * the `@device` alias. There is no `mode === "..."` branch anywhere in the app.
 *
 * DEVICE is set by scripts/dev.mjs and scripts/build-ui.mjs (which read the
 * device list from patcher/devices.mjs). It is an env var rather than vite's
 * `--mode` deliberately: `--mode` also flips `import.meta.env.DEV`, and a build
 * with DEV=true would ship the dev harness inside the device.
 *
 * A FACTORY, not a plain object: scripts/build-ui.mjs sets DEVICE and calls
 * vite's build() once per device in the same process; a top-level `const DEVICE
 * = process.env.DEVICE` would be evaluated once, when the module was first
 * loaded, and every device after the first would be built from the first one's
 * sources.
 */
export default defineConfig(() => {
	const DEVICE = process.env.DEVICE ?? uiDir(devices[0]);

	// A device can declare floating WINDOWS, each a separate page bundled from the
	// same device folder. build-ui.mjs sets WINDOW_ENTRY (the component name from
	// surface.ts, e.g. "Window") so `@device/App` resolves to that file instead of
	// App.tsx - and main.tsx, which imports `@device/App`, renders the window's
	// page with no branch of its own. Absent WINDOW_ENTRY this is the device view.
	const WINDOW_ENTRY = process.env.WINDOW_ENTRY;

	const config: UserConfig = {
		base: "./",
		plugins: [react(), tailwindcss(), bundleAudioWorklet(), viteSingleFile()],
		resolve: {
			alias: [
				{
					find: "@device/App",
					replacement: fileURLToPath(
						new URL(`./src/app/${DEVICE}/${WINDOW_ENTRY ?? "App"}`, import.meta.url),
					),
				},
				{ find: "@device", replacement: fileURLToPath(new URL(`./src/app/${DEVICE}`, import.meta.url)) },
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				// The engine: the git submodule's sources, or the esbuild prebundle of them
				// (see engineAliases above). vitest.config.ts always takes the sources.
				...engineAliases,
			],
		},
		define: {
			__APP_VERSION__: JSON.stringify(pkg.version),
			__DEVICE__: JSON.stringify(DEVICE),
		},
		// The engine worker contains dynamic imports (evalScope). They must be
		// bundled into the single inlined chunk: a ?worker&inline blob URL cannot
		// resolve relative chunk imports at runtime.
		worker: {
			format: "es",
			rollupOptions: {
				output: {
					inlineDynamicImports: true,
				},
			},
		},
		build: {
			// dist/ui/<device>/index.html - one per device, picked up by `m4l-jweb build`.
			// A WINDOW build lands in the same folder and must NOT empty it, or it would
			// wipe the device view built just before it (build-ui.mjs renames around this).
			outDir: `dist/ui/${DEVICE}`,
			emptyOutDir: !process.env.WINDOW,
			rollupOptions: {
				treeshake: {
					/**
					 * The generated icon barrel has no side effects, and rollup has no way to
					 * know it: `sideEffects: false` is read from the package.json of the
					 * PACKAGE a module resolves through, and this file sits in dist/, inside
					 * no package. Without this rollup keeps the barrel whole and every page
					 * ships all 24 icons instead of the one or two it draws.
					 */
					moduleSideEffects: (id) => !id.includes("/dist/prebundle/"),
				},
			},
		},
	};
	return config;
});

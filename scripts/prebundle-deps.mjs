/**
 * prebundle-deps.mjs - generate the icon barrel the UI builds import, once.
 *
 * WHY. Every `.amxd` embeds its own single-file UI and every floating window is another
 * page, so `build-ui.mjs` runs vite 17 times. Each run parsed ~1785 modules.
 *
 * WHAT IS ACTUALLY EXPENSIVE, measured rather than assumed. doc/FEAT-BUILD-OPTIMIZATION.md
 * attributed those modules to the Strudel engine transforming on every run. It is not the
 * engine: **1545 of the 1785 are lucide-react**, whose barrel is one module per icon, and
 * which every device imports for a handful of them. The whole engine - core, mini,
 * transpiler, tonal, superdough - is 12.
 *
 * WHAT WAS TRIED AND DROPPED. Compiling the engine with esbuild first, which was the
 * plan's Option 2: it moved a full UI build 40.6s -> 41.1s, inside the noise, and grew
 * every bundle (up to +151 KB on the main device) because esbuild's output is opaque to
 * rollup's tree-shaking. Also tried: esbuild-bundling the icon barrel the same way. That
 * collapses it to one module, but esbuild emits the re-exports as a namespace object
 * built by its `__export` helper - getters, which rollup cannot see through - so every
 * page shipped the WHOLE icon set, +770 KB each, on 17 pages.
 *
 * WHAT IS LEFT, and it is small: a generated BARREL of the icons the source actually
 * imports, each re-exported straight from its own file. Rollup keeps its per-export
 * granularity, the module count drops from 1545 to ~24, and the bundles come out the
 * size they were.
 *
 * The barrel is a build artifact, regenerated every build, so it cannot drift from the
 * source. vite.config.ts only uses it when M4L_PREBUNDLE is set - `pnpm dev:*` and
 * vitest take the real package, so an icon added while developing needs nothing here.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root } from "./devices.mjs";

const require = createRequire(import.meta.url);

export const OUT_DIR = path.join(root, "dist", "prebundle");

/** lucide-react's ESM barrel, from its own `module` field (`main` is the CJS build). */
function lucideBarrel() {
	const manifest = require.resolve("lucide-react/package.json");
	const { module: esm, main } = require(manifest);
	return path.join(path.dirname(manifest), esm ?? main);
}

/**
 * Every icon name the app imports by value.
 *
 * `import type { LucideIcon }` is skipped: it is erased before anything resolves, and a
 * .js barrel cannot re-export a type.
 */
function usedIcons(dir) {
	const names = new Set();
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const f = path.join(d, e.name);
			if (e.isDirectory()) walk(f);
			else if (/\.(tsx?|jsx?)$/.test(e.name)) {
				for (const m of readFileSync(f, "utf8").matchAll(
					/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g,
				)) {
					if (m[1]) continue; // import type - erased
					for (const spec of m[2].split(",")) {
						const name = spec
							.trim()
							.split(/\s+as\s+/)[0]
							.trim();
						if (name && name !== "type") names.add(name);
					}
				}
			}
		}
	};
	walk(dir);
	return [...names].sort();
}

/**
 * Write dist/prebundle/lucide-react.js - the icons in use, and nothing else.
 *
 * The name -> file map is READ OUT OF the real barrel rather than derived from the name.
 * lucide ships aliases (`CircleChevronLeft` and `ChevronLeftCircle` are one file) and a
 * PascalCase-to-kebab guess gets those wrong by resolving to a file that is not there.
 * An icon the map does not know fails here, by name, rather than as a rollup "not
 * exported by" three steps later.
 */
export function prebundleDeps() {
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });
	const barrel = lucideBarrel();
	const dir = path.dirname(barrel);
	const map = new Map();
	for (const m of readFileSync(barrel, "utf8").matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
		for (const spec of m[1].split(",")) {
			const as = spec.trim().match(/^default\s+as\s+(\w+)$/);
			if (as) map.set(as[1], path.resolve(dir, m[2]));
		}
	}

	const icons = usedIcons(path.join(root, "src"));
	const missing = icons.filter((n) => !map.has(n));
	if (missing.length) throw new Error(`lucide-react exports no icon named: ${missing.join(", ")}`);

	const lines = icons.map((n) => `export { default as ${n} } from ${JSON.stringify(map.get(n))};`);
	writeFileSync(path.join(OUT_DIR, "lucide-react.js"), lines.join("\n") + "\n");
	console.log(`m4l-jweb: icon barrel for ${icons.length} icons -> dist/prebundle/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prebundleDeps();

/**
 * clean-dist.mjs - empty the build output before a build fills it again.
 *
 * WHY THIS EXISTS. Neither `build-ui.mjs` nor `m4l-jweb build` deletes what it does not
 * overwrite, so `dist/` accumulated: a renamed device left its old `.amxd` behind
 * (`alienmind-gugelhupf-superdough.amxd` outlived the rename to `alienmind-gugelhupf`), a
 * withdrawn preset stayed a file, and a device run from `dist/` had written its WAV
 * bounces in there too. `m4l-jweb install` then mirrors that folder into the User
 * Library, so every one of those ghosts got installed - which is exactly how a stale
 * device ends up in Live's browser next to the real one.
 *
 * The install side wipes its destination before copying, so a clean `dist` is the whole
 * fix: one build and one install, and Live sees precisely what this repo builds.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { root } from "./devices.mjs";
import { createRequire } from "node:module";

const { name } = createRequire(import.meta.url)(path.join(root, "package.json"));

for (const dir of [path.join(root, "dist", name), path.join(root, "dist", "ui")]) {
	rmSync(dir, { recursive: true, force: true });
	console.log(`m4l-jweb: cleaned ${path.relative(root, dir)}`);
}

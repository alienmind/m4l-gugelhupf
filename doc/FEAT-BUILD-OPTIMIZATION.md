# Build Optimization - what was slow, and what it was not

Each `.amxd` embeds its own UI as a single HTML payload, and every floating window is
another page, so `scripts/build-ui.mjs` runs Vite 17 times. A full UI build took **40.6s**.

## The premise was wrong

This document used to say the cost was Vite "transforming the entire Strudel engine
(1600+ modules)" on every run, and proposed three ways to stop doing that. A device
build does parse ~1785 modules. They are not the engine:

| Origin | Modules |
|---|---|
| `lucide-react` | 1545 |
| this repo's `src/` | 49 |
| the whole Strudel engine (core, mini, transpiler, tonal, superdough) | 12 |
| react + react-dom + everything else | ~25 |

`lucide-react`'s barrel is one module per icon, and every device imports it for a
handful of them. **85% of every build's module graph was icons.**

## What was tried

**Option 2, pre-bundling the engine with esbuild** - the option this document
recommended keeping the architecture for. Built, measured, dropped: **40.6s -> 41.1s**,
inside the noise, because the engine is 12 modules. It also grew every bundle (up to
+151 KB on `alienmind-gugelhupf`), because esbuild's output is opaque to rollup's
tree-shaking. It is in `git log`, not in the tree.

**Option 1, the unified mega bundle** - rejected without building. It breaks an
invariant the library pins upstream (`tests/bundle.test.mjs`): each device ships its
own app and none of its siblings'. That test exists because the failure is silent - a
device carrying the wrong UI still builds, installs and loads.

**esbuild-bundling the icon barrel**, the same trick applied to the right dependency.
Collapses it to one module, but esbuild emits the re-exports as a namespace object
built by its `__export` helper - getters, which rollup cannot see through. Every page
then shipped the whole icon set: +770 KB each, on 17 pages.

## What shipped

A generated **barrel of the icons actually imported**, each re-exported from its own
file (`scripts/prebundle-deps.mjs`, written to `dist/prebundle/lucide-react.js` and
aliased in when `M4L_PREBUNDLE` is set). Rollup keeps its per-export granularity, so it
still shakes each device down to the icons that device draws.

    40.6s -> 27.7s, and the bundles are byte-for-byte identical.

Two things it needs, both of which were silent when missing:

- **`treeshake.moduleSideEffects`** in `vite.config.ts` must mark `dist/prebundle/` as
  side-effect free. `sideEffects: false` is read from the package.json of the package a
  module resolves *through*, and a generated file in `dist/` is inside no package - so
  rollup has to assume the barrel does something on import, keeps it whole, and every
  page ships all 24 icons (+8.4 KB each). A `package.json` next to the barrel does not
  help; the option does.
- The name -> file map is **read out of lucide's real barrel**, not derived from the
  name. lucide ships aliases (`CircleChevronLeft` and `ChevronLeftCircle` are one file),
  and a PascalCase-to-kebab guess resolves those to files that do not exist.

## What is left, if the build needs to get faster again

The remaining 27.7s is not module parsing any more - it is rollup rendering and
`vite-plugin-singlefile` inlining a ~1.4 MB bundle, 17 times. The next real lever is
building the 17 pages **in parallel** rather than sequentially; they are only sequential
because vite reads `DEVICE` from the environment, which a worker per build would fix.
Nobody has measured what that would buy.

import fs from 'node:fs';
import { defineConfig } from 'vite';

// Playables rules: no Page Visibility API (pause/resume come from the SDK) and no `new Function`.
// Phaser's prebuilt bundle contains both, so patch them out and fail loudly if Phaser changes.
const PHASER_FILE = /node_modules\/phaser\/dist\/phaser(\.esm)?\.js$/;
const PHASER_PATCHES = [
  ['document.addEventListener(hiddenVar, onChange, false);', ''],
  ["hiddenVar = 'visibilitychange';", 'hiddenVar = undefined;'],
  ["hiddenVar = prefix + 'visibilitychange';", 'hiddenVar = undefined;'],
  ['window.onblur = function ()', 'var unusedOnBlur = function ()'],
  ['window.onfocus = function ()', 'var unusedOnFocus = function ()'],
  ["return this || new Function('return this')();", 'return this || window;'],
];

function patchPhaserSource(code) {
  let out = code;
  for (const [from, to] of PHASER_PATCHES) {
    if (!out.includes(from)) throw new Error(`patch-phaser: pattern not found: ${from}`);
    out = out.replace(from, to);
  }
  return out;
}

// Production build (rollup) applies the patch in a transform; dev pre-bundling (esbuild) in onLoad.
const patchPhaser = () => ({
  name: 'patch-phaser',
  enforce: 'pre',
  transform(code, id) {
    // Match the real file only (not Vite's `?commonjs-*` virtual wrappers around it).
    if (!PHASER_FILE.test(id)) return null;
    return { code: patchPhaserSource(code), map: null };
  },
});

const esbuildPatchPhaser = {
  name: 'patch-phaser',
  setup(build) {
    build.onLoad({ filter: PHASER_FILE }, (args) => ({
      contents: patchPhaserSource(fs.readFileSync(args.path, 'utf8')),
      loader: 'js',
    }));
  },
};

export default defineConfig({
  base: './',
  plugins: [patchPhaser()],
  optimizeDeps: { esbuildOptions: { plugins: [esbuildPatchPhaser] } },
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
});

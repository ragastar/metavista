# three.js r126 subset bundle

Builds `vendor/three-r126-mv.min.js`: a trimmed three@0.126.1 plus OrbitControls that sets `window.THREE` exactly like the CDN `three.min.js` + `examples/js/controls/OrbitControls.js` pair (~139 KB gzip instead of ~162 KB).

Rebuild:

    cd tools/three-build && npm ci && npm run build

- Need another THREE member? Add it to both lists in `entry.js` (import + `members`) and rebuild; a missing member is `undefined` at runtime.
- Versions are pinned in `package.json` (three 0.126.1, esbuild 0.25.10). Build options and why (no `mangleProps`, only warn/log stripped) are in `build.mjs`.
- `node_modules/` is gitignored; commit only the source files and the output in `vendor/`.

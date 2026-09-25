// Builds ../../vendor/three-r126-mv.min.js from entry.js (three@0.126.1, pinned).
import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
const r = (p) => fileURLToPath(new URL(p, import.meta.url));
const license = readFileSync(r('./node_modules/three/LICENSE'), 'utf8').trim();
await build({
  entryPoints: [r('./entry.js')],
  outfile: r('../../vendor/three-r126-mv.min.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2018',            // Safari 12+; same output size as esnext
  legalComments: 'eof',
  // three.module.js only has a "// threejs.org/license" line comment, which esbuild
  // drops, so the MIT notice is added explicitly as a legal comment.
  banner: { js: `/*! three.js r126 subset for Metavista (+OrbitControls). https://threejs.org\n${license}\n*/` },
  // Strip console.warn/log/info (mostly deprecation notices, ~4.5 KB gz).
  // console.error is kept so shader compile errors still show up.
  pure: ['console.warn', 'console.log', 'console.info'],
  // Not used on purpose: mangleProps (breaks code outside the bundle that touches
  // three's _private props, e.g. examples/js loaders; saves only ~1 KB gz) and
  // drop:['console'] (would also hide shader/WebGL errors).
  logLevel: 'info',
});

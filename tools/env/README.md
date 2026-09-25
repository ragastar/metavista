# Studio environment (3D viewer)

`assets/studio-env.webp` (18 KB) replaces `assets/blue_photo_studio_1k.exr` (1.52 MB + EXRLoader 55 KB + fflate 30 KB).
Source: Poly Haven "Blue Photo Studio" (CC0), 1024×512.

**Format:** opaque lossy WebP (q80), each channel stored as log2: byte `b>0` → linear `2^(-10 + b/255·20.25)`, `b=0` → black
(0.08 stop per step; range covers the HDRI's 2^-9.1 … 2^10.15). The page decodes it with a short loop into an 8-bit RGBE
`DataTexture` (`encoding = RGBEEncoding`, NearestFilter, no mipmaps, flipY false — rows are written bottom-up) and runs
`PMREMGenerator.fromEquirectangular`. Code: `loadStudioEnv.js` (paste into the store script).

Why not RGBE-in-PNG (three r126 decodes that natively in PMREM): it works (bit-identical to a DataTexture in Chrome), but a
photographic HDRI doesn't compress losslessly — 310 KB at 512×256, 84 KB at 256×128 (and then LED reflections go soft),
and lossy codecs would corrupt the exponent in alpha. RGBM16 clips at 16 (LEDs reach ~1100) → wrong.

Regenerate:

    cd tools/env && npm install && npm run build     # or: node convert-env.mjs --sizes 1024 --formats log-webp --quality 80

`LOG_LO/LOG_HI` in `convert-env.mjs` must match `ENV_LO/ENV_HI` in the loader. Other `--formats` (rgbe-png, rgbe-webp,
rgbm16-png, hdr, log-jpg, rgbe-png-premul) exist for comparison.

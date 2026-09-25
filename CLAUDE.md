# Metavista — project notes

Copy of metaleks.com (custom HD metal prints), deliberately trimmed. Owner: Mikhail Levin. Store UI text is English; admin UI is Russian (store content inside it — products, FAQ, policies, reviews — stays English). Talk to the owner in Russian, plain words.

## Repo & deploy
- GitHub: https://github.com/ragastar/metavista (public). Live site (GitHub Pages from `main`, root): https://ragastar.github.io/metavista/ — `index.html` redirects to the store; admin at `…/Metavista%20Admin.dc.html`. Every push to `main` redeploys in ~1–2 min.
- Local: preview config `store` in `.claude/launch.json` (`npx serve` on :5173; serve drops `.html` from URLs).
- Commit after each finished change, then push.

## Files
- `Metavista Store.dc.html` — storefront (single file: template inside `<x-dc>`, logic in `<script type="text/x-dc">` class `Component extends DCLogic`, `renderVals()` returns everything the template uses).
- `Metavista Admin.dc.html` — admin panel, same format. Page "Site sections" (`#/sections`) toggles store features.
- `support.js` — the dc runtime (generated, do not edit). Loads React 18 + Babel from unpkg. Both pages preload React (same URL + SRI) in `<head>` so it downloads in parallel — support.js skips its own load when `window.React` exists. A `.mv-skel` logo splash sits after `</x-dc>` and hides itself via `#dc-root:not(:empty) ~ .mv-skel`.
- Assets: `assets/logo-mark-2x.png` (150 px tall, used everywhere), `assets/favicon-48.png`; `logo-mark.png` is the 62 KB original, no longer referenced.
- `_backup_*` — manual backups from previous sessions. `_test/` — scratch test image, safe to delete.

## Template engine gotchas (support.js)
- `{{ path }}` only resolves paths / `===` comparisons — compute everything in JS.
- Inline `style` strings are split on `;` → never put `data:` URLs into `style="…url(…)"`. Use `blob:` URLs or `<img>`, or pass a whole style object: `style="{{ obj }}"`.
- Use `sc-camel-src="{{ x }}"` instead of `src="{{ x }}"` on `<img>` (avoids bogus requests before render).
- `ref="{{ fn }}"` works (used for the three.js viewer); keep the function identity stable.
- Events: any `onXxx` incl. pointer events.

## Feature flags
- `FEATURES` list is duplicated in both files — keep keys/defaults in sync (labels/groups are Russian in admin, English in store). Stored in `localStorage.mv_features` (defaults in code). Groups: Global, Menu, Products, Home page, Footer, Photo tools, S.HD & preview.
- Other storage: `mv_cart`, `mv_orders` (order IDs placed in this browser — Track Order only knows these), `mv_admin` (admin edits: prices, codes, FAQ, policies… — per browser only, the store does not read it yet).
- `localStorage.mv_settings.shdEndpoint` — optional S.HD server (POST multipart `file` → image or JSON `{url}`); empty = in-browser enhancement (upscale + unsharp mask), also used as fallback.

## Customizer (popup wizard, like the reference)
Product page → "START CREATING" opens a popup: Upload → Frame & Crop (drag, zoom, rotate, Smart Focus, Original ratio, quality check) → S.HD compare (slider, 1–3× zoom, watermark, consent) → Size & Mounting (three.js 3D viewer with auto-rotate/inertia, back view with hardware + hotspots, 3 rooms to scale). Idol product skips crop/S.HD. Hexagon/collage paths are legacy and hidden.
- 3D: three.js r126 + OrbitControls from cdn.jsdelivr.net (needs internet); CSS 3D fallback if WebGL/CDN unavailable. Class `PrintViewer`.
  Look = reference tuning (from `_ref/ref.txt`): env = Poly Haven `assets/blue_photo_studio_1k.exr` (CC0) as equirect `scene.environment` (EXRLoader + fflate from jsdelivr; procedural `studio()` fallback), front `MeshStandardMaterial` metalness .25 / roughness .65 / envMapIntensity .5, ambient .7 + point .6, ACES exposure 1, camera FOV 75 close-up, one full spin on load. Rig turned by `YAW`/`LIFT` so the head-on view mirrors the HDRI's round LED panel. Brushed = photo multiplied onto a generated brushed-aluminium base (sat 130 %/contrast 50 %, then brightness 130 %/contrast 200 %). Ours on top: rounded bevelled plate, hover tilt.
- `_ref/` (gitignored) — reference-site code for study only, never commit or copy verbatim.

## Reference analysis (metaleks.com)
Their S.HD = Cloudflare worker (server AI), uploads go to Cloudflare R2 with GitHub/Cloudinary fallbacks, blur check via Laplacian variance in browser, 3D via three.js r126 (ACES tone mapping, EXR env map, damping 0.1, autoRotate in front view, camera tween to back "scene" mode).

## Store behaviour notes
- Checkout takes no payment: "Place order" = order request; copy says we email a preview + secure payment link. Discount code field: `CODES` (WELCOME15 = 15 %), never stacks — the bigger of code / bundle wins. Bundle tiers count print items only (`noBundle` items like the mount kit are excluded); all tier copy is generated from `tiers()`.
- Wizard pushes a history entry: phone/browser Back steps back through the wizard (`stepBack()`), × pops it. Design is kept when returning to the same product (`_czPid`).
- In-browser S.HD runs in a Web Worker (`enhanceCore` → blob worker); canvases that are read back use `willReadFrequently`. Pointer-move handlers are rAF-throttled via `frame()`; crop supports pinch-zoom.
- Scroll lock (`lockScroll`, iOS-safe) + focus trap/return for any element with `data-trap` (wizard, cart, modals); Esc closes modal → wizard → cart → menu.

## Known open items
- **PRIORITY (owner): 3D preview must load fast — current setup is too slow.** Measured 2026-09-25: step 4 pulls ~2.2 MB before the look is final — three.min.js 636 KB (≈156 KB gz) + OrbitControls 25 KB + fflate 30 KB + EXRLoader 55 KB + `blue_photo_studio_1k.exr` 1.52 MB (barely compresses). Loading only starts when step 4 mounts (even on Rooms/Flat tabs or with `preview_3d` off). Fix ideas: start `loadThree()` + env prefetch when the wizard opens (or on product page idle); replace the EXR with a small 256×128 RGBE/JPEG/PNG env (~20–60 KB) or prebaked PMREM; show the CSS/photo preview instantly and swap to WebGL when ready; mount the viewer only for 3D/back tabs; self-host/trim three.js (module build of only what we use); render on demand instead of a constant 60 fps loop; cap DPR ~1.5 on mobile.
- Real AI enhancement server not connected. Room previews are drawn with CSS shapes, not photos. Checkout card field is a placeholder (needs a payment provider). Collage Builder not built.

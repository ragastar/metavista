# Metavista — project notes

Copy of metaleks.com (custom HD metal prints), deliberately trimmed. Owner: Mikhail Levin. UI text is English; talk to the owner in Russian, plain words.

## Files
- `Metavista Store.dc.html` — storefront (single file: template inside `<x-dc>`, logic in `<script type="text/x-dc">` class `Component extends DCLogic`, `renderVals()` returns everything the template uses).
- `Metavista Admin.dc.html` — admin panel, same format. Page "Site sections" (`#/sections`) toggles store features.
- `support.js` — the dc runtime (generated, do not edit). Loads React 18 + Babel from unpkg.
- `_backup_*` — manual backups from previous sessions. `_test/` — scratch test image, safe to delete.

## Template engine gotchas (support.js)
- `{{ path }}` only resolves paths / `===` comparisons — compute everything in JS.
- Inline `style` strings are split on `;` → never put `data:` URLs into `style="…url(…)"`. Use `blob:` URLs or `<img>`, or pass a whole style object: `style="{{ obj }}"`.
- Use `sc-camel-src="{{ x }}"` instead of `src="{{ x }}"` on `<img>` (avoids bogus requests before render).
- `ref="{{ fn }}"` works (used for the three.js viewer); keep the function identity stable.
- Events: any `onXxx` incl. pointer events.

## Feature flags
- `FEATURES` list is duplicated in both files — keep them in sync. Stored in `localStorage.mv_features` (defaults in code). Groups: Global, Menu, Products, Home page, Footer, Photo tools, S.HD & preview.
- `localStorage.mv_settings.shdEndpoint` — optional S.HD server (POST multipart `file` → image or JSON `{url}`); empty = in-browser enhancement (upscale + unsharp mask), also used as fallback.

## Customizer (popup wizard, like the reference)
Product page → "START CREATING" opens a popup: Upload → Frame & Crop (drag, zoom, rotate, Smart Focus, Original ratio, quality check) → S.HD compare (slider, 1–3× zoom, watermark, consent) → Size & Mounting (three.js 3D viewer with auto-rotate/inertia, back view with hardware + hotspots, 3 rooms to scale). Idol product skips crop/S.HD. Hexagon/collage paths are legacy and hidden.
- 3D: three.js r126 + OrbitControls from cdn.jsdelivr.net (needs internet); CSS 3D fallback if WebGL/CDN unavailable. Class `PrintViewer`.

## Reference analysis (metaleks.com)
Their S.HD = Cloudflare worker (server AI), uploads go to Cloudflare R2 with GitHub/Cloudinary fallbacks, blur check via Laplacian variance in browser, 3D via three.js r126 (ACES tone mapping, EXR env map, damping 0.1, autoRotate in front view, camera tween to back "scene" mode).

## Known open items
- Real AI enhancement server not connected. Room previews are drawn with CSS shapes, not photos. Checkout card field is a placeholder (needs a payment provider). Collage Builder not built.

# Metavista — project notes

Copy of metaleks.com (custom HD metal prints), deliberately trimmed. Owner: Mikhail Levin. Store UI text is English; admin UI is Russian (store content inside it — products, FAQ, policies, reviews — stays English). Talk to the owner in Russian, plain words.

## Repo & deploy
- GitHub: https://github.com/ragastar/metavista (public). Live site (GitHub Pages from `main`, root): https://ragastar.github.io/metavista/ — `index.html` redirects to the store; admin at `…/Metavista%20Admin.dc.html`. Every push to `main` redeploys in ~1–2 min.
- Local: preview config `store` in `.claude/launch.json` (`npx serve` on :5173; serve drops `.html` from URLs).
- Commit after each finished change, then push.

## Files
- `Metavista Store.dc.html` — storefront (single file: template inside `<x-dc>`, logic in `<script type="text/x-dc">` class `Component extends DCLogic`, `renderVals()` returns everything the template uses).
- `Metavista Admin.dc.html` — admin panel, same format. Page "Site sections" (`#/sections`) toggles store features.
  - Mobile (≤860 px) is an app shell: slim top bar + fixed bottom tabs (Сводка / Заказы / S.HD / Товары / «Ещё» sheet with the rest), tables turn into cards via CSS grid-areas (`adm-orow`, `adm-crow`, `adm-srow`, `adm-rrow`), filter chips scroll in one row, order page reorders blocks (status first) and has a sticky next-step bar (`nextStep`: send proof → approved → shipped (needs tracking) → delivered), products has a sticky save bar, toasts move to the top. All on/off settings use the `.adm-switch` toggle. SVG attrs bound from data need `sc-camel-d` (raw template is parsed by the browser first).
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
- 3D (class `PrintViewer`, three.js r126):
  - Loading: `vendor/three-r126-mv.min.js` = slim self-hosted r126 + OrbitControls (rebuild: `tools/three-build`, ~140 KB gz; jsdelivr CDN is the fallback). Studio HDRI = `assets/studio-env.webp` (18 KB, Poly Haven "Blue Photo Studio" CC0, log2-encoded; decoded to RGBE → `PMREMGenerator.fromEquirectangular`; regenerate with `tools/env`). `prewarm3d()` starts both downloads + the engine when the wizard opens, so the Size step shows 3D at once.
  - Engine: one shared `WebGLRenderer` + PMREM env (`getEngine`) reused by every viewer (no context churn); viewers dispose all their geometry/materials/textures in `destroy()`. Render on demand (only while spinning/tweening/dragging/damping/tilting or after `dirty`), paused when offscreen (IntersectionObserver) or tab hidden.
  - Look: transparent canvas over a CSS studio gradient; FOV 30 product lens (distances scaled by `FOV_K`), print framed to ~66 % of the view; rig `YAW = 2.1` so head-on the print mirrors a dark part of the studio (clean photo) and turning it sweeps the LED-panel glint across (yaw .94 = glare). Front = `MeshPhysicalMaterial`, photo as emissive + `toneMapped:false` (true photo colours); gloss = clearcoat 1 / .07; brushed = reference composite + metalness/roughness map (light areas = bare brushed metal). Soft drop shadow fades with viewing angle. Back: brushed aluminium, dark nickel hardware.
  - Touch: vertical swipe scrolls the wizard, horizontal swipe spins (with inertia), two fingers → OrbitControls. Reduced-motion users get no pop/spin. CSS 3D fallback if WebGL/three.js fails.
- `_ref/` (gitignored) — reference-site code for study only, never commit or copy verbatim.

## Reference analysis (metaleks.com)
Their S.HD = Cloudflare worker (server AI), uploads go to Cloudflare R2 with GitHub/Cloudinary fallbacks, blur check via Laplacian variance in browser, 3D via three.js r126 (ACES tone mapping, EXR env map, damping 0.1, autoRotate in front view, camera tween to back "scene" mode).

## Store behaviour notes
- Checkout takes no payment: "Place order" = order request; copy says we email a preview + secure payment link. Discount code field: `CODES` (WELCOME15 = 15 %), never stacks — the bigger of code / bundle wins. Bundle tiers count print items only (`noBundle` items like the mount kit are excluded); all tier copy is generated from `tiers()`.
- Wizard pushes a history entry: phone/browser Back steps back through the wizard (`stepBack()`), × pops it. Design is kept when returning to the same product (`_czPid`).
- In-browser S.HD runs in a Web Worker (`enhanceCore` → blob worker); canvases that are read back use `willReadFrequently`. Pointer-move handlers are rAF-throttled via `frame()`; crop supports pinch-zoom.
- Scroll lock (`lockScroll`, iOS-safe) + focus trap/return for any element with `data-trap` (wizard, cart, modals); Esc closes modal → wizard → cart → menu.

## Known open items
- 3D fast-loading priority: done 2026-09-25 (2.2 MB → ~160 KB gz, prefetched on wizard open, 3D ready ~1.5 s after crop in headless tests). Room previews are still CSS.
- Real AI enhancement server not connected. Room previews are drawn with CSS shapes, not photos. Checkout card field is a placeholder (needs a payment provider). Collage Builder not built.

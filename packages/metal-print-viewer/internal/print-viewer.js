import * as Layout from './print-layout.js';
import { backTextCanvas } from './back-text.js';
import { createEngine } from './studio.js';
import { viewerError } from './errors.js';

const YAW = 2.1, LIFT = .12;
// product-shot lens: narrow FOV from further away (no keystone distortion); distances are scaled from the reference's 75° setup
const FOV = 30, FOV_K = Math.tan(75 / 2 * Math.PI / 180) / Math.tan(FOV / 2 * Math.PI / 180);
const easeInOutCubic = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
const easeOutBack = x => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

export class PrintViewer {
  constructor(el, T, onError) {
    this.T = T; this.el = el; this.o = {}; this.onError = onError; this.imageStatus = 'empty'; this.lastError = null; this.imageGeneration = 0; this.imagePromise = Promise.resolve({ imageStatus: 'empty' }); this.dead = false; this.tweens = []; this.dirty = true; this.inView = true;
    const eng = this.engine = createEngine(T, error => this.reportError(error)), r = this.renderer = eng.r;
    el.appendChild(r.domElement);
    const scene = this.scene = new T.Scene(); // transparent: the studio backdrop is a CSS gradient behind the canvas
    // environment: the photo-studio HDRI through PMREM; procedural studio until it arrives
    scene.environment = eng.env || eng.fallback;
    if (!eng.env) eng.envP.then(t => { if (t && !this.dead) { scene.environment = t; this.dirty = true; } });
    scene.add(new T.AmbientLight(0xffffff, .7));
    const pl = new T.PointLight(0xffffff, .6, 1100); pl.position.set(-5, 3, -2); scene.add(pl);
    // wide-angle camera close to the print (like the reference): strong perspective, so the print mirrors a wide slice of the studio
    // the whole rig (print + camera) is turned to YAW so the print, seen head-on, mirrors the studio's round LED panel
    this.camR = 1.2 * FOV_K; this.yaw = YAW;
    const cam = this.camera = new T.PerspectiveCamera(FOV, 1, .05, 100); cam.position.setFromSpherical(new T.Spherical(this.camR, Math.PI / 2 - LIFT, YAW));
    const ctl = this.controls = new T.OrbitControls(cam, r.domElement);
    Object.assign(ctl, { enableDamping:true, dampingFactor:.1, enablePan:false, rotateSpeed:.75, minDistance:.65, maxDistance:2.2, minPolarAngle:Math.PI * .22, maxPolarAngle:Math.PI * .78 });
    ctl.addEventListener('start', () => { this.drag = true; this.spin = null; r.domElement.style.cursor = 'grabbing'; });
    ctl.addEventListener('end', () => { this.drag = false; r.domElement.style.cursor = 'grab'; });
    ctl.addEventListener('change', () => { this.dirty = true; });
    this.group = new T.Group(); scene.add(this.group); this.hw = new T.Group(); this.group.add(this.hw);
    // mouse hover tilts the print a little so the highlights glide across it
    this.tilt = { x:0, y:0, tx:0, ty:0 };
    this._onMove = e => { if (e.pointerType !== 'mouse' || this.drag) return; const b = r.domElement.getBoundingClientRect(); this.tilt.ty = ((e.clientX - b.left) / b.width - .5) * .22; this.tilt.tx = ((e.clientY - b.top) / b.height - .5) * .16; };
    this._onLeave = () => { this.tilt.tx = this.tilt.ty = 0; };
    r.domElement.addEventListener('pointermove', this._onMove); r.domElement.addEventListener('pointerleave', this._onLeave);
    this.brushTex = this.brushedMap();
    this.edgeMat = new T.MeshStandardMaterial({ color:0xd0d0d8, metalness:.7, roughness:.3 });
    this.backMat = new T.MeshStandardMaterial({ color:0xaeb2b7, metalness:.88, roughness:.32, envMapIntensity:.8 });
    // print face: the photo is shown with its true colours (emissive, not tone-mapped); lighting only adds sheen, reflections and the gloss coat on top
    this.frontMat = new T.MeshPhysicalMaterial({ color:0xffffff, metalness:0, roughness:.5, toneMapped:false });
    this.hwMat = new T.MeshStandardMaterial({ color:0x3a3d42, metalness:1, roughness:.22, envMapIntensity:1 });
    this.darkMat = new T.MeshStandardMaterial({ color:0x2a2d31, metalness:.3, roughness:.6 });
    // hotspot layer (DOM, positioned from 3D each frame)
    const lay = this.layer = document.createElement('div'); lay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; el.appendChild(lay);
    this.spots = [];
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el); this.resize();
    // pause entirely while scrolled out of view
    this.io = new IntersectionObserver(es => { this.inView = es[es.length - 1].isIntersecting; if (this.inView) this.dirty = true; }); this.io.observe(el);
    // touch: OrbitControls r126 blocks page scrolling on any touch. On touch screens, a vertical swipe scrolls the wizard (to size / Add to cart),
    // a horizontal swipe spins the print (with inertia); two fingers still go to OrbitControls (pinch zoom).
    this.coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches; this.vel = 0;
    if (this.coarse) {
      r.domElement.style.touchAction = 'pan-y';
      const tc = this._touch = {};
      this._onTS = e => { if (e.target !== r.domElement || e.touches.length > 1) { tc.on = false; return; } e.stopPropagation(); const t = e.touches[0]; Object.assign(tc, { on:true, x:t.clientX, y:t.clientY, lx:t.clientX, lt:performance.now(), mode:null }); };
      this._onTM = e => { if (!tc.on || e.touches.length > 1) return; e.stopPropagation(); const t = e.touches[0];
        if (!tc.mode) { const dx = t.clientX - tc.x, dy = t.clientY - tc.y; if (Math.hypot(dx, dy) < 7) return; tc.mode = Math.abs(dx) > Math.abs(dy) ? 'spin' : 'scroll'; if (tc.mode === 'spin') { this.drag = true; this.spin = null; } }
        if (tc.mode !== 'spin') return;
        const now = performance.now(), d = -(t.clientX - tc.lx) * Math.PI / this.el.clientWidth; this.orbitBy(d); this.vel = Math.max(-.05, Math.min(.05, d / Math.max(8, now - tc.lt) * 16)); tc.lx = t.clientX; tc.lt = now; };
      this._onTE = e => { if (!tc.on) return; e.stopPropagation(); tc.on = false; if (tc.mode === 'spin') this.drag = false; else this.vel = 0; };
      el.addEventListener('touchstart', this._onTS, { capture:true, passive:true }); el.addEventListener('touchmove', this._onTM, { capture:true, passive:true });
      el.addEventListener('touchend', this._onTE, { capture:true, passive:true }); el.addEventListener('touchcancel', this._onTE, { capture:true, passive:true });
    }
    if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) this.pop = { s:.6, t0: performance.now() };
    const loop = () => { if (this.dead) return; this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  orbitBy(d) { const T = this.T, t = this.controls.target, s = new T.Spherical().setFromVector3(this.camera.position.clone().sub(t)); s.theta += d; this.camera.position.setFromSpherical(s).add(t); this.camera.lookAt(t); this.dirty = true; }
  resize() { const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true; }
  tween(ms, fn, done) { this.tweens.push({ t0: performance.now(), ms, fn, done }); }
  frame() {
    if (!this.el.isConnected || this.o.visible === false || !this.inView || document.hidden) return; // hidden → no work at all
    const now = performance.now();
    if (this.vel && !this.drag) { this.orbitBy(this.vel); this.vel *= .88; if (Math.abs(this.vel) < 1e-4) this.vel = 0; } // touch-spin inertia
    const busy = this.tweens.length || this.pop || this.spin || this.drag || this.vel;
    this.tweens = this.tweens.filter(tw => { const k = Math.min(1, (now - tw.t0) / tw.ms); tw.fn(k); if (k >= 1) { tw.done && tw.done(); return false; } return true; });
    // pop-in when a new print appears
    if (this.pop) { const k = Math.min(1, (now - this.pop.t0) / 650), s = this.pop.s + (1 - this.pop.s) * easeOutBack(k); this.group.scale.setScalar(s); if (k >= 1) this.pop = null; }
    // one full turn when a print appears (as the reference does), then it waits for the user
    let spinY = 0; if (this.spin) { const k = Math.min(1, (now - this.spin.t0) / 1900); spinY = Math.PI * 2 * easeOutCubic(k); if (k >= 1) this.spin = null; }
    const tl = this.tilt, on = this.o.mode !== 'back' && !this.drag, gx = on ? tl.tx : 0, gy = on ? tl.ty : 0, tilting = Math.abs(gx - tl.x) > 1e-4 || Math.abs(gy - tl.y) > 1e-4;
    tl.x += (gx - tl.x) * .08; tl.y += (gy - tl.y) * .08; this.group.rotation.set(0, this.yaw + tl.y + spinY, 0); this.group.rotateX(tl.x);
    const moved = this.controls.update();
    if (this.shadow) { const n = this._n || (this._n = new this.T.Vector3()), d = n.set(0, 0, 1).applyQuaternion(this.group.quaternion).dot(this.camera.position.clone().sub(this.controls.target).normalize());
      const k = this.o.mode === 'back' ? 0 : Math.pow(Math.max(0, d), 6) * .62; this.shadowMat.opacity = k; this.shadow.visible = k > .01; }
    // render only when something changes: idle viewer costs ~nothing (battery, fans, other tabs)
    if (!(busy || tilting || moved || this.dirty)) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.placeSpots();
  }
  reportError(error) {
    if (this.dead) return;
    this.lastError = error;
    try { this.onError?.(error); } catch (callbackError) { console.error('Print viewer onError callback failed', callbackError); }
  }
  update(o) {
    if (this.dead) throw viewerError('viewer_destroyed', 'This viewer has been destroyed.');
    const p = this.o; this.o = o; this.dirty = true;
    const geometryChanged = o.aspect !== p.aspect || o.widthCm !== p.widthCm || o.heightCm !== p.heightCm;
    if (o.img !== p.img || geometryChanged || o.wm !== p.wm) this.setPrint(o);
    if (o.finish !== p.finish) this.applyFinish(o.finish);
    if (o.mount !== p.mount || geometryChanged || o.size !== p.size) this.buildHardware(o.mount);
    if (geometryChanged || o.size !== p.size || o.mount !== p.mount || JSON.stringify(o.backText) !== JSON.stringify(p.backText)) this.setBackText(o);
    if (o.mode !== p.mode || geometryChanged) this.setMode(o.mode, !!p.mode && !geometryChanged);
    if (JSON.stringify(o.spots) !== JSON.stringify(p.spots) || o.mode !== p.mode || geometryChanged) this.buildSpots(o.mode === 'back' ? o.spots : []);
  }
  getState() {
    return { imageStatus: this.dead ? 'destroyed' : this.imageStatus, environment: this.engine.environmentStatus,
      error: this.lastError ? { code: this.lastError.code || 'viewer_error', message: this.lastError.message } : null };
  }
  setPrint(o) {
    const T = this.T, a = o.aspect || .75, L = 1.25, gW = a >= 1 ? L : L * a, gH = a >= 1 ? L / a : L, D = .0028; this.dims = { gW, gH, D };
    if (this.plate) { this.group.remove(this.plate); this.plate.traverse(m => m.geometry && m.geometry.dispose()); }
    this.plate = this.makePlate(gW, gH, D); this.group.add(this.plate);
    if (!this.shadow) { // soft drop shadow "on the wall" behind the print; fades out as the print turns away
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.filter = 'blur(22px)'; x.fillStyle = '#000'; x.fillRect(46, 46, 164, 164);
      this.shadowTex = new T.CanvasTexture(c); this.shadowMat = new T.MeshBasicMaterial({ map:this.shadowTex, color:0x000000, transparent:true, opacity:0, depthWrite:false, toneMapped:false });
      this.shadow = new T.Mesh(new T.PlaneGeometry(1, 1), this.shadowMat); this.shadow.renderOrder = -1; this.group.add(this.shadow); }
    this.shadow.scale.set(gW * 1.6, gH * 1.6, 1); this.shadow.position.set(.012, -.03, -D / 2 - .09);
    this.hw.position.z = -D / 2;
    // camera distance as in the reference, scaled to our plate (their 3.4-unit print ↔ our 1.25): portraits sit a bit further back
    // frame the print so its long side fills ~66 % of the (square) view, whatever its proportions
    this.camR = Math.max(gW, gH) / 2 / Math.tan(FOV / 2 * Math.PI / 180) / .66 + D;
    Object.assign(this.controls, { minDistance: this.camR * .55, maxDistance: this.camR * 1.8 });
    if (!this.animating) { const c = this.camera, t = this.controls.target; c.position.sub(t).setLength(this.camR).add(t); }
    this.cancelImage?.();
    const generation = ++this.imageGeneration;
    if (!o.img) {
      this.clearPhoto(); this.imageStatus = 'empty'; this.lastError = null;
      this.imagePromise = Promise.resolve(this.getState()); return;
    }
    this.imageStatus = 'loading'; this.lastError = null;
    const im = new Image(); im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
    if (/^https?:/i.test(o.img)) im.crossOrigin = 'anonymous';
    this.imagePromise = new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { im.onload = im.onerror = null; this.cancelImage = null; };
      this.cancelImage = () => { if (settled) return; settled = true; im.onload = im.onerror = null; im.src = ''; resolve({ imageStatus: 'superseded' }); };
      const fail = (message, cause) => {
        if (settled || this.dead || generation !== this.imageGeneration) return;
        settled = true; cleanup(); this.imageStatus = 'error';
        const error = viewerError('image_load_failed', message, cause); this.reportError(error); reject(error);
      };
      im.onerror = () => fail('The image could not be loaded. Check the URL and cross-origin permission.');
      im.onload = () => {
        if (settled || this.dead || generation !== this.imageGeneration) return;
        try {
          if (!im.naturalWidth || !im.naturalHeight) throw new Error('The image has no pixels.');
          // Center-cover the selected physical panel instead of stretching a differently shaped photo.
          // Only this preview canvas is cropped; the supplied image URL and source pixels stay untouched.
          const aspect = o.widthCm / o.heightCm, imageWidth = im.naturalWidth, imageHeight = im.naturalHeight;
          const cropWidth = Math.min(imageWidth, imageHeight * aspect), cropHeight = cropWidth / aspect;
          const cropX = (imageWidth - cropWidth) / 2, cropY = (imageHeight - cropHeight) / 2;
          const cap = Math.min(this.renderer.capabilities.maxTextureSize, innerWidth > 720 ? 2048 : 1600),
            scale = Math.min(1, cap / Math.max(cropWidth, cropHeight)), canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(cropWidth * scale)); canvas.height = Math.max(1, Math.round(cropHeight * scale));
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.imageSmoothingQuality = 'high';
          context.drawImage(im, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
          context.getImageData(0, 0, 1, 1); // Fail here if a cross-origin image tainted the canvas.
          if (o.wm) {
            context.save(); context.globalAlpha = .18; context.fillStyle = '#fff';
            context.font = `700 ${Math.max(10, Math.round(canvas.width / 26))}px Arial, sans-serif`;
            context.translate(canvas.width / 2, canvas.height / 2); context.rotate(-.42);
            const step = canvas.width / 2.6;
            for (let yy = -canvas.height; yy < canvas.height; yy += step / 1.6)
              for (let xx = -canvas.width; xx < canvas.width; xx += step)
                context.fillText(o.wm, xx + (Math.round(yy / step) % 2) * step / 2, yy);
            context.restore();
          }
          this.clearPhoto(); this.photoTex = this.tex(canvas); this.photoCanvas = canvas; this.applyFinish(this.o.finish);
          const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!calm) { this.pop = { s: .82, t0: performance.now() }; if (this.o.mode !== 'back' && !this.drag) this.spin = { t0: performance.now() }; }
          this.dirty = true; this.imageStatus = 'ready'; this.lastError = null; settled = true; cleanup(); resolve(this.getState());
        } catch (error) { fail('The image could not be rendered. Check its format and cross-origin permission.', error); }
      };
      im.src = o.img;
    });
    // Public readyImage() retains the rejection; this prevents an unobserved load from becoming an unhandled rejection.
    this.imagePromise.catch(() => {});
  }
  clearPhoto() {
    this.photoTex?.dispose();
    if (this.brushed) Object.values(this.brushed).forEach(texture => texture.dispose());
    this.photoTex = this.photoCanvas = this.brushed = null;
    Object.assign(this.frontMat, { map: null, emissiveMap: null, metalnessMap: null, roughnessMap: null, bumpMap: null });
    this.frontMat.needsUpdate = true;
  }
  tex(canvas) { const T = this.T, t = new T.CanvasTexture(canvas); t.encoding = T.sRGBEncoding; t.minFilter = T.LinearMipmapLinearFilter; t.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 16); return t; }
  brushedMap() { // fine horizontal streaks: roughness (G) + bump for the brushed aluminium back
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const x = c.getContext('2d'); x.fillStyle = 'rgb(96,96,96)'; x.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 2600; i++) { const v = 60 + Math.random() * 90 | 0, y = Math.random() * 1024; x.fillStyle = `rgba(${v},${v},${v},${.25 + Math.random() * .5})`; x.fillRect(Math.random() * 512 - 256, y, 128 + Math.random() * 640, Math.random() < .8 ? 1 : 2); }
    const t = new this.T.CanvasTexture(c); t.wrapS = t.wrapT = this.T.RepeatWrapping; return t;
  }
  brushedPhoto(src) {
    // raw aluminium print, the way the reference builds it: the photo multiplied onto a brushed-aluminium base,
    // (saturation +30 %, contrast −50 % before; brightness +30 %, contrast ×2 after) — light areas end up as bare brushed metal
    const w = src.width, h = src.height, mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
    const [base, bx] = mk(), g = bx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#c7cace'); g.addColorStop(.5, '#dfe1e4'); g.addColorStop(1, '#bcc0c5'); bx.fillStyle = g; bx.fillRect(0, 0, w, h);
    for (let i = 0; i < h * 2.2; i++) { const v = 150 + Math.random() * 95 | 0; bx.fillStyle = `rgba(${v},${v},${v + 4},${.12 + Math.random() * .3})`; bx.fillRect(Math.random() * w - w * .3, Math.random() * h, w * (.25 + Math.random() * .9), Math.random() < .85 ? 1 : 2); }
    const [ph, px] = mk(); px.filter = 'saturate(130%) contrast(50%)'; px.drawImage(src, 0, 0);
    bx.globalCompositeOperation = 'multiply'; bx.drawImage(ph, 0, 0); bx.globalCompositeOperation = 'source-over';
    const [out, ox] = mk(); ox.filter = 'brightness(130%) contrast(200%)'; ox.drawImage(base, 0, 0);
    return out;
  }
  brushedMaps(src) { // for the brushed finish: where the photo is light, the print is bare brushed aluminium (metal, streaky roughness)
    const w = src.width, h = src.height, mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently:true })]; };
    const comp = this.brushedPhoto(src), [mr, mx] = mk(), [em, ex] = mk();
    const lum = src.getContext('2d', { willReadFrequently:true }).getImageData(0, 0, w, h).data, cd = comp.getContext('2d').getImageData(0, 0, w, h).data;
    const md = mx.createImageData(w, h), ed = ex.createImageData(w, h), streak = new Float32Array(h);
    for (let y = 0; y < h; y++) streak[y] = Math.random();
    for (let i = 0, p = 0; i < lum.length; i += 4, p++) {
      const L = (lum[i] * .299 + lum[i + 1] * .587 + lum[i + 2] * .114) / 255, metal = Math.min(1, Math.max(0, (L - .5) / .4)), y = (p / w) | 0;
      const rough = .28 + .16 * streak[y] + .1 * Math.random();
      md.data[i] = 0; md.data[i + 1] = rough * 255; md.data[i + 2] = metal * 255; md.data[i + 3] = 255; // G = roughness, B = metalness (three's channels)
      const k = 1 - .38 * metal; ed.data[i] = cd[i] * k; ed.data[i + 1] = cd[i + 1] * k; ed.data[i + 2] = cd[i + 2] * k; ed.data[i + 3] = 255; // bare metal isn't "lit from inside"
    }
    mx.putImageData(md, 0, 0); ex.putImageData(ed, 0, 0);
    const mrT = new this.T.CanvasTexture(mr); mrT.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 16);
    return { color: this.tex(comp), emissive: this.tex(em), mr: mrT };
  }
  applyFinish(finish) {
    const m = this.frontMat, T = this.T;
    if (!this.photoTex) return;
    if (finish === 'brushed') {
      if (!this.brushed) this.brushed = this.brushedMaps(this.photoCanvas);
      const b = this.brushed; // raw aluminium: metal where the photo is light, satin ink elsewhere, no coat
      Object.assign(m, { map:b.color, emissiveMap:b.emissive, metalnessMap:b.mr, roughnessMap:b.mr, bumpMap:this.brushTex, bumpScale:.0006, metalness:1, roughness:1, clearcoat:0, envMapIntensity:1 });
      m.color.setScalar(.55); m.emissive.setScalar(.72);
    } else { // high-gloss white: vivid photo under a clear glossy coat that picks up crisp studio reflections
      Object.assign(m, { map:this.photoTex, emissiveMap:this.photoTex, metalnessMap:null, roughnessMap:null, bumpMap:null, metalness:0, roughness:.45, clearcoat:1, clearcoatRoughness:.07, envMapIntensity:.7 });
      m.color.setScalar(.2); m.emissive.setScalar(.84);
    }
    m.needsUpdate = true; this.dirty = true;
  }
  makePlate(gW, gH, D) { // rounded aluminium panel with a small polished bevel; the photo sits on the flat face
    const T = this.T, bev = D * .3, w = gW - 2 * bev, h = gH - 2 * bev, r = Math.min(gW, gH) * .016;
    const sh = new T.Shape(); sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const body = new T.ExtrudeGeometry(sh, { depth: D - 2 * bev, bevelEnabled:true, bevelThickness:bev, bevelSize:bev, bevelSegments:3, curveSegments:6 }); body.translate(0, 0, -(D - 2 * bev) / 2);
    const g = new T.Group(); g.add(new T.Mesh(body, [this.backMat, this.edgeMat]));
    const face = new T.ShapeGeometry(sh, 6), uv = face.attributes.uv, pos = face.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
    const fm = new T.Mesh(face, this.frontMat); fm.position.z = D / 2 + .0004; g.add(fm);
    return g;
  }
  buildHardware(mount) {
    const T = this.T; if (!this.dims) return; const { gW, gH } = this.dims;
    this.hw.children.forEach(m => { m.geometry.dispose(); if (m.material !== this.hwMat && m.material !== this.darkMat) m.material.dispose(); }); this.hw.clear();
    const add = (geo, mat, x, y, z, rx = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; this.hw.add(m); return m; };
    if(mount==='float'||mount==='magnet') {
      const spec={widthCm:this.o.widthCm,heightCm:this.o.heightCm,size:this.o.size,mount};
      for(const rect of Layout.mounts(spec)) {
        const side=rect.w/spec.widthCm*gW,px=(.5-(rect.x+rect.w/2)/spec.widthCm)*gW,py=(.5-(rect.y+rect.h/2)/spec.heightCm)*gH;
        if(mount==='float') {
          const r=side*.06,half=side/2,sh=new T.Shape();sh.moveTo(-half+r,-half);sh.lineTo(half-r,-half);sh.quadraticCurveTo(half,-half,half,-half+r);sh.lineTo(half,half-r);sh.quadraticCurveTo(half,half,half-r,half);sh.lineTo(-half+r,half);sh.quadraticCurveTo(-half,half,-half,half-r);sh.lineTo(-half,-half+r);sh.quadraticCurveTo(-half,-half,-half+r,-half);
          const slot=new T.Path(),sw=side*.19,sy=side*.31,hh=side*.035;slot.moveTo(-sw/2,sy-hh);slot.lineTo(-sw/2,sy+hh);slot.lineTo(sw/2,sy+hh);slot.lineTo(sw/2,sy-hh);slot.closePath();sh.holes.push(slot);
          add(new T.ExtrudeGeometry(sh,{depth:.003,bevelEnabled:true,bevelThickness:.0006,bevelSize:.0006,bevelSegments:2,curveSegments:6}),new T.MeshStandardMaterial({color:0xb8bdc4,roughness:.46,metalness:.8}),px,py,-.015);
        }else {add(new T.BoxGeometry(side,side,.006),this.hwMat,px,py,-.003);add(new T.BoxGeometry(side,side,.012),this.darkMat,px,py,-.035);add(new T.BoxGeometry(side,side,.002),new T.MeshStandardMaterial({color:0x285baf,roughness:.9}),px,py,-.043);}
      }
    }

    else {
      add(new T.BoxGeometry(gW * .56, .05, .022), this.hwMat, 0, gH * .36, -.011);
      // kickstand: top end rests against the back, bottom end kicks out away from the plate
      const len = gH * .42, tilt = .32; add(new T.BoxGeometry(.075, len, .014), this.hwMat, 0, -gH * .08, -(.009 + len / 2 * Math.sin(tilt)), tilt);
    }
  }
  setBackText(o) {
    if(this.backLettering){this.group.remove(this.backLettering);this.backLettering.geometry.dispose();this.backLettering.material.map.dispose();this.backLettering.material.dispose();this.backLettering=null;}
    if(!o.backText?.text||!this.dims)return;
    const spec={widthCm:o.widthCm,heightCm:o.heightCm,size:o.size,mount:o.mount};
    if(!Layout.layout(o.backText,spec).ok)return;
    const T=this.T,canvas=backTextCanvas(spec,o.backText,1600),texture=this.tex(canvas),mesh=new T.Mesh(new T.PlaneGeometry(this.dims.gW,this.dims.gH),new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
    mesh.rotation.y=Math.PI;mesh.position.z=-this.dims.D/2-.0005;this.group.add(mesh);this.backLettering=mesh;this.dirty=true;
  }
  setMode(mode, animate) {
    const T = this.T, ctl = this.controls, cam = this.camera;
    this.tweens = []; this.animating = false; ctl.enabled = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) animate = false;
    const tgt = mode === 'back' ? { th: YAW + Math.PI - .42, ph: Math.PI / 2 - .08, r: this.camR } : { th: YAW, ph: Math.PI / 2 - LIFT, r: this.camR };
    this.spin = null;
    const sph = new T.Spherical().setFromVector3(cam.position.clone().sub(ctl.target));
    let d = tgt.th - sph.theta; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const from = { th: sph.theta, ph: sph.phi, r: sph.radius };
    const apply = k => { const s = new T.Spherical(from.r + (tgt.r - from.r) * k, from.ph + (tgt.ph - from.ph) * k, from.th + d * k); cam.position.setFromSpherical(s).add(ctl.target); cam.lookAt(ctl.target); };
    if (!animate) { apply(1); return; }
    this.animating = true; ctl.enabled = false;
    this.tween(1000, k => apply(easeInOutCubic(k)), () => { this.animating = false; ctl.enabled = true; });
  }
  buildSpots(spots) {
    this.layer.innerHTML = ''; this.spots = []; this.openSpot = -1; if (!spots || !spots.length || !this.dims) return;
    const { gW, gH, D } = this.dims;
    spots.forEach((s, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = '+'; b.setAttribute('aria-label', s.t);
      b.style.cssText = 'position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:0;background:#fff;color:#141414;font:800 16px/28px Arial,sans-serif;box-shadow:0 0 0 6px rgba(255,255,255,.28);cursor:pointer;pointer-events:auto;';
      const tip = document.createElement('div'); tip.textContent = s.t; tip.style.cssText = 'position:absolute;left:0;top:0;width:170px;transform:translate(-50%,22px);background:#141414;color:#fff;font:600 11.5px/1.45 Arial,sans-serif;padding:8px 10px;border-radius:9px;display:none;pointer-events:none;box-shadow:0 8px 20px rgba(0,0,0,.35)';
      b.onclick = e => { e.stopPropagation(); const open = this.openSpot === i; this.spots.forEach(x => { x.tip.style.display = 'none'; x.b.textContent = '+'; }); this.openSpot = open ? -1 : i; if (!open) { tip.style.display = 'block'; b.textContent = '×'; } };
      b.onpointerdown = e => e.stopPropagation();
      this.layer.appendChild(b); this.layer.appendChild(tip);
      this.spots.push({ b, tip, v: new this.T.Vector3((.5 - s.x / 100) * gW, (.5 - s.y / 100) * gH, -D / 2 - .02) });
    });
  }
  placeSpots() {
    if (!this.spots.length) return; const w = this.el.clientWidth, h = this.el.clientHeight, T = this.T;
    const n = new T.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion), toCam = this.camera.position.clone().normalize(), vis = n.dot(toCam) > .15 && !this.animating;
    this.spots.forEach(s => { const p = s.v.clone().applyMatrix4(this.group.matrixWorld).project(this.camera); const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h; const st = `translate(${x}px,${y}px)`; s.b.style.transform = st; s.tip.style.left = x + 'px'; s.tip.style.top = y + 'px'; s.b.style.display = vis ? 'block' : 'none'; if (!vis) s.tip.style.display = 'none'; });
  }
  destroy() {
    if (this.dead) return;
    this.dead = true; this.imageGeneration++; this.cancelImage?.();
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.io.disconnect(); this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this._onMove); canvas.removeEventListener('pointerleave', this._onLeave);
    if (this._onTS) {
      const capture = { capture: true };
      this.el.removeEventListener('touchstart', this._onTS, capture); this.el.removeEventListener('touchmove', this._onTM, capture);
      this.el.removeEventListener('touchend', this._onTE, capture); this.el.removeEventListener('touchcancel', this._onTE, capture);
    }
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) materials.add(material);
    });
    for (const material of [this.edgeMat, this.backMat, this.frontMat, this.hwMat, this.darkMat, this.shadowMat]) if (material) materials.add(material);
    for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const texture of [this.photoTex, this.brushTex, this.shadowTex, ...Object.values(this.brushed || {})]) if (texture) textures.add(texture);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.scene.environment = null; this.scene.clear(); this.engine.dispose();
    this.photoCanvas = null; this.tweens = []; this.spots = [];
    if (canvas.parentNode === this.el) canvas.remove(); this.layer.remove();
  }
}

// Studio HDRI for the 3D viewer (three.js r126 globals). Paste into the store script.
// assets/studio-env.webp = Poly Haven "Blue Photo Studio" (CC0), 1024×512, log2-encoded per channel
// (byte b>0 → linear 2^(LO + b/255·(HI−LO)), b=0 → black), made by tools/env/convert-env.mjs.
// The image is decoded once (≈10 ms) into RGBE bytes; each renderer then gets its own PMREM (≈20–30 ms).
const STUDIO_ENV = './assets/studio-env.webp', ENV_LO = -10, ENV_HI = 10.25; // LO/HI must match convert-env.mjs
let _envDataP = null;
const loadEnvData = () => _envDataP || (_envDataP = (async () => {
  const im = new Image(); im.decoding = 'async'; im.src = STUDIO_ENV; await im.decode();
  const w = im.naturalWidth, h = im.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const src = x.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4);
  // per byte: linear value, and for the brightest channel the RGBE exponent + mantissa scale (three: rgb/255 · 2^(a−128))
  const lin = new Float32Array(256), ex = new Uint8Array(256), sc = new Float32Array(256);
  for (let b = 1; b < 256; b++) { lin[b] = 2 ** (ENV_LO + b / 255 * (ENV_HI - ENV_LO)); const e = Math.ceil(Math.log2(lin[b])); ex[b] = e + 128; sc[b] = 255 / 2 ** e; }
  let lo = 255, hi = 0;
  for (let y = 0; y < h; y++) for (let i = y * w * 4, o = (h - 1 - y) * w * 4, e = i + w * 4; i < e; i += 4, o += 4) { // rows written bottom-up → flipY stays false
    const r = src[i], g = src[i + 1], b = src[i + 2], m = r > g ? (r > b ? r : b) : (g > b ? g : b); if (!m) continue;
    if (m < lo) lo = m; if (m > hi) hi = m;
    const k = sc[m]; out[o] = Math.min(255, Math.round(lin[r] * k)); out[o + 1] = Math.min(255, Math.round(lin[g] * k)); out[o + 2] = Math.min(255, Math.round(lin[b] * k)); out[o + 3] = ex[m];
  }
  if (hi - lo < 16) throw new Error('env read-back blocked'); // canvas read-back disabled (privacy mode) → keep the fallback studio
  return { out, w, h };
})().catch(e => { _envDataP = null; throw e; }));
// → Promise<Texture> (PMREM cube-UV texture for scene.environment); rejects if the file can't load
const loadStudioEnv = async (T, renderer) => {
  const { out, w, h } = await loadEnvData();
  const tex = new T.DataTexture(out, w, h, T.RGBAFormat, T.UnsignedByteType);
  tex.encoding = T.RGBEEncoding; tex.minFilter = tex.magFilter = T.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  const pm = new T.PMREMGenerator(renderer), rt = pm.fromEquirectangular(tex); pm.dispose(); tex.dispose();
  return rt.texture;
};

import { viewerError } from './errors.js';

// Module-relative and self-hosted. This WebP stores HDR channels as log2 values.
const STUDIO_ENV = new URL('../assets/studio-env.webp', import.meta.url).href;
const ENV_LO = -10, ENV_HI = 10.25, YAW = 2.1;
let environmentDataPromise;

function loadEnvironmentData() {
  if (environmentDataPromise) return environmentDataPromise;
  environmentDataPromise = (async () => {
    const image = new Image(); image.decoding = 'async'; image.src = STUDIO_ENV;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const source = context.getImageData(0, 0, width, height).data, output = new Uint8Array(width * height * 4);
    const linear = new Float32Array(256), exponent = new Uint8Array(256), scale = new Float32Array(256);
    for (let b = 1; b < 256; b++) {
      linear[b] = 2 ** (ENV_LO + b / 255 * (ENV_HI - ENV_LO));
      const e = Math.ceil(Math.log2(linear[b])); exponent[b] = e + 128; scale[b] = 255 / 2 ** e;
    }
    let low = 255, high = 0;
    for (let y = 0; y < height; y++) {
      // Reverse rows so the DataTexture can retain flipY=false.
      for (let i = y * width * 4, o = (height - 1 - y) * width * 4, end = i + width * 4; i < end; i += 4, o += 4) {
        const red = source[i], green = source[i + 1], blue = source[i + 2], max = Math.max(red, green, blue);
        if (!max) continue;
        low = Math.min(low, max); high = Math.max(high, max);
        const k = scale[max];
        output[o] = Math.min(255, Math.round(linear[red] * k));
        output[o + 1] = Math.min(255, Math.round(linear[green] * k));
        output[o + 2] = Math.min(255, Math.round(linear[blue] * k));
        output[o + 3] = exponent[max];
      }
    }
    if (high - low < 16) throw new Error('Environment canvas read-back was blocked.');
    return { output, width, height };
  })().catch(error => { environmentDataPromise = null; throw error; });
  return environmentDataPromise;
}

function fallbackStudio(T) {
  const scene = new T.Scene(), rig = new T.Group();
  const lit = (k, color = 0xffffff) => new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), side: T.DoubleSide });
  const room = new T.Mesh(new T.BoxGeometry(18, 11, 18), lit(.08));
  room.material.side = T.BackSide; room.position.y = 1; scene.add(room, rig); rig.rotation.y = YAW;
  const face = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.lookAt(0, 0, 0); rig.add(mesh); };
  const disc = new T.CircleGeometry(.35, 32);
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 2; j++) face(new T.Mesh(disc, lit(3)), i * 1.6, j * 1.5, 7);
  face(new T.Mesh(new T.PlaneGeometry(1.3, 7), lit(2)), -7.5, .5, 1.5);
  face(new T.Mesh(new T.PlaneGeometry(1.3, 7), lit(1.4)), 7.5, .5, 1.5);
  face(new T.Mesh(new T.PlaneGeometry(7, 4.5), lit(1)), 1, 1, -7.5);
  face(new T.Mesh(new T.PlaneGeometry(14, 14), lit(.3, 0xffe7cc)), 0, -4.8, 0);
  return scene;
}

export function createEngine(T, onError) {
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (error) { throw viewerError('webgl_unavailable', 'WebGL is unavailable in this browser.', error); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1; renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Interactive photo print. Drag to rotate; pinch or scroll to zoom.');
  const pmrem = new T.PMREMGenerator(renderer), engine = {
    r: renderer, dead: false, env: null, environmentStatus: 'loading', envTarget: null,
  };
  const studio = fallbackStudio(T), geometries = new Set(), materials = new Set();
  engine.fallbackTarget = pmrem.fromScene(studio, .04); engine.fallback = engine.fallbackTarget.texture;
  studio.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  engine.envP = loadEnvironmentData().then(({ output, width, height }) => {
    if (engine.dead) return null;
    const texture = new T.DataTexture(output, width, height, T.RGBAFormat, T.UnsignedByteType);
    texture.encoding = T.RGBEEncoding; texture.minFilter = texture.magFilter = T.NearestFilter;
    texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
    try {
      engine.envTarget = pmrem.fromEquirectangular(texture); engine.env = engine.envTarget.texture;
      engine.environmentStatus = 'studio'; return engine.env;
    } finally { texture.dispose(); }
  }).catch(error => {
    if (!engine.dead) {
      engine.environmentStatus = 'fallback';
      onError?.(viewerError('environment_unavailable', 'Studio reflections could not be loaded; the built-in studio is being used.', error));
    }
    return null;
  });
  const lost = event => {
    event.preventDefault();
    if (!engine.dead) onError?.(viewerError('webgl_context_lost', 'The browser lost the graphics context. Recreate this viewer.'));
  };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  engine.dispose = () => {
    if (engine.dead) return; engine.dead = true;
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    engine.envTarget?.dispose(); engine.fallbackTarget.dispose(); pmrem.dispose();
    engine.env = engine.fallback = engine.envTarget = engine.fallbackTarget = null;
    renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
  return engine;
}

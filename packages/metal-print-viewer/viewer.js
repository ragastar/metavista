import THREE from './vendor/three-r126.js';
import { PrintViewer } from './internal/print-viewer.js';
import * as Layout from './internal/print-layout.js';
import { viewerError } from './internal/errors.js';

const defaults = Object.freeze({ image: null, widthCm: 30, heightCm: 40, size: 'M', mount: 'float',
  finish: 'gloss', mode: 'front', backText: null, watermark: false, spots: null, visible: true, onError: null });
const optionNames = new Set(Object.keys(defaults));
const mounted = new WeakSet();

function imageUrl(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof URL)) throw viewerError('invalid_image', 'image must be a URL string, URL object, or null.');
  let url; try { url = new URL(value, document.baseURI); } catch { throw viewerError('invalid_image', 'The image URL is invalid.'); }
  if (url.protocol === 'data:' && /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml)(?:;|,)/i.test(url.href)) return url.href;
  if (url.protocol === 'blob:' || url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) return url.href;
  throw viewerError('invalid_image', 'Use a local image URL, HTTPS image, data image, or Blob URL.');
}

function normalize(previous, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw viewerError('invalid_options', 'Viewer options must be an object.');
  for (const key of Object.keys(patch)) if (!optionNames.has(key)) throw viewerError('invalid_options', `Unknown viewer option: ${key}`);
  const options = { ...previous, ...patch };
  for (const key of ['widthCm', 'heightCm']) if (typeof options[key] !== 'number' || !Number.isFinite(options[key]) || options[key] < 10 || options[key] > 150)
    throw viewerError('invalid_dimensions', 'widthCm and heightCm must be numbers from 10 to 150.');
  for (const [key, allowed] of [['size', ['M', 'L', 'XL']], ['mount', ['float', 'magnet', 'standard']], ['finish', ['gloss', 'brushed']], ['mode', ['front', 'back']]])
    if (!allowed.includes(options[key])) throw viewerError('invalid_options', `${key} must be one of: ${allowed.join(', ')}.`);
  if (typeof options.visible !== 'boolean') throw viewerError('invalid_options', 'visible must be true or false.');
  if (options.onError !== null && typeof options.onError !== 'function') throw viewerError('invalid_options', 'onError must be a function or null.');
  if (typeof options.watermark !== 'boolean' && (typeof options.watermark !== 'string' || options.watermark.length > 160))
    throw viewerError('invalid_options', 'watermark must be false, true, or a string up to 160 characters.');
  options.image = imageUrl(options.image);
  try { options.backText = Layout.config(options.backText); } catch { throw viewerError('invalid_back_text', 'The back text or its font/position is invalid.'); }
  const spec = { widthCm: options.widthCm, heightCm: options.heightCm, size: options.size, mount: options.mount };
  const layout = Layout.layout(options.backText, spec);
  if (!layout.ok) throw viewerError(layout.error, 'The back text overlaps a mount or extends past the print edge.');
  if (options.spots !== null) {
    if (!Array.isArray(options.spots) || options.spots.length > 30) throw viewerError('invalid_spots', 'spots must be null or an array of at most 30 labels.');
    options.spots = options.spots.map(spot => {
      if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y) || spot.x < 0 || spot.x > 100 || spot.y < 0 || spot.y > 100 || typeof spot.t !== 'string' || spot.t.length > 300)
        throw viewerError('invalid_spots', 'Each spot needs x/y percentages from 0 to 100 and a text label t.');
      return { x: spot.x, y: spot.y, t: spot.t };
    });
  }
  return options;
}

function rendererOptions(options) {
  const { widthCm, heightCm, size, mount } = options;
  const spots = options.spots ?? (mount === 'float' || mount === 'magnet' ? Layout.mounts({ widthCm, heightCm, size, mount }).map(rect => ({
    x: (rect.x + rect.w / 2) / widthCm * 100, y: (rect.y + rect.h / 2) / heightCm * 100,
    t: mount === 'magnet' ? 'Steel plate and magnetic wall mount' : 'Metal plate with hanging slot',
  })) : []);
  return { ...options, img: options.image, aspect: widthCm / heightCm, wm: options.watermark === true ? 'PREVIEW' : options.watermark || '', spots };
}

/**
 * Mount one independent self-hosted viewer. The returned object is ready to update;
 * await viewer.readyImage() when the current photo texture must be fully loaded.
 * All required JavaScript and the studio environment are shipped beside this module.
 */
export async function createPrintViewer(element, initialOptions = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw viewerError('browser_required', 'Create a viewer in a browser after the page has mounted.');
  if (!element || element.nodeType !== 1 || element.ownerDocument !== document) throw viewerError('invalid_container', 'Pass a DOM element from this document.');
  if (mounted.has(element)) throw viewerError('container_in_use', 'This container already has a viewer. Destroy it before creating another.');
  let options = normalize(defaults, initialOptions), core;
  const originalPosition = element.style.position, changedPosition = getComputedStyle(element).position === 'static';
  if (changedPosition) element.style.position = 'relative';
  const notify = error => { try { options.onError?.(error); } catch (callbackError) { console.error('Print viewer onError callback failed', callbackError); } };
  try { core = new PrintViewer(element, THREE, notify); core.update(rendererOptions(options)); }
  catch (error) { core?.destroy(); if (changedPosition) element.style.position = originalPosition; notify(error); throw error; }
  mounted.add(element);
  const api = {
    update(patch) {
      if (core.dead) throw viewerError('viewer_destroyed', 'This viewer has been destroyed.');
      const next = normalize(options, patch); core.update(rendererOptions(next)); options = next; return api;
    },
    readyImage() { return core.dead ? Promise.reject(viewerError('viewer_destroyed', 'This viewer has been destroyed.')) : core.imagePromise; },
    getState() {
      const { onError, ...publicOptions } = options;
      return { ...core.getState(), options: { ...publicOptions, backText: options.backText ? { ...options.backText } : null,
        spots: options.spots?.map(spot => ({ ...spot })) ?? null } };
    },
    destroy() {
      if (core.dead) return; core.destroy(); mounted.delete(element);
      if (changedPosition && element.style.position === 'relative') element.style.position = originalPosition;
    },
  };
  return api;
}

export default createPrintViewer;

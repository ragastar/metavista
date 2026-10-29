import { createPrintViewer } from './viewer.js';

const exampleImage = new URL('./assets/demo.svg', import.meta.url).href;
const host = document.querySelector('#viewer');
const controls = document.querySelector('#controls');
const status = document.querySelector('#viewer-status');
const errorBox = document.querySelector('#control-error');
const photoInput = document.querySelector('#photo');
const photoName = document.querySelector('#photo-name');
const backFields = document.querySelector('#back-fields');
const sizes = { M: [30, 40], L: [45, 60], XL: [60, 80] };
const defaults = {
  image: exampleImage,
  widthCm: 30,
  heightCm: 40,
  size: 'M',
  mount: 'float',
  finish: 'gloss',
  mode: 'front',
  backText: null,
  watermark: false,
  visible: true,
};

let viewer;
let fallbackImage;
let currentImage = exampleImage;
let localImageUrl = null;
let imageRequest = 0;
let textTimer;
let disposed = false;

function reportError(error) {
  if (error?.code === 'environment_unavailable') {
    refreshStatus();
    return;
  }
  if (error?.code === 'webgl_unavailable') return;
  const imageFailure = error?.code === 'image_load_failed';
  errorBox.textContent = imageFailure
    ? 'Не удалось открыть изображение. Попробуйте другое фото в формате JPEG, PNG или WebP.'
    : 'Не удалось применить настройки. Если добавили надпись, сократите текст, уменьшите буквы или выберите другое положение.';
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function refreshStatus() {
  if (fallbackImage && !disposed) {
    status.textContent = '3D недоступно в этом браузере — показываем обычное изображение';
    return;
  }
  if (!viewer || disposed) return;
  const state = viewer.getState();
  if (state.imageStatus === 'loading') {
    status.textContent = 'Загружаем изображение…';
  } else if (state.imageStatus === 'error') {
    status.textContent = 'Изображение не загрузилось';
  } else if (state.environment === 'fallback') {
    status.textContent = 'Резервное освещение';
  } else {
    status.textContent = 'Фото остаётся в вашем браузере';
  }
}

function settingsFromForm() {
  const values = new FormData(controls);
  const size = values.get('size');
  let [widthCm, heightCm] = sizes[size];
  if (values.get('orientation') === 'landscape') [widthCm, heightCm] = [heightCm, widthCm];
  return {
    image: currentImage,
    size,
    widthCm,
    heightCm,
    mount: values.get('mount'),
    finish: values.get('finish'),
    mode: values.get('mode'),
    backText: values.get('backEnabled') && values.get('backText').trim()
      ? {
          text: values.get('backText').trim(),
          position: values.get('backPosition'),
          fontMm: Number(values.get('backFont')),
        }
      : null,
  };
}

function applySettings() {
  if (disposed) return false;
  if (fallbackImage) {
    fallbackImage.src = currentImage;
    clearError();
    refreshStatus();
    return true;
  }
  if (!viewer) return false;
  clearError();
  backFields.hidden = !controls.elements.backEnabled.checked;
  try {
    viewer.update(settingsFromForm());
    refreshStatus();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

// Useful for checking several independent viewers on the same page.
window.createDemoViewer = (container = host, options = {}) => createPrintViewer(container, { ...defaults, ...options });

controls.addEventListener('submit', event => event.preventDefault());
controls.addEventListener('change', event => {
  if (event.target === photoInput) return;
  clearTimeout(textTimer);
  if (event.target.name === 'backEnabled' && event.target.checked) controls.elements.mode.value = 'back';
  applySettings();
});
controls.elements.backText.addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(applySettings, 180);
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file || (!viewer && !fallbackImage) || disposed) return;
  const previousUrl = localImageUrl;
  const candidateUrl = URL.createObjectURL(file);
  const previousImage = currentImage;
  currentImage = candidateUrl;
  if (!applySettings()) {
    currentImage = previousImage;
    URL.revokeObjectURL(candidateUrl);
    return;
  }
  localImageUrl = candidateUrl;
  photoName.textContent = file.name;
  const request = ++imageRequest;
  try {
    if (viewer) await viewer.readyImage();
    else await fallbackImage.decode();
  } catch (error) {
    if (request === imageRequest && !disposed) reportError(error);
  } finally {
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    if (request === imageRequest) refreshStatus();
  }
});

document.querySelector('#reset').addEventListener('click', async () => {
  controls.reset();
  backFields.hidden = true;
  clearTimeout(textTimer);
  const previousUrl = localImageUrl;
  currentImage = exampleImage;
  localImageUrl = null;
  photoName.textContent = 'Останется в вашем браузере';
  const request = ++imageRequest;
  if (!applySettings()) return;
  try {
    if (viewer) await viewer.readyImage();
    else await fallbackImage.decode();
  } catch (error) {
    if (request === imageRequest && !disposed) reportError(error);
  } finally {
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    if (request === imageRequest) refreshStatus();
  }
});

window.addEventListener('pagehide', () => {
  disposed = true;
  imageRequest++;
  clearTimeout(textTimer);
  viewer?.destroy();
  if (localImageUrl) URL.revokeObjectURL(localImageUrl);
}, { once: true });

window.demoReady = (async () => {
  try {
    viewer = await window.createDemoViewer(host, {
      onError(error) {
        if (disposed) return;
        reportError(error);
        refreshStatus();
      },
    });
    window.demoViewer = viewer;
    await viewer.readyImage();
    refreshStatus();
    return viewer;
  } catch (error) {
    if (error?.code === 'webgl_unavailable') {
      fallbackImage = new Image();
      fallbackImage.alt = 'Фотография для печати';
      fallbackImage.src = currentImage;
      host.appendChild(fallbackImage);
      for (const input of controls.querySelectorAll('select,textarea,input[type="checkbox"]')) input.disabled = true;
      document.querySelector('.gesture').textContent = 'Для 3D включите аппаратное ускорение или откройте страницу в другом браузере';
      refreshStatus();
    } else {
      reportError(error);
      status.textContent = 'Не удалось запустить просмотр. Обновите страницу или выберите другое фото.';
    }
    return null;
  }
})();

await window.demoReady;

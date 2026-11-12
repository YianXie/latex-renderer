'use strict';

// 200 px per em is 12pt type at 1200 dpi.
const PX_PER_EM = 200;
const EM_PER_EX = 0.442;  // x-height of MathJax's TeX font.
// Long expressions scale down to stay inside browser canvas limits.
const MAX_SIDE = 8192;
const MAX_AREA = 16e6;
const PADDING_EM = 0.12;
const PREVIEW_PX_PER_EM = 32;

window.MathJax = {
  tex: {
    // Bad input must surface as an error, and nothing should load at runtime.
    packages: { '[-]': ['noundefined', 'noerrors', 'autoload', 'require'] },
  },
  svg: { fontCache: 'local' },
  startup: {
    typeset: false,
    ready() {
      MathJax.startup.defaultReady();
      MathJax.startup.promise.then(start);
    },
  },
};

const $ = (id) => document.getElementById(id);
const input = $('input');
const image = $('image');
const message = $('message');
const white = $('white');
const copyButton = $('copy');
const downloadButton = $('download');
const preview = image.parentElement;

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const DELIMITERS = /^(?:\$\$([\s\S]*)\$\$|\$([\s\S]*)\$|\\\[([\s\S]*)\\\]|\\\(([\s\S]*)\\\))$/;

let generation = 0;  // Identifies the newest render, so stale async work is dropped.
let source = null;   // The current expression as a loaded SVG image.
let blobPromise = null;  // Resolves to the current PNG. Null when there is nothing to export.
let previewUrl = null;

function start() {
  input.addEventListener('input', render);
  white.addEventListener('change', () => source && paint());
  downloadButton.addEventListener('click', download);
  copyButton.addEventListener('click', copy);
  document.addEventListener('keydown', onKeydown);
  copyButton.title = isMac ? '⌘C' : 'Ctrl+C';
  render();
}

function stripDelimiters(text) {
  const match = text.trim().match(DELIMITERS);
  return match ? match.slice(1).find((group) => group !== undefined).trim() : text.trim();
}

// MathJax ignores \\ and \newline outside an environment, so input that uses
// them at the top level is wrapped in one: align* if it also has a top-level &,
// otherwise gather* for centered lines.
function wrapLines(tex) {
  let depth = 0;  // Nesting of {…} groups and \begin…\end environments.
  let hasBreak = false;
  let hasAlignment = false;

  for (let i = 0; i < tex.length; i++) {
    const char = tex[i];
    if (char === '%') {
      const end = tex.indexOf('\n', i);
      if (end === -1) break;
      i = end;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
    } else if (char === '&') {
      if (depth === 0) hasAlignment = true;
    } else if (char === '\\') {
      const name = tex.slice(i + 1).match(/^[a-zA-Z]+/)?.[0];
      if (!name) {
        // A control symbol such as \\, \{ or \&.
        if (tex[i + 1] === '\\' && depth === 0) hasBreak = true;
        i++;
        continue;
      }
      if (name === 'begin') depth++;
      else if (name === 'end') depth--;
      else if (name === 'newline' && depth === 0) hasBreak = true;
      i += name.length;
    }
  }

  if (!hasBreak) return tex;
  const environment = hasAlignment ? 'align*' : 'gather*';
  // The newline keeps a trailing % comment from swallowing \end.
  return `\\begin{${environment}}${tex}\n\\end{${environment}}`;
}

function render() {
  const tex = wrapLines(stripDelimiters(input.value));
  if (!tex) return clear();

  try {
    resetTex();
    const node = MathJax.tex2svg(tex, { display: true, em: PX_PER_EM, ex: PX_PER_EM * EM_PER_EX });
    const failure = node.querySelector('[data-mjx-error]');
    if (failure) return showError(failure.getAttribute('data-mjx-error'));
    source = loadSource(node.querySelector('svg'));
  } catch (error) {
    return showError(error.message);
  }
  paint();
}

// texReset() keeps \def and \newcommand definitions, so they are cleared here.
// Without this, a macro would outlive its removal from the input.
function resetTex() {
  MathJax.texReset();
  const { handlers } = MathJax.startup.input[0].configuration;
  for (const name of ['new-Command', 'new-Delimiter', 'new-Environment']) {
    handlers.retrieve(name).map.clear();
  }
}

// Sizes the SVG for export and loads it as an image the canvas can draw.
function loadSource(svg) {
  // Equations with \tag have width="100%" and carry their real width in min-width.
  const contentWidth = parseFloat(svg.style.minWidth || svg.getAttribute('width')) * EM_PER_EX;
  const contentHeight = parseFloat(svg.getAttribute('height')) * EM_PER_EX;
  const emWidth = contentWidth + 2 * PADDING_EM;
  const emHeight = contentHeight + 2 * PADDING_EM;
  const scale = Math.min(
    PX_PER_EM,
    MAX_SIDE / emWidth,
    MAX_SIDE / emHeight,
    Math.sqrt(MAX_AREA / (emWidth * emHeight)),
  );
  const width = Math.ceil(emWidth * scale);
  const height = Math.ceil(emHeight * scale);

  // MathJax's SVG is nested at its natural size, because \tag layout depends on
  // that viewport. The outer SVG adds the padding and any scaling down.
  svg.setAttribute('x', PADDING_EM * PX_PER_EM);
  svg.setAttribute('y', PADDING_EM * PX_PER_EM);
  svg.setAttribute('width', contentWidth * PX_PER_EM);
  svg.setAttribute('height', contentHeight * PX_PER_EM);
  svg.setAttribute('overflow', 'visible');
  svg.removeAttribute('style');

  const outer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outer.setAttribute('width', width);
  outer.setAttribute('height', height);
  outer.setAttribute('viewBox', `0 0 ${emWidth * PX_PER_EM} ${emHeight * PX_PER_EM}`);
  outer.setAttribute('color', '#000');
  outer.append(svg);

  const markup = new XMLSerializer().serializeToString(outer);
  const loaded = new Promise((resolve, reject) => {
    const svgImage = new Image();
    svgImage.onload = () => resolve(svgImage);
    svgImage.onerror = () => reject(new Error('Could not draw this expression.'));
    svgImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  });
  return { loaded, width, height, cssWidth: emWidth * PREVIEW_PX_PER_EM };
}

function encode(svgImage, { width, height }, withBackground) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (withBackground) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(svgImage, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
}

// The PNG is encoded here, ahead of any click, so export has no wait.
function paint() {
  const id = ++generation;
  const job = source;
  const withBackground = white.checked;
  blobPromise = job.loaded.then((svgImage) => encode(svgImage, job, withBackground));
  blobPromise.then((blob) => showImage(id, job, blob)).catch((error) => {
    if (id === generation) showError(error.message);
  });
}

function showImage(id, job, blob) {
  if (id !== generation) return;

  // The browser keeps showing the old image until this one has loaded.
  const url = URL.createObjectURL(blob);
  image.src = url;
  image.style.width = job.cssWidth + 'px';
  image.hidden = false;
  preview.classList.remove('stale');
  message.textContent = '';
  setEnabled(true);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
}

function invalidate() {
  generation++;
  source = null;
  blobPromise = null;
  setEnabled(false);
}

function clear() {
  invalidate();
  image.hidden = true;
  preview.classList.remove('stale');
  message.textContent = '';
}

// Keeps the last good image, dimmed, so typing doesn't make the preview jump.
function showError(text) {
  invalidate();
  preview.classList.add('stale');
  message.textContent = text;
}

function setEnabled(enabled) {
  copyButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
}

async function download() {
  if (!blobPromise) return;
  const url = URL.createObjectURL(await blobPromise);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'latex.png';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let copyLabelTimer;

async function copy() {
  if (!blobPromise) return;
  let label = 'Copied';
  try {
    // Handing over the promise keeps this inside the user gesture, as Safari requires.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
  } catch {
    label = 'Failed';
  }
  copyButton.textContent = label;
  clearTimeout(copyLabelTimer);
  copyLabelTimer = setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
}

function hasTextSelection() {
  const active = document.activeElement;
  if (active === input && input.selectionStart !== input.selectionEnd) return true;
  return String(window.getSelection()) !== '';
}

// Selected text keeps the normal copy behavior; otherwise the shortcut copies the image.
function onKeydown(event) {
  if (event.key.toLowerCase() !== 'c' || event.shiftKey || event.altKey || event.repeat) return;
  const shortcut = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!shortcut || !blobPromise || hasTextSelection()) return;
  event.preventDefault();
  copy();
}

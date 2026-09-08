/**
 * LinkedIn Toolkit — tiny DOM helpers.
 *
 * No framework, no build step. Everything the popup and the options page draw
 * goes through `el()` and `render()`, so no UI code ever touches `innerHTML`
 * and no LinkedIn-supplied string is ever parsed as markup.
 */

const ATTR_ONLY = new Set(['class', 'for', 'role', 'list']);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.nodeType !== 'number'
  );
}

function applyAttr(node, key, value) {
  if (value === null || value === undefined || value === false) return;

  if (key === 'class' || key === 'className') {
    node.setAttribute('class', String(value));
    return;
  }
  if (key === 'text') {
    node.textContent = String(value);
    return;
  }
  if (key === 'style' && isPlainObject(value)) {
    Object.assign(node.style, value);
    return;
  }
  if (key === 'dataset' && isPlainObject(value)) {
    Object.assign(node.dataset, value);
    return;
  }
  if (key.startsWith('on') && typeof value === 'function') {
    node.addEventListener(key.slice(2).toLowerCase(), value);
    return;
  }
  if (!ATTR_ONLY.has(key) && key in node) {
    node[key] = value;
    return;
  }
  node.setAttribute(key, value === true ? '' : String(value));
}

function appendChild(node, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(node, item);
    return;
  }
  if (typeof child.nodeType === 'number') {
    node.appendChild(child);
    return;
  }
  node.appendChild(document.createTextNode(String(child)));
}

/**
 * Create an element.
 *
 *   el('div', { class: 'card' }, el('h2', 'Title'), 'text')
 *   el('button', { onclick: fn, disabled: true }, 'Run')
 *
 * The second argument is treated as an attribute bag only when it is a plain
 * object; anything else becomes the first child.
 *
 * @param {string} tag
 * @param {object|Node|string|number|Array|null} [attrs]
 * @param {...*} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  let bag = attrs;
  if (!isPlainObject(bag)) {
    if (bag !== undefined) children.unshift(bag);
    bag = null;
  }
  if (bag) for (const [key, value] of Object.entries(bag)) applyAttr(node, key, value);
  for (const child of children) appendChild(node, child);
  return node;
}

/**
 * Replace everything inside `container` with `nodes`.
 * @param {HTMLElement} container
 * @param {*} nodes  node, string, or (nested) array of them
 * @returns {HTMLElement} container
 */
export function render(container, nodes) {
  if (!container) return container;
  container.textContent = '';
  appendChild(container, nodes);
  return container;
}

/** Remove every child of a node. */
export function clear(node) {
  if (node) node.textContent = '';
  return node;
}

/**
 * Format an epoch-milliseconds timestamp for display.
 * @param {number|undefined} ts
 * @param {{ time?: boolean }} [opts]
 */
export function fmtDate(ts, opts = {}) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const date = new Date(n);
  const base = { year: 'numeric', month: 'short', day: 'numeric' };
  if (opts.time) {
    base.hour = '2-digit';
    base.minute = '2-digit';
  }
  return date.toLocaleString(undefined, base);
}

/** Format a number with thousands separators. Non-numbers become an em dash. */
export function fmtNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

/** Format a millisecond duration as "3d 4h", "2h 10m", "45s" or "now". */
export function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 'now';
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Format a past timestamp as "just now" / "12m ago" / a date. */
export function fmtAgo(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const delta = Date.now() - n;
  if (delta < 0) return fmtDate(n, { time: true });
  if (delta < 60_000) return 'just now';
  if (delta < 86_400_000) return `${fmtDuration(delta)} ago`;
  return fmtDate(n);
}

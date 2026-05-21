/**
 * dom.js — Tiny DOM/utility helpers shared across renderers.
 *
 * Lives next to formatters.js. These are not imported as a bundle —
 * pick what you need: `import { escHtml, pct, debounce } from '../utils/dom.js';`
 */

/**
 * HTML-escape a string for safe interpolation into innerHTML.
 * Use this whenever a value originates from API/user input and gets
 * embedded in a template literal that will be assigned to innerHTML.
 * @param {*} s
 * @returns {string}
 */
export function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Percentage of `part` over `total`, rounded to 1 decimal.
 * Returns "0.0" when total is 0/null/undefined.
 * @param {number} part
 * @param {number} total
 * @returns {string}
 */
export function pct(part, total) {
    return total ? ((part / total) * 100).toFixed(1) : '0.0';
}

/**
 * Trailing-edge debounce. Returns a wrapped function that delays
 * invocation until `ms` has elapsed since the last call.
 * @template {(...args:any[])=>any} F
 * @param {F} fn
 * @param {number} ms
 * @returns {F}
 */
export function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// tests/js/setup.mjs — pre-import stubs for modules that touch the DOM at load.
// js/core/main.js builds UINodes via document.querySelector at module top level,
// and router.js/dataStore.js import main.js. Importing those in plain Node would
// throw "document is not defined". Importing THIS file first installs minimal
// globals so the import graph loads; tests then exercise the pure logic.
//
// Usage in a test file:  import './setup.mjs';  (must be the FIRST import)

function makeEl() {
    // A no-op element stand-in: every property read returns another stub,
    // every method is a no-op. Enough for top-level querySelector assignments.
    const el = {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
        setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        textContent: '', innerHTML: '', value: '',
    };
    return el;
}

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        querySelector() { return makeEl(); },
        querySelectorAll() { return []; },
        getElementById() { return makeEl(); },
        createElement() { return makeEl(); },
        addEventListener() {},
        body: makeEl(),
        documentElement: makeEl(),
    };
}

if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
}

if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        clear() { store.clear(); },
    };
}

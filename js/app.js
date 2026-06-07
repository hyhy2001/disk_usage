// Single production entry point — bundled by build.mjs into app.min.js.
// Imports every module for its side effects (window.* global assignments and
// module-load IIFEs). Order matches the original 14 <script> tags in index.html.
// Boot is no longer driven by per-module DOMContentLoaded listeners: each module
// now EXPORTS a named init fn, and ./core/boot.js (imported last) runs them all
// in one ordered, readyState-guarded pass. See boot.js to add a new init.
import './services/dataFetcher.js';
import './core/dataStore.js';
import './renderers/chartManager.js';
import './renderers/permissionRenderer.js';
import './renderers/treeMapRenderer.js';
import './renderers/userDetailRenderer.js';
import './core/main.js';
import './ui/chartModal.js';
import './ui/themeToggle.js';
import './ui/changelogModal.js';
import './features/group-user/groupUserManager.js';
import './ui/scrollToTop.js';
import './ui/tooltip.js';
import './ui/pageBoot.js';
import './core/boot.js';

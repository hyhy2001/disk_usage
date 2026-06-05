// Single production entry point — bundled by build.mjs into app.min.js.
// Imports every module for its side effects (DOMContentLoaded listeners and
// window.* global assignments). Order matches the original 14 <script> tags
// in index.html; boot is driven by independent DOMContentLoaded listeners, so
// order is not load-bearing, but kept identical to avoid surprises.
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

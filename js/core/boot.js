/**
 * boot.js — single startup orchestrator.
 *
 * Previously each module wired its own `DOMContentLoaded` listener, so there
 * was no one place that showed what runs at startup and a new contributor had
 * to remember to add a listener. Now every boot module EXPORTS a named init
 * fn and they are all invoked here, in one explicit, ordered pass.
 *
 * To add a new startup hook: export an init fn from your module, import it
 * below, and add it to INIT_SEQUENCE. That's the only wiring needed.
 *
 * Order note: initAppFetcher runs first (it sets up the router + the
 * window.appFetcher singleton); the rest are independent. This matches the
 * pre-refactor execution order so behavior is unchanged.
 */
import { initAppFetcher } from '../services/dataFetcher.js';
import { initThemeToggle } from '../ui/themeToggle.js';
import { initPageBoot } from '../ui/pageBoot.js';
import { initChartModal } from '../ui/chartModal.js';
import { bindChangeLogEvents } from '../ui/changelogModal.js';
import { initScrollToTop } from '../ui/scrollToTop.js';
import { initGroupUser } from '../features/group-user/groupUserManager.js';

const INIT_SEQUENCE = [
    ['appFetcher', initAppFetcher],
    ['themeToggle', initThemeToggle],
    ['pageBoot', initPageBoot],
    ['chartModal', initChartModal],
    ['changelog', bindChangeLogEvents],
    ['scrollToTop', initScrollToTop],
    ['groupUser', initGroupUser],
];

function runAll() {
    for (const [name, fn] of INIT_SEQUENCE) {
        try {
            fn();
        } catch (err) {
            // One failing init must not abort the rest of startup.
            console.error(`[boot] init "${name}" failed:`, err);
        }
    }
}

// readyState guard: if the DOM is still parsing, wait for it; otherwise the
// bundle was evaluated after DOMContentLoaded already fired, so run now.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAll);
} else {
    runAll();
}

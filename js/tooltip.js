// tooltip.js — Singleton JS tooltip, appended to <body>.
// Reads data-tooltip="" attribute. Not affected by stacking contexts.
// Auto-positions: flips when near viewport edges, clamps horizontally.
// Usage:  data-tooltip="text"
//         data-tooltip-pos="bottom"  (preferred direction; auto-flips if needed)

(function () {
    const GAP     = 9;   // px gap between element and tooltip
    const MARGIN  = 8;   // px min distance from viewport edge

    const tip = document.createElement('div');
    tip.id    = 'js-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let _target = null;
    let _raf    = null;

    function _pos(el) {
        const r     = el.getBoundingClientRect();
        const tw    = tip.offsetWidth;
        const th    = tip.offsetHeight;
        const vw    = window.innerWidth;
        const vh    = window.innerHeight;
        const pref  = el.getAttribute('data-tooltip-pos') || 'top';
        const sx    = window.scrollX;
        const sy    = window.scrollY;

        // ── Vertical: try preferred, flip if out ──────────────────────────────
        let placement;
        if (pref === 'bottom') {
            // Prefer below; flip to top if bottom overflows
            placement = (r.bottom + GAP + th > vh - MARGIN) ? 'top' : 'bottom';
        } else {
            // Prefer above; flip to bottom if top overflows
            placement = (r.top - GAP - th < MARGIN) ? 'bottom' : 'top';
        }

        let top;
        if (placement === 'top') {
            top = r.top - th - GAP + sy;
            tip.setAttribute('data-arrow', 'down');
        } else {
            top = r.bottom + GAP + sy;
            tip.setAttribute('data-arrow', 'up');
        }

        // ── Horizontal: center on element, clamp to viewport ─────────────────
        let left = r.left + r.width / 2 - tw / 2 + sx;
        left = Math.max(MARGIN + sx, Math.min(left, sx + vw - tw - MARGIN));

        tip.style.top  = top  + 'px';
        tip.style.left = left + 'px';
    }

    function _show(el) {
        const text = el.getAttribute('data-tooltip');
        if (!text) return;
        _target         = el;
        tip.textContent = text;
        tip.removeAttribute('data-arrow');
        tip.classList.add('visible');
        // Position after paint so offsetWidth/Height are correct
        _raf = requestAnimationFrame(() => _pos(el));
    }

    function _hide() {
        _target = null;
        cancelAnimationFrame(_raf);
        tip.classList.remove('visible');
    }

    document.addEventListener('mouseover', e => {
        const el = e.target.closest('[data-tooltip]');
        if (el && el !== _target) _show(el);
    });
    document.addEventListener('mouseout', e => {
        const el = e.target.closest('[data-tooltip]');
        if (el) _hide();
    });
    document.addEventListener('focusin', e => {
        const el = e.target.closest('[data-tooltip]');
        if (el) _show(el);
    });
    document.addEventListener('focusout', e => {
        const el = e.target.closest('[data-tooltip]');
        if (el) _hide();
    });
    // Hide on scroll to avoid floating ghost
    document.addEventListener('scroll', _hide, true);
})();

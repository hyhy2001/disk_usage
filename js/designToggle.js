/**
 * designToggle.js — Legacy / Pro-Max design switch with localStorage persistence
 */

const DESIGN_STORAGE_KEY = 'disk-usage-design-mode';

function applyDesign(design) {
    if (design === 'pro-max') {
        document.documentElement.setAttribute('data-design', 'pro-max');
        document.body.setAttribute('data-design', 'pro-max');
    } else {
        document.documentElement.removeAttribute('data-design');
        document.body.removeAttribute('data-design');
    }
    
    localStorage.setItem(DESIGN_STORAGE_KEY, design);
    
    // Toggle Button Icons
    const btn = document.getElementById('btn-design-toggle');
    if (btn) {
        const legacyIcon = btn.querySelector('.icon-legacy');
        const promaxIcon = btn.querySelector('.icon-promax');
        const labelText = btn.querySelector('.design-label');
        if (design === 'pro-max') {
            if(legacyIcon) legacyIcon.style.display = 'block';
            if(promaxIcon) promaxIcon.style.display = 'none';
            if(labelText) labelText.textContent = 'Legacy UI';
            btn.removeAttribute('data-tooltip'); // Remove tooltip for dropdown item
        } else {
            if(legacyIcon) legacyIcon.style.display = 'none';
            if(promaxIcon) promaxIcon.style.display = 'block';
            if(labelText) labelText.textContent = 'Pro-Max UI';
            btn.removeAttribute('data-tooltip'); // Remove tooltip for dropdown item
        }
    }
    
    // Notify charts or other components to re-render if needed
    document.dispatchEvent(new CustomEvent('designChanged', { detail: { design } }));
}

function initDesignToggle() {
    const btn = document.getElementById('btn-design-toggle');
    if (!btn) return;

    // Apply saved design on load (default to legacy)
    const saved = localStorage.getItem(DESIGN_STORAGE_KEY) || 'legacy';
    applyDesign(saved);

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = document.documentElement.getAttribute('data-design') || 'legacy';
        applyDesign(current === 'legacy' ? 'pro-max' : 'legacy');
    });
}

document.addEventListener('DOMContentLoaded', initDesignToggle);

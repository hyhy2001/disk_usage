/**
 * themeToggle.js — Light / Dark mode toggle with localStorage persistence
 */

const STORAGE_KEY = 'disk-usage-theme';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Notify chart manager (and anything else) to re-render with updated colors
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

function initThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    // Apply saved theme on load
    const saved = localStorage.getItem(STORAGE_KEY) || 'dark';
    applyTheme(saved);

    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });
}

document.addEventListener('DOMContentLoaded', initThemeToggle);

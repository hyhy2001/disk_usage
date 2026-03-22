/**
 * scrollToTop.js
 * Floating Action Button that appears when user scrolls down inside .main-content.
 * Clicking it smoothly scrolls back to top.
 */

const SCROLL_THRESHOLD = 300; // px to scroll before button appears

export function initScrollToTop() {
    const fab = document.getElementById('btn-scroll-top');
    const scroller = document.querySelector('.main-content');

    if (!fab || !scroller) return;

    // Show/hide based on scroll position
    const onScroll = () => {
        if (scroller.scrollTop > SCROLL_THRESHOLD) {
            fab.classList.add('visible');
        } else {
            fab.classList.remove('visible');
        }
    };

    // Smooth scroll to top on click
    fab.addEventListener('click', () => {
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Listen to the scrollable container (not window)
    scroller.addEventListener('scroll', onScroll, { passive: true });

    // Initial check (in case page is already scrolled on load)
    onScroll();
}

document.addEventListener('DOMContentLoaded', initScrollToTop);

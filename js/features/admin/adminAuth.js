// admin/adminAuth.js — in-dashboard admin entry point. Injects a Login button
// into the header; opens a login/setup popup; after login swaps to an avatar
// dropdown (Disk Mapping, Group Config, Accounts, Change password, Logout).

import { showToast } from '../../core/main.js';
import { adminApi, adminState, refreshAdminState, utf8ToB64 } from './adminApi.js';
import { openDiskMappingModal } from './diskMappingModal.js';
import { openAccountsModal, openChangePasswordModal } from './accountsModal.js';
import { openGroupConfig, rebootstrapGroupConfig } from '../group-user/groupUserManager.js';

function $(id) { return document.getElementById(id); }

function iconPerson() {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
}

// ── Header button (Login ⇄ Avatar) ───────────────────────────────────────────
function ensureHeaderButton() {
    if ($('admin-auth-btn')) return;
    const anchor = $('btn-fetch'); // Sync button in workspace-actions
    if (!anchor || !anchor.parentNode) return;

    const wrap = document.createElement('div');
    wrap.id = 'admin-auth-wrap';
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';

    const btn = document.createElement('button');
    btn.id = 'admin-auth-btn';
    btn.type = 'button';
    btn.className = 'btn-sync admin-auth-btn';
    btn.addEventListener('click', onAuthButtonClick);
    wrap.appendChild(btn);

    const dropdown = document.createElement('div');
    dropdown.id = 'admin-avatar-dropdown';
    dropdown.className = 'settings-dropdown';
    dropdown.style.display = 'none';
    wrap.appendChild(dropdown);

    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

    document.addEventListener('click', (e) => {
        if (dropdown.dataset.visible === 'true' && !wrap.contains(e.target)) {
            dropdown.style.display = 'none';
            dropdown.dataset.visible = 'false';
        }
    });
}

function renderHeaderButton() {
    const btn = $('admin-auth-btn');
    if (!btn) return;
    if (adminState.authenticated) {
        btn.innerHTML = iconPerson() + '<span>' + (adminState.username || 'Account') + '</span>';
        btn.title = 'Account menu';
    } else {
        btn.innerHTML = iconPerson() + '<span>Login</span>';
        btn.title = 'Admin login';
    }
}

function onAuthButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (adminState.authenticated) {
        toggleAvatarDropdown();
    } else {
        openAuthModal();
    }
}

// ── Avatar dropdown ───────────────────────────────────────────────────────────
function buildDropdownItems() {
    const dropdown = $('admin-avatar-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-dd-header';
    header.textContent = (adminState.username || 'admin') + ' · ' + (adminState.role || 'admin');
    dropdown.appendChild(header);

    const items = [
        { label: 'Group Config', icon: iconUsers(), fn: () => openGroupConfig() },
    ];
    if (adminState.role === 'owner') {
        items.unshift({ label: 'Disk Mapping', icon: iconDisk(), fn: () => openDiskMappingModal() });
        items.push({ label: 'Accounts', icon: iconShield(), fn: () => openAccountsModal() });
    }
    items.push({ label: 'Change Password', icon: iconKey(), fn: () => openChangePasswordModal() });
    items.push({ label: 'Logout', icon: iconLogout(), fn: () => doLogout(), danger: true });

    items.forEach((item) => {
        const btn = document.createElement('button');
        btn.className = 'dropdown-item' + (item.danger ? ' dropdown-item-danger' : '');
        btn.type = 'button';
        btn.innerHTML = item.icon + '<span>' + item.label + '</span>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAvatarDropdown();
            item.fn();
        });
        dropdown.appendChild(btn);
    });
}

function toggleAvatarDropdown() {
    const dropdown = $('admin-avatar-dropdown');
    if (!dropdown) return;
    const isVisible = dropdown.dataset.visible === 'true';
    if (isVisible) { closeAvatarDropdown(); return; }
    buildDropdownItems();
    dropdown.style.display = 'flex';
    dropdown.dataset.visible = 'true';
}

function closeAvatarDropdown() {
    const dropdown = $('admin-avatar-dropdown');
    if (!dropdown) return;
    dropdown.style.display = 'none';
    dropdown.dataset.visible = 'false';
}

// ── Login / Setup modal ───────────────────────────────────────────────────────
let authModalBuilt = false;

function createAuthModal() {
    if (authModalBuilt) return;
    const shell = document.createElement('div');
    shell.id = 'admin-auth-modal';
    shell.className = 'admin-modal';
    shell.innerHTML = `
        <div class="admin-modal-backdrop" data-close-modal="true"></div>
        <div class="admin-modal-box admin-modal-box-sm glass-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div class="admin-modal-header">
                <div>
                    <div id="auth-title" class="admin-modal-title">Admin Login</div>
                    <div id="auth-subtitle" class="admin-modal-subtitle">Sign in to manage configuration</div>
                </div>
                <button id="auth-close" class="admin-icon-btn" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="admin-modal-body">
                <form id="auth-form" autocomplete="off" class="admin-stack-form">
                    <input id="auth-username" class="admin-input" type="text" placeholder="Username" autocomplete="username" />
                    <input id="auth-password" class="admin-input" type="password" placeholder="Password" autocomplete="current-password" />
                    <input id="auth-password-confirm" class="admin-input hidden" type="password" placeholder="Confirm password" autocomplete="new-password" />
                    <div id="auth-captcha-row" class="admin-captcha-row hidden">
                        <span id="auth-captcha-q" class="admin-captcha-q"></span>
                        <input id="auth-captcha" class="admin-input admin-captcha-input" type="text" inputmode="numeric" placeholder="Answer" autocomplete="off" />
                    </div>
                    <button id="auth-submit" class="admin-btn admin-btn-primary" type="submit">Sign In</button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(shell);
    shell.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-modal') === 'true') closeAuthModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shell.classList.contains('visible')) closeAuthModal();
    });
    $('auth-close').addEventListener('click', closeAuthModal);
    $('auth-form').addEventListener('submit', onAuthSubmit);
    authModalBuilt = true;
}

async function openAuthModal() {
    createAuthModal();
    // Decide setup vs login from current server state.
    try {
        await refreshAdminState();
    } catch (_err) { /* show login form as fallback */ }

    const isSetup = !adminState.hasAdmin;
    $('auth-title').textContent = isSetup ? 'Create Owner Account' : 'Admin Login';
    $('auth-subtitle').textContent = isSetup
        ? 'No admin exists yet — create the first (owner) account.'
        : 'Sign in to manage configuration';
    $('auth-submit').textContent = isSetup ? 'Create Owner Account' : 'Sign In';
    $('auth-password-confirm').classList.toggle('hidden', !isSetup);
    $('auth-form').dataset.mode = isSetup ? 'setup' : 'login';

    // Captcha only gates login (not the one-time owner setup).
    $('auth-captcha-row').classList.toggle('hidden', isSetup);
    if (!isSetup) await loadCaptcha();

    const modal = $('admin-auth-modal');
    modal.classList.add('visible');
    document.body.classList.add('admin-modal-open');
    $('auth-username').focus();
}

async function loadCaptcha() {
    try {
        const data = await adminApi('captcha', { method: 'GET' });
        $('auth-captcha-q').textContent = data.question || '';
        $('auth-captcha').value = '';
    } catch (_err) {
        $('auth-captcha-q').textContent = '';
    }
}

function closeAuthModal() {
    const modal = $('admin-auth-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.classList.remove('admin-modal-open');
}

async function onAuthSubmit(e) {
    e.preventDefault();
    const mode = $('auth-form').dataset.mode || 'login';
    const username = $('auth-username').value.trim();
    const password = $('auth-password').value;

    try {
        if (mode === 'setup') {
            const confirm = $('auth-password-confirm').value;
            if (password !== confirm) { showToast('Mismatch', 'Password confirmation does not match.', 'error'); return; }
            const body = new URLSearchParams({ username, password_b64: utf8ToB64(password) });
            await adminApi('setup', { method: 'POST', body: body.toString() });
            showToast('Owner created', 'Owner account created. You are now signed in.', 'success');
        } else {
            const captcha = $('auth-captcha').value.trim();
            const body = new URLSearchParams({ username, password_b64: utf8ToB64(password), captcha });
            await adminApi('login', { method: 'POST', body: body.toString() });
            showToast('Signed in', 'Login successful.', 'success');
        }
        $('auth-form').reset();
        closeAuthModal();
        await onAuthChanged();
    } catch (err) {
        showToast(mode === 'setup' ? 'Setup failed' : 'Login failed', err.message, 'error');
        // Captcha is single-use server-side — refresh it for the next attempt.
        if (mode === 'login') await loadCaptcha();
    }
}

async function doLogout() {
    try {
        await adminApi('logout', { method: 'POST' });
        showToast('Signed out', 'You have been logged out.', 'success');
    } catch (err) {
        showToast('Logout failed', err.message, 'error');
    }
    await onAuthChanged();
}

// After login/logout: refresh state, re-render the header button, and
// re-bootstrap the group-user config so its admin-awareness flips.
async function onAuthChanged() {
    try { await refreshAdminState(); } catch (_err) { /* ignore */ }
    renderHeaderButton();
    closeAvatarDropdown();
    try { await rebootstrapGroupConfig(); } catch (_err) { /* ignore */ }
}

// ── Small inline icons (match utils.js style) ────────────────────────────────
function iconDisk() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path></svg>';
}
function iconUsers() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
}
function iconShield() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>';
}
function iconKey() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"></path></svg>';
}
function iconLogout() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
}

export async function initAdminAuth() {
    ensureHeaderButton();
    try {
        await refreshAdminState();
    } catch (_err) { /* offline / not configured — leave Login button */ }
    renderHeaderButton();
}

// admin/accountsModal.js — account management (owner: create/delete admins) +
// self-service change password. Two small modals reusing the admin-modal shell.

import { showToast } from '../../core/main.js';
import { adminApi, adminState, utf8ToB64 } from './adminApi.js';

let accountsBuilt = false;
let changePwBuilt = false;

function $(id) { return document.getElementById(id); }

// ── Accounts modal ───────────────────────────────────────────────────────────
function createAccountsShell() {
    if (accountsBuilt) return;
    const shell = document.createElement('div');
    shell.id = 'accounts-modal';
    shell.className = 'admin-modal';
    shell.innerHTML = `
        <div class="admin-modal-backdrop" data-close-modal="true"></div>
        <div class="admin-modal-box admin-modal-box-sm glass-panel" role="dialog" aria-modal="true" aria-labelledby="acc-title">
            <div class="admin-modal-header">
                <div>
                    <div id="acc-title" class="admin-modal-title">Accounts</div>
                    <div class="admin-modal-subtitle">Manage admin accounts</div>
                </div>
                <button id="acc-close" class="admin-icon-btn" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="admin-modal-body">
                <div id="acc-list" class="admin-accounts-list"></div>
                <div id="acc-create-wrap" class="admin-create-wrap hidden">
                    <h4>Create admin account</h4>
                    <form id="acc-create-form" autocomplete="off" class="admin-stack-form">
                        <input id="acc-new-username" class="admin-input" type="text" placeholder="Username" autocomplete="off" />
                        <button class="admin-btn admin-btn-primary" type="submit">Create Admin</button>
                    </form>
                    <p class="admin-hint">A strong password is generated automatically. Only the owner can create or delete admin accounts.</p>
                    <div id="acc-new-cred" class="admin-new-cred hidden">
                        <p id="acc-new-cred-label" class="admin-new-cred-label">Copy these credentials now — the password won't be shown again:</p>
                        <div class="admin-new-cred-row">
                            <code id="acc-new-cred-pw" class="admin-new-cred-pw"></code>
                            <button id="acc-copy-pw" class="admin-btn admin-btn-sm" type="button">Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(shell);
    shell.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-modal') === 'true') closeAccounts();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shell.classList.contains('visible')) closeAccounts();
    });
    $('acc-close').addEventListener('click', closeAccounts);
    $('acc-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = $('acc-new-username').value.trim();
        try {
            const body = new URLSearchParams({ username: u });
            const data = await adminApi('create_admin', { method: 'POST', body: body.toString() });
            showToast('Created', 'Created admin: ' + u, 'success');
            $('acc-create-form').reset();
            revealNewCredential(data.username || u, data.password || '',
                'Copy these credentials now — the password won\'t be shown again:');
            await refreshAdmins();
        } catch (err) {
            showToast('Create failed', err.message, 'error');
        }
    });
    $('acc-copy-pw').addEventListener('click', async () => {
        const text = $('acc-new-cred-pw').dataset.copy || $('acc-new-cred-pw').textContent || '';
        try {
            await navigator.clipboard.writeText(text);
            showToast('Copied', 'Credentials copied to clipboard.', 'success');
        } catch (_err) {
            showToast('Copy failed', 'Select the text and copy it manually.', 'error');
        }
    });
    accountsBuilt = true;
}

function revealNewCredential(username, password, label) {
    const box = $('acc-new-cred');
    if (!box) return;
    if (!password) { box.classList.add('hidden'); return; }
    $('acc-new-cred-label').textContent = label;
    const display = 'username: ' + username + '\npassword: ' + password;
    const el = $('acc-new-cred-pw');
    el.textContent = display;
    el.dataset.copy = display;
    box.classList.remove('hidden');
}

export async function openAccountsModal() {
    createAccountsShell();
    const modal = $('accounts-modal');
    modal.classList.add('visible');
    document.body.classList.add('admin-modal-open');
    await refreshAdmins();
}

function closeAccounts() {
    const modal = $('accounts-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.classList.remove('admin-modal-open');
}

async function refreshAdmins() {
    const isOwner = adminState.role === 'owner';
    $('acc-create-wrap').classList.toggle('hidden', !isOwner);
    let admins = [];
    try {
        const data = await adminApi('list_admins', { method: 'GET' });
        admins = Array.isArray(data.admins) ? data.admins : [];
    } catch (err) {
        $('acc-list').textContent = 'Failed to load admins: ' + err.message;
        return;
    }
    renderAdmins(admins, isOwner);
}

function renderAdmins(admins, isOwner) {
    const root = $('acc-list');
    root.textContent = '';
    admins.forEach((a) => {
        const row = document.createElement('div');
        row.className = 'admin-account-row';

        const info = document.createElement('span');
        info.className = 'admin-account-info';
        const nameEl = document.createElement('strong');
        nameEl.textContent = a.username;
        const roleEl = document.createElement('span');
        roleEl.className = 'admin-role-badge admin-role-' + (a.role || 'admin');
        roleEl.textContent = a.role || 'admin';
        info.appendChild(nameEl);
        info.appendChild(document.createTextNode(' '));
        info.appendChild(roleEl);
        row.appendChild(info);

        const canManage = isOwner && a.role !== 'owner' && a.id !== undefined
            && String(a.username) !== String(adminState.username);
        if (canManage) {
            const reset = document.createElement('button');
            reset.className = 'admin-btn admin-btn-sm';
            reset.type = 'button';
            reset.textContent = 'Reset';
            reset.title = 'Generate a new password for this admin';
            reset.addEventListener('click', async () => {
                if (!window.confirm('Reset password for "' + a.username + '"? Their current password stops working.')) return;
                try {
                    const body = new URLSearchParams({ id: String(a.id) });
                    const data = await adminApi('reset_password', { method: 'POST', body: body.toString() });
                    showToast('Reset', 'New password generated for ' + a.username + '.', 'success');
                    revealNewCredential(data.username || a.username, data.password || '',
                        'New password for ' + (data.username || a.username) + ' — copy it now:');
                } catch (err) {
                    showToast('Reset failed', err.message, 'error');
                }
            });
            row.appendChild(reset);

            const del = document.createElement('button');
            del.className = 'admin-btn admin-btn-sm admin-btn-danger';
            del.type = 'button';
            del.textContent = 'Delete';
            del.addEventListener('click', async () => {
                if (!window.confirm('Delete admin "' + a.username + '"?')) return;
                try {
                    const body = new URLSearchParams({ id: String(a.id) });
                    await adminApi('delete_admin', { method: 'POST', body: body.toString() });
                    showToast('Deleted', 'Deleted admin: ' + a.username, 'success');
                    await refreshAdmins();
                } catch (err) {
                    showToast('Delete failed', err.message, 'error');
                }
            });
            row.appendChild(del);
        }
        root.appendChild(row);
    });
}

// ── Change-password modal ────────────────────────────────────────────────────
function createChangePwShell() {
    if (changePwBuilt) return;
    const shell = document.createElement('div');
    shell.id = 'change-pw-modal';
    shell.className = 'admin-modal';
    shell.innerHTML = `
        <div class="admin-modal-backdrop" data-close-modal="true"></div>
        <div class="admin-modal-box admin-modal-box-sm glass-panel" role="dialog" aria-modal="true" aria-labelledby="cpw-title">
            <div class="admin-modal-header">
                <div>
                    <div id="cpw-title" class="admin-modal-title">Change Password</div>
                    <div class="admin-modal-subtitle">Update your own password</div>
                </div>
                <button id="cpw-close" class="admin-icon-btn" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="admin-modal-body">
                <form id="cpw-form" autocomplete="off" class="admin-stack-form">
                    <input id="cpw-old" class="admin-input" type="password" placeholder="Current password" autocomplete="current-password" />
                    <input id="cpw-new" class="admin-input" type="password" placeholder="New password (min 10 chars)" autocomplete="new-password" />
                    <button class="admin-btn admin-btn-primary" type="submit">Update Password</button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(shell);
    shell.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-modal') === 'true') closeChangePw();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shell.classList.contains('visible')) closeChangePw();
    });
    $('cpw-close').addEventListener('click', closeChangePw);
    $('cpw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldp = $('cpw-old').value;
        const newp = $('cpw-new').value;
        try {
            const body = new URLSearchParams({
                old_password_b64: utf8ToB64(oldp),
                new_password_b64: utf8ToB64(newp),
            });
            await adminApi('change_password', { method: 'POST', body: body.toString() });
            showToast('Updated', 'Password updated.', 'success');
            $('cpw-form').reset();
            closeChangePw();
        } catch (err) {
            showToast('Update failed', err.message, 'error');
        }
    });
    changePwBuilt = true;
}

export function openChangePasswordModal() {
    createChangePwShell();
    const modal = $('change-pw-modal');
    modal.classList.add('visible');
    document.body.classList.add('admin-modal-open');
}

function closeChangePw() {
    const modal = $('change-pw-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.classList.remove('admin-modal-open');
}

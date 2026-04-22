const els = {
    setupPanel: document.getElementById('admin-setup'),
    loginPanel: document.getElementById('admin-login'),
    dashPanel: document.getElementById('admin-dashboard'),
    msg: document.getElementById('admin-message'),
    welcome: document.getElementById('admin-welcome'),
    statTeams: document.getElementById('stat-teams'),
    statDisks: document.getElementById('stat-disks'),
    statBackups: document.getElementById('stat-backups'),
    statChanges: document.getElementById('stat-changes'),
    unsavedBadge: document.getElementById('unsaved-badge'),
    setupForm: document.getElementById('form-setup'),
    loginForm: document.getElementById('form-login'),
    reloadBtn: document.getElementById('btn-reload'),
    diffBtn: document.getElementById('btn-diff'),
    saveBtn: document.getElementById('btn-save'),
    logoutBtn: document.getElementById('btn-logout'),
    addTeamBtn: document.getElementById('btn-add-team'),
    refreshRawBtn: document.getElementById('btn-refresh-raw'),
    teamEditor: document.getElementById('team-editor'),
    rawPreview: document.getElementById('raw-json-preview'),
    backupSelect: document.getElementById('backup-select'),
    refreshBackupsBtn: document.getElementById('btn-refresh-backups'),
    restoreBackupBtn: document.getElementById('btn-restore-backup'),
    diffBox: document.getElementById('diff-box'),
    diffSummary: document.getElementById('diff-summary'),
    diffList: document.getElementById('diff-list'),
};

let baselineConfig = [];
let currentConfig = [];
let diffTimer = null;
let backupCount = 0;

function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
}

function setMessage(text, kind) {
    const variant = kind || '';
    els.msg.textContent = text || '';
    els.msg.className = 'alert alert-secondary admin-alert' + (variant ? ' ' + variant : '');
}

async function api(action, options) {
    const requestOptions = options || {};
    const res = await fetch('../api.php?type=admin&action=' + encodeURIComponent(action), requestOptions);
    let payload = null;
    try {
        payload = await res.json();
    } catch (_err) {
        throw new Error('Server returned invalid JSON.');
    }
    if (!res.ok || payload.status === 'error') {
        throw new Error(payload && payload.message ? payload.message : 'Request failed.');
    }
    return payload.data || {};
}

function showPanel(name) {
    els.setupPanel.classList.add('hidden');
    els.loginPanel.classList.add('hidden');
    els.dashPanel.classList.add('hidden');
    if (els.logoutBtn) els.logoutBtn.classList.add('hidden');
    if (name === 'setup') els.setupPanel.classList.remove('hidden');
    if (name === 'login') els.loginPanel.classList.remove('hidden');
    if (name === 'dash') {
        els.dashPanel.classList.remove('hidden');
        if (els.logoutBtn) els.logoutBtn.classList.remove('hidden');
    }
}

function safeParseJson(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function normalizeConfig(raw) {
    const source = Array.isArray(raw) ? raw : [];
    return source.map((team, teamIdx) => {
        const teamName = String((team && team.name) || ('Team ' + (teamIdx + 1))).trim() || ('Team ' + (teamIdx + 1));
        const disks = Array.isArray(team && team.disks) ? team.disks : [];
        return {
            name: teamName,
            disks: disks.map((disk, diskIdx) => ({
                id: String((disk && disk.id) || ('disk_' + teamIdx + '_' + (diskIdx + 1))).trim(),
                name: String((disk && disk.name) || ('Disk ' + (diskIdx + 1))).trim(),
                path: String((disk && disk.path) || '').trim(),
            })),
        };
    });
}

function getCurrentConfigJson() {
    return JSON.stringify(currentConfig, null, 4);
}

function getChangeCount() {
    const changes = [];
    collectDiff('$', baselineConfig, currentConfig, changes);
    return changes.length;
}

function updateDashboardStats() {
    const teams = Array.isArray(currentConfig) ? currentConfig.length : 0;
    let disks = 0;
    if (Array.isArray(currentConfig)) {
        currentConfig.forEach((team) => {
            disks += Array.isArray(team.disks) ? team.disks.length : 0;
        });
    }
    const changes = getChangeCount();

    if (els.statTeams) els.statTeams.textContent = String(teams);
    if (els.statDisks) els.statDisks.textContent = String(disks);
    if (els.statBackups) els.statBackups.textContent = String(backupCount);
    if (els.statChanges) els.statChanges.textContent = String(changes);

    if (els.unsavedBadge) {
        if (changes > 0) {
            els.unsavedBadge.classList.remove('hidden');
            els.unsavedBadge.textContent = 'Unsaved (' + changes + ')';
        } else {
            els.unsavedBadge.classList.add('hidden');
        }
    }
}

function updateRawPreview() {
    els.rawPreview.textContent = getCurrentConfigJson();
}

function scheduleDiffRender() {
    if (!els.diffBox || els.diffBox.classList.contains('hidden')) return;
    if (diffTimer) clearTimeout(diffTimer);
    diffTimer = setTimeout(() => {
        renderDiff();
    }, 180);
}

function onDataChanged() {
    updateRawPreview();
    updateDashboardStats();
    scheduleDiffRender();
}

function createLabelInput(labelText, value, onInput) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('input', onInput);
    label.appendChild(span);
    label.appendChild(input);
    return label;
}

function renderTeamEditor() {
    els.teamEditor.innerHTML = '';

    if (!Array.isArray(currentConfig) || currentConfig.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-team-note';
        empty.textContent = 'No teams yet. Click "Add Team" to create one.';
        els.teamEditor.appendChild(empty);
        return;
    }

    currentConfig.forEach((team, teamIdx) => {
        const teamCard = document.createElement('section');
        teamCard.className = 'team-card';

        const teamHead = document.createElement('div');
        teamHead.className = 'team-head';

        const teamNameInput = createLabelInput('Team Name', team.name, (e) => {
            currentConfig[teamIdx].name = e.target.value;
            onDataChanged();
        });

        const addDiskBtn = document.createElement('button');
        addDiskBtn.type = 'button';
        addDiskBtn.className = 'btn btn-outline-primary btn-sm';
        addDiskBtn.textContent = '+ Add Disk';
        addDiskBtn.addEventListener('click', () => {
            currentConfig[teamIdx].disks.push({ id: '', name: '', path: '' });
            renderTeamEditor();
            onDataChanged();
        });

        const removeTeamBtn = document.createElement('button');
        removeTeamBtn.type = 'button';
        removeTeamBtn.className = 'btn btn-outline-danger btn-sm';
        removeTeamBtn.textContent = 'Delete Team';
        removeTeamBtn.addEventListener('click', () => {
            if (!window.confirm('Delete this team and all its disks?')) return;
            currentConfig.splice(teamIdx, 1);
            renderTeamEditor();
            onDataChanged();
        });

        teamHead.appendChild(teamNameInput);
        teamHead.appendChild(addDiskBtn);
        teamHead.appendChild(removeTeamBtn);
        teamCard.appendChild(teamHead);

        const diskList = document.createElement('div');
        diskList.className = 'disk-list';

        if (!Array.isArray(team.disks) || team.disks.length === 0) {
            const note = document.createElement('div');
            note.className = 'empty-team-note';
            note.textContent = 'No disks in this team.';
            diskList.appendChild(note);
        } else {
            team.disks.forEach((disk, diskIdx) => {
                const row = document.createElement('div');
                row.className = 'disk-grid';

                const idInput = createLabelInput('Disk ID', disk.id, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].id = e.target.value;
                    onDataChanged();
                });

                const nameInput = createLabelInput('Disk Name', disk.name, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].name = e.target.value;
                    onDataChanged();
                });

                const pathInput = createLabelInput('Report Path', disk.path, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].path = e.target.value;
                    onDataChanged();
                });

                const actions = document.createElement('div');
                actions.className = 'disk-actions';
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn btn-outline-danger btn-sm';
                removeBtn.textContent = 'Delete';
                removeBtn.addEventListener('click', () => {
                    currentConfig[teamIdx].disks.splice(diskIdx, 1);
                    renderTeamEditor();
                    onDataChanged();
                });
                actions.appendChild(removeBtn);

                row.appendChild(idInput);
                row.appendChild(nameInput);
                row.appendChild(pathInput);
                row.appendChild(actions);
                diskList.appendChild(row);
            });
        }

        teamCard.appendChild(diskList);
        els.teamEditor.appendChild(teamCard);
    });

    updateDashboardStats();
}

function validateConfig(config) {
    const errors = [];
    const ids = {};

    config.forEach((team, teamIdx) => {
        if (!team.name || !team.name.trim()) {
            errors.push('Team #' + (teamIdx + 1) + ': Team Name is required.');
        }
        if (!Array.isArray(team.disks) || team.disks.length === 0) {
            errors.push('Team "' + (team.name || ('#' + (teamIdx + 1))) + '": At least one disk is required.');
            return;
        }

        team.disks.forEach((disk, diskIdx) => {
            const rowName = 'Team "' + (team.name || ('#' + (teamIdx + 1))) + '" Disk #' + (diskIdx + 1);
            const id = (disk.id || '').trim();
            const name = (disk.name || '').trim();
            const path = (disk.path || '').trim();

            if (!id) errors.push(rowName + ': Disk ID is required.');
            if (!name) errors.push(rowName + ': Disk Name is required.');
            if (!path) errors.push(rowName + ': Report Path is required.');

            if (id) {
                if (ids[id]) {
                    errors.push('Duplicate Disk ID "' + id + '".');
                }
                ids[id] = true;
            }
        });
    });

    return errors;
}

function renderValue(v) {
    if (typeof v === 'string') return '"' + v + '"';
    try {
        return JSON.stringify(v);
    } catch (_err) {
        return String(v);
    }
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function collectDiff(path, beforeValue, afterValue, output) {
    if (typeof beforeValue === 'undefined' && typeof afterValue !== 'undefined') {
        output.push({ type: 'add', path: path, after: afterValue });
        return;
    }
    if (typeof afterValue === 'undefined' && typeof beforeValue !== 'undefined') {
        output.push({ type: 'remove', path: path, before: beforeValue });
        return;
    }

    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
        const maxLen = Math.max(beforeValue.length, afterValue.length);
        for (let i = 0; i < maxLen; i += 1) {
            collectDiff(path + '[' + i + ']', beforeValue[i], afterValue[i], output);
        }
        return;
    }

    if (isObject(beforeValue) && isObject(afterValue)) {
        const keys = new Set(Object.keys(beforeValue).concat(Object.keys(afterValue)));
        Array.from(keys).sort().forEach((key) => {
            const childPath = path === '$' ? '$.' + key : path + '.' + key;
            collectDiff(childPath, beforeValue[key], afterValue[key], output);
        });
        return;
    }

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        output.push({ type: 'change', path: path, before: beforeValue, after: afterValue });
    }
}

function renderDiff() {
    els.diffList.innerHTML = '';

    const changes = [];
    collectDiff('$', baselineConfig, currentConfig, changes);

    if (changes.length === 0) {
        els.diffSummary.textContent = 'No changes detected compared with current disks.json.';
        updateDashboardStats();
        return;
    }

    const addCount = changes.filter((c) => c.type === 'add').length;
    const removeCount = changes.filter((c) => c.type === 'remove').length;
    const changeCount = changes.filter((c) => c.type === 'change').length;
    els.diffSummary.textContent =
        'Detected ' + changes.length + ' changes (+' + addCount + ' / -' + removeCount + ' / ~' + changeCount + ').';

    const maxRows = 250;
    changes.slice(0, maxRows).forEach((item) => {
        const li = document.createElement('li');
        if (item.type === 'add') {
            li.className = 'diff-add';
            li.textContent = '[ADD] ' + item.path + ' = ' + renderValue(item.after);
        } else if (item.type === 'remove') {
            li.className = 'diff-remove';
            li.textContent = '[REMOVE] ' + item.path + ' was ' + renderValue(item.before);
        } else {
            li.className = 'diff-change';
            li.textContent = '[CHANGE] ' + item.path + ' from ' + renderValue(item.before) + ' to ' + renderValue(item.after);
        }
        els.diffList.appendChild(li);
    });

    updateDashboardStats();
}

function setDiffBoxVisible(visible) {
    if (visible) {
        els.diffBox.classList.remove('hidden');
        els.diffBtn.textContent = 'Hide Diff';
        renderDiff();
    } else {
        els.diffBox.classList.add('hidden');
        els.diffBtn.textContent = 'Show Diff';
    }
    updateDashboardStats();
}

async function loadDisks() {
    const data = await api('get_disks', { method: 'GET' });
    const parsed = safeParseJson(data.content || '[]');
    if (!parsed.ok) {
        throw new Error('Current disks.json is invalid: ' + parsed.error);
    }

    baselineConfig = normalizeConfig(parsed.value);
    currentConfig = deepClone(baselineConfig);
    renderTeamEditor();
    updateRawPreview();
    scheduleDiffRender();
}

async function loadBackups() {
    const data = await api('list_backups', { method: 'GET' });
    const items = Array.isArray(data.items) ? data.items : [];
    backupCount = items.length;
    const previous = els.backupSelect.value;

    els.backupSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = items.length > 0 ? 'Select a backup...' : 'No backups found';
    els.backupSelect.appendChild(placeholder);

    items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.name;
        const stamp = item.mtime ? item.mtime.replace('T', ' ').replace('Z', ' UTC') : 'unknown time';
        opt.textContent = item.name + ' (' + stamp + ')';
        els.backupSelect.appendChild(opt);
    });

    if (previous) els.backupSelect.value = previous;
    updateDashboardStats();
}

async function saveDisks() {
    const errors = validateConfig(currentConfig);
    if (errors.length > 0) {
        setMessage(errors[0] + (errors.length > 1 ? (' (+' + (errors.length - 1) + ' more)') : ''), 'error');
        return;
    }

    const normalized = JSON.stringify(currentConfig, null, 4);
    const body = new URLSearchParams({ content_b64: btoa(unescape(encodeURIComponent(normalized))) });
    const data = await api('save_disks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
    });

    baselineConfig = deepClone(currentConfig);
    updateRawPreview();
    updateDashboardStats();
    scheduleDiffRender();
    await loadBackups();

    const backupInfo = data.backup_file ? (' Backup: ' + data.backup_file) : '';
    setMessage('Saved disks.json successfully.' + backupInfo, 'success');
}

async function restoreFromBackup() {
    const backupName = (els.backupSelect.value || '').trim();
    if (!backupName) {
        setMessage('Please select a backup first.', 'error');
        return;
    }

    const ok = window.confirm(
        'Restore disks.json from backup "' + backupName + '"?\nCurrent file will be auto-backed up first.'
    );
    if (!ok) return;

    const body = new URLSearchParams({ backup_name: backupName });
    const data = await api('restore_backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
    });

    await loadDisks();
    await loadBackups();
    const pre = data.pre_restore_backup ? (' Pre-restore backup: ' + data.pre_restore_backup) : '';
    setMessage('Restored from ' + (data.restored_from || backupName) + '.' + pre, 'success');
}

async function refreshStatus() {
    const status = await api('status', { method: 'GET' });
    if (!status.has_admin) {
        showPanel('setup');
        setDiffBoxVisible(false);
        setMessage('Create the first admin account to continue.');
        return;
    }

    if (!status.authenticated) {
        showPanel('login');
        setDiffBoxVisible(false);
        setMessage('Please sign in as admin.');
        return;
    }

    showPanel('dash');
    els.welcome.textContent = 'Signed in as: ' + (status.username || 'admin');
    await loadDisks();
    await loadBackups();
    setMessage('Admin dashboard ready.', 'success');
}

function bindSetup() {
    els.setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('setup-username').value.trim();
        const pass = document.getElementById('setup-password').value;
        const confirm = document.getElementById('setup-password-confirm').value;
        if (pass !== confirm) {
            setMessage('Password confirmation does not match.', 'error');
            return;
        }

        try {
            const body = new URLSearchParams({
                username: username,
                password_b64: btoa(unescape(encodeURIComponent(pass))),
            });
            await api('setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: body.toString(),
            });
            await refreshStatus();
            setMessage('Admin account created. Setup is now locked.', 'success');
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });
}

function bindLogin() {
    els.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        try {
            const body = new URLSearchParams({
                username: username,
                password_b64: btoa(unescape(encodeURIComponent(password))),
            });
            await api('login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: body.toString(),
            });
            await refreshStatus();
            setMessage('Login successful.', 'success');
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });
}

function bindDashboardActions() {
    els.addTeamBtn.addEventListener('click', () => {
        currentConfig.push({
            name: 'New Team',
            disks: [{ id: '', name: '', path: '' }],
        });
        renderTeamEditor();
        onDataChanged();
    });

    els.refreshRawBtn.addEventListener('click', () => {
        updateRawPreview();
        setMessage('Raw JSON preview refreshed.', 'success');
    });

    els.reloadBtn.addEventListener('click', async () => {
        try {
            await loadDisks();
            setMessage('Reloaded disks.json.', 'success');
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });

    els.diffBtn.addEventListener('click', () => {
        const willShow = els.diffBox.classList.contains('hidden');
        setDiffBoxVisible(willShow);
    });

    els.saveBtn.addEventListener('click', async () => {
        try {
            await saveDisks();
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });

    els.refreshBackupsBtn.addEventListener('click', async () => {
        try {
            await loadBackups();
            setMessage('Backup list refreshed.', 'success');
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });

    els.restoreBackupBtn.addEventListener('click', async () => {
        try {
            await restoreFromBackup();
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });

    els.logoutBtn.addEventListener('click', async () => {
        try {
            await api('logout', { method: 'POST' });
            await refreshStatus();
        } catch (err) {
            setMessage(err.message, 'error');
        }
    });
}

async function init() {
    bindSetup();
    bindLogin();
    bindDashboardActions();
    try {
        await refreshStatus();
    } catch (err) {
        setMessage(err.message, 'error');
    }
}

init();

// admin/adminApi.js — auth/session core for the in-dashboard admin panel.
// Wraps api.php?type=admin with CSRF capture + base64 helpers. Shared by the
// login flow, disk-mapping editor, and account management modals.

export const adminState = {
    authenticated: false,
    role: '',
    username: '',
    hasAdmin: false,
};

let csrfToken = '';

export function utf8ToB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// Call an admin action. Captures the CSRF token from any response and defaults
// the Content-Type for string bodies (PHP only fills $_POST for urlencoded).
export async function adminApi(action, options) {
    const requestOptions = options || {};
    const headers = Object.assign({}, requestOptions.headers || {});
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (typeof requestOptions.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    requestOptions.headers = headers;

    const res = await fetch('api.php?type=admin&action=' + encodeURIComponent(action), requestOptions);
    let payload = null;
    try {
        payload = await res.json();
    } catch (_err) {
        throw new Error('Server returned invalid JSON.');
    }
    if (!res.ok || payload.status === 'error') {
        throw new Error(payload && payload.message ? payload.message : 'Request failed.');
    }
    const data = payload.data || {};
    if (data.csrf_token) csrfToken = data.csrf_token;
    return data;
}

// Refresh adminState from the server. Returns the raw status payload.
export async function refreshAdminState() {
    const status = await adminApi('status', { method: 'GET' });
    adminState.hasAdmin = !!status.has_admin;
    adminState.authenticated = !!status.authenticated;
    adminState.role = status.role || '';
    adminState.username = status.username || '';
    return status;
}

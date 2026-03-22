/**
 * formatters.js — Single source of truth for all byte/date formatting.
 * Import from here; never duplicate these functions in other modules.
 */

/**
 * Human-readable byte string with auto unit selection.
 * fmt(1_500_000_000_000) → "1.50 TB"
 * @param {number|null|undefined} bytes
 * @param {number} [decimals=2]
 */
export function fmt(bytes, decimals = 2) {
    if (bytes === null || bytes === undefined) return '—';
    const TB = 1e12, GB = 1e9, MB = 1e6, KB = 1e3;
    if (bytes >= TB) return `${(bytes / TB).toFixed(decimals)} TB`;
    if (bytes >= GB) return `${(bytes / GB).toFixed(Math.min(decimals, 1))} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
    if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
    return `${bytes} B`;
}

/**
 * Full precision formatter — includes PB support, configurable decimals.
 * Used in chart tooltips for readability.
 * @param {number} bytes
 * @param {number} [decimals=2]
 */
export function smartFmt(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const abs = Math.abs(bytes);
    if (abs >= 1e15) return (bytes / 1e15).toFixed(decimals) + ' PB';
    if (abs >= 1e12) return (bytes / 1e12).toFixed(decimals) + ' TB';
    if (abs >= 1e9)  return (bytes / 1e9).toFixed(decimals) + ' GB';
    if (abs >= 1e6)  return (bytes / 1e6).toFixed(decimals) + ' MB';
    if (abs >= 1e3)  return (bytes / 1e3).toFixed(decimals) + ' KB';
    return bytes.toFixed(decimals) + ' B';
}

/**
 * Compact tick label — short suffix, no space.
 * smartFmtTick(23_600_000_000) → "23.6G"
 * Use for chart axis ticks only (tooltips should use smartFmt).
 * @param {number} bytes
 */
export function smartFmtTick(bytes) {
    if (bytes === 0) return '0';
    const abs = Math.abs(bytes);
    const sign = bytes < 0 ? '-' : '';
    if (abs >= 1e15) return sign + (abs / 1e15).toFixed(1) + 'P';
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(1) + 'T';
    if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(1) + 'G';
    if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(1) + 'K';
    return sign + abs.toFixed(0) + 'B';
}

/**
 * Pick a consistent unit for an entire chart based on max absolute value.
 * Returns { divisor, unit } so every data point in the chart uses the same unit.
 * @param {number[]} bytesArray - raw byte values
 * @returns {{ divisor: number, unit: string }}
 */
export function pickUnit(bytesArray) {
    const maxAbs = Math.max(...bytesArray.map(Math.abs));
    if (maxAbs >= 1e15) return { divisor: 1e15, unit: 'PB' };
    if (maxAbs >= 1e12) return { divisor: 1e12, unit: 'TB' };
    if (maxAbs >= 1e9)  return { divisor: 1e9,  unit: 'GB' };
    if (maxAbs >= 1e6)  return { divisor: 1e6,  unit: 'MB' };
    if (maxAbs >= 1e3)  return { divisor: 1e3,  unit: 'KB' };
    return { divisor: 1, unit: 'B' };
}

/**
 * Format a Unix-ms timestamp to "21 Mar 2026".
 * @param {number} ms - milliseconds since epoch
 */
export function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
}

/**
 * Format a Unix-seconds timestamp to "21 Mar 2026" (for API date fields).
 * @param {number} unixSec
 */
export function fmtDateSec(unixSec) {
    if (!unixSec) return '—';
    return fmtDate(unixSec * 1000);
}

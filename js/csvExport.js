// csvExport.js — Shared CSV download utility

/**
 * Trigger browser download of a CSV string.
 * @param {string} filename
 * @param {string} csvContent
 */
export function downloadCsv(filename, csvContent) {
    const bom  = '\uFEFF';  // UTF-8 BOM for Excel compatibility
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Convert an array of row-objects to CSV string.
 * @param {string[]} headers   — CSV column headers
 * @param {Object[]} rows      — each row has keys matching headers (lowercase)
 * @param {(row: Object, key: string) => string} [getValue]
 */
export function toCsv(headers, rows, getValue) {
    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    };
    const headerLine = headers.map(escape).join(',');
    const lines = rows.map(row =>
        headers.map(h => {
            const val = getValue ? getValue(row, h) : row[h.toLowerCase().replace(/ /g, '_')];
            return escape(val ?? '');
        }).join(',')
    );
    return [headerLine, ...lines].join('\r\n');
}

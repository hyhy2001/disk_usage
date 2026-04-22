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

/**
 * Compress an array of files into a ZIP and download.
 * @param {string} filename 
 * @param {{name: string, content: string}[]} filesArr 
 * @param {Function} [onProgress] 
 */
export async function downloadZip(filename, filesArr, onProgress) {
    if (!window.JSZip) {
        alert("JSZip library is not loaded.");
        return;
    }
    const zip = new JSZip();
    for (const file of filesArr) {
       zip.file(file.name, file.content);
    }
    const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (metadata) => {
        if (onProgress) onProgress(metadata.percent);
    });
    
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Native GZIP Streaming Export
 * Directly writes compressed data to the user's hard drive without consuming RAM.
 * @param {string} filename - The suggested file name (e.g., export.csv)
 * @param {string[]} headers - The CSV headers
 * @param {Function} fetchChunkCallback - async function returning { rows: Object[], isLast: boolean }
 * @param {Function} [formatRow] - Optional mapper function(row, header)
 * @returns {Promise<boolean>} True if successful, false if not supported or canceled.
 */
export async function streamExportGzip(filename, headers, fetchChunkCallback, formatRow) {
    if (!window.showSaveFilePicker || !window.CompressionStream) {
        return false; // Not supported, fallback to JSZip
    }

    let fileHandle;
    try {
        fileHandle = await window.showSaveFilePicker({
            suggestedName: filename + '.csv.gz',
            types: [{ description: 'GZIP Compressed CSV', accept: { 'application/gzip': ['.gz'] } }],
        });
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('AbortError');
        return false;
    }

    const writable    = await fileHandle.createWritable();
    const cs          = new CompressionStream('gzip');
    const writer      = cs.writable.getWriter();
    // Save promise — must await AFTER writer.close() so all compressed bytes reach the file.
    const pipePromise = cs.readable.pipeTo(writable);

    const encoder = new TextEncoder();
    const bom     = '\uFEFF';

    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    try {
        // Header row
        const headerLine = headers.map(escape).join(',');
        await writer.write(encoder.encode(bom + headerLine + '\r\n'));

        let hasMore = true;
        while (hasMore) {
            const chunkData = await fetchChunkCallback();
            if (!chunkData) break;

            hasMore = !chunkData.isLast;
            const rows = chunkData.rows || [];

            if (rows.length > 0) {
                const lines = rows.map(row =>
                    headers.map(h => {
                        const val = formatRow ? formatRow(row, h) : row[h.toLowerCase().replace(/ /g, '_')];
                        return escape(val ?? '');
                    }).join(',')
                ).join('\r\n') + '\r\n';

                await writer.write(encoder.encode(lines));
            }
        }

        await writer.close();
        await pipePromise; // flush all compressed bytes into the file before returning
        return true;

    } catch (err) {
        // Abort both streams so the browser marks the file as failed/incomplete
        await writer.abort(err).catch(() => {});
        await writable.abort(err).catch(() => {});
        throw err;
    }
}

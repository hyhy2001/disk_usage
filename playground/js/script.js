document.addEventListener('DOMContentLoaded', () => {

    const componentsData = {
        "disk-card": {
            name: "Disk Card",
            html: `<div class="disk-card disk-status-healthy">
  <div class="disk-header">
    <div class="disk-title">
      <span class="disk-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 12H2"></path>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
            <line x1="6" y1="16" x2="6.01" y2="16"></line>
            <line x1="10" y1="16" x2="10.01" y2="16"></line>
        </svg>
      </span>
      <h3>Sample Drive (C:)</h3>
    </div>
    <div class="disk-badge">Healthy</div>
  </div>
  
  <div class="disk-stats">
    <div class="stat-item">
      <span class="stat-label">Used:</span>
      <span class="stat-value">45 GB</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Total Size:</span>
      <span class="stat-value">100 GB</span>
    </div>
  </div>

  <div class="progress-bar-container">
    <div class="progress-bar">
      <div class="progress-fill" style="width: 45%; background-color: var(--color-success)"></div>
    </div>
    <div class="progress-labels">
      <span>0%</span>
      <span>45%</span>
      <span>100%</span>
    </div>
  </div>
</div>`,
            css: `/* 
   You can add custom CSS here. 
   The disk_usage classes are already loaded.
*/
body {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background-color: var(--bg-body, #0f172a);
}

.disk-card {
    min-width: 350px;
    /* Hover effects for the card */
    transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.disk-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
}`,
            js: `// Example: Randomly change % every 2 seconds
const fill = document.querySelector('.progress-fill');
const valueLabel = document.querySelector('.progress-labels span:nth-child(2)');

setInterval(() => {
    if (!fill) return;
    const randomPct = Math.floor(Math.random() * 100);
    fill.style.width = randomPct + '%';
    
    if (randomPct > 90) fill.style.backgroundColor = 'var(--color-danger)';
    else if (randomPct > 70) fill.style.backgroundColor = 'var(--color-warning)';
    else fill.style.backgroundColor = 'var(--color-success)';
    
    valueLabel.textContent = randomPct + '%';
}, 2000);`
        },
        "sidebar-item": {
            name: "Sidebar Items",
            html: `<ul class="disk-list">
  <li class="disk-item active">
    <span class="disk-icon" style="color:var(--text-muted);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
    </span>
    <div class="disk-info">
      <div class="disk-name">System (C:)</div>
      <div class="disk-usage-mini">
        <div class="progress-mini"><div class="fill-mini" style="width:70%; background:var(--color-warning);"></div></div>
      </div>
    </div>
  </li>
  <li class="disk-item">
    <span class="disk-icon" style="color:var(--text-muted);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="disk-icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
    </span>
    <div class="disk-info">
      <div class="disk-name">Data (D:)</div>
      <div class="disk-usage-mini">
        <div class="progress-mini"><div class="fill-mini" style="width:30%; background:var(--color-success);"></div></div>
      </div>
    </div>
  </li>
</ul>`,
            css: `body {
    padding: 20px;
    background-color: var(--bg-sidebar, #1e293b);
    color: white;
}
                
.disk-list {
    list-style: none;
    padding: 0;
    margin: 0;
    width: 250px;
}

.disk-item {
    display: flex;
    align-items: center;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: background 0.2s;
    background: var(--bg-card, #2c3e50);
}

.disk-item:hover, .disk-item.active {
    background: var(--bg-hover, #3b5068);
}

.disk-icon { margin-right: 12px; font-size: 1.2rem; }
.disk-info { flex: 1; }
.disk-name { font-size: 0.9rem; font-weight: 500; margin-bottom: 6px; }

.progress-mini {
    height: 4px;
    background: #1a252f;
    border-radius: 2px;
    overflow: hidden;
}
.fill-mini { height: 100%; border-radius: 2px; }`,
            js: `const items = document.querySelectorAll('.disk-item');
items.forEach(item => {
    item.addEventListener('click', () => {
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
    });
});`
        },
        "theme-toggle": {
            name: "Theme Toggle",
            html: `<div style="padding: 50px; background: var(--bg-body, #0f172a); display: flex; justify-content: center; height:100vh;">
  <button id="themeToggleBtn" class="btn-icon">
    <span class="sun-icon" style="display:none; line-height: 0;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </span>
    <span class="moon-icon" style="line-height: 0;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </span>
  </button>
</div>`,
            css: `.btn-icon {
    background: var(--bg-card, #1e293b);
    border: 1px solid var(--border-color, #334155);
    border-radius: 50%;
    width: 48px;
    height: 48px;
    font-size: 1.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    color: white;
    transition: transform 0.2s, background 0.2s;
}

.btn-icon:hover {
    transform: scale(1.1);
    background: var(--bg-hover, #2d3748);
}`,
            js: `const btn = document.getElementById('themeToggleBtn');
const sun = document.querySelector('.sun-icon');
const moon = document.querySelector('.moon-icon');
let isDark = true;

// Applies the data-theme to HTML tag so that vars.css kicks in
document.documentElement.setAttribute('data-theme', 'dark');

btn.addEventListener('click', () => {
    isDark = !isDark;
    if (isDark) {
        sun.style.display = 'none';
        moon.style.display = 'block';
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        sun.style.display = 'block';
        moon.style.display = 'none';
        document.documentElement.setAttribute('data-theme', 'light');
    }
});`
        },
        "col-resize": {
            name: "Column Resizer",
            html: `<div class="container-split" style="display: flex; height: 100vh; background: var(--bg-body, #0f172a);">
  <!-- Left Panel -->
  <aside id="left-panel" style="width: 250px; background: var(--bg-sidebar, #1e293b); color: white; display: flex; flex-direction: column; position: relative;">
    <div style="padding: 20px;">Left Panel</div>
    <div id="col2-resizer" class="col-resizer">
        <div class="resizer-icon">
            <svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor">
                <circle cx="1" cy="2" r="1"></circle>
                <circle cx="1" cy="7" r="1"></circle>
                <circle cx="1" cy="12" r="1"></circle>
                <circle cx="5" cy="2" r="1"></circle>
                <circle cx="5" cy="7" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
            </svg>
        </div>
    </div>
  </aside>

  <!-- Right Panel -->
  <main style="flex: 1; padding: 20px; color: white;">
    <h2>Main Content Area</h2>
    <p>Drag the handle on the left edge to resize the sidebar.</p>
  </main>
</div>`,
            css: `/* Resizer Styling from index.css */
.col-resizer {
    position: absolute;
    right: 0;
    top: 0;
    width: 6px; /* Hit area */
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
}

.col-resizer:hover, .col-resizer.active {
    background-color: rgba(255, 255, 255, 0.1);
}

.resizer-icon {
    opacity: 0;
    transition: opacity 0.2s;
    color: var(--text-muted, #64748b);
}

.col-resizer:hover .resizer-icon,
.col-resizer.active .resizer-icon {
    opacity: 1;
}`,
            js: `const resizer = document.getElementById('col2-resizer');
const leftPanel = document.getElementById('left-panel');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    resizer.classList.add('active');
    e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    
    // Bounds checking
    if (newWidth >= 150 && newWidth <= 500) {
        leftPanel.style.width = newWidth + 'px';
    }
});

window.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        resizer.classList.remove('active');
    }
});`
        },
        "chart-panel": {
            name: "Chart Container",
            html: `<div style="padding: 20px; background: var(--bg-body, #0f172a); min-height: 100vh;">
  <div class="chart-container glass-panel" style="width: 100%; max-width: 500px; height: 350px;">
    <div class="panel-header">
        <h2>Usage by Teams</h2>
        <button class="chart-expand-btn" aria-label="Open full-screen chart view">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
        </button>
    </div>
    <div class="canvas-wrapper">
        <canvas id="mockChart"></canvas>
    </div>
  </div>
</div>
<!-- Load Chart.js for playground -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>`,
            css: `.chart-container {
    display: flex;
    flex-direction: column;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid var(--border-color, rgba(255,255,255,0.06));
    background: var(--bg-card, #1e293b);
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.panel-header h2 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary, #f8fafc);
    margin: 0;
}

.canvas-wrapper {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
}

.chart-expand-btn {
    background: none;
    border: none;
    color: var(--text-muted, #64748b);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
}

.chart-expand-btn:hover {
    color: var(--text-primary, white);
    background: rgba(255,255,255,0.1);
}`,
            js: `// We need to wait for Chart object because Chart JS is loaded asynchronously in our HTML block
setTimeout(() => {
    const ctx = document.getElementById('mockChart');
    if (!ctx) return;
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Team Alpha', 'Team Beta', 'Team Gamma', 'Unallocated'],
            datasets: [{
                data: [45, 25, 20, 10],
                backgroundColor: [
                    '#3b82f6', '#8b5cf6', '#10b981', '#475569'
                ],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#cbd5e1' } }
            },
            cutout: '65%'
        }
    });
}, 500);`
        },
        "search-disk": {
            name: "Search Input",
            html: `<div style="padding: 50px; background: var(--bg-body, #0f172a); min-height: 100vh;">
  <div style="width: 300px; padding: 20px; background: var(--bg-sidebar, #1e293b); border-radius: 8px;">
    
    <label style="display:block; margin-bottom:8px; font-size:0.8rem; color: #cbd5e1;">Team Disks</label>
    
    <div class="team-overview-search-container" style="position:relative; width:100%;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-muted, #64748b);">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" id="demo-search" class="sidebar-text-input" placeholder="Search disks...">
    </div>
    
  </div>
</div>`,
            css: `.sidebar-text-input {
    width: 100%;
    padding: 8px 12px 8px 34px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--text-primary, #f8fafc);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-sizing: border-box;
}

.sidebar-text-input:focus {
    border-color: var(--accent-color, #3b82f6);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.sidebar-text-input::placeholder {
    color: var(--text-muted, #64748b);
}`,
            js: `const searchInput = document.getElementById('demo-search');

searchInput.addEventListener('input', (e) => {
    console.log("Searching for:", e.target.value);
    // You can see this output in your browser's Developer Console
});`
        }
    };

    // Configuration for CodeMirror
    const cmConfig = {
        theme: 'monokai',
        lineNumbers: true,
        lineWrapping: true,
        autoCloseTags: true,
        autoCloseBrackets: true,
        tabSize: 2,
        indentUnit: 2,
        scrollbarStyle: 'native'
    };

    // Initialize Editors
    const htmlEditor = CodeMirror.fromTextArea(document.getElementById('html-code'), { ...cmConfig, mode: 'xml' });
    const cssEditor = CodeMirror.fromTextArea(document.getElementById('css-code'), { ...cmConfig, mode: 'css' });
    const jsEditor = CodeMirror.fromTextArea(document.getElementById('js-code'), { ...cmConfig, mode: 'javascript' });

    const previewFrame = document.getElementById('preview');
    let currentPreviewUrl = null;

    // Build Sidebar
    const componentList = document.getElementById('component-list');
    
    function loadComponent(key) {
        const comp = componentsData[key];
        if (!comp) return;
        
        // Update active class
        document.querySelectorAll('.component-list li').forEach(li => li.classList.remove('active'));
        document.getElementById('nav-' + key).classList.add('active');

        // Load values
        htmlEditor.setValue(comp.html);
        cssEditor.setValue(comp.css);
        jsEditor.setValue(comp.js);
        
        // Refresh editors to fix size issues
        setTimeout(() => {
            htmlEditor.refresh();
            cssEditor.refresh();
            jsEditor.refresh();
        }, 10);
    }

    Object.keys(componentsData).forEach((key, index) => {
        const li = document.createElement('li');
        li.id = 'nav-' + key;
        li.textContent = componentsData[key].name;
        li.addEventListener('click', () => loadComponent(key));
        componentList.appendChild(li);
    });

    // Update preview via Blob URL (more reliable than iframeDoc.write, fixes white screen)
    function updatePreview() {
        const html = htmlEditor.getValue();
        const css = cssEditor.getValue();
        const js = jsEditor.getValue();

        // Dynamically resolve the absolute path to the CSS folder based on CURRENT URL
        // Example: from .../playground/index.html -> resolves to .../css/
        const cssPath = new URL("../css", window.location.href).href;
        
        const sourceHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssPath}/vars.css" onerror="console.log('vars.css optional')">
    <link rel="stylesheet" href="${cssPath}/layout.css" onerror="console.log('layout.css optional')">
    <link rel="stylesheet" href="${cssPath}/components.css">
    <link rel="stylesheet" href="${cssPath}/index.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; margin: 0; min-height: 100vh; }
        ${css}
    </style>
</head>
<body>
    ${html}
    <script>
        try {
            ${js}
        } catch (error) {
            console.error('Playground JS Error:', error);
        }
    </script>
</body>
</html>`;

        const blob = new Blob([sourceHtml], { type: 'text/html' });
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
        }
        currentPreviewUrl = URL.createObjectURL(blob);
        previewFrame.src = currentPreviewUrl;
    }

    // Debounce preview update
    let updateTimeout;
    const handleChange = () => {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updatePreview, 500);
    };

    htmlEditor.on('change', handleChange);
    cssEditor.on('change', handleChange);
    jsEditor.on('change', handleChange);

    // Dynamic horizontal pane resizer logic
    const resizer = document.getElementById('resizer');
    const editorsContainer = document.querySelector('.editors');
    const container = document.querySelector('.container');
    
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('active');
        previewFrame.style.pointerEvents = 'none';
        
        // When resizing, prevent text selection
        document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        // Calculate relative Y
        const containerRect = container.getBoundingClientRect();
        const newHeightPixels = e.clientY - containerRect.top;
        
        // Boundaries
        const minHeight = 100;
        const maxHeight = containerRect.height - 100;
        
        if (newHeightPixels >= minHeight && newHeightPixels <= maxHeight) {
            const newHeightPercent = (newHeightPixels / containerRect.height) * 100;
            editorsContainer.style.height = newHeightPercent + "%";
            
            // Refresh codemirror so it recalculates height
            htmlEditor.refresh();
            cssEditor.refresh();
            jsEditor.refresh();
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('active');
            previewFrame.style.pointerEvents = 'auto';
            document.body.style.userSelect = '';
        }
    });

    // Make sure editors recalculate layout on window resize
    window.addEventListener('resize', () => {
        htmlEditor.refresh();
        cssEditor.refresh();
        jsEditor.refresh();
    });

    // Initial load
    loadComponent("disk-card");
});

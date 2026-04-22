const ROADMAP_ITEMS = [
    {
        version: "v3.9",
        date: "2026-04-22",
        status: "done",
        title: "Light mode and responsive expansion",
        bullets: [
            "Expanded light mode coverage for Inode, Permission Issues, TreeMap, and Group User Config.",
            "Improved cross-device scaling for Group User Config modal (desktop/tablet/mobile).",
            "Refined panel/list heights for high-density user sets.",
        ],
    },
    {
        version: "v3.8",
        date: "2026-04-20",
        status: "done",
        title: "Advanced Group/User operations and safety",
        bullets: [
            "Multi-select groups and users with Ctrl/Cmd support.",
            "Inline group rename by double-clicking group rows.",
            "Delete group flow with automatic user fallback to Other group.",
            "Reset configuration action to restore system defaults.",
        ],
    },
    {
        version: "v3.7",
        date: "2026-04-18",
        status: "done",
        title: "TreeMap, Permission, and Inode expansion",
        bullets: [
            "Expanded detail tabs with TreeMap explorer and permission analysis.",
            "Added inode distribution and top inode consumers visualization.",
            "Improved table/chart readability and state persistence in detail tabs.",
        ],
    },
    {
        version: "v3.0",
        date: "2026-04-12",
        status: "done",
        title: "Group User Config foundation release",
        bullets: [
            "Introduced Group User Config modal with server/local synchronized mapping.",
            "Added Team Space + Disk + Group + Users tri-pane configuration flow.",
            "Added import/export baseline for group mapping configuration.",
        ],
    },
    {
        version: "v2.5",
        date: "2026-04-05",
        status: "done",
        title: "Detail analysis maturation",
        bullets: [
            "Strengthened Permission Issues filtering and export flow.",
            "Improved detail tab behaviors and user-focused diagnostics.",
            "Added reliability updates for heavy datasets and long lists.",
        ],
    },
    {
        version: "v2.0",
        date: "2026-03-29",
        status: "done",
        title: "Historical and comparative analytics",
        bullets: [
            "Introduced trend/history analytics with timeline controls.",
            "Added team/user consumption visual comparisons with chart modes.",
            "Improved interaction model for drill-down analysis.",
        ],
    },
    {
        version: "v1.5",
        date: "2026-03-22",
        status: "done",
        title: "Dashboard UX and chart stability",
        bullets: [
            "Refined dashboard cards, chart containers, and filter interactions.",
            "Added better status signaling and feedback toasts.",
            "Improved table rendering and layout consistency.",
        ],
    },
    {
        version: "v1.0",
        date: "2026-03-15",
        status: "done",
        title: "Initial Disk Usage release",
        bullets: [
            "Launched baseline disk usage overview with team/disk navigation.",
            "Added primary capacity stats (total, used, scanned, free, usage%).",
            "Established sync pipeline and core frontend structure.",
        ],
    },
];

function iconRoadmap() {
    return `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h13"></path>
            <path d="M3 12h13"></path>
            <path d="M3 18h13"></path>
            <circle cx="19" cy="6" r="2"></circle>
            <circle cx="19" cy="12" r="2"></circle>
            <circle cx="19" cy="18" r="2"></circle>
        </svg>
    `;
}

function formatStatus(status) {
    if (status === "done") return "Done";
    if (status === "in-progress") return "In Progress";
    return "Planned";
}

function closeSettingsDropdown() {
    const dropdown = document.getElementById("settings-dropdown");
    if (!dropdown) return;
    dropdown.style.display = "none";
    dropdown.dataset.visible = "false";
}

function buildRoadmapRows() {
    return ROADMAP_ITEMS.map((item) => {
        const bullets = item.bullets.map((line) => `<li>${line}</li>`).join("");
        return `
            <article class="changelog-item">
                <div class="changelog-item-head">
                    <div class="changelog-item-meta">
                        <span class="changelog-version">${item.version}</span>
                        <span class="changelog-date">${item.date}</span>
                    </div>
                    <span class="changelog-status ${item.status}">${formatStatus(item.status)}</span>
                </div>
                <h4 class="changelog-item-title">${item.title}</h4>
                <ul class="changelog-bullets">${bullets}</ul>
            </article>
        `;
    }).join("");
}

function createChangeLogModal() {
    if (document.getElementById("changelog-modal")) return;

    const modal = document.createElement("div");
    modal.id = "changelog-modal";
    modal.className = "changelog-modal";
    modal.innerHTML = `
        <div class="changelog-backdrop" data-close-changelog="true"></div>
        <div class="changelog-box glass-panel" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
            <header class="changelog-header">
                <div class="changelog-title-wrap">
                    <div id="changelog-title" class="changelog-title">${iconRoadmap()}<span>Disk Usage Roadmap</span></div>
                    <p class="changelog-subtitle">Feature timeline and development direction.</p>
                </div>
                <button id="btn-changelog-close" class="changelog-close" type="button" aria-label="Close">x</button>
            </header>
            <div class="changelog-body">
                ${buildRoadmapRows()}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function openChangeLogModal() {
    createChangeLogModal();
    const modal = document.getElementById("changelog-modal");
    if (!modal) return;
    document.body.classList.add("changelog-open");
    modal.classList.add("visible");
}

function closeChangeLogModal() {
    const modal = document.getElementById("changelog-modal");
    if (!modal) return;
    modal.classList.remove("visible");
    document.body.classList.remove("changelog-open");
}

function bindChangeLogEvents() {
    const trigger = document.getElementById("btn-open-changelog");
    if (!trigger) return;

    trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSettingsDropdown();
        openChangeLogModal();
    });

    document.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.matches("[data-close-changelog='true']") || target.id === "btn-changelog-close") {
            closeChangeLogModal();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeChangeLogModal();
    });
}

document.addEventListener("DOMContentLoaded", bindChangeLogEvents);

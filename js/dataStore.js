import { UINodes, AppState } from './main.js';

// The centralized Store that receives processed chunks from Web Worker
export class DataStore {
    constructor() {
        this.timelineData = [];
        this.teamUsageMap = new Map();
        this.userUsageMap = new Map();
        this.otherUsageMap = new Map();

        // Lightweight per-entity timelines
        this.userTimelineMap = new Map(); // username → [{timestamp, used}]
        this.teamTimelineMap = new Map(); // teamname → [{timestamp, used}]

        this.dateRange = { min: Infinity, max: -Infinity };

        // Full snapshot object for the latest report
        this.latestSnapshot = null;
        this._latestTs = -Infinity;
        this.permissionIssues = null;  // latest *permission_issues*.json

        this.latestStats = {
            total: 0,
            used: 0,
            available: 0,
            date: null
        };
    }

    // Process a chunk of parsed data from the worker/API
    processChunk(reports) {
        reports.forEach(report => {
            // Defensive Check against malformed JSONs
            if (!report || !report.general_system) {
                console.warn("Skipping malformed report structure.", report);
                return;
            }

            // Store timeline points
            const scannedBytes = (report.team_usage || []).reduce((s, t) => s + (t.used || 0), 0);
            this.timelineData.push({
                timestamp: (report.date || 0) * 1000,
                used: report.general_system.used || 0,
                total: report.general_system.total || 0,
                scanned: scannedBytes
            });

            // Keep track of the latest report for top-level stats
            if (!this.latestStats.date || report.date > this.latestStats.date) {
                this.latestStats.date = report.date;
                this.latestStats.total = report.general_system.total || 0;
                this.latestStats.used = report.general_system.used || 0;
                this.latestStats.available = report.general_system.available || 0;
            }

            // Update date range
            const ts = (report.date || 0) * 1000;
            if (ts < this.dateRange.min) this.dateRange.min = ts;
            if (ts > this.dateRange.max) this.dateRange.max = ts;

            // Update latest snapshot (full breakdown stored once)
            if (ts > this._latestTs) {
                this._latestTs = ts;
                this.latestSnapshot = {
                    timestamp: ts,
                    general: {
                        total: report.general_system.total || 0,
                        used: report.general_system.used || 0,
                        free: report.general_system.available || 0,
                    },
                    teams: (report.team_usage || []).slice().sort((a, b) => b.used - a.used),
                    users: (report.user_usage || []).slice().sort((a, b) => b.used - a.used),
                    other: (report.other_usage || []).slice().sort((a, b) => b.used - a.used),
                };
            }

            // Aggregate Teams
            if (report.team_usage) {
                report.team_usage.forEach(team => {
                    this.teamUsageMap.set(team.name, team.used);
                    if (!this.teamTimelineMap.has(team.name)) this.teamTimelineMap.set(team.name, []);
                    this.teamTimelineMap.get(team.name).push({ timestamp: ts, used: team.used });
                });
            }

            // Aggregate Users
            if (report.user_usage) {
                report.user_usage.forEach(user => {
                    this.userUsageMap.set(user.name, user.used);
                    if (!this.userTimelineMap.has(user.name)) this.userTimelineMap.set(user.name, []);
                    this.userTimelineMap.get(user.name).push({ timestamp: ts, used: user.used });
                });
            }

            // Aggregate Other
            if (report.other_usage) {
                report.other_usage.forEach(item => {
                    const prev = this.otherUsageMap.get(item.name) || 0;
                    if (item.used > prev) this.otherUsageMap.set(item.name, item.used);
                    if (!this.userTimelineMap.has(item.name)) this.userTimelineMap.set(item.name, []);
                    this.userTimelineMap.get(item.name).push({ timestamp: ts, used: item.used });
                });
            }
        });
    }

    // Sort time series data before rendering
    finalizeProcessing() {
        this.timelineData.sort((a, b) => a.timestamp - b.timestamp);
        // Sort each user/team timeline too
        this.userTimelineMap.forEach(arr => arr.sort((a, b) => a.timestamp - b.timestamp));
        this.teamTimelineMap.forEach(arr => arr.sort((a, b) => a.timestamp - b.timestamp));
    }

    getTimelineData() { return this.timelineData; }
    getDateRange() { return this.dateRange; }
    getAllUserNames() { return Array.from(this.userTimelineMap.keys()).sort(); }
    getAllTeamNames() { return Array.from(this.teamUsageMap.keys()).sort(); }

    // Returns the full latest snapshot object
    getLatestSnapshot() { return this.latestSnapshot; }

    // ── Pivot table queries ───────────────────────────────────────────

    // Top N users by total usage (last known value in range)
    getTopUsersByTotal(startMs, endMs, limit = 10) {
        return Array.from(this.userTimelineMap.entries())
            .map(([name, timeline]) => {
                const inRange = timeline.filter(p => p.timestamp >= startMs && p.timestamp <= endMs);
                const used = inRange.length ? inRange[inRange.length - 1].used : 0;
                return { name, used };
            })
            .sort((a, b) => b.used - a.used)
            .slice(0, limit);
    }

    // Top N users by growth (last - first in range)
    getTopUsersByGrowth(startMs, endMs, limit = 10) {
        return Array.from(this.userTimelineMap.entries())
            .map(([name, timeline]) => {
                const inRange = timeline.filter(p => p.timestamp >= startMs && p.timestamp <= endMs);
                const first = inRange.length ? inRange[0].used : 0;
                const last = inRange.length ? inRange[inRange.length - 1].used : 0;
                return { name, used: last, growth: last - first };
            })
            .filter(u => u.growth > 0)
            .sort((a, b) => b.growth - a.growth)
            .slice(0, limit);
    }

    // Build pivot: { dates[], userNames[], matrix: Map<date, Map<user, used>> }
    getPivotData(startMs, endMs, userNames) {
        // Collect all unique timestamps in range
        const tsSet = new Set();
        for (const timeline of this.userTimelineMap.values()) {
            timeline.forEach(p => {
                if (p.timestamp >= startMs && p.timestamp <= endMs) tsSet.add(p.timestamp);
            });
        }
        const dates = Array.from(tsSet).sort((a, b) => b - a); // newest first

        // Build matrix: date → user → used
        const matrix = new Map();
        for (const ts of dates) {
            const row = new Map();
            for (const uname of userNames) {
                const timeline = this.userTimelineMap.get(uname) ?? [];
                // Find the entry closest at or before this timestamp
                const match = timeline.filter(p => p.timestamp <= ts).pop();
                row.set(uname, match ? match.used : null);
            }
            matrix.set(ts, row);
        }
        return { dates, userNames, matrix };
    }

    getTeamDistribution() {
        return Array.from(this.teamUsageMap.entries())
            .map(([name, used]) => ({ name, used }))
            .sort((a, b) => b.used - a.used);
    }

    getTopUsers(limit = 10) {
        const combined = new Map([...this.userUsageMap, ...this.otherUsageMap]);
        return Array.from(combined.entries())
            .map(([name, used]) => ({ name, used }))
            .sort((a, b) => b.used - a.used)
            .slice(0, limit);
    }

    // ── Filter-aware queries ──────────────────────────────────────────

    // Returns timeline snapshots within [startMs, endMs]
    getFilteredTimeline(startMs, endMs) {
        return this.timelineData.filter(d => d.timestamp >= startMs && d.timestamp <= endMs);
    }

    // Returns user list, using the LAST value within [startMs, endMs]
    getFilteredUsers(startMs, endMs, selectedUsers = null, minUsedBytes = 0, sortKey = 'used_desc') {
        const names = selectedUsers ?? this.getAllUserNames();
        const results = [];

        for (const name of names) {
            const timeline = this.userTimelineMap.get(name) ?? [];
            const inRange = timeline.filter(p => p.timestamp >= startMs && p.timestamp <= endMs);
            const used = inRange.length ? inRange[inRange.length - 1].used : 0;
            if (used >= minUsedBytes) results.push({ name, used });
        }

        return this._sortEntities(results, sortKey);
    }

    // Returns team list filtered by selection, sorted
    getFilteredTeams(selectedTeams = null, minUsedBytes = 0, sortKey = 'used_desc') {
        const names = selectedTeams ?? this.getAllTeamNames();
        const results = names
            .map(name => ({ name, used: this.teamUsageMap.get(name) ?? 0 }))
            .filter(t => t.used >= minUsedBytes);
        return this._sortEntities(results, sortKey);
    }

    _sortEntities(arr, sortKey) {
        return arr.sort((a, b) => {
            if (sortKey === 'used_desc') return b.used - a.used;
            if (sortKey === 'used_asc') return a.used - b.used;
            if (sortKey === 'name_asc') return a.name.localeCompare(b.name);
            if (sortKey === 'name_desc') return b.name.localeCompare(a.name);
            return 0;
        });
    }
}

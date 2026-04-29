import { UINodes, AppState } from './main.js';

// The centralized Store that receives processed chunks from Web Worker
export class DataStore {
    constructor() {
        this.timelineData = [];
        this.teamUsageMap = new Map();
        this.userUsageMap = new Map();
        this.otherUsageMap = new Map();

        // Lightweight per-entity timelines
        this.userTimelineMap = new Map(); // username -> [{timestamp, used}]
        this.teamTimelineMap = new Map(); // teamname -> [{timestamp, used}]

        // team_id -> Set<username> (built from user_usage.team_id in latest report)
        this.teamUserMap = new Map();
        // username -> team_id
        this.userTeamIdMap = new Map();
        // team name -> team_id
        this.teamIdMap = new Map();

        this.dateRange = { min: Infinity, max: -Infinity };

        this.latestSnapshot = null;
        this._latestTs = -Infinity;
        this.permissionIssues = null;
        this.latestInodes = null;
        this.groupConfig = null;
        this.activeDiskId = null;
        this.groupedView = null;

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
                    directory: report.directory || null,
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

            // Aggregate Teams (store team_id alongside)
            if (report.team_usage) {
                report.team_usage.forEach(team => {
                    this.teamUsageMap.set(team.name, team.used);
                    if (team.team_id !== undefined) this.teamIdMap.set(team.name, team.team_id);
                    if (!this.teamTimelineMap.has(team.name)) this.teamTimelineMap.set(team.name, []);
                    this.teamTimelineMap.get(team.name).push({ timestamp: ts, used: team.used });
                });
            }

            // Aggregate Users (store team_id for team-user linking)
            if (report.user_usage) {
                report.user_usage.forEach(user => {
                    this.userUsageMap.set(user.name, user.used);
                    if (user.team_id !== undefined) {
                        this.userTeamIdMap.set(user.name, user.team_id);
                        if (!this.teamUserMap.has(user.team_id)) this.teamUserMap.set(user.team_id, new Set());
                        this.teamUserMap.get(user.team_id).add(user.name);
                    }
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

        this._rebuildGroupedView();
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

    setGroupingContext(config, activeDiskId) {
        this.groupConfig = this._normalizeGroupingConfig(config);
        this.activeDiskId = activeDiskId ? String(activeDiskId) : null;
        this._rebuildGroupedView();
    }

    _normalizeGroupingConfig(config) {
        if (!config || typeof config !== 'object' || !Array.isArray(config.groups)) return null;
        const groups = config.groups
            .filter(g => g && typeof g === 'object')
            .map((g, idx) => {
                const id = String(g.id || `group_${idx + 1}`);
                const name = String(g.name || `Group ${idx + 1}`).trim() || `Group ${idx + 1}`;
                const diskUsers = {};
                if (g.diskUsers && typeof g.diskUsers === 'object') {
                    Object.keys(g.diskUsers).forEach(diskId => {
                        const users = g.diskUsers[diskId];
                        if (!Array.isArray(users)) return;
                        diskUsers[String(diskId)] = [...new Set(users
                            .map(u => String(u || '').trim())
                            .filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b));
                    });
                }
                return { id, name, diskUsers };
            });

        return {
            schema_version: Number(config.schema_version || 1),
            groups,
        };
    }

    _rebuildGroupedView() {
        this.groupedView = null;
        if (!this.latestSnapshot || !this.groupConfig || !this.activeDiskId) {
            if (this.latestSnapshot) this.latestSnapshot.grouped = null;
            return;
        }

        const usageMap = new Map();
        const addUsage = (arr) => {
            (arr || []).forEach((u) => {
                if (!u || !u.name) return;
                const name = String(u.name);
                const prev = usageMap.get(name) || 0;
                const used = Number(u.used || 0);
                if (used > prev) usageMap.set(name, used);
            });
        };

        addUsage(this.latestSnapshot.users);
        addUsage(this.latestSnapshot.other);

        const assignedUsers = new Set();
        const distribution = [];
        const membersByGroup = new Map();
        let hasActiveAssignments = false;

        this.groupConfig.groups.forEach((group) => {
            const list = Array.isArray(group.diskUsers?.[this.activeDiskId]) ? group.diskUsers[this.activeDiskId] : [];
            if (list.length === 0) return;
            hasActiveAssignments = true;
            const members = [];
            let sum = 0;

            list.forEach((userName) => {
                const used = usageMap.get(userName) || 0;
                assignedUsers.add(userName);
                members.push({ name: userName, used });
                sum += used;
            });

            members.sort((a, b) => b.used - a.used);
            const groupKey = `group:${group.id}`;
            membersByGroup.set(groupKey, members);
            distribution.push({
                name: group.name,
                used: sum,
                team_id: groupKey,
                is_group: true,
            });
        });

        // No users assigned to any group for this disk:
        // keep default (non-grouped) view to avoid showing synthetic legends.
        if (!hasActiveAssignments) {
            this.groupedView = null;
            this.latestSnapshot.grouped = null;
            return;
        }

        const ungroupedUsers = [];
        usageMap.forEach((used, name) => {
            if (!assignedUsers.has(name)) {
                ungroupedUsers.push({ name, used });
            }
        });
        ungroupedUsers.sort((a, b) => b.used - a.used);

        const ungroupedSum = ungroupedUsers.reduce((s, u) => s + (u.used || 0), 0);
        let otherTeamId = null;
        if (ungroupedSum > 0) {
            const otherIdx = distribution.findIndex((g) => String(g?.name || '').trim().toLowerCase() === 'other');
            if (otherIdx >= 0) {
                otherTeamId = distribution[otherIdx].team_id || 'group:__other__';
                const existingMembers = membersByGroup.get(otherTeamId) || [];
                membersByGroup.set(otherTeamId, existingMembers.concat(ungroupedUsers).sort((a, b) => b.used - a.used));
                distribution[otherIdx].used = (distribution[otherIdx].used || 0) + ungroupedSum;
            } else {
                otherTeamId = 'group:__other__';
                membersByGroup.set(otherTeamId, ungroupedUsers.slice());
                distribution.push({
                    name: 'Other',
                    used: ungroupedSum,
                    team_id: otherTeamId,
                    is_group: true,
                });
            }
        }
        if (!otherTeamId) {
            const existingOther = distribution.find((g) => String(g?.name || '').trim().toLowerCase() === 'other');
            otherTeamId = existingOther?.team_id || null;
        }

        distribution.sort((a, b) => b.used - a.used);
        const topConsumers = distribution.slice();
        const otherUsers = otherTeamId
            ? (membersByGroup.get(otherTeamId) || []).slice().sort((a, b) => b.used - a.used)
            : [];

        this.groupedView = {
            distribution,
            membersByGroup,
            ungroupedUsers,
            otherUsers,
            topConsumers,
        };

        this.latestSnapshot.grouped = {
            schema_version: this.groupConfig.schema_version || 1,
            disk_id: this.activeDiskId,
            groups: distribution.map(g => ({ name: g.name, used: g.used, team_id: g.team_id })),
            ungrouped_users: ungroupedUsers.slice(),
        };
    }

    setLatestInodes(inodesData) { this.latestInodes = inodesData; }
    getLatestInodes() { return this.latestInodes; }

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
            .filter(u => u.growth !== 0 || this.userTimelineMap.size <= 10) // Show all if <=10 users, else filter out 0 growth
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
        if (this.groupedView?.distribution?.length) {
            return this.groupedView.distribution.slice();
        }
        if (!this.latestSnapshot || !this.latestSnapshot.teams) return [];
        return this.latestSnapshot.teams.slice().sort((a, b) => b.used - a.used);
    }

    /** Return only users belonging to a given team_id, sorted by usage desc */
    getUsersByTeamId(teamId) {
        if (this.groupedView?.membersByGroup?.has(teamId)) {
            return (this.groupedView.membersByGroup.get(teamId) || []).slice().sort((a, b) => b.used - a.used);
        }
        if (!this.latestSnapshot || !this.latestSnapshot.users) return [];
        return this.latestSnapshot.users
            .filter(u => u.team_id === teamId)
            .slice()
            .sort((a, b) => b.used - a.used);
    }

    /** Return other_usage (system/unregistered users), sorted by usage desc */
    getOtherUsers() {
        if (this.groupedView?.otherUsers) {
            return this.groupedView.otherUsers.slice().sort((a, b) => b.used - a.used);
        }
        if (!this.latestSnapshot || !this.latestSnapshot.other) return [];
        return this.latestSnapshot.other.slice().sort((a, b) => b.used - a.used);
    }

    getTopConsumers(limit = 10) {
        if (this.groupedView?.topConsumers?.length) {
            return this.groupedView.topConsumers.slice().sort((a, b) => b.used - a.used).slice(0, limit);
        }
        return this.getTopUsers(limit);
    }

    getTopUsers(limit = 10) {
        if (!this.latestSnapshot) return [];
        const combined = [
            ...(this.latestSnapshot.users || []),
            ...(this.latestSnapshot.other || [])
        ];
        return combined
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

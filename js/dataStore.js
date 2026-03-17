import { UINodes, AppState } from './main.js';

// The centralized Store that receives processed chunks from Web Worker
export class DataStore {
    constructor() {
        this.timelineData = [];
        this.teamUsageMap = new Map();
        this.userUsageMap = new Map();
        
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
            this.timelineData.push({
                timestamp: (report.date || 0) * 1000, // JS expects ms
                used: report.general_system.used || 0,
                total: report.general_system.total || 0
            });
            
            // Keep track of the latest report for top-level stats
            if (!this.latestStats.date || report.date > this.latestStats.date) {
                this.latestStats.date = report.date;
                this.latestStats.total = report.general_system.total || 0;
                this.latestStats.used = report.general_system.used || 0;
                this.latestStats.available = report.general_system.available || 0;
            }

            // Aggregate Teams
            if (report.team_usage) {
                report.team_usage.forEach(team => {
                    // For simplicity, we just keep the latest known state of the team
                    // Or we could average it, but taking max/latest is usually what dashboard wants 
                    // Let's take the latest state by sorting later, for now just overwrite
                    this.teamUsageMap.set(team.name, team.used);
                });
            }

            // Aggregate Users
            if (report.user_usage) {
                report.user_usage.forEach(user => {
                    this.userUsageMap.set(user.name, user.used);
                });
            }
        });
    }

    // Sort time series data before rendering
    finalizeProcessing() {
        this.timelineData.sort((a, b) => a.timestamp - b.timestamp);
    }

    getTimelineData() {
        return this.timelineData;
    }

    getTeamDistribution() {
        return Array.from(this.teamUsageMap.entries())
            .map(([name, used]) => ({ name, used }))
            .sort((a, b) => b.used - a.used);
    }

    getTopUsers(limit = 10) {
        return Array.from(this.userUsageMap.entries())
            .map(([name, used]) => ({ name, used }))
            .sort((a, b) => b.used - a.used)
            .slice(0, limit);
    }
}

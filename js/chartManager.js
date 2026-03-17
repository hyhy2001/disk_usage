export class ChartManager {
    constructor() {
        this.timelineChart = null;
        this.teamChart = null;
        this.usersChart = null;
        
        // Brand Colors
        this.colors = {
            emerald: '#10b981',
            rose: '#f43f5e',
            sky: '#0ea5e9',
            amber: '#f59e0b',
            slate: '#94a3b8'
        };

        Chart.defaults.color = this.colors.slate;
        Chart.defaults.font.family = "'Inter', sans-serif";
    }

    render(dataStore) {
        this.renderTimeline(dataStore.getTimelineData());
        this.renderTeamChart(dataStore.getTeamDistribution());
        this.renderUsersChart(dataStore.getTopUsers(10));
    }

    renderTimeline(timelineData) {
        const ctx = document.getElementById('timelineChart').getContext('2d');
        
        const labels = timelineData.map(d => new Date(d.timestamp).toLocaleDateString());
        // Convert to TB
        const usedData = timelineData.map(d => d.used / (1024 ** 4));
        const totalData = timelineData.map(d => d.total / (1024 ** 4));

        if (this.timelineChart) this.timelineChart.destroy();

        this.timelineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Used Capacity (TB)',
                        data: usedData,
                        borderColor: this.colors.rose,
                        backgroundColor: 'rgba(244, 63, 94, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10
                    },
                    {
                        label: 'Total Capacity (TB)',
                        data: totalData,
                        borderColor: this.colors.emerald,
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.1,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 17, 21, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y: { 
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' } 
                    }
                }
            }
        });
    }

    renderTeamChart(teamData) {
        const ctx = document.getElementById('teamChart').getContext('2d');
        const labels = teamData.map(t => t.name);
        // TB
        const data = teamData.map(t => t.used / (1024 ** 4));

        if (this.teamChart) this.teamChart.destroy();

        this.teamChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        this.colors.sky, this.colors.emerald, this.colors.amber, 
                        this.colors.rose, '#8b5cf6', this.colors.slate
                    ],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });
    }

    renderUsersChart(userData) {
        const ctx = document.getElementById('usersChart').getContext('2d');
        const labels = userData.map(u => u.name);
        const data = userData.map(u => u.used / (1024 ** 4));

        if (this.usersChart) this.usersChart.destroy();

        this.usersChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Consumed (TB)',
                    data: data,
                    backgroundColor: this.colors.sky,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Horizontal bar chart
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y: { grid: { display: false } }
                }
            }
        });
    }
}

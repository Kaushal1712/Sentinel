/**
 * Dashboard Module — Stats cards, recent scans table.
 */
const Dashboard = {
    async load() {
        try {
            const data = await API.getDashboardStats();
            this.renderStats(data.stats);
            this.renderTrends(data.timeline);
            this.renderRecentScans(data.recent_scans);
        } catch (error) {
            console.warn('Dashboard load error (may be first load):', error);
            // Don't rethrow — show zeros gracefully
            this.renderStats({
                total_scans: 0,
                total_profiles_found: 0,
                avg_risk_score: 0,
                total_entities_found: 0,
            });
            this.renderRecentScans([]);
        }
    },

    renderStats(stats) {
        this.animateCounter('stat-total-scans', stats.total_scans || 0);
        this.animateCounter('stat-profiles-found', stats.total_profiles_found || 0);
        this.animateCounter('stat-avg-risk', stats.avg_risk_score || 0, true);
        this.animateCounter('stat-entities', stats.total_entities_found || 0);
    },

    renderTrends(timeline) {
        if (!timeline || timeline.length === 0) return;

        this.renderChartJs('trend-scans-chart', timeline, 'scans', 'Scans Over Time', '--accent-blue');
        this.renderChartJs('trend-risk-chart', timeline, 'avg_risk', 'Average Risk Score', '--accent-amber');
    },

    renderChartJs(containerId, data, key, label, colorVar) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `<canvas id="${containerId}-canvas"></canvas>`;
        const ctx = document.getElementById(`${containerId}-canvas`).getContext('2d');

        const hexColor = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim() || '#3b82f6';

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => this.formatDate(d.date).replace(' ago', '').replace('Just now', 'Today')),
                datasets: [{
                    label: label,
                    data: data.map(d => d[key]),
                    borderColor: hexColor,
                    backgroundColor: `${hexColor}33`,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f1f5f9',
                        bodyColor: '#cbd5e1',
                        borderColor: '#334155',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: { display: true, grid: { display: false, drawBorder: false }, ticks: { color: '#64748b', maxTicksLimit: 5 } },
                    y: {
                        display: true,
                        grid: { color: '#334155', drawBorder: false },
                        ticks: { color: '#64748b' },
                        min: 0,
                        max: key === 'avg_risk' ? 10 : undefined
                    }
                }
            }
        });
    },

    animateCounter(elementId, targetValue, isFloat = false) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const duration = 1200;
        const startTime = performance.now();
        const startValue = 0;

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = startValue + (targetValue - startValue) * eased;

            el.textContent = isFloat ? current.toFixed(1) : Math.round(current);

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    },

    renderRecentScans(scans) {
        const tbody = document.getElementById('recent-scans-body');
        if (!tbody) return;

        if (!scans || scans.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No scans yet. Start your first investigation!</td></tr>';
            return;
        }

        tbody.innerHTML = scans.map(scan => `
            <tr>
                <td><strong style="color: var(--text-primary)">${this.escapeHtml(scan.target_name)}</strong></td>
                <td><span class="badge badge-${scan.mode}">${scan.mode}</span></td>
                <td><span class="badge badge-${scan.status}">${scan.status}</span></td>
                <td>${scan.risk_score !== null ? `<span style="color: ${this.getRiskColor(scan.risk_score)}">${scan.risk_score}/10</span>` : '—'}</td>
                <td>${scan.platforms_found || 0}</td>
                <td>${this.formatDate(scan.created_at)}</td>
                <td>
                    ${scan.status === 'completed' ? `
                        <a href="#/results?id=${scan.id}" class="btn btn-sm btn-secondary">View</a>
                    ` : scan.status === 'running' ? `
                        <span class="badge badge-running">In Progress</span>
                    ` : '—'}
                </td>
            </tr>
        `).join('');
    },

    getRiskColor(score) {
        if (score >= 8) return 'var(--risk-critical)';
        if (score >= 6) return 'var(--risk-high)';
        if (score >= 3) return 'var(--risk-medium)';
        return 'var(--risk-low)';
    },

    formatDate(dateStr) {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

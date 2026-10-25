/**
 * Visualize Module — Interactive chart builder with Chart.js.
 */
const Visualize = {
    currentDatasetId: null,
    currentDataset: null,
    dataRows: [],
    charts: [],
    chartCounter: 0,

    async load() {
        const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const datasetId = params.get('dataset');

        if (!datasetId) {
            await this.showDatasetSelector();
            return;
        }

        this.currentDatasetId = parseInt(datasetId);
        await this.loadVisualizationBuilder();
    },

    async showDatasetSelector() {
        const container = document.getElementById('visualize-container');
        if (!container) return;

        try {
            const data = await API.getDatasets();
            const datasets = data.datasets || [];

            if (datasets.length === 0) {
                container.innerHTML = `
                    <div class="chat-no-dataset">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                            <path d="M18 20V10M12 20V4M6 20v-6"/>
                        </svg>
                        <h3>No Datasets Yet</h3>
                        <p>Upload a dataset first to create visualizations.</p>
                        <a href="#/datasets" class="btn btn-primary">Upload Dataset</a>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="chat-dataset-picker">
                    <h3>Select a Dataset to Visualize</h3>
                    <p>Choose a dataset to build interactive charts and dashboards.</p>
                    <div class="chat-dataset-grid">
                        ${datasets.map(ds => `
                            <div class="chat-dataset-option glass-card" onclick="Visualize.selectDataset(${ds.id})">
                                <div class="chat-ds-icon">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                                </div>
                                <h4>${Visualize.escapeHtml(ds.name)}</h4>
                                <span>${(ds.row_count || 0).toLocaleString()} rows · ${ds.column_count || 0} cols</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('Failed to load datasets', e);
        }
    },

    selectDataset(id) {
        window.location.hash = `#/visualize?dataset=${id}`;
    },

    async loadVisualizationBuilder() {
        const container = document.getElementById('visualize-container');
        if (!container) return;

        try {
            const dsData = await API.getDataset(this.currentDatasetId);
            this.currentDataset = dsData.dataset;

            const pageData = await API.getDatasetData(this.currentDatasetId, 1, 200);
            this.dataRows = pageData.data || [];

            this.renderBuilder();
        } catch (e) {
            console.warn('Failed to load dataset for viz', e);
            Toast.show('Failed to load dataset', 'error');
        }
    },

    renderBuilder() {
        const container = document.getElementById('visualize-container');
        const columns = this.currentDataset.columns || [];

        container.innerHTML = `
            <div class="viz-header">
                <div>
                    <button class="btn btn-ghost btn-sm" onclick="window.location.hash='#/visualize'">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                        Back
                    </button>
                    <h2>${this.escapeHtml(this.currentDataset.name)}</h2>
                </div>
            </div>

            <!-- Chart Builder Controls -->
            <div class="viz-controls glass-card fade-in">
                <div class="viz-control-row">
                    <div class="form-group">
                        <label>Chart Type</label>
                        <select id="viz-chart-type" class="select-input">
                            <option value="bar">Bar Chart</option>
                            <option value="line">Line Chart</option>
                            <option value="pie">Pie Chart</option>
                            <option value="doughnut">Doughnut</option>
                            <option value="scatter">Scatter Plot</option>
                            <option value="polarArea">Polar Area</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>X-Axis (Labels)</label>
                        <select id="viz-x-col" class="select-input">
                            ${columns.map((c, i) => `<option value="${c.name}" ${i === 0 ? 'selected' : ''}>${c.name} (${c.dtype})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Y-Axis (Values)</label>
                        <select id="viz-y-col" class="select-input">
                            ${columns.map((c, i) => `<option value="${c.name}" ${i === 1 || (i === 0 && columns.length === 1) ? 'selected' : ''}>${c.name} (${c.dtype})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Aggregation</label>
                        <select id="viz-agg" class="select-input">
                            <option value="none">None (raw)</option>
                            <option value="sum">Sum</option>
                            <option value="mean">Average</option>
                            <option value="count">Count</option>
                            <option value="min">Min</option>
                            <option value="max">Max</option>
                        </select>
                    </div>
                    <div class="form-group" style="align-self:end;">
                        <button class="btn btn-primary" onclick="Visualize.addChart()">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add Chart
                        </button>
                    </div>
                </div>
            </div>

            <!-- Charts Area -->
            <div class="viz-charts-grid" id="viz-charts-grid">
                <div class="viz-empty-state" id="viz-empty">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                        <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    <p>Configure chart options above and click "Add Chart" to create a visualization</p>
                </div>
            </div>
        `;
    },

    addChart() {
        const chartType = document.getElementById('viz-chart-type').value;
        const xCol = document.getElementById('viz-x-col').value;
        const yCol = document.getElementById('viz-y-col').value;
        const agg = document.getElementById('viz-agg').value;

        const empty = document.getElementById('viz-empty');
        if (empty) empty.style.display = 'none';

        this.chartCounter++;
        const chartId = `viz-chart-${this.chartCounter}`;

        // Prepare data
        let labels, values;

        if (agg === 'none') {
            const sliced = this.dataRows.slice(0, 50);
            labels = sliced.map(d => d[xCol] != null ? String(d[xCol]) : '');
            values = sliced.map(d => Number(d[yCol]) || 0);
        } else {
            // Group by xCol, aggregate yCol
            const groups = {};
            this.dataRows.forEach(row => {
                const key = row[xCol] != null ? String(row[xCol]) : 'Unknown';
                if (!groups[key]) groups[key] = [];
                groups[key].push(Number(row[yCol]) || 0);
            });

            const entries = Object.entries(groups).map(([key, vals]) => {
                let result;
                switch (agg) {
                    case 'sum': result = vals.reduce((a, b) => a + b, 0); break;
                    case 'mean': result = vals.reduce((a, b) => a + b, 0) / vals.length; break;
                    case 'count': result = vals.length; break;
                    case 'min': result = Math.min(...vals); break;
                    case 'max': result = Math.max(...vals); break;
                    default: result = vals[0];
                }
                return { key, value: result };
            });

            entries.sort((a, b) => b.value - a.value);
            const top = entries.slice(0, 30);
            labels = top.map(e => e.key);
            values = top.map(e => e.value);
        }

        const grid = document.getElementById('viz-charts-grid');
        const wrapper = document.createElement('div');
        wrapper.className = 'viz-chart-card glass-card fade-in';
        wrapper.id = `${chartId}-wrapper`;
        wrapper.innerHTML = `
            <div class="viz-chart-header">
                <h3>${chartType.charAt(0).toUpperCase() + chartType.slice(1)}: ${this.escapeHtml(yCol)} by ${this.escapeHtml(xCol)}${agg !== 'none' ? ` (${agg})` : ''}</h3>
                <button class="btn-icon" onclick="Visualize.removeChart('${chartId}')" title="Remove chart">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="viz-chart-body">
                <canvas id="${chartId}" height="300"></canvas>
            </div>
        `;
        grid.appendChild(wrapper);

        // Render chart
        const colors = [
            'rgba(99, 102, 241, 0.8)', 'rgba(16, 185, 129, 0.8)', 'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)', 'rgba(139, 92, 246, 0.8)', 'rgba(6, 182, 212, 0.8)',
            'rgba(236, 72, 153, 0.8)', 'rgba(34, 197, 94, 0.8)', 'rgba(251, 146, 60, 0.8)',
            'rgba(168, 85, 247, 0.8)', 'rgba(20, 184, 166, 0.8)', 'rgba(217, 70, 239, 0.8)',
        ];

        const isPieType = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea';
        const bgColors = isPieType ? colors.slice(0, values.length) : 'rgba(99, 102, 241, 0.7)';
        const borderColors = isPieType ? colors.map(c => c.replace('0.8', '1')) : 'rgba(99, 102, 241, 1)';

        const chart = new Chart(document.getElementById(chartId), {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: `${yCol}${agg !== 'none' ? ` (${agg})` : ''}`,
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: chartType === 'line' ? 2 : 1,
                    tension: 0.3,
                    fill: chartType === 'line',
                    pointRadius: chartType === 'scatter' ? 5 : 3,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: isPieType, labels: { color: '#94a3b8', font: { size: 11 } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(99, 102, 241, 0.3)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8,
                    },
                },
                scales: !isPieType ? {
                    x: {
                        ticks: { color: '#94a3b8', maxRotation: 45, font: { size: 10 } },
                        grid: { color: 'rgba(148,163,184,0.08)' },
                    },
                    y: {
                        ticks: { color: '#94a3b8', font: { size: 10 } },
                        grid: { color: 'rgba(148,163,184,0.08)' },
                    },
                } : undefined,
                animation: {
                    duration: 800,
                    easing: 'easeOutQuart',
                },
            },
        });

        this.charts.push({ id: chartId, chart });
    },

    removeChart(chartId) {
        const idx = this.charts.findIndex(c => c.id === chartId);
        if (idx !== -1) {
            this.charts[idx].chart.destroy();
            this.charts.splice(idx, 1);
        }
        const wrapper = document.getElementById(`${chartId}-wrapper`);
        if (wrapper) wrapper.remove();

        if (this.charts.length === 0) {
            const empty = document.getElementById('viz-empty');
            if (empty) empty.style.display = '';
        }
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },
};

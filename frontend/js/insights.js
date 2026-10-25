/**
 * Insights Module — AI-generated insights display.
 */
const Insights = {
    currentDatasetId: null,

    async load() {
        const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const datasetId = params.get('dataset');

        if (!datasetId) {
            await this.showDatasetSelector();
            return;
        }

        this.currentDatasetId = parseInt(datasetId);
        await this.loadInsights();
    },

    async showDatasetSelector() {
        const container = document.getElementById('insights-container');
        if (!container) return;

        try {
            const data = await API.getDatasets();
            const datasets = data.datasets || [];

            if (datasets.length === 0) {
                container.innerHTML = `
                    <div class="chat-no-dataset">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                        </svg>
                        <h3>No Datasets Yet</h3>
                        <p>Upload a dataset to generate AI-powered insights.</p>
                        <a href="#/datasets" class="btn btn-primary">Upload Dataset</a>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="chat-dataset-picker">
                    <h3>Select a Dataset for Insights</h3>
                    <p>Choose a dataset to generate AI-powered insights and analysis.</p>
                    <div class="chat-dataset-grid">
                        ${datasets.map(ds => `
                            <div class="chat-dataset-option glass-card" onclick="Insights.selectDataset(${ds.id})">
                                <div class="chat-ds-icon">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                                    </svg>
                                </div>
                                <h4>${Insights.escapeHtml(ds.name)}</h4>
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
        window.location.hash = `#/insights?dataset=${id}`;
    },

    async loadInsights() {
        const container = document.getElementById('insights-container');
        if (!container) return;

        container.innerHTML = `
            <div class="insights-header">
                <button class="btn btn-ghost btn-sm" onclick="window.location.hash='#/insights'">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back
                </button>
                <h2 id="insights-ds-name">Loading...</h2>
                <button class="btn btn-primary btn-sm" id="btn-generate-ai-insights" onclick="Insights.generateAIInsights()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    Generate AI Insights
                </button>
            </div>
            <div class="insights-loading" id="insights-loading">
                <div class="chat-typing-dots"><span></span><span></span><span></span></div>
                <p>Loading dataset analysis...</p>
            </div>
            <div class="insights-grid" id="insights-grid" style="display:none;"></div>
        `;

        // Load basic (rule-based) insights first
        try {
            const data = await API.request(`/api/insights/${this.currentDatasetId}/summary`);
            document.getElementById('insights-ds-name').textContent = data.columns ? `Insights` : 'Insights';

            this.renderInsights(data.insights || []);
        } catch (e) {
            console.warn('Failed to load insights', e);
            document.getElementById('insights-loading').innerHTML = '<p>Failed to load insights</p>';
        }
    },

    async generateAIInsights() {
        const btn = document.getElementById('btn-generate-ai-insights');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<div class="chat-typing-dots" style="margin:0;"><span></span><span></span><span></span></div> Generating...`;
        }

        try {
            const data = await API.request(`/api/insights/${this.currentDatasetId}/generate`, {
                method: 'POST',
            });
            this.renderInsights(data.insights || [], true);
            Toast.show('AI insights generated!', 'success');
        } catch (e) {
            Toast.show(e.error || 'Failed to generate AI insights', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg> Generate AI Insights`;
            }
        }
    },

    renderInsights(insights, isAI = false) {
        const loading = document.getElementById('insights-loading');
        const grid = document.getElementById('insights-grid');
        if (loading) loading.style.display = 'none';
        if (grid) grid.style.display = '';

        const typeIcons = {
            trend: '📈', outlier: '⚠️', correlation: '🔗', distribution: '📊',
            comparison: '⚖️', summary: '📋',
        };
        const importanceColors = {
            high: 'var(--risk-high)', medium: 'var(--accent-amber)', low: 'var(--text-tertiary)',
        };

        if (!insights || insights.length === 0) {
            grid.innerHTML = '<div class="viz-empty-state"><p>No insights generated yet. Click "Generate AI Insights" to analyze your data.</p></div>';
            return;
        }

        grid.innerHTML = `
            ${isAI ? '<div class="insights-ai-badge"><span class="badge badge-quick">🧠 AI-Generated Insights</span></div>' : ''}
            ${insights.map((insight, i) => `
                <div class="insight-card glass-card fade-in" style="animation-delay: ${i * 0.05}s;">
                    <div class="insight-card-header">
                        <span class="insight-icon">${typeIcons[insight.type] || '💡'}</span>
                        <span class="insight-type badge badge-${insight.importance === 'high' ? 'running' : insight.importance === 'medium' ? 'pending' : 'completed'}">${insight.type || 'insight'}</span>
                    </div>
                    <h3 class="insight-title">${this.escapeHtml(insight.title)}</h3>
                    <p class="insight-desc">${this.escapeHtml(insight.description)}</p>
                    ${insight.relatedColumns && insight.relatedColumns.length > 0 ? `
                        <div class="insight-cols">
                            ${insight.relatedColumns.map(c => `<span class="insight-col-tag">${this.escapeHtml(c)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        `;
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },
};

/**
 * Chat Module — AI-powered ChatGPT-style conversation with your data.
 */
const ChatUI = {
    currentDatasetId: null,
    currentDataset: null,
    messages: [],
    isLoading: false,

    async load() {
        // Get dataset ID from URL
        const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const datasetId = params.get('dataset');

        if (!datasetId) {
            this.showDatasetSelector();
            return;
        }

        this.currentDatasetId = parseInt(datasetId);
        await this.loadChat();
    },

    async showDatasetSelector() {
        const container = document.getElementById('chat-container');
        if (!container) return;

        try {
            const data = await API.getDatasets();
            const datasets = data.datasets || [];

            if (datasets.length === 0) {
                container.innerHTML = `
                    <div class="chat-no-dataset">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <h3>No Datasets Yet</h3>
                        <p>Upload a dataset first to start chatting with your data.</p>
                        <a href="#/datasets" class="btn btn-primary">Upload Dataset</a>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="chat-dataset-picker">
                    <h3>Select a Dataset to Chat With</h3>
                    <p>Choose a dataset to start an AI-powered conversation about your data.</p>
                    <div class="chat-dataset-grid">
                        ${datasets.map(ds => `
                            <div class="chat-dataset-option glass-card" onclick="ChatUI.selectDataset(${ds.id})">
                                <div class="chat-ds-icon">
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                        <polyline points="14 2 14 8 20 8"/>
                                    </svg>
                                </div>
                                <h4>${ChatUI.escapeHtml(ds.name)}</h4>
                                <span>${(ds.row_count || 0).toLocaleString()} rows · ${ds.column_count || 0} cols</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('Failed to load datasets for chat picker', e);
        }
    },

    selectDataset(id) {
        window.location.hash = `#/chat?dataset=${id}`;
    },

    async loadChat() {
        const container = document.getElementById('chat-container');
        if (!container) return;

        // Build chat UI
        container.innerHTML = `
            <div class="chat-header" id="chat-header">
                <div class="chat-header-info">
                    <button class="btn btn-ghost btn-sm" onclick="window.location.hash='#/chat'">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    </button>
                    <div>
                        <h3 id="chat-dataset-name">Loading...</h3>
                        <span class="chat-dataset-meta" id="chat-dataset-meta"></span>
                    </div>
                </div>
                <button class="btn btn-ghost btn-sm" title="Clear history" onclick="ChatUI.clearHistory()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            <div class="chat-messages" id="chat-messages">
                <div class="chat-welcome">
                    <div class="chat-welcome-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#chatGrad)" stroke-width="1.5">
                            <defs><linearGradient id="chatGrad"><stop stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                    </div>
                    <h3>Chat with your Data</h3>
                    <p>Ask questions in natural language — I'll analyze your dataset and show you results with charts.</p>
                    <div class="chat-suggestions" id="chat-suggestions">
                        <button class="chat-suggestion" onclick="ChatUI.sendSuggestion('Show me the first 5 rows')">Show first 5 rows</button>
                        <button class="chat-suggestion" onclick="ChatUI.sendSuggestion('What are the summary statistics?')">Summary statistics</button>
                        <button class="chat-suggestion" onclick="ChatUI.sendSuggestion('Which column has the most missing values?')">Missing values</button>
                        <button class="chat-suggestion" onclick="ChatUI.sendSuggestion('Show the top 10 values by the first numeric column')">Top 10 values</button>
                    </div>
                </div>
            </div>
            <div class="chat-input-area" id="chat-input-area">
                <div class="chat-input-wrap">
                    <input type="text" id="chat-input" placeholder="Ask about your data..." autocomplete="off"/>
                    <button class="chat-send-btn" id="chat-send-btn" onclick="ChatUI.sendMessage()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        `;

        // Enter key handler
        const input = document.getElementById('chat-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // Load dataset info and history
        try {
            const histData = await API.getChatHistory(this.currentDatasetId);
            this.currentDataset = histData.dataset;
            this.messages = histData.messages || [];

            document.getElementById('chat-dataset-name').textContent = this.currentDataset.name;
            document.getElementById('chat-dataset-meta').textContent =
                `${(this.currentDataset.row_count || 0).toLocaleString()} rows · ${this.currentDataset.column_count || 0} columns`;

            if (this.messages.length > 0) {
                const welcome = document.querySelector('.chat-welcome');
                if (welcome) welcome.style.display = 'none';
                this.messages.forEach(msg => this.appendMessage(msg));
            }
        } catch (e) {
            console.warn('Failed to load chat', e);
        }
    },

    sendSuggestion(text) {
        const input = document.getElementById('chat-input');
        if (input) input.value = text;
        this.sendMessage();
    },

    async sendMessage() {
        const input = document.getElementById('chat-input');
        if (!input) return;

        const message = input.value.trim();
        if (!message || this.isLoading) return;

        // Hide welcome
        const welcome = document.querySelector('.chat-welcome');
        if (welcome) welcome.style.display = 'none';

        // Show user message
        this.appendMessage({ role: 'user', content: message });
        input.value = '';

        // Show typing indicator
        this.isLoading = true;
        this.showTyping();

        try {
            const response = await API.sendChatMessage(this.currentDatasetId, message);
            this.hideTyping();
            if (response.message) {
                this.appendMessage(response.message);
            }
        } catch (error) {
            this.hideTyping();
            this.appendMessage({
                role: 'assistant',
                content: error.error || 'Something went wrong. Please try again.',
            });
        } finally {
            this.isLoading = false;
        }
    },

    appendMessage(msg) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `chat-bubble chat-${msg.role}`;

        let html = `<div class="chat-bubble-content">${this.escapeHtml(msg.content)}</div>`;

        // If there's a query generated, show it
        if (msg.query_generated) {
            html += `<div class="chat-query-tag">
                        <span>Query:</span>
                        <code>${this.escapeHtml(msg.query_generated)}</code>
                     </div>`;
        }

        // If there's data result, show it as a mini table
        if (msg.data_result && msg.data_result.length > 0) {
            const data = msg.data_result.slice(0, 10);
            const cols = Object.keys(data[0]);
            html += `
                <div class="chat-data-table-wrap">
                    <table class="chat-data-table">
                        <thead><tr>${cols.map(c => `<th>${this.escapeHtml(c)}</th>`).join('')}</tr></thead>
                        <tbody>${data.map(row =>
                            `<tr>${cols.map(c => `<td>${row[c] != null ? row[c] : '—'}</td>`).join('')}</tr>`
                        ).join('')}</tbody>
                    </table>
                    ${msg.data_result.length > 10 ? `<span class="chat-data-more">+${msg.data_result.length - 10} more rows</span>` : ''}
                </div>
            `;
        }

        // If there's a chart config, render it
        if (msg.chart_config && msg.data_result && msg.data_result.length > 0) {
            const chartId = `chat-chart-${Date.now()}`;
            html += `<div class="chat-chart-wrap"><canvas id="${chartId}" height="220"></canvas></div>`;
            div.innerHTML = html;
            container.appendChild(div);
            // Render chart after DOM insert
            setTimeout(() => this.renderChart(chartId, msg.chart_config, msg.data_result), 50);
        } else {
            div.innerHTML = html;
            container.appendChild(div);
        }

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    },

    renderChart(canvasId, config, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') return;

        const chartType = config.chartType || 'bar';
        const xCol = config.xColumn || Object.keys(data[0])[0];
        const yCol = config.yColumn || Object.keys(data[0])[1] || Object.keys(data[0])[0];

        const labels = data.map(d => d[xCol] != null ? String(d[xCol]) : '');
        const values = data.map(d => Number(d[yCol]) || 0);

        const colors = [
            'rgba(99, 102, 241, 0.8)', 'rgba(16, 185, 129, 0.8)', 'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)', 'rgba(139, 92, 246, 0.8)', 'rgba(6, 182, 212, 0.8)',
            'rgba(236, 72, 153, 0.8)', 'rgba(34, 197, 94, 0.8)', 'rgba(251, 146, 60, 0.8)',
        ];

        const bgColors = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea'
            ? colors.slice(0, values.length)
            : 'rgba(99, 102, 241, 0.7)';

        new Chart(canvas, {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: config.title || yCol,
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: 'rgba(99, 102, 241, 1)',
                    borderWidth: chartType === 'line' ? 2 : 1,
                    tension: 0.3,
                    fill: chartType === 'line',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: chartType === 'pie' || chartType === 'doughnut', labels: { color: '#94a3b8' } },
                    title: { display: !!config.title, text: config.title || '', color: '#e2e8f0' },
                    zoom: typeof ChartZoom !== 'undefined' ? { zoom: { wheel: { enabled: true }, pinch: { enabled: true } }, pan: { enabled: true } } : undefined,
                },
                scales: (chartType !== 'pie' && chartType !== 'doughnut' && chartType !== 'polarArea') ? {
                    x: { ticks: { color: '#94a3b8', maxRotation: 45 }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
                } : undefined,
            },
        });
    },

    showTyping() {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.id = 'chat-typing';
        div.className = 'chat-bubble chat-assistant chat-typing';
        div.innerHTML = `
            <div class="chat-typing-dots">
                <span></span><span></span><span></span>
            </div>
            <span>AI is analyzing your data...</span>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    },

    hideTyping() {
        const el = document.getElementById('chat-typing');
        if (el) el.remove();
    },

    async clearHistory() {
        if (!this.currentDatasetId) return;
        if (!confirm('Clear all chat history for this dataset?')) return;
        try {
            await API.clearChatHistory(this.currentDatasetId);
            window.location.hash = `#/chat?dataset=${this.currentDatasetId}`;
            await this.loadChat();
        } catch (e) {
            Toast.show('Failed to clear history', 'error');
        }
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },
};

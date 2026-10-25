/**
 * Dataset Module — Upload, manage, and explore datasets.
 */
const DatasetManager = {
    datasets: [],
    currentDataset: null,

    async load() {
        try {
            const data = await API.getDatasets();
            this.datasets = data.datasets || [];
            this.renderDatasetList();
        } catch (error) {
            console.warn('Dataset load error:', error);
            this.datasets = [];
            this.renderDatasetList();
        }
    },

    renderDatasetList() {
        const grid = document.getElementById('dataset-grid');
        const empty = document.getElementById('dataset-empty');
        if (!grid) return;

        if (this.datasets.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        grid.innerHTML = this.datasets.map(ds => `
            <div class="dataset-card glass-card fade-in" data-id="${ds.id}">
                <div class="dataset-card-header">
                    <div class="dataset-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </div>
                    <div class="dataset-card-actions">
                        <button class="btn-icon" title="Chat with data" onclick="DatasetManager.openChat(${ds.id})">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                        </button>
                        <button class="btn-icon btn-icon-danger" title="Delete" onclick="DatasetManager.deleteDataset(${ds.id}, event)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <h3 class="dataset-card-name">${this.escapeHtml(ds.name)}</h3>
                <p class="dataset-card-file">${this.escapeHtml(ds.original_filename)}</p>
                <div class="dataset-card-stats">
                    <span><strong>${(ds.row_count || 0).toLocaleString()}</strong> rows</span>
                    <span><strong>${ds.column_count || 0}</strong> cols</span>
                    <span><strong>${this.formatSize(ds.file_size_bytes)}</strong></span>
                </div>
                <div class="dataset-card-footer">
                    <span class="badge badge-${ds.upload_status === 'ready' ? 'completed' : 'pending'}">${ds.upload_status}</span>
                    <span class="dataset-date">${this.formatDate(ds.created_at)}</span>
                </div>
            </div>
        `).join('');

        // Click to view detail
        grid.querySelectorAll('.dataset-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-icon')) return;
                const id = parseInt(card.dataset.id);
                this.showDetail(id);
            });
        });
    },

    initUpload() {
        const dropzone = document.getElementById('dataset-dropzone');
        const fileInput = document.getElementById('dataset-file-input');
        const uploadBtn = document.getElementById('btn-upload-dataset');

        if (!dropzone) return;

        // Drag and drop
        ['dragenter', 'dragover'].forEach(event => {
            dropzone.addEventListener(event, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(event => {
            dropzone.addEventListener(event, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.showFileName(files[0].name);
            }
        });

        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                this.showFileName(fileInput.files[0].name);
            }
        });

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => this.uploadFile());
        }
    },

    showFileName(name) {
        const label = document.getElementById('dropzone-label');
        if (label) {
            label.innerHTML = `<strong>${this.escapeHtml(name)}</strong> selected`;
        }
    },

    async uploadFile() {
        const fileInput = document.getElementById('dataset-file-input');
        const nameInput = document.getElementById('dataset-name-input');
        const progressBar = document.getElementById('upload-progress-bar');
        const progressContainer = document.getElementById('upload-progress-container');

        if (!fileInput || !fileInput.files.length) {
            Toast.show('Please select a file first', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        if (nameInput && nameInput.value.trim()) {
            formData.append('name', nameInput.value.trim());
        }

        if (progressContainer) progressContainer.style.display = '';
        if (progressBar) progressBar.style.width = '30%';

        try {
            const data = await API.uploadDataset(formData);
            if (progressBar) progressBar.style.width = '100%';
            Toast.show('Dataset uploaded successfully!', 'success');

            // Reset form
            fileInput.value = '';
            if (nameInput) nameInput.value = '';
            const label = document.getElementById('dropzone-label');
            if (label) label.innerHTML = 'Drop CSV/Excel file here or <span class="dropzone-browse">browse</span>';

            setTimeout(() => {
                if (progressContainer) progressContainer.style.display = 'none';
                if (progressBar) progressBar.style.width = '0%';
            }, 1000);

            await this.load();
        } catch (error) {
            if (progressContainer) progressContainer.style.display = 'none';
            Toast.show(error.error || 'Upload failed', 'error');
        }
    },

    async showDetail(datasetId) {
        try {
            const dsData = await API.getDataset(datasetId);
            this.currentDataset = dsData.dataset;

            // Get paginated data
            const pageData = await API.getDatasetData(datasetId, 1, 50);

            this.renderDetailView(this.currentDataset, pageData);
        } catch (error) {
            Toast.show('Failed to load dataset details', 'error');
        }
    },

    renderDetailView(dataset, pageData) {
        const detail = document.getElementById('dataset-detail');
        const list = document.getElementById('dataset-list-section');
        if (!detail || !list) return;

        list.style.display = 'none';
        detail.style.display = '';

        const columns = dataset.columns || [];
        const summary = dataset.summary || {};
        const data = pageData.data || [];

        detail.innerHTML = `
            <div class="dataset-detail-header">
                <button class="btn btn-ghost btn-sm" id="btn-back-datasets" onclick="DatasetManager.backToList()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Back
                </button>
                <h2>${this.escapeHtml(dataset.name)}</h2>
                <div class="dataset-detail-actions">
                    <button class="btn btn-primary btn-sm" onclick="DatasetManager.openChat(${dataset.id})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Chat with Data
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="DatasetManager.openVisualize(${dataset.id})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                        Visualize
                    </button>
                </div>
            </div>

            <!-- Summary Stats -->
            <div class="stats-grid" style="margin-bottom: 24px;">
                <div class="stat-card glass-card">
                    <div class="stat-icon stat-icon-blue">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9h18M3 15h18M12 3v18"/></svg>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${(dataset.row_count || 0).toLocaleString()}</span>
                        <span class="stat-label">Rows</span>
                    </div>
                </div>
                <div class="stat-card glass-card">
                    <div class="stat-icon stat-icon-green">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${dataset.column_count || 0}</span>
                        <span class="stat-label">Columns</span>
                    </div>
                </div>
                <div class="stat-card glass-card">
                    <div class="stat-icon stat-icon-amber">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01"/><circle cx="12" cy="12" r="10"/></svg>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${summary.total_missing || 0}</span>
                        <span class="stat-label">Missing Values</span>
                    </div>
                </div>
                <div class="stat-card glass-card">
                    <div class="stat-icon stat-icon-purple">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/></svg>
                    </div>
                    <div class="stat-info">
                        <span class="stat-value">${summary.total_duplicates || 0}</span>
                        <span class="stat-label">Duplicates</span>
                    </div>
                </div>
            </div>

            <!-- Column Info -->
            <div class="section-card glass-card fade-in" style="margin-bottom: 24px;">
                <div class="section-header"><h2>Column Analysis</h2></div>
                <div class="table-wrap">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Min</th><th>Max</th><th>Mean</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${columns.map(col => `
                                <tr>
                                    <td><strong style="color:var(--text-primary)">${this.escapeHtml(col.name)}</strong></td>
                                    <td><span class="badge badge-${col.dtype === 'integer' || col.dtype === 'float' ? 'completed' : col.dtype === 'categorical' ? 'quick' : 'pending'}">${col.dtype}</span></td>
                                    <td>${col.missing_count > 0 ? `<span style="color:var(--risk-high)">${col.missing_count} (${col.missing_pct}%)</span>` : '<span style="color:var(--risk-low)">0</span>'}</td>
                                    <td>${col.unique_count}</td>
                                    <td>${col.min != null ? col.min : '—'}</td>
                                    <td>${col.max != null ? col.max : '—'}</td>
                                    <td>${col.mean != null ? Number(col.mean).toFixed(2) : '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Data Preview -->
            <div class="section-card glass-card fade-in">
                <div class="section-header">
                    <h2>Data Preview</h2>
                    <span class="badge badge-pending">First ${Math.min(data.length, 50)} rows</span>
                </div>
                <div class="table-wrap">
                    <table class="data-table" id="data-preview-table">
                        <thead>
                            <tr>${columns.map(c => `<th>${this.escapeHtml(c.name)}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${data.slice(0, 50).map(row => `
                                <tr>${columns.map(c => `<td>${row[c.name] != null ? this.escapeHtml(String(row[c.name])) : '<span style="opacity:0.3">null</span>'}</td>`).join('')}</tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    backToList() {
        const detail = document.getElementById('dataset-detail');
        const list = document.getElementById('dataset-list-section');
        if (detail) detail.style.display = 'none';
        if (list) list.style.display = '';
    },

    openChat(datasetId) {
        window.location.hash = `#/chat?dataset=${datasetId}`;
    },

    openVisualize(datasetId) {
        window.location.hash = `#/visualize?dataset=${datasetId}`;
    },

    async deleteDataset(id, event) {
        if (event) event.stopPropagation();
        if (!confirm('Delete this dataset and all associated chat history?')) return;
        try {
            await API.deleteDataset(id);
            Toast.show('Dataset deleted', 'success');
            await this.load();
        } catch (error) {
            Toast.show('Failed to delete dataset', 'error');
        }
    },

    formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let size = bytes;
        while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
        return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
    },

    formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now - d) / 60000);
        if (diff < 1) return 'Just now';
        if (diff < 60) return `${diff}m ago`;
        if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
        return d.toLocaleDateString();
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },
};

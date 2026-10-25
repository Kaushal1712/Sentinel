// Audit Log Module
async function loadAuditLogs(page = 1) {
    try {
        const resp = await req(`/api/audit?page=${page}&limit=50`);
        const container = document.getElementById('audit-container');

        let html = `
            <table class="data-table">
                <thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th>Details</th></tr></thead>
                <tbody>
        `;

        if (resp.logs.length === 0) {
            html += '<tr class="empty-row"><td colspan="6">No audit logs found.</td></tr>';
        } else {
            resp.logs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString();
                const userName = log.user ? log.user.name : 'System';
                const roleBadge = log.user?.role === 'admin' ? '<span class="badge badge-high">Admin</span>' : '';
                const details = log.details ? JSON.stringify(log.details) : '-';

                html += `
                    <tr>
                        <td class="text-mono text-sm" style="white-space:nowrap">${date}</td>
                        <td><strong>${userName}</strong> ${roleBadge}</td>
                        <td><span class="badge badge-quick">${log.action}</span></td>
                        <td>${log.target || '-'}</td>
                        <td class="text-mono text-sm text-muted">${log.ip_address || '-'}</td>
                        <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title='${details}'>${details}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table>';

        // Pagination
        if (resp.pages > 1) {
            html += `<div style="margin-top:16px; display:flex; gap:8px;">`;
            if (page > 1) html += `<button class="btn btn-sm btn-secondary" onclick="loadAuditLogs(${page-1})">Previous</button>`;
            html += `<span style="padding:4px 8px; color:var(--text-secondary)">Page ${resp.current_page} of ${resp.pages}</span>`;
            if (page < resp.pages) html += `<button class="btn btn-sm btn-secondary" onclick="loadAuditLogs(${page+1})">Next</button>`;
            html += `</div>`;
        }

        container.innerHTML = html;
    } catch (e) {
        console.error("Failed to load audit logs", e);
        document.getElementById('audit-container').innerHTML = '<div class="alert alert-error">Failed to load audit logs. Administrator privileges may be required.</div>';
    }
}

window.exportAuditLog = function() {
    window.location.href = '/api/audit/export';
};

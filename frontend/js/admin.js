// Premium Admin Panel Module with Animations

async function loadAdminPanel() {
    try {
        const stats = await req('/api/admin/stats');
        const container = document.getElementById('admin-container');

        const isHealthy = stats.system_health === 'ok';

        let html = `
            <div class="stats-grid">
                <div class="stat-card glass-card shine-effect">
                    <div class="stat-icon stat-icon-blue">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <div>
                        <span class="stat-value counter-animate" id="admin-stat-users">${stats.total_users || 0}</span>
                        <span class="stat-label">Total Analysts</span>
                    </div>
                </div>
                <div class="stat-card glass-card shine-effect">
                    <div class="stat-icon stat-icon-purple">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m21 21-4.3-4.3"/></svg>
                    </div>
                    <div>
                        <span class="stat-value counter-animate" id="admin-stat-scans">${stats.total_scans || 0}</span>
                        <span class="stat-label">System Scans Executed</span>
                    </div>
                </div>
                <div class="stat-card glass-card shine-effect" style="border-left: 4px solid ${isHealthy ? 'var(--accent-green)' : 'var(--accent-red)'}">
                    <div class="stat-icon ${isHealthy ? 'stat-icon-green' : 'stat-icon-red'}">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    </div>
                    <div>
                        <span class="stat-value" id="admin-stat-system" style="color: ${isHealthy ? 'var(--accent-green)' : 'var(--accent-red)'}">
                            ${isHealthy ? 'Operational' : 'Degraded'}
                        </span>
                        <span class="stat-label">Core Stability</span>
                    </div>
                </div>
            </div>

            <div class="card glass-card mt-16 admin-users-card">
                <div class="section-header">
                    <h2>Organization Identity Management</h2>
                    <button class="btn btn-secondary" onclick="loadAdminUsers()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                        Refresh Users
                    </button>
                </div>
                <div class="table-wrap">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Personnel Name</th>
                                <th>Email Identity</th>
                                <th>Access Role</th>
                                <th>Last Security Event</th>
                                <th>Quota Limits</th>
                                <th style="text-align: right;">Admin Functions</th>
                            </tr>
                        </thead>
                        <tbody id="admin-users-tbody">
                            <tr><td colspan="6" class="text-center text-muted"><div class="spinner"></div> Authenticating roles...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = html;
        loadAdminUsers();

    } catch (e) {
        console.error("Failed to load admin stats", e);
        document.getElementById('admin-container').innerHTML = `
            <div class="alert alert-error">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <strong>Security Fault:</strong> Failed to fetch administration node. You require elevated Administrator privileges.
            </div>`;
    }
}

async function loadAdminUsers() {
    try {
        const users = await req('/api/admin/users');
        const tbody = document.getElementById('admin-users-tbody');

        if (!users || users.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No personnel registered</td></tr>';
            return;
        }

        let html = '';
        users.forEach(u => {
            const isAdmin = u.role === 'admin';
            const roleBadgeClass = isAdmin ? 'badge-high' : 'badge-quick';
            const roleTooltip = isAdmin ? 'Click to demote to Analyst' : 'Click to promote to Admin';

            html += `
                <tr class="user-row-hover">
                    <td>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div class="user-avatar-small">${u.name ? u.name.charAt(0).toUpperCase() : 'U'}</div>
                            <strong>${u.name || 'Anonymous'}</strong>
                        </div>
                    </td>
                    <td style="color: var(--text-secondary);">${u.email}</td>
                    <td>
                        <span class="badge ${roleBadgeClass}" onclick="updateRole(${u.id}, '${isAdmin ? 'analyst' : 'admin'}')" style="cursor:pointer; transition: all 0.2s ease;" title="${roleTooltip}">
                            ${u.role.toUpperCase()}
                        </span>
                    </td>
                    <td><span class="timestamp-pill">${u.last_login ? new Date(u.last_login).toLocaleString() : 'No Activity'}</span></td>
                    <td>
                        <div class="quota-input-wrapper">
                            <input type="number" min="0" value="${u.max_scans_per_day || 10}"
                                   class="text-center bg-input border border-secondary text-primary radius-sm quota-input"
                                   onchange="updateQuota(${u.id}, this.value)">
                            <span class="quota-unit">/ day</span>
                        </div>
                    </td>
                    <td style="text-align: right;">
                        <button class="btn btn-sm btn-danger-outline" onclick="deleteUser(${u.id})" title="Purge user identity">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

    } catch (e) {
        console.error("Failed to load users", e);
        document.getElementById('admin-users-tbody').innerHTML = '<tr class="error-row"><td colspan="6">Error downloading Active Directory</td></tr>';
    }
}

window.updateRole = async function(id, newRole) {
    if (!confirm(`Warning: You are transferring the Security Level to ${newRole.toUpperCase()} for User ID: ${id}. Proceed?`)) return;
    try {
        await req(`/api/admin/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: newRole })
        });
        Toast.show("Privilege escalation succeeded.", "success");
        loadAdminUsers();
    } catch (e) {
        Toast.show("Failed to assign role", "error");
    }
};

window.updateQuota = async function(id, maxScans) {
    try {
        await req(`/api/admin/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ max_scans_per_day: parseInt(maxScans) })
        });
        Toast.show("Quota limits redefined.", "success");
    } catch (e) {
        Toast.show("Failed to commit quota changes", "error");
    }
};

window.deleteUser = async function(id) {
    if (!confirm("CRITICAL: Purging this ID will destroy all associated audit logs and risk footprints forever. Continue?")) return;
    try {
        await req(`/api/admin/users/${id}`, { method: 'DELETE' });
        Toast.show("User purged from registry.", "success");
        loadAdminUsers();
    } catch (e) {
        Toast.show("Authorization failed for deletion", "error");
    }
};

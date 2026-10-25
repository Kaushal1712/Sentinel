// Premium Scheduled Scans Module with Glassmorphism UI

async function loadSchedules() {
    try {
        const resp = await req('/api/schedule/');
        const schedules = resp.schedules || resp; // Depending on if it's returning {"schedules": [...]} or just array
        const container = document.getElementById('schedules-container');

        if (!schedules || schedules.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
                    <h3>No automated schedules</h3>
                    <p>You haven't set up any recurring scans yet. Let the platform monitor targets dynamically.</p>
                </div>
            `;
            return;
        }

        let html = '<div class="schedule-grid">';

        schedules.forEach(s => {
            const nextRunDate = s.next_run ? new Date(s.next_run) : null;
            const nextRunFormatted = nextRunDate ? nextRunDate.toLocaleString() : 'Pending calculation...';
            const isDue = nextRunDate && nextRunDate < new Date();
            const statusClass = s.active ? 'active-pulse' : 'paused-fade';
            const toggleIcon = s.active ?
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' :
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

            html += `
                <div class="schedule-card glass-card ${statusClass}">
                    <div class="schedule-header">
                        <div class="schedule-target">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                            <h3>${s.target_username}</h3>
                        </div>
                        <div class="schedule-badge ${s.active ? 'badge-success' : 'badge-neutral'}">
                            ${s.active ? 'Monitoring' : 'Paused'}
                        </div>
                    </div>

                    <div class="schedule-details">
                        <div class="detail-row">
                            <span class="detail-label">Frequency:</span>
                            <span class="detail-value highlight-text" style="text-transform: capitalize;">${s.frequency}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Next Run:</span>
                            <span class="detail-value ${isDue ? 'text-warning' : ''}">${nextRunFormatted}</span>
                        </div>
                    </div>

                    <div class="schedule-actions">
                        <button class="btn btn-icon-text ${s.active ? 'btn-secondary' : 'btn-primary'}" onclick="toggleSchedule(${s.id})">
                            ${toggleIcon} ${s.active ? 'Pause' : 'Resume'}
                        </button>
                        <button class="btn btn-icon-text btn-danger-outline" onclick="deleteSchedule(${s.id})">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            Delete
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        console.error("Failed to load schedules", e);
        document.getElementById('schedules-container').innerHTML = '<div class="alert alert-error">Failed to connect to scheduling service.</div>';
    }
}

window.promptCreateSchedule = function() {
    const target = prompt("Enter target Username or domain to monitor continuously:");
    if (!target) return;

    // Default to weekly
    const freqOpts = ["daily", "weekly", "monthly"];
    let freq = prompt(`Enter frequency (daily, weekly, monthly):`, "weekly");
    if (!freq) return;
    freq = freq.toLowerCase().trim();
    if (!freqOpts.includes(freq)) {
        Toast.show("Invalid frequency", "error");
        return;
    }

    req('/api/schedule/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target_username: target,
            frequency: freq
        })
    }).then(() => {
        Toast.show("Continuous monitoring scheduled!", "success");
        loadSchedules();
    }).catch(e => {
        Toast.show("Failed to create schedule metadata", "error");
        console.error(e);
    });
};

window.toggleSchedule = async function(id) {
    try {
        await req(`/api/schedule/${id}/toggle`, {
            method: 'POST'
        });
        Toast.show("Schedule state toggled successfully", "success");
        loadSchedules();
    } catch (e) {
        Toast.show("Failed to modify schedule state", "error");
        console.error(e);
    }
};

window.deleteSchedule = async function(id) {
    if (!confirm("Are you certain you want to delete this monitoring schedule? All future executions will be stopped immediately.")) return;

    try {
        await req(`/api/schedule/${id}`, { method: 'DELETE' });
        Toast.show("Monitoring schedule deleted.", "success");
        loadSchedules();
    } catch (e) {
        Toast.show("Failed to delete schedule", "error");
        console.error(e);
    }
};

// Auto refresh on load
document.addEventListener("DOMContentLoaded", () => {
    // If the hash implies jumping straight to schedules, we load it
    // Note: app.js handlePageSwitch already calls loadSchedules if it jumps there.
});

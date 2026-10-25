// Settings Module

async function loadSettings() {
    try {
        const user = await req('/api/auth/me');
        const container = document.getElementById('settings-container');

        let html = `
            <div class="scan-layout">
                <!-- User Profile -->
                <div class="card glass-card">
                    <div class="section-header"><h2>Profile Settings</h2></div>
                    <form id="settings-profile-form">
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="setting-name" value="${user.name}" required>
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" value="${user.email}" disabled style="opacity:0.7">
                        </div>
                         <div class="form-group">
                            <label>Role</label>
                            <input type="text" value="${user.role.toUpperCase()}" disabled style="opacity:0.7; font-weight:bold; color:var(--accent-purple)">
                        </div>
                        <button type="button" class="btn btn-primary" onclick="alert('Profile update endpoint required.')">Save Profile</button>
                    </form>
                </div>

                <!-- Webhooks -->
                <div class="card glass-card">
                    <div class="section-header">
                        <h2>Webhooks Integrations</h2>
                        <button class="btn btn-sm btn-secondary" onclick="createWebhook()">+ Add Webhook</button>
                    </div>
                    <p style="font-size:0.85rem; color:var(--text-tertiary); margin-bottom:12px;">Send DFAS alerts to Slack, Discord, or generic endpoints.</p>
                    <div id="settings-webhooks">Loading webhooks...</div>
                </div>
            </div>

            <div class="scan-layout mt-16">
                 <!-- 2FA Settings -->
                <div class="card glass-card" style="border-color: rgba(239,68,68,0.3)">
                    <div class="section-header"><h2>Two-Factor Authentication</h2></div>
                    <p style="font-size:0.85rem; color:var(--text-tertiary); margin-bottom:12px;">Add an extra layer of security to your account.</p>
                    <div id="settings-2fa">
                        <button id="btn-setup-2fa" class="btn btn-primary" style="background:var(--accent-blue)">Set Up 2FA</button>
                    </div>
                </div>
            </div>

        `;

        container.innerHTML = html;
        loadWebhooks();

        document.getElementById('btn-setup-2fa').onclick = async () => {
            try {
                const resp = await req('/api/auth/2fa/setup', {method: 'POST'});
                const modalHtml = `
                    <div style="text-align:center;">
                        <p>Scan this QR code with your Authenticator app:</p>
                        <div id="qr-container" style="background:white; padding:16px; display:inline-block; border-radius:8px; margin:16px 0;"></div>
                        <p class="text-mono" style="margin-bottom:16px; color:var(--accent-blue)">${resp.secret}</p>
                        <div class="form-group" style="text-align:left;">
                            <label>Verify Code</label>
                            <input type="text" id="verify-2fa-token" placeholder="000000" maxlength="6">
                        </div>
                        <button class="btn btn-primary btn-full" onclick="verify2FASetup()">Verify & Enable</button>
                    </div>
                `;
                document.getElementById('report-modal-body').innerHTML = modalHtml;
                document.getElementById('report-modal').style.display = 'flex';

                new QRCode(document.getElementById("qr-container"), {
                    text: resp.uri, width: 200, height: 200,
                    colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H
                });
            } catch (e) {
                Toast.show("Failed to initiate 2FA setup", "error");
            }
        };

    } catch (e) {
        console.error("Failed to load settings", e);
        document.getElementById('settings-container').innerHTML = '<div class="alert alert-error">Failed to load settings.</div>';
    }
}

async function loadWebhooks() {
    try {
        const resp = await req('/api/webhooks');
        const container = document.getElementById('settings-webhooks');

        if (resp.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No webhooks configured.</div>';
            return;
        }

        let html = '<div class="scan-list">';
        resp.forEach(wh => {
            html += `
                <div class="scan-list-item" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span class="scan-item-name">${wh.name}</span>
                        <span class="scan-item-date">${wh.url}</span>
                    </div>
                    <button class="btn btn-sm" onclick="deleteWebhook(${wh.id})" style="color:var(--accent-red);border-color:var(--accent-red)">Delete</button>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        document.getElementById('settings-webhooks').innerHTML = '<span class="text-muted">Error loading webhooks</span>';
    }
}

window.createWebhook = async function() {
    const name = prompt("Webhook Name (e.g., Slack Alerts):");
    if (!name) return;
    const url = prompt("Webhook URL (https://...):");
    if (!url) return;

    try {
        const secret = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
        await req('/api/webhooks', {
            method: 'POST',
            body: JSON.stringify({ name, url, secret })
        });
        Toast.show("Webhook added successfully", "success");
        loadWebhooks();
    } catch (e) {
        Toast.show("Failed to add webhook", "error");
    }
};

window.deleteWebhook = async function(id) {
    if (!confirm("Delete this webhook?")) return;
    try {
        await req(`/api/webhooks/${id}`, { method: 'DELETE' });
        Toast.show("Webhook deleted", "success");
        loadWebhooks();
    } catch (e) {
        Toast.show("Failed to delete webhook", "error");
    }
};

window.verify2FASetup = async function() {
    const token = document.getElementById('verify-2fa-token').value;
    if (!token) return;
    try {
        await req('/api/auth/2fa/verify', {
            method: 'POST',
            body: JSON.stringify({ token })
        });
        Toast.show("2FA successfully enabled!", "success");
        document.getElementById('report-modal').style.display = 'none';
        document.getElementById('btn-setup-2fa').innerText = "2FA Enabled";
        document.getElementById('btn-setup-2fa').disabled = true;
    } catch (e) {
        Toast.show("Invalid 2FA token", "error");
    }
};

/**
 * Scanner Module - Scan form, mode selection, and live progress tracking.
 */
const Scanner = {
    initialized: false,
    currentScanId: null,
    pollInterval: null,

    init() {
        this.prefillOwnedIdentity();
        this.reset();

        if (this.initialized) {
            return;
        }

        this.bindEvents();
        this.initialized = true;
    },

    bindEvents() {
        const form = document.getElementById('scan-form');
        if (form) {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                this.startScan();
            });
        }

        const modeInputs = document.querySelectorAll('input[name="scan-mode"]');
        modeInputs.forEach((input) => {
            input.addEventListener('change', () => {
                document.querySelectorAll('.mode-option').forEach((option) => option.classList.remove('mode-selected'));
                input.closest('.mode-option').classList.add('mode-selected');
            });
        });
    },

    isPlaceholderEmail(email) {
        return (email || '').trim().toLowerCase().endsWith('@digilocker.gov.in');
    },

    clearError() {
        const errorEl = document.getElementById('scan-error');
        if (errorEl) {
            errorEl.textContent = '';
        }
    },

    showError(message) {
        const errorEl = document.getElementById('scan-error');
        if (errorEl) {
            errorEl.textContent = message;
        }

        if (typeof Toast !== 'undefined') {
            Toast.show(message, 'error');
        } else {
            alert(message);
        }
    },

    prefillOwnedIdentity() {
        const user = API.getUser();
        const nameInput = document.getElementById('scan-name');
        const emailInput = document.getElementById('scan-email');
        const identityNotice = document.getElementById('scan-policy-identity');

        if (!nameInput || !emailInput) {
            return;
        }

        const trustedName = user?.full_name || '';
        const trustedEmail = user?.email || '';
        const hasUsableEmail = trustedEmail && !this.isPlaceholderEmail(trustedEmail);

        nameInput.value = trustedName;
        nameInput.readOnly = true;

        emailInput.value = hasUsableEmail ? trustedEmail : '';
        emailInput.readOnly = true;
        emailInput.placeholder = hasUsableEmail
            ? 'Locked to your account email'
            : 'No verified account email is available for scanning';

        if (identityNotice) {
            const identityBits = [trustedName || 'your signed-in account'];
            if (hasUsableEmail) {
                identityBits.push(trustedEmail);
            }
            identityNotice.textContent = `This scan is locked to ${identityBits.join(' | ')}. Optional username and phone fields must also belong to you.`;
        }
    },

    async startScan() {
        this.clearError();

        const user = API.getUser();
        const name = document.getElementById('scan-name').value.trim();
        const email = document.getElementById('scan-email').value.trim();
        const username = document.getElementById('scan-username').value.trim();
        const phone = document.getElementById('scan-phone').value.trim();
        const mode = document.querySelector('input[name="scan-mode"]:checked').value;
        const selfAttested = document.getElementById('scan-self-attested').checked;
        const trustedName = user?.full_name?.trim() || '';
        const trustedEmail = user?.email?.trim() || '';

        if (!trustedName) {
            this.showError('Your account is missing a profile name. Please update your account before scanning.');
            return;
        }

        if (name !== trustedName) {
            this.showError('The scan identity is locked to your signed-in profile. You cannot scan another person.');
            return;
        }

        if (email && trustedEmail && email.toLowerCase() !== trustedEmail.toLowerCase()) {
            this.showError('The scan email is locked to your signed-in account. You cannot scan another person.');
            return;
        }

        if (!selfAttested) {
            this.showError('Confirm the self-scan checkbox before starting. Scanning other people is blocked.');
            return;
        }

        const btn = document.getElementById('btn-start-scan');
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Starting...';

        try {
            const scanData = {
                name: trustedName,
                self_attested: true,
            };

            if (trustedEmail && !this.isPlaceholderEmail(trustedEmail)) {
                scanData.email = trustedEmail;
            }
            if (username) scanData.username = username;
            if (phone) scanData.phone = phone;

            const data = mode === 'full'
                ? await API.startFullScan(scanData)
                : await API.startQuickScan(scanData);

            this.currentScanId = data.scan.id;
            this.showProgress();
            this.startPolling();
        } catch (error) {
            this.showError(error.error || 'Failed to start scan.');
        } finally {
            btn.disabled = false;
            btn.querySelector('span').textContent = 'Start Investigation';
        }
    },

    showProgress() {
        const card = document.getElementById('scan-progress-card');
        if (card) {
            card.style.display = 'block';
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    startPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);

        this.pollInterval = setInterval(async () => {
            try {
                const data = await API.getScanStatus(this.currentScanId);
                this.updateProgress(data.scan);

                if (data.scan.status === 'completed' || data.scan.status === 'failed') {
                    clearInterval(this.pollInterval);
                    this.pollInterval = null;

                    if (data.scan.status === 'completed') {
                        setTimeout(() => {
                            window.location.hash = `#/results?id=${this.currentScanId}`;
                        }, 1500);
                    }
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 1500);
    },

    updateProgress(scan) {
        const bar = document.getElementById('scan-progress-bar');
        if (bar) bar.style.width = `${scan.progress}%`;

        const text = document.getElementById('scan-progress-text');
        if (text) text.textContent = scan.current_stage || 'Processing...';

        const stages = document.querySelectorAll('.stage');
        const stageMap = {
            'Queued in background worker': 0,
            'Queued locally': 0,
            'Normalizing identity': 0,
            'Running discovery': 1,
            'Processing discovered profiles': 1,
            'Scraping discovered pages': 2,
            'Extracting entities': 3,
            'Building identity graph': 4,
            'Generating risk report': 5,
            'Scan complete': 5,
        };

        const currentStageIndex = stageMap[scan.current_stage] ?? -1;
        stages.forEach((stage, index) => {
            stage.classList.remove('active', 'completed');
            if (index < currentStageIndex) {
                stage.classList.add('completed');
            } else if (index === currentStageIndex) {
                stage.classList.add('active');
            }
        });

        if (scan.status === 'completed') {
            stages.forEach((stage) => {
                stage.classList.remove('active');
                stage.classList.add('completed');
            });
        }

        if (scan.platforms_found > 0) {
            const liveResults = document.getElementById('scan-live-results');
            if (liveResults && !liveResults.querySelector(`[data-count="${scan.platforms_found}"]`)) {
                const item = document.createElement('div');
                item.className = 'live-result-item';
                item.dataset.count = scan.platforms_found;
                item.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                    <span>${scan.platforms_found} platform(s) discovered</span>
                `;
                liveResults.appendChild(item);
            }
        }
    },

    reset() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.currentScanId = null;

        const card = document.getElementById('scan-progress-card');
        if (card) card.style.display = 'none';

        const bar = document.getElementById('scan-progress-bar');
        if (bar) bar.style.width = '0%';

        const text = document.getElementById('scan-progress-text');
        if (text) text.textContent = 'Waiting to start...';

        const liveResults = document.getElementById('scan-live-results');
        if (liveResults) liveResults.innerHTML = '';

        const usernameInput = document.getElementById('scan-username');
        if (usernameInput) usernameInput.value = '';

        const phoneInput = document.getElementById('scan-phone');
        if (phoneInput) phoneInput.value = '';

        const selfAttested = document.getElementById('scan-self-attested');
        if (selfAttested) selfAttested.checked = false;

        this.clearError();
        this.prefillOwnedIdentity();

        document.querySelectorAll('.stage').forEach((stage) => stage.classList.remove('active', 'completed'));
    },
};

/* ==========================================================
   ADMIN CONTROLLER & MODALS
   Lineage 2 Boss Tracker
   ========================================================== */

const AdminController = {
    token: localStorage.getItem('adminToken') || '',
    isAdmin: false,

    init() {
        if (this.token) {
            this.checkAuth();
        }
    },

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
            headers['x-admin-token'] = this.token;
        }
        return headers;
    },

    async checkAuth() {
        try {
            const res = await fetch('/api/auth/me', { headers: this.getHeaders() });
            const data = await res.json();
            this.isAdmin = data.role === 'admin';
            this.updateAdminUI();
        } catch (e) {
            this.isAdmin = false;
            this.updateAdminUI();
        }
    },

    updateAdminUI() {
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(el => {
            el.style.display = this.isAdmin ? '' : 'none';
        });

        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            if (this.isAdmin) {
                authBtn.innerHTML = '🛡️ Admin (Logout)';
                authBtn.classList.remove('btn-primary');
                authBtn.classList.add('btn-emerald');
            } else {
                authBtn.innerHTML = '🔒 Login / Unlock';
                authBtn.classList.add('btn-primary');
                authBtn.classList.remove('btn-emerald');
            }
        }
    },

    async login(username, password) {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success && data.token) {
                this.token = data.token;
                this.isAdmin = true;
                localStorage.setItem('adminToken', this.token);
                this.updateAdminUI();
                App.showToast('Logged in as Administrator!', 'emerald');
                this.closeModal('login-modal');
                return true;
            } else {
                App.showToast(data.message || 'Login failed', 'rose');
                return false;
            }
        } catch (e) {
            App.showToast('Network error during login', 'rose');
            return false;
        }
    },

    async unlockWithPin(pin) {
        try {
            const res = await fetch('/api/auth/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            const data = await res.json();
            if (data.success && data.token) {
                this.token = data.token;
                this.isAdmin = true;
                localStorage.setItem('adminToken', this.token);
                this.updateAdminUI();
                App.showToast('Unlocked Admin Mode!', 'emerald');
                this.closeModal('login-modal');
                return true;
            } else {
                App.showToast(data.message || 'Invalid PIN code', 'rose');
                return false;
            }
        } catch (e) {
            App.showToast('Network error during PIN unlock', 'rose');
            return false;
        }
    },

    logout() {
        this.token = '';
        this.isAdmin = false;
        localStorage.removeItem('adminToken');
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        this.updateAdminUI();
        App.showToast('Logged out to Guest Mode', 'amber');
    },

    openModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.add('active');
    },

    closeModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.remove('active');
    },

    // Record Kill/Spawn Modal
    openRecordModal(bossId) {
        const boss = App.getBossById(bossId);
        if (!boss) return;

        document.getElementById('record-boss-id').value = boss.id;
        document.getElementById('record-boss-name').textContent = `${boss.is_invasion ? '⚡ ' : ''}${boss.name}`;
        
        // Default to current local time in datetime-local format
        const now = new Date();
        const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('record-kill-time').value = localIso;
        document.getElementById('record-spawn-time').value = localIso;

        this.setRecordTab('kill');
        this.openModal('record-modal');
    },

    setRecordTab(mode) {
        const tabKill = document.getElementById('record-tab-kill');
        const tabSpawn = document.getElementById('record-tab-spawn');
        const groupKill = document.getElementById('record-group-kill');
        const groupSpawn = document.getElementById('record-group-spawn');
        const submitBtn = document.getElementById('record-submit-btn');

        if (mode === 'kill') {
            tabKill.classList.add('active');
            tabSpawn.classList.remove('active');
            groupKill.style.display = '';
            groupSpawn.style.display = 'none';
            submitBtn.textContent = 'Save Kill Time (Auto calculate next)';
            submitBtn.dataset.mode = 'kill';
        } else {
            tabKill.classList.remove('active');
            tabSpawn.classList.add('active');
            groupKill.style.display = 'none';
            groupSpawn.style.display = '';
            submitBtn.textContent = 'Save Next Spawn Time';
            submitBtn.dataset.mode = 'spawn';
        }
    },

    async submitRecordTime() {
        const bossId = document.getElementById('record-boss-id').value;
        const submitBtn = document.getElementById('record-submit-btn');
        const mode = submitBtn.dataset.mode || 'kill';
        const timeInput = mode === 'kill' 
            ? document.getElementById('record-kill-time').value 
            : document.getElementById('record-spawn-time').value;

        if (!timeInput) {
            App.showToast('Please select a date and time', 'amber');
            return;
        }

        const dateObj = new Date(timeInput);
        if (isNaN(dateObj.getTime())) {
            App.showToast('Invalid date format', 'rose');
            return;
        }

        try {
            const res = await fetch(`/api/bosses/${bossId}/kill`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    mode: mode,
                    time: dateObj.toISOString(),
                    reporter: localStorage.getItem('dashboard.nickname') || 'Admin'
                })
            });
            const data = await res.json();
            if (data.success) {
                App.showToast(`Updated ${data.boss.name}!`, 'emerald');
                this.closeModal('record-modal');
                App.refreshBoss(data.boss);
            }
        } catch (e) {
            App.showToast('Failed to record time', 'rose');
        }
    },

    // Maintenance Modal
    openMaintenanceModal() {
        const input = document.getElementById('maintenance-end-time');
        const now = new Date();
        const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        input.value = localIso;

        // Render Reset Configs Table
        this.renderResetConfigsTable();
        this.openModal('maintenance-modal');
    },

    renderResetConfigsTable() {
        const tbody = document.getElementById('reset-configs-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const configs = App.state.resetTimeConfigs || {};
        const bossNames = Object.keys(configs).sort();

        bossNames.forEach(name => {
            const conf = configs[name];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 6px 10px; font-weight: 600;">${name}</td>
                <td style="padding: 6px 10px;">
                    <input type="number" min="0" max="72" value="${conf.hours || 0}" 
                        class="form-input btn-sm config-hours" data-boss="${name}" style="width: 60px; display: inline-block;"> h
                    <input type="number" min="0" max="59" value="${conf.minutes || 0}" 
                        class="form-input btn-sm config-minutes" data-boss="${name}" style="width: 60px; display: inline-block;"> m
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    async applyMaintenance() {
        const timeInput = document.getElementById('maintenance-end-time').value;
        if (!timeInput) {
            App.showToast('Please specify maintenance end time', 'amber');
            return;
        }

        const dateObj = new Date(timeInput);
        if (isNaN(dateObj.getTime())) {
            App.showToast('Invalid date format', 'rose');
            return;
        }

        if (!confirm(`Are you sure you want to apply reset spawn times from ${timeInput}? All configured bosses will be recalculated!`)) {
            return;
        }

        try {
            const res = await fetch('/api/maintenance/apply', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ maintenance_end_time: dateObj.toISOString() })
            });
            const data = await res.json();
            if (data.success) {
                App.showToast(`Applied maintenance times to ${data.appliedCount} bosses!`, 'emerald');
                this.closeModal('maintenance-modal');
                App.fetchAll();
            } else {
                App.showToast(data.error || 'Failed to apply maintenance', 'rose');
            }
        } catch (e) {
            App.showToast('Error applying maintenance', 'rose');
        }
    },

    async cancelMaintenance() {
        if (!confirm('Cancel maintenance mode for all bosses?')) return;
        try {
            await fetch('/api/maintenance/cancel', {
                method: 'POST',
                headers: this.getHeaders()
            });
            App.showToast('Maintenance mode cancelled', 'amber');
            this.closeModal('maintenance-modal');
            App.fetchAll();
        } catch (e) {
            App.showToast('Failed to cancel maintenance', 'rose');
        }
    },

    async saveEditedResetConfigs() {
        const configs = {};
        const hoursInputs = document.querySelectorAll('.config-hours');
        hoursInputs.forEach(input => {
            const name = input.dataset.boss;
            const minInput = document.querySelector(`.config-minutes[data-boss="${name}"]`);
            configs[name] = {
                hours: parseInt(input.value, 10) || 0,
                minutes: parseInt(minInput ? minInput.value : '0', 10) || 0
            };
        });

        try {
            const res = await fetch('/api/maintenance/save-configs', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ configs })
            });
            const data = await res.json();
            if (data.success) {
                App.state.resetTimeConfigs = data.configs;
                App.showToast('Saved reset configs!', 'emerald');
            }
        } catch (e) {
            App.showToast('Failed to save reset configs', 'rose');
        }
    },

    // Add / Edit Boss Modal
    openAddBossModal(bossId = null) {
        const titleEl = document.getElementById('boss-modal-title');
        const deleteBtn = document.getElementById('boss-delete-btn');
        const idInput = document.getElementById('edit-boss-id');

        if (bossId) {
            const boss = App.getBossById(bossId);
            if (!boss) return;
            titleEl.textContent = 'Edit Boss';
            idInput.value = boss.id;
            document.getElementById('boss-name-input').value = boss.name;
            document.getElementById('boss-location-input').value = boss.location || '';
            document.getElementById('boss-interval-input').value = boss.interval;
            document.getElementById('boss-chance-input').value = boss.chance_of_appearing || '100';
            document.getElementById('boss-invasion-input').checked = Boolean(boss.is_invasion);
            deleteBtn.style.display = '';
        } else {
            titleEl.textContent = 'Add New Boss';
            idInput.value = '';
            document.getElementById('boss-name-input').value = '';
            document.getElementById('boss-location-input').value = '';
            document.getElementById('boss-interval-input').value = '360';
            document.getElementById('boss-chance-input').value = '100';
            document.getElementById('boss-invasion-input').checked = false;
            deleteBtn.style.display = 'none';
        }

        this.openModal('boss-modal');
    },

    async saveBoss() {
        const id = document.getElementById('edit-boss-id').value;
        const name = document.getElementById('boss-name-input').value.trim();
        const location = document.getElementById('boss-location-input').value.trim();
        const interval = parseInt(document.getElementById('boss-interval-input').value, 10);
        const chance = document.getElementById('boss-chance-input').value.trim();
        const isInvasion = document.getElementById('boss-invasion-input').checked;

        if (!name) {
            App.showToast('Boss name is required', 'amber');
            return;
        }

        const payload = {
            name,
            location,
            interval: interval || 60,
            chance_of_appearing: chance || '100.00',
            is_invasion: isInvasion
        };

        try {
            const url = id ? `/api/bosses/${id}` : '/api/bosses';
            const method = id ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                App.showToast(id ? 'Boss updated!' : 'Boss added!', 'emerald');
                this.closeModal('boss-modal');
                App.fetchAll();
            } else {
                App.showToast(data.error || 'Failed to save boss', 'rose');
            }
        } catch (e) {
            App.showToast('Network error saving boss', 'rose');
        }
    },

    async deleteBoss() {
        const id = document.getElementById('edit-boss-id').value;
        if (!id) return;
        const boss = App.getBossById(id);
        if (!confirm(`Are you sure you want to delete ${boss ? boss.name : 'this boss'}?`)) return;

        try {
            const res = await fetch(`/api/bosses/${id}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                App.showToast('Boss deleted', 'amber');
                this.closeModal('boss-modal');
                App.removeBoss(id);
            }
        } catch (e) {
            App.showToast('Failed to delete boss', 'rose');
        }
    },

    // Settings Modal
    openSettingsModal() {
        const s = App.state.settings || {};
        document.getElementById('setting-server-name').value = s.serverName || '#Kain7';
        document.getElementById('setting-invasion-label').value = s.invasionLabel || '⚡Inv.';
        document.getElementById('setting-invasion-emoji').value = s.invasionEmoji || '⚡';
        document.getElementById('setting-invasion-color').value = s.invasionColor || '#c084fc';
        document.getElementById('setting-alert-mins').value = s.alertBeforeMinutes || 5;

        // Sound settings
        const soundSelect = document.getElementById('setting-alert-sound');
        soundSelect.value = soundManager.selectedAlertSound;
        const spawnSoundSelect = document.getElementById('setting-spawn-sound');
        spawnSoundSelect.value = soundManager.selectedSpawnSound;
        const volumeSlider = document.getElementById('setting-volume');
        volumeSlider.value = soundManager.volume;
        document.getElementById('volume-val').textContent = `${Math.round(soundManager.volume * 100)}%`;

        // Display settings
        document.getElementById('setting-swap-countdown').checked = localStorage.getItem('dashboard.swapCountdown') === 'true';
        document.getElementById('setting-show-location').checked = localStorage.getItem('dashboard.showLocation') !== 'false';
        document.getElementById('setting-show-chance').checked = localStorage.getItem('dashboard.showChance') !== 'false';

        // Opacity
        const opacitySlider = document.getElementById('setting-opacity');
        const currentOpacity = localStorage.getItem('dashboard.wrapperOpacity') || '1';
        opacitySlider.value = currentOpacity;
        document.getElementById('opacity-val').textContent = `${Math.round(parseFloat(currentOpacity) * 100)}%`;

        this.openModal('settings-modal');
    },

    async saveSettings() {
        const serverName = document.getElementById('setting-server-name').value;
        const invasionLabel = document.getElementById('setting-invasion-label').value;
        const invasionEmoji = document.getElementById('setting-invasion-emoji').value;
        const invasionColor = document.getElementById('setting-invasion-color').value;
        const alertMins = document.getElementById('setting-alert-mins').value;

        // Save local preferences
        const alertSound = document.getElementById('setting-alert-sound').value;
        const spawnSound = document.getElementById('setting-spawn-sound').value;
        soundManager.setAlertSound(alertSound);
        soundManager.setSpawnSound(spawnSound);
        soundManager.setAlertBeforeMinutes(alertMins);

        const swapCountdown = document.getElementById('setting-swap-countdown').checked;
        const showLocation = document.getElementById('setting-show-location').checked;
        const showChance = document.getElementById('setting-show-chance').checked;

        localStorage.setItem('dashboard.swapCountdown', swapCountdown ? 'true' : 'false');
        localStorage.setItem('dashboard.showLocation', showLocation ? 'true' : 'false');
        localStorage.setItem('dashboard.showChance', showChance ? 'true' : 'false');

        // Server settings if admin
        if (this.isAdmin) {
            try {
                await fetch('/api/settings', {
                    method: 'PUT',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        serverName,
                        invasionLabel,
                        invasionEmoji,
                        invasionColor,
                        alertBeforeMinutes: parseInt(alertMins, 10)
                    })
                });
            } catch (e) {}
        }

        App.showToast('Settings saved!', 'emerald');
        this.closeModal('settings-modal');
        App.render();
    },

    // Announcement
    async setAnnouncement() {
        const text = prompt('Enter announcement banner text (leave empty to clear):', App.state.settings.announcement || '');
        if (text === null) return;

        try {
            if (text.trim() === '') {
                await fetch('/api/settings/announcement/clear', {
                    method: 'POST',
                    headers: this.getHeaders()
                });
                App.setAnnouncement(null);
                App.showToast('Announcement cleared', 'amber');
            } else {
                await fetch('/api/settings/announcement', {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({ announcement: text.trim() })
                });
                App.setAnnouncement(text.trim());
                App.showToast('Announcement updated!', 'emerald');
            }
        } catch (e) {
            App.showToast('Failed to update announcement', 'rose');
        }
    }
};

window.AdminController = AdminController;

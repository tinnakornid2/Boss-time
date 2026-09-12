/* ==========================================================
   MAIN APPLICATION LOGIC & REAL-TIME WEBSOCKET
   Lineage 2 Boss Tracker
   ========================================================== */

const App = {
    state: {
        bosses: [],
        events: [],
        resetTimeConfigs: {},
        settings: {},
        activeTab: 'all',
        searchQuery: '',
        wsConnected: false
    },

    ws: null,
    timerInterval: null,

    async init() {
        console.log('⚔️ Initializing Boss Tracker App...');
        
        // Check Admin state
        AdminController.init();

        // Restore window opacity
        const savedOpacity = localStorage.getItem('dashboard.wrapperOpacity');
        if (savedOpacity) {
            document.body.style.opacity = savedOpacity;
        }

        // Setup Event Listeners
        this.bindEvents();

        // Initial Data Fetch
        await this.fetchAll();

        // Connect WebSocket for real-time sync
        this.connectWebSocket();

        // Start 1-second render & countdown ticker
        this.startTicker();
    },

    bindEvents() {
        // Search filter
        const searchInput = document.getElementById('search-input');
        const clearBtn = document.getElementById('search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.state.searchQuery = e.target.value.trim().toLowerCase();
                clearBtn.style.display = this.state.searchQuery ? 'block' : 'none';
                this.render();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.state.searchQuery = '';
                clearBtn.style.display = 'none';
                this.render();
            });
        }

        // Tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.activeTab = btn.dataset.tab;
                this.render();
            });
        });

        // Auth / Unlock button
        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            authBtn.addEventListener('click', () => {
                if (AdminController.isAdmin) {
                    AdminController.logout();
                } else {
                    AdminController.openModal('login-modal');
                }
            });
        }

        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                AdminController.openSettingsModal();
            });
        }

        // Maintenance button
        const maintBtn = document.getElementById('maint-btn');
        if (maintBtn) {
            maintBtn.addEventListener('click', () => {
                AdminController.openMaintenanceModal();
            });
        }

        // Add Boss button
        const addBossBtn = document.getElementById('add-boss-btn');
        if (addBossBtn) {
            addBossBtn.addEventListener('click', () => {
                AdminController.openAddBossModal();
            });
        }

        // Announcement banner click (admin edit)
        const banner = document.getElementById('announcement-banner');
        if (banner) {
            banner.addEventListener('click', () => {
                if (AdminController.isAdmin) {
                    AdminController.setAnnouncement();
                }
            });
        }

        // Volume and Opacity live sliders in Settings modal
        const volSlider = document.getElementById('setting-volume');
        if (volSlider) {
            volSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                document.getElementById('volume-val').textContent = `${Math.round(val * 100)}%`;
                soundManager.setVolume(val);
            });
        }

        const opacitySlider = document.getElementById('setting-opacity');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const val = e.target.value;
                document.getElementById('opacity-val').textContent = `${Math.round(val * 100)}%`;
                document.body.style.opacity = val;
                localStorage.setItem('dashboard.wrapperOpacity', val);
            });
        }

        // Sound preview buttons
        const previewAlertBtn = document.getElementById('btn-preview-alert');
        if (previewAlertBtn) {
            previewAlertBtn.addEventListener('click', () => {
                const sound = document.getElementById('setting-alert-sound').value;
                soundManager.preview(sound);
            });
        }

        const previewSpawnBtn = document.getElementById('btn-preview-spawn');
        if (previewSpawnBtn) {
            previewSpawnBtn.addEventListener('click', () => {
                const sound = document.getElementById('setting-spawn-sound').value;
                soundManager.preview(sound);
            });
        }

        // Modal backdrop click to close
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Request notification permission on first user interaction
        document.addEventListener('click', () => {
            soundManager.requestNotificationPermission();
        }, { once: true });
    },

    async fetchAll() {
        try {
            const res = await fetch('/api/bosses');
            const data = await res.json();
            this.state.bosses = data.bosses || [];
            this.state.events = data.events || [];
            this.state.resetTimeConfigs = data.resetTimeConfigs || {};
            this.state.settings = data.settings || {};

            this.updateBrand();
            this.updateAnnouncement();
            this.render();
        } catch (e) {
            console.error('Failed to fetch initial boss data:', e);
            this.showToast('Failed to connect to server', 'rose');
        }
    },

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('⚡ WebSocket connected to server');
                this.state.wsConnected = true;
                this.updateConnectionStatus(true);
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleSocketMessage(msg);
                } catch (e) {
                    console.error('Socket message parse error:', e);
                }
            };

            this.ws.onclose = () => {
                console.warn('WebSocket disconnected. Reconnecting in 3s...');
                this.state.wsConnected = false;
                this.updateConnectionStatus(false);
                setTimeout(() => this.connectWebSocket(), 3000);
            };

            this.ws.onerror = () => {
                this.ws.close();
            };
        } catch (e) {
            console.error('WebSocket connection error:', e);
            setTimeout(() => this.connectWebSocket(), 5000);
        }
    },

    handleSocketMessage(msg) {
        const { event, data } = msg;
        console.log(`[WS Event] ${event}:`, data);

        switch (event) {
            case 'boss:killed':
            case 'boss:updated':
                this.refreshBoss(data);
                this.showToast(`Updated: ${data.name}`, 'emerald');
                break;
            case 'boss:created':
                this.state.bosses.push(data);
                this.render();
                this.showToast(`Added: ${data.name}`, 'emerald');
                break;
            case 'boss:deleted':
                this.removeBoss(data.id);
                this.showToast('Boss removed', 'amber');
                break;
            case 'event:updated':
                this.refreshEvent(data);
                this.render();
                break;
            case 'bosses:reload':
                this.fetchAll();
                this.showToast('Data refreshed from server', 'emerald');
                break;
            case 'settings:updated':
                this.state.settings = { ...this.state.settings, ...data };
                this.updateBrand();
                this.render();
                break;
            case 'announcement:updated':
                this.setAnnouncement(data.announcement);
                break;
        }
    },

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('ws-indicator');
        if (indicator) {
            indicator.style.background = connected ? 'var(--accent-emerald)' : 'var(--accent-rose)';
            indicator.title = connected ? 'Live Real-time Sync Active' : 'Disconnected (Reconnecting...)';
        }
    },

    updateBrand() {
        const serverNameEl = document.getElementById('server-name-label');
        if (serverNameEl && this.state.settings.serverName) {
            serverNameEl.textContent = this.state.settings.serverName;
        }
    },

    updateAnnouncement() {
        this.setAnnouncement(this.state.settings.announcement);
    },

    setAnnouncement(text) {
        const banner = document.getElementById('announcement-banner');
        const bannerText = document.getElementById('announcement-text');
        if (!banner || !bannerText) return;

        if (text && text.trim()) {
            bannerText.textContent = text;
            banner.classList.add('visible');
        } else {
            bannerText.textContent = '';
            banner.classList.remove('visible');
        }
    },

    getBossById(id) {
        return this.state.bosses.find(b => b.id === Number(id));
    },

    refreshBoss(updatedBoss) {
        const idx = this.state.bosses.findIndex(b => b.id === updatedBoss.id);
        if (idx !== -1) {
            this.state.bosses[idx] = updatedBoss;
        } else {
            this.state.bosses.push(updatedBoss);
        }
        this.render();
    },

    refreshEvent(updatedEvent) {
        const idx = this.state.events.findIndex(e => e.id === updatedEvent.id);
        if (idx !== -1) {
            this.state.events[idx] = updatedEvent;
        } else {
            this.state.events.push(updatedEvent);
        }
        this.render();
    },

    removeBoss(id) {
        this.state.bosses = this.state.bosses.filter(b => b.id !== Number(id));
        this.render();
    },

    startTicker() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        const tick = () => {
            const now = new Date();
            // Update Clocks
            const localClock = document.getElementById('local-clock');
            if (localClock) {
                localClock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            }

            // Check Audio Alerts
            soundManager.checkAlerts(this.state.bosses);

            // Re-render table countdowns
            this.render();
        };

        tick();
        this.timerInterval = setInterval(tick, 1000);
    },

    // Main Render Routine
    render() {
        const now = Date.now();
        const { justSpawned, preSpawned, upcoming, overdue, mainList } = TimerEngine.categorizeBosses(this.state.bosses, now);

        // Update tab count badges
        const allCountBadge = document.getElementById('badge-count-all');
        if (allCountBadge) allCountBadge.textContent = this.state.bosses.length;
        
        const aliveCountBadge = document.getElementById('badge-count-alive');
        if (aliveCountBadge) aliveCountBadge.textContent = justSpawned.length;

        const upcomingCountBadge = document.getElementById('badge-count-upcoming');
        if (upcomingCountBadge) upcomingCountBadge.textContent = upcoming.length;

        const invasionCount = this.state.bosses.filter(b => b.is_invasion).length;
        const invasionBadge = document.getElementById('badge-count-invasion');
        if (invasionBadge) invasionBadge.textContent = invasionCount;

        const eventBadge = document.getElementById('badge-count-events');
        if (eventBadge) eventBadge.textContent = this.state.events.length;

        // Render Just Spawned / ALIVE Section
        this.renderJustSpawned(justSpawned, now);

        // Filter bosses according to activeTab and search query
        let filteredList = [];
        if (this.state.activeTab === 'all') {
            filteredList = mainList;
        } else if (this.state.activeTab === 'upcoming') {
            filteredList = upcoming;
        } else if (this.state.activeTab === 'alive') {
            filteredList = justSpawned;
        } else if (this.state.activeTab === 'invasion') {
            filteredList = this.state.bosses.filter(b => b.is_invasion);
        } else if (this.state.activeTab === 'events') {
            this.renderEventsTable();
            return;
        }

        // Apply Search Filter
        if (this.state.searchQuery) {
            const q = this.state.searchQuery;
            filteredList = filteredList.filter(b => 
                (b.name && b.name.toLowerCase().includes(q)) ||
                (b.location && b.location.toLowerCase().includes(q))
            );
        }

        // Render Table Body
        this.renderBossTable(filteredList, now);
    },

    // Render Just Spawned Section
    renderJustSpawned(aliveBosses, now) {
        const section = document.getElementById('just-spawned-section');
        const grid = document.getElementById('alive-grid');
        if (!section || !grid) return;

        if (aliveBosses.length === 0) {
            section.style.display = 'none';
            grid.innerHTML = '';
            return;
        }

        section.style.display = '';
        grid.innerHTML = aliveBosses.map(b => {
            const spawnMs = b.next_spawn ? new Date(b.next_spawn).getTime() : now;
            const elapsed = Math.max(0, now - spawnMs);
            const isMuted = soundManager.isBossMuted(b.id);
            const invasionTag = b.is_invasion ? `<span class="invasion-badge">⚡ ${this.state.settings.invasionLabel || 'Inv.'}</span>` : '';

            return `
                <div class="alive-card">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="pulse-dot"></span>
                            <strong style="font-size: 1.05rem; color: #ffffff;">${b.name}</strong>
                            ${invasionTag}
                        </div>
                        <span class="status-badge badge-alive">${b.pinned_alive ? 'PINNED ALIVE' : 'JUST SPAWNED'}</span>
                    </div>

                    <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 10px;">
                        📍 ${b.location || 'Unknown Location'} • Spawned: ${TimerEngine.formatCountdown(-elapsed)}
                    </div>

                    <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
                        <button class="btn btn-emerald btn-sm" onclick="App.killNow(${b.id})">
                            ⚔️ Kill Now
                        </button>
                        <button class="btn btn-sm" onclick="AdminController.openRecordModal(${b.id})">
                            🕒 Time
                        </button>
                        <button class="btn btn-sm" onclick="App.togglePin(${b.id})" title="${b.pinned_alive ? 'Unpin' : 'Pin'}">
                            📌
                        </button>
                        <button class="btn btn-sm" onclick="App.toggleMute(${b.id})" title="${isMuted ? 'Unmute' : 'Mute'}">
                            ${isMuted ? '🔇' : '🔔'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    // Render Boss Table
    renderBossTable(bosses, now) {
        const tbody = document.getElementById('boss-tbody');
        const emptyState = document.getElementById('empty-state');
        if (!tbody) return;

        if (bosses.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const swapCountdown = localStorage.getItem('dashboard.swapCountdown') === 'true';
        const showLocation = localStorage.getItem('dashboard.showLocation') !== 'false';
        const showChance = localStorage.getItem('dashboard.showChance') !== 'false';
        const invasionLabel = this.state.settings.invasionLabel || 'Inv.';

        tbody.innerHTML = bosses.map((b, idx) => {
            const spawnMs = b.next_spawn ? new Date(b.next_spawn).getTime() : null;
            const diff = spawnMs ? spawnMs - now : null;
            const isSoon = diff !== null && diff > 0 && diff <= (this.state.settings.alertBeforeMinutes || 5) * 60000;
            const isAlive = b.pinned_alive || (diff !== null && diff <= 0 && diff >= -300000);
            const isOverdue = diff !== null && diff < -300000;

            let countdownClass = 'countdown-main';
            if (isAlive) countdownClass += ' countdown-alive';
            else if (isSoon) countdownClass += ' countdown-soon';
            else if (isOverdue) countdownClass += ' countdown-overdue';

            const countdownText = swapCountdown 
                ? TimerEngine.formatLocalTime(b.next_spawn)
                : TimerEngine.formatCountdown(diff);

            const subText = swapCountdown
                ? TimerEngine.formatCountdown(diff)
                : (b.next_spawn ? `Spawn: ${TimerEngine.formatLocalTime(b.next_spawn)}` : 'No kill recorded');

            const isMuted = soundManager.isBossMuted(b.id);
            const invasionBadge = b.is_invasion ? `<span class="invasion-badge">⚡ ${invasionLabel}</span>` : '';
            const advancedBadge = b.auto_advanced ? `<span class="status-badge badge-advanced">ADV</span>` : '';
            const maintBadge = b.post_maintenance ? `<span class="status-badge badge-maintenance">MAINT</span>` : '';
            const preBadge = b.pre_spawned ? `<span class="status-badge badge-prespawn">PRE</span>` : '';

            return `
                <tr class="boss-row ${idx % 2 === 1 ? 'striped' : ''}">
                    <td>
                        <div class="boss-name-cell">
                            <span class="boss-icon-tag">${b.is_invasion ? '⚡' : '👑'}</span>
                            <div>
                                <span style="font-weight: 600; color: #ffffff;">${b.name}</span>
                                ${invasionBadge}
                                ${advancedBadge}
                                ${maintBadge}
                                ${preBadge}
                            </div>
                        </div>
                    </td>
                    <td class="col-location" style="${showLocation ? '' : 'display:none;'} color: var(--text-muted); font-size: 0.82rem;">
                        ${b.location || '-'}
                    </td>
                    <td class="col-interval" style="color: var(--text-dim); font-size: 0.82rem; font-variant-numeric: tabular-nums;">
                        ${TimerEngine.formatInterval(b.interval)}
                    </td>
                    <td class="col-chance" style="${showChance ? '' : 'display:none;'} color: var(--accent-primary); font-weight: 600; font-size: 0.82rem;">
                        ${Math.round(parseFloat(b.chance_of_appearing || 100))}%
                    </td>
                    <td>
                        <div class="countdown-box">
                            <span class="${countdownClass}">${countdownText}</span>
                            <span class="countdown-sub">${subText}</span>
                        </div>
                    </td>
                    <td>
                        <div class="action-cell">
                            <button class="btn btn-emerald btn-sm" onclick="App.killNow(${b.id})" title="Record Kill Now">
                                ⚔️ Kill
                            </button>
                            <button class="btn btn-sm" onclick="AdminController.openRecordModal(${b.id})" title="Adjust Kill / Spawn Time">
                                🕒
                            </button>
                            <button class="btn btn-amber btn-sm" onclick="App.advanceBoss(${b.id})" title="Advance +1 Cycle (Skip 50% Spawn)">
                                ⏩
                            </button>
                            <button class="btn btn-sm" onclick="App.togglePin(${b.id})" title="${b.pinned_alive ? 'Unpin' : 'Pin Alive'}">
                                ${b.pinned_alive ? '📍' : '📌'}
                            </button>
                            <button class="btn btn-sm" onclick="App.toggleMute(${b.id})" title="${isMuted ? 'Unmute Sound' : 'Mute Sound'}">
                                ${isMuted ? '🔇' : '🔔'}
                            </button>
                            <button class="btn btn-sm admin-only" style="${AdminController.isAdmin ? '' : 'display:none;'}" onclick="AdminController.openAddBossModal(${b.id})" title="Edit Boss">
                                ✏️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // Render Events Table
    renderEventsTable() {
        const tbody = document.getElementById('boss-tbody');
        const emptyState = document.getElementById('empty-state');
        if (!tbody) return;

        if (this.state.events.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        const now = Date.now();

        tbody.innerHTML = this.state.events.map((ev, idx) => {
            const spawnMs = ev.next_spawn ? new Date(ev.next_spawn).getTime() : null;
            const diff = spawnMs ? spawnMs - now : null;
            const isDoneToday = ev.done_on === new Date().toISOString().split('T')[0];

            return `
                <tr class="boss-row ${idx % 2 === 1 ? 'striped' : ''}">
                    <td>
                        <div class="boss-name-cell">
                            <span class="boss-icon-tag" style="background: rgba(6, 182, 212, 0.15); color: var(--accent-cyan);">📅</span>
                            <div>
                                <span style="font-weight: 600; color: #ffffff;">${ev.name}</span>
                                <span class="status-badge" style="background: rgba(6, 182, 212, 0.2); color: var(--accent-cyan);">EVENT</span>
                                ${isDoneToday ? '<span class="status-badge badge-alive">DONE TODAY</span>' : ''}
                            </div>
                        </div>
                    </td>
                    <td class="col-location" style="color: var(--text-muted); font-size: 0.82rem;">
                        ${ev.location || 'Clan Hall'}
                    </td>
                    <td class="col-interval" style="color: var(--text-dim); font-size: 0.82rem;">
                        ${(ev.occurs_on || []).join(', ')} @ ${ev.event_time}
                    </td>
                    <td class="col-chance" style="color: var(--accent-cyan); font-weight: 600; font-size: 0.82rem;">
                        100%
                    </td>
                    <td>
                        <div class="countdown-box">
                            <span class="countdown-main" style="color: var(--accent-cyan);">${isDoneToday ? 'COMPLETED' : TimerEngine.formatCountdown(diff)}</span>
                            <span class="countdown-sub">Next: ${ev.next_spawn ? TimerEngine.formatDateTime(ev.next_spawn) : '-'}</span>
                        </div>
                    </td>
                    <td>
                        <div class="action-cell">
                            <button class="btn btn-emerald btn-sm" onclick="App.markEventDone(${ev.id})" title="Mark Event Done">
                                ✔️ Done
                            </button>
                            <button class="btn btn-amber btn-sm" onclick="App.skipEvent(${ev.id})" title="Skip to Next Occurrence">
                                ⏩ Skip
                            </button>
                            <button class="btn btn-sm" onclick="App.pinEvent(${ev.id})" title="Pin Active">
                                📌
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // Quick Actions
    async killNow(bossId) {
        try {
            const res = await fetch(`/api/bosses/${bossId}/kill`, {
                method: 'POST',
                headers: AdminController.getHeaders(),
                body: JSON.stringify({
                    mode: 'now',
                    reporter: localStorage.getItem('dashboard.nickname') || 'QuickKill'
                })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast(`Killed ${data.boss.name}! Next spawn: ${TimerEngine.formatLocalTime(data.boss.next_spawn)}`, 'emerald');
                this.refreshBoss(data.boss);
            }
        } catch (e) {
            this.showToast('Failed to kill boss', 'rose');
        }
    },

    async advanceBoss(bossId) {
        try {
            const res = await fetch(`/api/bosses/${bossId}/advance`, {
                method: 'POST',
                headers: AdminController.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.showToast(`Advanced ${data.boss.name} to next cycle!`, 'amber');
                this.refreshBoss(data.boss);
            }
        } catch (e) {
            this.showToast('Failed to advance boss', 'rose');
        }
    },

    async togglePin(bossId) {
        try {
            const res = await fetch(`/api/bosses/${bossId}/pin`, {
                method: 'POST',
                headers: AdminController.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.showToast(`${data.boss.name} pinned status: ${data.boss.pinned_alive ? 'ALIVE' : 'OFF'}`, 'emerald');
                this.refreshBoss(data.boss);
            }
        } catch (e) {
            this.showToast('Failed to toggle pin', 'rose');
        }
    },

    toggleMute(bossId) {
        const isMuted = soundManager.toggleMuteBoss(bossId);
        const boss = this.getBossById(bossId);
        this.showToast(`${boss ? boss.name : 'Boss'} ${isMuted ? 'MUTED' : 'UNMUTED'}`, isMuted ? 'amber' : 'emerald');
        this.render();
    },

    async markEventDone(eventId) {
        try {
            const res = await fetch(`/api/events/${eventId}/done`, {
                method: 'POST',
                headers: AdminController.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.showToast(`Event marked done!`, 'emerald');
                this.refreshEvent(data.event);
            }
        } catch (e) {
            this.showToast('Failed to update event', 'rose');
        }
    },

    async skipEvent(eventId) {
        try {
            const res = await fetch(`/api/events/${eventId}/skip`, {
                method: 'POST',
                headers: AdminController.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.showToast(`Event skipped to next date`, 'amber');
                this.refreshEvent(data.event);
            }
        } catch (e) {
            this.showToast('Failed to skip event', 'rose');
        }
    },

    async pinEvent(eventId) {
        try {
            const res = await fetch(`/api/events/${eventId}/pin`, {
                method: 'POST',
                headers: AdminController.getHeaders()
            });
            const data = await res.json();
            if (data.success) {
                this.refreshEvent(data.event);
            }
        } catch (e) {}
    },

    // Toast Messages
    showToast(message, type = 'emerald') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'emerald' ? '✅' : type === 'amber' ? '⚠️' : '❌';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(50px)';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

window.App = App;

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

class NexoKDS {
    constructor() {
        this.branch = null;
        this.storageKeys = {
            branch: 'kds_branch',
            currentStation: 'kds_current_station',
            selectedStations: 'kds_selected_stations',
            theme: 'kds_theme'
        };

        this.currentStation = localStorage.getItem(this.storageKeys.currentStation) || 'All';
        this.allAvailableStations = [];
        this.currentTheme = localStorage.getItem(this.storageKeys.theme) || 'dark';
        this.groupedItems = [];
        this.stationItemCounts = {};
        this.selectedStations = JSON.parse(localStorage.getItem(this.storageKeys.selectedStations) || '[]');
        
        this.init();
    }

    async init() {
        this.applyThemeConfiguration();
        this.setupEventHandlers();
        await this.checkActiveSession();
    }

    applyThemeConfiguration() {
        const applyBodyTheme = () => {
            const body = document.body || document.querySelector('body');
            if (body) {
                body.setAttribute('data-theme', this.currentTheme);
            }
        };

        if (document.body) {
            applyBodyTheme();
        } else {
            document.addEventListener('DOMContentLoaded', applyBodyTheme);
        }

        const indicator = document.getElementById('theme-icon-indicator');
        if (indicator) {
            indicator.innerText = this.currentTheme === 'dark' ? '🌙' : '☀️';
        }
    }

    setupEventHandlers() {
        document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
            this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem(this.storageKeys.theme, this.currentTheme);
            this.applyThemeConfiguration();
        });

        document.getElementById('station-select-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('station-dropdown')?.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            document.getElementById('station-dropdown')?.classList.add('hidden');
        });

        document.getElementById('station-dropdown')?.addEventListener('click', (e) => e.stopPropagation());
        document.getElementById('kds-login-form')?.addEventListener('submit', (e) => this.handleCustomLogin(e));

        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            await fetch('/api/method/logout');
            localStorage.removeItem(this.storageKeys.selectedStations);
            localStorage.removeItem(this.storageKeys.currentStation);
            localStorage.removeItem(this.storageKeys.branch);
            window.location.reload();
        });
    }

    async checkActiveSession() {
        try {
            const res = await fetch('/api/method/nexo_kds.api.get_kds_initial_context', {
                method: 'GET',
                credentials: 'include'
            });

            if (!res.ok) {
                throw new Error(`Initial context request failed: ${res.status}`);
            }

            const data = await res.json();

            if (data.message && !data.message.error) {
                const storedBranch = localStorage.getItem(this.storageKeys.branch);
                this.branch = data.message.branch;
                this.allAvailableStations = data.message.stations || [];

                if (storedBranch !== this.branch) {
                    localStorage.setItem(this.storageKeys.branch, this.branch || '');
                    localStorage.removeItem(this.storageKeys.selectedStations);
                    localStorage.removeItem(this.storageKeys.currentStation);
                    this.currentStation = 'All';
                    this.selectedStations = [];
                }

                // Reconcile any previously stored selected stations with stations for this branch
                const stored = JSON.parse(localStorage.getItem(this.storageKeys.selectedStations) || '[]');
                let valid = Array.isArray(stored) ? stored.filter(s => this.allAvailableStations.includes(s)) : [];

                if (valid.length === 0 && this.allAvailableStations.length > 0) {
                    valid = [...this.allAvailableStations];
                }

                this.selectedStations = valid;
                localStorage.setItem(this.storageKeys.selectedStations, JSON.stringify(this.selectedStations));

                // Ensure currentStation is valid for this branch
                if (this.currentStation !== 'All' && !this.allAvailableStations.includes(this.currentStation) && this.currentStation !== 'Assembly') {
                    this.currentStation = 'All';
                    localStorage.setItem(this.storageKeys.currentStation, this.currentStation);
                }

                this.showAppScreen();
            } else {
                this.showLoginScreen();
            }
        } catch (err) {
            this.showLoginScreen();
        }
    }

    showLoginScreen() {
        document.getElementById('kds-main-app')?.classList.add('hidden');
        document.getElementById('kds-login-screen')?.classList.remove('hidden');
    }

    showAppScreen() {
        document.getElementById('kds-login-screen')?.classList.add('hidden');
        document.getElementById('kds-main-app')?.classList.remove('hidden');
        
        const badge = document.getElementById('branch-badge');
        if (badge) badge.innerText = `Branch: ${this.branch}`;

        this.renderStationTabs();
        this.refreshKDSGrid();
        
        clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => this.refreshKDSGrid(), 4000);
    }

    async requestApi(method, args = {}, requestMethod = 'POST') {
    let url = `/api/method/${method}`;
    
    // 1. Safe Token Retrieval
    // Check if 'frappe' exists, otherwise look in window or cookies
    let csrfToken = '';
    if (typeof frappe !== 'undefined' && frappe.csrf_token) {
        csrfToken = frappe.csrf_token;
    } else if (window.csrf_token) {
        csrfToken = window.csrf_token;
    } else {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        if (match) csrfToken = match[1];
    }

    const options = {
        method: requestMethod,
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': csrfToken
        }
    };

    const params = new URLSearchParams();
    Object.entries(args).forEach(([key, value]) => {
        params.append(key, value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value);
    });

    if (requestMethod === 'GET') {
        url += `?${params.toString()}`;
    } else {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        options.body = params.toString();
    }

    const res = await fetch(url, options);

    if (!res.ok) {
        const errorData = await res.text();
        console.error(`API Error [${method}]:`, errorData);
        throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

    async handleCustomLogin(e) {
        e.preventDefault();
        const usr = document.getElementById('kds-username').value;
        const pwd = document.getElementById('kds-password').value;
        const errDiv = document.getElementById('login-error-msg');
        try {
            // Use the standard Frappe login endpoint so session cookie is created properly
            await this.requestApi('login', { usr: usr, pwd: pwd });

            // Re-check session by calling initial context. If login succeeded,
            // checkActiveSession will show the app screen; otherwise show error.
            await this.checkActiveSession();

            // If still on login screen, show a generic message
            if (document.getElementById('kds-login-screen') && !document.getElementById('kds-login-screen').classList.contains('hidden')) {
                errDiv.innerText = "Invalid username or password";
                errDiv.classList.remove('hidden');
            }
        } catch (err) {
            errDiv.innerText = (err && err.message) ? err.message : "Network sync error. Please check your connection.";
            errDiv.classList.remove('hidden');
        }
    }

    renderStationTabs() {
        const header = document.getElementById('main-app-header');
        if (!header) return;

        const oldTabsContainer = document.getElementById('station-tabs-container');
        if (oldTabsContainer) oldTabsContainer.remove();

        const tabsContainer = document.createElement('div');
        tabsContainer.id = 'station-tabs-container';
        tabsContainer.className = 'flex gap-2 items-center border-b border-slate-800 px-6 py-3 overflow-x-auto custom-scrollbar shrink-0';
        tabsContainer.style.overscrollBehavior = 'contain';

        const allTab = document.createElement('button');
        allTab.className = `station-tab px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            this.currentStation === 'All' 
                ? 'bg-[#42818c] text-white' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`;
        allTab.textContent = '📊 All Stations';
        allTab.onclick = () => this.switchStation('All');
        tabsContainer.appendChild(allTab);

        const assemblyTab = document.createElement('button');
        const assemblyCount = this.stationItemCounts['Assembly'] || 0;
        assemblyTab.className = `station-tab px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            this.currentStation === 'Assembly' 
                ? 'bg-green-700 text-white' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`;
        assemblyTab.innerHTML = `🔗 Assembly ${assemblyCount > 0 ? `<span class="ml-2 bg-red-600 px-2 py-0.5 rounded-full text-xs">${assemblyCount}</span>` : ''}`;
        assemblyTab.onclick = () => this.switchStation('Assembly');
        tabsContainer.appendChild(assemblyTab);

        const separator = document.createElement('div');
        separator.className = 'w-px h-6 bg-slate-700';
        tabsContainer.appendChild(separator);

        this.allAvailableStations.forEach(station => {
            const count = this.stationItemCounts[station] || 0;
            const tab = document.createElement('button');
            tab.className = `station-tab px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                this.currentStation === station 
                    ? 'bg-[#42818c] text-white' 
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`;
            tab.innerHTML = `🍳 ${station} ${count > 0 ? `<span class="ml-2 bg-orange-600 px-2 py-0.5 rounded-full text-xs">${count}</span>` : ''}`;
            tab.onclick = () => this.switchStation(station);
            tabsContainer.appendChild(tab);
        });

        const mainApp = document.getElementById('kds-main-app');
        mainApp.insertBefore(tabsContainer, mainApp.querySelector('main'));
    }

    switchStation(stationName) {
        this.currentStation = stationName;
        localStorage.setItem('kds_current_station', stationName);
        this.renderStationTabs();
        this.refreshKDSGrid();
    }

    async updateStationCounts() {
        if (!this.branch) return;

        try {
            const assemblyRes = await this.requestApi("nexo_kds.api.get_station_items_count", {
                branch: this.branch,
                station_name: "Assembly"
            }, "GET");
            this.stationItemCounts['Assembly'] = assemblyRes.message?.count || 0;

            for (const station of this.allAvailableStations) {
                const res = await this.requestApi("nexo_kds.api.get_station_items_count", {
                    branch: this.branch,
                    station_name: station
                }, "GET");
                this.stationItemCounts[station] = res.message?.count || 0;
            }
        } catch (err) {
            console.error("Failed to update station counts", err);
        }
    }

    async refreshKDSGrid() {
        if (!this.branch) return;

        try {
            await this.updateStationCounts();
            this.renderStationTabs();

            let stationForFetch = this.currentStation;
            if (this.currentStation === 'All') {
                this.groupedItems = [];
                for (const station of this.allAvailableStations) {
                    const res = await this.requestApi("nexo_kds.api.get_kds_items", {
                        branch: this.branch,
                        station_name: station
                    }, "GET");
                    const items = res.message || [];
                    this.groupedItems.push({ stationName: station, data: items });
                }
                const assemblyRes = await this.requestApi("nexo_kds.api.get_kds_items", {
                    branch: this.branch,
                    station_name: "Assembly"
                }, "GET");
                const assemblyItems = assemblyRes.message || [];
                if (assemblyItems.length > 0) {
                    this.groupedItems.push({ stationName: 'Assembly', data: assemblyItems });
                }
            } else {
                const res = await this.requestApi("nexo_kds.api.get_kds_items", {
                    branch: this.branch,
                    station_name: stationForFetch
                }, "GET");
                const items = res.message || [];
                this.groupedItems = [{ stationName: stationForFetch, data: items }];
            }

            this.renderTicketsUI();
        } catch (err) {
            console.error("KDS Sync broken", err);
        }
    }

    renderTicketsUI() {
    const container = document.getElementById('kds-orders-container');
    if (!container) return;

    // 1. Ensure groupedItems is always an array
    const groups = Array.isArray(this.groupedItems) ? this.groupedItems : [];
    
    // Check if there are any items
    const hasItems = groups.some(g => g.data && g.data.length > 0);

    if (groups.length === 0 || !hasItems) {
        container.innerHTML = `<div class="text-center p-10 text-slate-500 font-bold">No active items for ${this.currentStation} station.</div>`;
        return;
    }

    let html = '';

    if (this.currentStation === 'All') {
        // "All Stations" mode
        for (const stationGroup of groups) {
            if (!stationGroup.data || stationGroup.data.length === 0) continue;
            
            html += `
                <div class="mb-8">
                    <h2 class="text-2xl font-black mb-4 text-[#42818c] px-2">🍳 Station: ${stationGroup.stationName}</h2>
                    <div class="flex gap-4 flex-wrap">
                        ${stationGroup.data.map(kot => this.renderOrderCard(kot, stationGroup.stationName)).join('')}
                    </div>
                </div>
            `;
        }
    } else {
        // Single Station mode
        // Find the specific station group
        const stationGroup = groups.find(g => g.stationName === this.currentStation);
        if (stationGroup && stationGroup.data) {
            html = `<div class="flex gap-4 flex-wrap">${stationGroup.data.map(kot => this.renderOrderCard(kot, this.currentStation)).join('')}</div>`;
        }
    }

    container.innerHTML = html;
}

renderOrderCard(kot, stationName) {
    // Filter items based on station (Assembly sees all, others see their own)
    const itemsToShow = stationName === 'Assembly' 
        ? kot.items 
        : kot.items.filter(item => item.kds === stationName);

    if (itemsToShow.length === 0) return '';

    const allReady = itemsToShow.every(i => i.status === 'Ready');
    
    return `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl w-96 shadow-xl flex flex-col data-[theme=light]:bg-white data-[theme=light]:border-slate-200">
            <div class="p-4 border-b border-slate-800 data-[theme=light]:border-slate-200 bg-slate-950/50 rounded-t-2xl">
                <h3 class="font-black text-xl text-[#ff9f43]">KOT: ${kot.kot_id}</h3>
                <h4 class="font-bold text-slate-100 data-[theme=light]:text-slate-900">Table: ${kot.table}</h4>
                <p class="text-xs text-slate-400 data-[theme=light]:text-slate-500">Inv: ${kot.invoice_id} | Station: ${stationName}</p>
            </div>
            
            <div class="p-4 space-y-3 flex-1">
                ${itemsToShow.map(item => this.renderItemRow(item, stationName)).join('')}
            </div>

            ${stationName === 'Assembly' && allReady ? `
                <div class="border-t border-slate-800 data-[theme=light]:border-slate-200 p-4">
                    <button onclick="window.kdsEngine.finalizeAssembly('${kot.kot_id}')"
                            class="w-full bg-green-700 hover:bg-green-600 text-white font-black py-3 rounded-lg text-sm transition-all shadow-lg active:scale-95">
                            ✓ Mark Ready for Pickup
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

renderItemRow(item, stationName) {
    const isReady = item.status === 'Ready';
    const isPreparing = item.status === 'Preparing';
    const isPending = item.status === 'Pending';

    let buttonHTML = '';
    
    if (isReady) {
        buttonHTML = '<span class="text-green-500 text-xs font-bold px-3 py-1.5 border border-green-900 bg-green-900/20 rounded-lg">✓ Ready</span>';
    } else if (isPending) {
        buttonHTML = `
            <button onclick="window.kdsEngine.startPreparing('${item.name}')" 
                    class="bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95">
                    Start Prep
            </button>
        `;
    } else if (isPreparing) {
        buttonHTML = `
            <button onclick="window.kdsEngine.markItemReady('${item.name}')" 
                    class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95">
                    Ready
            </button>
        `;
    }

    return `
        <div class="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-800 data-[theme=light]:bg-slate-50 data-[theme=light]:border-slate-200">
            <div>
                <p class="text-sm font-bold text-slate-100 data-[theme=light]:text-slate-900">${item.item_name}</p>
                <p class="text-xs text-slate-400 data-[theme=light]:text-slate-600">Qty: ${item.qty} | Status: <span class="text-[#42818c] font-bold">${item.status}</span></p>
            </div>
            ${buttonHTML}
        </div>
    `;
}
// Add these methods to your NexoKDS class
    async startPreparing(childId) {
        try {
            const res = await this.requestApi("nexo_kds.api.update_item_status", {
                child_id: childId,
                new_status: "Preparing"
            }, "POST"); // Ensure it's POST to match the backend form_dict
            
            if (res.success) {
                this.refreshKDSGrid();
            } else {
                console.error("Failed to start prep:", res.error);
            }
        } catch (err) {
            console.error("Error calling startPreparing:", err);
        }
    }

    async markItemReady(childId) {
        try {
            const res = await this.requestApi("nexo_kds.api.update_item_status", {
                child_id: childId,
                new_status: "Ready"
            }, "POST");
            
            if (res.success) {
                this.refreshKDSGrid();
            } else {
                console.error("Failed to mark ready:", res.error);
            }
        } catch (err) {
            console.error("Error calling markItemReady:", err);
        }
    }

    async finalizeAssembly(kotId) {
    // 1. Validation: Check if kotId exists
    if (!kotId) {
        console.error("finalizeAssembly error: No KOT ID provided.");
        return;
    }

    try {
        // 2. API Call: Send request to the Python backend
        const res = await this.requestApi("nexo_kds.api.finalize_assembly", {
            kot_id: kotId
        }, "POST");
        
        // 3. Response Validation: 
        // Handles both direct response {success: true} and wrapped {message: {success: true}}
        const success = (res && res.success === true) || (res && res.message && res.message.success === true);

        if (success) {
            console.log("KOT finalized successfully:", kotId);
            
            // 4. UI Refresh:
            // This triggers a fresh fetch from the server.
            // Since the status in DB is now "Ready for Pick-Up", 
            // the 'Assembly' station filter will no longer include this KOT.
            await this.refreshKDSGrid(); 
        } else {
            console.error("Failed to finalize assembly. Server returned:", res);
        }
    } catch (err) {
        // 5. Error Handling: Catches network issues or unexpected crashes
        console.error("Error calling finalizeAssembly:", err);
    }
}
    
    openCustomerScreen() {
        if (this.branch) {
            window.open(`/customer_screen?branch=${encodeURIComponent(this.branch)}`, '_blank');
        } else {
            window.open('/customer_screen', '_blank');
        }
    }

    async openHistoryModal() {
    const container = document.getElementById('history-rows-container');
    
    if (!container) return;
    
    container.innerHTML = `<div class="text-center py-8 text-slate-500 font-bold text-xs animate-pulse">Loading history...</div>`;
    document.getElementById('history-modal').classList.remove('hidden');

    try {
        const res = await this.requestApi("nexo_kds.api.get_kot_history", {
            branch: this.branch
        });
        
        const logs = res.message || [];

        if (logs.length === 0) {
            container.innerHTML = `<div class="text-center py-8 text-slate-600 text-xs italic font-medium">No historically finalized saved KOT tickets found.</div>`;
            return;
        }

        // Render Cards
        container.innerHTML = logs.map(log => {
            const created = new Date(log.creation).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            const finished = new Date(log.modified).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const itemsListHTML = log.items && log.items.length > 0 
                ? log.items.map(i => `
                    <div class="text-xs text-white font-medium flex justify-between bg-slate-800 p-1.5 px-3 rounded-lg border border-slate-700">
                        <span class="font-bold text-indigo-400">x${i.qty}</span> 
                        <span>${i.item_name}</span>
                    </div>`).join('')
                : `<div class="text-[10px] text-slate-500 italic">No associated items.</div>`;

            return `
                <div class="history-card bg-slate-950 p-4 rounded-xl border border-slate-800/80 flex flex-col gap-3" data-kot-id="${log.name.toLowerCase()}">
                    <div class="flex justify-between border-b border-slate-800/60 pb-2">
                        <div>
                            <div class="kot-id font-black text-sm text-slate-200">${log.name}</div>
                            <div class="text-slate-500 text-xs">Inv: #${log.invoice_no || 'N/A'} | Table: ${log.table}</div>
                        </div>
                        <div class="text-right text-xs">
                            <div class="text-slate-500">IN: <span class="text-indigo-400">${created}</span></div>
                            <div class="text-slate-500">READY: <span class="text-emerald-400">${finished}</span></div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 gap-2">${itemsListHTML}</div>
                </div>
            `;
        }).join('');

        // Filter Logic Binding - Select input here to ensure it exists
        const filterInput = document.querySelector('input[placeholder="Filter logs by ticket number..."]');
        if (filterInput) {
            filterInput.oninput = (e) => {
                const term = e.target.value.toLowerCase();
                const cards = document.querySelectorAll('.history-card');
                
                cards.forEach(card => {
                    const id = card.getAttribute('data-kot-id');
                    // Agar match kare to default display (empty string), nahi to 'none'
                    card.style.display = id.includes(term) ? '' : 'none';
                });
            };
        }

    } catch(err) {
        console.error("History Modal Error:", err);
        container.innerHTML = `<div class="text-center py-8 text-red-400 font-bold text-xs">Failed to fetch history.</div>`;
    }
}

    closeHistoryModal() {
        document.getElementById('history-modal').classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.kdsEngine = new NexoKDS();
});
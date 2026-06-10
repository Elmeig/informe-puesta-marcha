document.addEventListener('DOMContentLoaded', () => {
    let reports = [];
    let isEditMode = false;
    let editId = null;

    const DOM = {
        recordsContainer: document.getElementById('records-container'),
        btnAddRecord: document.getElementById('btn-add-record'),
        modalRecord: document.getElementById('modal-record'),
        modalView: document.getElementById('modal-view'),
        btnModalClose: document.getElementById('btn-modal-close'),
        btnViewClose: document.getElementById('btn-view-close'),
        btnCancelModal: document.getElementById('btn-cancel-modal'),
        btnViewCloseFooter: document.getElementById('btn-view-close-footer'),
        form: document.getElementById('record-form'),
        modalTitle: document.getElementById('modal-title'),
        statTotal: document.getElementById('stat-total'),
        loading: document.getElementById('loading-overlay'),
        toast: document.getElementById('toast-container'),
        
        // Form inputs
        client: document.getElementById('form-client'),
        dateStart: document.getElementById('form-date-start'),
        dateEnd: document.getElementById('form-date-end'),
        techs: document.getElementById('form-techs'),
        notes: document.getElementById('form-notes'),
        diarioContainer: document.getElementById('diario-container'),
        btnAddDay: document.getElementById('btn-add-day'),
        
        // Search & Theme
        searchInput: document.getElementById('global-search-input'),
        btnTheme: document.getElementById('btn-theme')
    };

    // Theme toggle — 3 themes: light → mid → dark (same as Bug Tracker)
    const themes = ['light', 'mid', 'dark'];
    const themeIcons = { light: '☀️', mid: '🌗', dark: '🌙' };
    let currentTheme = localStorage.getItem('theme') || 'dark';

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        DOM.btnTheme.textContent = themeIcons[theme];
        localStorage.setItem('theme', theme);
    }
    applyTheme(currentTheme);

    DOM.btnTheme.addEventListener('click', () => {
        const idx = themes.indexOf(currentTheme);
        const next = themes[(idx + 1) % themes.length];
        applyTheme(next);
    });

    async function fetchReports() {
        DOM.loading.style.display = 'flex';
        try {
            const res = await fetch('api/reports');
            const data = await res.json();
            reports = data.reports || [];
            updateCachedLists(reports);
            renderReports();
        } catch (e) {
            showToast('Error cargando informes', 'error');
        } finally {
            DOM.loading.style.display = 'none';
        }
    }

    function renderReports() {
        DOM.statTotal.textContent = `Total: ${reports.length}`;
        DOM.recordsContainer.innerHTML = '';
        
        const filter = DOM.searchInput.value.toLowerCase();
        const filtered = reports.filter(r => 
            (r.cliente || '').toLowerCase().includes(filter) ||
            (r.tecnicos || '').toLowerCase().includes(filter)
        );

        if (filtered.length === 0) {
            DOM.recordsContainer.innerHTML = '<div style="text-align:center; padding: 2rem;">No hay informes.</div>';
            return;
        }

        filtered.forEach(r => {
            const card = document.createElement('div');
            card.className = 'record-card';
            card.style = 'background: var(--surface); padding: 1.5rem; margin-bottom: 1rem; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 4px 6px var(--shadow);';
            
            card.innerHTML = `
                <div style="display:flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div>
                        <h3 style="margin:0; color: var(--primary); font-size: 1.25rem;">${escapeHtml(r.cliente)}</h3>
                        <div style="font-size: 0.9rem; color: var(--text-muted); margin-top: 0.25rem;">
                            📅 ${escapeHtml(r.fecha_inicio)} - ${escapeHtml(r.fecha_fin)} | 👨‍🔧 ${escapeHtml(r.tecnicos)}
                        </div>
                    </div>
                    <div style="display:flex; gap: 0.5rem;">
                        <button class="btn-secondary btn-sm" onclick="viewReport('${r.id}')">👁️ Ver</button>
                        <button class="btn-secondary btn-sm" onclick="editReport('${r.id}')">✏️ Editar</button>
                        <button class="btn-secondary btn-sm" onclick="deleteReport('${r.id}')" style="color: #ef4444; border-color: #ef4444;">🗑️</button>
                    </div>
                </div>
                <div style="color: var(--text); font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                    ${r.notas_adicionales ? escapeHtml(r.notas_adicionales) : 'Sin notas adicionales.'}
                </div>
            `;
            DOM.recordsContainer.appendChild(card);
        });
    }

    DOM.searchInput.addEventListener('input', renderReports);

    // Form logic
    DOM.btnAddRecord.addEventListener('click', () => {
        isEditMode = false;
        editId = null;
        DOM.modalTitle.textContent = 'Nuevo Informe';
        DOM.form.reset();
        DOM.diarioContainer.innerHTML = '';
        addDayEntry(); // Add one default day
        DOM.modalRecord.classList.add('active');
    });

    [DOM.btnModalClose, DOM.btnCancelModal].forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.modalRecord.classList.remove('active');
        });
    });

    [DOM.btnViewClose, DOM.btnViewCloseFooter].forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.modalView.classList.remove('active');
        });
    });

    DOM.btnAddDay.addEventListener('click', addDayEntry);

    function addDayEntry(dateStr = '', descStr = '') {
        const div = document.createElement('div');
        div.className = 'day-entry';
        div.style = 'border: 1px solid var(--border); padding: 1rem; margin-bottom: 1rem; border-radius: 6px; position: relative;';
        div.innerHTML = `
            <button type="button" class="btn-remove-day" style="position: absolute; right: 0.5rem; top: 0.5rem; background: none; border: none; color: #ef4444; font-size: 1.2rem; cursor: pointer;">&times;</button>
            <div class="form-group" style="margin-bottom: 0.5rem;">
                <label>Fecha del día</label>
                <input type="date" class="day-date" required value="${dateStr}">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label>Tareas Realizadas</label>
                <textarea class="day-desc" rows="4" required placeholder="Describe las tareas realizadas este día...">${descStr}</textarea>
            </div>
        `;
        div.querySelector('.btn-remove-day').addEventListener('click', () => {
            div.remove();
        });
        DOM.diarioContainer.appendChild(div);
    }

    DOM.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Collect daily logs
        const dayEntries = document.querySelectorAll('.day-entry');
        const diario = Array.from(dayEntries).map(entry => {
            return {
                fecha: entry.querySelector('.day-date').value,
                descripcion: entry.querySelector('.day-desc').value
            };
        });

        // Sort by date ascending
        diario.sort((a, b) => a.fecha.localeCompare(b.fecha));

        const payload = {
            cliente: DOM.client.value,
            fecha_inicio: DOM.dateStart.value,
            fecha_fin: DOM.dateEnd.value,
            tecnicos: DOM.techs.value,
            notas_adicionales: DOM.notes.value,
            diario: diario
        };

        try {
            DOM.loading.style.display = 'flex';
            const method = isEditMode ? 'PUT' : 'POST';
            const url = isEditMode ? 'api/reports/' + editId : 'api/reports';
            
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Error saving');
            
            showToast(isEditMode ? 'Informe actualizado' : 'Informe creado', 'success');
            DOM.modalRecord.classList.remove('active');
            await fetchReports();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            DOM.loading.style.display = 'none';
        }
    });

    window.editReport = (id) => {
        const report = reports.find(r => r.id === id);
        if (!report) return;

        isEditMode = true;
        editId = id;
        DOM.modalTitle.textContent = 'Editar Informe';
        
        DOM.client.value = report.cliente || '';
        DOM.dateStart.value = report.fecha_inicio || '';
        DOM.dateEnd.value = report.fecha_fin || '';
        DOM.techs.value = report.tecnicos || '';
        DOM.notes.value = report.notas_adicionales || '';

        DOM.diarioContainer.innerHTML = '';
        const diario = report.diario || [];
        if (diario.length === 0) {
            addDayEntry();
        } else {
            diario.forEach(d => addDayEntry(d.fecha, d.descripcion));
        }

        DOM.modalRecord.classList.add('active');
    };

    window.deleteReport = async (id) => {
        if (!confirm('¿Seguro que deseas eliminar este informe?')) return;
        try {
            DOM.loading.style.display = 'flex';
            const res = await fetch('api/reports/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error deleting');
            showToast('Informe eliminado', 'success');
            await fetchReports();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            DOM.loading.style.display = 'none';
        }
    };

    window.viewReport = (id) => {
        const report = reports.find(r => r.id === id);
        if (!report) return;

        document.getElementById('view-title').textContent = `Informe: ${report.cliente}`;
        
        let html = `
            <div style="margin-bottom: 1.5rem; padding: 1rem; background: var(--bg); border-radius: 6px;">
                <p><strong>Cliente/Proyecto:</strong> ${escapeHtml(report.cliente)}</p>
                <p><strong>Período:</strong> ${escapeHtml(report.fecha_inicio)} a ${escapeHtml(report.fecha_fin)}</p>
                <p><strong>Técnicos:</strong> ${escapeHtml(report.tecnicos)}</p>
            </div>
            <h3 style="margin-bottom: 1rem; color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Diario de Puesta en Marcha</h3>
        `;

        if (report.diario && report.diario.length > 0) {
            report.diario.forEach(d => {
                html += `
                    <div style="margin-bottom: 1.5rem; border-left: 3px solid var(--primary); padding-left: 1rem;">
                        <h4 style="margin: 0 0 0.5rem 0; color: var(--text);">${escapeHtml(d.fecha)}</h4>
                        <div style="white-space: pre-wrap; color: var(--text-muted); line-height: 1.5;">${escapeHtml(d.descripcion)}</div>
                    </div>
                `;
            });
        } else {
            html += `<p style="color: var(--text-muted);">No hay registro diario.</p>`;
        }

        if (report.notas_adicionales) {
            html += `
                <h3 style="margin: 2rem 0 1rem 0; color: var(--primary); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Notas Adicionales</h3>
                <div style="white-space: pre-wrap; background: var(--bg); padding: 1rem; border-radius: 6px; border: 1px solid var(--border);">${escapeHtml(report.notas_adicionales)}</div>
            `;
        }

        document.getElementById('view-content').innerHTML = html;
        DOM.modalView.classList.add('active');
    };

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(msg, type='info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        DOM.toast.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Initial load
    fetchReports();
});

/* ─── Combobox: Client Autocomplete ────────────────── */
let _clientHighlightedIndex = -1;
let _autocompleteData = { clients: [], technicians: [] };
let _autocompleteLoaded = false;

async function loadAutocompleteData() {
    if (_autocompleteLoaded) return _autocompleteData;
    try {
        const res = await fetch('api/autocomplete');
        _autocompleteData = await res.json();
        _autocompleteLoaded = true;
    } catch (_) {
        _autocompleteData = { clients: [], technicians: [] };
    }
    return _autocompleteData;
}

// Also refresh when reports are saved
function updateCachedLists(reports) {
    // Invalidate autocomplete cache so next open fetches fresh data
    _autocompleteLoaded = false;
}

async function filterClientDropdown(value, openOnEmpty = false) {
    const dropdown = document.getElementById('client-dropdown');
    const data = await loadAutocompleteData();
    const list = data.clients || [];
    const q = value.trim().toLowerCase();

    if (!openOnEmpty && !q) { dropdown.classList.remove('open'); return; }
    const filtered = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
    if (filtered.length === 0) { dropdown.classList.remove('open'); return; }

    dropdown.innerHTML = '';
    filtered.forEach((name, i) => {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.dataset.value = name;
        if (q) {
            const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            item.innerHTML = name.replace(re, '<mark>$1</mark>');
        } else {
            item.textContent = name;
        }
        item.addEventListener('mousedown', (e) => { e.preventDefault(); selectClientItem(name); });
        item.addEventListener('mouseenter', () => { _clientHighlightedIndex = i; updateClientHighlight(); });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
    _clientHighlightedIndex = -1;
}

function updateClientHighlight() {
    const dropdown = document.getElementById('client-dropdown');
    dropdown.querySelectorAll('.combobox-item').forEach((item, i) => {
        item.classList.toggle('highlighted', i === _clientHighlightedIndex);
    });
}

function selectClientItem(name) {
    document.getElementById('form-client').value = name;
    document.getElementById('client-dropdown').classList.remove('open');
    _clientHighlightedIndex = -1;
}

function handleClientKeydown(event) {
    const dropdown = document.getElementById('client-dropdown');
    const items = dropdown.querySelectorAll('.combobox-item');
    if (!dropdown.classList.contains('open')) {
        if (event.key === 'ArrowDown' || event.key === 'Enter') {
            event.preventDefault();
            filterClientDropdown('', true);
        }
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        _clientHighlightedIndex = Math.min(_clientHighlightedIndex + 1, items.length - 1);
        updateClientHighlight();
        items[_clientHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        _clientHighlightedIndex = Math.max(_clientHighlightedIndex - 1, -1);
        updateClientHighlight();
    } else if (event.key === 'Enter') {
        if (_clientHighlightedIndex >= 0 && items[_clientHighlightedIndex]) {
            event.preventDefault();
            selectClientItem(items[_clientHighlightedIndex].dataset.value);
        }
    } else if (event.key === 'Escape' || event.key === 'Tab') {
        dropdown.classList.remove('open');
    }
}

/* ─── Combobox: Technician Autocomplete ────────────── */
let _techHighlightedIndex = -1;

async function filterTechDropdown(value, openOnEmpty = false) {
    const dropdown = document.getElementById('tech-dropdown');
    const data = await loadAutocompleteData();
    const list = data.technicians || [];
    const q = value.trim().toLowerCase();

    if (!openOnEmpty && !q) { dropdown.classList.remove('open'); return; }
    const filtered = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
    if (filtered.length === 0) { dropdown.classList.remove('open'); return; }

    dropdown.innerHTML = '';
    filtered.forEach((name, i) => {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.dataset.value = name;
        if (q) {
            const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            item.innerHTML = name.replace(re, '<mark>$1</mark>');
        } else {
            item.textContent = name;
        }
        item.addEventListener('mousedown', (e) => { e.preventDefault(); selectTechItem(name); });
        item.addEventListener('mouseenter', () => { _techHighlightedIndex = i; updateTechHighlight(); });
        dropdown.appendChild(item);
    });
    dropdown.classList.add('open');
    _techHighlightedIndex = -1;
}

function updateTechHighlight() {
    const dropdown = document.getElementById('tech-dropdown');
    dropdown.querySelectorAll('.combobox-item').forEach((item, i) => {
        item.classList.toggle('highlighted', i === _techHighlightedIndex);
    });
}

function selectTechItem(name) {
    document.getElementById('form-techs').value = name;
    document.getElementById('tech-dropdown').classList.remove('open');
    _techHighlightedIndex = -1;
}

function handleTechKeydown(event) {
    const dropdown = document.getElementById('tech-dropdown');
    const items = dropdown.querySelectorAll('.combobox-item');
    if (!dropdown.classList.contains('open')) {
        if (event.key === 'ArrowDown' || event.key === 'Enter') {
            event.preventDefault();
            filterTechDropdown('', true);
        }
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        _techHighlightedIndex = Math.min(_techHighlightedIndex + 1, items.length - 1);
        updateTechHighlight();
        items[_techHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        _techHighlightedIndex = Math.max(_techHighlightedIndex - 1, -1);
        updateTechHighlight();
    } else if (event.key === 'Enter') {
        if (_techHighlightedIndex >= 0 && items[_techHighlightedIndex]) {
            event.preventDefault();
            selectTechItem(items[_techHighlightedIndex].dataset.value);
        }
    } else if (event.key === 'Escape' || event.key === 'Tab') {
        dropdown.classList.remove('open');
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.combobox-wrap')) {
        document.querySelectorAll('.combobox-dropdown').forEach(d => d.classList.remove('open'));
    }
});

// ==================== КОНФИГУРАЦИЯ ====================
const STORAGE_KEY = 'stroiai_requests';
const ANALYTICS_KEY = 'stroiai_analytics';

// ==================== НАСТРОЙКА БИТРИКС24 ====================
const BITRIX24_WEBHOOK_URL = 'https://b24-vli9ke.bitrix24.ru/rest/1/sesq6kg1zshw3211/';
const USE_BITRIX24 = true;

// Отправка в Битрикс24 (без алертов)
async function sendToBitrix24(formData) {
    if (!USE_BITRIX24) {
        console.log('📦 Отправка в Битрикс24 отключена');
        return null;
    }
    
    const method = 'crm.lead.add.json';
    
    let leadData = {
        fields: {
            TITLE: `[СтройAI] ${formData.type}`,
            NAME: formData.name || 'Не указан',
            PHONE: [{ VALUE: formData.phone || '', VALUE_TYPE: 'WORK' }],
            COMMENTS: '',
            SOURCE_ID: 'WEB',
            SOURCE_DESCRIPTION: 'Заявка с сайта СтройAI'
        },
        params: { REGISTER_SONET_EVENT: 'Y' }
    };
    
    if (formData.roomDesc) leadData.fields.COMMENTS = `Описание: ${formData.roomDesc}`;
    if (formData.dimensions) leadData.fields.COMMENTS += `\nРазмеры: ${formData.dimensions}`;
    if (formData.budget) leadData.fields.COMMENTS += `\nБюджет: ${formData.budget}`;
    if (formData.estimateTotal) leadData.fields.COMMENTS += `\nСмета: ${formData.estimateTotal} ₽`;
    if (formData.calcParams) leadData.fields.COMMENTS = `Параметры: ${formData.calcParams}`;
    
    try {
        const response = await fetch(BITRIX24_WEBHOOK_URL + method, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadData)
        });
        const result = await response.json();
        if (result.error) {
            console.error('❌ Ошибка Битрикс24:', result.error_description);
            return null;
        }
        console.log('✅ Отправлено в Битрикс24, ID лида:', result.result);
        return result.result;
    } catch (error) {
        console.error('❌ Ошибка:', error);
        return null;
    }
}

// ==================== LOCALSTORAGE ====================
function getRequests() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveRequestToLocalStorage(requestData) {
    const requests = getRequests();
    const newRequest = {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        createdAtDisplay: new Date().toLocaleString('ru-RU'),
        status: 'new',
        ...requestData
    };
    requests.unshift(newRequest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    return newRequest;
}

// ==================== УНИВЕРСАЛЬНОЕ СОХРАНЕНИЕ (БЕЗ АЛЕРТОВ) ====================
async function saveRequestSilent(requestData) {
    let bitrixResult = null;
    if (USE_BITRIX24) bitrixResult = await sendToBitrix24(requestData.data || requestData);
    const localResult = saveRequestToLocalStorage(requestData);
    return { bitrix: bitrixResult, local: localResult };
}

// ==================== КАЛЬКУЛЯТОР С РЕАЛЬНЫМИ РАСЧЁТАМИ ====================
const areaSlider = document.getElementById('areaSlider');
const areaValue = document.getElementById('areaValue');
const priceResult = document.getElementById('priceResult');
const pricePerM2El = document.getElementById('pricePerM2');
const complexityMultiplierEl = document.getElementById('complexityMultiplier');
const durationEstimateEl = document.getElementById('durationEstimate');

let currentRoom = 'apartment';
let currentRepair = 'designer';

// Базовая стоимость за м² по типам помещений
const basePrices = {
    apartment: 5800,
    house: 5200,
    office: 6500
};

// Коэффициенты по типам ремонта
const repairMultipliers = {
    cosmetic: 1.0,
    capital: 1.6,
    designer: 2.8
};

// Сроки ремонта (дни)
const repairDurations = {
    cosmetic: { min: 14, max: 21 },
    capital: { min: 30, max: 45 },
    designer: { min: 45, max: 60 }
};

function calculatePrice() {
    if (!areaSlider || !priceResult) return;
    
    const area = parseInt(areaSlider.value);
    const basePrice = basePrices[currentRoom];
    const multiplier = repairMultipliers[currentRepair];
    const total = Math.round(area * basePrice * multiplier);
    
    priceResult.innerText = total.toLocaleString() + ' ₽';
    if (pricePerM2El) pricePerM2El.innerText = Math.round(basePrice * multiplier).toLocaleString() + ' ₽';
    if (complexityMultiplierEl) complexityMultiplierEl.innerText = multiplier + 'x';
    
    // Сроки ремонта
    const duration = repairDurations[currentRepair];
    if (duration && durationEstimateEl) {
        durationEstimateEl.innerText = `${duration.min}–${duration.max} дней`;
    }
}

// Обработчики кнопок калькулятора
document.querySelectorAll('.room-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.room-type-btn').forEach(b => b.classList.remove('active-room'));
        btn.classList.add('active-room');
        currentRoom = btn.dataset.room;
        calculatePrice();
    });
});

document.querySelectorAll('.repair-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.repair-type-btn').forEach(b => b.classList.remove('active-repair'));
        btn.classList.add('active-repair');
        currentRepair = btn.dataset.repair;
        calculatePrice();
    });
});

if (areaSlider) {
    areaSlider.addEventListener('input', (e) => {
        if (areaValue) areaValue.innerText = e.target.value;
        calculatePrice();
    });
    calculatePrice();
    document.querySelector('[data-repair="designer"]')?.classList.add('active-repair');
    document.querySelector('[data-room="apartment"]')?.classList.add('active-room');
}

// Кнопка "Перейти к дизайну" на калькуляторе
const exactCalcBtn = document.getElementById('exactCalcBtn');
if (exactCalcBtn) {
    exactCalcBtn.addEventListener('click', () => {
        // Сохраняем параметры расчёта в sessionStorage для передачи на страницу дизайна
        const area = areaSlider.value;
        const roomName = document.querySelector('.room-type-btn.active-room')?.innerText || 'Квартира';
        const repairName = document.querySelector('.repair-type-btn.active-repair')?.innerText || 'Премиум';
        const price = priceResult.innerText;
        sessionStorage.setItem('calculatorParams', JSON.stringify({
            area, roomName, repairName, price
        }));
        window.location.href = 'design.html';
    });
}

// ==================== СТРАНИЦА ДИЗАЙНА (размеры + смета + 1 дизайн + PDF) ====================
const API_BASE = `${window.location.origin}/api`;

const ROOM_LABELS = {
    living_room: 'Гостиная',
    bedroom: 'Спальня',
    kitchen: 'Кухня',
    bathroom: 'Ванная',
    hallway: 'Прихожая'
};

const ESTIMATE_LINE_LABELS = {
    flooring: 'Пол',
    walls: 'Стены',
    ceiling: 'Потолок',
    skirting: 'Плинтус'
};

let selectedBudget = 'standard';
let designImageBase64 = null;
let currentEstimate = null;
let currentProjectId = null;
let ceilingManualEdit = false;
let estimateDebounceTimer = null;

function toImageSrc(base64) {
    if (!base64) return '';
    if (base64.startsWith('data:')) return base64;
    return `data:image/jpeg;base64,${base64}`;
}

function setPdfButtonEnabled(enabled) {
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const pdfHint = document.getElementById('pdfHint');
    if (!downloadPdfBtn) return;
    downloadPdfBtn.disabled = !enabled;
    downloadPdfBtn.classList.toggle('btn-pdf-disabled', !enabled);
    if (pdfHint) {
        pdfHint.textContent = enabled
            ? 'PDF включает дизайн и детальную смету'
            : (designImageBase64 ? 'Дождитесь расчёта сметы' : 'Заполните размеры и сгенерируйте дизайн');
    }
}

function collectFormData() {
    return {
        room_type: document.getElementById('roomType')?.value || 'living_room',
        area_floor: parseFloat(document.getElementById('areaFloor')?.value) || 0,
        area_walls: parseFloat(document.getElementById('areaWalls')?.value) || 0,
        area_ceiling: parseFloat(document.getElementById('areaCeiling')?.value) || 0,
        skirting_length: parseFloat(document.getElementById('skirtingLength')?.value) || 0,
        budget: selectedBudget,
        description: document.getElementById('roomDescription')?.value.trim() || ''
    };
}

function formDimensionsValid(data) {
    return data.area_floor > 0 && data.area_walls > 0 && data.area_ceiling > 0;
}

function initDesignPage() {
    const designForm = document.getElementById('designForm');
    if (!designForm) return;

    const loadingSpinner = document.getElementById('loadingSpinner');
    const designResultSection = document.getElementById('designResultSection');
    const designImage = document.getElementById('designImage');
    const estimateBlock = document.getElementById('estimateBlock');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const areaFloor = document.getElementById('areaFloor');
    const areaCeiling = document.getElementById('areaCeiling');

    setPdfButtonEnabled(false);

    document.querySelectorAll('#designForm .budget-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#designForm .budget-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            selectedBudget = btn.dataset.budget;
            scheduleEstimateUpdate();
        });
    });

    areaFloor?.addEventListener('input', () => {
        if (!ceilingManualEdit && areaCeiling) {
            areaCeiling.value = areaFloor.value;
        }
        scheduleEstimateUpdate();
    });

    areaCeiling?.addEventListener('input', () => {
        ceilingManualEdit = true;
        scheduleEstimateUpdate();
    });

    ['roomType', 'areaWalls', 'skirtingLength'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', scheduleEstimateUpdate);
        document.getElementById(id)?.addEventListener('change', scheduleEstimateUpdate);
    });

    const calcParams = sessionStorage.getItem('calculatorParams');
    if (calcParams) {
        try {
            const p = JSON.parse(calcParams);
            if (p.area && areaFloor) {
                areaFloor.value = p.area;
                if (areaCeiling) areaCeiling.value = p.area;
            }
        } catch (_) { /* ignore */ }
    }

    designForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleFormSubmit();
    });

    function scheduleEstimateUpdate() {
        clearTimeout(estimateDebounceTimer);
        estimateDebounceTimer = setTimeout(() => updateEstimate(), 400);
    }

    async function updateEstimate() {
        const form = collectFormData();
        if (!formDimensionsValid(form)) {
            estimateBlock?.classList.add('hidden');
            setPdfButtonEnabled(false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/estimate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    budget: form.budget,
                    area_floor: form.area_floor,
                    area_walls: form.area_walls,
                    area_ceiling: form.area_ceiling,
                    skirting_length: form.skirting_length,
                    room_type: form.room_type
                })
            });
            const estimate = await response.json();
            if (!response.ok) throw new Error(estimate.error || 'Ошибка сметы');

            currentEstimate = estimate;
            renderEstimateTable(estimate);
            estimateBlock?.classList.remove('hidden');
            setPdfButtonEnabled(!!designImageBase64 && !!currentEstimate);
        } catch (err) {
            console.error('Смета:', err);
        }
    }

    function renderEstimateTable(estimate) {
        const tbody = document.getElementById('estimateTableBody');
        if (!tbody) return;

        const rows = ['flooring', 'walls', 'ceiling', 'skirting'];
        tbody.innerHTML = rows.map((key) => {
            const row = estimate[key];
            if (!row) return '';
            return `
                <tr>
                    <td>${ESTIMATE_LINE_LABELS[key]}</td>
                    <td>${row.material_name}</td>
                    <td>${row.quantity} ${row.unit || ''}</td>
                    <td>${Number(row.material_unit_price).toLocaleString('ru-RU')} ₽</td>
                    <td>${Number(row.work_unit_price).toLocaleString('ru-RU')} ₽</td>
                    <td>${Number(row.material_cost).toLocaleString('ru-RU')} ₽</td>
                    <td>${Number(row.work_cost).toLocaleString('ru-RU')} ₽</td>
                    <td>${Number(row.total).toLocaleString('ru-RU')} ₽</td>
                </tr>
            `;
        }).join('');

        const grandCell = document.getElementById('grandTotalCell');
        const durationCell = document.getElementById('durationDaysCell');
        const coefEl = document.getElementById('estimateRoomCoef');
        if (grandCell) grandCell.innerHTML = `<strong>${Number(estimate.total).toLocaleString('ru-RU')} ₽</strong>`;
        if (durationCell) durationCell.textContent = estimate.duration_days ?? '—';
        if (coefEl) {
            coefEl.textContent = `${ROOM_LABELS[estimate.room_type] || estimate.room_type} · коэф. ×${estimate.room_coefficient}`;
        }
    }

    async function saveProjectToDb(form, estimate) {
        try {
            const res = await fetch(`${API_BASE}/design-project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: form.description,
                    budget: form.budget,
                    room_type: form.room_type,
                    area_floor: form.area_floor,
                    area_walls: form.area_walls,
                    area_ceiling: form.area_ceiling,
                    skirting_length: form.skirting_length,
                    estimate_json: estimate
                })
            });
            const data = await res.json();
            if (data.success) currentProjectId = data.projectId;
        } catch (e) {
            console.error('DB save:', e);
        }
    }

    async function handleFormSubmit() {
        const form = collectFormData();

        if (!form.description) {
            alert('Опишите желаемый дизайн');
            return;
        }
        if (!formDimensionsValid(form)) {
            alert('Заполните площади пола, стен и потолка');
            return;
        }

        designImageBase64 = null;
        setPdfButtonEnabled(false);

        const dimsText = `Пол: ${form.area_floor} м², стены: ${form.area_walls} м², потолок: ${form.area_ceiling} м², плинтус: ${form.skirting_length || 0} п.м., ${ROOM_LABELS[form.room_type]}`;

        await saveRequestSilent({
            type: 'ГЕНЕРАЦИЯ ДИЗАЙНА',
            data: {
                name: 'Аноним',
                phone: '—',
                roomDesc: form.description,
                roomType: ROOM_LABELS[form.room_type],
                budget: form.budget,
                dimensions: dimsText,
                area_floor: form.area_floor,
                area_walls: form.area_walls,
                area_ceiling: form.area_ceiling,
                skirting_length: form.skirting_length,
                estimateTotal: currentEstimate?.total
            }
        });

        const generateBtn = document.getElementById('generateBtn');
        loadingSpinner?.classList.remove('hidden');
        loadingSpinner?.classList.add('flex');
        designResultSection?.classList.add('hidden');
        if (generateBtn) generateBtn.disabled = true;

        try {
            await updateEstimate();

            const response = await fetch(`${API_BASE}/generate-design`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: form.description })
            });
            const data = await response.json();

            if (!data.success || !data.image) {
                throw new Error(data.error || 'Не удалось сгенерировать дизайн');
            }

            designImageBase64 = data.image;
            if (designImage) designImage.src = toImageSrc(designImageBase64);
            designResultSection?.classList.remove('hidden');

            if (currentEstimate) {
                await saveProjectToDb(form, currentEstimate);
            }
            setPdfButtonEnabled(!!designImageBase64 && !!currentEstimate);
        } catch (err) {
            console.error(err);
            alert('Ошибка: ' + (err.message || err));
        } finally {
            loadingSpinner?.classList.add('hidden');
            loadingSpinner?.classList.remove('flex');
            if (generateBtn) generateBtn.disabled = false;
        }
    }

    downloadPdfBtn?.addEventListener('click', async () => {
        if (!designImageBase64 || !currentEstimate) return;

        downloadPdfBtn.disabled = true;
        const prevText = downloadPdfBtn.textContent;
        downloadPdfBtn.textContent = 'ФОРМИРОВАНИЕ PDF…';

        try {
            const response = await fetch(`${API_BASE}/generate-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    designImageBase64,
                    userPrompt: document.getElementById('roomDescription')?.value.trim(),
                    estimate: currentEstimate
                })
            });
            const data = await response.json();
            if (!response.ok || !data.pdfBase64) {
                throw new Error(data.error || 'Ошибка PDF');
            }

            const blob = base64ToBlob(data.pdfBase64, 'application/pdf');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stroiai_project_${currentProjectId || Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Ошибка PDF: ' + err.message);
        } finally {
            downloadPdfBtn.textContent = prevText;
            setPdfButtonEnabled(!!designImageBase64 && !!currentEstimate);
        }
    });

    scheduleEstimateUpdate();
}

function base64ToBlob(base64, mimeType) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
    }
    return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

if (window.location.pathname.includes('design.html')) {
    document.addEventListener('DOMContentLoaded', initDesignPage);
}

// ==================== АДМИН-ПАНЕЛЬ ====================
async function renderAdminTable() {
    const tbody = document.getElementById('requestsTable');
    if (!tbody) return;
    
    const requests = getRequests();
    if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-ivory/30">НЕТ ЗАЯВОК</td></tr>';
        return;
    }
    
    tbody.innerHTML = requests.map(req => `
        <tr class="hover:bg-white/5 transition admin-row" data-id="${req.id}">
            <td class="text-sm text-beige">#${req.id}</td>
            <td class="text-xs text-ivory/50">${req.createdAtDisplay || '—'}</td>
            <td class="text-sm font-medium">${req.type || '—'}</td>
            <td class="text-sm text-ivory/60">
                ${formatRequestData(req.data)}
                ${req.data?.dimensions ? `<br><span class="text-beige/70 text-xs">${req.data.dimensions}</span>` : ''}
                ${req.data?.estimateTotal ? `<br><span class="text-xs">Смета: ${Number(req.data.estimateTotal).toLocaleString('ru-RU')} ₽</span>` : ''}
            </td>
            <td><select class="status-select" data-id="${req.id}">
                <option value="new" ${req.status === 'new' ? 'selected' : ''}>НОВАЯ</option>
                <option value="in_work" ${req.status === 'in_work' ? 'selected' : ''}>В РАБОТЕ</option>
                <option value="completed" ${req.status === 'completed' ? 'selected' : ''}>ЗАВЕРШЕНА</option>
            </select></td>
            <td><button class="delete-request text-red-400/60 hover:text-red-400 text-sm" data-id="${req.id}">УДАЛИТЬ</button></td>
        </tr>
    `).join('');
    
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => updateRequestStatus(e.target.dataset.id, e.target.value));
    });
    document.querySelectorAll('.delete-request').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if(confirm('Удалить заявку?')) deleteRequest(e.target.dataset.id);
        });
    });
}

function updateRequestStatus(id, newStatus) {
    let requests = getRequests();
    requests = requests.map(req => req.id == id ? { ...req, status: newStatus } : req);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    renderAdminTable();
}

function deleteRequest(id) {
    let requests = getRequests();
    requests = requests.filter(req => req.id != id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    renderAdminTable();
}

function formatRequestData(data) {
    if (!data) return '—';
    let parts = [];
    if (data.name) parts.push(data.name);
    if (data.phone) parts.push(data.phone);
    if (data.roomType) parts.push(`🏠 ${data.roomType}`);
    if (data.budget) parts.push(`💰 ${data.budget}`);
    if (data.roomDesc) parts.push(data.roomDesc.substring(0, 50) + (data.roomDesc.length > 50 ? '…' : ''));
    if (data.area_floor) parts.push(`пол ${data.area_floor} м²`);
    if (data.area_walls) parts.push(`стены ${data.area_walls} м²`);
    if (data.calcParams) parts.push(data.calcParams);
    return parts.join('<br>') || '—';
}

// Экспорт в Excel
function exportToExcel() {
    const requests = getRequests();
    if (requests.length === 0) return alert('Нет данных');
    
    const excelData = requests.map(req => ({
        'ID': req.id,
        'Дата': req.createdAtDisplay,
        'Тип': req.type,
        'Имя': req.data?.name || '—',
        'Телефон': req.data?.phone || '—',
        'Статус': req.status === 'new' ? 'Новая' : (req.status === 'in_work' ? 'В работе' : 'Завершена')
    }));
    
    const headers = Object.keys(excelData[0]);
    const csvRows = [headers.join(';')];
    
    for (const row of excelData) {
        const values = headers.map(h => String(row[h] || '').replace(/"/g, '""'));
        csvRows.push(values.join(';'));
    }
    
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stroiai_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Инициализация админки
async function loadDbProjectsIntoTable() {
    const tbody = document.getElementById('requestsTable');
    if (!tbody) return;
    try {
        const res = await fetch(`${window.location.origin}/api/projects`);
        const projects = await res.json();
        const designProjects = (projects || []).filter((p) => p.type === 'ДИЗАЙН-ПРОЕКТ').slice(0, 20);
        if (designProjects.length === 0) return;

        const dbRows = designProjects.map((p) => {
            let est = {};
            try { est = p.estimate_json ? JSON.parse(p.estimate_json) : {}; } catch (_) {}
            const room = p.room_type || '—';
            const dims = `пол ${p.area_floor || '—'} / стены ${p.area_walls || '—'} / потолок ${p.area_ceiling || '—'} / плинтус ${p.skirting_length || 0} п.м.`;
            return `
                <tr class="hover:bg-white/5 transition bg-beige/5">
                    <td class="text-sm text-beige">DB#${p.id}</td>
                    <td class="text-xs text-ivory/50">${p.created_at || '—'}</td>
                    <td class="text-sm font-medium">${p.type}</td>
                    <td class="text-sm text-ivory/60">
                        ${p.description ? p.description.substring(0, 40) + '…' : '—'}<br>
                        <span class="text-beige/70 text-xs">${room} · ${p.budget || '—'} · ${dims}</span><br>
                        <span class="text-xs">Итого: ${est.total ? Number(est.total).toLocaleString('ru-RU') + ' ₽' : '—'}</span>
                    </td>
                    <td class="text-xs text-ivory/40">${p.status || 'new'}</td>
                    <td class="text-xs text-ivory/30">SQLite</td>
                </tr>
            `;
        }).join('');

        if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
        tbody.insertAdjacentHTML('beforeend', dbRows);
    } catch (e) {
        console.warn('DB projects load skipped:', e);
    }
}

if (window.location.pathname.includes('admin.html')) {
    document.addEventListener('DOMContentLoaded', async () => {
        await renderAdminTable();
        await loadDbProjectsIntoTable();
        document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);
        document.getElementById('refreshDataBtn')?.addEventListener('click', async () => {
            await renderAdminTable();
            await loadDbProjectsIntoTable();
        });
    });
}
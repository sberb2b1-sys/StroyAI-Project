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

// ==================== СТРАНИЦА ДИЗАЙНА (3 варианта + смета + PDF) ====================
const API_BASE = 'http://localhost:5000/api';

let selectedBudget = 'standard';
let generatedVariants = [];
let selectedVariantId = null;
let currentProjectId = null;
let currentEstimate = null;
let originalPhotoBase64 = null;

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function stripDataUrl(value) {
    if (!value || typeof value !== 'string') return '';
    const m = value.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    return m ? m[1] : value;
}

function initDesignPage() {
    const designForm = document.getElementById('designForm');
    if (!designForm) return;

    const loadingSpinner = document.getElementById('loadingSpinner');
    const variantsSection = document.getElementById('variantsSection');
    const variantsContainer = document.getElementById('variantsContainer');
    const selectedDesignSection = document.getElementById('selectedDesignSection');
    const selectedDesignImage = document.getElementById('selectedDesignImage');
    const estimateSection = document.getElementById('estimateSection');
    const showEstimateBtn = document.getElementById('showEstimateBtn');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const roomPhoto = document.getElementById('roomPhoto');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const orderSection = document.getElementById('orderSection');
    const orderBtn = document.getElementById('orderBtn');

    // Budget selection buttons
    document.querySelectorAll('.budget-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.budget-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            selectedBudget = btn.dataset.budget;
        });
    });

    if (roomPhoto) {
        roomPhoto.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && fileNameDisplay) {
                fileNameDisplay.textContent = `📎 ${file.name}`;
                fileNameDisplay.classList.remove('hidden');
            }
        });
    }

    // Pre-fill area from calculator if available
    const calcParams = sessionStorage.getItem('calculatorParams');
    if (calcParams) {
        try {
            const p = JSON.parse(calcParams);
            const areaInput = document.getElementById('roomArea');
            if (areaInput && p.area) areaInput.value = p.area;
        } catch (_) { /* ignore */ }
    }

    designForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleFormSubmit();
    });

    async function handleFormSubmit() {
        const description = document.getElementById('roomDescription')?.value.trim();
        const area = parseFloat(document.getElementById('roomArea')?.value);
        const photoInput = document.getElementById('roomPhoto');

        if (!description) {
            alert('Пожалуйста, опишите интерьер');
            return;
        }
        if (!area || area <= 0) {
            alert('Укажите площадь в м²');
            return;
        }

        let imageBase64 = null;
        if (photoInput?.files?.[0]) {
            imageBase64 = await fileToBase64(photoInput.files[0]);
            originalPhotoBase64 = imageBase64;
        } else {
            originalPhotoBase64 = null;
        }

        await saveRequestSilent({
            type: 'ГЕНЕРАЦИЯ ДИЗАЙНА',
            data: {
                name: 'Аноним',
                phone: '—',
                roomDesc: description,
                area,
                budget: selectedBudget
            }
        });

        const generateBtn = document.getElementById('generateBtn');
        loadingSpinner?.classList.remove('hidden');
        variantsSection?.classList.add('hidden');
        selectedDesignSection?.classList.add('hidden');
        estimateSection?.classList.add('hidden');
        orderSection?.classList.add('hidden');
        if (generateBtn) generateBtn.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/generate-three-variants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    budget: selectedBudget,
                    area,
                    originalPhotoBase64: imageBase64 ? stripDataUrl(imageBase64) : undefined
                })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Ошибка генерации');
            }

            currentProjectId = data.projectId;
            generatedVariants = data.variants || [];
            selectedVariantId = null;
            currentEstimate = null;

            renderVariants(generatedVariants);
            variantsSection?.classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('Ошибка: ' + err.message);
        } finally {
            loadingSpinner?.classList.add('hidden');
            if (generateBtn) generateBtn.disabled = false;
        }
    }

    function renderVariants(variants) {
        if (!variantsContainer) return;
        const budgetLabels = { economy: 'Эконом', standard: 'Стандарт', premium: 'Премиум' };
        variantsContainer.innerHTML = variants.map((v) => `
            <div class="variant-thumb-wrap" data-id="${v.id}" data-budget="${v.budget}">
                <img class="variant-thumb" src="data:image/jpeg;base64,${v.imageBase64 || ''}" alt="${v.budget}">
                <p class="text-xs text-center text-beige mt-2">${budgetLabels[v.budget] || v.budget}</p>
            </div>
        `).join('');

        variantsContainer.querySelectorAll('.variant-thumb').forEach((img) => {
            img.addEventListener('click', () => {
                const wrap = img.closest('.variant-thumb-wrap');
                onVariantSelect(Number(wrap.dataset.id), wrap.dataset.budget);
            });
        });
    }

    function onVariantSelect(variantId, budget) {
        selectedVariantId = variantId;
        if (budget) selectedBudget = budget;
        const variant = generatedVariants.find((v) => v.id === variantId);
        if (!variant || !variant.imageBase64) return;

        document.querySelectorAll('.variant-thumb').forEach((el) => el.classList.remove('selected'));
        const wrap = variantsContainer.querySelector(`[data-id="${variantId}"]`);
        wrap?.querySelector('.variant-thumb')?.classList.add('selected');

        if (selectedDesignImage) {
            selectedDesignImage.src = `data:image/jpeg;base64,${variant.imageBase64}`;
        }
        selectedDesignSection?.classList.remove('hidden');
        estimateSection?.classList.add('hidden');

        if (currentProjectId) {
            fetch(`${API_BASE}/projects/${currentProjectId}/update`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selected_variant: variantId })
            }).catch(console.error);
        }
    }

    showEstimateBtn?.addEventListener('click', async () => {
        if (!selectedVariantId) {
            alert('Сначала выберите вариант дизайна');
            return;
        }
        const area = parseFloat(document.getElementById('roomArea')?.value);
        try {
            const response = await fetch(`${API_BASE}/estimate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: selectedBudget, area })
            });
            const estimate = await response.json();
            if (!response.ok) throw new Error(estimate.error || 'Ошибка расчёта');

            currentEstimate = estimate;
            renderEstimateTable(estimate);
            estimateSection?.classList.remove('hidden');
            orderSection?.classList.remove('hidden');

            if (currentProjectId) {
                fetch(`${API_BASE}/projects/${currentProjectId}/update`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ estimate_json: estimate })
                }).catch(console.error);
            }
        } catch (err) {
            alert('Ошибка сметы: ' + err.message);
        }
    });

    function renderEstimateTable(estimate) {
        const tbody = document.getElementById('estimateTableBody');
        if (!tbody) return;
        tbody.innerHTML = estimate.breakdown.map((row) => `
            <tr>
                <td>${row.name}</td>
                <td>${Math.round(row.quantity)}</td>
                <td>${row.price.toLocaleString('ru-RU')} ₽</td>
                <td>${row.lineTotal.toLocaleString('ru-RU')} ₽</td>
            </tr>
        `).join('');
        const laborCell = document.getElementById('laborTotalCell');
        const grandCell = document.getElementById('grandTotalCell');
        const durationCell = document.getElementById('durationDaysCell');
        const labor = estimate.laborTotal ?? estimate.work_cost ?? 0;
        const total = estimate.total ?? estimate.total_cost ?? 0;
        const days = estimate.durationDays ?? estimate.duration_days ?? '—';
        if (laborCell) laborCell.textContent = labor.toLocaleString('ru-RU') + ' ₽';
        if (grandCell) grandCell.innerHTML = '<strong>' + total.toLocaleString('ru-RU') + ' ₽</strong>';
        if (durationCell) durationCell.textContent = days;
    }

    downloadPdfBtn?.addEventListener('click', async () => {
        if (!selectedVariantId || !currentEstimate) {
            alert('Выберите вариант и откройте смету перед скачиванием PDF');
            return;
        }
        const variant = generatedVariants.find((v) => v.id === selectedVariantId);
        const area = parseFloat(document.getElementById('roomArea')?.value);

        downloadPdfBtn.disabled = true;
        downloadPdfBtn.textContent = 'ФОРМИРОВАНИЕ PDF…';

        try {
            const response = await fetch(`${API_BASE}/generate-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    designImageBase64: variant?.imageBase64,
                    originalPhotoBase64: originalPhotoBase64 ? stripDataUrl(originalPhotoBase64) : undefined,
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

            if (currentProjectId) {
                fetch(`${API_BASE}/projects/${currentProjectId}/update`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pdfDownloaded: true })
                }).catch(console.error);
            }
        } catch (err) {
            alert('Ошибка PDF: ' + err.message);
        } finally {
            downloadPdfBtn.disabled = false;
            downloadPdfBtn.textContent = 'СКАЧАТЬ PDF';
        }
    });

    orderBtn?.addEventListener('click', () => {
        alert('Спасибо! Менеджер свяжется с вами для уточнения деталей.');
    });
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
        <tr class="hover:bg-white/5 transition">
            <td class="text-sm text-beige">#${req.id}</td>
            <td class="text-xs text-ivory/50">${req.createdAtDisplay || '—'}</td>
            <td class="text-sm font-medium">${req.type || '—'}</td>
            <td class="text-sm text-ivory/60">${formatRequestData(req.data)}</td>
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
    if (data.roomDesc) parts.push(data.roomDesc.substring(0, 40) + '...');
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
if (window.location.pathname.includes('admin.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        renderAdminTable();
        document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);
        document.getElementById('refreshDataBtn')?.addEventListener('click', renderAdminTable);
    });
}
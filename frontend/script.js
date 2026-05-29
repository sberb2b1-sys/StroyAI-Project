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

// ==================== СТРАНИЦА ДИЗАЙНА ====================
const generateBtn = document.getElementById('generateBtn');
const designImage = document.getElementById('designImage');
const loadingSpinner = document.getElementById('loadingSpinner');
const roomDesc = document.getElementById('roomDescription');
const designResults = document.getElementById('designResults');
const designGrid = document.getElementById('designGrid');
const downloadSection = document.getElementById('downloadSection');
const downloadBtn = document.getElementById('downloadBtn');
const floorPlanInput = document.getElementById('floorPlanInput');
const uploadArea = document.getElementById('uploadArea');
const fileNameDisplay = document.getElementById('fileNameDisplay');

let selectedDesignId = null;
let uploadedFileName = null;

// Загрузка файла планировки
if (uploadArea) {
    uploadArea.addEventListener('click', () => floorPlanInput?.click());
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('border-beige');
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('border-beige');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('border-beige');
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    });
    
    if (floorPlanInput) {
        floorPlanInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleFileUpload(e.target.files[0]);
        });
    }
}

function handleFileUpload(file) {
    uploadedFileName = file.name;
    if (fileNameDisplay) {
        fileNameDisplay.textContent = `📎 ${file.name}`;
        fileNameDisplay.classList.remove('hidden');
    }
    console.log('Файл загружен:', file.name);
}

// Генерация 3 вариантов дизайна
if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        const description = roomDesc?.value.trim();
        if (!description) {
            alert('Пожалуйста, опишите комнату');
            return;
        }
        
        // Сохраняем заявку в Битрикс24 (тихо, без алерта)
        await saveRequestSilent({
            type: 'ГЕНЕРАЦИЯ ДИЗАЙНА',
            data: { 
                name: 'Аноним', 
                phone: '—',
                roomDesc: description,
                hasFile: !!uploadedFileName,
                fileName: uploadedFileName || '—'
            }
        });
        
        loadingSpinner.classList.remove('hidden');
        designResults?.classList.add('hidden');
        downloadSection?.classList.add('hidden');
        
        // Симуляция работы нейросети (3 варианта)
        setTimeout(() => {
            loadingSpinner.classList.add('hidden');
            
            // Генерируем 3 варианта дизайна
            const variants = [
                { id: 1, style: 'СОВРЕМЕННАЯ КЛАССИКА', price: 'от 850 000 ₽', duration: '45 дней' },
                { id: 2, style: 'МИНИМАЛИЗМ', price: 'от 720 000 ₽', duration: '38 дней' },
                { id: 3, style: 'ЛОФТ / ИНДАСТРИАЛ', price: 'от 920 000 ₽', duration: '52 дня' }
            ];
            
            designGrid.innerHTML = variants.map(v => `
                <div class="bg-dark-bg border border-beige/20 p-4 cursor-pointer hover:border-beige transition-all design-option" data-id="${v.id}">
                    <img src="https://picsum.photos/400/300?random=${v.id}" alt="Вариант ${v.id}" class="w-full h-48 object-cover mb-3">
                    <h4 class="font-serif font-bold text-beige">${v.style}</h4>
                    <p class="text-ivory/50 text-sm mt-1">💰 ${v.price}</p>
                    <p class="text-ivory/50 text-sm">⏱ ${v.duration}</p>
                    <div class="mt-3 w-4 h-4 rounded-full border border-beige/50 mx-auto selected-indicator"></div>
                </div>
            `).join('');
            
            designResults?.classList.remove('hidden');
            
            // Обработка выбора дизайна
            document.querySelectorAll('.design-option').forEach(option => {
                option.addEventListener('click', () => {
                    document.querySelectorAll('.design-option').forEach(opt => {
                        opt.classList.remove('border-beige');
                        opt.classList.add('border-beige/20');
                        const indicator = opt.querySelector('.selected-indicator');
                        if (indicator) indicator.style.backgroundColor = 'transparent';
                    });
                    option.classList.remove('border-beige/20');
                    option.classList.add('border-beige');
                    const indicator = option.querySelector('.selected-indicator');
                    if (indicator) indicator.style.backgroundColor = '#D4B896';
                    selectedDesignId = option.dataset.id;
                    downloadSection?.classList.remove('hidden');
                });
            });
        }, 2000);
    });
}

// Скачивание файла с дизайном, сметой и календарём
if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
        if (!selectedDesignId) {
            alert('Пожалуйста, выберите вариант дизайна');
            return;
        }
        
        // Сохраняем выбор пользователя
        saveRequestSilent({
            type: 'ВЫБРАН ДИЗАЙН',
            data: { 
                name: 'Аноним', 
                phone: '—',
                selectedVariant: selectedDesignId,
                roomDesc: roomDesc?.value || '—'
            }
        });
        
        // Создаём ZIP-архив (имитация — реальные агенты будут генерировать файлы)
        // Здесь формируем JSON для демонстрации
        const designPackage = {
            selectedDesign: selectedDesignId,
            roomDescription: roomDesc?.value || '',
            uploadedFile: uploadedFileName || null,
            generatedAt: new Date().toISOString(),
            message: 'Этот файл будет содержать: 1) Дизайн-проект в PDF, 2) Смету ремонта, 3) Календарный план работ. В реальной системе здесь будут сгенерированы файлы AI-агентами.'
        };
        
        const blob = new Blob([JSON.stringify(designPackage, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stroiai_design_package_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert('✅ Пакет дизайна сформирован! Менеджер свяжется с вами в ближайшее время для уточнения деталей.');
    });
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
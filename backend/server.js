const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
// На macOS порт 5000 занят AirPlay Receiver — используйте 3001
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// express.static отключён — 403 на некоторых системах; файлы отдаём явными маршрутами ниже
// app.use(express.static(path.join(__dirname, 'public')));

// База данных
const db = new sqlite3.Database('./stroiai.db');

// Создание таблицы projects если не существует
db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    client_phone TEXT,
    type TEXT,
    data TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    area REAL,
    budget TEXT,
    generated_variants_json TEXT,
    original_photo_base64 TEXT,
    description TEXT,
    estimate_json TEXT,
    room_type TEXT,
    area_floor REAL,
    area_walls REAL,
    area_ceiling REAL,
    skirting_length REAL
)`);

// Миграция: добавить колонки в существующую БД
const extraColumns = [
    ['estimate_json', 'TEXT'],
    ['room_type', 'TEXT'],
    ['area_floor', 'REAL'],
    ['area_walls', 'REAL'],
    ['area_ceiling', 'REAL'],
    ['skirting_length', 'REAL']
];
db.all('PRAGMA table_info(projects)', (err, cols) => {
    if (err || !cols) return;
    const existing = new Set(cols.map((c) => c.name));
    extraColumns.forEach(([name, sqlType]) => {
        if (!existing.has(name)) {
            db.run(`ALTER TABLE projects ADD COLUMN ${name} ${sqlType}`);
        }
    });
});

function loadPrices() {
    const raw = fs.readFileSync(path.join(__dirname, 'prices.json'), 'utf8');
    return JSON.parse(raw);
}

/** Расчёт строки сметы: (материалы + работы) × коэффициент помещения */
function calcLine(materialCost, workCost, coefficient) {
    const mat = Math.round(materialCost * coefficient);
    const work = Math.round(workCost * coefficient);
    return { material_cost: mat, work_cost: work, total: mat + work };
}

function calculateDetailedEstimate(params) {
    const {
        budget = 'standard',
        area_floor = 0,
        area_walls = 0,
        area_ceiling = 0,
        skirting_length = 0,
        room_type = 'living_room'
    } = params;

    const prices = loadPrices();
    const mats = prices.materials[budget];
    const works = prices.work_cost[budget];
    if (!mats || !works) {
        throw new Error('Неизвестный бюджет');
    }

    const coef = prices.room_coefficients[room_type] ?? prices.room_coefficients[prices.default_room] ?? 1;

    const flooringRaw = calcLine(
        area_floor * mats.flooring.price_per_sqm,
        area_floor * works.flooring,
        coef
    );
    const wallsRaw = calcLine(
        area_walls * mats.wall_paint.price_per_sqm,
        area_walls * works.wall_paint,
        coef
    );
    const ceilingRaw = calcLine(
        area_ceiling * mats.ceiling.price_per_sqm,
        area_ceiling * works.ceiling,
        coef
    );
    const skirtingLen = Number(skirting_length) || 0;
    const skirtingRaw = calcLine(
        skirtingLen * mats.skirting.price_per_meter,
        skirtingLen * works.skirting,
        coef
    );

    const flooring = {
        material_name: mats.flooring.name,
        quantity: area_floor,
        unit: mats.flooring.unit,
        material_unit_price: mats.flooring.price_per_sqm,
        work_unit_price: works.flooring,
        ...flooringRaw
    };
    const walls = {
        material_name: mats.wall_paint.name,
        quantity: area_walls,
        unit: mats.wall_paint.unit,
        material_unit_price: mats.wall_paint.price_per_sqm,
        work_unit_price: works.wall_paint,
        ...wallsRaw
    };
    const ceiling = {
        material_name: mats.ceiling.name,
        quantity: area_ceiling,
        unit: mats.ceiling.unit,
        material_unit_price: mats.ceiling.price_per_sqm,
        work_unit_price: works.ceiling,
        ...ceilingRaw
    };
    const skirting = {
        material_name: mats.skirting.name,
        quantity: skirtingLen,
        unit: mats.skirting.unit,
        material_unit_price: mats.skirting.price_per_meter,
        work_unit_price: works.skirting,
        ...skirtingRaw
    };

    const total = flooring.total + walls.total + ceiling.total + skirting.total;
    const durationDays = prices.duration_days?.[budget] ?? 45;

    return {
        budget,
        room_type,
        room_coefficient: coef,
        area_floor,
        area_walls,
        area_ceiling,
        skirting_length: skirtingLen,
        flooring,
        walls,
        ceiling,
        skirting,
        total,
        duration_days: durationDays
    };
}

// Обёртки для промисов
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// API: получить все проекты
app.get('/api/projects', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: создать проект
app.post('/api/project', async (req, res) => {
    const { client_name, client_phone, type, data } = req.body;
    try {
        const result = await dbRun(
            'INSERT INTO projects (client_name, client_phone, type, data) VALUES (?, ?, ?, ?)',
            [client_name, client_phone, type, JSON.stringify(data)]
        );
        res.json({ id: result.lastID, success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// API: обновить статус проекта
app.put('/api/project/:id/status', async (req, res) => {
    try {
        await dbRun('UPDATE projects SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== ГЕНЕРАЦИЯ ТРЁХ ВАРИАНТОВ ДИЗАЙНА ==========
app.post('/api/generate-three-variants', async (req, res) => {
    const { description, area, budget, originalPhotoBase64, imageBase64 } = req.body;
    const photo = originalPhotoBase64 || imageBase64 || null;

    if (!description) {
        return res.status(400).json({ success: false, error: 'Нет описания' });
    }

    console.log(`🎨 Генерация трёх вариантов для: ${description}`);

    const budgets = ['economy', 'standard', 'premium'];
    const prompts = {
        economy: `${description}, budget economy style, simple materials, affordable, basic finish`,
        standard: `${description}, standard interior, modern materials, comfortable, nice finish`,
        premium: `${description}, luxury premium style, high-end materials, elegant, designer finish`
    };

    const variants = [];

    for (const budgetType of budgets) {
        const prompt = prompts[budgetType];
        const escapedPrompt = prompt.replace(/"/g, '\\"');

        try {
            const result = await new Promise((resolve, reject) => {
                exec(`python3 design_agent.py "${escapedPrompt}"`, (error, stdout, stderr) => {
                    if (error) {
                        reject(stderr);
                    } else {
                        const output = stdout.trim();
                        if (output === 'ERROR' || !output) {
                            reject('Ошибка генерации');
                        } else {
                            resolve(output);
                        }
                    }
                });
            });
            variants.push({ id: budgets.indexOf(budgetType) + 1, budget: budgetType, imageBase64: result });
        } catch (err) {
            console.error(`❌ Ошибка генерации для ${budgetType}:`, err);
            variants.push({ id: budgets.indexOf(budgetType) + 1, budget: budgetType, imageBase64: null, error: err });
        }
    }

    const variantsJson = JSON.stringify(variants.map(v => ({ budget: v.budget, hasImage: !!v.imageBase64 })));
    const result = await dbRun(
        `INSERT INTO projects (type, data, area, budget, generated_variants_json, original_photo_base64, description) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['ГЕНЕРАЦИЯ ДИЗАЙНА', JSON.stringify({ description, variantsCount: variants.length }), area || null, budget || null, variantsJson, photo, description]
    );

    res.json({
        success: true,
        projectId: result.lastID,
        variants: variants
    });
});

// API: получить смету (по размерам помещения)
app.post('/api/estimate', (req, res) => {
    try {
        const {
            budget,
            area_floor,
            area_walls,
            area_ceiling,
            skirting_length,
            room_type
        } = req.body;

        if (!budget) {
            return res.status(400).json({ error: 'Укажите бюджет' });
        }
        if (!area_floor || !area_walls || !area_ceiling) {
            return res.status(400).json({ error: 'Укажите площади пола, стен и потолка' });
        }

        const estimate = calculateDetailedEstimate({
            budget,
            area_floor: Number(area_floor),
            area_walls: Number(area_walls),
            area_ceiling: Number(area_ceiling),
            skirting_length: Number(skirting_length) || 0,
            room_type: room_type || 'living_room'
        });

        res.json(estimate);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: сохранить дизайн-проект с размерами и сметой
app.post('/api/design-project', async (req, res) => {
    try {
        const {
            description,
            budget,
            room_type,
            area_floor,
            area_walls,
            area_ceiling,
            skirting_length,
            estimate_json
        } = req.body;

        const result = await dbRun(
            `INSERT INTO projects (
                type, description, budget, room_type,
                area_floor, area_walls, area_ceiling, skirting_length,
                area, estimate_json, data, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'ДИЗАЙН-ПРОЕКТ',
                description || null,
                budget || null,
                room_type || null,
                area_floor ?? null,
                area_walls ?? null,
                area_ceiling ?? null,
                skirting_length ?? null,
                area_floor ?? null,
                estimate_json ? JSON.stringify(estimate_json) : null,
                JSON.stringify(req.body),
                'new'
            ]
        );

        res.json({ success: true, projectId: result.lastID });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: сгенерировать PDF
app.post('/api/generate-pdf', async (req, res) => {
    const {
        designImageBase64,
        imageBase64,
        estimate,
        userPrompt,
        originalPhotoBase64
    } = req.body;

    const designB64 = designImageBase64 || imageBase64;
    const stripDataUrl = (v) => {
        if (!v || typeof v !== 'string') return '';
        const m = v.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
        return m ? m[1] : v;
    };

    try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4' });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const pdfBase64 = Buffer.concat(chunks).toString('base64');
            res.json({ success: true, pdfBase64 });
        });

        doc.fontSize(20).text('СтройAI — Дизайн-проект и смета', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Описание: ${userPrompt || '—'}`);
        if (estimate.room_type) {
            doc.text(`Тип помещения: ${estimate.room_type} (коэф. ×${estimate.room_coefficient || 1})`);
        }
        doc.moveDown();

        const orig = stripDataUrl(originalPhotoBase64);
        if (orig) {
            doc.text('Исходное фото:');
            doc.image(Buffer.from(orig, 'base64'), { fit: [200, 150] });
            doc.moveDown();
        }

        const design = stripDataUrl(designB64);
        if (design) {
            doc.text('Сгенерированный дизайн:');
            doc.image(Buffer.from(design, 'base64'), { fit: [400, 280] });
            doc.moveDown();
        }

        doc.fontSize(14).text('Детальная смета', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        const lines = [
            { key: 'flooring', label: 'Пол' },
            { key: 'walls', label: 'Стены' },
            { key: 'ceiling', label: 'Потолок' },
            { key: 'skirting', label: 'Плинтус' }
        ];

        lines.forEach(({ key, label }) => {
            const row = estimate[key];
            if (!row) return;
            doc.text(
                `${label}: ${row.material_name} | ${row.quantity} ${row.unit || ''} | ` +
                `мат. ${row.material_unit_price} ₽ + раб. ${row.work_unit_price} ₽ | ` +
                `мат. ${row.material_cost.toLocaleString('ru-RU')} ₽ + раб. ${row.work_cost.toLocaleString('ru-RU')} ₽ = ` +
                `${row.total.toLocaleString('ru-RU')} ₽`
            );
        });

        doc.moveDown();
        doc.fontSize(12);
        doc.text(`Итого: ${(estimate.total || 0).toLocaleString('ru-RU')} ₽`, { underline: true });
        doc.text(`Срок ремонта: ${estimate.duration_days ?? 45} дней`);

        doc.end();
    } catch (err) {
        console.error('PDF error:', err);
        res.status(500).json({ error: 'Ошибка генерации PDF' });
    }
});

// API: обновить проект
app.put('/api/projects/:id/update', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const allowed = [
        'selected_variant', 'estimate_json', 'pdf_generated', 'pdf_downloaded',
        'status', 'budget', 'area', 'description',
        'room_type', 'area_floor', 'area_walls', 'area_ceiling', 'skirting_length'
    ];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) continue;
        fields.push(`${key} = ?`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
    values.push(id);

    if (fields.length === 0) {
        return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    try {
        await dbRun(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Legacy endpoint — оставляем для совместимости
app.post('/api/generate-design', (req, res) => {
    const { description } = req.body;
    if (!description) {
        return res.status(400).json({ success: false, error: 'Нет описания' });
    }

    const escapedDesc = description.replace(/"/g, '\\"');
    exec(`python3 design_agent.py "${escapedDesc}"`, (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, error: stderr });
        }
        const output = stdout.trim();
        if (output === 'ERROR' || !output) {
            return res.json({ success: false, error: 'Ошибка генерации' });
        }
        res.json({ success: true, image: output });
    });
});

// Явная отдача HTML файлов (обходит 403)
const publicDir = path.join(__dirname, 'public');

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'design.html'));
});

app.get('/design.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'design.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/calculator.html', (req, res) => {
    res.sendFile(path.join(publicDir, 'calculator.html'));
});

// Явная отдача CSS и JS
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(publicDir, 'styles.css'));
});

app.get('/script.js', (req, res) => {
    res.sendFile(path.join(publicDir, 'script.js'));
});

// Старый URL /frontend/... — редирект на актуальные страницы
app.get('/frontend/design.html', (req, res) => res.redirect('/design.html'));
app.get('/frontend/index.html', (req, res) => res.redirect('/index.html'));
app.get('/frontend/admin.html', (req, res) => res.redirect('/admin.html'));
app.get('/frontend/calculator.html', (req, res) => res.redirect('/calculator.html'));
app.get('/frontend/styles.css', (req, res) => res.redirect('/styles.css'));
app.get('/frontend/script.js', (req, res) => res.redirect('/script.js'));

// Запуск сервера
app.listen(port, () => {
    console.log(`✅ Бэкенд запущен на http://localhost:${port}`);
    console.log(`📁 Файлы из: ${publicDir}`);
    console.log(`🌐 Открывай: http://localhost:${port}/design.html`);
    console.log('⚠️  Не используйте порт 5000 на macOS — его занимает AirPlay (отсюда был 403).');
});

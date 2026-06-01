const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 5000;

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
    description TEXT
)`);

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

// API: получить смету
app.post('/api/estimate', (req, res) => {
    const { budget, area } = req.body;

    let prices;
    try {
        const pricesRaw = fs.readFileSync(path.join(__dirname, 'prices.json'), 'utf8');
        prices = JSON.parse(pricesRaw);
    } catch (err) {
        return res.status(500).json({ error: 'Не удалось загрузить базу цен' });
    }

    const budgetData = prices.materials[budget];
    const laborCostPerSqm = prices.work_cost_per_sqm[budget];
    const userArea = area || prices.default_area || 45;

    if (!budgetData || !laborCostPerSqm) {
        return res.status(400).json({ error: 'Неизвестный бюджет' });
    }

    const materialsTotal = Object.values(budgetData).reduce((sum, item) => {
        if (item.price_per_sqm) return sum + (item.price_per_sqm * userArea);
        if (item.price_per_liter) return sum + (item.price_per_liter * (userArea * 0.2));
        if (item.fixed_price) return sum + item.fixed_price;
        return sum;
    }, 0);

    const laborTotal = laborCostPerSqm * userArea;
    const total = materialsTotal + laborTotal;
    const durationDays = prices.duration_days?.[budget] || 45;

    const breakdown = Object.entries(budgetData).map(([key, item]) => {
        const qty = item.price_per_sqm ? userArea : item.price_per_liter ? userArea * 0.2 : 1;
        const price = item.price_per_sqm || item.price_per_liter || item.fixed_price || 0;
        const lineTotal = item.price_per_sqm
            ? item.price_per_sqm * userArea
            : item.price_per_liter
                ? item.price_per_liter * (userArea * 0.2)
                : item.fixed_price || 0;
        return {
            name: item.name || key,
            unit: item.unit || '—',
            price,
            quantity: qty,
            lineTotal: Math.round(lineTotal)
        };
    });

    res.json({
        budget,
        area: userArea,
        work_cost: Math.round(laborTotal),
        materials_cost: Math.round(materialsTotal),
        total_cost: Math.round(total),
        laborTotal: Math.round(laborTotal),
        materialsTotal: Math.round(materialsTotal),
        total: Math.round(total),
        breakdown,
        duration_days: durationDays,
        durationDays
    });
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

        doc.fontSize(20).text('СтройAI — Дизайн-проект', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Описание: ${userPrompt || '—'}`);
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
            doc.image(Buffer.from(design, 'base64'), { fit: [400, 300] });
            doc.moveDown();
        }

        doc.fontSize(14).text('Смета', { underline: true });
        doc.fontSize(12);
        const workCost = estimate.work_cost ?? estimate.laborTotal ?? 0;
        const materialsCost = estimate.materials_cost ?? estimate.materialsTotal ?? 0;
        const totalCost = estimate.total_cost ?? estimate.total ?? 0;
        const days = estimate.duration_days ?? estimate.durationDays ?? 45;
        doc.text(`Стоимость работ: ${workCost.toLocaleString('ru-RU')} ₽`);
        doc.text(`Стоимость материалов: ${materialsCost.toLocaleString('ru-RU')} ₽`);
        doc.text(`Итого: ${totalCost.toLocaleString('ru-RU')} ₽`);
        doc.text(`Срок ремонта: ${days} дней`);

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
        'status', 'budget', 'area', 'description'
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
});

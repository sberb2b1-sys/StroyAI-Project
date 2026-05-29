const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('../'));

// База данных
const db = new sqlite3.Database('./stroiai.db');
db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    client_phone TEXT,
    type TEXT,
    data TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.get('/api/projects', (req, res) => {
    db.all('SELECT * FROM projects ORDER BY created_at DESC', (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/project', (req, res) => {
    const { client_name, client_phone, type, data } = req.body;
    db.run(
        'INSERT INTO projects (client_name, client_phone, type, data) VALUES (?, ?, ?, ?)',
        [client_name, client_phone, type, JSON.stringify(data)],
        function(err) {
            if (err) {
                res.json({ success: false, error: err.message });
            } else {
                res.json({ id: this.lastID, success: true });
            }
        }
    );
});

app.put('/api/project/:id/status', (req, res) => {
    db.run('UPDATE projects SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
    res.json({ success: true });
});

// ========== АГЕНТ-ДИЗАЙНЕР (РАБОЧАЯ ВЕРСИЯ) ==========
app.post('/api/generate-design', (req, res) => {
    const { description } = req.body;
    
    if (!description) {
        return res.status(400).json({ success: false, error: 'Нет описания' });
    }
    
    console.log(`🎨 Генерация дизайна: ${description}`);
    
    const escapedDesc = description.replace(/"/g, '\\"');
    
    exec(`python3 design_agent.py "${escapedDesc}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('❌ Ошибка:', stderr);
            return res.json({ success: false, error: stderr });
        }
        
        const output = stdout.trim();
        
        if (output === 'ERROR' || !output) {
            return res.json({ success: false, error: 'Ошибка генерации изображения' });
        }
        
        console.log('✅ Дизайн сгенерирован');
        res.json({ success: true, image: output });
    });
});

app.listen(port, () => {
    console.log(`✅ Бэкенд запущен на http://localhost:${port}`);
});
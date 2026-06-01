/**
 * One-time migration: adds design-project columns to projects table.
 * Run from backend folder: node db_migrate.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'stroiai.db');
const db = new sqlite3.Database(dbPath);

const columns = [
    { name: 'area', sql: 'REAL' },
    { name: 'budget', sql: 'TEXT' },
    { name: 'selected_variant', sql: 'INTEGER' },
    { name: 'estimate_json', sql: 'TEXT' },
    { name: 'pdf_generated', sql: 'INTEGER DEFAULT 0' },
    { name: 'original_photo_base64', sql: 'TEXT' },
    { name: 'generated_variants_json', sql: 'TEXT' },
    { name: 'pdf_downloaded', sql: 'INTEGER DEFAULT 0' },
    { name: 'description', sql: 'TEXT' }
];

function run(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => (err ? reject(err) : resolve()));
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function migrate() {
    const tableInfo = await all('PRAGMA table_info(projects)');
    const existing = new Set(tableInfo.map((c) => c.name));

    for (const col of columns) {
        if (!existing.has(col.name)) {
            await run(`ALTER TABLE projects ADD COLUMN ${col.name} ${col.sql}`);
            console.log(`✅ Added column: ${col.name}`);
        } else {
            console.log(`⏭ Column already exists: ${col.name}`);
        }
    }

    console.log('Migration complete.');
    db.close();
}

migrate().catch((err) => {
    console.error('Migration failed:', err);
    db.close();
    process.exit(1);
});

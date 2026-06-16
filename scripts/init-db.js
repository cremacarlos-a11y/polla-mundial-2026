const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'polla_mundial_2026.db');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  console.error('No se encontró data/polla_mundial_2026.db.');
  console.error('Copia la base SQLite generada en la carpeta data/.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const columns = db.prepare("PRAGMA table_info(participantes)").all().map(c => c.name);

if (!columns.includes('pin')) {
  db.prepare("ALTER TABLE participantes ADD COLUMN pin TEXT").run();
}

const pins = [
  ['Mary','1001'],
  ['José','1002'],
  ['Jesús','1003'],
  ['Paolo','1004'],
  ['Juli','1005'],
  ['Uriel','1006'],
  ['Daniela','1007'],
  ['Carlos','1008']
];

const upd = db.prepare("UPDATE participantes SET pin = ? WHERE nombre = ?");
for (const [nombre, pin] of pins) {
  upd.run(pin, nombre);
}

console.log('Base inicializada correctamente.');
console.log('PINs:');
for (const [nombre, pin] of pins) console.log(`${nombre}: ${pin}`);

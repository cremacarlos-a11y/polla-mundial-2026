const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'polla_mundial_2026.db');
const db = new Database(DB_PATH);

function restarUnaHora(fecha, hora) {
  if (!fecha || !hora) return { fecha, hora };

  const [yyyy, mm, dd] = String(fecha).split('-').map(Number);
  const [HH, MM] = String(hora).split(':').map(Number);

  if (!yyyy || !mm || !dd || Number.isNaN(HH)) return { fecha, hora };

  // Usamos UTC solo como contenedor para evitar problemas de zona local.
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, HH, MM || 0, 0));
  d.setUTCHours(d.getUTCHours() - 1);

  const nf = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const nh = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

  return { fecha: nf, hora: nh };
}

const partidos = db.prepare(`
  SELECT id_partido, fecha, hora, equipo_local, equipo_visitante
  FROM partidos
  ORDER BY id_partido
`).all();

const update = db.prepare(`
  UPDATE partidos
  SET fecha = ?, hora = ?
  WHERE id_partido = ?
`);

const tx = db.transaction(() => {
  for (const p of partidos) {
    const nuevo = restarUnaHora(p.fecha, p.hora);
    update.run(nuevo.fecha, nuevo.hora, p.id_partido);
    console.log(`P${String(p.id_partido).padStart(3, '0')} ${p.equipo_local} vs ${p.equipo_visitante}: ${p.fecha} ${p.hora} -> ${nuevo.fecha} ${nuevo.hora}`);
  }
});

tx();
console.log(`Horarios corregidos en ${partidos.length} partidos.`);
console.log(`Base actualizada: ${DB_PATH}`);

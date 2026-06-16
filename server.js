const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'polla_mundial_2026.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getParticipantePorCredenciales(nombre, pin) {
  return db.prepare(`
    SELECT id_participante, nombre
    FROM participantes
    WHERE nombre = ? AND pin = ? AND activo = 1
  `).get(nombre, pin);
}

function partidoBloqueado(fecha, hora) {
  // Bloqueo simple: compara fecha/hora local del servidor.
  // Luego podemos ajustar zona horaria Lima si desplegamos.
  if (!fecha) return false;
  const h = hora || '00:00';
  const inicio = new Date(`${fecha}T${h}:00`);
  const ahora = new Date();
  return ahora >= inicio;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Polla Mundial 2026', db: DB_PATH });
});

app.get('/api/participantes', (req, res) => {
  const rows = db.prepare(`
    SELECT id_participante, nombre
    FROM participantes
    WHERE activo = 1
    ORDER BY id_participante
  `).all();
  res.json(rows);
});

app.post('/api/login', (req, res) => {
  const { participante, pin } = req.body;
  if (!participante || !pin) {
    return res.status(400).json({ error: 'Debe ingresar participante y PIN.' });
  }

  const user = getParticipantePorCredenciales(participante, pin);
  if (!user) {
    return res.status(401).json({ error: 'Participante o PIN incorrecto.' });
  }

  res.json({ ok: true, participante: user });
});


app.post('/api/mis-pronosticos', (req, res) => {
  const { participante, pin } = req.body;
  const user = getParticipantePorCredenciales(participante, pin);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });

  const rows = db.prepare(`
    SELECT
      p.id_partido,
      p.fecha,
      p.hora,
      p.fase,
      p.grupo,
      p.equipo_local,
      p.equipo_visitante,
      pr.pronostico_local,
      pr.pronostico_visitante,
      pr.resultado_pronostico,
      pr.criterio,
      pr.puntos,
      pr.estado_partido,
      COALESCE(r.resultado, '') AS resultado_real,
      COALESCE(r.estado, 'Pendiente') AS estado_resultado
    FROM pronosticos pr
    JOIN partidos p ON p.id_partido = pr.id_partido
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    WHERE pr.id_participante = ?
    ORDER BY p.fecha, p.hora, p.id_partido
  `).all(user.id_participante);

  res.json({
    participante: user.nombre,
    pronosticos: rows.map(r => ({
      ...r,
      partido: `${r.equipo_local} vs ${r.equipo_visitante}`,
      pronostico: r.resultado_pronostico || `${r.pronostico_local}-${r.pronostico_visitante}`
    }))
  });
});

app.get('/api/partidos-admin', (req, res) => {
  const rows = db.prepare(`
    SELECT
      p.id_partido,
      p.fecha,
      p.hora,
      p.fase,
      p.grupo,
      p.equipo_local,
      p.equipo_visitante,
      COALESCE(r.goles_local, '') AS goles_local,
      COALESCE(r.goles_visitante, '') AS goles_visitante,
      COALESCE(r.resultado, '') AS resultado,
      COALESCE(r.estado, 'Pendiente') AS estado
    FROM partidos p
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    ORDER BY p.fecha, p.hora, p.id_partido
  `).all();

  res.json(rows.map(r => ({
    ...r,
    partido: `${r.equipo_local} vs ${r.equipo_visitante}`
  })));
});


app.post('/api/partidos-pendientes', (req, res) => {
  const { participante, pin } = req.body;
  const user = getParticipantePorCredenciales(participante, pin);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });

  const rows = db.prepare(`
    SELECT
      p.id_partido,
      p.fecha,
      p.hora,
      p.fase,
      p.grupo,
      p.equipo_local,
      p.equipo_visitante,
      COALESCE(r.estado, 'Pendiente') AS estado_resultado,
      pr.pronostico_local,
      pr.pronostico_visitante,
      CASE WHEN pr.id_pronostico IS NULL THEN 0 ELSE 1 END AS ya_registrado
    FROM partidos p
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    LEFT JOIN pronosticos pr
      ON pr.id_partido = p.id_partido
     AND pr.id_participante = ?
    WHERE COALESCE(r.estado, 'Pendiente') <> 'Registrado'
    ORDER BY p.fecha, p.hora, p.id_partido
    LIMIT 12
  `).all(user.id_participante);

  const data = rows.map(p => ({
    ...p,
    partido: `${p.equipo_local} vs ${p.equipo_visitante}`,
    bloqueado: partidoBloqueado(p.fecha, p.hora)
  }));

  res.json({ participante: user.nombre, partidos: data });
});

app.post('/api/pronosticos', (req, res) => {
  const { participante, pin, pronosticos } = req.body;
  const user = getParticipantePorCredenciales(participante, pin);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas.' });

  if (!Array.isArray(pronosticos) || pronosticos.length === 0) {
    return res.status(400).json({ error: 'No se recibieron pronósticos.' });
  }

  const insert = db.prepare(`
    INSERT INTO pronosticos (
      id_partido,
      id_participante,
      pronostico_local,
      pronostico_visitante,
      resultado_pronostico,
      criterio,
      puntos,
      estado_partido,
      registrado_en
    )
    VALUES (?, ?, ?, ?, ?, 'Pendiente', 0, 'Pendiente', CURRENT_TIMESTAMP)
    ON CONFLICT(id_partido, id_participante)
    DO UPDATE SET
      pronostico_local = excluded.pronostico_local,
      pronostico_visitante = excluded.pronostico_visitante,
      resultado_pronostico = excluded.resultado_pronostico,
      registrado_en = CURRENT_TIMESTAMP
  `);

  const tx = db.transaction((items) => {
    const registrados = [];
    const bloqueados = [];

    for (const item of items) {
      const idPartido = Number(item.id_partido);
      const gl = Number(item.pronostico_local);
      const gv = Number(item.pronostico_visitante);

      if (!Number.isInteger(idPartido) || !Number.isInteger(gl) || !Number.isInteger(gv) || gl < 0 || gv < 0) {
        continue;
      }

      const partido = db.prepare(`
        SELECT p.*, COALESCE(r.estado, 'Pendiente') AS estado_resultado
        FROM partidos p
        LEFT JOIN resultados r ON r.id_partido = p.id_partido
        WHERE p.id_partido = ?
      `).get(idPartido);

      if (!partido) continue;

      if (partido.estado_resultado === 'Registrado' || partidoBloqueado(partido.fecha, partido.hora)) {
        bloqueados.push({
          id_partido: idPartido,
          partido: `${partido.equipo_local} vs ${partido.equipo_visitante}`
        });
        continue;
      }

      insert.run(
        idPartido,
        user.id_participante,
        gl,
        gv,
        `${gl}-${gv}`
      );

      registrados.push({
        id_partido: idPartido,
        partido: `${partido.equipo_local} vs ${partido.equipo_visitante}`,
        pronostico: `${gl}-${gv}`
      });
    }

    return { registrados, bloqueados };
  });

  const result = tx(pronosticos);
  res.json({ ok: true, participante: user.nombre, ...result });
});

app.get('/api/ranking', (req, res) => {
  const rows = db.prepare(`
    SELECT
      posicion,
      participante,
      partidos_pronosticados AS partidos,
      score_exactos AS scoreExactos,
      aciertos_ganador_empate AS ganadorEmpate,
      puntos_totales AS puntos
    FROM v_ranking
    ORDER BY posicion
  `).all();
  res.json(rows);
});


app.get('/api/dashboard', (req, res) => {
  const metricas = {};
  for (const row of db.prepare('SELECT indicador, valor FROM v_dashboard').all()) {
    metricas[row.indicador] = row.valor;
  }

  const lider = db.prepare(`
    SELECT participante, puntos_totales
    FROM v_ranking
    ORDER BY posicion
    LIMIT 1
  `).get();

  res.json({
    metricas,
    lider: lider || null
  });
});


app.get('/api/control-pronosticos', (req, res) => {
  const porPartido = db.prepare(`
    SELECT *
    FROM v_control_pronosticos_partido
    ORDER BY fecha, hora
  `).all();

  const porParticipante = db.prepare(`
    SELECT *
    FROM v_control_pronosticos_participante
    ORDER BY pendientes DESC, participante
  `).all();

  res.json({ porPartido, porParticipante });
});

app.post('/api/resultados', (req, res) => {
  const { id_partido, goles_local, goles_visitante, admin_pin } = req.body;

  if (admin_pin !== (process.env.ADMIN_PIN || 'admin2026')) {
    return res.status(401).json({ error: 'PIN de administrador incorrecto.' });
  }

  const id = Number(id_partido);
  const gl = Number(goles_local);
  const gv = Number(goles_visitante);

  if (!Number.isInteger(id) || !Number.isInteger(gl) || !Number.isInteger(gv)) {
    return res.status(400).json({ error: 'Datos de resultado inválidos.' });
  }

  const partido = db.prepare('SELECT * FROM partidos WHERE id_partido = ?').get(id);
  if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });

  db.prepare(`
    INSERT INTO resultados (id_partido, goles_local, goles_visitante, resultado, estado, actualizado_en)
    VALUES (?, ?, ?, ?, 'Registrado', CURRENT_TIMESTAMP)
    ON CONFLICT(id_partido)
    DO UPDATE SET
      goles_local = excluded.goles_local,
      goles_visitante = excluded.goles_visitante,
      resultado = excluded.resultado,
      estado = 'Registrado',
      actualizado_en = CURRENT_TIMESTAMP
  `).run(id, gl, gv, `${gl}-${gv}`);

  db.prepare(`UPDATE partidos SET estado = 'Registrado' WHERE id_partido = ?`).run(id);

  recalcularPuntosPartido(id, gl, gv);

  res.json({ ok: true, partido: `${partido.equipo_local} vs ${partido.equipo_visitante}`, resultado: `${gl}-${gv}` });
});

function signo(a, b) {
  if (a > b) return 'L';
  if (a < b) return 'V';
  return 'E';
}

function recalcularPuntosPartido(idPartido, realLocal, realVisitante) {
  const pronosticos = db.prepare(`
    SELECT id_pronostico, pronostico_local, pronostico_visitante
    FROM pronosticos
    WHERE id_partido = ?
  `).all(idPartido);

  const upd = db.prepare(`
    UPDATE pronosticos
    SET criterio = ?, puntos = ?, estado_partido = 'Registrado'
    WHERE id_pronostico = ?
  `);

  const realSigno = signo(realLocal, realVisitante);

  const tx = db.transaction(() => {
    for (const pr of pronosticos) {
      const exacto = pr.pronostico_local === realLocal && pr.pronostico_visitante === realVisitante;
      const aciertaSigno = signo(pr.pronostico_local, pr.pronostico_visitante) === realSigno;

      let criterio = 'Sin puntos';
      let puntos = 0;

      if (exacto) {
        criterio = 'Score Exacto';
        puntos = 6;
      } else if (aciertaSigno) {
        criterio = 'Ganador/Empate';
        puntos = 2;
      }

      upd.run(criterio, puntos, pr.id_pronostico);
    }
  });

  tx();
}

app.listen(PORT, () => {
  console.log(`Polla Mundial 2026 corriendo en http://localhost:${PORT}`);
});

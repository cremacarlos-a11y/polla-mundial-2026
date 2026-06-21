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

function fechaHoraLimaToDate(fecha, hora) {
  if (!fecha) return null;

  const h = hora || '00:00';
  const [yyyy, mm, dd] = String(fecha).split('-').map(Number);
  const [HH, MM] = String(h).split(':').map(Number);

  if (!yyyy || !mm || !dd || Number.isNaN(HH)) return null;

  // Perú no usa horario de verano. Hora Lima = UTC-5.
  // Para comparar correctamente en Render, convertimos la hora Perú a UTC.
  return new Date(Date.UTC(yyyy, mm - 1, dd, HH + 5, MM || 0, 0));
}

function partidoBloqueado(fecha, hora) {
  const inicio = fechaHoraLimaToDate(fecha, hora);
  if (!inicio) return false;
  return new Date() >= inicio;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Polla Mundial 2026', db: DB_PATH });
});

app.get('/api/admin/backup-db', (req, res) => {
  const adminPin = req.query.admin_pin;

  if (!validarAdminPin(adminPin)) {
    return res.status(401).json({ error: 'PIN de administrador incorrecto.' });
  }

  const fileName = `polla_mundial_2026_backup_${new Date().toISOString().slice(0,10)}.db`;

  res.download(DB_PATH, fileName, (err) => {
    if (err) {
      console.error('Error descargando backup:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'No se pudo descargar la base de datos.' });
      }
    }
  });
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



app.post('/api/cambiar-pin', (req, res) => {
  const { participante, pin_actual, nuevo_pin, confirmar_pin } = req.body;

  if (!participante || !pin_actual || !nuevo_pin || !confirmar_pin) {
    return res.status(400).json({ error: 'Debe completar todos los campos.' });
  }

  if (!/^\d{4}$/.test(String(nuevo_pin))) {
    return res.status(400).json({ error: 'El nuevo PIN debe tener exactamente 4 dígitos numéricos.' });
  }

  if (String(nuevo_pin) !== String(confirmar_pin)) {
    return res.status(400).json({ error: 'La confirmación del PIN no coincide.' });
  }

  if (String(pin_actual) === String(nuevo_pin)) {
    return res.status(400).json({ error: 'El nuevo PIN debe ser diferente al PIN actual.' });
  }

  const user = getParticipantePorCredenciales(participante, pin_actual);
  if (!user) {
    return res.status(401).json({ error: 'PIN actual incorrecto.' });
  }

  db.prepare(`
    UPDATE participantes
    SET pin = ?
    WHERE id_participante = ?
  `).run(String(nuevo_pin), user.id_participante);

  res.json({ ok: true, mensaje: 'PIN actualizado correctamente.' });
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
  const totalParticipantes = db.prepare(`
    SELECT COUNT(*) AS total
    FROM participantes
    WHERE activo = 1
  `).get().total;

  const totalPartidos = db.prepare(`
    SELECT COUNT(*) AS total
    FROM partidos
  `).get().total;

  const porPartido = db.prepare(`
    SELECT
      p.id_partido,
      p.fecha,
      p.hora,
      p.equipo_local || ' vs ' || p.equipo_visitante AS partido,
      ? AS esperados,
      COALESCE(SUM(CASE WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL THEN 1 ELSE 0 END), 0) AS registrados,
      ? - COALESCE(SUM(CASE WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL THEN 1 ELSE 0 END), 0) AS pendientes
    FROM partidos p
    LEFT JOIN pronosticos pr ON pr.id_partido = p.id_partido
    GROUP BY p.id_partido, p.fecha, p.hora, p.equipo_local, p.equipo_visitante
    ORDER BY p.fecha, p.hora, p.id_partido
  `).all(totalParticipantes, totalParticipantes);

  const porParticipante = db.prepare(`
    SELECT
      pa.nombre AS participante,
      COALESCE(SUM(CASE WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL THEN 1 ELSE 0 END), 0) AS registrados,
      ? - COALESCE(SUM(CASE WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL THEN 1 ELSE 0 END), 0) AS pendientes
    FROM participantes pa
    LEFT JOIN pronosticos pr ON pr.id_participante = pa.id_participante
    WHERE pa.activo = 1
    GROUP BY pa.id_participante, pa.nombre
    ORDER BY pendientes DESC, participante
  `).all(totalPartidos);

  res.json({ porPartido, porParticipante });
});

app.post('/api/resultados', (req, res) => {
  const { id_partido, goles_local, goles_visitante, admin_pin } = req.body;

  if (!validarAdminPin(admin_pin)) {
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
      let criterio = 'Sin pronóstico';
      let puntos = 0;

      if (pr.pronostico_local !== null && pr.pronostico_visitante !== null) {
        const exacto = pr.pronostico_local === realLocal && pr.pronostico_visitante === realVisitante;
        const aciertaSigno = signo(pr.pronostico_local, pr.pronostico_visitante) === realSigno;

        criterio = 'Sin puntos';
        if (exacto) {
          criterio = 'Score Exacto';
          puntos = 6;
        } else if (aciertaSigno) {
          criterio = 'Ganador/Empate';
          puntos = 2;
        }
      }

      upd.run(criterio, puntos, pr.id_pronostico);
    }
  });

  tx();
}

function validarAdminPin(pin) {
  return pin === (process.env.ADMIN_PIN || 'admin2026');
}

function recalcularPronosticoIndividual(idPronostico, realLocal, realVisitante) {
  const pr = db.prepare(`
    SELECT id_pronostico, pronostico_local, pronostico_visitante
    FROM pronosticos
    WHERE id_pronostico = ?
  `).get(idPronostico);

  if (!pr) return;

  let criterio = 'Sin pronóstico';
  let puntos = 0;

  if (pr.pronostico_local !== null && pr.pronostico_visitante !== null) {
    const exacto = pr.pronostico_local === realLocal && pr.pronostico_visitante === realVisitante;
    const aciertaSigno = signo(pr.pronostico_local, pr.pronostico_visitante) === signo(realLocal, realVisitante);

    criterio = 'Sin puntos';
    if (exacto) {
      criterio = 'Score Exacto';
      puntos = 6;
    } else if (aciertaSigno) {
      criterio = 'Ganador/Empate';
      puntos = 2;
    }
  }

  db.prepare(`
    UPDATE pronosticos
    SET criterio = ?, puntos = ?, estado_partido = 'Registrado'
    WHERE id_pronostico = ?
  `).run(criterio, puntos, idPronostico);
}

app.post('/api/admin/revertir-resultado', (req, res) => {
  const { id_partido, admin_pin } = req.body;

  if (!validarAdminPin(admin_pin)) {
    return res.status(401).json({ error: 'PIN de administrador incorrecto.' });
  }

  const id = Number(id_partido);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Partido inválido.' });
  }

  const partido = db.prepare('SELECT * FROM partidos WHERE id_partido = ?').get(id);
  if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO resultados (id_partido, goles_local, goles_visitante, resultado, estado, actualizado_en)
      VALUES (?, NULL, NULL, NULL, 'Pendiente', CURRENT_TIMESTAMP)
      ON CONFLICT(id_partido)
      DO UPDATE SET
        goles_local = NULL,
        goles_visitante = NULL,
        resultado = NULL,
        estado = 'Pendiente',
        actualizado_en = CURRENT_TIMESTAMP
    `).run(id);

    db.prepare(`UPDATE partidos SET estado = 'Próximo' WHERE id_partido = ?`).run(id);

    db.prepare(`
      UPDATE pronosticos
      SET criterio = 'Pendiente',
          puntos = 0,
          estado_partido = 'Pendiente'
      WHERE id_partido = ?
    `).run(id);
  });

  tx();

  res.json({
    ok: true,
    mensaje: 'Resultado revertido a pendiente.',
    partido: `${partido.equipo_local} vs ${partido.equipo_visitante}`
  });
});

app.post('/api/admin/recalcular-ranking', (req, res) => {
  const { admin_pin } = req.body;

  if (!validarAdminPin(admin_pin)) {
    return res.status(401).json({ error: 'PIN de administrador incorrecto.' });
  }

  const resultados = db.prepare(`
    SELECT id_partido, goles_local, goles_visitante
    FROM resultados
    WHERE estado = 'Registrado'
      AND goles_local IS NOT NULL
      AND goles_visitante IS NOT NULL
  `).all();

  for (const r of resultados) {
    recalcularPuntosPartido(r.id_partido, r.goles_local, r.goles_visitante);
  }

  res.json({ ok: true, recalculados: resultados.length });
});

app.get('/api/admin/control-partido/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Partido inválido.' });
  }

  const partido = db.prepare(`
    SELECT
      p.id_partido,
      p.fecha,
      p.hora,
      p.equipo_local || ' vs ' || p.equipo_visitante AS partido,
      COALESCE(r.resultado, '') AS resultado,
      COALESCE(r.estado, 'Pendiente') AS estado
    FROM partidos p
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    WHERE p.id_partido = ?
  `).get(id);

  if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });

  const registrados = db.prepare(`
    SELECT
      pa.nombre AS participante,
      pr.pronostico_local,
      pr.pronostico_visitante,
      CASE
        WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL
        THEN CAST(pr.pronostico_local AS TEXT) || '-' || CAST(pr.pronostico_visitante AS TEXT)
        ELSE 'SIN PRONÓSTICO'
      END AS pronostico,
      CASE
        WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL
        THEN 1 ELSE 0
      END AS tiene_pronostico,
      CASE
        WHEN pr.pronostico_local IS NOT NULL AND pr.pronostico_visitante IS NOT NULL
        THEN COALESCE(pr.criterio, 'Pendiente')
        ELSE 'Sin pronóstico'
      END AS criterio,
      COALESCE(pr.puntos, 0) AS puntos
    FROM participantes pa
    LEFT JOIN pronosticos pr
      ON pr.id_participante = pa.id_participante
     AND pr.id_partido = ?
    WHERE pa.activo = 1
    ORDER BY pa.nombre
  `).all(id);

  const pendientes = db.prepare(`
    SELECT pa.nombre AS participante
    FROM participantes pa
    LEFT JOIN pronosticos pr
      ON pr.id_participante = pa.id_participante
     AND pr.id_partido = ?
    WHERE pa.activo = 1
      AND (
        pr.id_pronostico IS NULL
        OR pr.pronostico_local IS NULL
        OR pr.pronostico_visitante IS NULL
      )
    ORDER BY pa.nombre
  `).all(id);

  const totalParticipantes = registrados.length;
  const recibidos = registrados.filter(r => r.tiene_pronostico === 1).length;
  const faltantes = pendientes.length;
  const completo = totalParticipantes > 0 && recibidos === totalParticipantes;

  res.json({
    partido,
    registrados,
    pendientes,
    resumen: {
      totalParticipantes,
      recibidos,
      faltantes,
      completo
    }
  });
});

app.get('/api/admin/pronostico', (req, res) => {
  const idPartido = Number(req.query.id_partido);
  const participante = String(req.query.participante || '');

  if (!Number.isInteger(idPartido) || !participante) {
    return res.status(400).json({ error: 'Debe indicar partido y participante.' });
  }

  const row = db.prepare(`
    SELECT
      pr.id_pronostico,
      p.id_partido,
      pa.nombre AS participante,
      p.equipo_local,
      p.equipo_visitante,
      p.equipo_local || ' vs ' || p.equipo_visitante AS partido,
      pr.pronostico_local,
      pr.pronostico_visitante,
      pr.resultado_pronostico,
      COALESCE(pr.criterio, 'Pendiente') AS criterio,
      COALESCE(pr.puntos, 0) AS puntos,
      COALESCE(pr.estado_partido, 'Pendiente') AS estado_partido,
      COALESCE(r.resultado, '') AS resultado,
      COALESCE(r.estado, 'Pendiente') AS estado_resultado
    FROM pronosticos pr
    JOIN participantes pa ON pa.id_participante = pr.id_participante
    JOIN partidos p ON p.id_partido = pr.id_partido
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    WHERE pr.id_partido = ?
      AND pa.nombre = ?
  `).get(idPartido, participante);

  if (!row) return res.status(404).json({ error: 'Pronóstico no encontrado para ese participante y partido.' });
  res.json(row);
});

app.post('/api/admin/editar-pronostico', (req, res) => {
  const { id_partido, participante, pronostico_local, pronostico_visitante, admin_pin } = req.body;

  if (!validarAdminPin(admin_pin)) {
    return res.status(401).json({ error: 'PIN de administrador incorrecto.' });
  }

  const idPartido = Number(id_partido);
  const gl = Number(pronostico_local);
  const gv = Number(pronostico_visitante);

  if (!Number.isInteger(idPartido) || !participante || !Number.isInteger(gl) || !Number.isInteger(gv)) {
    return res.status(400).json({ error: 'Datos de pronóstico inválidos.' });
  }

  const partido = db.prepare('SELECT * FROM partidos WHERE id_partido = ?').get(idPartido);
  if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });

  const persona = db.prepare(`
    SELECT id_participante, nombre
    FROM participantes
    WHERE nombre = ? AND activo = 1
  `).get(participante);

  if (!persona) return res.status(404).json({ error: 'Participante no encontrado.' });

  const existente = db.prepare(`
    SELECT id_pronostico
    FROM pronosticos
    WHERE id_partido = ? AND id_participante = ?
  `).get(idPartido, persona.id_participante);

  let idPronostico;

  if (existente) {
    idPronostico = existente.id_pronostico;
    db.prepare(`
      UPDATE pronosticos
      SET pronostico_local = ?,
          pronostico_visitante = ?,
          resultado_pronostico = ?,
          registrado_en = CURRENT_TIMESTAMP
      WHERE id_pronostico = ?
    `).run(gl, gv, `${gl}-${gv}`, idPronostico);
  } else {
    const info = db.prepare(`
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
    `).run(idPartido, persona.id_participante, gl, gv, `${gl}-${gv}`);

    idPronostico = info.lastInsertRowid;
  }

  const resultado = db.prepare(`
    SELECT goles_local, goles_visitante, estado
    FROM resultados
    WHERE id_partido = ?
  `).get(idPartido);

  if (resultado && resultado.estado === 'Registrado') {
    recalcularPronosticoIndividual(idPronostico, resultado.goles_local, resultado.goles_visitante);
  } else {
    db.prepare(`
      UPDATE pronosticos
      SET criterio = 'Pendiente', puntos = 0, estado_partido = 'Pendiente'
      WHERE id_pronostico = ?
    `).run(idPronostico);
  }

  const actualizado = db.prepare(`
    SELECT resultado_pronostico, criterio, puntos, estado_partido
    FROM pronosticos
    WHERE id_pronostico = ?
  `).get(idPronostico);

  res.json({
    ok: true,
    participante: persona.nombre,
    partido: `${partido.equipo_local} vs ${partido.equipo_visitante}`,
    ...actualizado
  });
});


app.get('/api/partidos-dashboard', (req, res) => {
  const proximos = db.prepare(`
    SELECT 'P' || printf('%03d', p.id_partido) AS id, p.id_partido AS idPartido, p.fecha, p.hora, p.fase, p.grupo,
           p.equipo_local AS local, p.equipo_visitante AS visitante,
           p.equipo_local || ' vs ' || p.equipo_visitante AS partido, 'Próximo' AS estado
    FROM partidos p
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    WHERE COALESCE(r.estado, 'Pendiente') <> 'Registrado'
    ORDER BY p.fecha, p.hora, p.id_partido
  `).all();

  const finalizados = db.prepare(`
    SELECT 'P' || printf('%03d', p.id_partido) AS id, p.id_partido AS idPartido, p.fecha, p.hora, p.fase, p.grupo,
           p.equipo_local AS local, p.equipo_visitante AS visitante,
           p.equipo_local || ' vs ' || p.equipo_visitante AS partido, 'Finalizado' AS estado, r.resultado
    FROM resultados r
    JOIN partidos p ON p.id_partido = r.id_partido
    WHERE r.estado = 'Registrado'
    ORDER BY p.fecha DESC, p.hora DESC, p.id_partido DESC
    LIMIT 6
  `).all();

  const resumen = {
    totalPartidos: db.prepare('SELECT COUNT(*) AS c FROM partidos').get().c,
    finalizados: db.prepare("SELECT COUNT(*) AS c FROM resultados WHERE estado = 'Registrado'").get().c,
    pendientes: db.prepare("SELECT COUNT(*) AS c FROM resultados WHERE COALESCE(estado,'Pendiente') <> 'Registrado'").get().c
  };

  res.json({
    actualizado: new Date().toLocaleString('es-PE', { hour12: false }),
    resumen,
    proximosPartidos: proximos,
    finalizadosRecientes: finalizados.reverse()
  });
});

app.get('/api/detalle-participante/:nombre', (req, res) => {
  const nombre = req.params.nombre;
  const participante = db.prepare(`SELECT id_participante, nombre FROM participantes WHERE nombre = ? AND activo = 1`).get(nombre);
  if (!participante) return res.status(404).json({ error: 'Participante no encontrado.' });

  const ranking = db.prepare(`
    SELECT posicion, participante, partidos_pronosticados AS partidos, score_exactos AS scoreExactos,
           aciertos_ganador_empate AS ganadorEmpate, puntos_totales AS puntos
    FROM v_ranking WHERE participante = ?
  `).get(nombre);

  const detalle = db.prepare(`
    SELECT p.fecha, p.hora, p.fase, p.grupo,
           p.equipo_local || ' vs ' || p.equipo_visitante AS partido,
           pr.resultado_pronostico AS pronostico,
           COALESCE(r.resultado, '') AS resultado,
           pr.criterio, pr.puntos, pr.estado_partido AS estado
    FROM pronosticos pr
    JOIN partidos p ON p.id_partido = pr.id_partido
    LEFT JOIN resultados r ON r.id_partido = p.id_partido
    WHERE pr.id_participante = ?
    ORDER BY p.fecha, p.hora, p.id_partido
  `).all(participante.id_participante);

  res.json({ participante: nombre, ranking, detalle });
});


app.listen(PORT, () => {
  console.log(`Polla Mundial 2026 corriendo en http://localhost:${PORT}`);
});

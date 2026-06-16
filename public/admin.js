async function cargarAdmin() {
  await Promise.all([cargarMetricas(), cargarPartidos(), cargarControl()]);
}

async function cargarMetricas() {
  const data = await fetch('/api/dashboard').then(r => r.json());
  const m = data.metricas || {};
  const lider = data.lider || {};
  document.getElementById('metricas').innerHTML = `
    <div class="statline"><span>Líder</span><b>${lider.participante || '--'} (${lider.puntos_totales || 0})</b></div>
    <div class="statline"><span>Partidos jugados</span><b>${m.partidos_jugados || 0}</b></div>
    <div class="statline"><span>Pronósticos evaluados</span><b>${m.pronosticos_registrados || 0}</b></div>
    <div class="statline"><span>Scores exactos</span><b>${m.score_exactos || 0}</b></div>
  `;
}

async function cargarPartidos() {
  const rows = await fetch('/api/partidos-admin').then(r => r.json());
  document.getElementById('partidoResultado').innerHTML = rows.map(p => `
    <option value="${p.id_partido}">
      P${String(p.id_partido).padStart(3,'0')} · ${p.fecha} ${p.hora || ''} · ${p.partido} · ${p.estado}${p.resultado ? ' · ' + p.resultado : ''}
    </option>
  `).join('');
}

async function cargarControl() {
  const data = await fetch('/api/control-pronosticos').then(r => r.json());
  document.getElementById('controlPartido').innerHTML = data.porPartido.slice(0, 20).map(r => `
    <tr><td>${r.partido}<br><span class="muted">${r.fecha} ${r.hora || ''}</span></td><td>${r.esperados}</td><td>${r.registrados}</td><td>${r.pendientes}</td></tr>
  `).join('');

  document.getElementById('controlParticipante').innerHTML = data.porParticipante.map(r => `
    <tr><td>${r.participante}</td><td>${r.registrados}</td><td>${r.pendientes}</td></tr>
  `).join('');
}

async function guardarResultado() {
  const body = {
    id_partido: Number(document.getElementById('partidoResultado').value),
    goles_local: Number(document.getElementById('golesLocal').value),
    goles_visitante: Number(document.getElementById('golesVisitante').value),
    admin_pin: document.getElementById('adminPin').value
  };
  try {
    const resp = await fetch('/api/resultados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo guardar');
    document.getElementById('resultadoMsg').innerHTML = `✅ ${data.partido}: ${data.resultado}`;
    document.getElementById('golesLocal').value = '';
    document.getElementById('golesVisitante').value = '';
    await cargarAdmin();
  } catch (err) {
    document.getElementById('resultadoMsg').textContent = err.message;
  }
}
cargarAdmin();

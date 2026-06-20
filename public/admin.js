let partidosAdmin = [];
let participantesAdmin = [];

function adminPin() {
  return document.getElementById('adminPin').value;
}

async function cargarAdmin() {
  await Promise.all([
    cargarMetricas(),
    cargarParticipantes(),
    cargarPartidos(),
    cargarControl()
  ]);
  await cargarDetallePartido();
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

async function cargarParticipantes() {
  participantesAdmin = await fetch('/api/participantes').then(r => r.json());
  document.getElementById('participanteEditar').innerHTML = participantesAdmin.map(p => `
    <option value="${p.nombre}">${p.nombre}</option>
  `).join('');
}

async function cargarPartidos() {
  partidosAdmin = await fetch('/api/partidos-admin').then(r => r.json());
  document.getElementById('partidoResultado').innerHTML = partidosAdmin.map(p => `
    <option value="${p.id_partido}">
      P${String(p.id_partido).padStart(3,'0')} · ${p.fecha} ${p.hora || ''} · ${p.partido} · ${p.estado}${p.resultado ? ' · ' + p.resultado : ''}
    </option>
  `).join('');
}

async function cargarControl() {
  const data = await fetch('/api/control-pronosticos').then(r => r.json());

  document.getElementById('controlPartido').innerHTML = data.porPartido.slice(0, 30).map(r => `
    <tr>
      <td>${r.partido}<br><span class="muted">${r.fecha} ${r.hora || ''}</span></td>
      <td>${r.esperados}</td>
      <td>${r.registrados}</td>
      <td>${r.pendientes}</td>
    </tr>
  `).join('');

  document.getElementById('controlParticipante').innerHTML = data.porParticipante.map(r => `
    <tr>
      <td>${r.participante}</td>
      <td>${r.registrados}</td>
      <td>${r.pendientes}</td>
    </tr>
  `).join('');
}

async function cargarDetallePartido() {
  const id = Number(document.getElementById('partidoResultado').value);
  if (!id) return;

  try {
    const data = await fetch('/api/admin/control-partido/' + id).then(r => r.json());
    if (data.error) throw new Error(data.error);

    const p = data.partido;
    document.getElementById('detallePartidoResumen').innerHTML = `
      <b>${p.partido}</b><br>
      <span class="badgeSoft">${p.fecha} ${p.hora || ''}</span>
      <span class="badgeSoft">${p.estado}</span>
      ${p.resultado ? `<span class="badgeSoft">Resultado: ${p.resultado}</span>` : ''}
    `;

    document.getElementById('registradosPartido').innerHTML = (data.registrados || []).map(r => `
      <tr>
        <td>${r.participante}</td>
        <td>${r.pronostico || `${r.pronostico_local}-${r.pronostico_visitante}`}</td>
        <td>${r.criterio || 'Pendiente'}</td>
        <td>${r.puntos || 0}</td>
      </tr>
    `).join('') || '<tr><td colspan="4">Sin pronósticos registrados</td></tr>';

    document.getElementById('pendientesPartido').innerHTML = (data.pendientes || []).map(r => `
      <tr><td>${r.participante}</td></tr>
    `).join('') || '<tr><td>Sin pendientes</td></tr>';

  } catch (err) {
    document.getElementById('detallePartidoResumen').textContent = err.message;
  }
}

async function guardarResultado() {
  const body = {
    id_partido: Number(document.getElementById('partidoResultado').value),
    goles_local: Number(document.getElementById('golesLocal').value),
    goles_visitante: Number(document.getElementById('golesVisitante').value),
    admin_pin: adminPin()
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

async function revertirResultado() {
  const id = Number(document.getElementById('partidoResultado').value);
  const partido = partidosAdmin.find(p => Number(p.id_partido) === id);

  if (!confirm(`¿Seguro que deseas revertir a pendiente el resultado de ${partido ? partido.partido : 'este partido'}? Se pondrán en cero los puntos asociados a ese partido.`)) {
    return;
  }

  try {
    const resp = await fetch('/api/admin/revertir-resultado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_partido: id, admin_pin: adminPin() })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo revertir');

    document.getElementById('resultadoMsg').innerHTML = `↩ ${data.mensaje} ${data.partido}`;
    await cargarAdmin();
  } catch (err) {
    document.getElementById('resultadoMsg').textContent = err.message;
  }
}

async function recalcularRanking() {
  try {
    const resp = await fetch('/api/admin/recalcular-ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_pin: adminPin() })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo recalcular');

    document.getElementById('recalculoMsg').innerHTML = `✅ Ranking recalculado. Partidos procesados: ${data.recalculados}`;
    await cargarAdmin();
  } catch (err) {
    document.getElementById('recalculoMsg').textContent = err.message;
  }
}

async function buscarPronostico() {
  const id = Number(document.getElementById('partidoResultado').value);
  const participante = document.getElementById('participanteEditar').value;

  try {
    const resp = await fetch(`/api/admin/pronostico?id_partido=${id}&participante=${encodeURIComponent(participante)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se encontró pronóstico');

    document.getElementById('pronLocal').value = data.pronostico_local ?? '';
    document.getElementById('pronVisitante').value = data.pronostico_visitante ?? '';
    document.getElementById('editarMsg').innerHTML = `
      🔎 ${data.participante} · ${data.partido}: ${data.resultado_pronostico || '-'}
      · ${data.criterio || 'Pendiente'} · ${data.puntos || 0} pts
    `;
  } catch (err) {
    document.getElementById('pronLocal').value = '';
    document.getElementById('pronVisitante').value = '';
    document.getElementById('editarMsg').textContent = err.message + '. Puedes registrar uno nuevo usando los campos.';
  }
}

async function editarPronostico() {
  const body = {
    id_partido: Number(document.getElementById('partidoResultado').value),
    participante: document.getElementById('participanteEditar').value,
    pronostico_local: Number(document.getElementById('pronLocal').value),
    pronostico_visitante: Number(document.getElementById('pronVisitante').value),
    admin_pin: adminPin()
  };

  try {
    const resp = await fetch('/api/admin/editar-pronostico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo editar');

    document.getElementById('editarMsg').innerHTML =
      `✅ ${data.participante} · ${data.partido}: ${data.resultado_pronostico} · ${data.criterio} · ${data.puntos} pts`;

    document.getElementById('pronLocal').value = '';
    document.getElementById('pronVisitante').value = '';

    await cargarAdmin();
  } catch (err) {
    document.getElementById('editarMsg').textContent = err.message;
  }
}

cargarAdmin();

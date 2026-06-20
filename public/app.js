let session = null;
let partidosActuales = [];

function $(id) {
  return document.getElementById(id);
}

async function init() {
  const participantes = await fetch('/api/participantes').then(r => r.json());
  $('participante').innerHTML = '<option value="">Seleccionar...</option>' +
    participantes.map(p => `<option>${p.nombre}</option>`).join('');
}

async function login() {
  const participante = $('participante').value;
  const pin = $('pin').value;

  $('loginMsg').textContent = '';

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participante, pin })
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error de login');

    session = { participante, pin };
    $('loginCard').classList.add('hidden');
    $('pronosticosCard').classList.remove('hidden');
    $('tituloPronosticos').textContent = `Pronósticos de ${participante}`;

    await cargarPartidos();
    await cargarMisPronosticos();

  } catch (err) {
    $('loginMsg').textContent = err.message;
  }
}

async function cargarPartidos() {
  const resp = await fetch('/api/partidos-pendientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session)
  });

  const data = await resp.json();
  partidosActuales = data.partidos || [];

  if (partidosActuales.length === 0) {
    $('partidos').innerHTML = '<div class="empty">No hay partidos pendientes disponibles.</div>';
    return;
  }

  $('partidos').innerHTML = partidosActuales.map(p => {
    const disabled = p.bloqueado ? 'disabled' : '';
    const tag = p.bloqueado ? 'Bloqueado' : (p.ya_registrado ? 'Ya registrado' : 'Pendiente');
    return `
      <div class="match ${p.bloqueado ? 'blocked' : ''}">
        <div class="matchHeader">
          <div>
            <b>${p.equipo_local} vs ${p.equipo_visitante}</b>
            <span>${p.fecha} · ${p.hora || '--'} · Grupo ${p.grupo || '-'}</span>
          </div>
          <em>${tag}</em>
        </div>
        <div class="scoreRow">
          <span>${p.equipo_local}</span>
          <input ${disabled} type="number" min="0" id="l_${p.id_partido}" value="${p.pronostico_local ?? ''}" placeholder="0" oninput="actualizarContador()">
          <strong>-</strong>
          <input ${disabled} type="number" min="0" id="v_${p.id_partido}" value="${p.pronostico_visitante ?? ''}" placeholder="0" oninput="actualizarContador()">
          <span>${p.equipo_visitante}</span>
        </div>
      </div>
    `;
  }).join('');
}

function leerPronosticos() {
  return partidosActuales
    .filter(p => !p.bloqueado)
    .map(p => {
      const local = $(`l_${p.id_partido}`).value;
      const visitante = $(`v_${p.id_partido}`).value;
      return {
        id_partido: p.id_partido,
        partido: `${p.equipo_local} vs ${p.equipo_visitante}`,
        pronostico_local: local === '' ? null : Number(local),
        pronostico_visitante: visitante === '' ? null : Number(visitante)
      };
    })
    .filter(p => Number.isInteger(p.pronostico_local) && Number.isInteger(p.pronostico_visitante));
}

function mostrarResumen() {
  const pronosticos = leerPronosticos();

  if (pronosticos.length === 0) {
    $('formMsg').textContent = 'Debes ingresar al menos un pronóstico.';
    return;
  }

  $('formMsg').textContent = '';
  $('pronosticosCard').classList.add('hidden');
  $('resumenCard').classList.remove('hidden');

  $('resumen').innerHTML = pronosticos.map(p => `
    <div class="summaryLine">
      <span>${p.partido}</span>
      <b>${p.pronostico_local}-${p.pronostico_visitante}</b>
    </div>
  `).join('');
  actualizarContador();
}

async function guardarPronosticos() {
  const pronosticos = leerPronosticos();

  try {
    const resp = await fetch('/api/pronosticos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...session, pronosticos })
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo guardar');

    $('saveMsg').innerHTML = `✅ Registrados: ${data.registrados.length}. Bloqueados: ${data.bloqueados.length}.`;
    await cargarPartidos();
    await cargarMisPronosticos();

  } catch (err) {
    $('saveMsg').textContent = err.message;
  }
}

function volverEditar() {
  $('resumenCard').classList.add('hidden');
  $('pronosticosCard').classList.remove('hidden');
}


function actualizarContador() {
  const c = document.getElementById('contador');
  if (!c || !partidosActuales.length) return;
  const completados = leerPronosticos().length;
  const editables = partidosActuales.filter(p => !p.bloqueado).length;
  c.textContent = `Completados: ${completados} de ${editables} partidos editables`;
}

async function cargarMisPronosticos() {
  if (!session) return;
  try {
    const resp = await fetch('/api/mis-pronosticos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    });
    const data = await resp.json();
    const cont = document.getElementById('misPronosticos');
    if (!cont) return;
    const rows = data.pronosticos || [];
    if (!rows.length) {
      cont.innerHTML = '<div class="empty">Aún no tienes pronósticos registrados.</div>';
      return;
    }
    cont.innerHTML = `
      <div class="tableWrap">
        <table>
          <thead><tr><th>Fecha</th><th>Partido</th><th>Pronóstico</th><th>Resultado</th><th>Puntos</th></tr></thead>
          <tbody>
            ${rows.slice(0, 20).map(r => `
              <tr>
                <td>${r.fecha}<br><span class="muted">${r.hora || '--'}</span></td>
                <td>${r.partido}</td>
                <td>${r.pronostico}</td>
                <td>${r.resultado_real || '-'}</td>
                <td>${r.puntos || 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error(err);
  }
}

function salir() {
  session = null;
  partidosActuales = [];
  $('pin').value = '';
  $('loginCard').classList.remove('hidden');
  $('pronosticosCard').classList.add('hidden');
  $('resumenCard').classList.add('hidden');
}

init();



function mostrarCambioPin() {
  const card = document.getElementById('cambiarPinCard');
  if (!card) return;
  card.classList.remove('hidden');
  document.getElementById('cambioPinMsg').textContent = '';
  document.getElementById('pinActualCambio').value = '';
  document.getElementById('nuevoPinCambio').value = '';
  document.getElementById('confirmarPinCambio').value = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ocultarCambioPin() {
  const card = document.getElementById('cambiarPinCard');
  if (card) card.classList.add('hidden');
}

async function cambiarPin() {
  if (!session) return;

  const pinActual = document.getElementById('pinActualCambio').value.trim();
  const nuevoPin = document.getElementById('nuevoPinCambio').value.trim();
  const confirmarPin = document.getElementById('confirmarPinCambio').value.trim();
  const msg = document.getElementById('cambioPinMsg');

  msg.textContent = '';

  if (!/^\d{4}$/.test(nuevoPin)) {
    msg.textContent = 'El nuevo PIN debe tener exactamente 4 dígitos.';
    return;
  }

  if (nuevoPin !== confirmarPin) {
    msg.textContent = 'La confirmación del PIN no coincide.';
    return;
  }

  try {
    const resp = await fetch('/api/cambiar-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participante: session.participante,
        pin_actual: pinActual,
        nuevo_pin: nuevoPin,
        confirmar_pin: confirmarPin
      })
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'No se pudo cambiar el PIN.');

    msg.innerHTML = '✅ PIN actualizado correctamente. Vuelve a ingresar con tu nuevo PIN.';
    session.pin = nuevoPin;

    document.getElementById('pinActualCambio').value = '';
    document.getElementById('nuevoPinCambio').value = '';
    document.getElementById('confirmarPinCambio').value = '';
  } catch (err) {
    msg.textContent = err.message;
  }
}


// Si el frontend se sirve desde el mismo servidor Express, deja API_BASE = '/api'.
// Si lo sirves aparte (ej. otro puerto/dominio), cambia esto por la URL completa,
// ej: 'http://localhost:3000/api'
const API_BASE = 'http://localhost:3000/api';

async function apiRequest(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta vacía */ }
  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    throw new Error(message);
  }
  return data;
}

function apiGet(path) {
  return apiRequest(path);
}
function apiPost(path, body) {
  return apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
}
function apiPut(path, body) {
  return apiRequest(path, { method: 'PUT', body: JSON.stringify(body) });
}
function apiDelete(path) {
  return apiRequest(path, { method: 'DELETE' });
}
// Requiere que api.js esté cargado antes que este archivo (apiGet/apiPost/apiPut/apiDelete).

let clients = [];
let devices = [];
let services = [];
let quotations = [];
let editingServiceId = null; // null = creando servicio nuevo, si tiene valor = editando ese servicio
let editingQuoteId = null; // null = creando cotización nueva, si tiene valor = editando esa cotización
let quoteItemsTemp = []; // items en edición dentro del modal de cotización (solo en memoria, no vienen de la BD)
let currentDetail = null; // {type: 'client'|'device'|'quote', id} - para refrescar el modal de detalle si está abierto

// Genera un id temporal SOLO para los ítems de cotización que aún no se han guardado.
function tempId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

async function loadAll() {
  const [c, d, s, q] = await Promise.all([
    apiGet('/clients'),
    apiGet('/devices'),
    apiGet('/services'),
    apiGet('/quotations')
  ]);
  clients = c; devices = d; services = s; quotations = q;
  updateStats();
}

function formatPriceInput(input) {
  const raw = input.value.replace(/\D/g, '');
  input.value = raw ? parseInt(raw, 10).toLocaleString('es-CO') : '';
}

function rawPrice(value) {
  return value.replace(/\D/g, '');
}

function updateStats() {
  document.getElementById('statClients').textContent = clients.length;
  document.getElementById('statDevices').textContent = devices.length;
  const pending = services.filter(s => s.status === 'Pendiente' || s.status === 'Autorizado').length;
  document.getElementById('statPending').textContent = pending;
  const now = Date.now();
  const dueCount = services.filter(s => s.reminderDate && !s.reminderDone && s.reminderDate <= now).length;
  document.getElementById('statReminders').textContent = dueCount;
}

function switchTab(tab) {
  ['clients','devices','quotes','history','reminders'].forEach(t => {
    document.getElementById('view-' + t).classList.add('hidden');
    document.getElementById('tab-' + t).classList.remove('active');
  });
  document.getElementById('view-' + tab).classList.remove('hidden');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'clients') renderClients();
  if (tab === 'devices') renderDevices();
  if (tab === 'quotes') renderQuotes();
  if (tab === 'history') renderHistory();
  if (tab === 'reminders') renderReminders();
}

function renderClients() {
  const q = document.getElementById('searchClients').value.toLowerCase();
  const list = document.getElementById('clientsList');
  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.phone.includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  ).sort((a,b) => b.createdAt - a.createdAt);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>No hay clientes registrados.<br>Comienza agregando uno nuevo.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(c => {
    const devCount = devices.filter(d => d.clientId === c._id).length;
    const svcCount = services.filter(s => {
      const d = devices.find(x => x._id === s.deviceId);
      return d && d.clientId === c._id;
    }).length;
    return `
      <div class="client-row" onclick="showClientDetail('${c._id}')">
        <div class="client-info">
          <h4>${c.name}</h4>
          <span>📞 ${c.phone}${c.email ? ' &nbsp;|&nbsp; ✉️ ' + c.email : ''}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="tag">${devCount} equipo${devCount!==1?'s':''}</span>
          <span class="tag">${svcCount} servicio${svcCount!==1?'s':''}</span>
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openDeviceModal('${c._id}')">+ Equipo</button>
        </div>
      </div>`;
  }).join('');
}

async function saveClient() {
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  if (!name || !phone) { alert('Nombre y teléfono son obligatorios'); return; }
  try {
    const newClient = await apiPost('/clients', {
      name, phone,
      email: document.getElementById('cEmail').value.trim(),
      address: document.getElementById('cAddress').value.trim()
    });
    clients.push(newClient);
    updateStats();
    closeModal('client');
    ['cName','cPhone','cEmail','cAddress'].forEach(id => document.getElementById(id).value = '');
    renderClients();
  } catch (err) {
    alert('Error al guardar el cliente: ' + err.message);
  }
}

function renderDevices() {
  const q = document.getElementById('searchDevices').value.toLowerCase();
  const list = document.getElementById('devicesList');
  const filtered = devices.filter(d =>
    d.brand.toLowerCase().includes(q) ||
    (d.model || '').toLowerCase().includes(q) ||
    (d.serial || '').toLowerCase().includes(q) ||
    d.type.toLowerCase().includes(q)
  ).sort((a,b) => b.createdAt - a.createdAt);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>No hay equipos registrados.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(d => {
    const client = clients.find(c => c._id === d.clientId);
    const svcCount = services.filter(s => s.deviceId === d._id).length;
    const lastSvc = services.filter(s => s.deviceId === d._id).sort((a,b) => b.date - a.date)[0];
    return `
      <div class="client-row" onclick="showDeviceDetail('${d._id}')">
        <div class="client-info">
          <h4>${d.type} ${d.brand} ${d.model || ''}</h4>
          <span>👤 ${client ? client.name : 'Sin cliente'} &nbsp;|&nbsp; Serial: ${d.serial || 'N/A'}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="tag">${svcCount} servicio${svcCount!==1?'s':''}</span>
          ${lastSvc ? `<span class="badge badge-${lastSvc.status.toLowerCase()}">${lastSvc.status}</span>` : ''}
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openServiceModal('${d._id}')">+ Servicio</button>
        </div>
      </div>`;
  }).join('');
}

function populateClientSelect(selId, preselect) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option value="">Selecciona un cliente...</option>' +
    clients.slice().sort((a,b) => a.name.localeCompare(b.name)).map(c =>
      `<option value="${c._id}" ${preselect===c._id?'selected':''}>${c.name} - ${c.phone}</option>`
    ).join('');
}

function populateDeviceSelect(selId, preselect, clientId) {
  const sel = document.getElementById(selId);
  let devs = devices;
  if (clientId) devs = devices.filter(d => d.clientId === clientId);
  sel.innerHTML = '<option value="">Selecciona un equipo...</option>' +
    devs.slice().sort((a,b) => b.createdAt - a.createdAt).map(d => {
      const c = clients.find(x => x._id === d.clientId);
      return `<option value="${d._id}" ${preselect===d._id?'selected':''}>${d.type} ${d.brand} ${d.model||''} - ${c?c.name:'Sin cliente'}</option>`;
    }).join('');
}

async function saveDevice() {
  const clientId = document.getElementById('dClientId').value;
  const brand = document.getElementById('dBrand').value.trim();
  if (!clientId) { alert('Selecciona un cliente'); return; }
  if (!brand) { alert('La marca es obligatoria'); return; }
  try {
    const newDevice = await apiPost('/devices', {
      clientId,
      type: document.getElementById('dType').value,
      brand,
      model: document.getElementById('dModel').value.trim(),
      serial: document.getElementById('dSerial').value.trim(),
      specs: document.getElementById('dSpecs').value.trim()
    });
    devices.push(newDevice);
    updateStats();
    closeModal('device');
    ['dBrand','dModel','dSerial','dSpecs'].forEach(id => document.getElementById(id).value = '');
    renderDevices();
  } catch (err) {
    alert('Error al guardar el equipo: ' + err.message);
  }
}

function renderHistory() {
  const q = document.getElementById('searchHistory').value.toLowerCase();
  const list = document.getElementById('historyList');
  const filtered = services.filter(s => {
    const d = devices.find(x => x._id === s.deviceId);
    const c = d ? clients.find(x => x._id === d.clientId) : null;
    return (s.description || '').toLowerCase().includes(q) ||
           (s.serviceType || '').toLowerCase().includes(q) ||
           (s.notes || '').toLowerCase().includes(q) ||
           (c && c.name.toLowerCase().includes(q)) ||
           (d && d.brand.toLowerCase().includes(q));
  }).sort((a,b) => b.date - a.date);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>No hay servicios registrados.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(s => {
    const d = devices.find(x => x._id === s.deviceId);
    const c = d ? clients.find(x => x._id === d.clientId) : null;
    const dateStr = new Date(s.date).toLocaleDateString('es-CO', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return `
      <div class="history-item">
        <div class="history-date">${dateStr}</div>
        <div class="history-title">${s.serviceType} - ${d ? d.type + ' ' + d.brand + ' ' + (d.model||'') : 'Equipo eliminado'}</div>
        <div class="history-desc">👤 ${c ? c.name : 'Cliente desconocido'} &nbsp;|&nbsp; ${s.description.substring(0,120)}${s.description.length>120?'...':''}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span class="badge badge-${s.status.toLowerCase()}">${s.status}</span>
          ${s.price ? `<span class="history-price">$${parseFloat(s.price).toLocaleString('es-CO')}</span>` : ''}
        </div>
        ${s.reminderDate ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">🔔 Próximo mantenimiento: ${new Date(s.reminderDate).toLocaleDateString('es-CO')}</div>` : ''}
        ${s.notes ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px; font-style:italic;">📝 ${s.notes}</div>` : ''}
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn-sm btn-secondary" onclick="editService('${s._id}')">✏️ Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteService('${s._id}')">🗑️ Eliminar</button>
        </div>
      </div>`;
  }).join('');
}

function clearServiceForm() {
  ['sDescription','sPrice','sNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sReminderMonths').value = '';
}

async function saveService() {
  const deviceId = document.getElementById('sDeviceId').value;
  const description = document.getElementById('sDescription').value.trim();
  if (!deviceId) { alert('Selecciona un equipo'); return; }
  if (!description) { alert('La descripción es obligatoria'); return; }
  const months = parseInt(document.getElementById('sReminderMonths').value) || 0;
  let reminderDate = null;
  if (months > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    reminderDate = d.getTime();
  }

  const payload = {
    deviceId,
    serviceType: document.getElementById('sServiceType').value,
    description,
    price: rawPrice(document.getElementById('sPrice').value),
    status: document.getElementById('sStatus').value,
    notes: document.getElementById('sNotes').value.trim()
  };
  // Solo se toca el recordatorio si el usuario indicó meses (igual que la lógica original)
  if (months > 0) { payload.reminderDate = reminderDate; payload.reminderDone = false; }

  try {
    if (editingServiceId) {
      const updated = await apiPut(`/services/${editingServiceId}`, payload);
      const idx = services.findIndex(s => s._id === editingServiceId);
      if (idx !== -1) services[idx] = updated;
    } else {
      const created = await apiPost('/services', payload);
      services.push(created);
    }
  } catch (err) {
    alert('Error al guardar el servicio: ' + err.message);
    return;
  }

  updateStats();
  closeModal('service');
  clearServiceForm();
  editingServiceId = null;
  document.getElementById('serviceModalTitle').textContent = '📋 Nuevo Servicio / Cotización';
  document.getElementById('serviceSaveBtn').textContent = 'Guardar Servicio';
  renderHistory();
  if (!document.getElementById('view-devices').classList.contains('hidden')) renderDevices();
  refreshDetailIfOpen();
}

function editService(id) {
  const s = services.find(x => x._id === id);
  if (!s) return;
  editingServiceId = id;
  openModal('service');
  populateDeviceSelect('sDeviceId', s.deviceId);
  document.getElementById('sServiceType').value = s.serviceType;
  document.getElementById('sDescription').value = s.description;
  document.getElementById('sPrice').value = s.price ? parseInt(s.price, 10).toLocaleString('es-CO') : '';
  document.getElementById('sStatus').value = s.status;
  document.getElementById('sNotes').value = s.notes || '';
  document.getElementById('sReminderMonths').value = '';
  document.getElementById('serviceModalTitle').textContent = '✏️ Editar Servicio';
  document.getElementById('serviceSaveBtn').textContent = 'Guardar Cambios';
}

async function deleteService(id) {
  if (!confirm('¿Eliminar este servicio? Esta acción no se puede deshacer.')) return;
  try {
    await apiDelete(`/services/${id}`);
    services = services.filter(s => s._id !== id);
    updateStats();
    renderHistory();
    renderReminders();
    if (!document.getElementById('view-devices').classList.contains('hidden')) renderDevices();
    refreshDetailIfOpen();
  } catch (err) {
    alert('Error al eliminar el servicio: ' + err.message);
  }
}

function refreshDetailIfOpen() {
  if (document.getElementById('modal-detail').classList.contains('hidden') || !currentDetail) return;
  if (currentDetail.type === 'client') showClientDetail(currentDetail.id);
  else if (currentDetail.type === 'device') showDeviceDetail(currentDetail.id);
  else if (currentDetail.type === 'quote') showQuoteDetail(currentDetail.id);
}

function renderReminders() {
  const list = document.getElementById('remindersList');
  const now = Date.now();
  const upcoming = services.filter(s => s.reminderDate && !s.reminderDone)
    .sort((a,b) => a.reminderDate - b.reminderDate);

  if (!upcoming.length) {
    list.innerHTML = `<div class="empty-state"><p>No hay recordatorios programados.</p></div>`;
    return;
  }

  list.innerHTML = upcoming.map(s => {
    const d = devices.find(x => x._id === s.deviceId);
    const c = d ? clients.find(x => x._id === d.clientId) : null;
    const overdue = s.reminderDate <= now;
    const dateStr = new Date(s.reminderDate).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
    return `
      <div class="reminder-item ${overdue ? 'overdue' : ''}">
        <div class="history-date">${dateStr}</div>
        <div class="history-title">${d ? d.type + ' ' + d.brand + ' ' + (d.model||'') : 'Equipo eliminado'}</div>
        <div class="history-desc">👤 ${c ? c.name : 'Cliente desconocido'} ${c ? '&nbsp;|&nbsp; 📞 ' + c.phone : ''}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span class="reminder-badge ${overdue ? 'overdue' : ''}">${overdue ? 'Vencido - contactar cliente' : 'Próximo'}</span>
          <button class="btn btn-sm btn-secondary" onclick="dismissReminder('${s._id}')">✔️ Marcar hecho</button>
        </div>
      </div>`;
  }).join('');
}

async function dismissReminder(serviceId) {
  try {
    const updated = await apiPut(`/services/${serviceId}`, { reminderDone: true });
    const idx = services.findIndex(s => s._id === serviceId);
    if (idx !== -1) services[idx] = updated;
    updateStats();
    renderReminders();
  } catch (err) {
    alert('Error al actualizar el recordatorio: ' + err.message);
  }
}

function showClientDetail(clientId) {
  const c = clients.find(x => x._id === clientId);
  if (!c) return;
  const clientDevices = devices.filter(d => d.clientId === clientId);
  const clientServices = services.filter(s => {
    const d = devices.find(x => x._id === s.deviceId);
    return d && d.clientId === clientId;
  }).sort((a,b) => b.date - a.date);

  document.getElementById('detailTitle').innerHTML = '👤 ' + c.name;
  let html = `
    <div style="margin-bottom:20px;">
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">📞 ${c.phone}</p>
      ${c.email ? `<p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">✉️ ${c.email}</p>` : ''}
      ${c.address ? `<p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">📍 ${c.address}</p>` : ''}
    </div>
    <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" onclick="openDeviceModal('${c._id}')">+ Agregar Equipo</button>
      <button class="btn btn-primary btn-sm" onclick="openQuoteModal('${c._id}')">🧾 Nueva Cotización</button>
      <button class="btn btn-secondary btn-sm" onclick="editClient('${c._id}')">✏️ Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteClient('${c._id}')">🗑️ Eliminar</button>
    </div>
  `;

  html += '<h3 style="font-size:16px; margin:20px 0 12px;">💻 Equipos registrados</h3>';
  if (!clientDevices.length) {
    html += '<p style="color:var(--text-secondary); font-size:14px;">No hay equipos registrados.</p>';
  } else {
    html += clientDevices.map(d => {
      const svc = services.filter(s => s.deviceId === d._id).sort((a,b) => b.date - a.date);
      const last = svc[0];
      return `
        <div class="device-card">
          <div class="device-header">
            <h5>${d.type} ${d.brand} ${d.model||''}</h5>
            ${last ? `<span class="badge badge-${last.status.toLowerCase()}">${last.status}</span>` : '<span class="badge" style="background:#eef0f5;color:#6b6d80;">Sin servicios</span>'}
          </div>
          <div class="device-meta">Serial: ${d.serial||'N/A'} &nbsp;|&nbsp; ${svc.length} servicio${svc.length!==1?'s':''}</div>
          ${d.specs ? `<div class="device-meta" style="margin-top:4px;">🖥️ ${d.specs}</div>` : ''}
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="openServiceModal('${d._id}')">+ Servicio</button>
            <button class="btn btn-sm btn-secondary" onclick="showDeviceDetail('${d._id}')">Ver historial</button>
          </div>
        </div>`;
    }).join('');
  }

  html += '<h3 style="font-size:16px; margin:24px 0 12px;">📋 Historial de servicios</h3>';
  if (!clientServices.length) {
    html += '<p style="color:var(--text-secondary); font-size:14px;">No hay servicios registrados.</p>';
  } else {
    html += clientServices.map(s => {
      const d = devices.find(x => x._id === s.deviceId);
      const dateStr = new Date(s.date).toLocaleDateString('es-CO', { year:'numeric', month:'short', day:'numeric' });
      return `
        <div class="history-item">
          <div class="history-date">${dateStr} &nbsp;|&nbsp; ${d ? d.type + ' ' + d.brand : 'Equipo'}</div>
          <div class="history-title">${s.serviceType}</div>
          <div class="history-desc">${s.description}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            <span class="badge badge-${s.status.toLowerCase()}">${s.status}</span>
            ${s.price ? `<span class="history-price">$${parseFloat(s.price).toLocaleString('es-CO')}</span>` : ''}
          </div>
          ${s.reminderDate ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">🔔 Próximo mantenimiento: ${new Date(s.reminderDate).toLocaleDateString('es-CO')}</div>` : ''}
          ${s.notes ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px; font-style:italic;">📝 ${s.notes}</div>` : ''}
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn btn-sm btn-secondary" onclick="editService('${s._id}')">✏️ Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteService('${s._id}')">🗑️ Eliminar</button>
          </div>
        </div>`;
    }).join('');
  }

  document.getElementById('detailContent').innerHTML = html;
  currentDetail = { type: 'client', id: clientId };
  openModal('detail');
}

function showDeviceDetail(deviceId) {
  const d = devices.find(x => x._id === deviceId);
  if (!d) return;
  const c = clients.find(x => x._id === d.clientId);
  const svc = services.filter(s => s.deviceId === deviceId).sort((a,b) => b.date - a.date);

  document.getElementById('detailTitle').innerHTML = '💻 ' + d.type + ' ' + d.brand + ' ' + (d.model||'');
  let html = `
    <div style="margin-bottom:20px;">
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">👤 Cliente: ${c ? c.name : 'Desconocido'}</p>
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">🔢 Serial: ${d.serial||'N/A'}</p>
      ${d.specs ? `<p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">🖥️ ${d.specs}</p>` : ''}
    </div>
    <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" onclick="openServiceModal('${d._id}')">+ Nuevo Servicio</button>
      <button class="btn btn-secondary btn-sm" onclick="editDevice('${d._id}')">✏️ Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteDevice('${d._id}')">🗑️ Eliminar</button>
    </div>
    <h3 style="font-size:16px; margin:20px 0 12px;">📋 Historial completo del equipo</h3>
  `;

  if (!svc.length) {
    html += '<p style="color:var(--text-secondary); font-size:14px;">Este equipo no tiene servicios registrados.</p>';
  } else {
    html += svc.map(s => {
      const dateStr = new Date(s.date).toLocaleDateString('es-CO', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="history-item">
          <div class="history-date">${dateStr}</div>
          <div class="history-title">${s.serviceType}</div>
          <div class="history-desc">${s.description}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            <span class="badge badge-${s.status.toLowerCase()}">${s.status}</span>
            ${s.price ? `<span class="history-price">$${parseFloat(s.price).toLocaleString('es-CO')}</span>` : ''}
          </div>
          ${s.reminderDate ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">🔔 Próximo mantenimiento: ${new Date(s.reminderDate).toLocaleDateString('es-CO')}</div>` : ''}
          ${s.notes ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px; font-style:italic;">📝 ${s.notes}</div>` : ''}
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn btn-sm btn-secondary" onclick="editService('${s._id}')">✏️ Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteService('${s._id}')">🗑️ Eliminar</button>
          </div>
        </div>`;
    }).join('');
  }

  document.getElementById('detailContent').innerHTML = html;
  currentDetail = { type: 'device', id: deviceId };
  openModal('detail');
}

async function editClient(id) {
  const c = clients.find(x => x._id === id);
  if (!c) return;
  const name = prompt('Nombre:', c.name);
  if (name === null) return;
  const phone = prompt('Teléfono:', c.phone);
  if (phone === null) return;
  const emailInput = prompt('Email:', c.email || '');
  const addressInput = prompt('Dirección:', c.address || '');
  try {
    const updated = await apiPut(`/clients/${id}`, {
      name: name.trim() || c.name,
      phone: phone.trim() || c.phone,
      email: emailInput !== null ? emailInput.trim() : c.email,
      address: addressInput !== null ? addressInput.trim() : c.address
    });
    Object.assign(c, updated);
    renderClients();
    showClientDetail(id);
  } catch (err) {
    alert('Error al actualizar el cliente: ' + err.message);
  }
}

async function deleteClient(id) {
  if (!confirm('¿Eliminar este cliente y todos sus equipos/servicios?')) return;
  try {
    await apiDelete(`/clients/${id}`);
    const devIds = devices.filter(d => d.clientId === id).map(d => d._id);
    services = services.filter(s => !devIds.includes(s.deviceId));
    devices = devices.filter(d => d.clientId !== id);
    clients = clients.filter(c => c._id !== id);
    updateStats();
    closeModal('detail');
    renderClients();
    renderDevices();
    renderHistory();
  } catch (err) {
    alert('Error al eliminar el cliente: ' + err.message);
  }
}

async function editDevice(id) {
  const d = devices.find(x => x._id === id);
  if (!d) return;
  const brand = prompt('Marca:', d.brand);
  if (brand === null) return;
  const modelInput = prompt('Modelo:', d.model || '');
  const serialInput = prompt('Serial:', d.serial || '');
  const specsInput = prompt('Especificaciones:', d.specs || '');
  try {
    const updated = await apiPut(`/devices/${id}`, {
      brand: brand.trim() || d.brand,
      model: modelInput !== null ? modelInput.trim() : d.model,
      serial: serialInput !== null ? serialInput.trim() : d.serial,
      specs: specsInput !== null ? specsInput.trim() : d.specs
    });
    Object.assign(d, updated);
    renderDevices();
    showDeviceDetail(id);
  } catch (err) {
    alert('Error al actualizar el equipo: ' + err.message);
  }
}

async function deleteDevice(id) {
  if (!confirm('¿Eliminar este equipo y todo su historial?')) return;
  try {
    await apiDelete(`/devices/${id}`);
    services = services.filter(s => s.deviceId !== id);
    devices = devices.filter(d => d._id !== id);
    updateStats();
    closeModal('detail');
    renderDevices();
    renderHistory();
  } catch (err) {
    alert('Error al eliminar el equipo: ' + err.message);
  }
}

function openModal(name) {
  // Cierra cualquier otro modal que esté abierto antes de mostrar el nuevo
  document.querySelectorAll('.modal-overlay').forEach(m => {
    if (m.id !== 'modal-' + name) m.classList.add('hidden');
  });
  document.getElementById('modal-' + name).classList.remove('hidden');
  if (name === 'device') populateClientSelect('dClientId');
  if (name === 'service') populateDeviceSelect('sDeviceId');
  if (name === 'quote') populateClientSelect('qClientId');
}
function closeModal(name) { document.getElementById('modal-' + name).classList.add('hidden'); }
function closeModalOnOverlay(e, name) { if (e.target.id === 'modal-' + name) closeModal(name); }

function openDeviceModal(clientId) {
  openModal('device');
  populateClientSelect('dClientId', clientId);
}
function openServiceModal(deviceId) {
  editingServiceId = null;
  clearServiceForm();
  document.getElementById('serviceModalTitle').textContent = '📋 Nuevo Servicio / Cotización';
  document.getElementById('serviceSaveBtn').textContent = 'Guardar Servicio';
  openModal('service');
  populateDeviceSelect('sDeviceId', deviceId);
}

/* ==================== COTIZACIONES ==================== */

function renderQuotes() {
  const q = document.getElementById('searchQuotes').value.toLowerCase();
  const list = document.getElementById('quotesList');
  const filtered = quotations.filter(x =>
    x.number.toLowerCase().includes(q) ||
    x.clientName.toLowerCase().includes(q)
  ).sort((a,b) => b.date - a.date);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>No hay cotizaciones registradas.<br>Comienza creando una nueva.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(x => {
    const total = x.items.reduce((s,it) => s + (it.qty||0) * (parseFloat(it.price)||0), 0);
    const dateStr = new Date(x.date).toLocaleDateString('es-CO', { year:'numeric', month:'short', day:'numeric' });
    const status = x.status || 'Pendiente';
    return `
      <div class="client-row" onclick="showQuoteDetail('${x._id}')">
        <div class="client-info">
          <h4>Cotización No. ${x.number}</h4>
          <span>👤 ${x.clientName} &nbsp;|&nbsp; ${dateStr}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="badge badge-${status.toLowerCase()}">${status}</span>
          <span class="history-price" style="margin:0;">$${total.toLocaleString('es-CO')}</span>
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); printQuote('${x._id}')">🖨️ Imprimir</button>
        </div>
      </div>`;
  }).join('');
}

function newQuoteItem() {
  return { id: tempId(), desc: '', qty: 1, price: '' };
}

function renderQuoteItemsForm() {
  const c = document.getElementById('quoteItemsContainer');
  c.innerHTML = quoteItemsTemp.map(it => `
    <div class="qi-row" data-item-id="${it.id}">
      <input type="number" min="1" class="qi-input qi-qty" value="${it.qty}" placeholder="Cant." oninput="updateQuoteItem('${it.id}','qty',this.value)">
      <input type="text" class="qi-input qi-desc" value="${(it.desc||'').replace(/"/g,'&quot;')}" placeholder="Descripción del ítem" oninput="updateQuoteItem('${it.id}','desc',this.value)">
      <input type="text" inputmode="numeric" class="qi-input qi-price" value="${it.price ? parseInt(it.price,10).toLocaleString('es-CO') : ''}" placeholder="Vlr. unitario" oninput="formatPriceInput(this); updateQuoteItem('${it.id}','price', rawPrice(this.value))">
      <span class="qi-total">$${((it.qty||0) * (parseFloat(it.price)||0)).toLocaleString('es-CO')}</span>
      <button type="button" class="btn btn-sm btn-danger" onclick="removeQuoteItem('${it.id}')">✕</button>
    </div>`).join('');
  recalcQuoteTotals();
}

function addQuoteItem() {
  quoteItemsTemp.push(newQuoteItem());
  renderQuoteItemsForm();
}

function removeQuoteItem(id) {
  quoteItemsTemp = quoteItemsTemp.filter(it => it.id !== id);
  if (!quoteItemsTemp.length) quoteItemsTemp.push(newQuoteItem());
  renderQuoteItemsForm();
}

function updateQuoteItem(id, field, value) {
  const it = quoteItemsTemp.find(x => x.id === id);
  if (!it) return;
  if (field === 'qty') it.qty = parseInt(value) || 0;
  else if (field === 'price') it.price = value;
  else it.desc = value;

  const row = document.querySelector(`#quoteItemsContainer [data-item-id="${id}"]`);
  if (row) {
    const totalEl = row.querySelector('.qi-total');
    if (totalEl) totalEl.textContent = '$' + ((it.qty||0) * (parseFloat(it.price)||0)).toLocaleString('es-CO');
  }
  recalcQuoteTotals();
}

function recalcQuoteTotals() {
  const subtotal = quoteItemsTemp.reduce((s,it) => s + (it.qty||0) * (parseFloat(it.price)||0), 0);
  document.getElementById('quoteSubtotalDisplay').textContent = '$' + subtotal.toLocaleString('es-CO');
  document.getElementById('quoteTotalDisplay').textContent = '$' + subtotal.toLocaleString('es-CO');
}

function fillQuoteClientFromSelect() {
  const id = document.getElementById('qClientId').value;
  const c = clients.find(x => x._id === id);
  if (c) {
    document.getElementById('qClientName').value = c.name;
    document.getElementById('qClientPhone').value = c.phone || '';
  }
}

function openQuoteModal(clientId) {
  editingQuoteId = null;
  quoteItemsTemp = [newQuoteItem()];
  document.getElementById('quoteModalTitle').textContent = '🧾 Nueva Cotización';
  document.getElementById('quoteSaveBtn').textContent = 'Guardar Cotización';
  document.getElementById('qClientName').value = '';
  document.getElementById('qClientPhone').value = '';
  document.getElementById('qValidityDays').value = 15;
  document.getElementById('qPaymentTerms').value = 'Contra entrega';
  document.getElementById('qConditions').value = '';
  openModal('quote');
  populateClientSelect('qClientId', clientId);
  if (clientId) fillQuoteClientFromSelect();
  renderQuoteItemsForm();
}

async function saveQuote() {
  const clientName = document.getElementById('qClientName').value.trim();
  if (!clientName) { alert('El nombre del cliente es obligatorio'); return; }
  const items = quoteItemsTemp.filter(it => it.desc.trim() !== '');
  if (!items.length) { alert('Agrega al menos un ítem con descripción'); return; }
  items.forEach(it => { if (!it.qty || it.qty < 1) it.qty = 1; });

  const payload = {
    clientId: document.getElementById('qClientId').value || null,
    clientName,
    clientPhone: document.getElementById('qClientPhone').value.trim(),
    items: items.map(it => ({ desc: it.desc.trim(), qty: it.qty, price: it.price || '0' })),
    validityDays: parseInt(document.getElementById('qValidityDays').value) || 15,
    paymentTerms: document.getElementById('qPaymentTerms').value.trim() || 'Contra entrega',
    conditions: document.getElementById('qConditions').value,
    tecnico: document.getElementById('qTecnico').value
  };

  try {
    if (editingQuoteId) {
      const updated = await apiPut(`/quotations/${editingQuoteId}`, payload);
      const idx = quotations.findIndex(q => q._id === editingQuoteId);
      if (idx !== -1) quotations[idx] = updated;
    } else {
      const created = await apiPost('/quotations', payload);
      quotations.push(created);
    }
  } catch (err) {
    alert('Error al guardar la cotización: ' + err.message);
    return;
  }

  closeModal('quote');
  editingQuoteId = null;
  renderQuotes();
  refreshDetailIfOpen();
}

function editQuote(id) {
  const qu = quotations.find(x => x._id === id);
  if (!qu) return;
  editingQuoteId = id;
  quoteItemsTemp = qu.items.map(it => ({ id: tempId(), desc: it.desc, qty: it.qty, price: it.price }));
  openModal('quote');
  populateClientSelect('qClientId', qu.clientId);
  document.getElementById('qClientName').value = qu.clientName;
  document.getElementById('qClientPhone').value = qu.clientPhone || '';
  document.getElementById('qValidityDays').value = qu.validityDays || 15;
  document.getElementById('qPaymentTerms').value = qu.paymentTerms || 'Contra entrega';
  document.getElementById('qConditions').value = qu.conditions || '';
  document.getElementById('qTecnico').value = qu.tecnico || 'Juan Pablo Granja';
  renderQuoteItemsForm();
  document.getElementById('quoteModalTitle').textContent = '✏️ Editar Cotización No. ' + qu.number;
  document.getElementById('quoteSaveBtn').textContent = 'Guardar Cambios';
}

async function deleteQuote(id) {
  if (!confirm('¿Eliminar esta cotización? Esta acción no se puede deshacer.')) return;
  const wasOpenInDetail = currentDetail && currentDetail.type === 'quote' && currentDetail.id === id;
  try {
    await apiDelete(`/quotations/${id}`);
    quotations = quotations.filter(q => q._id !== id);
    renderQuotes();
    if (wasOpenInDetail) closeModal('detail');
  } catch (err) {
    alert('Error al eliminar la cotización: ' + err.message);
  }
}

async function updateQuoteStatus(id, status) {
  try {
    const updated = await apiPut(`/quotations/${id}`, { status });
    const idx = quotations.findIndex(x => x._id === id);
    if (idx !== -1) quotations[idx] = updated;
    renderQuotes();
    showQuoteDetail(id);
  } catch (err) {
    alert('Error al actualizar el estado: ' + err.message);
  }
}

function showQuoteDetail(id) {
  const qu = quotations.find(x => x._id === id);
  if (!qu) return;
  const total = qu.items.reduce((s,it) => s + (it.qty||0) * (parseFloat(it.price)||0), 0);
  const dateStr = new Date(qu.date).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
  const status = qu.status || 'Pendiente';

  document.getElementById('detailTitle').innerHTML = '🧾 Cotización No. ' + qu.number;
  let html = `
    <div style="margin-bottom:16px;">
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">👤 Cliente: ${qu.clientName}${qu.clientPhone ? ' &nbsp;|&nbsp; 📞 ' + qu.clientPhone : ''}</p>
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">📅 Fecha: ${dateStr}</p>
    </div>
    <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; align-items:center;">
      <button class="btn btn-primary btn-sm" onclick="printQuote('${qu._id}')">🖨️ Imprimir / PDF</button>
      <button class="btn btn-secondary btn-sm" onclick="editQuote('${qu._id}')">✏️ Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteQuote('${qu._id}')">🗑️ Eliminar</button>
      <select onchange="updateQuoteStatus('${qu._id}', this.value)" style="padding:9px 12px; border-radius:8px; border:1px solid var(--border); font-size:13px; background:var(--surface); color:var(--text-primary);">
        <option value="Pendiente" ${status==='Pendiente'?'selected':''}>Pendiente</option>
        <option value="Aprobada" ${status==='Aprobada'?'selected':''}>Aprobada</option>
        <option value="Rechazada" ${status==='Rechazada'?'selected':''}>Rechazada</option>
      </select>
    </div>
    <h3 style="font-size:16px; margin:12px 0;">Ítems cotizados</h3>
  `;

  html += qu.items.map(it => `
    <div class="history-item">
      <div class="history-title">${it.desc}</div>
      <div class="history-desc">Cantidad: ${it.qty} &nbsp;|&nbsp; Vlr. unitario: $${parseFloat(it.price||0).toLocaleString('es-CO')}</div>
      <div class="history-price">$${((it.qty||0) * (parseFloat(it.price)||0)).toLocaleString('es-CO')}</div>
    </div>`).join('');

  html += `<div style="text-align:right; font-size:17px; margin:16px 0;">TOTAL GENERAL: <strong style="color:var(--accent);">$${total.toLocaleString('es-CO')}</strong></div>`;

  document.getElementById('detailContent').innerHTML = html;
  currentDetail = { type: 'quote', id };
  openModal('detail');
}

function printQuote(id) {
  const qu = quotations.find(x => x._id === id);
  if (!qu) return;
  const subtotal = qu.items.reduce((s,it) => s + (it.qty||0) * (parseFloat(it.price)||0), 0);
  const dateStr = new Date(qu.date).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });

  const rows = qu.items.map(it => `
    <tr>
      <td style="text-align:center;">${it.qty}</td>
      <td>${it.desc}</td>
      <td style="text-align:right;">$${parseFloat(it.price||0).toLocaleString('es-CO')}</td>
      <td style="text-align:right;">$${((it.qty||0) * (parseFloat(it.price)||0)).toLocaleString('es-CO')}</td>
    </tr>`).join('');

  const conditionLines = [
    `Vigencia de la cotización: ${qu.validityDays || 15} días calendario.`,
    `Forma de pago: ${qu.paymentTerms || 'Contra entrega'}.`,
    'Los valores están expresados en pesos colombianos (COP).',
    'Instalación y configuración incluida en el valor cotizado.',
    ...(qu.conditions || '').split('\n').map(l => l.trim()).filter(Boolean)
  ].map(l => `<li>${l}</li>`).join('');

  document.getElementById('quotePrintArea').innerHTML = `
    <div class="qp-page">
      <div class="qp-header">
        <img src="/assests/El Mundo de la Tecnologia sin fondo.png" class="qp-logo">
        <div class="qp-company">EL MUNDO DE LA TECNOLOGÍA</div>
        <div class="qp-sub">Soporte Técnico, Mantenimiento, Desarrollo y Actualización de Aplicaciones Web</div>
        <div class="qp-sub">Cali, Colombia &nbsp;|&nbsp; Tel: 305 239 9750</div>
        <div class="qp-sub">Email: mundodelatecnologia05@gmail.com &nbsp;|&nbsp; Web: https://elmundodelatecnologiaf.vercel.app/</div>
      </div>
      <h2 class="qp-title">COTIZACIÓN No. ${qu.number}</h2>
      <p>Fecha: ${dateStr}</p>
      <p><strong>Cliente:</strong><br>${qu.clientName}${qu.clientPhone ? '<br>' + qu.clientPhone : ''}</p>
      <p>Cordial saludo,</p>
      <p>De acuerdo con su solicitud, nos permitimos presentar la siguiente cotización:</p>
      <table class="qp-table">
        <thead>
          <tr><th>Cant.</th><th>Descripción</th><th>Vlr. Unitario</th><th>Vlr. Total</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="qp-subtotal"><td colspan="3" style="text-align:right;">Subtotal:</td><td style="text-align:right;">$${subtotal.toLocaleString('es-CO')}</td></tr>
          <tr class="qp-total"><td colspan="3" style="text-align:right;">TOTAL GENERAL:</td><td style="text-align:right;">$${subtotal.toLocaleString('es-CO')}</td></tr>
        </tbody>
      </table>
      <h3 class="qp-h3">Condiciones Comerciales</h3>
      <ul class="qp-list">${conditionLines}</ul>
      <p>Agradecemos la oportunidad de presentarle esta cotización.<br>Quedamos atentos a cualquier duda o ajuste que requiera.</p>
      <div class="qp-signature">
        <strong>${(qu.tecnico || 'JUAN PABLO GRANJA').toUpperCase()}</strong><br>
        ${qu.tecnico === 'Leidy Tatiana Montoya' ? 'Tecnóloga en Sistemas' : 'Tecnólogo en Sistemas'}<br>
        Cel: 305 239 9750<br>
        "El Mundo de la Tecnología"
      </div>
    </div>
  `;
  setTimeout(() => window.print(), 150);
}

/* ==================== FIN COTIZACIONES ==================== */

async function exportBackup() {
  try {
    const data = await apiGet('/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error al exportar el backup: ' + err.message);
  }
}

function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('Esto reemplazará todos los datos actuales en el servidor. ¿Continuar?')) return;
      await apiPost('/backup/restore', data);
      await loadAll();
      renderClients();
      renderDevices();
      renderHistory();
      alert('Backup restaurado correctamente');
    } catch (err) {
      alert('Archivo inválido o error al restaurar: ' + err.message);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// Carga inicial de datos desde la API
loadAll().then(renderClients).catch(err => {
  console.error('Error cargando datos iniciales:', err);
  alert('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.');
});

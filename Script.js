let clients = JSON.parse(localStorage.getItem('tp_clients') || '[]');
let devices = JSON.parse(localStorage.getItem('tp_devices') || '[]');
let services = JSON.parse(localStorage.getItem('tp_services') || '[]');

function saveAll() {
  localStorage.setItem('tp_clients', JSON.stringify(clients));
  localStorage.setItem('tp_devices', JSON.stringify(devices));
  localStorage.setItem('tp_services', JSON.stringify(services));
  updateStats();
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

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
  ['clients','devices','history','reminders'].forEach(t => {
    document.getElementById('view-' + t).classList.add('hidden');
    document.getElementById('tab-' + t).classList.remove('active');
  });
  document.getElementById('view-' + tab).classList.remove('hidden');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'clients') renderClients();
  if (tab === 'devices') renderDevices();
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
    const devCount = devices.filter(d => d.clientId === c.id).length;
    const svcCount = services.filter(s => {
      const d = devices.find(x => x.id === s.deviceId);
      return d && d.clientId === c.id;
    }).length;
    return `
      <div class="client-row" onclick="showClientDetail('${c.id}')">
        <div class="client-info">
          <h4>${c.name}</h4>
          <span>📞 ${c.phone}${c.email ? ' &nbsp;|&nbsp; ✉️ ' + c.email : ''}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="tag">${devCount} equipo${devCount!==1?'s':''}</span>
          <span class="tag">${svcCount} servicio${svcCount!==1?'s':''}</span>
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openDeviceModal('${c.id}')">+ Equipo</button>
        </div>
      </div>`;
  }).join('');
}

function saveClient() {
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  if (!name || !phone) { alert('Nombre y teléfono son obligatorios'); return; }
  clients.push({
    id: genId(), name, phone,
    email: document.getElementById('cEmail').value.trim(),
    address: document.getElementById('cAddress').value.trim(),
    createdAt: Date.now()
  });
  saveAll();
  closeModal('client');
  ['cName','cPhone','cEmail','cAddress'].forEach(id => document.getElementById(id).value = '');
  renderClients();
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
    const client = clients.find(c => c.id === d.clientId);
    const svcCount = services.filter(s => s.deviceId === d.id).length;
    const lastSvc = services.filter(s => s.deviceId === d.id).sort((a,b) => b.date - a.date)[0];
    return `
      <div class="client-row" onclick="showDeviceDetail('${d.id}')">
        <div class="client-info">
          <h4>${d.type} ${d.brand} ${d.model || ''}</h4>
          <span>👤 ${client ? client.name : 'Sin cliente'} &nbsp;|&nbsp; Serial: ${d.serial || 'N/A'}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="tag">${svcCount} servicio${svcCount!==1?'s':''}</span>
          ${lastSvc ? `<span class="badge badge-${lastSvc.status.toLowerCase()}">${lastSvc.status}</span>` : ''}
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openServiceModal('${d.id}')">+ Servicio</button>
        </div>
      </div>`;
  }).join('');
}

function populateClientSelect(selId, preselect) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option value="">Selecciona un cliente...</option>' + 
    clients.sort((a,b) => a.name.localeCompare(b.name)).map(c => 
      `<option value="${c.id}" ${preselect===c.id?'selected':''}>${c.name} - ${c.phone}</option>`
    ).join('');
}

function populateDeviceSelect(selId, preselect, clientId) {
  const sel = document.getElementById(selId);
  let devs = devices;
  if (clientId) devs = devices.filter(d => d.clientId === clientId);
  sel.innerHTML = '<option value="">Selecciona un equipo...</option>' + 
    devs.sort((a,b) => b.createdAt - a.createdAt).map(d => {
      const c = clients.find(x => x.id === d.clientId);
      return `<option value="${d.id}" ${preselect===d.id?'selected':''}>${d.type} ${d.brand} ${d.model||''} - ${c?c.name:'Sin cliente'}</option>`;
    }).join('');
}

function saveDevice() {
  const clientId = document.getElementById('dClientId').value;
  const brand = document.getElementById('dBrand').value.trim();
  if (!clientId) { alert('Selecciona un cliente'); return; }
  if (!brand) { alert('La marca es obligatoria'); return; }
  devices.push({
    id: genId(), clientId,
    type: document.getElementById('dType').value,
    brand, model: document.getElementById('dModel').value.trim(),
    serial: document.getElementById('dSerial').value.trim(),
    specs: document.getElementById('dSpecs').value.trim(),
    createdAt: Date.now()
  });
  saveAll();
  closeModal('device');
  ['dBrand','dModel','dSerial','dSpecs'].forEach(id => document.getElementById(id).value = '');
  renderDevices();
}

function renderHistory() {
  const q = document.getElementById('searchHistory').value.toLowerCase();
  const list = document.getElementById('historyList');
  const filtered = services.filter(s => {
    const d = devices.find(x => x.id === s.deviceId);
    const c = d ? clients.find(x => x.id === d.clientId) : null;
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
    const d = devices.find(x => x.id === s.deviceId);
    const c = d ? clients.find(x => x.id === d.clientId) : null;
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
      </div>`;
  }).join('');
}

function saveService() {
  const deviceId = document.getElementById('sDeviceId').value;
  const description = document.getElementById('sDescription').value.trim();
  if (!deviceId) { alert('Selecciona un equipo'); return; }
  if (!description) { alert('La descripción es obligatoria'); return; }
  const months = parseInt(document.getElementById('sReminderMonths').value) || 0;
  const now = Date.now();
  let reminderDate = null;
  if (months > 0) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + months);
    reminderDate = d.getTime();
  }
  services.push({
    id: genId(), deviceId,
    serviceType: document.getElementById('sServiceType').value,
    description,
    price: rawPrice(document.getElementById('sPrice').value),
    status: document.getElementById('sStatus').value,
    notes: document.getElementById('sNotes').value.trim(),
    date: now,
    reminderDate,
    reminderDone: false
  });
  saveAll();
  closeModal('service');
  ['sDescription','sPrice','sNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sReminderMonths').value = '';
  renderHistory();
  if (!document.getElementById('view-devices').classList.contains('hidden')) renderDevices();
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
    const d = devices.find(x => x.id === s.deviceId);
    const c = d ? clients.find(x => x.id === d.clientId) : null;
    const overdue = s.reminderDate <= now;
    const dateStr = new Date(s.reminderDate).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
    return `
      <div class="reminder-item ${overdue ? 'overdue' : ''}">
        <div class="history-date">${dateStr}</div>
        <div class="history-title">${d ? d.type + ' ' + d.brand + ' ' + (d.model||'') : 'Equipo eliminado'}</div>
        <div class="history-desc">👤 ${c ? c.name : 'Cliente desconocido'} ${c ? '&nbsp;|&nbsp; 📞 ' + c.phone : ''}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span class="reminder-badge ${overdue ? 'overdue' : ''}">${overdue ? 'Vencido - contactar cliente' : 'Próximo'}</span>
          <button class="btn btn-sm btn-secondary" onclick="dismissReminder('${s.id}')">✔️ Marcar hecho</button>
        </div>
      </div>`;
  }).join('');
}

function dismissReminder(serviceId) {
  const s = services.find(x => x.id === serviceId);
  if (!s) return;
  s.reminderDone = true;
  saveAll();
  renderReminders();
}

function showClientDetail(clientId) {
  const c = clients.find(x => x.id === clientId);
  if (!c) return;
  const clientDevices = devices.filter(d => d.clientId === clientId);
  const clientServices = services.filter(s => {
    const d = devices.find(x => x.id === s.deviceId);
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
      <button class="btn btn-primary btn-sm" onclick="openDeviceModal('${c.id}')">+ Agregar Equipo</button>
      <button class="btn btn-secondary btn-sm" onclick="editClient('${c.id}')">✏️ Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.id}')">🗑️ Eliminar</button>
    </div>
  `;

  html += '<h3 style="font-size:16px; margin:20px 0 12px;">💻 Equipos registrados</h3>';
  if (!clientDevices.length) {
    html += '<p style="color:var(--text-secondary); font-size:14px;">No hay equipos registrados.</p>';
  } else {
    html += clientDevices.map(d => {
      const svc = services.filter(s => s.deviceId === d.id).sort((a,b) => b.date - a.date);
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
            <button class="btn btn-sm btn-primary" onclick="openServiceModal('${d.id}')">+ Servicio</button>
            <button class="btn btn-sm btn-secondary" onclick="showDeviceDetail('${d.id}')">Ver historial</button>
          </div>
        </div>`;
    }).join('');
  }

  html += '<h3 style="font-size:16px; margin:24px 0 12px;">📋 Historial de servicios</h3>';
  if (!clientServices.length) {
    html += '<p style="color:var(--text-secondary); font-size:14px;">No hay servicios registrados.</p>';
  } else {
    html += clientServices.map(s => {
      const d = devices.find(x => x.id === s.deviceId);
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
        </div>`;
    }).join('');
  }

  document.getElementById('detailContent').innerHTML = html;
  openModal('detail');
}

function showDeviceDetail(deviceId) {
  const d = devices.find(x => x.id === deviceId);
  if (!d) return;
  const c = clients.find(x => x.id === d.clientId);
  const svc = services.filter(s => s.deviceId === deviceId).sort((a,b) => b.date - a.date);

  document.getElementById('detailTitle').innerHTML = '💻 ' + d.type + ' ' + d.brand + ' ' + (d.model||'');
  let html = `
    <div style="margin-bottom:20px;">
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">👤 Cliente: ${c ? c.name : 'Desconocido'}</p>
      <p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">🔢 Serial: ${d.serial||'N/A'}</p>
      ${d.specs ? `<p style="color:var(--text-secondary); font-size:14px; margin:4px 0;">🖥️ ${d.specs}</p>` : ''}
    </div>
    <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" onclick="openServiceModal('${d.id}')">+ Nuevo Servicio</button>
      <button class="btn btn-secondary btn-sm" onclick="editDevice('${d.id}')">✏️ Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteDevice('${d.id}')">🗑️ Eliminar</button>
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
        </div>`;
    }).join('');
  }

  document.getElementById('detailContent').innerHTML = html;
  openModal('detail');
}

function editClient(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  const name = prompt('Nombre:', c.name);
  if (name === null) return;
  const phone = prompt('Teléfono:', c.phone);
  if (phone === null) return;
  c.name = name.trim() || c.name;
  c.phone = phone.trim() || c.phone;
  c.email = prompt('Email:', c.email || '') || c.email;
  c.address = prompt('Dirección:', c.address || '') || c.address;
  saveAll();
  renderClients();
  showClientDetail(id);
}

function deleteClient(id) {
  if (!confirm('¿Eliminar este cliente y todos sus equipos/servicios?')) return;
  const devIds = devices.filter(d => d.clientId === id).map(d => d.id);
  services = services.filter(s => !devIds.includes(s.deviceId));
  devices = devices.filter(d => d.clientId !== id);
  clients = clients.filter(c => c.id !== id);
  saveAll();
  closeModal('detail');
  renderClients();
  renderDevices();
  renderHistory();
}

function editDevice(id) {
  const d = devices.find(x => x.id === id);
  if (!d) return;
  const brand = prompt('Marca:', d.brand);
  if (brand === null) return;
  d.brand = brand.trim() || d.brand;
  d.model = prompt('Modelo:', d.model || '') || d.model;
  d.serial = prompt('Serial:', d.serial || '') || d.serial;
  d.specs = prompt('Especificaciones:', d.specs || '') || d.specs;
  saveAll();
  renderDevices();
  showDeviceDetail(id);
}

function deleteDevice(id) {
  if (!confirm('¿Eliminar este equipo y todo su historial?')) return;
  services = services.filter(s => s.deviceId !== id);
  devices = devices.filter(d => d.id !== id);
  saveAll();
  closeModal('detail');
  renderDevices();
  renderHistory();
}

function openModal(name) {
  document.getElementById('modal-' + name).classList.remove('hidden');
  if (name === 'device') populateClientSelect('dClientId');
  if (name === 'service') populateDeviceSelect('sDeviceId');
}
function closeModal(name) { document.getElementById('modal-' + name).classList.add('hidden'); }
function closeModalOnOverlay(e, name) { if (e.target.id === 'modal-' + name) closeModal(name); }

function openDeviceModal(clientId) {
  openModal('device');
  populateClientSelect('dClientId', clientId);
}
function openServiceModal(deviceId) {
  openModal('service');
  populateDeviceSelect('sDeviceId', deviceId);
}

function exportBackup() {
  const data = { clients, devices, services, exportDate: Date.now() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tallerpro_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('Esto reemplazará todos los datos actuales. ¿Continuar?')) return;
      clients = data.clients || [];
      devices = data.devices || [];
      services = data.services || [];
      saveAll();
      renderClients();
      renderDevices();
      renderHistory();
      alert('Backup restaurado correctamente');
    } catch (err) {
      alert('Archivo inválido');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

updateStats();
renderClients();
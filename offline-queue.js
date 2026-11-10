/* ═══════════════════════════════════════════════════════════
   COLA OFFLINE — El Mundo de la Tecnología
   Guarda operaciones fallidas y las sincroniza al reconectarse
   ═══════════════════════════════════════════════════════════ */

const QUEUE_KEY = 'mundotec_offline_queue';

/* ─── Leer / guardar la cola en localStorage ─── */
function queueGet() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch { return []; }
}
function queueSave(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/* ─── Agregar una operación a la cola ─── */
function queueAdd(method, path, body) {
  const q = queueGet();
  const item = {
    _qid: 'oq_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    method,
    path,
    body: body || null,
    timestamp: Date.now()
  };
  q.push(item);
  queueSave(q);
  queueUpdateUI();
  return item._qid;
}

/* ─── Eliminar un ítem de la cola ─── */
function queueRemove(qid) {
  queueSave(queueGet().filter(x => x._qid !== qid));
  queueUpdateUI();
}

/* ─── Actualizar el badge flotante ─── */
function queueUpdateUI() {
  const count = queueGet().length;
  const badge  = document.getElementById('sync-badge');
  const countEl = document.getElementById('sync-count');
  if (!badge) return;

  if (count === 0) {
    badge.classList.add('oq-hidden');
  } else {
    badge.classList.remove('oq-hidden');
    countEl.textContent = count + ' pendiente' + (count !== 1 ? 's' : '');
  }
}

/* ─── Mostrar toast de notificación ─── */
let _toastTimer = null;
function queueToast(msg, type = 'info', duration = 5000) {
  const toast = document.getElementById('sync-toast');
  if (!toast) return;
  clearTimeout(_toastTimer);
  toast.innerHTML = msg;
  toast.className = 'sync-toast sync-toast--' + type;
  toast.classList.remove('oq-hidden');
  if (duration > 0) {
    _toastTimer = setTimeout(() => toast.classList.add('oq-hidden'), duration);
  }
}

/* ─── Enviar toda la cola al servidor ─── */
async function queueFlush() {
  const q = queueGet();
  if (!q.length) return;

  queueToast(`⏳ Sincronizando ${q.length} cambio${q.length !== 1 ? 's' : ''}...`, 'syncing', 0);

  let ok = 0, fail = 0;

  for (const item of q) {
    try {
      const opts = {
        method: item.method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (item.body && item.method !== 'DELETE') {
        opts.body = JSON.stringify(item.body);
      }
      const res = await fetch(API_BASE + item.path, opts);
      /* 404 en DELETE = el recurso ya no existe en el servidor = OK */
      if (res.ok || (item.method === 'DELETE' && res.status === 404)) {
        queueRemove(item._qid);
        ok++;
      } else {
        fail++;
      }
    } catch {
      fail++; /* Todavía sin conexión */
    }
  }

  /* Recargar todos los datos desde el servidor */
  if (ok > 0) {
    try {
      await loadAll();
      /* Re-renderizar la vista activa */
      ['clients', 'devices', 'quotes', 'history', 'reminders'].forEach(tab => {
        const view = document.getElementById('view-' + tab);
        if (view && !view.classList.contains('hidden')) {
          if (tab === 'clients')   renderClients();
          if (tab === 'devices')   renderDevices();
          if (tab === 'quotes')    renderQuotes();
          if (tab === 'history')   renderHistory();
          if (tab === 'reminders') renderReminders();
        }
      });
      if (typeof refreshDetailIfOpen === 'function') refreshDetailIfOpen();
    } catch { /* Si falla el reload no es crítico */ }
  }

  queueUpdateUI();

  if (ok > 0 && fail === 0) {
    queueToast(
      `✅ ${ok} cambio${ok !== 1 ? 's' : ''} sincronizado${ok !== 1 ? 's' : ''} correctamente`,
      'success', 5000
    );
  } else if (ok > 0 && fail > 0) {
    queueToast(
      `⚠️ ${ok} sincronizados, ${fail} aún pendientes`,
      'warning', 6000
    );
  } else {
    queueToast(
      `📵 Sin conexión — ${fail} cambio${fail !== 1 ? 's' : ''} pendiente${fail !== 1 ? 's' : ''}`,
      'offline', 5000
    );
  }
}

/* ─── Generar ID temporal para elementos offline ─── */
function offlineId() {
  return 'offline_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

/* ─── Eventos de red ─── */
window.addEventListener('online', () => {
  queueToast('📶 Conexión recuperada — sincronizando cambios...', 'syncing', 0);
  setTimeout(queueFlush, 1200);
});

window.addEventListener('offline', () => {
  queueToast(
    '📵 Sin conexión — tus cambios se guardan localmente y se sincronizarán al reconectarte',
    'offline', 7000
  );
});

/* ─── Al cargar la página: actualizar badge y sincronizar si hay pendientes ─── */
document.addEventListener('DOMContentLoaded', () => {
  queueUpdateUI();
  if (navigator.onLine && queueGet().length > 0) {
    setTimeout(queueFlush, 2500);
  }
});

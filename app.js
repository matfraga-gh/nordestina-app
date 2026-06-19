/* ============================================
   AZUCAPP - Lógica principal
============================================ */

(function() {
'use strict';

// ============================================
// CONFIGURACIÓN
// ============================================
const SUPABASE_URL = 'https://vbnucvzjlcghrmqxjldp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VGfoUAU6e0zlXzkY2y8iBw_lYeOKU7K';

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Lista de locales - se carga dinámicamente desde la base al iniciar sesión
// LOCALES_DB es el array completo de objetos {slug, nombre, orden, activo}
// LOCAL_LABELS es un diccionario {slug: nombre_visible} que se construye a partir de LOCALES_DB
let LOCALES_DB = [];
let LOCAL_LABELS = {};

// Helpers para acceder a los locales
function getLocalesActivos() {
  // Devuelve los slugs de los locales activos (para usar en selectores normales)
  return LOCALES_DB.filter(l => l.activo).map(l => l.slug);
}

function getLocalesTodos() {
  // Devuelve los slugs de todos los locales (activos + reservados) - para Admin
  return LOCALES_DB.map(l => l.slug);
}

function localLabel(slug) {
  // Devuelve el nombre visible de un slug (o el slug si no encuentra match)
  return LOCAL_LABELS[slug] || slug;
}

async function cargarLocalesDesdeBase() {
  try {
    const data = await api('locales?order=orden.asc');
    LOCALES_DB = data || [];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
    // El "transversal" es solo el filtro "ver todos": se muestra como TODOS
    const _tv = LOCALES_DB.find(x => /transversal/i.test(x.nombre || '') || /transversal/i.test(x.slug || ''));
    if (_tv) LOCAL_LABELS[_tv.slug] = 'TODOS';
  } catch (e) {
    console.error('Error al cargar locales:', e);
    // Fallback de emergencia para que la app no se rompa si falla la query
    LOCALES_DB = [
      { slug: '1-AZUCA',     nombre: 'Azuca',            orden: 1, activo: true },
      { slug: '2-AZAFRAN',   nombre: 'Azafrán',          orden: 2, activo: true },
      { slug: '3-NIETO',     nombre: 'Nieto Senetiner',  orden: 3, activo: true },
      { slug: '4-VIÑA COBOS', nombre: 'Viña Cobos',      orden: 4, activo: true },
      { slug: '5-TRAPICHE',  nombre: 'Espacio Trapiche', orden: 5, activo: true },
      { slug: 'VINOBIEN',    nombre: 'Vinobien',         orden: 6, activo: true }
    ];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
    // El "transversal" es solo el filtro "ver todos": se muestra como TODOS
    const _tv = LOCALES_DB.find(x => /transversal/i.test(x.nombre || '') || /transversal/i.test(x.slug || ''));
    if (_tv) LOCAL_LABELS[_tv.slug] = 'TODOS';
  }
}

const TIPOS_INCIDENCIA = {
  tardanza: '⏰ Llegada tarde',
  ausencia: '❌ Ausencia',
  enfermedad: '🤒 Enfermedad',
  cambio_turno: '🔄 Cambio de turno',
  otro: '📝 Otro'
};

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null;
let currentEmpleado = null;   // Datos del colaborador vinculado al usuario
let semanaActual = null;      // Lunes de la semana visible (formato YYYY-MM-DD)

// ============================================
// HELPERS - API
// ============================================
async function api(path, options = {}) {
  const opts = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    },
    ...options
  };

  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, opts);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('API error ' + res.status + ': ' + txt);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ============================================
// HELPERS - Hash y sesión
// ============================================
async function sha256(str) {
  if (!crypto || !crypto.subtle) {
    throw new Error('Tu navegador no soporta cifrado seguro. Abrí la app desde https:// en Chrome o Safari actualizado.');
  }
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function saveSession(user) {
  localStorage.setItem('azucapp_user', JSON.stringify(user));
}

function loadSession() {
  try {
    const raw = localStorage.getItem('azucapp_user');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('azucapp_user');
}

// ============================================
// HELPERS - Fechas
// ============================================
function hoyStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parsearFecha(yyyymmdd) {
  // Evita problemas de timezone parseando manualmente
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function aFechaStr(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLunes(fechaStr) {
  const d = parsearFecha(fechaStr);
  const dow = d.getDay();  // 0=domingo, 1=lunes, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return aFechaStr(d);
}

function addDays(fechaStr, n) {
  const d = parsearFecha(fechaStr);
  d.setDate(d.getDate() + n);
  return aFechaStr(d);
}

function diasDeSemana(lunesStr) {
  return Array.from({length: 7}, (_, i) => addDays(lunesStr, i));
}

function fmtFechaCorta(fechaStr) {
  const d = parsearFecha(fechaStr);
  return `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

function fmtSemana(lunesStr) {
  const dias = diasDeSemana(lunesStr);
  const d1 = parsearFecha(dias[0]);
  const d7 = parsearFecha(dias[6]);
  const m1 = MESES_CORTO[d1.getMonth()];
  const m7 = MESES_CORTO[d7.getMonth()];
  if (m1 === m7) {
    return `${d1.getDate()} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
  }
  return `${d1.getDate()} ${m1} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
}

function fmtDateTime(date) {
  const dias = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'];
  const dia = dias[date.getDay()];
  const fecha = date.getDate();
  const mes = MESES_CORTO[date.getMonth()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dia} ${fecha} ${mes} · ${hh}:${mm}`;
}

function esHoy(fechaStr) {
  return fechaStr === hoyStr();
}

function esDiaPasado(fechaStr, turno) {
  const hoy = hoyStr();
  if (fechaStr < hoy) return true;
  if (fechaStr > hoy) return false;
  // Es hoy: si tiene turno con hora y ya pasó, considerar pasado
  if (turno && turno.hora_entrada && !turno.es_off && !turno.es_flex) {
    const ahora = new Date();
    const [h, m] = turno.hora_entrada.split(':').map(Number);
    if (ahora.getHours() > h || (ahora.getHours() === h && ahora.getMinutes() > m + 30)) {
      return true;
    }
  }
  return false;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Formato de números con separador de miles (es-AR)
function formatNumber(n) {
  const num = Math.round(parseFloat(n) || 0);
  return num.toLocaleString('es-AR');
}

// ============================================
// TOAST
// ============================================
let toastTimeout = null;
const TOAST_ICONS = {
  success: 'ti-circle-check',
  error: 'ti-alert-circle',
  warning: 'ti-alert-triangle',
  '': 'ti-info-circle'
};
function toast(msg, kind = 'success') {
  const el = document.getElementById('toast');
  // Si no se pasa kind, asumimos success (es lo más común al guardar)
  const k = kind || 'success';
  const icon = TOAST_ICONS[k] || TOAST_ICONS.success;
  el.className = 'toast show ' + k;
  el.innerHTML = `<i class="ti ${icon}"></i><span>${esc(msg)}</span>`;
  if (toastTimeout) clearTimeout(toastTimeout);
  // Toasts de error duran más para que se alcancen a leer
  const duracion = k === 'error' ? 4500 : 3200;
  toastTimeout = setTimeout(() => {
    el.className = 'toast';
  }, duracion);
}

// ============================================
// MODAL DE CONFIRMACIÓN / ALERTA UNIVERSAL
// ============================================
let _confirmResolve = null;

/**
 * showConfirm(opciones) - muestra un modal de confirmación.
 * Devuelve una Promise<boolean>: true si confirma, false si cancela.
 * opciones: { title, msg, type, okLabel, cancelLabel, danger }
 *   - type: 'warning' (default), 'danger', 'info', 'success'
 *   - danger: si true, el botón OK se pinta rojo
 */
function showConfirm(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = '¿Estás seguro?',
      msg = '',
      type = 'warning',
      okLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.warning);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    const btnOk = document.getElementById('confirmBtnOk');
    const btnCancel = document.getElementById('confirmBtnCancel');
    btnOk.textContent = okLabel;
    btnCancel.textContent = cancelLabel;
    btnOk.className = danger ? 'btn-danger' : 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

/**
 * showAlert(opciones) - como showConfirm pero solo botón OK (informativo).
 * opciones: { title, msg, type, okLabel }
 */
function showAlert(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = 'Atención',
      msg = '',
      type = 'info',
      okLabel = 'Entendido'
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.info);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    // Ocultar botón cancelar, dejar solo OK
    document.getElementById('confirmBtnCancel').style.display = 'none';
    const btnOk = document.getElementById('confirmBtnOk');
    btnOk.textContent = okLabel;
    btnOk.className = 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

function closeConfirm(result) {
  document.getElementById('modalConfirm').style.display = 'none';
  // Restaurar botón cancelar para próximas confirmaciones
  document.getElementById('confirmBtnCancel').style.display = '';
  if (_confirmResolve) {
    const r = _confirmResolve;
    _confirmResolve = null;
    r(result);
  }
}

// ============================================
// CIERRE UNIFICADO DE MODALES
// (click afuera + tecla Escape)
// ============================================
document.addEventListener('click', (e) => {
  // Si el click es directamente sobre el overlay (no en el contenido), cerrarlo
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    const card = e.target.querySelector('.modal-card');
    if (card && card.hasAttribute('data-prevent-close')) return;
    e.target.style.display = 'none';
    // Si era el modal de confirmación, resolver como cancelar
    if (e.target.id === 'modalConfirm' && _confirmResolve) {
      const r = _confirmResolve;
      _confirmResolve = null;
      r(false);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Buscar el modal abierto más reciente y cerrarlo
    const modales = document.querySelectorAll('.modal-overlay');
    for (let i = modales.length - 1; i >= 0; i--) {
      const m = modales[i];
      if (m.style.display === 'flex') {
        m.style.display = 'none';
        if (m.id === 'modalConfirm' && _confirmResolve) {
          const r = _confirmResolve;
          _confirmResolve = null;
          r(false);
        }
        break;
      }
    }
  }
});

// Exponer al window
window.closeConfirm = closeConfirm;
window.showConfirm = showConfirm;
window.showAlert = showAlert;

// ============================================
// MÓDULOS DEL DASHBOARD
// ============================================
const MODULES = [
  {
    id: 'semana',
    icon: 'ti-calendar-event',
    color: '#7F77DD',
    title: 'Mi semana',
    desc: 'Mis turnos asignados',
    visible: () => true,
    action: () => openMiSemana()
  },
  {
    id: 'propina',
    icon: 'ti-cash',
    color: '#EF9F27',
    title: 'Mi propina',
    desc: 'Propinas acumuladas',
    visible: () => true,
    action: () => openMiPropina()
  },
  {
    id: 'biblioteca',
    icon: 'ti-books',
    color: '#5DCAA5',
    title: 'Mi biblioteca',
    desc: 'Capacitación y recursos',
    visible: () => isMaster() || isAdmin() || (currentUser.locales_asignados && currentUser.locales_asignados.length > 0),
    action: () => openMiBiblioteca()
  },
  {
    id: 'misdatos',
    icon: 'ti-id-badge-2',
    color: '#5B8C7B',
    title: 'Mis Datos',
    desc: 'Tus datos personales y de cobro',
    visible: () => !!(currentUser && currentUser.empleado_id),
    action: () => openMisDatos()
  },
  {
    id: 'recetas',
    icon: 'ti-chef-hat',
    color: '#D85A30',
    title: 'Mis recetas',
    desc: 'Recetas y menús del local',
    visible: () => isMaster() || isAdmin() || currentUser.editor_recetas,
    action: () => openMisRecetas()
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || isAdmin() || currentUser.editor_pedidos,
    action: () => openMisPedidos()
  },
  {
    id: 'stock',
    icon: 'ti-clipboard-check',
    color: '#1D9E75',
    title: 'Mi Stock',
    desc: 'Control de stock por local',
    visible: () => puedeGestionarStock(),
    action: () => openMiStock()
  },
  {
    id: 'cierres',
    icon: 'ti-cash-register',
    color: '#C4622D',
    title: 'Mis Cierres',
    desc: 'Cierre de caja por local y turno',
    visible: () => puedeGestionarCierres(),
    action: () => openMisCierres()
  },
  {
    id: 'estadisticas',
    icon: 'ti-chart-bar',
    color: '#2D7FC4',
    title: 'Mis Estadísticas',
    desc: 'Ventas, pax y promedio por local',
    visible: () => isMaster() || isAdmin(),
    action: () => openMisEstadisticas()
  },
  {
    id: 'insumos',
    icon: 'ti-package',
    color: '#EF9F27',
    title: 'Insumos',
    desc: 'Catálogo, validación y subfamilias',
    visible: () => !!(currentUser && currentUser.editor_insumos) && !isMaster() && !isAdmin(),
    action: () => openAdminInsumos()
  },
  {
    id: 'rosters',
    icon: 'ti-calendar-event',
    color: '#7F77DD',
    title: 'Gestión de Rosters',
    desc: 'Armá la semana del equipo',
    visible: () => puedeGestionarRosters(),
    action: () => openGestionRosters()
  },
  {
    id: 'incidencias',
    icon: 'ti-alert-triangle',
    color: '#C4622D',
    title: 'Gestión de Incidencias',
    desc: 'Aceptar o rechazar reportes del equipo',
    visible: () => puedeGestionarRosters(),
    action: () => openGestionIncidencias()
  },
  {
    id: 'admin',
    icon: 'ti-settings',
    color: '#B4B2A9',
    title: 'Administración',
    desc: 'Usuarios y permisos',
    visible: () => isMaster() || isAdmin(),
    action: () => openAdministracion()
  }
];

function isMaster() {
  return currentUser && currentUser.perfil === 'master';
}

function isAdmin() {
  return currentUser && currentUser.perfil === 'admin';
}

// ============================================
// LÓGICA DE LOGIN
// ============================================
async function doLogin(usuario, password) {
  try {
    const users = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=*`);

    if (!users || users.length === 0) {
      throw new Error('Usuario no encontrado');
    }

    const user = users[0];

    if (!user.activo) {
      throw new Error('Usuario inactivo');
    }

    const hash = await sha256(password);
    if (hash !== user.password_hash) {
      throw new Error('Contraseña incorrecta');
    }

    currentUser = user;
    saveSession(user);

    // Cargar lista de locales desde la base (necesario para que toda la app
    // muestre los nombres correctos de los locales)
    await cargarLocalesDesdeBase();

    if (user.debe_cambiar_password) {
      showView('vChangePass');
    } else {
      showDashboard();
    }

  } catch (err) {
    document.getElementById('loginError').textContent = err.message || 'Error al ingresar';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;

  document.getElementById('loginError').textContent = '';
  document.getElementById('btnLogin').disabled = true;
  document.getElementById('btnLogin').textContent = 'Ingresando...';

  await doLogin(usuario, password);

  document.getElementById('btnLogin').disabled = false;
  document.getElementById('btnLogin').textContent = 'Ingresar';
});

// ============================================
// CAMBIO DE CONTRASEÑA OBLIGATORIO
// ============================================
document.getElementById('changePassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('changePassError');
  errBox.textContent = '';

  const p1 = document.getElementById('newPass1').value;
  const p2 = document.getElementById('newPass2').value;

  if (p1.length < 6) {
    errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    currentUser.debe_cambiar_password = false;
    saveSession(currentUser);

    document.getElementById('newPass1').value = '';
    document.getElementById('newPass2').value = '';

    showDashboard();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// CAMBIO DE CONTRASEÑA VOLUNTARIO
// ============================================
document.getElementById('changePassVoluntaryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('voluntaryPassError');
  errBox.textContent = '';

  const currentP = document.getElementById('currentPass').value;
  const p1 = document.getElementById('voluntaryPass1').value;
  const p2 = document.getElementById('voluntaryPass2').value;

  const currentHash = await sha256(currentP);
  if (currentHash !== currentUser.password_hash) {
    errBox.textContent = 'Contraseña actual incorrecta';
    return;
  }
  if (p1.length < 6) {
    errBox.textContent = 'La nueva contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    saveSession(currentUser);

    document.getElementById('currentPass').value = '';
    document.getElementById('voluntaryPass1').value = '';
    document.getElementById('voluntaryPass2').value = '';

    openMiPerfil();
    toast('Contraseña actualizada', 'success');
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// DASHBOARD
// ============================================
function showDashboard() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Saludo según hora del día + nombre de pila
  let primerNombre = (currentEmpleado && currentEmpleado.nombre_p)
    ? currentEmpleado.nombre_p.trim().split(/\s+/)[0]
    : nombre.trim().split(/\s+/)[0];
  const hora = new Date().getHours();
  let saludo, emoji;
  if (hora >= 5 && hora < 12) {
    saludo = 'Buenos días';
    emoji = '☀️';
  } else if (hora >= 12 && hora < 20) {
    saludo = 'Buenas tardes';
    emoji = '🌤️';
  } else {
    saludo = 'Buenas noches';
    emoji = '🌙';
  }
  document.getElementById('greetingText').textContent = `${saludo}, ${primerNombre}`;
  document.getElementById('greetingEmoji').textContent = emoji;
  // Si no tenemos el nombre de pila cargado, lo buscamos y corregimos el saludo
  if (currentUser.empleado_id && (!currentEmpleado || !currentEmpleado.nombre_p)) {
    api('empleados?id=eq.' + currentUser.empleado_id + '&select=*').then(function(emps) {
      if (emps && emps.length) {
        currentEmpleado = emps[0];
        const pn = (currentEmpleado.nombre_p || '').trim().split(/\s+/)[0];
        const el = document.getElementById('greetingText');
        if (pn && el) el.textContent = saludo + ', ' + pn;
      }
    }).catch(function() {});
  }

  // User pill
  document.getElementById('userPillName').textContent = nombre;
  document.getElementById('userPillRole').textContent = roleLabel;

  // Avatar: inicial + color según perfil
  const avatarEl = document.getElementById('userPillAvatar');
  avatarEl.textContent = obtenerIniciales(nombre);
  avatarEl.className = 'user-pill-avatar avatar-' + perfil;

  document.getElementById('datetime').textContent = fmtDateTime(new Date());

  renderDashboardCards();
  showView('vDash');
}

// Devuelve hasta 2 iniciales del nombre (ej: "Matías Fraga" → "MF")
function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
  return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
}

// ============================================
// MI PERFIL
// ============================================
async function openMiPerfil() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Avatar grande
  const avatar = document.getElementById('perfilAvatar');
  avatar.textContent = obtenerIniciales(nombre);
  avatar.className = 'perfil-avatar avatar-' + perfil;

  // Datos básicos
  document.getElementById('perfilNombre').textContent = nombre;
  document.getElementById('perfilUsuario').textContent = '@' + (currentUser.usuario || '');

  const badge = document.getElementById('perfilBadge');
  badge.textContent = roleLabel;
  badge.className = 'perfil-badge ' + perfil;

  // Empleado
  document.getElementById('perfilEmpleado').textContent =
    currentUser.empleado_id ? '#' + currentUser.empleado_id : 'Sin asignar';

  // Tipo de perfil expandido
  const perfilDescripciones = {
    master:  'Master · Control total',
    admin:   'Admin · Administra todo menos Locales',
    editor:  'Editor · Permisos según módulo',
    usuario: 'Usuario · Solo lectura de lo propio'
  };
  document.getElementById('perfilTipo').textContent =
    perfilDescripciones[perfil] || roleLabel;

  // Locales asignados
  const filaLocales = document.getElementById('perfilLocalesRow');
  const elLocales = document.getElementById('perfilLocales');

  if (perfil === 'master' || perfil === 'admin') {
    elLocales.textContent = 'Todos los locales';
  } else {
    const locs = currentUser.locales_asignados || [];
    if (locs.length === 0) {
      elLocales.textContent = 'Sin locales asignados';
      elLocales.style.color = '#E24B4A';
    } else {
      const nombresVisibles = locs.map(slug => localLabel(slug)).join(', ');
      elLocales.textContent = nombresVisibles;
      elLocales.style.color = '';
    }
  }

  showView('vMiPerfil');
}

window.openMiPerfil = openMiPerfil;

function renderDashboardCards() {
  const grid = document.getElementById('dashGrid');
  const visibleModules = MODULES.filter(m => m.visible());

  grid.innerHTML = visibleModules.map((m, idx) => {
    const isLastOdd = (idx === visibleModules.length - 1) && (visibleModules.length % 2 === 1);
    const fullClass = isLastOdd ? ' full' : '';

    return `
      <button class="dash-card${fullClass}" data-module="${m.id}">
        <div class="dash-icon" style="color: ${m.color}">
          <i class="ti ${m.icon}"></i>
        </div>
        <div class="dash-title">${m.title}</div>
        <div class="dash-desc">${m.desc}</div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const modId = card.dataset.module;
      const mod = MODULES.find(m => m.id === modId);
      if (mod) mod.action();
    });
  });
}

// ============================================
// MI SEMANA
// ============================================
async function openMiSemana() {
  showView('vMiSemana');

  // Inicializar fecha
  if (!semanaActual) {
    semanaActual = getLunes(hoyStr());
  }

  // Cargar datos del colaborador si tiene empleado_id
  currentEmpleado = null;
  if (currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) {
        currentEmpleado = emps[0];
      }
    } catch (e) {
      console.warn('Error cargando empleado:', e);
    }
  }

  // Renderizar
  await renderMiSemana();
}

async function renderMiSemana() {
  const subtitle = document.getElementById('miSemanaSubtitle');
  const weekNav = document.getElementById('weekNav');
  const diasGrid = document.getElementById('diasGrid');
  const comentBox = document.getElementById('comentarioGeneral');
  const noEmpBox = document.getElementById('noEmpleado');
  const reportarBox = document.getElementById('reportarWrap');

  // Caso 1: usuario sin empleado vinculado (ej: matfraga master)
  if (!currentEmpleado) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    weekNav.style.display = 'none';
    diasGrid.innerHTML = '';
    comentBox.style.display = 'none';
    noEmpBox.style.display = 'flex';
    reportarBox.style.display = 'none';
    return;
  }

  // Caso 2: usuario con empleado
  weekNav.style.display = 'flex';
  noEmpBox.style.display = 'none';
  reportarBox.style.display = 'block';

  const localLabel = LOCAL_LABELS[currentEmpleado.local] || currentEmpleado.local || '';
  subtitle.textContent = localLabel + (currentEmpleado.sector ? ' · ' + currentEmpleado.sector : '');

  document.getElementById('weekLabel').textContent = fmtSemana(semanaActual);

  // Mostrar loading
  diasGrid.innerHTML = '<div class="loading">Cargando turnos...</div>';

  const dias = diasDeSemana(semanaActual);
  let turnos = {};         // por día → turno
  let localesPorDia = {};  // por día → nombre del local
  let comentGeneral = '';
  let incPorDia = {};

  try {
    // Buscar TODAS las semanas (de cualquier local) con esta fecha de lunes
    // que tengan turnos para este empleado
    const semanas = await api(
      `roster_semanas?fecha_lunes=eq.${semanaActual}&select=id,local,comentario_general`
    );

    if (semanas && semanas.length) {
      // Construir mapa id→local para asignarlo después a cada turno
      const semanaIdToLocal = {};
      const semanaIds = [];
      semanas.forEach(s => {
        semanaIdToLocal[s.id] = s.local;
        semanaIds.push(s.id);
      });

      // Buscar todos los turnos del empleado en cualquiera de esas semanas
      const tts = await api(
        `roster_turnos?semana_id=in.(${semanaIds.join(',')})` +
        `&empleado_id=eq.${currentEmpleado.id}&select=*`
      ) || [];

      tts.forEach(t => {
        turnos[t.dia] = t;
        localesPorDia[t.dia] = semanaIdToLocal[t.semana_id];
      });

      // Para el comentario general, priorizar el del local principal del empleado
      const semanaPrincipal = semanas.find(s => s.local === currentEmpleado.local);
      if (semanaPrincipal && semanaPrincipal.comentario_general) {
        comentGeneral = semanaPrincipal.comentario_general;
      } else if (semanas.length === 1 && semanas[0].comentario_general) {
        comentGeneral = semanas[0].comentario_general;
      }
    }

    // Cargar incidencias del empleado en el rango de la semana
    const desde = dias[0];
    const hasta = dias[6];
    const incs = await api(
      `incidencias?empleado_id=eq.${currentEmpleado.id}` +
      `&fecha=gte.${desde}&fecha=lte.${hasta}` +
      `&select=*&order=creado_en.desc`
    ) || [];
    incs.forEach(inc => {
      if (!incPorDia[inc.fecha]) incPorDia[inc.fecha] = inc;
    });
  } catch (e) {
    diasGrid.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar la semana</div>';
    console.error(e);
    return;
  }

  // Detectar si el empleado tiene turnos en distintos locales esta semana
  const localesUnicos = [...new Set(Object.values(localesPorDia))];
  const esRotativo = localesUnicos.length > 1;

  // Renderizar la grilla
  diasGrid.innerHTML = dias.map((dia, i) => {
    const t = turnos[dia];
    const esOff = t && t.es_off;
    const esFlex = t && t.es_flex;
    const hoy = esHoy(dia);
    const pasado = esDiaPasado(dia, t);
    const inc = incPorDia[dia];
    const localTurno = localesPorDia[dia];

    let txt;
    if (esOff) {
      txt = 'OFF';
    } else if (esFlex) {
      txt = t.hora_entrada ? 'FLEX ' + t.hora_entrada.slice(0, 5) : 'FLEX';
    } else if (t && t.hora_entrada) {
      txt = t.hora_entrada.slice(0, 5);
    } else {
      txt = '—';
    }

    const classes = ['dia-card'];
    if (esOff) classes.push('off');
    if (esFlex) classes.push('flex');
    if (hoy) classes.push('hoy');
    if (pasado) classes.push('pasado');

    // Mostrar el local SOLO si el empleado es rotativo y tiene un turno con local
    const mostrarLocal = esRotativo && localTurno && !esOff && t && t.hora_entrada;
    if (mostrarLocal) classes.push('con-local');

    const dot = inc
      ? `<span class="inc-dot ${inc.estado}" onclick="verIncidencia(${inc.id})" title="Ver incidencia"></span>`
      : '';

    const hoyTag = hoy ? '<span class="hoy-label">HOY</span>' : '';

    const localTag = mostrarLocal
      ? `<div class="dia-local">${esc(LOCAL_LABELS[localTurno] || localTurno)}</div>`
      : '';

    const comentTurno = (t && t.comentario)
      ? `<div class="dia-comment"><i class="ti ti-message-circle"></i><span>${esc(t.comentario)}</span></div>`
      : '';

    return `
      <div class="${classes.join(' ')}">
        ${dot}
        <div class="dia-nombre">${DIAS_LARGO[i]}${hoyTag}</div>
        <div class="dia-fecha">${fmtFechaCorta(dia)}</div>
        <div class="dia-hora">${txt}</div>
        ${localTag}
        ${comentTurno}
      </div>
    `;
  }).join('');

  // Comentario general
  if (comentGeneral) {
    comentBox.innerHTML = `<i class="ti ti-message-2"></i><em>${esc(comentGeneral)}</em>`;
    comentBox.style.display = 'flex';
  } else {
    comentBox.style.display = 'none';
  }
}

window.cambiarSemanaEmp = function(n) {
  semanaActual = addDays(semanaActual, n * 7);
  renderMiSemana();
};

// ============================================
// MI SEMANA - Reportar incidencia
// ============================================
window.openIncidenciaModal = function() {
  const hoy = hoyStr();
  const inp = document.getElementById('incFecha');
  inp.value = hoy;
  inp.min = hoy;
  document.getElementById('incTipo').value = 'tardanza';
  document.getElementById('incDesc').value = '';
  document.getElementById('incError').textContent = '';
  document.getElementById('modalIncidencia').classList.add('show');
};

window.closeIncidenciaModal = function() {
  document.getElementById('modalIncidencia').classList.remove('show');
};

window.guardarIncidencia = async function() {
  const tipo = document.getElementById('incTipo').value;
  const fecha = document.getElementById('incFecha').value;
  const desc = document.getElementById('incDesc').value.trim();
  const errBox = document.getElementById('incError');
  errBox.textContent = '';

  if (!fecha) {
    errBox.textContent = 'Elegí una fecha';
    return;
  }
  const hoy = hoyStr();
  if (fecha < hoy) {
    errBox.textContent = 'No se pueden reportar incidencias de días pasados';
    return;
  }
  if (!desc) {
    errBox.textContent = 'Describí la incidencia';
    return;
  }
  if (!currentEmpleado) {
    errBox.textContent = 'Tu usuario no está vinculado a un colaborador';
    return;
  }

  // Si la incidencia es para HOY, validar que no se haya pasado la hora del turno + 30 min
  if (fecha === hoy) {
    try {
      const turnoHoy = await api(
        `roster_turnos?empleado_id=eq.${currentEmpleado.id}&dia=eq.${hoy}` +
        `&select=hora_entrada,es_off,es_flex&limit=1`
      );
      if (turnoHoy && turnoHoy.length && turnoHoy[0].hora_entrada
          && !turnoHoy[0].es_off && !turnoHoy[0].es_flex) {
        const ahora = new Date();
        const [h, m] = turnoHoy[0].hora_entrada.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m + 30, 0, 0);
        if (ahora > limite) {
          errBox.textContent = 'Ya pasó la hora de tu turno + 30 min, no se puede reportar';
          return;
        }
      }
    } catch (e) {
      console.warn('Error validando turno hoy:', e);
    }
  }

  try {
    await api('incidencias', {
      method: 'POST',
      body: JSON.stringify({
        empleado_id: currentEmpleado.id,
        fecha,
        tipo,
        descripcion: desc,
        estado: 'pendiente'
      })
    });
    closeIncidenciaModal();
    toast('✓ Incidencia enviada', 'success');
    // Refrescar la vista para mostrar el indicador
    await renderMiSemana();
  } catch (err) {
    errBox.textContent = 'Error al enviar: ' + err.message;
  }
};

// ============================================
// MI SEMANA - Ver detalle de incidencia
// ============================================
window.verIncidencia = async function(id) {
  try {
    const incs = await api(`incidencias?id=eq.${id}&select=*`);
    if (!incs || !incs.length) {
      toast('No se encontró la incidencia', 'error');
      return;
    }
    const inc = incs[0];

    const estadoLabels = {
      pendiente: { label: '⏳ Pendiente', cls: 'pendiente' },
      aprobado: { label: '✓ Aceptada', cls: 'aprobado' },
      rechazado: { label: '✗ Denegada', cls: 'rechazado' }
    };
    const est = estadoLabels[inc.estado] || estadoLabels.pendiente;

    document.getElementById('incDetTitle').textContent = TIPOS_INCIDENCIA[inc.tipo] || inc.tipo;
    document.getElementById('incDetBody').innerHTML = `
      <div class="det-line">
        <div class="det-label">Fecha</div>
        <div class="det-value">${fmtFechaCorta(inc.fecha)}</div>
      </div>
      <div class="det-line">
        <div class="det-label">Estado</div>
        <div class="det-value"><span class="det-badge ${est.cls}">${est.label}</span></div>
      </div>
      <div class="det-line">
        <div class="det-label">Descripción</div>
        <div class="det-value">${esc(inc.descripcion || '—')}</div>
      </div>
      ${inc.respuesta ? `<div class="det-line"><div class="det-label">Respuesta</div><div class="det-value">${esc(inc.respuesta)}</div></div>` : ''}
    `;
    document.getElementById('modalIncDetalle').classList.add('show');
  } catch (e) {
    toast('Error al cargar la incidencia', 'error');
  }
};

window.closeIncDetalleModal = function() {
  document.getElementById('modalIncDetalle').classList.remove('show');
};

// ============================================
// MI PROPINA
// ============================================
async function openMiPropina() {
  showView('vMiPropina');
  const cont = document.getElementById('propinaContenido');
  const subtitle = document.getElementById('miPropinaSubtitle');
  cont.innerHTML = '<div class="loading">Cargando propinas...</div>';
  // Necesita empleado vinculado
  if (!currentUser.empleado_id) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    cont.innerHTML = `
      <div class="no-empleado">
        <i class="ti ti-info-circle"></i>
        <div>
          <div class="ne-title">No tenés propinas asignadas</div>
          <div class="ne-desc">Tu usuario no está vinculado a un colaborador. Si esto es un error, contactá a Recursos Humanos.</div>
        </div>
      </div>`;
    return;
  }

  // Cargar nombre del colaborador para el subtítulo
  if (!currentEmpleado && currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) currentEmpleado = emps[0];
    } catch(e) { /* ignore */ }
  }
  subtitle.textContent = 'Propinas acumuladas';

  // Cargar asignaciones con datos del cierre
  let asigs = [];
  try {
    asigs = await api(
      `propinas_asignaciones?empleado_id=eq.${currentUser.empleado_id}` +
      `&select=*,cierre:cierre_id(fecha,turno,local,pagado,pagado_en)` +
      `&order=id.desc`
    ) || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar propinas</div>';
    return;
  }

  // No existen cierres "transversales": ese local es solo un filtro de vista
  const _tvSlug = getSlugTransversal();
  if (_tvSlug) asigs = asigs.filter(a => !a.cierre || a.cierre.local !== _tvSlug);

  const pendientes = asigs.filter(a => a.cierre && !a.cierre.pagado && a.monto > 0);

  const hoy = new Date();
  const limite = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1);
  const limiteStr = limite.toISOString().slice(0, 10);
  const pagadosRecientes = asigs.filter(a =>
    a.cierre && a.cierre.pagado && a.monto > 0 && a.cierre.fecha >= limiteStr
  );

  let html = '';

  // ===== 1. BOTÓN DE GESTIÓN (Master, Admin o editor de propinas) =====
  if (puedeGestionarPropinas()) {
    html += `
      <button class="btn-gestion" onclick="abrirGestionPropinas()">
        <i class="ti ti-settings"></i> GESTIÓN DE PROPINAS
      </button>`;
  }

  // ===== 2. BANNER PENDIENTE =====
  const totalPendiente = pendientes.reduce((s, a) => s + parseFloat(a.monto || 0), 0);
  if (pendientes.length) {
    html += `
      <div class="propina-banner">
        <div class="propina-banner-label">Total pendiente de cobro</div>
        <div class="propina-banner-monto">$${formatNumber(totalPendiente)}</div>
        <div class="propina-banner-sub">${pendientes.length} ${pendientes.length === 1 ? 'cierre pendiente' : 'cierres pendientes'}</div>
      </div>`;
  } else {
    html += `
      <div class="propina-empty">
        <div class="propina-empty-icon">💰</div>
        <div class="propina-empty-title">No tenés propinas pendientes</div>
        <div class="propina-empty-desc">Cuando se carguen propinas para vos, las vas a ver acá.</div>
      </div>`;
  }

  // ===== 3. DETALLE DE PENDIENTES POR LOCAL =====
  if (pendientes.length) {
    const porLocal = {};
    pendientes.forEach(a => {
      const loc = a.cierre.local;
      if (!porLocal[loc]) porLocal[loc] = { total: 0, dias: [] };
      porLocal[loc].total += parseFloat(a.monto || 0);
      porLocal[loc].dias.push({
        fecha: a.cierre.fecha,
        turno: a.cierre.turno,
        puntos: parseFloat(a.puntos),
        monto: parseFloat(a.monto || 0)
      });
    });
    Object.values(porLocal).forEach(l => l.dias.sort((a, b) => b.fecha.localeCompare(a.fecha)));

    const turnoIcon = { mediodia: '🌤', noche: '🌙', evento: '🎉', especial: '⭐' };
    const turnoLbl = { mediodia: 'Mediodía', noche: 'Noche', evento: 'Evento', especial: 'Especial' };

    html += `<div class="pend-section-title">Detalle de pendientes</div>`;
    Object.entries(porLocal).forEach(([loc, data]) => {
      html += `
        <div class="pend-local">
          <div class="pend-local-header">
            <div class="pend-local-name"><i class="ti ti-map-pin"></i> ${esc(LOCAL_LABELS[loc] || loc)}</div>
            <div class="pend-local-total">$${formatNumber(data.total)}</div>
          </div>
          ${data.dias.map(d => {
            const pts = d.puntos === 1 ? '1 punto' : d.puntos === 0.5 ? '½ punto' : d.puntos + ' pts';
            return `
              <div class="pend-dia">
                <div class="pend-dia-info">
                  <span class="pend-dia-fecha">${fmtFechaCorta(d.fecha)}</span>
                  <span class="pend-dia-meta">${turnoIcon[d.turno] || ''} ${turnoLbl[d.turno] || d.turno} · ${pts}</span>
                </div>
                <div class="pend-dia-monto">$${formatNumber(d.monto)}</div>
              </div>`;
          }).join('')}
        </div>`;
    });
  }

  // ===== 4. HISTÓRICO COBRADO (últimos 4 meses) =====
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const buckets = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = `${MESES[d.getMonth()]} ${d.getFullYear()}`;
    buckets.push({ key, lbl, total: 0, cantidad: 0 });
  }
  pagadosRecientes.forEach(a => {
    const k = a.cierre.fecha.slice(0, 7);
    const b = buckets.find(x => x.key === k);
    if (b) { b.total += parseFloat(a.monto || 0); b.cantidad++; }
  });
  const totalCobrado = buckets.reduce((s, b) => s + b.total, 0);

  if (totalCobrado > 0 || pendientes.length) {
    html += `
      <div class="cobrado-box">
        <div class="cobrado-header">
          <div class="cobrado-title"><i class="ti ti-cash"></i> Histórico cobrado</div>
          <div class="cobrado-periodo">Últimos meses</div>
        </div>
        <div class="cobrado-grid">
          ${buckets.map((b, i) => `
            <div class="cobrado-mes${i === 0 ? ' actual' : ''}">
              <div class="cobrado-mes-label">${b.lbl}${i === 0 ? ' · Actual' : ''}</div>
              <div class="cobrado-mes-monto${b.total > 0 ? '' : ' cero'}">$${formatNumber(b.total)}</div>
              ${b.cantidad ? `<div class="cobrado-mes-cant">${b.cantidad} ${b.cantidad === 1 ? 'cierre' : 'cierres'}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="cobrado-total">
          <span style="color:var(--c-muted)">Total cobrado:</span>
          <strong>$${formatNumber(totalCobrado)}</strong>
        </div>
      </div>`;
  }

  cont.innerHTML = html;
}

// ============================================
// GESTIÓN DE PROPINAS
// ============================================

let PROP_CIERRES = [];
let PROP_LOCAL_SEL = null;  // local seleccionado para filtrar
let PROP_CONFIG = null;     // cache de propinas_config

// ¿Quién puede entrar al módulo?
function puedeGestionarPropinas() {
  return isMaster() || isAdmin() || currentUser.editor_propinas === true;
}

// ¿Quién puede tocar configuración y marcar como pagado?
function puedeAdminPropinas() {
  return isMaster() || isAdmin();
}

// Locales que puede operar este usuario
function localesPropinasUsuario() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  // Editor: solo sus locales asignados que estén activos
  const asignados = currentUser.locales_asignados || [];
  return asignados.filter(loc => getLocalesActivos().includes(loc));
}

async function abrirGestionPropinas() {
  if (!puedeGestionarPropinas()) {
    toast('No tenés permiso para gestionar propinas', 'error');
    return;
  }

  showView('vGestionPropinas');
  document.getElementById('propGestTabla').innerHTML = '<div class="loading">Cargando cierres...</div>';
  document.getElementById('propGestKpis').innerHTML = '';

  // Cargar config + cierres en paralelo
  try {
    const [configs, cierres] = await Promise.all([
      api('propinas_config?id=eq.1'),
      api('propinas_cierres?order=fecha.desc,id.desc')
    ]);
    PROP_CONFIG = (configs && configs[0]) ? configs[0] : null;
    PROP_CIERRES = cierres || [];
  } catch (e) {
    document.getElementById('propGestTabla').innerHTML =
      '<div class="loading" style="color:var(--c-error)">Error al cargar datos</div>';
    return;
  }

  // Pre-seleccionar el primer local del usuario si no hay selección
  const localesUser = localesPropinasUsuario();
  if (!PROP_LOCAL_SEL || !localesUser.includes(PROP_LOCAL_SEL)) {
    PROP_LOCAL_SEL = localesUser[0] || null;
  }

  renderPropGestHeader();
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
  actualizarBtnNuevoCierre();
}

function renderPropGestHeader() {
  const subtitle = document.getElementById('propGestSubtitle');
  // Agregar botón Configurar al header si tiene permiso
  const headerBlock = subtitle.parentElement.parentElement;

  // Eliminar botón previo si existe (para evitar duplicados al re-renderizar)
  const oldBtn = headerBlock.querySelector('.btn-config-propinas');
  if (oldBtn) oldBtn.remove();

  if (puedeAdminPropinas()) {
    const btn = document.createElement('button');
    btn.className = 'btn-config-propinas';
    btn.title = 'Configurar tipos de cambio';
    btn.innerHTML = '<i class="ti ti-settings"></i>';
    btn.onclick = openConfigPropinas;
    headerBlock.appendChild(btn);
  }

  const _pexp = document.getElementById('propExportWrap');
  if (_pexp) _pexp.style.display = puedeAdminPropinas() ? '' : 'none';

  subtitle.textContent = puedeAdminPropinas()
    ? 'Cierres registrados · podés editarlos y marcar como pagados'
    : 'Cierres registrados de tus locales';
}

function renderPropGestLocales() {
  const cont = document.getElementById('propGestLocales');
  const locales = localesPropinasUsuario();

  if (locales.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-map-pin-off"></i><div class="bib-empty-title">No tenés locales asignados</div></div>';
    return;
  }

  if (locales.length === 1) {
    // Si solo tiene un local, no mostrar selector
    cont.innerHTML = '';
    return;
  }

  cont.innerHTML = locales.map(slug => `
    <button class="bib-chip ${PROP_LOCAL_SEL === slug ? 'active' : ''}"
            onclick="selectPropLocal('${esc(slug).replace(/'/g, "\\'")}')">
      <i class="ti ti-map-pin"></i>${esc(localLabel(slug))}
    </button>
  `).join('');
}

function selectPropLocal(slug) {
  PROP_LOCAL_SEL = slug;
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
  actualizarBtnNuevoCierre();
}

function cierresLocalActual() {
  if (!PROP_LOCAL_SEL) return [];
  const slugTodos = getSlugTransversal();
  if (slugTodos && PROP_LOCAL_SEL === slugTodos) {
    // "Todos los locales": agrego los cierres de todos los locales reales que el usuario puede ver
    const visibles = localesPropinasUsuario();
    return PROP_CIERRES.filter(c => c.local !== slugTodos && visibles.includes(c.local));
  }
  return PROP_CIERRES.filter(c => c.local === PROP_LOCAL_SEL);
}

// El botón "Nuevo cierre" no aplica en modo "Todos"
function actualizarBtnNuevoCierre() {
  const btn = document.getElementById('propGestNuevoBtn');
  if (!btn) return;
  const slugTodos = getSlugTransversal();
  btn.style.display = (slugTodos && PROP_LOCAL_SEL === slugTodos) ? 'none' : '';
}

function renderPropGestKpis() {
  const cont = document.getElementById('propGestKpis');
  const cierres = cierresLocalActual();

  const total = cierres.length;
  const pendientes = cierres.filter(c => !c.pagado).length;
  const pagados = total - pendientes;

  const totalAcum = cierres.reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);
  const aLiquidar = cierres.filter(c => !c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);
  const yaPagado = cierres.filter(c => c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);

  cont.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Cierres</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">${pendientes} pendiente${pendientes !== 1 ? 's' : ''} · ${pagados} pagado${pagados !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total acumulado</div>
      <div class="kpi-value">$${formatNumber(totalAcum)}</div>
    </div>
    <div class="kpi-card highlight">
      <div class="kpi-label">A liquidar</div>
      <div class="kpi-value">$${formatNumber(aLiquidar)}</div>
      <div class="kpi-sub">+$${formatNumber(yaPagado)} ya pagados</div>
    </div>
  `;
}

function renderPropGestTabla() {
  const cont = document.getElementById('propGestTabla');
  const cierres = cierresLocalActual();

  if (cierres.length === 0) {
    cont.innerHTML = `
      <div class="prop-empty">
        <i class="ti ti-cash-off"></i>
        <div class="prop-empty-title">No hay cierres todavía</div>
        <div class="prop-empty-desc">${PROP_LOCAL_SEL
          ? 'Cuando se cargue el primer cierre de ' + localLabel(PROP_LOCAL_SEL) + ', aparecerá acá.'
          : 'Elegí un local para ver sus cierres.'}</div>
      </div>`;
    return;
  }

  const TURNOS_LABEL = {
    mediodia: '🍲 Mediodía',
    'mediodía': '🍲 Mediodía',
    noche: '🌙 Noche',
    evento: '🎉 Evento',
    especial: '⭐ Especial'
  };

  let html = `
    <div class="prop-tabla">
      <div class="prop-tabla-header">
        <span>Fecha</span>
        <span>Turno</span>
        <span>Local</span>
        <span>Monto</span>
        <span>Puntos</span>
        <span>Estado</span>
      </div>`;

  cierres.forEach(c => {
    const fecha = c.fecha ? fmtFechaCorta(c.fecha) : '—';
    const turnoKey = (c.turno || '').toLowerCase();
    const turnoLabel = TURNOS_LABEL[turnoKey] || (c.turno || '—');
    const estadoCls = c.pagado ? 'pagado' : 'cerrado';
    const estadoTxt = c.pagado ? '✓ Pagado' : 'Cerrado';

    // Solo Admin/Master puede togglear pagado (no propaga al click de la fila)
    const estadoClickable = puedeAdminPropinas() ? `onclick="event.stopPropagation(); togglePagado(${c.id})"` : '';
    const estadoTitle = puedeAdminPropinas()
      ? (c.pagado ? 'title="Click para volver a Cerrado"' : 'title="Click para marcar como Pagado"')
      : '';

    // Master/Admin pueden editar un cierre mientras no esté pagado
    const editable = puedeAdminPropinas() && !c.pagado;
    const rowAttrs = editable ? `onclick="abrirEditarCierre(${c.id})" style="cursor:pointer" title="Tocá la fila para editar este cierre"` : '';

    html += `
      <div class="prop-tabla-row" ${rowAttrs}>
        <span class="prop-fecha">${fecha}</span>
        <span class="prop-turno">${turnoLabel}</span>
        <span class="prop-local">${esc(localLabel(c.local))}</span>
        <span class="prop-monto">$${formatNumber(Math.round((c.total_bruto || 0) * (1 - (parseFloat(c.porcentaje_admin) || 0) / 100)))}</span>
        <span>${c.total_puntos || 0}</span>
        <span class="prop-estado ${estadoCls}" ${estadoClickable} ${estadoTitle}>${estadoTxt}</span>
      </div>`;
  });

  html += '</div>';
  cont.innerHTML = html;
}

// Helper para formatear fecha corta tipo "18-may"
function fmtFechaCorta(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T00:00:00');
  const dia = d.getDate();
  const mes = MESES_CORTO[d.getMonth()];
  return `${dia}-${mes}`;
}

// Toggle pagado / cerrado
async function togglePagado(cierreId) {
  if (!puedeAdminPropinas()) return;
  const c = PROP_CIERRES.find(x => x.id === cierreId);
  if (!c) return;

  if (!c.pagado) {
    // Confirmar marcar como pagado
    const ok = await showConfirm({
      title: '¿Marcar como pagado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\nNeto: $${formatNumber(c.total_neto || 0)}\n\nAl marcar como pagado, los empleados dejarán de verlo en sus pendientes.`,
      type: 'success',
      okLabel: 'Sí, marcar pagado',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    // Confirmar revertir a cerrado
    const ok = await showConfirm({
      title: '¿Revertir a Cerrado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\n\nAl revertir, volverá a aparecer como pendiente en los empleados.`,
      type: 'warning',
      okLabel: 'Revertir',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!ok) return;
  }

  try {
    const body = c.pagado
      ? { pagado: false, pagado_en: null, pagado_por: null, actualizado_en: new Date().toISOString() }
      : { pagado: true, pagado_en: new Date().toISOString(), pagado_por: currentUser.id, actualizado_en: new Date().toISOString() };

    await api(`propinas_cierres?id=eq.${cierreId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache local
    Object.assign(c, body);

    toast(c.pagado ? 'Marcado como pagado' : 'Vuelto a Cerrado');
    renderPropGestKpis();
    renderPropGestTabla();
  } catch (e) {
    toast('Error al actualizar', 'error');
  }
}

// Placeholder para nuevo cierre (Fase 2)
// ============================================
// FASE 2 — NUEVO CIERRE DE PROPINAS
// ============================================
const BILLETES_DENOM = [100, 200, 500, 1000, 2000, 10000, 20000];
let CIERRE_COLABS = [];
let CIERRE_EDITANDO = null;       // id del cierre en edición (null = nuevo)
let CIERRE_EDIT_PUNTOS = {};      // empleado_id -> puntos (pre-carga al editar)
let CIERRE_LOCAL_ACTUAL = null;   // local del cierre que se está cargando/editando

function billeteVal(d) {
  const el = document.getElementById('bil_' + d);
  return el ? (parseInt(el.value, 10) || 0) : 0;
}
function valNumCierre(id) {
  const el = document.getElementById(id);
  return el ? (parseFloat(el.value) || 0) : 0;
}

function abrirNuevoCierre() {
  if (!puedeGestionarPropinas()) { toast('No tenés permiso para cargar cierres', 'error'); return; }
  if (!PROP_LOCAL_SEL || PROP_LOCAL_SEL === getSlugTransversal()) { toast('Elegí un local para cargar el cierre', 'error'); return; }
  CIERRE_EDITANDO = null;
  CIERRE_EDIT_PUNTOS = {};
  CIERRE_LOCAL_ACTUAL = PROP_LOCAL_SEL;
  const tit = document.getElementById('cierreModalTitulo'); if (tit) tit.textContent = 'Nuevo cierre';

  document.getElementById('cierreLocal').value = localLabel(PROP_LOCAL_SEL);
  document.getElementById('cierreFecha').value = hoyStr();
  document.getElementById('cierreTurno').value = 'noche';
  ['cierreUsd','cierreEur','cierreBrl','cierreTarjeta','cierreTransf','cierreComentario'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('cierreError').textContent = '';

  const tc = PROP_CONFIG || {};
  document.getElementById('cierreTcHint').textContent =
    'Cotización actual: USD $' + formatNumber(tc.tc_usd || 0) +
    ' · EUR $' + formatNumber(tc.tc_eur || 0) +
    ' · BRL $' + formatNumber(tc.tc_brl || 0);

  document.getElementById('cierreBilletes').innerHTML = BILLETES_DENOM.map(d =>
    '<label class="billete-row"><span>$' + formatNumber(d) + '</span>' +
    '<input type="number" min="0" step="1" id="bil_' + d + '" placeholder="0" oninput="recalcCierre()"></label>'
  ).join('');

  document.getElementById('cierreColabs').innerHTML = '<div class="loading">Cargando colaboradores...</div>';
  document.getElementById('modalNuevoCierre').classList.add('show');
  cargarColabsCierre();
  recalcCierre();
}
window.abrirNuevoCierre = abrirNuevoCierre;

// "Transversal (todos)" no es un local real: es el botón de "ver todos juntos"
function getSlugTransversal() {
  const l = LOCALES_DB.find(x => /transversal/i.test(x.nombre || '') || /transversal/i.test(x.slug || ''));
  return l ? l.slug : null;
}

async function abrirEditarCierre(cierreId) {
  if (!puedeAdminPropinas()) { toast('Solo Master/Admin puede editar cierres', 'error'); return; }
  const c = (PROP_CIERRES || []).find(x => x.id === cierreId);
  if (!c) { toast('No se encontró el cierre', 'error'); return; }
  if (c.pagado) { toast('No se puede editar un cierre ya pagado', 'error'); return; }
  // Asegurar que PROP_CONFIG esté cargado (puede no estarlo si se abre desde liquidar)
  if (!PROP_CONFIG) {
    try {
      const data = await api('propinas_config?id=eq.1');
      PROP_CONFIG = (data && data[0]) ? data[0] : {};
    } catch(e) { PROP_CONFIG = {}; }
  }

  CIERRE_EDITANDO = cierreId;
  CIERRE_EDIT_PUNTOS = {};
  CIERRE_LOCAL_ACTUAL = c.local;
  const tit = document.getElementById('cierreModalTitulo'); if (tit) tit.textContent = 'Editar cierre';

  document.getElementById('cierreLocal').value = localLabel(c.local);
  document.getElementById('cierreFecha').value = c.fecha || hoyStr();
  document.getElementById('cierreTurno').value = c.turno || 'noche';
  document.getElementById('cierreUsd').value = c.monto_usd || '';
  document.getElementById('cierreEur').value = c.monto_eur || '';
  document.getElementById('cierreBrl').value = c.monto_brl || '';
  document.getElementById('cierreTarjeta').value = c.monto_tarjeta || '';
  document.getElementById('cierreTransf').value = c.monto_transferencia || '';
  document.getElementById('cierreComentario').value = c.comentario || '';
  document.getElementById('cierreError').textContent = '';

  const tc = PROP_CONFIG || {};
  document.getElementById('cierreTcHint').textContent =
    'Cotización actual: USD $' + formatNumber(tc.tc_usd || 0) +
    ' · EUR $' + formatNumber(tc.tc_eur || 0) +
    ' · BRL $' + formatNumber(tc.tc_brl || 0);

  document.getElementById('cierreBilletes').innerHTML = BILLETES_DENOM.map(d =>
    '<label class="billete-row"><span>$' + formatNumber(d) + '</span>' +
    '<input type="number" min="0" step="1" id="bil_' + d + '" value="' + (c['bil_' + d] || 0) + '" placeholder="0" oninput="recalcCierre()"></label>'
  ).join('');

  document.getElementById('cierreColabs').innerHTML = '<div class="loading">Cargando colaboradores...</div>';
  document.getElementById('modalNuevoCierre').classList.add('show');

  try {
    const asigs = await api('propinas_asignaciones?cierre_id=eq.' + cierreId + '&select=empleado_id,puntos') || [];
    asigs.forEach(a => { CIERRE_EDIT_PUNTOS[a.empleado_id] = parseFloat(a.puntos) || 0; });
  } catch (e) { /* si falla, arrancan en 0 */ }

  await cargarColabsCierre(c.local);
  recalcCierre();
}
window.abrirEditarCierre = abrirEditarCierre;

async function cargarColabsCierre(localSlug) {
  const loc = localSlug || PROP_LOCAL_SEL;
  const cont = document.getElementById('cierreColabs');
  try {
    const filtro = 'empleados?activo=eq.true' +
      '&or=(local.eq.' + encodeURIComponent(loc) + ',es_multilocal.eq.true)' +
      '&select=id,nombre,apellido,nombre_p,local,es_multilocal&order=apellido.asc';
    const emps = await api(filtro) || [];
    CIERRE_COLABS = emps.map(e => {
      const ap = e.apellido || '';
      const pila = e.nombre_p || e.nombre || '';
      const nombre = (ap && pila) ? (ap + ', ' + pila) : (ap || pila || ('Empleado #' + e.id));
      const pts = CIERRE_EDITANDO ? (CIERRE_EDIT_PUNTOS[e.id] != null ? CIERRE_EDIT_PUNTOS[e.id] : 0) : 0;
      return { id: e.id, nombre: nombre, multi: !!e.es_multilocal && e.local !== loc, puntos: pts };
    });
    renderColabsCierre();
    recalcCierre();
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar colaboradores</div>';
  }
}

function renderColabsCierre() {
  const cont = document.getElementById('cierreColabs');
  if (!CIERRE_COLABS.length) {
    cont.innerHTML = '<div class="cierre-hint">No hay colaboradores activos en este local.</div>';
    return;
  }
  cont.innerHTML = CIERRE_COLABS.map((c, idx) => {
    const opts = [['0','0'], ['0.5','½'], ['1','1']];
    const seg = opts.map(o =>
      '<button type="button" class="puntos-btn' + (String(c.puntos) === o[0] ? ' active' : '') +
      '" onclick="setPuntoColab(' + idx + ',' + o[0] + ')">' + o[1] + '</button>'
    ).join('');
    return '<div class="colab-row">' +
      '<span class="colab-nombre">' + esc(c.nombre) + (c.multi ? ' <span class="colab-multi">multi</span>' : '') + '</span>' +
      '<div class="puntos-seg">' + seg + '</div>' +
      '</div>';
  }).join('');
}

window.setPuntoColab = function(idx, val) {
  if (CIERRE_COLABS[idx]) CIERRE_COLABS[idx].puntos = val;
  renderColabsCierre();
  recalcCierre();
};

function resumenRow(k, v, hi) {
  return '<div class="cierre-res-row' + (hi ? ' hi' : '') + '"><span>' + k + '</span><strong>' + v + '</strong></div>';
}

function recalcCierre() {
  const tc = PROP_CONFIG || {};
  let cash = 0;
  BILLETES_DENOM.forEach(d => { cash += d * billeteVal(d); });
  const extranjera = valNumCierre('cierreUsd') * (parseFloat(tc.tc_usd) || 0) +
                     valNumCierre('cierreEur') * (parseFloat(tc.tc_eur) || 0) +
                     valNumCierre('cierreBrl') * (parseFloat(tc.tc_brl) || 0);
  const electronico = valNumCierre('cierreTarjeta') + valNumCierre('cierreTransf');
  const total = cash + extranjera + electronico;
  const puntos = CIERRE_COLABS.reduce((s, c) => s + (parseFloat(c.puntos) || 0), 0);

  const pctPreview = parseFloat((PROP_CONFIG || {}).porcentaje_admin) || 0;
  const adminPreview = Math.round(total * pctPreview / 100);
  const netoPreview = total - adminPreview;

  document.getElementById('cierreResumen').innerHTML =
    resumenRow('Total bruto', '$' + formatNumber(Math.round(total))) +
    (pctPreview > 0 ? resumenRow('Administración (' + pctPreview + '%)', '− $' + formatNumber(adminPreview)) : '') +
    resumenRow('Total a repartir', '$' + formatNumber(netoPreview), true) +
    resumenRow('Puntos totales', puntos + (puntos > 0 ? '' : '  ⚠️ falta asignar'));
}
window.recalcCierre = recalcCierre;

async function guardarCierre() {
  const err = document.getElementById('cierreError'); err.textContent = '';
  const tc = PROP_CONFIG || {};

  const billetes = {};
  let cash = 0;
  BILLETES_DENOM.forEach(d => { const n = billeteVal(d); billetes['bil_' + d] = n; cash += d * n; });
  const usd = valNumCierre('cierreUsd'), eur = valNumCierre('cierreEur'), brl = valNumCierre('cierreBrl');
  const tarjeta = valNumCierre('cierreTarjeta'), transf = valNumCierre('cierreTransf');
  const extranjera = usd * (parseFloat(tc.tc_usd) || 0) + eur * (parseFloat(tc.tc_eur) || 0) + brl * (parseFloat(tc.tc_brl) || 0);
  const bruto = cash + extranjera + tarjeta + transf;
  const pct = parseFloat((PROP_CONFIG || {}).porcentaje_admin) || 0;
  const montoAdmin = Math.round(bruto * pct / 100);
  const neto = bruto - montoAdmin;  // lo que se reparte entre colaboradores
  const colabs = CIERRE_COLABS.filter(c => (parseFloat(c.puntos) || 0) > 0);
  const puntos = colabs.reduce((s, c) => s + parseFloat(c.puntos), 0);

  if (bruto <= 0) { err.textContent = 'Cargá al menos un monto (efectivo, moneda extranjera o electrónico).'; return; }
  if (puntos <= 0) { err.textContent = 'Asigná puntos a al menos un colaborador.'; return; }

  const btn = document.getElementById('btnGuardarCierre');
  btn.disabled = true; btn.textContent = 'Guardando...';
  const ahora = new Date().toISOString();

  const cierre = Object.assign({
    local: CIERRE_LOCAL_ACTUAL,
    fecha: document.getElementById('cierreFecha').value || hoyStr(),
    turno: document.getElementById('cierreTurno').value,
    monto_usd: usd, monto_eur: eur, monto_brl: brl,
    tc_usd: parseFloat(tc.tc_usd) || 0, tc_eur: parseFloat(tc.tc_eur) || 0, tc_brl: parseFloat(tc.tc_brl) || 0,
    monto_tarjeta: tarjeta, monto_transferencia: transf,
    porcentaje_admin: pct,
    total_bruto: Math.round(bruto), total_neto: Math.round(neto), total_puntos: puntos,
    comentario: (document.getElementById('cierreComentario').value || '').trim() || null,
    actualizado_en: ahora
  }, billetes);
  if (!CIERRE_EDITANDO) {
    cierre.pagado = false;
    cierre.creado_por = currentUser.id;
    cierre.creado_en = ahora;
  }

  try {
    let cierreId;
    if (CIERRE_EDITANDO) {
      await api('propinas_cierres?id=eq.' + CIERRE_EDITANDO, { method: 'PATCH', body: JSON.stringify(cierre) });
      cierreId = CIERRE_EDITANDO;
      // Reemplazo las asignaciones: borro las viejas y cargo las nuevas
      await api('propinas_asignaciones?cierre_id=eq.' + cierreId, { method: 'DELETE' });
    } else {
      const res = await api('propinas_cierres', { method: 'POST', body: JSON.stringify(cierre) });
      const nuevo = Array.isArray(res) ? res[0] : res;
      cierreId = nuevo.id;
    }

    const asigs = colabs.map(c => ({
      cierre_id: cierreId,
      empleado_id: c.id,
      puntos: c.puntos,
      monto: Math.round(neto * c.puntos / puntos)
    }));
    if (asigs.length) {
      await api('propinas_asignaciones', { method: 'POST', body: JSON.stringify(asigs) });
    }

    closeNuevoCierre();
    toast(CIERRE_EDITANDO ? '✓ Cierre actualizado' : ('✓ Cierre guardado y repartido entre ' + colabs.length + ' colaboradores'), 'success');
    PROP_CIERRES = await api('propinas_cierres?order=fecha.desc,id.desc') || [];
    renderPropGestKpis();
    renderPropGestTabla();
  } catch (e) {
    err.textContent = 'Error al guardar el cierre. Revisá la conexión y reintentá.';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cierre';
  }
}
window.guardarCierre = guardarCierre;
window.closeNuevoCierre = function() {
  document.getElementById('modalNuevoCierre').classList.remove('show');
};

// ============================================
// EXPORTAR LIQUIDACIÓN DE PROPINAS (Excel)
// ============================================
const TURNOS_LIQ = { mediodia: 'Mediodía', 'mediodía': 'Mediodía', noche: 'Noche', evento: 'Evento', especial: 'Especial' };

function fmtFechaDDMM(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : (iso || '');
}

window.abrirLiquidacion = function() {
  if (!puedeGestionarPropinas()) { toast('No tenés permiso', 'error'); return; }
  const localesUser = localesPropinasUsuario();
  // Pre-cargar el período para que cubra los cierres pendientes de liquidar
  const pendientes = (PROP_CIERRES || []).filter(c => !c.pagado && c.fecha && localesUser.includes(c.local));
  let desde, hasta;
  if (pendientes.length) {
    const fechas = pendientes.map(c => c.fecha).sort();
    desde = fechas[0];
    hasta = fechas[fechas.length - 1];
  } else {
    const hoy = new Date();
    const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    desde = primero.toISOString().slice(0, 10);
    hasta = hoyStr();
  }
  document.getElementById('liqDesde').value = desde;
  document.getElementById('liqHasta').value = hasta;
  document.getElementById('liqError').textContent = '';
  document.getElementById('modalLiquidacion').classList.add('show');
};
window.closeLiquidacion = function() {
  document.getElementById('modalLiquidacion').classList.remove('show');
};

window.generarLiquidacion = async function() {
  const err = document.getElementById('liqError'); err.textContent = '';
  const desde = document.getElementById('liqDesde').value;
  const hasta = document.getElementById('liqHasta').value;
  if (!desde || !hasta) { err.textContent = 'Elegí el período (desde y hasta).'; return; }
  if (desde > hasta) { err.textContent = 'La fecha "desde" no puede ser posterior a "hasta".'; return; }

  const btn = document.getElementById('btnGenerarLiq');
  btn.disabled = true; btn.textContent = 'Generando...';

  try {
    const localesUser = localesPropinasUsuario();
    let cierres = await api('propinas_cierres?fecha=gte.' + desde + '&fecha=lte.' + hasta + '&order=fecha.asc') || [];
    cierres = cierres.filter(c => localesUser.includes(c.local));
    if (!cierres.length) {
      err.textContent = 'No hay cierres en ese período.';
      btn.disabled = false; btn.textContent = 'Generar Excel';
      return;
    }

    const cierreMap = {};
    cierres.forEach(c => { cierreMap[c.id] = c; });
    const ids = cierres.map(c => c.id);

    const asigs = await api('propinas_asignaciones?cierre_id=in.(' + ids.join(',') + ')&select=*') || [];
    if (!asigs.length) {
      err.textContent = 'Los cierres del período no tienen colaboradores cargados.';
      btn.disabled = false; btn.textContent = 'Generar Excel';
      return;
    }

    const empIds = Array.from(new Set(asigs.map(a => a.empleado_id)));
    const emps = await api('empleados?id=in.(' + empIds.join(',') + ')&select=id,nombre,apellido,nombre_p,alias') || [];
    const empMap = {};
    const aliasMap = {};
    emps.forEach(e => {
      const ap = e.apellido || '';
      const pila = e.nombre_p || e.nombre || '';
      empMap[e.id] = (ap && pila) ? (ap + ', ' + pila) : (ap || pila || ('Empleado #' + e.id));
      aliasMap[e.id] = e.alias || '';
    });
    const nombreEmp = id => empMap[id] || ('Empleado #' + id);

    // ---- DETALLE por cierre (una fila por colaborador + una fila por Administración) ----
    const detalleColabs = asigs.map(a => {
      const c = cierreMap[a.cierre_id] || {};
      return {
        'Empleado': nombreEmp(a.empleado_id),
        'Local': localLabel(c.local) || c.local || '',
        'Fecha': fmtFechaDDMM(c.fecha),
        'Turno': TURNOS_LIQ[(c.turno || '').toLowerCase()] || c.turno || '',
        'Estado': c.pagado ? 'Pagado' : 'Pendiente',
        'Puntos': parseFloat(a.puntos) || 0,
        'Monto': parseFloat(a.monto) || 0
      };
    });

    // Filas de Administración: una por cada cierre que tenga porcentaje_admin > 0
    const detalleAdmin = cierres
      .filter(c => (parseFloat(c.porcentaje_admin) || 0) > 0)
      .map(c => {
        const pctC = parseFloat(c.porcentaje_admin) || 0;
        const montoAdminC = Math.round((parseFloat(c.total_bruto) || 0) * pctC / 100);
        return {
          'Empleado': 'Administración (' + pctC + '%)',
          'Local': localLabel(c.local) || c.local || '',
          'Fecha': fmtFechaDDMM(c.fecha),
          'Turno': TURNOS_LIQ[(c.turno || '').toLowerCase()] || c.turno || '',
          'Estado': c.pagado ? 'Pagado' : 'Pendiente',
          'Puntos': '-',
          'Monto': montoAdminC
        };
      });

    const detalle = [...detalleColabs, ...detalleAdmin].sort((x, y) =>
      x.Fecha.localeCompare(y.Fecha) ||
      x.Local.localeCompare(y.Local, 'es') ||
      x.Empleado.localeCompare(y.Empleado, 'es')
    );

    // ---- RESUMEN: una fila por empleado con su total (el desglose por local/cierre está en la otra hoja) ----
    const grupos = {};
    asigs.forEach(a => {
      const c = cierreMap[a.cierre_id] || {};
      const id = a.empleado_id;
      if (!grupos[id]) grupos[id] = { empId: id, cierres: 0, puntos: 0, pendiente: 0, pagado: 0, locales: {} };
      const g = grupos[id];
      g.cierres += 1;
      g.puntos += parseFloat(a.puntos) || 0;
      const m = parseFloat(a.monto) || 0;
      if (c.pagado) g.pagado += m; else g.pendiente += m;
      const locLbl = localLabel(c.local) || c.local || '';
      if (locLbl) g.locales[locLbl] = true;
    });

    const resumenColabs = Object.keys(grupos).map(id => {
      const g = grupos[id];
      return {
        'Empleado': nombreEmp(g.empId),
        'Locales': Object.keys(g.locales).sort((a, b) => a.localeCompare(b, 'es')).join(', '),
        'Cierres': g.cierres,
        'Puntos': g.puntos,
        'Pendiente': Math.round(g.pendiente),
        'Pagado': Math.round(g.pagado),
        'Total': Math.round(g.pendiente + g.pagado),
        'Alias': aliasMap[g.empId] || ''
      };
    }).sort((x, y) => x.Empleado.localeCompare(y.Empleado, 'es'));

    // Fila de Administración en el resumen
    const gruposAdmin = {};
    cierres.forEach(c => {
      const pctC = parseFloat(c.porcentaje_admin) || 0;
      if (!pctC) return;
      const loc = localLabel(c.local) || c.local || '';
      if (!gruposAdmin[loc]) gruposAdmin[loc] = { pendiente: 0, pagado: 0, cierres: 0, pct: pctC };
      const montoAdminC = Math.round((parseFloat(c.total_bruto) || 0) * pctC / 100);
      gruposAdmin[loc].cierres += 1;
      if (c.pagado) gruposAdmin[loc].pagado += montoAdminC;
      else gruposAdmin[loc].pendiente += montoAdminC;
    });
    const resumenAdmin = Object.keys(gruposAdmin).sort().map(loc => {
      const g = gruposAdmin[loc];
      return {
        'Empleado': 'Administración (' + g.pct + '%)',
        'Locales': loc,
        'Cierres': g.cierres,
        'Puntos': '-',
        'Pendiente': Math.round(g.pendiente),
        'Pagado': Math.round(g.pagado),
        'Total': Math.round(g.pendiente + g.pagado),
        'Alias': ''
      };
    });

    const resumen = [...resumenColabs, ...resumenAdmin];

    exportarAExcel('Liquidacion_propinas_AZUCA_' + desde + '_a_' + hasta + '.xlsx', [
      { nombre: 'Resumen por empleado', filas: resumen },
      { nombre: 'Detalle por cierre', filas: detalle }
    ]);
    closeLiquidacion();
    toast('✓ Liquidación generada (' + cierres.length + ' cierres)', 'success');
  } catch (e) {
    err.textContent = 'Error al generar la liquidación. Reintentá.';
  } finally {
    btn.disabled = false; btn.textContent = 'Generar Excel';
  }
};

// ============================================
// MÓDULO RECETAS — SUB-ELABORACIONES (tipo = elaboracion)
// ============================================
let RECETAS_DB = [];            // sub-elaboraciones activas
let RECETAS_COSTO = {};         // receta_id -> costo_mp (de la vista)
let RECETAS_INSUMOS_VAL = [];   // insumos validados (para el picker)
let RECETA_FILTRO_LOCAL = '';
let RECETA_EDITANDO = null;
let RECETA_COMP_EDIT = [];      // componentes en edición
const UNIDADES_RECETA = ['kg', 'g', 'l', 'ml', 'unidad', 'porción'];
let RECETA_TIPO = 'elaboracion';     // sección activa: 'elaboracion' | 'plato'
let RECETAS_VIEW = {};               // receta_id -> fila de v_costeo_recetas
let RECETAS_ELAB_PICKER = [];        // sub-elaboraciones disponibles como componente
const FOOD_COST_SALUDABLE = 35;      // % de food cost saludable (badge verde)
let RECETA_COMP_VIEJOS = [];         // ids de componentes existentes (para borrar al editar)
let COSTEO_INSUMOS = {};             // id -> {costo, cant_pres, unidad}
let COSTEO_RECETAS = {};             // id -> {rendimiento, unidad_rendimiento, tipo, precio_venta}
let COSTEO_COMPS = {};               // receta_id -> [componentes]
let RECETAS_COSTO_CALC = {};         // id -> costo total calculado correctamente
let COSTEO_PASOS = {};               // menu_id -> [pasos]
let RECETAS_PLATOS_PICKER = [];      // platos disponibles como paso de menú
let MENU_PASOS_EDIT = [];            // pasos en edición
let MENU_PASOS_VIEJOS = [];          // ids de pasos existentes (para borrar al editar)
let COSTEO_CARGADO = false;          // cache: evita recargar el costeo en cada cambio de pestaña

function puedeGestionarRecetas() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_recetas === true);
}

// Cantidad con decimales (no redondea como formatNumber, que es para pesos)
function fmtCant(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

// ============================================
// MÓDULO MIS DATOS (el empleado edita su propia ficha)
// ============================================
function openMisDatos() {
  showView('vMisDatos');
  cargarMisDatos();
}
window.openMisDatos = openMisDatos;

function opcionesTalle(valores, sel) {
  return '<option value="">—</option>' + valores.map(v =>
    '<option value="' + v + '"' + (String(v) === String(sel || '') ? ' selected' : '') + '>' + v + '</option>').join('');
}

async function cargarMisDatos() {
  const form = document.getElementById('misDatosForm');
  const noFicha = document.getElementById('misDatosNoFicha');
  if (!currentUser || !currentUser.empleado_id) {
    if (form) form.style.display = 'none';
    if (noFicha) noFicha.style.display = '';
    return;
  }
  if (noFicha) noFicha.style.display = 'none';
  if (form) form.style.display = '';
  try {
    const emps = await api('empleados?id=eq.' + currentUser.empleado_id + '&select=*');
    if (emps && emps.length) currentEmpleado = emps[0];
  } catch (e) {}
  const e = currentEmpleado || {};
  document.getElementById('miNombre').value = e.nombre_p || e.nombre || '';
  document.getElementById('miApellido').value = e.apellido || '';
  document.getElementById('miDocumento').value = e.documento || '';
  document.getElementById('miFechaNac').value = e.fecha_nac || '';
  document.getElementById('miTelefono').value = e.telefono || '';
  document.getElementById('miEmail').value = e.email || '';
  document.getElementById('miAlias').value = e.alias || '';
  const pantalones = []; for (let i = 36; i <= 56; i += 2) pantalones.push(i);
  const calzados = []; for (let i = 35; i <= 46; i++) calzados.push(i);
  document.getElementById('miTalleRemera').innerHTML = opcionesTalle(['XS','S','M','L','XL','XXL','XXXL'], e.talle_remera);
  document.getElementById('miTallePantalon').innerHTML = opcionesTalle(pantalones, e.talle_pantalon);
  document.getElementById('miTalleCalzado').innerHTML = opcionesTalle(calzados, e.talle_calzado);
  document.getElementById('misDatosError').textContent = '';
  document.getElementById('misDatosOk').textContent = '';
}

window.guardarMisDatos = async function() {
  if (!currentUser || !currentUser.empleado_id) return;
  const err = document.getElementById('misDatosError'); err.textContent = '';
  const ok = document.getElementById('misDatosOk'); ok.textContent = '';
  const nombre = document.getElementById('miNombre').value.trim();
  if (!nombre) { err.textContent = 'El nombre no puede quedar vacío.'; return; }
  const email = document.getElementById('miEmail').value.trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Revisá el email, no parece válido.'; return; }
  const datos = {
    nombre: nombre,
    nombre_p: nombre,
    apellido: document.getElementById('miApellido').value.trim() || null,
    documento: document.getElementById('miDocumento').value.trim() || null,
    fecha_nac: document.getElementById('miFechaNac').value || null,
    telefono: document.getElementById('miTelefono').value.trim() || null,
    email: email || null,
    alias: document.getElementById('miAlias').value.trim() || null,
    talle_remera: document.getElementById('miTalleRemera').value || null,
    talle_pantalon: document.getElementById('miTallePantalon').value || null,
    talle_calzado: document.getElementById('miTalleCalzado').value || null
  };
  const btn = document.getElementById('btnGuardarMisDatos');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await api('empleados?id=eq.' + currentUser.empleado_id, { method: 'PATCH', body: JSON.stringify(datos) });
    if (!currentEmpleado) currentEmpleado = {};
    Object.assign(currentEmpleado, datos);
    ok.textContent = '✓ Tus datos se guardaron correctamente.';
    toast('✓ Datos guardados', 'success');
  } catch (e) {
    err.textContent = 'Error al guardar: ' + (e && e.message ? e.message.slice(0, 150) : e);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

function openMisRecetas() {
  showView('vMisRecetas');
  RECETA_TIPO = 'elaboracion';
  COSTEO_CARGADO = false;
  actualizarTabsReceta();
  RECETA_FILTRO_LOCAL = '';
  const s = document.getElementById('recetaSearch'); if (s) s.value = '';
  const fl = document.getElementById('recetaFiltroLocal'); if (fl) fl.value = '';
  const btn = document.getElementById('recetaNuevoBtn');
  if (btn) btn.style.display = puedeGestionarRecetas() ? '' : 'none';
  cargarRecetas();
}
window.openMisRecetas = openMisRecetas;

function actualizarTabsReceta() {
  const te = document.getElementById('tabElaboracion');
  const tp = document.getElementById('tabPlato');
  const tm = document.getElementById('tabMenu');
  if (te) te.classList.toggle('active', RECETA_TIPO === 'elaboracion');
  if (tp) tp.classList.toggle('active', RECETA_TIPO === 'plato');
  if (tm) tm.classList.toggle('active', RECETA_TIPO === 'menu');
  const s = document.getElementById('recetaSearch');
  if (s) s.placeholder = RECETA_TIPO === 'menu' ? 'Buscar menú...' : (RECETA_TIPO === 'plato' ? 'Buscar plato...' : 'Buscar sub-elaboración...');
}

window.cambiarSeccionReceta = function(tipo) {
  RECETA_TIPO = tipo;
  actualizarTabsReceta();
  const s = document.getElementById('recetaSearch'); if (s) s.value = '';
  const fl = document.getElementById('recetaFiltroLocal'); if (fl) fl.value = '';
  cargarRecetas();
};

function unitCostInsumoCosteo(ins) {
  return (parseFloat(ins.costo) || 0) / (parseFloat(ins.cant_pres) || 1);
}

// Costo total de una receta, recorriendo insumos y sub-elaboraciones (recursivo, con memo y guarda de ciclos)
function computeCostoReceta(id, cache, stack) {
  if (cache[id] != null) return cache[id];
  if (stack[id]) return 0;               // evita bucles infinitos
  stack[id] = true;
  let total = 0;
  const rec = COSTEO_RECETAS[id];
  if (rec && rec.tipo === 'menu') {
    const pasos = COSTEO_PASOS[id] || [];
    for (let k = 0; k < pasos.length; k++) {
      if (pasos[k].opcional) continue;
      total += computeCostoReceta(pasos[k].receta_id, cache, stack);
    }
  } else {
    const comps = COSTEO_COMPS[id] || [];
    for (let k = 0; k < comps.length; k++) {
      const c = comps[k];
      const cant = parseFloat(c.cantidad) || 0;
      if (c.tipo_componente === 'ingrediente') {
        const ins = COSTEO_INSUMOS[c.ingrediente_id];
        if (!ins) continue;
        const conv = convertirCantidad(cant, c.unidad, ins.unidad);
        if (conv != null) total += conv * unitCostInsumoCosteo(ins);
      } else {
        const sub = COSTEO_RECETAS[c.sub_receta_id];
        if (!sub) continue;
        const subTotal = computeCostoReceta(c.sub_receta_id, cache, stack);
        const rend = parseFloat(sub.rendimiento) || 0;
        const ucSub = rend > 0 ? subTotal / rend : 0;
        const conv = convertirCantidad(cant, c.unidad, sub.unidad_rendimiento);
        if (conv != null) total += conv * ucSub;
      }
    }
  }
  delete stack[id];
  cache[id] = total;
  return total;
}

// Carga todo el árbol de recetas/insumos y precalcula el costo de cada receta
async function cargarDatosCosteo() {
  if (COSTEO_CARGADO) return;
  const recs = await api('recetas?select=id,tipo,rendimiento,unidad_rendimiento,precio_venta') || [];
  const comps = await api('receta_componentes?select=receta_id,tipo_componente,ingrediente_id,sub_receta_id,cantidad,unidad') || [];
  const inss = await api('ingredientes?activo=eq.true&select=id,costo,cantidad_por_presentacion,unidad') || [];
  const pasos = await api('menu_pasos?select=menu_id,receta_id,orden,opcional') || [];
  COSTEO_PASOS = {};
  pasos.forEach(p => { (COSTEO_PASOS[p.menu_id] = COSTEO_PASOS[p.menu_id] || []).push(p); });
  COSTEO_RECETAS = {};
  recs.forEach(r => { COSTEO_RECETAS[r.id] = r; });
  COSTEO_COMPS = {};
  comps.forEach(c => { (COSTEO_COMPS[c.receta_id] = COSTEO_COMPS[c.receta_id] || []).push(c); });
  COSTEO_INSUMOS = {};
  inss.forEach(i => { COSTEO_INSUMOS[i.id] = { costo: i.costo, cant_pres: i.cantidad_por_presentacion, unidad: i.unidad }; });
  RECETAS_COSTO_CALC = {};
  const cache = {};
  Object.keys(COSTEO_RECETAS).forEach(id => {
    try {
      RECETAS_COSTO_CALC[id] = computeCostoReceta(parseInt(id, 10), cache, {});
    } catch (e) {
      RECETAS_COSTO_CALC[id] = 0;
    }
  });
  COSTEO_CARGADO = true;
}

async function cargarRecetas() {
  const lista = document.getElementById('recetasLista');
  const etiqueta = RECETA_TIPO === 'menu' ? 'menús' : (RECETA_TIPO === 'plato' ? 'platos' : 'sub-elaboraciones');
  if (lista) lista.innerHTML = '<div class="loading">Cargando ' + etiqueta + '...</div>';
  // 1) Lo esencial: la lista. Si esto falla, mostramos el motivo real.
  try {
    RECETAS_DB = await api('recetas?tipo=eq.' + RECETA_TIPO + '&activo=eq.true&select=*&order=nombre.asc') || [];
  } catch (e) {
    if (lista) lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">No se pudo cargar la lista. Revisá la conexión y volvé a entrar.<br><span style="font-size:11px;opacity:.7">' + esc(String((e && e.message) || e)) + '</span></div>';
    return;
  }
  // 2) Costeo: si falla (ej: señal mala), igual mostramos la lista (sin costos)
  try { await cargarDatosCosteo(); } catch (e) { console.warn('Costeo no disponible:', e); }
  // 3) Datos para editar: no deben bloquear la lista
  try {
    if (!RECETAS_INSUMOS_VAL.length) {
      RECETAS_INSUMOS_VAL = await api('ingredientes?validado=eq.true&activo=eq.true&select=id,nombre,unidad,costo,cantidad_por_presentacion&order=nombre.asc') || [];
    }
    if (!RECETAS_ELAB_PICKER.length) {
      RECETAS_ELAB_PICKER = await api('recetas?tipo=eq.elaboracion&activo=eq.true&select=id,nombre,unidad_rendimiento,rendimiento&order=nombre.asc') || [];
    }
    if (!RECETAS_PLATOS_PICKER.length) {
      RECETAS_PLATOS_PICKER = await api('recetas?tipo=eq.plato&activo=eq.true&select=id,nombre&order=nombre.asc') || [];
    }
  } catch (e) { console.warn('Datos de edición no disponibles:', e); }
  poblarFiltroLocalReceta();
  renderRecetas();
}

function poblarFiltroLocalReceta() {
  const sel = document.getElementById('recetaFiltroLocal');
  if (!sel) return;
  const locales = Array.from(new Set(RECETAS_DB.map(r => r.local).filter(Boolean)))
    .sort((a, b) => (localLabel(a) || a).localeCompare(localLabel(b) || b, 'es'));
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todos los locales</option>' +
    locales.map(l => '<option value="' + esc(l) + '">' + esc(localLabel(l)) + '</option>').join('');
  sel.value = prev;
}

function recetasFiltradas() {
  const q = normalizar((document.getElementById('recetaSearch') || {}).value);
  const fLocal = (document.getElementById('recetaFiltroLocal') || {}).value || '';
  return RECETAS_DB.filter(r => {
    if (fLocal) {
      // un local muestra sus recetas + las TRANSVERSAL (globales)
      if (r.local !== fLocal && !/transversal/i.test(r.local || '')) return false;
    }
    if (q && normalizar(r.nombre).indexOf(q) === -1) return false;
    return true;
  });
}

function renderRecetas() {
  const lista = document.getElementById('recetasLista');
  if (!lista) return;
  const items = recetasFiltradas();
  const esPlato = RECETA_TIPO === 'plato';
  const esMenu = RECETA_TIPO === 'menu';
  const fmtPct = n => (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cnt = document.getElementById('recetasCount');
  if (cnt) {
    const sing = esMenu ? 'menú' : (esPlato ? 'plato' : 'sub-elaboración');
    const plur = esMenu ? 'menús' : (esPlato ? 'platos' : 'sub-elaboraciones');
    cnt.textContent = items.length + ' ' + (items.length === 1 ? sing : plur);
  }
  if (!items.length) {
    lista.innerHTML = '<div class="empty-list">No hay resultados con ese criterio</div>';
    return;
  }
  const gestiona = puedeGestionarRecetas();
  lista.innerHTML = items.map(r => {
    const transversal = /transversal/i.test(r.local || '');
    const costo = RECETAS_COSTO_CALC[r.id] || 0;
    const head =
      '<div class="rc-top">' +
        '<div class="rc-name">' + esc(r.nombre) + '</div>' +
        '<span class="rc-localbadge' + (transversal ? ' transv' : '') + '">' + esc(localLabel(r.local)) + '</span>' +
      '</div>';

    let meta;
    if (esPlato || esMenu) {
      const precio = parseFloat(r.precio_venta) || 0;
      const fc = precio > 0 ? (costo / precio * 100) : 0;
      const margen = precio - costo;
      let pre;
      if (esMenu) {
        const nPasos = (COSTEO_PASOS[r.id] || []).length;
        pre = '<span class="rc-cat">' + nPasos + (nPasos === 1 ? ' paso' : ' pasos') + '</span>';
      } else {
        pre = r.categoria ? ('<span class="rc-cat">' + esc(r.categoria) + '</span>') : '';
      }
      let l2;
      if (precio > 0) {
        l2 = '<span><i class="ti ti-coin"></i> costo $' + formatNumber(Math.round(costo)) + '</span>' +
             '<span><i class="ti ti-tag"></i> venta $' + formatNumber(Math.round(precio)) + '</span>' +
             '<span class="rc-fc' + (fc <= FOOD_COST_SALUDABLE ? ' ok' : ' alto') + '">FC ' + fmtPct(fc) + '%</span>' +
             '<span><i class="ti ti-trending-up"></i> margen $' + formatNumber(Math.round(margen)) + '</span>';
      } else {
        l2 = '<span><i class="ti ti-coin"></i> costo $' + formatNumber(Math.round(costo)) + '</span>' +
             '<span class="rc-fc sinprecio">Sin precio</span>';
      }
      meta = '<div class="rc-meta">' + pre + l2 + '</div>';
    } else {
      const rend = parseFloat(r.rendimiento) || 0;
      const unidad = r.unidad_rendimiento || '';
      const costoUnit = rend > 0 ? (costo / rend) : 0;
      meta = '<div class="rc-meta">' +
        '<span><i class="ti ti-scale"></i> rinde ' + fmtCant(rend) + ' ' + esc(unidad) + '</span>' +
        '<span><i class="ti ti-coin"></i> $' + formatNumber(Math.round(costo)) + (rend > 0 ? (' · $' + formatNumber(Math.round(costoUnit)) + '/' + esc(unidad)) : '') + '</span>' +
      '</div>';
    }
    return '<div class="receta-card"' + (gestiona ? ' onclick="abrirEditarSubelab(' + r.id + ')" style="cursor:pointer"' : '') + '>' + head + meta + '</div>';
  }).join('');
}

// ---- Alta / edición ----
function opcionesLocalReceta(sel) {
  const locales = getLocalesActivos();
  return locales.map(l => '<option value="' + esc(l) + '"' + (l === sel ? ' selected' : '') + '>' + esc(localLabel(l)) + '</option>').join('');
}
function opcionesUnidad(sel) {
  return UNIDADES_RECETA.map(u => '<option value="' + u + '"' + (u === sel ? ' selected' : '') + '>' + u + '</option>').join('');
}

function configurarCamposModal() {
  const t = RECETA_TIPO;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('rendimientoCampos', t !== 'menu');
  show('categoriaCampo', t === 'plato');
  show('precioCampo', t === 'plato' || t === 'menu');
  show('componentesSection', t !== 'menu');
  show('menuPasosSection', t === 'menu');
}

window.poblarPlatosPicker = function() {
  const sel = document.getElementById('pasoPlato');
  if (!sel) return;
  sel.innerHTML = '<option value="">Elegí un plato...</option>' +
    RECETAS_PLATOS_PICKER.map(p => '<option value="' + p.id + '">' + esc(p.nombre) + '</option>').join('');
};

window.agregarPaso = function() {
  const sel = document.getElementById('pasoPlato');
  const id = parseInt(sel.value, 10);
  if (!id) { toast('Elegí un plato', 'error'); return; }
  const plato = RECETAS_PLATOS_PICKER.find(p => p.id === id);
  MENU_PASOS_EDIT.push({ receta_id: id, nombre: plato ? plato.nombre : ('Plato #' + id), nombre_paso: '', opcional: false });
  sel.value = '';
  renderPasosEdit();
};

window.quitarPaso = function(idx) {
  MENU_PASOS_EDIT.splice(idx, 1);
  renderPasosEdit();
};

window.setPasoNombre = function(idx, val) {
  if (MENU_PASOS_EDIT[idx]) MENU_PASOS_EDIT[idx].nombre_paso = val;
};

window.setPasoOpcional = function(idx, checked) {
  if (MENU_PASOS_EDIT[idx]) { MENU_PASOS_EDIT[idx].opcional = checked; renderPasosEdit(); }
};

function renderPasosEdit() {
  const cont = document.getElementById('pasosLista');
  if (!cont) return;
  if (!MENU_PASOS_EDIT.length) {
    cont.innerHTML = '<div class="cierre-hint">Todavía no agregaste pasos.</div>';
    return;
  }
  let total = 0;
  const filas = MENU_PASOS_EDIT.map((p, idx) => {
    const costoPlato = RECETAS_COSTO_CALC[p.receta_id] || 0;
    if (!p.opcional) total += costoPlato;
    return '<div class="comp-row">' +
      '<div class="comp-info" style="flex:1;">' +
        '<span class="comp-nombre"><strong>' + (idx + 1) + '.</strong> ' + esc(p.nombre) + '</span>' +
        '<span class="comp-costo">costo $' + formatNumber(Math.round(costoPlato)) + (p.opcional ? ' · <span class="comp-duda">opcional (no suma)</span>' : '') + '</span>' +
        '<div class="paso-controls">' +
          '<input type="text" class="paso-nombre" placeholder="Nombre del paso (ej: Entrada)" value="' + esc(p.nombre_paso || '') + '" oninput="setPasoNombre(' + idx + ', this.value)">' +
          '<label class="paso-opc"><input type="checkbox" ' + (p.opcional ? 'checked' : '') + ' onchange="setPasoOpcional(' + idx + ', this.checked)"> opcional</label>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="comp-del" onclick="quitarPaso(' + idx + ')" aria-label="Quitar"><i class="ti ti-trash"></i></button>' +
    '</div>';
  }).join('');
  const totalLinea = '<div class="comp-total">Costo del menú: <strong>$' + formatNumber(Math.round(total)) + '</strong>' +
    '<div class="comp-total-hint">Suma los platos no opcionales. El food cost se ve en la lista.</div></div>';
  cont.innerHTML = filas + totalLinea;
}

async function cargarPasosEnEditor(id) {
  const cont = document.getElementById('pasosLista');
  if (cont) cont.innerHTML = '<div class="loading">Cargando pasos...</div>';
  try {
    const pasos = await api('menu_pasos?menu_id=eq.' + id + '&select=*&order=orden') || [];
    MENU_PASOS_VIEJOS = pasos.map(p => p.id);
    MENU_PASOS_EDIT = pasos.map(p => {
      const plato = RECETAS_PLATOS_PICKER.find(x => x.id === p.receta_id);
      return { receta_id: p.receta_id, nombre: plato ? plato.nombre : ('Plato #' + p.receta_id), nombre_paso: p.nombre_paso || '', opcional: !!p.opcional };
    });
    renderPasosEdit();
  } catch (e) {
    if (cont) cont.innerHTML = '<div class="cierre-hint" style="color:var(--c-error)">Error al cargar los pasos</div>';
  }
}

window.abrirNuevaSubelab = function() {
  if (!puedeGestionarRecetas()) { toast('No tenés permiso', 'error'); return; }
  const t = RECETA_TIPO;
  RECETA_EDITANDO = null;
  RECETA_COMP_EDIT = []; RECETA_COMP_VIEJOS = [];
  MENU_PASOS_EDIT = []; MENU_PASOS_VIEJOS = [];
  document.getElementById('subelabTitulo').textContent = t === 'menu' ? 'Nuevo menú' : (t === 'plato' ? 'Nuevo plato' : 'Nueva sub-elaboración');
  document.getElementById('subelabNombre').value = '';
  document.getElementById('subelabLocal').innerHTML = opcionesLocalReceta('');
  document.getElementById('subelabRendimiento').value = t === 'plato' ? '1' : '';
  document.getElementById('subelabUnidad').innerHTML = opcionesUnidad(t === 'plato' ? 'porción' : 'kg');
  document.getElementById('subelabProcedimiento').value = '';
  document.getElementById('platoCategoria').value = '';
  document.getElementById('platoPrecio').value = '';
  document.getElementById('subelabError').textContent = '';
  configurarCamposModal();
  prepararPickerComponente();
  renderComponentesEdit();
  poblarPlatosPicker();
  renderPasosEdit();
  document.getElementById('modalSubelab').classList.add('show');
};

window.abrirEditarSubelab = async function(id) {
  if (!puedeGestionarRecetas()) { toast('No tenés permiso', 'error'); return; }
  const r = RECETAS_DB.find(x => x.id === id);
  if (!r) return;
  RECETA_EDITANDO = id;
  RECETA_COMP_EDIT = [];
  MENU_PASOS_EDIT = []; MENU_PASOS_VIEJOS = [];
  const t = RECETA_TIPO;
  document.getElementById('subelabTitulo').textContent = t === 'menu' ? 'Editar menú' : (t === 'plato' ? 'Editar plato' : 'Editar sub-elaboración');
  document.getElementById('subelabNombre').value = r.nombre || '';
  document.getElementById('subelabLocal').innerHTML = opcionesLocalReceta(r.local || '');
  document.getElementById('subelabRendimiento').value = r.rendimiento || '';
  document.getElementById('subelabUnidad').innerHTML = opcionesUnidad(r.unidad_rendimiento || 'kg');
  document.getElementById('subelabProcedimiento').value = r.procedimiento || '';
  document.getElementById('platoCategoria').value = r.categoria || '';
  document.getElementById('platoPrecio').value = r.precio_venta || '';
  document.getElementById('subelabError').textContent = '';
  configurarCamposModal();
  prepararPickerComponente();
  poblarPlatosPicker();
  document.getElementById('modalSubelab').classList.add('show');
  if (t === 'menu') { cargarPasosEnEditor(id); } else { cargarComponentesEnEditor(id); }
};

// Carga (o recarga) los componentes de una receta dentro del editor abierto
async function cargarComponentesEnEditor(id) {
  const cont = document.getElementById('componentesLista');
  if (cont) cont.innerHTML = '<div class="loading">Cargando componentes...</div>';
  try {
    const comps = await api('receta_componentes?receta_id=eq.' + id + '&select=*') || [];
    RECETA_COMP_VIEJOS = comps.map(c => c.id);
    RECETA_COMP_EDIT = comps.map(c => {
      if (c.tipo_componente === 'ingrediente') {
        const ins = RECETAS_INSUMOS_VAL.find(x => x.id === c.ingrediente_id);
        return { tipo: 'ingrediente', refId: c.ingrediente_id, nombre: ins ? ins.nombre : ('Insumo #' + c.ingrediente_id), cantidad: parseFloat(c.cantidad) || 0, unidad: c.unidad || '' };
      }
      const sub = RECETAS_ELAB_PICKER.find(x => x.id === c.sub_receta_id);
      return { tipo: 'receta', refId: c.sub_receta_id, nombre: sub ? sub.nombre : ('Sub-elab #' + c.sub_receta_id), cantidad: parseFloat(c.cantidad) || 0, unidad: c.unidad || '' };
    });
    renderComponentesEdit();
  } catch (e) {
    if (cont) cont.innerHTML = '<div class="cierre-hint" style="color:var(--c-error)">Error al cargar componentes</div>';
  }
}

window.closeSubelab = function() {
  document.getElementById('modalSubelab').classList.remove('show');
};

function prepararPickerComponente() {
  const tipoSel = document.getElementById('compTipo');
  if (tipoSel) tipoSel.value = 'ingrediente';
  poblarItemsComponente();
  const cant = document.getElementById('compCantidad'); if (cant) cant.value = '';
}

// Lista global de items disponibles para el picker de componentes
let REC_ITEMS_LISTA = [];

window.poblarItemsComponente = function() {
  const tipo = document.getElementById('compTipo').value;
  const searchEl = document.getElementById('compItemSearch');
  const hiddenEl = document.getElementById('compItem');
  const opts = document.getElementById('compItemOpts');

  if (tipo === 'ingrediente') {
    REC_ITEMS_LISTA = RECETAS_INSUMOS_VAL.map(i => ({ id: i.id, nombre: i.nombre, unidad: i.unidad || '' }));
    if (searchEl) searchEl.placeholder = 'Buscá un insumo...';
  } else {
    const localReceta = (document.getElementById('subelabLocal') || {}).value || '';
    REC_ITEMS_LISTA = RECETAS_ELAB_PICKER
      .filter(r => String(r.id) !== String(RECETA_EDITANDO))
      .filter(r => !localReceta || !r.local || r.local === localReceta)
      .map(r => ({ id: r.id, nombre: r.nombre, unidad: r.unidad_rendimiento || '' }));
    if (searchEl) searchEl.placeholder = 'Buscá una sub-elaboración...';
  }
  if (hiddenEl) hiddenEl.value = '';
  if (searchEl) searchEl.value = '';
  if (opts) opts.style.display = 'none';
};

function recCerrarDropdown() {
  const opts = document.getElementById('compItemOpts');
  if (opts) opts.style.display = 'none';
}

// Cerrar dropdown al tocar/hacer click fuera del buscador de componentes
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('compItemWrap');
  if (wrap && !wrap.contains(e.target)) recCerrarDropdown();
});
document.addEventListener('touchstart', function(e) {
  const wrap = document.getElementById('compItemWrap');
  if (wrap && !wrap.contains(e.target)) recCerrarDropdown();
}, { passive: true });

window.recFiltrarItems = function(input) {
  const q = (input.value || '').toLowerCase().trim();
  const opts = document.getElementById('compItemOpts');
  if (!opts) return;
  const filtrados = q
    ? REC_ITEMS_LISTA.filter(i => i.nombre.toLowerCase().includes(q))
    : REC_ITEMS_LISTA.slice(0, 40);
  if (!filtrados.length) {
    opts.innerHTML = '<div class="ped-ins-no-result">Sin resultados</div>';
  } else {
    // Usar data-id para evitar conflictos de comillas en onclick
    opts.innerHTML = filtrados.map(function(i) {
      return '<div class="ped-ins-opt" data-rec-id="' + esc(String(i.id)) + '" onclick="recSeleccionarItemById(this)">' + esc(i.nombre) + '</div>';
    }).join('');
  }
  opts.style.display = 'block';
};

window.recOcultarItems = function() {
  // Timeout largo para que en mobile el onclick de la opción se ejecute antes de cerrar
  setTimeout(recCerrarDropdown, 500);
};

window.recSeleccionarItemById = function(el) {
  const id = el.dataset.recId;
  const item = REC_ITEMS_LISTA.find(function(i) { return String(i.id) === String(id); });
  if (!item) return;
  recSeleccionarItem(item.id, item.nombre, item.unidad);
};

window.recSeleccionarItem = function(id, nombre, unidad) {
  const hiddenEl = document.getElementById('compItem');
  const searchEl = document.getElementById('compItemSearch');
  const uSel = document.getElementById('compUnidad');
  if (hiddenEl) hiddenEl.value = id;
  if (searchEl) searchEl.value = nombre;
  if (unidad && uSel) uSel.value = unidad;
  recCerrarDropdown();
};

window.agregarComponente = function() {
  const tipo = document.getElementById('compTipo').value;
  const hiddenEl = document.getElementById('compItem');
  const searchEl = document.getElementById('compItemSearch');
  const refIdRaw = hiddenEl ? hiddenEl.value : '';
  const refId = parseInt(refIdRaw, 10);
  const cantidad = parseFloat(document.getElementById('compCantidad').value) || 0;
  const unidad = document.getElementById('compUnidad').value;
  if (!refId) { toast('Elegí un insumo o sub-elaboración', 'error'); return; }
  if (cantidad <= 0) { toast('Poné una cantidad', 'error'); return; }
  // Buscar nombre en la lista global
  const item = REC_ITEMS_LISTA.find(i => String(i.id) === String(refId));
  const nombre = item ? item.nombre : (searchEl ? searchEl.value : ('Item #' + refId));
  RECETA_COMP_EDIT.push({ tipo: tipo, refId: refId, nombre: nombre, cantidad: cantidad, unidad: unidad });
  if (hiddenEl) hiddenEl.value = '';
  if (searchEl) searchEl.value = '';
  document.getElementById('compCantidad').value = '';
  renderComponentesEdit();
};

window.quitarComponente = function(idx) {
  RECETA_COMP_EDIT.splice(idx, 1);
  renderComponentesEdit();
};

// Conversión de unidades para estimar costos (peso y volumen)
function convertirCantidad(cant, fromU, toU) {
  if (!fromU || !toU) return null;
  const f = String(fromU).toLowerCase().trim(), t = String(toU).toLowerCase().trim();
  if (f === t) return cant;
  const peso = { kg: 1000, kilo: 1000, kilogramo: 1000, g: 1, gr: 1, gramo: 1, gramos: 1 };
  const vol = { l: 1000, lt: 1000, litro: 1000, litros: 1000, ml: 1, cc: 1 };
  if (peso[f] != null && peso[t] != null) return cant * peso[f] / peso[t];
  if (vol[f] != null && vol[t] != null) return cant * vol[f] / vol[t];
  return null; // unidades no convertibles entre sí
}

// Estima el costo de un componente: { unitCost, unidadBase, usado(null si no convertible) }
function costoComponente(c) {
  let unitCost = 0, unidadBase = '';
  if (c.tipo === 'ingrediente') {
    const ins = RECETAS_INSUMOS_VAL.find(x => x.id === c.refId);
    if (!ins) return null;
    unitCost = costoUnitarioInsumo(ins);
    unidadBase = ins.unidad || '';
  } else {
    const sub = RECETAS_ELAB_PICKER.find(x => x.id === c.refId);
    if (!sub) return null;
    const rend = parseFloat(sub.rendimiento) || 0;
    if (rend <= 0) return null;
    unitCost = (RECETAS_COSTO_CALC[c.refId] || 0) / rend;
    unidadBase = sub.unidad_rendimiento || '';
  }
  const conv = convertirCantidad(parseFloat(c.cantidad) || 0, c.unidad, unidadBase);
  return { unitCost: unitCost, unidadBase: unidadBase, usado: conv != null ? conv * unitCost : null };
}

function renderComponentesEdit() {
  const cont = document.getElementById('componentesLista');
  if (!cont) return;
  if (!RECETA_COMP_EDIT.length) {
    cont.innerHTML = '<div class="cierre-hint">Todavía no agregaste componentes.</div>';
    return;
  }
  let total = 0, hayDuda = false;
  const filas = RECETA_COMP_EDIT.map((c, idx) => {
    const cc = costoComponente(c);
    let costoLinea = '';
    if (cc) {
      const unit = '$' + formatNumber(Math.round(cc.unitCost)) + '/' + esc(cc.unidadBase);
      if (cc.usado != null) {
        total += cc.usado;
        costoLinea = '<span class="comp-costo">' + unit + ' · usa <strong>$' + formatNumber(Math.round(cc.usado)) + '</strong></span>';
      } else {
        hayDuda = true;
        costoLinea = '<span class="comp-costo">' + unit + ' · <span class="comp-duda">revisar unidad</span></span>';
      }
    }
    return '<div class="comp-row">' +
      '<div class="comp-info">' +
        '<span class="comp-nombre">' + esc(c.nombre) + (c.tipo === 'receta' ? ' <span class="comp-tag">sub-elab</span>' : '') + '</span>' +
        '<span class="comp-cant">' + fmtCant(c.cantidad) + ' ' + esc(c.unidad) + '</span>' +
        costoLinea +
      '</div>' +
      '<button type="button" class="comp-del" onclick="quitarComponente(' + idx + ')" aria-label="Quitar"><i class="ti ti-trash"></i></button>' +
    '</div>';
  }).join('');
  const totalLinea = '<div class="comp-total">Costo estimado: <strong>$' + formatNumber(Math.round(total)) + '</strong>' +
    (hayDuda ? ' <span class="comp-duda">(faltan unidades por convertir)</span>' : '') +
    '<div class="comp-total-hint">Se calcula a partir de los componentes, convirtiendo unidades automáticamente.</div></div>';
  cont.innerHTML = filas + totalLinea;
}

window.guardarSubelab = async function() {
  const err = document.getElementById('subelabError'); err.textContent = '';
  const esMenu = RECETA_TIPO === 'menu';
  // Auto-agregar lo que quedó en el selector sin tocar "+"
  if (esMenu) {
    const pp = document.getElementById('pasoPlato');
    if (pp && pp.value) window.agregarPaso();
  } else {
    const pendItem = document.getElementById('compItem');
    const pendCant = parseFloat((document.getElementById('compCantidad') || {}).value) || 0;
    if (pendItem && pendItem.value && pendCant > 0) window.agregarComponente();
  }
  const nombre = document.getElementById('subelabNombre').value.trim();
  const local = document.getElementById('subelabLocal').value;
  const procedimiento = document.getElementById('subelabProcedimiento').value.trim() || null;

  if (!nombre) { err.textContent = 'Poné un nombre.'; return; }
  if (!local) { err.textContent = 'Elegí un local.'; return; }
  if (esMenu) {
    if (!MENU_PASOS_EDIT.length) { err.textContent = 'Agregá al menos un paso (plato).'; return; }
  } else {
    const rendChk = parseFloat(document.getElementById('subelabRendimiento').value) || 0;
    if (rendChk <= 0) { err.textContent = 'El rendimiento tiene que ser mayor a 0.'; return; }
    if (!RECETA_COMP_EDIT.length) { err.textContent = 'Agregá al menos un componente.'; return; }
  }

  const btn = document.getElementById('btnGuardarSubelab');
  btn.disabled = true; btn.textContent = 'Guardando...';
  const ahora = new Date().toISOString();
  const receta = {
    nombre: nombre, tipo: RECETA_TIPO, local: local,
    rendimiento: esMenu ? 1 : (parseFloat(document.getElementById('subelabRendimiento').value) || 0),
    unidad_rendimiento: esMenu ? 'menú' : document.getElementById('subelabUnidad').value,
    procedimiento: procedimiento, activo: true,
    actualizado_en: ahora, actualizado_por: currentUser.id
  };
  if (RECETA_TIPO === 'plato') {
    receta.categoria = document.getElementById('platoCategoria').value || null;
  }
  if (RECETA_TIPO === 'plato' || esMenu) {
    receta.precio_venta = parseFloat(document.getElementById('platoPrecio').value) || 0;
  }
  if (!RECETA_EDITANDO) { receta.creado_por = currentUser.id; receta.creado_en = ahora; }

  try {
    const esEdicion = !!RECETA_EDITANDO;
    let recetaId;
    if (esEdicion) {
      await api('recetas?id=eq.' + RECETA_EDITANDO, { method: 'PATCH', body: JSON.stringify(receta) });
      recetaId = RECETA_EDITANDO;
    } else {
      const res = await api('recetas', { method: 'POST', body: JSON.stringify(receta) });
      recetaId = (Array.isArray(res) ? res[0] : res).id;
    }
    if (esMenu) {
      // Pasos del menú: insertar nuevos primero, borrar viejos después
      const pasos = MENU_PASOS_EDIT.map((p, i) => ({
        menu_id: recetaId, receta_id: p.receta_id, orden: i + 1,
        nombre_paso: p.nombre_paso || null, opcional: !!p.opcional
      }));
      await api('menu_pasos', { method: 'POST', body: JSON.stringify(pasos) });
      if (esEdicion && MENU_PASOS_VIEJOS.length) {
        await api('menu_pasos?id=in.(' + MENU_PASOS_VIEJOS.join(',') + ')', { method: 'DELETE' });
      }
    } else {
      // Componentes: insertar nuevos primero, borrar viejos después
      const comps = RECETA_COMP_EDIT.map(c => ({
        receta_id: recetaId,
        tipo_componente: c.tipo,
        ingrediente_id: c.tipo === 'ingrediente' ? c.refId : null,
        sub_receta_id: c.tipo === 'receta' ? c.refId : null,
        cantidad: c.cantidad,
        unidad: c.unidad
      }));
      await api('receta_componentes', { method: 'POST', body: JSON.stringify(comps) });
      if (esEdicion && RECETA_COMP_VIEJOS.length) {
        await api('receta_componentes?id=in.(' + RECETA_COMP_VIEJOS.join(',') + ')', { method: 'DELETE' });
      }
    }
    // Quedarse en el editor mostrando lo guardado (se recarga desde la base)
    RECETA_EDITANDO = recetaId;
    document.getElementById('subelabTitulo').textContent =
      esMenu ? 'Editar menú' : (RECETA_TIPO === 'plato' ? 'Editar plato' : 'Editar sub-elaboración');
    const lbl = esMenu ? 'Menú' : (RECETA_TIPO === 'plato' ? 'Plato' : 'Sub-elaboración');
    const gen = (esMenu || RECETA_TIPO === 'plato') ? 'o' : 'a';
    toast('✓ ' + lbl + ' ' + (esEdicion ? 'actualizad' : 'cread') + gen, 'success');
    if (esMenu) { await cargarPasosEnEditor(recetaId); } else { await cargarComponentesEnEditor(recetaId); }
    COSTEO_CARGADO = false;
    cargarRecetas();
  } catch (e) {
    console.error('guardarSubelab error:', e);
    err.textContent = 'Error al guardar: ' + (e && e.message ? e.message.slice(0, 180) : e);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

// Listeners de filtros de recetas
(function initRecetaFiltros() {
  const s = document.getElementById('recetaSearch');
  if (s) s.addEventListener('input', renderRecetas);
  const fl = document.getElementById('recetaFiltroLocal');
  if (fl) fl.addEventListener('change', renderRecetas);
})();

function nuevoCierrePlaceholder() {
  toast('Carga de cierres - próximamente (Fase 2)', 'warning');
}

// ============================================
// CONFIGURACIÓN DE PROPINAS
// ============================================
async function openConfigPropinas() {
  if (!puedeAdminPropinas()) return;

  // Si no hay config cargada, traerla
  if (!PROP_CONFIG) {
    try {
      const data = await api('propinas_config?id=eq.1');
      PROP_CONFIG = (data && data[0]) ? data[0] : null;
    } catch (e) {
      toast('Error al cargar configuración', 'error');
      return;
    }
  }

  if (!PROP_CONFIG) {
    toast('No se encontró configuración', 'error');
    return;
  }

  document.getElementById('configUSD').value = PROP_CONFIG.cambio_usd || '';
  document.getElementById('configEUR').value = PROP_CONFIG.cambio_eur || '';
  document.getElementById('configBRL').value = PROP_CONFIG.cambio_brl || '';
  document.getElementById('configPct').value = PROP_CONFIG.porcentaje_admin || '';

  // Última actualización
  const ultima = PROP_CONFIG.actualizado_en
    ? `Última actualización: ${new Date(PROP_CONFIG.actualizado_en).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })}`
    : 'Sin actualización previa';
  document.getElementById('configUltima').textContent = ultima;

  document.getElementById('modalConfigPropinas').style.display = 'flex';
}

function closeConfigPropinas() {
  document.getElementById('modalConfigPropinas').style.display = 'none';
}

async function guardarConfigPropinas() {
  const usd = parseFloat(document.getElementById('configUSD').value);
  const eur = parseFloat(document.getElementById('configEUR').value);
  const brl = parseFloat(document.getElementById('configBRL').value);
  const pct = parseFloat(document.getElementById('configPct').value);

  if (isNaN(usd) || usd <= 0) { toast('USD inválido', 'error'); return; }
  if (isNaN(eur) || eur <= 0) { toast('EUR inválido', 'error'); return; }
  if (isNaN(brl) || brl <= 0) { toast('BRL inválido', 'error'); return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { toast('Porcentaje inválido (0-100)', 'error'); return; }

  const btn = document.getElementById('btnGuardarConfig');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const body = {
      cambio_usd: usd,
      cambio_eur: eur,
      cambio_brl: brl,
      porcentaje_admin: pct,
      actualizado_en: new Date().toISOString(),
      actualizado_por: currentUser.id
    };
    await api('propinas_config?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache
    PROP_CONFIG = Object.assign({}, PROP_CONFIG, body);

    toast('Configuración actualizada');
    closeConfigPropinas();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar configuración';
  }
}

// Exponer al window
window.openMiPropina = openMiPropina;
window.abrirGestionPropinas = abrirGestionPropinas;
window.selectPropLocal = selectPropLocal;
window.togglePagado = togglePagado;
window.nuevoCierrePlaceholder = nuevoCierrePlaceholder;
window.openConfigPropinas = openConfigPropinas;
window.closeConfigPropinas = closeConfigPropinas;
window.guardarConfigPropinas = guardarConfigPropinas;

// ============================================
// ADMINISTRACIÓN - Panel principal
// ============================================
const ADMIN_SECTIONS = [
  {
    id: 'personal',
    icon: 'ti-users',
    color: '#7F77DD',
    title: 'Personal',
    desc: 'Fichas, perfiles, contraseñas, exportar',
    activa: true,
    action: () => openPersonal()
  },
  {
    id: 'editores',
    icon: 'ti-shield-check',
    color: '#5DCAA5',
    title: 'Editores y permisos',
    desc: 'Asignar qué puede editar cada Editor',
    activa: true,
    action: () => openAdminEditores()
  },
  {
    id: 'locales',
    icon: 'ti-building-store',
    color: '#C4622D',
    title: 'Locales',
    desc: 'Gestionar locales del grupo',
    activa: true,
    soloMaster: true,
    action: () => openAdminLocales()
  },
  {
    id: 'insumos',
    icon: 'ti-package',
    color: '#EF9F27',
    title: 'Insumos',
    desc: 'Catálogo de insumos y proveedores',
    activa: true,
    action: () => openAdminInsumos()
  },
  {
    id: 'plantillas',
    icon: 'ti-template',
    color: '#7F77DD',
    title: 'Plantillas de Rosters',
    desc: 'Horarios estándar para armar la semana',
    activa: true,
    action: () => openPlantillasRosters()
  },
  {
    id: 'historial',
    icon: 'ti-history',
    color: '#B4B2A9',
    title: 'Historial',
    desc: 'Auditoría de cambios',
    activa: false
  }
];

function openAdministracion() {
  if (!isMaster() && !isAdmin()) {
    showDashboard();
    return;
  }

  const grid = document.getElementById('adminGrid');
  grid.innerHTML = ADMIN_SECTIONS
    .filter(s => !s.soloMaster || isMaster())
    .map(s => {
      const cls = 'admin-card' + (s.activa ? '' : ' disabled');
      const arrowOrTag = s.activa
        ? `<div class="admin-card-arrow"><i class="ti ti-chevron-right"></i></div>`
        : `<span class="pronto-tag">Pronto</span>`;
      return `
        <button class="${cls}" data-id="${s.id}">
          <div class="admin-card-icon" style="background:${s.color}22">
            <i class="ti ${s.icon}" style="color:${s.color}"></i>
          </div>
          <div class="admin-card-text">
            <div class="admin-card-title">${s.title}</div>
            <div class="admin-card-desc">${s.desc}</div>
          </div>
          ${arrowOrTag}
        </button>`;
    }).join('');

  grid.querySelectorAll('.admin-card').forEach(c => {
    c.addEventListener('click', () => {
      const id = c.dataset.id;
      const sec = ADMIN_SECTIONS.find(s => s.id === id);
      if (sec && sec.activa && sec.action) {
        sec.action();
      } else {
        toast('Próximamente disponible');
      }
    });
  });

  showView('vAdmin');
}

window.openAdministracion = openAdministracion;

// ============================================
// ADMINISTRACIÓN - Usuarios
// ============================================
let ADMIN_USUARIOS_CACHE = [];
let ADMIN_EMPLEADOS_CACHE = [];
let ADMIN_FILTRO_ACTUAL = 'todos';
let EDITANDO_USER_ID = null;
let RESET_USER_ID = null;

// ============================================
// MÓDULO PERSONAL  (reemplaza al viejo "Usuarios")
// Lista unificada: empleados activos + usuarios sin ficha (ej: matfraga)
// ============================================
const AZUCA26_HASH = 'c6a7c00511ff7ca91719d38debce681a27ee1798f905a96801a44c3e75003cbe';
const PERFIL_LABELS = { master: 'Master', admin: 'Admin', editor: 'Editor', usuario: 'Usuario' };

let PERSONAS_CACHE = [];
let PERFIL_EDIT_USERID = null;
let FICHA_EDIT_KEY = null;
let FICHA_VISTA_KEY = null;

// Quita tildes y pasa a minúsculas para buscar con tolerancia
function normalizar(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function formatearFecha(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : iso;
}

function openPersonal() {
  showView('vPersonal');
  const s = document.getElementById('personalSearch');
  if (s) s.value = '';
  ['personalFiltroLocal', 'personalFiltroSector', 'personalFiltroPerfil'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cargarUsuarios();
}
window.openPersonal = openPersonal;

// Mantengo el nombre cargarUsuarios porque guardarUsuario/reset/toggle lo llaman
async function cargarUsuarios() {
  const lista = document.getElementById('personalLista');
  if (lista) lista.innerHTML = '<div class="loading">Cargando personal...</div>';
  try {
    await cargarEmpleados();
    ADMIN_USUARIOS_CACHE = await api('roster_usuarios?select=*&order=nombre.asc') || [];
    construirPersonas();
    poblarFiltrosPersonal();
    renderPersonal();
  } catch (e) {
    if (lista) lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar el personal</div>';
  }
}

async function cargarEmpleados() {
  try {
    ADMIN_EMPLEADOS_CACHE = await api('empleados?activo=eq.true&select=id,nombre,apellido,nombre_p,sector,categoria,local,telefono,fecha_nac,es_multilocal,activo,documento,email,alias,talle_remera,talle_pantalon,talle_calzado&order=apellido.asc') || [];
  } catch (e) {
    console.warn('Error al cargar empleados:', e);
    ADMIN_EMPLEADOS_CACHE = [];
  }
}

function armarPersona(e, u) {
  const apellido = e ? (e.apellido || '') : '';
  const pila = e ? (e.nombre_p || e.nombre || '') : (u ? (u.nombre || '') : '');
  let nombreCompleto;
  if (apellido && pila) nombreCompleto = apellido + ', ' + pila;
  else nombreCompleto = (apellido || pila || (u ? u.nombre : '') || 'Sin nombre');
  const perfil = u ? (u.perfil || 'usuario') : null;
  return {
    key: e ? ('emp-' + e.id) : ('usr-' + u.id),
    empleado: e, user: u,
    apellido: apellido, pila: pila, nombreCompleto: nombreCompleto,
    iniciales: obtenerIniciales(((pila + ' ' + apellido).trim()) || (u ? u.nombre : '') || '?'),
    usuario: u ? (u.usuario || '') : '',
    perfil: perfil,
    perfilLabel: perfil ? (PERFIL_LABELS[perfil] || 'Usuario') : 'Sin acceso',
    local: e ? (e.local || '') : '',
    sector: e ? (e.sector || '') : '',
    categoria: e ? (e.categoria || '') : '',
    telefono: e ? (e.telefono || '') : '',
    fechaNac: e ? (e.fecha_nac || '') : '',
    documento: e ? (e.documento || '') : '',
    email: e ? (e.email || '') : '',
    alias: e ? (e.alias || '') : '',
    talleRemera: e ? (e.talle_remera || '') : '',
    tallePantalon: e ? (e.talle_pantalon || '') : '',
    talleCalzado: e ? (e.talle_calzado || '') : '',
    esMultilocal: e ? !!e.es_multilocal : false,
    tieneAcceso: !!u,
    accesoActivo: u ? !!u.activo : false,
    orden: (apellido || pila || (u ? u.nombre : '') || '').toLowerCase()
  };
}

function construirPersonas() {
  const usersByEmp = {};
  const consumidos = {};
  (ADMIN_USUARIOS_CACHE || []).forEach(u => {
    if (u.empleado_id != null) usersByEmp[u.empleado_id] = u;
  });

  const personas = [];
  (ADMIN_EMPLEADOS_CACHE || []).forEach(e => {
    const u = usersByEmp[e.id] || null;
    if (u) consumidos[u.id] = true;
    personas.push(armarPersona(e, u));
  });
  // Usuarios que pueden entrar pero no quedaron vinculados a un empleado activo
  // (ej: matfraga, o usuarios de empleados dados de baja) -> que no se pierdan
  (ADMIN_USUARIOS_CACHE || []).forEach(u => {
    if (consumidos[u.id]) return;
    personas.push(armarPersona(null, u));
  });

  personas.sort((a, b) => a.orden.localeCompare(b.orden, 'es'));
  PERSONAS_CACHE = personas;
}

function poblarFiltrosPersonal() {
  const locales = Array.from(new Set(PERSONAS_CACHE.map(p => p.local).filter(Boolean))).sort();
  const sectores = Array.from(new Set(PERSONAS_CACHE.map(p => p.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
  const selLocal = document.getElementById('personalFiltroLocal');
  const selSector = document.getElementById('personalFiltroSector');
  if (selLocal) {
    const prev = selLocal.value;
    selLocal.innerHTML = '<option value="">Todos los locales</option>' +
      locales.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
    selLocal.value = prev;
  }
  if (selSector) {
    const prev = selSector.value;
    selSector.innerHTML = '<option value="">Todos los sectores</option>' +
      sectores.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    selSector.value = prev;
  }
}

function personasFiltradas() {
  const q = normalizar((document.getElementById('personalSearch') || {}).value);
  const fLocal = (document.getElementById('personalFiltroLocal') || {}).value || '';
  const fSector = (document.getElementById('personalFiltroSector') || {}).value || '';
  const fPerfil = (document.getElementById('personalFiltroPerfil') || {}).value || '';
  return PERSONAS_CACHE.filter(p => {
    if (fLocal && p.local !== fLocal) return false;
    if (fSector && p.sector !== fSector) return false;
    if (fPerfil) {
      if (fPerfil === 'sinacceso') { if (p.tieneAcceso) return false; }
      else if (p.perfil !== fPerfil) return false;
    }
    if (q) {
      const hay = normalizar(p.apellido) + ' ' + normalizar(p.pila) + ' ' +
                  normalizar(p.usuario) + ' ' + normalizar(p.nombreCompleto);
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderPersonal() {
  const lista = document.getElementById('personalLista');
  if (!lista) return;
  const items = personasFiltradas();
  const cnt = document.getElementById('personalCount');
  if (cnt) cnt.textContent = items.length + (items.length === 1 ? ' persona' : ' personas');
  if (!items.length) {
    lista.innerHTML = '<div class="empty-list">No se encontró personal con ese criterio</div>';
    return;
  }
  const gestiona = isMaster() || isAdmin();

  lista.innerHTML = items.map(p => {
    const avCls = p.perfil ? ('p-' + p.perfil) : 'p-sinacceso';
    const badgeCls = p.perfil ? p.perfil : 'sinacceso';

    const subParts = [];
    if (p.usuario) subParts.push('@' + esc(p.usuario));
    if (p.sector) subParts.push(esc(p.sector));
    if (p.categoria) subParts.push(esc(p.categoria));
    const sub = subParts.join(' · ');

    const chips = [];
    if (p.local) chips.push('<span class="pc-chip"><i class="ti ti-map-pin"></i>' + esc(LOCAL_LABELS[p.local] || p.local) + '</span>');
    if (p.esMultilocal) chips.push('<span class="pc-chip"><i class="ti ti-arrows-shuffle"></i>Multilocal</span>');
    if (p.tieneAcceso && !p.accesoActivo) chips.push('<span class="pc-chip pc-chip-off"><i class="ti ti-user-off"></i>Acceso inactivo</span>');

    let acciones = '<button class="btn-ghost pc-btn" onclick="abrirFicha(\'' + p.key + '\')"><i class="ti ti-id"></i>Ver ficha</button>';
    if (gestiona) {
      if (p.tieneAcceso) {
        acciones += '<button class="btn-ghost pc-btn" onclick="abrirCambiarPerfil(' + p.user.id + ')"><i class="ti ti-user-cog"></i>Perfil</button>';
        acciones += '<button class="btn-ghost pc-btn" onclick="resetearAzuca26(' + p.user.id + ')"><i class="ti ti-key"></i>Reset</button>';
        if (!currentUser || p.user.id !== currentUser.id) {
          acciones += '<button class="btn-ghost pc-btn" onclick="toggleActivoUser(' + p.user.id + ')"><i class="ti ti-' + (p.accesoActivo ? 'user-off' : 'user-check') + '"></i>' + (p.accesoActivo ? 'Desactivar' : 'Activar') + '</button>';
        }
      } else if (p.empleado) {
        acciones += '<button class="btn-ghost pc-btn" onclick="crearAccesoEmpleado(' + p.empleado.id + ')"><i class="ti ti-user-plus"></i>Crear acceso</button>';
      }
      if (p.empleado) {
        acciones += '<button class="btn-ghost pc-btn pc-btn-danger" onclick="eliminarPersona(' + p.empleado.id + ', ' + (p.user ? p.user.id : 'null') + ')"><i class="ti ti-trash"></i>Eliminar</button>';
      }
    }

    return '' +
      '<div class="personal-card' + (p.tieneAcceso && !p.accesoActivo ? ' inactive' : '') + '">' +
        '<div class="pc-top">' +
          '<div class="user-avatar ' + avCls + '">' + esc(p.iniciales) + '</div>' +
          '<div class="pc-id">' +
            '<div class="pc-name">' + esc(p.nombreCompleto) + '</div>' +
            (sub ? '<div class="pc-sub">' + sub + '</div>' : '') +
          '</div>' +
          '<span class="perfil-badge ' + badgeCls + '">' + esc(p.perfilLabel) + '</span>' +
        '</div>' +
        (chips.length ? '<div class="pc-meta">' + chips.join('') + '</div>' : '') +
        '<div class="pc-actions">' + acciones + '</div>' +
      '</div>';
  }).join('');
}

// ---- Ficha (solo lectura) ----
window.abrirFicha = function(key) {
  const p = PERSONAS_CACHE.find(x => x.key === key);
  if (!p) return;
  const fila = (lbl, val) => '<div class="ficha-row"><span class="ficha-k">' + lbl + '</span><span class="ficha-v">' + (val ? esc(val) : '—') + '</span></div>';
  const estado = p.tieneAcceso ? (p.accesoActivo ? 'Activo' : 'Inactivo') : 'Sin acceso a la app';
  document.getElementById('fichaTitulo').textContent = p.nombreCompleto;
  document.getElementById('fichaBody').innerHTML =
    fila('Apellido', p.apellido) +
    fila('Nombre', p.pila) +
    fila('Documento', p.documento) +
    fila('Usuario', p.usuario ? '@' + p.usuario : '') +
    fila('Perfil', p.perfilLabel) +
    fila('Local', p.local ? (LOCAL_LABELS[p.local] || p.local) : '') +
    fila('Sector', p.sector) +
    fila('Categoría', p.categoria) +
    fila('Teléfono', p.telefono) +
    fila('Email', p.email) +
    fila('Alias (propinas)', p.alias) +
    fila('Fecha de nacimiento', formatearFecha(p.fechaNac)) +
    fila('Talle remera', p.talleRemera) +
    fila('Talle pantalón', p.tallePantalon) +
    fila('Talle calzado', p.talleCalzado) +
    fila('Multilocal', p.esMultilocal ? 'Sí' : 'No') +
    fila('Estado de acceso', estado);
  const btnEd = document.getElementById('fichaEditarBtn');
  if (btnEd) btnEd.style.display = ((isMaster() || isAdmin()) && p.empleado) ? '' : 'none';
  FICHA_VISTA_KEY = key;
  document.getElementById('modalFicha').classList.add('show');
};
window.closeFichaModal = function() {
  document.getElementById('modalFicha').classList.remove('show');
};

// ---- Editar ficha (Master + Admin): datos base + locales asignados ----
window.editarDesdeFicha = function() {
  if (!FICHA_VISTA_KEY) return;
  closeFichaModal();
  abrirEditarFicha(FICHA_VISTA_KEY);
};
function efRecomputarMultilocal() {
  const grid = document.getElementById('efLocalesGrid');
  const cb = document.getElementById('efMultilocal');
  if (!grid || !cb) return;
  const slugs = Array.from(grid.querySelectorAll('.local-check.activo')).map(el => el.dataset.local);
  cb.checked = slugs.length >= 2 || slugs.indexOf('TRANSVERSAL') !== -1;
}
window.abrirEditarFicha = function(key) {
  if (!isMaster() && !isAdmin()) return;
  const p = PERSONAS_CACHE.find(x => x.key === key);
  if (!p || !p.empleado) { showAlert('Esta persona no tiene ficha de empleado para editar.'); return; }
  FICHA_EDIT_KEY = key;
  document.getElementById('efPersonaNombre').textContent = p.nombreCompleto;
  document.getElementById('efNombre').value = p.pila || '';
  document.getElementById('efApellido').value = p.apellido || '';
  document.getElementById('efSector').value = p.sector || '';
  document.getElementById('efCategoria').value = p.categoria || '';
  document.getElementById('efMultilocal').checked = !!p.esMultilocal;

  // Local principal (incluye el actual aunque esté inactivo)
  const todos = getLocalesActivos().slice();
  if (p.local && todos.indexOf(p.local) === -1) todos.unshift(p.local);
  document.getElementById('efLocal').innerHTML =
    '<option value="">— Sin local —</option>' +
    todos.map(loc => '<option value="' + esc(loc) + '"' + (loc === p.local ? ' selected' : '') + '>' + esc(LOCAL_LABELS[loc] || loc) + '</option>').join('');

  // Datalists de sector/categoría con valores existentes
  const setData = (id, vals) => {
    const dl = document.getElementById(id);
    if (dl) dl.innerHTML = Array.from(new Set(vals.filter(Boolean))).sort()
      .map(v => '<option value="' + esc(v) + '"></option>').join('');
  };
  setData('efSectorList', (ADMIN_EMPLEADOS_CACHE || []).map(e => e.sector));
  setData('efCategoriaList', (ADMIN_EMPLEADOS_CACHE || []).map(e => e.categoria));

  // Locales asignados (solo si tiene cuenta de acceso)
  const sec = document.getElementById('efLocalesSection');
  if (p.user) {
    sec.style.display = '';
    const asignados = p.user.locales_asignados || [];
    document.getElementById('efLocalesGrid').innerHTML = getLocalesActivos().map(loc => {
      const on = asignados.indexOf(loc) !== -1;
      return '<label class="local-check' + (on ? ' activo' : '') + '" data-local="' + esc(loc) + '">' +
             '<input type="checkbox" ' + (on ? 'checked' : '') + '>' + esc(LOCAL_LABELS[loc] || loc) + '</label>';
    }).join('');
    document.querySelectorAll('#efLocalesGrid .local-check').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        el.classList.toggle('activo');
        el.querySelector('input').checked = el.classList.contains('activo');
        efRecomputarMultilocal();
      });
    });
    efRecomputarMultilocal();
    document.getElementById('efMultilocal').disabled = true;
  } else {
    sec.style.display = 'none';
    document.getElementById('efLocalesGrid').innerHTML = '';
    document.getElementById('efMultilocal').disabled = false;
  }

  document.getElementById('efError').textContent = '';
  document.getElementById('modalEditarFicha').classList.add('show');
};
window.closeEditarFichaModal = function() {
  document.getElementById('modalEditarFicha').classList.remove('show');
};
window.guardarEditarFicha = async function() {
  const p = PERSONAS_CACHE.find(x => x.key === FICHA_EDIT_KEY);
  const err = document.getElementById('efError');
  err.textContent = '';
  if (!p || !p.empleado) { err.textContent = 'No se encontró la ficha.'; return; }

  const nombre_p = document.getElementById('efNombre').value.trim();
  const apellido = document.getElementById('efApellido').value.trim();
  const sector = document.getElementById('efSector').value.trim();
  const categoria = document.getElementById('efCategoria').value.trim();
  const local = document.getElementById('efLocal').value || null;
  let multilocal = document.getElementById('efMultilocal').checked;
  const _gridSel = Array.from(document.querySelectorAll('#efLocalesGrid .local-check.activo')).map(el => el.dataset.local);
  if (document.getElementById('efLocalesSection').style.display !== 'none') {
    multilocal = _gridSel.length >= 2 || _gridSel.indexOf('TRANSVERSAL') !== -1;
  }

  if (!nombre_p && !apellido) { err.textContent = 'Cargá al menos nombre o apellido.'; return; }

  const btn = document.getElementById('efGuardarBtn');
  btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Guardando...';
  try {
    const empPatch = {
      nombre_p: nombre_p || null,
      nombre: nombre_p || null,
      apellido: apellido || null,
      sector: sector || null,
      categoria: categoria || null,
      local: local,
      es_multilocal: multilocal
    };
    await api('empleados?id=eq.' + p.empleado.id, { method: 'PATCH', body: JSON.stringify(empPatch) });
    const ec = (ADMIN_EMPLEADOS_CACHE || []).find(e => e.id === p.empleado.id);
    if (ec) Object.assign(ec, empPatch);

    if (p.user) {
      const checks = document.querySelectorAll('#efLocalesGrid .local-check.activo');
      const locs = Array.from(checks).map(c => c.dataset.local);
      const usrPatch = {
        locales_asignados: locs.length ? locs : null,
        nombre: ((apellido || '') + ' ' + (nombre_p || '')).trim() || null
      };
      await api('roster_usuarios?id=eq.' + p.user.id, { method: 'PATCH', body: JSON.stringify(usrPatch) });
      const uc = (ADMIN_USUARIOS_CACHE || []).find(u => u.id === p.user.id);
      if (uc) Object.assign(uc, usrPatch);
      const ec2 = (EDITORES_CACHE || []).find(u => u.id === p.user.id);
      if (ec2) Object.assign(ec2, usrPatch);
      if (currentUser && p.user.id === currentUser.id) {
        currentUser.locales_asignados = usrPatch.locales_asignados;
        currentUser.nombre = usrPatch.nombre;
      }
    }
    if (currentEmpleado && currentEmpleado.id === p.empleado.id) {
      Object.assign(currentEmpleado, empPatch);
    }

    closeEditarFichaModal();
    construirPersonas();
    renderPersonal();
    toast('✓ Ficha actualizada', 'success');
  } catch (e) {
    err.textContent = 'No se pudo guardar: ' + (e.message || e);
  } finally {
    btn.disabled = false; btn.textContent = txt;
  }
};

// ---- Cambiar perfil (Master + Admin) ----
window.abrirCambiarPerfil = function(userId) {
  if (!isMaster() && !isAdmin()) return;
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === userId);
  if (!u) return;
  PERFIL_EDIT_USERID = userId;
  document.getElementById('cambiarPerfilNombre').textContent = (u.nombre || ('@' + u.usuario));
  document.getElementById('cambiarPerfilSelect').value = u.perfil || 'usuario';
  const optM = document.getElementById('cpOptMaster');
  optM.disabled = !isMaster();
  optM.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo un Master puede asignar)';
  document.getElementById('cambiarPerfilError').textContent = '';
  document.getElementById('modalCambiarPerfil').classList.add('show');
};
window.closeCambiarPerfilModal = function() {
  document.getElementById('modalCambiarPerfil').classList.remove('show');
};
window.guardarCambioPerfil = async function() {
  const err = document.getElementById('cambiarPerfilError');
  err.textContent = '';
  const nuevo = document.getElementById('cambiarPerfilSelect').value;
  if (nuevo === 'master' && !isMaster()) {
    err.textContent = 'Solo un Master puede asignar el perfil Master';
    return;
  }
  const btn = document.getElementById('btnGuardarPerfil');
  try {
    btn.disabled = true; btn.textContent = 'Guardando...';
    await api('roster_usuarios?id=eq.' + PERFIL_EDIT_USERID, {
      method: 'PATCH',
      body: JSON.stringify({ perfil: nuevo })
    });
    closeCambiarPerfilModal();
    toast('✓ Perfil actualizado', 'success');
    await cargarUsuarios();
  } catch (e) {
    err.textContent = 'Error al actualizar el perfil';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

// ---- Reset de contraseña a azuca26 (un toque, Master + Admin) ----
window.resetearAzuca26 = async function(userId) {
  if (!isMaster() && !isAdmin()) return;
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === userId);
  if (!u) return;
  const ok = await showConfirm({
    title: 'Resetear contraseña',
    msg: 'La contraseña de ' + (u.nombre || ('@' + u.usuario)) + ' va a quedar en "azuca26".\n\nLa próxima vez que entre, el sistema le va a pedir que elija una nueva.\n\n¿Confirmás?',
    type: 'warning',
    okLabel: 'Sí, resetear',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  try {
    await api('roster_usuarios?id=eq.' + userId, {
      method: 'PATCH',
      body: JSON.stringify({ password_hash: AZUCA26_HASH, debe_cambiar_password: true })
    });
    toast('✓ Contraseña reseteada a azuca26', 'success');
  } catch (e) {
    toast('Error al resetear la contraseña', 'error');
  }
};

// ---- Crear acceso para un empleado sin usuario (reusa el modal de Crear) ----
window.crearAccesoEmpleado = function(empId) {
  abrirCrearUsuario();
  const e = ADMIN_EMPLEADOS_CACHE.find(x => x.id === empId);
  if (e) {
    const nom = ((e.nombre_p || e.nombre || '') + ' ' + (e.apellido || '')).trim();
    const elNom = document.getElementById('userNombre');
    const elEmp = document.getElementById('userEmpleado');
    if (elNom) elNom.value = nom;
    if (elEmp) elEmp.value = String(empId);
  }
};

// ============================================
// EXPORTAR A EXCEL  (helper genérico reutilizable)
// hojas = [{ nombre: 'Personal', filas: [{Col:val,...}, ...] }, ...]
// ============================================
function exportarAExcel(nombreArchivo, hojas) {
  if (typeof XLSX === 'undefined') {
    toast('No se pudo cargar el exportador de Excel', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();
  (hojas || []).forEach(h => {
    const ws = XLSX.utils.json_to_sheet(h.filas || []);
    XLSX.utils.book_append_sheet(wb, ws, (h.nombre || 'Hoja').substring(0, 31));
  });
  XLSX.writeFile(wb, nombreArchivo);
}
window.exportarAExcel = exportarAExcel;

window.exportarPersonalExcel = function() {
  const items = personasFiltradas();
  if (!items.length) {
    toast('No hay personal para exportar con esos filtros', 'error');
    return;
  }
  const filas = items.map(p => ({
    'Apellido': p.apellido,
    'Nombre': p.pila,
    'Documento': p.documento,
    'Usuario': p.usuario,
    'Perfil': p.perfilLabel,
    'Local': p.local ? (LOCAL_LABELS[p.local] || p.local) : '',
    'Sector': p.sector,
    'Categoría': p.categoria,
    'Teléfono': p.telefono,
    'Email': p.email,
    'Alias': p.alias,
    'Fecha nacimiento': p.fechaNac || '',
    'Talle remera': p.talleRemera,
    'Talle pantalón': p.tallePantalon,
    'Talle calzado': p.talleCalzado,
    'Multilocal': p.esMultilocal ? 'Sí' : 'No',
    'Acceso': p.tieneAcceso ? (p.accesoActivo ? 'Activo' : 'Inactivo') : 'Sin acceso'
  }));
  exportarAExcel('Personal_AZUCA_' + hoyStr() + '.xlsx', [{ nombre: 'Personal', filas: filas }]);
  toast('✓ Excel generado', 'success');
};

// Listeners de filtros del módulo Personal
(function initPersonalFiltros() {
  const s = document.getElementById('personalSearch');
  if (s) s.addEventListener('input', renderPersonal);
  ['personalFiltroLocal', 'personalFiltroSector', 'personalFiltroPerfil'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderPersonal);
  });
})();

// ============================================
// MODAL CREAR / EDITAR USUARIO
// ============================================
window.abrirCrearUsuario = function() {
  EDITANDO_USER_ID = null;
  document.getElementById('userFormTitle').textContent = 'Nuevo usuario';
  document.getElementById('userNombre').value = '';
  document.getElementById('userUsuario').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = 'usuario';
  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = '';
  document.getElementById('userPasswordField').style.display = '';
  document.getElementById('userFormError').textContent = '';

  // Si no es Master, no puede crear Masters
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede crear Masters)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.abrirEditarUsuario = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  EDITANDO_USER_ID = id;
  document.getElementById('userFormTitle').textContent = 'Editar usuario';
  document.getElementById('userNombre').value = u.nombre || '';
  document.getElementById('userUsuario').value = u.usuario || '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = u.perfil || 'usuario';

  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = u.empleado_id || '';

  // En edición, ocultar password (se cambia con el botón de reset)
  document.getElementById('userPasswordField').style.display = 'none';
  document.getElementById('userFormError').textContent = '';

  // Reglas: solo Master puede asignar Master
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede asignar Master)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.closeUserFormModal = function() {
  document.getElementById('modalUserForm').classList.remove('show');
};

window.guardarUsuario = async function() {
  const errBox = document.getElementById('userFormError');
  errBox.textContent = '';

  const nombre = document.getElementById('userNombre').value.trim();
  const usuario = document.getElementById('userUsuario').value.trim().toLowerCase();
  const perfil = document.getElementById('userPerfil').value;
  const empleadoId = document.getElementById('userEmpleado').value;
  const password = document.getElementById('userPassword').value;

  if (!nombre) { errBox.textContent = 'Falta el nombre'; return; }
  if (!usuario) { errBox.textContent = 'Falta el usuario'; return; }
  if (!/^[a-z0-9_.-]+$/i.test(usuario)) {
    errBox.textContent = 'El usuario solo puede tener letras, números, _ . -';
    return;
  }

  // Validar permisos para perfil Master
  if (perfil === 'master' && !isMaster()) {
    errBox.textContent = 'Solo un Master puede asignar el perfil Master';
    return;
  }

  try {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    if (EDITANDO_USER_ID) {
      // Editando: verificar conflictos de username SOLO si cambió
      const original = ADMIN_USUARIOS_CACHE.find(u => u.id === EDITANDO_USER_ID);
      if (usuario !== (original.usuario || '').toLowerCase()) {
        const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
        if (existentes && existentes.length) {
          throw new Error('Ese usuario ya existe');
        }
      }

      await api(`roster_usuarios?id=eq.${EDITANDO_USER_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre,
          usuario,
          perfil,
          empleado_id: empleadoId ? parseInt(empleadoId) : null
        })
      });

      toast('✓ Usuario actualizado', 'success');
    } else {
      // Creando: requiere password
      if (!password || password.length < 6) {
        errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
        btn.disabled = false;
        btn.textContent = 'Guardar';
        return;
      }

      // Verificar que no exista
      const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
      if (existentes && existentes.length) {
        throw new Error('Ese usuario ya existe');
      }

      const passHash = await sha256(password);

      await api('roster_usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario,
          nombre,
          perfil,
          password_hash: passHash,
          empleado_id: empleadoId ? parseInt(empleadoId) : null,
          debe_cambiar_password: true,
          activo: true
        })
      });

      toast('✓ Usuario creado', 'success');
    }

    closeUserFormModal();
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al guardar';
  } finally {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
};

// ============================================
// MODAL RESET PASSWORD
// ============================================
window.abrirResetPass = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  RESET_USER_ID = id;
  document.getElementById('resetPassUser').textContent = `Usuario: ${u.nombre || u.usuario} (@${u.usuario})`;
  document.getElementById('resetPassValue').value = '';
  document.getElementById('resetPassError').textContent = '';
  document.getElementById('modalResetPass').classList.add('show');
};

window.closeResetPassModal = function() {
  document.getElementById('modalResetPass').classList.remove('show');
};

window.confirmarResetPass = async function() {
  const errBox = document.getElementById('resetPassError');
  errBox.textContent = '';
  const nueva = document.getElementById('resetPassValue').value;

  if (!nueva || nueva.length < 6) {
    errBox.textContent = 'Debe tener al menos 6 caracteres';
    return;
  }

  try {
    const hash = await sha256(nueva);
    await api(`roster_usuarios?id=eq.${RESET_USER_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: hash,
        debe_cambiar_password: true
      })
    });
    closeResetPassModal();
    toast('✓ Contraseña reseteada', 'success');
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al resetear';
  }
};

// ============================================
// ACTIVAR / DESACTIVAR USUARIO
// ============================================
window.toggleActivoUser = async function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  if (u.id === currentUser.id) {
    toast('No podés desactivar tu propia cuenta', 'error');
    return;
  }

  // Aviso especial si se está por desactivar a un Master
  if (u.activo && u.perfil === 'master') {
    const ok = await showConfirm({
      title: 'Desactivar a un Master',
      msg: `Estás por desactivar a un Master (${u.nombre}).\n\nSi te quedás sin Masters, NADIE va a poder crear nuevos Masters ni editar Locales.\n\n¿Seguro que querés continuar?`,
      type: 'danger',
      danger: true,
      okLabel: 'Sí, desactivar',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    const accion = u.activo ? 'desactivar' : 'activar';
    const ok = await showConfirm({
      title: `¿${accion.charAt(0).toUpperCase() + accion.slice(1)} usuario?`,
      msg: `Vas a ${accion} a ${u.nombre || u.usuario}.`,
      type: u.activo ? 'warning' : 'info',
      okLabel: u.activo ? 'Desactivar' : 'Activar',
      danger: u.activo
    });
    if (!ok) return;
  }

  try {
    await api(`roster_usuarios?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !u.activo })
    });
    toast(`✓ Usuario ${u.activo ? 'desactivado' : 'activado'}`, 'success');
    await cargarUsuarios();
  } catch (err) {
    toast('Error al cambiar estado', 'error');
  }
};

// ============================================
// ADMINISTRACIÓN - Editores y permisos
// ============================================
// LOCALES_DISPONIBLES ya no es una constante: ahora se obtiene dinámicamente
// con getLocalesActivos() desde la base.

let EDITORES_CACHE = [];
let LOCALES_EDITANDO_ID = null;

const PERMISOS_DEF = [
  { key: 'editor_rosters',    label: 'Rosters',       icon: 'ti-calendar-event', tipo: 'editor' },
  { key: 'editor_propinas',   label: 'Propinas',      icon: 'ti-cash',           tipo: 'editor' },
  { key: 'editor_biblioteca', label: 'Biblioteca',    icon: 'ti-books',          tipo: 'editor' },
  { key: 'editor_recetas',    label: 'Recetas',       icon: 'ti-chef-hat',       tipo: 'editor' },
  { key: 'editor_pedidos',    label: 'Pedidos',       icon: 'ti-shopping-cart',  tipo: 'editor' },
  { key: 'editor_insumos',    label: 'Insumos / Compras', icon: 'ti-package',    tipo: 'editor' },
  { key: 'editor_stock',      label: 'Stock',         icon: 'ti-clipboard-check', tipo: 'editor' },
  { key: 'editor_cierres',    label: 'Cierres de caja', icon: 'ti-cash-register', tipo: 'editor' }
];

async function openAdminEditores() {
  showView('vAdminEditores');
  await cargarEditores();
}
window.openAdminEditores = openAdminEditores;

async function cargarEditores() {
  const lista = document.getElementById('editoresLista');
  lista.innerHTML = '<div class="loading">Cargando editores...</div>';

  try {
    EDITORES_CACHE = await api(
      `roster_usuarios?perfil=eq.editor&activo=eq.true&select=*&order=nombre.asc`
    ) || [];
    renderEditores();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar editores</div>';
  }
}

function renderEditores() {
  const lista = document.getElementById('editoresLista');
  document.getElementById('editoresCount').textContent =
    EDITORES_CACHE.length + (EDITORES_CACHE.length === 1 ? ' editor' : ' editores');

  if (!EDITORES_CACHE.length) {
    lista.innerHTML = `
      <div class="editor-empty">
        <div class="editor-empty-icon"><i class="ti ti-users-group"></i></div>
        <div class="editor-empty-title">No hay editores asignados</div>
        <div class="editor-empty-desc">
          Para que alguien aparezca acá, andá a <strong>Usuarios</strong> y cambiale el perfil a <strong>Editor</strong>.
        </div>
      </div>`;
    return;
  }

  lista.innerHTML = EDITORES_CACHE.map(u => {
    const inicial = (u.nombre || u.usuario || '?').trim().charAt(0).toUpperCase();
    const locales = u.locales_asignados || [];
    const localesTxt = locales.length
      ? locales.map(l => LOCAL_LABELS[l] || l).join(', ')
      : 'Sin locales asignados';
    const localesIco = locales.length ? 'ti-map-pin' : 'ti-map-pin-off';

    const perms = PERMISOS_DEF.map(p => {
      const activo = !!u[p.key];
      const cls = 'permiso-check' + (activo ? ' activo' : '') + (p.tipo === 'admin' ? ' admin-perm' : '');
      const icon = activo ? 'ti-check' : p.icon;
      return `
        <label class="${cls}" onclick="togglePermiso(${u.id}, '${p.key}', this)">
          <i class="ti ${icon}"></i>
          <span>${p.label}</span>
        </label>`;
    }).join('');

    return `
      <div class="editor-card" data-id="${u.id}">
        <div class="editor-card-head">
          <div class="editor-card-avatar">${esc(inicial)}</div>
          <div class="editor-card-info">
            <div class="editor-card-name">${esc(u.nombre || u.usuario)}</div>
            <div class="editor-card-meta">@${esc(u.usuario)}</div>
          </div>
        </div>

        <div class="editor-card-locales">
          <i class="ti ${localesIco}"></i>
          <span>${esc(localesTxt)}</span>
          <button class="editar-locales" onclick="abrirEditarLocales(${u.id})">Editar</button>
        </div>

        <div class="permisos-grid">
          ${perms}
        </div>
      </div>`;
  }).join('');
}

window.togglePermiso = async function(userId, key, labelEl) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;

  const nuevoValor = !user[key];

  // Update visual inmediato
  labelEl.classList.toggle('activo', nuevoValor);
  const icon = labelEl.querySelector('i.ti');
  if (nuevoValor) {
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add('ti-check');
  } else {
    const def = PERMISOS_DEF.find(p => p.key === key);
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add(def.icon);
  }

  // Actualizar caché local
  user[key] = nuevoValor;

  // Guardar en BD
  try {
    await api(`roster_usuarios?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: nuevoValor })
    });
  } catch (err) {
    toast('Error al guardar permiso', 'error');
    // Revertir cambio visual
    user[key] = !nuevoValor;
    labelEl.classList.toggle('activo', !nuevoValor);
  }
};

// ============================================
// MODAL: EDITAR LOCALES DE UN EDITOR
// ============================================
window.abrirEditarLocales = function(userId) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;
  LOCALES_EDITANDO_ID = userId;

  document.getElementById('localesUserName').innerHTML =
    `<strong>${esc(user.nombre || user.usuario)}</strong>`;

  const asignados = user.locales_asignados || [];

  document.getElementById('localesGrid').innerHTML = getLocalesActivos().map(loc => {
    const activo = asignados.includes(loc);
    return `
      <label class="local-check${activo ? ' activo' : ''}" data-local="${loc}">
        <input type="checkbox" ${activo ? 'checked' : ''}>
        ${esc(LOCAL_LABELS[loc] || loc)}
      </label>`;
  }).join('');

  // Toggle visual
  document.querySelectorAll('#localesGrid .local-check').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      el.classList.toggle('activo');
      const cb = el.querySelector('input');
      cb.checked = el.classList.contains('activo');
    });
  });

  document.getElementById('localesError').textContent = '';
  document.getElementById('modalLocales').classList.add('show');
};

window.closeLocalesModal = function() {
  document.getElementById('modalLocales').classList.remove('show');
};

window.guardarLocales = async function() {
  if (!LOCALES_EDITANDO_ID) return;
  const errBox = document.getElementById('localesError');
  errBox.textContent = '';

  const checks = document.querySelectorAll('#localesGrid .local-check.activo');
  const nuevos = Array.from(checks).map(c => c.dataset.local);

  try {
    await api(`roster_usuarios?id=eq.${LOCALES_EDITANDO_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ locales_asignados: nuevos.length ? nuevos : null })
    });

    // Actualizar caché
    const user = EDITORES_CACHE.find(u => u.id === LOCALES_EDITANDO_ID);
    if (user) user.locales_asignados = nuevos;

    closeLocalesModal();
    toast('✓ Locales actualizados', 'success');
    renderEditores();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
};

// ============================================
// LOGOUT
// ============================================
window.doLogout = async function() {
  const ok = await showConfirm({
    title: '¿Cerrar sesión?',
    msg: 'Vas a salir de AZUCAPP. Tendrás que volver a iniciar sesión.',
    type: 'info',
    okLabel: 'Cerrar sesión',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  clearSession();
  currentUser = null;
  currentEmpleado = null;
  semanaActual = null;
  document.getElementById('loginUsuario').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  showView('vLogin');
};

// ============================================
// NAVEGACIÓN
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(viewId);
  if (v) v.classList.add('active');
  window.scrollTo(0, 0);
}

window.showDashboard = showDashboard;
window.showChangePass = function() {
  document.getElementById('voluntaryPassError').textContent = '';
  document.getElementById('currentPass').value = '';
  document.getElementById('voluntaryPass1').value = '';
  document.getElementById('voluntaryPass2').value = '';
  showView('vChangePassVoluntary');
};

// Cerrar modales clicando el overlay
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) {
      ov.classList.remove('show');
    }
  });
});

// ============================================
// INICIALIZACIÓN
// ============================================
async function init() {
  const savedUser = loadSession();

  if (savedUser) {
    try {
      const fresh = await api(`roster_usuarios?id=eq.${savedUser.id}&select=*`);
      if (fresh && fresh[0] && fresh[0].activo) {
        currentUser = fresh[0];
        saveSession(currentUser);

        // Cargar lista de locales antes de mostrar nada
        await cargarLocalesDesdeBase();

        if (currentUser.debe_cambiar_password) {
          showView('vChangePass');
        } else {
          showDashboard();
        }
        return;
      }
    } catch(e) {
      console.warn('No se pudo verificar sesión:', e);
    }
    clearSession();
  }

  showView('vLogin');

  // Actualizar fecha cada minuto
  setInterval(() => {
    const dt = document.getElementById('datetime');
    if (dt && currentUser) {
      dt.textContent = fmtDateTime(new Date());
    }
  }, 60000);
}

// ============================================
// MÓDULO: BIBLIOTECA
// ============================================

let BIB_CATEGORIAS = [];     // cache de categorías
let BIB_CONTENIDOS = [];     // cache de contenidos visibles
let BIB_FILTRO_CAT = null;   // null = "Todas", o id de categoría
let BIB_EDITANDO_CONT = null; // contenido que se está editando (o null = nuevo)
let BIB_EDITANDO_CAT = null;  // categoría que se está editando (o null = nueva)
let BIB_TIPO_SEL = 'pdf';    // tipo seleccionado en modal
let BIB_LOCALES_SEL = [];    // locales seleccionados en modal
let BIB_ICONO_SEL = 'ti-folder'; // ícono seleccionado en modal categoría

// Definición de tipos de contenido
const BIB_TIPOS = [
  { key: 'pdf',   label: 'PDF',   icon: 'ti-file-text',        cls: 'bib-icon-pdf' },
  { key: 'doc',   label: 'Doc',   icon: 'ti-file-description', cls: 'bib-icon-doc' },
  { key: 'video', label: 'Video', icon: 'ti-brand-youtube',    cls: 'bib-icon-video' },
  { key: 'audio', label: 'Audio', icon: 'ti-brand-spotify',    cls: 'bib-icon-audio' }
];

// Íconos disponibles para categorías
const BIB_ICONOS_CAT = [
  'ti-folder', 'ti-building-bank', 'ti-school', 'ti-clipboard-list',
  'ti-shield', 'ti-sparkles', 'ti-chef-hat', 'ti-tools',
  'ti-heart', 'ti-flame', 'ti-bell', 'ti-bookmark',
  'ti-star', 'ti-bulb', 'ti-trophy', 'ti-coffee',
  'ti-map', 'ti-camera', 'ti-music', 'ti-message',
  'ti-calendar', 'ti-target', 'ti-rocket', 'ti-leaf'
];

// ¿Puede el usuario administrar la biblioteca?
function puedeAdminBib() {
  return isMaster() || isAdmin();
}

// ¿Puede gestionar categorías y borrar? (solo Admin/Master)
function puedeAdminBibCat() {
  return isMaster() || isAdmin();
}

// Locales del usuario actual (o todos si es master/admin)
function localesUsuarioActual() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  return currentUser.locales_asignados || [];
}

// ============================================
// VISTA USUARIO: Mi Biblioteca
// ============================================
async function openMiBiblioteca() {
  showView('vBiblioteca');
  const cont = document.getElementById('bibContenido');
  const chips = document.getElementById('bibChips');
  cont.innerHTML = '<div class="loading">Cargando biblioteca...</div>';
  chips.innerHTML = '';

  // Cargar categorías y contenidos en paralelo
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?activo=neq.false&order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar biblioteca</div>';
    return;
  }

  // Filtrar contenidos por locales del usuario
  const localesUser = localesUsuarioActual();
  const esEditor = !!(currentUser && currentUser.editor_biblioteca);
  const transversalSlug = (() => {
    const t = LOCALES_DB.find(x => /transversal/i.test(x.nombre || '') || /transversal/i.test(x.slug || ''));
    return t ? t.slug : null;
  })();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    // contenido sin locales = transversal, visible para todos
    if (!c.locales || c.locales.length === 0) return true;
    // contenido marcado como transversal
    if (transversalSlug && c.locales.includes(transversalSlug)) return true;
    // Si no es editor de biblioteca, ve el contenido de sus locales también
    if (!esEditor) return c.locales.some(loc => localesUser.includes(loc));
    return c.locales.some(loc => localesUser.includes(loc));
  });

  // Render chips de categorías
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibChips(visibles) {
  const chips = document.getElementById('bibChips');
  // Solo mostrar categorías que tengan al menos un contenido visible
  const catsConContenido = BIB_CATEGORIAS.filter(cat =>
    visibles.some(c => c.categoria_id === cat.id)
  );

  let html = `<button class="bib-chip ${BIB_FILTRO_CAT === null ? 'active' : ''}" onclick="filtrarBibCat(null)">Todas</button>`;
  catsConContenido.forEach(cat => {
    html += `<button class="bib-chip ${BIB_FILTRO_CAT === cat.id ? 'active' : ''}" onclick="filtrarBibCat(${cat.id})">
      <i class="ti ${esc(cat.icono || 'ti-folder')}"></i>${esc(cat.nombre)}
    </button>`;
  });
  chips.innerHTML = html;
}

function filtrarBibCat(catId) {
  BIB_FILTRO_CAT = catId;
  // Re-render con filtro aplicado
  const localesUser = localesUsuarioActual();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    if (!c.locales || c.locales.length === 0) return false;
    return c.locales.some(loc => localesUser.includes(loc));
  });
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibContenidos(visibles) {
  const cont = document.getElementById('bibContenido');
  const filtrados = BIB_FILTRO_CAT === null
    ? visibles
    : visibles.filter(c => c.categoria_id === BIB_FILTRO_CAT);

  let html = '';

  // ===== BOTÓN DE GESTIÓN (solo Editor con permiso, Admin o Master) =====
  if (puedeAdminBib()) {
    html += `
      <button class="btn-gestion" onclick="openAdminBiblioteca()">
        <i class="ti ti-settings"></i> GESTIÓN DE BIBLIOTECA
      </button>`;
  }

  if (filtrados.length === 0) {
    html += `
      <div class="bib-empty">
        <i class="ti ti-books-off"></i>
        <div class="bib-empty-title">No hay contenido disponible</div>
        <div class="bib-empty-desc">${BIB_FILTRO_CAT === null
          ? 'Cuando se cargue material, aparecerá acá.'
          : 'No hay material en esta categoría para tus locales.'}</div>
      </div>`;
    cont.innerHTML = html;
    return;
  }

  html += '<div class="bib-grid">';
  filtrados.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    html += `
      <a class="bib-card" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
        <div class="bib-card-top">
          <div class="bib-card-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
          <span class="bib-card-tipo">${tipo.label}</span>
        </div>
        <div class="bib-card-titulo">${esc(c.titulo)}</div>
        <div class="bib-card-cat">
          <i class="ti ${esc(cat ? cat.icono : 'ti-folder')}"></i>
          ${esc(cat ? cat.nombre : 'Sin categoría')}
        </div>
      </a>`;
  });
  html += '</div>';
  cont.innerHTML = html;
}

// ============================================
// VISTA ADMIN: Administrar Biblioteca
// ============================================
async function openAdminBiblioteca() {
  if (!puedeAdminBib()) {
    toast('No tenés permiso', 'error');
    return;
  }
  showView('vAdminBiblioteca');

  // Tab de categorías solo visible para Admin/Master
  document.getElementById('bibTabCategorias').style.display =
    puedeAdminBibCat() ? 'inline-flex' : 'none';

  // Subtítulo según rol
  document.getElementById('adminBibSubtitle').textContent =
    puedeAdminBibCat() ? 'Gestión de contenidos y categorías' : 'Gestión de contenidos';

  // Mostrar tab contenidos por defecto
  switchBibTab('contenidos');

  // Cargar datos
  await recargarBibAdmin();
}

async function recargarBibAdmin() {
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    toast('Error al cargar datos', 'error');
    return;
  }
  renderBibAdminLista();
  renderBibAdminCategorias();
}

function switchBibTab(tab) {
  const tabCont = document.getElementById('bibTabContenidos');
  const tabCat  = document.getElementById('bibTabCategorias');
  const panCont = document.getElementById('bibPanelContenidos');
  const panCat  = document.getElementById('bibPanelCategorias');

  if (tab === 'contenidos') {
    tabCont.classList.add('active');
    tabCat.classList.remove('active');
    panCont.style.display = 'block';
    panCat.style.display = 'none';
  } else {
    tabCont.classList.remove('active');
    tabCat.classList.add('active');
    panCont.style.display = 'none';
    panCat.style.display = 'block';
  }
}

function renderBibAdminLista() {
  const cont = document.getElementById('bibAdminLista');
  if (BIB_CONTENIDOS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-files-off"></i>
        <div class="bib-empty-title">No hay contenidos cargados</div>
        <div class="bib-empty-desc">Tocá "Agregar contenido" para sumar el primero.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CONTENIDOS.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    const locTxt = (!c.locales || c.locales.length === 0)
      ? 'Todos los locales'
      : (c.locales.length === getLocalesActivos().length
          ? 'Todos los locales'
          : c.locales.length + ' local' + (c.locales.length > 1 ? 'es' : ''));

    const inactivo = c.activo === false;
    const btnDelete = puedeAdminBibCat()
      ? `<button class="bib-btn-delete" onclick="borrarContenido(${c.id})" title="Borrar"><i class="ti ti-trash"></i></button>`
      : '';
    const btnActivar = (inactivo && puedeAdminBibCat())
      ? `<button class="bib-btn-activar" onclick="activarContenido(${c.id})" title="Activar"><i class="ti ti-eye"></i></button>`
      : '';
    const badgeInactivo = inactivo
      ? `<span class="bib-badge-inactivo">Inactivo</span>`
      : '';

    html += `
      <div class="bib-admin-item${inactivo ? ' bib-admin-item--inactivo' : ''}">
        <div class="bib-admin-item-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
        <div class="bib-admin-item-info">
          <div class="bib-admin-item-titulo">${esc(c.titulo)}${badgeInactivo}</div>
          <div class="bib-admin-item-meta">${esc(cat ? cat.nombre : 'Sin categoría')} · ${locTxt}</div>
        </div>
        <div class="bib-admin-item-actions">
          ${btnActivar}
          <button class="bib-btn-edit" onclick="openModalContenido(${c.id})" title="Editar"><i class="ti ti-edit"></i></button>
          ${btnDelete}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function renderBibAdminCategorias() {
  const cont = document.getElementById('bibAdminCategorias');
  if (BIB_CATEGORIAS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-folder-off"></i>
        <div class="bib-empty-title">No hay categorías</div>
        <div class="bib-empty-desc">Creá la primera categoría para empezar a organizar el contenido.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CATEGORIAS.forEach(cat => {
    const count = BIB_CONTENIDOS.filter(c => c.categoria_id === cat.id).length;
    html += `
      <div class="bib-cat-item">
        <div class="bib-cat-icon-box"><i class="ti ${esc(cat.icono || 'ti-folder')}"></i></div>
        <div class="bib-cat-nombre">${esc(cat.nombre)}</div>
        <div class="bib-cat-count">${count} contenido${count !== 1 ? 's' : ''}</div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalCategoria(${cat.id})" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="bib-btn-delete" onclick="borrarCategoria(${cat.id})" title="Borrar"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

// ============================================
// MODAL: AGREGAR / EDITAR CONTENIDO
// ============================================
function openModalContenido(contId) {
  BIB_EDITANDO_CONT = contId;
  const c = contId ? BIB_CONTENIDOS.find(x => x.id === contId) : null;

  document.getElementById('modalContenidoTitle').textContent = c ? 'Editar contenido' : 'Nuevo contenido';
  document.getElementById('contTitulo').value = c ? c.titulo : '';
  document.getElementById('contUrl').value = c ? c.url : '';

  // Categorías
  const selectCat = document.getElementById('contCategoria');
  selectCat.innerHTML = BIB_CATEGORIAS.map(cat =>
    `<option value="${cat.id}">${esc(cat.nombre)}</option>`
  ).join('');
  if (c) selectCat.value = c.categoria_id;
  else if (BIB_CATEGORIAS.length) selectCat.value = BIB_CATEGORIAS[0].id;

  // Tipo
  BIB_TIPO_SEL = c ? c.tipo : 'pdf';
  renderTipoGrid();
  actualizarHintUrl();

  // Locales
  BIB_LOCALES_SEL = c && c.locales ? c.locales.slice() : [];
  renderLocalesChips();

  document.getElementById('modalContenido').style.display = 'flex';
}

function closeModalContenido() {
  document.getElementById('modalContenido').style.display = 'none';
  BIB_EDITANDO_CONT = null;
}

function renderTipoGrid() {
  const cont = document.getElementById('contTipoGrid');
  cont.innerHTML = BIB_TIPOS.map(t => `
    <button class="tipo-btn ${BIB_TIPO_SEL === t.key ? 'active' : ''}" onclick="selectTipo('${t.key}')">
      <i class="ti ${t.icon}"></i>${t.label}
    </button>
  `).join('');
}

function selectTipo(key) {
  BIB_TIPO_SEL = key;
  renderTipoGrid();
  actualizarHintUrl();
}

function actualizarHintUrl() {
  const hint = document.getElementById('contUrlHint');
  const placeholders = {
    pdf:   'Ej: link de Google Drive, Dropbox o cualquier PDF online',
    doc:   'Ej: link de Google Docs, Word online o similar',
    video: 'Ej: link de YouTube o Vimeo',
    audio: 'Ej: link de Spotify, Apple Podcasts, etc.'
  };
  hint.textContent = placeholders[BIB_TIPO_SEL] || 'Pegá el link completo';
}

function renderLocalesChips() {
  const cont = document.getElementById('contLocales');
  cont.innerHTML = getLocalesActivos().map(loc => {
    const activo = BIB_LOCALES_SEL.includes(loc);
    return `<button class="loc-chip ${activo ? 'active' : ''}" onclick="toggleLocalChip('${loc}')">
      ${activo ? '<i class="ti ti-check"></i>' : ''}${esc(LOCAL_LABELS[loc] || loc)}
    </button>`;
  }).join('');
}

function toggleLocalChip(loc) {
  const idx = BIB_LOCALES_SEL.indexOf(loc);
  if (idx >= 0) BIB_LOCALES_SEL.splice(idx, 1);
  else BIB_LOCALES_SEL.push(loc);
  renderLocalesChips();
}

async function guardarContenido() {
  const titulo = document.getElementById('contTitulo').value.trim();
  const url = document.getElementById('contUrl').value.trim();
  const categoria_id = parseInt(document.getElementById('contCategoria').value, 10);

  if (!titulo) { toast('Falta el título', 'error'); return; }
  if (!url) { toast('Falta el link', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) { toast('El link debe empezar con http:// o https://', 'error'); return; }
  if (!categoria_id) { toast('Elegí una categoría', 'error'); return; }
  if (BIB_LOCALES_SEL.length === 0) { toast('Elegí al menos un local', 'error'); return; }

  const btn = document.getElementById('btnGuardarContenido');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  // Si eligieron el local "TODOS" (transversal), guardar locales=null para que aparezca en todos
  const transversalSlugGuardar = (() => {
    const t = LOCALES_DB.find(x => /transversal/i.test(x.nombre || '') || /transversal/i.test(x.slug || ''));
    return t ? t.slug : null;
  })();
  const localesParaGuardar = (transversalSlugGuardar && BIB_LOCALES_SEL.includes(transversalSlugGuardar))
    ? null
    : BIB_LOCALES_SEL;

  const body = {
    titulo,
    categoria_id,
    tipo: BIB_TIPO_SEL,
    url,
    locales: localesParaGuardar,
    activo: true,
    actualizado_en: new Date().toISOString()
  };

  try {
    if (BIB_EDITANDO_CONT) {
      // UPDATE
      await api(`biblioteca_contenidos?id=eq.${BIB_EDITANDO_CONT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Contenido actualizado');
    } else {
      // INSERT
      body.creado_por = currentUser.id;
      await api('biblioteca_contenidos', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Contenido agregado');
    }
    closeModalContenido();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function activarContenido(id) {
  try {
    await api(`biblioteca_contenidos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: true })
    });
    toast('Contenido activado');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al activar', 'error');
  }
}
window.activarContenido = activarContenido;

async function borrarContenido(id) {
  const c = BIB_CONTENIDOS.find(x => x.id === id);
  if (!c) return;
  const ok = await showConfirm({
    title: '¿Borrar contenido?',
    msg: `Vas a eliminar "${c.titulo}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    // Soft delete
    await api(`biblioteca_contenidos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
    });
    toast('Contenido borrado');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// MODAL: AGREGAR / EDITAR CATEGORÍA
// ============================================
function openModalCategoria(catId) {
  if (!puedeAdminBibCat()) return;
  BIB_EDITANDO_CAT = catId;
  const c = catId ? BIB_CATEGORIAS.find(x => x.id === catId) : null;

  document.getElementById('modalCategoriaTitle').textContent = c ? 'Editar categoría' : 'Nueva categoría';
  document.getElementById('catNombre').value = c ? c.nombre : '';

  BIB_ICONO_SEL = c ? (c.icono || 'ti-folder') : 'ti-folder';
  renderIconPicker();

  document.getElementById('modalCategoria').style.display = 'flex';
}

function closeModalCategoria() {
  document.getElementById('modalCategoria').style.display = 'none';
  BIB_EDITANDO_CAT = null;
}

function renderIconPicker() {
  const cont = document.getElementById('catIconPicker');
  cont.innerHTML = BIB_ICONOS_CAT.map(ic => `
    <div class="icon-opt ${BIB_ICONO_SEL === ic ? 'active' : ''}" onclick="selectIcono('${ic}')">
      <i class="ti ${ic}"></i>
    </div>
  `).join('');
}

function selectIcono(ic) {
  BIB_ICONO_SEL = ic;
  renderIconPicker();
}

async function guardarCategoria() {
  const nombre = document.getElementById('catNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarCategoria');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const body = { nombre, icono: BIB_ICONO_SEL };

  try {
    if (BIB_EDITANDO_CAT) {
      await api(`biblioteca_categorias?id=eq.${BIB_EDITANDO_CAT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Categoría actualizada');
    } else {
      // Orden = el siguiente al máximo actual
      const maxOrden = BIB_CATEGORIAS.reduce((m, c) => Math.max(m, c.orden || 0), 0);
      body.orden = maxOrden + 1;
      await api('biblioteca_categorias', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Categoría creada');
    }
    closeModalCategoria();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function borrarCategoria(id) {
  const cat = BIB_CATEGORIAS.find(c => c.id === id);
  if (!cat) return;

  const contCount = BIB_CONTENIDOS.filter(c => c.categoria_id === id).length;
  if (contCount > 0) {
    await showAlert({
      title: 'No se puede borrar',
      msg: `La categoría "${cat.nombre}" tiene ${contCount} contenido(s) asignado(s).\n\nMové o borrá esos contenidos primero.`,
      type: 'warning',
      okLabel: 'Entendido'
    });
    return;
  }

  const ok = await showConfirm({
    title: '¿Borrar categoría?',
    msg: `Vas a eliminar la categoría "${cat.nombre}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`biblioteca_categorias?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false })
    });
    toast('Categoría borrada');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// Exponer funciones globalmente (para onclick desde HTML)
window.openMiBiblioteca = openMiBiblioteca;
window.openAdminBiblioteca = openAdminBiblioteca;
window.filtrarBibCat = filtrarBibCat;
window.switchBibTab = switchBibTab;
window.openModalContenido = openModalContenido;
window.closeModalContenido = closeModalContenido;
window.selectTipo = selectTipo;
window.toggleLocalChip = toggleLocalChip;
window.guardarContenido = guardarContenido;
window.borrarContenido = borrarContenido;
window.openModalCategoria = openModalCategoria;
window.closeModalCategoria = closeModalCategoria;
window.selectIcono = selectIcono;
window.guardarCategoria = guardarCategoria;
window.borrarCategoria = borrarCategoria;

// ============================================
// ADMIN: GESTIÓN DE LOCALES
// ============================================

let LOCAL_EDITANDO = null;   // slug del local que se está editando
let LOCAL_ACTIVO_SEL = true; // estado seleccionado en el modal

async function openAdminLocales() {
  if (!isMaster()) {
    toast('Solo Master puede gestionar locales', 'error');
    showDashboard();
    return;
  }
  showView('vAdminLocales');
  await recargarLocalesAdmin();
}

async function recargarLocalesAdmin() {
  // Refrescar caché en memoria
  await cargarLocalesDesdeBase();
  renderLocalesAdmin();
}

function renderLocalesAdmin() {
  const cont = document.getElementById('localesAdminLista');
  const count = document.getElementById('localesAdminCount');

  const activos = LOCALES_DB.filter(l => l.activo).length;
  count.textContent = `${activos} activo${activos !== 1 ? 's' : ''} de ${LOCALES_DB.length}`;

  if (LOCALES_DB.length === 0) {
    cont.innerHTML = `<div class="bib-empty">
      <i class="ti ti-building-skyscraper"></i>
      <div class="bib-empty-title">No hay locales cargados</div>
      <div class="bib-empty-desc">Algo raro pasó con la base. Avisá al equipo técnico.</div>
    </div>`;
    return;
  }

  let html = '';
  LOCALES_DB.forEach(l => {
    const cls = 'local-admin-item' + (l.activo ? '' : ' inactivo');
    const badgeCls = l.activo ? 'activo' : 'inactivo';
    const badgeTxt = l.activo ? 'Activo' : 'Oculto';
    const icon = l.activo ? 'ti-building-store' : 'ti-building-store';
    html += `
      <div class="${cls}">
        <div class="local-admin-item-icon"><i class="ti ${icon}"></i></div>
        <div class="local-admin-item-info">
          <div class="local-admin-item-nombre">
            ${esc(l.nombre)}
            <span class="local-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="local-admin-item-slug">${esc(l.slug)}</div>
        </div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalLocal('${esc(l.slug).replace(/'/g, "\\'")}')" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openModalLocal(slug) {
  const l = LOCALES_DB.find(x => x.slug === slug);
  if (!l) { toast('Local no encontrado', 'error'); return; }

  LOCAL_EDITANDO = slug;
  LOCAL_ACTIVO_SEL = l.activo;

  document.getElementById('localSlug').value = l.slug;
  document.getElementById('localNombre').value = l.nombre;
  actualizarToggleLocal();
  document.getElementById('modalLocal').style.display = 'flex';
}

function closeModalLocal() {
  document.getElementById('modalLocal').style.display = 'none';
  LOCAL_EDITANDO = null;
}

function setLocalActivo(val) {
  LOCAL_ACTIVO_SEL = val;
  actualizarToggleLocal();
}

function actualizarToggleLocal() {
  const btnAct = document.getElementById('localToggleActivo');
  const btnIna = document.getElementById('localToggleInactivo');
  const hint = document.getElementById('localEstadoHint');

  btnAct.classList.toggle('active', LOCAL_ACTIVO_SEL);
  btnIna.classList.toggle('active-off', !LOCAL_ACTIVO_SEL);

  hint.textContent = LOCAL_ACTIVO_SEL
    ? 'Cuando está activo, aparece en toda la app.'
    : 'Oculto: no aparece en ningún selector de la app.';
}

async function guardarLocal() {
  if (!LOCAL_EDITANDO) return;
  const nombre = document.getElementById('localNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarLocal');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    await api(`locales?slug=eq.${encodeURIComponent(LOCAL_EDITANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nombre,
        activo: LOCAL_ACTIVO_SEL,
        actualizado_en: new Date().toISOString()
      })
    });
    toast('Local actualizado');
    closeModalLocal();
    await recargarLocalesAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// Exponer funciones globalmente
window.openAdminLocales = openAdminLocales;
window.openModalLocal = openModalLocal;
window.closeModalLocal = closeModalLocal;
window.setLocalActivo = setLocalActivo;
window.guardarLocal = guardarLocal;

// ============================================
// ADMIN: INSUMOS (catálogo de ingredientes)
// ============================================

let INSUMOS_DB = [];          // cache completo de insumos cargados
let INSUMOS_FILTRO_TEXTO = '';
let INSUMOS_FILTRO_SUBFAMILIA = '';
let INSUMOS_FILTRO_PROVEEDOR = '';
let INSUMOS_FILTRO_ESTADO = '';
let INSUMOS_PAGE = 0;
const INSUMOS_PAGE_SIZE = 30;
let INSUMO_EDITANDO = null;   // null = nuevo, o id del insumo
let INSUMOS_SUBFAMILIAS_CACHE = []; // subfamilias únicas del catálogo
let INSUMOS_PROVEEDORES_CACHE = []; // proveedores únicos del catálogo
let INSUMOS_BUSCAR_TIMEOUT = null;

// ¿Quién puede gestionar insumos?
function puedeGestionarInsumos() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_insumos === true);
}
function puedeEditarInsumos() {
  return isMaster() || isAdmin();
}

// Volver desde Insumos: Admin/Master -> panel Administración; editor de Compras -> inicio
window.volverDeInsumos = function() {
  if (isMaster() || isAdmin()) openAdministracion();
  else showDashboard();
};

async function openAdminInsumos() {
  if (!puedeGestionarInsumos()) {
    toast('Solo Master/Admin puede gestionar insumos', 'error');
    showDashboard();
    return;
  }

  showView('vAdminInsumos');

  const _nb = document.getElementById('insumoNuevoBtn');
  if (_nb) _nb.style.display = puedeEditarInsumos() ? '' : 'none';
  const _gb = document.getElementById('insumoGearBtn');
  if (_gb) _gb.style.display = puedeEditarInsumos() ? '' : 'none';
  const _xb = document.getElementById('insumoExportBtn');
  if (_xb) _xb.style.display = puedeEditarInsumos() ? '' : 'none';

  // Reset filtros si es primera vez
  document.getElementById('insumoBuscar').value = INSUMOS_FILTRO_TEXTO;
  document.getElementById('insumoEstado').value = INSUMOS_FILTRO_ESTADO;

  document.getElementById('insumosLista').innerHTML = '<div class="loading">Cargando insumos...</div>';
  document.getElementById('insumosCount').textContent = 'Cargando...';

  await cargarInsumos();
  await cargarSubfamiliasUnicas();
  renderInsumosLista();
}

// Carga TODOS los insumos activos (con paginación local después)
async function cargarInsumos() {
  try {
    // En lugar de traer 7295, traemos los activos (1015)
    // Si llega a ser lento, podemos hacer paginación server-side
    const data = await api('ingredientes?activo=eq.true&order=nombre.asc');
    INSUMOS_DB = data || [];
  } catch (e) {
    console.error('Error cargando insumos:', e);
    document.getElementById('insumosLista').innerHTML =
      '<div class="loading" style="color:var(--c-error)">Error al cargar insumos</div>';
    INSUMOS_DB = [];
  }
}

async function cargarOpcionesUnicas() {
  // Subfamilias únicas
  const subsUnicas = [...new Set(INSUMOS_DB.map(i => i.subfamilia).filter(Boolean))].sort();
  INSUMOS_SUBFAMILIAS_CACHE = subsUnicas;

  // Proveedores únicos
  const provsUnicos = [...new Set(INSUMOS_DB.map(i => i.proveedor).filter(Boolean))].sort();
  INSUMOS_PROVEEDORES_CACHE = provsUnicos;

  // Llenar datalist del filtro de subfamilia
  const dataListFiltro = document.getElementById('insumoSubfamiliaList');
  if (dataListFiltro) {
    dataListFiltro.innerHTML = subsUnicas.map(s => `<option value="${esc(s)}">`).join('');
  }

  // Llenar datalist del filtro de proveedor
  const dataListProvFiltro = document.getElementById('insumoProveedorList');
  if (dataListProvFiltro) {
    dataListProvFiltro.innerHTML = provsUnicos.map(p => `<option value="${esc(p)}">`).join('');
  }
}

// Mantener nombre viejo por compatibilidad
async function cargarSubfamiliasUnicas() {
  return cargarOpcionesUnicas();
}

function actualizarDatalistsInsumos() {
  const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const subF = norm(INSUMOS_FILTRO_SUBFAMILIA);
  const provF = norm(INSUMOS_FILTRO_PROVEEDOR);
  // Proveedores que tienen insumos en la subfamilia elegida
  const provs = [...new Set(INSUMOS_DB
    .filter(i => !subF || norm(i.subfamilia).includes(subF))
    .map(i => i.proveedor).filter(Boolean))].sort();
  // Subfamilias que tiene el proveedor elegido
  const subs = [...new Set(INSUMOS_DB
    .filter(i => !provF || norm(i.proveedor).includes(provF))
    .map(i => i.subfamilia).filter(Boolean))].sort();
  const dlProv = document.getElementById('insumoProveedorList');
  if (dlProv) dlProv.innerHTML = provs.map(p => `<option value="${esc(p)}">`).join('');
  const dlSub = document.getElementById('insumoSubfamiliaList');
  if (dlSub) dlSub.innerHTML = subs.map(s => `<option value="${esc(s)}">`).join('');
}

function insumosFiltrados() {
  const txt = INSUMOS_FILTRO_TEXTO.toLowerCase().trim();
  // Normalizamos para tolerancia a tildes y mayúsculas
  const norm = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const txtN = norm(txt);

  return INSUMOS_DB.filter(i => {
    // Filtro estado
    if (INSUMOS_FILTRO_ESTADO === 'validado' && !i.validado) return false;
    if (INSUMOS_FILTRO_ESTADO === 'pendiente' && i.validado) return false;
    // Filtro subfamilia (búsqueda parcial, tolerante a tildes)
    if (INSUMOS_FILTRO_SUBFAMILIA) {
      const filtroN = norm(INSUMOS_FILTRO_SUBFAMILIA);
      const subN = norm(i.subfamilia);
      if (!subN.includes(filtroN)) return false;
    }
    // Filtro proveedor (búsqueda parcial, tolerante a tildes)
    if (INSUMOS_FILTRO_PROVEEDOR) {
      const filtroN = norm(INSUMOS_FILTRO_PROVEEDOR);
      const provN = norm(i.proveedor);
      if (!provN.includes(filtroN)) return false;
    }
    // Filtro texto (en nombre o proveedor)
    if (txtN) {
      const enNombre = norm(i.nombre).includes(txtN);
      const enProveedor = norm(i.proveedor).includes(txtN);
      if (!enNombre && !enProveedor) return false;
    }
    return true;
  });
}

// Exportar Insumos a Excel (3 hojas, respeta los filtros activos)
window.exportarInsumosExcel = function() {
  const items = insumosFiltrados();
  if (!items.length) {
    toast('No hay insumos para exportar con esos filtros', 'error');
    return;
  }

  // Hoja 1: Insumos
  const filasInsumos = items.map(i => ({
    'Nombre': i.nombre || '',
    'Formato': i.formato || '',
    'Unidad': i.unidad || '',
    'Cantidad por envase': parseFloat(i.cantidad_por_presentacion || 0),
    'Costo envase': parseFloat(i.costo || 0),
    'Costo por unidad': Math.round(costoUnitarioInsumo(i) * 100) / 100,
    'Proveedor': i.proveedor || '',
    'Subfamilia': i.subfamilia || '',
    'Código HiOPOS': i.codigo_hiopos || '',
    'Estado': i.validado ? 'Validado' : 'Pendiente',
    'Actualizado': i.actualizado_en ? String(i.actualizado_en).substring(0, 10) : ''
  }));

  // Hoja 2: Subfamilias (conteo dentro de lo filtrado)
  const subMap = {};
  items.forEach(i => {
    const s = i.subfamilia || '(sin subfamilia)';
    subMap[s] = (subMap[s] || 0) + 1;
  });
  const filasSub = Object.keys(subMap).sort((a, b) => a.localeCompare(b, 'es'))
    .map(s => ({ 'Subfamilia': s, 'Cantidad de insumos': subMap[s] }));

  // Hoja 3: Proveedores (conteo dentro de lo filtrado)
  const provMap = {};
  items.forEach(i => {
    const p = i.proveedor || '(sin proveedor)';
    provMap[p] = (provMap[p] || 0) + 1;
  });
  const filasProv = Object.keys(provMap).sort((a, b) => a.localeCompare(b, 'es'))
    .map(p => ({ 'Proveedor': p, 'Cantidad de insumos': provMap[p] }));

  exportarAExcel('Insumos_AZUCA_' + hoyStr() + '.xlsx', [
    { nombre: 'Insumos', filas: filasInsumos },
    { nombre: 'Subfamilias', filas: filasSub },
    { nombre: 'Proveedores', filas: filasProv }
  ]);
  toast('\u2713 Excel generado (' + items.length + ' insumos)', 'success');
};

function renderInsumosLista() {
  const cont = document.getElementById('insumosLista');
  const countEl = document.getElementById('insumosCount');
  const filtrados = insumosFiltrados();

  const textoCount = filtrados.length === INSUMOS_DB.length
    ? `${INSUMOS_DB.length} insumos`
    : `${filtrados.length} de ${INSUMOS_DB.length} insumos`;
  countEl.textContent = textoCount;
  const inlineEl = document.getElementById('insumosCountInline');
  if (inlineEl) inlineEl.textContent = textoCount;

  if (filtrados.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-package-off"></i>
        <div class="bib-empty-title">No hay insumos para mostrar</div>
        <div class="bib-empty-desc">Ajustá los filtros o agregá un insumo nuevo.</div>
      </div>`;
    document.getElementById('insumosPager').innerHTML = '';
    return;
  }

  // Paginar localmente
  const totalPages = Math.ceil(filtrados.length / INSUMOS_PAGE_SIZE);
  if (INSUMOS_PAGE >= totalPages) INSUMOS_PAGE = 0;
  const desde = INSUMOS_PAGE * INSUMOS_PAGE_SIZE;
  const hasta = desde + INSUMOS_PAGE_SIZE;
  const pageItems = filtrados.slice(desde, hasta);

  let html = '';
  pageItems.forEach(i => {
    const cls = 'insumo-card ' + (i.validado ? 'validado' : 'pendiente');
    const badgeCls = i.validado ? 'validado' : 'pendiente';
    const badgeTxt = i.validado ? '✓ Validado' : '⏳ Pendiente';

    const costoBase = costoUnitarioInsumo(i);
    const costoEnvase = parseFloat(i.costo || 0);
    const cantidad = parseFloat(i.cantidad_por_presentacion || 0);
    const unidad = i.unidad || '';

    html += `
      <div class="${cls}">
        <div class="insumo-icon"><i class="ti ti-package"></i></div>
        <div class="insumo-info">
          <div class="insumo-top">
            <div class="insumo-nombre">${esc(i.nombre)}</div>
            <span class="insumo-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="insumo-meta">
            ${i.formato ? `<strong>${esc(i.formato)}</strong>` : '<em style="color:#888780">(sin formato)</em>'}
            ${i.proveedor ? ` · ${esc(i.proveedor)}` : ''}
          </div>
          <div class="insumo-precio">
            ${costoEnvase > 0 ? `<span>Envase: <span class="insumo-precio-monto">$${formatNumber(costoEnvase)}</span></span>` : ''}
            ${cantidad > 0 ? `<span>${formatNumber(cantidad)} ${esc(unidad)}</span>` : ''}
            ${costoBase > 0 ? `<span>· <span class="insumo-precio-monto">$${formatNumber(costoBase)}/${esc(unidad)}</span></span>` : ''}
          </div>
          ${i.subfamilia ? `<div class="insumo-meta" style="margin-top:6px"><i class="ti ti-tag" style="font-size:11px;vertical-align:-1px"></i> ${esc(i.subfamilia)}</div>` : ''}
        </div>
        ${puedeEditarInsumos() ? `<div class="insumo-actions">
          <button class="bib-btn-edit" onclick="openModalInsumo(${i.id})" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
          <button class="bib-btn-delete" onclick="borrarInsumo(${i.id})" title="Borrar">
            <i class="ti ti-trash"></i>
          </button>
        </div>` : ''}
      </div>`;
  });
  cont.innerHTML = html;

  renderPagerInsumos(filtrados.length, totalPages);
}

function renderPagerInsumos(total, totalPages) {
  const pag = document.getElementById('insumosPager');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = '';
  // Botón anterior
  html += `<button class="pager-btn" onclick="irPaginaInsumo(${INSUMOS_PAGE - 1})" ${INSUMOS_PAGE === 0 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>`;

  // Info "Página X de Y"
  html += `<span class="pager-info">Página ${INSUMOS_PAGE + 1} de ${totalPages}</span>`;

  // Botón siguiente
  html += `<button class="pager-btn" onclick="irPaginaInsumo(${INSUMOS_PAGE + 1})" ${INSUMOS_PAGE === totalPages - 1 ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>`;

  pag.innerHTML = html;
}

function irPaginaInsumo(p) {
  INSUMOS_PAGE = p;
  renderInsumosLista();
  // Scroll al top
  document.getElementById('vAdminInsumos').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Calcula costo por unidad base
function costoUnitarioInsumo(ins) {
  const costo = parseFloat(ins.costo || 0);
  const cant = parseFloat(ins.cantidad_por_presentacion || 0);
  if (!costo || !cant) return 0;
  return costo / cant;
}

// Buscador con debounce
function onBuscarInsumo() {
  if (INSUMOS_BUSCAR_TIMEOUT) clearTimeout(INSUMOS_BUSCAR_TIMEOUT);
  INSUMOS_BUSCAR_TIMEOUT = setTimeout(() => {
    INSUMOS_FILTRO_TEXTO = document.getElementById('insumoBuscar').value;
    INSUMOS_PAGE = 0;
    renderInsumosLista();
  }, 250);
}

function onFiltroInsumo() {
  if (INSUMOS_BUSCAR_TIMEOUT) clearTimeout(INSUMOS_BUSCAR_TIMEOUT);
  INSUMOS_BUSCAR_TIMEOUT = setTimeout(() => {
    INSUMOS_FILTRO_SUBFAMILIA = document.getElementById('insumoSubfamilia').value;
    INSUMOS_FILTRO_PROVEEDOR  = document.getElementById('insumoProveedor').value;
    INSUMOS_FILTRO_ESTADO     = document.getElementById('insumoEstado').value;
    actualizarDatalistsInsumos();
    INSUMOS_PAGE = 0;
    renderInsumosLista();
  }, 200);
}

// Limpiar todos los filtros y volver a ver todos los insumos
window.limpiarFiltrosInsumos = function() {
  INSUMOS_FILTRO_TEXTO = '';
  INSUMOS_FILTRO_SUBFAMILIA = '';
  INSUMOS_FILTRO_PROVEEDOR = '';
  INSUMOS_FILTRO_ESTADO = '';
  ['insumoBuscar', 'insumoSubfamilia', 'insumoProveedor', 'insumoEstado'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  actualizarDatalistsInsumos();
  INSUMOS_PAGE = 0;
  renderInsumosLista();
};

// ============================================
// MODAL: CREAR / EDITAR INSUMO
// ============================================
function openModalInsumo(id) {
  if (!puedeEditarInsumos()) { toast('Solo Master/Admin puede editar insumos', 'error'); return; }
  INSUMO_EDITANDO = id;
  const ins = id ? INSUMOS_DB.find(x => x.id === id) : null;

  document.getElementById('modalInsumoTitle').textContent = ins ? 'Editar insumo' : 'Nuevo insumo';

  document.getElementById('insNombre').value = ins ? (ins.nombre || '') : '';
  document.getElementById('insFormato').value = ins ? (ins.formato || '') : '';
  document.getElementById('insUnidad').value = ins ? (ins.unidad || 'kg') : 'kg';
  document.getElementById('insCantidad').value = ins ? (ins.cantidad_por_presentacion || '') : '1';
  document.getElementById('insCosto').value = ins ? (ins.costo || '') : '';
  document.getElementById('insProveedor').value = ins ? (ins.proveedor || '') : '';
  document.getElementById('insCodigo').value = ins ? (ins.codigo_hiopos || '') : '';

  // Subfamilias en el datalist
  const dataList = document.getElementById('insSubfamiliaList');
  dataList.innerHTML = INSUMOS_SUBFAMILIAS_CACHE
    .map(s => `<option value="${esc(s)}">`)
    .join('');
  document.getElementById('insSubfamilia').value = ins && ins.subfamilia ? ins.subfamilia : '';

  // Proveedores en el datalist
  const dataListProv = document.getElementById('insProveedorList');
  if (dataListProv) {
    dataListProv.innerHTML = INSUMOS_PROVEEDORES_CACHE
      .map(p => `<option value="${esc(p)}">`)
      .join('');
  }

  // Calcular costo unidad inicial
  actualizarCostoUnidad();

  // Si está validado, el botón "Validar" muestra "Re-validar"
  const btnVal = document.getElementById('btnInsumoValidar');
  if (ins && ins.validado) {
    btnVal.innerHTML = '✓ Guardar como validado';
  } else {
    btnVal.innerHTML = '✓ Validar';
  }

  // Listeners para recalcular costo en vivo
  document.getElementById('insCosto').oninput = actualizarCostoUnidad;
  document.getElementById('insCantidad').oninput = actualizarCostoUnidad;

  document.getElementById('modalInsumo').style.display = 'flex';
}

function closeModalInsumo() {
  document.getElementById('modalInsumo').style.display = 'none';
  INSUMO_EDITANDO = null;
}

function actualizarCostoUnidad() {
  const costo = parseFloat(document.getElementById('insCosto').value) || 0;
  const cant = parseFloat(document.getElementById('insCantidad').value) || 0;
  const unidad = document.getElementById('insUnidad').value || '';
  const box = document.getElementById('insCostoUnidad');
  if (costo > 0 && cant > 0) {
    box.value = `$${formatNumber(costo / cant)} / ${unidad}`;
  } else {
    box.value = '';
  }
}

async function guardarInsumo(validar) {
  if (!puedeEditarInsumos()) { toast('Solo Master/Admin puede editar insumos', 'error'); return; }
  const nombre = document.getElementById('insNombre').value.trim();
  const formato = document.getElementById('insFormato').value.trim();
  const unidad = document.getElementById('insUnidad').value;
  const cantidad = parseFloat(document.getElementById('insCantidad').value);
  const costo = parseFloat(document.getElementById('insCosto').value);
  const proveedor = document.getElementById('insProveedor').value.trim();
  const codigo = document.getElementById('insCodigo').value.trim();
  const subfamilia = document.getElementById('insSubfamilia').value;

  if (!nombre) { toast('Falta el nombre', 'error'); return; }
  if (!unidad) { toast('Falta la unidad base', 'error'); return; }
  if (isNaN(cantidad) || cantidad <= 0) { toast('Cantidad por envase inválida', 'error'); return; }
  if (isNaN(costo) || costo < 0) { toast('Costo inválido', 'error'); return; }

  const btnVal = document.getElementById('btnInsumoValidar');
  const btnSin = document.getElementById('btnInsumoSinValidar');
  btnVal.disabled = true;
  btnSin.disabled = true;

  const body = {
    nombre,
    formato: formato || null,
    unidad,
    cantidad_por_presentacion: cantidad,
    costo,
    proveedor: proveedor || null,
    codigo_hiopos: codigo || null,
    subfamilia: subfamilia || null,
    familia: 'INSUMOS',
    activo: true,
    validado: validar,
    actualizado_en: new Date().toISOString()
  };
  if (validar) {
    body.validado_por = currentUser.id;
    body.validado_en = new Date().toISOString();
  }

  try {
    if (INSUMO_EDITANDO) {
      await api(`ingredientes?id=eq.${INSUMO_EDITANDO}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast(validar ? '✓ Validado — disponible para cocina' : 'Guardado sin validar');
    } else {
      // Insumo nuevo
      await api('ingredientes', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast(validar ? '✓ Insumo creado y validado' : 'Insumo creado sin validar');
    }
    closeModalInsumo();
    // Recargar lista
    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
  } catch (e) {
    toast('Error al guardar', 'error');
    console.error(e);
  } finally {
    btnVal.disabled = false;
    btnSin.disabled = false;
  }
}

async function borrarInsumo(id) {
  if (!puedeEditarInsumos()) { toast('Solo Master/Admin puede editar insumos', 'error'); return; }
  const ins = INSUMOS_DB.find(x => x.id === id);
  if (!ins) return;

  // Antes de borrar, chequear si está siendo usado en alguna receta
  try {
    const usos = await api(`receta_componentes?ingrediente_id=eq.${id}&select=receta_id&limit=1`);
    if (usos && usos.length > 0) {
      await showAlert({
        title: 'No se puede borrar',
        msg: `El insumo "${ins.nombre}" está siendo usado en al menos una receta. Primero quitalo de las recetas que lo usan.`,
        type: 'warning',
        okLabel: 'Entendido'
      });
      return;
    }
  } catch (e) {
    console.warn('No se pudo verificar uso del insumo:', e);
  }

  const ok = await showConfirm({
    title: '¿Borrar insumo?',
    msg: `Vas a eliminar "${ins.nombre}".\n\nNo se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    // Soft delete
    await api(`ingredientes?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
    });
    toast('Insumo borrado');
    await cargarInsumos();
    renderInsumosLista();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// GESTIÓN DE SUBFAMILIAS
// ============================================

let SUBFAM_RENOMBRANDO = null; // subfamilia original que se está renombrando

function openGestionSubfamilias() {
  if (!puedeGestionarInsumos()) return;
  renderSubfamilias();
  document.getElementById('modalSubfamilias').style.display = 'flex';
}

function closeGestionSubfamilias() {
  document.getElementById('modalSubfamilias').style.display = 'none';
}

function renderSubfamilias() {
  const cont = document.getElementById('subfamiliasLista');

  // Calcular cantidad de insumos por subfamilia
  const counts = {};
  INSUMOS_DB.forEach(i => {
    const s = i.subfamilia || '(sin subfamilia)';
    counts[s] = (counts[s] || 0) + 1;
  });
  const subs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  if (subs.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-tags-off"></i><div class="bib-empty-title">No hay subfamilias</div></div>';
    return;
  }

  let html = '';
  subs.forEach(s => {
    const esSinSubfam = (s === '(sin subfamilia)');
    const safeName = esc(s).replace(/'/g, "\\'");
    const accionRenombrar = esSinSubfam ? '' : `
      <button class="bib-btn-edit" onclick="openRenombrarSubfam('${safeName}')" title="Renombrar o fusionar">
        <i class="ti ti-edit"></i>
      </button>`;
    const accionBorrar = esSinSubfam ? '' : `
      <button class="bib-btn-delete" onclick="borrarSubfamilia('${safeName}')" title="Borrar (insumos quedan sin subfamilia)">
        <i class="ti ti-trash"></i>
      </button>`;

    html += `
      <div class="subfam-row">
        <div class="subfam-icon-box"><i class="ti ti-tag"></i></div>
        <div class="subfam-info">
          <div class="subfam-nombre">${esc(s)}</div>
          <div class="subfam-count">${counts[s]} insumo${counts[s] !== 1 ? 's' : ''}</div>
        </div>
        <div class="subfam-actions">
          ${accionRenombrar}
          ${accionBorrar}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openRenombrarSubfam(nombreOriginal) {
  SUBFAM_RENOMBRANDO = nombreOriginal;

  const count = INSUMOS_DB.filter(i => i.subfamilia === nombreOriginal).length;

  document.getElementById('subfamOriginal').value = nombreOriginal;
  document.getElementById('subfamNuevo').value = nombreOriginal;
  document.getElementById('subfamCount').textContent =
    `Se actualizarán ${count} insumo${count !== 1 ? 's' : ''}.`;

  // Listener para detectar si se va a fusionar
  const hint = document.getElementById('subfamHint');
  const updateHint = () => {
    const nuevo = document.getElementById('subfamNuevo').value.trim();
    if (!nuevo || nuevo === nombreOriginal) {
      hint.textContent = 'Si el nuevo nombre ya existe, las subfamilias se fusionan.';
      hint.style.color = '';
    } else if (INSUMOS_SUBFAMILIAS_CACHE.includes(nuevo)) {
      hint.textContent = `⚠ "${nuevo}" ya existe. Se fusionarán las dos.`;
      hint.style.color = '#EF9F27';
    } else {
      hint.textContent = `Se renombra "${nombreOriginal}" → "${nuevo}".`;
      hint.style.color = '#5DCAA5';
    }
  };
  document.getElementById('subfamNuevo').oninput = updateHint;
  updateHint();

  document.getElementById('modalRenombrarSubfam').style.display = 'flex';
}

function closeRenombrarSubfam() {
  document.getElementById('modalRenombrarSubfam').style.display = 'none';
  SUBFAM_RENOMBRANDO = null;
}

async function guardarRenombrarSubfam() {
  if (!SUBFAM_RENOMBRANDO) return;
  const nuevo = document.getElementById('subfamNuevo').value.trim();

  if (!nuevo) { toast('Falta el nombre nuevo', 'error'); return; }
  if (nuevo === SUBFAM_RENOMBRANDO) { toast('El nombre no cambió', 'warning'); return; }

  const yaExiste = INSUMOS_SUBFAMILIAS_CACHE.includes(nuevo);
  const accion = yaExiste ? 'fusionar' : 'renombrar';
  const count = INSUMOS_DB.filter(i => i.subfamilia === SUBFAM_RENOMBRANDO).length;

  const ok = await showConfirm({
    title: yaExiste ? `¿Fusionar subfamilias?` : `¿Renombrar subfamilia?`,
    msg: yaExiste
      ? `Vas a fusionar "${SUBFAM_RENOMBRANDO}" con "${nuevo}".\n\n${count} insumo(s) pasarán a "${nuevo}".`
      : `Vas a renombrar "${SUBFAM_RENOMBRANDO}" a "${nuevo}".\n\nAfecta a ${count} insumo(s).`,
    type: yaExiste ? 'warning' : 'info',
    okLabel: yaExiste ? 'Fusionar' : 'Renombrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  const btn = document.getElementById('btnRenombrarSubfam');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  try {
    // UPDATE masivo en ingredientes
    await api(`ingredientes?subfamilia=eq.${encodeURIComponent(SUBFAM_RENOMBRANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subfamilia: nuevo,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(yaExiste ? `Subfamilias fusionadas (${count} insumos)` : `Renombrada (${count} insumos)`);
    closeRenombrarSubfam();

    // Recargar y refrescar UI
    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
    renderSubfamilias();
  } catch (e) {
    toast('Error al actualizar', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aplicar';
  }
}

async function borrarSubfamilia(nombre) {
  const count = INSUMOS_DB.filter(i => i.subfamilia === nombre).length;

  const ok = await showConfirm({
    title: '¿Borrar subfamilia?',
    msg: `Vas a borrar la subfamilia "${nombre}".\n\nLos ${count} insumo(s) asociados quedarán sin subfamilia (no se borran).`,
    type: 'warning',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`ingredientes?subfamilia=eq.${encodeURIComponent(nombre)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subfamilia: null,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(`Subfamilia eliminada (${count} insumos sin subfamilia)`);

    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
    renderSubfamilias();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// MENÚ DE GESTIÓN (subfamilias / proveedores)
// ============================================

function openMenuGestion() {
  if (!puedeGestionarInsumos()) return;
  document.getElementById('modalMenuGestion').style.display = 'flex';
}

function closeMenuGestion() {
  document.getElementById('modalMenuGestion').style.display = 'none';
}

// ============================================
// GESTIÓN DE PROVEEDORES
// ============================================

let PROV_RENOMBRANDO = null;

function openGestionProveedores() {
  if (!puedeGestionarInsumos()) return;
  renderProveedores();
  document.getElementById('modalProveedores').style.display = 'flex';
}

function closeGestionProveedores() {
  document.getElementById('modalProveedores').style.display = 'none';
}

function renderProveedores() {
  const cont = document.getElementById('proveedoresLista');

  const counts = {};
  INSUMOS_DB.forEach(i => {
    const p = i.proveedor || '(sin proveedor)';
    counts[p] = (counts[p] || 0) + 1;
  });
  const provs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  if (provs.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-truck-off"></i><div class="bib-empty-title">No hay proveedores</div></div>';
    return;
  }

  let html = '';
  provs.forEach(p => {
    const esSinProv = (p === '(sin proveedor)');
    const safeName = esc(p).replace(/'/g, "\\'");
    const accionRenombrar = esSinProv ? '' : `
      <button class="bib-btn-edit" onclick="openRenombrarProv('${safeName}')" title="Renombrar o fusionar">
        <i class="ti ti-edit"></i>
      </button>`;
    const accionBorrar = esSinProv ? '' : `
      <button class="bib-btn-delete" onclick="borrarProveedor('${safeName}')" title="Borrar (insumos quedan sin proveedor)">
        <i class="ti ti-trash"></i>
      </button>`;

    html += `
      <div class="subfam-row">
        <div class="subfam-icon-box" style="background:rgba(239,159,39,0.15);color:#EF9F27;">
          <i class="ti ti-truck"></i>
        </div>
        <div class="subfam-info">
          <div class="subfam-nombre">${esc(p)}</div>
          <div class="subfam-count">${counts[p]} insumo${counts[p] !== 1 ? 's' : ''}</div>
        </div>
        <div class="subfam-actions">
          ${accionRenombrar}
          ${accionBorrar}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openRenombrarProv(nombreOriginal) {
  PROV_RENOMBRANDO = nombreOriginal;

  const count = INSUMOS_DB.filter(i => i.proveedor === nombreOriginal).length;

  document.getElementById('provOriginal').value = nombreOriginal;
  document.getElementById('provNuevo').value = nombreOriginal;
  document.getElementById('provCount').textContent =
    `Se actualizarán ${count} insumo${count !== 1 ? 's' : ''}.`;

  const hint = document.getElementById('provHint');
  const updateHint = () => {
    const nuevo = document.getElementById('provNuevo').value.trim();
    if (!nuevo || nuevo === nombreOriginal) {
      hint.textContent = 'Si el nuevo nombre ya existe, los proveedores se fusionan.';
      hint.style.color = '';
    } else if (INSUMOS_PROVEEDORES_CACHE.includes(nuevo)) {
      hint.textContent = `⚠ "${nuevo}" ya existe. Se fusionarán los dos.`;
      hint.style.color = '#EF9F27';
    } else {
      hint.textContent = `Se renombra "${nombreOriginal}" → "${nuevo}".`;
      hint.style.color = '#5DCAA5';
    }
  };
  document.getElementById('provNuevo').oninput = updateHint;
  updateHint();

  document.getElementById('modalRenombrarProv').style.display = 'flex';
}

function closeRenombrarProv() {
  document.getElementById('modalRenombrarProv').style.display = 'none';
  PROV_RENOMBRANDO = null;
}

async function guardarRenombrarProv() {
  if (!PROV_RENOMBRANDO) return;
  const nuevo = document.getElementById('provNuevo').value.trim();

  if (!nuevo) { toast('Falta el nombre nuevo', 'error'); return; }
  if (nuevo === PROV_RENOMBRANDO) { toast('El nombre no cambió', 'warning'); return; }

  const yaExiste = INSUMOS_PROVEEDORES_CACHE.includes(nuevo);
  const count = INSUMOS_DB.filter(i => i.proveedor === PROV_RENOMBRANDO).length;

  const ok = await showConfirm({
    title: yaExiste ? `¿Fusionar proveedores?` : `¿Renombrar proveedor?`,
    msg: yaExiste
      ? `Vas a fusionar "${PROV_RENOMBRANDO}" con "${nuevo}".\n\n${count} insumo(s) pasarán a "${nuevo}".`
      : `Vas a renombrar "${PROV_RENOMBRANDO}" a "${nuevo}".\n\nAfecta a ${count} insumo(s).`,
    type: yaExiste ? 'warning' : 'info',
    okLabel: yaExiste ? 'Fusionar' : 'Renombrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  const btn = document.getElementById('btnRenombrarProv');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  try {
    await api(`ingredientes?proveedor=eq.${encodeURIComponent(PROV_RENOMBRANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        proveedor: nuevo,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(yaExiste ? `Proveedores fusionados (${count} insumos)` : `Renombrado (${count} insumos)`);
    closeRenombrarProv();

    await cargarInsumos();
    await cargarOpcionesUnicas();
    renderInsumosLista();
    renderProveedores();
  } catch (e) {
    toast('Error al actualizar', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aplicar';
  }
}

async function borrarProveedor(nombre) {
  const count = INSUMOS_DB.filter(i => i.proveedor === nombre).length;

  const ok = await showConfirm({
    title: '¿Borrar proveedor?',
    msg: `Vas a borrar el proveedor "${nombre}".\n\nLos ${count} insumo(s) asociados quedarán sin proveedor (no se borran).`,
    type: 'warning',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`ingredientes?proveedor=eq.${encodeURIComponent(nombre)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        proveedor: null,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(`Proveedor eliminado (${count} insumos sin proveedor)`);

    await cargarInsumos();
    await cargarOpcionesUnicas();
    renderInsumosLista();
    renderProveedores();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// Exponer al window
window.openAdminInsumos = openAdminInsumos;
window.openModalInsumo = openModalInsumo;
window.closeModalInsumo = closeModalInsumo;
window.guardarInsumo = guardarInsumo;
window.borrarInsumo = borrarInsumo;
window.onBuscarInsumo = onBuscarInsumo;
window.onFiltroInsumo = onFiltroInsumo;
window.irPaginaInsumo = irPaginaInsumo;
window.openGestionSubfamilias = openGestionSubfamilias;
window.closeGestionSubfamilias = closeGestionSubfamilias;
window.openRenombrarSubfam = openRenombrarSubfam;
window.closeRenombrarSubfam = closeRenombrarSubfam;
window.guardarRenombrarSubfam = guardarRenombrarSubfam;
window.borrarSubfamilia = borrarSubfamilia;
window.openMenuGestion = openMenuGestion;
window.closeMenuGestion = closeMenuGestion;
window.openGestionProveedores = openGestionProveedores;
window.closeGestionProveedores = closeGestionProveedores;
window.openRenombrarProv = openRenombrarProv;
window.closeRenombrarProv = closeRenombrarProv;
window.guardarRenombrarProv = guardarRenombrarProv;
window.borrarProveedor = borrarProveedor;


// ============================================
// GESTIÓN DE ROSTERS (Admin / Master / editor_rosters)
// ============================================
function puedeGestionarRosters() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_rosters === true);
}
function rostLocalesPermitidos() {
  const activos = getLocalesActivos();
  if (isMaster() || isAdmin()) return activos;
  const mios = (currentUser && currentUser.locales_asignados) || [];
  return activos.filter(l => mios.indexOf(l) !== -1);
}
function rostNombreEmp(e) {
  const pila = e.nombre_p || e.nombre || '';
  const ap = e.apellido || '';
  if (ap && pila) return ap + ', ' + pila;
  return (ap || pila || 'Sin nombre');
}

let ROST_LOCAL = null, ROST_LUNES = null, ROST_SEMANA = null;
let ROST_EMPLEADOS = [], ROST_TURNOS = {}, ROST_EMP_EDIT = null, ROST_PLANTILLAS = [];
let ROST_SECTOR_FILTRO = '', ROST_ALL_EMP = [], ROST_EMP_ASIG = {};

async function openGestionRosters() {
  if (!puedeGestionarRosters()) return;
  showView('vGestionRosters');
  const locs = rostLocalesPermitidos();
  const sel = document.getElementById('rostLocal');
  sel.innerHTML = locs.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
  if (!locs.length) {
    document.getElementById('rostWeekLabel').textContent = '—';
    document.getElementById('rostLista').innerHTML = '<div class="empty-list">No tenés locales asignados para gestionar rosters.</div>';
    return;
  }
  let def = locs[0];
  if (currentEmpleado && currentEmpleado.local && locs.indexOf(currentEmpleado.local) !== -1) def = currentEmpleado.local;
  sel.value = def;
  ROST_LOCAL = def;
  ROST_LUNES = addDays(getLunes(hoyStr()), 7);  // por defecto la semana siguiente (la que hay que editar)
  await cargarPlantillasRoster();
  await cargarEmpleadosRoster();
  await cargarRosterSemana();
}
window.onChangeLocalRoster = function() {
  ROST_LOCAL = document.getElementById('rostLocal').value;
  cargarRosterSemana();
};
window.cambiarSemanaRoster = function(n) {
  ROST_LUNES = addDays(ROST_LUNES, n * 7);
  cargarRosterSemana();
};

async function cargarPlantillasRoster() {
  try {
    ROST_PLANTILLAS = await api('turnos_estandar?activo=eq.true&select=*&order=nombre') || [];
  } catch (e) {
    ROST_PLANTILLAS = [];
    console.warn('No se pudieron cargar plantillas:', e);
  }
}

async function cargarEmpleadosRoster() {
  try {
    ROST_ALL_EMP = await api('empleados?activo=eq.true&select=*') || [];
    const users = await api('roster_usuarios?empleado_id=not.is.null&select=empleado_id,locales_asignados') || [];
    ROST_EMP_ASIG = {};
    users.forEach(u => { if (u.empleado_id != null) ROST_EMP_ASIG[u.empleado_id] = u.locales_asignados || []; });
  } catch (e) { console.warn('No se pudieron cargar empleados:', e); ROST_ALL_EMP = ROST_ALL_EMP || []; }
}
function poblarSectorRoster() {
  const sel = document.getElementById('rostSector');
  if (!sel) return;
  const sectores = Array.from(new Set(ROST_EMPLEADOS.map(e => e.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
  const prev = ROST_SECTOR_FILTRO;
  sel.innerHTML = '<option value="">Todos los sectores</option>' + sectores.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
  if (sectores.indexOf(prev) !== -1) sel.value = prev; else { sel.value = ''; ROST_SECTOR_FILTRO = ''; }
}
window.onChangeSectorRoster = function() {
  ROST_SECTOR_FILTRO = document.getElementById('rostSector').value;
  renderRosterLista();
};

async function cargarRosterSemana() {
  const lista = document.getElementById('rostLista');
  document.getElementById('rostWeekLabel').textContent = fmtSemana(ROST_LUNES);
  lista.innerHTML = '<div class="loading">Cargando...</div>';
  try {
    const sem = await api('roster_semanas?local=eq.' + encodeURIComponent(ROST_LOCAL) + '&fecha_lunes=eq.' + ROST_LUNES + '&select=*');
    ROST_SEMANA = (sem && sem.length) ? sem[0] : null;
    document.getElementById('rostNota').value = ROST_SEMANA ? (ROST_SEMANA.comentario_general || '') : '';

    ROST_EMPLEADOS = (ROST_ALL_EMP || []).filter(e =>
      e.local === ROST_LOCAL ||
      (e.es_multilocal && (ROST_EMP_ASIG[e.id] || []).indexOf(ROST_LOCAL) !== -1)
    );
    ROST_EMPLEADOS.sort((a, b) => rostNombreEmp(a).localeCompare(rostNombreEmp(b), 'es'));
    poblarSectorRoster();

    ROST_TURNOS = {};
    if (ROST_SEMANA) {
      const tts = await api('roster_turnos?semana_id=eq.' + ROST_SEMANA.id + '&select=*') || [];
      tts.forEach(t => {
        if (!ROST_TURNOS[t.empleado_id]) ROST_TURNOS[t.empleado_id] = {};
        ROST_TURNOS[t.empleado_id][t.dia] = t;
      });
    }
    renderRosterLista();
  } catch (e) {
    lista.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar la semana</div>';
    console.error(e);
  }
}

function renderRosterLista() {
  const lista = document.getElementById('rostLista');
  let emps = ROST_EMPLEADOS;
  if (ROST_SECTOR_FILTRO) emps = emps.filter(e => e.sector === ROST_SECTOR_FILTRO);
  if (!emps.length) {
    lista.innerHTML = '<div class="empty-list">No hay empleados ' + (ROST_SECTOR_FILTRO ? 'de ese sector ' : '') + 'en este local.</div>';
    return;
  }
  const dias = diasDeSemana(ROST_LUNES);
  const cortos = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
  lista.innerHTML = emps.map(e => {
    const chips = dias.map((d, i) => {
      const t = (ROST_TURNOS[e.id] || {})[d];
      let txt = '—', cls = 'rost-chip';
      if (t) {
        if (t.es_off) { txt = 'OFF'; cls += ' off'; }
        else if (t.es_flex) { txt = t.hora_entrada ? 'F ' + t.hora_entrada.slice(0, 5) : 'FLEX'; cls += ' flex'; }
        else if (t.hora_entrada) { txt = t.hora_entrada.slice(0, 5); cls += ' on'; }
      }
      return '<div class="rost-chip-wrap"><span class="rost-dia-lbl">' + cortos[i] + ' ' + Number(d.slice(8, 10)) + '</span><span class="' + cls + '">' + esc(txt) + '</span></div>';
    }).join('');
    return '<div class="rost-emp" onclick="abrirEditarTurnosEmp(' + e.id + ')">' +
      '<div class="rost-emp-top"><span class="rost-emp-nom">' + esc(rostNombreEmp(e)) + '</span><i class="ti ti-chevron-right"></i></div>' +
      '<div class="rost-chips">' + chips + '</div></div>';
  }).join('');
}

window.abrirEditarTurnosEmp = function(empId) {
  const e = ROST_EMPLEADOS.find(x => x.id === empId);
  if (!e) return;
  ROST_EMP_EDIT = empId;
  document.getElementById('rostEmpNombre').textContent = rostNombreEmp(e);
  document.getElementById('rostEmpSemana').textContent = (LOCAL_LABELS[ROST_LOCAL] || ROST_LOCAL) + ' · ' + fmtSemana(ROST_LUNES);
  document.getElementById('rostError').textContent = '';

  const dias = diasDeSemana(ROST_LUNES);
  const empT = ROST_TURNOS[empId] || {};
  const estados = [['trabaja', 'Trabaja'], ['off', 'OFF'], ['flex', 'FLEX'], ['', '—']];
  document.getElementById('rostDias').innerHTML = dias.map((d, i) => {
    const t = empT[d];
    let est = '';
    if (t) { if (t.es_off) est = 'off'; else if (t.es_flex) est = 'flex'; else est = 'trabaja'; }
    const hora = t && t.hora_entrada ? t.hora_entrada.slice(0, 5) : '';
    const coment = t && t.comentario ? t.comentario : '';
    const btns = estados.map(p => '<button type="button" class="rost-est' + (est === p[0] ? ' activo' : '') + '" data-est="' + p[0] + '">' + p[1] + '</button>').join('');
    const showHora = (est === 'trabaja' || est === 'flex');
    return '<div class="rost-dia" data-dia="' + d + '" data-est="' + est + '">' +
      '<div class="rost-dia-head"><strong>' + DIAS_LARGO[i] + '</strong> <span>' + fmtFechaCorta(d) + '</span></div>' +
      '<div class="rost-estados">' + btns + '</div>' +
      '<div class="rost-dia-extra">' +
        '<input type="time" class="rost-hora" value="' + hora + '"' + (showHora ? '' : ' style="display:none;"') + '>' +
        '<input type="text" class="rost-coment" placeholder="Comentario (opcional)" value="' + esc(coment) + '">' +
      '</div></div>';
  }).join('');

  document.querySelectorAll('#rostDias .rost-dia').forEach(block => {
    block.querySelectorAll('.rost-est').forEach(btn => {
      btn.addEventListener('click', () => {
        block.querySelectorAll('.rost-est').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        const est = btn.dataset.est;
        block.dataset.est = est;
        block.querySelector('.rost-hora').style.display = (est === 'trabaja' || est === 'flex') ? '' : 'none';
      });
    });
  });

  // Plantillas disponibles para este local (o 'TODOS')
  const dispo = ROST_PLANTILLAS.filter(p => p.local === ROST_LOCAL || p.local === 'TODOS');
  const selP = document.getElementById('rostPlantilla');
  selP.innerHTML = '<option value="">Aplicar una plantilla\u2026</option>' +
    dispo.map(p => '<option value="' + p.id + '">' + esc(p.nombre) +
      ' (' + esc(p.local === 'TODOS' ? 'Todos' : (LOCAL_LABELS[p.local] || p.local)) + ')</option>').join('');
  document.getElementById('rostPlantillaRow').style.display = dispo.length ? 'flex' : 'none';

  document.getElementById('modalEditarTurnos').classList.add('show');
};
window.closeEditarTurnosModal = function() {
  document.getElementById('modalEditarTurnos').classList.remove('show');
};

window.aplicarPlantilla = function() {
  const id = parseInt(document.getElementById('rostPlantilla').value, 10);
  if (!id) return;
  const tpl = ROST_PLANTILLAS.find(p => p.id === id);
  if (!tpl) return;
  const dayKeys = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  const blocks = document.querySelectorAll('#rostDias .rost-dia');
  blocks.forEach((block, i) => {
    const hora = tpl[dayKeys[i]];
    const flex = !!tpl[dayKeys[i] + '_flex'];
    let est = null;
    if (flex) est = 'flex';
    else if (hora && String(hora).trim()) est = 'trabaja';
    if (!est) return; // día vacío en la plantilla → no se toca
    block.querySelectorAll('.rost-est').forEach(b => b.classList.toggle('activo', b.dataset.est === est));
    block.dataset.est = est;
    const horaEl = block.querySelector('.rost-hora');
    horaEl.style.display = '';
    horaEl.value = hora ? String(hora).slice(0, 5) : '';
  });
  toast('Plantilla aplicada — revisá y guardá', 'success');
};

async function asegurarSemanaRoster() {
  if (ROST_SEMANA) return ROST_SEMANA;
  const ins = await api('roster_semanas', {
    method: 'POST',
    body: JSON.stringify({ local: ROST_LOCAL, fecha_lunes: ROST_LUNES, creado_por: currentUser ? currentUser.id : null })
  });
  ROST_SEMANA = Array.isArray(ins) ? ins[0] : ins;
  return ROST_SEMANA;
}

async function chequearConflictoMultilocal(empId, dias) {
  try {
    if (!dias || !dias.length) return;
    const turnos = await api('roster_turnos?empleado_id=eq.' + empId +
      '&dia=in.(' + dias.join(',') + ')&es_off=eq.false&select=dia,hora_entrada,semana_id') || [];
    if (!turnos.length) return;
    const semIds = Array.from(new Set(turnos.map(t => t.semana_id).filter(Boolean)));
    if (!semIds.length) return;
    const sems = await api('roster_semanas?id=in.(' + semIds.join(',') + ')&select=id,local') || [];
    const locOf = {}; sems.forEach(s => { locOf[s.id] = s.local; });
    const conf = turnos.filter(t => locOf[t.semana_id] && locOf[t.semana_id] !== ROST_LOCAL);
    if (!conf.length) return;
    conf.sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
    const lineas = conf.map(t => {
      const loc = LOCAL_LABELS[locOf[t.semana_id]] || locOf[t.semana_id];
      const h = t.hora_entrada ? (' a las ' + String(t.hora_entrada).slice(0, 5)) : '';
      return '\u2022 ' + fmtFechaCorta(t.dia) + ': ' + loc + h;
    }).join('\n');
    await showAlert({
      title: '\u26a0\ufe0f Ya tiene turno en otro local',
      msg: 'Esta persona, adem\u00e1s de ac\u00e1, ya tiene turno asignado en:\n\n' + lineas + '\n\nSi entra en dos locales el mismo d\u00eda en horarios distintos est\u00e1 bien; solo revis\u00e1 que no se superpongan.',
      type: 'warning'
    });
  } catch (e) { console.warn('conflicto multilocal:', e); }
}
window.guardarTurnosEmp = async function() {
  const err = document.getElementById('rostError');
  err.textContent = '';
  const empId = ROST_EMP_EDIT;
  if (!empId) return;
  const btn = document.getElementById('rostGuardarBtn');
  btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Guardando...';
  try {
    const semana = await asegurarSemanaRoster();
    const empT = ROST_TURNOS[empId] || {};
    const blocks = document.querySelectorAll('#rostDias .rost-dia');
    const aInsertar = [];
    const diasTrabaja = [];
    for (const block of blocks) {
      const dia = block.dataset.dia;
      const est = block.dataset.est || '';
      const hora = block.querySelector('.rost-hora').value || null;
      const coment = block.querySelector('.rost-coment').value.trim() || null;
      const existente = empT[dia];

      if (!est) {
        if (existente) {
          await api('roster_turnos?id=eq.' + existente.id, { method: 'DELETE' });
          delete empT[dia];
        }
        continue;
      }
      const payload = {
        semana_id: semana.id,
        empleado_id: empId,
        dia: dia,
        hora_entrada: (est === 'off') ? null : hora,
        es_off: est === 'off',
        es_flex: est === 'flex',
        comentario: coment
      };
      if (est !== 'off') diasTrabaja.push(dia);
      if (existente) {
        const upd = await api('roster_turnos?id=eq.' + existente.id, { method: 'PATCH', body: JSON.stringify(payload) });
        empT[dia] = (Array.isArray(upd) && upd.length) ? upd[0] : Object.assign({}, existente, payload);
      } else {
        aInsertar.push(payload);
      }
    }
    if (aInsertar.length) {
      const inserted = await api('roster_turnos', { method: 'POST', body: JSON.stringify(aInsertar) });
      (Array.isArray(inserted) ? inserted : [inserted]).forEach(t => { if (t && t.dia) empT[t.dia] = t; });
    }
    ROST_TURNOS[empId] = empT;
    await chequearConflictoMultilocal(empId, diasTrabaja);
    closeEditarTurnosModal();
    renderRosterLista();
    toast('\u2713 Turnos guardados', 'success');
  } catch (e) {
    err.textContent = 'No se pudo guardar: ' + (e.message || e);
  } finally {
    btn.disabled = false; btn.textContent = txt;
  }
};

window.guardarNotaSemana = async function() {
  try {
    const nota = document.getElementById('rostNota').value.trim() || null;
    const semana = await asegurarSemanaRoster();
    await api('roster_semanas?id=eq.' + semana.id, { method: 'PATCH', body: JSON.stringify({ comentario_general: nota }) });
    ROST_SEMANA.comentario_general = nota;
    toast('\u2713 Nota guardada', 'success');
  } catch (e) {
    toast('No se pudo guardar la nota', 'error');
  }
};



// ============================================
// ADMIN: PLANTILLAS DE ROSTERS (turnos_estandar)
// ============================================
let PLANTILLAS_CACHE = [], PLANTILLA_EDIT_ID = null;
const PL_DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

async function openPlantillasRosters() {
  if (!isMaster() && !isAdmin()) { showDashboard(); return; }
  showView('vPlantillasRosters');
  await recargarPlantillas();
}
async function recargarPlantillas() {
  const cont = document.getElementById('plantillasLista');
  cont.innerHTML = '<div class="loading">Cargando...</div>';
  try {
    PLANTILLAS_CACHE = await api('turnos_estandar?select=*&order=local,nombre') || [];
    renderPlantillasLista();
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar las plantillas</div>';
    console.error(e);
  }
}
function renderPlantillasLista() {
  const cont = document.getElementById('plantillasLista');
  const count = document.getElementById('plantillasCount');
  const activas = PLANTILLAS_CACHE.filter(p => p.activo).length;
  count.textContent = activas + ' activa' + (activas !== 1 ? 's' : '') + ' de ' + PLANTILLAS_CACHE.length;
  if (!PLANTILLAS_CACHE.length) {
    cont.innerHTML = '<div class="empty-list">Todav\u00eda no hay plantillas. Cre\u00e1 la primera con el bot\u00f3n de arriba.</div>';
    return;
  }
  const cortos = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'S\u00e1', 'Do'];
  cont.innerHTML = PLANTILLAS_CACHE.map(p => {
    const chips = PL_DIAS.map((k, i) => {
      const hora = p[k]; const flex = !!p[k + '_flex'];
      let txt = '\u2014', cls = 'rost-chip';
      if (flex) { txt = hora ? 'F ' + String(hora).slice(0, 5) : 'FLEX'; cls += ' flex'; }
      else if (hora) { txt = String(hora).slice(0, 5); cls += ' on'; }
      return '<div class="rost-chip-wrap"><span class="rost-dia-lbl">' + cortos[i] + '</span><span class="' + cls + '">' + esc(txt) + '</span></div>';
    }).join('');
    const localTxt = p.local === 'TODOS' ? 'Todos' : (LOCAL_LABELS[p.local] || p.local);
    const inact = p.activo ? '' : ' <span style="color:var(--c-muted);font-weight:400;font-size:11px;">(inactiva)</span>';
    return '<div class="rost-emp' + (p.activo ? '' : ' inactive') + '" onclick="abrirEditarPlantilla(' + p.id + ')">' +
      '<div class="rost-emp-top"><span class="rost-emp-nom">' + esc(p.nombre) + inact + '</span>' +
      '<span style="font-size:11px;color:var(--c-muted);">' + esc(localTxt) + '</span></div>' +
      '<div class="rost-chips">' + chips + '</div></div>';
  }).join('');
}

function llenarLocalSelectPlantilla(sel) {
  const todos = getLocalesActivos().slice();
  if (sel && sel !== 'TODOS' && todos.indexOf(sel) === -1) todos.unshift(sel);
  const opts = ['<option value="TODOS"' + (sel === 'TODOS' || !sel ? ' selected' : '') + '>Todos los locales</option>']
    .concat(todos.map(l => '<option value="' + esc(l) + '"' + (l === sel ? ' selected' : '') + '>' + esc(LOCAL_LABELS[l] || l) + '</option>'));
  document.getElementById('plLocal').innerHTML = opts.join('');
}
function renderPlantillaDias(p) {
  const estados = [['trabaja', 'Trabaja'], ['flex', 'FLEX'], ['', '\u2014']];
  document.getElementById('plDias').innerHTML = PL_DIAS.map((k, i) => {
    let est = '', hora = '';
    if (p) {
      const flex = !!p[k + '_flex']; const h = p[k];
      if (flex) est = 'flex'; else if (h) est = 'trabaja';
      hora = h ? String(h).slice(0, 5) : '';
    }
    const btns = estados.map(e => '<button type="button" class="rost-est' + (est === e[0] ? ' activo' : '') + '" data-est="' + e[0] + '">' + e[1] + '</button>').join('');
    const showHora = (est === 'trabaja' || est === 'flex');
    return '<div class="rost-dia" data-key="' + k + '" data-est="' + est + '">' +
      '<div class="rost-dia-head"><strong>' + DIAS_LARGO[i] + '</strong></div>' +
      '<div class="rost-estados">' + btns + '</div>' +
      '<div class="rost-dia-extra"><input type="time" class="rost-hora" value="' + hora + '"' + (showHora ? '' : ' style="display:none;"') + '></div>' +
      '</div>';
  }).join('');
  document.querySelectorAll('#plDias .rost-dia').forEach(block => {
    block.querySelectorAll('.rost-est').forEach(btn => {
      btn.addEventListener('click', () => {
        block.querySelectorAll('.rost-est').forEach(b => b.classList.remove('activo'));
        btn.classList.add('activo');
        const est = btn.dataset.est; block.dataset.est = est;
        block.querySelector('.rost-hora').style.display = (est === 'trabaja' || est === 'flex') ? '' : 'none';
      });
    });
  });
}

window.abrirNuevaPlantilla = function() {
  PLANTILLA_EDIT_ID = null;
  document.getElementById('plantillaModalTitulo').textContent = 'Nueva plantilla';
  document.getElementById('plNombre').value = '';
  document.getElementById('plActivo').checked = true;
  llenarLocalSelectPlantilla(null);
  renderPlantillaDias(null);
  document.getElementById('plError').textContent = '';
  document.getElementById('modalPlantilla').classList.add('show');
};
window.abrirEditarPlantilla = function(id) {
  const p = PLANTILLAS_CACHE.find(x => x.id === id);
  if (!p) return;
  PLANTILLA_EDIT_ID = id;
  document.getElementById('plantillaModalTitulo').textContent = 'Editar plantilla';
  document.getElementById('plNombre').value = p.nombre || '';
  document.getElementById('plActivo').checked = !!p.activo;
  llenarLocalSelectPlantilla(p.local);
  renderPlantillaDias(p);
  document.getElementById('plError').textContent = '';
  document.getElementById('modalPlantilla').classList.add('show');
};
window.closePlantillaModal = function() {
  document.getElementById('modalPlantilla').classList.remove('show');
};
window.guardarPlantilla = async function() {
  const err = document.getElementById('plError'); err.textContent = '';
  const nombre = document.getElementById('plNombre').value.trim();
  if (!nombre) { err.textContent = 'Pon\u00e9 un nombre para la plantilla.'; return; }
  const payload = {
    nombre: nombre,
    local: document.getElementById('plLocal').value,
    activo: document.getElementById('plActivo').checked
  };
  document.querySelectorAll('#plDias .rost-dia').forEach(block => {
    const k = block.dataset.key; const est = block.dataset.est || '';
    const hora = block.querySelector('.rost-hora').value || null;
    payload[k] = (est === '') ? null : hora;
    payload[k + '_flex'] = (est === 'flex');
  });
  const btn = document.getElementById('plGuardarBtn');
  btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Guardando...';
  try {
    if (PLANTILLA_EDIT_ID) {
      await api('turnos_estandar?id=eq.' + PLANTILLA_EDIT_ID, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      payload.creado_por = currentUser ? currentUser.id : null;
      await api('turnos_estandar', { method: 'POST', body: JSON.stringify(payload) });
    }
    closePlantillaModal();
    await recargarPlantillas();
    toast('\u2713 Plantilla guardada', 'success');
  } catch (e) {
    err.textContent = 'No se pudo guardar: ' + (e.message || e);
  } finally {
    btn.disabled = false; btn.textContent = txt;
  }
};



// ============================================
// MIS PEDIDOS (requerimientos + requerimiento_items)
// ============================================
function puedeGestionarPedidos() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_pedidos === true);
}
function pedLocalesPermitidos() {
  const tv = getSlugTransversal();
  const activos = getLocalesActivos().filter(l => l !== tv);
  if (isMaster() || isAdmin()) return activos;
  const mios = (currentUser && currentUser.locales_asignados) || [];
  return activos.filter(l => mios.indexOf(l) !== -1);
}
const PED_ESTADOS = {
  borrador:   { label: 'Borrador',   color: '#B4B2A9' },
  pendiente:  { label: 'Pendiente',  color: '#EF9F27' },
  confirmado: { label: 'Confirmado', color: '#378ADD' },
  completado: { label: 'Completado', color: '#1D9E75' }
};
function pedFecha(x) { return x ? fmtFechaCorta(String(x).slice(0, 10)) : ''; }

let PED_LOCAL_FILTRO = '', PED_ESTADO_FILTRO = '';
let PED_LISTA = [], PED_INSUMOS = [], PED_UNIDADES = [];
let PED_ACTUAL = null, PED_ITEMS = [];

async function openMisPedidos() {
  if (!puedeGestionarPedidos()) { showDashboard(); return; }
  showView('vMisPedidos');
  const locs = pedLocalesPermitidos();
  const sel = document.getElementById('pedLocalFiltro');
  sel.innerHTML = '<option value="">Todos mis locales</option>' +
    locs.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
  document.getElementById('pedNuevoBtn').style.display = locs.length ? '' : 'none';
  await cargarCatalogosPedidos();
  await cargarPedidos();
}
window.openMisPedidos = openMisPedidos;
async function cargarCatalogosPedidos() {
  try {
    if (!PED_INSUMOS.length) PED_INSUMOS = await api('ingredientes?activo=eq.true&select=id,nombre,unidad,costo,cantidad_por_presentacion&order=nombre.asc') || [];
    if (!PED_UNIDADES.length) PED_UNIDADES = await api('unidades_pedido?activo=eq.true&select=*&order=orden.asc') || [];
  } catch (e) { console.warn('catalogos pedidos:', e); }
}
window.onFiltroPedidos = function() {
  PED_LOCAL_FILTRO = document.getElementById('pedLocalFiltro').value;
  PED_ESTADO_FILTRO = document.getElementById('pedEstadoFiltro').value;
  cargarPedidos();
};
async function cargarPedidos() {
  const lista = document.getElementById('pedidosLista');
  lista.innerHTML = '<div class="loading">Cargando pedidos...</div>';
  const locs = pedLocalesPermitidos();
  try {
    let q = 'requerimientos?activo=eq.true&select=*&order=fecha_creacion.desc';
    if (PED_LOCAL_FILTRO) {
      q += '&local=eq.' + encodeURIComponent(PED_LOCAL_FILTRO);
    } else if (!isMaster() && !isAdmin()) {
      if (!locs.length) { lista.innerHTML = '<div class="empty-list">No ten\u00e9s locales asignados.</div>'; return; }
      q += '&local=in.(' + locs.map(encodeURIComponent).join(',') + ')';
    }
    if (PED_ESTADO_FILTRO) q += '&estado=eq.' + PED_ESTADO_FILTRO;
    PED_LISTA = await api(q) || [];
    const _ids = PED_LISTA.map(p => p.id);
    if (_ids.length) {
      try {
        const _its = await api('requerimiento_items?requerimiento_id=in.(' + _ids.join(',') + ')&select=requerimiento_id,ingrediente_id,cantidad_pedida,unidad,orden&order=orden.asc') || [];
        const _by = {};
        _its.forEach(it => { (_by[it.requerimiento_id] = _by[it.requerimiento_id] || []).push(it); });
        PED_LISTA.forEach(p => { p._items = _by[p.id] || []; });
      } catch (e) { PED_LISTA.forEach(p => { p._items = []; }); }
    }
    renderPedidos();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">No se pudieron cargar los pedidos.<br><span style="font-size:11px;opacity:.7">' + esc(String((e && e.message) || e)) + '</span></div>';
  }
}
function renderPedidos() {
  const lista = document.getElementById('pedidosLista');
  if (!PED_LISTA.length) { lista.innerHTML = '<div class="empty-list">No hay pedidos con ese criterio.</div>'; return; }
  lista.innerHTML = PED_LISTA.map(p => {
    const est = PED_ESTADOS[p.estado] || { label: p.estado || '\u2014', color: '#8A8278' };
    const partes = [];
    if (p.fecha_deseada) partes.push('Para ' + pedFecha(p.fecha_deseada));
    if (p.fecha_comprometida) partes.push('Entrega ' + pedFecha(p.fecha_comprometida));
    const sub = partes.length ? partes.join(' \u00b7 ') : ('Creado ' + pedFecha(p.fecha_creacion));
    const its = p._items || [];
    let itemsHtml = '';
    if (its.length) {
      const names = its.slice(0, 5).map(it => esc(pedInsumoNombre(it.ingrediente_id)));
      const extra = its.length > 5 ? (' +' + (its.length - 5) + ' m\u00e1s') : '';
      itemsHtml = '<div class="ped-card-items">' + names.join(' \u00b7 ') + extra + '</div>';
    }
    return '<div class="ped-card" onclick="abrirPedido(' + p.id + ')">' +
      '<div class="ped-card-top"><span class="ped-local">' + esc(LOCAL_LABELS[p.local] || p.local) + '</span>' +
      '<span class="ped-estado" style="background:' + est.color + '22;color:' + est.color + '">' + esc(est.label) + '</span></div>' +
      '<div class="ped-card-sub">' + esc(sub) + '</div>' + itemsHtml + '</div>';
  }).join('');
}

window.abrirNuevoPedido = function() {
  const locs = pedLocalesPermitidos();
  if (!locs.length) return;
  PED_ACTUAL = { id: null, local: locs[0], estado: 'borrador', fecha_deseada: '', fecha_comprometida: '', observaciones_generales: '' };
  PED_ITEMS = [];
  showView('vPedidoEditor');
  renderEditorPedido();
};
window.abrirPedido = async function(id) {
  try {
    const r = await api('requerimientos?id=eq.' + id + '&select=*');
    if (!r || !r.length) { toast('No se encontr\u00f3 el pedido', 'error'); return; }
    PED_ACTUAL = r[0];
    PED_ITEMS = await api('requerimiento_items?requerimiento_id=eq.' + id + '&select=*&order=orden.asc') || [];
    showView('vPedidoEditor');
    renderEditorPedido();
  } catch (e) { toast('Error al abrir el pedido', 'error'); }
};
async function recargarPedidoActual() {
  const r = await api('requerimientos?id=eq.' + PED_ACTUAL.id + '&select=*');
  if (r && r.length) PED_ACTUAL = r[0];
  PED_ITEMS = await api('requerimiento_items?requerimiento_id=eq.' + PED_ACTUAL.id + '&select=*&order=orden.asc') || [];
}

function pedInsumoNombre(id) {
  const ins = PED_INSUMOS.find(x => x.id === id);
  return ins ? ins.nombre : ('Insumo #' + id);
}
function pedInsumoOptions(sel) {
  return '<option value="">\u2014 Eleg\u00ed un insumo \u2014</option>' +
    PED_INSUMOS.map(ins => '<option value="' + ins.id + '"' + (ins.id === sel ? ' selected' : '') + '>' + esc(ins.nombre) + '</option>').join('');
}
function pedUnidadOptions(sel) {
  const us = PED_UNIDADES.map(u => u.nombre);
  if (sel && us.indexOf(sel) === -1) us.unshift(sel);
  return '<option value="">\u2014 unidad \u2014</option>' +
    us.map(u => '<option value="' + esc(u) + '"' + (u === sel ? ' selected' : '') + '>' + esc(u) + '</option>').join('');
}

function renderItemPedido(it, i, editable, recepcion, completado) {
  if (editable) {
    return '<div class="ped-item" data-idx="' + i + '">' +
      '<div class="ped-item-head"><select class="ped-ins">' + pedInsumoOptions(it.ingrediente_id) + '</select>' +
      '<button class="ped-item-del" onclick="quitarItemPedido(' + i + ')" aria-label="Quitar"><i class="ti ti-trash"></i></button></div>' +
      '<div class="ped-item-row">' +
        '<input class="ped-cant" type="number" step="any" min="0" placeholder="Cantidad" value="' + (it.cantidad_pedida != null ? it.cantidad_pedida : '') + '">' +
        '<select class="ped-unidad">' + pedUnidadOptions(it.unidad) + '</select></div>' +
      '<div class="ped-item-row">' +
        '<input class="ped-stock" type="number" step="any" min="0" placeholder="Stock hoy (opc.)" value="' + (it.stock_actual != null ? it.stock_actual : '') + '">' +
        '<input class="ped-coment" type="text" placeholder="Comentario (opc.)" value="' + esc(it.comentario_pedido || '') + '"></div>' +
      '</div>';
  }
  if (recepcion || completado) {
    const recep = [['correcto', 'Recibido correcto'], ['observacion', 'Recibido con observación']];
    const er = it.estado_recepcion || '';
    const recibido = it.cantidad_recibida != null ? it.cantidad_recibida : '';
    const dis = completado ? ' disabled' : '';
    return '<div class="ped-item" data-idx="' + i + '" data-itemid="' + it.id + '">' +
      '<div class="ped-item-head"><strong>' + esc(pedInsumoNombre(it.ingrediente_id)) + '</strong></div>' +
      '<div class="ped-item-sub">Pedido: ' + fmtCant(it.cantidad_pedida || 0) + ' ' + esc(it.unidad || '') + '</div>' +
      '<div class="ped-item-row">' +
        '<input class="ped-recibido" type="number" step="any" min="0" placeholder="Recibido" value="' + recibido + '"' + dis + '>' +
        '<select class="ped-recep-estado"' + dis + '><option value="">\u2014 estado \u2014</option>' +
          recep.map(r => '<option value="' + r[0] + '"' + (er === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></div>' +
      '<input class="ped-recep-coment" type="text" placeholder="Comentario recepci\u00f3n (opc.)" value="' + esc(it.comentario_recepcion || '') + '"' + dis + '>' +
      '</div>';
  }
  return '<div class="ped-item" data-idx="' + i + '">' +
    '<div class="ped-item-head"><strong>' + esc(pedInsumoNombre(it.ingrediente_id)) + '</strong></div>' +
    '<div class="ped-item-sub">' + fmtCant(it.cantidad_pedida || 0) + ' ' + esc(it.unidad || '') + (it.comentario_pedido ? (' \u00b7 ' + esc(it.comentario_pedido)) : '') + '</div></div>';
}

function renderEditorPedido() {
  const p = PED_ACTUAL;
  const est = p.estado || 'borrador';
  const estInfo = PED_ESTADOS[est] || { label: est, color: '#8A8278' };
  const soyAdmin = isMaster() || isAdmin();
  const esNuevo = !p.id;
  const editable = (est === 'borrador');
  const recepcion = (est === 'confirmado');
  const completado = (est === 'completado');

  document.getElementById('pedEditorTitulo').textContent = esNuevo ? 'Nuevo pedido' : ('Pedido \u00b7 ' + (LOCAL_LABELS[p.local] || p.local));
  document.getElementById('pedEditorSub').innerHTML = '<span class="ped-estado" style="background:' + estInfo.color + '22;color:' + estInfo.color + '">' + esc(estInfo.label) + '</span>';

  let html = '<div class="ped-section">';
  if (esNuevo) {
    const locs = pedLocalesPermitidos();
    html += '<label class="field"><span class="field-label">Local</span><select id="pedLocal">' +
      locs.map(l => '<option value="' + esc(l) + '"' + (l === p.local ? ' selected' : '') + '>' + esc(LOCAL_LABELS[l] || l) + '</option>').join('') + '</select></label>';
  }
  const fd = p.fecha_deseada ? String(p.fecha_deseada).slice(0, 10) : '';
  if (editable) html += '<label class="field"><span class="field-label">Fecha que lo necesit\u00e1s</span><input type="date" id="pedFechaDeseada" value="' + fd + '"></label>';
  else if (fd) html += '<div class="ped-info"><span>Fecha deseada</span><strong>' + pedFecha(p.fecha_deseada) + '</strong></div>';

  const fc = p.fecha_comprometida ? String(p.fecha_comprometida).slice(0, 10) : '';
  if (soyAdmin && est === 'pendiente') html += '<label class="field"><span class="field-label">Fecha comprometida (entrega)</span><input type="date" id="pedFechaComprometida" value="' + fc + '"></label>';
  else if (fc) html += '<div class="ped-info"><span>Fecha comprometida</span><strong>' + pedFecha(p.fecha_comprometida) + '</strong></div>';

  const obs = p.observaciones_generales || '';
  if (editable || (soyAdmin && est === 'pendiente')) html += '<label class="field"><span class="field-label">Observaciones</span><textarea id="pedObs" rows="2" placeholder="Opcional">' + esc(obs) + '</textarea></label>';
  else if (obs) html += '<div class="ped-info"><span>Observaciones</span><strong>' + esc(obs) + '</strong></div>';
  html += '</div>';

  html += '<div class="ped-section"><div class="ped-section-title">Insumos</div>';
  if (!PED_ITEMS.length && !editable) html += '<div class="empty-list">Este pedido no tiene insumos.</div>';
  html += '<div id="pedItems">';
  PED_ITEMS.forEach((it, i) => { html += renderItemPedido(it, i, editable, recepcion, completado); });
  html += '</div>';
  if (editable) html += '<button class="btn-ghost" style="width:100%;margin-top:8px;" onclick="agregarItemPedido()"><i class="ti ti-plus"></i> Agregar insumo</button>';
  html += '</div>';

  if (recepcion) html += '<div class="ped-recep-hint">“Guardar sin cerrar” guarda lo que recibiste y deja el pedido abierto para seguir cargando más tarde. “Cerrar pedido (recibido)” lo da por recibido y finalizado (ya no se edita).</div>';
  html += '<div class="ped-actions">';
  if (editable) {
    html += '<button class="btn-ghost" onclick="guardarPedido(false)">Guardar borrador</button>';
    html += '<button class="btn-primary" onclick="guardarPedido(true)">Enviar pedido</button>';
    if (!esNuevo) html += '<button class="btn-ghost ped-danger" onclick="eliminarPedido()">Eliminar</button>';
  } else if (est === 'pendiente') {
    if (soyAdmin) {
      html += '<button class="btn-ghost" onclick="devolverPedido()">Devolver a borrador</button>';
      html += '<button class="btn-primary" onclick="confirmarPedido()">Confirmar</button>';
    } else {
      html += '<div class="ped-info" style="width:100%"><span>Estado</span><strong>Esperando confirmaci\u00f3n de un Admin</strong></div>';
    }
  } else if (recepcion) {
    html += '<button class="btn-ghost" onclick="guardarRecepcion(false)">Guardar sin cerrar</button>';
    html += '<button class="btn-primary" onclick="guardarRecepcion(true)">Cerrar pedido (recibido)</button>';
  }
  html += '</div>';

  document.getElementById('pedEditorBody').innerHTML = html;
}

function leerItemsDesdeDOM() {
  const cont = document.getElementById('pedItems');
  if (!cont) return;
  cont.querySelectorAll('.ped-item').forEach(b => {
    const idx = parseInt(b.dataset.idx, 10);
    if (isNaN(idx) || !PED_ITEMS[idx]) return;
    const insEl = b.querySelector('.ped-ins');
    if (insEl) {
      PED_ITEMS[idx].ingrediente_id = insEl.value ? parseInt(insEl.value, 10) : null;
      PED_ITEMS[idx].cantidad_pedida = b.querySelector('.ped-cant').value;
      PED_ITEMS[idx].unidad = b.querySelector('.ped-unidad').value;
      PED_ITEMS[idx].stock_actual = b.querySelector('.ped-stock').value;
      PED_ITEMS[idx].comentario_pedido = b.querySelector('.ped-coment').value;
    }
  });
}
function leerHeaderDesdeDOM() {
  const localEl = document.getElementById('pedLocal');
  if (localEl) PED_ACTUAL.local = localEl.value;
  const fdEl = document.getElementById('pedFechaDeseada');
  if (fdEl) PED_ACTUAL.fecha_deseada = fdEl.value || null;
  const obsEl = document.getElementById('pedObs');
  if (obsEl) PED_ACTUAL.observaciones_generales = obsEl.value.trim() || null;
}
window.agregarItemPedido = function() {
  leerItemsDesdeDOM();
  PED_ITEMS.push({ ingrediente_id: null, cantidad_pedida: '', unidad: '', stock_actual: '', comentario_pedido: '' });
  renderEditorPedido();
};
window.quitarItemPedido = function(i) {
  leerItemsDesdeDOM();
  PED_ITEMS.splice(i, 1);
  renderEditorPedido();
};

window.guardarPedido = async function(enviar) {
  leerHeaderDesdeDOM();
  leerItemsDesdeDOM();
  const validos = PED_ITEMS.filter(it => it.ingrediente_id && parseFloat(it.cantidad_pedida) > 0);
  if (enviar && !validos.length) { toast('Agreg\u00e1 al menos un insumo con cantidad', 'warning'); return; }
  try {
    if (!PED_ACTUAL.id) {
      const ins = await api('requerimientos', { method: 'POST', body: JSON.stringify({
        local: PED_ACTUAL.local, estado: 'borrador', fecha_creacion: hoyStr(),
        fecha_deseada: PED_ACTUAL.fecha_deseada || null,
        observaciones_generales: PED_ACTUAL.observaciones_generales || null
      })});
      PED_ACTUAL = Array.isArray(ins) ? ins[0] : ins;
    } else {
      await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({
        local: PED_ACTUAL.local, fecha_deseada: PED_ACTUAL.fecha_deseada || null,
        observaciones_generales: PED_ACTUAL.observaciones_generales || null,
        actualizado_en: new Date().toISOString()
      })});
    }
    await api('requerimiento_items?requerimiento_id=eq.' + PED_ACTUAL.id, { method: 'DELETE' });
    if (validos.length) {
      const payload = validos.map((it, i) => ({
        requerimiento_id: PED_ACTUAL.id, ingrediente_id: it.ingrediente_id,
        cantidad_pedida: parseFloat(it.cantidad_pedida) || 0, unidad: it.unidad || null,
        stock_actual: (it.stock_actual !== '' && it.stock_actual != null) ? (parseFloat(it.stock_actual) || 0) : null,
        comentario_pedido: it.comentario_pedido || null, orden: i
      }));
      await api('requerimiento_items', { method: 'POST', body: JSON.stringify(payload) });
    }
    if (enviar) {
      await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({ estado: 'pendiente', actualizado_en: new Date().toISOString() })});
      toast('\u2713 Pedido enviado', 'success');
      openMisPedidos();
    } else {
      toast('\u2713 Borrador guardado', 'success');
      await recargarPedidoActual();
      renderEditorPedido();
    }
  } catch (e) { toast('No se pudo guardar: ' + ((e && e.message) || e), 'error'); }
};

window.confirmarPedido = async function() {
  const fcEl = document.getElementById('pedFechaComprometida');
  const obsEl = document.getElementById('pedObs');
  try {
    await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({
      estado: 'confirmado', fecha_comprometida: (fcEl && fcEl.value) ? fcEl.value : null,
      observaciones_generales: obsEl ? (obsEl.value.trim() || null) : PED_ACTUAL.observaciones_generales,
      actualizado_en: new Date().toISOString()
    })});
    toast('\u2713 Pedido confirmado', 'success');
    openMisPedidos();
  } catch (e) { toast('No se pudo confirmar: ' + ((e && e.message) || e), 'error'); }
};
window.devolverPedido = async function() {
  const ok = await showConfirm({ title: 'Devolver a borrador', msg: 'El editor podr\u00e1 modificarlo de nuevo. \u00bfSeguimos?', okLabel: 'Devolver' });
  if (!ok) return;
  try {
    await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({ estado: 'borrador', actualizado_en: new Date().toISOString() })});
    toast('Pedido devuelto a borrador', 'success');
    openMisPedidos();
  } catch (e) { toast('No se pudo devolver', 'error'); }
};
window.guardarRecepcion = async function(cerrar) {
  const cont = document.getElementById('pedItems');
  const blocks = cont.querySelectorAll('.ped-item');
  try {
    for (const b of blocks) {
      const itemId = b.dataset.itemid;
      if (!itemId) continue;
      const rec = b.querySelector('.ped-recibido').value;
      const recibido = (rec !== '') ? (parseFloat(rec) || 0) : null;
      await api('requerimiento_items?id=eq.' + itemId, { method: 'PATCH', body: JSON.stringify({
        cantidad_recibida: recibido,
        estado_recepcion: b.querySelector('.ped-recep-estado').value || null,
        comentario_recepcion: b.querySelector('.ped-recep-coment').value.trim() || null,
        recibido_en: recibido != null ? new Date().toISOString() : null
      })});
    }
    if (cerrar) {
      await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({ estado: 'completado', actualizado_en: new Date().toISOString() })});
      toast('\u2713 Pedido recibido y cerrado', 'success');
      openMisPedidos();
    } else {
      toast('\u2713 Recepci\u00f3n guardada', 'success');
      await recargarPedidoActual();
      renderEditorPedido();
    }
  } catch (e) { toast('No se pudo guardar la recepci\u00f3n: ' + ((e && e.message) || e), 'error'); }
};
window.eliminarPedido = async function() {
  if (!PED_ACTUAL.id) { openMisPedidos(); return; }
  const ok = await showConfirm({ title: 'Eliminar pedido', msg: 'Se va a eliminar este borrador. \u00bfSeguro?', danger: true, okLabel: 'Eliminar' });
  if (!ok) return;
  try {
    await api('requerimientos?id=eq.' + PED_ACTUAL.id, { method: 'PATCH', body: JSON.stringify({ activo: false })});
    toast('Pedido eliminado', 'success');
    openMisPedidos();
  } catch (e) { toast('No se pudo eliminar', 'error'); }
};



// ---- Eliminar persona (Master/Admin): borra ficha + acceso de forma permanente ----
window.eliminarPersona = async function(empId, userId) {
  if (!isMaster() && !isAdmin()) return;
  const p = PERSONAS_CACHE.find(x => x.empleado && x.empleado.id === empId);
  const nombre = p ? p.nombreCompleto : 'esta persona';
  const ok = await showConfirm({
    title: 'Eliminar persona',
    msg: 'Vas a eliminar a ' + nombre + ' de forma permanente (ficha y acceso a la app). Esto NO se puede deshacer. Si la persona tiene turnos o propinas cargadas, el sistema no va a dejar borrarla: en ese caso us\u00e1 Desactivar.',
    danger: true, okLabel: 'Eliminar', cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  try {
    if (userId) await api('roster_usuarios?id=eq.' + userId, { method: 'DELETE' });
    await api('empleados?id=eq.' + empId, { method: 'DELETE' });
    ADMIN_EMPLEADOS_CACHE = (ADMIN_EMPLEADOS_CACHE || []).filter(e => e.id !== empId);
    if (userId) ADMIN_USUARIOS_CACHE = (ADMIN_USUARIOS_CACHE || []).filter(u => u.id !== userId);
    construirPersonas();
    renderPersonal();
    toast('Persona eliminada', 'success');
  } catch (e) {
    toast('No se pudo eliminar (puede tener turnos o propinas asociadas). Prob\u00e1 con Desactivar.', 'error');
    try { openPersonal(); } catch (_) {}
  }
};


// ============================================
// MI STOCK (stock_articulos + stock_conteos)
// ============================================
function puedeGestionarStock() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_stock === true);
}
function stockLocalesPermitidos() {
  const activos = getLocalesActivos();
  if (isMaster() || isAdmin()) return activos;
  const mios = (currentUser && currentUser.locales_asignados) || [];
  return activos.filter(l => mios.indexOf(l) !== -1);
}
let STOCK_TAB = 'cargar', STOCK_LOCAL = '';
let STOCK_ARTICULOS = [], STOCK_CONTEOS_LOCAL = {}, STOCK_ART_EDIT = null;

async function openMiStock() {
  if (!puedeGestionarStock()) { showDashboard(); return; }
  showView('vMiStock');
  const esAdmin = isMaster() || isAdmin();
  document.getElementById('stockTabs').style.display = esAdmin ? 'flex' : 'none';
  STOCK_TAB = 'cargar';
  document.querySelectorAll('#stockTabs .stock-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'cargar'));
  const locs = stockLocalesPermitidos();
  STOCK_LOCAL = locs.length ? locs[0] : '';
  await cargarStockArticulos();
  stockRender();
}
async function cargarStockArticulos() {
  try { STOCK_ARTICULOS = await api('stock_articulos?select=*&order=nombre.asc') || []; }
  catch (e) { STOCK_ARTICULOS = []; console.warn('stock articulos:', e); }
}
async function cargarConteosLocal(local) {
  STOCK_CONTEOS_LOCAL = {};
  try {
    const rows = await api('stock_conteos?local=eq.' + encodeURIComponent(local) + '&select=*&order=fecha.desc') || [];
    rows.forEach(r => {
      if (!STOCK_CONTEOS_LOCAL[r.articulo_id]) STOCK_CONTEOS_LOCAL[r.articulo_id] = [];
      STOCK_CONTEOS_LOCAL[r.articulo_id].push(r);
    });
  } catch (e) { console.warn('conteos:', e); }
}
window.stockCambiarTab = function(tab) {
  STOCK_TAB = tab;
  document.querySelectorAll('#stockTabs .stock-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  stockRender();
};
window.stockOnChangeLocal = function() {
  STOCK_LOCAL = document.getElementById('stockLocalSel').value;
  if (STOCK_TAB === 'reportes' && (isMaster() || isAdmin())) stockRenderReportes();
  else stockRenderCargar();
};
function stockRender() {
  const tab = (isMaster() || isAdmin()) ? STOCK_TAB : 'cargar';
  if (tab === 'articulos') stockRenderArticulos();
  else if (tab === 'reportes') stockRenderReportes();
  else stockRenderCargar();
}

// ---- CARGAR (editor y admin) ----
async function stockRenderCargar() {
  const body = document.getElementById('stockBody');
  const locs = stockLocalesPermitidos();
  if (!locs.length) { body.innerHTML = '<div class="empty-list">No ten\u00e9s locales asignados.</div>'; return; }
  if (locs.indexOf(STOCK_LOCAL) === -1) STOCK_LOCAL = locs[0];
  body.innerHTML = '<label class="field"><span class="field-label">Local</span><select id="stockLocalSel" onchange="stockOnChangeLocal()">' +
    locs.map(l => '<option value="' + esc(l) + '"' + (l === STOCK_LOCAL ? ' selected' : '') + '>' + esc(LOCAL_LABELS[l] || l) + '</option>').join('') +
    '</select></label><div id="stockCargarLista"><div class="loading">Cargando...</div></div>';
  await cargarConteosLocal(STOCK_LOCAL);
  stockRenderCargarLista();
}
function stockRenderCargarLista() {
  const cont = document.getElementById('stockCargarLista');
  if (!cont) return;
  const arts = STOCK_ARTICULOS.filter(a => a.activo && (a.locales || []).indexOf(STOCK_LOCAL) !== -1);
  if (!arts.length) { cont.innerHTML = '<div class="empty-list">No hay art\u00edculos asignados a este local todav\u00eda.</div>'; return; }
  cont.innerHTML = arts.map(a => {
    const hist = STOCK_CONTEOS_LOCAL[a.id] || [];
    const ult = hist.length ? hist[0] : null;
    const ultTxt = ult ? (fmtCant(ult.cantidad) + (a.unidad ? ' ' + esc(a.unidad) : '') + ' \u00b7 ' + pedFecha(ult.fecha)) : 'Sin registros previos';
    return '<div class="stock-art" data-art="' + a.id + '" data-ult="' + (ult ? ult.cantidad : '') + '">' +
      '<div class="stock-art-head"><span class="stock-art-nom">' + esc(a.nombre) + '</span></div>' +
      '<div class="stock-art-ult">\u00daltimo: ' + ultTxt + '</div>' +
      '<div class="stock-art-row">' +
        '<input class="stock-art-input" type="number" step="any" min="0" placeholder="Stock actual' + (a.unidad ? ' (' + esc(a.unidad) + ')' : '') + '" oninput="stockCalcDiff(this)">' +
        '<span class="stock-art-diff"></span></div>' +
      '<input class="stock-art-coment" type="text" placeholder="Comentario (opcional)">' +
      '</div>';
  }).join('') +
    '<button class="btn-primary" style="width:100%;margin-top:8px;" onclick="guardarStockConteos()"><i class="ti ti-device-floppy"></i> Guardar stock</button>';
}
window.stockCalcDiff = function(input) {
  const block = input.closest('.stock-art');
  const diffEl = block.querySelector('.stock-art-diff');
  const ult = parseFloat(block.dataset.ult);
  const val = parseFloat(input.value);
  if (isNaN(val) || isNaN(ult)) { diffEl.textContent = ''; diffEl.className = 'stock-art-diff'; return; }
  if (ult === 0) { diffEl.textContent = ''; diffEl.className = 'stock-art-diff'; return; }
  const pct = ((val - ult) / ult) * 100;
  diffEl.textContent = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
  diffEl.className = 'stock-art-diff ' + (pct < 0 ? 'baja' : (pct > 0 ? 'sube' : ''));
};
window.guardarStockConteos = async function() {
  const blocks = document.querySelectorAll('#stockCargarLista .stock-art');
  const payload = [];
  blocks.forEach(b => {
    const val = b.querySelector('.stock-art-input').value;
    if (val === '' || isNaN(parseFloat(val))) return;
    payload.push({
      articulo_id: parseInt(b.dataset.art, 10),
      local: STOCK_LOCAL,
      cantidad: parseFloat(val),
      comentario: b.querySelector('.stock-art-coment').value.trim() || null,
      editor_id: currentUser ? currentUser.id : null
    });
  });
  if (!payload.length) { toast('Carg\u00e1 al menos un stock', 'warning'); return; }
  try {
    await api('stock_conteos', { method: 'POST', body: JSON.stringify(payload) });
    toast('\u2713 Stock guardado', 'success');
    await cargarConteosLocal(STOCK_LOCAL);
    stockRenderCargarLista();
  } catch (e) { toast('No se pudo guardar: ' + ((e && e.message) || e), 'error'); }
};

// ---- ARTÍCULOS (admin) ----
function stockRenderArticulos() {
  const body = document.getElementById('stockBody');
  let html = '<button class="btn-primary" style="width:100%;margin-bottom:14px;" onclick="abrirNuevoStockArticulo()"><i class="ti ti-plus"></i> Nuevo art\u00edculo</button>';
  if (!STOCK_ARTICULOS.length) { body.innerHTML = html + '<div class="empty-list">Todav\u00eda no hay art\u00edculos. Cre\u00e1 el primero.</div>'; return; }
  html += STOCK_ARTICULOS.map(a => {
    const locs = (a.locales || []).map(l => LOCAL_LABELS[l] || l).join(', ') || 'Sin locales asignados';
    const inact = a.activo ? '' : ' <span style="color:var(--c-muted);font-weight:400;font-size:11px;">(inactivo)</span>';
    return '<div class="ped-card" onclick="abrirEditarStockArticulo(' + a.id + ')"' + (a.activo ? '' : ' style="opacity:.55;"') + '>' +
      '<div class="ped-card-top"><span class="ped-local">' + esc(a.nombre) + inact + '</span>' +
      (a.unidad ? '<span style="font-size:11px;color:var(--c-muted);">' + esc(a.unidad) + '</span>' : '') + '</div>' +
      '<div class="ped-card-sub">' + esc(locs) + '</div></div>';
  }).join('');
  body.innerHTML = html;
}
const STOCK_UNIDADES = ['unidad', 'litros', 'kilos'];
function stockUnidadOptions(sel) {
  const us = STOCK_UNIDADES.slice();
  if (sel && us.indexOf(sel) === -1) us.unshift(sel);
  return us.map(u => '<option value="' + esc(u) + '"' + (u === sel ? ' selected' : '') + '>' + esc(u) + '</option>').join('');
}
window.abrirNuevoStockArticulo = function() {
  STOCK_ART_EDIT = null;
  document.getElementById('stockArtTitulo').textContent = 'Nuevo art\u00edculo';
  document.getElementById('saNombre').value = '';
  document.getElementById('saUnidad').innerHTML = stockUnidadOptions('unidad');
  document.getElementById('saActivo').checked = true;
  stockLlenarLocalesGrid([]);
  document.getElementById('saError').textContent = '';
  document.getElementById('modalStockArticulo').classList.add('show');
};
window.abrirEditarStockArticulo = function(id) {
  const a = STOCK_ARTICULOS.find(x => x.id === id);
  if (!a) return;
  STOCK_ART_EDIT = id;
  document.getElementById('stockArtTitulo').textContent = 'Editar art\u00edculo';
  document.getElementById('saNombre').value = a.nombre || '';
  document.getElementById('saUnidad').innerHTML = stockUnidadOptions(a.unidad || 'unidad');
  document.getElementById('saActivo').checked = !!a.activo;
  stockLlenarLocalesGrid(a.locales || []);
  document.getElementById('saError').textContent = '';
  document.getElementById('modalStockArticulo').classList.add('show');
};
function stockLlenarLocalesGrid(sel) {
  document.getElementById('saLocalesGrid').innerHTML = getLocalesActivos().map(loc => {
    const on = sel.indexOf(loc) !== -1;
    return '<label class="local-check' + (on ? ' activo' : '') + '" data-local="' + esc(loc) + '"><input type="checkbox" ' + (on ? 'checked' : '') + '>' + esc(LOCAL_LABELS[loc] || loc) + '</label>';
  }).join('');
  document.querySelectorAll('#saLocalesGrid .local-check').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); el.classList.toggle('activo'); el.querySelector('input').checked = el.classList.contains('activo'); });
  });
}
window.closeStockArticulo = function() { document.getElementById('modalStockArticulo').classList.remove('show'); };
window.guardarStockArticulo = async function() {
  const err = document.getElementById('saError'); err.textContent = '';
  const nombre = document.getElementById('saNombre').value.trim();
  if (!nombre) { err.textContent = 'Pon\u00e9 un nombre.'; return; }
  const locales = Array.from(document.querySelectorAll('#saLocalesGrid .local-check.activo')).map(el => el.dataset.local);
  const payload = {
    nombre: nombre,
    unidad: document.getElementById('saUnidad').value.trim() || null,
    locales: locales,
    activo: document.getElementById('saActivo').checked
  };
  const btn = document.getElementById('saGuardarBtn');
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Guardando...';
  try {
    if (STOCK_ART_EDIT) {
      await api('stock_articulos?id=eq.' + STOCK_ART_EDIT, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      payload.creado_por = currentUser ? currentUser.id : null;
      await api('stock_articulos', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeStockArticulo();
    await cargarStockArticulos();
    stockRender();
    toast('\u2713 Art\u00edculo guardado', 'success');
  } catch (e) { err.textContent = 'No se pudo guardar: ' + ((e && e.message) || e); }
  finally { btn.disabled = false; btn.textContent = t; }
};

// ---- REPORTES (admin) ----
async function stockRenderReportes() {
  const body = document.getElementById('stockBody');
  const locs = stockLocalesPermitidos();
  if (!locs.length) { body.innerHTML = '<div class="empty-list">No hay locales.</div>'; return; }
  if (locs.indexOf(STOCK_LOCAL) === -1) STOCK_LOCAL = locs[0];
  body.innerHTML = '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;">' +
    '<label class="field" style="flex:1;"><span class="field-label">Local</span><select id="stockLocalSel" onchange="stockOnChangeLocal()">' +
    locs.map(l => '<option value="' + esc(l) + '"' + (l === STOCK_LOCAL ? ' selected' : '') + '>' + esc(LOCAL_LABELS[l] || l) + '</option>').join('') +
    '</select></label>' +
    '<button class="btn-ghost" onclick="stockDescargarReporte()"><i class="ti ti-download"></i> Excel</button></div>' +
    '<div id="stockReporteLista"><div class="loading">Cargando...</div></div>';
  await cargarConteosLocal(STOCK_LOCAL);
  stockRenderReporteLista();
}
function stockRenderReporteLista() {
  const cont = document.getElementById('stockReporteLista');
  if (!cont) return;
  const arts = STOCK_ARTICULOS.filter(a => (a.locales || []).indexOf(STOCK_LOCAL) !== -1);
  if (!arts.length) { cont.innerHTML = '<div class="empty-list">No hay art\u00edculos asignados a este local.</div>'; return; }
  cont.innerHTML = arts.map(a => {
    const hist = STOCK_CONTEOS_LOCAL[a.id] || [];
    const ult = hist.length ? hist[0] : null;
    const prev = hist.length > 1 ? hist[1] : null;
    let diff = '';
    if (ult && prev && parseFloat(prev.cantidad) !== 0) {
      const pct = ((ult.cantidad - prev.cantidad) / prev.cantidad) * 100;
      diff = '<span class="stock-art-diff ' + (pct < 0 ? 'baja' : (pct > 0 ? 'sube' : '')) + '">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</span>';
    }
    const inact = a.activo ? '' : ' (inactivo)';
    return '<div class="stock-rep"><div class="stock-rep-top"><span class="stock-art-nom">' + esc(a.nombre) + esc(inact) + '</span>' + diff + '</div>' +
      '<div class="stock-rep-sub">' + (ult ? (fmtCant(ult.cantidad) + (a.unidad ? ' ' + esc(a.unidad) : '') + ' \u00b7 ' + pedFecha(ult.fecha)) : 'Sin registros') + '</div></div>';
  }).join('');
}
window.stockDescargarReporte = function() {
  const arts = STOCK_ARTICULOS.filter(a => (a.locales || []).indexOf(STOCK_LOCAL) !== -1);
  const filas = arts.map(a => {
    const hist = STOCK_CONTEOS_LOCAL[a.id] || [];
    const ult = hist.length ? hist[0] : null;
    return {
      'Art\u00edculo': a.nombre,
      'Unidad': a.unidad || '',
      '\u00daltimo stock': ult ? ult.cantidad : '',
      'Fecha': ult ? pedFecha(ult.fecha) : '',
      'Activo': a.activo ? 'S\u00ed' : 'No'
    };
  });
  exportarAExcel('stock_' + STOCK_LOCAL + '_' + hoyStr(), [{ nombre: 'Stock', filas: filas }]);
};



// ============================================
// MIS CIERRES (cierres_caja)
// ============================================
function puedeGestionarCierres() {
  return isMaster() || isAdmin() || (currentUser && currentUser.editor_cierres === true);
}
function puedeEditarCierres() { return isMaster() || isAdmin(); }
function cierresLocalesPermitidos() {
  const activos = getLocalesActivos();
  if (isMaster() || isAdmin()) return activos;
  const mios = (currentUser && currentUser.locales_asignados) || [];
  return activos.filter(l => mios.indexOf(l) !== -1);
}
const CIERRE_CAJA_TURNOS = [['mediodia', 'Mediod\u00eda'], ['noche', 'Noche'], ['evento', 'Evento'], ['especial', 'Especial']];
function ccTurnoLabel(t) { const f = CIERRE_CAJA_TURNOS.find(x => x[0] === t); return f ? f[1] : (t || '\u2014'); }

let CC_LOCAL_FILTRO = '', CC_LISTA = [], CC_EDIT = null;

async function openMisCierres() {
  if (!puedeGestionarCierres()) { showDashboard(); return; }
  showView('vMisCierres');
  const locs = cierresLocalesPermitidos();
  document.getElementById('ccLocalFiltro').innerHTML = '<option value="">Todos mis locales</option>' +
    locs.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
  document.getElementById('ccNuevoBtn').style.display = locs.length ? '' : 'none';
  await cargarCierres();
}
window.onFiltroCierres = function() {
  CC_LOCAL_FILTRO = document.getElementById('ccLocalFiltro').value;
  cargarCierres();
};
async function cargarCierres() {
  const lista = document.getElementById('cierresLista');
  lista.innerHTML = '<div class="loading">Cargando...</div>';
  const locs = cierresLocalesPermitidos();
  try {
    let q = 'cierres_caja?select=*&order=fecha.desc,id.desc&limit=300';
    if (CC_LOCAL_FILTRO) q += '&local=eq.' + encodeURIComponent(CC_LOCAL_FILTRO);
    else if (!isMaster() && !isAdmin()) {
      if (!locs.length) { lista.innerHTML = '<div class="empty-list">No ten\u00e9s locales asignados.</div>'; return; }
      q += '&local=in.(' + locs.map(encodeURIComponent).join(',') + ')';
    }
    CC_LISTA = await api(q) || [];
    renderCierres();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">No se pudieron cargar los cierres.<br><span style="font-size:11px;opacity:.7">' + esc(String((e && e.message) || e)) + '</span></div>';
  }
}
function renderCierres() {
  const lista = document.getElementById('cierresLista');
  if (!CC_LISTA.length) { lista.innerHTML = '<div class="empty-list">No hay cierres cargados todav\u00eda.</div>'; return; }
  const puedeEd = puedeEditarCierres();
  lista.innerHTML = CC_LISTA.map(c => {
    const prom = (c.pax && c.pax > 0) ? (c.ventas_total / c.pax) : null;
    const click = puedeEd ? ' onclick="abrirEditarCierreCaja(' + c.id + ')" style="cursor:pointer"' : '';
    return '<div class="ped-card"' + click + '>' +
      '<div class="ped-card-top"><span class="ped-local">' + esc(LOCAL_LABELS[c.local] || c.local) + '</span>' +
      '<span class="cc-venta">$' + formatNumber(c.ventas_total || 0) + '</span></div>' +
      '<div class="ped-card-sub">' + pedFecha(c.fecha) + ' \u00b7 ' + esc(ccTurnoLabel(c.turno)) + ' \u00b7 ' + (c.pax || 0) + ' pax' +
      (prom != null ? (' \u00b7 $' + formatNumber(prom) + '/pax') : '') + '</div></div>';
  }).join('');
}

window.abrirNuevoCierreCaja = function() {
  const locs = cierresLocalesPermitidos();
  if (!locs.length) return;
  CC_EDIT = null;
  document.getElementById('ccModalTitulo').textContent = 'Nuevo cierre';
  document.getElementById('ccLocal').innerHTML = locs.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
  document.getElementById('ccLocal').disabled = false;
  document.getElementById('ccFecha').value = hoyStr();
  document.getElementById('ccTurno').innerHTML = CIERRE_CAJA_TURNOS.map(t => '<option value="' + t[0] + '"' + (t[0] === 'noche' ? ' selected' : '') + '>' + t[1] + '</option>').join('');
  document.getElementById('ccVentas').value = '';
  document.getElementById('ccPax').value = '';
  document.getElementById('ccObs').value = '';
  document.getElementById('ccProm').textContent = '';
  document.getElementById('ccError').textContent = '';
  document.getElementById('ccBorrarBtn').style.display = 'none';
  document.getElementById('modalCierreCaja').classList.add('show');
};
window.abrirEditarCierreCaja = function(id) {
  if (!puedeEditarCierres()) return;
  const c = CC_LISTA.find(x => x.id === id);
  if (!c) return;
  CC_EDIT = id;
  document.getElementById('ccModalTitulo').textContent = 'Editar cierre';
  document.getElementById('ccLocal').innerHTML = '<option value="' + esc(c.local) + '">' + esc(LOCAL_LABELS[c.local] || c.local) + '</option>';
  document.getElementById('ccLocal').disabled = true;
  document.getElementById('ccFecha').value = c.fecha ? String(c.fecha).slice(0, 10) : hoyStr();
  document.getElementById('ccTurno').innerHTML = CIERRE_CAJA_TURNOS.map(t => '<option value="' + t[0] + '"' + (t[0] === c.turno ? ' selected' : '') + '>' + t[1] + '</option>').join('');
  document.getElementById('ccVentas').value = c.ventas_total != null ? c.ventas_total : '';
  document.getElementById('ccPax').value = c.pax != null ? c.pax : '';
  document.getElementById('ccObs').value = c.observaciones || '';
  ccCalcProm();
  document.getElementById('ccError').textContent = '';
  document.getElementById('ccBorrarBtn').style.display = (isMaster() || isAdmin()) ? '' : 'none';
  document.getElementById('modalCierreCaja').classList.add('show');
};
window.closeCierreCaja = function() { document.getElementById('modalCierreCaja').classList.remove('show'); };
window.ccCalcProm = function() {
  const v = parseFloat(document.getElementById('ccVentas').value);
  const p = parseInt(document.getElementById('ccPax').value, 10);
  const el = document.getElementById('ccProm');
  if (!isNaN(v) && !isNaN(p) && p > 0) el.textContent = 'Promedio por pax: $' + formatNumber(v / p);
  else el.textContent = '';
};
window.guardarCierreCaja = async function() {
  const err = document.getElementById('ccError'); err.textContent = '';
  const local = document.getElementById('ccLocal').value;
  const fecha = document.getElementById('ccFecha').value;
  const turno = document.getElementById('ccTurno').value;
  const ventas = parseFloat(document.getElementById('ccVentas').value);
  const pax = parseInt(document.getElementById('ccPax').value, 10);
  if (!local) { err.textContent = 'Eleg\u00ed un local.'; return; }
  if (!fecha) { err.textContent = 'Eleg\u00ed la fecha.'; return; }
  if (isNaN(ventas) || ventas < 0) { err.textContent = 'Carg\u00e1 las ventas totales.'; return; }
  if (isNaN(pax) || pax < 0) { err.textContent = 'Carg\u00e1 la cantidad de pax.'; return; }
  const payload = { local: local, fecha: fecha, turno: turno, ventas_total: ventas, pax: pax, observaciones: document.getElementById('ccObs').value.trim() || null };
  const btn = document.getElementById('ccGuardarBtn'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Guardando...';
  try {
    if (CC_EDIT) {
      await api('cierres_caja?id=eq.' + CC_EDIT, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      const dup = await api('cierres_caja?local=eq.' + encodeURIComponent(local) + '&fecha=eq.' + fecha + '&turno=eq.' + turno + '&select=id') || [];
      if (dup.length) { err.textContent = 'Ya hay un cierre para ese local, fecha y turno. Si hay que corregirlo, ped\u00edselo a un Admin.'; btn.disabled = false; btn.textContent = t; return; }
      payload.creado_por = currentUser ? currentUser.id : null;
      await api('cierres_caja', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeCierreCaja();
    await cargarCierres();
    toast('\u2713 Cierre guardado', 'success');
  } catch (e) { err.textContent = 'No se pudo guardar: ' + ((e && e.message) || e); }
  finally { btn.disabled = false; btn.textContent = t; }
};
window.borrarCierreCaja = async function() {
  if (!CC_EDIT || !(isMaster() || isAdmin())) return;
  const ok = await showConfirm({ title: 'Eliminar cierre', msg: 'Se va a eliminar este cierre de caja. \u00bfSeguro?', danger: true, okLabel: 'Eliminar' });
  if (!ok) return;
  try {
    await api('cierres_caja?id=eq.' + CC_EDIT, { method: 'DELETE' });
    closeCierreCaja();
    await cargarCierres();
    toast('Cierre eliminado', 'success');
  } catch (e) { toast('No se pudo eliminar', 'error'); }
};



// ============================================
// GESTIÓN DE INCIDENCIAS (editor_rosters / admin)
// ============================================
let GI_ESTADO = 'pendiente', GI_LISTA = [], GI_EDIT = null;
const GI_ESTADOS = {
  pendiente: { label: '\u23f3 Pendiente', cls: 'pendiente' },
  aprobado:  { label: '\u2713 Aceptada', cls: 'aprobado' },
  rechazado: { label: '\u2717 Rechazada', cls: 'rechazado' }
};
function incLocalesPermitidos() {
  if (isMaster() || isAdmin()) return null; // null = ve todos
  const mios = (currentUser && currentUser.locales_asignados) || [];
  return getLocalesActivos().filter(l => mios.indexOf(l) !== -1);
}
function incEmpNombre(emp) {
  if (!emp) return 'Colaborador';
  const ap = emp.apellido || '';
  const pn = emp.nombre_p || emp.nombre || '';
  return ((ap ? ap + ', ' : '') + pn).trim() || 'Colaborador';
}
async function openGestionIncidencias() {
  if (!puedeGestionarRosters()) { showDashboard(); return; }
  showView('vGestionIncidencias');
  document.getElementById('giEstadoFiltro').value = GI_ESTADO;
  await cargarIncidencias();
}
window.onFiltroIncidencias = function() {
  GI_ESTADO = document.getElementById('giEstadoFiltro').value;
  cargarIncidencias();
};
async function cargarIncidencias() {
  const lista = document.getElementById('incidenciasLista');
  lista.innerHTML = '<div class="loading">Cargando...</div>';
  try {
    let q = 'incidencias?select=*&order=fecha.desc,id.desc&limit=300';
    if (GI_ESTADO) q += '&estado=eq.' + GI_ESTADO;
    let data = await api(q) || [];
    const _eids = Array.from(new Set(data.map(i => i.empleado_id).filter(Boolean)));
    let _emap = {};
    if (_eids.length) {
      const _emps = await api('empleados?id=in.(' + _eids.join(',') + ')&select=id,nombre,nombre_p,apellido,local') || [];
      _emps.forEach(e => { _emap[e.id] = e; });
    }
    data.forEach(i => { i.empleado = _emap[i.empleado_id] || null; });
    const permit = incLocalesPermitidos();
    if (permit) data = data.filter(i => i.empleado && permit.indexOf(i.empleado.local) !== -1);
    GI_LISTA = data;
    renderIncidencias();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">No se pudieron cargar las incidencias.<br><span style="font-size:11px;opacity:.7">' + esc(String((e && e.message) || e)) + '</span></div>';
  }
}
function renderIncidencias() {
  const lista = document.getElementById('incidenciasLista');
  if (!GI_LISTA.length) { lista.innerHTML = '<div class="empty-list">No hay incidencias con ese criterio.</div>'; return; }
  lista.innerHTML = GI_LISTA.map(i => {
    const est = GI_ESTADOS[i.estado] || GI_ESTADOS.pendiente;
    const tipo = TIPOS_INCIDENCIA[i.tipo] || i.tipo || '';
    const loc = i.empleado ? (LOCAL_LABELS[i.empleado.local] || i.empleado.local || '') : '';
    const resp = i.respuesta ? '<div class="inc-resp"><strong>Respuesta:</strong> ' + esc(i.respuesta) + '</div>' : '';
    const acciones = (i.estado === 'pendiente')
      ? '<div class="inc-acciones"><button class="btn-ghost inc-ok" onclick="abrirResolverIncidencia(' + i.id + ')"><i class="ti ti-message-reply"></i> Responder</button></div>'
      : '';
    return '<div class="ped-card" style="cursor:default">' +
      '<div class="ped-card-top"><span class="ped-local">' + esc(incEmpNombre(i.empleado)) + '</span>' +
      '<span class="det-badge ' + est.cls + '">' + est.label + '</span></div>' +
      '<div class="ped-card-sub">' + esc(tipo) + ' \u00b7 ' + fmtFechaCorta(i.fecha) + (loc ? (' \u00b7 ' + esc(loc)) : '') + '</div>' +
      '<div class="inc-desc">' + esc(i.descripcion || '') + '</div>' +
      resp + acciones + '</div>';
  }).join('');
}
window.abrirResolverIncidencia = function(id) {
  const i = GI_LISTA.find(x => x.id === id);
  if (!i) return;
  GI_EDIT = id;
  document.getElementById('giResTitulo').textContent = TIPOS_INCIDENCIA[i.tipo] || 'Incidencia';
  document.getElementById('giResInfo').innerHTML =
    '<div class="ped-card-sub">' + esc(incEmpNombre(i.empleado)) + ' \u00b7 ' + fmtFechaCorta(i.fecha) + '</div>' +
    '<div class="inc-desc">' + esc(i.descripcion || '') + '</div>';
  document.getElementById('giResComent').value = i.respuesta || '';
  document.getElementById('giResError').textContent = '';
  document.getElementById('modalResolverInc').classList.add('show');
};
window.closeResolverInc = function() { document.getElementById('modalResolverInc').classList.remove('show'); };
async function resolverIncidencia(estado) {
  if (!GI_EDIT) return;
  const coment = document.getElementById('giResComent').value.trim() || null;
  const err = document.getElementById('giResError'); err.textContent = '';
  const payload = { estado: estado, respuesta: coment, revisado_por: currentUser ? currentUser.id : null, revisado_en: new Date().toISOString() };
  try {
    await api('incidencias?id=eq.' + GI_EDIT, { method: 'PATCH', body: JSON.stringify(payload) });
    closeResolverInc();
    await cargarIncidencias();
    toast(estado === 'aprobado' ? '\u2713 Incidencia aceptada' : 'Incidencia rechazada', estado === 'aprobado' ? 'success' : 'warning');
  } catch (e) { err.textContent = 'No se pudo guardar: ' + ((e && e.message) || e); }
}
window.aceptarIncidencia = function() { resolverIncidencia('aprobado'); };
window.rechazarIncidencia = function() { resolverIncidencia('rechazado'); };



// ============================================
// MIS ESTADÍSTICAS (Master / Admin)
// ============================================
let EST_MES = '', EST_LOCAL = '';

function openMisEstadisticas() {
  if (!isMaster() && !isAdmin()) { showDashboard(); return; }
  showView('vMisEstadisticas');
  poblarFiltrosEst();
  cargarEstadisticas();
}
window.openMisEstadisticas = openMisEstadisticas;

function poblarFiltrosEst() {
  const selMes   = document.getElementById('estMes');
  const selLocal = document.getElementById('estLocal');
  const hoy = new Date();
  if (!EST_MES) {
    EST_MES = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  }
  const opsMes = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = MESES_CORTO[d.getMonth()] + ' ' + d.getFullYear();
    opsMes.push('<option value="' + val + '"' + (val === EST_MES ? ' selected' : '') + '>' + label + '</option>');
  }
  selMes.innerHTML = opsMes.join('');
  const locales = getLocalesActivos().filter(function(l) { return !/transversal/i.test(l); });
  selLocal.innerHTML = '<option value="">Todos los locales</option>' +
    locales.map(function(l) {
      return '<option value="' + esc(l) + '"' + (l === EST_LOCAL ? ' selected' : '') + '>' + esc(localLabel(l)) + '</option>';
    }).join('');
}

window.onFiltroEst = function() {
  EST_MES   = document.getElementById('estMes').value;
  EST_LOCAL = document.getElementById('estLocal').value;
  cargarEstadisticas();
};

async function cargarEstadisticas() {
  const elRes  = document.getElementById('estResumen');
  const elList = document.getElementById('estLista');
  elRes.innerHTML  = '<div class="loading">Cargando estadísticas...</div>';
  elList.innerHTML = '';
  try {
    let q = 'cierres_caja?select=*&order=fecha.desc,id.desc';
    if (EST_MES) {
      const parts = EST_MES.split('-');
      const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
      const lastDay = new Date(y, m, 0).getDate();
      q += '&fecha=gte.' + EST_MES + '-01&fecha=lte.' + EST_MES + '-' + String(lastDay).padStart(2, '0');
    }
    if (EST_LOCAL) {
      q += '&local=eq.' + encodeURIComponent(EST_LOCAL);
    }
    const data = await api(q) || [];
    renderEstadisticas(data);
  } catch (e) {
    elRes.innerHTML  = '<div class="empty-list" style="color:var(--c-error)">No se pudieron cargar los datos.<br><span style="font-size:11px;opacity:.7">' + esc(String((e && e.message) || e)) + '</span></div>';
    elList.innerHTML = '';
  }
}

function renderEstadisticas(data) {
  const elRes  = document.getElementById('estResumen');
  const elList = document.getElementById('estLista');

  if (!data.length) {
    elRes.innerHTML  = '<div class="empty-list">No hay cierres para este período.</div>';
    elList.innerHTML = '';
    return;
  }

  const totalVentas = data.reduce(function(s, c) { return s + (parseFloat(c.ventas_total) || 0); }, 0);
  const totalPax    = data.reduce(function(s, c) { return s + (parseInt(c.pax, 10) || 0); }, 0);
  const promGlobal  = totalPax > 0 ? totalVentas / totalPax : null;

  elRes.innerHTML =
    '<div class="est-cards">' +
      '<div class="est-card"><div class="est-card-label">Ventas totales</div><div class="est-card-valor">$' + formatNumber(totalVentas) + '</div></div>' +
      '<div class="est-card"><div class="est-card-label">Pax total</div><div class="est-card-valor">' + formatNumber(totalPax) + '</div></div>' +
      '<div class="est-card"><div class="est-card-label">Prom. por pax</div><div class="est-card-valor">' + (promGlobal != null ? '$' + formatNumber(promGlobal) : '—') + '</div></div>' +
      '<div class="est-card"><div class="est-card-label">Turnos</div><div class="est-card-valor">' + data.length + '</div></div>' +
    '</div>';

  let html = '';

  if (!EST_LOCAL) {
    const porLocal = {};
    data.forEach(function(c) {
      if (!porLocal[c.local]) porLocal[c.local] = { ventas: 0, pax: 0 };
      porLocal[c.local].ventas += parseFloat(c.ventas_total) || 0;
      porLocal[c.local].pax    += parseInt(c.pax, 10) || 0;
    });
    const locs = Object.keys(porLocal).sort(function(a, b) { return porLocal[b].ventas - porLocal[a].ventas; });
    html += '<div class="est-section-title">Por local</div>' +
      '<div class="est-tabla">' +
        '<div class="est-tabla-head"><span>Local</span><span>Ventas</span><span>Pax</span><span>Prom/pax</span></div>' +
        locs.map(function(loc) {
          const r = porLocal[loc];
          const pr = r.pax > 0 ? r.ventas / r.pax : null;
          return '<div class="est-tabla-fila">' +
            '<span>' + esc(localLabel(loc)) + '</span>' +
            '<span>$' + formatNumber(r.ventas) + '</span>' +
            '<span>' + formatNumber(r.pax) + '</span>' +
            '<span>' + (pr != null ? '$' + formatNumber(pr) : '—') + '</span>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  html += '<div class="est-section-title">Cierres del período</div>' +
    data.map(function(c) {
      const prom = (c.pax && c.pax > 0) ? c.ventas_total / c.pax : null;
      return '<div class="ped-card">' +
        '<div class="ped-card-top">' +
          '<span class="ped-local">' + esc(localLabel(c.local)) + '</span>' +
          '<span class="cc-venta">$' + formatNumber(c.ventas_total || 0) + '</span>' +
        '</div>' +
        '<div class="ped-card-sub">' +
          pedFecha(c.fecha) + ' · ' + esc(ccTurnoLabel(c.turno)) + ' · ' + (c.pax || 0) + ' pax' +
          (prom != null ? ' · $' + formatNumber(prom) + '/pax' : '') +
          (c.observaciones ? '<br><span style="font-style:italic;opacity:.7">' + esc(c.observaciones) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

  elList.innerHTML = html;
}

init();

})();

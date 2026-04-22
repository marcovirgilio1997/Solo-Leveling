// ============================================================
// CONFIGURACIÓN SUPABASE
// ============================================================
const SUPABASE_URL = 'https://jhpyvimfsuvcqtqliffm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9FHnlbOZhyitZIqMPbrt9A_hZlQyO5c';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// CONSTANTES
// ============================================================
const NOMBRE_KEY = 'cazador-nombre';
const RANK_THRESHOLDS = [
  { rank: 'E', threshold: 0 },
  { rank: 'D', threshold: 1500 },
  { rank: 'C', threshold: 6000 },
  { rank: 'B', threshold: 15000 },
  { rank: 'A', threshold: 35000 },
  { rank: 'S', threshold: 60000 }
];
const MISSION_EXP = 150;
const FULL_CLEAR_BONUS = 100;
const BONUS_MISSION_EXP = 100;
const ZERO_MISSION_PENALTY = -75;
const ONE_MISSION_PENALTY = -25;
const THREE_DAY_STREAK_PENALTY = -200;
const MIN_EXP_TOTAL = 0;
const MONTHS_ES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
];
const RANK_COLORS = {
  'E': { color: '#FFFFFF', glow: 'rgba(0,191,255,0.7)' },
  'D': { color: '#00AA00', glow: 'rgba(0,170,0,0.7)' },
  'C': { color: '#0066FF', glow: 'rgba(0,102,255,0.7)' },
  'B': { color: '#FFD700', glow: 'rgba(255,215,0,0.7)' },
  'A': { color: '#FF4400', glow: 'rgba(255,68,0,0.7)' },
  'S': { color: '#9B59B6', glow: 'rgba(155,89,182,0.7)' },
};
const RANK_NAMES = {
  'E': 'Novato', 'D': 'Aprendiz', 'C': 'Competente',
  'B': 'Avanzado', 'A': 'Élite', 'S': 'Nacional',
};

let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();

// Cache global: { 'YYYY-MM-DD': { nutricion, entrenamiento, suplementos, bonusMission } }
let misionesCache = {};

// ============================================================
// HELPERS DE FECHA
// ============================================================
function getTodayStr() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
}

function dateToStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ============================================================
// CARGA DESDE SUPABASE
// ============================================================
async function cargarDesdeSupabase() {
  const { data, error } = await db.from('missions').select('*');
  if (error) { console.error('Error cargando misiones:', error); return; }
  misionesCache = {};
  for (const row of data) {
    misionesCache[row.fecha] = {
      nutricion: !!row.nutricion,
      entrenamiento: !!row.entrenamiento,
      suplementos: !!row.suplementos,
      bonusMission: !!row.bonus_mission
    };
  }
  const { data: configData } = await db.from('config').select('*');
  if (configData) {
    for (const row of configData) {
      localStorage.setItem(row.key, row.value);
    }
  }
  updateUI();
  renderCalendar();
}

// ============================================================
// GUARDAR MISIÓN
// ============================================================
async function guardarMision() {
  const nutricion = document.getElementById('cb-nutricion')?.checked || false;
  const entrenamiento = document.getElementById('cb-entrenamiento')?.checked || false;
  const suplementos = document.getElementById('cb-suplementos')?.checked || false;
  const bonusMission = document.getElementById('bonusMissionCheckbox')?.checked || false;
  const fecha = getTodayStr();

  // Actualizar cache local inmediatamente
  misionesCache[fecha] = { nutricion, entrenamiento, suplementos, bonusMission };

  // Guardar en Supabase (upsert = insert o update si ya existe)
  const { error } = await db.from('missions').upsert({
    fecha,
    nutricion,
    entrenamiento,
    suplementos,
    bonus_mission: bonusMission
  }, { onConflict: 'fecha' });

  console.log('Guardando:', fecha, { nutricion, entrenamiento, suplementos, bonusMission });
  if (error) console.error('Error guardando:', error);

  updateUI();
}

// ============================================================
// CÁLCULOS
// ============================================================
function getTodayMissionData() {
  return misionesCache[getTodayStr()] || { nutricion: false, entrenamiento: false, suplementos: false, bonusMission: false };
}

function calcularEXPTotal() {
  const fechaInicio = localStorage.getItem('fechaInicio') || null;
  const entries = Object.entries(misionesCache)
    .filter(([fecha]) => !fechaInicio || fecha >= fechaInicio)
    .map(([fecha, data]) => ({ date: new Date(fecha + 'T00:00:00'), data }))
    .sort((a, b) => a.date - b.date);

  let total = 0;
  let zeroStreak = 0;
  let previousDate = null;

  const todayStr = getTodayStr();

  for (const { date, data } of entries) {
    const fechaStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const esHoy = fechaStr === todayStr;
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    const dailyExp = count * MISSION_EXP + (count === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);

    let penalty = 0;
    if (!esHoy) {
      if (count === 0) penalty += ZERO_MISSION_PENALTY;
      if (count === 1) penalty += ONE_MISSION_PENALTY;
    }

    if (count === 0) {
      zeroStreak = (previousDate && date - previousDate === 86400000) ? zeroStreak + 1 : 1;
    } else {
      zeroStreak = 0;
    }

    if (!esHoy && zeroStreak === 3) penalty += THREE_DAY_STREAK_PENALTY;

    total += dailyExp + penalty;
    previousDate = date;
  }

  return Math.max(total, MIN_EXP_TOTAL);
}

function calcularRacha() {
  const fechaInicio = localStorage.getItem('fechaInicio') || null;
  let racha = 0;
  const hoy = new Date();
  const todayStr = getTodayStr();

  for (let i = 1; i < 365; i++) {  // empieza en 1, saltea hoy
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - i);
    const key = dateToStr(d);
    if (fechaInicio && key < fechaInicio) break;
    const data = misionesCache[key];
    if (data) {
      const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
      if (count > 0) { racha++; continue; }
    }
    break;
  }
  return racha;
}

function calcularRango(exp) {
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (exp >= RANK_THRESHOLDS[i].threshold) return RANK_THRESHOLDS[i].rank;
  }
  return 'E';
}

// ============================================================
// UI
// ============================================================
function cargarNombreCazador() {
  const nombre = localStorage.getItem(NOMBRE_KEY) || 'MARCO';
  const el = document.getElementById('hunterNameDisplay');
  if (el) el.textContent = nombre;
}

function updateRankRing(expTotal) {
  const ring = document.getElementById('rankRingProgress');
  const rango = calcularRango(expTotal);
  const idx = RANK_THRESHOLDS.findIndex(r => r.rank === rango);
  const cur = RANK_THRESHOLDS[idx]?.threshold || 0;
  const nxt = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1].threshold : cur;
  const progress = rango === 'S' ? 100 : nxt > cur ? ((expTotal - cur) / (nxt - cur)) * 100 : 0;
  const clamped = Math.min(Math.max(progress, 0), 100);
  if (ring) {
    const circumference = 2 * Math.PI * 92;
    const offset = circumference - (clamped / 100) * circumference;
    ring.style.strokeDasharray = `${circumference} ${circumference}`;
    ring.style.strokeDashoffset = `${offset}`;
  }
}

function openRankSystemModal() {
  const expTotal = calcularEXPTotal();
  const rangoActual = calcularRango(expTotal);
  const currentIdx = RANK_THRESHOLDS.findIndex(r => r.rank === rangoActual);

  // Tabla de rangos
  const rankTable = document.getElementById('rankTable');
  if (rankTable) {
    rankTable.innerHTML = '';
    RANK_THRESHOLDS.forEach((t, idx) => {
      const rank = t.rank;
      const rc = RANK_COLORS[rank];
      const nxtThreshold = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1].threshold : null;
      let pct;
      if (idx < currentIdx) {
        pct = 100;
      } else if (idx === currentIdx) {
        pct = nxtThreshold
          ? Math.min(100, ((expTotal - t.threshold) / (nxtThreshold - t.threshold)) * 100)
          : 100;
      } else {
        pct = 0;
      }
      const isCurrent = idx === currentIdx;
      const row = document.createElement('div');
      row.className = 'rsm-rank-row' + (isCurrent ? ' rsm-current' : '');
      row.style.border = `1px solid ${rc.color}`;
      row.style.boxShadow = `0 0 8px ${rc.color}33`;
      row.innerHTML = `
        <div class="rsm-rank-letter" style="color:#FFFFFF;text-shadow:0 0 8px rgba(255,255,255,0.6);">${rank}</div>
        <div class="rsm-rank-info">
          <div class="rsm-rank-name" style="color:#FFFFFF;">${RANK_NAMES[rank]}</div>
          <div class="rsm-rank-exp">${t.threshold.toLocaleString()} EXP</div>
          <div class="rsm-rank-bar-container">
            <div class="rsm-rank-bar-fill" style="width:${Math.round(pct)}%;background:${rc.color};box-shadow:0 0 6px ${rc.color};"></div>
          </div>
        </div>
        ${isCurrent ? '<div class="rsm-current-badge">ACTUAL</div>' : ''}
      `;
      rankTable.appendChild(row);
    });
  }

  // Mi progreso
  const myProg = document.getElementById('myRankProgress');
  if (myProg) {
    const cur = RANK_THRESHOLDS[currentIdx].threshold;
    const nxt = currentIdx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[currentIdx + 1] : null;
    const rc = RANK_COLORS[rangoActual];
    const pct = nxt ? Math.min(100, ((expTotal - cur) / (nxt.threshold - cur)) * 100) : 100;
    const falta = nxt ? Math.max(0, nxt.threshold - expTotal) : 0;
    const rcNxt = nxt ? RANK_COLORS[nxt.rank] : rc;

    myProg.innerHTML = `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">EXP TOTAL</span>
        <span class="rsm-prog-value" style="color:${rc.color};text-shadow:0 0 8px ${rc.color};">${expTotal.toLocaleString()}</span>
      </div>
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">RANGO ACTUAL</span>
        <span class="rsm-prog-value" style="color:${rc.color};text-shadow:0 0 8px ${rc.color};">${rangoActual} — ${RANK_NAMES[rangoActual]}</span>
      </div>
      ${nxt ? `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">SIGUIENTE RANGO</span>
        <span class="rsm-prog-value">${nxt.rank} — ${RANK_NAMES[nxt.rank]}</span>
      </div>
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">EXP FALTANTE</span>
        <span class="rsm-prog-value" style="color:#FF6B6B;">${falta.toLocaleString()} EXP</span>
      </div>
      <div style="margin-top:6px;">
        <div class="rsm-prog-bar-wrap">
          <div class="rsm-prog-bar-fill" style="width:${Math.round(pct)}%;background:linear-gradient(90deg,${rc.color},${rcNxt.color});box-shadow:0 0 10px ${rc.color};"></div>
          <div class="rsm-prog-bar-label">${Math.round(pct)}% HACIA RANGO ${nxt.rank}</div>
        </div>
      </div>
      ` : `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">ESTADO</span>
        <span class="rsm-prog-value" style="color:${rc.color};text-shadow:0 0 10px ${rc.color};">RANGO MÁXIMO ALCANZADO ✦</span>
      </div>
      `}
    `;
  }

  // Cargar fecha de inicio guardada
  const inputFecha = document.getElementById('inputFechaInicio');
  if (inputFecha) inputFecha.value = localStorage.getItem('fechaInicio') || '';

  document.getElementById('rankSystemModal').style.display = 'flex';
}

function updateUI() {
  const data = getTodayMissionData();
  const fields = ['nutricion', 'entrenamiento', 'suplementos'];
  fields.forEach(f => {
    const el = document.getElementById(`cb-${f}`);
    if (el) el.checked = data[f];
  });
  const cb = document.getElementById('bonusMissionCheckbox');
  if (cb) cb.checked = data.bonusMission;

  cargarNombreCazador();

  const expTotal = calcularEXPTotal();
  const rango = calcularRango(expTotal);
  const idx = RANK_THRESHOLDS.findIndex(r => r.rank === rango);
  const cur = RANK_THRESHOLDS[idx]?.threshold || 0;
  const nxt = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1].threshold : cur;
  const rangeSize = (nxt - cur) || 1;
  const expEnRango = expTotal - cur;
  const fillPercent = rango === 'S' ? 100 : Math.min(Math.max((expEnRango / rangeSize) * 100, 0), 100);

  const barraExp = document.getElementById('expFill');
  const textoExp = document.getElementById('exp-text');
  if (barraExp) {
    barraExp.style.width = `${fillPercent}%`;
    const tip = barraExp.querySelector('.exp-tip-glow');
    if (tip) tip.style.display = fillPercent > 1 ? 'block' : 'none';
  }
  if (textoExp) textoExp.textContent = rango === 'S' ? `${expEnRango} EXP` : `${expEnRango} / ${rangeSize} EXP`;

  const anilloTexto = document.getElementById('rango-letra');
  if (anilloTexto) {
    anilloTexto.textContent = rango;
    const rc = RANK_COLORS[rango] || RANK_COLORS['E'];
    anilloTexto.style.color = rc.color;
    anilloTexto.style.textShadow = `0 0 15px ${rc.color}, 0 0 30px ${rc.glow}`;
  }
  const anilloTitulo = document.getElementById('rango-titulo');
  if (anilloTitulo) anilloTitulo.textContent = RANK_NAMES[rango] || '';

  const racha = calcularRacha();
  const fechaInicio = localStorage.getItem('fechaInicio') || null;
  let misionesTotales = 0, diasTotales = 0, diasCompletos = 0;
  for (const [fecha, d] of Object.entries(misionesCache)) {
    if (fechaInicio && fecha < fechaInicio) continue;
    const count = (d.nutricion ? 1 : 0) + (d.entrenamiento ? 1 : 0) + (d.suplementos ? 1 : 0);
    diasTotales++;
    misionesTotales += count;
    if (count === 3) diasCompletos++;
  }
  const eficiencia = diasTotales > 0 ? Math.round((diasCompletos / diasTotales) * 100) : 0;

  const ids = { 'stat-racha': racha, 'stat-misiones': misionesTotales, 'stat-exp': expTotal, 'stat-eficiencia': `${eficiencia}%` };
  for (const [id, val] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  const countHoy = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
  const expHoy = countHoy * MISSION_EXP + (countHoy === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);
  const recompensa = document.getElementById('recompensa-diaria');
  if (recompensa) recompensa.textContent = `Recompensa diaria estimada: ${expHoy} EXP`;

  updateRankRing(expTotal);
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  const title = document.getElementById('cal-title');
  if (!grid || !title) return;
  title.textContent = `${MONTHS_ES[calMonth]} ${calYear}`;
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = getTodayStr();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(calYear, calMonth, d);
    const key = dateToStr(date);
    const data = misionesCache[key] || null;
    const isToday = key === todayStr;
    const isPast = date <= new Date();

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.textContent = d;

    if (data) {
      const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
      if (count === 3) { cell.style.background = '#003300'; cell.style.borderColor = '#00ff00'; }
      else if (count > 0) { cell.style.background = '#2a1a00'; cell.style.borderColor = '#FFB300'; }
      else { cell.style.background = '#1a0505'; cell.style.borderColor = '#3a0000'; }
    } else if (isPast) {
      cell.style.background = '#1a0505'; cell.style.borderColor = '#3a0000';
    } else {
      cell.style.color = '#444'; cell.style.cursor = 'default';
    }

    if (isToday) { cell.style.border = '2px solid #00BFFF'; cell.style.boxShadow = '0 0 8px #00BFFF'; }

    cell.addEventListener('click', () => {
      const detail = document.getElementById('cal-detail');
      if (!detail) return;
      if (!data) {
        detail.innerHTML = `<span style="color:#00BFFF;font-weight:bold">${d} DE ${MONTHS_ES[calMonth]} DE ${calYear}</span><br><span style="color:#666">Sin misiones registradas</span>`;
        return;
      }
      const icon = v => v ? '<span style="color:#00ff00">✓</span>' : '<span style="color:#ff4444">✗</span>';
      detail.innerHTML = `<span style="color:#00BFFF;font-weight:bold">${d} DE ${MONTHS_ES[calMonth]} DE ${calYear}</span><br>${icon(data.nutricion)} [NUTRICIÓN]<br>${icon(data.entrenamiento)} [ENTRENAMIENTO]<br>${icon(data.suplementos)} [SUPLEMENTOS]`;
    });

    grid.appendChild(cell);
  }
}

// ============================================================
// INIT
// ============================================================// ============================================================
// SISTEMA DE MISIONES BONUS
// ============================================================
const BONUS_POOL = [
  'Hacé 30 flexiones',
  'Hacé 30 abdominales',
  'Hacé 40 sentadillas',
  'Mantené plancha 60 segundos',
  'Hacé 20 fondos entre sillas',
  'Hacé 15 burpees',
  'Caminá 20 minutos sin parar',
  'Hacé 50 saltos de tijera',
  'Estirá todo el cuerpo 10 minutos',
  'Hacé 3 series de 10 flexiones diamante',
  'Hacé 25 elevaciones de cadera',
  'Hacé 20 sentadillas con salto'
];

function getBonusMisionDelDia() {
  const hoy = getTodayStr();
  // Usamos la fecha como seed para que sea siempre la misma del día
  let hash = 0;
  for (let i = 0; i < hoy.length; i++) hash += hoy.charCodeAt(i);
  return BONUS_POOL[hash % BONUS_POOL.length];
}

function mostrarBonusModal() {
  const hoy = getTodayStr();
  if (localStorage.getItem('bonusDate') === hoy) return;

  const mision = getBonusMisionDelDia();
  localStorage.setItem('bonusMision', mision);

  const notif = document.getElementById('bonusCornerNotif');
  if (notif) {
    notif.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => notif.classList.add('visible')));
  }
}

function mostrarEpicModal() {
  const mision = localStorage.getItem('bonusMision') || getBonusMisionDelDia();
  const el = document.getElementById('bonusModalMision');
  if (el) el.textContent = mision;

  // Ocultar notificación de esquina
  const notif = document.getElementById('bonusCornerNotif');
  if (notif) {
    notif.classList.remove('visible');
    setTimeout(() => { notif.style.display = 'none'; }, 500);
  }

  // Mostrar modal épico con animación
  const modal = document.getElementById('bonusEpicModal');
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    modal.classList.add('active');
    // Efecto glitch en el header durante 1 segundo
    const header = document.getElementById('bonusEpicHeader');
    if (header) {
      header.classList.add('glitch');
      setTimeout(() => header.classList.remove('glitch'), 1000);
    }
  }));
}

function aceptarBonus() {
  const hoy = getTodayStr();
  localStorage.setItem('bonusDate', hoy);
  localStorage.setItem('bonusStatus', 'aceptada');

  // Destello blanco
  const flash = document.getElementById('bonusFlash');
  if (flash) {
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 180);
  }

  // Cerrar modal épico
  const modal = document.getElementById('bonusEpicModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 400);
  }

  // Mostrar misión en pantalla principal
  const container = document.getElementById('bonusMissionContainer');
  const texto = document.getElementById('bonusMissionText');
  if (container) container.style.display = 'flex';
  if (texto) texto.textContent = `[BONUS] ${localStorage.getItem('bonusMision')}`;
}

function rechazarBonus() {
  // Cerrar modal épico
  const modal = document.getElementById('bonusEpicModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 400);
  }

  const hoy = getTodayStr();
  localStorage.setItem('bonusDate', hoy);
  localStorage.setItem('bonusStatus', 'rechazada');

  // Mostrar modal cobardía con delay
  setTimeout(() => {
    const coward = document.getElementById('cowardModal');
    if (coward) coward.style.display = 'flex';
  }, 420);
}

function confirmarCobardia() {
  const coward = document.getElementById('cowardModal');
  if (coward) coward.style.display = 'none';
  updateUI();
}

// ============================================================
// HISTORIAL DE EXP
// ============================================================
function openHistorialModal() {
  const fechaInicio = localStorage.getItem('fechaInicio') || null;
  const allEntries = Object.entries(misionesCache)
    .filter(([fecha]) => !fechaInicio || fecha >= fechaInicio)
    .map(([fecha, data]) => ({ date: new Date(fecha + 'T00:00:00'), fecha, data }))
    .sort((a, b) => a.date - b.date);

  // Calcular penalización real por día (incluye racha de 3 días en 0)
  const penaltyMap = {};
  let zeroStreak = 0;
  let previousDate = null;
  for (const { date, fecha, data } of allEntries) {
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    let penalty = 0;
    if (count === 0) penalty += ZERO_MISSION_PENALTY;
    if (count === 1) penalty += ONE_MISSION_PENALTY;
    if (count === 0) {
      zeroStreak = (previousDate && date - previousDate === 86400000) ? zeroStreak + 1 : 1;
    } else {
      zeroStreak = 0;
    }
    if (zeroStreak === 3) penalty += THREE_DAY_STREAK_PENALTY;
    penaltyMap[fecha] = penalty;
    previousDate = date;
  }

  // Mostrar del más reciente al más antiguo, máx 30
  const display = [...allEntries].sort((a, b) => b.date - a.date).slice(0, 30);

  let bestExp = -Infinity, bestDia = null, lastDespeje = null;

  let tableHTML = '';
  for (const { fecha, data } of display) {
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    const expGanada = count * MISSION_EXP + (count === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);
    const penalty = penaltyMap[fecha] || 0;
    const total = expGanada + penalty;

    if (expGanada > bestExp) { bestExp = expGanada; bestDia = fecha; }
    if (count === 3 && !lastDespeje) lastDespeje = fecha;

    const [y, m, d] = fecha.split('-');
    const fechaDisplay = `${d}/${m}/${y}`;
    const badges = (count === 3 ? ' <span class="hist-badge-gold">✦</span>' : '') +
                   (data.bonusMission ? ' <span class="hist-badge-bolt">⚡</span>' : '');
    const expStr    = `<span class="hist-exp">+${expGanada} EXP</span>`;
    const penStr    = penalty < 0 ? `<span class="hist-neg">${penalty} EXP</span>` : `<span class="hist-neutral">—</span>`;
    const totalStr  = total >= 0 ? `<span class="hist-pos">+${total} EXP</span>` : `<span class="hist-neg">${total} EXP</span>`;

    tableHTML += `<tr class="hist-row">
      <td class="hist-fecha">${fechaDisplay}${badges}</td>
      <td class="hist-misiones">${count}/3</td>
      <td>${expStr}</td>
      <td>${penStr}</td>
      <td>${totalStr}</td>
    </tr>`;
  }

  const expTotal = calcularEXPTotal();
  const fmtFecha = f => f ? f.split('-').reverse().join('/') : '—';

  document.getElementById('histExpTotal').textContent = `${expTotal.toLocaleString()} EXP`;
  document.getElementById('histMejorDia').textContent = bestDia ? `${fmtFecha(bestDia)}  (+${bestExp} EXP)` : '—';
  document.getElementById('histUltimaDespeje').textContent = fmtFecha(lastDespeje);
  document.getElementById('histTableBody').innerHTML = tableHTML || '<tr><td colspan="5" style="text-align:center;color:#334455;padding:20px;">Sin registros</td></tr>';

  document.getElementById('historialModal').style.display = 'flex';
}

// ============================================================
// TIMER DE MISIÓN
// ============================================================
function iniciarTimerMision() {
  const el = document.getElementById('misionTimer');
  if (!el) return;

  function actualizar() {
    const fi = localStorage.getItem('fechaInicio');
    const inicio = fi ? new Date(fi + 'T00:00:00') : new Date(getTodayStr() + 'T00:00:00');
    const fin = new Date(inicio.getTime() + 105 * 86400000);
    const restante = fin.getTime() - Date.now();

    if (restante <= 0) {
      el.innerHTML = `<span class="timer-completada">⚔ MISIÓN COMPLETADA ⚔</span>`;
      return;
    }

    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const m = Math.floor((restante % 3600000) / 60000);
    const s = Math.floor((restante % 60000) / 1000);

    el.innerHTML =
      `<span class="timer-block"><span class="timer-num">${String(d).padStart(3,'0')}</span><span class="timer-unit">D</span></span>` +
      `<span class="timer-block"><span class="timer-num">${String(h).padStart(2,'0')}</span><span class="timer-unit">H</span></span>` +
      `<span class="timer-block"><span class="timer-num">${String(m).padStart(2,'0')}</span><span class="timer-unit">M</span></span>` +
      `<span class="timer-block"><span class="timer-num">${String(s).padStart(2,'0')}</span><span class="timer-unit">S</span></span>`;
  }

  actualizar();
  setInterval(actualizar, 1000);
}

function checkBonusStatus() {
  const hoy = getTodayStr();
  const bonusDate = localStorage.getItem('bonusDate');
  const bonusStatus = localStorage.getItem('bonusStatus');
  if (bonusDate === hoy && bonusStatus === 'aceptada') {
    const container = document.getElementById('bonusMissionContainer');
    const texto = document.getElementById('bonusMissionText');
    if (container) container.style.display = 'flex';
    if (texto) texto.textContent = `[BONUS] ${localStorage.getItem('bonusMision')}`;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  cargarDesdeSupabase();
  renderCalendar();
  ['nutricion', 'entrenamiento', 'suplementos'].forEach(f => {
    const el = document.getElementById(`cb-${f}`);
    if (el) el.addEventListener('change', guardarMision);
  });
  document.getElementById('bonusMissionCheckbox')?.addEventListener('change', guardarMision);
  document.getElementById('btnRankSystem')?.addEventListener('click', openRankSystemModal);

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  // Tooltips de estadísticas
  let activeTooltip = null;

  document.querySelectorAll('.stat-item[data-tooltip]').forEach(item => {
    const tooltip = item.querySelector('.stat-tooltip');
    if (!tooltip) return;
    tooltip.textContent = item.dataset.tooltip;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = activeTooltip === tooltip;
      if (activeTooltip) {
        activeTooltip.classList.remove('visible');
        activeTooltip = null;
      }
      if (!isOpen) {
        // Mostrar primero para poder medir el ancho real
        tooltip.classList.add('visible');
        activeTooltip = tooltip;

        const card = item.getBoundingClientRect();
        const margin = 8;
        const maxW = Math.min(250, window.innerWidth - margin * 2);
        tooltip.style.maxWidth = maxW + 'px';

        const ttW = tooltip.offsetWidth;
        const ttH = tooltip.offsetHeight;

        // Centrado bajo la tarjeta, ajustado para no salir de pantalla
        let left = card.left + card.width / 2 - ttW / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - ttW - margin));

        let top = card.bottom + 8;
        // Si no entra abajo, mostrarlo arriba
        if (top + ttH > window.innerHeight - margin) {
          top = card.top - ttH - 8;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top  = top  + 'px';

        // Alinear la flecha con el centro real de la tarjeta
        const arrowX = (card.left + card.width / 2) - left;
        tooltip.style.setProperty('--arrow-x', arrowX + 'px');
      }
    });
  });

  document.addEventListener('click', () => {
    if (activeTooltip) {
      activeTooltip.classList.remove('visible');
      activeTooltip = null;
    }
  });

  document.getElementById('btnConfirmarFecha')?.addEventListener('click', async () => {
    const input = document.getElementById('inputFechaInicio');
    if (!input) return;
    const val = input.value; // 'YYYY-MM-DD' o vacío
    if (val) {
      localStorage.setItem('fechaInicio', val);
      await db.from('config').upsert({ key: 'fechaInicio', value: val }, { onConflict: 'key' });
    } else {
      localStorage.removeItem('fechaInicio');
      await db.from('config').delete().eq('key', 'fechaInicio');
    }
    updateUI();
    // Refrescar el panel "TU PROGRESO" dentro del modal con los nuevos datos
    openRankSystemModal();
  });

  document.getElementById('btnHistorial')?.addEventListener('click', openHistorialModal);
  document.getElementById('btnCerrarHistorial')?.addEventListener('click', () => {
    document.getElementById('historialModal').style.display = 'none';
  });
  document.getElementById('historialModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('historialModal'))
      document.getElementById('historialModal').style.display = 'none';
  });

  document.getElementById('btnVerMision')?.addEventListener('click', mostrarEpicModal);

  document.getElementById('bonusEpicModal')?.addEventListener('click', (e) => {
    if (e.target !== document.getElementById('bonusEpicModal')) return;
    const modal = document.getElementById('bonusEpicModal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 400);
    const notif = document.getElementById('bonusCornerNotif');
    if (notif) {
      notif.style.display = 'block';
      requestAnimationFrame(() => requestAnimationFrame(() => notif.classList.add('visible')));
    }
  });
  document.getElementById('btnAceptarBonus')?.addEventListener('click', aceptarBonus);
  document.getElementById('btnRechazarBonus')?.addEventListener('click', rechazarBonus);
  document.getElementById('btnConfirmarCobardia')?.addEventListener('click', confirmarCobardia);
  iniciarTimerMision();
  checkBonusStatus();
  setTimeout(mostrarBonusModal, 1500);
});
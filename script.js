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
const FECHA_INICIO_FALLBACK = '2026-04-18';
const FECHA_FIN_FALLBACK = '2026-08-16';
const RANK_THRESHOLDS = [
  { rank: 'E', threshold: 0 },
  { rank: 'D', threshold: 1500 },
  { rank: 'C', threshold: 6000 },
  { rank: 'B', threshold: 15000 },
  { rank: 'A', threshold: 35000 },
  { rank: 'S', threshold: 60000 }
];
const MISSION_EXP = { nutricion: 150, entrenamiento: 150, suplementos: 75 };
const FULL_CLEAR_BONUS = 100;
const BONUS_MISSION_EXP = 100;
const ZERO_MISSION_PENALTY = -75;
const ONE_MISSION_PENALTY = -25;
const TWO_DAY_STREAK_PENALTY = -200;
const BONUS_REJECTED_PENALTY = -50;
const MIN_EXP_TOTAL = 0;
const MONTHS_ES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
];
const RANK_NAMES = {
  'E': 'Novato', 'D': 'Aprendiz', 'C': 'Competente',
  'B': 'Avanzado', 'A': 'Élite', 'S': 'Nacional',
};

let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();

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

// Fecha de inicio blindada: localStorage → fallback fijo
function getFechaInicio() {
  return localStorage.getItem('fechaInicio') || FECHA_INICIO_FALLBACK;
}

// Fecha de fin de misión: independiente de la fecha de inicio (no afecta historial/EXP)
function getFechaFinMision() {
  return localStorage.getItem('fechaFinMision') || FECHA_FIN_FALLBACK;
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
      bonusMission: !!row.bonus_mission,
      bonusRejected: !!row.bonus_rejected
    };
  }
  const { data: configData } = await db.from('config').select('*');
  if (configData) {
    for (const row of configData) {
      localStorage.setItem(row.key, row.value);
    }
  }
  updateUI();
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

  const prev = misionesCache[fecha] || {};
  misionesCache[fecha] = { ...prev, nutricion, entrenamiento, suplementos, bonusMission };

  updateUI();

  const { error } = await db.from('missions').upsert({
    fecha,
    nutricion,
    entrenamiento,
    suplementos,
    bonus_mission: bonusMission
  }, { onConflict: 'fecha' });

  if (error) console.error('Error guardando:', error);
}

// ============================================================
// CÁLCULOS
// ============================================================
function getTodayMissionData() {
  return misionesCache[getTodayStr()] || { nutricion: false, entrenamiento: false, suplementos: false, bonusMission: false };
}

function calcularEXPTotal() {
  const fechaInicio = getFechaInicio();
  const entries = Object.entries(misionesCache)
    .filter(([fecha]) => fecha >= fechaInicio)
    .map(([fecha, data]) => ({ date: new Date(fecha + 'T00:00:00'), data }))
    .sort((a, b) => a.date - b.date);

  let total = 0;
  let zeroStreak = 0;
  let previousDate = null;

  const todayStr = getTodayStr();

  for (const { date, data } of entries) {
    const fechaStr = dateToStr(date);
    const esHoy = fechaStr === todayStr;
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    const dailyExp = (data.nutricion ? MISSION_EXP.nutricion : 0) + (data.entrenamiento ? MISSION_EXP.entrenamiento : 0) + (data.suplementos ? MISSION_EXP.suplementos : 0) + (count === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);

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

    if (!esHoy && zeroStreak === 2) penalty += TWO_DAY_STREAK_PENALTY;
    if (data.bonusRejected) penalty += BONUS_REJECTED_PENALTY;

    total += dailyExp + penalty;
    previousDate = date;
  }

  return Math.max(total, MIN_EXP_TOTAL);
}

function calcularRacha() {
  const fechaInicio = getFechaInicio();
  let racha = 0;
  const hoy = new Date();

  for (let i = 1; i < 365; i++) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - i);
    const key = dateToStr(d);
    if (key < fechaInicio) break;
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

function syncMissionRows() {
  document.querySelectorAll('.m-row').forEach(row => {
    const input = row.querySelector('input[type="checkbox"]');
    if (input) row.classList.toggle('done', input.checked);
  });
}

function updateRankRing(expTotal) {
  const ring = document.getElementById('rankRingProgress');
  const tip = document.getElementById('rankRingTip');
  const tipHalo = document.getElementById('rankRingTipHalo');
  const rango = calcularRango(expTotal);
  const idx = RANK_THRESHOLDS.findIndex(r => r.rank === rango);
  const cur = RANK_THRESHOLDS[idx]?.threshold || 0;
  const nxt = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1].threshold : cur;
  const progress = rango === 'S' ? 100 : nxt > cur ? ((expTotal - cur) / (nxt - cur)) * 100 : 0;
  const clamped = Math.min(Math.max(progress, 0), 100);

  const radius = 128;
  const circumference = 2 * Math.PI * radius;

  if (ring) {
    const offset = circumference - (clamped / 100) * circumference;
    ring.style.strokeDasharray = `${circumference} ${circumference}`;
    ring.style.strokeDashoffset = `${offset}`;
  }

  const angleDeg = (clamped / 100) * 360 - 90;
  const angleRad = angleDeg * Math.PI / 180;
  const cx = 160 + radius * Math.cos(angleRad);
  const cy = 160 + radius * Math.sin(angleRad);

  if (tip) {
    tip.setAttribute('cx', cx);
    tip.setAttribute('cy', cy);
    tip.style.opacity = clamped > 1 ? 1 : 0;
  }
  if (tipHalo) {
    tipHalo.setAttribute('cx', cx);
    tipHalo.setAttribute('cy', cy);
    tipHalo.style.opacity = clamped > 1 ? 1 : 0;
  }
}

function openRankSystemModal() {
  const expTotal = calcularEXPTotal();
  const rangoActual = calcularRango(expTotal);
  const currentIdx = RANK_THRESHOLDS.findIndex(r => r.rank === rangoActual);

  const rankTable = document.getElementById('rankTable');
  if (rankTable) {
    rankTable.innerHTML = '';
    RANK_THRESHOLDS.forEach((t, idx) => {
      const rank = t.rank;
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
      row.innerHTML = `
        <div class="rsm-rank-letter">${rank}</div>
        <div class="rsm-rank-info">
          <div class="rsm-rank-name">${RANK_NAMES[rank]}</div>
          <div class="rsm-rank-exp">${t.threshold.toLocaleString()} EXP</div>
          <div class="rsm-rank-bar-container">
            <div class="rsm-rank-bar-fill" style="width:${Math.round(pct)}%;"></div>
          </div>
        </div>
        ${isCurrent ? '<div class="rsm-current-badge">ACTUAL</div>' : ''}
      `;
      rankTable.appendChild(row);
    });
  }

  const myProg = document.getElementById('myRankProgress');
  if (myProg) {
    const cur = RANK_THRESHOLDS[currentIdx].threshold;
    const nxt = currentIdx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[currentIdx + 1] : null;
    const pct = nxt ? Math.min(100, ((expTotal - cur) / (nxt.threshold - cur)) * 100) : 100;
    const falta = nxt ? Math.max(0, nxt.threshold - expTotal) : 0;

    myProg.innerHTML = `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">EXP TOTAL</span>
        <span class="rsm-prog-value">${expTotal.toLocaleString()}</span>
      </div>
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">RANGO ACTUAL</span>
        <span class="rsm-prog-value">${rangoActual} — ${RANK_NAMES[rangoActual]}</span>
      </div>
      ${nxt ? `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">SIGUIENTE RANGO</span>
        <span class="rsm-prog-value">${nxt.rank} — ${RANK_NAMES[nxt.rank]}</span>
      </div>
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">EXP FALTANTE</span>
        <span class="rsm-prog-value">${falta.toLocaleString()} EXP</span>
      </div>
      <div style="margin-top:6px;">
        <div class="rsm-prog-bar-wrap">
          <div class="rsm-prog-bar-fill" style="width:${Math.round(pct)}%;"></div>
          <div class="rsm-prog-bar-label">${Math.round(pct)}% HACIA RANGO ${nxt.rank}</div>
        </div>
      </div>
      ` : `
      <div class="rsm-prog-row">
        <span class="rsm-prog-label">ESTADO</span>
        <span class="rsm-prog-value">RANGO MÁXIMO ALCANZADO</span>
      </div>
      `}
    `;
  }

  const inputFecha = document.getElementById('inputFechaInicio');
  if (inputFecha) inputFecha.value = getFechaInicio();

  const inputFin = document.getElementById('inputFechaFin');
  if (inputFin) inputFin.value = getFechaFinMision();

  document.getElementById('rankSystemModal').style.display = 'flex';
}

function updateUI() {
  const data = getTodayMissionData();
  ['nutricion', 'entrenamiento', 'suplementos'].forEach(f => {
    const el = document.getElementById(`cb-${f}`);
    if (el) el.checked = data[f];
  });
  const cb = document.getElementById('bonusMissionCheckbox');
  if (cb) cb.checked = data.bonusMission;

  syncMissionRows();
  cargarNombreCazador();

  const expTotal = calcularEXPTotal();
  const rango = calcularRango(expTotal);
  const idx = RANK_THRESHOLDS.findIndex(r => r.rank === rango);
  const cur = RANK_THRESHOLDS[idx]?.threshold || 0;
  const nxt = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1].threshold : cur;
  const rangeSize = (nxt - cur) || 1;
  const expEnRango = expTotal - cur;

  const textoExp = document.getElementById('exp-text');
  if (textoExp) textoExp.textContent = rango === 'S' ? `${expEnRango} EXP` : `${expEnRango} / ${rangeSize} EXP`;

  const anilloTexto = document.getElementById('rango-letra');
  if (anilloTexto) anilloTexto.textContent = rango;
  const anilloTitulo = document.getElementById('rango-titulo');
  if (anilloTitulo) anilloTitulo.textContent = RANK_NAMES[rango] || '';

  const racha = calcularRacha();
  const fechaInicio = getFechaInicio();
  let misionesTotales = 0, diasTotales = 0, diasCompletos = 0;
  for (const [fecha, d] of Object.entries(misionesCache)) {
    if (fecha < fechaInicio) continue;
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
  const expHoy = (data.nutricion ? MISSION_EXP.nutricion : 0) + (data.entrenamiento ? MISSION_EXP.entrenamiento : 0) + (data.suplementos ? MISSION_EXP.suplementos : 0) + (countHoy === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);
  const recompensa = document.getElementById('recompensa-diaria');
  if (recompensa) recompensa.textContent = `RECOMPENSA ESTIMADA · ${expHoy} EXP`;

  updateRankRing(expTotal);
  renderCalendar();
  renderSysLog();
}

// ============================================================
// CALENDARIO
// ============================================================
function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  const title = document.getElementById('cal-title');
  if (!grid || !title) return;
  title.textContent = `${MONTHS_ES[calMonth]} ${calYear}`;
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = getTodayStr();
  const now = new Date();

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
    const isFuture = !isToday && date > now;

    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.textContent = d;

    if (isFuture) {
      cell.classList.add('cal-future');
    } else if (data) {
      const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
      const bar = document.createElement('span');
      bar.className = 'cal-bar';
      const fill = document.createElement('i');
      if (count === 0) {
        cell.classList.add('cal-z');
        fill.style.width = '0%';
      } else {
        if (count === 3) cell.classList.add('cal-full');
        fill.style.width = `${Math.round(count / 3 * 100)}%`;
      }
      bar.appendChild(fill);
      cell.appendChild(bar);
      if (data.bonusMission) {
        const mark = document.createElement('span');
        mark.className = 'cal-bonus-mark';
        mark.textContent = '⚡';
        cell.appendChild(mark);
      }
    } else if (!isToday) {
      cell.classList.add('cal-miss');
    }

    if (isToday) cell.classList.add('cal-today');

    cell.addEventListener('click', () => {
      if (isFuture) return;
      const detail = document.getElementById('cal-detail');
      if (!detail) return;
      if (!data) {
        detail.innerHTML = `<span style="color:var(--cyan);font-weight:600;letter-spacing:1px;">${d} DE ${MONTHS_ES[calMonth]} DE ${calYear}</span><br><span style="color:var(--tx-faint);">Sin misiones registradas</span>`;
        return;
      }
      const icon = v => v ? '<span style="color:var(--pos);">✓</span>' : '<span style="color:var(--neg);">✗</span>';
      const bonusLine = data.bonusMission ? '<br><span style="color:var(--cyan);">⚡ MISIÓN BONUS COMPLETADA</span>' : '';
      detail.innerHTML = `<span style="color:var(--cyan);font-weight:600;letter-spacing:1px;">${d} DE ${MONTHS_ES[calMonth]} DE ${calYear}</span><br>${icon(data.nutricion)} NUTRICIÓN<br>${icon(data.entrenamiento)} ENTRENAMIENTO<br>${icon(data.suplementos)} SUPLEMENTOS${bonusLine}`;
    });

    grid.appendChild(cell);
  }
}

// ============================================================
// SISTEMA DE MISIONES BONUS
// ============================================================
const BONUS_POOL = [
  'Caminá 20 minutos sin parar',
  'Mantené plancha 60 segundos',
  'Hacé 40 sentadillas',
  'Hacé 30 flexiones',
  'Hacé 3 series de 10 flexiones diamante'
];

function getBonusMisionDelDia() {
  const hoy = getTodayStr();
  let hash = 0;
  for (let i = 0; i < hoy.length; i++) hash += hoy.charCodeAt(i);
  return BONUS_POOL[hash % BONUS_POOL.length];
}

function mostrarBonusInline() {
  const hoy = getTodayStr();
  if (localStorage.getItem('bonusDate') === hoy) return;

  const mision = getBonusMisionDelDia();
  localStorage.setItem('bonusMision', mision);

  const el = document.getElementById('bonusModalMision');
  if (el) el.textContent = mision;

  const box = document.getElementById('bonusInline');
  if (!box) return;
  box.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('visible')));
}

function cerrarBonusInline() {
  const box = document.getElementById('bonusInline');
  if (!box) return;
  box.classList.remove('open');
  setTimeout(() => {
    box.classList.remove('visible');
    setTimeout(() => { box.style.display = 'none'; }, 500);
  }, 350);
}

function aceptarBonus() {
  const hoy = getTodayStr();
  localStorage.setItem('bonusDate', hoy);
  localStorage.setItem('bonusStatus', 'aceptada');

  const flash = document.getElementById('bonusFlash');
  if (flash) {
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 180);
  }

  cerrarBonusInline();

  const container = document.getElementById('bonusMissionContainer');
  const texto = document.getElementById('bonusMissionText');
  if (container) container.style.display = 'flex';
  if (texto) texto.textContent = `[BONUS] ${localStorage.getItem('bonusMision')}`;
}

async function rechazarBonus() {
  cerrarBonusInline();

  const hoy = getTodayStr();
  localStorage.setItem('bonusDate', hoy);
  localStorage.setItem('bonusStatus', 'rechazada');

  const existing = misionesCache[hoy] || { nutricion: false, entrenamiento: false, suplementos: false, bonusMission: false };
  misionesCache[hoy] = { ...existing, bonusRejected: true };
  await db.from('missions').upsert({
    fecha: hoy,
    nutricion: existing.nutricion,
    entrenamiento: existing.entrenamiento,
    suplementos: existing.suplementos,
    bonus_mission: existing.bonusMission,
    bonus_rejected: true
  }, { onConflict: 'fecha' });

  setTimeout(() => {
    const coward = document.getElementById('cowardModal');
    if (coward) coward.style.display = 'flex';
  }, 780);
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
  const fechaInicio = getFechaInicio();
  const allEntries = Object.entries(misionesCache)
    .filter(([fecha]) => fecha >= fechaInicio)
    .map(([fecha, data]) => ({ date: new Date(fecha + 'T00:00:00'), fecha, data }))
    .sort((a, b) => a.date - b.date);

  const penaltyMap = {};
  const todayStr = getTodayStr();
  let zeroStreak = 0;
  let previousDate = null;
  for (const { date, fecha, data } of allEntries) {
    const esHoy = fecha === todayStr;
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    let penalty = 0;
    if (!esHoy && count === 0) penalty += ZERO_MISSION_PENALTY;
    if (!esHoy && count === 1) penalty += ONE_MISSION_PENALTY;
    if (count === 0) {
      zeroStreak = (previousDate && date - previousDate === 86400000) ? zeroStreak + 1 : 1;
    } else {
      zeroStreak = 0;
    }
    if (!esHoy && zeroStreak === 2) penalty += TWO_DAY_STREAK_PENALTY;
    if (data.bonusRejected) penalty += BONUS_REJECTED_PENALTY;
    penaltyMap[fecha] = { total: penalty, hadStreakBreak: !esHoy && zeroStreak === 2 };
    previousDate = date;
  }

  const display = [...allEntries].sort((a, b) => b.date - a.date).slice(0, 30);

  let bestExp = -Infinity, bestDia = null, lastDespeje = null;

  let tableHTML = '';
  for (const { fecha, data } of display) {
    const count = (data.nutricion ? 1 : 0) + (data.entrenamiento ? 1 : 0) + (data.suplementos ? 1 : 0);
    const expGanada = (data.nutricion ? MISSION_EXP.nutricion : 0) + (data.entrenamiento ? MISSION_EXP.entrenamiento : 0) + (data.suplementos ? MISSION_EXP.suplementos : 0) + (count === 3 ? FULL_CLEAR_BONUS : 0) + (data.bonusMission ? BONUS_MISSION_EXP : 0);
    const penEntry = penaltyMap[fecha] || { total: 0, hadStreakBreak: false };
    const penalty = penEntry.total;
    const total = expGanada + penalty;

    if (expGanada > bestExp) { bestExp = expGanada; bestDia = fecha; }
    if (count === 3 && !lastDespeje) lastDespeje = fecha;

    const [y, m, d] = fecha.split('-');
    const fechaDisplay = `${d}/${m}/${y}`;
    const badges = (count === 3 ? ' <span class="hist-badge-gold">◆</span>' : '');
    const bonusCol = data.bonusMission === true
      ? '<span class="hist-badge-bolt">⚡</span>'
      : '<span class="hist-badge-bolt-off">⚡</span>';
    const expStr   = `<span class="hist-exp">+${expGanada}</span>`;
    const penStr   = penalty < 0 ? `<span class="hist-neg">${penalty}</span>` : `<span class="hist-neutral">—</span>`;
    const totalStr = total >= 0 ? `<span class="hist-pos">+${total}</span>` : `<span class="hist-neg">${total}</span>`;

    const esHoyRow = fecha === todayStr;
    const penDetails = [];
    if (!esHoyRow && count === 0) penDetails.push('0 misiones: −75');
    if (!esHoyRow && count === 1) penDetails.push('1 misión: −25');
    if (data.bonusRejected) penDetails.push('Bonus rechazada: −50');
    if (penEntry.hadStreakBreak) penDetails.push('Racha 2 días en 0: −200');
    const breakdownStr = penDetails.length > 0 ? penDetails.join(' · ') : 'Sin penalizaciones';

    tableHTML += `<tr class="hist-row" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'table-row' ? 'none' : 'table-row';">
      <td class="hist-fecha">${fechaDisplay}${badges}</td>
      <td class="hist-misiones">${count}/3</td>
      <td style="text-align:center;">${bonusCol}</td>
      <td>${expStr}</td>
      <td>${penStr}</td>
      <td>${totalStr}</td>
    </tr>
    <tr class="hist-detail-row" style="display:none;">
      <td colspan="6"><strong>Desglose:</strong> ${breakdownStr}</td>
    </tr>`;
  }

  const expTotal = calcularEXPTotal();
  const fmtFecha = f => f ? f.split('-').reverse().join('/') : '—';
  const bonusCount = display.filter(({ data }) => data.bonusMission === true).length;

  document.getElementById('histExpTotal').textContent = `${expTotal.toLocaleString()} EXP`;
  document.getElementById('histMejorDia').textContent = bestDia ? `${fmtFecha(bestDia)}  (+${bestExp})` : '—';
  document.getElementById('histUltimaDespeje').textContent = fmtFecha(lastDespeje);
  document.getElementById('histBonusCount').textContent = bonusCount;
  document.getElementById('histTableBody').innerHTML = tableHTML || '<tr><td colspan="6" style="text-align:center;color:var(--tx-faint);padding:20px;">Sin registros</td></tr>';

  document.getElementById('historialModal').style.display = 'flex';
}

// ============================================================
// TIMER DE MISIÓN
// ============================================================
function iniciarTimerMision() {
  const el = document.getElementById('misionTimer');
  if (!el) return;

  function actualizar() {
    const fin = new Date(getFechaFinMision() + 'T00:00:00');
    const restante = fin.getTime() - Date.now();

    if (restante <= 0) {
      el.innerHTML = `<span class="timer-completada">MISIÓN COMPLETADA</span>`;
      return;
    }

    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const m = Math.floor((restante % 3600000) / 60000);
    const s = Math.floor((restante % 60000) / 1000);

    el.innerHTML =
      `<span class="tb"><span class="tn">${String(d).padStart(3,'0')}</span><span class="tu">D</span></span>` +
      `<span class="tb"><span class="tn">${String(h).padStart(2,'0')}</span><span class="tu">H</span></span>` +
      `<span class="tb"><span class="tn">${String(m).padStart(2,'0')}</span><span class="tu">M</span></span>` +
      `<span class="tb"><span class="tn">${String(s).padStart(2,'0')}</span><span class="tu">S</span></span>`;
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

// ============================================================
// REGISTRO DEL SISTEMA
// ============================================================
function generarEventosSistema() {
  const todayStr = getTodayStr();
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = dateToStr(ayer);

  const eventos = [];

  function eventosDelDia(fechaStr, label) {
    const d = misionesCache[fechaStr];
    if (!d) return;
    const count = (d.nutricion?1:0) + (d.entrenamiento?1:0) + (d.suplementos?1:0);

    if (d.nutricion)     eventos.push({ t: label, txt: `+150 EXP — Nutrición completada`, cls: 'sl-pos' });
    if (d.entrenamiento) eventos.push({ t: label, txt: `+150 EXP — Entrenamiento completado`, cls: 'sl-pos' });
    if (d.suplementos)   eventos.push({ t: label, txt: `+75 EXP — Suplementos completado`, cls: 'sl-pos' });
    if (count === 3)     eventos.push({ t: label, txt: `+100 EXP — DESPEJE TOTAL`, cls: 'sl-gold' });
    if (d.bonusMission)  eventos.push({ t: label, txt: `+100 EXP — Misión Bonus completada`, cls: 'sl-gold' });
    if (d.bonusRejected) eventos.push({ t: label, txt: `-50 EXP — Bonus rechazada`, cls: 'sl-neg' });

    const esHoy = fechaStr === todayStr;
    if (!esHoy && count === 0) eventos.push({ t: label, txt: `-75 EXP — Día sin misiones`, cls: 'sl-neg' });
    if (!esHoy && count === 1) eventos.push({ t: label, txt: `-25 EXP — Solo 1 misión`, cls: 'sl-neg' });
  }

  eventosDelDia(ayerStr, 'AYER');
  eventosDelDia(todayStr, 'HOY');

  return eventos;
}

let syslogRunId = 0;
let syslogTyped = false;

function renderSysLog() {
  const container = document.getElementById('syslogLines');
  if (!container) return;

  const runId = ++syslogRunId;
  container.innerHTML = '';

  const eventos = generarEventosSistema();
  if (eventos.length === 0) {
    container.innerHTML = '<div class="syslog-empty">> Sin actividad registrada</div>';
    return;
  }

  if (syslogTyped) {
    container.innerHTML = eventos.map(ev =>
      `<div class="syslog-line"><span class="sl-time">> [${ev.t}] </span><span class="${ev.cls}">${ev.txt}</span></div>`
    ).join('');
    return;
  }

  syslogTyped = true;
  let lineIdx = 0;

  function escribirSiguiente() {
    if (runId !== syslogRunId) return;
    if (lineIdx >= eventos.length) return;
    const ev = eventos[lineIdx];
    const line = document.createElement('div');
    line.className = 'syslog-line typing';
    container.appendChild(line);

    const fullText = `> [${ev.t}] ${ev.txt}`;
    let charIdx = 0;

    function escribirChar() {
      if (runId !== syslogRunId) return;
      if (charIdx <= fullText.length) {
        const partial = fullText.slice(0, charIdx);
        const m = partial.match(/^(> \[[^\]]*\] )(.*)$/);
        if (m) {
          line.innerHTML = `<span class="sl-time">${m[1]}</span><span class="${ev.cls}">${m[2]}</span>`;
        } else {
          line.textContent = partial;
        }
        charIdx++;
        setTimeout(escribirChar, 18);
      } else {
        line.classList.remove('typing');
        lineIdx++;
        setTimeout(escribirSiguiente, 120);
      }
    }
    escribirChar();
  }

  escribirSiguiente();
}

// ============================================================
// QUEST DEL DÍA
// ============================================================
const QUEST_POOL = [
  { t: 'PROTOCOLO DE HIERRO',    d: 'Antes del mediodía, completá tu entrenamiento.' },
  { t: 'AYUNO DE DISTRACCIONES', d: 'Pasá la primera hora del día sin pantallas.' },
  { t: 'CARGA EXTRA',            d: 'Sumá 10 repeticiones por encima de tu rutina habitual.' },
  { t: 'DISCIPLINA NOCTURNA',    d: 'Apagá todo y dormí antes de medianoche.' },
  { t: 'PURGA DEL AZÚCAR',       d: 'Cero azúcar añadido en todas tus comidas de hoy.' },
  { t: 'HIDRATACIÓN TOTAL',      d: 'Tomá al menos 3 litros de agua durante el día.' },
  { t: 'CAMINO DEL ACERO',       d: 'Acumulá 5 minutos de plancha antes de dormir.' },
  { t: 'MENTE EN SILENCIO',      d: 'Dedicá 10 minutos a respiración o meditación.' },
  { t: 'CACERÍA TEMPRANA',       d: 'Iniciá tu primera misión antes de las 9:00.' },
  { t: 'RESISTENCIA FINAL',      d: 'Cerrá el día con las 3 misiones completas.' },
  { t: 'CÓDIGO DEL CAZADOR',     d: 'Dejá preparadas tus comidas de mañana.' },
  { t: 'AVANCE FORZADO',         d: 'Agregá 15 minutos de cardio a tu jornada.' },
  { t: 'VOTO DE CONSTANCIA',     d: 'Registrá actividad hoy sí o sí.' },
  { t: 'DOMINIO DEL CUERPO',     d: 'Estirá 10 minutos al despertar.' },
  { t: 'POSTURA DE COMBATE',     d: 'Espalda recta cada vez que te sientes hoy.' },
  { t: 'RESPIRO DE GUERRERO',    d: 'Hacé 3 pausas de 1 minuto para respirar profundo.' },
  { t: 'LUZ DEL SOL',            d: 'Tomá 15 minutos de sol antes del mediodía.' },
  { t: 'AYUNO DE QUEJAS',        d: 'Pasá el día entero sin quejarte una sola vez.' },
  { t: 'GOLPE MATINAL',          d: 'Hacé 30 sentadillas apenas te levantes.' },
  { t: 'ORDEN DEL TERRITORIO',   d: 'Ordená tu espacio de entrenamiento o trabajo.' },
  { t: 'PASO LARGO',             d: 'Caminá 8.000 pasos hoy.' },
  { t: 'COMIDA LIMPIA',          d: 'Una comida del día 100% sin ultraprocesados.' },
  { t: 'FOCO ABSOLUTO',          d: 'Trabajá 25 minutos sin tocar el teléfono.' },
  { t: 'FUERZA DE AGARRE',       d: 'Hacé una serie máxima de flexiones.' },
  { t: 'GRATITUD DEL CAZADOR',   d: 'Anotá 3 cosas que lograste hoy.' },
  { t: 'CIERRE PERFECTO',        d: 'Revisá tus misiones antes de dormir y planeá mañana.' }
];

function sistemaSeedIndex(arr, salt) {
  const base = getTodayStr() + (salt || '');
  let hash = 0;
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return hash % arr.length;
}
function getQuestDelDia() { return QUEST_POOL[sistemaSeedIndex(QUEST_POOL, 'quest')]; }

function renderQuestDia() {
  const t = document.getElementById('questDiaTitle');
  const d = document.getElementById('questDiaDesc');
  if (!t || !d) return;
  const q = getQuestDelDia();
  t.textContent = q.t;
  d.textContent = q.d;
}

// ============================================================
// ANÁLISIS DEL CAZADOR
// ============================================================
const DIAS_SEM = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
const DIAS_SEM_FULL = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

function countDia(d) {
  return (d.nutricion ? 1 : 0) + (d.entrenamiento ? 1 : 0) + (d.suplementos ? 1 : 0);
}

function openAnalisisModal() {
  const fInicio = getFechaInicio();
  const todayStr = getTodayStr();
  const hoy = new Date(todayStr + 'T00:00:00');
  const inicio = new Date(fInicio + 'T00:00:00');
  const ayer = new Date(hoy.getTime() - 86400000);

  // ---- RACHA: actual, récord y ticks de 14 días
  const rachaActual = calcularRacha();
  let record = 0, run = 0;
  for (let t = inicio.getTime(); t <= hoy.getTime(); t += 86400000) {
    const key = dateToStr(new Date(t));
    const d = misionesCache[key];
    if (d && countDia(d) > 0) {
      run++;
      if (run > record) record = run;
    } else if (key !== todayStr) {
      run = 0;
    }
  }
  const elRA = document.getElementById('anRachaActual');
  const elRR = document.getElementById('anRachaRecord');
  if (elRA) elRA.textContent = rachaActual;
  if (elRR) elRR.textContent = record;

  const ticksEl = document.getElementById('anRachaDias');
  if (ticksEl) {
    let ticks = '';
    for (let i = 13; i >= 0; i--) {
      const dDate = new Date(hoy.getTime() - i * 86400000);
      const key = dateToStr(dDate);
      if (key < fInicio) { ticks += '<i></i>'; continue; }
      const d = misionesCache[key];
      const ok = d && countDia(d) > 0;
      if (key === todayStr && !ok) ticks += '<i></i>';
      else ticks += ok ? '<i class="on"></i>' : '<i class="off"></i>';
    }
    ticksEl.innerHTML = ticks;
  }

  // ---- Días completos transcurridos (hasta ayer)
  let diasCompletos = Math.floor((ayer.getTime() - inicio.getTime()) / 86400000) + 1;
  if (diasCompletos < 0) diasCompletos = 0;

  // ---- DEBILIDAD DETECTADA
  const NOMBRES = { nutricion: 'Nutrición', entrenamiento: 'Entrenamiento', suplementos: 'Suplementos' };
  const cumplidas = { nutricion: 0, entrenamiento: 0, suplementos: 0 };
  for (let t = inicio.getTime(); t <= ayer.getTime(); t += 86400000) {
    const d = misionesCache[dateToStr(new Date(t))];
    if (!d) continue;
    if (d.nutricion) cumplidas.nutricion++;
    if (d.entrenamiento) cumplidas.entrenamiento++;
    if (d.suplementos) cumplidas.suplementos++;
  }
  const debEl = document.getElementById('anDebilidad');
  if (debEl) {
    const rows = Object.keys(cumplidas).map(k => ({
      key: k,
      nombre: NOMBRES[k],
      pct: diasCompletos > 0 ? Math.round((cumplidas[k] / diasCompletos) * 100) : 0,
      fallos: Math.max(0, diasCompletos - cumplidas[k])
    })).sort((a, b) => b.pct - a.pct);
    const peor = rows[rows.length - 1];
    const costo = peor.fallos * MISSION_EXP[peor.key];
    debEl.innerHTML = rows.map(r => `
      <div class="wk-row${r === peor && diasCompletos > 0 ? ' weak' : ''}">
        <span class="wk-name">${r.nombre}</span>
        <span class="wk-bar"><i style="width:${r.pct}%"></i></span>
        <span class="wk-pct">${r.pct}%</span>
      </div>`).join('') +
      (diasCompletos > 0 && peor.fallos > 0 ? `
      <div class="wk-verdict">
        <b>PUNTO DÉBIL · ${peor.nombre.toUpperCase()}</b><br>
        Te costó ${costo.toLocaleString()} EXP en misiones falladas desde el inicio.
      </div>` : '');
  }

  // ---- PATRÓN SEMANAL
  const semTotal = [0,0,0,0,0,0,0], semFull = [0,0,0,0,0,0,0];
  for (let t = inicio.getTime(); t <= ayer.getTime(); t += 86400000) {
    const dDate = new Date(t);
    const wd = dDate.getDay();
    semTotal[wd]++;
    const d = misionesCache[dateToStr(dDate)];
    if (d && countDia(d) === 3) semFull[wd]++;
  }
  const pcts = semTotal.map((n, i) => n > 0 ? Math.round((semFull[i] / n) * 100) : null);
  const semEl = document.getElementById('anSemanal');
  const semCap = document.getElementById('anSemanalCap');
  if (semEl) {
    let worst = -1, best = -1;
    pcts.forEach((p, i) => {
      if (p === null) return;
      if (worst === -1 || p < pcts[worst]) worst = i;
      if (best === -1 || p > pcts[best]) best = i;
    });
    semEl.innerHTML = pcts.map((p, i) => {
      const h = p === null ? 3 : Math.max(p, 3);
      const cls = (i === worst && worst !== best) ? ' worst' : (i === best ? ' best' : '');
      return `<div class="wd-col${cls}"><div class="wd-bar" style="height:${h}%"></div><span class="wd-lbl">${DIAS_SEM[i]}</span></div>`;
    }).join('');
    if (semCap) {
      semCap.innerHTML = (worst !== -1 && worst !== best)
        ? `Tu día más flojo es el <b>${DIAS_SEM_FULL[worst]}</b> · ${pcts[worst]}% de despeje`
        : '';
    }
  }

  // ---- PROYECCIÓN DEL SISTEMA
  const expTotal = calcularEXPTotal();
  const rango = calcularRango(expTotal);
  const idx = RANK_THRESHOLDS.findIndex(r => r.rank === rango);
  const nxt = idx < RANK_THRESHOLDS.length - 1 ? RANK_THRESHOLDS[idx + 1] : null;

  const ventana = Math.max(1, Math.min(14, diasCompletos));
  let expVentana = 0;
  for (let i = 1; i <= ventana; i++) {
    const key = dateToStr(new Date(hoy.getTime() - i * 86400000));
    if (key < fInicio) break;
    const d = misionesCache[key];
    if (!d) { expVentana += ZERO_MISSION_PENALTY; continue; }
    const c = countDia(d);
    let e = (d.nutricion ? MISSION_EXP.nutricion : 0) + (d.entrenamiento ? MISSION_EXP.entrenamiento : 0) + (d.suplementos ? MISSION_EXP.suplementos : 0) + (c === 3 ? FULL_CLEAR_BONUS : 0) + (d.bonusMission ? BONUS_MISSION_EXP : 0);
    if (c === 0) e += ZERO_MISSION_PENALTY;
    if (c === 1) e += ONE_MISSION_PENALTY;
    if (d.bonusRejected) e += BONUS_REJECTED_PENALTY;
    expVentana += e;
  }
  const ritmo = Math.max(0, Math.round(expVentana / ventana));

  const finMision = new Date(getFechaFinMision() + 'T00:00:00');
  const diasRestantes = Math.max(0, Math.floor((finMision.getTime() - Date.now()) / 86400000));

  const pjEl = document.getElementById('anProyeccion');
  if (pjEl) {
    let rowsHTML = `<div class="pj-row"><span class="pj-l">Ritmo actual</span><span class="pj-v cy">${ritmo.toLocaleString()} EXP / DÍA</span></div>`;
    let verdictHTML = '';
    if (!nxt) {
      verdictHTML = `<div class="pj-verdict">RANGO MÁXIMO ALCANZADO</div>`;
    } else {
      const falta = Math.max(0, nxt.threshold - expTotal);
      rowsHTML += `<div class="pj-row"><span class="pj-l">Próximo rango</span><span class="pj-v">${nxt.rank} — ${RANK_NAMES[nxt.rank].toUpperCase()}</span></div>`;
      if (ritmo > 0) {
        const llegada = Math.ceil(falta / ritmo);
        rowsHTML += `<div class="pj-row"><span class="pj-l">Llegada estimada</span><span class="pj-v cy">${llegada} DÍAS</span></div>`;
        rowsHTML += `<div class="pj-row"><span class="pj-l">Fin de la misión</span><span class="pj-v">${diasRestantes} DÍAS</span></div>`;
        if (llegada <= diasRestantes) {
          verdictHTML = `<div class="pj-verdict">RANGO ${nxt.rank} ALCANZABLE<br>ANTES DEL FIN DE LA MISIÓN</div>`;
        } else {
          const necesario = diasRestantes > 0 ? Math.ceil(falta / diasRestantes) : falta;
          verdictHTML = `<div class="pj-verdict bad">RITMO INSUFICIENTE<br>NECESITÁS ${necesario.toLocaleString()} EXP / DÍA</div>`;
        }
      } else {
        rowsHTML += `<div class="pj-row"><span class="pj-l">Fin de la misión</span><span class="pj-v">${diasRestantes} DÍAS</span></div>`;
        verdictHTML = `<div class="pj-verdict bad">SIN RITMO REGISTRADO<br>SUMÁ EXP HOY</div>`;
      }
    }
    pjEl.innerHTML = `<div class="pj-rows">${rowsHTML}</div>` + verdictHTML;
  }
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  cargarDesdeSupabase();
  renderCalendar();
  ['nutricion', 'entrenamiento', 'suplementos'].forEach(f => {
    const el = document.getElementById(`cb-${f}`);
    if (el) el.addEventListener('change', () => { syncMissionRows(); guardarMision(); });
  });
  document.getElementById('bonusMissionCheckbox')?.addEventListener('change', () => { syncMissionRows(); guardarMision(); });
  document.getElementById('btnRankSystem')?.addEventListener('click', openRankSystemModal);

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

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
        tooltip.classList.add('visible');
        activeTooltip = tooltip;

        const card = item.getBoundingClientRect();
        const margin = 8;
        const maxW = Math.min(250, window.innerWidth - margin * 2);
        tooltip.style.maxWidth = maxW + 'px';

        const ttW = tooltip.offsetWidth;
        const ttH = tooltip.offsetHeight;

        let left = card.left + card.width / 2 - ttW / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - ttW - margin));

        let top = card.bottom + 8;
        if (top + ttH > window.innerHeight - margin) {
          top = card.top - ttH - 8;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top  = top  + 'px';

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
    const val = input.value;
    if (val) {
      localStorage.setItem('fechaInicio', val);
      await db.from('config').upsert({ key: 'fechaInicio', value: val }, { onConflict: 'key' });
    } else {
      localStorage.removeItem('fechaInicio');
      await db.from('config').delete().eq('key', 'fechaInicio');
    }
    location.reload();
  });

  document.getElementById('btnConfirmarFechaFin')?.addEventListener('click', async () => {
    const input = document.getElementById('inputFechaFin');
    if (!input) return;
    const val = input.value;
    if (val) {
      localStorage.setItem('fechaFinMision', val);
      await db.from('config').upsert({ key: 'fechaFinMision', value: val }, { onConflict: 'key' });
    } else {
      localStorage.removeItem('fechaFinMision');
      await db.from('config').delete().eq('key', 'fechaFinMision');
    }
    location.reload();
  });

  document.getElementById('btnHistorial')?.addEventListener('click', openHistorialModal);
  document.getElementById('btnCerrarHistorial')?.addEventListener('click', () => {
    document.getElementById('historialModal').style.display = 'none';
  });
  document.getElementById('historialModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('historialModal'))
      document.getElementById('historialModal').style.display = 'none';
  });

  document.getElementById('btnStats')?.addEventListener('click', () => {
    openAnalisisModal();
    document.getElementById('statsModal').style.display = 'flex';
  });
  document.getElementById('btnCerrarStats')?.addEventListener('click', () => {
    document.getElementById('statsModal').style.display = 'none';
  });
  document.getElementById('statsModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('statsModal'))
      document.getElementById('statsModal').style.display = 'none';
  });

  document.getElementById('btnAceptarBonus')?.addEventListener('click', aceptarBonus);
  document.getElementById('btnRechazarBonus')?.addEventListener('click', rechazarBonus);
  document.getElementById('btnConfirmarCobardia')?.addEventListener('click', confirmarCobardia);
  iniciarTimerMision();
  checkBonusStatus();
  renderQuestDia();
  document.getElementById('bonusToggle')?.addEventListener('click', () => {
    document.getElementById('bonusInline')?.classList.toggle('open');
  });
  setTimeout(mostrarBonusInline, 1200);
});
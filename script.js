// ============================================================
// SUPABASE
// ============================================================
const SUPABASE_URL = 'https://jhpyvimfsuvcqtqliffm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9FHnlbOZhyitZIqMPbrt9A_hZlQyO5c';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// CICLO Y MISIONES
// ============================================================
const CICLO_ACTUAL = 2;
const FECHA_INICIO_FALLBACK = '2026-08-31';
const FECHA_FIN_FALLBACK = '2026-11-10';

const MISIONES = [
  { key:'desayuno',      col:'desayuno',      label:'Desayuno',           grupo:'NUTRICIÓN' },
  { key:'almuerzo',      col:'almuerzo',      label:'Almuerzo',           grupo:'NUTRICIÓN' },
  { key:'merienda',      col:'merienda',      label:'Merienda',           grupo:'NUTRICIÓN' },
  { key:'cena',          col:'cena',          label:'Cena',               grupo:'NUTRICIÓN' },
  { key:'ayuno',         col:'ayuno',         label:'Ayuno 12 h',         grupo:'PROTOCOLO' },
  { key:'diaLimpio',     col:'dia_limpio',    label:'Día limpio',         grupo:'PROTOCOLO' },
  { key:'entrenamiento', col:'entrenamiento', label:'Entrenamiento',      grupo:'CUERPO' },
  { key:'suplementos',   col:'suplementos',   label:'Omega 3 + creatina', grupo:'CUERPO' }
];

const MISIONES_C1 = [
  { key:'nutricion',     col:'nutricion',     label:'Nutrición' },
  { key:'entrenamiento', col:'entrenamiento', label:'Entrenamiento' },
  { key:'suplementos',   col:'suplementos',   label:'Suplementos' }
];

const KEYS_GRASA   = ['desayuno','almuerzo','merienda','cena','ayuno','diaLimpio'];
const MIN_LIMPIO   = 5;

const KCAL_POR_KG = 7700;
const DEFICIT_DIARIO = 600;
const UMBRAL_MUSCULO = 0.75;
const INCERTIDUMBRE_KG = 1.5;

// Barra de músculo: 4 sesiones de fuerza por semana = 100% del entrenamiento;
// el entrenamiento pesa 80% y los suplementos 20%.
const OBJETIVO_ENTRENO_SEMANAL = 4;
const PESO_ENTRENO = 0.8;

const ANTRO_DEFAULT = { peso:84.8, musculo:39.0, grasa:16.9, objetivo:12.9 };

const MONTHS_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let misionesCache = {};

// ============================================================
// HELPERS
// ============================================================
function getTodayStr() { return new Date().toLocaleDateString('en-CA'); }
function dateToStr(d) { return d.toLocaleDateString('en-CA'); }
function getFechaInicio() { return localStorage.getItem('fechaInicio') || FECHA_INICIO_FALLBACK; }
function getFechaFinMision() { return localStorage.getItem('fechaFinMision') || FECHA_FIN_FALLBACK; }
function nf(n, d) { return n.toFixed(d === undefined ? 1 : d).replace('.', ','); }

function getAntro() {
  return {
    peso:     parseFloat(localStorage.getItem('antroPeso'))     || ANTRO_DEFAULT.peso,
    musculo:  parseFloat(localStorage.getItem('antroMusculo'))  || ANTRO_DEFAULT.musculo,
    grasa:    parseFloat(localStorage.getItem('antroGrasa'))    || ANTRO_DEFAULT.grasa,
    objetivo: parseFloat(localStorage.getItem('antroObjetivo')) || ANTRO_DEFAULT.objetivo
  };
}

function defsDelDia(d) { return (d && d.ciclo === 1) ? MISIONES_C1 : MISIONES; }

function countDia(d) {
  if (!d) return 0;
  return defsDelDia(d).reduce((n, m) => n + (d[m.key] ? 1 : 0), 0);
}

function diaVacio() {
  const base = { ciclo: CICLO_ACTUAL, nota: '' };
  for (const m of MISIONES) base[m.key] = false;
  return base;
}

function getTodayMissionData() {
  return misionesCache[getTodayStr()] || diaVacio();
}

// ============================================================
// SUPABASE IO
// ============================================================
async function cargarDesdeSupabase() {
  const { data, error } = await db.from('missions').select('*');
  if (error) { console.error('Error cargando misiones:', error); return; }
  misionesCache = {};
  for (const row of data) {
    const ciclo = row.ciclo || 1;
    const dia = {
      ciclo,
      nota: row.nota || ''
    };
    for (const m of (ciclo === 1 ? MISIONES_C1 : MISIONES)) dia[m.key] = !!row[m.col];
    misionesCache[row.fecha] = dia;
  }
  const { data: configData } = await db.from('config').select('*');
  if (configData) for (const row of configData) localStorage.setItem(row.key, row.value);
  updateUI();
}

async function guardarMision() {
  const fecha = getTodayStr();
  if (fecha < getFechaInicio()) return;
  const prev = misionesCache[fecha] || diaVacio();
  const dia = { ...prev, ciclo: CICLO_ACTUAL };
  const payload = { fecha, ciclo: CICLO_ACTUAL };

  for (const m of MISIONES) {
    const v = document.getElementById(`cb-${m.key}`)?.checked || false;
    dia[m.key] = v;
    payload[m.col] = v;
  }

  misionesCache[fecha] = dia;
  updateUI();

  const { error } = await db.from('missions').upsert(payload, { onConflict: 'fecha' });
  if (error) console.error('Error guardando:', error);
}

// ============================================================
// PROYECCIÓN
// ============================================================
function statsProyeccion() {
  const inicio = new Date(getFechaInicio() + 'T00:00:00');
  const fin = new Date(getFechaFinMision() + 'T00:00:00');
  const hoy = new Date(getTodayStr() + 'T00:00:00');
  const ayer = new Date(hoy.getTime() - 86400000);

  const diasCiclo = Math.max(1, Math.round((fin - inicio) / 86400000));

  const antro = getAntro();
  const deficitKg = Math.max(0, antro.grasa - antro.objetivo);
  const diasLimpiosNecesarios = Math.min(diasCiclo, Math.ceil(deficitKg * KCAL_POR_KG / DEFICIT_DIARIO));
  const umbralGrasa = diasCiclo > 0 ? diasLimpiosNecesarios / diasCiclo : 0;
  const fichasTotal = diasCiclo - diasLimpiosNecesarios;

  let evaluados = 0, limpios = 0, entrenos = 0, supleDias = 0;
  for (let t = inicio.getTime(); t <= ayer.getTime(); t += 86400000) {
    const d = misionesCache[dateToStr(new Date(t))];
    if (d && d.ciclo === 1) continue;
    evaluados++;
    const n = d ? KEYS_GRASA.reduce((a, k) => a + (d[k] ? 1 : 0), 0) : 0;
    if (n >= MIN_LIMPIO) limpios++;
    if (d && d.entrenamiento) entrenos++;
    if (d && d.suplementos) supleDias++;
  }

  const adhGrasa = evaluados > 0 ? limpios / evaluados : 0;

  // Entrenamiento contra objetivo semanal (4/sem = 100%), tope 100%.
  const semanas = evaluados / 7;
  const adhEntreno = semanas > 0
    ? Math.min(1, entrenos / (semanas * OBJETIVO_ENTRENO_SEMANAL)) : 0;
  const adhSuple = evaluados > 0 ? supleDias / evaluados : 0;
  const adhMusculo = evaluados > 0
    ? PESO_ENTRENO * adhEntreno + (1 - PESO_ENTRENO) * adhSuple : 0;

  const fichasUsadas = Math.max(0, evaluados - limpios);

  const perdida = adhGrasa * diasCiclo * DEFICIT_DIARIO / KCAL_POR_KG;
  const grasaProy = Math.max(0, antro.grasa - perdida);

  const diasRestantes = Math.max(0, Math.round((fin - hoy) / 86400000));
  const preCiclo = getTodayStr() < getFechaInicio();

  return {
    diasCiclo, diasRestantes, evaluados, limpios, preCiclo,
    fichasTotal, fichasUsadas,
    adhGrasa, adhMusculo, umbralGrasa,
    entrenos, adhEntreno, adhSuple,
    ritmoEntreno: semanas > 0 ? entrenos / semanas : 0,
    grasaProy, antro,
    diaActual: Math.max(1, Math.min(diasCiclo, Math.round((hoy - inicio) / 86400000) + 1))
  };
}

function renderEstado() {
  const a = getAntro();
  const pgc = a.peso > 0 ? (a.grasa / a.peso) * 100 : 0;
  const delta = a.grasa - a.objetivo;

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('estPeso', `${nf(a.peso)} kg`);
  set('estMusculo', `${nf(a.musculo)} kg`);
  set('estGrasa', `${nf(a.grasa)} kg`);
  set('estPgc', `${nf(pgc)} %`);
  set('estObjetivo', `${nf(a.grasa)} → ${nf(a.objetivo)} kg`);
  set('estNota', delta > 0
    ? `Bajar ${nf(delta)} kg de grasa manteniendo el músculo`
    : 'Objetivo alcanzado en la última medición');
}

function renderProyeccion() {
  const s = statsProyeccion();

  const cicloDia = document.getElementById('cicloDia');
  if (cicloDia) cicloDia.textContent = s.preCiclo
    ? `POR COMENZAR · ${s.diasCiclo} DÍAS`
    : `DÍA ${s.diaActual} DE ${s.diasCiclo}`;

  function barra(pctId, barId, markId, capId, valor, umbral, etiqueta) {
    const pct = Math.round(valor * 100);
    const bar = document.getElementById(barId);
    const mark = document.getElementById(markId);
    const el = document.getElementById(pctId);
    const cap = document.getElementById(capId);
    if (el) {
      el.textContent = s.evaluados > 0 ? `${pct}%` : '—';
      el.classList.toggle('low', s.evaluados > 0 && valor < umbral);
    }
    if (bar) {
      bar.style.width = `${Math.min(100, pct)}%`;
      bar.classList.toggle('low', s.evaluados > 0 && valor < umbral);
    }
    if (mark) mark.style.left = `${Math.round(umbral * 100)}%`;
    if (cap) cap.textContent = `Umbral para la meta: ${Math.round(umbral * 100)}% · ${etiqueta}`;
  }

  barra('adhGrasaPct', 'adhGrasaBar', 'adhGrasaMark', 'adhGrasaCap',
    s.adhGrasa, s.umbralGrasa, `${s.limpios} de ${s.evaluados} días en regla`);
  barra('adhMusculoPct', 'adhMusculoBar', 'adhMusculoMark', 'adhMusculoCap',
    s.adhMusculo, UMBRAL_MUSCULO,
    `${s.entrenos} ${s.entrenos === 1 ? 'entreno' : 'entrenos'} · ${nf(s.ritmoEntreno)}/semana (meta ${OBJETIVO_ENTRENO_SEMANAL})`);

  const fichasTexto = document.getElementById('fichasTexto');
  const restantes = Math.max(0, s.fichasTotal - s.fichasUsadas);
  if (fichasTexto) fichasTexto.textContent = `${restantes} de ${s.fichasTotal} restantes`;

  const grid = document.getElementById('fichasGrid');
  if (grid) {
    let html = '';
    for (let i = 0; i < s.fichasTotal; i++) {
      html += `<i class="${i < s.fichasUsadas ? 'used' : ''}"></i>`;
    }
    grid.innerHTML = html;
  }

  const pv = document.getElementById('proyValor');
  const pr = document.getElementById('proyRango');
  if (pv) pv.textContent = s.evaluados > 0 ? `${nf(s.grasaProy)} kg` : '—';
  if (pr) pr.textContent = s.evaluados > 0
    ? `rango ${nf(s.grasaProy - INCERTIDUMBRE_KG)} – ${nf(s.grasaProy + INCERTIDUMBRE_KG)}`
    : '';

  const ver = document.getElementById('proyVeredicto');
  if (ver) {
    ver.classList.remove('bad', 'warn');
    if (s.preCiclo) {
      ver.textContent = 'EL CICLO AÚN NO COMENZÓ';
    } else if (s.evaluados === 0) {
      ver.textContent = 'SIN DATOS SUFICIENTES';
    } else if (s.adhGrasa >= s.umbralGrasa && s.adhMusculo >= UMBRAL_MUSCULO) {
      ver.innerHTML = 'EN RITMO<br>LA META ESTÁ AL ALCANCE';
    } else if (s.adhGrasa >= s.umbralGrasa) {
      ver.classList.add('warn');
      ver.innerHTML = 'LA GRASA VA EN RITMO<br>EL ENTRENAMIENTO ESTÁ POR DEBAJO';
    } else if (s.adhMusculo >= UMBRAL_MUSCULO) {
      ver.classList.add('warn');
      ver.innerHTML = 'EL MÚSCULO ESTÁ CUBIERTO<br>LA NUTRICIÓN ESTÁ POR DEBAJO';
    } else {
      ver.classList.add('bad');
      ver.innerHTML = `FUERA DE RITMO<br>QUEDAN ${s.diasRestantes} DÍAS`;
    }
  }
}

// ============================================================
// MISIONES
// ============================================================
function renderMisiones() {
  const cont = document.getElementById('misionesLista');
  if (!cont) return;

  const inicio = getFechaInicio();
  if (getTodayStr() < inicio) {
    const [, mes, dia] = inicio.split('-');
    cont.innerHTML = `<div class="m-pre">El ciclo arranca el ${dia}/${mes}. Las misiones se habilitan ese día.</div>`;
    return;
  }

  const data = getTodayMissionData();
  let html = '', grupoPrev = null;

  if (countDia(data) === defsDelDia(data).length) {
    html += `<div class="m-clear">
      <span class="m-clear-t">DESPEJE TOTAL</span>
      <span class="m-clear-s">Todas las misiones del día cumplidas</span>
    </div>`;
  }

  for (const m of MISIONES) {
    if (m.grupo !== grupoPrev) { html += `<div class="m-grp">${m.grupo}</div>`; grupoPrev = m.grupo; }
    html += `<div class="m-row${data[m.key] ? ' done' : ''}">
      <label class="m-check"><input type="checkbox" id="cb-${m.key}"${data[m.key] ? ' checked' : ''}><span class="m-mk"></span></label>
      <span class="m-n">${m.label}</span>
    </div>`;
  }
  cont.innerHTML = html;

  for (const m of MISIONES) {
    document.getElementById(`cb-${m.key}`)?.addEventListener('change', () => {
      const eraPleno = esDiaPleno();
      syncMissionRows();
      guardarMision();
      if (!eraPleno && esDiaPleno()) dispararPlenoFx();
    });
  }
}

function syncMissionRows() {
  document.querySelectorAll('.m-row').forEach(row => {
    const input = row.querySelector('input[type="checkbox"]');
    if (input) row.classList.toggle('done', input.checked);
  });
}

// ============================================================
// DÍA PLENO — todas las misiones del día cumplidas
// ============================================================
function esDiaPleno() {
  if (getTodayStr() < getFechaInicio()) return false;
  const d = getTodayMissionData();
  const total = defsDelDia(d).length;
  return total > 0 && countDia(d) === total;
}

function aplicarEstadoPleno() {
  document.body.classList.toggle('dia-pleno', esDiaPleno());
}

function dispararPlenoFx() {
  const fx = document.getElementById('plenoFlash');
  if (!fx) return;
  fx.classList.remove('go');
  void fx.offsetWidth;               // reinicia la animación
  fx.classList.add('go');
  setTimeout(() => fx.classList.remove('go'), 1800);
}

// ============================================================
// UI PRINCIPAL
// ============================================================
function updateUI() {
  renderMisiones();
  syncMissionRows();
  renderEstado();
  renderProyeccion();
  renderCalendar();
  aplicarEstadoPleno();
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
      const defs = defsDelDia(data);
      const count = countDia(data);
      const ratio = defs.length ? count / defs.length : 0;
      const bar = document.createElement('span');
      bar.className = 'cal-bar';
      const fill = document.createElement('i');
      if (count === 0) {
        cell.classList.add('cal-z');
        fill.style.width = '0%';
      } else {
        if (count === defs.length)   cell.classList.add('cal-full');
        else if (ratio >= 0.75)      cell.classList.add('cal-hi');
        else if (ratio >= 0.5)       cell.classList.add('cal-mid');
        else                         cell.classList.add('cal-low');
        fill.style.width = `${Math.round(ratio * 100)}%`;
      }
      bar.appendChild(fill);
      cell.appendChild(bar);

      if (data.entrenamiento) {
        const e = document.createElement('b');
        e.className = 'cal-e';
        e.textContent = 'E';
        cell.appendChild(e);
      }
    } else if (!isToday) {
      cell.classList.add('cal-miss');
    }

    if (isToday) cell.classList.add('cal-today');

    cell.addEventListener('click', () => {
      if (isFuture) return;
      const detail = document.getElementById('cal-detail');
      if (!detail) return;
      const cab = `<span class="cd-h">${d} DE ${MONTHS_ES[calMonth]} DE ${calYear}</span>`;
      if (!data) {
        detail.innerHTML = `${cab}<br><span class="cd-empty">Sin misiones registradas</span>`;
        return;
      }
      const defs = defsDelDia(data);
      const hechas = countDia(data);
      const marcador = `<span class="cd-count">${hechas}/${defs.length}</span>`;
      const icon = v => v ? '<span class="cd-ok">✓</span>' : '<span class="cd-no">✗</span>';
      const filas = defs.map(m => `${icon(data[m.key])} ${m.label.toUpperCase()}`).join('<br>');
      const c1 = data.ciclo === 1 ? '<br><span class="cd-empty">Registro del Ciclo 1</span>' : '';
      const pleno = hechas === defs.length
        ? '<br><span class="cd-clear">✦ DESPEJE TOTAL</span>' : '';
      detail.innerHTML = `${cab} ${marcador}<br>${filas}${c1}${pleno}`;
    });

    grid.appendChild(cell);
  }
}

// ============================================================
// TIMER
// ============================================================
function iniciarTimerMision() {
  const el = document.getElementById('misionTimer');
  if (!el) return;
  function actualizar() {
    const fin = new Date(getFechaFinMision() + 'T00:00:00');
    const restante = fin.getTime() - Date.now();
    if (restante <= 0) {
      el.innerHTML = '<span class="timer-completada">CICLO COMPLETADO</span>';
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

// ============================================================
// CONFIGURACIÓN
// ============================================================
function abrirConfig() {
  const a = getAntro();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('inputFechaInicio', getFechaInicio());
  set('inputFechaFin', getFechaFinMision());
  set('inputPeso', a.peso);
  set('inputMusculo', a.musculo);
  set('inputGrasa', a.grasa);
  set('inputObjetivo', a.objetivo);
  document.getElementById('configModal').style.display = 'flex';
}

async function guardarConfig() {
  const val = id => document.getElementById(id)?.value;
  const pares = [
    ['fechaInicio',    val('inputFechaInicio')],
    ['fechaFinMision', val('inputFechaFin')],
    ['antroPeso',      val('inputPeso')],
    ['antroMusculo',   val('inputMusculo')],
    ['antroGrasa',     val('inputGrasa')],
    ['antroObjetivo',  val('inputObjetivo')]
  ];
  for (const [k, v] of pares) {
    if (v === undefined || v === '') continue;
    localStorage.setItem(k, v);
    await db.from('config').upsert({ key: k, value: String(v) }, { onConflict: 'key' });
  }
  location.reload();
}

// ============================================================
// GIMNASIO
// ============================================================
// La hoja es texto libre. Va en la tabla config (key/value) como una fila más,
// así viaja a todos los dispositivos con la carga inicial y no hace falta
// una tabla nueva.
const GYM_KEY = 'gymHoja';
let gymTimer = null;
let gymGuardado = null;   // último texto confirmado en Supabase

function gymEstado(txt, cls) {
  const el = document.getElementById('gymEstado');
  if (!el) return;
  el.textContent = txt;
  el.className = 'gym-estado' + (cls ? ' ' + cls : '');
}

// el textarea crece con el contenido: scrollea el overlay, no la caja
function gymAltura(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

async function guardarGym() {
  const ta = document.getElementById('gymHoja');
  if (!ta) return;
  const txt = ta.value;
  if (txt === gymGuardado) return;

  localStorage.setItem(GYM_KEY, txt);
  gymEstado('GUARDANDO…');
  const { error } = await db.from('config')
    .upsert({ key: GYM_KEY, value: txt }, { onConflict: 'key' });

  if (error) {
    // queda en null para que el próximo intento reintente el envío
    gymGuardado = null;
    gymEstado('SIN SINCRONIZAR · GUARDADO ACÁ', 'err');
    console.error('Error guardando gimnasio:', error);
  } else {
    gymGuardado = txt;
    gymEstado('GUARDADO', 'ok');
  }
}

function programarGuardadoGym() {
  gymEstado('ESCRIBIENDO…');
  clearTimeout(gymTimer);
  gymTimer = setTimeout(guardarGym, 800);
}

async function abrirGym() {
  const modal = document.getElementById('gymModal');
  const ta = document.getElementById('gymHoja');
  if (!modal || !ta) return;

  // primero lo que ya está en el dispositivo: abre sin esperar a la red
  ta.value = localStorage.getItem(GYM_KEY) || '';
  gymGuardado = ta.value;
  const abrioCon = ta.value;
  gymEstado(ta.value ? 'GUARDADO' : '', ta.value ? 'ok' : '');
  modal.style.display = 'flex';
  gymAltura(ta);

  // y en paralelo la del servidor, por si se escribió desde otro dispositivo
  const { data } = await db.from('config').select('value').eq('key', GYM_KEY).maybeSingle();
  const remoto = data?.value;
  if (remoto == null || remoto === ta.value) return;
  if (ta.value !== abrioCon) return;   // ya está tipeando: no le pisamos nada
  ta.value = remoto;
  localStorage.setItem(GYM_KEY, remoto);
  gymGuardado = remoto;
  gymAltura(ta);
  gymEstado('ACTUALIZADO', 'ok');
}

function cerrarGym() {
  clearTimeout(gymTimer);
  guardarGym();
  const modal = document.getElementById('gymModal');
  if (modal) modal.style.display = 'none';
}

// ============================================================
// ARISE
// ============================================================
function iniciarArise() {
  const overlay = document.getElementById('ariseOverlay');
  const text = document.getElementById('ariseText');
  const caret = document.getElementById('ariseCaret');
  if (!overlay || !text) return;

  const PALABRA = 'ARISE';
  const INICIO = 220;   // ms hasta la primera letra
  const PASO = 90;      // ms entre pulsación y pulsación
  const timers = [];
  let cerrado = false;

  // se crean todas ocultas: así reservan el ancho final y el cursor avanza
  // sobre la palabra en vez de re-centrarla en cada letra
  text.innerHTML = '';
  const letras = [...PALABRA].map(ch => {
    const s = document.createElement('span');
    s.className = 'arise-ch';
    s.textContent = ch;
    text.appendChild(s);
    return s;
  });

  // offsetLeft/offsetWidth son de layout: no los altera el transform de entrada
  const moverCaret = x => { if (caret) caret.style.transform = 'translateX(' + x + 'px)'; };
  moverCaret(letras[0].offsetLeft);

  letras.forEach((s, idx) => {
    timers.push(setTimeout(() => {
      s.classList.add('on');
      moverCaret(s.offsetLeft + s.offsetWidth);
    }, INICIO + idx * PASO));
  });

  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    timers.forEach(clearTimeout);
    overlay.classList.add('arise-done');
    setTimeout(() => overlay.classList.add('arise-off'), 650);
  };

  // fogonazo + latido + cursor parpadeando cuando la última letra se asienta
  const finTipeo = INICIO + (letras.length - 1) * PASO + 370;
  timers.push(setTimeout(() => overlay.classList.add('arise-charged'), finTipeo));
  // cierre automático
  timers.push(setTimeout(cerrar, finTipeo + 1100));

  overlay.addEventListener('click', cerrar);
}

// ============================================================
// PROTOCOLO NUTRICIONAL
// ============================================================
const EQ_GRASA = [
  '¼ de palta',
  '1 cda sopera de aceite de oliva o coco',
  '8 aceitunas',
  '6 nueces, almendras o pistachos',
  '1 cda sopera de semillas (chía, lino, sésamo, girasol)',
  '2 cdas soperas de harina de frutos secos o semillas',
  '¼ taza de leche vegetal',
  '1 tostada de esas harinas'
];

// Combinaciones de despensa, nada de recetas largas. "Cubre" dice contra qué
// casillero del almuerzo se descuenta: solo el aceite y la palta gastan la grasa,
// el resto de los condimentos no ocupa nada.
const SALSAS = [
  { n:'ACEITE Y LIMÓN', c:'CUBRE LA GRASA',
    i:'1 cda sopera de aceite de oliva, jugo de limón y sal.' },
  { n:'VINAGRETA DE MANZANA', c:'CUBRE LA GRASA',
    i:'1 cda sopera de aceite de oliva, un chorro de vinagre de manzana, sal y pimienta.' },
  { n:'VINAGRETA DE MOSTAZA', c:'CUBRE LA GRASA',
    i:'1 cda sopera de aceite de oliva, 1 cdita de mostaza y vinagre de manzana. Batido queda espeso y se pega a la hoja.' },
  { n:'PALTA Y LIMÓN', c:'CUBRE LA GRASA',
    i:'¼ de palta pisada con limón y sal. Sin aceite: la palta ya es la grasa del plato.' },
  { n:'MOSTAZA Y LIMÓN', c:'LIBRE',
    i:'Mostaza sin azúcar, limón y pimienta. Al no llevar aceite te queda la grasa libre para otra cosa.' },
  { n:'LIMÓN, AJO Y ORÉGANO', c:'LIBRE',
    i:'Jugo de limón con ajo rallado, orégano y ají molido. Va bien sobre la carne recién salida del fuego.' }
];

// Lo que queda afuera aunque parezca inofensivo
const SALSAS_VETO = 'Salsa de soja y teriyaki (soja), kétchup y salsas de frasco (azúcar y jarabe de maíz), ' +
  'crema, manteca y quesos de vaca, maicena para espesar (maíz) y cualquier salsa ligada con harina de trigo.';

const PLAN = [
  {
    t:'AYUNO 12 H',
    s:'Reposo digestivo entre la cena y el desayuno',
    b:[
      { tipo:'regla', txt:'12 horas. El plan aclara que no hay que extenderlo más.' },
      { tipo:'texto', txt:'Cenás cerca de las 21 y no volvés a comer hasta las 9. Ese es el rango, no un mínimo a superar.' }
    ]
  },
  {
    t:'DESAYUNO Y MERIENDA',
    s:'Infusión + 3 proteínas + 2 grasas + 1 fruta o 1 carbo',
    b:[
      { tipo:'lista', h:'PROTEÍNA · elegís 3', items:['1 huevo','2 claras','30 g de queso de cabra'] },
      { tipo:'lista', h:'GRASA · elegís 2', items:EQ_GRASA },
      { tipo:'lista', h:'CARBO · elegís 1', items:['1 tostada de sarraceno o quinoa','2 tostadas de arroz','2 cdas soperas de las harinas'] },
      { tipo:'ej', h:'EJEMPLOS', items:[
        'Tostada de sarraceno con 2 huevos revueltos, queso de cabra y almendras',
        'Pancake de 2 huevos y 2 claras con harina de almendras, nueces y banana',
        'Tortilla de 3 huevos con aceitunas y semillas, más 2 tostadas de arroz',
        'Revuelto de 2 huevos y 30 g de queso de cabra con palta y aceite de oliva'
      ]},
      { tipo:'regla', txt:'Solo en la merienda: batido de proteína + 1 fruta como variante.' }
    ]
  },
  {
    t:'ALMUERZO',
    s:'200 g cocidos de proteína animal + medio plato de vegetales crudos + 1 carbo + 1 grasa',
    b:[
      { tipo:'lista', h:'PROTEÍNA · 200 g cocidos', items:['Vaca','Cerdo','Pollo','Pescado'] },
      { tipo:'lista', h:'VEGETALES CRUDOS · sin límite', items:['Pepino, tomate, zanahoria','Rúcula, apio, rabanito','Albahaca y demás verdes'] },
      { tipo:'lista', h:'CARBO · elegís 1', items:['150–180 g cocidos de grano o cereal sin TACC','200 g de tubérculos','4 cdas soperas de harinas sin TACC'] },
      { tipo:'regla', txt:'Los 150–180 g del grano son ya cocido, servido en el plato. Son unos 60 g pesados en crudo: el arroz y la quinoa casi triplican su peso al hervirse.' },
      { tipo:'lista', h:'GRASA · elegís 1', items:EQ_GRASA },
      { tipo:'salsas', h:'SALSAS · qué casillero ocupa cada una', items:SALSAS },
      { tipo:'regla', txt:'Sal, pimienta, ajo, limón, vinagre de manzana, mostaza sin azúcar y las hierbas secas no gastan nada: combinalas como quieras. Los únicos que ocupan la grasa del plato son el aceite de oliva y la palta, y va uno solo por comida. Todo esto sirve igual para la cena.' },
      { tipo:'ej', h:'EJEMPLOS', items:[
        'Pechuga de pollo con quinoa y ensalada de rúcula, tomate y pepino',
        'Bife con papas y ensalada, terminado con aceite de oliva',
        'Merluza con arroz, zanahoria rallada, apio y aceitunas',
        'Cerdo con batata, ensalada verde y nueces'
      ]}
    ]
  },
  {
    t:'CENA',
    s:'Igual al almuerzo, pero sin carbohidrato',
    b:[
      { tipo:'texto', txt:'200 g cocidos de proteína animal, medio plato de vegetales crudos y 1 grasa. Sin grano, sin tubérculo, sin harina.' },
      { tipo:'ej', h:'EJEMPLOS', items:[
        'Tortilla soufflé de verduras con pollo al horno',
        'Bowl de vegetales crudos con pollo y palta',
        'Pescado al horno con ensalada grande y aceite de oliva',
        'Carne con zucchini y berenjena, más semillas por encima'
      ]},
      { tipo:'regla', txt:'Postre opcional: 1 barrita de chocolate amargo al 80 % o media taza de frutos rojos congelados.' }
    ]
  },
  {
    t:'DESACONSEJADOS',
    s:'Lo que rompe el día limpio',
    veto:true,
    b:[
      { tipo:'lista', h:'FUERA', items:[
        'Granos y cereales con gluten',
        'Lácteos de vaca. De otro animal sí',
        'Galletitas, panificados industriales, embutidos, snacks',
        'Azúcar refinada, jarabe de maíz, edulcorantes artificiales',
        'Alcohol y exceso de cafeína',
        'Soja, maní y derivados',
        'Maíz y derivados'
      ]},
      { tipo:'regla', txt:'Salsas: ' + SALSAS_VETO }
    ]
  },
  {
    t:'SUPLEMENTOS',
    s:'Omega 3 + creatina',
    b:[
      { tipo:'texto', txt:'Sostenidos todos los días. La creatina es de lo poco que protege masa magra mientras bajás grasa.' }
    ]
  }
];

function renderPlan() {
  const cont = document.getElementById('planBody');
  if (!cont) return;
  cont.innerHTML = PLAN.map((sec, i) => {
    const cuerpo = sec.b.map(bl => {
      if (bl.tipo === 'texto') return `<p class="pl-p">${bl.txt}</p>`;
      if (bl.tipo === 'regla') return `<div class="pl-regla">${bl.txt}</div>`;
      if (bl.tipo === 'salsas') return `<div class="pl-blk">
        <div class="pl-blk-h">${bl.h}</div>
        <ul class="pl-sal">${bl.items.map(s => `<li>
          <div class="sal-n">${s.n}</div>
          <div class="sal-c">${s.c}</div>
          <div class="sal-i">${s.i}</div>
        </li>`).join('')}</ul>
      </div>`;
      const cls = bl.tipo === 'ej' ? 'pl-ej' : 'pl-eq';
      return `<div class="pl-blk">
        <div class="pl-blk-h">${bl.h}</div>
        <ul class="${cls}">${bl.items.map(x => `<li>${x}</li>`).join('')}</ul>
      </div>`;
    }).join('');
    return `<div class="pl-sec${sec.veto ? ' veto' : ''}" data-i="${i}">
      <button class="pl-tog">
        <span class="pl-t">${sec.t}</span>
        <span class="pl-ch"></span>
      </button>
      <div class="pl-s">${sec.s}</div>
      <div class="pl-x">${cuerpo}</div>
    </div>`;
  }).join('');

  cont.querySelectorAll('.pl-tog').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.pl-sec').classList.toggle('open'));
  });
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  iniciarArise();
  updateUI();
  cargarDesdeSupabase();

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  document.getElementById('btnConfig')?.addEventListener('click', abrirConfig);
  document.getElementById('btnGuardarConfig')?.addEventListener('click', guardarConfig);
  document.getElementById('btnCerrarConfig')?.addEventListener('click', () => {
    document.getElementById('configModal').style.display = 'none';
  });
  document.getElementById('configModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('configModal'))
      document.getElementById('configModal').style.display = 'none';
  });

  const proyInfo = document.getElementById('proyInfoModal');
  const abrirProyInfo = () => { if (proyInfo) proyInfo.style.display = 'flex'; };
  document.getElementById('btnProyInfo')?.addEventListener('click', abrirProyInfo);
  document.getElementById('btnMusculoInfo')?.addEventListener('click', abrirProyInfo);
  document.getElementById('btnCerrarProyInfo')?.addEventListener('click', () => {
    if (proyInfo) proyInfo.style.display = 'none';
  });
  proyInfo?.addEventListener('click', e => {
    if (e.target === proyInfo) proyInfo.style.display = 'none';
  });

  renderPlan();
  document.getElementById('btnPlan')?.addEventListener('click', () => {
    document.getElementById('planModal').style.display = 'flex';
  });
  document.getElementById('btnCerrarPlan')?.addEventListener('click', () => {
    document.getElementById('planModal').style.display = 'none';
  });
  document.getElementById('planModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('planModal'))
      document.getElementById('planModal').style.display = 'none';
  });

  const gymModal = document.getElementById('gymModal');
  document.getElementById('btnGym')?.addEventListener('click', abrirGym);
  document.getElementById('btnCerrarGym')?.addEventListener('click', cerrarGym);
  gymModal?.addEventListener('click', e => { if (e.target === gymModal) cerrarGym(); });
  document.getElementById('gymHoja')?.addEventListener('input', e => {
    gymAltura(e.target);
    programarGuardadoGym();
  });
  // salir de la app en el teléfono cuenta como cerrar: guarda lo tipeado
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gymModal?.style.display === 'flex') {
      clearTimeout(gymTimer);
      guardarGym();
    }
  });

  iniciarTimerMision();
});
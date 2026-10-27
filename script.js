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
  { key:'desayuno',      col:'desayuno',      label:'Desayuno',           grupo:'NUTRICIÓN', xp:10 },
  { key:'almuerzo',      col:'almuerzo',      label:'Almuerzo',           grupo:'NUTRICIÓN', xp:10 },
  { key:'merienda',      col:'merienda',      label:'Merienda',           grupo:'NUTRICIÓN', xp:10 },
  { key:'cena',          col:'cena',          label:'Cena',               grupo:'NUTRICIÓN', xp:10 },
  { key:'ayuno',         col:'ayuno',         label:'Ayuno 12 h',         grupo:'PROTOCOLO', xp:10 },
  { key:'diaLimpio',     col:'dia_limpio',    label:'Día limpio',         grupo:'PROTOCOLO', xp:10 },
  { key:'entrenamiento', col:'entrenamiento', label:'Entrenamiento',      grupo:'CUERPO',    xp:25 },
  { key:'suplementos',   col:'suplementos',   label:'Omega 3 + creatina', grupo:'CUERPO',    xp:10 }
];

const MISIONES_C1 = [
  { key:'nutricion',     col:'nutricion',     label:'Nutrición',     xp:40 },
  { key:'entrenamiento', col:'entrenamiento', label:'Entrenamiento', xp:25 },
  { key:'suplementos',   col:'suplementos',   label:'Suplementos',   xp:10 }
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
  datosCargados = true;
  updateUI();
  chequearAscensos(0);
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
    fichasTotal, fichasUsadas, diasLimpiosNecesarios,
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
      <span class="m-xp">+${m.xp} XP</span>
    </div>`;
  }
  cont.innerHTML = html;

  for (const m of MISIONES) {
    document.getElementById(`cb-${m.key}`)?.addEventListener('change', e => {
      const eraPleno = esDiaPleno();
      const xpAntes = xpDia(getTodayMissionData());
      // guardarMision re-dibuja la lista: la posición se toma antes
      const rect = e.target.closest('.m-row')?.getBoundingClientRect();
      syncMissionRows();
      guardarMision();
      const delta = xpDia(getTodayMissionData()) - xpAntes;
      if (rect && delta) { flotarXp(rect, delta); pulsoXp(); }
      const pleno = !eraPleno && esDiaPleno();
      if (pleno) dispararPlenoFx();
      // si además sube de nivel, la notificación espera a que pase el dorado
      chequearAscensos(pleno ? 1500 : 250);
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
  renderCazador();
  if (evoVisto) renderEvolucion(false);
  renderCalendar();
  aplicarEstadoPleno();
}

// ============================================================
// NIVEL Y XP
// ============================================================
// El XP se recalcula siempre desde el historial de misiones: no se guarda
// aparte, así que es el mismo en cualquier dispositivo.
const XP_DESPEJE = 50;      // bonus por cerrar las 8 del día
const XP_DESPEJE_C1 = 30;   // bonus por cerrar las 3 del ciclo 1
let datosCargados = false;

function xpDia(d) {
  if (!d) return 0;
  const defs = defsDelDia(d);
  let xp = 0;
  for (const m of defs) if (d[m.key]) xp += m.xp;
  if (countDia(d) === defs.length) xp += d.ciclo === 1 ? XP_DESPEJE_C1 : XP_DESPEJE;
  return xp;
}

function xpTotal() {
  const hoy = getTodayStr();
  let xp = 0;
  for (const f in misionesCache) if (f <= hoy) xp += xpDia(misionesCache[f]);
  return xp;
}

// cada nivel pide 4 XP más que el anterior: 100, 104, 108…
function xpParaSubir(nivel) { return 100 + 4 * (nivel - 1); }

function nivelDe(xp) {
  let nivel = 1, resto = xp;
  while (resto >= xpParaSubir(nivel)) { resto -= xpParaSubir(nivel); nivel++; }
  return { nivel, actual: resto, necesario: xpParaSubir(nivel), total: xp };
}

function miles(n) { return Math.round(n).toLocaleString('es-AR'); }

// ============================================================
// RANGO DE CAZADOR
// ============================================================
// Sale de las dos barras de la proyección (60% grasa, 40% músculo), sobre los
// días ya cerrados del ciclo: se gana sosteniendo, no tildando un día suelto.
const RANGOS = [
  { r:'E', min:0,    titulo:'DESPERTADO' },
  { r:'D', min:0.45, titulo:'APRENDIZ' },
  { r:'C', min:0.58, titulo:'CAZADOR' },
  { r:'B', min:0.70, titulo:'VETERANO' },
  { r:'A', min:0.80, titulo:'ÉLITE' },
  { r:'S', min:0.90, titulo:'MONARCA DE LAS SOMBRAS' }
];
const PESO_RANGO_GRASA = 0.6;

function rangoActual(s) {
  s = s || statsProyeccion();
  const evaluado = s.evaluados > 0;
  const score = evaluado
    ? PESO_RANGO_GRASA * s.adhGrasa + (1 - PESO_RANGO_GRASA) * s.adhMusculo : 0;
  let idx = 0;
  RANGOS.forEach((x, i) => { if (score >= x.min) idx = i; });
  return { ...RANGOS[idx], idx, score, evaluado };
}

function emblemaHTML(r, cls) {
  return `<span class="rk-emb${cls ? ' ' + cls : ''}" data-rk="${r}">` +
    '<svg viewBox="0 0 60 68" aria-hidden="true">' +
    '<polygon class="rk-o" points="30,2 57,17.5 57,50.5 30,66 3,50.5 3,17.5"/>' +
    '<polygon class="rk-i" points="30,9 51,21 51,47 30,59 9,47 9,21"/>' +
    `</svg><b>${r}</b></span>`;
}

function renderCazador() {
  const lv = nivelDe(xpTotal());
  const rk = rangoActual();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  const emb = document.getElementById('hunterEmb');
  if (emb && emb.dataset.rk !== rk.r) { emb.dataset.rk = rk.r; emb.innerHTML = emblemaHTML(rk.r); }
  set('hunterNivel', lv.nivel);
  set('hunterTitulo', `RANGO ${rk.r} · ${rk.titulo}`);
  set('xpTexto', `${miles(lv.actual)} / ${miles(lv.necesario)} XP`);
  set('xpHoy', `+${xpDia(misionesCache[getTodayStr()])} HOY`);
  const fill = document.getElementById('xpFill');
  if (fill) fill.style.width = `${(lv.actual / lv.necesario) * 100}%`;
}

function pulsoXp() {
  const h = document.getElementById('btnHunter');
  if (!h) return;
  h.classList.remove('gain');
  void h.offsetWidth;
  h.classList.add('gain');
}

function flotarXp(rect, xp) {
  const el = document.createElement('span');
  el.className = 'xp-float' + (xp < 0 ? ' neg' : '') + (xp > 30 ? ' big' : '');
  el.textContent = (xp > 0 ? '+' : '−') + Math.abs(xp) + ' XP';
  el.style.left = (rect.right - 14) + 'px';
  el.style.top = (rect.top + rect.height / 2) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function renderRangoModal() {
  const body = document.getElementById('rangoBody');
  if (!body) return;
  const lv = nivelDe(xpTotal());
  const rk = rangoActual();
  const sig = RANGOS[rk.idx + 1];
  const pct = Math.round(rk.score * 100);
  const falta = sig ? Math.max(1, Math.ceil((sig.min - rk.score) * 100)) : 0;

  const escalera = RANGOS.slice().reverse().map(x => {
    const i = RANGOS.indexOf(x);
    const st = i === rk.idx ? 'cur' : i < rk.idx ? 'done' : 'lock';
    return `<li class="${st}">${emblemaHTML(x.r, 'sm')}
      <span class="rg-n">RANGO ${x.r}<em>${x.titulo}</em></span>
      <span class="rg-min">${i === rk.idx ? 'ACTUAL' : x.min ? '≥ ' + Math.round(x.min * 100) + '%' : 'BASE'}</span>
    </li>`;
  }).join('');

  body.innerHTML = `
    <div class="rg-hero">
      ${emblemaHTML(rk.r, 'big')}
      <div class="rg-hero-t">CAZADOR DE RANGO ${rk.r}</div>
      <div class="rg-hero-s" data-rk="${rk.r}">${rk.titulo}</div>
    </div>
    <div class="rg-lv">
      <div class="rg-lv-row"><span class="rg-lv-n">NIVEL <b>${lv.nivel}</b></span><span class="rg-lv-x">${miles(lv.total)} XP TOTAL</span></div>
      <div class="xp-track"><i class="xp-fill" style="width:${(lv.actual / lv.necesario) * 100}%"></i></div>
      <div class="rg-lv-cap">${miles(lv.necesario - lv.actual)} XP para el nivel ${lv.nivel + 1}</div>
    </div>
    <div class="cfg-section-title">ESCALAFÓN</div>
    <div class="rg-score">${rk.evaluado
      ? `Adherencia combinada <b>${pct}%</b>` + (sig ? ` · te faltan <b>${falta}</b> puntos para el rango ${sig.r}` : ' · rango máximo')
      : 'El rango se calcula desde el segundo día del ciclo'}</div>
    <ul class="rg-ladder">${escalera}</ul>
    <div class="info-block">
      <div class="info-h">Cómo se gana XP</div>
      <ul class="rg-xp">
        <li><span>Cada comida, el ayuno, el día limpio y los suplementos</span><b>+10</b></li>
        <li><span>Entrenamiento</span><b>+25</b></li>
        <li><span>Despeje total: las 8 del día</span><b>+${XP_DESPEJE}</b></li>
      </ul>
      <p>Cuenta todo el historial, ciclo 1 incluido. Cada nivel pide 4 XP más que el anterior.</p>
    </div>
    <div class="info-block">
      <div class="info-h">Cómo se calcula el rango</div>
      <p>Sale de las dos barras de la proyección: 60 % la de grasa y 40 % la de músculo, sobre los días ya cerrados del ciclo. Se recalcula cada día, así que si aflojás, baja. El nivel no se pierde; el rango hay que sostenerlo.</p>
    </div>`;
}

// la guía del nivel se arma con los números del momento, así cada cosa que
// explica es la misma que se ve en la tarjeta
function renderNivelInfo() {
  const body = document.getElementById('nivelInfoBody');
  if (!body) return;
  const lv = nivelDe(xpTotal());
  const rk = rangoActual();
  const hoy = xpDia(misionesCache[getTodayStr()]);
  const perfecto = MISIONES.reduce((n, m) => n + m.xp, 0) + XP_DESPEJE;
  const falta = lv.necesario - lv.actual;
  const dias = Math.ceil(falta / perfecto);

  body.innerHTML = `
    <div class="info-block">
      <div class="info-h">Qué es cada cosa de la tarjeta</div>
      <ul class="nv-key">
        <li><span class="nv-chip">NV.<b>${lv.nivel}</b></span>
          <p><b>Tu nivel.</b> Sube a medida que juntás XP (puntos de experiencia) y nunca baja.</p></li>
        <li><span class="nv-chip nv-chip-bar"><i style="width:${(lv.actual / lv.necesario) * 100}%"></i></span>
          <p><b>La barra.</b> Cuánto llevás del nivel ${lv.nivel}. Cuando se llena pasás al ${lv.nivel + 1} y arranca de cero.</p></li>
        <li><span class="nv-chip">${miles(lv.actual)} / ${miles(lv.necesario)}</span>
          <p><b>Los números de la barra.</b> Tenés ${miles(lv.actual)} XP de los ${miles(lv.necesario)} que pide este nivel: te faltan ${miles(falta)}.</p></li>
        <li><span class="nv-chip nv-chip-hoy">+${hoy} HOY</span>
          <p><b>Lo de hoy.</b> El XP que sumaste hoy con lo que tildaste. Si destildás algo, se descuenta.</p></li>
        <li><span class="nv-chip nv-chip-rk">${emblemaHTML(rk.r, 'sm')}</span>
          <p><b>El emblema: rango ${rk.r}, ${rk.titulo.toLowerCase()}.</b> Es otra cosa: no sale del XP sino de qué tan parejo venís cumpliendo este ciclo.</p></li>
      </ul>
    </div>
    <div class="info-block">
      <div class="info-h">Cómo se gana XP</div>
      <ul class="rg-xp">
        <li><span>Cada comida, el ayuno, el día limpio y los suplementos</span><b>+10</b></li>
        <li><span>Entrenamiento</span><b>+25</b></li>
        <li><span>Despeje total: las 8 del día</span><b>+${XP_DESPEJE}</b></li>
        <li class="nv-total"><span>Un día perfecto</span><b>${perfecto} XP</b></li>
      </ul>
    </div>
    <div class="info-block">
      <div class="info-h">Cuánto pide cada nivel</div>
      <p>El nivel 1 pide 100 XP y cada nivel pide 4 más que el anterior: el ${lv.nivel} pide ${miles(lv.necesario)}. Así que cuanto más alto, más cuesta subir. Con días perfectos te faltan ${dias === 1 ? '1 día' : dias + ' días'} para el ${lv.nivel + 1}.</p>
    </div>
    <div class="info-block">
      <div class="info-h">Nivel o rango</div>
      <p>El <b>nivel</b> mide cuánto trabajaste en total, con todo el historial (ciclo 1 incluido): sólo sube. El <b>rango</b> (de E a S) mide cómo venís sosteniendo este ciclo, y si aflojás baja. Tocá la tarjeta para ver el escalafón de rangos.</p>
    </div>`;
}

// ============================================================
// NOTIFICACIONES DEL SISTEMA — subida de nivel y de rango
// ============================================================
function chequearAscensos(delay) {
  if (!datosCargados) return;
  const lv = nivelDe(xpTotal());
  const rk = rangoActual();
  const nvVisto = parseInt(localStorage.getItem('nivelVisto'), 10);
  const rkVisto = RANGOS.findIndex(x => x.r === localStorage.getItem('rangoVisto'));

  if (!nvVisto) {
    // primera vez en este dispositivo: el sistema presenta al cazador
    localStorage.setItem('nivelVisto', lv.nivel);
    if (rk.evaluado) localStorage.setItem('rangoVisto', rk.r);
    encolarAlerta({ tipo:'despertar', nivel: lv.nivel, rango: rk }, delay);
    return;
  }
  // el máximo visto: destildar y volver a tildar no repite la fanfarria
  if (lv.nivel > nvVisto) {
    localStorage.setItem('nivelVisto', lv.nivel);
    encolarAlerta({ tipo:'nivel', de: nvVisto, a: lv.nivel }, delay);
  }
  if (rk.evaluado && rk.idx !== rkVisto) {
    if (rkVisto >= 0 && rk.idx > rkVisto) encolarAlerta({ tipo:'rango', de: RANGOS[rkVisto], a: rk }, delay);
    localStorage.setItem('rangoVisto', rk.r);
  }
}

const alertas = [];
let alertaActiva = false;

function encolarAlerta(a, delay) {
  setTimeout(() => {
    alertas.push(a);
    if (!alertaActiva) siguienteAlerta();
  }, delay || 0);
}

function siguienteAlerta() {
  if (!alertas.length) { alertaActiva = false; return; }
  alertaActiva = true;
  // no se pisa con la intro
  const arise = document.getElementById('ariseOverlay');
  if (arise && !arise.classList.contains('arise-off')) { setTimeout(siguienteAlerta, 200); return; }
  mostrarAlerta(alertas.shift());
}

function mostrarAlerta(a) {
  const ov = document.getElementById('sysAlert');
  if (!ov) { alertaActiva = false; return; }
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  ov.className = 'sys-alert';
  delete ov.dataset.rk;
  let titulo, core, sub, dura = 3400;

  if (a.tipo === 'nivel') {
    titulo = '¡HAS SUBIDO DE NIVEL!';
    core = `<div class="sa-lv-l">NIVEL</div>
      <div class="sa-roll"><span class="sa-old">${a.de}</span><span class="sa-new">${a.a}</span></div>`;
    const lv = nivelDe(xpTotal());
    sub = `Próximo nivel en ${miles(lv.necesario - lv.actual)} XP`;
  } else if (a.tipo === 'rango') {
    ov.classList.add('sa-rank');
    ov.dataset.rk = a.a.r;
    titulo = 'RANGO ASCENDIDO';
    core = `<div class="sa-rk-row">
      <span class="sa-rk-old">${emblemaHTML(a.de.r)}</span>
      <span class="sa-arrow"></span>
      ${emblemaHTML(a.a.r, 'big')}
    </div>`;
    sub = `CAZADOR DE RANGO ${a.a.r} · ${a.a.titulo}`;
    dura = 3800;
  } else {
    ov.classList.add('sa-rank', 'sa-wake');
    ov.dataset.rk = a.rango.r;
    titulo = 'EL SISTEMA TE RECONOCE';
    core = `<div class="sa-wake-row">
      ${emblemaHTML(a.rango.r, 'big')}
      <div class="sa-wake-lv"><div class="sa-lv-l">NIVEL</div><div class="sa-num">${a.nivel}</div></div>
    </div>`;
    sub = `CAZADOR DE RANGO ${a.rango.r} · ${a.rango.titulo}`;
    dura = 4200;
  }

  set('saTitulo', titulo);
  set('saCore', core);
  set('saSub', sub);
  set('saPts', Array.from({ length: 26 }, () =>
    `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(Math.random() * 1.6).toFixed(2)}s;` +
    `--t:${(1.8 + Math.random() * 1.8).toFixed(2)}s;--s:${(2 + Math.random() * 3).toFixed(1)}px"></i>`).join(''));

  ov.hidden = false;
  // el navegador solo deja vibrar después de un toque en la página
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate([25, 50, 70]);

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(t);
    ov.classList.add('out');
    setTimeout(() => {
      ov.hidden = true;
      ov.classList.remove('out');
      siguienteAlerta();
    }, 450);
  };
  const t = setTimeout(cerrar, dura);
  ov.onclick = cerrar;
}

// ============================================================
// EVOLUCIÓN
// ============================================================
// Las mediciones (balanza o InBody) viajan como un JSON en la tabla config,
// igual que la hoja del gimnasio.
const MED_KEY = 'mediciones';
const KG_POR_DIA_LIMPIO = DEFICIT_DIARIO / KCAL_POR_KG;
const MESES3 = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const EVO_UNIDADES = { grasa:'GRASA', peso:'PESO', musculo:'MÚSCULO' };
const EVO_SUB = {
  grasa:   'Kilos de grasa. La línea celeste se calcula con tus días en regla; los rombos naranjas son mediciones reales.',
  peso:    'Peso en kilos. Arranca en el InBody y baja lo mismo que la grasa, porque se supone que el músculo se mantiene.',
  musculo: 'Masa muscular. No se puede calcular con los tildes: sólo se ven tus mediciones. La línea verde es el piso.'
};
let evoMetrica = 'grasa';
let evoVisto = false;

function getMediciones() {
  try {
    const lista = JSON.parse(localStorage.getItem(MED_KEY) || '[]');
    return Array.isArray(lista) ? lista.sort((a, b) => a.fecha < b.fecha ? -1 : 1) : [];
  } catch (e) { return []; }
}

async function guardarMediciones(lista) {
  const txt = JSON.stringify(lista);
  localStorage.setItem(MED_KEY, txt);
  const { error } = await db.from('config').upsert({ key: MED_KEY, value: txt }, { onConflict: 'key' });
  if (error) console.error('Error guardando mediciones:', error);
}

function serieEvolucion(metrica) {
  const s = statsProyeccion();
  const a = s.antro;
  const N = s.diasCiclo;
  const inicio = new Date(getFechaInicio() + 'T00:00:00');
  const fecha = i => { const d = new Date(inicio); d.setDate(d.getDate() + i); return d; };
  const idxDe = f => Math.round((new Date(f + 'T00:00:00') - inicio) / 86400000);
  const hoyIdx = Math.max(0, Math.min(N, idxDe(getTodayStr())));
  const base = metrica === 'grasa' ? a.grasa : metrica === 'peso' ? a.peso : a.musculo;

  // grasa y peso bajan lo mismo: el modelo asume que el músculo se sostiene
  let est = null, proy = null;
  const bajar = metrica === 'musculo' ? 0 : Math.max(0, a.grasa - a.objetivo);
  if (metrica !== 'musculo') {
    est = [base];
    let limpios = 0;
    for (let i = 0; i < hoyIdx; i++) {
      const d = misionesCache[dateToStr(fecha(i))];
      if (d && d.ciclo !== 1 && KEYS_GRASA.reduce((n, k) => n + (d[k] ? 1 : 0), 0) >= MIN_LIMPIO) limpios++;
      est.push(base - limpios * KG_POR_DIA_LIMPIO);
    }
    const ritmo = s.adhGrasa * KG_POR_DIA_LIMPIO;
    const tramo = N - hoyIdx;
    proy = [];
    for (let i = hoyIdx; i <= N; i++) proy.push({
      i, v: est[hoyIdx] - (i - hoyIdx) * ritmo,
      u: tramo > 0 ? INCERTIDUMBRE_KG * (i - hoyIdx) / tramo : 0
    });
  }

  const meds = [{ i: 0, v: base, base: true, fecha: getFechaInicio() }];
  for (const m of getMediciones()) {
    const v = parseFloat(m[metrica]);
    const i = idxDe(m.fecha);
    if (!(v > 0) || i < 0 || i > N) continue;
    if (i === 0) meds[0].v = v;
    else meds.push({ i, v, fecha: m.fecha });
  }

  return { s, N, hoyIdx, base, est, proy, meds, fecha, meta: { de: base, a: base - bajar } };
}

function evoValor(S, i) {
  if (!S.est) return null;
  return i <= S.hoyIdx ? S.est[i] : S.proy[i - S.hoyIdx].v;
}

// el plan es la recta del inicio a la meta: dónde tendrías que estar cada día
function evoPlan(S, i) { return S.meta.de + (S.meta.a - S.meta.de) * i / S.N; }

function evoFecha(S, i) { const f = S.fecha(i); return `${f.getDate()} ${MESES3[f.getMonth()]}`; }

// La diferencia sale de los números ya redondeados como se muestran, con dos
// decimales si es chica: así nunca se lee "13,2 contra 13,1: 0,03 kg".
// Quien la muestre tiene que escribir los dos valores con esos mismos decimales.
function evoComparar(v, ref) {
  const dec = Math.abs(v - ref) < 0.1 ? 2 : 1;
  const r = n => Math.round(n * 10 ** dec) / 10 ** dec;
  return { dec, d: r(v) - r(ref) };
}

// en grasa y peso, quedar por debajo del plan es ir adelantado; en músculo,
// lo bueno es quedar por encima del piso
function evoVsPlan(S, v, i) {
  const { dec, d } = evoComparar(v, evoPlan(S, i));
  const musc = evoMetrica === 'musculo';
  const n = nf(Math.abs(d), dec);
  if (Math.abs(d) < 1e-9) return { txt: musc ? 'justo en el piso' : 'al día con el plan', cls: '', dec };
  if (musc) return d > 0 ? { txt: `${n} kg sobre el piso`, cls: 'up', dec } : { txt: `${n} kg bajo el piso`, cls: 'dn', dec };
  return d < 0 ? { txt: `${n} kg adelantado`, cls: 'up', dec } : { txt: `${n} kg atrasado`, cls: 'dn', dec };
}

function renderEvolucion(animar) {
  const cont = document.getElementById('evoChart');
  if (!cont) return;
  const S = serieEvolucion(evoMetrica);
  const musc = evoMetrica === 'musculo';

  const W = Math.max(260, cont.clientWidth), H = 216;
  const M = { l: 34, r: 42, t: 22, b: 24 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;

  const vals = [S.meta.de, S.meta.a, ...S.meds.map(p => p.v)];
  if (S.est) vals.push(...S.est);
  if (S.proy) S.proy.forEach(p => vals.push(p.v - p.u, p.v + p.u));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1; }
  const crudo = (hi - lo) * 1.16 / 4;
  const paso = [0.25, 0.5, 1, 2, 5, 10].find(p => p >= crudo) || 10;
  const margen = (hi - lo) * 0.08;
  lo = Math.floor((lo - margen) / paso) * paso;
  hi = Math.ceil((hi + margen) / paso) * paso;

  const x = i => M.l + (i / S.N) * pw;
  const y = v => M.t + (1 - (v - lo) / (hi - lo)) * ph;
  const xy = (i, v) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  const linea = pts => pts.map((p, k) => (k ? 'L' : 'M') + xy(p.i, p.v)).join('');
  const dec = paso < 1 ? 1 : 0;
  const yBase = M.t + ph;

  let g = '';
  // grilla y eje Y
  for (let v = lo; v <= hi + 1e-9; v += paso) {
    g += `<line class="ev-grid" x1="${M.l}" x2="${M.l + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="ev-ax" x="${M.l - 7}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${nf(v, dec)}</text>`;
  }
  // eje X: inicio de cada mes (con el día si el ciclo no arranca un 1°)
  for (let i = 0; i <= S.N; i++) {
    const f = S.fecha(i);
    if (f.getDate() !== 1 && i !== 0) continue;
    const lbl = f.getDate() === 1 ? MESES3[f.getMonth()] : evoFecha(S, i);
    if (i !== 0 && x(i) - x(0) < 46) continue;
    g += `<line class="ev-tick" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${yBase}" y2="${yBase + 4}"/>`;
    g += `<text class="ev-ax" x="${x(i).toFixed(1)}" y="${yBase + 15}" text-anchor="${i === 0 ? 'start' : 'middle'}">${lbl}</text>`;
  }
  g += `<line class="ev-base" x1="${M.l}" x2="${M.l + pw}" y1="${yBase}" y2="${yBase}"/>`;

  // plan: la recta del inicio a la meta (en músculo, el piso)
  g += `<line class="ev-plan" x1="${x(0)}" y1="${y(S.meta.de).toFixed(1)}" x2="${x(S.N)}" y2="${y(S.meta.a).toFixed(1)}"/>`;

  // hoy
  const xh = x(S.hoyIdx).toFixed(1);
  g += `<line class="ev-hoy" x1="${xh}" x2="${xh}" y1="${M.t - 6}" y2="${yBase}"/>`;
  g += `<text class="ev-hoy-t" x="${xh}" y="${M.t - 10}" text-anchor="middle">HOY</text>`;

  const etiquetas = [];
  let decLbl = 1;
  if (S.est) {
    const pts = S.est.map((v, i) => ({ i, v }));
    const p0 = S.proy[0], pN = S.proy[S.proy.length - 1];
    // cono de incertidumbre y proyección
    const sup = S.proy.map(p => ({ i: p.i, v: p.v + p.u }));
    const inf = S.proy.map(p => ({ i: p.i, v: p.v - p.u })).reverse();
    g += `<path class="ev-cone" d="${linea(sup)}${linea(inf).replace('M', 'L')}Z"/>`;
    g += `<path class="ev-proy" d="M${xy(p0.i, p0.v)}L${xy(pN.i, pN.v)}"/>`;
    // área + línea estimada
    if (pts.length > 1) {
      g += `<path class="ev-area" d="${linea(pts)}L${xh},${yBase}L${x(0)},${yBase}Z"/>`;
      g += `<path class="ev-est-glow" d="${linea(pts)}" pathLength="1"/>`;
      g += `<path class="ev-est" d="${linea(pts)}" pathLength="1"/>`;
    }
    decLbl = evoComparar(pN.v, S.meta.a).dec;
    etiquetas.push({ y: y(pN.v), cap: 'PROY', val: nf(pN.v, decLbl), cls: 'ev-lbl-proy' });
    // punto de hoy
    const yh = y(S.est[S.hoyIdx]).toFixed(1);
    g += `<circle class="ev-now-ring" cx="${xh}" cy="${yh}" r="4"/><circle class="ev-now" cx="${xh}" cy="${yh}" r="3.5"/>`;
  }
  etiquetas.push({ y: y(S.meta.a), cap: musc ? 'PISO' : 'META', val: nf(S.meta.a, decLbl), cls: 'ev-lbl-meta' });
  // la meta es un punto al final del plan, no la línea entera
  if (!musc) {
    const gx = x(S.N).toFixed(1), gy = y(S.meta.a).toFixed(1);
    g += `<circle class="ev-goal-r" cx="${gx}" cy="${gy}" r="5.5"/><circle class="ev-goal" cx="${gx}" cy="${gy}" r="2.2"/>`;
  }

  // mediciones reales
  if (S.meds.length > 1) {
    g += `<path class="ev-med-glow" d="${linea(S.meds)}" pathLength="1"/>`;
    g += `<path class="ev-med" d="${linea(S.meds)}" pathLength="1"/>`;
  }
  S.meds.forEach((p, k) => {
    const cx = x(p.i), cy = y(p.v), r = 5;
    g += `<path class="ev-dot${p.base ? ' base' : ''}" style="--k:${k}" d="M${cx.toFixed(1)},${(cy - r).toFixed(1)}l${r},${r}l${-r},${r}l${-r},${-r}Z"/>`;
  });
  // la etiqueta de partida va arriba, donde no pasa ninguna línea: la estimada
  // y el plan bajan o siguen planos. Sólo si la primera medición sube, va abajo.
  const subeMed = S.meds.length > 1 && S.meds[1].v > S.meds[0].v;
  g += `<text class="ev-lbl-ini" x="${(x(0) + 9).toFixed(1)}" y="${(y(S.meds[0].v) + (subeMed ? 15 : -6)).toFixed(1)}">INICIO</text>`;
  if (S.meds.length > 1) {
    // la etiqueta va del lado opuesto a la línea estimada (o al piso) para no pisarla
    const u = S.meds[S.meds.length - 1];
    const ref = S.est ? evoValor(S, u.i) : evoPlan(S, u.i);
    const abajo = u.v < ref;
    g += `<text class="ev-lbl-med" x="${x(u.i).toFixed(1)}" y="${(y(u.v) + (abajo ? 18 : -10)).toFixed(1)}" text-anchor="middle">${nf(u.v)}</text>`;
  }

  // etiquetas del margen derecho (nombre arriba, valor abajo); si se pisan,
  // se abren las dos desde el medio
  etiquetas.sort((a, b) => a.y - b.y);
  if (etiquetas.length === 2 && etiquetas[1].y - etiquetas[0].y < 21) {
    const mid = (etiquetas[0].y + etiquetas[1].y) / 2;
    etiquetas[0].y = mid - 10.5;
    etiquetas[1].y = mid + 10.5;
  }
  const xl = M.l + pw + 9;
  for (const e of etiquetas)
    g += `<text class="ev-lbl ${e.cls}" x="${xl}" y="${(e.y - 1.5).toFixed(1)}">` +
      `<tspan class="ev-lbl-c">${e.cap}</tspan><tspan x="${xl}" dy="9.5">${e.val}</tspan></text>`;

  if (!S.est && S.meds.length < 2) {
    // el aviso va en la mitad del gráfico donde no está la línea del piso
    const yc = y(S.meta.a) > M.t + ph / 2 ? M.t + ph * 0.26 : M.t + ph * 0.66;
    g += `<text class="ev-empty" x="${M.l + pw / 2}" y="${yc.toFixed(1)}" text-anchor="middle">SIN MEDICIONES TODAVÍA</text>` +
         `<text class="ev-empty2" x="${M.l + pw / 2}" y="${(yc + 16).toFixed(1)}" text-anchor="middle">Registrá la próxima para ver la curva real</text>`;
  }

  // cruz de lectura
  g += `<g class="ev-cross" id="evoCross" style="display:none">
    <line class="ev-cross-l" y1="${M.t - 4}" y2="${yBase}"/>
    <circle class="ev-cross-d" r="4"/>
  </g>`;
  g += `<rect class="ev-hit" x="${M.l - 6}" y="0" width="${pw + 12}" height="${H}"/>`;

  cont.innerHTML = `<svg class="${animar ? 'anim' : ''}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de ${EVO_UNIDADES[evoMetrica].toLowerCase()} en el ciclo">
    <defs>
      <linearGradient id="evoArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00e5ff" stop-opacity=".26"/>
        <stop offset="1" stop-color="#00e5ff" stop-opacity="0"/>
      </linearGradient>
    </defs>${g}</svg>`;

  const svg = cont.querySelector('svg');
  const cross = svg.querySelector('#evoCross');
  const cl = cross.querySelector('.ev-cross-l');
  const cd = cross.querySelector('.ev-cross-d');
  const hit = svg.querySelector('.ev-hit');

  const leer = i => {
    if (i === null) { cross.style.display = 'none'; evoLeer(S, S.hoyIdx); return; }
    const v = evoValor(S, i);
    const med = S.meds.find(p => p.i === i);
    const vy = med ? med.v : v;
    cross.style.display = '';
    cl.setAttribute('x1', x(i)); cl.setAttribute('x2', x(i));
    cd.setAttribute('cx', x(i));
    cd.setAttribute('cy', vy === null ? -20 : y(vy));
    cd.classList.toggle('med', !!med);
    evoLeer(S, i);
  };
  const desdePuntero = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) - M.l) / pw * S.N);
    leer(Math.max(0, Math.min(S.N, i)));
  };
  hit.addEventListener('pointerdown', desdePuntero);
  hit.addEventListener('pointermove', desdePuntero);
  hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') leer(null); });

  evoLeer(S, S.hoyIdx);
  renderEvoResumen(S);
}

function evoLeer(S, i) {
  const el = document.getElementById('evoRead');
  if (!el) return;
  const musc = evoMetrica === 'musculo';
  // el índice N es el 10/11: el día del InBody de cierre, no un día más del ciclo
  const cuando = i >= S.N ? `CIERRE · ${evoFecha(S, i)}`
    : `${i === S.hoyIdx ? 'HOY · ' : ''}${evoFecha(S, i)} · DÍA ${i + 1} DE ${S.N}`;
  const v = evoValor(S, i);
  const med = S.meds.find(p => p.i === i);
  const val = (sw, txt, n, dec) => `<span class="er-v"><i class="${sw}"></i>${txt} <b>${nf(n, dec)}</b><small>kg</small></span>`;
  let vals = '', st;
  if (med && med.base) {
    st = { txt: 'InBody de partida', cls: '', dec: 1 };
    vals = val('sw-base', 'INICIO', med.v, 1);
  } else {
    // los valores van con los decimales de la comparación, así cierran con ella
    const real = med ? med.v : v;
    st = real !== null ? evoVsPlan(S, real, i) : { txt: 'sin medición ese día', cls: '', dec: 1 };
    if (med) vals += val('sw-med', 'MEDIDO', med.v, st.dec);
    if (v !== null) vals += i > S.hoyIdx ? val('sw-proy', 'PROYECTADO', v, st.dec) : val('sw-est', 'ESTIMADO', v, st.dec);
    vals += val('sw-plan', musc ? 'PISO' : 'PLAN', evoPlan(S, i), st.dec);
  }
  el.innerHTML = `<div class="er-top"><span class="er-d">${cuando}</span>` +
    `<span class="er-s ${st.cls}">${st.txt}</span></div><div class="er-vs">${vals}</div>`;
}

function renderEvoResumen(S) {
  const leg = document.getElementById('evoLegend');
  const st = document.getElementById('evoStats');
  const sub = document.getElementById('evoSub');
  const musc = evoMetrica === 'musculo';
  const kg = v => `${nf(v)}<small>kg</small>`;
  const dif = (v, ref) => {
    // sobre los valores redondeados del cuadro, para que la resta cierre a la vista
    const d = Math.round(v * 10) / 10 - Math.round(ref * 10) / 10;
    if (Math.abs(d) < 0.05) return '<em>sin cambio</em>';
    // en músculo subir es bueno; en grasa y peso, bajar
    const bien = musc ? d > 0 : d < 0;
    return `<em class="${bien ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${nf(Math.abs(d))} kg</em>`;
  };

  if (sub) sub.textContent = EVO_SUB[evoMetrica];

  const ultima = S.meds.length > 1 ? S.meds[S.meds.length - 1] : null;
  if (leg) leg.innerHTML = (S.est
    ? '<span><i class="sw-est"></i>ESTIMADO</span><span><i class="sw-proy"></i>PROYECCIÓN</span><span><i class="sw-cone"></i>MARGEN</span>' : '') +
    `<span><i class="sw-plan"></i>${musc ? 'PISO' : 'PLAN'}</span>` +
    (musc ? '' : '<span><i class="sw-goal"></i>META</span>') +
    '<span><i class="sw-base"></i>INICIO</span>' +
    (ultima ? '<span><i class="sw-med"></i>MEDICIÓN</span>' : '');

  let tiles;
  if (S.est) {
    const hoyV = S.est[S.hoyIdx], fin = S.proy[S.proy.length - 1].v;
    tiles = [
      ['INICIO', kg(S.base), `<em>${evoFecha(S, 0)}</em>`],
      ['HOY · EST.', kg(hoyV), dif(hoyV, S.base)],
      ['CIERRE · PROY.', kg(fin), dif(fin, S.base)]
    ];
  } else {
    tiles = [
      ['INICIO', kg(S.base), `<em>${evoFecha(S, 0)}</em>`],
      ['ÚLTIMA MEDIDA', ultima ? kg(ultima.v) : '—', ultima ? dif(ultima.v, S.base) : ''],
      ['OBJETIVO', 'MANTENER', '']
    ];
  }
  let html = `<div class="evo-tiles">${tiles.map(([l, v, d]) =>
    `<div class="evo-tile"><div class="et-l">${l}</div><div class="et-v">${v}</div><div class="et-d">${d}</div></div>`).join('')}</div>`;
  html += `<div class="evo-plan">${evoLectura(S, ultima)}</div>`;
  if (ultima && S.est) {
    const est = S.est[Math.min(ultima.i, S.hoyIdx)];
    const [, mes, dia] = ultima.fecha.split('-');
    const { dec, d: gap } = evoComparar(ultima.v, est);
    html += `<div class="evo-real">Medición del ${dia}/${mes}: <b>${nf(ultima.v, dec)} kg</b>. El estimado ese día era ${nf(est, dec)} kg — ` +
      (Math.abs(gap) < 0.3 ? 'vas tal cual lo previsto.'
        : gap < 0 ? `vas <b class="up">${nf(-gap, dec)} kg mejor</b> que lo previsto.`
        : `vas <b class="dn">${nf(gap, dec)} kg por encima</b> de lo previsto.`) + '</div>';
  }
  if (st) st.innerHTML = html;

  renderEvoLista();
}

// el gráfico contado en palabras: dónde estás, a dónde vas y qué falta.
// Los días que pide salen de la misma cuenta que el presupuesto de fallas.
function evoLectura(S, ultima) {
  const s = S.s;
  if (!S.est) {
    const vm = ultima && evoVsPlan(S, ultima.v, ultima.i);
    const t = ultima
      ? `<p><b>Última medición:</b> ${nf(ultima.v, vm.dec)} kg el ${evoFecha(S, ultima.i).toLowerCase()}, <b class="${vm.cls}">${vm.txt}</b>.</p>`
      : '<p>El músculo no se puede calcular con los tildes: para verlo hace falta una medición de InBody.</p>';
    return t + `<p><b>El piso</b> es ${nf(S.meta.a)} kg, lo que tenías al empezar. Si la barra de músculo de la proyección está arriba del ${Math.round(UMBRAL_MUSCULO * 100)} %, estás entrenando lo suficiente para no perderlo.</p>`;
  }
  if (s.evaluados === 0)
    return '<p>Todavía no hay días cerrados: la línea empieza a moverse cuando termina el primer día del ciclo.</p>';

  const hoyV = S.est[S.hoyIdx], fin = S.proy[S.proy.length - 1].v, meta = S.meta.a;
  const vs = evoVsPlan(S, hoyV, S.hoyIdx);
  const quedan = S.N - S.hoyIdx;
  const faltan = Math.max(0, s.diasLimpiosNecesarios - s.limpios);
  let t = `<p><b>Hoy:</b> ${nf(hoyV, vs.dec)} kg estimados; el plan pedía ${nf(evoPlan(S, S.hoyIdx), vs.dec)}. ` +
    `Vas <b class="${vs.cls}">${vs.txt}</b>.</p>`;
  const c = evoComparar(fin, meta);
  t += `<p><b>Al cierre:</b> con el ${Math.round(s.adhGrasa * 100)} % de días en regla que llevás, el ${evoFecha(S, S.N).toLowerCase()} llegás a ${nf(fin, c.dec)} kg` +
    (c.d > 1e-9 ? ` y la meta es ${nf(meta, c.dec)}: quedás <b class="dn">${nf(c.d, c.dec)} kg arriba</b>.`
      : ` y cumplís la meta de ${nf(meta, c.dec)}` + (c.d < -1e-9 ? `, con <b class="up">${nf(-c.d, c.dec)} kg de sobra</b>.` : '.')) + '</p>';
  if (quedan > 0) t += '<p><b>Para la meta:</b> ' + (
    faltan === 0 ? 'con los días en regla que ya juntaste te alcanza.'
    : faltan > quedan ? `ya no alcanza aunque cumplas todos los días; el mejor cierre posible es ${nf(hoyV - quedan * KG_POR_DIA_LIMPIO)} kg.`
    : `necesitás <b>${faltan} días en regla de los ${quedan}</b> que quedan (podés fallar ${quedan - faltan}).`) + '</p>';
  return t;
}

function renderEvoLista() {
  const cont = document.getElementById('evoLista');
  if (!cont) return;
  const meds = getMediciones();
  if (!meds.length) { cont.innerHTML = ''; return; }
  const v = (n, l) => n > 0 ? `<span><small>${l}</small>${nf(n)}</span>` : `<span class="nd"><small>${l}</small>—</span>`;
  cont.innerHTML = '<div class="evo-lista-h">MEDICIONES</div>' + meds.slice().reverse().map(m => {
    const [, mes, dia] = m.fecha.split('-');
    return `<div class="evo-item">
      <span class="ei-f">${dia}/${mes}</span>
      ${v(m.peso, 'P')}${v(m.musculo, 'M')}${v(m.grasa, 'G')}
      <button class="ei-x" data-f="${m.fecha}" aria-label="Borrar medición del ${dia}/${mes}">✕</button>
    </div>`;
  }).join('');
  cont.querySelectorAll('.ei-x').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta medición?')) return;
    await guardarMediciones(getMediciones().filter(m => m.fecha !== b.dataset.f));
    renderEvolucion(false);
  }));
}

function abrirMedicion() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('medFecha', getTodayStr());
  set('medPeso', ''); set('medMusculo', ''); set('medGrasa', '');
  const err = document.getElementById('medError');
  if (err) err.textContent = '';
  document.getElementById('medModal').style.display = 'flex';
}

async function guardarMedicion() {
  const num = id => { const n = parseFloat(String(document.getElementById(id)?.value || '').replace(',', '.')); return n > 0 ? n : null; };
  const fecha = document.getElementById('medFecha')?.value;
  const nueva = { peso: num('medPeso'), musculo: num('medMusculo'), grasa: num('medGrasa') };
  const err = document.getElementById('medError');
  if (!fecha || (!nueva.peso && !nueva.musculo && !nueva.grasa)) {
    if (err) err.textContent = 'Cargá la fecha y al menos un valor.';
    return;
  }
  // misma fecha: se completa la que ya estaba, sin borrar lo que no se tocó
  const lista = getMediciones();
  const prev = lista.find(m => m.fecha === fecha);
  const fila = { ...(prev || {}), fecha };
  for (const k in nueva) if (nueva[k]) fila[k] = nueva[k];
  await guardarMediciones([...lista.filter(m => m.fecha !== fecha), fila]);
  document.getElementById('medModal').style.display = 'none';
  renderEvolucion(true);
}

function observarEvolucion() {
  const panel = document.getElementById('panelEvo');
  const arrancar = () => { evoVisto = true; renderEvolucion(true); };
  if (!panel || !('IntersectionObserver' in window)) { arrancar(); return; }
  const io = new IntersectionObserver(ents => {
    if (ents.some(e => e.isIntersecting)) { io.disconnect(); arrancar(); }
  }, { threshold: 0.3 });
  io.observe(panel);
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
  const INICIO = 120;   // ms hasta la primera letra
  const PASO = 60;      // ms entre pulsación y pulsación
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
    setTimeout(() => overlay.classList.add('arise-off'), 450);
  };

  // fogonazo + latido + cursor parpadeando cuando la última letra se asienta
  const finTipeo = INICIO + (letras.length - 1) * PASO + 270;
  timers.push(setTimeout(() => overlay.classList.add('arise-charged'), finTipeo));
  // cierre automático
  timers.push(setTimeout(cerrar, finTipeo + 700));

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

  // rango y nivel
  const rangoModal = document.getElementById('rangoModal');
  document.getElementById('btnHunter')?.addEventListener('click', () => {
    renderRangoModal();
    if (rangoModal) rangoModal.style.display = 'flex';
  });
  document.getElementById('btnCerrarRango')?.addEventListener('click', () => {
    if (rangoModal) rangoModal.style.display = 'none';
  });
  rangoModal?.addEventListener('click', e => {
    if (e.target === rangoModal) rangoModal.style.display = 'none';
  });
  const nivelInfo = document.getElementById('nivelInfoModal');
  document.getElementById('btnNivelInfo')?.addEventListener('click', () => {
    renderNivelInfo();
    if (nivelInfo) nivelInfo.style.display = 'flex';
  });
  document.getElementById('btnCerrarNivelInfo')?.addEventListener('click', () => {
    if (nivelInfo) nivelInfo.style.display = 'none';
  });
  nivelInfo?.addEventListener('click', e => {
    if (e.target === nivelInfo) nivelInfo.style.display = 'none';
  });

  // evolución
  document.querySelectorAll('.evo-tab').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.m === evoMetrica) return;
    evoMetrica = btn.dataset.m;
    document.querySelectorAll('.evo-tab').forEach(b => b.classList.toggle('on', b === btn));
    renderEvolucion(true);
  }));
  const medModal = document.getElementById('medModal');
  document.getElementById('btnMedicion')?.addEventListener('click', abrirMedicion);
  document.getElementById('btnGuardarMed')?.addEventListener('click', guardarMedicion);
  document.getElementById('btnCerrarMed')?.addEventListener('click', () => {
    if (medModal) medModal.style.display = 'none';
  });
  medModal?.addEventListener('click', e => {
    if (e.target === medModal) medModal.style.display = 'none';
  });
  const evoInfo = document.getElementById('evoInfoModal');
  document.getElementById('btnEvoInfo')?.addEventListener('click', () => {
    if (evoInfo) evoInfo.style.display = 'flex';
  });
  document.getElementById('btnCerrarEvoInfo')?.addEventListener('click', () => {
    if (evoInfo) evoInfo.style.display = 'none';
  });
  evoInfo?.addEventListener('click', e => {
    if (e.target === evoInfo) evoInfo.style.display = 'none';
  });
  let evoResize = null;
  window.addEventListener('resize', () => {
    clearTimeout(evoResize);
    evoResize = setTimeout(() => { if (evoVisto) renderEvolucion(false); }, 150);
  });
  observarEvolucion();

  iniciarTimerMision();
});
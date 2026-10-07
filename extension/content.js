// Mi DeepSeek Bridge — content script
// v0.2.0 — fixes: doble detección, pwaReady reset, clickSend robusto,
//                 loadAP race, origin check, cancelación, reintento,
//                 debounce, selector textarea, iframe lazy.

const PWA_URL = 'https://alain314159.github.io/mi-deepseek-bridge/';
const PWA_ORIGIN = 'https://alain314159.github.io';
const MSG = { HELLO:'HELLO', EXEC:'EXEC', CANCEL:'CANCEL', PING:'PING',
              READY:'READY', STREAM:'STREAM', RESULT:'RESULT', ERROR:'ERROR', PONG:'PONG' };
const VERSION = 1;
const MAX_QUEUE = 10;
const READY_TIMEOUT_MS = 40000;
const EXEC_TIMEOUT_MS = 180000;
const GLOBAL_TIMEOUT_MS = 200000;
const DEBUG = false;

const SYSTEM_PROMPT =
  "Eres un asistente que trabaja en modo agente con el usuario a traves de un puente " +
  "que ejecuta comandos en una terminal Linux real. REGLAS: 1. Cuando necesites ejecutar " +
  "algo, responde UNICAMENTE con un bloque de codigo ```sh con el comando exacto. " +
  "2. Un comando por bloque. Espera el resultado. 3. El usuario te devuelve la salida " +
  "en un bloque ```plaintext. 4. Nunca inventes resultados. 5. Avanza de a un paso. " +
  "6. Usa flags no interactivos (ej: < /dev/null). 7. Al terminar, resumi sin bloques.";

const pending = new Map();     // id -> {resolve, onStream, cancel}
const lastCmd = new WeakMap(); // el -> string (dedupe real)
let iframe=null, panel=null, pwaReady=false, autopilot=false, iframeLoaded=false;

function log(...a){ if (DEBUG) console.log('[mdsb]', ...a); }
function warn(...a){ console.warn('[mdsb]', ...a); }

function makeMsg(t,p={},id=null){
  return { v:VERSION, id:id||Math.random().toString(36).slice(2,10), type:t, ts:Date.now(), payload:p };
}

// ---------- storage ----------
function loadAP(){
  try {
    chrome.storage.local.get(['autopilot']).then(r=>{
      autopilot = !!r.autopilot;
      // Fix bug #4: re-render estado tras resolver
      updateFab();
      const tgl = panel && panel.querySelector('#mdsb-ap-toggle');
      const ap  = panel && panel.querySelector('#mdsb-ap');
      if (tgl) tgl.classList.toggle('on', autopilot);
      if (ap) ap.checked = autopilot;
      if (autopilot) runAuto();
    }).catch(e=>warn('loadAP falló', e));
  } catch(e){ warn('storage no disponible', e); }
}
function saveAP(){
  try { chrome.storage.local.set({ autopilot }); } catch(e){ warn('saveAP falló', e); }
}

// ---------- panel ----------
function ensurePanel(){
  if (panel) return;
  panel = document.createElement('div');
  panel.id = 'mdsb-panel';
  panel.innerHTML =
    '<div class="header"><span>Bridge</span>' +
    '<div class="actions">' +
    '<span id="mdsb-status" class="status-wait">○ esperando</span>' +
    '<label class="toggle" id="mdsb-ap-toggle"><input type="checkbox" id="mdsb-ap"/>Auto</label>' +
    '<button id="mdsb-inject" title="Instrucciones">I</button>' +
    '<button id="mdsb-close">x</button>' +
    '</div></div>';
  iframe = document.createElement('iframe');
  iframe.src = PWA_URL;
  iframe.setAttribute('allow', 'cross-origin-isolated');
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  const ap = panel.querySelector('#mdsb-ap');
  const tgl = panel.querySelector('#mdsb-ap-toggle');
  ap.checked = autopilot;
  if (autopilot) tgl.classList.add('on');
  ap.onchange = () => {
    autopilot = ap.checked;
    tgl.classList.toggle('on', autopilot);
    saveAP(); updateFab();
    if (autopilot) runAuto();
  };
  panel.querySelector('#mdsb-close').onclick = () => panel.classList.remove('open');
  panel.querySelector('#mdsb-inject').onclick = injectPrompt;

  // Fix bug #2: resetear pwaReady cuando el iframe recarga
  iframe.addEventListener('load', () => {
    iframeLoaded = true;
    // Si el iframe ya había cargado antes (recarga), resetear estado
    if (pwaReady) {
      log('iframe recargado → reset pwaReady');
      pwaReady = false;
      setStatus('wait', '○ esperando');
    }
    iframe.contentWindow.postMessage(makeMsg(MSG.HELLO, {role:'ext'}), PWA_ORIGIN);
  });
}

function setStatus(kind, text){
  const s = panel && panel.querySelector('#mdsb-status');
  if (!s) return;
  s.textContent = text;
  s.className = 'status-' + kind;
}

function openPanel(){
  ensurePanel();
  if (!panel.classList.contains('open')) panel.classList.add('open');
}

// ---------- FAB ----------
function ensureFab(){
  let f = document.getElementById('mdsb-fab');
  if (f) { updateFab(); return; }
  f = document.createElement('button');
  f.id = 'mdsb-fab';
  f.textContent = '>'; f.title = 'Mi DeepSeek Bridge';
  document.body.appendChild(f);

  try {
    chrome.storage.local.get(['fabPos']).then(r=>{
      if (r && r.fabPos){
        f.style.left=r.fabPos.left+'px';
        f.style.top =r.fabPos.top+'px';
        f.style.right='auto'; f.style.bottom='auto';
      }
    });
  } catch(e){ warn('fabPos load', e); }

  let startX=0,startY=0,startL=0,startT=0,dragged=false,downAt=0,active=false;
  const getPoint = e => e.touches ? e.touches[0] : e;

  function down(e){
    const p = getPoint(e);
    startX=p.clientX; startY=p.clientY;
    const r = f.getBoundingClientRect();
    startL=r.left; startT=r.top;
    dragged=false; active=true; downAt=Date.now();
    f.classList.add('dragging'); f.style.transition='none';
  }
  function move(e){
    if (!active) return;
    const p = getPoint(e);
    const dx=p.clientX-startX, dy=p.clientY-startY;
    if (Math.abs(dx)>4 || Math.abs(dy)>4) dragged=true;
    let nl=startL+dx, nt=startT+dy;
    const maxL=window.innerWidth-f.offsetWidth;
    const maxT=window.innerHeight-f.offsetHeight;
    nl=Math.max(0,Math.min(maxL,nl));
    nt=Math.max(0,Math.min(maxT,nt));
    f.style.left=nl+'px'; f.style.top=nt+'px';
    f.style.right='auto'; f.style.bottom='auto';
    if (dragged && e.cancelable) e.preventDefault();
  }
  function up(){
    if (!active) return;
    active=false;
    f.classList.remove('dragging'); f.style.transition='';
    if (dragged){
      const r = f.getBoundingClientRect();
      try { chrome.storage.local.set({fabPos:{left:r.left, top:r.top}}); } catch{}
    } else if (Date.now()-downAt < 600){
      ensurePanel();
      if (panel.classList.contains('open')){
        panel.classList.remove('open');
      } else {
        panel.classList.add('open');
        if (iframe && iframe.contentWindow){
          try { iframe.contentWindow.postMessage(makeMsg(MSG.HELLO,{role:'ext'}), PWA_ORIGIN); } catch(e){}
        }
      }
    }
  }
  f.addEventListener('touchstart',down,{passive:true});
  f.addEventListener('touchmove',move,{passive:false});
  f.addEventListener('touchend',up);
  f.addEventListener('touchcancel',up);
  f.addEventListener('mousedown',down);
  document.addEventListener('mousemove',move);
  document.addEventListener('mouseup',up);
  updateFab();
}
function updateFab(){
  const f = document.getElementById('mdsb-fab');
  if (!f) return;
  f.classList.toggle('autopilot', autopilot);
  f.textContent = autopilot ? 'A' : '>';
}

// ---------- textarea / send ----------
function findChatTextarea(){
  const all = document.querySelectorAll('textarea');
  let best = null;
  for (const ta of all){
    if (ta.disabled) continue;
    if (ta.offsetParent === null) continue;
    const r = ta.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    if (!best) { best = ta; continue; }
    // preferir el más abajo (chat input suele estar al fondo)
    if (r.top > best.getBoundingClientRect().top) best = ta;
  }
  return best;
}

function setTextarea(txt){
  const ta = findChatTextarea();
  if (!ta) { warn('no textarea'); return false; }
  ta.focus();
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  s.call(ta, txt);
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}

function clickSend(){
  const ta = findChatTextarea();
  if (!ta) return {ok:false, reason:'no textarea'};

  // 1) submit button en el form
  const form = ta.closest('form');
  if (form){
    const s = form.querySelector('button[type="submit"]');
    if (s && !s.disabled && s.offsetParent !== null){ s.click(); return {ok:true}; }
  }
  // 2) botones con aria-label de enviar
  const cands = document.querySelectorAll('button[aria-label], [role="button"][aria-label]');
  for (const b of cands){
    const label = (b.getAttribute('aria-label')||'').toLowerCase();
    if (/send|enviar|submit/i.test(label) && !b.disabled && b.offsetParent !== null){
      b.click(); return {ok:true};
    }
  }
  // 3) fallback: último button habilitado en el contenedor del textarea
  const cont = form || (ta.parentElement && ta.parentElement.parentElement);
  if (cont){
    const btns = cont.querySelectorAll('button');
    for (let i=btns.length-1; i>=0; i--){
      const b = btns[i];
      if (!b.disabled && b.offsetParent !== null){ b.click(); return {ok:true}; }
    }
  }
  return {ok:false, reason:'no send button'};
}

function injectPrompt(){
  if (!setTextarea(SYSTEM_PROMPT)) showToast('No encontré el input del chat');
}

// ---------- toast ----------
function showToast(msg, ms=3000){
  let el = document.getElementById('mdsb-toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'mdsb-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#1a1a2e;color:#e0e0f0;padding:10px 16px;border-radius:8px;' +
      'font-size:13px;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.6);' +
      'border:1px solid #2a2a3e;max-width:90vw;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.display='none'; }, ms);
}

// ---------- message handling ----------
window.addEventListener('message', ev => {
  // Fix bug #9: validar origen
  if (ev.origin !== PWA_ORIGIN) return;
  const d = ev.data;
  if (!d || d.v !== VERSION || typeof d.type !== 'string') return;

  if (d.type === MSG.READY){
    pwaReady = true;
    if (d.payload && d.payload.nodepod) setStatus('ok','● listo');
    else                                setStatus('wait','○ booteando');
    return;
  }
  if (d.type === MSG.STREAM){
    const p = pending.get(d.payload && d.payload.targetId);
    if (p && p.onStream) p.onStream(d.payload);
    return;
  }
  if (d.type === MSG.RESULT || d.type === MSG.ERROR){
    const id = d.payload && d.payload.targetId;
    const p = pending.get(id);
    if (p){ p.resolve(d.payload); pending.delete(id); }
  }
});

// ---------- exec ----------
function execInPwa(cmd, onStream){
  openPanel();
  return new Promise((res, rej) => {
    if (pending.size >= MAX_QUEUE){
      rej(new Error('cola llena (' + MAX_QUEUE + '), esperá un poco'));
      return;
    }
    const id = Math.random().toString(36).slice(2,10);
    let cancelled = false;
    pending.set(id, { resolve: res, onStream, cancel: ()=>{ cancelled = true; } });

    const sendExec = () => {
      if (cancelled) { pending.delete(id); rej(new Error('cancelado')); return; }
      try {
        iframe.contentWindow.postMessage(
          makeMsg(MSG.EXEC, { cmd, timeout: EXEC_TIMEOUT_MS }, id), PWA_ORIGIN);
      } catch(e){
        pending.delete(id);
        rej(new Error('postMessage EXEC falló: ' + e.message));
      }
    };

    const waitReady = (tries) => {
      if (cancelled) { pending.delete(id); rej(new Error('cancelado')); return; }
      if (pwaReady){ sendExec(); return; }
      if (tries <= 0){
        pending.delete(id);
        rej(new Error('PWA no respondió READY (timeout ' + (READY_TIMEOUT_MS/1000) + 's)'));
        return;
      }
      try {
        iframe.contentWindow.postMessage(makeMsg(MSG.HELLO,{role:'ext'}), PWA_ORIGIN);
      } catch(e){
        pending.delete(id);
        rej(new Error('postMessage HELLO falló: ' + e.message));
        return;
      }
      setTimeout(()=>waitReady(tries-1), 800);
    };
    waitReady(Math.ceil(READY_TIMEOUT_MS/800));

    setTimeout(()=>{
      if (pending.has(id)){
        pending.delete(id);
        rej(new Error('timeout global ' + (GLOBAL_TIMEOUT_MS/1000) + 's'));
      }
    }, GLOBAL_TIMEOUT_MS);
  });
}

// ---------- detección de comandos ----------
function isCmd(t){
  t = t.trim();
  if (!t || t.length > 4000) return false;
  if (/^(?:const|let|var|function|import|export|class|return|<\?|\/[a-z])/.test(t)) return false;
  return /^(?:git|npm|node|npx|ls|cd|cat|echo|mkdir|rm|cp|mv|curl|wget|grep|find|chmod|pwd|touch|head|tail|sed|awk|python|python3|pip|bash|sh|yarn|pnpm|tar|zip|unzip|which|whoami|env|export|sudo|apt|apt-get|docker|make|gcc|g\+\+|go|cargo|rustc)\b|^\.\/|^\/[\w.\/-]+/.test(t);
}

// Fix bug #1: solo iterar sobre pre, usar code interno si existe
function findNew(){
  const r = [];
  document.querySelectorAll('pre').forEach(pre => {
    if (pre.closest('#mdsb-panel')) return;
    const el = pre.querySelector('code') || pre;
    const t = (el.textContent || '').trim();
    if (!t || !isCmd(t)) return;
    if (lastCmd.get(el) === t) return; // ya procesado con este mismo contenido
    lastCmd.set(el, t);
    r.push({ el, cmd: t });
  });
  return r;
}

function decorate(el, cmd){
  // Eliminar cualquier botón previo justo después del elemento
  let sib = el.nextElementSibling;
  while (sib && sib.classList && sib.classList.contains('mdsb-run-btn')){
    const s = sib; sib = sib.nextElementSibling; s.remove();
  }
  const b = document.createElement('button');
  b.className = 'mdsb-run-btn';
  b.textContent = '▶ Ejecutar';
  b.onclick = () => runBlock(b, cmd, { autoPaste:false });
  el.parentNode.insertBefore(b, el.nextSibling);
  return b;
}

async function runBlock(btn, cmd, opts){
  opts = opts || {};
  btn.disabled = true;
  btn.classList.remove('done','error');
  btn.textContent = '⏳ Ejecutando…';

  // Fix bug #6: botón cancelar superpuesto
  let cancelBtn = btn.nextElementSibling;
  const needsCancel = !(cancelBtn && cancelBtn.classList && cancelBtn.classList.contains('mdsb-cancel-btn'));
  if (needsCancel){
    cancelBtn = document.createElement('button');
    cancelBtn.className = 'mdsb-run-btn mdsb-cancel-btn';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Cancelar';
    btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
  }
  cancelBtn.style.display = 'inline-flex';

  let cancelled = false;
  cancelBtn.onclick = () => {
    cancelled = true;
    // cancelar todos los pendientes de esta corrida (aproximación simple)
    for (const [id, p] of pending){ if (p.cancel) p.cancel(); }
    btn.textContent = '✕ Cancelado';
    btn.classList.add('error');
    cancelBtn.style.display = 'none';
    btn.disabled = false;
  };

  try {
    const r = await execInPwa(cmd, s => {
      if (s && s.stream === 'meta') btn.textContent = '⏳ ' + s.chunk.trim().slice(0,50);
    });
    cancelBtn.style.display = 'none';

    if (r && r.message && r.exitCode === undefined){
      // fue un ERROR del bridge
      btn.textContent = '✗ ' + (r.message||'').slice(0,30);
      btn.classList.add('error');
      showToast('Error: ' + r.message);
    } else if (r && r.exitCode === 0){
      btn.textContent = '✓ Listo';
      btn.classList.add('done');
    } else {
      btn.textContent = '✗ exit ' + (r ? r.exitCode : '?');
      btn.classList.add('error');
    }

    const out = ((r && r.stdout) || '') +
                (r && r.stderr ? '\n[stderr]\n' + r.stderr : '') +
                '\n[exit ' + (r ? r.exitCode : '?') + ']';

    if (opts.autoPaste){
      if (!setTextarea('```plaintext\n' + out.trim() + '\n```')){
        showToast('No encontré el input para pegar');
      } else {
        setTimeout(()=>{
          const s = clickSend();
          if (!s.ok) showToast('No pude enviar: ' + s.reason);
        }, 400);
      }
    }
    // Fix bug #15: permitir reintentar
    btn.disabled = false;
    btn.title = 'Reintentar';
    btn.onclick = () => runBlock(btn, cmd, opts);
    return r;
  } catch(e){
    cancelBtn.style.display = 'none';
    btn.textContent = '✗ ' + (e.message || 'error').slice(0,30);
    btn.classList.add('error');
    btn.disabled = false;
    btn.title = 'Reintentar';
    btn.onclick = () => runBlock(btn, cmd, opts);
    showToast('Error: ' + e.message);
    return { error: e };
  }
}

// ---------- autopilot ----------
let busy = false;
async function runAuto(){
  if (!autopilot || busy) return;
  const bs = findNew();
  if (!bs.length) return;
  busy = true;
  try {
    for (const item of bs){
      if (!autopilot) break;
      const b = decorate(item.el, item.cmd);
      if (b) await runBlock(b, item.cmd, { autoPaste:true });
      await new Promise(r=>setTimeout(r,1500));
    }
  } finally {
    busy = false;
    // Fix bug #7: re-chequear por si quedaron cosas durante busy
    if (autopilot && findNew().length) setTimeout(runAuto, 300);
  }
}

// ---------- observer con debounce ----------
let moTimer = null;
const mo = new MutationObserver(()=>{
  clearTimeout(moTimer);
  moTimer = setTimeout(()=>{
    try {
      findNew().forEach(item => decorate(item.el, item.cmd));
      if (autopilot) runAuto();
    } catch(e){ warn('observer', e); }
  }, 250);
});

// ---------- bootstrap ----------
function boot(){
  if (!document.body){
    setTimeout(boot, 100);
    return;
  }
  mo.observe(document.body, { childList:true, subtree:true });
  loadAP();
  ensureFab();
  // Fix bug #8: NO crear el panel/iframe hasta que se necesite.
  // ensurePanel() se llama desde el FAB o desde execInPwa.
  log('listo');
}

boot();

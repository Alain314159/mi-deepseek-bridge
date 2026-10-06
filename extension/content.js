// Mi DeepSeek Bridge - content script
// Detecta bloques de código en las respuestas de DeepSeek, inyecta botones "Ejecutar",
// y comunica con el iframe de la PWA (Nodepod) por postMessage.

const PWA_URL = 'https://alain314159.github.io/mi-deepseek-bridge/';
const MSG = {
  HELLO: 'HELLO', EXEC: 'EXEC', CANCEL: 'CANCEL', PING: 'PING',
  READY: 'READY', STREAM: 'STREAM', RESULT: 'RESULT', ERROR: 'ERROR', PONG: 'PONG',
};
const VERSION = 1;
const pending = new Map();
let iframe = null;
let panel = null;
let pwaReady = false;

function makeMsg(type, payload = {}, id = null) {
  return { v: VERSION, id: id || Math.random().toString(36).slice(2, 10), type, ts: Date.now(), payload };
}

function ensurePanel() {
  if (panel) return;
  panel = document.createElement('div');
  panel.id = 'mdsb-panel';
  panel.innerHTML = `
    <div class="header">
      <span>Mi DeepSeek Bridge</span>
      <button title="Cerrar" id="mdsb-close">×</button>
    </div>
  `;
  iframe = document.createElement('iframe');
  iframe.src = PWA_URL;
  iframe.setAttribute('allow', 'cross-origin-isolated');
  panel.appendChild(iframe);
  document.body.appendChild(panel);
  panel.querySelector('#mdsb-close').onclick = () => panel.classList.remove('open');
}

function ensureFab() {
  if (document.getElementById('mdsb-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'mdsb-fab';
  fab.textContent = '▶';
  fab.title = 'Mi DeepSeek Bridge';
  fab.onclick = () => {
    ensurePanel();
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) iframe.contentWindow.postMessage(makeMsg(MSG.HELLO, { role: 'extension' }), '*');
  };
  document.body.appendChild(fab);
}

window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.v !== VERSION) return;
  if (d.type === MSG.READY) { pwaReady = true; return; }
  if (d.type === MSG.STREAM) {
    const p = pending.get(d.payload.targetId);
    if (p && p.onStream) p.onStream(d.payload);
    return;
  }
  if (d.type === MSG.RESULT || d.type === MSG.ERROR) {
    const p = pending.get(d.payload.targetId);
    if (p) { p.resolve(d.payload); pending.delete(d.payload.targetId); }
  }
});

function execInPwa(cmd, onStream) {
  ensurePanel();
  if (!panel.classList.contains('open')) panel.classList.add('open');
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2, 10);
    pending.set(id, { resolve, onStream });
    iframe.contentWindow.postMessage(makeMsg(MSG.EXEC, { cmd, timeout: 180000 }, id), '*');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout esperando PWA')); }
    }, 200000);
  });
}

// Extraer el texto del último mensaje del asistente
function getLastAssistantText() {
  const candidates = document.querySelectorAll('[class*="markdown"], [class*="message"], [class*="assistant"]');
  let last = null;
  candidates.forEach((el) => { last = el; });
  return last ? last.textContent : '';
}

// Detectar bloques de código con forma de comando shell
function detectCommands(text) {
  const blocks = [];
  const re = /```(?:sh|bash|shell|exec|execute)?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1].trim();
    if (body && body.length < 4000 && !body.includes('npm start') === false) {
      blocks.push(body);
    }
  }
  return blocks;
}

// Inyectar botón al lado del último bloque de código
function injectRunButton() {
  const pres = document.querySelectorAll('pre');
  const last = pres[pres.length - 1];
  if (!last || last.dataset.mdsb === '1') return;
  const code = last.textContent.trim();
  if (!code || code.length > 4000) return;
  if (/^(?:const|let|var|function|import|export|class|<)/.test(code)) return; // código JS/HTML, no shell
  last.dataset.mdsb = '1';

  const btn = document.createElement('button');
  btn.className = 'mdsb-run-btn';
  btn.textContent = '▶ Ejecutar';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Ejecutando…';
    try {
      const r = await execInPwa(code, (s) => {
        if (s.stream === 'meta') btn.textContent = '⏳ ' + s.chunk.trim();
      });
      if (r.exitCode === 0) { btn.textContent = '✓ Listo'; btn.classList.add('done'); }
      else { btn.textContent = '✗ exit ' + r.exitCode; btn.classList.add('error'); }
      // Inyectar el resultado como nuevo mensaje en el chat
      const ta = document.querySelector('textarea');
      if (ta) {
        const out = '```\n' + (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '') + '\n[exit ' + r.exitCode + ']\n```';
        ta.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, out);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      btn.textContent = '✗ ' + e.message;
      btn.classList.add('error');
    }
  };
  last.parentNode.insertBefore(btn, last.nextSibling);
}

// Observar el DOM del chat para detectar nuevos mensajes
const mo = new MutationObserver(() => { try { injectRunButton(); } catch {} });
mo.observe(document.body, { childList: true, subtree: true });

ensureFab();
console.log('[mdsb] extensión lista');

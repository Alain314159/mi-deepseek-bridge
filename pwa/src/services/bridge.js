import { MSG, makeMsg, isBridgeMsg } from '../protocol/messages.js';
import { execCommand, bootNodepod } from './nodepod-boot.js';

const ALLOWED_ORIGINS = [
  'https://chat.deepseek.com',
  // para pruebas locales, agregar el origen del dev server:
  // 'http://localhost:5173',
];

const MAX_QUEUE = 10;
let listeners = [];
let nodepodReady = false;
let booted = false;
const pendingJobs = [];
const running = new Map(); // id -> process handle (para cancelar)

function send(target, msg) { try { target.postMessage(msg, '*'); } catch (e) { console.error(e); } }
function broadcast(msg) {
  if (window.parent && window.parent !== window) send(window.parent, msg);
  if (window.opener) send(window.opener, msg);
  listeners.forEach((fn) => fn(msg));
}

async function handleExec(payload, id) {
  const { cmd, cwd, timeout } = payload;
  broadcast(makeMsg(MSG.STREAM, { targetId: id, chunk: `$ ${cmd}\n`, stream: 'meta' }, id));
  try {
    const r = await execCommand(cmd, {
      cwd, timeout,
      onStdout: (c) => broadcast(makeMsg(MSG.STREAM, { targetId: id, chunk: c, stream: 'stdout' }, id)),
      onStderr: (c) => broadcast(makeMsg(MSG.STREAM, { targetId: id, chunk: c, stream: 'stderr' }, id)),
    });
    broadcast(makeMsg(MSG.RESULT, { targetId: id, ...r }, id));
  } catch (e) {
    broadcast(makeMsg(MSG.ERROR, { targetId: id, message: String(e) }, id));
  }
}

function flushPending() {
  while (pendingJobs.length) {
    const job = pendingJobs.shift();
    handleExec(job.payload, job.id);
  }
}

export function onMessage(h) {
  listeners.push(h);
  return () => { listeners = listeners.filter((x) => x !== h); };
}

export function startBridge() {
  if (booted) return;
  booted = true;

  window.addEventListener('message', (ev) => {
    if (!isBridgeMsg(ev.data)) return;
    // Fix bug #9: validar origen si está en la lista (si está vacía, permitir todo)
    if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(ev.origin)) {
      console.warn('[bridge] origen no permitido:', ev.origin);
      return;
    }
    const msg = ev.data;

    if (msg.type === MSG.HELLO) {
      broadcast(makeMsg(MSG.READY, { nodepod: nodepodReady, version: '0.1' }, msg.id));
    } else if (msg.type === MSG.PING) {
      broadcast(makeMsg(MSG.PONG, {}, msg.id));
    } else if (msg.type === MSG.CANCEL) {
      // Fix bug #6: cancelar el comando en curso
      const id = msg.payload && msg.payload.targetId;
      if (id && running.has(id)) {
        try { running.get(id).kill(); } catch {}
        running.delete(id);
        broadcast(makeMsg(MSG.ERROR, { targetId: id, message: 'cancelado por el usuario' }, id));
      }
    } else if (msg.type === MSG.EXEC) {
      if (pendingJobs.length >= MAX_QUEUE) {
        broadcast(makeMsg(MSG.ERROR, { targetId: msg.id, message: 'cola llena' }, msg.id));
        return;
      }
      if (nodepodReady) handleExec(msg.payload, msg.id);
      else pendingJobs.push({ payload: msg.payload, id: msg.id });
    }
  });

  // Aviso de "escuchando pero sin Nodepod"
  broadcast(makeMsg(MSG.READY, { nodepod: false, version: '0.1' }));

  bootNodepod()
    .then(() => {
      nodepodReady = true;
      broadcast(makeMsg(MSG.READY, { nodepod: true, version: '0.1' }));
      flushPending();
      console.log('[bridge] Nodepod listo, cola vaciada');
    })
    .catch((e) => console.error('[bridge] boot falló', e));

  console.log('[bridge] iniciado');
}

import { MSG, makeMsg, isBridgeMsg } from '../protocol/messages.js';
import { execCommand, bootNodepod } from './nodepod-boot.js';

let listeners = [];
let nodepodReady = false;
let booted = false;
const pendingJobs = [];

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

  // 1) Registrar listener ANTES de bootear Nodepod
  window.addEventListener('message', (ev) => {
    if (!isBridgeMsg(ev.data)) return;
    const msg = ev.data;
    if (msg.type === MSG.HELLO) {
      // Responder SIEMPRE (aunque Nodepod aún no arrancó)
      broadcast(makeMsg(MSG.READY, { nodepod: nodepodReady, version: '0.1' }, msg.id));
    } else if (msg.type === MSG.PING) {
      broadcast(makeMsg(MSG.PONG, {}, msg.id));
    } else if (msg.type === MSG.EXEC) {
      if (nodepodReady) handleExec(msg.payload, msg.id);
      else pendingJobs.push({ payload: msg.payload, id: msg.id });
    }
  });

  // 2) Avisar que ya escuchamos (nodepod: false)
  broadcast(makeMsg(MSG.READY, { nodepod: false, version: '0.1' }));

  // 3) Bootear en paralelo sin bloquear
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

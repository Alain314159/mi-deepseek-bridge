import { MSG, makeMsg, isBridgeMsg } from '../protocol/messages.js';
import { execCommand, bootNodepod } from './nodepod-boot.js';
let listeners = [];
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
export function onMessage(h) { listeners.push(h); return () => { listeners = listeners.filter((x) => x !== h); }; }
export function startBridge() {
  window.addEventListener('message', async (ev) => {
    if (!isBridgeMsg(ev.data)) return;
    const msg = ev.data;
    if (msg.type === MSG.HELLO) broadcast(makeMsg(MSG.READY, { nodepod: true, version: '0.1' }));
    else if (msg.type === MSG.PING) broadcast(makeMsg(MSG.PONG, {}, msg.id));
    else if (msg.type === MSG.EXEC) handleExec(msg.payload, msg.id);
  });
  broadcast(makeMsg(MSG.READY, { nodepod: true, version: '0.1' }));
  bootNodepod().catch((e) => console.error('[bridge] boot falló', e));
  console.log('[bridge] iniciado');
}

export const VERSION = 1;
export const MSG = {
  HELLO: 'HELLO', EXEC: 'EXEC', CANCEL: 'CANCEL', PING: 'PING',
  READY: 'READY', STREAM: 'STREAM', RESULT: 'RESULT', ERROR: 'ERROR', PONG: 'PONG',
};
export function makeMsg(type, payload = {}, id = null) {
  return { v: VERSION, id: id || Math.random().toString(36).slice(2, 10), type, ts: Date.now(), payload };
}
export function isBridgeMsg(data) {
  return data && typeof data === 'object' && data.v === VERSION && typeof data.type === 'string';
}

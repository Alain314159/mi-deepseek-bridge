import { Nodepod, createBrowserHost, setRuntimeHost } from '@r1ck404/nodepod';

let instance = null;
let bootPromise = null;

export async function bootNodepod() {
  if (instance) return instance;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    try {
      const host = createBrowserHost();
      setRuntimeHost(host);
    } catch (e) {
      console.warn('[nodepod-boot] setRuntimeHost:', e.message);
    }

    const np = await Nodepod.boot({
      files: { '/home/project/README.md': '# Proyecto\n' },
      workdir: '/home/project',
      serviceWorker: false,
      swUrl: './__sw__.js',
      workerUrl: './__worker__.js',
      // Para activar persistencia entre recargas, descomentar:
      // persistence: { id: 'default' },
    });
    instance = np;
    return np;
  })();

  try {
    return await bootPromise;
  } catch (e) {
    // Fix bug #5: permitir reintentar tras error
    console.error('[nodepod-boot] boot falló, reseteando para reintentar:', e);
    bootPromise = null;
    throw e;
  }
}

export function getNodepod() { return instance; }

export async function execCommand(cmd, opts = {}) {
  const np = await bootNodepod();
  const timeout = opts.timeout ?? 120000;
  const start = Date.now();
  const p = await np.spawn('sh', ['-c', cmd], { cwd: opts.cwd });
  let stdout = '';
  let stderr = '';
  const MAX_OUT = 1_000_000; // 1 MB cap por stream

  function cap(s){ return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n[truncado]' : s; }

  p.on('output', (chunk) => {
    stdout = cap(stdout + chunk);
    if (opts.onStdout) opts.onStdout(chunk);
  });
  p.on('error', (chunk) => {
    stderr = cap(stderr + chunk);
    if (opts.onStderr) opts.onStderr(chunk);
  });

  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { try { p.kill(); } catch {} resolve('__timeout__'); }, timeout);
  });
  const winner = await Promise.race([p.completion, timedOut]);
  clearTimeout(timer);

  if (winner === '__timeout__') {
    return { stdout, stderr: stderr + '\n[bridge] timeout ' + timeout + 'ms', exitCode: 124, ms: Date.now() - start };
  }
  return {
    stdout: winner.stdout ?? stdout,
    stderr: winner.stderr ?? stderr,
    exitCode: winner.exitCode ?? 0,
    ms: Date.now() - start,
  };
}

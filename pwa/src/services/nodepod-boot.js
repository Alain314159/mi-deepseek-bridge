import { Nodepod } from '@r1ck404/nodepod';
let instance = null;
let bootPromise = null;
export async function bootNodepod() {
  if (instance) return instance;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const np = await Nodepod.boot({
      files: { '/home/project/README.md': '# Proyecto\n' },
      workdir: '/home/project',
      serviceWorker: false,
    });
    instance = np;
    return np;
  })();
  return bootPromise;
}
export function getNodepod() { return instance; }
export async function execCommand(cmd, opts = {}) {
  const np = await bootNodepod();
  const timeout = opts.timeout ?? 120000;
  const start = Date.now();
  const p = await np.spawn('sh', ['-c', cmd], { cwd: opts.cwd });
  let stdout = '';
  let stderr = '';
  p.on('output', (chunk) => { stdout += chunk; if (opts.onStdout) opts.onStdout(chunk); });
  p.on('error', (chunk) => { stderr += chunk; if (opts.onStderr) opts.onStderr(chunk); });
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { try { p.kill(); } catch {} resolve('timeout'); }, timeout);
  });
  const winner = await Promise.race([p.completion, timedOut]);
  clearTimeout(timer);
  if (winner === 'timeout') {
    return { stdout, stderr: stderr + '\n[bridge] timeout ' + timeout + 'ms', exitCode: 124, ms: Date.now() - start };
  }
  return {
    stdout: winner.stdout ?? stdout,
    stderr: winner.stderr ?? stderr,
    exitCode: winner.exitCode ?? 0,
    ms: Date.now() - start,
  };
}

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { startBridge } from './services/bridge.js';
import { execCommand, bootNodepod } from './services/nodepod-boot.js';

const booted = ref(false);
const bootError = ref(null);
const input = ref('');
const terminalEl = ref(null);

let term = null;
let fitAddon = null;

function append(line) { if (term) term.writeln(line); }

async function handleExec(cmd) {
  if (!cmd.trim()) return;
  append('\x1b[36m$ ' + cmd + '\x1b[0m');
  try {
    const r = await execCommand(cmd, {
      onStdout: (c) => term && term.write(c),
      onStderr: (c) => term && term.write('\x1b[31m' + c + '\x1b[0m'),
    });
    append('\x1b[2m[exit ' + r.exitCode + ' · ' + r.ms + 'ms]\x1b[0m');
  } catch (e) {
    append('\x1b[31m[error] ' + e.message + '\x1b[0m');
  }
}

async function onSubmit() {
  const cmd = input.value;
  input.value = '';
  await handleExec(cmd);
}

onMounted(async () => {
  try {
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: '#0b0b14', foreground: '#e0e0f0' } });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl.value);
    fitAddon.fit();
    window.addEventListener('resize', () => fitAddon && fitAddon.fit());
    append('[bridge] arrancando Nodepod…');
    await bootNodepod();
    booted.value = true;
    append('[bridge] Nodepod listo. Escribí un comando abajo.');
  } catch (e) {
    bootError.value = String(e);
    append('\x1b[31m[bridge] ERROR: ' + e.message + '\x1b[0m');
  }
  startBridge();
});

onBeforeUnmount(() => { if (term) term.dispose(); });
</script>

<template>
  <div class="app">
    <header>
      <h1>Mi DeepSeek Bridge</h1>
      <span :class="['status', booted ? 'ok' : bootError ? 'err' : 'wait']">
        {{ booted ? '● Nodepod listo' : bootError ? '● Error' : '○ Arrancando…' }}
      </span>
    </header>
    <main ref="terminalEl" class="term"></main>
    <form @submit.prevent="onSubmit" class="inputbar">
      <input v-model="input" placeholder="Comando (git status, ls, node -e ...)"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button type="submit">▶</button>
    </form>
  </div>
</template>

// DOM boot for the Angry Birds 1.0 port.
import { GameApp, loadFileSystem, setStatusFn } from './app.js';

const statusEl = document.getElementById('status');
const canvas = document.getElementById('screen');
const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };
setStatusFn(setStatus);

async function boot(buffer) {
  setStatus('Extracting original resources…');
  const fsys = await loadFileSystem(buffer);
  setStatus('Starting original game logic…');
  const app = new GameApp(fsys, canvas);
  window.__app = app;
  setStatus('');
  document.body.classList.add('running');
  app.run();
}

async function start() {
  const picker = document.getElementById('ipa');
  picker.addEventListener('change', async () => {
    const f = picker.files && picker.files[0];
    if (f) boot(await f.arrayBuffer()).catch(fail);
  });
  try {
    setStatus('Loading Angry Birds 1.0.ipa…');
    const r = await fetch('Angry%20Birds%201.0.ipa');
    if (!r.ok) throw new Error('not served');
    await boot(await r.arrayBuffer());
  } catch (e) {
    if (e && e.message === 'not served') {
      setStatus('Select your original “Angry Birds 1.0.ipa” to start.');
      document.body.classList.add('need-ipa');
    } else fail(e);
  }
}
function fail(e) {
  console.error(e);
  setStatus('Error: ' + (e && e.message) + (e && e.luaTraceback ? '\n' + e.luaTraceback.join('\n') : ''));
}

start();

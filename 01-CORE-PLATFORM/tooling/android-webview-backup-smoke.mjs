import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const packageName = 'ir.majora.classicbag';
const pid = adb('shell', 'pidof', packageName).split(/\s+/)[0];
if (!pid) throw new Error('App process is not running');
adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);

let target;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
    target = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
    if (target) break;
  } catch { /* Wait for the debug WebView. */ }
  await delay(1000);
}
if (!target) throw new Error('Debug WebView target unavailable');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const dialogs = [];
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  if (response.method === 'Page.javascriptDialogOpening') {
    dialogs.push(response.params?.message ?? 'dialog without message');
    socket.send(JSON.stringify({ id: ++nextId, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    return;
  }
  if (!response.id) return;
  const item = pending.get(response.id);
  if (!item) return;
  pending.delete(response.id);
  if (response.error || response.result?.exceptionDetails) item.reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
  else item.resolve(response.result?.result?.value);
});
function command(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`WebView command timed out: ${method}`)); }, 20000).unref();
  });
}
const evaluate = expression => command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

try {
  socket.send(JSON.stringify({ id: ++nextId, method: 'Page.enable' }));
  const home = await evaluate('document.body.innerText.includes("مدیریت روز فروشگاه")');
  if (!home) throw new Error('Home screen did not render');
  await evaluate('document.querySelector(".menu-trigger").click()');
  await delay(200);
  const settings = await evaluate('(() => { const button = [...document.querySelectorAll(".menu-drawer button")].find(item => item.textContent.includes("تنظیمات")); if (!button) return false; button.click(); return true; })()');
  if (!settings) throw new Error('Settings navigation unavailable');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    ready = await evaluate('document.body.innerText.includes("ذخیرهٔ نسخهٔ جدید قالب (فعلی:")');
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error('Native repository did not finish initializing');
  const password = randomBytes(18).toString('hex');
  const entered = await evaluate(`(() => { const input = document.querySelector('.backup-card input[type="password"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(password)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  if (!entered) throw new Error('Backup password input unavailable');
  await delay(300);
  await evaluate('window.__majoraTestAlerts = []; window.alert = message => window.__majoraTestAlerts.push(String(message));');
  const canTap = await evaluate('(() => { const button = document.querySelector(".backup-card button.primary"); if (!button || button.disabled) return false; document.documentElement.style.scrollBehavior = "auto"; button.scrollIntoView({ behavior: "instant", block: "center" }); return true; })()');
  if (!canTap) throw new Error('Backup button remained disabled');
  await delay(300);
  const point = await evaluate('(() => { const rect = document.querySelector(".backup-card button.primary").getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: rect.top >= 0 && rect.bottom <= innerHeight }; })()');
  if (!point.visible) throw new Error(`Backup button did not scroll into view: ${JSON.stringify(point)}`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await delay(300);
  const afterTap = await evaluate('JSON.stringify({ button: document.querySelector(".backup-card button.primary")?.textContent, alerts: window.__majoraTestAlerts })');
  console.log(`Backup control after native tap: ${afterTap}`);
  let files = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    try { files = adb('shell', 'find', '/sdcard/Documents/MAJORA/Backups', '-type', 'f', '-name', '*.zip'); }
    catch { /* The backup directory is created on demand. */ }
    if (files.includes('majora-backup-')) break;
    await delay(1000);
  }
  if (!files.includes('majora-backup-')) {
    const feedback = await evaluate('JSON.stringify({ alerts: window.__majoraTestAlerts, button: document.querySelector(".backup-card button.primary")?.textContent, filesystemPlugin: !!window.Capacitor?.Plugins?.Filesystem })');
    const nearby = adb('shell', 'find', '/sdcard', '-maxdepth', '7', '-iname', '*backup*');
    throw new Error(`Encrypted backup was not saved in Documents. Dialogs: ${JSON.stringify(dialogs)}. Nearby files: ${nearby}. UI: ${feedback}`);
  }
  const file = files.split(/\r?\n/).find(item => item.includes('majora-backup-'));
  const size = Number(adb('shell', 'stat', '-c', '%s', file));
  if (!(size > 100)) throw new Error('Encrypted backup is empty');
  console.log(`Native backup smoke passed: ${file} (${size} bytes)`);
} finally {
  socket.close();
  adb('forward', '--remove', 'tcp:9222');
}

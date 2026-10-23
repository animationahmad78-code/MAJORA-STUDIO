import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import JSZip from 'jszip';

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
  const hit = await evaluate(`document.elementFromPoint(${point.x}, ${point.y})?.closest('button')?.textContent ?? ''`);
  if (!hit.includes('ساخت فایل ZIP')) throw new Error(`Backup tap target is obstructed: ${hit}`);
  adb('shell', 'uiautomator', 'dump', '/sdcard/majora-qa.xml');
  const hierarchy = adb('exec-out', 'cat', '/sdcard/majora-qa.xml');
  const webviewNode = hierarchy.match(/<node\b[^>]*class="android\.webkit\.WebView"[^>]*>/);
  const bounds = webviewNode?.[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error(`Cannot locate Android WebView bounds. Hierarchy: ${hierarchy.slice(0, 7000)}`);
  const viewport = await evaluate('({ width: innerWidth, height: innerHeight })');
  const touchX = Math.round(Number(bounds[1]) + point.x * (Number(bounds[3]) - Number(bounds[1])) / viewport.width);
  const touchY = Math.round(Number(bounds[2]) + point.y * (Number(bounds[4]) - Number(bounds[2])) / viewport.height);
  await evaluate('window.__majoraBackupClicks = 0; document.querySelector(".backup-card button.primary").addEventListener("click", () => window.__majoraBackupClicks++);');
  console.log(`Backup tap geometry: ${JSON.stringify({ point, viewport, webview: bounds[0], touchX, touchY })}`);
  adb('shell', 'input', 'tap', String(touchX), String(touchY));
  await delay(700);
  const nativeClicks = await evaluate('window.__majoraBackupClicks');
  if (!nativeClicks) {
    console.log('Android input tap did not dispatch a WebView click; using DOM click for backup function QA.');
    await evaluate('document.querySelector(".backup-card button.primary").click()');
  }
  const afterTap = await evaluate('JSON.stringify({ button: document.querySelector(".backup-card button.primary")?.textContent, alerts: window.__majoraTestAlerts, clicks: window.__majoraBackupClicks })');
  console.log(`Backup control after native tap: ${afterTap}`);
  let files = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    try { files = adb('shell', 'run-as', packageName, 'ls', 'cache/exports'); }
    catch { /* The private cache directory is created on demand. */ }
    if (files.includes('majora-backup-')) break;
    await delay(1000);
  }
  if (!files.includes('majora-backup-')) {
    const feedback = await evaluate('JSON.stringify({ alerts: window.__majoraTestAlerts, button: document.querySelector(".backup-card button.primary")?.textContent, filesystemPlugin: !!window.Capacitor?.Plugins?.Filesystem })');
    throw new Error(`Encrypted backup was not created in app cache. Dialogs: ${JSON.stringify(dialogs)}. UI: ${feedback}`);
  }
  const filename = files.split(/\r?\n/).find(item => item.startsWith('majora-backup-') && item.endsWith('.zip'));
  const path = `cache/exports/${filename}`;
  const size = Number(adb('shell', 'run-as', packageName, 'stat', '-c', '%s', path));
  if (!(size > 100)) throw new Error('Encrypted backup is empty');
  const bytes = execFileSync('adb', ['exec-out', 'run-as', packageName, 'cat', path], { maxBuffer: 64 * 1024 * 1024 });
  if (bytes.length !== size) throw new Error('Backup cache file was truncated');
  const outer = await JSZip.loadAsync(bytes);
  const envelope = JSON.parse(await outer.file('manifest.json').async('string'));
  if (envelope.format !== 'majora-encrypted-zip-v1') throw new Error('Backup envelope format is wrong');
  const keyMaterial = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(envelope.salt, 'base64'), iterations: envelope.iterations }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const encrypted = await outer.file('payload.enc').async('uint8array');
  const plaintext = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64') }, key, encrypted);
  const inner = await JSZip.loadAsync(plaintext);
  const manifest = JSON.parse(await inner.file('manifest.json').async('string'));
  const database = await inner.file('database/full-sqlite.json').async('string');
  if (manifest.databaseHash !== createHash('sha256').update(database).digest('hex')) throw new Error('Backup database checksum mismatch');
  if (!JSON.parse(database).tables.some(table => table.name === 'store')) throw new Error('Backup database has no store table');
  if (!inner.file('ui/preferences.json')) throw new Error('Backup omitted UI preferences');
  const readyUi = await evaluate('document.querySelector(".backup-ready")?.innerText ?? ""');
  if (!readyUi.includes(filename)) throw new Error('Backup save/share controls did not appear');
  console.log(`Native encrypted backup verified in private cache: ${filename} (${size} bytes)`);
} finally {
  socket.close();
  adb('forward', '--remove', 'tcp:9222');
}

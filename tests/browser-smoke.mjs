import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.HARP_TEST_URL || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.HARP_BROWSER_EXECUTABLE ? { executablePath: process.env.HARP_BROWSER_EXECUTABLE } :
    process.env.HARP_BROWSER_CHANNEL ? { channel: process.env.HARP_BROWSER_CHANNEL } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const errors = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const count = async () => Number.parseInt(await page.locator('#pluckCount').innerText());
const results = {};
try {
  await page.goto(base);
  await page.locator('#harp').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.pedal').length === 7);
  console.log('INITIAL DOM', (await page.locator('body').innerText()).slice(0, 1500));
  await page.screenshot({ path: fileURLToPath(new URL('../预览/桌面演奏.png', import.meta.url)), fullPage: true });
  const rect = await page.locator('#harp').boundingBox();
  const scale = Math.min(rect.width / 1000, rect.height / 670);
  const ox = (rect.width - 1000 * scale) / 2, oy = (rect.height - 670 * scale) / 2;
  const xy = (x, y) => ({ x: rect.x + ox + x * scale, y: rect.y + oy + y * scale });
  const point = xy(370.3, 320);
  await page.mouse.click(point.x, point.y);
  assert.equal(await count(), 1, 'mouse click must pluck a real string');
  await page.keyboard.press('a');
  await page.waitForFunction(() => Number.parseInt(document.querySelector('#pluckCount').textContent) >= 2);
  assert.match(await page.locator('#currentNote').innerText(), /C4/);
  results.mouseAndKeyboard = true;
  const from = xy(255, 310), to = xy(620, 310);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 }); await page.mouse.up();
  assert.ok(await count() > 12, 'mouse drag must produce multiple string crossings');
  results.glissandoPlucks = await count();

  await page.getByRole('button', { name: '听一段示范' }).click();
  await page.getByRole('button', { name: '停止示范' }).waitFor();
  const beforeDemo = await count(); await page.waitForTimeout(450);
  assert.ok(await count() > beforeDemo);
  await page.getByRole('button', { name: '停止示范' }).click();
  const stopped = await count(); await page.waitForTimeout(400);
  assert.equal(await count(), stopped, 'stop demo must cancel all scheduled notes');
  results.demo = true;

  await page.getByLabel('选择演奏音域').selectOption('focus');
  assert.equal(await page.locator('#stringBadge').innerText(), '22 STRINGS');
  assert.equal(await page.locator('#rangeText').innerText(), 'C3 — C6');
  await page.getByLabel('选择调性').selectOption('G');
  assert.match(await page.locator('.pedal[data-letter="F"]').getAttribute('aria-label'), /升半音/);
  await page.locator('.pedal[data-letter="F"]').click();
  assert.equal(await page.getByLabel('选择调性').inputValue(), 'custom');
  await page.getByRole('button', { name: '温暖', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '温暖', exact: true }).getAttribute('aria-pressed'), 'true');
  results.controlsAndPedals = true;
  await page.getByRole('button', { name: '演奏指南' }).click();
  assert.equal(await page.locator('#helpDialog').evaluate(e => e.open), true);
  await page.getByRole('button', { name: '开始我的演奏' }).click();
  assert.equal(await page.locator('#helpDialog').evaluate(e => e.open), false);
  results.guide = true;

  await page.getByRole('button', { name: '录下这一刻' }).click();
  await page.getByRole('button', { name: /停止录音/ }).waitFor();
  await page.locator('#harp').focus();
  await page.keyboard.press('a'); await page.keyboard.press('d'); await page.keyboard.press('g');
  await page.waitForTimeout(650);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /停止录音/ }).click();
  const download = await downloadEvent;
  const recordingPath = fileURLToPath(new URL('../预览/验收录音.webm', import.meta.url));
  await download.saveAs(recordingPath);
  results.recording = { filename: download.suggestedFilename(), success: !(await download.failure()) };
  assert.ok(results.recording.success);
  results.recording.audio = await page.evaluate(async bytes => {
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
    let squares = 0, peak = 0, samples = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      for (const sample of decoded.getChannelData(channel)) {
        squares += sample * sample; peak = Math.max(peak, Math.abs(sample)); samples++;
      }
    }
    await context.close();
    return { duration: decoded.duration, channels: decoded.numberOfChannels, rms: Math.sqrt(squares / samples), peak };
  }, [...await readFile(recordingPath)]);
  assert.ok(results.recording.audio.rms > 0.0001, 'recorded application output must be audible, not silence');
  await page.getByLabel('选择演奏音域').selectOption('full');
  await page.getByLabel('选择调性').selectOption('C');
  await page.getByRole('button', { name: '音乐会', exact: true }).click();
  await page.locator('#dampBtn').click();
  await page.screenshot({ path: fileURLToPath(new URL('../预览/桌面演奏_已验证.png', import.meta.url)), fullPage: true });
  await page.locator('#stage').screenshot({ path: fileURLToPath(new URL('../预览/竖琴应用.png', import.meta.url)) });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  mobile.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await mobile.goto(base);
  await mobile.waitForFunction(() => document.querySelectorAll('.pedal').length === 7);
  console.log('MOBILE DOM', (await mobile.locator('body').innerText()).slice(0, 500));
  results.mobileOverflow = await mobile.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(results.mobileOverflow.scroll <= results.mobileOverflow.viewport + 1, 'mobile must not overflow horizontally');
  await mobile.screenshot({ path: fileURLToPath(new URL('../预览/手机演奏.png', import.meta.url)), fullPage: true });
  await mobile.getByRole('button', { name: '演奏指南' }).click();
  results.mobileGuideOverflow = await mobile.locator('#helpDialog').evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  assert.ok(results.mobileGuideOverflow.scroll <= results.mobileGuideOverflow.width + 1);
  await mobile.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(new URL('../预览/页面验收.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), results, errors, consoleErrors }, null, 2));
  console.log(JSON.stringify({ results, errors, consoleErrors }, null, 2));
} finally { await browser.close(); }

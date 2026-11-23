import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.HARP_TEST_URL || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.HARP_BROWSER_EXECUTABLE ? { executablePath: process.env.HARP_BROWSER_EXECUTABLE } :
    process.env.HARP_BROWSER_CHANNEL ? { channel: process.env.HARP_BROWSER_CHANNEL } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [], requests = [], completedRequests = [], consoleErrors = [], blockedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
page.on('requestfinished', request => completedRequests.push(request.url()));
page.on('requestfailed', request => blockedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
try {
  await page.goto(base);
  console.log('LOCAL PAGE', (await page.locator('body').innerText()).slice(0, 450));
  const image = await page.evaluate(async () => {
    const { FilesetResolver, HandLandmarker } = await import('/vendor/vision_bundle.mjs');
    const model = await HandLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/wasm/'), {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE', numHands: 2,
    });
    const img = new Image(); img.src = '/tests/fixtures/right_hands.jpg'; await img.decode();
    const result = model.detect(img); model.close();
    return { width: img.naturalWidth, height: img.naturalHeight, hands: result.landmarks.length,
      points: result.landmarks.map(points => points.length), handedness: result.handedness.map(h => h[0]?.categoryName) };
  });
  assert.equal(image.hands, 2, 'official sample must produce two real detections');
  assert.deepEqual(image.points, [21, 21]);

  // This emulates a device using a moving public sample image; it never accesses
  // the user's physical camera, microphone, or personal image/video.
  await page.evaluate(() => {
    window.__fakeTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image(); img.src = '/tests/fixtures/right_hands.jpg'; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 800;
      const context = canvas.getContext('2d');
      const start = performance.now();
      const draw = now => {
        context.fillStyle = '#e2e2e2'; context.fillRect(0, 0, 960, 800);
        const dx = Math.sin((now - start) / 1000) * 160;
        context.drawImage(img, 110 + dx, 80, 740, 640);
        if (window.__fakeTracks.every(track => track.readyState !== 'ended')) requestAnimationFrame(draw);
      };
      draw(start);
      const stream = canvas.captureStream(25);
      window.__fakeTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.getByRole('button', { name: '开启摄像头演奏' }).click();
  await page.waitForFunction(() => document.querySelector('#cameraPreview').dataset.phase === 'running', null, { timeout: 30000 });
  await page.waitForFunction(() => /只手/.test(document.querySelector('#handCount').textContent), null, { timeout: 20000 });
  await page.waitForTimeout(2200);
  const camera = await page.evaluate(() => ({
    phase: document.querySelector('#cameraPreview').dataset.phase,
    hands: document.querySelector('#handCount').textContent,
    fps: document.querySelector('#stageStatus').textContent,
    plucks: document.querySelector('#pluckCount').textContent,
    video: { width: document.querySelector('video').videoWidth, height: document.querySelector('video').videoHeight },
  }));
  await page.screenshot({ path: fileURLToPath(new URL('../预览/摄像头模拟输入验证.png', import.meta.url)), fullPage: true });
  console.log('CAMERA', camera);
  await page.getByRole('button', { name: '关闭摄像头', exact: true }).click();
  const stopped = await page.evaluate(() => ({
    phase: document.querySelector('#cameraPreview').dataset.phase,
    tracks: window.__fakeTracks.map(t => t.readyState),
    hasStream: !!document.querySelector('video').srcObject,
  }));
  assert.equal(stopped.phase, 'idle');
  assert.ok(stopped.tracks.every(t => t === 'ended'));
  assert.equal(stopped.hasStream, false);
  assert.deepEqual(errors, []);
  const externalRequests = requests.filter(url => !url.startsWith(base) && !url.startsWith('blob:') && !url.startsWith('data:'));
  const completedExternalRequests = completedRequests.filter(url => !url.startsWith(base) && !url.startsWith('blob:') && !url.startsWith('data:'));
  const expectedDiagnostics = consoleErrors.filter(message => message.startsWith('INFO: Created TensorFlow') || message.includes('odml.pa.googleapis.com'));
  const unexpectedConsoleErrors = consoleErrors.filter(message => !expectedDiagnostics.includes(message));
  assert.deepEqual(unexpectedConsoleErrors, []);
  const report = { checkedAt: new Date().toISOString(), image, camera, stopped, errors, unexpectedConsoleErrors, expectedDiagnostics, externalRequests, completedExternalRequests, blockedRequests };
  await writeFile(new URL('../预览/模型与模拟摄像头验收.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(completedExternalRequests, [], 'no external request may complete');
  const privacyPolicy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content').catch(() => null);
  if (externalRequests.length) assert.match(privacyPolicy ?? '', /connect-src\s+'self'/, 'external telemetry attempts must be blocked by CSP');
} finally { await browser.close(); }

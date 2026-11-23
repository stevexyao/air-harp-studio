import { StableHandIds } from './gesture-core.js';

/** Local MediaPipe inference. The video is never uploaded or recorded.
 * Returned landmarks are mirrored once; present video with scaleX(-1). */
export class HandCamera {
  constructor(video, onResults, onStatus) {
    this.video = video;
    this.onResults = onResults;
    this.onStatus = onStatus;
    this.stream = null;
    this.model = null;
    this.phase = 'idle';
    this.generation = 0;
    this.frame = 0;
    this.ids = new StableHandIds();
    this.detect = this.detect.bind(this);
  }

  async start() {
    if (this.phase === 'loading' || this.phase === 'running') return;
    const generation = ++this.generation;
    this.setStatus('loading', '正在开启摄像头…');
    try {
      if (!window.isSecureContext) throw new Error('请通过本机启动器或 HTTPS 打开，才能使用摄像头。');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头，请使用 Chrome 或 Safari。');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (generation !== this.generation) return;
          this.fail('摄像头已断开，请连接后重新开启。');
        }, { once: true });
      }
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      this.setStatus('loading', '正在准备本地手部识别…');
      const { FilesetResolver, HandLandmarker } = await import('../vendor/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks(new URL('../wasm/', import.meta.url).href);
      if (generation !== this.generation) return;
      const model = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: new URL('../models/hand_landmarker.task', import.meta.url).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      if (generation !== this.generation) { model.close(); return; }
      this.model = model;
      this.lastVideoTime = -1;
      this.lastInference = -Infinity;
      this.lastTimestamp = -Infinity;
      this.interval = 50;
      this.sampleAt = performance.now();
      this.samples = 0;
      this.ids.reset();
      this.setStatus('running', '请将手放入画面，食指横向穿过琴弦');
      this.frame = requestAnimationFrame(this.detect);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(cameraError(error));
    }
  }

  stop() {
    ++this.generation;
    this.release();
    const now = performance.now();
    this.onResults([], now, now);
    this.setStatus('idle', '摄像头已关闭');
  }

  setStatus(phase, message, extra = {}) {
    this.phase = phase;
    this.onStatus({ phase, message, ...extra });
  }

  release() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    try { this.model?.close(); } catch { /* A failed WASM graph may already be closed. */ }
    this.model = null;
    this.ids.reset();
  }

  fail(message) {
    ++this.generation;
    this.release();
    const now = performance.now();
    this.onResults([], now, now);
    this.setStatus('error', message);
  }

  detect(now) {
    if (this.phase !== 'running' || !this.model) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime && now - this.lastInference >= this.interval) {
      this.lastVideoTime = this.video.currentTime;
      this.lastInference = now;
      try {
        const capturedAt = Math.max(performance.now(), this.lastTimestamp + 0.01);
        this.lastTimestamp = capturedAt;
        const result = this.model.detectForVideo(this.video, capturedAt);
        const inferenceMs = performance.now() - capturedAt;
        this.interval = inferenceMs > 65 ? 95 : 50;
        const observations = result.landmarks.map((rawLandmarks, i) => {
          const category = result.handedness[i]?.[0];
          const name = category?.categoryName;
          const landmarks = rawLandmarks.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }));
          return {
            landmarks, rawLandmarks,
            worldLandmarks: result.worldLandmarks?.[i],
            handedness: name === 'Left' || name === 'Right' ? name : 'Unknown',
            confidence: category?.score ?? 0,
            index: landmarks[8], wrist: landmarks[0],
            imageAspect: this.video.videoWidth / this.video.videoHeight,
          };
        });
        const hands = this.ids.update(observations, capturedAt);
        this.onResults(hands, capturedAt, performance.now());
        this.samples++;
        if (now - this.sampleAt > 1000) {
          this.setStatus('running', hands.length ? `已识别 ${hands.length} 只手` : '请将手放入画面，食指横向穿过琴弦', {
            fps: Math.round(this.samples * 1000 / (now - this.sampleAt)),
            inferenceMs: Math.round(inferenceMs),
          });
          this.samples = 0;
          this.sampleAt = now;
        }
      } catch {
        this.fail('手部识别暂时中断，请重新开启摄像头。');
        return;
      }
    }
    this.frame = requestAnimationFrame(this.detect);
  }
}

export function cameraError(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '摄像头权限未开启。请在浏览器地址栏允许摄像头，然后重试。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有找到摄像头。请连接摄像头后重试，也可以先用鼠标试奏。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头暂时无法使用。请关闭其他占用摄像头的应用后重试。';
  if (name === 'OverconstrainedError') return '摄像头不支持当前设置，请更换摄像头或浏览器。';
  if (error instanceof Error && /HTTPS|当前浏览器/.test(error.message)) return error.message;
  return '本地手部识别资源未能加载。请通过启动器打开应用，或先使用鼠标试奏。';
}

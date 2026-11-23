import test from 'node:test';
import assert from 'node:assert/strict';
import { StringPlucker, StableHandIds } from '../src/gesture-core.js';
import { HandCamera, cameraError } from '../src/hands.js';

const strings = [
  { id: 'C4', x: 0.3, top: 0.2, bottom: 0.9 },
  { id: 'D4', x: 0.4, top: 0.25, bottom: 0.85 },
  { id: 'E4', x: 0.5, top: 0.3, bottom: 0.8 },
];
const p = (x, y = 0.5, id = 'left') => ({ id, x, y });

test('initial fingertip appearance does not sound a note', () => {
  const detector = new StringPlucker();
  assert.deepEqual(detector.update([p(0.29)], strings, 0), []);
  assert.deepEqual(detector.update([p(0.3)], strings, 50), []);
});

test('stationary hand with subpixel noise does not repeatedly pluck', () => {
  const detector = new StringPlucker();
  detector.update([p(0.3)], strings, 0);
  let hits = 0;
  for (let i = 1; i <= 100; i++) {
    hits += detector.update([p(0.3 + Math.sin(i * 3.7) * 0.002)], strings, i * 50).length;
  }
  assert.equal(hits, 0);
});

test('horizontal crossing sounds the intersected string once', () => {
  const detector = new StringPlucker();
  detector.update([p(0.28)], strings, 0);
  detector.update([p(0.299)], strings, 50);
  const [hit] = detector.update([p(0.32)], strings, 100);
  assert.equal(hit.stringId, 'C4');
  assert.equal(hit.handId, 'left');
  assert.equal(hit.x, 0.3);
  assert.equal(hit.y, 0.5);
  assert.ok(hit.velocity > 0.2 && hit.velocity <= 1);
  assert.deepEqual(detector.update([p(0.33)], strings, 150), []);
});

test('crossing above or below the actual string never sounds', () => {
  for (const y of [0.1, 0.99]) {
    const detector = new StringPlucker();
    detector.update([p(0.28, y)], strings, 0);
    assert.deepEqual(detector.update([p(0.32, y)], strings, 50), []);
  }
});

test('diagonal crossing tests the intersection, not the final fingertip y', () => {
  const detector = new StringPlucker();
  detector.update([p(0.28, 0.1)], strings, 0);
  assert.deepEqual(detector.update([p(0.32, 0.24)], strings, 50), []);
});

test('fast continuous glissando returns every crossed string in motion order', () => {
  for (const [from, to, expected] of [[0.27, 0.53, ['C4', 'D4', 'E4']], [0.53, 0.27, ['E4', 'D4', 'C4']]]) {
    const detector = new StringPlucker();
    detector.update([p(from)], strings, 0);
    const hits = detector.update([p(to)], strings, 80);
    assert.deepEqual(hits.map(hit => hit.stringId), expected);
  }
});

test('cooldown rejects immediate noise recross but permits deliberate return', () => {
  const detector = new StringPlucker();
  detector.update([p(0.28)], strings, 0);
  assert.equal(detector.update([p(0.32)], strings, 50).length, 1);
  assert.equal(detector.update([p(0.28)], strings, 100).length, 0);
  assert.equal(detector.update([p(0.32)], strings, 200).length, 1);
});

test('lost hands, long frame gaps, and impossible teleports establish new baselines', () => {
  const lost = new StringPlucker();
  lost.update([p(0.28)], strings, 0);
  lost.update([], strings, 50);
  assert.deepEqual(lost.update([p(0.32)], strings, 100), []);
  const gap = new StringPlucker();
  gap.update([p(0.28)], strings, 0);
  assert.deepEqual(gap.update([p(0.32)], strings, 400), []);
  const teleport = new StringPlucker();
  teleport.update([p(0.1)], strings, 0);
  assert.deepEqual(teleport.update([p(0.7)], strings, 50), []);
});

test('two hands can cross the same string independently', () => {
  const detector = new StringPlucker();
  detector.update([p(0.28, 0.5, 'left'), p(0.32, 0.6, 'right')], strings, 0);
  const hits = detector.update([p(0.32, 0.5, 'left'), p(0.28, 0.6, 'right')], strings, 50);
  assert.deepEqual(hits.map(h => h.handId).sort(), ['left', 'right']);
});

test('reversed detector ordering preserves stable identities', () => {
  const ids = new StableHandIds();
  const hand = (x, handedness) => ({ wrist: { x, y: 0.6 }, handedness });
  const first = ids.update([hand(0.2, 'Left'), hand(0.8, 'Right')], 0);
  const second = ids.update([hand(0.75, 'Right'), hand(0.25, 'Left')], 50);
  assert.equal(second[0].id, first[1].id);
  assert.equal(second[1].id, first[0].id);
  const third = ids.update([hand(0.45, 'Left'), hand(0.55, 'Right')], 100);
  const fourth = ids.update([hand(0.35, 'Right'), hand(0.65, 'Left')], 150);
  assert.equal(third[0].id, first[0].id);
  assert.equal(fourth[1].id, first[0].id);
  assert.equal(fourth[0].id, first[1].id);
});

test('camera errors explain actionable recovery without requiring network', () => {
  assert.match(cameraError({ name: 'NotAllowedError' }), /允许摄像头/);
  assert.match(cameraError({ name: 'NotFoundError' }), /没有找到摄像头/);
  assert.match(cameraError(new Error('network')), /本地/);
});

function browserMocks(getUserMedia) {
  const values = {
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia } },
    cancelAnimationFrame() {},
    requestAnimationFrame() { throw new Error('Inference must not start after cancellation'); },
  };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

test('stop during a pending camera permission stops a subsequently granted stream', async () => {
  let grant;
  const restore = browserMocks(() => new Promise(resolve => { grant = resolve; }));
  try {
    let stopped = 0;
    const track = { stop() { stopped++; } };
    const statuses = [];
    const video = { srcObject: null, pause() {}, async play() {} };
    const camera = new HandCamera(video, () => {}, status => statuses.push(status));
    const pending = camera.start();
    camera.stop();
    grant({ getTracks: () => [track] });
    await pending;
    assert.equal(stopped, 1);
    assert.equal(camera.phase, 'idle');
    assert.equal(video.srcObject, null);
    assert.equal(statuses.at(-1).phase, 'idle');
  } finally { restore(); }
});

test('stop while video playback is loading releases the camera without loading a model', async () => {
  let finishPlay;
  let stopped = 0;
  const track = { stop() { stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const restore = browserMocks(async () => stream);
  try {
    const video = {
      srcObject: null, pause() {},
      play() { return new Promise(resolve => { finishPlay = resolve; }); },
    };
    const camera = new HandCamera(video, () => {}, () => {});
    const pending = camera.start();
    await Promise.resolve();
    assert.equal(video.srcObject, stream);
    camera.stop();
    finishPlay();
    await pending;
    assert.equal(stopped, 1);
    assert.equal(camera.phase, 'idle');
    assert.equal(video.srcObject, null);
  } finally { restore(); }
});

test('permission denial leaves a recoverable error state and no active stream', async () => {
  const restore = browserMocks(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
  try {
    const results = [];
    const statuses = [];
    const video = { srcObject: null, pause() {} };
    const camera = new HandCamera(video, hands => results.push(hands), status => statuses.push(status));
    await camera.start();
    assert.equal(camera.phase, 'error');
    assert.equal(video.srcObject, null);
    assert.deepEqual(results.at(-1), []);
    assert.match(statuses.at(-1).message, /允许摄像头/);
    camera.stop();
    assert.equal(camera.phase, 'idle');
  } finally { restore(); }
});

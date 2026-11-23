import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHarpSamples, HarpAudio} from '../src/audio.js';

function rms(samples, start, length) {
  let power = 0;
  for (let i = start; i < start + length; i++) power += samples[i] ** 2;
  return Math.sqrt(power / length);
}
function correlation(samples, sr, hz) {
  const p = sr / hz, start = Math.round(sr * .1), length = Math.round(sr * .2);
  const lag = Math.round(p);
  let xy = 0, xx = 0, yy = 0;
  for (let i = start; i < start + length; i++) {
    xy += samples[i] * samples[i + lag];
    xx += samples[i] ** 2;
    yy += samples[i + lag] ** 2;
  }
  return xy / Math.sqrt(xx * yy);
}

test('Bass, middle and treble are finite, voiced, bounded and decay', () => {
  const sr = 44100;
  for (const midi of [24, 48, 60, 72, 84, 103]) {
    const samples = renderHarpSamples(sr, midi);
    let peak = 0;
    for (const v of samples) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > .7 && peak <= .741, `${midi}: normalized headroom`);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
    assert.ok(rms(samples, Math.floor(sr * .04), 2048) > .02, `${midi}: audible attack`);
    assert.ok(rms(samples, Math.floor(sr * 1.7), 2048) < rms(samples, Math.floor(sr * .08), 2048), `${midi}: natural decay`);
    const hz = 440 * 2 ** ((midi - 69) / 12);
    assert.ok(correlation(samples, sr, hz) > .90, `${midi}: periodic at concert pitch`);
  }
});

test('Tone changes the physical voice without invalidating it', () => {
  const normal = renderHarpSamples(24000, 60, 'concert');
  const warm = renderHarpSamples(24000, 60, 'warm');
  const bright = renderHarpSamples(24000, 60, 'bright');
  assert.ok(warm.length > normal.length);
  assert.ok(bright.length < normal.length);
  assert.notEqual(normal[128], warm[128]);
  assert.notEqual(normal[128], bright[128]);
});

test('Engine does not initialize audio without a user-gesture init call', () => {
  const audio = new HarpAudio();
  assert.equal(audio.state, 'uninitialized');
  assert.equal(audio.play(60), false);
  assert.equal(audio.recording, false);
  audio.setVolume(.8); audio.setReverb(.4); audio.setTone('warm'); audio.damp();
  assert.equal(audio.state, 'uninitialized');
  assert.throws(() => renderHarpSamples(0, 60), RangeError);
  assert.throws(() => renderHarpSamples(44100, NaN), RangeError);
});

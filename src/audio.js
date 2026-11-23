/**
 * Offline concert-harp voice engine. All sound is synthesized on this device.
 *
 * Usage: const harp = new HarpAudio(); await harp.init() in a user gesture;
 * harp.play(60, .7, -.2); harp.setVolume(.7); harp.setReverb(.35);
 * harp.setTone('concert' | 'warm' | 'bright'); harp.damp();
 * Recording captures the instrument output, never the microphone.
 */
const TAU = Math.PI * 2;
const TONES = {
  concert: { pluck: .21, brightness: .51, sustain: 1, body: .065 },
  warm: { pluck: .29, brightness: .29, sustain: 1.12, body: .09 },
  bright: { pluck: .14, brightness: .76, sustain: .92, body: .045 },
};
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

/** Pure physical string renderer, also used for repeatable acoustic checks. */
export function renderHarpSamples(sampleRate, midi, tone = 'concert') {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  if (!Number.isFinite(midi) || midi < 12 || midi > 108) throw new RangeError('MIDI note must be between 12 and 108');
  const settings = TONES[tone] || TONES.concert;
  const hz = frequency(midi);
  // Longer bass wires and shorter treble strings have distinctly different decay.
  const duration = clamp(8.8 - (midi - 24) * .105, 2.3, 9.5) * settings.sustain;
  const size = Math.ceil(sampleRate * duration);
  const data = new Float32Array(size);
  const rng = randomGenerator(Math.round(midi * 100 + settings.pluck * 1000));
  // A fractional feedback delay is tuned for its filter's phase delay. The
  // frequency-dependent loss models a string becoming rounder as it rings.
  const filterWeight = .11 + .13 * (1 - settings.brightness);
  const desiredDelay = sampleRate / hz - filterWeight;
  const delay = Math.max(2, Math.floor(desiredDelay));
  const fraction = desiredDelay - delay;
  const loop = new Float64Array(delay + 2);
  let mean = 0;
  for (let i = 0; i < loop.length; i++) {
    const phase = i / delay;
    const shape = phase < settings.pluck ? phase / settings.pluck : (1 - phase) / (1 - settings.pluck);
    loop[i] = shape - .5 + (rng() * 2 - 1) * .035 * settings.brightness;
    mean += loop[i];
  }
  mean /= loop.length;
  for (let i = 0; i < loop.length; i++) loop[i] -= mean;
  const t60 = duration * .76;
  const loss = Math.exp(-6.907755 / (hz * t60));
  let previous = 0;
  let highpass = 0;
  let previousInput = 0;
  let peak = .001;
  // Use the finished sample array as the waveguide history. No AudioWorklet,
  // remote sample service, or per-sample JS is needed during playback.
  if (midi >= 78) {
    // At short wavelengths a sampled delay's loss filter would overdamp even
    // the fundamental. Resolve the same triangular pluck into string modes in
    // the treble, preserving its pitch and a clear, bell-like singing tail.
    const partials = Math.min(14, Math.floor(sampleRate * .46 / hz));
    for (let harmonic = 1; harmonic <= partials; harmonic++) {
      const amplitude = Math.sin(Math.PI * harmonic * settings.pluck) / harmonic ** (1.6 - settings.brightness * .3);
      const phase = TAU * hz * harmonic / sampleRate;
      const sine = Math.sin(phase), cosine = Math.cos(phase);
      const decay = Math.exp(-6.907755 * (1 + (harmonic - 1) * .24) / (sampleRate * t60));
      let x = 0, y = 1, envelope = amplitude;
      for (let i = 0; i < size; i++) {
        const next = x * cosine + y * sine;
        y = y * cosine - x * sine;
        x = next;
        data[i] += x * envelope;
        envelope *= decay;
      }
    }
  } else {
    for (let i = 0; i < size; i++) {
      let value;
      if (i < loop.length) {
        value = loop[i];
      } else {
        const delayed = data[i - delay] * (1 - fraction) + data[i - delay - 1] * fraction;
        value = (delayed * (1 - filterWeight) + previous * filterWeight) * loss;
        previous = delayed;
      }
      data[i] = value;
    }
  }
  // Body modes and a tiny bridge impulse impart wood, instead of a bare wire.
  const modes = [
    { f: 112, a: .42, d: 9.5 }, { f: 228, a: .29, d: 13 },
    { f: 412, a: .16, d: 19 }, { f: 680, a: .09, d: 25 },
  ].filter(mode => mode.f < sampleRate * .45).map(mode => ({
    ...mode, x: 0, y: 1, s: Math.sin(TAU * mode.f / sampleRate), c: Math.cos(TAU * mode.f / sampleRate),
    envelope: 1, decay: Math.exp(-mode.d / sampleRate),
  }));
  const attackFrames = Math.max(1, Math.round(sampleRate * .0018));
  const releaseFrames = Math.round(sampleRate * .05);
  for (let i = 0; i < size; i++) {
    let body = 0;
    if (i < sampleRate * .7) {
      for (const mode of modes) {
        const x = mode.x * mode.c + mode.y * mode.s;
        mode.y = mode.y * mode.c - mode.x * mode.s;
        mode.x = x;
        mode.envelope *= mode.decay;
        body += x * mode.a * mode.envelope;
      }
    }
    let value = data[i] + body * settings.body;
    // Remove any residual displacement DC before normalization.
    highpass = value - previousInput + .998 * highpass;
    previousInput = value;
    value = highpass;
    value *= Math.min(1, i / attackFrames) * Math.min(1, (size - 1 - i) / releaseFrames);
    data[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const scale = .74 / peak;
  for (let i = 0; i < size; i++) data[i] *= scale;
  return data;
}

function hallImpulse(context) {
  const duration = 3.4;
  const frames = Math.ceil(context.sampleRate * duration);
  const impulse = context.createBuffer(2, frames, context.sampleRate);
  const rng = randomGenerator(71413);
  const reflections = [.027, .043, .071, .113, .179, .257];
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let filtered = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / context.sampleRate;
      filtered = filtered * .64 + (rng() * 2 - 1) * .36;
      data[i] = t < .021 ? 0 : filtered * Math.exp(-t * 2.6) * Math.min(1, (t - .021) / .03);
    }
    for (const t of reflections) {
      const index = Math.floor((t + channel * .003) * context.sampleRate);
      data[index] += Math.exp(-t * 6) * .26 * (channel ? -1 : 1);
    }
  }
  return impulse;
}

export class HarpAudio {
  constructor() {
    this.context = null;
    this._volume = .72;
    this._reverb = .34;
    this._tone = 'concert';
    this._voices = new Set();
    this._buffers = new Map();
    this._maxVoices = 72;
    this._analyser = null;
    this._recorder = null;
    this._recordChunks = [];
    this._initPromise = null;
    this._warmGeneration = 0;
    this._cancelWarm = null;
  }

  get state() { return this.context?.state || 'uninitialized'; }
  get analyser() { return this._analyser; }
  get recording() { return this._recorder?.state === 'recording'; }
  get activeVoices() { return this._voices.size; }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initialize();
    try { return await this._initPromise; }
    finally { this._initPromise = null; }
  }

  async _initialize() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('当前浏览器不支持音频，请用 Chrome 或 Safari 打开。');
      const context = this.context = new Context({ latencyHint: 'interactive' });
      this.input = context.createGain();
      this.dry = context.createGain();
      this.send = context.createGain();
      this.convolver = context.createConvolver();
      this.convolver.buffer = hallImpulse(context);
      this.wet = context.createGain();
      this.master = context.createGain();
      this.limiter = context.createDynamicsCompressor();
      this.limiter.threshold.value = -15;
      this.limiter.knee.value = 15;
      this.limiter.ratio.value = 7;
      this.limiter.attack.value = .003;
      this.limiter.release.value = .22;
      // A compressor controls the ensemble; a gentle final saturator bounds
      // the few-millisecond attack even when every string is swept at once.
      this.safety = context.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const x = i * 2 / (curve.length - 1) - 1;
        curve[i] = .79 * Math.tanh(x / .79);
      }
      this.safety.curve = curve;
      this.safety.oversample = '2x';
      this.highpass = context.createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = 24;
      this.highpass.Q.value = .5;
      this._analyser = context.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = .75;
      this.input.connect(this.dry).connect(this.highpass);
      this.input.connect(this.send).connect(this.convolver).connect(this.wet).connect(this.highpass);
      this.highpass.connect(this.limiter).connect(this.safety).connect(this.master).connect(this._analyser).connect(context.destination);
      this.recordDestination = typeof context.createMediaStreamDestination === 'function' ? context.createMediaStreamDestination() : null;
      if (this.recordDestination) this.master.connect(this.recordDestination);
      this.setVolume(this._volume);
      this.setReverb(this._reverb);
      this._prewarm();
    }
    if (this.context.state === 'suspended' || this.context.state === 'interrupted') await this.context.resume();
    return this;
  }

  setVolume(value) {
    this._volume = clamp(Number(value));
    if (this.master) this.master.gain.setTargetAtTime(this._volume * 1.2, this.context.currentTime, .018);
  }

  setReverb(value) {
    this._reverb = clamp(Number(value));
    if (!this.context) return;
    const now = this.context.currentTime;
    this.dry.gain.setTargetAtTime(1 - this._reverb * .18, now, .025);
    this.send.gain.setTargetAtTime(this._reverb * .82, now, .025);
    this.wet.gain.setTargetAtTime(.7, now, .025);
  }

  setTone(tone) {
    const selected = Object.hasOwn(TONES, tone) ? tone : 'concert';
    if (selected === this._tone) return;
    this._tone = selected;
    if (this.context && this.context.state !== 'closed') this._prewarm();
  }

  _prewarm() {
    // Preparing one voice per idle period keeps camera frames and pointer
    // gestures responsive. Common performance notes are ready first.
    this._cancelWarm?.();
    const generation = ++this._warmGeneration;
    const semitones = [0, 2, 4, 5, 7, 9, 11];
    const priority = [60, 64, 67, 72, 62, 65, 69, 71, 48, 55, 76, 79, 84];
    const fullRange = Array.from({ length: 47 }, (_, i) => 24 + Math.floor(i / 7) * 12 + semitones[i % 7]);
    const queue = [...new Set([...priority, ...fullRange])];
    const schedule = () => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        const token = globalThis.requestIdleCallback(prepare, { timeout: 350 });
        this._cancelWarm = () => globalThis.cancelIdleCallback(token);
      } else {
        const token = setTimeout(prepare, 18);
        this._cancelWarm = () => clearTimeout(token);
      }
    };
    const prepare = () => {
      if (generation !== this._warmGeneration || !this.context || this.context.state === 'closed') return;
      const midi = queue.shift();
      if (midi === undefined) { this._cancelWarm = null; return; }
      this._buffer(midi);
      if (queue.length) schedule();
      else this._cancelWarm = null;
    };
    schedule();
  }

  _buffer(midi) {
    const key = `${this._tone}:${midi}`;
    if (this._buffers.has(key)) {
      const value = this._buffers.get(key);
      this._buffers.delete(key);
      this._buffers.set(key, value);
      return value;
    }
    const samples = renderHarpSamples(this.context.sampleRate, midi, this._tone);
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.copyToChannel(samples, 0);
    this._buffers.set(key, buffer);
    if (this._buffers.size > 56) this._buffers.delete(this._buffers.keys().next().value);
    return buffer;
  }

  play(midi, velocity = .6, pan = 0) {
    if (!this.context || this.context.state !== 'running' || !Number.isFinite(midi)) return false;
    midi = clamp(midi, 12, 108);
    velocity = clamp(Number(velocity), .03, 1);
    const buffer = this._buffer(midi);
    while (this._voices.size >= this._maxVoices) this._endVoice(this._voices.values().next().value, .025);
    const context = this.context;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    const hz = frequency(midi);
    filter.frequency.setValueAtTime(Math.min(context.sampleRate * .45, hz * (5 + velocity * 12) + 1300), now);
    filter.Q.value = .35;
    if (panner.pan) panner.pan.value = clamp(Number(pan), -1, 1) * .66;
    // Equal-loudness compensation avoids weak treble and overwhelming bass.
    const balance = .82 + clamp((midi - 40) / 60) * .25;
    envelope.gain.setValueAtTime(.43 * velocity ** .82 * balance, now);
    source.connect(filter).connect(envelope).connect(panner).connect(this.input);
    const voice = { source, envelope, filter, panner, finished: false };
    source.onended = () => this._cleanupVoice(voice);
    this._voices.add(voice);
    source.start(now);
    return true;
  }

  _cleanupVoice(voice) {
    if (voice.finished) return;
    voice.finished = true;
    this._voices.delete(voice);
    for (const node of [voice.source, voice.envelope, voice.filter, voice.panner]) { try { node.disconnect(); } catch {} }
  }

  _endVoice(voice, release = .07) {
    if (!voice || voice.finished) return;
    this._voices.delete(voice);
    const now = this.context.currentTime;
    const gain = voice.envelope.gain;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
    else { const current = gain.value; gain.cancelScheduledValues(now); gain.setValueAtTime(current, now); }
    gain.linearRampToValueAtTime(0, now + release);
    try { voice.source.stop(now + release + .012); } catch { this._cleanupVoice(voice); }
  }

  /** Damps the strings quickly; the room's natural short reverb tail remains. */
  damp() { for (const voice of [...this._voices]) this._endVoice(voice, .065); }

  async startRecording() {
    await this.init();
    if (this.recording) return;
    if (!globalThis.MediaRecorder || !this.recordDestination) throw new Error('当前浏览器不支持录音导出，请使用较新版本的 Chrome 或 Safari。');
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    this._recordChunks = [];
    const recorder = this._recorder = new MediaRecorder(this.recordDestination.stream, mimeType ? { mimeType, audioBitsPerSecond: 192000 } : undefined);
    recorder.ondataavailable = event => { if (event.data.size) this._recordChunks.push(event.data); };
    recorder.start(250);
  }

  async stopRecording() {
    const recorder = this._recorder;
    if (!recorder || recorder.state === 'inactive') return null;
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this._recordChunks, { type: recorder.mimeType || 'audio/webm' });
        this._recordChunks = [];
        this._recorder = null;
        resolve(blob);
      };
      recorder.onerror = event => { this._recorder = null; reject(event.error || new Error('录音导出失败')); };
      recorder.stop();
    });
  }

  async close() {
    if (this.recording) await this.stopRecording();
    this.damp();
    this._cancelWarm?.();
    this._cancelWarm = null;
    ++this._warmGeneration;
    this._buffers.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this._analyser = null;
  }
}

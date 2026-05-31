/* audio.js — procedural "synthwave cruiser" soundtrack + SFX (Web Audio, no files).
 *
 * 8-bar loop, progression i-VI-III-VII in A minor (Am-F-C-G), with:
 *   - four-on-the-floor-ish drum kit (kick/snare/hats) + fills
 *   - pulsing 8th-note synth bass
 *   - detuned saw pad bed
 *   - plucky 16th arpeggio through a tempo-synced tape delay
 *   - a lead melody that enters in the second half (bars 5-8)
 * Tempo nudges up with gameplay difficulty for tension.
 */
(function () {
  "use strict";

  const NOTE = {};
  (function () {
    const n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let o = 1; o <= 6; o++)
      for (let i = 0; i < 12; i++)
        NOTE[n[i] + o] = 440 * Math.pow(2, (o * 12 + i + 12 - 69) / 12);
  })();

  // --- progression: one chord per bar over 8 bars ---
  const CH = {
    Am: { bass: "A2", pad: ["A3", "C4", "E4"], arp: ["A3", "C4", "E4", "A4"] },
    F:  { bass: "F2", pad: ["F3", "A3", "C4"], arp: ["F3", "A3", "C4", "F4"] },
    C:  { bass: "C2", pad: ["C4", "E4", "G4"], arp: ["C4", "E4", "G4", "C5"] },
    G:  { bass: "G2", pad: ["G3", "B3", "D4"], arp: ["G3", "B3", "D4", "G4"] },
  };
  const BARS = [CH.Am, CH.F, CH.C, CH.G, CH.Am, CH.F, CH.C, CH.G];
  const STEPS = BARS.length * 16;           // 128 sixteenth-note steps
  const ARP_IDX = [0, 1, 2, 3, 2, 3, 2, 1, 0, 1, 2, 3, 3, 2, 1, 0];

  // Lead melody for bars 5-8 (section B). {step, note, len16}
  const LEAD = [
    { s: 64, n: "A4", l: 4 }, { s: 68, n: "C5", l: 2 }, { s: 70, n: "E5", l: 2 },
    { s: 72, n: "D5", l: 4 }, { s: 76, n: "C5", l: 4 },
    { s: 80, n: "E5", l: 4 }, { s: 84, n: "F5", l: 2 }, { s: 86, n: "E5", l: 2 },
    { s: 88, n: "C5", l: 4 }, { s: 92, n: "A4", l: 4 },
    { s: 96, n: "G4", l: 4 }, { s: 100, n: "A4", l: 2 }, { s: 102, n: "C5", l: 2 },
    { s: 104, n: "B4", l: 4 }, { s: 108, n: "G4", l: 4 },
    { s: 112, n: "A4", l: 2 }, { s: 114, n: "C5", l: 2 }, { s: 116, n: "E5", l: 4 },
    { s: 120, n: "D5", l: 2 }, { s: 122, n: "C5", l: 2 }, { s: 124, n: "B4", l: 4 },
  ];
  const LEAD_AT = {};
  for (const e of LEAD) LEAD_AT[e.s] = e;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.musicOn = false;
      this.bpm = 112;
      this.step = 0;
      this.nextTime = 0;
      this.lookahead = 0.025;
      this.ahead = 0.12;
      this._timer = null;
      this._lastThrust = 0;
    }

    init() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();

      this.master = g(this.ctx, this.enabled ? 0.9 : 0);
      this.master.connect(this.ctx.destination);

      this.music = g(this.ctx, 0.5); this.music.connect(this.master);
      this.sfx = g(this.ctx, 0.6);  this.sfx.connect(this.master);

      // tempo-synced feedback delay (the synthwave echo) on a send bus
      this.delay = this.ctx.createDelay(1.0);
      this.delay.delayTime.value = this._dottedEighth();
      this.fb = g(this.ctx, 0.34);
      this.delay.connect(this.fb); this.fb.connect(this.delay);
      this.wet = g(this.ctx, 0.32);
      this.delay.connect(this.wet); this.wet.connect(this.music);
    }

    _dottedEighth() { return (60 / this.bpm / 4) * 3; }

    setEnabled(on) {
      this.enabled = on;
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(on ? 0.9 : 0, t + 0.08);
      }
    }
    toggle() { this.setEnabled(!this.enabled); return this.enabled; }

    setIntensity(t01) {
      this.bpm = 112 + Math.max(0, Math.min(1, t01)) * 22; // 112 -> 134
      if (this.delay) this.delay.delayTime.setTargetAtTime(this._dottedEighth(), this.ctx.currentTime, 0.3);
    }

    startMusic() {
      if (!this.ctx || this.musicOn) return;
      this.musicOn = true;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
      const tick = () => {
        if (!this.musicOn) return;
        const dt = 60 / this.bpm / 4;
        while (this.nextTime < this.ctx.currentTime + this.ahead) {
          this._step(this.step % STEPS, this.nextTime, dt);
          this.nextTime += dt;
          this.step++;
        }
        this._timer = setTimeout(tick, this.lookahead * 1000);
      };
      tick();
    }
    stopMusic() { this.musicOn = false; if (this._timer) { clearTimeout(this._timer); this._timer = null; } }

    _step(step, time, dt) {
      const bar = (step / 16) | 0;
      const six = step % 16;
      const chord = BARS[bar];

      // --- pad: sustain chord across the whole bar ---
      if (six === 0) {
        for (const p of chord.pad) this._pad(NOTE[p], time, dt * 16);
      }

      // --- bass: 8th-note pulse on the root, octave lift mid-bar ---
      if (six % 2 === 0) {
        const accent = six === 0 || six === 8;
        const f = NOTE[chord.bass] * (six === 14 ? 2 : 1);
        this._bass(f, time, dt * 1.7, accent ? 0.28 : 0.2);
      }

      // --- arp: 16ths through chord tones, sent to delay ---
      this._arp(NOTE[chord.arp[ARP_IDX[six]]], time, dt * 1.4);

      // --- lead (section B) ---
      const le = LEAD_AT[step];
      if (le) this._lead(NOTE[le.n], time, dt * le.l * 0.95);

      // --- drums ---
      if (six === 0 || six === 8) this._kick(time);
      if (bar % 2 === 1 && six === 14) this._kick(time);          // groove push
      if (six === 4 || six === 12) this._snare(time);
      if (bar === 7 && (six === 8 || six === 10 || six === 12 || six === 14))
        this._snare(time, 0.18);                                  // turnaround fill
      if (six % 2 === 0) this._hat(time, six % 4 === 2 ? 0.07 : 0.04, six === 14);
    }

    /* ---------- instruments ---------- */
    _pad(freq, time, dur) {
      const o1 = osc(this.ctx, "sawtooth", freq, -7);
      const o2 = osc(this.ctx, "sawtooth", freq, +7);
      const f = lp(this.ctx, 1600);
      const env = g(this.ctx, 0);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.05, time + 0.25);
      env.gain.linearRampToValueAtTime(0.04, time + dur * 0.7);
      env.gain.linearRampToValueAtTime(0.0008, time + dur);
      o1.connect(f); o2.connect(f); f.connect(env); env.connect(this.music);
      o1.start(time); o2.start(time); o1.stop(time + dur + 0.05); o2.stop(time + dur + 0.05);
    }

    _bass(freq, time, dur, peak) {
      const o = osc(this.ctx, "sawtooth", freq);
      const sub = osc(this.ctx, "square", freq / 2);
      const f = lp(this.ctx, 900);
      const env = g(this.ctx, 0);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(peak, time + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0008, time + dur);
      o.connect(f); sub.connect(f); f.connect(env); env.connect(this.music);
      o.start(time); sub.start(time); o.stop(time + dur + 0.03); sub.stop(time + dur + 0.03);
    }

    _arp(freq, time, dur) {
      const o = osc(this.ctx, "square", freq, +4);
      const f = lp(this.ctx, 2800);
      const env = g(this.ctx, 0);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.085, time + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0008, time + dur);
      o.connect(f); f.connect(env);
      env.connect(this.music); env.connect(this.delay);
      o.start(time); o.stop(time + dur + 0.02);
    }

    _lead(freq, time, dur) {
      const o1 = osc(this.ctx, "sawtooth", freq, -5);
      const o2 = osc(this.ctx, "square", freq, +5);
      const f = lp(this.ctx, 3200);
      const env = g(this.ctx, 0);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.16, time + 0.02);
      env.gain.setValueAtTime(0.16, time + dur * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0008, time + dur);
      o1.connect(f); o2.connect(f); f.connect(env);
      env.connect(this.music); env.connect(this.delay);
      o1.start(time); o2.start(time); o1.stop(time + dur + 0.03); o2.stop(time + dur + 0.03);
    }

    _kick(time) {
      const o = this.ctx.createOscillator();
      const env = g(this.ctx, 0);
      o.frequency.setValueAtTime(140, time);
      o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      env.gain.setValueAtTime(0.6, time);
      env.gain.exponentialRampToValueAtTime(0.0008, time + 0.2);
      o.connect(env); env.connect(this.music);
      o.start(time); o.stop(time + 0.22);
    }

    _snare(time, vol) {
      vol = vol || 0.28;
      const n = noiseSrc(this.ctx, this._noise());
      const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1400;
      const env = g(this.ctx, 0);
      env.gain.setValueAtTime(vol, time);
      env.gain.exponentialRampToValueAtTime(0.0008, time + 0.16);
      n.connect(hp); hp.connect(env); env.connect(this.music);
      n.start(time); n.stop(time + 0.18);
      const o = osc(this.ctx, "triangle", 190);
      const oe = g(this.ctx, 0);
      oe.gain.setValueAtTime(vol * 0.5, time);
      oe.gain.exponentialRampToValueAtTime(0.0008, time + 0.09);
      o.connect(oe); oe.connect(this.music);
      o.start(time); o.stop(time + 0.1);
    }

    _hat(time, vol, open) {
      const n = noiseSrc(this.ctx, this._noise());
      const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000;
      const env = g(this.ctx, 0);
      const dur = open ? 0.14 : 0.04;
      env.gain.setValueAtTime(vol, time);
      env.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      n.connect(hp); hp.connect(env); env.connect(this.music);
      n.start(time); n.stop(time + dur + 0.02);
    }

    _noise() {
      if (this._nb) return this._nb;
      const len = this.ctx.sampleRate * 0.4;
      const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return (this._nb = b);
    }

    /* ---------- SFX ---------- */
    thrust() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (t - this._lastThrust < 0.06) return; // rate-limit rapid taps
      this._lastThrust = t;
      const o = osc(this.ctx, "triangle", 200);
      o.frequency.exponentialRampToValueAtTime(340, t + 0.07);
      const env = g(this.ctx, 0);
      env.gain.linearRampToValueAtTime(0.06, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0006, t + 0.1);
      o.connect(env); env.connect(this.sfx);
      o.start(t); o.stop(t + 0.12);
    }
    blip() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = osc(this.ctx, "square", NOTE["E5"]);
      o.frequency.setValueAtTime(NOTE["A5"], t + 0.05);
      const env = g(this.ctx, 0.16);
      env.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
      o.connect(env); env.connect(this.sfx);
      o.start(t); o.stop(t + 0.18);
    }
    crash() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const n = noiseSrc(this.ctx, this._noise());
      const f = lp(this.ctx, 2200);
      f.frequency.exponentialRampToValueAtTime(180, t + 0.5);
      const env = g(this.ctx, 0.5);
      env.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
      n.connect(f); f.connect(env); env.connect(this.sfx);
      n.start(t); n.stop(t + 0.6);
      const o = osc(this.ctx, "sawtooth", 220);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
      const oe = g(this.ctx, 0.25);
      oe.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
      o.connect(oe); oe.connect(this.sfx);
      o.start(t); o.stop(t + 0.52);
    }
  }

  /* ---------- tiny node helpers ---------- */
  function g(ctx, v) { const n = ctx.createGain(); n.gain.value = v; return n; }
  function lp(ctx, hz) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = hz; return f; }
  function osc(ctx, type, freq, detune) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    return o;
  }
  function noiseSrc(ctx, buf) { const s = ctx.createBufferSource(); s.buffer = buf; return s; }

  window.AudioEngine = AudioEngine;
})();

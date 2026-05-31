/* audio.js — music from a pre-rendered file (gapless loop) + procedural SFX.
 *
 * The looping soundtrack is a static asset (assets/music.*) rendered offline by
 * tools/render-music.js. We decode it once and loop it through Web Audio for a
 * seamless join. SFX (thrust/blip/crash) stay fully procedural — cheap and
 * reactive. The first user gesture (init) unlocks audio per browser policy.
 *
 * Format choice: AAC/.m4a is the primary (iOS Safari plays it natively and
 * loops cleanly); .ogg is offered first for Chrome/Firefox efficiency.
 */
(function () {
  "use strict";

  // Source candidates in preference order; first the browser can decode wins.
  const MUSIC_SOURCES = ["assets/music.ogg", "assets/music.m4a"];

  // notes used by SFX
  const NOTE = {};
  (function () {
    const n = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    for (let o = 1; o <= 6; o++)
      for (let i = 0; i < 12; i++)
        NOTE[n[i] + o] = 440 * Math.pow(2, (o*12 + i + 12 - 69) / 12);
  })();

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.musicOn = false;
      this._lastThrust = 0;
      this.buffer = null;       // decoded music
      this.srcNode = null;      // current looping BufferSource
      this._loading = null;     // in-flight fetch/decode promise
    }

    init() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();

      this.master = g(this.ctx, this.enabled ? 0.9 : 0);
      this.master.connect(this.ctx.destination);

      this.music = g(this.ctx, 0.55); this.music.connect(this.master);
      this.sfx   = g(this.ctx, 0.6);  this.sfx.connect(this.master);

      this._load(); // kick off fetch/decode (safe to call repeatedly)
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(on ? 0.9 : 0, t + 0.08);
      }
    }
    toggle() { this.setEnabled(!this.enabled); return this.enabled; }

    // Intensity hook kept for API compatibility; a fixed file can't change
    // tempo, so we nudge the music level slightly as difficulty rises.
    setIntensity(t01) {
      if (!this.music) return;
      const lvl = 0.5 + Math.max(0, Math.min(1, t01)) * 0.12;
      this.music.gain.setTargetAtTime(lvl, this.ctx.currentTime, 0.5);
    }

    _load() {
      if (this.buffer || this._loading) return this._loading;
      this._loading = (async () => {
        for (const url of MUSIC_SOURCES) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.arrayBuffer();
            const buf = await new Promise((resolve, reject) =>
              this.ctx.decodeAudioData(data, resolve, reject));
            this.buffer = buf;
            if (this.musicOn) this._play(); // start now if we were asked to
            return buf;
          } catch (e) { /* try next format */ }
        }
        console.warn("NEONCAVE: no playable music source");
        return null;
      })();
      return this._loading;
    }

    _play() {
      if (!this.ctx || !this.buffer || this.srcNode) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;                 // gapless: Web Audio loops sample-accurately
      src.connect(this.music);
      src.start(0);
      this.srcNode = src;
    }

    startMusic() {
      if (!this.ctx) return;
      this.musicOn = true;
      if (this.buffer) this._play();
      else this._load();               // will auto-play on decode
    }

    stopMusic() {
      this.musicOn = false;
      if (this.srcNode) {
        try { this.srcNode.stop(); } catch (e) {}
        this.srcNode.disconnect();
        this.srcNode = null;
      }
    }

    /* ---------- SFX (procedural) ---------- */
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

    _noise() {
      if (this._nb) return this._nb;
      const len = this.ctx.sampleRate * 0.4;
      const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return (this._nb = b);
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

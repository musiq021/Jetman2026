/* audio.js — music via an HTML <audio> element + procedural SFX.
 *
 * Music plays through a plain <audio> tag rather than a Web Audio
 * decodeAudioData/BufferSource. This is the robust path on iOS Safari, which
 * (a) cannot decodeAudioData Ogg and is flaky with AAC, and (b) routes
 * Web-Audio output through the hardware ring/silent switch. Native <audio>
 * playback started from a user gesture sidesteps all of that and supports MP3
 * universally. SFX stay on Web Audio (cheap, reactive); they're tiny blips so
 * the silent-switch caveat doesn't matter for them.
 *
 * Each track ships as .mp3 (iOS/universal primary) + .ogg (Chrome/FF). The
 * <audio> element's <source> fallback picks whatever the browser supports.
 */
(function () {
  "use strict";

  // Track list — surfaced in the in-game config panel's selector.
  const TRACKS = [
    { id: "stage1", name: "Stage 1" },
    { id: "stage2", name: "Stage 2" },
    { id: "boss",   name: "Boss Fight" },
    { id: "select", name: "Stage Select" },
  ];
  const DEFAULT_TRACK = "stage1";

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
      this.tracks = TRACKS;
      this.trackId = localStorage.getItem("neoncave_track") || DEFAULT_TRACK;
      this.musicVol = 0.55;
      this.audioEl = null;      // HTMLAudioElement for music
    }

    init() {
      // Music element (created once; safe before any AudioContext exists).
      if (!this.audioEl) {
        const a = document.createElement("audio");
        a.loop = true;
        a.preload = "auto";
        a.volume = this.enabled ? this.musicVol : 0;
        a.setAttribute("playsinline", "");
        this._setSrc(a, this.trackId);
        document.body.appendChild(a);
        this.audioEl = a;
      }
      // Web Audio context for SFX only.
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = g(this.ctx, 0.9);
        this.master.connect(this.ctx.destination);
        this.sfx = g(this.ctx, 0.6); this.sfx.connect(this.master);
      } else if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
    }

    _setSrc(a, id) {
      a.innerHTML = "";
      for (const ext of ["mp3", "ogg"]) {
        const s = document.createElement("source");
        s.src = "assets/" + id + "." + ext;
        s.type = ext === "mp3" ? "audio/mpeg" : "audio/ogg";
        a.appendChild(s);
      }
      a.load();
    }

    listTracks() { return this.tracks; }
    getTrack() { return this.trackId; }

    setTrack(id) {
      if (!this.tracks.some(t => t.id === id)) return;
      this.trackId = id;
      localStorage.setItem("neoncave_track", id);
      if (this.audioEl) {
        const wasPlaying = this.musicOn;
        this._setSrc(this.audioEl, id);
        if (wasPlaying) this.audioEl.play().catch(() => {});
      }
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.audioEl) this.audioEl.volume = on ? this.musicVol : 0;
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(on ? 0.9 : 0, t + 0.08);
      }
    }
    toggle() { this.setEnabled(!this.enabled); return this.enabled; }

    // Nudge music level slightly with difficulty for a touch of tension.
    setIntensity(t01) {
      if (!this.audioEl || !this.enabled) return;
      this.musicVol = 0.5 + Math.max(0, Math.min(1, t01)) * 0.12;
      this.audioEl.volume = this.musicVol;
    }

    startMusic() {
      this.musicOn = true;
      if (this.audioEl) this.audioEl.play().catch(() => {});
    }

    stopMusic() {
      this.musicOn = false;
      if (this.audioEl) this.audioEl.pause();
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

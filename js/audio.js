/* audio.js — procedural chiptune + SFX via Web Audio API (no asset files). */
(function () {
  "use strict";

  const NOTE = {}; // name -> frequency
  (function buildNotes() {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let oct = 1; oct <= 6; oct++) {
      for (let i = 0; i < 12; i++) {
        // MIDI: A4 = 440Hz = midi 69
        const midi = oct * 12 + i + 12;
        NOTE[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
      }
    }
  })();

  // A driving minor-key pattern. Bass line + 16th-note arpeggio.
  // Steps are played one per 16th note; null = rest.
  const BASS = ["A2", null, "A2", null, "F2", null, "F2", null,
                "G2", null, "G2", null, "E2", null, "E2", null];
  const ARP  = ["A4", "E4", "A4", "C5", "E5", "C5", "A4", "E4",
                "F4", "C5", "F4", "A4", "C5", "A4", "G4", "B4"];

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.enabled = true;
      this.musicOn = false;

      // scheduler
      this.bpm = 132;
      this.step16 = 0;
      this.nextNoteTime = 0;
      this.lookahead = 0.025;   // seconds between scheduler ticks
      this.scheduleAhead = 0.1; // how far ahead to queue notes
      this._timer = null;
    }

    // Must be called from a user gesture (click/keydown) to satisfy autoplay rules.
    init() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0.0;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.6;
      this.sfxGain.connect(this.master);
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(on ? 0.9 : 0.0, t + 0.08);
      }
    }
    toggle() { this.setEnabled(!this.enabled); return this.enabled; }

    /* ---------------- Music ---------------- */
    startMusic() {
      if (!this.ctx || this.musicOn) return;
      this.musicOn = true;
      this.step16 = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.06;
      const tick = () => {
        if (!this.musicOn) return;
        const secPer16 = 60 / this.bpm / 4;
        while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAhead) {
          this._scheduleStep(this.step16 % 16, this.nextNoteTime);
          this.nextNoteTime += secPer16;
          this.step16++;
        }
        this._timer = setTimeout(tick, this.lookahead * 1000);
      };
      tick();
    }

    stopMusic() {
      this.musicOn = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }

    // Tempo nudges up with difficulty for tension.
    setIntensity(t01) {
      this.bpm = 132 + Math.min(1, Math.max(0, t01)) * 36; // 132 -> 168
    }

    _scheduleStep(step, time) {
      const bass = BASS[step];
      if (bass) this._voice(NOTE[bass], time, 0.16, "square", 0.55, 1100);
      const arp = ARP[step];
      if (arp) this._voice(NOTE[arp], time, 0.11, "square", 0.18, 2600);
      // light hat on offbeats
      if (step % 2 === 1) this._hat(time, 0.05);
    }

    // A small synth voice: osc -> lowpass -> gain envelope -> musicGain
    _voice(freq, time, dur, type, peak, cutoff) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      o.type = type;
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = cutoff;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
      o.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start(time);
      o.stop(time + dur + 0.02);
    }

    _hat(time, dur) {
      const src = this.ctx.createBufferSource();
      const buf = this._noiseBuf();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 7000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.08, time);
      g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
      src.connect(f); f.connect(g); g.connect(this.musicGain);
      src.start(time);
      src.stop(time + dur + 0.02);
    }

    _noiseBuf() {
      if (this._nb) return this._nb;
      const len = this.ctx.sampleRate * 0.4;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = buf;
      return buf;
    }

    /* ---------------- SFX ---------------- */
    thrust() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(320, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.14);
    }

    blip() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(NOTE["E5"], t);
      o.frequency.setValueAtTime(NOTE["A5"], t + 0.05);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.18);
    }

    crash() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // noise burst
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf();
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(2200, t);
      f.frequency.exponentialRampToValueAtTime(200, t + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start(t); src.stop(t + 0.6);
      // descending tone
      const o = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
      og.gain.setValueAtTime(0.25, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
      o.connect(og); og.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.52);
    }
  }

  window.AudioEngine = AudioEngine;
})();

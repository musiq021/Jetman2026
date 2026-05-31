// tools/render-music.js — offline render of the NEONCAVE loop to a WAV.
// Run: node tools/render-music.js  (then encode to ogg with ffmpeg)
// No realtime constraints here, so we can layer reverb/delay and a fuller mix.
const fs = require("fs");
const path = require("path");

const SR = 44100;
const BPM = 112;
const SIX = 60 / BPM / 4;          // 16th-note seconds
const BARS = 16;
const STEPS = BARS * 16;
const LOOP = STEPS * SIX;          // seamless loop length (~34s)
const N = Math.round(LOOP * SR);

const L = new Float32Array(N);
const R = new Float32Array(N);

// ---- notes ----
const NOTE = {};
(() => {
  const nm = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  for (let o = 1; o <= 6; o++) for (let i = 0; i < 12; i++)
    NOTE[nm[i] + o] = 440 * Math.pow(2, (o*12 + i + 12 - 69) / 12);
})();

// ---- progression (matches the live version's harmony) ----
const CH = {
  Am:{bass:"A2",pad:["A3","C4","E4"],arp:["A3","C4","E4","A4"]},
  F: {bass:"F2",pad:["F3","A3","C4"],arp:["F3","A3","C4","F4"]},
  C: {bass:"C2",pad:["C4","E4","G4"],arp:["C4","E4","G4","C5"]},
  G: {bass:"G2",pad:["G3","B3","D4"],arp:["G3","B3","D4","G4"]},
  Dm:{bass:"D2",pad:["D3","F3","A3"],arp:["D3","F3","A3","D4"]},
  Em:{bass:"E2",pad:["E3","G3","B3"],arp:["E3","G3","B3","E4"]},
};
const SEQ = [CH.Am,CH.F,CH.C,CH.G, CH.Am,CH.Dm,CH.Em,CH.G,
             CH.C,CH.G,CH.Am,CH.F, CH.Dm,CH.Em,CH.F,CH.G];
const ARP_IDX = [0,1,2,3,2,3,2,1,0,1,2,3,3,2,1,0];
const ARP_HITS = [0,3,6,8,11,14];

// ---- helpers: write a voice with wrap-around (seamless loop) ----
function addWrap(buf, startSample, samples, fn) {
  for (let i = 0; i < samples; i++) {
    const s = fn(i);
    buf[(startSample + i) % N] += s;
  }
}
function adsr(i, total, a, d, s, r, peak) {
  const aN = a*SR, dN = d*SR, rN = r*SR, sStart = aN+dN, rStart = total - rN;
  let g;
  if (i < aN) g = (i/aN)*peak;
  else if (i < sStart) g = peak - (1 - s) * peak * ((i-aN)/dN);
  else if (i < rStart) g = s*peak;
  else g = s*peak * (1 - (i-rStart)/rN);
  return Math.max(0, g);
}

function voice({freq, t, dur, type="saw", peak=0.2, detune=0, pan=0,
                a=0.005, d=0.05, s=0.7, r=0.08, cutoff=4000}) {
  const start = Math.round(t*SR), total = Math.round(dur*SR);
  const wL = Math.cos((pan+1)*Math.PI/4), wR = Math.sin((pan+1)*Math.PI/4);
  const dt = detune/100;
  // one-pole lowpass state
  let lp = 0; const alpha = Math.min(1, cutoff / (SR/2));
  addWrap(L, start, total, (i) => 0); // ensure range touched (no-op)
  for (let i = 0; i < total; i++) {
    const ph = (i/SR) * freq * Math.pow(2, dt);
    let raw;
    const frac = ph - Math.floor(ph);
    if (type === "saw") raw = 2*frac - 1;
    else if (type === "square") raw = frac < 0.5 ? 1 : -1;
    else if (type === "tri") raw = 4*Math.abs(frac-0.5) - 1;
    else raw = Math.sin(2*Math.PI*ph); // sine
    lp += alpha * (raw - lp);
    const g = adsr(i, total, a, d, s, r, peak);
    const v = lp * g;
    const idx = (start + i) % N;
    L[idx] += v * wL; R[idx] += v * wR;
  }
}

function kick(t) {
  const start = Math.round(t*SR), total = Math.round(0.22*SR);
  for (let i = 0; i < total; i++) {
    const tt = i/SR;
    const f = 140 * Math.pow(45/140, Math.min(1, tt/0.12));
    const env = Math.exp(-tt*22);
    const v = Math.sin(2*Math.PI*f*tt) * env * 0.7;
    const idx = (start+i)%N; L[idx]+=v; R[idx]+=v;
  }
}
function snare(t, vol=0.28) {
  const start = Math.round(t*SR), total = Math.round(0.18*SR);
  let hp = 0;
  for (let i = 0; i < total; i++) {
    const tt = i/SR, env = Math.exp(-tt*18);
    const n = Math.random()*2-1; hp = 0.7*(hp + n - (i?L[(start+i-1)%N]:0)); // rough hp
    const tone = Math.sin(2*Math.PI*190*tt)*0.4;
    const v = (n*0.8 + tone) * env * vol;
    const idx=(start+i)%N; L[idx]+=v; R[idx]+=v;
  }
}
function hat(t, vol, open) {
  const start = Math.round(t*SR), total = Math.round((open?0.14:0.04)*SR);
  for (let i=0;i<total;i++){
    const tt=i/SR, env=Math.exp(-tt*(open?30:90));
    const v=(Math.random()*2-1)*env*vol;
    const idx=(start+i)%N; L[idx]+=v*0.9; R[idx]+=v*1.1;
  }
}

// ---- arrange ----
for (let step = 0; step < STEPS; step++) {
  const bar = (step/16)|0, six = step%16, t = step*SIX, ch = SEQ[bar];
  const drumsOn = bar >= 2 && !(bar===8||bar===9);
  const arpOn = bar >= 1, bassFull = bar >= 2, half2 = bar >= 8;

  if (six === 0) {
    ch.pad.forEach((p, k) => {
      voice({freq:NOTE[p], t, dur:SIX*16, type:"saw", peak:0.045,
             detune:(k-1)*7, pan:(k-1)*0.5, a:0.25, d:0.3, s:0.8, r:1.5, cutoff:1700});
    });
  }
  if (bassFull ? six%2===0 : (six===0||six===8)) {
    const accent = six===0||six===8;
    const f = NOTE[ch.bass] * (six===14 && bassFull ? 2 : 1);
    voice({freq:f, t, dur:SIX*1.7, type:"saw", peak:accent?0.3:0.22,
           a:0.005, d:0.06, s:0.4, r:0.1, cutoff:1000});
    voice({freq:f/2, t, dur:SIX*1.7, type:"square", peak:accent?0.12:0.08,
           a:0.005, d:0.06, s:0.4, r:0.1, cutoff:700});
  }
  if (arpOn && (ARP_HITS.includes(six) || (half2 && six%2===1))) {
    const f = NOTE[ch.arp[ARP_IDX[six]]];
    const pan = ((step%4)/3 - 0.5);
    voice({freq:f, t, dur:SIX*1.6, type:"tri", peak:0.08, detune:3, pan,
           a:0.006, d:0.08, s:0.3, r:0.12, cutoff:2400});
  }
  if (drumsOn) {
    if (six===0||six===8) kick(t);
    if (bar%2===1 && six===14) kick(t);
    if (six===4||six===12) snare(t);
    if (bar===15 && (six===8||six===10||six===12||six===14)) snare(t, 0.18);
    if (six%2===0) hat(t, six%4===2?0.06:0.035, six===14);
  }
}

// ---- tempo-synced feedback delay (dotted-8th), wrap-around ----
(() => {
  const dly = Math.round(SIX*3 * SR); // dotted 8th
  const fb = 0.34, wet = 0.30;
  const oL = Float32Array.from(L), oR = Float32Array.from(R);
  for (let i = 0; i < N; i++) {
    const sL = oL[(i - dly + N)%N], sR = oR[(i - dly + N)%N];
    L[i] += (sL*fb + oR[(i-dly+N)%N]*0)*wet; // simple
    R[i] += (sR*fb)*wet;
  }
  // second tap for spread
  for (let i = 0; i < N; i++) {
    L[i] += oR[(i - dly*2 + N*2)%N]*wet*fb*0.6;
    R[i] += oL[(i - dly*2 + N*2)%N]*wet*fb*0.6;
  }
})();

// ---- light Schroeder-ish reverb (a few wrapped combs) ----
(() => {
  const combs = [1116, 1188, 1277, 1356].map(s => Math.round(s*SR/44100));
  const g = 0.78, wet = 0.16;
  const oL = Float32Array.from(L), oR = Float32Array.from(R);
  for (const d of combs) {
    for (let i = 0; i < N; i++) {
      L[i] += oL[(i-d+N)%N]*g*wet/combs.length;
      R[i] += oR[(i-d+ N + 7)%N]*g*wet/combs.length;
    }
  }
})();

// ---- normalize ----
let peak = 0;
for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = peak > 0 ? 0.89/peak : 1;

// ---- write 16-bit stereo WAV ----
const bytes = N*4;
const buf = Buffer.alloc(44 + bytes);
buf.write("RIFF",0); buf.writeUInt32LE(36+bytes,4); buf.write("WAVE",8);
buf.write("fmt ",12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20);
buf.writeUInt16LE(2,22); buf.writeUInt32LE(SR,24); buf.writeUInt32LE(SR*4,28);
buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34);
buf.write("data",36); buf.writeUInt32LE(bytes,40);
let o = 44;
for (let i = 0; i < N; i++) {
  let l = Math.max(-1, Math.min(1, L[i]*norm));
  let r = Math.max(-1, Math.min(1, R[i]*norm));
  buf.writeInt16LE((l*32767)|0, o); o+=2;
  buf.writeInt16LE((r*32767)|0, o); o+=2;
}
const out = path.resolve(__dirname, "music.wav");
fs.writeFileSync(out, buf);
console.log("wrote", out, "duration", LOOP.toFixed(2)+"s", N, "frames");

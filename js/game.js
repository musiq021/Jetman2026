/* game.js — NEONCAVE, an SFCave clone.
 * Fixed-timestep physics, procedural tunnel, scrolling block obstacles. */
(function () {
  "use strict";

  const W = 960, H = 540;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ---- fixed constants ----
  const STEP = 1000 / 60;   // physics timestep
  const PLAYER_X = 200;     // player's fixed horizontal position
  const PLAYER_R = 6;       // collision radius
  const MARGIN = 26;        // min wall thickness top/bottom

  // ---- live-tunable params (adjustable via the in-game debug panel) ----
  // Defaults are gentle; open the panel (gear button / "D") to tune.
  const P = {
    gravity: 0.17,     // downward accel/step when not thrusting
    thrust: 0.13,      // upward accel/step while held
    maxVy: 3.5,        // terminal velocity (both directions)
    baseSpeed: 3.9,    // scroll px/step at difficulty 0
    extraSpeed: 3.0,   // added scroll px/step at difficulty 1
    rampDist: 16000,   // px traveled to reach max difficulty
    maxGap: 260,       // tunnel opening at start
    minGap: 120,       // tunnel opening at max difficulty
  };
  const P_DEFAULTS = Object.assign({}, P);

  const audio = new window.AudioEngine();

  // ---- game state ----
  let state = "menu"; // menu | play | over
  let best = +(localStorage.getItem("neoncave_best") || 0);

  let scrollX, distance, score, difficulty, speed;
  let player, vy, holding, ready;   // `ready` = pre-flight hover, no gravity/collision
  let readyPulse = 0;
  let trail, particles, stars, blocks;
  let nextBlockAt;            // worldX at which to spawn next block
  let cavePhase;             // randomized phases for the tunnel shape
  let acc = 0, lastT = 0;    // physics accumulator
  let shake = 0;

  // ---- DOM ----
  const overlay   = document.getElementById("overlay");
  const gameover  = document.getElementById("gameover");
  const hud       = document.getElementById("hud");
  const scoreEl   = document.getElementById("score");
  const bestEl    = document.getElementById("best");
  const finalEl   = document.getElementById("finalScore");
  const bestScore = document.getElementById("bestScore");

  bestEl.textContent = "BEST " + best;

  // ---------- tunnel shape ----------
  // Smooth pseudo-random center line from layered sines (deterministic per run).
  function caveCenter(worldX) {
    const p = cavePhase;
    const s =
      Math.sin(worldX * 0.0042 + p[0]) +
      Math.sin(worldX * 0.0017 + p[1]) * 0.8 +
      Math.sin(worldX * 0.0105 + p[2]) * 0.5 +
      // extra wobble that grows with difficulty
      Math.sin(worldX * 0.020 + p[3]) * 0.45 * difficulty;
    const norm = s / 2.75; // -> roughly [-1, 1]
    const gap = caveGap();
    const maxDev = (H / 2) - (gap / 2) - MARGIN;
    return H / 2 + norm * maxDev * 0.92;
  }
  function caveGap() {
    return P.maxGap - (P.maxGap - P.minGap) * difficulty;
  }
  function caveTopAt(worldX) { return caveCenter(worldX) - caveGap() / 2; }
  function caveBotAt(worldX) { return caveCenter(worldX) + caveGap() / 2; }

  // ---------- lifecycle ----------
  function reset() {
    scrollX = 0; distance = 0; score = 0; difficulty = 0; speed = P.baseSpeed;
    vy = 0; holding = false; ready = true; shake = 0;
    trail = []; particles = []; blocks = [];
    cavePhase = [Math.random() * 6.28, Math.random() * 6.28,
                 Math.random() * 6.28, Math.random() * 6.28];
    player = { x: PLAYER_X, y: H / 2 };
    nextBlockAt = 900;
    initStars();
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.3 + Math.random() * 1.2,   // parallax depth
        r: Math.random() * 1.4 + 0.3
      });
    }
  }

  function startGame() {
    audio.init();
    audio.startMusic();
    reset();
    state = "play";
    overlay.classList.add("hidden");
    gameover.classList.add("hidden");
    hud.classList.remove("hidden");
  }

  function endGame() {
    state = "over";
    holding = false;
    audio.crash();
    shake = 16;
    spawnExplosion(player.x, player.y);
    if (score > best) {
      best = score;
      localStorage.setItem("neoncave_best", String(best));
    }
    bestEl.textContent = "BEST " + best;
    finalEl.textContent = score;
    bestScore.textContent = best;
    // brief delay so the explosion is visible before the panel
    setTimeout(() => {
      if (state === "over") gameover.classList.remove("hidden");
    }, 650);
  }

  // ---------- obstacles ----------
  function spawnBlock() {
    const gap = caveGap();
    const worldX = scrollX + W + 40;
    const top = caveTopAt(worldX);
    const usable = gap;
    // Block height scales up with difficulty; leave a passable slot.
    const bh = Math.min(usable - 50, 24 + difficulty * 90 + Math.random() * 40);
    const slot = usable - bh;                 // free vertical space
    const offset = Math.random() * slot;      // where the block sits in the gap
    const bw = 22 + Math.random() * 26;
    blocks.push({ x: worldX, y: top + offset, w: bw, h: bh });
    // Next spawn distance shrinks as it gets harder.
    const spacing = 520 - difficulty * 230 + Math.random() * 160;
    nextBlockAt = worldX + spacing;
  }

  function spawnExplosion(x, y) {
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 7;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.012 + Math.random() * 0.03,
        r: 1 + Math.random() * 3
      });
    }
  }

  // ---------- update ----------
  function update() {
    // Pre-flight hover: ship floats at center, no gravity/scroll/collision,
    // until the first thrust input. Fixes the instant-crash on start (esp. touch).
    if (ready) {
      readyPulse += 0.12;
      player.y += (H / 2 - player.y) * 0.12; // ease to center
      vy = 0;
      // keep the starfield drifting so the screen feels alive
      for (const s of stars) {
        s.x -= P.baseSpeed * s.z * 0.35;
        if (s.x < 0) { s.x = W; s.y = Math.random() * H; }
      }
      return;
    }

    // difficulty & speed
    difficulty = Math.min(1, distance / P.rampDist);
    speed = P.baseSpeed + P.extraSpeed * difficulty;
    audio.setIntensity(difficulty);

    // physics
    vy += holding ? -P.thrust : P.gravity;
    if (vy > P.maxVy) vy = P.maxVy;
    if (vy < -P.maxVy) vy = -P.maxVy;
    player.y += vy;

    // advance world
    scrollX += speed;
    distance += speed;
    const newScore = Math.floor(distance / 8);
    if (Math.floor(newScore / 100) > Math.floor(score / 100)) audio.blip(); // milestone
    score = newScore;

    // trail
    trail.push({ x: player.x, y: player.y });
    if (trail.length > 22) trail.shift();

    // stars
    for (const s of stars) {
      s.x -= speed * s.z * 0.35;
      if (s.x < 0) { s.x = W; s.y = Math.random() * H; }
    }

    // spawn / cull blocks
    if (scrollX + W + 40 >= nextBlockAt) spawnBlock();
    blocks = blocks.filter(b => b.x - scrollX + b.w > -10);

    // collisions
    const top = caveTopAt(scrollX + player.x);
    const bot = caveBotAt(scrollX + player.x);
    if (player.y - PLAYER_R < top || player.y + PLAYER_R > bot) return endGame();

    for (const b of blocks) {
      const bx = b.x - scrollX;
      if (circleRect(player.x, player.y, PLAYER_R, bx, b.y, b.w, b.h)) return endGame();
    }

    scoreEl.textContent = score;
  }

  function updateOver() {
    // keep particles & a little drift going on the death screen
  }

  function stepParticles() {
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.12; p.vx *= 0.99;
      p.life -= p.decay;
    }
    particles = particles.filter(p => p.life > 0);
    if (shake > 0) shake *= 0.86;
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- render ----------
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawBackground();
    drawCave();
    drawBlocks();
    if (state !== "over") drawPlayer();
    drawParticles();
    if (state === "play" && ready) drawReadyHint();
    drawScanlines();

    ctx.restore();
  }

  function drawReadyHint() {
    const a = 0.55 + 0.35 * Math.sin(readyPulse);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#eafdff";
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#38f6ff";
    ctx.font = "bold 26px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("TAP & HOLD TO FLY", W / 2, H / 2 - 70);
    ctx.font = "14px 'Courier New', monospace";
    ctx.globalAlpha = a * 0.8;
    ctx.fillText("release to fall", W / 2, H / 2 - 46);
    ctx.restore();
    ctx.shadowBlur = 0;
    // little down-arrow tether from the hint toward the waiting ship
    ctx.strokeStyle = `rgba(56,246,255,${a * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, H / 2 - 36);
    ctx.lineTo(player.x, player.y - 16);
    ctx.stroke();
  }

  function drawBackground() {
    // subtle vertical glow already from CSS; add stars + faint grid drift
    ctx.fillStyle = "#aef3ff";
    for (const s of stars) {
      ctx.globalAlpha = 0.12 + s.z * 0.18;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawCave() {
    const step = 8;
    // Build edge points across the screen.
    const tops = [], bots = [];
    for (let x = 0; x <= W; x += step) {
      const wx = scrollX + x;
      tops.push([x, caveTopAt(wx)]);
      bots.push([x, caveBotAt(wx)]);
    }

    // Filled solid walls (dark, slightly blue).
    ctx.fillStyle = "#070d1c";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (const [x, y] of tops) ctx.lineTo(x, y);
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, H);
    for (const [x, y] of bots) ctx.lineTo(x, y);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Glowing neon edges.
    const hue = 188 - difficulty * 40; // shifts cyan -> toward pink as it heats up
    ctx.strokeStyle = `hsl(${hue}, 100%, 65%)`;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 16;
    ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;

    ctx.beginPath();
    tops.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
    ctx.beginPath();
    bots.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawBlocks() {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff3c91";
    ctx.fillStyle = "rgba(255, 60, 145, 0.12)";
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#ff3c91";
    for (const b of blocks) {
      const x = b.x - scrollX;
      ctx.fillRect(x, b.y, b.w, b.h);
      ctx.strokeRect(x, b.y, b.w, b.h);
    }
    ctx.shadowBlur = 0;
  }

  function drawPlayer() {
    // trail
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      ctx.strokeStyle = `rgba(56, 246, 255, ${a * 0.6})`;
      ctx.lineWidth = a * 6;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }

    // ship — a glowing triangle, tilted by vertical velocity
    const tilt = Math.max(-0.6, Math.min(0.6, vy / P.maxVy * 0.6));
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(tilt);
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#38f6ff";
    ctx.fillStyle = "#eafdff";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-8, -7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.fill();
    // thrust flame
    if (holding) {
      ctx.fillStyle = "#ff3c91";
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-8 - Math.random() * 8, -3);
      ctx.lineTo(-8 - Math.random() * 8, 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.life > 0.5 ? "#fff" : "#ff3c91";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#ff3c91";
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawScanlines() {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#000";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
  }

  // ---------- main loop ----------
  function loop(t) {
    if (!lastT) lastT = t;
    let frame = t - lastT;
    lastT = t;
    if (frame > 100) frame = 100; // avoid spiral after tab switch
    acc += frame;

    while (acc >= STEP) {
      if (state === "play") update();
      else if (state === "over") updateOver();
      stepParticles();
      acc -= STEP;
    }
    render();
    requestAnimationFrame(loop);
  }

  // ---------- input ----------
  function press() {
    if (state === "play") {
      ready = false;        // first input begins the flight
      holding = true;
      audio.thrust();
    }
  }
  function release() { holding = false; }

  function primaryAction() {
    audio.init();
    if (state === "menu") startGame();
    else if (state === "over") {
      // ignore taps during the death animation pause
      if (!gameover.classList.contains("hidden")) startGame();
    }
  }

  // pointer / touch
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); primaryAction(); press(); });
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (state === "play") press();
      else primaryAction();
    } else if (e.key === "m" || e.key === "M") {
      audio.toggle();
    } else if (e.key === "d" || e.key === "D") {
      debugPanel.classList.toggle("hidden");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") release();
  });

  // buttons
  document.getElementById("startBtn").addEventListener("click", (e) => {
    e.stopPropagation(); audio.init(); startGame();
  });
  document.getElementById("retryBtn").addEventListener("click", (e) => {
    e.stopPropagation(); audio.init(); startGame();
  });

  // pause music when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.stopMusic();
    else if (state === "play") audio.startMusic();
  });

  // iOS: suppress pinch-zoom and the long-press context menu. Selection, the
  // magnifier/cursor, and double-tap zoom are handled in CSS (user-select /
  // touch-callout / touch-action) so we don't interfere with pointer input.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- debug / tuning panel ----------
  // Live sliders for the physics params. Toggle with the gear button or "D".
  const DBG = [
    { k: "gravity",    min: 0.05, max: 1.0,  step: 0.01, label: "Gravity" },
    { k: "thrust",     min: 0.05, max: 1.0,  step: 0.01, label: "Thrust" },
    { k: "maxVy",      min: 2,    max: 12,   step: 0.5,  label: "Max speed (vy)" },
    { k: "baseSpeed",  min: 1,    max: 6,    step: 0.1,  label: "Scroll: base" },
    { k: "extraSpeed", min: 0,    max: 6,    step: 0.1,  label: "Scroll: +difficulty" },
    { k: "rampDist",   min: 4000, max: 40000,step: 1000, label: "Ramp distance" },
    { k: "maxGap",     min: 140,  max: 360,  step: 5,    label: "Start gap" },
    { k: "minGap",     min: 70,   max: 220,  step: 5,    label: "Hardest gap" },
  ];

  function buildDebugPanel() {
    const panel = document.createElement("div");
    panel.id = "debug";
    panel.className = "hidden";
    // --- music section: track selector + mute ---
    const mh = document.createElement("h3");
    mh.textContent = "▸ MUSIC";
    panel.appendChild(mh);

    const trackRow = document.createElement("label");
    trackRow.className = "dbg-select";
    const trackName = document.createElement("span");
    trackName.textContent = "Track";
    const select = document.createElement("select");
    for (const t of audio.listTracks()) {
      const opt = document.createElement("option");
      opt.value = t.id; opt.textContent = t.name;
      if (t.id === audio.getTrack()) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      audio.init();           // ensure the element exists / is unlocked
      audio.startMusic();     // a track change is a user gesture — play it
      audio.setTrack(select.value);
    });
    trackRow.appendChild(trackName); trackRow.appendChild(select);
    panel.appendChild(trackRow);

    const muteRow = document.createElement("button");
    muteRow.className = "dbg-reset";
    const syncMute = () => { muteRow.textContent = audio.enabled ? "🔊 SOUND ON" : "🔇 SOUND OFF"; };
    syncMute();
    muteRow.addEventListener("click", () => { audio.toggle(); syncMute(); });
    panel.appendChild(muteRow);

    const h = document.createElement("h3");
    h.textContent = "▸ TUNING";
    h.style.marginTop = "14px";
    panel.appendChild(h);

    const rows = {};
    for (const d of DBG) {
      const row = document.createElement("label");
      const name = document.createElement("span");
      const val = document.createElement("b");
      const input = document.createElement("input");
      input.type = "range";
      input.min = d.min; input.max = d.max; input.step = d.step;
      input.value = P[d.k];
      name.textContent = d.label;
      val.textContent = P[d.k];
      input.addEventListener("input", () => {
        P[d.k] = parseFloat(input.value);
        val.textContent = P[d.k];
      });
      row.appendChild(name); row.appendChild(val); row.appendChild(input);
      panel.appendChild(row);
      rows[d.k] = { input, val };
    }

    const reset = document.createElement("button");
    reset.textContent = "RESET DEFAULTS";
    reset.className = "dbg-reset";
    reset.addEventListener("click", () => {
      Object.assign(P, P_DEFAULTS);
      for (const d of DBG) { rows[d.k].input.value = P[d.k]; rows[d.k].val.textContent = P[d.k]; }
    });
    panel.appendChild(reset);

    const gear = document.createElement("button");
    gear.id = "gear";
    gear.textContent = "⚙";
    gear.title = "Tuning panel (D)";
    gear.addEventListener("click", (e) => { e.stopPropagation(); panel.classList.toggle("hidden"); });

    document.getElementById("frame").appendChild(panel);
    document.getElementById("frame").appendChild(gear);
    return panel;
  }
  const debugPanel = buildDebugPanel();

  // ---------- boot ----------
  reset();
  state = "menu";
  requestAnimationFrame(loop);
})();

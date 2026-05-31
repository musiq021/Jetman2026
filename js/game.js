/* game.js — NEONCAVE, an SFCave clone.
 * Fixed-timestep physics, procedural tunnel, scrolling block obstacles. */
(function () {
  "use strict";

  const W = 960, H = 540;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ---- tunable constants (per 1/60s physics step) ----
  const STEP = 1000 / 60;
  const GRAVITY = 0.46;     // downward accel when not thrusting
  const THRUST  = 0.46;     // upward accel while held (symmetric = classic SFCave feel)
  const MAX_VY  = 8.5;      // terminal velocity (both directions)
  const PLAYER_X = 200;     // player's fixed horizontal position
  const PLAYER_R = 6;       // collision radius

  const BASE_SPEED = 3.0;   // px/step at difficulty 0
  const EXTRA_SPEED = 3.4;  // added at difficulty 1
  const RAMP_DIST = 16000;  // px traveled to reach max difficulty

  const MARGIN = 26;        // min wall thickness top/bottom
  const MAX_GAP = 250;      // tunnel opening at start
  const MIN_GAP = 110;      // tunnel opening at max difficulty

  const audio = new window.AudioEngine();

  // ---- game state ----
  let state = "menu"; // menu | play | over
  let best = +(localStorage.getItem("neoncave_best") || 0);

  let scrollX, distance, score, difficulty, speed;
  let player, vy, holding;
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
    return MAX_GAP - (MAX_GAP - MIN_GAP) * difficulty;
  }
  function caveTopAt(worldX) { return caveCenter(worldX) - caveGap() / 2; }
  function caveBotAt(worldX) { return caveCenter(worldX) + caveGap() / 2; }

  // ---------- lifecycle ----------
  function reset() {
    scrollX = 0; distance = 0; score = 0; difficulty = 0; speed = BASE_SPEED;
    vy = 0; holding = false; shake = 0;
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
    // difficulty & speed
    difficulty = Math.min(1, distance / RAMP_DIST);
    speed = BASE_SPEED + EXTRA_SPEED * difficulty;
    audio.setIntensity(difficulty);

    // physics
    vy += holding ? -THRUST : GRAVITY;
    if (vy > MAX_VY) vy = MAX_VY;
    if (vy < -MAX_VY) vy = -MAX_VY;
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
    drawScanlines();

    ctx.restore();
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
    const tilt = Math.max(-0.6, Math.min(0.6, vy / MAX_VY * 0.6));
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

  // ---------- boot ----------
  reset();
  state = "menu";
  requestAnimationFrame(loop);
})();

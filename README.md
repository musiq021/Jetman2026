# NEONCAVE — a browser-based SFCave clone

A faithful, dependency-free clone of the classic **SFCave** arcade game, rebuilt
for the browser with a neon-retro coat of paint and a fully procedural chiptune
soundtrack. No build step, no assets, no libraries — just open `index.html`.

## How to play

| Input | Action |
|-------|--------|
| Hold **mouse / touch / SPACE / ↑** | thrust **up** |
| Release | fall **down** |
| **M** | toggle sound |

Thread your ship through the cave. Touch a wall or a pink block and you're wrecked.
Score climbs with distance. The cave narrows, wobbles harder, blocks get bigger,
and the music speeds up the longer you survive.

## Running it

It's a static site. Any of these work:

```bash
# simplest — just open the file
open index.html          # macOS
xdg-open index.html      # Linux

# or serve it (avoids any future fetch/CORS quirks)
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Design — honing the SFCave feel

**Mechanics (the core).** SFCave's signature is *dual-acceleration* flight, not
a fixed jump. Holding applies a constant upward acceleration; releasing applies an
equal downward one (`GRAVITY === THRUST`). Velocity integrates over time and is
clamped to a terminal speed, so survival is a rhythm of small taps to hold
altitude rather than mashing. The player is pinned at a fixed screen-x and the
world scrolls past — classic side-tunnel framing.

**Gameplay / difficulty curve.** A single `difficulty` value ramps from 0→1 over
the first ~16k px of distance and drives everything:
- tunnel gap shrinks (`MAX_GAP → MIN_GAP`),
- scroll speed rises (`BASE_SPEED → +EXTRA_SPEED`),
- the center line gains a faster wobble harmonic,
- block obstacles spawn closer together and grow taller.

The cave centerline is a sum of incommensurate sines with run-randomized phases —
smooth and deterministic within a run, but unpredictable between runs. Blocks are
placed inside the current gap with a guaranteed passable slot.

**Style.** Neon-on-black: glowing cyan tunnel edges that shift toward hot-pink as
difficulty rises, a parallax starfield, a tilting triangular ship with a fading
motion trail and thrust flame, particle explosion + screen-shake on death, and a
subtle CRT scanline overlay.

**Music.** A licensed synthwave track ("Synthwave House Loop" by Fupi, CC0 —
see `CREDITS.md`), shipped as `assets/music.ogg` (Vorbis) + `assets/music.m4a`
(AAC, for iOS Safari, which doesn't reliably play Ogg). `js/audio.js` fetches,
decodes, and gaplessly loops it via a Web Audio `BufferSource`, picking the first
format the browser supports. SFX (thrust, milestone blip, crash) are still
synthesized on the fly. Audio starts from the first user gesture to respect
browser autoplay policies.

## Architecture

```
index.html      # canvas + menu/HUD/game-over overlays
css/style.css   # neon styling, responsive 16:9 scaling
js/audio.js     # AudioEngine: procedural music + SFX
js/game.js      # fixed-timestep loop, physics, cave gen, render
```

The game loop uses a **fixed 60 Hz physics timestep** with an accumulator so the
feel is identical regardless of display refresh rate; rendering happens once per
animation frame. Best score persists via `localStorage`.

## Tuning

All the knobs live at the top of `js/game.js` (`GRAVITY`, `THRUST`, `MAX_VY`,
`MAX_GAP`, `MIN_GAP`, `RAMP_DIST`, speeds). Adjust and reload.

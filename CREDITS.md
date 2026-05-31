# Audio Credits

## Music
- **Tracks:** *Chiptune Adventures* — "Stage 1", "Stage 2", "Boss Fight",
  "Stage Select" (selectable in the in-game ⚙ config panel)
- **Author:** Juhani Junkala (SubspaceAudio)
- **Source:** https://opengameart.org/content/4-chiptunes-adventure
- **License:** CC0 1.0 (public domain dedication — no attribution required;
  credited here as a courtesy)

Each track ships as `assets/<id>.mp3` (for iOS Safari / universal) and
`assets/<id>.ogg` (Vorbis, for Chrome/Firefox), transcoded from the original
Ogg. Music plays through an HTML `<audio>` element for reliable iOS playback.

## Sound effects
Thrust / milestone blip / crash are generated procedurally at runtime via the
Web Audio API (`js/audio.js`) — no asset files.

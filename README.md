# SatisBall Studio

A browser studio that makes satisfying ball-simulation videos for TikTok, Reels and Shorts. It has nine simulation modes, synthesised musical sound, a vertical 1080×1920 canvas, and a one-click, frame-perfect MP4 export.

## Run it (Windows)

1. Download or clone this folder.
2. Double-click **`Start SatisBall.bat`**. It opens the studio in Microsoft Edge (or Chrome) as an app window.
   You can also just double-click `index.html` in Edge or Chrome.
3. Click the splash screen once. Browsers only allow sound after a click.

There's nothing to install, no server to run and no internet connection needed. The fonts and libraries are bundled.

Use Edge or Chrome. The frame-perfect export uses WebCodecs, which both of them support. Firefox can preview and live-record, but its export support varies.

## Make a video

| Step | How |
|---|---|
| Pick a mode | Left column, or keys **1–9** |
| Start from a preset | **Mode** tab → Presets |
| Make every run different | **🎲 Randomise** (**G**), or **New run** (**N**) for a new seed |
| Look & sound | **Look** tab (palettes, glow, bloom, shake, trails) and **Sound** tab (instrument, note pattern, key/scale, melody) |
| Hook text | **Text** tab. Wrap a word in `*stars*` to colour it, e.g. `Can the ball *escape?*`. It can be switched off or shown for 4 s only |
| Target length | **Run** tab. Every mode steers its difficulty so the payoff lands close to this (15–60 s) |

### Export (recommended)
Press **⤓ Export MP4** (**E**) → **Render MP4**. SatisBall re-simulates the current run from the start with the same seed and settings. It renders every frame at 1080×1920 and encodes **H.264 + AAC MP4** at 60 fps. The file downloads when it's done.

Because it renders offline, the video is perfectly smooth even if your PC can't hold 60 fps live, and the audio is sample-accurate. A 35 s video usually takes a minute or two to render.

If the browser has no H.264 encoder, it falls back to VP9 + Opus WebM, which TikTok also accepts.

### Live record
Press **● Record live** (**L**). The run restarts and records in real time (preview + audio). Recording stops by itself after the payoff and saves the file. This only captures what your machine renders live, so use Export when you want guaranteed smoothness.

### Recording mode (for OBS / screen capture)
Press **H**: every UI element disappears and only the 9:16 video fills the window. The run restarts cleanly. **H** or **Esc** brings the UI back. **F** toggles fullscreen.
The **Safe zones** checkbox under the preview shows where TikTok's buttons and caption sit. It is never part of the video.

## Modes

1. **Escape the Rings**: a ball bounces inside rotating rings with gaps. Passing a gap shatters that ring, and speed and spin ramp up with every ring. Includes a "final ring" riser and slow-mo shatter.
2. **Spiral Breaker**: a spinning spiral that breaks piece by piece. Every hit adds speed and colour, and new balls join. Ends with "Spiral destroyed".
3. **Ball Battles**: 2–4 named fighters with HP. Abilities: **Sword** (spins faster per hit, parries), **Spikes** (grow per hit), **Growth**, **Clone** (minions), **Archer** (bigger volleys), **Vampire** (life-steal), **Shield** (blocks & reflects arrows), **Speed**, **Bomber** (mines). Also has sudden death, where the arena shrinks.
4. **Ball Growth**: every bounce grows the ball until it fills the circle, triangle, square, pentagon or hexagon (optionally spinning). It leaves imprint rings as it grows.
5. **Ball Multiply**: every wall hit spawns a ball, or with the *escape rule* every ball that escapes the ring spawns two. Goes up to 1500 balls.
6. **Marble Race Knockout**: 3–12 racers on a random course of pegs, spinners, sliders, bumpers and funnels. The last ball each lap is eliminated, and a round timer keeps it moving. Live leaderboard with lap counts.
7. **Obstacle Course Survival**: ~4 named balls descend a long random course while **THE WALL** chases them. Sections:
   - colour gates that open only for one ball
   - a key & locked door
   - knives to pick up and use on other balls
   - trapdoors
   - crumbling floors
   - crushing pistons
   - saws and spinners
   - bounce pads
   - a colour-locked shortcut lane

   Sections behind the wall collapse. Close calls, lead changes, a kill feed, a live leaderboard and a course tracker. The win goes to the first ball over the finish line or the last survivor.
8. **Bounce Strings** (extra): every bounce ties a glowing string from the hit point to the ball, weaving a web. The strings snap at the goal.
9. **Colour War** (extra): team balls flip enemy tiles. The countdown ticks through the last 5 seconds, and at 0:00 the winner floods the board.

Each mode has its own settings (speed, gravity, counts, sizes, HP, colours…), presets, and a **Pace assist** toggle. The assist keeps runs inside 15–60 s. Switch it off for pure physics.

## Sound

Everything is synthesised by the app, so there is nothing to license:
- **8 instruments:** Grand Piano, Marimba, Harp Pluck (Karplus-Strong), Neon Synth, Crystal Bells (FM), Kalimba, Glass Sine, 8-Bit.
- **Note patterns:**
  - Chord Arpeggios (always in key, with bass on chord changes)
  - Scale Climb
  - Scale Up & Down
  - Melody (one note per hit): public-domain tunes such as Ode to Joy, Für Elise, Canon in D, Hall of the Mountain King (which climbs each loop), Moonlight Sonata, Greensleeves, Korobeiniki and Twinkle Twinkle
  - Rises With Tension
  - Random In-Key
- Any key and 8 scales.
- **SFX:** shatter, boom, elimination, gate, collapse, crumble, blade, clang, pickup, key, boing, riser, shimmer, win fanfare…
- A reverb → compressor → limiter chain keeps it loud without clipping. Tested at about −11 dB mean and −1 dB peak.

## Presets I expect to perform best

1. **Escape the Rings → "Hyper 40 Rings"** with Sound → *Melody: Hall of the Mountain King* on piano. The counter, rising tempo and final-ring slow-mo make a strong watch-to-the-end loop. Hook: *"How long to escape 40 rings?"*
2. **Ball Battles → "Sword vs Spikes"** (or 2 random fighters). Viewers pick a side in the first second and argue in the comments. Hook: *"Who wins? Pick a side!"*
3. **Obstacle Course Survival → "4 Survivors"**, target 45 s. It has the most drama: gates, knives, close calls with the wall. Pin a comment asking which ball they backed.
4. **Ball Growth → "Melody Grow"**, one note of Canon in D per bounce, climbing to "IT'S FULL!". Very rewatchable.
5. **Marble Race Knockout → "8 Racers"**, Neon Noir palette. The per-lap eliminations give a new payoff every ~4 seconds.
6. **Colour War → "Day vs Night"**, target 30 s. Tense final-5-seconds countdown.

Post several seeds of the same format. The **Randomise each new run** option (Run tab) gives endless variety.

## Architecture (adding a mode)

Plain JavaScript, no build step (`index.html` loads the scripts in order).

- `js/core/game.js`: fixed-step (240 Hz) deterministic simulation, director (hook text, slow-mo, hit-stop, finale, winner card) and render pipeline (background, bloom, HUD).
- `js/core/physics.js`: circle physics with adaptive sub-stepping (no tunnelling), rotating/moving walls, Coulomb friction, energy lock (no energy creep) and a spatial grid.
- `js/core/audio.js`: DSP instruments & SFX, the mixing graph (the same graph live and offline) and the music sequencer.
- `js/core/fx.js`: particles, shards, confetti, shake, flashes, banners, glow sprites and text.
- `js/core/recorder.js`: WebCodecs exporter (mp4-muxer / webm-muxer) and the MediaRecorder live capture.
- `js/modes/*.js`: one file per mode.

To add a mode, create `js/modes/mymode.js`, subclass `SB.Mode` (`init`, `update(dt)`, `render(ctx)`, `hud(ctx)`, `forceEnd()`), call `SB.modes.register({ id, name, icon, tagline, hook, settings, presets, create })`, and add a `<script>` tag to `index.html`. The UI builds its settings panel from the `settings` schema automatically. The contract is documented at the top of `js/core/mode.js`.

Rules that keep exports identical to the preview:
- Use only `this.rng` (seeded) for randomness.
- Change state only in `update`, never in `render`.

## Test tools (Node + Playwright, for development)

```
node tools/pacing.cjs 6     # every mode over 6 seeds: payoff time must land in 15–60 s
node tools/audit.cjs 3      # physics invariants (no tunnelling/escapes) incl. extreme settings
node tools/audio.cjs        # offline-render each soundtrack: peak / loudness / clipping
node tools/export.cjs rings out.mp4 35   # full export through WebCodecs
node tools/uitest.cjs .     # drives the whole UI and reports console errors
```

## Licences

- Code: yours.
- Bundled: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) and webm-muxer (MIT), and the Unbounded and Space Grotesk fonts (SIL Open Font License). See `licenses/`.
- All sounds are generated by the code.
- The melodies are public domain.

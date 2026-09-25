# SatisBall Studio

A browser studio for making satisfying ball-simulation videos for TikTok, Reels and Shorts. It includes:

- 19 simulation modes
- synthesised music that builds with the tension
- a vertical 9:16 canvas
- one-click, frame-perfect MP4 export, plus batch export

## Run it (Windows)

1. Download or clone this folder.
2. Double-click **`Start SatisBall.bat`**. It opens the studio in Microsoft Edge (or Chrome) as an app window.
   You can also just double-click `index.html` in Edge or Chrome.
3. Click the splash screen once. Browsers only allow sound after a click.

There's nothing to install, no server to run and no internet needed. The fonts and libraries are bundled.

Use Edge or Chrome. The frame-perfect export uses WebCodecs, which both of them support. Firefox can preview and live-record.

## Run it on a phone

Phones can't open a local `index.html` with its scripts (iPhone's Files app only shows a preview, and Android blocks the sibling files). So the studio needs to be served from a URL:

1. **GitHub Pages (free, one-time setup):**
   1. In the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   2. The included workflow (`.github/workflows/pages.yml`) then publishes the site on every push. Re-run it once from the **Actions** tab to deploy straight away.
   3. Open `https://<your-username>.github.io/<repo>/` on your phone.
   4. Use **Share → Add to Home Screen** to make it a full-screen app.
2. **Or from your PC on the same Wi-Fi:** run `python -m http.server 8000` in this folder, then open `http://<your-PC's-IP>:8000` on the phone.

The phone layout has:
- a bottom bar: **Modes · Settings · Random · New run · Export · More**
- modes and settings as swipe-up sheets
- a lighter live preview. It steps down automatically on slow phones; exports always render at full quality.

After an export, **📤 Save / share video** opens the phone's share sheet, so you can save to Photos or post straight to TikTok.
- **Android Chrome:** exports with sound.
- **iPhone Safari:** can encode video, but some iOS versions can't encode audio. In that case the app warns you before rendering; use **More → Record live** for a clip with sound, or export on a PC.
- **iPhone sound:** turn the silent switch off.

## Make a video

| Step | How |
|---|---|
| Pick a mode | Left column: search box, grouped by category. Keys **1–9**, **[** / **]** |
| Start from a preset | **Mode** tab → preset chips, or **Library** tab → *Featured presets* |
| Make every run different | **🎲 Randomise** (**G**), or **New run** (**N**) for a fresh seed |
| Tune the mode | **Mode** tab: every setting the mode has, plus target length, seed and auto-restart/auto-randomise |
| Look | **Look** tab: 8 palettes plus a custom palette editor, cast editor (rename and recolour fighters, racers, teams and armies), 7 backgrounds, 5 ball styles, glow, bloom, shake, particles, trails, camera zoom and slow-mo, tension glow |
| Sound | **Sound** tab: 13 instruments, note pattern, melody, key, scale, octave, backing track (off / pad / builds with tension / full beat), tempo, mix |
| Hook text | **Text** tab. Wrap words in `*stars*` to highlight them. You can also set: <ul><li>6 fonts and 4 styles (shadow, outline, caption box, neon)</li><li>4 animations</li><li>size, offset, colours and a sub-line</li><li>an intro hook card with the roster</li><li>end text, outro length and fade to black</li></ul> |
| Save / share | **Library** tab: save presets, export/import `.json`, copy a **share code** (or link) that reproduces the exact same video, and a **history** of recent runs you can replay exactly |

### Export (recommended)
Press **⤓ Export** (**E**) → **Render**. SatisBall re-simulates the run from its seed and renders every frame offline. It encodes **H.264 + AAC MP4**, and the file downloads when it's done. It falls back to VP9 + Opus WebM when a browser has no H.264 encoder; TikTok also accepts that.

Because the render happens offline, the video is perfectly smooth even if your PC can't hold 60 fps live, and the audio is sample-accurate. It is aligned to the frames to within ±½ frame.

**Export tab** options:
- **Resolution:** 720×1280, 1080×1920 or 1440×2560.
- **Frame rate:** 30 or 60 fps.
- **Quality:** standard, high or max.
- **Length limit:** optional hard cut.
- **Intro card and outro:** quick toggles.

**Batch export** renders many videos in one go. Choose:
- how many
- which modes: current, all, or a hand-picked list
- whether to randomise settings, and palette/sound, for each video
- a length window; runs that would fall outside it are re-rolled before rendering

In Chrome/Edge you can pick a folder so files save straight into it, with no download prompts.

### Auto-publish to YouTube Shorts and TikTok
In the **Export** tab, connect YouTube and/or TikTok and switch on auto-upload. Every export and every batch video then uploads by itself, with templated titles, captions and hashtags. YouTube uploads can be scheduled, e.g. one every 4 hours, and TikTok gets inbox drafts or direct posts. The one-time developer setup, and the platforms' limits for new apps, are in [PUBLISHING.md](PUBLISHING.md).

### Live record
Press **● Record live** (**L**). The run restarts and records in real time and stops by itself after the payoff. Use Export when you want guaranteed smoothness.

### Recording mode (for OBS / screen capture)
Press **H**: every UI element disappears and only the 9:16 video fills the window. **H** or **Esc** brings the UI back. **F** toggles fullscreen.
The **Safe zones** checkbox shows where TikTok's buttons and caption sit. It is never part of the video.

## Modes

**Satisfying**
- **Spiral Breaker**: every hit breaks the spinning spiral and adds speed and balls.
- **Ball Growth**: every bounce grows the ball until it fills the arena. It can be any of 8 shapes, spinning or morphing.
- **Ball Multiply**: every bounce spawns a ball, or the escape rule doubles escapees. Goes up to 1500 balls.
- **Bounce Strings**: every bounce ties a glowing string, weaving a web.
- **Chain Reaction** *(new)*: balls vs a numbered brick board in 7 shapes, including heart and pyramid. TNT bricks chain-explode with slow-mo, and +1 bricks add multiball.

**Escape**
- **Escape the Rings**: rotating rings with gaps. Passing a gap shatters the ring.
- **Rotating Maze** *(new)*: a procedurally generated circular maze spins while gravity rolls the ball(s) to the exit. Walls crack and crumble, and the exit gate counts down. Race up to 4 balls.

**Battles**
- **Ball Battles**: 2–4 named fighters with HP and 12 abilities:
  - sword, spikes, growth, clone, archer, vampire, shield, speed, bomber, frost, laser, healer

  It has crits, combos, sudden death and morphing arenas.
- **Tournament** *(new)*: a 4 or 8-fighter knockout bracket. The bracket fills in live, stakes rise per round, and the champion lifts a trophy. Long-form.
- **Team Battle** *(new)*: 2–4 colour teams from 1v1 to 5v5, with no friendly fire. Includes team HP cards, "last one standing" calls and an MVP on the payoff.
- **Boss Fight** *(new)*: a hero squad vs a giant boss with 3 phases:
  1. bullet rings
  2. dash and minions
  3. FINAL FORM spirals

  Shields reflect bullets and swords cut them. The seeded "who should win" option keeps it dramatic.
- **Level Up** *(new)*: fighters hunt XP orbs, and every level upgrades their ability, up to Lv6 "MAXED OUT".

**Survival**
- **Marble Race Knockout**: random courses; the last ball each lap is eliminated.
- **Obstacle Course Survival**: outrun THE WALL through gates, keys, knives, trapdoors, pistons and saws.
- **Square Escape** *(new)*: eyed squares race a procedurally generated, validated level.
  - Layouts: gauntlet (start stalls and linked doors), circuit, tower, lanes and staircase.
  - Obstacles: number blocks, colour bars, spikes, pencils, ghosts, knives, guns, boosts and portals.
  - The winner is first to the flag or last alive. Long-form (up to ~3 min, paced so it never stalls).

**Territory**
- **Colour War**: team balls flip enemy tiles; final countdown.
- **Paint Splat** *(new)*: balls paint the floor on swirling paths. Paint bombs and big brushes flip the lead. When the timer ends, the most coverage wins.
- **Army Clash** *(new)*: 2–4 armies spawn hundreds of units. Moving ×2/×3 rings multiply them, and a fallen base's army converts to the attacker.

**Viewer pick**
- **Last One In** *(new)*: numbered balls in a spinning ring with gaps. The last one still inside wins (or the first out). Built for "comment your number".

Every mode has its own settings, presets and hook ideas, plus a **Pace assist** that steers the payoff close to your target length. Normal modes land at 15–60 s; long-form modes (Tournament, Square Escape) run up to ~3 min. Switch the assist off for pure physics.

Every mode also has at least one "rewatch moment" with slow-mo, zoom and a flash: a final ring, a KO, a chain ×10, a gate breaking, or a last-second paint bomb.

## Sound

Everything is synthesised by the app, so there is nothing to license:
- **13 instruments:**
  - Grand Piano, Marimba, Harp Pluck, Neon Synth, Crystal Bells, Kalimba, Glass
  - 8-Bit, Lo-fi Keys, Vibraphone, Music Box, Steel Pan, Nylon Guitar
- **Note patterns:** chord arpeggios, scale climb, up & down, rises with tension, random in-key, and melody mode (one note per hit). Melody mode uses public-domain tunes:
  - Ode to Joy, Für Elise, Canon in D, Mountain King, Moonlight Sonata, William Tell, Habanera, Greensleeves, Korobeiniki, Twinkle Twinkle
- **Backing track:** a pad, kick, hats, bass, claps, snare roll and a swell that build with the run's tension, then drop into the win sting.
- **Mix:** a music bus with side-chain ducking and an SFX bus with overlap limits, feeding reverb, compressor and limiter.
  - Tested: no clipping; about −10 dB RMS and −1.5 dBFS peak.
  - Notes are pre-rendered in idle time, so the first hits never hitch.

## Architecture (adding a mode)

Plain JavaScript with no build step; `index.html` loads the scripts in order.

- `js/core/game.js`: fixed-step (240 Hz) deterministic simulation, plus:
  - a director: hook, intro card, slow-mo, hit-stop, camera moments, winner card, outro
  - the render pipeline: background, bloom, tension glow
- `js/core/physics.js`, `arena.js`: circle physics with adaptive sub-stepping (no tunnelling), Coulomb friction, energy lock, a spatial grid, and star-shaped / spinning / morphing arenas with correct concave collision.
- `js/core/brawl.js`: the fighter engine (abilities, levels, teams, projectiles, HUD cards). Battles, Tournament, Team Battle, Boss Fight and Level Up all use it.
- `js/core/audio-dsp.js`, `audio.js`: DSP instruments & SFX, the mixing graph (the same graph live and offline), the sequencer and the backing track.
- `js/core/fx.js`, `backgrounds.js`: particles, shards, confetti, banners, popups, ball styles, text and backgrounds.
- `js/core/recorder.js`: the WebCodecs exporter (mp4-muxer / webm-muxer), live capture and folder saving.
- `js/ui.js`, `js/ui-library.js`: the studio UI, preset library, share codes and history.
- `js/modes/*.js`: one file per mode.

To add a mode:
1. Create `js/modes/mymode.js`.
2. Subclass `SB.Mode` and implement `init`, `update(dt)`, `render(ctx)`, `hud(ctx)` and `forceEnd()`.
3. Call `SB.modes.register({ id, name, icon, category, tagline, hook, settings, presets, create })`.
4. Add a `<script>` tag to `index.html` before `recorder.js`.

The UI builds the settings panel from the schema, including `show: (s) => bool` for conditional settings. The contract is documented at the top of `js/core/mode.js`.

Rules that keep exports identical to the preview:
- Use only `this.rng` (seeded) for randomness.
- Change state only in `update`, never in `render`.

## Test tools (Node + Playwright, for development)

```
node tools/pacing.cjs 6     # every mode over 6 seeds: payoff time inside 15–60 s (long-form 15–180 s)
node tools/audit.cjs 3      # physics invariants on every mode incl. extreme stress settings
node tools/audio.cjs        # offline-render soundtracks: peak / loudness / clipping / silence
node tools/export.cjs rings out.mp4 35   # full export (env OPTS='{"width":720,"height":1280,"fps":30}')
python3 tools/mp4info.py out.mp4         # frame count / duration / size of an exported MP4
node tools/uitest.cjs .     # drives every mode x tab, library, share codes, replay, export options
node tools/mobile.cjs .     # iPhone-sized touch emulation: bottom bar, sheets, clean view, export modal
node tools/publishtest.cjs  # export + auto-upload to mocked YouTube / TikTok endpoints
node tools/relaytest.mjs    # TikTok relay logic with TikTok's API mocked
```

## Licences

- Code: yours.
- Bundled: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) and webm-muxer (MIT).
- Fonts:
  - SIL Open Font License: Unbounded, Space Grotesk, Anton, Bungee, Poppins
  - Apache 2.0: Luckiest Guy

  See `licenses/`.
- All sounds are generated by the code.
- The melodies are public domain.

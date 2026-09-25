/* SatisBall — preset library: curated built-in presets, user presets, run history and share codes.
 * A "snapshot" fully determines a run: { v, modeId, seed, settings, look, sound, text, targetLen }.
 * Same snapshot = the exact same video, frame for frame. */
'use strict';
(function (SB) {
  const USER_KEY = 'satisball.presets.v1', HIST_KEY = 'satisball.history.v1';

  // Curated cross-mode presets — the "post these first" shelf.
  const FEATURED = [
    { name: 'Comment Your Number', desc: '20 numbered balls, a spinning ring with one gap', modeId: 'lastin', settings: { balls: 20 }, look: { palette: 'neon', bg: 'glow' }, sound: { theme: 'marimba', pattern: 'chords', backing: 'build' } },
    { name: 'Square Escape: Gauntlet', desc: 'Start stalls, doors, number blocks and spikes', modeId: 'squares', settings: { layout: 'gauntlet', squares: 4 }, look: { palette: 'candy' }, sound: { theme: 'chip', pattern: 'climb', backing: 'build' } },
    { name: '8-Fighter Tournament', desc: 'Knockout bracket with a trophy finish', modeId: 'tournament', settings: { fighters: 8 }, look: { palette: 'neon', bg: 'grid' }, sound: { theme: 'synth', pattern: 'tension', backing: 'full' } },
    { name: 'Boss Fight: 4 Heroes', desc: 'Three boss phases, bullet hell finale', modeId: 'boss', settings: { heroes: 4 }, look: { palette: 'lava', bg: 'rays' }, sound: { theme: 'synth', pattern: 'tension', backing: 'full' } },
    { name: 'Escape 40 Rings', desc: 'The classic ring escape, hyper speed', modeId: 'rings', settings: { rings: 40, spacing: 22, gap: 40, spin: 1.6, intensity: 1.8, thickness: 7, speed: 900 }, look: { palette: 'aurora' }, sound: { theme: 'piano', pattern: 'melody', melody: 'mountain', backing: 'build' } },
    { name: 'Rotating Maze Race', desc: 'Three balls, one random maze, crumbling walls', modeId: 'maze', settings: { balls: 3 }, look: { palette: 'vapor', bg: 'stars' }, sound: { theme: 'kalimba', pattern: 'pingpong', backing: 'pad' }, text: { hooks: { maze: 'Which ball gets *out first?*' } } },
    { name: 'TNT Chain Reaction', desc: 'Numbered bricks, TNT chains, multiball', modeId: 'chain', settings: { tnt: 0.16, multi: 0.06 }, look: { palette: 'sunset' }, sound: { theme: 'marimba', pattern: 'climb', backing: 'build' } },
    { name: 'Paint Splat 4-Way', desc: 'Most floor painted when the timer ends', modeId: 'paint', settings: { colors: 4 }, look: { palette: 'candy' }, sound: { theme: 'steelpan', pattern: 'random', backing: 'full' } },
    { name: 'Army Clash: Red vs Blue', desc: 'Hundreds of units, x2 rings, base conversion', modeId: 'army', settings: { armies: 2 }, look: { palette: 'neon', bg: 'grid' }, sound: { theme: 'pluck', pattern: 'tension', backing: 'full' } },
    { name: 'Team Battle 3v3', desc: 'Colour squads of ability fighters, MVP payoff', modeId: 'teams', settings: { teams: 2, perTeam: 3 }, look: { palette: 'ocean' }, sound: { theme: 'synth', pattern: 'chords', backing: 'build' } },
    { name: 'Level Up Duel', desc: 'XP orbs evolve their abilities up to Lv6', modeId: 'levelup', settings: { fighters: 2 }, look: { palette: 'aurora', bg: 'bokeh' }, sound: { theme: 'bells', pattern: 'climb', backing: 'build' } },
    { name: 'Sword vs Spikes', desc: 'The ability duel everyone argues about', modeId: 'battle', settings: { fighters: 2, ab1: 'sword', ab2: 'spikes' }, look: { palette: 'neon' }, sound: { theme: 'synth', pattern: 'tension', backing: 'build' } },
    { name: 'Multiply to 500', desc: 'Every bounce = +1 ball', modeId: 'multiply', settings: {}, look: { palette: 'sunset' }, sound: { theme: 'glass', pattern: 'chords', backing: 'pad' } },
    { name: 'Grow to Fill the Circle', desc: 'Oddly satisfying growth to the brim', modeId: 'growth', settings: {}, look: { palette: 'mono' }, sound: { theme: 'piano', pattern: 'melody', melody: 'canon', backing: 'pad' } },
    { name: 'Outrun THE WALL', desc: 'Survival course with a chasing wall', modeId: 'course', settings: {}, look: { palette: 'lava' }, sound: { theme: 'chip', pattern: 'tension', backing: 'full' } },
    { name: 'Colour War', desc: 'Teams flip tiles — who takes over?', modeId: 'colorwar', settings: {}, look: { palette: 'candy' }, sound: { theme: 'marimba', pattern: 'random', backing: 'build' } },
    { name: 'String Weaver', desc: 'Every bounce ties a new string', modeId: 'strings', settings: {}, look: { palette: 'vapor' }, sound: { theme: 'nylon', pattern: 'pingpong', backing: 'pad' } },
    { name: 'Elimination Race', desc: 'Last place each lap is out', modeId: 'race', settings: {}, look: { palette: 'ocean' }, sound: { theme: 'pluck', pattern: 'climb', backing: 'build' } },
  ];

  // --- share codes: 'SB2-' + base64url(JSON)
  function encode(snap) {
    const json = JSON.stringify(snap);
    const bytes = new TextEncoder().encode(json);
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return 'SB2-' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(code) {
    code = String(code || '').trim();
    if (code.startsWith('{')) return validate(JSON.parse(code));
    const m = code.match(/SB2-([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('Not a SatisBall share code');
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return validate(JSON.parse(new TextDecoder().decode(bytes)));
  }
  function validate(s) {
    if (!s || typeof s !== 'object') throw new Error('Empty preset');
    if (s.presets && Array.isArray(s.presets)) return s; // a whole library file
    if (!s.modeId || !SB.modes.byId[s.modeId]) throw new Error('Unknown mode in preset: ' + (s.modeId || '?'));
    return s;
  }

  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };

  const user = {
    list: () => load(USER_KEY),
    add(p) { const l = load(USER_KEY).filter((x) => x.name !== p.name); l.unshift(p); save(USER_KEY, l.slice(0, 200)); },
    remove(name) { save(USER_KEY, load(USER_KEY).filter((x) => x.name !== name)); },
    rename(from, to) { const l = load(USER_KEY); const p = l.find((x) => x.name === from); if (p) { p.name = to; save(USER_KEY, l); } },
    replaceAll(l) { save(USER_KEY, l); },
  };
  const history = {
    list: () => load(HIST_KEY),
    push(entry) {
      const l = load(HIST_KEY).filter((x) => !(x.snap.modeId === entry.snap.modeId && x.snap.seed === entry.snap.seed));
      l.unshift(entry); save(HIST_KEY, l.slice(0, 40));
    },
    clear() { save(HIST_KEY, []); },
  };

  SB.library = { FEATURED, encode, decode, user, history };
})(window.SB);

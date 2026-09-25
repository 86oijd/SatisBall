// Physics invariants across modes & extreme settings. Usage: node tools/audit.cjs [seeds]
const { chromium } = require('playwright');
(async () => {
  const [n = '4'] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e)));
  await p.goto('file://' + process.cwd() + '/index.html?headless');
  await p.waitForFunction(() => window.SB && SB.test);
  const cases = [
    ['rings', {}], ['rings', { speed: 1600, gravity: 2500, spin: 4, intensity: 3, ballSize: 10, thickness: 3 }], ['rings', { balls: 4, gravity: 0 }],
    ['spiral', {}], ['spiral', { speed: 1400, maxSpeed: 3000, speedGain: 60, ballSize: 6, thickness: 4 }],
    ['battle', {}], ['battle', { fighters: 4, speed: 1100 }], ['battle', { gravity: 2000, speed: 900 }],
    ['growth', {}], ['growth', { shape: 'triangle', spin: 3, gravity: 3000, speed: 1600 }], ['growth', { shape: 'hexagon', balls: 3 }],
    ['multiply', {}], ['multiply', { collide: true, target: 800, shape: 'square', spin: 3 }], ['multiply', { rule: 'escape' }],
    ['race', {}], ['race', { balls: 12, gravity: 3500, maxSpeed: 3000 }],
    ['course', {}], ['course', { balls: 6, gravity: 3000, maxSpeed: 3000, length: 14 }],
    ['strings', {}], ['strings', { shape: 'triangle', spin: 3, speed: 1500, maxSpeed: 3000, speedUp: 5, ballSize: 8 }],
    ['colorwar', {}], ['colorwar', { teams: 4, perTeam: 4, speed: 1800, ballSize: 8, tile: 20 }],
    ['squares', {}], ['squares', { layout: 'circuit', squares: 6, speed: 900, size: 20 }], ['squares', { layout: 'tower' }], ['squares', { layout: 'stairs', squares: 2 }],
    ['lastin', {}], ['lastin', { balls: 48, gaps: 4, fill: 0.3, spin: 3, gravity: 2000 }], ['lastin', { balls: 30, speed: 1400, gravity: 0, spin: -3, reverse: true }],
    ['tournament', { fighters: 4 }], ['tournament', { fighters: 8, speed: 1100, shape: 'morph' }],
    ['teams', {}], ['teams', { teams: 4, perTeam: 5, speed: 1000, shape: 'morph' }],
    ['boss', {}], ['boss', { heroes: 6, aggression: 2, speed: 1000, bossHp: 3000 }],
    ['levelup', {}], ['levelup', { fighters: 4, hunt: 3, orbRate: 3, speed: 1000 }],
    ['chain', {}], ['chain', { cols: 14, rows: 18, maxHp: 6, tnt: 0.12, ballSize: 8, speed: 2000, maxBalls: 60, multi: 0.2, ballCollide: true }],
    ['maze', {}], ['maze', { balls: 4, rings: 9, ballSize: 12, wall: 5, spin: 2, gravity: 3000, maxSpeed: 3000, bounce: 1 }],
    ['paint', {}], ['paint', { colors: 6, perColor: 6, speed: 1400, brush: 60, shape: 'star' }],
    ['army', {}], ['army', { armies: 4, maxUnits: 1500, spawnRate: 20, burst: 5, unitSize: 4, speed: 600 }],
  ];
  let bad = 0;
  for (const [m, s] of cases) for (let i = 0; i < +n; i++) {
    const r = await p.evaluate(([m, s, seed]) => SB.test.audit(m, { seed, settings: s, maxSecs: 200 }), [m, s, 9000 + i * 17]);
    const v = Object.keys(r.violations).length;
    if (v) bad++;
    if (v || i === 0) console.log(m.padEnd(10), JSON.stringify(s).slice(0, 70).padEnd(72), r.secs + 's', v ? JSON.stringify(r.violations) : 'ok');
  }
  console.log(bad ? `${bad} runs with violations` : 'no violations');
  if (errs.length) console.log('ERRORS', errs.join('\n'));
  await b.close();
})();

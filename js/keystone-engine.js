// Keystone: an idle tower-defense game. Pure game logic (no DOM) so it can be
// simulated and balance-tested headlessly.

export const R = 320;          // arena radius (world units)
export const TOWER_R = 28;
export const WAVE_TIME = 20;   // seconds per wave
export const SPAWN_TIME = 14;  // enemies of a wave spawn during this window
export const BOSS_EVERY = 10;

// ---------- Enemy types ----------
export const TYPES = {
  block:   { name: 'Block',   hp: 1.0, dmg: 1.0, speed: 38, size: 15, coins: 1, sides: 4, rot: Math.PI / 4, color: '#5b8def', from: 1 },
  dart:    { name: 'Dart',    hp: 0.5, dmg: 0.6, speed: 78, size: 13, coins: 1, sides: 3, rot: 0,           color: '#f2c84b', from: 3 },
  brute:   { name: 'Brute',   hp: 4.0, dmg: 2.4, speed: 22, size: 22, coins: 3, sides: 5, rot: 0,           color: '#e0843a', from: 5 },
  spitter: { name: 'Spitter', hp: 1.3, dmg: 0.9, speed: 34, size: 15, coins: 2, sides: 4, rot: 0,           color: '#c95ad6', from: 7, ranged: true, stopAt: 195, fireEvery: 2.4 },
  boss:    { name: 'Warden',  hp: 18,  dmg: 3.5,  speed: 15, size: 38, coins: 30, sides: 8, rot: 0,          color: '#e05a5a', boss: true },
};
const WEIGHTS = { block: 5, dart: 3, brute: 1.6, spitter: 1.4 };

export const enemyHp = (w) => 6 * Math.pow(1.127, w - 1);
export const enemyDmg = (w) => 2.2 * Math.pow(1.085, w - 1);
export const enemyCoins = (w) => 1 + 0.14 * (w - 1);
export const waveCount = (w) => Math.min(42, Math.round(6 + 1.25 * w));

// ---------- Upgrades bought during a run (coins) ----------
// value(L, perm) -> stat value; cost = c0 * g^L
const g104 = (L) => Math.pow(1.04, L);
export const RUN_UPGRADES = [
  { id: 'dmg',    tab: 'attack',  name: 'Damage',       c0: 6,  g: 1.16, val: (L) => 5 * (1 + 0.3 * L) * g104(L), fmt: 'num' },
  { id: 'rate',   tab: 'attack',  name: 'Attack speed', c0: 9,  g: 1.21, max: 40, val: (L) => 1 + 0.08 * L, fmt: 'rate' },
  { id: 'range',  tab: 'attack',  name: 'Range',        c0: 14, g: 1.26, max: 20, val: (L) => 165 + 6 * L, fmt: 'int' },
  { id: 'crit',   tab: 'attack',  name: 'Crit chance',  c0: 18, g: 1.24, max: 30, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'critx',  tab: 'attack',  name: 'Crit damage',  c0: 22, g: 1.22, max: 35, val: (L) => 1.5 + 0.1 * L, fmt: 'mult' },
  { id: 'multi',  tab: 'attack',  name: 'Multishot',    c0: 45, g: 1.3,  max: 25, val: (L) => 0.03 * L, fmt: 'pct' },
  { id: 'hp',     tab: 'defense', name: 'Max health',   c0: 6,  g: 1.16, val: (L) => 60 * (1 + 0.3 * L) * g104(L), fmt: 'num' },
  { id: 'regen',  tab: 'defense', name: 'Regeneration', c0: 8,  g: 1.18, val: (L) => (0.5 + 0.6 * L) * g104(L), fmt: 'regen' },
  { id: 'armor',  tab: 'defense', name: 'Armor',        c0: 18, g: 1.23, max: 30, val: (L) => 0.015 * L, fmt: 'pct' },
  { id: 'thorns', tab: 'defense', name: 'Thorns',       c0: 22, g: 1.22, max: 25, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'coins',  tab: 'economy', name: 'Coin bonus',   c0: 25, g: 1.24, val: (L) => 0.1 * L, fmt: 'plus' },
  { id: 'wavec',  tab: 'economy', name: 'Wave bonus',   c0: 35, g: 1.28, val: (L) => 4 * L, fmt: 'wave' },
];
export const RUN_BY_ID = Object.fromEntries(RUN_UPGRADES.map((u) => [u.id, u]));

// ---------- Permanent upgrades (shards) ----------
export const PERM_UPGRADES = [
  { id: 'pdmg',    name: 'Sharpened core',   desc: '+12% damage',             c0: 8,  g: 1.32, val: (L) => 1 + 0.12 * L },
  { id: 'php',     name: 'Reinforced walls', desc: '+12% health and regen',   c0: 8,  g: 1.32, val: (L) => 1 + 0.12 * L },
  { id: 'prate',   name: 'Quick loader',     desc: '+3% attack speed',        c0: 12, g: 1.4,  max: 25, val: (L) => 1 + 0.03 * L },
  { id: 'pcoin',   name: 'Prospector',       desc: '+10% coins',              c0: 10, g: 1.35, val: (L) => 1 + 0.1 * L },
  { id: 'pstart',  name: 'War chest',        desc: '+15 starting coins',      c0: 6,  g: 1.3,  val: (L) => 15 * L * Math.pow(1.1, L) },
  { id: 'pdisc',   name: 'Bargaining',       desc: '−2% upgrade costs',       c0: 20, g: 1.45, max: 15, val: (L) => 1 - 0.02 * L },
  { id: 'pcrit',   name: 'Keen eye',         desc: '+1% crit chance',         c0: 15, g: 1.4,  max: 20, val: (L) => 0.01 * L },
  { id: 'pshard',  name: 'Shard lens',       desc: '+8% shards from runs',    c0: 25, g: 1.45, val: (L) => 1 + 0.08 * L },
  { id: 'poffl',   name: 'Night watch',      desc: '+25% offline shards',     c0: 15, g: 1.4,  max: 20, val: (L) => 1 + 0.25 * L },
];
export const PERM_BY_ID = Object.fromEntries(PERM_UPGRADES.map((u) => [u.id, u]));

// ---------- Abilities ----------
export const ABILITIES = [
  { id: 'pulse',     name: 'Pulse',     desc: 'Shockwave that blasts and knocks back nearby enemies', cost: 20,  cd: 25 },
  { id: 'freeze',    name: 'Freeze',    desc: 'Slows every enemy by 70% for 6 seconds',               cost: 45,  cd: 40 },
  { id: 'overdrive', name: 'Overdrive', desc: 'Doubles attack speed for 8 seconds',                   cost: 90,  cd: 50 },
  { id: 'repair',    name: 'Repair',    desc: 'Restores 40% of max health',                           cost: 150, cd: 60 },
];
export const AUTOCAST_COST = 120;

// ---------- Meta (saved between runs) ----------
export function newMeta() {
  return { shards: 0, perm: {}, abilities: {}, autocast: false, autoOn: true, bestWave: 0, runs: 0, lastSeen: Date.now() };
}
const lvl = (o, id) => (o && o[id]) || 0;
export const permVal = (meta, id) => PERM_BY_ID[id].val(lvl(meta.perm, id));

export function permCost(meta, id) {
  const u = PERM_BY_ID[id];
  const L = lvl(meta.perm, id);
  if (u.max != null && L >= u.max) return Infinity;
  return Math.ceil(u.c0 * Math.pow(u.g, L));
}

// ---------- Stats ----------
export function stats(run, meta) {
  const L = (id) => lvl(run.levels, id);
  const v = (id) => RUN_BY_ID[id].val(L(id));
  return {
    dmg: v('dmg') * permVal(meta, 'pdmg'),
    rate: v('rate') * permVal(meta, 'prate') * (run.fx.overdrive > 0 ? 2 : 1),
    range: v('range'),
    crit: Math.min(0.9, v('crit') + permVal(meta, 'pcrit')),
    critx: v('critx'),
    multi: v('multi'),
    maxHp: v('hp') * permVal(meta, 'php'),
    regen: v('regen') * permVal(meta, 'php'),
    armor: v('armor'),
    thorns: v('thorns'),
    coinMult: (1 + v('coins')) * permVal(meta, 'pcoin'),
    waveBonus: v('wavec'),
  };
}

export function runCost(run, meta, id, count = 1) {
  const u = RUN_BY_ID[id];
  const L0 = lvl(run.levels, id);
  const disc = permVal(meta, 'pdisc');
  let total = 0, n = 0;
  for (let k = 0; k < count; k++) {
    if (u.max != null && L0 + k >= u.max) break;
    total += Math.ceil(u.c0 * Math.pow(u.g, L0 + k) * disc);
    n++;
  }
  return { cost: total, n };
}
// how many levels can be afforded right now (for "Max")
export function affordable(run, meta, id) {
  const u = RUN_BY_ID[id];
  const disc = permVal(meta, 'pdisc');
  let L = lvl(run.levels, id), coins = run.coins, n = 0, total = 0;
  while ((u.max == null || L < u.max) && n < 500) {
    const c = Math.ceil(u.c0 * Math.pow(u.g, L) * disc);
    if (c > coins) break;
    coins -= c; total += c; L++; n++;
  }
  return { n, cost: total };
}
export function buy(run, meta, id, count) {
  const { n, cost } = count === 'max' ? affordable(run, meta, id) : runCost(run, meta, id, count);
  if (!n || cost > run.coins) return false;
  const before = stats(run, meta);
  run.coins -= cost;
  run.levels[id] = lvl(run.levels, id) + n;
  if (id === 'hp') {
    const after = stats(run, meta);
    run.hp += after.maxHp - before.maxHp; // new max health arrives filled
  }
  return true;
}

// ---------- Run ----------
export function newRun(meta) {
  const run = {
    wave: 1, waveT: 0, spawned: 0, toSpawn: waveCount(1),
    coins: Math.floor(permVal(meta, 'pstart')),
    levels: {}, hp: 0, aim: 0,
    enemies: [], shots: [], bolts: [], fx: { overdrive: 0, freeze: 0 }, rings: [],
    cds: {}, fireT: 0, time: 0,
    kills: 0, bossKills: 0, coinsEarned: 0, over: false, nextId: 1,
  };
  run.hp = stats(run, meta).maxHp;
  return run;
}

// Serialize/resume: enemies are not saved; the current wave restarts.
export function snapshot(run) {
  const { wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time } = run;
  return { wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time };
}
export function resume(snap, meta) {
  const run = newRun(meta);
  Object.assign(run, snap);
  run.toSpawn = waveCount(run.wave) + (run.wave % BOSS_EVERY === 0 ? 1 : 0);
  return run;
}

function pickType(w, rand) {
  const pool = Object.entries(WEIGHTS).filter(([t]) => TYPES[t].from <= w);
  let tot = pool.reduce((s, [, x]) => s + x, 0), r = rand() * tot;
  for (const [t, x] of pool) { if ((r -= x) <= 0) return t; }
  return 'block';
}

function spawn(run, type, rand) {
  const T = TYPES[type];
  const w = run.wave;
  const a = rand() * Math.PI * 2;
  const hp = enemyHp(w) * T.hp;
  run.enemies.push({
    id: run.nextId++, type, x: Math.cos(a) * (R + 18), y: Math.sin(a) * (R + 18),
    hp, maxHp: hp, dmg: enemyDmg(w) * T.dmg, speed: T.speed * (0.9 + rand() * 0.2),
    size: T.size, atkT: 0.4, spin: rand() * 6, push: 0,
  });
}

function hitTower(run, meta, s, dmg, events) {
  const taken = dmg * (1 - s.armor);
  run.hp -= taken;
  events.push({ t: 'hurt', v: taken });
  if (run.hp <= 0) { run.hp = 0; run.over = true; events.push({ t: 'over' }); }
}

function killEnemy(run, meta, s, e, events) {
  const T = TYPES[e.type];
  const c = enemyCoins(run.wave) * T.coins * s.coinMult;
  run.coins += c; run.coinsEarned += c; run.kills++;
  if (T.boss) run.bossKills++;
  events.push({ t: 'kill', x: e.x, y: e.y, type: e.type, coins: c });
}

export function useAbility(run, meta, id, events = []) {
  if (!meta.abilities[id] || (run.cds[id] || 0) > 0 || run.over) return false;
  const ab = ABILITIES.find((a) => a.id === id);
  const s = stats(run, meta);
  run.cds[id] = ab.cd;
  if (id === 'pulse') {
    const rad = 210;
    for (const e of run.enemies) {
      const d = Math.hypot(e.x, e.y);
      if (d <= rad) { e.hp -= s.dmg * 8; e.push = 70; }
    }
    run.rings.push({ r: 0, max: rad, t: 0, kind: 'pulse' });
    for (const e of run.enemies.filter((x) => x.hp <= 0)) killEnemy(run, meta, s, e, events);
    run.enemies = run.enemies.filter((e) => e.hp > 0);
  } else if (id === 'freeze') {
    run.fx.freeze = 6;
    run.rings.push({ r: 0, max: R, t: 0, kind: 'freeze' });
  } else if (id === 'overdrive') {
    run.fx.overdrive = 8;
  } else if (id === 'repair') {
    run.hp = Math.min(s.maxHp, run.hp + s.maxHp * 0.4);
    run.rings.push({ r: 0, max: 60, t: 0, kind: 'repair' });
  }
  events.push({ t: 'ability', id });
  return true;
}

function autocast(run, meta, events) {
  if (!meta.autocast || !meta.autoOn) return;
  const s = stats(run, meta);
  const near = run.enemies.filter((e) => Math.hypot(e.x, e.y) < 160).length;
  if (meta.abilities.pulse && near >= 4) useAbility(run, meta, 'pulse', events);
  if (meta.abilities.freeze && run.enemies.length >= 10) useAbility(run, meta, 'freeze', events);
  if (meta.abilities.overdrive && run.enemies.some((e) => Math.hypot(e.x, e.y) < s.range)) useAbility(run, meta, 'overdrive', events);
  if (meta.abilities.repair && run.hp < s.maxHp * 0.45) useAbility(run, meta, 'repair', events);
}

// Advance the simulation by dt seconds. Returns events for the UI.
export function step(run, meta, dt, rand = Math.random) {
  const events = [];
  if (run.over) return events;
  run.time += dt;
  const s = stats(run, meta);

  // timers
  for (const k in run.cds) if (run.cds[k] > 0) run.cds[k] = Math.max(0, run.cds[k] - dt);
  run.fx.overdrive = Math.max(0, run.fx.overdrive - dt);
  run.fx.freeze = Math.max(0, run.fx.freeze - dt);
  for (const r of run.rings) { r.t += dt; r.r = r.max * Math.min(1, r.t / 0.45); }
  run.rings = run.rings.filter((r) => r.t < 0.6);

  // regen
  run.hp = Math.min(s.maxHp, run.hp + s.regen * dt);

  // waves & spawning
  run.waveT += dt;
  const isBossWave = run.wave % BOSS_EVERY === 0;
  const total = waveCount(run.wave);
  while (run.spawned < total && run.waveT >= (run.spawned / total) * SPAWN_TIME) {
    spawn(run, pickType(run.wave, rand), rand);
    run.spawned++;
  }
  if (isBossWave && run.spawned === total && !run.bossSpawned && run.waveT >= SPAWN_TIME * 0.5) {
    spawn(run, 'boss', rand);
    run.bossSpawned = true;
    events.push({ t: 'boss' });
  }
  if (run.waveT >= WAVE_TIME) {
    const bonus = s.waveBonus * run.wave;
    if (bonus) { run.coins += bonus; run.coinsEarned += bonus; }
    run.wave++; run.waveT = 0; run.spawned = 0; run.bossSpawned = false;
    if (run.wave > (meta.bestWave || 0)) meta.bestWave = run.wave;
    events.push({ t: 'wave', wave: run.wave, bonus });
  }

  // enemies move / attack
  const slow = run.fx.freeze > 0 ? 0.3 : 1;
  for (const e of run.enemies) {
    const T = TYPES[e.type];
    const d = Math.hypot(e.x, e.y) || 1;
    e.spin += dt * (T.boss ? 0.4 : 1.2);
    if (e.push > 0) {
      const p = Math.min(e.push, 260 * dt);
      e.x += (e.x / d) * p; e.y += (e.y / d) * p; e.push -= p;
      continue;
    }
    const stop = T.ranged ? T.stopAt : TOWER_R + e.size;
    if (d > stop) {
      const mv = Math.min(d - stop, e.speed * slow * dt);
      e.x -= (e.x / d) * mv; e.y -= (e.y / d) * mv;
    } else {
      e.atkT -= dt * slow;
      if (e.atkT <= 0) {
        if (T.ranged) {
          e.atkT = T.fireEvery;
          run.bolts.push({ x: e.x, y: e.y, dmg: e.dmg, speed: 150 });
        } else {
          e.atkT = 1;
          hitTower(run, meta, s, e.dmg, events);
          if (s.thorns > 0) {
            e.hp -= e.maxHp * s.thorns;
            if (e.hp <= 0) killEnemy(run, meta, s, e, events);
          }
        }
      }
    }
  }
  run.enemies = run.enemies.filter((e) => e.hp > 0);

  // enemy bolts
  for (const b of run.bolts) {
    const d = Math.hypot(b.x, b.y);
    const mv = b.speed * dt;
    if (d <= TOWER_R + mv) { b.hit = true; hitTower(run, meta, s, b.dmg, events); }
    else { b.x -= (b.x / d) * mv; b.y -= (b.y / d) * mv; }
  }
  run.bolts = run.bolts.filter((b) => !b.hit);
  if (run.over) return events;

  // tower fires
  run.fireT -= dt;
  if (run.fireT <= 0) {
    const inRange = run.enemies
      .map((e) => [e, Math.hypot(e.x, e.y)])
      .filter(([, d]) => d <= s.range)
      .sort((a, b) => a[1] - b[1]);
    if (inRange.length) {
      run.fireT = 1 / s.rate;
      const fire = (e) => {
        const crit = rand() < s.crit;
        run.shots.push({ x: 0, y: 0, target: e.id, tx: e.x, ty: e.y, dmg: s.dmg * (crit ? s.critx : 1), crit, speed: 560 });
      };
      fire(inRange[0][0]);
      run.aim = Math.atan2(inRange[0][0].y, inRange[0][0].x);
      if (inRange.length > 1 && rand() < s.multi) fire(inRange[1][0]);
    } else run.fireT = 0;
  }

  // shots (homing)
  const byId = new Map(run.enemies.map((e) => [e.id, e]));
  for (const p of run.shots) {
    const e = byId.get(p.target);
    if (e) { p.tx = e.x; p.ty = e.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const mv = p.speed * dt;
    if (d <= mv + (e ? e.size * 0.6 : 2)) {
      p.done = true;
      if (e && e.hp > 0) {
        e.hp -= p.dmg;
        events.push({ t: 'hit', x: e.x, y: e.y, dmg: p.dmg, crit: p.crit });
        if (e.hp <= 0) killEnemy(run, meta, s, e, events);
      }
    } else { p.x += (dx / d) * mv; p.y += (dy / d) * mv; }
  }
  run.shots = run.shots.filter((p) => !p.done);
  run.enemies = run.enemies.filter((e) => e.hp > 0);

  autocast(run, meta, events);
  return events;
}

// ---------- Rewards ----------
export function shardsForRun(run, meta) {
  const w = run.wave;
  const base = Math.floor(w * (1 + w / 25)) + run.bossKills * 6;
  return Math.max(1, Math.round(base * permVal(meta, 'pshard')));
}
export const OFFLINE_CAP_H = 12;
export function offlineShards(meta, seconds) {
  const hours = Math.min(OFFLINE_CAP_H, seconds / 3600);
  const perHour = 0.12 * (meta.bestWave || 0) * permVal(meta, 'poffl');
  return Math.floor(perHour * hours);
}

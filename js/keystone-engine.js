// Keystone: an idle tower-defense game. Pure game logic (no DOM) so it can be
// simulated and balance-tested headlessly.
//
// Long-term structure
//   Runs     – waves every 20 s; coins buy in-run upgrades (reset each run).
//   Tiers    – harder versions of the field. Reaching wave TIER_UNLOCK_WAVE in a
//              tier unlocks the next. Each tier multiplies enemy strength and rewards
//              and introduces new enemies, upgrades and abilities.
//   Shards   – earned from runs and while away; spent in the Workshop (permanent,
//              multiplicative upgrades) and on Research.
//   Research – upgrades that take real time (minutes → days); 1–3 lab slots.
//   Relics   – rare Warden drops that give small permanent bonuses; duplicates level them.

export const VERSION = 2;
export const R = 320;          // arena radius (world units)
export const TOWER_R = 28;
export const WAVE_TIME = 20;   // seconds per wave
export const SPAWN_TIME = 14;  // enemies of a wave spawn during this window
export const BOSS_EVERY = 10;
export const TIER_UNLOCK_WAVE = 40;

// ---------- Tier scaling ----------
export const TIER = {
  hp: 6,          // enemy health ×6 per tier
  dmg: 3.5,      // enemy damage ×3.5 per tier
  coins: 2.2,    // coins ×2.2 per tier
  shards: 1.25,  // shards ×1.25 per tier
  growth: 0.008, // enemies also grow faster per wave in higher tiers
};
const tierPow = (k, t) => Math.pow(TIER[k], t - 1);

// ---------- Enemy types ----------
// tier/from: first tier and first wave (within a run) where the type appears
export const TYPES = {
  block:    { name: 'Block',    hp: 1.0, dmg: 1.0, speed: 38, size: 15, coins: 1, shape: 4, rot: Math.PI / 4, color: '#5b8def', tier: 1, from: 1 },
  dart:     { name: 'Dart',     hp: 0.5, dmg: 0.6, speed: 78, size: 13, coins: 1, shape: 3, rot: 0, color: '#f2c84b', tier: 1, from: 3 },
  brute:    { name: 'Brute',    hp: 4.0, dmg: 2.4, speed: 22, size: 22, coins: 3, shape: 5, rot: 0, color: '#e0843a', tier: 1, from: 5 },
  spitter:  { name: 'Spitter',  hp: 1.3, dmg: 0.9, speed: 34, size: 15, coins: 2, shape: 4, rot: 0, color: '#c95ad6', tier: 1, from: 7, ranged: true, stopAt: 195, fireEvery: 2.4 },
  shield:   { name: 'Bulwark',  hp: 2.2, dmg: 1.2, speed: 30, size: 17, coins: 2, shape: 6, rot: 0, color: '#8fa3b8', tier: 2, from: 4, shielded: true },
  splitter: { name: 'Splitter', hp: 1.6, dmg: 1.0, speed: 36, size: 16, coins: 2, shape: 0, rot: 0, color: '#5fb86a', tier: 3, from: 6, splits: true },
  mini:     { name: 'Shard',    hp: 0.35, dmg: 0.5, speed: 64, size: 9, coins: 0.5, shape: 0, rot: 0, color: '#8fd498', tier: 99, from: 999 },
  healer:   { name: 'Mender',   hp: 1.4, dmg: 0, speed: 30, size: 15, coins: 3, shape: 'cross', rot: 0, color: '#ef8fb3', tier: 4, from: 8, healer: true, stopAt: 235 },
  phantom:  { name: 'Phantom',  hp: 0.8, dmg: 1.1, speed: 30, size: 14, coins: 2, shape: 'star', rot: 0, color: '#a993d8', tier: 5, from: 10, blinks: true },
  boss:     { name: 'Warden',   hp: 18,  dmg: 3.5, speed: 15, size: 38, coins: 30, shape: 8, rot: 0, color: '#e05a5a', tier: 1, boss: true },
};
const WEIGHTS = { block: 5, dart: 3, brute: 1.6, spitter: 1.4, shield: 1.6, splitter: 1.4, healer: 0.7, phantom: 1.2 };
export const eliteChance = (tier) => (tier >= 6 ? Math.min(0.25, 0.03 * (tier - 5)) : 0);

// A tier's extra strength ramps in over the first TIER_RAMP waves of a run,
// so every run starts survivable and the tier bites in the later waves.
export const TIER_RAMP = 15;
const ramp = (w) => Math.min(1, (w - 1) / TIER_RAMP);
export const enemyHp = (w, t = 1) => 6 * Math.pow(1.127 + TIER.growth * (t - 1), w - 1) * Math.pow(TIER.hp, (t - 1) * ramp(w));
export const enemyDmg = (w, t = 1) => 2.2 * Math.pow(1.085, w - 1) * Math.pow(TIER.dmg, (t - 1) * ramp(w));
export const enemyCoins = (w, t = 1) => (1 + 0.14 * (w - 1)) * tierPow('coins', t);
export const waveCount = (w) => Math.min(42, Math.round(6 + 1.25 * w));

// ---------- Upgrades bought during a run (coins) ----------
const g104 = (L) => Math.pow(1.04, L);
export const RUN_UPGRADES = [
  { id: 'dmg',    tab: 'attack',  name: 'Damage',       c0: 6,  g: 1.16, val: (L) => 5 * (1 + 0.3 * L) * g104(L), fmt: 'num' },
  { id: 'rate',   tab: 'attack',  name: 'Attack speed', c0: 9,  g: 1.21, max: 40, val: (L) => 1 + 0.08 * L, fmt: 'rate' },
  { id: 'range',  tab: 'attack',  name: 'Range',        c0: 14, g: 1.26, max: 20, val: (L) => 165 + 6 * L, fmt: 'int' },
  { id: 'crit',   tab: 'attack',  name: 'Crit chance',  c0: 18, g: 1.24, max: 30, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'critx',  tab: 'attack',  name: 'Crit damage',  c0: 22, g: 1.22, max: 35, val: (L) => 1.5 + 0.1 * L, fmt: 'mult' },
  { id: 'multi',  tab: 'attack',  name: 'Multishot',    c0: 45, g: 1.3,  max: 25, val: (L) => 0.03 * L, fmt: 'pct' },
  { id: 'bounce', tab: 'attack',  name: 'Ricochet',     c0: 60, g: 1.6,  max: 4, tier: 2, val: (L) => L, fmt: 'bounce' },
  { id: 'exec',   tab: 'attack',  name: 'Execute',      c0: 80, g: 1.45, max: 10, tier: 4, val: (L) => 0.01 * L, fmt: 'pct' },
  { id: 'hp',     tab: 'defense', name: 'Max health',   c0: 6,  g: 1.16, val: (L) => 60 * (1 + 0.3 * L) * g104(L), fmt: 'num' },
  { id: 'regen',  tab: 'defense', name: 'Regeneration', c0: 8,  g: 1.18, val: (L) => (0.5 + 0.6 * L) * g104(L), fmt: 'regen' },
  { id: 'armor',  tab: 'defense', name: 'Armor',        c0: 18, g: 1.23, max: 30, val: (L) => 0.015 * L, fmt: 'pct' },
  { id: 'thorns', tab: 'defense', name: 'Thorns',       c0: 22, g: 1.22, max: 25, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'salvage', tab: 'defense', name: 'Salvage',     c0: 70, g: 1.5,  max: 10, tier: 6, val: (L) => 0.003 * L, fmt: 'pctx' },
  { id: 'coins',  tab: 'economy', name: 'Coin bonus',   c0: 25, g: 1.24, val: (L) => 0.1 * L, fmt: 'plus' },
  { id: 'wavec',  tab: 'economy', name: 'Wave bonus',   c0: 35, g: 1.28, val: (L) => 4 * L, fmt: 'wave' },
];
export const RUN_BY_ID = Object.fromEntries(RUN_UPGRADES.map((u) => [u.id, u]));
export const runUpgradesFor = (tier) => RUN_UPGRADES.filter((u) => (u.tier || 1) <= tier);

// ---------- Workshop: permanent upgrades (shards) ----------
// Multiplicative so they keep mattering; costs grow a little faster than the benefit.
export const PERM_UPGRADES = [
  { id: 'pdmg',   name: 'Sharpened core',   desc: '×1.08 damage',             c0: 8,  g: 1.15, val: (L) => Math.pow(1.08, L) },
  { id: 'php',    name: 'Reinforced walls', desc: '×1.08 health and regen',   c0: 8,  g: 1.15, val: (L) => Math.pow(1.08, L) },
  { id: 'prate',  name: 'Quick loader',     desc: '+2% attack speed',         c0: 12, g: 1.22, max: 50, val: (L) => 1 + 0.02 * L },
  { id: 'pcoin',  name: 'Prospector',       desc: '×1.06 coins',              c0: 10, g: 1.16, val: (L) => Math.pow(1.06, L) },
  { id: 'pstart', name: 'War chest',        desc: 'More starting coins',      c0: 6,  g: 1.2,  val: (L) => 20 * L * Math.pow(1.12, L) },
  { id: 'pdisc',  name: 'Bargaining',       desc: '−2% upgrade costs',        c0: 20, g: 1.35, max: 15, val: (L) => 1 - 0.02 * L },
  { id: 'pcrit',  name: 'Keen eye',         desc: '+1% crit chance',          c0: 15, g: 1.3,  max: 20, val: (L) => 0.01 * L },
  { id: 'pshard', name: 'Shard lens',       desc: '×1.05 shards',             c0: 25, g: 1.2,  val: (L) => Math.pow(1.05, L) },
  { id: 'poffl',  name: 'Night watch',      desc: '+25% offline shards',      c0: 15, g: 1.3,  max: 20, val: (L) => 1 + 0.25 * L },
];
export const PERM_BY_ID = Object.fromEntries(PERM_UPGRADES.map((u) => [u.id, u]));

// ---------- Research (shards + real time) ----------
// time = t0 * tg^L seconds (capped at 7 days); cost = c0 * g^L shards
export const RESEARCH = [
  { id: 'rdmg',   name: 'Ballistics',     desc: '×1.12 damage',              c0: 25,  g: 1.28, t0: 600,  tg: 1.42, val: (L) => Math.pow(1.12, L) },
  { id: 'rhp',    name: 'Masonry',        desc: '×1.12 health and regen',    c0: 25,  g: 1.28, t0: 600,  tg: 1.42, val: (L) => Math.pow(1.12, L) },
  { id: 'rcoin',  name: 'Minting',        desc: '×1.1 coins',                c0: 30,  g: 1.28, t0: 900,  tg: 1.42, val: (L) => Math.pow(1.1, L) },
  { id: 'rshard', name: 'Crystallurgy',   desc: '×1.08 shards',              c0: 40,  g: 1.3,  t0: 1200, tg: 1.43, val: (L) => Math.pow(1.08, L) },
  { id: 'rspeed', name: 'Lab efficiency', desc: '+6% research speed',        c0: 60,  g: 1.4,  t0: 1800, tg: 1.4, max: 25, val: (L) => 1 + 0.06 * L },
  { id: 'roffl',  name: 'Long watch',     desc: '+2 h offline limit',        c0: 50,  g: 1.45, t0: 3600, tg: 1.45, max: 12, val: (L) => 2 * L },
  { id: 'rcd',    name: 'Capacitors',     desc: '−3% ability cooldowns',     c0: 80,  g: 1.4,  t0: 2400, tg: 1.4, max: 15, tier: 2, val: (L) => 1 - 0.03 * L },
  { id: 'rboss',  name: 'Siegecraft',     desc: '×1.15 damage to Wardens',   c0: 100, g: 1.35, t0: 3600, tg: 1.35, tier: 3, val: (L) => Math.pow(1.15, L) },
  { id: 'rrelic', name: 'Archaeology',    desc: '+10% relic drop chance',    c0: 150, g: 1.4,  t0: 5400, tg: 1.4, max: 20, tier: 4, val: (L) => 1 + 0.1 * L },
];
export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((u) => [u.id, u]));
export const MAX_RESEARCH_SECONDS = 7 * 86400;
export const researchSlots = (meta) => 1 + ((meta.maxTier || 1) >= 3 ? 1 : 0) + ((meta.maxTier || 1) >= 6 ? 1 : 0);

// ---------- Relics (Warden drops) ----------
export const RELICS = [
  { id: 'ember',   name: 'Ember Prism',   rarity: 'common', tier: 1, desc: '+6% damage',            stat: 'dmg',    per: 0.06 },
  { id: 'stone',   name: 'Stone Seal',    rarity: 'common', tier: 1, desc: '+6% health and regen',  stat: 'hp',     per: 0.06 },
  { id: 'cog',     name: 'Gilded Cog',    rarity: 'common', tier: 1, desc: '+6% coins',             stat: 'coin',   per: 0.06 },
  { id: 'moon',    name: 'Moon Shard',    rarity: 'rare',   tier: 1, desc: '+5% shards',            stat: 'shard',  per: 0.05 },
  { id: 'gear',    name: 'Swift Gear',    rarity: 'rare',   tier: 2, desc: '+2% attack speed',      stat: 'rate',   per: 0.02 },
  { id: 'lens',    name: 'Hawk Lens',     rarity: 'rare',   tier: 2, desc: '+1% crit chance',       stat: 'crit',   per: 0.01, add: true },
  { id: 'bark',    name: 'Iron Bark',     rarity: 'rare',   tier: 3, desc: '+1% armor',             stat: 'armor',  per: 0.01, add: true },
  { id: 'bell',    name: 'Echo Bell',     rarity: 'epic',   tier: 3, desc: '−3% ability cooldowns', stat: 'cd',     per: 0.03, inv: true },
  { id: 'map',     name: 'Star Map',      rarity: 'epic',   tier: 4, desc: '+4% research speed',    stat: 'rspeed', per: 0.04 },
  { id: 'lantern', name: 'Night Lantern', rarity: 'rare',   tier: 4, desc: '+8% offline shards',    stat: 'offl',   per: 0.08 },
  { id: 'sigil',   name: 'Warden Sigil',  rarity: 'epic',   tier: 5, desc: '+8% damage to Wardens', stat: 'boss',   per: 0.08 },
  { id: 'clover',  name: 'Four-leaf',     rarity: 'epic',   tier: 6, desc: '+6% relic drop chance', stat: 'relic',  per: 0.06 },
];
export const RELIC_MAX = 20;
// meta.relics stores copies found; each level needs more copies than the last
// (1, 1, 2, 2, 3, 3, ...): a maxed relic takes 110 copies.
export const relicCopiesFor = (L) => { let n = 0; for (let k = 1; k <= L; k++) n += Math.ceil(k / 2); return n; };
export function relicLevel(copies) { let L = 0; while (L < RELIC_MAX && relicCopiesFor(L + 1) <= copies) L++; return L; }
export const relicLv = (meta, id) => relicLevel((meta.relics || {})[id] || 0);
const RARITY_W = { common: 10, rare: 4, epic: 1.2 };
export const relicDropChance = (meta, tier) => Math.min(0.9, (0.07 + 0.006 * (tier - 1)) * mult(meta, 'relic'));

function relicBonus(meta, stat) {
  let add = 0;
  for (const r of RELICS) if (r.stat === stat) add += r.per * relicLv(meta, r.id);
  return add;
}

// ---------- Abilities ----------
export const ABILITIES = [
  { id: 'pulse',     name: 'Pulse',     desc: 'Shockwave that blasts and knocks back nearby enemies', cost: 20,   cd: 25, tier: 1 },
  { id: 'freeze',    name: 'Freeze',    desc: 'Slows every enemy by 70% for 6 seconds',               cost: 45,   cd: 40, tier: 1 },
  { id: 'overdrive', name: 'Overdrive', desc: 'Doubles attack speed for 8 seconds',                   cost: 90,   cd: 50, tier: 1 },
  { id: 'repair',    name: 'Repair',    desc: 'Restores 40% of max health',                           cost: 150,  cd: 60, tier: 1 },
  { id: 'orbit',     name: 'Orbit',     desc: 'Blades circle the keep for 10 s, shredding anything close', cost: 1500, cd: 35, tier: 3 },
  { id: 'chain',     name: 'Chain',     desc: 'Lightning arcs through the 6 nearest enemies',          cost: 12000, cd: 20, tier: 5 },
];
export const AUTOCAST_COST = 120;

// ---------- Meta (saved between runs) ----------
export function newMeta() {
  return {
    v: VERSION, shards: 0, perm: {}, research: {}, lab: [], relics: {},
    abilities: {}, autocast: false, autoOn: true,
    best: {}, maxTier: 1, tier: 1, bestWave: 0, runs: 0, lastSeen: Date.now(),
  };
}

// Convert a version-1 save: refund shards spent in the old workshop, keep abilities.
const OLD_PERM = { pdmg: [8, 1.32], php: [8, 1.32], prate: [12, 1.4], pcoin: [10, 1.35], pstart: [6, 1.3], pdisc: [20, 1.45], pcrit: [15, 1.4], pshard: [25, 1.45], poffl: [15, 1.4] };
export function migrateMeta(m) {
  const base = newMeta();
  if (!m || !Object.keys(m).length) return base;
  if (m.v === VERSION) return { ...base, ...m };
  let refund = 0;
  for (const [id, L] of Object.entries(m.perm || {})) {
    const o = OLD_PERM[id];
    if (o) for (let k = 0; k < L; k++) refund += Math.ceil(o[0] * Math.pow(o[1], k));
  }
  return {
    ...base,
    shards: (m.shards || 0) + refund,
    abilities: m.abilities || {}, autocast: !!m.autocast, autoOn: m.autoOn !== false,
    best: m.bestWave ? { 1: m.bestWave } : {}, bestWave: m.bestWave || 0,
    runs: m.runs || 0, lastSeen: m.lastSeen || Date.now(), migratedRefund: refund,
  };
}

const lvl = (o, id) => (o && o[id]) || 0;
export const permVal = (meta, id) => PERM_BY_ID[id].val(lvl(meta.perm, id));
export const researchVal = (meta, id) => RESEARCH_BY_ID[id].val(lvl(meta.research, id));

// Combined permanent multipliers from workshop, research and relics.
export function mult(meta, key) {
  switch (key) {
    case 'dmg': return permVal(meta, 'pdmg') * researchVal(meta, 'rdmg') * (1 + relicBonus(meta, 'dmg'));
    case 'hp': return permVal(meta, 'php') * researchVal(meta, 'rhp') * (1 + relicBonus(meta, 'hp'));
    case 'rate': return permVal(meta, 'prate') * (1 + relicBonus(meta, 'rate'));
    case 'coin': return permVal(meta, 'pcoin') * researchVal(meta, 'rcoin') * (1 + relicBonus(meta, 'coin'));
    case 'shard': return permVal(meta, 'pshard') * researchVal(meta, 'rshard') * (1 + relicBonus(meta, 'shard'));
    case 'crit': return permVal(meta, 'pcrit') + relicBonus(meta, 'crit');
    case 'armor': return relicBonus(meta, 'armor');
    case 'cd': return researchVal(meta, 'rcd') * Math.max(0.5, 1 - relicBonus(meta, 'cd'));
    case 'boss': return researchVal(meta, 'rboss') * (1 + relicBonus(meta, 'boss'));
    case 'rspeed': return researchVal(meta, 'rspeed') * (1 + relicBonus(meta, 'rspeed'));
    case 'offl': return permVal(meta, 'poffl') * (1 + relicBonus(meta, 'offl'));
    case 'relic': return researchVal(meta, 'rrelic') * (1 + relicBonus(meta, 'relic'));
    default: return 1;
  }
}

export function permCost(meta, id) {
  const u = PERM_BY_ID[id];
  const L = lvl(meta.perm, id);
  if (u.max != null && L >= u.max) return Infinity;
  return Math.ceil(u.c0 * Math.pow(u.g, L));
}

// ---------- Research API ----------
export function researchCost(meta, id) {
  const u = RESEARCH_BY_ID[id];
  const L = lvl(meta.research, id);
  if (u.max != null && L >= u.max) return Infinity;
  return Math.ceil(u.c0 * Math.pow(u.g, L));
}
export function researchTime(meta, id) {
  const u = RESEARCH_BY_ID[id];
  const L = lvl(meta.research, id);
  return Math.min(MAX_RESEARCH_SECONDS, u.t0 * Math.pow(u.tg, L)) / mult(meta, 'rspeed');
}
export const researchAvailable = (meta, id) => (RESEARCH_BY_ID[id].tier || 1) <= (meta.maxTier || 1);
export const isResearching = (meta, id) => (meta.lab || []).some((j) => j.id === id);
export function startResearch(meta, id, now = Date.now()) {
  const cost = researchCost(meta, id);
  if (!researchAvailable(meta, id) || isResearching(meta, id) || cost > meta.shards) return false;
  if ((meta.lab || []).length >= researchSlots(meta)) return false;
  meta.shards -= cost;
  meta.lab = [...(meta.lab || []), { id, start: now, end: now + researchTime(meta, id) * 1000 }];
  return true;
}
// Completes finished projects; returns their ids.
export function collectResearch(meta, now = Date.now()) {
  const done = [];
  meta.lab = (meta.lab || []).filter((j) => {
    if (j.end <= now) { meta.research[j.id] = lvl(meta.research, j.id) + 1; done.push(j.id); return false; }
    return true;
  });
  return done;
}

// ---------- Stats ----------
export function stats(run, meta) {
  const L = (id) => lvl(run.levels, id);
  const v = (id) => RUN_BY_ID[id].val(L(id));
  return {
    dmg: v('dmg') * mult(meta, 'dmg'),
    rate: v('rate') * mult(meta, 'rate') * (run.fx.overdrive > 0 ? 2 : 1),
    range: v('range'),
    crit: Math.min(0.9, v('crit') + mult(meta, 'crit')),
    critx: v('critx'),
    multi: v('multi'),
    bounce: v('bounce'),
    exec: v('exec'),
    maxHp: v('hp') * mult(meta, 'hp'),
    regen: v('regen') * mult(meta, 'hp'),
    armor: Math.min(0.75, v('armor') + mult(meta, 'armor')),
    thorns: v('thorns'),
    salvage: v('salvage'),
    coinMult: (1 + v('coins')) * mult(meta, 'coin'),
    waveBonus: v('wavec') * tierPow('coins', run.tier),
    boss: mult(meta, 'boss'),
  };
}

export function runCost(run, meta, id, count = 1) {
  const u = RUN_BY_ID[id];
  const L0 = lvl(run.levels, id);
  const disc = permVal(meta, 'pdisc') * tierPow('coins', run.tier);
  let total = 0, n = 0;
  for (let k = 0; k < count; k++) {
    if (u.max != null && L0 + k >= u.max) break;
    total += Math.ceil(u.c0 * Math.pow(u.g, L0 + k) * disc);
    n++;
  }
  return { cost: total, n };
}
export function affordable(run, meta, id) {
  const u = RUN_BY_ID[id];
  const disc = permVal(meta, 'pdisc') * tierPow('coins', run.tier);
  let L = lvl(run.levels, id), coins = run.coins, n = 0, total = 0;
  while ((u.max == null || L < u.max) && n < 500) {
    const c = Math.ceil(u.c0 * Math.pow(u.g, L) * disc);
    if (c > coins) break;
    coins -= c; total += c; L++; n++;
  }
  return { n, cost: total };
}
export function buy(run, meta, id, count) {
  if ((RUN_BY_ID[id].tier || 1) > run.tier) return false;
  const { n, cost } = count === 'max' ? affordable(run, meta, id) : runCost(run, meta, id, count);
  if (!n || cost > run.coins) return false;
  const before = stats(run, meta);
  run.coins -= cost;
  run.levels[id] = lvl(run.levels, id) + n;
  if (id === 'hp') run.hp += stats(run, meta).maxHp - before.maxHp;
  return true;
}

// ---------- Run ----------
export function newRun(meta, tier = meta.tier || 1) {
  tier = Math.max(1, Math.min(tier, meta.maxTier || 1));
  const run = {
    tier, wave: 1, waveT: 0, spawned: 0,
    coins: Math.floor(permVal(meta, 'pstart') * tierPow('coins', tier)),
    levels: {}, hp: 0, aim: 0,
    enemies: [], shots: [], bolts: [], fx: { overdrive: 0, freeze: 0, orbit: 0 }, rings: [], zaps: [],
    cds: {}, fireT: 0, time: 0, orbitT: 0,
    kills: 0, bossKills: 0, coinsEarned: 0, relicsFound: [], over: false, nextId: 1,
  };
  run.hp = stats(run, meta).maxHp;
  return run;
}

// Serialize/resume: enemies are not saved; the current wave restarts.
export function snapshot(run) {
  const { tier, wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time, relicsFound } = run;
  return { tier, wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time, relicsFound };
}
export function resume(snap, meta) {
  const run = newRun(meta, snap.tier || 1);
  Object.assign(run, snap, { tier: snap.tier || 1, relicsFound: snap.relicsFound || [] });
  return run;
}

function pickType(run, rand) {
  const pool = Object.entries(WEIGHTS).filter(([t]) => TYPES[t].tier <= run.tier && TYPES[t].from <= run.wave);
  let tot = pool.reduce((s, [, x]) => s + x, 0), r = rand() * tot;
  for (const [t, x] of pool) { if ((r -= x) <= 0) return t; }
  return 'block';
}

function spawn(run, type, rand, at) {
  const T = TYPES[type];
  const w = run.wave;
  const a = rand() * Math.PI * 2;
  const elite = !T.boss && type !== 'mini' && rand() < eliteChance(run.tier);
  const hp = enemyHp(w, run.tier) * T.hp * (elite ? 3 : 1);
  const e = {
    id: run.nextId++, type, elite,
    x: at ? at.x : Math.cos(a) * (R + 18), y: at ? at.y : Math.sin(a) * (R + 18),
    hp, maxHp: hp, dmg: enemyDmg(w, run.tier) * T.dmg * (elite ? 2 : 1), speed: T.speed * (0.9 + rand() * 0.2),
    size: T.size * (elite ? 1.2 : 1), atkT: 0.4, spin: rand() * 6, push: 0, blinkT: 3,
  };
  run.enemies.push(e);
  return e;
}

function hitTower(run, meta, s, dmg, events) {
  const taken = dmg * (1 - s.armor);
  run.hp -= taken;
  events.push({ t: 'hurt', v: taken });
  if (run.hp <= 0) { run.hp = 0; run.over = true; events.push({ t: 'over' }); }
}

function damage(run, meta, s, e, amount, events, rand) {
  const T = TYPES[e.type];
  if (T.boss) amount *= s.boss;
  if (T.shielded && e.hp > e.maxHp * 0.5) amount *= 0.5;
  e.hp -= amount;
  if (e.hp > 0 && !T.boss && s.exec > 0 && e.hp < e.maxHp * s.exec) e.hp = 0;
  if (e.hp <= 0 && !e.dead) killEnemy(run, meta, s, e, events, rand);
}

function killEnemy(run, meta, s, e, events, rand = Math.random) {
  e.dead = true;
  const T = TYPES[e.type];
  const c = enemyCoins(run.wave, run.tier) * T.coins * s.coinMult * (e.elite ? 4 : 1);
  run.coins += c; run.coinsEarned += c; run.kills++;
  if (s.salvage > 0) run.hp = Math.min(s.maxHp, run.hp + s.maxHp * s.salvage);
  events.push({ t: 'kill', x: e.x, y: e.y, type: e.type, coins: c, elite: e.elite });
  if (T.splits) {
    for (let k = 0; k < 2; k++) {
      const m = spawn(run, 'mini', rand, { x: e.x + (k ? 8 : -8), y: e.y + (k ? -6 : 6) });
      m.atkT = 0.6;
    }
  }
  if (T.boss) {
    run.bossKills++;
    if (rand() < relicDropChance(meta, run.tier)) {
      const id = rollRelic(meta, run.tier, rand);
      if (id) {
        meta.relics = meta.relics || {};
        meta.relics[id] = (meta.relics[id] || 0) + 1;
        run.relicsFound.push(id);
        events.push({ t: 'relic', id, x: e.x, y: e.y });
      }
    }
  }
}

export function rollRelic(meta, tier, rand = Math.random) {
  const pool = RELICS.filter((r) => r.tier <= tier && relicLv(meta, r.id) < RELIC_MAX);
  if (!pool.length) return null;
  let tot = pool.reduce((s, r) => s + RARITY_W[r.rarity], 0), x = rand() * tot;
  for (const r of pool) { if ((x -= RARITY_W[r.rarity]) <= 0) return r.id; }
  return pool[pool.length - 1].id;
}

export const abilityUnlocked = (meta, id) => ABILITIES.find((a) => a.id === id).tier <= (meta.maxTier || 1);
export function abilityCd(meta, ab) { return ab.cd * mult(meta, 'cd'); }

export function useAbility(run, meta, id, events = [], rand = Math.random) {
  if (!meta.abilities[id] || (run.cds[id] || 0) > 0 || run.over) return false;
  const ab = ABILITIES.find((a) => a.id === id);
  const s = stats(run, meta);
  run.cds[id] = abilityCd(meta, ab);
  if (id === 'pulse') {
    const rad = 210;
    for (const e of run.enemies) if (Math.hypot(e.x, e.y) <= rad) { e.push = 70; damage(run, meta, s, e, s.dmg * 8, events, rand); }
    run.rings.push({ r: 0, max: rad, t: 0, kind: 'pulse' });
  } else if (id === 'freeze') {
    run.fx.freeze = 6;
    run.rings.push({ r: 0, max: R, t: 0, kind: 'freeze' });
  } else if (id === 'overdrive') {
    run.fx.overdrive = 8;
  } else if (id === 'repair') {
    run.hp = Math.min(s.maxHp, run.hp + s.maxHp * 0.4);
    run.rings.push({ r: 0, max: 60, t: 0, kind: 'repair' });
  } else if (id === 'orbit') {
    run.fx.orbit = 10;
  } else if (id === 'chain') {
    const near = run.enemies.map((e) => [e, Math.hypot(e.x, e.y)]).sort((a, b) => a[1] - b[1]).slice(0, 6).map((x) => x[0]);
    let px = 0, py = 0;
    for (const e of near) {
      run.zaps.push({ x1: px, y1: py, x2: e.x, y2: e.y, t: 0 });
      px = e.x; py = e.y;
      damage(run, meta, s, e, s.dmg * 15, events, rand);
    }
  }
  run.enemies = run.enemies.filter((e) => e.hp > 0);
  events.push({ t: 'ability', id });
  return true;
}

function autocast(run, meta, events, rand) {
  if (!meta.autocast || !meta.autoOn) return;
  const s = stats(run, meta);
  const near = run.enemies.filter((e) => Math.hypot(e.x, e.y) < 160).length;
  const inRange = run.enemies.some((e) => Math.hypot(e.x, e.y) < s.range);
  if (meta.abilities.pulse && near >= 4) useAbility(run, meta, 'pulse', events, rand);
  if (meta.abilities.freeze && run.enemies.length >= 10) useAbility(run, meta, 'freeze', events, rand);
  if (meta.abilities.overdrive && inRange) useAbility(run, meta, 'overdrive', events, rand);
  if (meta.abilities.repair && run.hp < s.maxHp * 0.45) useAbility(run, meta, 'repair', events, rand);
  if (meta.abilities.orbit && near >= 3) useAbility(run, meta, 'orbit', events, rand);
  if (meta.abilities.chain && run.enemies.length >= 4 && inRange) useAbility(run, meta, 'chain', events, rand);
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
  run.fx.orbit = Math.max(0, run.fx.orbit - dt);
  for (const r of run.rings) { r.t += dt; r.r = r.max * Math.min(1, r.t / 0.45); }
  run.rings = run.rings.filter((r) => r.t < 0.6);
  for (const z of run.zaps) z.t += dt;
  run.zaps = run.zaps.filter((z) => z.t < 0.35);

  run.hp = Math.min(s.maxHp, run.hp + s.regen * dt);

  // waves & spawning
  run.waveT += dt;
  const isBossWave = run.wave % BOSS_EVERY === 0;
  const total = waveCount(run.wave);
  while (run.spawned < total && run.waveT >= (run.spawned / total) * SPAWN_TIME) {
    spawn(run, pickType(run, rand), rand);
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
    const best = meta.best || (meta.best = {});
    if (run.wave > (best[run.tier] || 0)) best[run.tier] = run.wave;
    if (run.wave > (meta.bestWave || 0)) meta.bestWave = run.wave;
    events.push({ t: 'wave', wave: run.wave, bonus });
    if (run.wave >= TIER_UNLOCK_WAVE && run.tier === (meta.maxTier || 1)) {
      meta.maxTier = run.tier + 1;
      events.push({ t: 'tier', tier: meta.maxTier });
    }
  }

  // enemies move / attack / special behaviour
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
    if (T.healer) {
      for (const o of run.enemies) if (o !== e && Math.hypot(o.x - e.x, o.y - e.y) < 95) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.04 * dt);
    }
    if (T.blinks && d > 120) {
      e.blinkT -= dt * slow;
      if (e.blinkT <= 0) { e.blinkT = 3; const j = Math.min(70, d - 110); e.x -= (e.x / d) * j; e.y -= (e.y / d) * j; events.push({ t: 'blink', x: e.x, y: e.y }); }
    }
    const stop = T.stopAt || TOWER_R + e.size;
    if (d > stop) {
      const mv = Math.min(d - stop, e.speed * slow * dt);
      e.x -= (e.x / d) * mv; e.y -= (e.y / d) * mv;
    } else if (!T.healer) {
      e.atkT -= dt * slow;
      if (e.atkT <= 0) {
        if (T.ranged) {
          e.atkT = T.fireEvery;
          run.bolts.push({ x: e.x, y: e.y, dmg: e.dmg, speed: 150 });
        } else {
          e.atkT = 1;
          hitTower(run, meta, s, e.dmg, events);
          if (s.thorns > 0) damage(run, meta, s, e, e.maxHp * s.thorns, events, rand);
        }
      }
    }
  }
  run.enemies = run.enemies.filter((e) => e.hp > 0);

  // orbit blades: damage enemies in a ring around the keep
  if (run.fx.orbit > 0) {
    run.orbitT -= dt;
    if (run.orbitT <= 0) {
      run.orbitT = 0.25;
      for (const e of run.enemies) {
        const d = Math.hypot(e.x, e.y);
        if (d > 50 && d < 115) damage(run, meta, s, e, s.dmg * 1.2, events, rand);
      }
      run.enemies = run.enemies.filter((e) => e.hp > 0);
    }
  }

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
        run.shots.push({ x: 0, y: 0, target: e.id, tx: e.x, ty: e.y, dmg: s.dmg * (crit ? s.critx : 1), crit, speed: 560, bounces: s.bounce });
      };
      fire(inRange[0][0]);
      run.aim = Math.atan2(inRange[0][0].y, inRange[0][0].x);
      if (inRange.length > 1 && rand() < s.multi) fire(inRange[1][0]);
    } else run.fireT = 0;
  }

  // shots (homing, may ricochet)
  const byId = new Map(run.enemies.map((e) => [e.id, e]));
  const newShots = [];
  for (const p of run.shots) {
    const e = byId.get(p.target);
    if (e) { p.tx = e.x; p.ty = e.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const mv = p.speed * dt;
    if (d <= mv + (e ? e.size * 0.6 : 2)) {
      p.done = true;
      if (e && e.hp > 0) {
        damage(run, meta, s, e, p.dmg, events, rand);
        events.push({ t: 'hit', id: e.id, x: e.x, y: e.y, dmg: p.dmg, crit: p.crit });
        if (p.bounces > 0) {
          let next = null, nd = 160;
          for (const o of run.enemies) {
            if (o === e || o.hp <= 0) continue;
            const od = Math.hypot(o.x - e.x, o.y - e.y);
            if (od < nd) { nd = od; next = o; }
          }
          if (next) newShots.push({ x: e.x, y: e.y, target: next.id, tx: next.x, ty: next.y, dmg: p.dmg * 0.6, crit: false, speed: 560, bounces: p.bounces - 1 });
        }
      }
    } else { p.x += (dx / d) * mv; p.y += (dy / d) * mv; }
  }
  run.shots = run.shots.filter((p) => !p.done).concat(newShots);
  run.enemies = run.enemies.filter((e) => e.hp > 0);

  autocast(run, meta, events, rand);
  return events;
}

// ---------- Rewards ----------
export function shardsForRun(run, meta) {
  const w = run.wave;
  const base = Math.floor(w * (1 + w / 25)) + run.bossKills * 6;
  return Math.max(1, Math.round(base * tierPow('shards', run.tier) * mult(meta, 'shard')));
}
export const OFFLINE_CAP_H = 12;
export const offlineCapHours = (meta) => OFFLINE_CAP_H + researchVal(meta, 'roffl');
// shards per hour while away: based on your best showing in your best tier
export function offlineRate(meta) {
  const t = meta.maxTier || 1;
  let best = 0;
  for (const [tier, w] of Object.entries(meta.best || {})) best = Math.max(best, w * tierPow('shards', +tier) * 1);
  if (!best && meta.bestWave) best = meta.bestWave;
  void t;
  return 0.12 * best * mult(meta, 'offl') * mult(meta, 'shard');
}
export function offlineShards(meta, seconds) {
  const hours = Math.min(offlineCapHours(meta), seconds / 3600);
  return Math.floor(offlineRate(meta) * hours);
}

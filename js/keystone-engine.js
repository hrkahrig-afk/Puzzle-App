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

export const VERSION = 3;
export const R = 320;          // arena radius (world units)
export const TOWER_R = 28;
export const WAVE_TIME = 20;   // seconds per wave
export const SPAWN_TIME = 14;  // enemies of a wave spawn during this window
export const BOSS_EVERY = 10;
export const TIER_UNLOCK_WAVE = 40;

// ---------- Tier scaling ----------
export const TIER = {
  hp: 8,          // enemy health ×8 per tier
  dmg: 4,        // enemy damage ×4 per tier
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
  { id: 'knock',  tab: 'attack',  name: 'Knockback',    c0: 30, g: 1.3,  max: 15, val: (L) => 0.04 * L, fmt: 'pct' },
  { id: 'super',  tab: 'attack',  name: 'Super crit',   c0: 90, g: 1.35, max: 25, tier: 3, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'hp',     tab: 'defense', name: 'Max health',   c0: 6,  g: 1.16, val: (L) => 60 * (1 + 0.3 * L) * g104(L), fmt: 'num' },
  { id: 'regen',  tab: 'defense', name: 'Regeneration', c0: 8,  g: 1.18, val: (L) => (0.5 + 0.6 * L) * g104(L), fmt: 'regen' },
  { id: 'armor',  tab: 'defense', name: 'Armor',        c0: 18, g: 1.23, max: 30, val: (L) => 0.015 * L, fmt: 'pct' },
  { id: 'thorns', tab: 'defense', name: 'Thorns',       c0: 22, g: 1.22, max: 25, val: (L) => 0.02 * L, fmt: 'pct' },
  { id: 'wall',   tab: 'defense', name: 'Wall',         c0: 25, g: 1.25, max: 20, val: (L) => 0.1 * L, fmt: 'wallpct' },
  { id: 'leech',  tab: 'defense', name: 'Lifesteal',    c0: 40, g: 1.3,  max: 20, tier: 2, val: (L) => 0.005 * L, fmt: 'pctx' },
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
  { id: 'plast',  name: 'Last stand',       desc: 'Once per run, survive a fatal blow (+10% health per level)', c0: 250, g: 2.4, max: 5, val: (L) => (L ? 0.2 + 0.1 * L : 0) },
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


// Clock used for missions (replaceable so the simulator can fast-forward days).
let clockFn = () => Date.now();
export function setClock(fn) { clockFn = fn; }
const nowMs = () => clockFn();

// ---------- Perks (chosen during a run) ----------
// Every PERK_EVERY waves the run offers 3 perks; pick one (or it's auto-picked).
export const PERK_EVERY = 5;
export const PERK_STACK = 3;
export const PERKS = [
  { id: 'k_dmg',    name: 'Sharpshooter', desc: '×1.15 damage',                tag: 'dmg' },
  { id: 'k_rate',   name: 'Rapid fire',   desc: '×1.1 attack speed',           tag: 'rate' },
  { id: 'k_hp',     name: 'Fortify',      desc: '×1.2 max health',             tag: 'hp' },
  { id: 'k_regen',  name: 'Mending',      desc: '×1.35 regeneration',          tag: 'regen' },
  { id: 'k_coin',   name: 'Windfall',     desc: '×1.2 coins',                  tag: 'coins' },
  { id: 'k_crit',   name: 'Precision',    desc: '+8% crit chance',             tag: 'crit' },
  { id: 'k_critx',  name: 'Brutality',    desc: '+0.6× crit damage',           tag: 'critx' },
  { id: 'k_range',  name: 'Long sight',   desc: '+20 range',                   tag: 'range' },
  { id: 'k_armor',  name: 'Plating',      desc: '+5% armor',                   tag: 'armor' },
  { id: 'k_thorns', name: 'Spikes',       desc: '+10% thorns',                 tag: 'thorns' },
  { id: 'k_leech',  name: 'Leech',        desc: '+2% lifesteal',               tag: 'leech' },
  { id: 'k_wall',   name: 'Rampart',      desc: '+25% of health as wall',      tag: 'wall' },
  { id: 'k_cd',     name: 'Overclock',    desc: '−15% ability cooldowns',      tag: 'cd' },
  { id: 'k_boss',   name: 'Giant-slayer', desc: '×1.5 damage to Wardens',      tag: 'dmg' },
  { id: 'k_glass',  name: 'Glass cannon', desc: '×1.4 damage, ×0.8 health',    tag: 'dmg' },
  { id: 'k_greed',  name: 'Greed',        desc: '×1.4 coins, −5% armor',       tag: 'coins' },
];
export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
const pk = (run, id) => (run.perks && run.perks[id]) || 0;

export function offerPerks(run, rand = Math.random) {
  const pool = PERKS.filter((p) => pk(run, p.id) < PERK_STACK);
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0].id);
  run.offer = out.length ? out : null;
}
export function choosePerk(run, id) {
  if (!run.offer || !run.offer.includes(id)) return false;
  run.perks = run.perks || {};
  run.perks[id] = pk(run, id) + 1;
  run.offer = null;
  run.stats && (run.stats.perks = [...(run.stats.perks || []), id]);
  return true;
}

// ---------- Gear (equipment loadout) ----------
export const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
export const RARITY_COLORS = ['#8a94a6', '#4f8fe0', '#b26ee0', '#e0a92e', '#e05a7a'];
export const MERGE = 3; // three of a rarity merge into one of the next
export const GEAR = [
  { id: 'g_barrel', name: 'Heavy Barrel',   stat: 'dmg',    v: [1.1, 1.2, 1.35, 1.55, 1.8],   desc: (x) => `×${x} damage, ×0.9 attack speed` },
  { id: 'g_clock',  name: 'Clockwork',      stat: 'rate',   v: [1.05, 1.1, 1.16, 1.24, 1.35], desc: (x) => `×${x} attack speed` },
  { id: 'g_scope',  name: 'Scope',          stat: 'range',  v: [10, 20, 30, 45, 60],         desc: (x) => `+${x} range, +${Math.round(x / 10)}% crit` },
  { id: 'g_plate',  name: 'Bastion Plate',  stat: 'hp',     v: [1.12, 1.25, 1.45, 1.7, 2],    desc: (x) => `×${x} max health` },
  { id: 'g_heart',  name: 'Living Heart',   stat: 'regen',  v: [1.2, 1.4, 1.7, 2.1, 2.6],      desc: (x) => `×${x} regeneration` },
  { id: 'g_purse',  name: 'Bottomless Purse', stat: 'coin', v: [1.1, 1.2, 1.35, 1.55, 1.8],  desc: (x) => `×${x} coins` },
  { id: 'g_prism',  name: 'Prism',          stat: 'critx',  v: [0.2, 0.4, 0.7, 1, 1.5],      desc: (x) => `+${x}× crit damage` },
  { id: 'g_fang',   name: 'Fang',           stat: 'leech',  v: [0.01, 0.02, 0.03, 0.045, 0.06], desc: (x) => `+${(x * 100).toFixed(1).replace('.0', '')}% lifesteal` },
  { id: 'g_stone',  name: 'Rampart Stone',  stat: 'wall',   v: [0.1, 0.2, 0.35, 0.5, 0.75],  desc: (x) => `+${Math.round(x * 100)}% of health as wall` },
  { id: 'g_glass',  name: 'Hourglass',      stat: 'cd',     v: [0.92, 0.85, 0.78, 0.7, 0.6], desc: (x) => `−${Math.round((1 - x) * 100)}% ability cooldowns` },
  { id: 'g_crown',  name: 'Warden Crown',   stat: 'boss',   v: [1.15, 1.3, 1.5, 1.8, 2.2],    desc: (x) => `×${x} damage to Wardens` },
  { id: 'g_coin',   name: 'Lucky Coin',     stat: 'shard',  v: [1.03, 1.06, 1.1, 1.15, 1.22], desc: (x) => `×${x} shards` },
];
export const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));
export const gearSlots = (meta) => { const t = meta.maxTier || 1; return 2 + (t >= 3) + (t >= 5) + (t >= 8) + (t >= 12); };
// meta.gear[id] = counts per rarity, e.g. [2, 1, 0, 0, 0]
export function gearRarity(meta, id) {
  const c = (meta.gear || {})[id];
  if (!c) return -1;
  for (let r = c.length - 1; r >= 0; r--) if (c[r] > 0) return r;
  return -1;
}
export function addGear(meta, id, rarity = 0) {
  meta.gear = meta.gear || {};
  const c = meta.gear[id] || (meta.gear[id] = [0, 0, 0, 0, 0]);
  c[rarity]++;
  for (let r = 0; r < c.length - 1; r++) while (c[r] >= MERGE) { c[r] -= MERGE; c[r + 1]++; }
  return gearRarity(meta, id);
}
export const gearDropChance = (tier) => Math.min(0.3, 0.1 + 0.005 * (tier - 1));
export function rollGear(tier, rand = Math.random) {
  const id = GEAR[Math.floor(rand() * GEAR.length)].id;
  const x = rand();
  const epic = Math.min(0.12, 0.03 + 0.004 * tier), rare = Math.min(0.4, 0.2 + 0.01 * tier);
  return { id, rarity: x < epic ? 2 : x < epic + rare ? 1 : 0 };
}
// combined value of equipped gear for a stat (multiplicative or additive by stat)
function gearVal(meta, stat) {
  const ADD = { range: 1, critx: 1, leech: 1, wall: 1 };
  let v = ADD[stat] ? 0 : 1;
  for (const id of meta.loadout || []) {
    const g = GEAR_BY_ID[id];
    if (!g) continue;
    const r = gearRarity(meta, id);
    if (r < 0) continue;
    if (g.stat === stat) v = ADD[stat] ? v + g.v[r] : v * g.v[r];
    if (stat === 'rate' && g.stat === 'dmg') v *= 0.9;
    if (stat === 'crit' && g.stat === 'range') v *= 1; // handled in critAdd
  }
  return v;
}
function gearCritAdd(meta) {
  let add = 0;
  for (const id of meta.loadout || []) if (id === 'g_scope') { const r = gearRarity(meta, id); if (r >= 0) add += GEAR_BY_ID[id].v[r] / 1000; }
  return add;
}

// ---------- Schematics (auto-buy build priorities) ----------
// Weights 0–4 per in-run upgrade. Auto-buy picks the upgrade with the lowest cost ÷ weight.
export const SCHEMATICS = [
  { id: 'balanced', name: 'Balanced', desc: 'A bit of everything',            w: { dmg: 4, rate: 3, range: 2, crit: 2, critx: 2, multi: 2, bounce: 2, exec: 1, knock: 1, super: 2, hp: 4, regen: 3, armor: 2, thorns: 1, wall: 2, leech: 1, salvage: 1, coins: 2, wavec: 2 } },
  { id: 'assault',  name: 'Assault',  desc: 'Damage, speed and crits first',  w: { dmg: 4, rate: 4, range: 2, crit: 3, critx: 3, multi: 3, bounce: 3, exec: 2, knock: 1, super: 3, hp: 2, regen: 1, armor: 1, thorns: 0, wall: 1, leech: 2, salvage: 0, coins: 1, wavec: 1 } },
  { id: 'fortress', name: 'Fortress', desc: 'Outlast everything',             w: { dmg: 2, rate: 1, range: 1, crit: 1, critx: 1, multi: 1, bounce: 1, exec: 1, knock: 3, super: 1, hp: 4, regen: 4, armor: 4, thorns: 3, wall: 4, leech: 3, salvage: 2, coins: 1, wavec: 1 } },
  { id: 'tycoon',   name: 'Tycoon',   desc: 'Economy early, power later',     w: { dmg: 3, rate: 2, range: 1, crit: 1, critx: 1, multi: 1, bounce: 1, exec: 1, knock: 1, super: 1, hp: 3, regen: 2, armor: 1, thorns: 1, wall: 1, leech: 1, salvage: 1, coins: 4, wavec: 4 } },
];
export const schematicWeights = (meta) => {
  if (meta.schematic === 'custom') return meta.customSchematic || SCHEMATICS[0].w;
  return (SCHEMATICS.find((x) => x.id === meta.schematic) || SCHEMATICS[0]).w;
};
// Spend coins according to the active schematic. Returns number of levels bought.
export function autoBuy(run, meta, maxBuys = 6) {
  const w = schematicWeights(meta);
  let bought = 0;
  for (let k = 0; k < maxBuys; k++) {
    let best = null;
    for (const u of runUpgradesFor(run.tier)) {
      const wt = w[u.id] || 0;
      if (!wt) continue;
      const c = runCost(run, meta, u.id, 1);
      if (!c.n) continue;
      const score = c.cost / (wt * wt);
      if (!best || score < best[1]) best = [u.id, score, c.cost];
    }
    if (!best || best[2] > run.coins) break;
    run._auto = true;
    buy(run, meta, best[0], 1);
    run._auto = false;
    bought++;
  }
  return bought;
}
// Auto-pick a perk according to the schematic's priorities.
export function autoPickPerk(run, meta) {
  if (!run.offer) return null;
  const w = schematicWeights(meta);
  let best = run.offer[0], bw = -1;
  for (const id of run.offer) { const x = (w[PERK_BY_ID[id].tag] || 1) + (id === 'k_boss' ? -0.5 : 0); if (x > bw) { bw = x; best = id; } }
  choosePerk(run, best);
  return best;
}

// ---------- Missions & milestones ----------
// Missions come in five styles that pull in different directions, so no single
// build or habit clears them all: offense, defense, economy, handicap, explore.
// "count" missions add up across runs; "run" missions need a single run that
// meets the condition (weekly ones need it several times).
// Wave targets scale with your best wave in your highest tier (bw).
const share = (run, keys) => {
  const D = run.stats.dmg || {};
  const tot = Object.values(D).reduce((a, b) => a + b, 0) || 1;
  return keys.reduce((a, k) => a + (D[k] || 0), 0) / tot;
};
const bought = (run, tab) => ((run.stats.bought || {})[tab] || 0);
const hasPerk = (run, id) => (run.perks || {})[id] || 0;
export const MISSION_CATS = { offense: 'Offense', defense: 'Defense', economy: 'Economy', handicap: 'Handicap', explore: 'Explore' };
const MISSION_POOL = [
  // offense
  { id: 'crit',    cat: 'offense', type: 'run', f: 0.5, text: (m) => `Deal 35% of a run’s damage with critical hits (reach wave ${m.w})`, ok: (r, m) => r.wave >= m.w && share(r, ['crit', 'super']) >= 0.35 },
  { id: 'abil',    cat: 'offense', type: 'run', f: 0.5, need: (M) => Object.keys(M.abilities || {}).length > 0, text: (m) => `Deal 12% of a run’s damage with abilities (reach wave ${m.w})`, ok: (r, m) => r.wave >= m.w && share(r, ['pulse', 'orbit', 'chain']) >= 0.12 },
  { id: 'warden2', cat: 'offense', type: 'run', text: () => 'Defeat 2 Wardens in a single run', ok: (r) => r.bossKills >= 2 },
  { id: 'kills',   cat: 'offense', type: 'count', key: 'kills', n: 500, wn: 5000, text: (m) => `Defeat ${m.n.toLocaleString('en-US')} enemies` },
  { id: 'bounce',  cat: 'offense', type: 'run', f: 0.5, need: (M) => (M.maxTier || 1) >= 2, text: (m) => `Deal 10% of a run’s damage with Ricochet (reach wave ${m.w})`, ok: (r, m) => r.wave >= m.w && share(r, ['bounce']) >= 0.1 },
  // defense
  { id: 'wall',    cat: 'defense', type: 'run', text: () => 'Block damage equal to 2× your max health with the wall in one run', ok: (r) => (r.stats.absorbed || 0) >= 2 * (r.stats.maxHpEnd || Infinity) },
  { id: 'leech',   cat: 'defense', type: 'run', need: (M) => (M.maxTier || 1) >= 2, text: () => 'Heal your full max health with lifesteal in one run', ok: (r) => (r.stats.healed || 0) >= (r.stats.maxHpEnd || Infinity) },
  { id: 'thorns',  cat: 'defense', type: 'run', f: 0.5, text: (m) => `Deal 8% of a run’s damage with Thorns (reach wave ${m.w})`, ok: (r, m) => r.wave >= m.w && share(r, ['thorns']) >= 0.08 },
  { id: 'fortress', cat: 'defense', type: 'run', f: 0.7, text: (m) => `Reach wave ${m.w} using the Fortress schematic with Auto-buy`, ok: (r, m) => r.wave >= m.w && r.stats.schematic === 'fortress' && (r.stats.auto || 0) > 0 },
  // economy
  { id: 'econ',    cat: 'economy', type: 'run', text: () => 'Buy 15 Economy upgrade levels in one run', ok: (r) => bought(r, 'economy') >= 15 },
  { id: 'tycoon',  cat: 'economy', type: 'run', f: 0.7, text: (m) => `Reach wave ${m.w} using the Tycoon schematic with Auto-buy`, ok: (r, m) => r.wave >= m.w && r.stats.schematic === 'tycoon' && (r.stats.auto || 0) > 0 },
  { id: 'greed',   cat: 'economy', type: 'run', f: 0.5, text: (m) => `Reach wave ${m.w} after choosing Windfall or Greed`, ok: (r, m) => r.wave >= m.w && (hasPerk(r, 'k_coin') || hasPerk(r, 'k_greed')) },
  { id: 'work',    cat: 'economy', type: 'count', key: 'workshop', n: 4, wn: 25, text: (m) => `Buy ${m.n} Workshop upgrades` },
  { id: 'lab',     cat: 'economy', type: 'count', key: 'research', n: 2, wn: 10, text: (m) => `Start ${m.n} research projects` },
  // handicap
  { id: 'noauto',  cat: 'handicap', type: 'run', f: 0.6, text: (m) => `Reach wave ${m.w} without Auto-buy`, ok: (r, m) => r.wave >= m.w && !(r.stats.auto > 0) },
  { id: 'nogear',  cat: 'handicap', type: 'run', f: 0.5, text: (m) => `Reach wave ${m.w} with no gear equipped`, ok: (r, m) => r.wave >= m.w && !r.stats.loadout },
  { id: 'noabil',  cat: 'handicap', type: 'run', f: 0.6, text: (m) => `Reach wave ${m.w} without using abilities`, ok: (r, m) => r.wave >= m.w && !r.stats.abilities },
  { id: 'nodef',   cat: 'handicap', type: 'run', f: 0.45, text: (m) => `Reach wave ${m.w} without buying Defense upgrades`, ok: (r, m) => r.wave >= m.w && !bought(r, 'defense') },
  { id: 'glass',   cat: 'handicap', type: 'run', f: 0.5, text: (m) => `Reach wave ${m.w} after choosing Glass cannon twice`, ok: (r, m) => r.wave >= m.w && hasPerk(r, 'k_glass') >= 2 },
  // explore
  { id: 'top',     cat: 'explore', type: 'run', f: 0.9, text: (m) => `Reach wave ${m.w} in your highest tier`, ok: (r, m) => r.wave >= m.w && r.tier >= (r.stats.maxTierAtStart || 1) },
  { id: 'low',     cat: 'explore', type: 'run', f: 1.3, need: (M) => (M.maxTier || 1) >= 2, text: (m) => `Reach wave ${m.w} in a tier below your highest`, ok: (r, m) => r.wave >= m.w && r.tier < (r.stats.maxTierAtStart || 1) },
  { id: 'long',    cat: 'explore', type: 'run', text: () => 'Play a single run lasting 15 minutes', ok: (r) => (r.time || 0) >= 900 },
  { id: 'assault', cat: 'explore', type: 'run', f: 0.7, text: (m) => `Reach wave ${m.w} using the Assault schematic with Auto-buy`, ok: (r, m) => r.wave >= m.w && r.stats.schematic === 'assault' && (r.stats.auto || 0) > 0 },
  { id: 'perks4',  cat: 'explore', type: 'run', text: () => 'Choose 4 different perks in one run', ok: (r) => Object.keys(r.perks || {}).length >= 4 },
];
const MISSION_BY_ID = Object.fromEntries(MISSION_POOL.map((m) => [m.id, m]));
const WEEKLY_TIMES = 3; // weekly "run" missions need the condition met this many times
export const MILESTONES = [
  ...[100, 1000, 10000, 100000, 1000000].map((n, i) => ({ id: `m_k${i}`, key: 'kills', n, text: `Defeat ${n.toLocaleString('en-US')} enemies`, gear: i >= 2 ? 1 : 0 })),
  ...[1, 10, 50, 250, 1000].map((n, i) => ({ id: `m_w${i}`, key: 'wardens', n, text: `Defeat ${n} Warden${n > 1 ? 's' : ''}`, gear: i >= 1 ? 1 : 0 })),
  ...[2, 3, 5, 8, 12, 16, 20, 25, 30, 40].map((n, i) => ({ id: `m_t${i}`, key: 'maxTier', n, text: `Unlock tier ${n}`, gear: n >= 5 ? 2 : 1 })),
  ...[10, 50, 200, 1000].map((n, i) => ({ id: `m_r${i}`, key: 'runs', n, text: `Finish ${n} runs`, gear: i >= 2 ? 1 : 0 })),
  ...[10, 50, 150, 400].map((n, i) => ({ id: `m_l${i}`, key: 'researchLv', n, text: `Reach ${n} total research levels`, gear: i >= 1 ? 1 : 0 })),
];
function dayKeyOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function weekKeyOf(d) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); return 'W' + dayKeyOf(m); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function pickFrom(pool, n, seed) {
  const a = pool.slice(); const out = [];
  let x = seed;
  while (out.length < n && a.length) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out.push(a.splice(x % a.length, 1)[0]); }
  return out;
}
// Rewards scale with how far you've come, so missions stay worth doing.
export function rewardScale(meta) {
  const t = meta.maxTier || 1;
  const w = Math.max(10, (meta.best || {})[t] || (meta.best || {})[t - 1] || 10);
  return Math.max(5, Math.floor(w * (1 + w / 25)) * tierPow('shards', t) * mult(meta, 'shard'));
}
// Make sure daily/weekly missions exist for "now"; returns meta.missions.
const MISSION_VER = 3;
export const MISSIONS_PER_STYLE = 2; // 5 styles × 2 = 10 missions per set
function makeMissions(meta, seed, weekly) {
  const t = meta.maxTier || 1;
  const bw = Math.max(12, (meta.best || {})[t] || (meta.best || {})[t - 1] || 12);
  const out = [];
  let x = seed;
  for (const cat of Object.keys(MISSION_CATS)) {
    const pool = MISSION_POOL.filter((m) => m.cat === cat && (!m.need || m.need(meta)));
    for (let k = 0; k < MISSIONS_PER_STYLE && pool.length; k++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const d = pool.splice(x % pool.length, 1)[0];
      const m = { id: d.id, cat, prog: 0, claimed: false };
      if (d.type === 'count') { m.key = d.key; m.n = weekly ? d.wn : d.n; }
      else { m.n = weekly ? WEEKLY_TIMES : 1; if (d.f) m.w = Math.max(8, Math.round(bw * d.f)); }
      out.push(m);
    }
  }
  return out;
}
export function refreshMissions(meta, now = nowMs()) {
  const d = new Date(now);
  const day = dayKeyOf(d), week = weekKeyOf(d);
  const M = meta.missions || (meta.missions = {});
  if (M.ver !== MISSION_VER) { M.ver = MISSION_VER; M.day = null; M.week = null; }
  if (M.day !== day) { M.day = day; M.daily = makeMissions(meta, hash(day), false); M.dailyBonus = false; }
  if (M.week !== week) { M.week = week; M.weekly = makeMissions(meta, hash(week + 'w'), true); M.weeklyBonus = false; }
  M.done = M.done || {};
  return M;
}
export function missionText(m) {
  const d = MISSION_BY_ID[m.id];
  if (!d) return m.id;
  const t = d.text(m);
  return d.type === 'run' && m.n > 1 ? `${t} — ${m.n} times` : t;
}
export const missionCat = (m) => MISSION_CATS[m.cat] || '';
// each mission pays a little; clearing a whole set pays a bonus on top
export const missionReward = (meta, kind) => Math.round(rewardScale(meta) * (kind === 'weekly' ? 0.36 : 0.09));
export const sweepReward = (meta, kind) => Math.round(rewardScale(meta) * (kind === 'weekly' ? 2 : 0.5));
export function sweepStatus(meta, kind) {
  const M = refreshMissions(meta);
  const list = M[kind];
  return { done: list.filter((m) => m.claimed).length, total: list.length, claimed: !!M[kind + 'Bonus'], reward: sweepReward(meta, kind) };
}
export function claimSweep(meta, kind) {
  const M = refreshMissions(meta);
  if (M[kind + 'Bonus'] || !M[kind].every((m) => m.claimed)) return 0;
  M[kind + 'Bonus'] = true;
  const got = sweepReward(meta, kind);
  meta.shards += got;
  return got;
}
// Check a finished run against "run" missions.
function checkRunMissions(run, meta) {
  const M = refreshMissions(meta);
  for (const m of [...M.daily, ...M.weekly]) {
    const d = MISSION_BY_ID[m.id];
    if (!d || d.type !== 'run' || m.claimed || m.prog >= m.n) continue;
    try { if (d.ok(run, m)) m.prog = Math.min(m.n, m.prog + 1); } catch {}
  }
}
export const milestoneReward = (meta, m) => Math.round(rewardScale(meta) * 0.5 * (1 + (m.gear || 0)));
// Count progress toward missions and lifetime totals.
export function track(meta, key, amount = 1, now = nowMs()) {
  const M = refreshMissions(meta, now);
  for (const m of [...M.daily, ...M.weekly]) if (m.key && m.key === key && !m.claimed) m.prog = Math.min(m.n, m.prog + amount);
  const R = meta.records || (meta.records = {});
  R[key] = (R[key] || 0) + amount;
}
export function milestoneValue(meta, key) {
  if (key === 'maxTier') return meta.maxTier || 1;
  if (key === 'researchLv') return Object.values(meta.research || {}).reduce((a, b) => a + b, 0);
  return (meta.records || {})[key] || 0;
}
export function claimMission(meta, list, idx, rand = Math.random) {
  const M = refreshMissions(meta);
  const m = M[list][idx];
  if (!m || m.claimed || m.prog < m.n) return 0;
  m.claimed = true;
  const got = missionReward(meta, list);
  meta.shards += got;
  return got;
}
export function claimMilestone(meta, id, rand = Math.random) {
  const m = MILESTONES.find((x) => x.id === id);
  const M = refreshMissions(meta);
  if (!m || M.done[id] || milestoneValue(meta, m.key) < m.n) return null;
  M.done[id] = true;
  const shards = milestoneReward(meta, m);
  meta.shards += shards;
  let gear = null;
  if (m.gear) { const g = rollGear(meta.maxTier || 1, rand); g.rarity = Math.max(g.rarity, Math.min(2, m.gear)); addGear(meta, g.id, g.rarity); gear = g; }
  return { shards, gear };
}
export const unclaimedCount = (meta) => {
  const M = refreshMissions(meta);
  let n = [...M.daily, ...M.weekly].filter((m) => !m.claimed && m.prog >= m.n).length;
  for (const k of ['daily', 'weekly']) if (!M[k + 'Bonus'] && M[k].every((m) => m.claimed)) n++;
  n += MILESTONES.filter((m) => !M.done[m.id] && milestoneValue(meta, m.key) >= m.n).length;
  return n;
};


// ---------- Monthly events ----------
// Each calendar month runs a themed event. Event runs use the theme's rules,
// don't count toward tier unlocks or best waves, and earn event tokens.
// Tokens unlock nodes in a 22-node tree (three branches + capstone). Tokens and
// tree progress reset when the month ends; rewards you unlocked are permanent.
export const EVENT_THEMES = [
  { id: 'swarm',   name: 'The Swarm',    color: '#7ed957', desc: 'Twice as many enemies, each with half the health.',  mod: { count: 2, hp: 0.5 } },
  { id: 'titans',  name: 'Titanfall',    color: '#e0843a', desc: 'Half as many enemies with triple health — and double coins.', mod: { count: 0.5, hp: 3, coins: 2 } },
  { id: 'blitz',   name: 'Blitz',        color: '#f2c84b', desc: 'Waves arrive every 12 seconds instead of 20.',      mod: { waveTime: 12, spawnTime: 8 } },
  { id: 'eclipse', name: 'Eclipse',      color: '#e05a5a', desc: 'A Warden arrives every 5 waves.',                   mod: { bossEvery: 5 } },
  { id: 'glass',   name: 'Glass Keep',   color: '#8fd3ff', desc: 'Your keep deals double damage but has half the health.', mod: { pdmg: 2, php: 0.5 } },
  { id: 'frost',   name: 'Deep Frost',   color: '#bfe8ff', desc: 'Enemies move 30% slower but are 50% tougher.',      mod: { speed: 0.7, hp: 1.5 } },
];
export const THEME_BY_ID = Object.fromEntries(EVENT_THEMES.map((t) => [t.id, t]));
const monthKeyOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
export function currentEvent(now = nowMs()) {
  const d = new Date(now);
  const idx = (d.getFullYear() * 12 + d.getMonth()) % EVENT_THEMES.length;
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { key: monthKeyOf(d), theme: EVENT_THEMES[idx], endsAt: end.getTime() };
}
// Challenge ladders: each step pays tokens once per month.
export const EVENT_CHALLENGES = [
  { id: 'runs',    text: (n) => `Finish ${n} event runs`,           steps: [3, 10, 20, 35],              tokens: [10, 20, 30, 50] },
  { id: 'wave',    text: (n) => `Reach wave ${n} in an event run`,   steps: [15, 25, 35, 45, 60],         tokens: [10, 15, 25, 40, 60] },
  { id: 'wardens', text: (n) => `Defeat ${n} Wardens in event runs`, steps: [5, 15, 30, 60],              tokens: [10, 20, 35, 55] },
  { id: 'kills',   text: (n) => `Defeat ${n.toLocaleString('en-US')} enemies in event runs`, steps: [1000, 5000, 15000, 40000], tokens: [10, 20, 35, 55] },
];
// Tree: three branches of 7 nodes; each node needs the one above it.
// The capstone needs all three branch ends.
const NODE_COST = [15, 25, 40, 60, 85, 115, 150];
export const EVENT_BRANCHES = [
  { id: 'might',   name: 'Might',   rewards: ['shards:1', 'gear:1', 'shards:2', 'relic:2', 'shards:3', 'gear:2', 'gear:3'] },
  { id: 'bulwark', name: 'Bulwark', rewards: ['shards:1', 'relic:1', 'gear:1', 'shards:2', 'relic:3', 'shards:4', 'gear:3'] },
  { id: 'fortune', name: 'Fortune', rewards: ['shards:2', 'shards:2', 'relic:2', 'shards:3', 'gear:2', 'shards:5', 'relic:5'] },
];
export const CAPSTONE_COST = 200;
export function eventNodes() {
  const out = [];
  for (const b of EVENT_BRANCHES) b.rewards.forEach((r, i) => out.push({ id: `${b.id}${i}`, branch: b.id, i, cost: NODE_COST[i], reward: r, needs: i ? [`${b.id}${i - 1}`] : [] }));
  out.push({ id: 'capstone', branch: 'capstone', i: 7, cost: CAPSTONE_COST, reward: 'skin', needs: EVENT_BRANCHES.map((b) => `${b.id}6`) });
  return out;
}
export function refreshEvent(meta, now = nowMs()) {
  const ev = currentEvent(now);
  const E = meta.event || (meta.event = {});
  if (E.key !== ev.key) Object.assign(E, { key: ev.key, theme: ev.theme.id, tokens: 0, earned: 0, nodes: {}, prog: { runs: 0, wave: 0, wardens: 0, kills: 0 }, steps: {} });
  return E;
}
export function eventRewardText(meta, reward) {
  const [kind, x] = reward.split(':');
  if (kind === 'shards') return `${Math.round(rewardScale(meta) * 0.6 * +x)} shards`;
  if (kind === 'gear') return `${RARITIES[Math.min(4, +x)]} gear`;
  if (kind === 'relic') return `${x} relic${+x > 1 ? 's' : ''}`;
  if (kind === 'skin') return 'Exclusive keep colour';
  return reward;
}
export function unlockNode(meta, id, rand = Math.random) {
  const E = refreshEvent(meta);
  const node = eventNodes().find((n) => n.id === id);
  if (!node || E.nodes[id] || E.tokens < node.cost || !node.needs.every((n) => E.nodes[n])) return null;
  E.tokens -= node.cost;
  E.nodes[id] = true;
  const [kind, x] = node.reward.split(':');
  const out = { kind };
  if (kind === 'shards') { out.shards = Math.round(rewardScale(meta) * 0.6 * +x); meta.shards += out.shards; }
  else if (kind === 'gear') { const g = rollGear(meta.maxTier || 1, rand); g.rarity = Math.min(4, +x); addGear(meta, g.id, g.rarity); out.gear = g; }
  else if (kind === 'relic') { out.relics = []; for (let k = 0; k < +x; k++) { const r = rollRelic(meta, Math.max(meta.maxTier || 1, 6), rand); if (r) { meta.relics[r] = (meta.relics[r] || 0) + 1; out.relics.push(r); } } }
  else if (kind === 'skin') { meta.skins = meta.skins || {}; meta.skins[E.theme] = true; out.skin = E.theme; }
  return out;
}
export function claimEventStep(meta, cid, step) {
  const E = refreshEvent(meta);
  const c = EVENT_CHALLENGES.find((x) => x.id === cid);
  const key = `${cid}${step}`;
  if (!c || E.steps[key] || (E.prog[cid] || 0) < c.steps[step]) return 0;
  E.steps[key] = true;
  E.tokens += c.tokens[step]; E.earned += c.tokens[step];
  return c.tokens[step];
}
export const eventTokensForRun = (run) => Math.floor(run.wave / 4) + 3 * run.bossKills + 2;
export function eventClaimable(meta) {
  const E = refreshEvent(meta);
  let n = 0;
  for (const c of EVENT_CHALLENGES) c.steps.forEach((v, i) => { if (!E.steps[`${c.id}${i}`] && (E.prog[c.id] || 0) >= v) n++; });
  return n;
}

// ---------- Game speed ----------
export const maxSpeed = (meta) => { const t = meta.maxTier || 1; return t >= 5 ? 5 : t >= 3 ? 4 : 3; };

// ---------- Meta (saved between runs) ----------
export function newMeta() {
  return {
    v: VERSION, shards: 0, perm: {}, research: {}, lab: [], relics: {},
    abilities: {}, autocast: false, autoOn: true,
    best: {}, maxTier: 1, tier: 1, bestWave: 0, runs: 0, lastSeen: Date.now(),
    gear: {}, loadout: [], schematic: 'balanced', customSchematic: null, autoBuy: false, autoPerk: true,
    missions: {}, records: {}, event: {}, skins: {}, skin: null,
  };
}

// Convert a version-1 save: refund shards spent in the old workshop, keep abilities.
const OLD_PERM = { pdmg: [8, 1.32], php: [8, 1.32], prate: [12, 1.4], pcoin: [10, 1.35], pstart: [6, 1.3], pdisc: [20, 1.45], pcrit: [15, 1.4], pshard: [25, 1.45], poffl: [15, 1.4] };
export function migrateMeta(m) {
  const base = newMeta();
  if (!m || !Object.keys(m).length) return base;
  // v2 → v3 only adds new fields; everything already saved is kept as-is
  if (m.v === VERSION || m.v === 2) return { ...base, ...m, v: VERSION, records: { runs: m.runs || 0, ...(m.records || {}) } };
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
    case 'shard': return permVal(meta, 'pshard') * researchVal(meta, 'rshard') * (1 + relicBonus(meta, 'shard')) * gearVal(meta, 'shard');
    case 'crit': return permVal(meta, 'pcrit') + relicBonus(meta, 'crit');
    case 'armor': return relicBonus(meta, 'armor');
    case 'cd': return researchVal(meta, 'rcd') * Math.max(0.5, 1 - relicBonus(meta, 'cd')) * gearVal(meta, 'cd');
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
  track(meta, 'research', 1, now);
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
  const p = (id) => pk(run, id);
  const dmgPerk = Math.pow(1.15, p('k_dmg')) * Math.pow(1.4, p('k_glass'));
  const hpPerk = Math.pow(1.2, p('k_hp')) * Math.pow(0.8, p('k_glass'));
  const M = run.mod || {};
  const maxHp = v('hp') * mult(meta, 'hp') * gearVal(meta, 'hp') * hpPerk * (M.php || 1);
  return {
    dmg: v('dmg') * mult(meta, 'dmg') * gearVal(meta, 'dmg') * dmgPerk * (M.pdmg || 1),
    rate: v('rate') * mult(meta, 'rate') * gearVal(meta, 'rate') * Math.pow(1.1, p('k_rate')) * (run.fx.overdrive > 0 ? 2 : 1),
    range: v('range') + gearVal(meta, 'range') + 20 * p('k_range'),
    crit: Math.min(0.9, v('crit') + mult(meta, 'crit') + gearCritAdd(meta) + 0.08 * p('k_crit')),
    critx: v('critx') + gearVal(meta, 'critx') + 0.6 * p('k_critx'),
    multi: v('multi'),
    bounce: v('bounce'),
    exec: v('exec'),
    knock: v('knock'),
    superc: v('super'),
    maxHp,
    regen: v('regen') * mult(meta, 'hp') * gearVal(meta, 'regen') * Math.pow(1.35, p('k_regen')),
    armor: Math.max(0, Math.min(0.75, v('armor') + mult(meta, 'armor') + 0.05 * p('k_armor') - 0.05 * p('k_greed'))),
    thorns: v('thorns') + 0.1 * p('k_thorns'),
    salvage: v('salvage'),
    leech: v('leech') + gearVal(meta, 'leech') + 0.02 * p('k_leech'),
    wallMax: maxHp * (v('wall') + gearVal(meta, 'wall') + 0.25 * p('k_wall')),
    coinMult: (1 + v('coins')) * mult(meta, 'coin') * gearVal(meta, 'coin') * Math.pow(1.2, p('k_coin')) * Math.pow(1.4, p('k_greed')),
    waveBonus: v('wavec') * tierPow('coins', run.tier),
    boss: mult(meta, 'boss') * gearVal(meta, 'boss') * Math.pow(1.5, p('k_boss')),
    cdMult: Math.pow(0.85, p('k_cd')),
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
  const B = run.stats.bought || (run.stats.bought = {});
  B[RUN_BY_ID[id].tab] = (B[RUN_BY_ID[id].tab] || 0) + n;
  if (run._auto) run.stats.auto = (run.stats.auto || 0) + n;
  if (id === 'hp') run.hp += stats(run, meta).maxHp - before.maxHp;
  return true;
}

// ---------- Run ----------
export function newRun(meta, tier = meta.tier || 1, eventTheme = null) {
  tier = Math.max(1, Math.min(tier, meta.maxTier || 1));
  const mod = eventTheme ? (THEME_BY_ID[eventTheme] || {}).mod || {} : {};
  const run = {
    event: eventTheme || null, mod, eventKey: eventTheme ? currentEvent().key : null,
    waveTime: mod.waveTime || WAVE_TIME, spawnTime: mod.spawnTime || SPAWN_TIME, bossEvery: mod.bossEvery || BOSS_EVERY,
    tier, wave: 1, waveT: 0, spawned: 0,
    coins: Math.floor(permVal(meta, 'pstart') * tierPow('coins', tier)),
    levels: {}, hp: 0, aim: 0,
    enemies: [], shots: [], bolts: [], fx: { overdrive: 0, freeze: 0, orbit: 0 }, rings: [], zaps: [],
    cds: {}, fireT: 0, time: 0, orbitT: 0,
    kills: 0, bossKills: 0, coinsEarned: 0, relicsFound: [], gearFound: [], over: false, nextId: 1,
    perks: {}, offer: null, wall: 0, wallT: 0, lastStand: false, invuln: 0,
    stats: newRunStats(),
  };
  const s = stats(run, meta);
  run.hp = s.maxHp;
  run.wall = s.wallMax;
  run.stats.loadout = (meta.loadout || []).filter((id) => gearRarity(meta, id) >= 0).length;
  run.stats.schematic = meta.schematic || 'balanced';
  run.stats.maxTierAtStart = meta.maxTier || 1;
  return run;
}
export function newRunStats() {
  return { dmg: {}, taken: { melee: 0, ranged: 0 }, absorbed: 0, healed: 0, killsBy: {}, perks: [], killer: null, abilities: 0 };
}

// Serialize/resume: enemies are not saved; the current wave restarts.
export function snapshot(run) {
  const { tier, wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time, relicsFound, gearFound, perks, offer, wall, lastStand, stats: st, event, eventKey } = run;
  return { tier, wave, coins, levels, hp, cds, kills, bossKills, coinsEarned, time, relicsFound, gearFound, perks, offer, wall, lastStand, stats: st, event, eventKey };
}
// Older snapshots simply lack the newer fields; they get sensible defaults.
export function resume(snap, meta) {
  const run = newRun(meta, snap.tier || 1, snap.event || null);
  Object.assign(run, snap, {
    tier: snap.tier || 1, relicsFound: snap.relicsFound || [], gearFound: snap.gearFound || [],
    perks: snap.perks || {}, offer: snap.offer || null, lastStand: !!snap.lastStand,
    stats: { ...newRunStats(), ...(snap.stats || {}) },
  });
  if (snap.wall == null) run.wall = stats(run, meta).wallMax;
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
  const hp = enemyHp(w, run.tier) * T.hp * (elite ? 3 : 1) * ((run.mod && run.mod.hp) || 1);
  const e = {
    id: run.nextId++, type, elite,
    x: at ? at.x : Math.cos(a) * (R + 18), y: at ? at.y : Math.sin(a) * (R + 18),
    hp, maxHp: hp, dmg: enemyDmg(w, run.tier) * T.dmg * (elite ? 2 : 1), speed: T.speed * (0.9 + rand() * 0.2) * ((run.mod && run.mod.speed) || 1),
    size: T.size * (elite ? 1.2 : 1), atkT: 0.4, spin: rand() * 6, push: 0, blinkT: 3,
  };
  run.enemies.push(e);
  return e;
}

function hitTower(run, meta, s, dmg, events, src = 'melee', who = null) {
  if (run.invuln > 0) return;
  let taken = dmg * (1 - s.armor);
  run.wallT = 4; // wall regrows after 4 s without being hit
  if (run.wall > 0) {
    const a = Math.min(run.wall, taken);
    run.wall -= a; taken -= a; run.stats.absorbed += a;
    if (a > 0) events.push({ t: 'wallhit', v: a, broke: run.wall <= 0 });
  }
  if (taken <= 0) return;
  run.hp -= taken;
  run.stats.taken[src] = (run.stats.taken[src] || 0) + taken;
  events.push({ t: 'hurt', v: taken });
  if (run.hp <= 0) {
    const ls = permVal(meta, 'plast');
    if (ls > 0 && !run.lastStand) {
      run.lastStand = true;
      run.hp = s.maxHp * ls;
      run.invuln = 3;
      events.push({ t: 'laststand' });
      return;
    }
    run.hp = 0; run.over = true; run.stats.killer = who; events.push({ t: 'over' });
  }
}

function damage(run, meta, s, e, amount, events, rand, src = 'shot') {
  const T = TYPES[e.type];
  if (T.boss) amount *= s.boss;
  if (T.shielded && e.hp > e.maxHp * 0.5) amount *= 0.5;
  const dealt = Math.min(Math.max(0, e.hp), amount);
  e.hp -= amount;
  const D = run.stats.dmg;
  D[src] = (D[src] || 0) + dealt;
  if (e.hp > 0 && !T.boss && s.exec > 0 && e.hp < e.maxHp * s.exec) { D.exec = (D.exec || 0) + e.hp; e.hp = 0; }
  if (s.leech > 0 && (src === 'shot' || src === 'crit' || src === 'super' || src === 'bounce')) {
    const heal = Math.min(s.maxHp - run.hp, dealt * s.leech);
    if (heal > 0) { run.hp += heal; run.stats.healed += heal; }
  }
  if (e.hp <= 0 && !e.dead) killEnemy(run, meta, s, e, events, rand);
}

function killEnemy(run, meta, s, e, events, rand = Math.random) {
  e.dead = true;
  const T = TYPES[e.type];
  const c = enemyCoins(run.wave, run.tier) * ((run.mod && run.mod.coins) || 1) * T.coins * s.coinMult * (e.elite ? 4 : 1);
  run.coins += c; run.coinsEarned += c; run.kills++;
  run.stats.killsBy[e.type] = (run.stats.killsBy[e.type] || 0) + 1;
  track(meta, 'kills', 1);
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
    track(meta, 'wardens', 1);
    if (rand() < gearDropChance(run.tier)) {
      const g = rollGear(run.tier, rand);
      addGear(meta, g.id, g.rarity);
      run.gearFound.push(g);
      events.push({ t: 'gear', id: g.id, rarity: g.rarity, x: e.x, y: e.y });
    }
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
  run.cds[id] = abilityCd(meta, ab) * s.cdMult;
  run.stats.abilities++;
  track(meta, 'abilities', 1);
  if (id === 'pulse') {
    const rad = 210;
    for (const e of run.enemies) if (Math.hypot(e.x, e.y) <= rad) { e.push = 70; damage(run, meta, s, e, s.dmg * 8, events, rand, 'pulse'); }
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
      damage(run, meta, s, e, s.dmg * 15, events, rand, 'chain');
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
  run.invuln = Math.max(0, (run.invuln || 0) - dt);
  if (run.wallT > 0) run.wallT -= dt;
  else if (run.wall < s.wallMax) run.wall = Math.min(s.wallMax, run.wall + s.wallMax * 0.15 * dt);

  // waves & spawning
  run.waveT += dt;
  const isBossWave = run.wave % (run.bossEvery || BOSS_EVERY) === 0;
  const spawnTime = run.spawnTime || SPAWN_TIME;
  const total = Math.max(2, Math.round(waveCount(run.wave) * ((run.mod && run.mod.count) || 1)));
  while (run.spawned < total && run.waveT >= (run.spawned / total) * spawnTime) {
    spawn(run, pickType(run, rand), rand);
    run.spawned++;
  }
  if (isBossWave && run.spawned === total && !run.bossSpawned && run.waveT >= spawnTime * 0.5) {
    spawn(run, 'boss', rand);
    run.bossSpawned = true;
    events.push({ t: 'boss' });
  }
  if (run.waveT >= (run.waveTime || WAVE_TIME)) {
    const bonus = s.waveBonus * run.wave;
    if (bonus) { run.coins += bonus; run.coinsEarned += bonus; }
    run.wave++; run.waveT = 0; run.spawned = 0; run.bossSpawned = false;
    track(meta, 'waves', 1);
    // an unanswered perk offer is auto-picked when the next one is due
    if ((run.wave - 1) % PERK_EVERY === 0) {
      if (run.offer) { autoPickPerk(run, meta); track(meta, 'perks', 1); }
      offerPerks(run, rand);
      events.push({ t: 'perks' });
      if (meta.autoPerk) { autoPickPerk(run, meta); track(meta, 'perks', 1); events.push({ t: 'perkauto' }); }
    }
    const best = meta.best || (meta.best = {});
    // event runs play by different rules, so they don't count toward bests or unlocks
    if (!run.event && run.wave > (best[run.tier] || 0)) best[run.tier] = run.wave;
    if (!run.event && run.wave > (meta.bestWave || 0)) meta.bestWave = run.wave;
    events.push({ t: 'wave', wave: run.wave, bonus });
    if (!run.event && run.wave >= TIER_UNLOCK_WAVE && run.tier === (meta.maxTier || 1)) {
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
          run.bolts.push({ x: e.x, y: e.y, dmg: e.dmg, speed: 150, who: e.type });
        } else {
          e.atkT = 1;
          hitTower(run, meta, s, e.dmg, events, 'melee', e.type);
          if (s.thorns > 0) damage(run, meta, s, e, e.maxHp * s.thorns, events, rand, 'thorns');
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
        if (d > 50 && d < 115) damage(run, meta, s, e, s.dmg * 1.2, events, rand, 'orbit');
      }
      run.enemies = run.enemies.filter((e) => e.hp > 0);
    }
  }

  // enemy bolts
  for (const b of run.bolts) {
    const d = Math.hypot(b.x, b.y);
    const mv = b.speed * dt;
    if (d <= TOWER_R + mv) { b.hit = true; hitTower(run, meta, s, b.dmg, events, 'ranged', b.who); }
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
        const sup = crit && rand() < s.superc;
        run.shots.push({ x: 0, y: 0, target: e.id, tx: e.x, ty: e.y, dmg: s.dmg * (crit ? s.critx : 1) * (sup ? 4 : 1), crit, sup, speed: 560, bounces: s.bounce });
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
        damage(run, meta, s, e, p.dmg, events, rand, p.bounced ? 'bounce' : p.sup ? 'super' : p.crit ? 'crit' : 'shot');
        events.push({ t: 'hit', id: e.id, x: e.x, y: e.y, dmg: p.dmg, crit: p.crit, sup: p.sup });
        if (s.knock > 0 && e.hp > 0 && !TYPES[e.type].boss && rand() < s.knock) e.push = 35;
        if (p.bounces > 0) {
          let next = null, nd = 160;
          for (const o of run.enemies) {
            if (o === e || o.hp <= 0) continue;
            const od = Math.hypot(o.x - e.x, o.y - e.y);
            if (od < nd) { nd = od; next = o; }
          }
          if (next) newShots.push({ x: e.x, y: e.y, target: next.id, tx: next.x, ty: next.y, dmg: p.dmg * 0.6, crit: false, speed: 560, bounces: p.bounces - 1, bounced: true });
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
// Bank a finished run: shards, run count, missions and lifetime records.
export function finishRun(run, meta) {
  run.stats.maxHpEnd = stats(run, meta).maxHp;
  checkRunMissions(run, meta);
  if (run.event) {
    const E = refreshEvent(meta);
    // only count toward the event that was running when this run started
    if (!run.eventKey || run.eventKey === E.key) {
      const tok = eventTokensForRun(run);
      E.tokens += tok; E.earned += tok;
      E.prog.runs = (E.prog.runs || 0) + 1;
      E.prog.wave = Math.max(E.prog.wave || 0, run.wave);
      E.prog.wardens = (E.prog.wardens || 0) + run.bossKills;
      E.prog.kills = (E.prog.kills || 0) + run.kills;
      run.tokensEarned = tok;
    }
  }
  const got = shardsForRun(run, meta);
  meta.shards += got;
  meta.runs = (meta.runs || 0) + 1;
  track(meta, 'runs', 1);
  const R = meta.records || (meta.records = {});
  R.shardsEarned = (R.shardsEarned || 0) + got;
  R.bestRunShards = Math.max(R.bestRunShards || 0, got);
  R.longestRun = Math.max(R.longestRun || 0, Math.round(run.time || 0));
  R.playTime = (R.playTime || 0) + Math.round(run.time || 0);
  return got;
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

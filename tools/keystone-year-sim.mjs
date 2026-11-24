// Simulates long-term Keystone progression for a given play profile.
// Usage: node tools/keystone-year-sim.mjs <light|heavy> <days> [reportEvery]
import * as K from '../js/keystone-engine.js';

const profile = process.argv[2] || 'light';
const DAYS = +(process.argv[3] || 60);
const EVERY = +(process.argv[4] || 7);
// session hours and how many runs each session represents (only one is simulated)
const PROFILES = {
  light: { sessions: [8, 20], runsPer: 1 },
  heavy: { sessions: [8, 12, 17, 21], runsPer: 2 },
};
const P = PROFILES[profile];

let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const meta = K.newMeta();
meta.lastSeen = 0;
meta.autoPerk = true;
const OLD = process.env.OLD === '1'; // simulate without the new systems for comparison
K.setClock(() => now);
const DT = 0.1;

function simulateRun(tier) {
  const run = K.newRun(meta, tier);
  let t = 0, buyT = 0;
  const ids = () => K.runUpgradesFor(run.tier).map((u) => u.id);
  while (!run.over && t < 2 * 3600) {
    K.step(run, meta, DT, rand); t += DT;
    if ((buyT += DT) >= 0.5) {
      buyT = 0;
      K.autoBuy(run, meta, 3);
    }
  }
  return { wave: run.wave, minutes: t / 60, run, relics: run.relicsFound.length };
}

function equipGear() {
  // equip the highest-rarity pieces, preferring core combat stats on ties
  const pref = ['g_barrel', 'g_plate', 'g_clock', 'g_heart', 'g_purse', 'g_prism', 'g_stone', 'g_fang', 'g_scope', 'g_crown', 'g_glass', 'g_coin'];
  const owned = pref.filter((id) => K.gearRarity(meta, id) >= 0).sort((a, b) => K.gearRarity(meta, b) - K.gearRarity(meta, a) || pref.indexOf(a) - pref.indexOf(b));
  meta.loadout = owned.slice(0, K.gearSlots(meta));
}
function claimAll() {
  const M = K.refreshMissions(meta, now);
  for (const list of ['daily', 'weekly']) M[list].forEach((m, i) => { if (m.prog >= m.n && !m.claimed) K.claimMission(meta, list, i, rand); });
  for (const list of ['daily', 'weekly']) K.claimSweep(meta, list);
  for (const m of K.MILESTONES) K.claimMilestone(meta, m.id, rand);
}
function spend() {
  if (!OLD) { claimAll(); equipGear(); }
  if (!OLD && !meta.perm.plast && meta.shards > K.permCost(meta, 'plast') * 3) { meta.shards -= K.permCost(meta, 'plast'); meta.perm.plast = 1; }
  for (const a of K.ABILITIES) if (!meta.abilities[a.id] && K.abilityUnlocked(meta, a.id) && meta.shards >= a.cost * 1.5) { meta.shards -= a.cost; meta.abilities[a.id] = true; }
  if (!meta.autocast && meta.shards >= K.AUTOCAST_COST * 1.5 && meta.abilities.pulse) { meta.shards -= K.AUTOCAST_COST; meta.autocast = true; }
  // keep lab busy: cheapest available research first
  for (;;) {
    if (meta.lab.length >= K.researchSlots(meta)) break;
    const opts = K.RESEARCH.filter((r) => K.researchAvailable(meta, r.id) && !K.isResearching(meta, r.id))
      .map((r) => [r.id, K.researchCost(meta, r.id)]).filter((x) => isFinite(x[1])).sort((a, b) => a[1] - b[1]);
    if (!opts.length || opts[0][1] > meta.shards) break;
    K.startResearch(meta, opts[0][0], now);
  }
  // workshop: cheapest first
  for (;;) {
    let best = null;
    for (const u of K.PERM_UPGRADES) { if (u.id === 'plast') continue; const c = K.permCost(meta, u.id); if (!best || c < best[1]) best = [u.id, c]; }
    if (!best || best[1] > meta.shards) break;
    meta.shards -= best[1]; meta.perm[best[0]] = (meta.perm[best[0]] || 0) + 1;
    K.track(meta, 'workshop', 1, now);
  }
}

let now = 0;
let lastTierResult = {};
const lastTry = {};
let sessionNo = 0;
const log = [];
for (let day = 1; day <= DAYS; day++) {
  let dayRuns = [];
  for (const hr of P.sessions) {
    now = ((day - 1) * 24 + hr) * 3600 * 1000;
    // offline earnings since last session
    const away = (now - meta.lastSeen) / 1000;
    if (meta.lastSeen) meta.shards += K.offlineShards(meta, away);
    K.collectResearch(meta, now);
    spend();
    // play the highest tier unless the last attempt there was poor
    // play the highest tier; after a poor attempt there, farm one tier lower for 2 sessions
    let tier = meta.maxTier;
    if (tier > 1 && (lastTierResult[tier] || 99) < 15 && (sessionNo - (lastTry[tier] || -99)) < 3) tier--;
    if (tier === meta.maxTier) lastTry[tier] = sessionNo;
    sessionNo++;
    const r = simulateRun(tier);
    lastTierResult[tier] = r.wave;
    if (process.env.V) console.log(`  d${day} T${tier} w${r.wave} ${r.minutes.toFixed(0)}m +${r.shards}`);
    const got = K.finishRun(r.run, meta);
    meta.shards += got * (P.runsPer - 1);
    meta.runs += P.runsPer - 1;
    if (!OLD) for (let k = 1; k < P.runsPer; k++) { K.track(meta, 'runs', 1, now); K.track(meta, 'kills', r.run.kills, now); K.track(meta, 'wardens', r.run.bossKills, now); K.track(meta, 'waves', r.wave - 1, now); }
    dayRuns.push({ tier, ...r });
    now += r.minutes * 60 * 1000 * P.runsPer;
    meta.lastSeen = now;
    K.collectResearch(meta, now);
    spend();
  }
  if (day % EVERY === 0 || day === 1 || day === DAYS) {
    const top = dayRuns.reduce((a, b) => (b.tier > a.tier || (b.tier === a.tier && b.wave > a.wave) ? b : a));
    const relicCount = K.RELICS.reduce((a, r) => a + K.relicLv(meta, r.id), 0) + '/' + K.RELICS.length * K.RELIC_MAX;
    const gear = (meta.loadout || []).map((id) => id.slice(2) + K.gearRarity(meta, id)).join(',');
    log.push(`day ${String(day).padStart(3)}: tier ${top.tier} wave ${String(top.wave).padStart(3)} (${top.minutes.toFixed(0)} min) | maxTier ${meta.maxTier} | runs ${meta.runs} | research ${Object.values(meta.research).reduce((a, b) => a + b, 0)} lv | relics ${relicCount} | workshop dmg ${meta.perm.pdmg || 0} | gear ${gear}`);
    console.log(log[log.length - 1]);
  }
}

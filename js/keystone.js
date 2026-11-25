import * as K from './keystone-engine.js';
import { h, icon, iconBtn, store, sheet, toast, haptic, fmtTime, backupNow } from './core.js';

// ---------- persistence ----------
export function loadMeta() {
  const raw = store.get('ks:meta', {});
  // safety net: copy everything before the save format is changed
  if (raw && Object.keys(raw).length && raw.v !== K.VERSION) backupNow(`before Keystone update (save v${raw.v || 1})`);
  return K.migrateMeta(raw);
}
// Guard: never let a smaller profile (fewer runs or a lower tier) overwrite a
// bigger one. That can only happen through a bug, so keep the stored one.
function saveMeta(m) {
  const cur = store.get('ks:meta', null);
  if (cur && ((cur.runs || 0) > (m.runs || 0) || (cur.maxTier || 1) > (m.maxTier || 1))) {
    if (!saveMeta.warned) { saveMeta.warned = true; backupNow('blocked a smaller save'); console.warn('Keystone: refused to overwrite a larger save'); }
    return;
  }
  store.set('ks:meta', m);
}
const loadRun = () => store.get('ks:run');
const saveRun = (run) => store.set('ks:run', K.snapshot(run));
const clearRun = () => store.del('ks:run');

// ---------- number formatting ----------
const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
export function fmtNum(x) {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 1000) return x < 10 && x % 1 ? x.toFixed(1) : String(Math.floor(x));
  let i = 0;
  while (Math.abs(x) >= 1000 && i < SUF.length - 1) { x /= 1000; i++; }
  if (Math.abs(x) >= 1000) return (x * Math.pow(1000, i)).toExponential(2).replace('+', '');
  return (x < 100 ? x.toFixed(x < 10 ? 2 : 1) : Math.floor(x)) + SUF[i];
}
function fmtStat(u, v, ctx) {
  switch (u.fmt) {
    case 'dist': return `+${(v * 100).toFixed(1)}% per 100 range`;
    case 'shots': return `${v} shot${v === 1 ? '' : 's'}`;
    case 'freepct': return `${Math.round(v * 100)}% per wave`;
    case 'levels': return `${v} level${v === 1 ? '' : 's'}`;
    case 'interest': return `${(v * 100).toFixed(1)}% per wave`;
    case 'thresh': return ctx && ctx.maxHp ? `${fmtNum(ctx.maxHp * v)} per hit` : `${(v * 100).toFixed(1)}% of health`;
    case 'rate': return v.toFixed(2) + '/s';
    case 'int': return String(Math.round(v));
    case 'pct': return Math.round(v * 100) + '%';
    case 'pctx': return (v * 100).toFixed(1) + '%';
    case 'mult': return '×' + v.toFixed(1);
    case 'plus': return '+' + Math.round(v * 100) + '%';
    case 'regen': return fmtNum(v) + '/s';
    case 'wave': return fmtNum(v) + '×wave';
    case 'bounce': return v + (v === 1 ? ' bounce' : ' bounces');
    case 'wallpct': return Math.round(v * 100) + '% of health';
    default: return fmtNum(v);
  }
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// keep "last seen" fresh while the game is open, for offline earnings
function touch(meta) { meta.lastSeen = Date.now(); saveMeta(meta); }

const ABILITY_ICON = {
  pulse: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="10.5" opacity=".5"/>',
  freeze: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  overdrive: '<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor"/>',
  repair: '<path d="M12 5v14M5 12h14" stroke-width="3.2"/>',
  orbit: '<circle cx="12" cy="12" r="8" stroke-dasharray="4 3"/><circle cx="12" cy="4" r="2" fill="currentColor"/><circle cx="12" cy="20" r="2" fill="currentColor"/>',
  chain: '<path d="M4 4l6 6-3 2 8 8M14 4l3 4-2 2 5 4"/>',
  auto: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
};
const abIcon = (id) => { const s = icon('plus'); s.innerHTML = ABILITY_ICON[id]; return s; };
const RARITY_COLOR = { common: '#8a94a6', rare: '#4f8fe0', epic: '#b26ee0' };
function relicGlyph(r, owned) {
  const el = h('div', { class: 'ks-relic-glyph' + (owned ? '' : ' unknown'), style: { '--rc': RARITY_COLOR[r.rarity] } });
  el.innerHTML = owned ? `<svg viewBox="0 0 24 24"><polygon points="12,2 21,8 18,20 6,20 3,8" fill="currentColor" opacity=".9"/><polygon points="12,6 16,9 14.5,16 9.5,16 8,9" fill="#fff" opacity=".35"/></svg>` : '?';
  return el;
}

function gearGlyph(id, r) {
  const el = h('div', { class: 'ks-relic-glyph', style: { '--rc': K.RARITY_COLORS[r] } });
  const shapes = { g_barrel: '<rect x="4" y="9" width="16" height="6" rx="2"/>', g_clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2" stroke="#fff" stroke-width="1.6" fill="none"/>', g_scope: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.4"/>', g_plate: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>', g_heart: '<path d="M12 20s-7-4.4-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>', g_purse: '<circle cx="12" cy="13" r="7"/><rect x="9" y="3" width="6" height="4" rx="1"/>', g_prism: '<polygon points="12,3 21,20 3,20"/>', g_fang: '<path d="M6 4h12l-6 17z"/>', g_stone: '<rect x="4" y="6" width="16" height="12" rx="2"/>', g_glass: '<path d="M7 3h10l-4 9 4 9H7l4-9z"/>', g_crown: '<path d="M3 18l2-10 4 5 3-7 3 7 4-5 2 10z"/>', g_coin: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="#fff" opacity=".35"/>' };
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${shapes[id] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;
  return el;
}

export function mount(view, params, ui) {
  return params[0] === 'run' ? mountRun(view, ui, params[1] === 'event') : mountLobby(view, ui);
}

// =====================================================================
// Lobby: tier, workshop, research, relics, abilities
// =====================================================================
function mountLobby(view, ui) {
  const meta = loadMeta();
  ui.setTitle(h('span', {}, 'Keystone', h('span', { class: 'mode-pill' }, 'Idle')));
  ui.setActions([iconBtn('help', 'How to play', showHelp)]);

  const notices = [];
  if (meta.migratedRefund != null) {
    const refund = meta.migratedRefund;
    delete meta.migratedRefund;
    notices.push(['Keystone has grown', [
      h('p', {}, 'Keystone now has tiers, a research lab, relics and new enemies, built to keep you progressing for months.'),
      refund ? h('div', { class: 'big-result' }, 'Your old workshop upgrades were refunded', h('b', {}, `+${fmtNum(refund)} shards`)) : null,
      h('p', { class: 'hint' }, 'Your abilities and best wave carry over.')]]);
  }

  // finished research
  const finished = K.collectResearch(meta);
  if (finished.length) setTimeout(() => toast(`Research complete: ${finished.map((id) => K.RESEARCH_BY_ID[id].name).join(', ')}`, 2600), 300);

  // offline earnings
  const away = (Date.now() - (meta.lastSeen || Date.now())) / 1000;
  if (away >= 300 && K.offlineRate(meta) > 0) {
    const gain = K.offlineShards(meta, away);
    if (gain > 0) {
      meta.shards += gain;
      const cap = K.offlineCapHours(meta);
      const hrs = Math.min(cap, away / 3600);
      notices.push(['While you were away', [
        h('div', { class: 'big-result' }, `Your keep stood watch for ${hrs >= 1 ? hrs.toFixed(1) + ' h' : Math.round(away / 60) + ' min'}`, h('b', {}, `+${fmtNum(gain)} shards`)),
        away / 3600 > cap ? h('p', { class: 'hint' }, `Offline earnings cap at ${cap} hours. Research “Long watch” to raise it.`) : null]]);
    }
  }
  if (notices.length) setTimeout(() => sheet(notices[0][0], h('div', {}, ...notices.flatMap(([title, kids], k) => (k ? [h('h3', { style: { marginTop: '22px' } }, title), ...kids] : kids)))), 250);
  touch(meta);

  let section = store.get('ks:section', 'workshop');
  const wrap = h('div', { class: 'home ks-lobby' });
  view.append(wrap);
  const timers = [];

  function draw() {
    timers.length = 0;
    const run = loadRun();
    meta.tier = Math.min(meta.tier || 1, meta.maxTier || 1);

    // ----- hero -----
    const tierOut = h('output', { class: 'ks-tier-out' });
    const tierSub = h('small', {});
    const drawTier = () => {
      tierOut.textContent = `Tier ${meta.tier}`;
      const best = meta.best?.[meta.tier] || 0;
      tierSub.textContent = best ? `Best wave ${best}` : 'Not played yet';
    };
    drawTier();
    const stepTier = (d) => { if (run) return toast('Finish or end your current run first'); meta.tier = Math.max(1, Math.min(meta.maxTier, meta.tier + d)); saveMeta(meta); drawTier(); };
    const nextHint = meta.maxTier ? `Reach wave ${K.TIER_UNLOCK_WAVE} in tier ${meta.maxTier} to unlock tier ${meta.maxTier + 1}` : '';
    const hero = h('section', { class: 'game-card ks-hero', style: { '--c': 'var(--idle)' } },
      h('div', { class: 'ks-hero-art', html: HERO_SVG }),
      h('div', { class: 'ks-hero-stats' },
        h('div', { class: 'ks-shards' }, h('span', { class: 'ks-gem' }), fmtNum(Math.floor(meta.shards)), h('small', {}, ' shards')),
        h('div', { class: 'sub' }, `Highest tier ${meta.maxTier} · ${meta.runs || 0} runs`)),
      h('div', { class: 'ks-tier' },
        h('button', { class: 'ks-tier-btn', 'aria-label': 'Lower tier', disabled: run || meta.tier <= 1, onclick: () => stepTier(-1) }, '−'),
        h('div', { class: 'ks-tier-mid' }, tierOut, tierSub),
        h('button', { class: 'ks-tier-btn', 'aria-label': 'Higher tier', disabled: run || meta.tier >= meta.maxTier, onclick: () => stepTier(1) }, '+')),
      h('p', { class: 'hint ks-tier-hint' }, nextHint),
      h('div', { class: 'card-actions' },
        run
          ? h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), `Resume · W${run.wave}`)
          : h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), `Start tier ${meta.tier}`),
        run ? h('button', { class: 'btn btn-soft', onclick: abandon }, 'End run') : null),
    );

    // ----- section tabs -----
    const labBusy = (meta.lab || []).length;
    const claimable = K.unclaimedCount(meta);
    const tabs = h('div', { class: 'ks-sections' }, ...[
      ['event', K.eventClaimable(meta) ? `Event · ${K.eventClaimable(meta)}` : 'Event'],
      ['workshop', 'Workshop'], ['research', `Research${labBusy ? ` · ${labBusy}` : ''}`], ['gear', 'Gear'],
      ['missions', claimable ? `Missions · ${claimable}` : 'Missions'], ['build', 'Build'], ['abilities', 'Abilities'], ['relics', 'Relics'], ['records', 'Records'],
    ].map(([id, label]) =>
      h('button', { class: 'chip' + (id === 'missions' && claimable ? ' ks-dot' : ''), 'aria-pressed': String(section === id), onclick: () => { section = id; store.set('ks:section', id); draw(); } }, label)));

    let body;
    if (section === 'workshop') body = drawWorkshop();
    else if (section === 'research') body = drawResearch();
    else if (section === 'relics') body = drawRelics();
    else if (section === 'gear') body = drawGear();
    else if (section === 'missions') body = drawMissions();
    else if (section === 'build') body = drawBuild();
    else if (section === 'records') body = drawRecords();
    else if (section === 'event') body = drawEvent();
    else body = drawAbilities();

    const rate = K.offlineRate(meta);
    wrap.replaceChildren(hero, tabs, body,
      h('p', { class: 'hint' }, rate > 0 ? `Earning ${fmtNum(rate)} shards/hour while away (up to ${K.offlineCapHours(meta)} h)` : 'Reach a wave to start earning shards while away'));
  }

  function drawWorkshop() {
    return h('div', { class: 'set-group' }, ...K.PERM_UPGRADES.map((u) => {
      const L = meta.perm[u.id] || 0;
      const cost = K.permCost(meta, u.id);
      return h('div', { class: 'set-item' },
        h('div', { class: 'lbl' }, u.name, h('span', { class: 'ks-lvl' }, `Lv ${L}${u.max ? '/' + u.max : ''}`), h('small', {}, `${u.desc} per level · now ${permNow(u, meta)}`)),
        cost === Infinity ? h('span', { class: 'ks-owned' }, 'Max') : costBtn(cost, () => { meta.shards -= cost; meta.perm[u.id] = L + 1; K.track(meta, 'workshop', 1); haptic(10); save(); }));
    }));
  }

  function drawResearch() {
    const slots = K.researchSlots(meta);
    const active = h('div', { class: 'ks-lab' });
    for (let k = 0; k < 3; k++) {
      const job = meta.lab[k];
      if (k >= slots) {
        active.append(h('div', { class: 'ks-slot locked' }, h('b', {}, 'Locked'), h('small', {}, `Unlocks at tier ${k === 1 ? 3 : 6}`)));
      } else if (!job) {
        active.append(h('div', { class: 'ks-slot empty' }, h('b', {}, 'Empty slot'), h('small', {}, 'Pick a project below')));
      } else {
        const u = K.RESEARCH_BY_ID[job.id];
        const bar = h('i', {});
        const left = h('small', {});
        const tick = () => {
          const now = Date.now();
          const frac = Math.min(1, (now - job.start) / (job.end - job.start));
          bar.style.width = `${frac * 100}%`;
          left.textContent = job.end <= now ? 'Done!' : `${fmtDur((job.end - now) / 1000)} left`;
        };
        tick();
        timers.push(tick);
        active.append(h('div', { class: 'ks-slot' }, h('b', {}, `${u.name} → Lv ${(meta.research[u.id] || 0) + 1}`), h('div', { class: 'ks-bar' }, bar), left));
      }
    }
    const full = meta.lab.length >= slots;
    const list = h('div', { class: 'set-group' }, ...K.RESEARCH.map((u) => {
      const L = meta.research[u.id] || 0;
      if (!K.researchAvailable(meta, u.id)) {
        return h('div', { class: 'set-item dim' }, h('div', { class: 'lbl' }, u.name, h('small', {}, `Unlocks at tier ${u.tier}`)), h('span', { class: 'ks-owned muted' }, '🔒'));
      }
      const cost = K.researchCost(meta, u.id);
      const busy = K.isResearching(meta, u.id);
      const ctl = cost === Infinity ? h('span', { class: 'ks-owned' }, 'Max')
        : busy ? h('span', { class: 'ks-owned' }, 'In lab')
        : costBtn(cost, () => { if (K.startResearch(meta, u.id)) { haptic(12); save(); } }, full);
      return h('div', { class: 'set-item' },
        h('div', { class: 'lbl' }, u.name, h('span', { class: 'ks-lvl' }, `Lv ${L}${u.max ? '/' + u.max : ''}`),
          h('small', {}, `${u.desc} per level · ${cost === Infinity ? 'complete' : 'takes ' + fmtDur(K.researchTime(meta, u.id))}`)),
        ctl);
    }));
    return h('div', {}, active, full ? h('p', { class: 'hint' }, 'All lab slots are busy.') : null, list);
  }

  function drawRelics() {
    const owned = meta.relics || {};
    const total = K.RELICS.reduce((s, r) => s + K.relicLv(meta, r.id), 0);
    const grid = h('div', { class: 'ks-relics' }, ...K.RELICS.map((r) => {
      const n = owned[r.id] || 0;
      const lv = K.relicLv(meta, r.id);
      const toNext = lv < K.RELIC_MAX ? `${n - K.relicCopiesFor(lv)}/${K.relicCopiesFor(lv + 1) - K.relicCopiesFor(lv)} to next` : 'Max level';
      const lockedTier = r.tier > (meta.maxTier || 1);
      return h('div', { class: 'ks-relic' + (n ? '' : ' none') },
        relicGlyph(r, n > 0),
        h('b', {}, n ? r.name : '???'),
        h('small', {}, n ? `${r.desc} per level` : lockedTier ? `Drops from tier ${r.tier}` : `${r.rarity[0].toUpperCase() + r.rarity.slice(1)} · not found yet`),
        n ? h('span', { class: 'ks-lvl' }, `Lv ${lv}/${K.RELIC_MAX} · ${toNext}`) : null);
    }));
    return h('div', {},
      h('p', { class: 'hint' }, `Wardens (every ${K.BOSS_EVERY}th wave) have a ${Math.round(K.relicDropChance(meta, meta.maxTier) * 100)}% chance to drop a relic in tier ${meta.maxTier}. Duplicates level a relic up. ${total} of ${K.RELICS.length * K.RELIC_MAX} relic levels found.`),
      grid);
  }

  function drawAbilities() {
    return h('div', { class: 'set-group' },
      ...K.ABILITIES.map((a) => {
        const owned = !!meta.abilities[a.id];
        const unlocked = K.abilityUnlocked(meta, a.id);
        return h('div', { class: 'set-item' + (unlocked ? '' : ' dim') },
          h('div', { class: 'ks-ab-ico' + (owned ? ' on' : '') }, abIcon(a.id)),
          h('div', { class: 'lbl' }, a.name, h('small', {}, `${a.desc} · ${Math.round(K.abilityCd(meta, a))}s cooldown`)),
          owned ? h('span', { class: 'ks-owned' }, 'Ready')
            : !unlocked ? h('span', { class: 'ks-owned muted' }, `Tier ${a.tier}`)
            : costBtn(a.cost, () => { meta.shards -= a.cost; meta.abilities[a.id] = true; haptic(15); save(); }));
      }),
      h('div', { class: 'set-item' },
        h('div', { class: 'ks-ab-ico' + (meta.autocast ? ' on' : '') }, abIcon('auto')),
        h('div', { class: 'lbl' }, 'Autocast', h('small', {}, 'Abilities fire on their own when they’d help most')),
        meta.autocast ? toggleEl(meta.autoOn !== false, (v) => { meta.autoOn = v; save(false); })
          : costBtn(K.AUTOCAST_COST, () => { meta.shards -= K.AUTOCAST_COST; meta.autocast = true; meta.autoOn = true; haptic(15); save(); })),
    );
  }


  // ----- Gear -----
  function drawGear() {
    const slots = K.gearSlots(meta);
    meta.loadout = (meta.loadout || []).filter((id) => K.gearRarity(meta, id) >= 0).slice(0, slots);
    const eq = h('div', { class: 'ks-loadout' });
    for (let k = 0; k < 6; k++) {
      const id = meta.loadout[k];
      if (k >= slots) { eq.append(h('div', { class: 'ks-gslot locked' }, h('small', {}, `Tier ${[0, 0, 3, 5, 8, 12][k]}`))); continue; }
      if (!id) { eq.append(h('div', { class: 'ks-gslot empty' }, h('small', {}, 'Empty'))); continue; }
      const r = K.gearRarity(meta, id);
      eq.append(h('button', { class: 'ks-gslot', style: { '--rc': K.RARITY_COLORS[r] }, onclick: () => { meta.loadout = meta.loadout.filter((x) => x !== id); save(); } },
        gearGlyph(id, r), h('small', {}, K.GEAR_BY_ID[id].name)));
    }
    const list = h('div', { class: 'set-group' }, ...K.GEAR.map((g) => {
      const r = K.gearRarity(meta, g.id);
      if (r < 0) return h('div', { class: 'set-item dim' }, h('div', { class: 'ks-ab-ico' }, '?'), h('div', { class: 'lbl' }, '???', h('small', {}, 'Not found yet · Wardens and milestones drop gear')));
      const c = meta.gear[g.id];
      const on = meta.loadout.includes(g.id);
      const nextR = r + 1 < K.RARITIES.length ? `${c[r]}/${K.MERGE} toward ${K.RARITIES[r + 1]}` : 'Highest rarity';
      return h('div', { class: 'set-item' },
        gearGlyph(g.id, r),
        h('div', { class: 'lbl' }, g.name, h('span', { class: 'ks-rar', style: { color: K.RARITY_COLORS[r] } }, K.RARITIES[r]),
          h('small', {}, `${g.desc(g.v[r])} · ${nextR}`)),
        h('button', { class: 'btn ' + (on ? 'btn-soft' : 'ks-cost'), style: { flex: 'none' }, disabled: !on && meta.loadout.length >= slots, onclick: () => {
          meta.loadout = on ? meta.loadout.filter((x) => x !== g.id) : [...meta.loadout, g.id];
          haptic(8); save();
        } }, on ? 'Unequip' : 'Equip'));
    }));
    return h('div', {},
      h('p', { class: 'hint' }, `Equip up to ${slots} pieces. Three copies of a rarity merge into the next rarity automatically.`),
      eq, list);
  }

  // ----- Missions & milestones -----
  function drawMissions() {
    const M = K.refreshMissions(meta);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - ((now.getDay() + 6) % 7)));
    const row = (text, prog, n, done, claimed, reward, onClaim, tag) => h('div', { class: 'set-item' + (claimed ? ' dim' : '') },
      h('div', { class: 'lbl' }, tag ? h('span', { class: 'ks-tag ks-tag-' + tag.toLowerCase() }, tag) : null, text,
        h('div', { class: 'ks-bar', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.min(100, (prog / n) * 100)}%` } })),
        h('small', {}, `${fmtNum(Math.min(prog, n))} / ${fmtNum(n)} · reward ${fmtNum(reward)} shards`)),
      claimed ? h('span', { class: 'ks-owned' }, '✓') : h('button', { class: 'btn ks-cost' + (done ? '' : ' off'), style: { flex: 'none' }, disabled: !done, onclick: onClaim }, 'Claim'));
    const list = (kind) => {
      const rows = M[kind].map((m, i) => row(K.missionText(m), m.prog, m.n, m.prog >= m.n, m.claimed, K.missionReward(meta, kind), () => {
        const got = K.claimMission(meta, kind, i);
        if (got) { toast(`+${fmtNum(got)} shards`); haptic(15); save(); }
      }, K.missionCat(m)));
      const sw = K.sweepStatus(meta, kind);
      rows.push(row(`Clear all ${sw.total} ${kind} missions`, sw.done, sw.total, sw.done >= sw.total, sw.claimed, sw.reward, () => {
        const got = K.claimSweep(meta, kind);
        if (got) { toast(`Full set! +${fmtNum(got)} shards`, 2200); haptic([20, 40, 20]); save(); }
      }, 'Bonus'));
      return rows;
    };
    const ms = K.MILESTONES.filter((m) => !M.done[m.id]).slice(0, 8);
    return h('div', {},
      h('p', { class: 'hint', style: { textAlign: 'left', margin: '0 4px 4px' } }, 'Each set mixes five play styles. Stick to one habit and you’ll leave shards behind; clear the whole set for a bonus.'),
      h('div', { class: 'menu-cap' }, `Daily · resets in ${fmtDur((midnight - now) / 1000)}`), h('div', { class: 'set-group' }, ...list('daily')),
      h('div', { class: 'menu-cap' }, `Weekly · resets in ${fmtDur((monday - now) / 1000)}`), h('div', { class: 'set-group' }, ...list('weekly')),
      h('div', { class: 'menu-cap' }, 'Milestones'),
      h('div', { class: 'set-group' }, ...ms.map((m) => {
        const v = K.milestoneValue(meta, m.key);
        return row(m.text + (m.gear ? ' · + gear' : ''), v, m.n, v >= m.n, false, K.milestoneReward(meta, m), () => {
          const res = K.claimMilestone(meta, m.id);
          if (res) { toast(`+${fmtNum(res.shards)} shards${res.gear ? ` · ${K.RARITIES[res.gear.rarity]} ${K.GEAR_BY_ID[res.gear.id].name}` : ''}`, 2600); haptic(15); save(); }
        });
      })),
      h('p', { class: 'hint' }, `${Object.keys(M.done).length} of ${K.MILESTONES.length} milestones complete`));
  }

  // ----- Build: schematics, auto-buy, perks -----
  function drawBuild() {
    const choose = (id) => { meta.schematic = id; if (id === 'custom' && !meta.customSchematic) meta.customSchematic = { ...K.SCHEMATICS[0].w }; save(); };
    const opts = [...K.SCHEMATICS, { id: 'custom', name: 'Custom', desc: 'Set your own priorities below' }];
    const group = h('div', { class: 'set-group' }, ...opts.map((x) => h('button', { class: 'set-item ks-choice' + (meta.schematic === x.id ? ' on' : ''), onclick: () => choose(x.id) },
      h('span', { class: 'ks-radio' }), h('div', { class: 'lbl', style: { textAlign: 'left' } }, x.name, h('small', {}, x.desc)))));
    const toggles = h('div', { class: 'set-group' },
      h('div', { class: 'set-item' }, h('div', { class: 'lbl' }, 'Auto-buy upgrades', h('small', {}, 'Spend coins during runs following your schematic')), toggleEl(!!meta.autoBuy, (v) => { meta.autoBuy = v; save(false); })),
      h('div', { class: 'set-item' }, h('div', { class: 'lbl' }, 'Pick perks for me', h('small', {}, 'Choose perks automatically to suit your schematic')), toggleEl(meta.autoPerk !== false, (v) => { meta.autoPerk = v; save(false); })));
    let editor = null;
    if (meta.schematic === 'custom') {
      const w = meta.customSchematic || (meta.customSchematic = { ...K.SCHEMATICS[0].w });
      editor = h('div', {}, h('div', { class: 'menu-cap' }, 'Custom priorities (0 = never buy)'),
        h('div', { class: 'set-group' }, ...K.RUN_UPGRADES.map((u) => {
          const out = h('output', {}, String(w[u.id] || 0));
          const set = (d) => { w[u.id] = Math.max(0, Math.min(4, (w[u.id] || 0) + d)); out.textContent = String(w[u.id]); saveMeta(meta); };
          return h('div', { class: 'set-item' + ((u.tier || 1) > meta.maxTier ? ' dim' : '') },
            h('div', { class: 'lbl' }, u.name, (u.tier || 1) > meta.maxTier ? h('small', {}, `Unlocks at tier ${u.tier}`) : null),
            h('div', { class: 'mini-step' }, h('button', { onclick: () => set(-1), 'aria-label': 'Lower' }, '−'), out, h('button', { onclick: () => set(1), 'aria-label': 'Higher' }, '+')));
        })));
    }
    return h('div', {}, h('div', { class: 'menu-cap' }, 'Schematic'), group, h('div', { class: 'menu-cap' }, 'Automation'), toggles, editor);
  }

  // ----- Monthly event -----
  function drawEvent() {
    const ev = K.currentEvent();
    const E = K.refreshEvent(meta);
    const th = ev.theme;
    const left = (ev.endsAt - Date.now()) / 1000;
    const run = loadRun();
    const head = h('section', { class: 'ks-event-head', style: { '--ev': th.color } },
      h('div', { class: 'ks-event-kicker' }, `${new Date().toLocaleDateString(undefined, { month: 'long' })} event · ends in ${fmtDur(left)}`),
      h('h3', {}, th.name),
      h('p', {}, th.desc),
      h('div', { class: 'ks-event-row' },
        h('div', { class: 'ks-tokens' }, h('span', { class: 'ks-token' }), h('b', {}, fmtNum(E.tokens)), h('small', {}, ` tokens · ${fmtNum(E.earned)} earned`)),
        run ? h('button', { class: 'btn btn-soft', style: { flex: 'none' }, onclick: () => ui.go('#/keystone/run') }, run.event ? 'Resume event run' : 'Finish current run first')
          : h('button', { class: 'btn btn-primary', style: { '--c': th.color, color: '#111', flex: 'none' }, onclick: () => ui.go('#/keystone/run/event') }, icon('play'), `Event run · T${meta.tier}`)),
      h('p', { class: 'hint', style: { textAlign: 'left', margin: '8px 0 0' } }, 'Event runs earn tokens (more for higher waves and Wardens) but don’t count toward tier unlocks or best waves. Tokens reset when the month ends.'));

    // challenges
    const ch = h('div', { class: 'set-group' }, ...K.EVENT_CHALLENGES.map((c) => {
      const prog = E.prog[c.id] || 0;
      let next = c.steps.findIndex((v, i) => !E.steps[`${c.id}${i}`]);
      const allDone = next < 0;
      if (allDone) next = c.steps.length - 1;
      const target = c.steps[next];
      const ready = !allDone && prog >= target;
      const pips = h('div', { class: 'ks-pips' }, ...c.steps.map((v, i) => h('i', { class: E.steps[`${c.id}${i}`] ? 'on' : prog >= v ? 'ready' : '' })));
      return h('div', { class: 'set-item' + (allDone ? ' dim' : '') },
        h('div', { class: 'lbl' }, c.text(target), pips,
          h('div', { class: 'ks-bar', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.min(100, (prog / target) * 100)}%`, background: th.color } })),
          h('small', {}, `${fmtNum(Math.min(prog, target))} / ${fmtNum(target)} · ${c.tokens[next]} tokens`)),
        allDone ? h('span', { class: 'ks-owned' }, '✓')
          : h('button', { class: 'btn ks-cost' + (ready ? '' : ' off'), style: { flex: 'none' }, disabled: !ready, onclick: () => { const got = K.claimEventStep(meta, c.id, next); if (got) { toast(`+${got} tokens`); haptic(15); save(); } } }, 'Claim'));
    }));

    // tree
    const nodes = K.eventNodes();
    const nodeEl = (n) => {
      const owned = !!E.nodes[n.id];
      const open = n.needs.every((x) => E.nodes[x]);
      const can = !owned && open && E.tokens >= n.cost;
      const label = K.eventRewardText(meta, n.reward);
      return h('button', { class: 'ks-node' + (owned ? ' owned' : can ? ' can' : open ? ' open' : ''), style: { '--ev': th.color }, disabled: owned || !can,
        onclick: () => {
          const res = K.unlockNode(meta, n.id);
          if (!res) return;
          haptic([15, 30, 15]);
          let msg = label;
          if (res.gear) msg = `${K.RARITIES[res.gear.rarity]} ${K.GEAR_BY_ID[res.gear.id].name}`;
          if (res.relics) msg = `Relics: ${res.relics.map((r) => K.RELICS.find((x) => x.id === r).name).join(', ')}`;
          if (res.skin) msg = `New keep colour: ${th.name}`;
          toast(msg, 2600); save();
        } },
        h('small', {}, owned ? '✓' : `${n.cost}`), h('b', {}, label));
    };
    const cols = h('div', { class: 'ks-tree' }, ...K.EVENT_BRANCHES.map((b) => h('div', { class: 'ks-branch' },
      h('div', { class: 'ks-branch-name' }, b.name), ...nodes.filter((n) => n.branch === b.id).map(nodeEl))));
    const cap = nodes.find((n) => n.id === 'capstone');
    const ownedN = Object.keys(E.nodes).length;

    // keep colours
    const skins = Object.keys(meta.skins || {});
    const skinRow = h('div', { class: 'ks-skins' },
      h('button', { class: 'ks-skin' + (!meta.skin ? ' on' : ''), style: { '--sk': 'var(--idle)' }, onclick: () => { meta.skin = null; save(); } }, h('i'), h('small', {}, 'Classic')),
      ...K.EVENT_THEMES.map((t) => {
        const has = skins.includes(t.id);
        return h('button', { class: 'ks-skin' + (meta.skin === t.id ? ' on' : '') + (has ? '' : ' locked'), style: { '--sk': t.color }, disabled: !has, onclick: () => { meta.skin = t.id; save(); } },
          h('i'), h('small', {}, has ? t.name : '???'));
      }));

    return h('div', {}, head,
      h('div', { class: 'menu-cap' }, 'Event challenges'), ch,
      h('div', { class: 'menu-cap' }, `Event tree · ${ownedN} of ${nodes.length} unlocked`),
      h('p', { class: 'hint', style: { textAlign: 'left', margin: '0 4px 8px' } }, 'Each node needs the one above it. Unlock all three branches to reach the capstone.'),
      cols, h('div', { class: 'ks-cap' }, nodeEl(cap)),
      h('div', { class: 'menu-cap' }, 'Keep colours'), skinRow,
      h('p', { class: 'hint' }, 'Each month’s capstone gives that event’s keep colour, yours to keep.'));
  }

  // ----- Records -----
  function drawRecords() {
    const R = meta.records || {};
    const rows = [
      ['Runs finished', fmtNum(meta.runs || 0)], ['Enemies defeated', fmtNum(R.kills || 0)], ['Wardens defeated', fmtNum(R.wardens || 0)],
      ['Waves cleared', fmtNum(R.waves || 0)], ['Abilities used', fmtNum(R.abilities || 0)], ['Perks chosen', fmtNum(R.perks || 0)],
      ['Shards earned from runs', fmtNum(R.shardsEarned || 0)], ['Best single run', `${fmtNum(R.bestRunShards || 0)} shards`],
      ['Longest run', fmtTime(R.longestRun || 0)], ['Time defending', fmtDur(R.playTime || 0)],
    ];
    const best = Object.entries(meta.best || {}).sort((a, b) => +a[0] - +b[0]);
    return h('div', {},
      h('div', { class: 'set-group' }, ...rows.map(([k, v]) => h('div', { class: 'set-item' }, h('div', { class: 'lbl' }, k), h('b', {}, v)))),
      h('div', { class: 'menu-cap' }, 'Best wave per tier'),
      h('div', { class: 'ks-tiers' }, ...best.map(([t, w]) => h('div', {}, h('small', {}, `Tier ${t}`), h('b', {}, String(w))))),
      h('p', { class: 'hint' }, 'Records count from this update onward, except runs and best waves.'));
  }

  function costBtn(cost, onBuy, blocked = false) {
    const can = meta.shards >= cost && !blocked;
    return h('button', { class: 'btn ks-cost' + (can ? '' : ' off'), style: { flex: 'none' }, disabled: !can, onclick: () => { if (meta.shards >= cost) onBuy(); } },
      h('span', { class: 'ks-gem' }), fmtNum(cost));
  }
  function save(redraw = true) { saveMeta(meta); if (redraw) draw(); }
  function abandon() {
    const r = loadRun();
    if (!r) return;
    const close = sheet('End this run?', h('div', {},
      h('p', { style: { textAlign: 'center', color: 'var(--muted)' } }, `You’ll collect shards for reaching wave ${r.wave}.`),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-soft', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => {
          const run = K.resume(r, meta);
          const got = K.finishRun(run, meta);
          clearRun(); save(); close(); toast(`+${fmtNum(got)} shards`);
        } }, 'End & collect'))));
  }

  draw();
  // live timers: research countdowns, auto-collect, last-seen
  let secs = 0;
  const iv = setInterval(() => {
    timers.forEach((t) => t());
    const done = K.collectResearch(meta);
    if (done.length) { toast(`Research complete: ${done.map((id) => K.RESEARCH_BY_ID[id].name).join(', ')}`, 2600); haptic(15); save(); }
    if (++secs % 15 === 0) touch(meta);
  }, 1000);
  return () => { clearInterval(iv); touch(meta); };
}

function permNow(u, meta) {
  const v = K.permVal(meta, u.id);
  switch (u.id) {
    case 'pstart': return `${fmtNum(Math.floor(v))} coins`;
    case 'pdisc': return `−${Math.round((1 - v) * 100)}%`;
    case 'pcrit': return `+${Math.round(v * 100)}%`;
    case 'prate': case 'poffl': return `+${Math.round((v - 1) * 100)}%`;
    default: return `×${fmtNum(v)}`;
  }
}
function toggleEl(value, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}

function showHelp() {
  sheet('How to play', h('div', {},
    h('p', {}, 'Your keep sits in the middle of the field and fires at the closest shape in range by itself. Waves arrive every 20 seconds and grow tougher; every 10th wave brings a Warden boss.'),
    h('p', {}, h('b', {}, 'Coins'), ' drop from defeated shapes. Spend them during a run on attack, defense and economy upgrades. They reset when the run ends.'),
    h('p', {}, h('b', {}, 'Tiers: '), `reach wave ${K.TIER_UNLOCK_WAVE} to unlock the next tier. Higher tiers have tougher enemies that ramp up over the first waves, new enemy types, and bigger rewards.`),
    h('p', {}, h('b', {}, 'Shards'), ' come from finished runs and from time away. Spend them in the Workshop (permanent upgrades) and the Research lab (bigger upgrades that take real time).'),
    h('p', {}, h('b', {}, 'Relics'), ' sometimes drop from Wardens and give small permanent bonuses. Duplicates level them up.'),
    h('p', {}, h('b', {}, 'Perks: '), `every ${K.PERK_EVERY} waves you choose 1 of 3 perks for the rest of the run (or let them be picked for you).`),
    h('p', {}, h('b', {}, 'Gear'), ' drops from Wardens and milestones. Equip a few pieces before a run; three of a kind merge into a rarer one.'),
    h('p', {}, h('b', {}, 'Build: '), 'choose a schematic and switch on Auto-buy to have upgrades bought for you toward that build.'),
    h('p', {}, h('b', {}, 'Monthly events'), ' change the rules each month. Event runs earn tokens for the event tree (shards, gear, relics and an exclusive keep colour). Tokens and the tree reset at month’s end; rewards stay.'),
    h('p', {}, h('b', {}, 'Missions'), ' refresh daily and weekly; milestones are one-time goals. All pay shards.'),
    h('p', {}, h('b', {}, 'Enemies: '), 'Blocks are steady, Darts fast, Brutes tough, Spitters shoot from range. Later tiers add Bulwarks (shielded until half health), Splitters, Menders (heal others), Phantoms (blink closer) and gold-edged elites.'),
    h('p', { class: 'hint' }, 'Leaving the screen pauses your run; it picks up at the start of the same wave.')));
}

const HERO_SVG = `<svg viewBox="0 0 120 120"><g fill="none" stroke="currentColor" opacity=".25"><circle cx="60" cy="60" r="56"/><circle cx="60" cy="60" r="38" stroke-dasharray="3 4"/></g>
<polygon points="60,44 74,52 74,68 60,76 46,68 46,52" fill="currentColor"/><polygon points="60,52 67,64 53,64" fill="#fff" opacity=".9"/>
<rect x="12" y="20" width="12" height="12" rx="2" fill="#5b8def" transform="rotate(20 18 26)"/><polygon points="100,18 108,32 92,32" fill="#f2c84b"/>
<polygon points="98,92 108,99 104,111 92,111 88,99" fill="#e0843a"/><polygon points="18,88 26,96 18,104 10,96" fill="#c95ad6"/></svg>`;

// =====================================================================
// Run screen
// =====================================================================
function mountRun(view, ui, asEvent = false) {
  const meta = loadMeta();
  K.collectResearch(meta);
  const snap = loadRun();
  const ev = K.currentEvent();
  K.refreshEvent(meta);
  const run = snap ? K.resume(snap, meta) : K.newRun(meta, meta.tier || 1, asEvent ? ev.theme.id : null);
  if (!snap) saveRun(run);
  touch(meta);
  const bestBefore = (meta.best || {})[run.tier] || 0;

  let speed = store.get('ks:speed', 1);
  let paused = false;
  let ended = false;
  let tab = 'attack';
  let qty = store.get('ks:qty', 1);

  // ----- header -----
  speed = Math.min(speed, K.maxSpeed(meta));
  const speedBtn = h('button', { class: 'chip ks-speed', onclick: () => { speed = speed >= K.maxSpeed(meta) ? 1 : speed + 1; store.set('ks:speed', speed); speedBtn.textContent = speed + '×'; } }, speed + '×');
  const theme = run.event ? K.THEME_BY_ID[run.event] : null;
  ui.setTitle(theme
    ? h('span', { class: 'ks-ev-title', style: { '--ev': theme.color } }, theme.name, h('small', {}, ` · T${run.tier}`))
    : h('span', {}, 'Keystone', h('span', { class: 'mode-pill' }, `Tier ${run.tier}`)));
  ui.setActions([speedBtn, iconBtn('pause', 'Pause', openPause)]);

  // ----- HUD -----
  const waveLbl = h('b', {});
  const waveBar = h('i', {});
  const coinsEl = h('b', {});
  const hpBar = h('i', {});
  const hpTxt = h('span', {});
  const wallBar = h('i', {});
  const wallWrap = h('div', { class: 'ks-bar wall' }, wallBar);
  const hud = h('div', { class: 'ks-hud' },
    h('div', { class: 'ks-hud-wave' }, h('div', {}, 'Wave ', waveLbl), h('div', { class: 'ks-bar' }, waveBar)),
    h('div', { class: 'ks-hud-coins' }, h('span', { class: 'ks-coin' }), coinsEl),
    h('div', { class: 'ks-hud-hp' }, h('div', { class: 'ks-bar hp' }, hpBar), wallWrap, hpTxt));

  // ----- canvas -----
  const canvas = h('canvas', { class: 'ks-canvas' });
  const stage = h('div', { class: 'ks-stage' }, canvas);
  const ctx = canvas.getContext('2d');

  // ----- abilities -----
  const abBtns = {};
  const abRow = h('div', { class: 'ks-abilities' });
  for (const a of K.ABILITIES) {
    if (!meta.abilities[a.id]) continue;
    const b = h('button', { class: 'ks-ab', 'aria-label': a.name, onclick: () => { if (K.useAbility(run, meta, a.id, pendingEvents)) haptic(20); } },
      h('span', { class: 'ks-ab-ring' }), abIcon(a.id), h('small', {}, a.name));
    abBtns[a.id] = b;
    abRow.append(b);
  }
  if (meta.autocast) {
    const auto = h('button', { class: 'ks-ab ks-auto' + (meta.autoOn !== false ? ' on' : ''), onclick: () => { meta.autoOn = meta.autoOn === false; auto.classList.toggle('on', meta.autoOn); saveMeta(meta); toast(meta.autoOn ? 'Autocast on' : 'Autocast off'); } },
      h('span', { class: 'ks-ab-ring' }), abIcon('auto'), h('small', {}, 'Autocast'));
    abRow.append(auto);
  }

  // ----- upgrade panel -----
  const tabs = h('div', { class: 'seg ks-tabs' });
  const qtySeg = h('div', { class: 'seg' });
  const list = h('div', { class: 'ks-list' });
  const rows = {};
  const available = K.runUpgradesFor(run.tier);
  function drawTabs() {
    tabs.replaceChildren(...[['attack', 'Attack'], ['defense', 'Defense'], ['economy', 'Economy']].map(([id, l]) =>
      h('button', { 'aria-pressed': String(tab === id), onclick: () => { tab = id; drawTabs(); buildList(); } }, l)));
    qtySeg.replaceChildren(...[[1, '×1'], [10, '×10'], ['max', 'Max']].map(([v, l]) =>
      h('button', { 'aria-pressed': String(qty === v), onclick: () => { qty = v; store.set('ks:qty', v); drawTabs(); refreshList(); } }, l)));
  }
  function buildList() {
    list.replaceChildren();
    for (const k in rows) delete rows[k];
    for (const u of available.filter((x) => x.tab === tab)) {
      const val = h('small', {});
      const lv = h('span', { class: 'ks-lvl' });
      const btn = h('button', { class: 'btn ks-buy' });
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (K.buy(run, meta, u.id, qty)) { haptic(8); refreshList(); } });
      list.append(h('div', { class: 'ks-row' }, h('div', { class: 'lbl' }, u.name, lv, val), btn));
      rows[u.id] = { val, lv, btn, u };
    }
    refreshList();
  }
  function refreshList() {
    for (const id in rows) {
      const { val, lv, btn, u } = rows[id];
      const L = run.levels[id] || 0;
      const maxed = u.max != null && L >= u.max;
      lv.textContent = `Lv ${L}${u.max ? '/' + u.max : ''}`;
      if (maxed) {
        val.textContent = fmtStat(u, u.val(L), K.stats(run, meta));
        btn.replaceChildren('Max'); btn.disabled = true; btn.classList.add('off');
        continue;
      }
      const c = qty === 'max' ? K.affordable(run, meta, id) : K.runCost(run, meta, id, qty);
      const n = qty === 'max' ? Math.max(1, c.n) : c.n;
      const cost = qty === 'max' && c.n === 0 ? K.runCost(run, meta, id, 1).cost : c.cost;
      const cx = u.id === 'thresh' ? K.stats(run, meta) : null;
      val.textContent = `${fmtStat(u, u.val(L), cx)} → ${fmtStat(u, u.val(L + n), cx)}`;
      const can = cost <= run.coins && n > 0;
      btn.disabled = !can; btn.classList.toggle('off', !can);
      btn.replaceChildren(h('span', { class: 'ks-coin' }), fmtNum(cost), n > 1 ? h('small', {}, ` ×${n}`) : '');
    }
  }
  drawTabs();
  buildList();
  const schemName = () => (meta.schematic === 'custom' ? 'Custom' : (K.SCHEMATICS.find((x) => x.id === meta.schematic) || K.SCHEMATICS[0]).name);
  const autoChip = h('button', { class: 'chip ks-autobuy' + (meta.autoBuy ? ' on' : ''), onclick: () => {
    meta.autoBuy = !meta.autoBuy; saveMeta(meta);
    autoChip.classList.toggle('on', meta.autoBuy);
    toast(meta.autoBuy ? `Auto-buy on · ${schemName()} schematic` : 'Auto-buy off');
  } }, 'Auto-buy');
  const panel = h('div', { class: 'ks-panel' }, h('div', { class: 'ks-panel-top' }, tabs, qtySeg), list);
  ui.setActions([autoChip, speedBtn, iconBtn('pause', 'Pause', openPause)]);
  // perk offer (non-blocking; auto-picked when the next offer arrives)
  const offerEl = h('div', { class: 'ks-offer', hidden: true });
  let offerKey = '';
  function drawOffer() {
    const key = run.offer ? run.offer.join(',') : '';
    if (key === offerKey) return;
    offerKey = key;
    offerEl.hidden = !run.offer;
    if (!run.offer) return;
    offerEl.replaceChildren(h('div', { class: 'ks-offer-title' }, 'Choose a perk'),
      h('div', { class: 'ks-offer-row' }, ...run.offer.map((id) => {
        const pk = K.PERK_BY_ID[id];
        const n = (run.perks || {})[id] || 0;
        return h('button', { class: 'ks-perk', onclick: () => { if (K.choosePerk(run, id)) { K.track(meta, 'perks', 1); haptic(15); banners.push({ text: pk.name, sub: pk.desc, t: 0 }); drawOffer(); refreshList(); } } },
          h('b', {}, pk.name), h('small', {}, pk.desc), n ? h('span', { class: 'ks-lvl' }, `owned ×${n}`) : null);
      })));
  }

  const root = h('div', { class: 'ks-run' }, hud, stage, offerEl, abRow.childNodes.length ? abRow : null, panel);
  view.append(root);

  // ----- sizing -----
  let side = 300, dpr = 1, scale = 1;
  function fit() {
    const w = stage.clientWidth, hh = stage.clientHeight;
    side = Math.max(120, Math.floor(Math.min(w, hh)));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = canvas.style.height = side + 'px';
    canvas.width = canvas.height = Math.floor(side * dpr);
    scale = (side / 2) / (K.R + 26);
  }
  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  fit();

  // ----- effects (UI only) -----
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_PARTS = reduced ? 160 : 520;
  const parts = [];
  const banners = [];
  const hitFlash = new Map(); // enemy id -> seconds of white flash left
  const muzzle = [];          // recent tower shots: { a, t }
  let hurtFlash = 0;
  let wallFlash = 0;
  let lastInterest = 0;
  let lastBlockFx = -1;
  let shake = 0;
  let clock = 0;
  const pendingEvents = [];
  const motes = Array.from({ length: 34 }, () => ({ a: Math.random() * Math.PI * 2, r: 40 + Math.random() * (K.R - 30), s: 0.6 + Math.random() * 1.6, v: (Math.random() - 0.5) * 0.06, ph: Math.random() * 6 }));
  const add = (p) => { if (parts.length < MAX_PARTS) parts.push(p); };
  // kinds: spark (streak), chip (spinning square), coin (flies home), ring (expanding outline), glow (soft blob)
  function sparks(x, y, col, n, sp = 110, life = 0.45) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.35 + Math.random());
      add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.8), t: 0, col, s: 1.4 + Math.random() * 1.8 });
    }
  }
  function chips(x, y, col, n, size) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 70;
      add({ kind: 'chip', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.4, t: 0, col, s: size * (0.25 + Math.random() * 0.25), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
    }
  }
  function coinsHome(x, y, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 50;
      add({ kind: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 2.2, t: 0, col: '#ffd34d', s: 2.6 });
    }
  }
  const ringFx = (x, y, col, max, life = 0.4, w = 5) => add({ kind: 'ring', x, y, life, t: 0, col, max, w });
  const glowFx = (x, y, col, r, life = 0.3) => add({ kind: 'glow', x, y, life, t: 0, col, r });
  const kick = (n) => { if (!reduced) shake = Math.min(10, shake + n); };

  function handle(evs) {
    for (const e of evs) {
      if (e.t === 'kill') {
        const T = K.TYPES[e.type];
        const col = e.elite ? '#ffd34d' : T.color;
        const big = T.boss ? 3 : e.elite ? 1.6 : 1;
        sparks(e.x, e.y, col, Math.round(9 * big), 120 * big);
        chips(e.x, e.y, col, Math.round(4 * big), T.size);
        ringFx(e.x, e.y, col, T.size * 2.8 * big, 0.45 + 0.15 * big, 6 * Math.min(big, 1.6));
        glowFx(e.x, e.y, col, T.size * 3 * big, 0.28);
        coinsHome(e.x, e.y, T.boss ? 14 : e.elite ? 4 : 1 + (Math.random() < 0.5 ? 1 : 0));
        hitFlash.delete(e.id);
        if (T.boss) { haptic(25); kick(7); banners.push({ text: 'Warden defeated!', t: 0 }); }
      } else if (e.t === 'hit' && e.sup) {
        hitFlash.set(e.id, 0.12);
        sparks(e.x, e.y, '#f3c4ff', 10, 200, 0.35); ringFx(e.x, e.y, '#e8a6ff', 26, 0.3, 4); glowFx(e.x, e.y, '#e8a6ff', 30, 0.25);
      } else if (e.t === 'hit') {
        hitFlash.set(e.id, 0.08);
        sparks(e.x, e.y, e.crit ? '#ffe27a' : C.idle, e.crit ? 5 : 2, e.crit ? 140 : 80, 0.25);
        if (e.crit) ringFx(e.x, e.y, '#ffe27a', 16, 0.22, 2);
      } else if (e.t === 'hurt') { hurtFlash = 0.25; kick(1.2); }
      else if (e.t === 'boss') { kick(5); banners.push({ text: 'A Warden approaches', t: 0, warn: true }); }
      else if (e.t === 'blink') { ringFx(e.x, e.y, '#c9b6ff', 22, 0.3, 2); sparks(e.x, e.y, '#c9b6ff', 6, 70, 0.35); }
      else if (e.t === 'ability') {
        if (e.id === 'pulse') { kick(3); for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; add({ kind: 'spark', x: Math.cos(a) * 30, y: Math.sin(a) * 30, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 0.45, t: 0, col: C.idle, s: 2.4 }); } }
        else if (e.id === 'freeze') { for (let k = 0; k < 60; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * K.R; add({ kind: 'glow', x: Math.cos(a) * r, y: Math.sin(a) * r, life: 0.9 + Math.random() * 0.8, t: 0, col: '#bfe8ff', r: 4 + Math.random() * 5 }); } }
        else if (e.id === 'repair') { for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2; add({ kind: 'spark', x: Math.cos(a) * 20, y: Math.sin(a) * 20, vx: Math.cos(a) * 30, vy: -60 - Math.random() * 60, life: 0.9, t: 0, col: '#6fe39a', s: 2.6 }); } }
        else if (e.id === 'overdrive') { ringFx(0, 0, C.idle, 70, 0.5, 4); }
        else if (e.id === 'chain') kick(2);
      } else if (e.t === 'relic') {
        const r = K.RELICS.find((x) => x.id === e.id);
        banners.push({ text: 'Relic found!', sub: `${r.name} · Lv ${K.relicLv(meta, r.id)}`, t: 0, gold: true });
        sparks(e.x, e.y, '#ffd34d', 40, 200, 0.8);
        ringFx(e.x, e.y, '#ffd34d', 90, 0.7, 4);
        kick(3);
        haptic([20, 40, 20]);
        saveMeta(meta);
      } else if (e.t === 'tier') {
        meta.tier = e.tier; // next run starts in the new tier (can be changed at the base)
        banners.push({ text: `Tier ${e.tier} unlocked!`, sub: 'Your next run starts there', t: 0, gold: true });
        ringFx(0, 0, '#ffd34d', K.R, 0.9, 5);
        haptic([20, 40, 20]);
        saveMeta(meta);
      } else if (e.t === 'interest') { lastInterest = e.v; }
      else if (e.t === 'freeup') {
        const u = K.RUN_BY_ID[e.id];
        banners.push({ text: 'Free upgrade!', sub: `${u.name} +${e.n}`, t: 0, gold: true });
        ringFx(0, 0, '#ffd34d', K.TOWER_R + 26, 0.5, 4);
        refreshList();
      } else if (e.t === 'blocked') {
        if (clock - lastBlockFx > 0.25) { lastBlockFx = clock; ringFx(0, 0, '#9fb8d6', K.TOWER_R + 12, 0.25, 3); }
      } else if (e.t === 'wave') {
        const parts2 = [];
        if (e.bonus) parts2.push(`+${fmtNum(e.bonus)} coins`);
        if (lastInterest) parts2.push(`+${fmtNum(lastInterest)} interest`);
        lastInterest = 0;
        banners.push({ text: `Wave ${e.wave}`, sub: parts2.join(' · '), t: 0 });
        ringFx(0, 0, C.idle, K.R * 0.9, 0.8, 2);
        saveRun(run);
      } else if (e.t === 'over') { kick(8); sparks(0, 0, C.idle, 60, 260, 0.9); endRun(); }
      else if (e.t === 'wallhit') { wallFlash = 0.15; if (e.broke) { ringFx(0, 0, '#cfe3f7', K.TOWER_R + 40, 0.5, 4); sparks(0, 0, '#cfe3f7', 18, 160, 0.5); } }
      else if (e.t === 'laststand') { banners.push({ text: 'Last stand!', sub: 'The keep refuses to fall', t: 0, gold: true }); ringFx(0, 0, '#ffd34d', 160, 0.8, 6); kick(6); haptic([30, 50, 30]); }
      else if (e.t === 'gear') {
        const g = K.GEAR_BY_ID[e.id];
        banners.push({ text: 'Gear found!', sub: `${K.RARITIES[e.rarity]} ${g.name}`, t: 0, gold: true });
        sparks(e.x, e.y, K.RARITY_COLORS[e.rarity], 30, 180, 0.7); ringFx(e.x, e.y, K.RARITY_COLORS[e.rarity], 70, 0.6, 4);
        haptic([20, 40, 20]); saveMeta(meta);
      } else if (e.t === 'perks') { if (!meta.autoPerk) haptic(15); }
      else if (e.t === 'perkauto') { const last = run.stats.perks[run.stats.perks.length - 1]; if (last) banners.push({ text: K.PERK_BY_ID[last].name, sub: K.PERK_BY_ID[last].desc, t: 0 }); }
    }
  }

  // ----- colors from theme -----
  let C = {};
  function readColors() {
    const cs = getComputedStyle(root);
    const g = (n, d) => cs.getPropertyValue(n).trim() || d;
    C = { keep: meta.skin && K.THEME_BY_ID[meta.skin] ? K.THEME_BY_ID[meta.skin].color : null, idle: g('--idle', '#22a39a'), text: g('--text', '#222'), muted: g('--muted', '#777'), border: g('--border', '#ccc'), surface: g('--surface', '#fff'), bg2: g('--surface-2', '#eee'), wrong: g('--wrong', '#d44') };
    const m = C.surface.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    C.dark = m ? (parseInt(m[1], 16) * 0.3 + parseInt(m[2], 16) * 0.59 + parseInt(m[3], 16) * 0.11) < 128 : false;
  }
  readColors();
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', readColors);

  // ----- drawing -----
  function shapePath(x, y, r, shape, rot) {
    ctx.beginPath();
    if (shape === 0) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
    if (shape === 'cross') {
      const a = r * 0.38;
      const pts = [[-a, -r], [a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a]];
      const c = Math.cos(rot), s = Math.sin(rot);
      pts.forEach(([px, py], k) => { const X = x + px * c - py * s, Y = y + px * s + py * c; k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath(); return;
    }
    if (shape === 'star') {
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? r * 0.45 : r;
        const a = rot + (k / 10) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); return;
    }
    for (let k = 0; k < shape; k++) {
      const a = rot + (k / shape) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  // Soft radial glow sprites, cached per colour.
  const glowCache = new Map();
  function glowSprite(col) {
    let c = glowCache.get(col);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    // fade to a transparent version of the same colour (avoids dark fringes)
    g.fillStyle = col;
    const rgb = g.fillStyle.startsWith('#') ? [1, 3, 5].map((i) => parseInt(g.fillStyle.slice(i, i + 2), 16)).join(',') : '255,255,255';
    grd.addColorStop(0, `rgba(${rgb},1)`); grd.addColorStop(0.3, `rgba(${rgb},.45)`); grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    glowCache.set(col, c);
    return c;
  }
  function glow(x, y, r, col, alpha) {
    ctx.globalAlpha = alpha * (C.dark ? 1 : 0.55);
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  }
  const additive = () => { ctx.globalCompositeOperation = C.dark ? 'lighter' : 'source-over'; };
  const normal = () => { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; };

  function draw() {
    const s = K.stats(run, meta);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.save();
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(side / 2 + sx, side / 2 + sy);
    ctx.scale(scale, scale);

    // ----- arena -----
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = C.border;
    for (let r = 80; r <= K.R; r += 80) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.globalAlpha = 0.45; ctx.stroke(); }
    // drifting motes
    additive();
    for (const m of motes) {
      m.a += m.v * 0.016;
      const x = Math.cos(m.a) * m.r, y = Math.sin(m.a) * m.r;
      ctx.globalAlpha = (C.dark ? 0.35 : 0.25) * (0.5 + 0.5 * Math.sin(clock * 1.3 + m.ph));
      ctx.fillStyle = C.idle;
      ctx.fillRect(x, y, m.s, m.s);
    }
    normal();
    // range ring: slowly turning dashes with a faint glow
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -clock * 12;
    ctx.strokeStyle = C.idle; ctx.globalAlpha = 0.9; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.arc(0, 0, s.range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.globalAlpha = C.dark ? 0.16 : 0.12; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(0, 0, s.range, 0, Math.PI * 2); ctx.stroke();
    normal();
    if (run.fx.freeze > 0) {
      const f = Math.min(1, run.fx.freeze / 0.5);
      ctx.fillStyle = '#8fd3ff'; ctx.globalAlpha = 0.12 * f; ctx.beginPath(); ctx.arc(0, 0, K.R + 20, 0, Math.PI * 2); ctx.fill();
      normal();
    }

    // ability rings (engine-driven)
    additive();
    for (const r of run.rings) {
      const col = r.kind === 'freeze' ? '#8fd3ff' : r.kind === 'repair' ? '#4caf73' : C.idle;
      const a = Math.max(0, 1 - r.t / 0.6);
      ctx.strokeStyle = col;
      ctx.globalAlpha = a * 0.25; ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r.r), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r.r), 0, Math.PI * 2); ctx.stroke();
    }
    normal();

    // ----- enemies -----
    // glows first (one additive pass), then bodies
    additive();
    for (const e of run.enemies) {
      const T = K.TYPES[e.type];
      if (T.boss) glow(e.x, e.y, e.size * 3.2, '#ff5a5a', 0.45 + 0.15 * Math.sin(clock * 4));
      else glow(e.x, e.y, e.size * 2.4, e.elite ? '#ffd34d' : T.color, e.elite ? 0.55 : 0.32);
      if (T.healer) glow(e.x, e.y, 95, T.color, 0.1 + 0.05 * Math.sin(e.spin * 3));
    }
    normal();
    for (const e of run.enemies) {
      const T = K.TYPES[e.type];
      const spinRot = T.rot + e.spin * (T.shape === 4 && !T.ranged ? 0.5 : 1);
      shapePath(e.x, e.y, e.size, T.shape, spinRot);
      ctx.fillStyle = T.color; ctx.fill();
      ctx.lineWidth = T.boss ? 3 : e.elite ? 3 : 1.5;
      ctx.strokeStyle = e.elite ? '#ffd34d' : run.fx.freeze > 0 ? '#d6f1ff' : 'rgba(255,255,255,.35)';
      ctx.stroke();
      // gem-like inner facet
      shapePath(e.x - e.size * 0.12, e.y - e.size * 0.12, e.size * 0.5, T.shape, spinRot);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill();
      const hf = hitFlash.get(e.id);
      if (hf > 0) { shapePath(e.x, e.y, e.size, T.shape, spinRot); ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, hf * 10)})`; ctx.fill(); }
      if (T.shielded && e.hp > e.maxHp * 0.5) {
        ctx.beginPath(); ctx.arc(e.x, e.y, e.size + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#cfe3f7'; ctx.lineWidth = 2; ctx.globalAlpha = 0.55 + 0.3 * Math.sin(clock * 5 + e.id); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (T.boss) { shapePath(e.x, e.y, e.size * 0.5, 8, -e.spin); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
      if (T.ranged) { ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      if (e.hp < e.maxHp) {
        const w = e.size * 2;
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(e.x - w / 2, e.y - e.size - 9, w, 3.5);
        ctx.fillStyle = T.boss ? '#ff8a8a' : '#7ee08f'; ctx.fillRect(e.x - w / 2, e.y - e.size - 9, w * Math.max(0, e.hp / e.maxHp), 3.5);
      }
    }

    // ----- projectiles -----
    additive();
    for (const b of run.bolts) {
      glow(b.x, b.y, 22, '#e46ad8', 0.85);
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffd0f6';
      ctx.beginPath(); ctx.arc(b.x, b.y, 4.8, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of run.shots) {
      // trail: remember last few positions on the shot object
      const tr = p._tr || (p._tr = []);
      tr.push(p.x, p.y);
      if (tr.length > 18) tr.splice(0, 2);
      if (!p._seen) { p._seen = true; if (p.x === 0 && p.y === 0) muzzle.push({ a: Math.atan2(p.ty, p.tx), t: 0 }); }
      const col = p.crit ? '#ffd34d' : C.idle;
      ctx.strokeStyle = col; ctx.lineCap = 'round';
      for (let k = 2; k < tr.length; k += 2) {
        ctx.globalAlpha = (k / tr.length) * 0.85;
        ctx.lineWidth = (p.crit ? 8 : 6) * (k / tr.length);
        ctx.beginPath(); ctx.moveTo(tr[k - 2], tr[k - 1]); ctx.lineTo(tr[k], tr[k + 1]); ctx.stroke();
      }
      glow(p.x, p.y, p.crit ? 26 : 19, col, 0.95);
      ctx.globalAlpha = 1; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.crit ? 6 : 4.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.crit ? 3.4 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'butt';
    // chain lightning: jagged bolt with a wide glow pass
    for (const z of run.zaps) {
      const a = Math.max(0, 1 - z.t / 0.35);
      const pts = [[z.x1, z.y1]];
      for (let k = 1; k < 5; k++) {
        const f = k / 5;
        pts.push([z.x1 + (z.x2 - z.x1) * f + (Math.random() - 0.5) * 22, z.y1 + (z.y2 - z.y1) * f + (Math.random() - 0.5) * 22]);
      }
      pts.push([z.x2, z.y2]);
      for (const [w, al, col] of [[10, 0.25, '#7fb8ff'], [3, 1, '#e6f3ff']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = a * al;
        ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      glow(z.x2, z.y2, 22, '#9fd0ff', a);
    }
    // orbit blades with glowing arcs
    if (run.fx.orbit > 0) {
      const a0 = run.time * 4;
      for (let k = 0; k < 4; k++) {
        const a = a0 + (k * Math.PI) / 2;
        ctx.strokeStyle = C.idle; ctx.lineWidth = 6; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(0, 0, 82, a - 0.7, a); ctx.stroke();
        glow(Math.cos(a) * 82, Math.sin(a) * 82, 20, C.idle, 0.8);
      }
      normal();
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) {
        const a = a0 + (k * Math.PI) / 2;
        shapePath(Math.cos(a) * 82, Math.sin(a) * 82, 8, 3, a + Math.PI / 2);
        ctx.fill();
      }
      additive();
    }

    // ----- particles -----
    for (const q of parts) {
      const life = Math.max(0, 1 - q.t / q.life);
      if (q.kind === 'spark') {
        ctx.strokeStyle = q.col; ctx.globalAlpha = life; ctx.lineWidth = q.s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035); ctx.stroke();
      } else if (q.kind === 'chip') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.globalAlpha = life; ctx.fillStyle = q.col; ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s);
        ctx.restore();
      } else if (q.kind === 'coin') {
        glow(q.x, q.y, 9, '#ffd34d', 0.7 * Math.min(1, life * 3));
        ctx.globalAlpha = Math.min(1, life * 3); ctx.fillStyle = '#fff3c4';
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, 0, Math.PI * 2); ctx.fill();
      } else if (q.kind === 'ring') {
        const r = q.max * (1 - Math.pow(1 - q.t / q.life, 2));
        ctx.strokeStyle = q.col;
        ctx.globalAlpha = life * 0.3; ctx.lineWidth = q.w * 3 * (0.4 + 0.6 * life);
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = life; ctx.lineWidth = q.w * (0.4 + 0.6 * life) + 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.stroke();
      } else if (q.kind === 'glow') {
        glow(q.x, q.y, q.r * (1 + q.t / q.life * 0.5), q.col, life * 0.8);
      }
    }
    ctx.lineCap = 'butt';
    normal();

    // ----- tower -----
    const hpFrac = Math.max(0, run.hp / s.maxHp);
    const od = run.fx.overdrive > 0;
    additive();
    glow(0, 0, K.TOWER_R * (od ? 3.4 : 2.6) * (1 + 0.05 * Math.sin(clock * 2.4)), hurtFlash > 0 ? '#ff6b6b' : (C.keep || C.idle), od ? 0.9 : 0.55);
    for (const m of muzzle) {
      const a = Math.max(0, 1 - m.t / 0.12);
      glow(Math.cos(m.a) * (K.TOWER_R + 6), Math.sin(m.a) * (K.TOWER_R + 6), 18, '#ffffff', a * 0.6);
    }
    normal();
    // rotating outer segments
    ctx.save(); ctx.rotate(clock * (od ? 2.4 : 0.6));
    ctx.strokeStyle = C.idle; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 17, (k / 6) * Math.PI * 2, (k / 6) * Math.PI * 2 + 0.55); ctx.stroke(); }
    ctx.restore(); ctx.globalAlpha = 1;
    // wall: a ring of segments that thins as it takes damage
    if (s.wallMax > 0 && run.wall > 0) {
      const f = run.wall / s.wallMax;
      const segs = 12;
      ctx.lineWidth = 5;
      ctx.strokeStyle = wallFlash > 0 ? '#ffffff' : '#cfe3f7';
      ctx.globalAlpha = 0.35 + 0.55 * f;
      for (let k = 0; k < segs; k++) {
        if (k / segs >= f) break;
        const a0 = (k / segs) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 30, a0 + 0.04, a0 + (Math.PI * 2) / segs - 0.04); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (run.invuln > 0) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(clock * 20); ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 14, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    // health ring
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.bg2; ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 9, 0, Math.PI * 2); ctx.stroke();
    const hpCol = hpFrac > 0.35 ? '#4caf73' : C.wrong;
    ctx.strokeStyle = hpCol;
    ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac); ctx.stroke();
    // body with a soft top highlight
    shapePath(0, 0, K.TOWER_R, 6, Math.PI / 6);
    const grd = ctx.createLinearGradient(0, -K.TOWER_R, 0, K.TOWER_R);
    const body = hurtFlash > 0 ? C.wrong : (C.keep || C.idle);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.18, body); grd.addColorStop(1, body);
    ctx.fillStyle = grd; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.rotate(run.aim + Math.PI / 2);
    shapePath(0, -2, 10, 3, 0); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.95; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();

    // banners (screen space)
    ctx.textAlign = 'center';
    for (const b of banners.slice(0, 1)) {
      const a = b.t < 0.25 ? b.t / 0.25 : Math.max(0, 1 - (b.t - 1.3) / 0.5);
      const pop = b.t < 0.25 ? 0.85 + 0.15 * (b.t / 0.25) : 1;
      ctx.globalAlpha = Math.min(1, a);
      ctx.save();
      ctx.translate(side / 2, side * 0.2); ctx.scale(pop, pop);
      ctx.fillStyle = b.warn ? C.wrong : b.gold ? '#e0a92e' : C.text;
      ctx.font = `700 ${Math.round(side * 0.07)}px ui-serif, Georgia, serif`;
      if (b.gold || b.warn) { ctx.shadowColor = b.warn ? C.wrong : '#ffd34d'; ctx.shadowBlur = 16; }
      ctx.fillText(b.text, 0, 0);
      ctx.shadowBlur = 0;
      if (b.sub) { ctx.font = `600 ${Math.round(side * 0.042)}px system-ui, sans-serif`; ctx.fillStyle = C.muted; ctx.fillText(b.sub, 0, side * 0.06); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ----- HUD update -----
  function hudUpdate() {
    const s = K.stats(run, meta);
    waveLbl.textContent = String(run.wave);
    waveBar.style.width = `${Math.min(100, (run.waveT / (run.waveTime || K.WAVE_TIME)) * 100)}%`;
    coinsEl.textContent = fmtNum(run.coins);
    hpBar.style.width = `${Math.max(0, (run.hp / s.maxHp) * 100)}%`;
    hpBar.classList.toggle('low', run.hp / s.maxHp < 0.35);
    hpTxt.textContent = `${fmtNum(run.hp)} / ${fmtNum(s.maxHp)}`;
    wallWrap.style.display = s.wallMax > 0 ? '' : 'none';
    if (s.wallMax > 0) wallBar.style.width = `${Math.max(0, (run.wall / s.wallMax) * 100)}%`;
    drawOffer();
    for (const a of K.ABILITIES) {
      const b = abBtns[a.id];
      if (!b) continue;
      const cd = run.cds[a.id] || 0;
      b.style.setProperty('--p', `${(cd / K.abilityCd(meta, a)) * 100}%`);
      b.classList.toggle('cooling', cd > 0);
    }
  }

  // ----- loop -----
  let last = performance.now();
  let raf = 0, acc = 0, uiT = 0, saveT = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (paused || ended || document.hidden) { draw(); return; }
    acc += dt * speed;
    const STEP = 1 / 60;
    let n = 0;
    while (acc >= STEP && n < 40 && !ended) {
      handle(pendingEvents.splice(0));
      handle(K.step(run, meta, STEP));
      acc -= STEP; n++;
    }
    handle(pendingEvents.splice(0));
    const gdt = dt * speed;
    clock += dt;
    for (const q of parts) {
      q.t += gdt;
      if (q.kind === 'coin') {
        // drift out, then get pulled into the keep
        const d = Math.hypot(q.x, q.y) || 1;
        const pull = q.t < 0.25 ? 0 : 900;
        q.vx = q.vx * 0.9 - (q.x / d) * pull * gdt; q.vy = q.vy * 0.9 - (q.y / d) * pull * gdt;
        if (d < K.TOWER_R) q.t = q.life;
      } else if (q.vx != null) { const f = Math.pow(0.03, gdt); q.vx *= f; q.vy *= f; }
      if (q.vx != null) { q.x += q.vx * gdt; q.y += q.vy * gdt; }
      if (q.rot != null) q.rot += q.vr * gdt;
    }
    for (let k = parts.length - 1; k >= 0; k--) if (parts[k].t > parts[k].life) parts.splice(k, 1);
    for (const [id, v] of hitFlash) { if (v - gdt <= 0) hitFlash.delete(id); else hitFlash.set(id, v - gdt); }
    for (const m of muzzle) m.t += gdt;
    while (muzzle.length && muzzle[0].t > 0.12) muzzle.shift();
    shake = Math.max(0, shake - dt * 30);
    // announcements play one at a time
    if (banners.length > 4) banners.splice(1, banners.length - 4);
    if (banners.length) banners[0].t += dt * (banners.length > 1 ? 1.4 : 1);
    while (banners.length && banners[0].t > 1.8) banners.shift();
    hurtFlash = Math.max(0, hurtFlash - dt);
    wallFlash = Math.max(0, wallFlash - dt);
    draw();
    if ((uiT += dt) > 0.12) {
      uiT = 0;
      if (meta.autoBuy && K.autoBuy(run, meta, 4)) refreshList();
      hudUpdate(); refreshList();
    }
    if ((saveT += dt) > 5) {
      saveT = 0;
      if (!ended) saveRun(run);
      const done = K.collectResearch(meta);
      if (done.length) toast(`Research complete: ${done.map((id) => K.RESEARCH_BY_ID[id].name).join(', ')}`, 2400);
      touch(meta);
    }
  }
  hudUpdate();
  raf = requestAnimationFrame(frame);

  const onVis = () => {
    if (document.hidden && !ended) { saveRun(run); saveMeta(meta); touch(meta); }
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVis);

  // ----- pause / end -----
  function openPause() {
    if (ended) return;
    paused = true;
    const close = sheet('Paused', h('div', {},
      h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
        h('div', {}, h('b', {}, String(run.wave)), h('span', {}, `Wave · T${run.tier}`)),
        h('div', {}, h('b', {}, fmtNum(run.kills)), h('span', {}, 'Defeated')),
        h('div', {}, h('b', {}, fmtTime(run.time)), h('span', {}, 'Time'))),
      h('div', { class: 'menu-list' },
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => close() }, icon('play'), 'Resume'),
        h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/keystone'); } }, 'Back to base (keeps this run)'),
        h('button', { class: 'btn btn-soft', onclick: () => { close(); endRun(true); } }, `End run & collect ${fmtNum(K.shardsForRun(run, meta))} shards`))),
    { onClose: () => { paused = false; last = performance.now(); } });
  }

  function endRun(voluntary = false) {
    if (ended) return;
    ended = true;
    const got = K.finishRun(run, meta);
    saveMeta(meta);
    clearRun();
    if (!voluntary) haptic([40, 60, 40]);
    const relics = run.relicsFound.map((id) => K.RELICS.find((r) => r.id === id).name);
    setTimeout(() => {
      const close = sheet(voluntary ? 'Run ended' : 'Your keep has fallen', h('div', {},
        h('div', { class: 'big-result' }, run.wave > bestBefore ? `New best in tier ${run.tier}!` : `Tier ${run.tier} · reached wave`, h('b', {}, String(run.wave))),
        h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
          h('div', {}, h('b', {}, `+${fmtNum(got)}`), h('span', {}, run.tokensEarned ? `Shards · +${run.tokensEarned} tokens` : 'Shards')),
          h('div', {}, h('b', {}, fmtNum(run.kills)), h('span', {}, 'Defeated')),
          h('div', {}, h('b', {}, fmtTime(run.time)), h('span', {}, 'Time'))),
        relics.length ? h('p', { class: 'hint' }, `Relics found: ${relics.join(', ')}`) : null,
        run.gearFound.length ? h('p', { class: 'hint' }, `Gear found: ${run.gearFound.map((g) => `${K.RARITIES[g.rarity]} ${K.GEAR_BY_ID[g.id].name}`).join(', ')}`) : null,
        h('button', { class: 'btn btn-outline', style: { width: '100%', marginTop: '8px' }, onclick: () => showRunStats(run) }, 'Run details'),
        meta.maxTier > run.tier && run.tier === meta.maxTier - 1 && run.wave >= K.TIER_UNLOCK_WAVE ? h('p', { class: 'hint' }, `Tier ${meta.maxTier} is now open. Your next run starts there; you can change tiers at the base.`) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/keystone', { replace: true }); } }, 'Base'),
          h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => { close(); ui.go('#/keystone/run', { replace: true }); } }, 'Run again'))));
    }, voluntary ? 0 : 700);
  }

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    mq.removeEventListener('change', readColors);
    document.removeEventListener('visibilitychange', onVis);
    if (!ended) saveRun(run);
    saveMeta(meta);
    touch(meta);
  };
}

const SRC_NAMES = { shot: 'Shots', crit: 'Critical hits', super: 'Super crits', bounce: 'Ricochets', thorns: 'Thorns', pulse: 'Pulse', orbit: 'Orbit', chain: 'Chain', exec: 'Execute' };
function showRunStats(run) {
  const S = run.stats || {};
  const dmg = Object.entries(S.dmg || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = dmg.reduce((a, [, v]) => a + v, 0) || 1;
  const kills = Object.entries(S.killsBy || {}).sort((a, b) => b[1] - a[1]);
  const killer = S.killer ? (K.TYPES[S.killer] || {}).name : null;
  sheet('Run details', h('div', {},
    h('div', { class: 'menu-cap' }, 'Damage dealt'),
    h('div', { class: 'ks-statbars' }, ...dmg.map(([k, v]) => h('div', { class: 'ks-statbar' },
      h('span', {}, SRC_NAMES[k] || k), h('div', { class: 'ks-bar' }, h('i', { style: { width: `${(v / total) * 100}%` } })), h('b', {}, `${Math.round((v / total) * 100)}%`)))),
    h('div', { class: 'menu-cap' }, 'Defense'),
    h('div', { class: 'set-group' },
      ...[['Damage taken (melee)', S.taken?.melee || 0], ['Damage taken (ranged)', S.taken?.ranged || 0], ['Blocked by wall', S.absorbed || 0], ['Stopped by damage threshold', S.threshold || 0], ['Healed by lifesteal', S.healed || 0], ['Interest earned (coins)', S.interest || 0], ['Free upgrade levels', S.free || 0]]
        .map(([k, v]) => h('div', { class: 'set-item' }, h('div', { class: 'lbl' }, k), h('b', {}, fmtNum(v))))),
    h('div', { class: 'menu-cap' }, 'Defeated'),
    h('div', { class: 'ks-tiers' }, ...kills.map(([t, n]) => h('div', {}, h('small', {}, (K.TYPES[t] || {}).name || t), h('b', {}, fmtNum(n))))),
    (S.perks || []).length ? h('div', {}, h('div', { class: 'menu-cap' }, 'Perks'), h('p', { class: 'hint', style: { textAlign: 'left' } }, S.perks.map((id) => K.PERK_BY_ID[id].name).join(' · '))) : null,
    h('p', { class: 'hint' }, `${fmtNum(run.coinsEarned)} coins earned · ${S.abilities || 0} abilities used${killer ? ` · fell to a ${killer}` : ''}`)));
}

import * as K from './keystone-engine.js';
import { h, icon, iconBtn, store, sheet, toast, haptic, fmtTime } from './core.js';

// ---------- persistence ----------
export function loadMeta() { return K.migrateMeta(store.get('ks:meta', {})); }
const saveMeta = (m) => store.set('ks:meta', m);
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
function fmtStat(u, v) {
  switch (u.fmt) {
    case 'rate': return v.toFixed(2) + '/s';
    case 'int': return String(Math.round(v));
    case 'pct': return Math.round(v * 100) + '%';
    case 'pctx': return (v * 100).toFixed(1) + '%';
    case 'mult': return '×' + v.toFixed(1);
    case 'plus': return '+' + Math.round(v * 100) + '%';
    case 'regen': return fmtNum(v) + '/s';
    case 'wave': return fmtNum(v) + '×wave';
    case 'bounce': return v + (v === 1 ? ' bounce' : ' bounces');
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

export function mount(view, params, ui) {
  return params[0] === 'run' ? mountRun(view, ui) : mountLobby(view, ui);
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
          ? h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), `Resume T${run.tier || 1} · W${run.wave}`)
          : h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), `Start tier ${meta.tier}`),
        run ? h('button', { class: 'btn btn-soft', onclick: abandon }, 'End run') : null),
    );

    // ----- section tabs -----
    const labBusy = (meta.lab || []).length;
    const tabs = h('div', { class: 'seg ks-sections' }, ...[['workshop', 'Workshop'], ['research', `Research${labBusy ? ` · ${labBusy}` : ''}`], ['relics', 'Relics'], ['abilities', 'Abilities']].map(([id, label]) =>
      h('button', { 'aria-pressed': String(section === id), onclick: () => { section = id; store.set('ks:section', id); draw(); } }, label)));

    let body;
    if (section === 'workshop') body = drawWorkshop();
    else if (section === 'research') body = drawResearch();
    else if (section === 'relics') body = drawRelics();
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
        cost === Infinity ? h('span', { class: 'ks-owned' }, 'Max') : costBtn(cost, () => { meta.shards -= cost; meta.perm[u.id] = L + 1; haptic(10); save(); }));
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
          const got = K.shardsForRun(run, meta);
          meta.shards += got; meta.runs = (meta.runs || 0) + 1;
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
function mountRun(view, ui) {
  const meta = loadMeta();
  K.collectResearch(meta);
  const snap = loadRun();
  const run = snap ? K.resume(snap, meta) : K.newRun(meta, meta.tier || 1);
  if (!snap) saveRun(run);
  touch(meta);
  const bestBefore = (meta.best || {})[run.tier] || 0;

  let speed = store.get('ks:speed', 1);
  let paused = false;
  let ended = false;
  let tab = 'attack';
  let qty = store.get('ks:qty', 1);

  // ----- header -----
  const speedBtn = h('button', { class: 'chip ks-speed', onclick: () => { speed = speed >= 3 ? 1 : speed + 1; store.set('ks:speed', speed); speedBtn.textContent = speed + '×'; } }, speed + '×');
  ui.setTitle(h('span', {}, 'Keystone', h('span', { class: 'mode-pill' }, `Tier ${run.tier}`)));
  ui.setActions([speedBtn, iconBtn('pause', 'Pause', openPause)]);

  // ----- HUD -----
  const waveLbl = h('b', {});
  const waveBar = h('i', {});
  const coinsEl = h('b', {});
  const hpBar = h('i', {});
  const hpTxt = h('span', {});
  const hud = h('div', { class: 'ks-hud' },
    h('div', { class: 'ks-hud-wave' }, h('div', {}, 'Wave ', waveLbl), h('div', { class: 'ks-bar' }, waveBar)),
    h('div', { class: 'ks-hud-coins' }, h('span', { class: 'ks-coin' }), coinsEl),
    h('div', { class: 'ks-hud-hp' }, h('div', { class: 'ks-bar hp' }, hpBar), hpTxt));

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
      h('span', { class: 'ks-ab-ring' }), abIcon('auto'), h('small', {}, 'Auto'));
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
        val.textContent = fmtStat(u, u.val(L));
        btn.replaceChildren('Max'); btn.disabled = true; btn.classList.add('off');
        continue;
      }
      const c = qty === 'max' ? K.affordable(run, meta, id) : K.runCost(run, meta, id, qty);
      const n = qty === 'max' ? Math.max(1, c.n) : c.n;
      const cost = qty === 'max' && c.n === 0 ? K.runCost(run, meta, id, 1).cost : c.cost;
      val.textContent = `${fmtStat(u, u.val(L))} → ${fmtStat(u, u.val(L + n))}`;
      const can = cost <= run.coins && n > 0;
      btn.disabled = !can; btn.classList.toggle('off', !can);
      btn.replaceChildren(h('span', { class: 'ks-coin' }), fmtNum(cost), n > 1 ? h('small', {}, ` ×${n}`) : '');
    }
  }
  drawTabs();
  buildList();
  const panel = h('div', { class: 'ks-panel' }, h('div', { class: 'ks-panel-top' }, tabs, qtySeg), list);

  const root = h('div', { class: 'ks-run' }, hud, stage, abRow.childNodes.length ? abRow : null, panel);
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
  const parts = [];
  const banners = [];
  let hurtFlash = 0;
  const pendingEvents = [];
  const burst = (x, y, col, n, sp = 90) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * sp;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, t: 0, col, s: 2 + Math.random() * 2.5 });
    }
  };
  function handle(evs) {
    for (const e of evs) {
      if (e.t === 'kill') {
        const T = K.TYPES[e.type];
        burst(e.x, e.y, e.elite ? '#ffd34d' : T.color, T.boss ? 22 : e.elite ? 12 : 6);
        if (T.boss) { haptic(25); banners.push({ text: 'Warden defeated!', t: 0 }); }
      } else if (e.t === 'hurt') hurtFlash = 0.25;
      else if (e.t === 'boss') banners.push({ text: 'A Warden approaches', t: 0, warn: true });
      else if (e.t === 'blink') burst(e.x, e.y, '#a993d8', 4, 40);
      else if (e.t === 'relic') {
        const r = K.RELICS.find((x) => x.id === e.id);
        banners.push({ text: 'Relic found!', sub: `${r.name} · Lv ${K.relicLv(meta, r.id)}`, t: 0, gold: true });
        burst(e.x, e.y, '#ffd34d', 26, 140);
        haptic([20, 40, 20]);
        saveMeta(meta);
      } else if (e.t === 'tier') {
        meta.tier = e.tier; // next run starts in the new tier (can be changed at the base)
        banners.push({ text: `Tier ${e.tier} unlocked!`, sub: 'Your next run starts there', t: 0, gold: true });
        haptic([20, 40, 20]);
        saveMeta(meta);
      } else if (e.t === 'wave') {
        banners.push({ text: `Wave ${e.wave}`, sub: e.bonus ? `+${fmtNum(e.bonus)} coins` : '', t: 0 });
        saveRun(run);
      } else if (e.t === 'over') endRun();
    }
  }

  // ----- colors from theme -----
  let C = {};
  function readColors() {
    const cs = getComputedStyle(root);
    const g = (n, d) => cs.getPropertyValue(n).trim() || d;
    C = { idle: g('--idle', '#22a39a'), text: g('--text', '#222'), muted: g('--muted', '#777'), border: g('--border', '#ccc'), surface: g('--surface', '#fff'), bg2: g('--surface-2', '#eee'), wrong: g('--wrong', '#d44') };
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
  function draw() {
    const s = K.stats(run, meta);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.save();
    ctx.translate(side / 2, side / 2);
    ctx.scale(scale, scale);

    // arena
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = C.border;
    for (let r = 80; r <= K.R; r += 80) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.globalAlpha = 0.55; ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = C.idle; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, s.range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (run.fx.freeze > 0) { ctx.fillStyle = '#8fd3ff'; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(0, 0, K.R + 20, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }

    for (const r of run.rings) {
      ctx.strokeStyle = r.kind === 'freeze' ? '#8fd3ff' : r.kind === 'repair' ? '#4caf73' : C.idle;
      ctx.globalAlpha = Math.max(0, 1 - r.t / 0.6); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r.r), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // enemies
    for (const e of run.enemies) {
      const T = K.TYPES[e.type];
      if (T.healer) { ctx.beginPath(); ctx.arc(e.x, e.y, 95, 0, Math.PI * 2); ctx.fillStyle = T.color; ctx.globalAlpha = 0.07 + 0.03 * Math.sin(e.spin * 3); ctx.fill(); ctx.globalAlpha = 1; }
      const spinRot = T.rot + e.spin * (T.shape === 4 && !T.ranged ? 0.5 : 1);
      shapePath(e.x, e.y, e.size, T.shape, spinRot);
      ctx.fillStyle = T.color; ctx.fill();
      ctx.lineWidth = T.boss ? 3 : e.elite ? 3 : 2;
      ctx.strokeStyle = e.elite ? '#ffd34d' : run.fx.freeze > 0 ? '#bfe8ff' : 'rgba(0,0,0,.25)';
      ctx.stroke();
      if (T.shielded && e.hp > e.maxHp * 0.5) { ctx.beginPath(); ctx.arc(e.x, e.y, e.size + 5, 0, Math.PI * 2); ctx.strokeStyle = '#cfe3f7'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1; }
      if (T.boss) { shapePath(e.x, e.y, e.size * 0.5, 8, -e.spin); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
      if (T.ranged) { ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      if (e.hp < e.maxHp) {
        const w = e.size * 2;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(e.x - w / 2, e.y - e.size - 8, w, 3.5);
        ctx.fillStyle = T.boss ? '#ff8a8a' : '#7ee08f'; ctx.fillRect(e.x - w / 2, e.y - e.size - 8, w * Math.max(0, e.hp / e.maxHp), 3.5);
      }
    }
    ctx.fillStyle = '#e46ad8';
    for (const b of run.bolts) { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); }
    for (const p of run.shots) {
      ctx.fillStyle = p.crit ? '#ffd34d' : C.idle;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.crit ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
    }
    // chain lightning
    for (const z of run.zaps) {
      ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 3; ctx.globalAlpha = Math.max(0, 1 - z.t / 0.35);
      ctx.beginPath(); ctx.moveTo(z.x1, z.y1);
      const mx = (z.x1 + z.x2) / 2 + (Math.random() - 0.5) * 18, my = (z.y1 + z.y2) / 2 + (Math.random() - 0.5) * 18;
      ctx.lineTo(mx, my); ctx.lineTo(z.x2, z.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // orbit blades
    if (run.fx.orbit > 0) {
      const a0 = run.time * 4;
      ctx.fillStyle = C.idle;
      for (let k = 0; k < 4; k++) {
        const a = a0 + (k * Math.PI) / 2;
        shapePath(Math.cos(a) * 82, Math.sin(a) * 82, 9, 3, a + Math.PI / 2);
        ctx.fill();
      }
      ctx.strokeStyle = C.idle; ctx.globalAlpha = 0.25; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 82, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.col; ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // tower
    const hpFrac = Math.max(0, run.hp / s.maxHp);
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.bg2; ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = hpFrac > 0.35 ? '#4caf73' : C.wrong;
    ctx.beginPath(); ctx.arc(0, 0, K.TOWER_R + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac); ctx.stroke();
    if (run.fx.overdrive > 0) { ctx.shadowColor = C.idle; ctx.shadowBlur = 18; }
    shapePath(0, 0, K.TOWER_R, 6, Math.PI / 6);
    ctx.fillStyle = hurtFlash > 0 ? C.wrong : C.idle; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); ctx.rotate(run.aim + Math.PI / 2);
    shapePath(0, -2, 10, 3, 0); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();

    // banners (screen space)
    ctx.textAlign = 'center';
    for (const b of banners) {
      const a = b.t < 0.25 ? b.t / 0.25 : Math.max(0, 1 - (b.t - 1.3) / 0.5);
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = b.warn ? C.wrong : b.gold ? '#e0a92e' : C.text;
      ctx.font = `700 ${Math.round(side * 0.07)}px ui-serif, Georgia, serif`;
      ctx.fillText(b.text, side / 2, side * 0.2);
      if (b.sub) { ctx.font = `600 ${Math.round(side * 0.042)}px system-ui, sans-serif`; ctx.fillStyle = C.muted; ctx.fillText(b.sub, side / 2, side * 0.2 + side * 0.06); }
    }
    ctx.globalAlpha = 1;
  }

  // ----- HUD update -----
  function hudUpdate() {
    const s = K.stats(run, meta);
    waveLbl.textContent = String(run.wave);
    waveBar.style.width = `${Math.min(100, (run.waveT / K.WAVE_TIME) * 100)}%`;
    coinsEl.textContent = fmtNum(run.coins);
    hpBar.style.width = `${Math.max(0, (run.hp / s.maxHp) * 100)}%`;
    hpBar.classList.toggle('low', run.hp / s.maxHp < 0.35);
    hpTxt.textContent = `${fmtNum(run.hp)} / ${fmtNum(s.maxHp)}`;
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
    for (const q of parts) { q.t += gdt; q.x += q.vx * gdt; q.y += q.vy * gdt; q.vx *= 0.94; q.vy *= 0.94; }
    for (let k = parts.length - 1; k >= 0; k--) if (parts[k].t > parts[k].life) parts.splice(k, 1);
    for (const b of banners) b.t += dt;
    while (banners.length && banners[0].t > 1.8) banners.shift();
    hurtFlash = Math.max(0, hurtFlash - dt);
    draw();
    if ((uiT += dt) > 0.12) { uiT = 0; hudUpdate(); refreshList(); }
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
    const got = K.shardsForRun(run, meta);
    meta.shards += got;
    meta.runs = (meta.runs || 0) + 1;
    saveMeta(meta);
    clearRun();
    if (!voluntary) haptic([40, 60, 40]);
    const relics = run.relicsFound.map((id) => K.RELICS.find((r) => r.id === id).name);
    setTimeout(() => {
      const close = sheet(voluntary ? 'Run ended' : 'Your keep has fallen', h('div', {},
        h('div', { class: 'big-result' }, run.wave > bestBefore ? `New best in tier ${run.tier}!` : `Tier ${run.tier} · reached wave`, h('b', {}, String(run.wave))),
        h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
          h('div', {}, h('b', {}, `+${fmtNum(got)}`), h('span', {}, 'Shards')),
          h('div', {}, h('b', {}, fmtNum(run.kills)), h('span', {}, 'Defeated')),
          h('div', {}, h('b', {}, fmtTime(run.time)), h('span', {}, 'Time'))),
        relics.length ? h('p', { class: 'hint' }, `Relics found: ${relics.join(', ')}`) : null,
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

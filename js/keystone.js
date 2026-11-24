import * as K from './keystone-engine.js';
import { h, icon, iconBtn, store, sheet, toast, haptic, fmtTime } from './core.js';

// ---------- persistence ----------
export function loadMeta() { return { ...K.newMeta(), ...store.get('ks:meta', {}) }; }
const saveMeta = (m) => store.set('ks:meta', m);
const loadRun = () => store.get('ks:run');
const saveRun = (run) => store.set('ks:run', K.snapshot(run));
const clearRun = () => store.del('ks:run');
export function keystoneSummary() {
  const m = loadMeta();
  const r = loadRun();
  return { best: m.bestWave || 0, shards: Math.floor(m.shards), runWave: r ? r.wave : 0 };
}

// ---------- number formatting ----------
const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
export function fmtNum(x) {
  if (!isFinite(x)) return '—';
  if (Math.abs(x) < 1000) return x < 10 && x % 1 ? x.toFixed(1) : String(Math.floor(x));
  let i = 0;
  while (Math.abs(x) >= 1000 && i < SUF.length - 1) { x /= 1000; i++; }
  return (x < 100 ? x.toFixed(x < 10 ? 2 : 1) : Math.floor(x)) + SUF[i];
}
function fmtStat(u, v) {
  switch (u.fmt) {
    case 'rate': return v.toFixed(2) + '/s';
    case 'int': return String(Math.round(v));
    case 'pct': return Math.round(v * 100) + '%';
    case 'mult': return '×' + v.toFixed(1);
    case 'plus': return '+' + Math.round(v * 100) + '%';
    case 'regen': return fmtNum(v) + '/s';
    case 'wave': return fmtNum(v) + '×wave';
    default: return fmtNum(v);
  }
}

// keep "last seen" fresh while the game is open, for offline earnings
function touch(meta) { meta.lastSeen = Date.now(); saveMeta(meta); }

const ABILITY_ICON = {
  pulse: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="10.5" opacity=".5"/>',
  freeze: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  overdrive: '<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor"/>',
  repair: '<path d="M12 5v14M5 12h14" stroke-width="3.2"/>',
};
const abIcon = (id) => { const s = icon('plus'); s.innerHTML = ABILITY_ICON[id]; return s; };

export function mount(view, params, ui) {
  return params[0] === 'run' ? mountRun(view, ui) : mountLobby(view, ui);
}

// =====================================================================
// Lobby: workshop, abilities, start/continue
// =====================================================================
function mountLobby(view, ui) {
  const meta = loadMeta();
  ui.setTitle(h('span', {}, 'Keystone', h('span', { class: 'mode-pill' }, 'Idle')));
  ui.setActions([iconBtn('help', 'How to play', showHelp)]);

  // offline earnings
  const away = (Date.now() - (meta.lastSeen || Date.now())) / 1000;
  if (away >= 300 && meta.bestWave > 0) {
    const gain = K.offlineShards(meta, away);
    if (gain > 0) {
      meta.shards += gain;
      const hrs = Math.min(K.OFFLINE_CAP_H, away / 3600);
      setTimeout(() => sheet('While you were away', h('div', {},
        h('div', { class: 'big-result' }, `Your keep stood watch for ${hrs >= 1 ? hrs.toFixed(1) + ' h' : Math.round(away / 60) + ' min'}`, h('b', {}, `+${gain} shards`)),
        away / 3600 > K.OFFLINE_CAP_H ? h('p', { class: 'hint' }, `Offline earnings cap at ${K.OFFLINE_CAP_H} hours.`) : null)), 250);
    }
  }
  touch(meta);
  const iv = setInterval(() => touch(meta), 15000);

  const wrap = h('div', { class: 'home ks-lobby' });
  view.append(wrap);

  function draw() {
    const run = loadRun();
    const shardsEl = h('div', { class: 'ks-shards' }, h('span', { class: 'ks-gem' }), fmtNum(Math.floor(meta.shards)), h('small', {}, ' shards'));
    const hero = h('section', { class: 'game-card ks-hero', style: { '--c': 'var(--idle)' } },
      h('div', { class: 'ks-hero-art', html: HERO_SVG }),
      h('div', { class: 'ks-hero-stats' },
        shardsEl,
        h('div', { class: 'sub' }, `Best wave ${meta.bestWave || 0} · ${meta.runs || 0} run${meta.runs === 1 ? '' : 's'}`)),
      h('div', { class: 'card-actions' },
        run
          ? h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), `Resume wave ${run.wave}`)
          : h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => ui.go('#/keystone/run') }, icon('play'), 'Start run'),
        run ? h('button', { class: 'btn btn-soft', onclick: abandon }, 'End run') : null),
    );

    const abil = h('div', { class: 'set-group' },
      ...K.ABILITIES.map((a) => {
        const owned = !!meta.abilities[a.id];
        return h('div', { class: 'set-item' },
          h('div', { class: 'ks-ab-ico' + (owned ? ' on' : '') }, abIcon(a.id)),
          h('div', { class: 'lbl' }, a.name, h('small', {}, `${a.desc} · ${a.cd}s cooldown`)),
          owned ? h('span', { class: 'ks-owned' }, 'Ready') : costBtn(a.cost, () => { meta.shards -= a.cost; meta.abilities[a.id] = true; haptic(15); save(); }));
      }),
      h('div', { class: 'set-item' },
        h('div', { class: 'ks-ab-ico' + (meta.autocast ? ' on' : '') }, icon('refresh')),
        h('div', { class: 'lbl' }, 'Autocast', h('small', {}, 'Abilities fire on their own when they’d help most')),
        meta.autocast ? toggleEl(meta.autoOn !== false, (v) => { meta.autoOn = v; save(false); })
          : costBtn(K.AUTOCAST_COST, () => { meta.shards -= K.AUTOCAST_COST; meta.autocast = true; meta.autoOn = true; haptic(15); save(); })),
    );

    const shop = h('div', { class: 'set-group' },
      ...K.PERM_UPGRADES.map((u) => {
        const L = meta.perm[u.id] || 0;
        const cost = K.permCost(meta, u.id);
        return h('div', { class: 'set-item' },
          h('div', { class: 'lbl' }, u.name, h('span', { class: 'ks-lvl' }, `Lv ${L}${u.max ? '/' + u.max : ''}`), h('small', {}, `${u.desc} per level · now ${permNow(u, meta)}`)),
          cost === Infinity ? h('span', { class: 'ks-owned' }, 'Max') : costBtn(cost, () => { meta.shards -= cost; meta.perm[u.id] = L + 1; haptic(10); save(); }));
      }));

    const rate = 0.12 * (meta.bestWave || 0) * K.permVal(meta, 'poffl');
    wrap.replaceChildren(
      hero,
      h('div', { class: 'section-label' }, 'Abilities'), abil,
      h('div', { class: 'section-label' }, 'Workshop · permanent upgrades'), shop,
      h('p', { class: 'hint' }, rate > 0 ? `Earning ${rate.toFixed(1)} shards/hour while away (up to ${K.OFFLINE_CAP_H} h)` : 'Reach a wave to start earning shards while away'),
    );
  }
  function costBtn(cost, onBuy) {
    const can = meta.shards >= cost;
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
          clearRun(); save(); close(); toast(`+${got} shards`);
        } }, 'End & collect'))));
  }
  draw();
  return () => { clearInterval(iv); touch(meta); };
}

function permNow(u, meta) {
  const v = K.permVal(meta, u.id);
  switch (u.id) {
    case 'pstart': return `${Math.floor(v)} coins`;
    case 'pdisc': return `−${Math.round((1 - v) * 100)}%`;
    case 'pcrit': return `+${Math.round(v * 100)}%`;
    default: return `+${Math.round((v - 1) * 100)}%`;
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
    h('p', {}, 'Your keep sits in the middle of the field and fires at the closest shape in range all by itself. Waves arrive every 20 seconds and get tougher each time; every 10th wave brings a Warden boss.'),
    h('p', {}, h('b', {}, 'Coins'), ' drop from defeated shapes. Spend them during a run on attack, defense and economy upgrades. They reset when the run ends.'),
    h('p', {}, h('b', {}, 'Shards'), ' are earned when a run ends (more for higher waves and bosses) and while you’re away. Spend them in the Workshop on permanent upgrades and abilities.'),
    h('p', {}, h('b', {}, 'Enemies: '), 'Blocks are steady, Darts are fast, Brutes are slow and tough, Spitters shoot from a distance.'),
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
  const snap = loadRun();
  const run = snap ? K.resume(snap, meta) : K.newRun(meta);
  if (!snap) saveRun(run);
  touch(meta);

  let speed = store.get('ks:speed', 1);
  let paused = false;
  let ended = false;
  let tab = 'attack';
  let qty = store.get('ks:qty', 1);

  // ----- header -----
  const speedBtn = h('button', { class: 'chip ks-speed', onclick: () => { speed = speed >= 3 ? 1 : speed + 1; store.set('ks:speed', speed); speedBtn.textContent = speed + '×'; } }, speed + '×');
  ui.setTitle(h('span', {}, 'Keystone'));
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
      h('span', { class: 'ks-ab-ring' }), icon('refresh'), h('small', {}, 'Auto'));
    abRow.append(auto);
  }

  // ----- upgrade panel -----
  const tabs = h('div', { class: 'seg ks-tabs' });
  const qtySeg = h('div', { class: 'seg' });
  const list = h('div', { class: 'ks-list' });
  const rows = {};
  function drawTabs() {
    tabs.replaceChildren(...[['attack', 'Attack'], ['defense', 'Defense'], ['economy', 'Economy']].map(([id, l]) =>
      h('button', { 'aria-pressed': String(tab === id), onclick: () => { tab = id; drawTabs(); buildList(); } }, l)));
    qtySeg.replaceChildren(...[[1, '×1'], [10, '×10'], ['max', 'Max']].map(([v, l]) =>
      h('button', { 'aria-pressed': String(qty === v), onclick: () => { qty = v; store.set('ks:qty', v); drawTabs(); refreshList(); } }, l)));
  }
  function buildList() {
    list.replaceChildren();
    for (const k in rows) delete rows[k];
    for (const u of K.RUN_UPGRADES.filter((x) => x.tab === tab)) {
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
  function handle(evs) {
    for (const e of evs) {
      if (e.t === 'kill') {
        const col = K.TYPES[e.type].color;
        const n = K.TYPES[e.type].boss ? 22 : 6;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90;
          parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, t: 0, col, s: 2 + Math.random() * 2.5 });
        }
        if (K.TYPES[e.type].boss) { haptic(25); banners.push({ text: 'Warden defeated!', t: 0 }); }
      } else if (e.t === 'hurt') hurtFlash = 0.25;
      else if (e.t === 'boss') banners.push({ text: 'A Warden approaches', t: 0, warn: true });
      else if (e.t === 'wave') {
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
  function poly(x, y, r, sides, rot) {
    ctx.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = rot + (k / sides) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function draw(realDt) {
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
    // range
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = C.idle; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, s.range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (run.fx.freeze > 0) { ctx.fillStyle = '#8fd3ff'; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(0, 0, K.R + 20, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }

    // rings
    for (const r of run.rings) {
      ctx.strokeStyle = r.kind === 'freeze' ? '#8fd3ff' : r.kind === 'repair' ? '#4caf73' : C.idle;
      ctx.globalAlpha = Math.max(0, 1 - r.t / 0.6); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r.r), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // enemies
    for (const e of run.enemies) {
      const T = K.TYPES[e.type];
      poly(e.x, e.y, e.size, T.sides, T.rot + e.spin * (T.sides === 4 && !T.ranged ? 0.5 : 1));
      ctx.fillStyle = T.color; ctx.fill();
      ctx.lineWidth = T.boss ? 3 : 2; ctx.strokeStyle = run.fx.freeze > 0 ? '#bfe8ff' : 'rgba(0,0,0,.25)'; ctx.stroke();
      if (T.boss) { poly(e.x, e.y, e.size * 0.5, 8, -e.spin); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); }
      if (T.ranged) { ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      if (e.hp < e.maxHp) {
        const w = e.size * 2;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(e.x - w / 2, e.y - e.size - 8, w, 3.5);
        ctx.fillStyle = T.boss ? '#ff8a8a' : '#7ee08f'; ctx.fillRect(e.x - w / 2, e.y - e.size - 8, w * Math.max(0, e.hp / e.maxHp), 3.5);
      }
    }
    // bolts
    ctx.fillStyle = '#e46ad8';
    for (const b of run.bolts) { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); }
    // shots
    for (const p of run.shots) {
      ctx.fillStyle = p.crit ? '#ffd34d' : C.idle;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.crit ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
    }
    // particles
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
    poly(0, 0, K.TOWER_R, 6, Math.PI / 6);
    ctx.fillStyle = hurtFlash > 0 ? C.wrong : C.idle; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); ctx.rotate(run.aim + Math.PI / 2);
    poly(0, -2, 10, 3, 0); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();

    // banners (screen space)
    ctx.textAlign = 'center';
    for (const b of banners) {
      const a = b.t < 0.25 ? b.t / 0.25 : Math.max(0, 1 - (b.t - 1.3) / 0.5);
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = b.warn ? C.wrong : C.text;
      ctx.font = `700 ${Math.round(side * 0.07)}px ui-serif, Georgia, serif`;
      ctx.fillText(b.text, side / 2, side * 0.2);
      if (b.sub) { ctx.font = `600 ${Math.round(side * 0.042)}px system-ui, sans-serif`; ctx.fillStyle = C.muted; ctx.fillText(b.sub, side / 2, side * 0.2 + side * 0.06); }
    }
    ctx.globalAlpha = 1;
    void realDt;
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
      b.style.setProperty('--p', `${(cd / a.cd) * 100}%`);
      b.classList.toggle('cooling', cd > 0);
    }
  }

  // ----- loop -----
  let last = performance.now();
  let raf = 0;
  let acc = 0;
  let uiT = 0;
  let saveT = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (paused || ended || document.hidden) { draw(0); return; }
    acc += dt * speed;
    const STEP = 1 / 60;
    let n = 0;
    while (acc >= STEP && n < 40 && !ended) {
      handle(pendingEvents.splice(0));
      handle(K.step(run, meta, STEP));
      acc -= STEP; n++;
    }
    handle(pendingEvents.splice(0));
    // effects advance in game time
    const gdt = dt * speed;
    for (const q of parts) { q.t += gdt; q.x += q.vx * gdt; q.y += q.vy * gdt; q.vx *= 0.94; q.vy *= 0.94; }
    for (let k = parts.length - 1; k >= 0; k--) if (parts[k].t > parts[k].life) parts.splice(k, 1);
    for (const b of banners) b.t += dt;
    while (banners.length && banners[0].t > 1.8) banners.shift();
    hurtFlash = Math.max(0, hurtFlash - dt);
    draw(dt);
    if ((uiT += dt) > 0.12) { uiT = 0; hudUpdate(); refreshList(); }
    if ((saveT += dt) > 5) { saveT = 0; if (!ended) saveRun(run); touch(meta); }
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
        h('div', {}, h('b', {}, String(run.wave)), h('span', {}, 'Wave')),
        h('div', {}, h('b', {}, fmtNum(run.kills)), h('span', {}, 'Defeated')),
        h('div', {}, h('b', {}, fmtTime(run.time)), h('span', {}, 'Time'))),
      h('div', { class: 'menu-list' },
        h('button', { class: 'btn btn-primary', style: { '--c': 'var(--idle)' }, onclick: () => close() }, icon('play'), 'Resume'),
        h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/keystone'); } }, 'Back to base (keeps this run)'),
        h('button', { class: 'btn btn-soft', onclick: () => { close(); endRun(true); } }, `End run & collect ${K.shardsForRun(run, meta)} shards`))),
    { onClose: () => { paused = false; last = performance.now(); } });
  }

  function endRun(voluntary = false) {
    if (ended) return;
    ended = true;
    const got = K.shardsForRun(run, meta);
    const newBest = run.wave >= (meta.bestWave || 0);
    meta.bestWave = Math.max(meta.bestWave || 0, run.wave);
    meta.shards += got;
    meta.runs = (meta.runs || 0) + 1;
    saveMeta(meta);
    clearRun();
    if (!voluntary) haptic([40, 60, 40]);
    setTimeout(() => {
      const close = sheet(voluntary ? 'Run ended' : 'Your keep has fallen', h('div', {},
        h('div', { class: 'big-result' }, newBest ? 'New best wave!' : 'Reached wave', h('b', {}, String(run.wave))),
        h('div', { class: 'stats-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
          h('div', {}, h('b', {}, `+${got}`), h('span', {}, 'Shards')),
          h('div', {}, h('b', {}, fmtNum(run.kills)), h('span', {}, 'Defeated')),
          h('div', {}, h('b', {}, fmtTime(run.time)), h('span', {}, 'Time'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-soft', onclick: () => { close(); ui.go('#/keystone', { replace: true }); } }, 'Workshop'),
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

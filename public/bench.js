// bench.js — Bàn thực hành 3D (Three.js): breadboard 830 lỗ, kéo-thả linh kiện,
// đi dây, xoay 360°, Inspector trượt từ phải, netlist nối vào CPU.
// Chỉ dùng chuột (trang chỉ dùng trên web máy tính).
// Three.js tải qua CDN (importmap, three@0.160.0); nếu tải lỗi thì hiện
// thông báo trong tab bàn. Nối CPU qua window.HoaTrangBenchBridge (app.js).
import {
  PITCH, holeId, holePos, allHoles,
  legOffsets, legsFor, picLegs, canPlace, benchToNetlist,
  describeTerminal, defaultBenchState, nextComponentId, compLabel,
  defaultProps, sanitizeState,
} from './bench-model.js?v=20261125e';
import { checkWiring, SIGNAL_COLORS } from './wiring.js?v=20261125b';

const $ = (id) => document.getElementById(id);
const benchView = $('benchView');
const wrap = $('benchCanvasWrap');
const paletteEl = $('benchPalette');
const searchEl = $('benchSearch');
const statusEl = $('benchStatus');
const angleEl = $('benchAngle');
const checksEl = $('benchChecks');
const inspectorEl = $('benchInspector');
const modeBanner = $('benchModeBanner');
const modeText = $('benchModeText');
const modeColors = $('benchModeColors');
const errorEl = $('benchError');
if (!benchView || !wrap) {
  // Không có tab bàn (trang cũ): không làm gì.
} else {
  main();
}

const LS_KEY = 'hoatrang-bench-v2';
const BOARD_TOP = 8;            // mặt trên breadboard (mm, y)
const TABLE_W = 900, TABLE_D = 600;
const LED_COLORS = [
  { name: 'Đỏ', value: '#DC2626' },
  { name: 'Xanh lá', value: '#059669' },
  { name: 'Vàng', value: '#D97706' },
  { name: 'Xanh dương', value: '#2563EB' },
  { name: 'Trắng', value: '#F8FAFC' },
];
const BAND_COLORS = ['#0F172A', '#92400E', '#DC2626', '#EA580C', '#D97706', '#059669', '#2563EB', '#7C3AED', '#64748B', '#F8FAFC'];

function main() {
  // --- Trạng thái bàn ---
  let state = loadState();
  let selected = null;          // {kind:'comp'|'wire', id}
  let wiringMode = false;
  let wireColor = SIGNAL_COLORS[0];
  let wireStart = null;         // lỗ bắt đầu của dây đang đi
  let placementMode = null;     // type đang chờ bấm lỗ để đặt (bấm khay, không kéo)
  let drag = null;              // {mode:'palette'|'move'|'move-psu'|'orbit', ...}
  let pressedBtn = null;        // id nút đang nhấn giữ trên bàn
  let seq = 1, wireSeq = 100;
  state.components.forEach((c) => {
    const n = parseInt(String(c.id).replace(/^[A-Z]+/, ''), 10);
    if (!isNaN(n) && n >= seq) seq = n + 1;
  });
  state.wires.forEach((w) => {
    const n = parseInt(String(w.id).replace(/^W/, ''), 10);
    if (!isNaN(n) && n >= wireSeq) wireSeq = n + 1;
  });

  // --- Three.js (tải lười khi mở tab lần đầu) ---
  let THREE = null, sceneReady = false, threeFailed = false;
  let renderer, scene, camera, raycaster;
  let boardGroup, compRoot, wireRoot, highlightBox, startMarker;
  const compMeshes = new Map();   // compId -> THREE.Group
  const wireMeshes = new Map();   // wireId -> THREE.Mesh (ống) + hit tube
  const ledMats = new Map();      // compId -> material phát sáng LED
  const lcdTexs = new Map();      // compId -> {canvas, ctx, tex, last}
  const buzzerMats = new Map();   // compId -> material còi
  const btnTops = new Map();      // compId -> mesh nút bấm (để nhấn xuống)
  const orbit = { az: 0.5, el: 0.72, r: 480 };
  const orbitTarget = { az: 0.5, el: 0.72, r: 480 };
  const camTarget = { x: 0, y: 0, z: -20 };
  let rafId = null, liveTimer = null;

  const bridge = () => window.HoaTrangBenchBridge || null;

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultBenchState();
      return sanitizeState(JSON.parse(raw));
    } catch { return defaultBenchState(); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* bỏ qua */ }
  }
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  // --- Đồng bộ netlist bench vào CPU + panel Kiểm tra ---
  function syncToCpu() {
    const b = bridge();
    if (b && typeof b.applyBenchNetlist === 'function') {
      b.applyBenchNetlist(benchToNetlist(state));
      for (const c of state.components) {
        if (c.type === 'pot') b.setPot(c.id, ((c.props?.pct ?? 0) / 100) * 5);
      }
    }
    renderChecks();
  }
  function renderChecks() {
    if (!checksEl) return;
    const netlist = benchToNetlist(state);
    const b = bridge();
    const warns = checkWiring(netlist, b && typeof b.getTris === 'function' ? b.getTris() : null);
    if (!warns.length) {
      checksEl.innerHTML = '<li class="check-ok">Mạch ổn — không phát hiện vấn đề đấu nối.</li>';
      return;
    }
    checksEl.innerHTML = warns.map((w, i) =>
      `<li><button type="button" class="check-item ${w.kind === 'short' ? 'check-short' : 'check-warn'}" data-warn="${i}">${esc(w.message)}</button></li>`).join('');
    checksEl.querySelectorAll('.check-item').forEach((btn) => btn.addEventListener('click', () => {
      const w = warns[Number(btn.dataset.warn)];
      const compId = compIdFromWarning(w);
      if (compId) select({ kind: 'comp', id: compId });
    }));
  }
  function compIdFromWarning(w) {
    for (const id of [...(w.compIds || []), ...(w.terminalIds || [])]) {
      if (id.startsWith('PIC.')) return 'PIC1';
      const m = id.match(/^(LED\d+|BTN\d+|POT\d+|LCD\d+|BUZ\d+)/);
      if (m && state.components.some((c) => c.id === m[1])) return m[1];
    }
    return null;
  }

  // --- Khay linh kiện (bên trái) ---
  const PALETTE = [
    { type: 'led', name: 'LED', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 48 64"><line x1="18" y1="34" x2="18" y2="62" stroke="#94A3B8" stroke-width="3"/><line x1="30" y1="34" x2="30" y2="62" stroke="#94A3B8" stroke-width="3"/><circle cx="24" cy="22" r="14" fill="#DC2626" stroke="#991B1B" stroke-width="2"/><circle cx="20" cy="18" r="4" fill="#FCA5A5"/></svg>' },
    { type: 'resistor', name: 'Điện trở 220Ω', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 76 30"><line x1="0" y1="15" x2="14" y2="15" stroke="#94A3B8" stroke-width="3"/><line x1="62" y1="15" x2="76" y2="15" stroke="#94A3B8" stroke-width="3"/><rect x="14" y="7" width="48" height="16" rx="8" fill="#D9A066" stroke="#92400E" stroke-width="1.5"/><rect x="26" y="7" width="4" height="16" fill="#DC2626"/><rect x="34" y="7" width="4" height="16" fill="#DC2626"/><rect x="42" y="7" width="4" height="16" fill="#92400E"/></svg>' },
    { type: 'button', name: 'Nút nhấn', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 56 56"><rect x="6" y="6" width="44" height="44" rx="6" fill="#FFFFFF" stroke="#1E3A5F" stroke-width="2"/><circle cx="28" cy="28" r="11" fill="#F1F3F5" stroke="#1E3A5F" stroke-width="2"/></svg>' },
    { type: 'pot', name: 'Chiết áp', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#FFFFFF" stroke="#1E3A5F" stroke-width="2"/><circle cx="32" cy="32" r="16" fill="#F1F3F5" stroke="#1E3A5F" stroke-width="2"/><line x1="32" y1="32" x2="32" y2="19" stroke="#DC2626" stroke-width="3"/></svg>' },
    { type: 'lcd', name: 'LCD 16x2', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 210 84"><rect x="2" y="6" width="206" height="72" rx="6" fill="#123524" stroke="#0F172A" stroke-width="2"/><rect x="16" y="20" width="16" height="16" rx="1" fill="#2E7D4F"/><rect x="38" y="20" width="16" height="16" rx="1" fill="#2E7D4F"/><rect x="60" y="20" width="16" height="16" rx="1" fill="#2E7D4F"/><rect x="16" y="46" width="16" height="16" rx="1" fill="#2E7D4F"/><rect x="38" y="46" width="16" height="16" rx="1" fill="#2E7D4F"/><text x="200" y="14" text-anchor="end" font-family="Fira Code, monospace" font-size="8" fill="#7CFFB2">16x2</text></svg>' },
    { type: 'buzzer', name: 'Còi buzzer', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="#FFFFFF" stroke="#1E3A5F" stroke-width="2"/><circle cx="28" cy="28" r="9" fill="#F1F3F5" stroke="#94A3B8" stroke-width="2"/><circle cx="28" cy="28" r="3" fill="#475569"/></svg>' },
    { type: 'psu', name: 'Nguồn 5V', hint: 'Kéo thả lên mặt bàn', svg: '<svg viewBox="0 0 120 72"><rect x="4" y="6" width="112" height="60" rx="6" fill="#334155" stroke="#0F172A" stroke-width="2"/><rect x="14" y="16" width="52" height="20" rx="3" fill="#0F172A"/><text x="40" y="31" text-anchor="middle" font-family="Fira Code, monospace" font-size="12" fill="#F87171">5.00</text><circle cx="88" cy="26" r="7" fill="#DC2626"/><circle cx="104" cy="26" r="7" fill="#0F172A" stroke="#94A3B8" stroke-width="2"/></svg>' },
    { type: 'wire', name: 'Dây dẫn', hint: 'Bấm để vào chế độ đi dây', svg: '<svg viewBox="0 0 76 30"><path d="M6 24 C 24 4, 52 4, 70 24" fill="none" stroke="#2563EB" stroke-width="4" stroke-linecap="round"/><circle cx="6" cy="24" r="4" fill="#1E3A5F"/><circle cx="70" cy="24" r="4" fill="#1E3A5F"/></svg>' },
  ];
  function renderPalette(filter = '') {
    const q = filter.trim().toLowerCase();
    paletteEl.innerHTML = PALETTE.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) =>
      `<div class="bench-pal-item${p.type === 'wire' && wiringMode ? ' wiring' : ''}" data-type="${p.type}" title="${p.hint}">${p.svg}<span>${p.name}</span></div>`).join('')
      || '<p class="sub">Không tìm thấy linh kiện nào.</p>';
    paletteEl.querySelectorAll('.bench-pal-item').forEach((el) => {
      el.addEventListener('pointerdown', (e) => onPalettePointerDown(e, el.dataset.type));
    });
  }
  if (searchEl) searchEl.addEventListener('input', () => renderPalette(searchEl.value));

  // --- Chế độ đi dây / đặt linh kiện bằng bấm ---
  function setWiringMode(on) {
    wiringMode = on;
    if (on) { placementMode = null; wireStart = null; }
    updateModeBanner();
    renderPalette(searchEl ? searchEl.value : '');
    if (on) setStatus('Đang đi dây — bấm lỗ bắt đầu rồi bấm lỗ kết thúc. Esc để hủy.');
  }
  function setPlacementMode(type) {
    placementMode = type;
    if (type) { wiringMode = false; wireStart = null; }
    updateModeBanner();
    if (type) setStatus('Đang đặt ' + (PALETTE.find((p) => p.type === type)?.name || type) + ' — bấm vào lỗ để đặt. Esc để hủy.');
  }
  function updateModeBanner() {
    if (!modeBanner) return;
    if (wiringMode) {
      modeBanner.hidden = false;
      modeText.innerHTML = '<strong>Đang đi dây</strong> — bấm lỗ bắt đầu rồi bấm lỗ kết thúc · Esc hủy';
      modeColors.hidden = false;
      modeColors.innerHTML = SIGNAL_COLORS.map((c) =>
        `<button type="button" class="bench-color${c === wireColor ? ' sel' : ''}" data-color="${c}" style="background:${c}" aria-label="Màu dây ${c}"></button>`).join('');
      modeColors.querySelectorAll('.bench-color').forEach((b) => b.addEventListener('click', () => {
        wireColor = b.dataset.color;
        updateModeBanner();
      }));
    } else if (placementMode) {
      modeBanner.hidden = false;
      modeText.innerHTML = '<strong>Đang đặt ' + esc(PALETTE.find((p) => p.type === placementMode)?.name || placementMode) + '</strong> — bấm vào lỗ để đặt · Esc hủy';
      modeColors.hidden = true;
    } else {
      modeBanner.hidden = true;
    }
  }
  $('btnWireCancel')?.addEventListener('click', () => { setWiringMode(false); setPlacementMode(null); setStatus('Đã hủy.'); });

  // --- Chọn / Inspector (panel trượt từ phải) ---
  function select(sel) {
    selected = sel;
    updateSelectionVisual();
    renderInspector();
  }
  function updateSelectionVisual() {
    if (!sceneReady) return;
    const selComp = selected && selected.kind === 'comp'
      ? state.components.find((c) => c.id === selected.id) : null;
    if (selComp && selComp.type !== 'psu' && selComp.type !== 'pic') showHighlightForComp(selComp.id);
    else hideHighlight();
    wireMeshes.forEach((m, id) => {
      const on = selected && selected.kind === 'wire' && selected.id === id;
      if (m.userData.tubeMat) m.userData.tubeMat.emissive = new THREE.Color(on ? 0x059669 : 0x000000);
    });
  }
  function renderInspector() {
    if (!inspectorEl) return;
    if (!selected) { inspectorEl.classList.remove('open'); inspectorEl.innerHTML = ''; return; }
    if (selected.kind === 'wire') {
      const w = state.wires.find((x) => x.id === selected.id);
      if (!w) { select(null); return; }
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>Dây dẫn</strong><div class="bench-insp-pos">${esc(holeName(w.a))} ↔ ${esc(holeName(w.b))}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">
          <label class="bench-insp-label">Màu dây</label>
          <div class="bench-colors">${SIGNAL_COLORS.map((c) => `<button type="button" class="bench-color${c === w.color ? ' sel' : ''}" data-color="${c}" style="background:${c}" aria-label="Màu dây ${c}"></button>`).join('')}</div>
          <p class="sub">Dây nối 2 strip của 2 lỗ. Bấm vào dây trên bàn để chọn lại.</p>
        </div>
        <div class="bench-insp-foot"><button type="button" class="btn btn-danger-outline btn-small" data-act="del-wire">Xoá dây</button></div>`;
      inspectorEl.querySelectorAll('.bench-color').forEach((b) => b.addEventListener('click', () => {
        w.color = b.dataset.color;
        save(); rebuildWires(); renderInspector();
      }));
    } else {
      const comp = state.components.find((c) => c.id === selected.id);
      if (!comp) { select(null); return; }
      const pos = comp.type === 'psu' ? `Trên bàn (${Math.round(comp.tx)}, ${Math.round(comp.tz)})` : 'BB: ' + comp.anchor;
      let body = '';
      if (comp.type === 'resistor') {
        body = `<label class="bench-insp-label" for="inspResVal">Giá trị điện trở (Ω)</label>
          <input class="input" id="inspResVal" type="number" min="1" max="10000000" step="1" value="${comp.props?.value ?? 220}">
          <p class="sub">Điện trở nối 2 strip của nó — dùng nối tiếp với LED để hạn dòng.</p>`;
      } else if (comp.type === 'led') {
        body = `<label class="bench-insp-label" for="inspLedColor">Màu LED</label>
          <select class="select" id="inspLedColor">${LED_COLORS.map((c) => `<option value="${c.value}"${(comp.props?.color || '#DC2626') === c.value ? ' selected' : ''}>${c.name}</option>`).join('')}</select>
          <p class="sub">LED sáng khi anode ở mức 1 và cathode về GND (hoặc mức 0).</p>`;
      } else if (comp.type === 'pot') {
        const pct = comp.props?.pct ?? 0;
        body = `<label class="bench-insp-label" for="inspPotRange">Chiết áp — <span id="inspPotVal">${((pct / 100) * 5).toFixed(2)} V</span></label>
          <input type="range" class="pot-slider" id="inspPotRange" min="0" max="100" step="1" value="${pct}">
          <p class="sub">Wiper nối kênh AN nào thì ADC đọc điện áp đó (0–5V).</p>`;
      } else if (comp.type === 'button') {
        body = `<p class="sub">Nhấn giữ linh kiện trên bàn để tác động mức 0 vào chân đã nối (active-low, có pull-up).</p>`;
      } else if (comp.type === 'lcd') {
        const b = bridge();
        const lcd = b && typeof b.getMapping === 'function' ? b.getMapping().lcd : null;
        body = lcd && lcd.id
          ? `<p class="sub">${lcd.complete ? 'LCD đã nối đủ dây, hiện chữ theo code.' : 'LCD chưa nối đủ dây — thiếu: ' + (lcd.missing.join(', ') || 'không rõ') + '.'}</p>`
          : `<p class="sub">LCD hiển thị 2 dòng 16 ký tự theo code (data + RS/E).</p>`;
      } else if (comp.type === 'buzzer') {
        body = `<p class="sub">Còi kêu khi chân + ra mức 1. Tiếng bíp (WebAudio) bật ở panel board.</p>`;
      } else if (comp.type === 'pic') {
        const conns = picLegs().map((l) => {
          const d = describeTerminal(state, l.term);
          const others = d.members.filter((m) => m !== l.term);
          if (!others.length && !d.vcc && !d.gnd) return null;
          const txt = [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map((m) => m.startsWith('PIC.') ? m.slice(4) : m)].join(', ');
          return `<div class="bench-conn"><span>${l.term.slice(4)}</span><span>${esc(txt)}</span></div>`;
        }).filter(Boolean);
        body = `<p class="sub">Chip cắm cố định ở cột 22–41, hàng b/h. ${conns.length} chân đang nối dây.</p>
          <div class="bench-conns">${conns.join('') || '<p class="sub">Chưa chân nào nối dây ngoài nguồn.</p>'}</div>`;
      } else if (comp.type === 'psu') {
        body = `<p class="sub">Nguồn 5V cố định. Cọc + (đỏ) và − (đen) nối vào rail trên/dưới của breadboard.</p>`;
      }
      const conns = comp.type !== 'pic' && comp.type !== 'psu'
        ? `<div class="bench-conns">${legsFor(comp).map((l) => {
          const term = comp.id + '.' + l.term;
          const d = describeTerminal(state, term);
          const others = d.members.filter((m) => m !== term);
          const txt = others.length || d.vcc || d.gnd
            ? [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map((m) => m.startsWith('PIC.') ? m.slice(4) : m)].join(', ')
            : 'chưa nối';
          return `<div class="bench-conn"><span>${l.term}</span><span>${esc(txt)}</span></div>`;
        }).join('')}</div>` : '';
      const canDelete = comp.type !== 'pic' && comp.type !== 'psu';
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>${esc(compLabel(comp))}</strong><div class="bench-insp-pos">${esc(pos)}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">${body}${conns}</div>
        ${canDelete ? '<div class="bench-insp-foot"><button type="button" class="btn btn-danger-outline btn-small" data-act="del-comp">Xoá linh kiện</button></div>' : ''}`;
      const resInput = inspectorEl.querySelector('#inspResVal');
      if (resInput) resInput.addEventListener('change', () => {
        const v = Math.round(Number(resInput.value));
        if (v >= 1 && v <= 10000000) {
          comp.props = { ...(comp.props || {}), value: v };
          save(); rebuildAll(); renderInspector();
          setStatus('Đã đổi ' + compLabel(comp) + ' thành ' + v + 'Ω.');
        } else { resInput.value = comp.props?.value ?? 220; }
      });
      const ledSel = inspectorEl.querySelector('#inspLedColor');
      if (ledSel) ledSel.addEventListener('change', () => {
        comp.props = { ...(comp.props || {}), color: ledSel.value };
        save(); rebuildAll(); renderInspector();
        setStatus('Đã đổi màu LED.');
      });
      const potRange = inspectorEl.querySelector('#inspPotRange');
      if (potRange) {
        potRange.addEventListener('input', () => {
          const pct = Number(potRange.value);
          comp.props = { ...(comp.props || {}), pct };
          const valEl = inspectorEl.querySelector('#inspPotVal');
          if (valEl) valEl.textContent = ((pct / 100) * 5).toFixed(2) + ' V';
          const b = bridge();
          if (b && typeof b.setPot === 'function') b.setPot(comp.id, (pct / 100) * 5);
        });
        potRange.addEventListener('change', () => save());
      }
    }
    inspectorEl.classList.add('open');
    inspectorEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
    inspectorEl.querySelector('[data-act="del-comp"]')?.addEventListener('click', () => deleteSelected());
    inspectorEl.querySelector('[data-act="del-wire"]')?.addEventListener('click', () => deleteSelected());
  }
  function holeName(e) {
    if (typeof e === 'string') return e;
    if (e && typeof e.x === 'number') return 'cọc nguồn';
    return '?';
  }
  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'wire') {
      state.wires = state.wires.filter((w) => w.id !== selected.id);
      setStatus('Đã gỡ dây.');
    } else {
      const comp = state.components.find((c) => c.id === selected.id);
      if (!comp || comp.type === 'pic' || comp.type === 'psu') return;
      state.components = state.components.filter((c) => c.id !== selected.id);
      setStatus('Đã gỡ ' + compLabel(comp) + ' khỏi bàn.');
    }
    select(null);
    save(); rebuildAll(); syncToCpu();
  }

  // --- Three.js: khởi tạo lười khi mở tab lần đầu ---
  async function ensureScene() {
    if (sceneReady || threeFailed) return;
    try {
      THREE = await import('three');
    } catch (e) {
      threeFailed = true;
      if (errorEl) errorEl.hidden = false;
      setStatus('Không tải được thư viện 3D, kiểm tra mạng rồi tải lại trang.');
      return;
    }
    try {
      buildScene();
    } catch (e) {
      threeFailed = true;
      if (errorEl) errorEl.hidden = false;
      setStatus('Không tải được thư viện 3D, kiểm tra mạng rồi tải lại trang.');
      console.error(e);
      return;
    }
    sceneReady = true;
    rebuildAll();
    syncToCpu();
    startLoop();
    startLivePoll();
  }
  function showBenchError() {
    if (errorEl) errorEl.hidden = false;
  }

  function buildScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    wrap.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEDF1F5);
    camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
    raycaster = new THREE.Raycaster();

    const hemi = new THREE.HemisphereLight(0xFFFFFF, 0x94A3B8, 0.9);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xFFFFFF, 1.6);
    dir.position.set(220, 320, 180);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -320; dir.shadow.camera.right = 320;
    dir.shadow.camera.top = 320; dir.shadow.camera.bottom = -320;
    dir.shadow.camera.far = 1200;
    scene.add(dir);

    // Mặt bàn + lưới
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_W, TABLE_D),
      new THREE.MeshStandardMaterial({ color: 0xDDE3E8, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);
    const grid = new THREE.GridHelper(TABLE_W, TABLE_W / 30, 0xCBD5E1, 0xE2E8F0);
    grid.position.y = 0.2;
    scene.add(grid);

    boardGroup = new THREE.Group();
    scene.add(boardGroup);
    buildBreadboardMesh();
    compRoot = new THREE.Group();
    scene.add(compRoot);
    wireRoot = new THREE.Group();
    scene.add(wireRoot);

    // Ô sáng báo vị trí đặt linh kiện (xanh = đặt được, đỏ = không)
    highlightBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1.5, 1),
      new THREE.MeshBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.35, depthWrite: false }));
    highlightBox.visible = false;
    scene.add(highlightBox);
    // Dấu chấm báo lỗ bắt đầu đi dây
    startMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x2563EB }));
    startMarker.visible = false;
    scene.add(startMarker);

    // Sự kiện chuột trên canvas
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onCanvasPointerDown);
    cv.addEventListener('pointermove', onCanvasPointerMove);
    cv.addEventListener('pointerup', onCanvasPointerUp);
    cv.addEventListener('pointercancel', onCanvasPointerUp);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbitTarget.r = clamp(orbitTarget.r * Math.exp(e.deltaY * 0.001), 180, 900);
    }, { passive: false });
    new ResizeObserver(() => {
      if (!renderer) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }).observe(wrap);
    const w0 = wrap.clientWidth || 800, h0 = wrap.clientHeight || 620;
    renderer.setSize(w0, h0, false);
    camera.aspect = w0 / h0;
    camera.updateProjectionMatrix();
  }

  function makeBoardTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 292;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 1024, 292);
    const px = (xmm) => (xmm + 85) * (1024 / 170);
    const py = (zmm) => (zmm + 24) * (292 / 48);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 15px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let col = 1; col <= 63; col += 5) {
      const x = px((col - 32) * PITCH);
      ctx.fillText(String(col), x, py(-22));
      ctx.fillText(String(col), x, py(22));
    }
    for (let r = 0; r <= 9; r++) {
      const z = py((r - 4.5) * PITCH);
      ctx.fillText('abcdefghij'[r], px(-82), z);
      ctx.fillText('abcdefghij'[r], px(82), z);
    }
    ctx.font = '700 17px "Fira Code", monospace';
    ctx.fillStyle = '#DC2626';
    ctx.fillText('+', px(-82), py(-16.5));
    ctx.fillText('+', px(-82), py(16.5));
    ctx.fillStyle = '#2563EB';
    ctx.fillText('−', px(-82), py(-14));
    ctx.fillText('−', px(-82), py(19));
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function buildBreadboardMesh() {
    // Thân board
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(170, BOARD_TOP, 48),
      new THREE.MeshStandardMaterial({ color: 0xF1F5F9, roughness: 0.6 }));
    body.position.y = BOARD_TOP / 2;
    body.receiveShadow = true;
    boardGroup.add(body);
    // Mặt trên có chữ hàng/cột
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 48),
      new THREE.MeshStandardMaterial({ map: makeBoardTexture(), roughness: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_TOP + 0.05;
    top.receiveShadow = true;
    boardGroup.add(top);
    // Rãnh giữa (giữa hàng e và f)
    const groove = new THREE.Mesh(
      new THREE.BoxGeometry(170, 0.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0xCBD5E1 }));
    groove.position.y = BOARD_TOP + 0.02;
    boardGroup.add(groove);
    // Vạch màu rail +/−
    for (const [r, color] of [[-2, 0xDC2626], [-1, 0x2563EB], [10, 0xDC2626], [11, 0x2563EB]]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(50 * PITCH, 0.5, 1.6),
        new THREE.MeshStandardMaterial({ color }));
      strip.position.set(((50 + 1) / 2 - 32) * PITCH, BOARD_TOP + 0.08, (r - 4.5) * PITCH);
      boardGroup.add(strip);
    }
    // 830 lỗ (InstancedMesh)
    const holes = allHoles();
    const inst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x1F2937, roughness: 0.9 }),
      holes.length);
    const m = new THREE.Matrix4();
    holes.forEach((h, i) => { m.makeTranslation(h.x, BOARD_TOP - 0.25, h.z); inst.setMatrixAt(i, m); });
    inst.receiveShadow = true;
    boardGroup.add(inst);
  }

  // --- Vẽ linh kiện 3D ---
  function stdMat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts });
  }
  function legMesh(x, z, h = 5.5) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, h, 8),
      stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 }));
    leg.position.set(x, h / 2, z);
    leg.castShadow = true;
    return leg;
  }
  function makeTextTexture(text, sub, fg = '#FFFFFF') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = fg;
    ctx.font = '700 52px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, sub ? 48 : 64);
    if (sub) {
      ctx.font = '400 32px "Fira Code", monospace';
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(sub, 256, 96);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }
  function buildComponentMesh(comp) {
    const g = new THREE.Group();
    g.userData.compId = comp.id;
    if (comp.type === 'pic') {
      // Thân chip + 40 chân cắm vào lỗ (cố định ở cột 22..41, hàng b/h)
      const body = new THREE.Mesh(new THREE.BoxGeometry(52.5, 4.5, 14), stdMat(0x0F172A, { roughness: 0.4 }));
      body.position.set(-1.27, BOARD_TOP + 6.2, -1.27);
      body.castShadow = true;
      g.add(body);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(44, 11),
        new THREE.MeshBasicMaterial({ map: makeTextTexture('PIC16F877A', 'DIP-40'), transparent: true }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(-1.27, BOARD_TOP + 8.5, -1.27);
      g.add(label);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 12), stdMat(0xF8FAFC));
      dot.position.set(-25.4, BOARD_TOP + 8.5, -8.89);
      g.add(dot);
      const pinMat = stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 });
      for (const leg of picLegs()) {
        const p = holePos(leg.hole);
        const pin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.5, 0.7), pinMat);
        pin.position.set(p.x, BOARD_TOP + 2.2, p.z);
        g.add(pin);
      }
      return g;
    }
    if (comp.type === 'psu') {
      // Hộp nguồn 5V đặt trên mặt bàn, mặt trước quay về phía breadboard
      g.position.set(comp.tx, 0, comp.tz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 80), stdMat(0x334155, { roughness: 0.5 }));
      body.position.y = 35;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const disp = new THREE.Mesh(
        new THREE.PlaneGeometry(52, 20),
        new THREE.MeshBasicMaterial({ map: makeDisplayTexture() }));
      disp.position.set(0, 52, 40.2);
      g.add(disp);
      const postR = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 10, 16), stdMat(0xDC2626));
      postR.rotation.x = Math.PI / 2;
      postR.position.set(-12, 28, 42);
      g.add(postR);
      const postB = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 10, 16), stdMat(0x0F172A));
      postB.rotation.x = Math.PI / 2;
      postB.position.set(12, 28, 42);
      g.add(postB);
      return g;
    }
    // Linh kiện cắm lỗ: gốc nhóm ở lỗ neo, chân theo legOffsets
    const anchor = holePos(comp.anchor);
    g.position.set(anchor.x, BOARD_TOP, anchor.z);
    g.rotation.y = -((comp.rot || 0) * Math.PI) / 2;
    const offs = legOffsets(comp.type, comp.rot || 0);
    for (const o of offs) g.add(legMesh(o.dc * PITCH, o.dr * PITCH));
    if (comp.type === 'led') {
      const color = comp.props?.color || '#DC2626';
      const mat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.15, roughness: 0.3 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5.5, 16), mat);
      body.position.set(1.27, 8.25, 0);
      body.castShadow = true;
      g.add(body);
      ledMats.set(comp.id, mat);
    } else if (comp.type === 'resistor') {
      const value = comp.props?.value ?? 220;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 7, 12), stdMat(0xD9A066));
      body.rotation.z = Math.PI / 2;
      body.position.set(5.08, 6.5, 0);
      body.castShadow = true;
      g.add(body);
      const bands = resistorBands(value);
      bands.forEach((col, i) => {
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(1.18, 1.18, 0.9, 12),
          stdMat(col));
        band.rotation.z = Math.PI / 2;
        band.position.set(5.08 + [-2.2, -0.7, 0.8, 2.4][i], 6.5, 0);
        g.add(band);
      });
      for (const x of [0, 10.16]) {
        const link = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 3.4, 8), stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 }));
        link.rotation.z = Math.PI / 2;
        link.position.set(x + (x === 0 ? 1.7 : -1.7), 6.5, 0);
        g.add(link);
      }
    } else if (comp.type === 'button') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.5, 6.5), stdMat(0xFFFFFF));
      base.position.set(1.27, 6.75, 1.27);
      base.castShadow = true;
      g.add(base);
      // 2 chân trang trí ở hàng sau (cùng strip với 2 chân chính)
      for (const [x, z] of [[0, 2.54], [2.54, 2.54]]) g.add(legMesh(x, z));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 2, 16), stdMat(0xF1F5F9));
      top.position.set(1.27, 9, 1.27);
      top.castShadow = true;
      g.add(top);
      btnTops.set(comp.id, top);
    } else if (comp.type === 'pot') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 9), stdMat(0x2563EB));
      box.position.set(2.54, 8, 0);
      box.castShadow = true;
      g.add(box);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.5, 16), stdMat(0xF8FAFC));
      knob.position.set(2.54, 12.2, 0);
      g.add(knob);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 2.6), stdMat(0xDC2626));
      mark.position.set(2.54, 13.5, 0);
      g.add(mark);
    } else if (comp.type === 'lcd') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(80, 8, 36), stdMat(0x123524, { roughness: 0.5 }));
      body.position.set(11.43, 9, 18);
      body.castShadow = true;
      g.add(body);
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 17.5),
        new THREE.MeshBasicMaterial({ map: tex }));
      screen.rotation.x = -Math.PI / 2;
      screen.position.set(11.43, 13.1, 18);
      g.add(screen);
      lcdTexs.set(comp.id, { canvas: cv, ctx: cv.getContext('2d'), tex, last: '' });
    } else if (comp.type === 'buzzer') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0F172A, emissive: 0xD97706, emissiveIntensity: 0, roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 8, 20), mat);
      body.position.set(1.27, 9, 0);
      body.castShadow = true;
      g.add(body);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.6, 12), stdMat(0x334155));
      hole.position.set(1.27, 13.1, 0);
      g.add(hole);
      buzzerMats.set(comp.id, mat);
    }
    return g;
  }
  function makeDisplayTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#F87171';
    ctx.font = '700 52px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('5.00', 108, 48);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 28px "Fira Code", monospace';
    ctx.fillText('V', 216, 48);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  function resistorBands(value) {
    const v = Math.max(1, Math.round(value));
    const digits = String(v);
    const d1 = Number(digits[0]);
    const d2 = digits.length > 1 ? Number(digits[1]) : 0;
    const mult = Math.min(5, Math.max(0, digits.length - 2));
    return [BAND_COLORS[d1], BAND_COLORS[d2], BAND_COLORS[mult], '#D9A066'];
  }
  function buildWireMesh(wire) {
    const a = endpointPos(wire.a);
    const b = endpointPos(wire.b);
    if (!a || !b) return null;
    const up = (p, h) => new THREE.Vector3(p.x, p.y + h, p.z);
    const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 42, (a.z + b.z) / 2);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x, a.y, a.z), up(a, 18), mid, up(b, 18), new THREE.Vector3(b.x, b.y, b.z),
    ]);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(wire.color), emissive: 0x000000, roughness: 0.5 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 1.1, 8), mat);
    tube.castShadow = true;
    tube.userData = { wireId: wire.id, tubeMat: mat };
    // Ống vô hình dày hơn để bấm chọn dây cho dễ
    const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 3.2, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData = { wireId: wire.id, tubeMat: mat, hitFor: wire.id };
    const grp = new THREE.Group();
    grp.add(tube);
    grp.add(hit);
    grp.userData = { wireId: wire.id, tubeMat: mat };
    return grp;
  }
  function endpointPos(e) {
    if (typeof e === 'string') {
      const p = holePos(e);
      return p ? { x: p.x, y: BOARD_TOP, z: p.z } : null;
    }
    if (e && typeof e.x === 'number') return { x: e.x, y: e.y, z: e.z };
    return null;
  }
  function rebuildAll() {
    if (!sceneReady) return;
    for (const [, g] of compMeshes) compRoot.remove(g);
    compMeshes.clear();
    ledMats.clear(); lcdTexs.clear(); buzzerMats.clear(); btnTops.clear();
    for (const comp of state.components) {
      const g = buildComponentMesh(comp);
      compRoot.add(g);
      compMeshes.set(comp.id, g);
    }
    rebuildWires();
    updateSelectionVisual();
  }
  function rebuildWires() {
    if (!sceneReady) return;
    for (const [, g] of wireMeshes) wireRoot.remove(g);
    wireMeshes.clear();
    for (const w of state.wires) {
      const g = buildWireMesh(w);
      if (!g) continue;
      wireRoot.add(g);
      wireMeshes.set(w.id, g);
    }
    updateSelectionVisual();
  }

  // --- Đặt linh kiện / dây ---
  function placeComponent(type, anchor, rot = 0, tx = 0, tz = 0) {
    if (type === 'psu') {
      const id = nextComponentId(state, 'psu');
      state.components.push({ id, type: 'psu', tx, tz, fixed: false, props: {} });
      save(); rebuildAll(); syncToCpu();
      select({ kind: 'comp', id });
      setStatus('Đã đặt Nguồn 5V lên bàn.');
      return id;
    }
    const chk = canPlace(state, type, anchor, rot);
    if (!chk.ok) { setStatus(chk.reason); return null; }
    const id = nextComponentId(state, type);
    const comp = { id, type, anchor, rot, props: defaultProps(type) };
    state.components.push(comp);
    save(); rebuildAll(); syncToCpu();
    select({ kind: 'comp', id });
    setStatus('Đã đặt ' + compLabel(comp) + ' vào lỗ ' + anchor + '.');
    return id;
  }
  function addWire(a, b) {
    if (a === b) { setStatus('Hai đầu trùng nhau — chọn 2 lỗ khác nhau.'); return false; }
    const dup = state.wires.some((w) =>
      (w.a === a && w.b === b) || (w.a === b && w.b === a));
    if (dup) { setStatus('Đã có dây nối 2 lỗ này rồi.'); return false; }
    const id = 'W' + (wireSeq++);
    state.wires.push({ id, a, b, color: wireColor });
    save(); rebuildWires(); syncToCpu();
    setStatus('Đã nối dây ' + (typeof a === 'string' ? a : 'cọc nguồn') + ' ↔ ' + (typeof b === 'string' ? b : 'cọc nguồn') + '.');
    return true;
  }

  // --- Raycast / chọn lỗ ---
  function pointerNdc(e) {
    const r = renderer.domElement.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
      inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
    };
  }
  const boardPlane = () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
  const tablePlane = () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pickHole(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(boardPlane(), pt)) return null;
    const col = Math.round(pt.x / PITCH) + 32;
    let best = null, bestD = 1e9;
    for (let r = -2; r <= 11; r++) {
      const z = (r - 4.5) * PITCH;
      const d = Math.abs(pt.z - z);
      if (d < bestD) { bestD = d; best = r; }
    }
    const id = holeId(best, col);
    if (!id) return null;
    const hp = holePos(id);
    const dist = Math.hypot(pt.x - hp.x, pt.z - hp.z);
    return dist <= 2.0 ? id : null;
  }
  function pickTablePoint(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(tablePlane(), pt)) return null;
    return { x: Math.max(-330, Math.min(330, pt.x)), z: Math.max(-200, Math.min(200, pt.z)) };
  }
  function pickObject(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const objs = [...wireMeshes.values(), ...compMeshes.values()];
    const hits = raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData?.compId) return { kind: 'comp', id: o.userData.compId };
        if (o.userData?.wireId) return { kind: 'wire', id: o.userData.wireId };
        o = o.parent;
      }
    }
    return null;
  }
  function footprintBox(type, rot) {
    const offs = legOffsets(type, rot);
    if (!offs.length) return { w: 12, d: 12, cx: 0, cz: 0 };
    const dcs = offs.map((o) => o.dc), drs = offs.map((o) => o.dr);
    const minDc = Math.min(...dcs), maxDc = Math.max(...dcs);
    const minDr = Math.min(...drs), maxDr = Math.max(...drs);
    return {
      w: (maxDc - minDc + 1) * PITCH + 6,
      d: (maxDr - minDr + 1) * PITCH + 6,
      cx: ((minDc + maxDc) / 2) * PITCH,
      cz: ((minDr + maxDr) / 2) * PITCH,
    };
  }
  function showHighlight(anchor, type, rot, ok) {
    if (!sceneReady) return;
    const p = holePos(anchor);
    if (!p) { highlightBox.visible = false; return; }
    const fp = footprintBox(type, rot);
    highlightBox.visible = true;
    highlightBox.scale.set(fp.w, 1, fp.d);
    highlightBox.material.color.set(ok ? 0x059669 : 0xDC2626);
    highlightBox.position.set(p.x + fp.cx, BOARD_TOP + 0.8, p.z + fp.cz);
    highlightBox.rotation.y = 0;
  }
  function showHighlightForComp(id) {
    const comp = state.components.find((c) => c.id === id);
    if (!comp || comp.type === 'psu' || !sceneReady) { hideHighlight(); return; }
    showHighlight(comp.anchor, comp.type, comp.rot || 0, true);
    highlightBox.material.color.set(0x059669);
  }
  function hideHighlight() { if (highlightBox) highlightBox.visible = false; }
  function showTableHighlight(x, z, ok) {
    if (!sceneReady) return;
    highlightBox.visible = true;
    highlightBox.scale.set(124, 1, 84);
    highlightBox.material.color.set(ok ? 0x059669 : 0xDC2626);
    highlightBox.position.set(x, 1, z);
    highlightBox.rotation.y = 0;
  }

  // --- Kéo-thả từ khay (pointer tự viết, không HTML5 DnD) ---
  let ghostEl = null;
  function makeGhost(name) {
    removeGhost();
    ghostEl = document.createElement('div');
    ghostEl.className = 'bench-ghost';
    ghostEl.textContent = name;
    document.body.appendChild(ghostEl);
  }
  function removeGhost() { if (ghostEl) { ghostEl.remove(); ghostEl = null; } }
  function onPalettePointerDown(e, type) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (type === 'wire') { setWiringMode(!wiringMode); return; }
    if (!sceneReady) { setStatus('Không tải được thư viện 3D, kiểm tra mạng rồi tải lại trang.'); return; }
    const def = PALETTE.find((p) => p.type === type);
    makeGhost(def ? def.name : type);
    drag = { mode: 'palette', type, rot: 0, moved: false, anchor: null, valid: false, tx: 0, tz: 0, startX: e.clientX, startY: e.clientY };
    moveGhost(e);
    window.addEventListener('pointermove', onPaletteDragMove);
    window.addEventListener('pointerup', onPaletteDragEnd, { once: true });
  }
  function moveGhost(e) {
    if (ghostEl) { ghostEl.style.left = (e.clientX + 14) + 'px'; ghostEl.style.top = (e.clientY + 14) + 'px'; }
  }
  function onPaletteDragMove(e) {
    if (!drag || drag.mode !== 'palette') return;
    moveGhost(e);
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
    if (drag.type === 'psu') {
      const pt = pickTablePoint(e);
      if (!pt) { drag.valid = false; hideHighlight(); return; }
      drag.tx = pt.x; drag.tz = pt.z;
      const blocked = Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64;
      drag.valid = !blocked;
      showTableHighlight(pt.x, pt.z, !blocked);
      return;
    }
    const hole = pickHole(e);
    if (!hole) { drag.anchor = null; drag.valid = false; hideHighlight(); return; }
    drag.anchor = hole;
    const chk = canPlace(state, drag.type, hole, drag.rot);
    drag.valid = chk.ok;
    showHighlight(hole, drag.type, drag.rot, chk.ok);
  }
  function onPaletteDragEnd(e) {
    window.removeEventListener('pointermove', onPaletteDragMove);
    removeGhost();
    hideHighlight();
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // Bấm (không kéo): vào chế độ đặt bằng bấm lỗ
      setPlacementMode(d.type);
      return;
    }
    if (d.type === 'psu') {
      if (d.valid) placeComponent('psu', null, 0, d.tx, d.tz);
      else setStatus('Không đặt được nguồn ở đây (đè lên breadboard).');
      return;
    }
    if (d.valid && d.anchor) placeComponent(d.type, d.anchor, d.rot);
    else if (d.anchor) setStatus('Không đặt được linh kiện vào lỗ này.');
  }

  // --- Chuột trên canvas: xoay / di chuyển / chọn / đi dây ---
  function onCanvasPointerDown(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    if (wiringMode) {
      const hole = pickHole(e);
      if (!hole) { wireStart = null; startMarker.visible = false; return; }
      if (!wireStart) {
        wireStart = hole;
        const p = holePos(hole);
        startMarker.position.set(p.x, BOARD_TOP + 2, p.z);
        startMarker.visible = true;
        setStatus('Đã chọn lỗ bắt đầu ' + hole + ' — bấm lỗ kết thúc.');
      } else {
        const a = wireStart;
        wireStart = null;
        startMarker.visible = false;
        addWire(a, hole);
      }
      return;
    }
    if (placementMode) {
      if (placementMode === 'psu') {
        const pt = pickTablePoint(e);
        if (pt && !(Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64)) placeComponent('psu', null, 0, pt.x, pt.z);
        else setStatus('Không đặt được nguồn ở đây (đè lên breadboard).');
        return;
      }
      const hole = pickHole(e);
      if (!hole) return;
      placeComponent(placementMode, hole, 0);
      return;
    }
    const hit = pickObject(e);
    if (hit && hit.kind === 'comp') {
      const comp = state.components.find((c) => c.id === hit.id);
      if (!comp) return;
      select({ kind: 'comp', id: comp.id });
      if (comp.type === 'button') {
        pressBenchButton(comp.id, true);
      }
      if (comp.type === 'pic') return; // chip cố định, chỉ chọn để xem
      if (comp.type === 'psu') {
        drag = { mode: 'move-psu', id: comp.id, startX: e.clientX, startY: e.clientY, origTx: comp.tx, origTz: comp.tz, moved: false };
      } else {
        drag = { mode: 'move', id: comp.id, startX: e.clientX, startY: e.clientY, origAnchor: comp.anchor, origRot: comp.rot || 0, rot: comp.rot || 0, anchor: comp.anchor, valid: true, moved: false };
      }
      renderer.domElement.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (hit && hit.kind === 'wire') {
      select({ kind: 'wire', id: hit.id });
      return;
    }
    // Chỗ trống: kéo để xoay 360°
    drag = { mode: 'orbit', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    renderer.domElement.setPointerCapture(e.pointerId);
    wrap.classList.add('rotating');
    e.preventDefault();
  }
  function onCanvasPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (!drag) return;
    if (drag.mode === 'orbit') {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      orbitTarget.az -= dx * 0.005;
      orbitTarget.el = clamp(orbitTarget.el + dy * 0.004, 0.15, 1.45);
      return;
    }
    if (drag.mode === 'move') {
      if (pressedBtn) { pressBenchButton(pressedBtn, false); pressedBtn = null; }
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      const hole = pickHole(e);
      const g = compMeshes.get(drag.id);
      if (!hole || !g) { drag.valid = false; hideHighlight(); return; }
      const chk = canPlace(state, state.components.find((c) => c.id === drag.id).type, hole, drag.rot, drag.id);
      drag.anchor = hole;
      drag.valid = chk.ok;
      const p = holePos(hole);
      g.position.set(p.x, BOARD_TOP, p.z);
      g.rotation.y = -((drag.rot || 0) * Math.PI) / 2;
      showHighlight(hole, state.components.find((c) => c.id === drag.id).type, drag.rot, chk.ok);
      return;
    }
    if (drag.mode === 'move-psu') {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      const pt = pickTablePoint(e);
      const g = compMeshes.get(drag.id);
      if (!pt || !g) return;
      const blocked = Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64;
      drag.valid = !blocked;
      drag.tx = pt.x; drag.tz = pt.z;
      g.position.set(pt.x, 0, pt.z);
      showTableHighlight(pt.x, pt.z, !blocked);
    }
  }
  function onCanvasPointerUp(e) {
    if (pressedBtn) { pressBenchButton(pressedBtn, false); pressedBtn = null; }
    wrap.classList.remove('rotating');
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'orbit') {
      if (!d.moved) select(null); // bấm chỗ trống: bỏ chọn
      return;
    }
    if (d.mode === 'move') {
      const comp = state.components.find((c) => c.id === d.id);
      if (!comp) return;
      if (!d.moved) return; // bấm chọn: đã select ở pointerdown
      if (d.valid && d.anchor) {
        comp.anchor = d.anchor;
        comp.rot = d.rot;
        save(); rebuildAll(); syncToCpu();
        setStatus('Đã di chuyển ' + compLabel(comp) + ' tới lỗ ' + d.anchor + '.');
      } else {
        rebuildAll(); // về lại vị trí cũ
        setStatus('Không di chuyển được tới đó.');
      }
      return;
    }
    if (d.mode === 'move-psu') {
      const comp = state.components.find((c) => c.id === d.id);
      if (!comp || !d.moved) return;
      if (d.valid) {
        comp.tx = d.tx; comp.tz = d.tz;
        // Cập nhật đầu dây nguồn mặc định theo cọc mới
        for (const w of state.wires) {
          if (w.id === 'W6' && typeof w.a === 'object') w.a = { x: comp.tx - 12, y: 28, z: comp.tz + 42 };
          if (w.id === 'W7' && typeof w.a === 'object') w.a = { x: comp.tx + 12, y: 28, z: comp.tz + 42 };
        }
        save(); rebuildAll(); syncToCpu();
      } else {
        rebuildAll();
      }
    }
  }
  function pressBenchButton(id, pressed) {
    const b = bridge();
    if (b && typeof b.pressButton === 'function') b.pressButton(id, pressed);
    const top = btnTops.get(id);
    if (top) top.position.y = pressed ? 8.2 : 9;
    if (pressed) pressedBtn = id;
  }

  // --- Vòng lặp render + cập nhật sống (LED/LCD/còi theo CPU) ---
  function startLoop() {
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (benchView.hidden || !sceneReady) return;
      orbit.az += (orbitTarget.az - orbit.az) * 0.18;
      orbit.el += (orbitTarget.el - orbit.el) * 0.18;
      orbit.r += (orbitTarget.r - orbit.r) * 0.18;
      const { az, el, r } = orbit;
      camera.position.set(
        camTarget.x + r * Math.cos(el) * Math.sin(az),
        camTarget.y + r * Math.sin(el),
        camTarget.z + r * Math.cos(el) * Math.cos(az));
      camera.lookAt(camTarget.x, camTarget.y, camTarget.z);
      const deg = Math.round((((az * 180) / Math.PI) % 360 + 360) % 360);
      if (angleEl) angleEl.textContent = 'Góc xoay: ' + deg + '°';
      renderer.render(scene, camera);
    };
    tick();
  }
  function startLivePoll() {
    if (liveTimer) return;
    liveTimer = setInterval(() => {
      if (!sceneReady || benchView.hidden) return;
      const b = bridge();
      if (!b) return;
      try {
        if (typeof b.getLedStates === 'function') {
          for (const s of b.getLedStates()) {
            const m = ledMats.get(s.id);
            if (m) m.emissiveIntensity = s.on ? 1.8 : 0.12;
          }
        }
        if (typeof b.getLcd === 'function') {
          const lcd = b.getLcd();
          for (const [, t] of lcdTexs) {
            const key = (lcd.complete ? '1' : '0') + '|' + lcd.lines[0] + '|' + lcd.lines[1];
            if (key === t.last) continue;
            t.last = key;
            const ctx = t.ctx;
            ctx.fillStyle = '#123524';
            ctx.fillRect(0, 0, 256, 64);
            ctx.fillStyle = '#7CFFB2';
            ctx.font = '28px "Fira Code", monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText(lcd.complete ? lcd.lines[0] : 'CHUA NOI DU DAY', 8, 18);
            ctx.fillText(lcd.complete ? lcd.lines[1] : '', 8, 48);
            t.tex.needsUpdate = true;
          }
        }
        if (typeof b.getMapping === 'function' && typeof b.getPin === 'function') {
          const mapping = b.getMapping();
          for (const bz of mapping.buzzers || []) {
            const mat = buzzerMats.get(bz.id);
            if (!mat || !bz.pin) continue;
            const { dir, level } = b.getPin(bz.pin.port, bz.pin.bit);
            mat.emissiveIntensity = dir === 'out' && level === 1 ? 1.2 : 0;
          }
        }
      } catch { /* bridge chưa sẵn: bỏ qua lần này */ }
    }, 150);
  }

  // --- Nút chế độ xem / dọn bàn ---
  $('btnView3D')?.addEventListener('click', () => {
    orbitTarget.el = 0.72; orbitTarget.r = 480;
    $('btnView3D').setAttribute('aria-pressed', 'true');
    $('btnViewTop').setAttribute('aria-pressed', 'false');
  });
  $('btnViewTop')?.addEventListener('click', () => {
    orbitTarget.el = 1.42; orbitTarget.r = 560;
    $('btnView3D').setAttribute('aria-pressed', 'false');
    $('btnViewTop').setAttribute('aria-pressed', 'true');
  });
  $('btnBenchClear')?.addEventListener('click', () => {
    state.components = state.components.filter((c) => c.type === 'pic' || c.type === 'psu');
    state.wires = state.wires.filter((w) => ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].includes(w.id));
    select(null);
    save(); rebuildAll(); syncToCpu();
    setStatus('Đã dọn hết bàn (giữ chip PIC, nguồn 5V và dây nguồn).');
  });
  $('btnBenchDefault')?.addEventListener('click', () => {
    state = defaultBenchState();
    seq = 1; wireSeq = 100;
    select(null);
    save(); rebuildAll(); syncToCpu();
    setStatus('Đã về bàn mặc định: chip PIC + nguồn 5V + dây nguồn.');
  });

  // --- Phím tắt ---
  document.addEventListener('keydown', (e) => {
    if (benchView.hidden) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.key === 'Escape') {
      if (drag?.mode === 'palette') { window.removeEventListener('pointermove', onPaletteDragMove); removeGhost(); hideHighlight(); drag = null; }
      else if (wiringMode) setWiringMode(false);
      else if (placementMode) setPlacementMode(null);
      else if (selected) select(null);
      wireStart = null;
      if (startMarker) startMarker.visible = false;
    } else if ((e.key === 'r' || e.key === 'R') && drag && (drag.mode === 'palette' || drag.mode === 'move')) {
      drag.rot = ((drag.rot || 0) + 1) % 4;
      if (drag.mode === 'move') {
        const g = compMeshes.get(drag.id);
        if (g) g.rotation.y = -((drag.rot || 0) * Math.PI) / 2;
        if (drag.anchor) {
          const comp = state.components.find((c) => c.id === drag.id);
          const chk = canPlace(state, comp.type, drag.anchor, drag.rot, drag.id);
          drag.valid = chk.ok;
          showHighlight(drag.anchor, comp.type, drag.rot, chk.ok);
        }
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      deleteSelected();
    }
  });

  // --- Mở tab bàn: tải scene + áp netlist bench vào CPU ---
  $('viewBenchBtn')?.addEventListener('click', () => {
    syncToCpu();
    ensureScene();
  });

  // --- Khởi động (chưa cần Three.js cho tới khi mở tab) ---
  renderPalette();
  renderChecks();
  updateModeBanner();
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

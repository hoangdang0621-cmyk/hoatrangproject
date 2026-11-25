// bench.js — Bàn thực hành 3D (Three.js): breadboard 830 lỗ, kéo-thả linh kiện,
// đi dây, xoay 360°, Inspector trượt từ phải, netlist nối vào CPU.
// Chỉ dùng chuột (trang chỉ dùng trên web máy tính).
// Three.js tải qua CDN (importmap, three@0.160.0); nếu tải lỗi thì hiện
// thông báo trong tab bàn. Nối CPU qua window.HoaTrangBenchBridge (app.js).
import {
  PITCH, holeId, holePos, allHoles,
  HOLE_RADIUS, HOLE_HEIGHT, holeCenterY,
  SEGMENT_LINE_WIDTH_MM, segmentBoundaries,
  legOffsets, legsFor, picLegs, canPlace, benchToNetlist,
  describeTerminal, defaultBenchState, nextComponentId, compLabel,
  defaultProps, sanitizeState, boardSize, colsOf, rowsOf, railColsOf, picCol,
  picRows, picBodyDepth, bodyDepth, rowLabel,
  pruneStateForSize, validateWireEnd, retargetWireEnd, togglePlacement,
  normalizeSize, holeCount, sizeLabel, sameSize,
  psuVolts, validatePsuVolts, parsePsuPost, psuPostPos,
  clampCamTarget, zoomTowardPoint, panTarget,
} from './bench-model.js?v=20261125t';
import { checkWiring, SIGNAL_COLORS } from './wiring.js?v=20261125r';
import { assemble } from './pic16.js?v=20261125q';

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
  let placementRot = 0;         // góc xoay khi đặt bằng bấm (0..3, R để xoay)
  let drag = null;              // {mode:'palette'|'move'|'move-psu'|'orbit'|'wire-end', ...}
  let pressedBtn = null;        // id nút đang nhấn giữ trên bàn
  let wireAddrError = '';       // lỗi nhập địa chỉ lỗ trong Inspector dây
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
  let boardGroup, compRoot, wireRoot, highlightBox, startMarker, ghostLine;
  const compMeshes = new Map();   // compId -> THREE.Group
  const wireMeshes = new Map();   // wireId -> THREE.Mesh (ống) + hit tube
  const wireHandleMeshes = [];    // núm tròn ở 2 đầu dây đang chọn (để kéo)
  const psuHitMeshes = [];        // núm bắt vô hình ở 2 cọc nguồn (để kéo đầu dây vào)
  const ledMats = new Map();      // compId -> material phát sáng LED
  const lcdTexs = new Map();      // compId -> {canvas, ctx, tex, last}
  const buzzerMats = new Map();   // compId -> material còi
  const btnTops = new Map();      // compId -> mesh nút bấm (để nhấn xuống)
  // Khoảng cách camera đóng khung vừa board (tỉ lệ theo chiều lớn nhất
  // của board: rộng hoặc sâu).
  const frameR = (size) => Math.max(150, Math.round(480 * (Math.max(colsOf(size) * PITCH + 10, bodyDepth(size)) / 170)));
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
  // Nút đang nhấn giữ được truyền vào netlist (nối T1–T2 như công tắc đóng).
  const pressedIds = () => (pressedBtn ? [pressedBtn] : []);
  function syncToCpu() {
    const b = bridge();
    if (b && typeof b.applyBenchNetlist === 'function') {
      b.applyBenchNetlist(benchToNetlist(state, pressedIds()));
      for (const c of state.components) {
        if (c.type === 'pot') b.setPot(c.id, ((c.props?.pct ?? 0) / 100) * 5);
      }
    }
    renderChecks();
  }
  function renderChecks() {
    if (!checksEl) return;
    const netlist = benchToNetlist(state, pressedIds());
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
    { type: 'psu', name: 'Nguồn', hint: 'Kéo thả lên mặt bàn', svg: '<svg viewBox="0 0 120 72"><rect x="4" y="6" width="112" height="60" rx="6" fill="#334155" stroke="#0F172A" stroke-width="2"/><rect x="14" y="16" width="52" height="20" rx="3" fill="#0F172A"/><text x="40" y="31" text-anchor="middle" font-family="Fira Code, monospace" font-size="12" fill="#F87171">5.00</text><circle cx="88" cy="26" r="7" fill="#DC2626"/><circle cx="104" cy="26" r="7" fill="#0F172A" stroke="#94A3B8" stroke-width="2"/></svg>' },
    { type: 'wire', name: 'Dây dẫn', hint: 'Bấm để vào chế độ đi dây', svg: '<svg viewBox="0 0 76 30"><path d="M6 24 C 24 4, 52 4, 70 24" fill="none" stroke="#2563EB" stroke-width="4" stroke-linecap="round"/><circle cx="6" cy="24" r="4" fill="#1E3A5F"/><circle cx="70" cy="24" r="4" fill="#1E3A5F"/></svg>' },
  ];
  function renderPalette(filter = '') {
    const q = filter.trim().toLowerCase();
    paletteEl.innerHTML = PALETTE.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) =>
      `<div class="bench-pal-item${p.type === 'wire' && wiringMode ? ' wiring' : ''}${p.type === placementMode ? ' placing' : ''}" data-type="${p.type}" title="${p.hint}">${p.svg}<span>${p.name}</span></div>`).join('')
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
    // Bấm lại đúng thẻ đang chọn thì thoát chế độ đặt.
    placementMode = togglePlacement(placementMode, type);
    placementRot = 0;
    if (placementMode) { wiringMode = false; wireStart = null; }
    updateModeBanner();
    renderPalette(searchEl ? searchEl.value : '');
    if (placementMode) setStatus('Đang đặt ' + (PALETTE.find((p) => p.type === placementMode)?.name || placementMode) + ' — bấm vào lỗ để đặt 1 cái, xong tự thoát. Bấm lại thẻ để thoát, Esc để hủy.');
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
      modeText.innerHTML = '<strong>Đang đặt ' + esc(PALETTE.find((p) => p.type === placementMode)?.name || placementMode) + '</strong> — bấm vào lỗ để đặt 1 cái · R xoay (hiện ' + (placementRot * 90) + '°) · bấm lại thẻ để thoát · Esc hủy';
      modeColors.hidden = true;
    } else {
      modeBanner.hidden = true;
    }
  }
  $('btnWireCancel')?.addEventListener('click', () => { setWiringMode(false); setPlacementMode(null); setStatus('Đã hủy.'); });

  // --- Tab "Nạp viết code": editor hợp ngữ + nạp file .hex + breakpoint ---
  const codeTabEl = $('benchTabCode');
  const compTabEl = $('benchTabComponents');
  const codeInput = $('benchCodeInput');
  const codeGutter = $('benchCodeGutter');
  const codeStatusEl = $('benchCodeStatus');
  const hexFileInput = $('benchHexFile');
  const CODE_LS_KEY = 'hoatrang-code-v1';
  // Code nhấp nháy mẫu dự phòng nếu bridge chưa có (app.js luôn có).
  const FALLBACK_BLINK = `; Nhap nhay LED RB0 - chuong trinh mac dinh chay san tren ban
    ORG 0
    BANKSEL TRISB
    CLRF TRISB
    BANKSEL PORTB
LOOP
    BSF PORTB, 0
    CALL DELAY
    BCF PORTB, 0
    CALL DELAY
    GOTO LOOP
DELAY
    MOVLW 0xFF
    MOVWF 0x20
D1
    MOVLW 0xFF
    MOVWF 0x21
D2
    DECFSZ 0x21, F
    GOTO D2
    DECFSZ 0x20, F
    GOTO D1
    RETURN
    END`;
  let sideTab = 'components';
  let codeInitDone = false;
  let codeBreakpoints = new Set();   // số dòng có breakpoint
  let codeLineToAddr = new Map();    // dòng -> địa chỉ (lần dịch gần nhất)
  let codeLoaded = false;            // đã nạp chương trình từ editor chưa
  let codeStatusSig = '';
  let codeSaveTimer = null;

  function setCodeWide(on) { benchView.classList.toggle('code-wide', on); }
  function setSideTab(tab) {
    sideTab = tab;
    document.querySelectorAll('.bench-mini-tab').forEach((b) => {
      const on = b.dataset.sideTab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (compTabEl) compTabEl.hidden = tab !== 'components';
    if (codeTabEl) codeTabEl.hidden = tab !== 'code';
    // Chuyển tab thì panel về 20%; chỉ bấm vào phần code mới to lên 40%.
    setCodeWide(false);
    if (tab === 'code') initCodeTab();
  }
  document.querySelectorAll('.bench-mini-tab').forEach((b) =>
    b.addEventListener('click', () => setSideTab(b.dataset.sideTab || 'components')));
  // Panel tự to/nhỏ: bấm hoặc focus vào phần code -> 40%, bấm/focus ra
  // ngoài -> 20%. Tab Linh Kiện đang mở thì luôn 20%.
  document.addEventListener('pointerdown', (e) => {
    if (sideTab !== 'code' || !codeTabEl) return;
    setCodeWide(codeTabEl.contains(e.target));
  });
  document.addEventListener('focusin', (e) => {
    if (sideTab !== 'code' || !codeTabEl) return;
    setCodeWide(codeTabEl.contains(e.target));
  });

  function loadSavedCode() {
    try {
      const raw = localStorage.getItem(CODE_LS_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (typeof d.code !== 'string') return null;
      return { code: d.code, breakpoints: Array.isArray(d.breakpoints) ? d.breakpoints : [] };
    } catch { return null; }
  }
  function saveCode() {
    try {
      localStorage.setItem(CODE_LS_KEY, JSON.stringify({ code: codeInput.value, breakpoints: [...codeBreakpoints] }));
    } catch { /* bỏ qua */ }
  }
  function saveCodeSoon() {
    clearTimeout(codeSaveTimer);
    codeSaveTimer = setTimeout(saveCode, 300);
  }
  // Dịch code hiện tại (chỉ để lấy bảng dòng->địa chỉ cho gutter, không nạp).
  function codeAssemble() {
    const r = assemble(codeInput.value);
    codeLineToAddr = r.lineToAddr || new Map();
    return r;
  }
  function renderGutter(curLine = null) {
    if (!codeGutter || !codeInput) return;
    const n = codeInput.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= n; i++) {
      const cls = [codeBreakpoints.has(i) ? 'bp' : '', curLine === i ? 'cur' : ''].filter(Boolean).join(' ');
      html += `<div data-line="${i}"${cls ? ` class="${cls}"` : ''}>${i}</div>`;
    }
    codeGutter.innerHTML = html;
    codeGutter.scrollTop = codeInput.scrollTop;
  }
  function setCodeStatus(text, isErr = false) {
    if (!codeStatusEl) return;
    codeStatusEl.textContent = text;
    codeStatusEl.classList.toggle('err', !!isErr);
  }
  function codeErrorText(errors) {
    const shown = errors.slice(0, 3).map((e) => `Dòng ${e.line}: ${e.message}`);
    return 'Lỗi dịch: ' + shown.join(' | ') + (errors.length > 3 ? ` (+${errors.length - 3} lỗi nữa)` : '');
  }
  function pruneBreakpoints() {
    codeBreakpoints = new Set([...codeBreakpoints].filter((l) => codeLineToAddr.has(l)));
  }
  function pushBreakpointsToCpu() {
    const b = bridge();
    if (b && typeof b.setBreakpointLines === 'function') b.setBreakpointLines([...codeBreakpoints]);
  }
  // Cập nhật dòng trạng thái + dòng hiện tại trong editor theo trạng thái
  // CPU (poll 150ms). Chỉ vẽ lại khi chữ ký trạng thái đổi, để không nuốt
  // thông báo lỗi dịch vừa hiện.
  function refreshCodeStatus(force = false) {
    if (!codeInitDone || !codeStatusEl) return;
    const b = bridge();
    if (!b || typeof b.getRunStatus !== 'function') return;
    const st = b.getRunStatus();
    const sig = [st.state, st.pauseReason, st.pc, st.line, st.hexMode].join('|');
    if (!force && sig === codeStatusSig) return;
    codeStatusSig = sig;
    let curLine = null;
    if (!st.hasProgram) {
      setCodeStatus('Chưa nạp chương trình.');
    } else if (st.state === 'running') {
      setCodeStatus(st.hexMode ? 'Đang chạy chương trình .hex…' : 'Đang chạy…');
    } else if (st.state === 'paused' && st.pauseReason === 'breakpoint') {
      curLine = st.line;
      setCodeStatus(`Dừng ở breakpoint dòng ${st.line ?? '?'} (địa chỉ 0x${st.pc.toString(16).toUpperCase()}). Bấm Chạy tiếp để chạy tiếp.`);
    } else if (st.state === 'paused' && st.pauseReason === 'step') {
      curLine = st.line;
      setCodeStatus(st.line ? `Dừng sau 1 lệnh — dòng tiếp theo là dòng ${st.line}.` : 'Dừng sau 1 lệnh.');
    } else if (st.state === 'paused' && st.pauseReason === 'sleep') {
      curLine = st.line;
      setCodeStatus('CPU đang SLEEP — đã dừng.');
    } else if (st.state === 'paused') {
      curLine = st.line;
      setCodeStatus(st.line ? `Đã dừng ở dòng ${st.line}.` : 'Đã dừng.');
    } else {
      setCodeStatus('Đã nạp chương trình — bấm Chạy tiếp để chạy.');
    }
    renderGutter(curLine);
    if (curLine && codeInput) {
      // Cuộn tới dòng hiện tại nếu nó nằm ngoài vùng nhìn thấy.
      const lineH = codeInput.scrollHeight / Math.max(1, codeInput.value.split('\n').length);
      const top = codeInput.scrollTop, bottom = top + codeInput.clientHeight;
      const y = (curLine - 1) * lineH;
      if (y < top || y > bottom - lineH) codeInput.scrollTop = Math.max(0, y - codeInput.clientHeight / 3);
      codeGutter.scrollTop = codeInput.scrollTop;
    }
  }
  function initCodeTab() {
    if (codeInitDone || !codeInput) return;
    codeInitDone = true;
    const saved = loadSavedCode();
    const b0 = bridge();
    codeInput.value = saved ? saved.code : (b0 && typeof b0.defaultProgram === 'function' ? b0.defaultProgram() : FALLBACK_BLINK);
    if (saved) codeBreakpoints = new Set(saved.breakpoints.filter((l) => Number.isInteger(l) && l > 0));
    codeAssemble();
    pruneBreakpoints();
    renderGutter();
    codeInput.addEventListener('input', () => {
      renderGutter();
      saveCodeSoon();
      if (codeLoaded) setCodeStatus('Code đã sửa — bấm Nạp & chạy để nạp lại.');
    });
    codeInput.addEventListener('scroll', () => { if (codeGutter) codeGutter.scrollTop = codeInput.scrollTop; });
    codeInput.addEventListener('keydown', (e) => {
      // Tab trong editor thì chèn 4 dấu cách, không chuyển focus.
      if (e.key === 'Tab') {
        e.preventDefault();
        codeInput.setRangeText('    ', codeInput.selectionStart, codeInput.selectionEnd, 'end');
        codeInput.dispatchEvent(new Event('input'));
      }
    });
    codeGutter.addEventListener('click', (e) => {
      const row = e.target.closest('[data-line]');
      if (!row) return;
      const line = Number(row.dataset.line);
      codeAssemble();
      if (!codeLineToAddr.has(line)) return; // dòng trống/chú thích/nhãn: không đặt được
      if (codeBreakpoints.has(line)) codeBreakpoints.delete(line);
      else codeBreakpoints.add(line);
      saveCode();
      renderGutter();
      pushBreakpointsToCpu();
    });
    $('btnCodeLoadRun')?.addEventListener('click', () => {
      const b = bridge();
      if (!b) return;
      const r = b.loadAsm(codeInput.value);
      if (!r.ok) { setCodeStatus(codeErrorText(r.errors), true); return; }
      codeLineToAddr = r.lineToAddr || new Map();
      pruneBreakpoints();
      pushBreakpointsToCpu();
      codeLoaded = true;
      const run = b.runProgram();
      if (run.ok) setCodeStatus('Đang chạy…');
      else setCodeStatus(run.error, true);
      refreshCodeStatus(true);
    });
    $('btnCodeResume')?.addEventListener('click', () => {
      const b = bridge();
      if (!b) return;
      const r = b.runProgram();
      if (r.ok) setCodeStatus('Đang chạy…');
      else setCodeStatus(r.error, true);
      refreshCodeStatus(true);
    });
    $('btnCodeStep')?.addEventListener('click', () => {
      const b = bridge();
      if (!b) return;
      const r = b.stepProgram();
      if (!r.ok) { setCodeStatus(r.error, true); return; }
      refreshCodeStatus(true);
    });
    $('btnCodePause')?.addEventListener('click', () => {
      const b = bridge();
      if (!b) return;
      b.pauseProgram();
      refreshCodeStatus(true);
    });
    $('btnCodeClearBp')?.addEventListener('click', () => {
      codeBreakpoints.clear();
      saveCode();
      renderGutter();
      pushBreakpointsToCpu();
    });
    $('btnCodeHex')?.addEventListener('click', () => hexFileInput?.click());
    hexFileInput?.addEventListener('change', async () => {
      const f = hexFileInput.files?.[0];
      hexFileInput.value = '';
      if (!f) return;
      const b = bridge();
      if (!b) return;
      const text = await f.text();
      const r = b.loadHex(text);
      if (!r.ok) { setCodeStatus(codeErrorText(r.errors), true); return; }
      codeLoaded = false;
      const run = b.runProgram();
      setCodeStatus(run.ok
        ? `Đã nạp file ${f.name}: ${r.words} word — đang chạy. Breakpoint không áp dụng cho chương trình .hex.`
        : run.error, !run.ok);
      refreshCodeStatus(true);
    });
    setInterval(refreshCodeStatus, 150);
    refreshCodeStatus(true);
  }

  // --- Chọn / Inspector (panel trượt từ phải) ---
  function select(sel) {
    const prevWire = selected && selected.kind === 'wire' ? selected.id : null;
    selected = sel;
    wireAddrError = '';
    // Dây được chọn vẽ lại dày + sáng hơn + có núm kéo 2 đầu.
    if (prevWire || (sel && sel.kind === 'wire')) rebuildWires();
    else updateSelectionVisual();
    renderInspector();
  }
  function updateSelectionVisual() {
    if (!sceneReady) return;
    const selComp = selected && selected.kind === 'comp'
      ? state.components.find((c) => c.id === selected.id) : null;
    if (selComp && selComp.type !== 'psu' && selComp.type !== 'pic') showHighlightForComp(selComp.id);
    else hideHighlight();
  }
  function renderInspector() {
    if (!inspectorEl) return;
    if (!selected) { inspectorEl.classList.remove('open'); inspectorEl.innerHTML = ''; return; }
    if (selected.kind === 'board') {
      // Popup Bo mạch: 3 mẫu sẵn (bấm là áp dụng ngay) + tự điền thông số.
      const cur = boardSize(state.size);
      const isPreset = (n) => state.size === n;
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>Bo mạch</strong><div class="bench-insp-pos">${esc(sizeLabel(state.size))} · ${cur.cols} cột × ${cur.rows} hàng${cur.railCols > 0 ? ' · có rail nguồn' : ' · không rail'}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">
          <label class="bench-insp-label">Mẫu sẵn — bấm để áp dụng ngay</label>
          <div class="bench-board-presets">
            ${[170, 400, 830].map((n) => `<button type="button" class="btn btn-small bench-board-preset" data-size="${n}" aria-pressed="${isPreset(n)}">${sizeLabel(n)}</button>`).join('')}
          </div>
          <label class="bench-insp-label">Tự điền thông số</label>
          <label class="bench-insp-label bench-insp-sub" for="inspBoardCols">Rộng (số cột, 5–100)</label>
          <input class="input bench-insp-hole" id="inspBoardCols" type="number" min="5" max="100" step="1" value="${cur.cols}">
          <label class="bench-insp-label bench-insp-sub" for="inspBoardRows">Dài (số hàng, 5–100, bội số của 5)</label>
          <input class="input bench-insp-hole" id="inspBoardRows" type="number" min="5" max="100" step="5" value="${cur.rows}">
          <label class="bench-insp-row"><input type="checkbox" id="inspBoardRails"${cur.railCols > 0 ? ' checked' : ''}> Có rail nguồn</label>
          <p class="bench-insp-err" id="inspBoardErr" role="alert"></p>
          <button type="button" class="btn btn-accent btn-small" data-act="apply-board">Áp dụng</button>
        </div>`;
      inspectorEl.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
        applyBoardSize(Number(b.dataset.size));
      }));
      const applyCustom = () => {
        const errEl = inspectorEl.querySelector('#inspBoardErr');
        const cols = Math.round(Number(inspectorEl.querySelector('#inspBoardCols').value));
        const rows = Math.round(Number(inspectorEl.querySelector('#inspBoardRows').value));
        if (!Number.isFinite(cols) || cols < 5 || cols > 100) {
          if (errEl) errEl.textContent = 'Số cột (rộng) phải là số nguyên từ 5 đến 100.';
          return;
        }
        if (!Number.isFinite(rows) || rows < 5 || rows > 100 || rows % 5 !== 0) {
          if (errEl) errEl.textContent = 'Số hàng (dài) phải là bội số của 5, từ 5 đến 100 (5, 10, 15, …, 100).';
          return;
        }
        const rails = inspectorEl.querySelector('#inspBoardRails').checked;
        applyBoardSize({ cols, rows, rails });
      };
      inspectorEl.querySelector('[data-act="apply-board"]')?.addEventListener('click', applyCustom);
      inspectorEl.querySelectorAll('#inspBoardCols, #inspBoardRows').forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyCustom(); }
        e.stopPropagation();
      }));
    } else if (selected.kind === 'wire') {
      const w = state.wires.find((x) => x.id === selected.id);
      if (!w) { select(null); return; }
      const endVal = (e) => (typeof e === 'string' ? e : '');
      const endHint = (e) => (typeof e === 'string' ? '' : ' placeholder="cọc nguồn"');
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>Dây dẫn</strong><div class="bench-insp-pos">${esc(holeName(w.a))} ↔ ${esc(holeName(w.b))}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">
          <label class="bench-insp-label" for="inspWireA">Đầu A — địa chỉ lỗ</label>
          <input class="input bench-insp-hole" id="inspWireA" type="text" value="${esc(endVal(w.a))}"${endHint(w.a)} autocomplete="off" spellcheck="false">
          <label class="bench-insp-label" for="inspWireB">Đầu B — địa chỉ lỗ</label>
          <input class="input bench-insp-hole" id="inspWireB" type="text" value="${esc(endVal(w.b))}"${endHint(w.b)} autocomplete="off" spellcheck="false">
          <p class="bench-insp-err" id="inspWireErr" role="alert">${esc(wireAddrError)}</p>
          <button type="button" class="btn btn-accent btn-small" data-act="apply-wire">Áp dụng</button>
          <label class="bench-insp-label">Màu dây</label>
          <div class="bench-colors">${SIGNAL_COLORS.map((c) => `<button type="button" class="bench-color${c === w.color ? ' sel' : ''}" data-color="${c}" style="background:${c}" aria-label="Màu dây ${c}"></button>`).join('')}</div>
          <p class="sub">Dây nối 2 strip của 2 điểm. Bấm vào dây trên bàn để chọn, kéo núm tròn ở 2 đầu dây để cắm sang lỗ khác hoặc cọc nguồn.</p>
        </div>
        <div class="bench-insp-foot"><button type="button" class="btn btn-danger-outline btn-small" data-act="del-wire">Xoá dây</button></div>`;
      inspectorEl.querySelectorAll('.bench-color').forEach((b) => b.addEventListener('click', () => {
        w.color = b.dataset.color;
        save(); rebuildWires(); renderInspector();
      }));
      const applyAddrs = () => {
        const aVal = inspectorEl.querySelector('#inspWireA').value;
        const bVal = inspectorEl.querySelector('#inspWireB').value;
        const errs = [];
        let applied = 0;
        for (const [end, raw] of [['a', aVal], ['b', bVal]]) {
          const norm = normalizeHoleInput(raw);
          if (!norm) continue; // để trống: giữ nguyên đầu đó
          const r = retargetWireEnd(state, w.id, end, norm);
          if (r.ok) applied++;
          else errs.push((end === 'a' ? 'Đầu A' : 'Đầu B') + ': ' + r.reason);
        }
        if (applied) { save(); rebuildWires(); syncToCpu(); }
        wireAddrError = errs.join(' ');
        if (applied && !errs.length) {
          setStatus('Đã chuyển đầu dây.');
          wireAddrError = '';
        }
        renderInspector();
      };
      inspectorEl.querySelector('[data-act="apply-wire"]')?.addEventListener('click', applyAddrs);
      inspectorEl.querySelectorAll('.bench-insp-hole').forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyAddrs(); }
        e.stopPropagation();
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
        body = `<p class="sub">Nhấn giữ linh kiện trên bàn: nối 2 chân T1–T2 với nhau như công tắc (vd nối tiếp nguồn–LED qua nút thì nhấn mới sáng). Nếu 1 chân nối chân PIC thì nhấn kéo chân đó về mức 0 (active-low, có pull-up).</p>`;
      } else if (comp.type === 'lcd') {
        const b = bridge();
        const lcd = b && typeof b.getMapping === 'function' ? b.getMapping().lcd : null;
        body = lcd && lcd.id
          ? `<p class="sub">${lcd.complete ? 'LCD đã nối đủ dây, hiện chữ theo code.' : 'LCD chưa nối đủ dây — thiếu: ' + (lcd.missing.join(', ') || 'không rõ') + '.'}</p>`
          : `<p class="sub">LCD hiển thị 2 dòng 16 ký tự theo code (data + RS/E).</p>`;
      } else if (comp.type === 'buzzer') {
        const soundOn = comp.props?.sound !== false;
        body = `<label class="bench-insp-row"><input type="checkbox" id="inspBuzzerSound"${soundOn ? ' checked' : ''}> Phát tiếng khi còi kêu</label>
          <p class="sub">Còi kêu khi chân + ra mức 1 (chân PIC mức cao hoặc nối thẳng nguồn 0–10V) và chân − về GND.</p>`;
      } else if (comp.type === 'pic') {
        const conns = picLegs(state.size).map((l) => {
          const d = describeTerminal(state, l.term, pressedIds());
          const others = d.members.filter((m) => m !== l.term);
          if (!others.length && !d.vcc && !d.gnd) return null;
          const txt = [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map((m) => m.startsWith('PIC.') ? m.slice(4) : m)].join(', ');
          return `<div class="bench-conn"><span>${l.term.slice(4)}</span><span>${esc(txt)}</span></div>`;
        }).filter(Boolean);
        const pc = picCol(state.size);
        const [rT, rB] = picRows(state.size);
        body = `<p class="sub">Chip cắm cố định ở cột ${Math.max(1, pc)}–${pc + 19}, hàng ${rowLabel(rT)}/${rowLabel(rB)}. ${conns.length} chân đang nối dây.</p>
          <div class="bench-conns">${conns.join('') || '<p class="sub">Chưa chân nào nối dây ngoài nguồn.</p>'}</div>`;
      } else if (comp.type === 'psu') {
        const volts = psuVolts(comp);
        body = `<label class="bench-insp-label" for="inspPsuVolts">Điện áp nguồn (V)</label>
          <input class="input" id="inspPsuVolts" type="number" min="0" max="24" step="0.1" value="${volts}">
          <p class="bench-insp-err" id="inspPsuErr" role="alert"></p>
          <button type="button" class="btn btn-accent btn-small" data-act="apply-psu">Áp dụng</button>
          <p class="sub">Nguồn chung, điều chỉnh được 0–24V (mặc định 5V). Cọc + (đỏ) và − (đen) nối vào rail trên/dưới của breadboard. Điện áp chỉ là giá trị danh định, không mô phỏng analog.</p>`;
      }
      const conns = comp.type !== 'pic' && comp.type !== 'psu'
        ? `<div class="bench-conns">${legsFor(comp, state.size).map((l) => {
          const term = comp.id + '.' + l.term;
          const d = describeTerminal(state, term, pressedIds());
          const others = d.members.filter((m) => m !== term);
          const txt = others.length || d.vcc || d.gnd
            ? [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map((m) => m.startsWith('PIC.') ? m.slice(4) : m)].join(', ')
            : 'chưa nối';
          return `<div class="bench-conn"><span>${l.term}</span><span>${esc(txt)}</span></div>`;
        }).join('')}</div>` : '';
      // Mục "Chân": từng chân cắm vào lỗ nào (chỉ đọc). PSU không có chân
      // dạng lỗ nên bỏ qua. Chân treo ngoài board (hole null) thì hiện
      // "ngoài board". Tên chân bỏ tiền tố 'PIC.' (PIC.RA0 -> RA0).
      const legs = comp.type === 'psu' ? [] : legsFor(comp, state.size);
      const pins = legs.length ? `<label class="bench-insp-label">Chân</label><div class="bench-conns">${legs.map((l) => {
        const term = l.term.startsWith('PIC.') ? l.term.slice(4) : l.term;
        return `<div class="bench-conn"><span>${esc(term)}</span><span>${l.hole ? esc(holeName(l.hole)) : 'ngoài board'}</span></div>`;
      }).join('')}</div>` : '';
      const canDelete = comp.type !== 'pic' && comp.type !== 'psu';
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>${esc(compLabel(comp))}</strong><div class="bench-insp-pos">${esc(pos)}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">${body}${conns}${pins}</div>
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
      const buzzerSound = inspectorEl.querySelector('#inspBuzzerSound');
      if (buzzerSound) buzzerSound.addEventListener('change', () => {
        comp.props = { ...(comp.props || {}), sound: buzzerSound.checked };
        save();
        setStatus(buzzerSound.checked ? 'Đã bật tiếng còi.' : 'Đã tắt tiếng còi (còi vẫn sáng khi kêu).');
      });
      const psuApply = () => {
        const inp = inspectorEl.querySelector('#inspPsuVolts');
        const errEl = inspectorEl.querySelector('#inspPsuErr');
        if (!inp) return;
        const r = validatePsuVolts(inp.value);
        if (!r.ok) { if (errEl) errEl.textContent = r.reason; return; }
        comp.props = { ...(comp.props || {}), volts: r.volts };
        save(); rebuildAll(); renderInspector(); syncToCpu(); updateSizeUI();
        setStatus('Đã đổi ' + compLabel(comp) + '.');
      };
      inspectorEl.querySelector('[data-act="apply-psu"]')?.addEventListener('click', psuApply);
      const psuInput = inspectorEl.querySelector('#inspPsuVolts');
      if (psuInput) psuInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); psuApply(); }
        e.stopPropagation();
      });
    }
    inspectorEl.classList.add('open');
    inspectorEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
    inspectorEl.querySelector('[data-act="del-comp"]')?.addEventListener('click', () => deleteSelected());
    inspectorEl.querySelector('[data-act="del-wire"]')?.addEventListener('click', () => deleteSelected());
  }
  function holeName(e) {
    if (typeof e === 'string') {
      const pp = parsePsuPost(e);
      if (pp) return 'cọc ' + pp.sign + ' nguồn ' + pp.psuId;
      return e;
    }
    if (e && typeof e.x === 'number') return 'cọc nguồn';
    return '?';
  }
  // Thường hoá địa chỉ người dùng gõ: trim, chữ hàng về thường
  // ('C12' -> 'c12', 'AA12' -> 'aa12'), chữ rail về hoa ('t+5' -> 'T+5'),
  // cọc nguồn về dạng chuẩn ('psu1.+' -> 'PSU1.+').
  function normalizeHoleInput(v) {
    const s = String(v || '').trim();
    let m = s.match(/^([a-zA-Z]+)(\d+)$/);
    if (m) return m[1].toLowerCase() + m[2];
    m = s.match(/^([tTbB])([+-])(\d+)$/);
    if (m) return m[1].toUpperCase() + m[2] + m[3];
    m = s.match(/^psu(\d+)\.([+-])$/i);
    if (m) return 'PSU' + m[1] + '.' + m[2];
    return s;
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
    // Đóng khung vừa board theo size đã lưu.
    orbitTarget.r = frameR(state.size);
    orbit.r = orbitTarget.r;

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
    buildBreadboardMesh(state.size);
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
    // Đường dây tạm khi kéo 1 đầu dây (từ đầu cố định tới chuột)
    ghostLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x2563EB }));
    ghostLine.visible = false;
    scene.add(ghostLine);

    // Sự kiện chuột trên canvas
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onCanvasPointerDown);
    cv.addEventListener('pointermove', onCanvasPointerMove);
    cv.addEventListener('pointerup', onCanvasPointerUp);
    cv.addEventListener('pointercancel', onCanvasPointerUp);
    // Chặn menu chuột phải để chuột phải dùng để pan.
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const oldR = orbitTarget.r;
      const newR = clamp(oldR * Math.exp(e.deltaY * 0.001), 120, 900);
      orbitTarget.r = newR;
      // Zoom vào thì target camera dịch dần về điểm trên mặt bàn dưới
      // con trỏ, để zoom được vào góc board chứ không chỉ về tâm.
      if (newR < oldR) {
        const pt = raycastTablePoint(e);
        if (pt) {
          const t = zoomTowardPoint(camTarget, pt, newR / oldR);
          const c = clampCamTarget(t.x, t.z, TABLE_W, TABLE_D);
          camTarget.x = c.x; camTarget.z = c.z;
        }
      }
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

  function makeBoardTexture(size) {
    const cols = colsOf(size);
    const rows = rowsOf(size);
    const bodyW = cols * PITCH + 10;
    const bodyD = bodyDepth(size);
    const c = document.createElement('canvas');
    c.width = 1024; c.height = Math.max(120, Math.round(1024 * bodyD / bodyW));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 1024, c.height);
    const px = (xmm) => (xmm + bodyW / 2) * (1024 / bodyW);
    const py = (zmm) => (zmm + bodyD / 2) * (c.height / bodyD);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 15px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let col = 1; col <= cols; col += 5) {
      const x = px((col - (cols + 1) / 2) * PITCH);
      ctx.fillText(String(col), x, py(-(bodyD / 2 - 2)));
      ctx.fillText(String(col), x, py(bodyD / 2 - 2));
    }
    // Nhãn hàng: chữ 13px, tâm cách mép board 2.6mm. Nhãn 2 chữ (aa, ab...)
    // rộng ~4mm trên board 100 cột, vẫn cách cột lỗ đầu tiên ~0.7mm
    // (cỡ 15px cũ, tâm cách mép 3mm thì nhãn chạm sát mép lỗ đầu tiên).
    ctx.font = '600 13px "Fira Code", monospace';
    for (let r = 0; r < rows; r++) {
      const z = py((r - (rows - 1) / 2) * PITCH);
      ctx.fillText(rowLabel(r), px(-bodyW / 2 + 2.6), z);
      ctx.fillText(rowLabel(r), px(bodyW / 2 - 2.6), z);
    }
    if (railColsOf(size) > 0) {
      // Dấu +/− của rail: T+ và B+ là +, T− và B− là −.
      const railZ = (r) => py((r - (rows - 1) / 2) * PITCH);
      ctx.font = '700 17px "Fira Code", monospace';
      ctx.fillStyle = '#DC2626';
      ctx.fillText('+', px(-bodyW / 2 + 3), railZ(-2));
      ctx.fillText('+', px(-bodyW / 2 + 3), railZ(rows));
      ctx.fillStyle = '#2563EB';
      ctx.fillText('−', px(-bodyW / 2 + 3), railZ(-1));
      ctx.fillText('−', px(-bodyW / 2 + 3), railZ(rows + 1));
    }
    // Vạch chia đoạn 5 hàng (vẽ trong texture, không phải khối 3D): vạch
    // nằm phẳng trên mặt board còn lỗ là đĩa 3D cao hơn 0.35mm nên vạch
    // không bao giờ che được lỗ.
    ctx.fillStyle = '#CBD5E1';
    const lineW = SEGMENT_LINE_WIDTH_MM * (c.height / bodyD);
    for (const z of segmentBoundaries(size)) {
      const y = py(z);
      ctx.fillRect(0, y - lineW / 2, c.width, lineW);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function buildBreadboardMesh(size) {
    const cols = colsOf(size);
    const rows = rowsOf(size);
    const rc = railColsOf(size);
    const bodyW = cols * PITCH + 10;
    const bodyD = bodyDepth(size);
    // Thân board
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW, BOARD_TOP, bodyD),
      new THREE.MeshStandardMaterial({ color: 0xF1F5F9, roughness: 0.6 }));
    body.position.y = BOARD_TOP / 2;
    body.receiveShadow = true;
    boardGroup.add(body);
    // Mặt trên có chữ hàng/cột
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(bodyW, bodyD),
      new THREE.MeshStandardMaterial({ map: makeBoardTexture(size), roughness: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = BOARD_TOP + 0.05;
    top.receiveShadow = true;
    boardGroup.add(top);
    // Vạch chia đoạn 5 hàng giờ vẽ trong texture mặt board (makeBoardTexture),
    // không còn khối rãnh 3D (khối cũ rộng 2.4mm đè lên lỗ e/f).
    // Vạch màu rail +/− (chỉ khi board có rail)
    if (rc > 0) {
      for (const [r, color] of [[-2, 0xDC2626], [-1, 0x2563EB], [rows, 0xDC2626], [rows + 1, 0x2563EB]]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(rc * PITCH, 0.5, 1.6),
          new THREE.MeshStandardMaterial({ color }));
        strip.position.set(((rc + 1) / 2 - (cols + 1) / 2) * PITCH, BOARD_TOP + 0.08, (r - (rows - 1) / 2) * PITCH);
        boardGroup.add(strip);
      }
    }
    // Lỗ (InstancedMesh)
    const holes = allHoles(size);
    const inst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, HOLE_HEIGHT, 10),
      new THREE.MeshStandardMaterial({ color: 0x1F2937, roughness: 0.9 }),
      holes.length);
    const m = new THREE.Matrix4();
    holes.forEach((h, i) => { m.makeTranslation(h.x, holeCenterY(BOARD_TOP), h.z); inst.setMatrixAt(i, m); });
    inst.receiveShadow = true;
    boardGroup.add(inst);
  }

  // Dựng lại mesh board khi đổi size (dỡ mesh cũ rồi vẽ lại).
  function rebuildBoard() {
    if (!sceneReady) return;
    for (const ch of [...boardGroup.children]) {
      boardGroup.remove(ch);
      ch.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mm of mats) { if (mm.map) mm.map.dispose(); mm.dispose(); }
        }
      });
    }
    buildBreadboardMesh(state.size);
    orbitTarget.r = frameR(state.size);
    orbitTarget.el = 0.72;
  }

  // Đổi size bo mạch: giữ linh kiện/dây còn trên board mới, gỡ cái ngoài board.
  // newSize là số mẫu sẵn (170/400/830) hoặc {cols, rows, rails} tự điền.
  function applyBoardSize(newSize) {
    const size = normalizeSize(newSize);
    if (sameSize(size, state.size)) { updateSizeUI(); return; }
    const wasBoard = selected && selected.kind === 'board';
    const res = pruneStateForSize(state, size);
    state = res.state;
    seq = 1; wireSeq = 100;
    state.components.forEach((c) => {
      const n = parseInt(String(c.id).replace(/^[A-Z]+/, ''), 10);
      if (!isNaN(n) && n >= seq) seq = n + 1;
    });
    state.wires.forEach((w) => {
      const n = parseInt(String(w.id).replace(/^W/, ''), 10);
      if (!isNaN(n) && n >= wireSeq) wireSeq = n + 1;
    });
    if (wasBoard) { setWiringMode(false); setPlacementMode(null); }
    else select(null);
    save(); rebuildBoard(); rebuildAll(); syncToCpu(); updateSizeUI();
    if (wasBoard) renderInspector(); // popup Bo mạch vẫn mở, hiện size mới
    const parts = [];
    if (res.removed.components.length) parts.push('gỡ ' + res.removed.components.length + ' linh kiện ngoài board');
    if (res.removed.wires.length) parts.push('gỡ ' + res.removed.wires.length + ' dây ngoài board');
    setStatus('Đã đổi size bo mạch sang ' + sizeLabel(size) + (parts.length ? ' — ' + parts.join(', ') + '.' : '.'));
  }
  function updateSizeUI() {
    const info = $('benchBoardInfo');
    if (info) info.textContent = `${sizeLabel(state.size)} · chip PIC16F877A cắm sẵn · nguồn phía sau bàn. Kéo chỗ trống để xoay 360°, chuột phải hoặc Shift+kéo để dịch góc nhìn, cuộn chuột để zoom vào điểm trỏ. Bấm vào board để đổi kích thước, bấm linh kiện để mở Inspector bên phải.`;
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
      // Thân chip + 40 chân cắm vào lỗ (căn giữa board theo size).
      // Chân treo ngoài board (Mini 170) vẫn vẽ nhưng nhô lên khỏi mặt board.
      // Thân chip nằm giữa 2 hàng chân (z = điểm giữa 2 hàng chân).
      const cols = colsOf(state.size);
      const rows = rowsOf(state.size);
      const [rT, rB] = picRows(state.size);
      const chipZ = ((rT + rB) / 2 - (rows - 1) / 2) * PITCH;
      const cx = (picCol(state.size) + 9.5 - (cols + 1) / 2) * PITCH;
      const body = new THREE.Mesh(new THREE.BoxGeometry(52.5, 4.5, picBodyDepth(state.size)), stdMat(0x0F172A, { roughness: 0.4 }));
      body.position.set(cx, BOARD_TOP + 6.2, chipZ);
      body.castShadow = true;
      g.add(body);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(44, 11),
        new THREE.MeshBasicMaterial({ map: makeTextTexture('PIC16F877A', 'DIP-40'), transparent: true }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(cx, BOARD_TOP + 8.5, chipZ);
      g.add(label);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.5, 12), stdMat(0xF8FAFC));
      dot.position.set(cx - 24.13, BOARD_TOP + 8.5, (rT - (rows - 1) / 2) * PITCH);
      g.add(dot);
      const pinMat = stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 });
      for (const leg of picLegs(state.size)) {
        const px = (leg.c - (cols + 1) / 2) * PITCH;
        const pz = (leg.r - (rows - 1) / 2) * PITCH;
        const pin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.5, 0.7), pinMat);
        // Chân không có lỗ (treo ngoài board) nhô lên để nhìn rõ là chưa cắm.
        pin.position.set(px, BOARD_TOP + (leg.hole ? 2.2 : 4.6), pz);
        g.add(pin);
      }
      return g;
    }
    if (comp.type === 'psu') {
      // Hộp nguồn đặt trên mặt bàn, mặt trước quay về phía breadboard
      g.position.set(comp.tx, 0, comp.tz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 80), stdMat(0x334155, { roughness: 0.5 }));
      body.position.y = 35;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const disp = new THREE.Mesh(
        new THREE.PlaneGeometry(52, 20),
        new THREE.MeshBasicMaterial({ map: makeDisplayTexture(psuVolts(comp)) }));
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
      // Núm bắt vô hình ở 2 cọc nguồn để kéo đầu dây vào được (pickPsuPost).
      for (const [sign, x] of [['+', -12], ['-', 12]]) {
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(7, 10, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.set(x, 28, 42);
        hit.userData = { psuPostId: comp.id + '.' + sign };
        g.add(hit);
        psuHitMeshes.push(hit);
      }
      return g;
    }
    // Linh kiện cắm lỗ: gốc nhóm ở lỗ neo, chân theo legOffsets
    const anchor = holePos(comp.anchor, state.size);
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
  // Màn hình nguồn: hiện điện áp hiện tại của nguồn (vd 12.00 V).
  function makeDisplayTexture(volts = 5) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#F87171';
    ctx.font = '700 52px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number(volts).toFixed(2), 108, 48);
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
    const isSel = selected && selected.kind === 'wire' && selected.id === wire.id;
    const up = (p, h) => new THREE.Vector3(p.x, p.y + h, p.z);
    const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 42, (a.z + b.z) / 2);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x, a.y, a.z), up(a, 18), mid, up(b, 18), new THREE.Vector3(b.x, b.y, b.z),
    ]);
    const baseColor = new THREE.Color(wire.color);
    const mat = new THREE.MeshStandardMaterial({
      color: isSel ? baseColor.clone().lerp(new THREE.Color(0xFFFFFF), 0.35) : baseColor,
      emissive: isSel ? baseColor : 0x000000,
      emissiveIntensity: isSel ? 0.55 : 0,
      roughness: 0.5,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, isSel ? 1.2 : 0.75, 8), mat);
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
    // Dây được chọn: núm tròn ở 2 đầu để kéo cắm sang lỗ khác.
    if (isSel) {
      for (const [end, p] of [['a', a], ['b', b]]) {
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(2.6, 14, 14),
          new THREE.MeshBasicMaterial({ color: 0x059669 }));
        knob.position.set(p.x, p.y + 2, p.z);
        knob.userData = { wireId: wire.id, wireEnd: end };
        grp.add(knob);
        wireHandleMeshes.push(knob);
      }
    }
    return grp;
  }
  function endpointPos(e) {
    if (typeof e === 'string') {
      // Cọc nguồn (PSU1.+/PSU1.-) lấy vị trí từ khối nguồn đang có trên bàn.
      const pp = parsePsuPost(e);
      if (pp) return psuPostPos(state, e);
      const p = holePos(e, state.size);
      return p ? { x: p.x, y: BOARD_TOP, z: p.z } : null;
    }
    if (e && typeof e.x === 'number') return { x: e.x, y: e.y, z: e.z };
    return null;
  }
  function rebuildAll() {
    if (!sceneReady) return;
    for (const [, g] of compMeshes) compRoot.remove(g);
    compMeshes.clear();
    psuHitMeshes.length = 0;
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
    wireHandleMeshes.length = 0;
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
      const comp = { id, type: 'psu', tx, tz, fixed: false, props: defaultProps('psu') };
      state.components.push(comp);
      save(); rebuildAll(); syncToCpu();
      select({ kind: 'comp', id });
      setStatus('Đã đặt ' + compLabel(comp) + ' lên bàn.');
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
    if (a === b) { setStatus('Hai đầu trùng nhau — chọn 2 điểm khác nhau.'); return false; }
    const dup = state.wires.some((w) =>
      (w.a === a && w.b === b) || (w.a === b && w.b === a));
    if (dup) { setStatus('Đã có dây nối 2 điểm này rồi.'); return false; }
    const id = 'W' + (wireSeq++);
    state.wires.push({ id, a, b, color: wireColor });
    save(); rebuildWires(); syncToCpu();
    setStatus('Đã nối dây ' + holeName(a) + ' ↔ ' + holeName(b) + '.');
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
    // Cột từ x: x = (c − (cols+1)/2) × PITCH -> c = x/PITCH + (cols+1)/2
    // (không hardcode 32 — chỉ đúng với board 830).
    const col = Math.round(pt.x / PITCH + (colsOf(state.size) + 1) / 2);
    // Hàng từ z: z = (r − (rows−1)/2) × PITCH -> r = z/PITCH + (rows−1)/2
    // (không hardcode 4.5 — chỉ đúng với board 10 hàng).
    const rows = rowsOf(state.size);
    const candRows = [-2, -1, ...Array.from({ length: rows }, (_, i) => i), rows, rows + 1];
    let best = null, bestD = 1e9;
    for (const r of candRows) {
      const z = (r - (rows - 1) / 2) * PITCH;
      const d = Math.abs(pt.z - z);
      if (d < bestD) { bestD = d; best = r; }
    }
    const id = holeId(best, col, state.size);
    if (!id) return null;
    const hp = holePos(id, state.size);
    const dist = Math.hypot(pt.x - hp.x, pt.z - hp.z);
    return dist <= 2.0 ? id : null;
  }
  // Điểm bấm trên thân board (kể cả lỗ trống): giao tia với mặt trên board,
  // chỉ nhận khi nằm trong hình chữ nhật thân board. Dùng để mở popup Bo mạch.
  function pickBoardPoint(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(boardPlane(), pt)) return null;
    const bodyW = colsOf(state.size) * PITCH + 10;
    if (Math.abs(pt.x) > bodyW / 2 || Math.abs(pt.z) > bodyDepth(state.size) / 2) return null;
    return { x: pt.x, z: pt.z };
  }
  // Điểm trên mặt bàn (y=0) dưới con trỏ, KHÔNG kẹp — dùng cho zoom về
  // điểm trỏ; pickTablePoint thì kẹp vào vùng đặt nguồn.
  function raycastTablePoint(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(tablePlane(), pt)) return null;
    return { x: pt.x, z: pt.z };
  }
  function pickTablePoint(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside) return null;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(tablePlane(), pt)) return null;
    return { x: Math.max(-330, Math.min(330, pt.x)), z: Math.max(-200, Math.min(200, pt.z)) };
  }
  function pickWireHandle(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside || !wireHandleMeshes.length) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(wireHandleMeshes, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.wireId && u.wireEnd ? { wireId: u.wireId, end: u.wireEnd } : null;
  }
  // Cọc nguồn (+/−) của khối nguồn: điểm thả hợp lệ cho đầu dây
  // (cả kéo đầu dây vào nguồn lẫn đi dây mới bắt đầu/kết thúc ở nguồn).
  function pickPsuPost(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside || !psuHitMeshes.length) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(psuHitMeshes, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.psuPostId ? u.psuPostId : null;
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
    const p = holePos(anchor, state.size);
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

  // --- Chuột trên canvas: xoay / di chuyển / chọn / đi dây / kéo đầu dây ---
  function onCanvasPointerDown(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.button !== 0 && e.button !== 2) return;
    // Chuột phải (hoặc Shift+chuột trái): kéo để pan — dịch góc nhìn
    // trên mặt bàn, không xoay, không chọn linh kiện.
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      drag = { mode: 'pan', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      renderer.domElement.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    // Kéo 1 đầu dây đang chọn: núm tròn ở đầu dây được ưu tiên trước.
    const handle = pickWireHandle(e);
    if (handle) {
      const w = state.wires.find((x) => x.id === handle.wireId);
      if (w) {
        select({ kind: 'wire', id: w.id });
        drag = { mode: 'wire-end', wireId: w.id, end: handle.end, origEnd: w[handle.end], moved: false, startX: e.clientX, startY: e.clientY, hoverHole: null };
        renderer.domElement.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    if (wiringMode) {
      const hole = pickHole(e) || pickPsuPost(e);
      if (!hole) { wireStart = null; startMarker.visible = false; return; }
      if (!wireStart) {
        wireStart = hole;
        const p = endpointPos(hole);
        if (p) { startMarker.position.set(p.x, p.y + 2, p.z); startMarker.visible = true; }
        setStatus('Đã chọn điểm bắt đầu ' + holeName(hole) + ' — bấm điểm kết thúc.');
      } else {
        const a = wireStart;
        wireStart = null;
        startMarker.visible = false;
        // Nối xong 1 dây thì thoát chế độ dây (one-shot như đặt linh kiện):
        // muốn nối nữa thì bấm lại "Dây dẫn". Nối lỗi (trùng đầu/trùng dây)
        // thì ở lại chế độ dây để chọn lại.
        if (addWire(a, hole)) setWiringMode(false);
      }
      return;
    }
    if (placementMode) {
      if (placementMode === 'psu') {
        const pt = pickTablePoint(e);
        if (pt && !(Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64)) {
          const id = placeComponent('psu', null, 0, pt.x, pt.z);
          if (id) setPlacementMode(null); // đặt 1 lần thì thoát chế độ đặt
        } else setStatus('Không đặt được nguồn ở đây (đè lên breadboard).');
        return;
      }
      const hole = pickHole(e);
      if (!hole) return;
      // Đặt 1 lần: thả xong thì thoát chế độ đặt (muốn thả nữa thì chọn lại thẻ).
      const id = placeComponent(placementMode, hole, placementRot);
      if (id) setPlacementMode(null);
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
    // Hover ở chế độ đặt: hiện ô sáng báo lỗ sắp đặt + góc xoay hiện tại.
    if (!drag && placementMode && placementMode !== 'psu') {
      const hole = pickHole(e);
      if (!hole) { hideHighlight(); return; }
      const chk = canPlace(state, placementMode, hole, placementRot);
      showHighlight(hole, placementMode, placementRot, chk.ok);
      return;
    }
    if (!drag) return;
    if (drag.mode === 'wire-end') {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      const w = state.wires.find((x) => x.id === drag.wireId);
      if (!w || !ghostLine) return;
      const fixedEnd = drag.end === 'a' ? w.b : w.a;
      const fixedPos = endpointPos(fixedEnd);
      if (!fixedPos) return;
      // Đích thả: lỗ breadboard/rail hoặc cọc nguồn (+/−).
      const hole = pickHole(e);
      const post = hole ? null : pickPsuPost(e);
      const targetId = hole || post;
      drag.hoverHole = targetId;
      // Đường dây tạm từ đầu cố định tới chuột.
      const ndc = pointerNdc(e);
      raycaster.setFromCamera(ndc, camera);
      const pt = new THREE.Vector3();
      let target = null;
      if (targetId) {
        const tp = endpointPos(targetId);
        if (tp) target = new THREE.Vector3(tp.x, tp.y + 2, tp.z);
      } else if (raycaster.ray.intersectPlane(boardPlane(), pt)) {
        target = new THREE.Vector3(pt.x, BOARD_TOP + 2, pt.z);
      }
      if (target) {
        ghostLine.geometry.setFromPoints([new THREE.Vector3(fixedPos.x, fixedPos.y + 2, fixedPos.z), target]);
        ghostLine.visible = true;
      } else ghostLine.visible = false;
      // Chấm tròn ở điểm đang trỏ: xanh = cắm được, đỏ = không.
      if (targetId) {
        const tp = endpointPos(targetId);
        const v = validateWireEnd(state, drag.wireId, drag.end, targetId);
        startMarker.position.set(tp.x, tp.y + 2, tp.z);
        startMarker.material.color.set(v.ok ? 0x059669 : 0xDC2626);
        startMarker.visible = true;
      } else startMarker.visible = false;
      return;
    }
    if (drag.mode === 'orbit') {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      orbitTarget.az -= dx * 0.005;
      orbitTarget.el = clamp(orbitTarget.el + dy * 0.004, 0.15, 1.45);
      return;
    }
    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      // mm/pixel tại độ sâu của target: chiều cao khung hình ứng với
      // 2*r*tan(fov/2) mm trên mặt bàn.
      const scale = (2 * orbit.r * Math.tan((camera.fov * Math.PI) / 360)) / (wrap.clientHeight || 620);
      const t = panTarget(camTarget, dx, dy, orbit.az, scale);
      const c = clampCamTarget(t.x, t.z, TABLE_W, TABLE_D);
      camTarget.x = c.x; camTarget.z = c.z;
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
      const p = holePos(hole, state.size);
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
    if (d.mode === 'wire-end') {
      if (ghostLine) ghostLine.visible = false;
      startMarker.visible = false;
      const w = state.wires.find((x) => x.id === d.wireId);
      if (!w) return;
      if (!d.moved || !d.hoverHole) { setStatus('Kéo đầu dây tới lỗ khác hoặc cọc nguồn để cắm lại.'); return; }
      const r = retargetWireEnd(state, d.wireId, d.end, d.hoverHole);
      if (r.ok) {
        save(); rebuildWires(); syncToCpu();
        setStatus('Đã chuyển đầu dây sang ' + holeName(d.hoverHole) + '.');
      } else {
        setStatus(r.reason);
      }
      return;
    }
    if (d.mode === 'orbit') {
      if (!d.moved) {
        // Bấm (không kéo) lên thân board hoặc lỗ trống: mở popup Bo mạch;
        // bấm ra ngoài board thì bỏ chọn như cũ.
        if (pickBoardPoint(e)) select({ kind: 'board' });
        else select(null);
      }
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
        if (selected && selected.kind === 'comp' && selected.id === d.id) renderInspector();
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
        // Đầu dây nguồn mặc định dạng id cọc (PSU1.+/PSU1.-) tự theo vị trí
        // nguồn mới; chỉ cập nhật đầu {x,y,z} cũ (state lưu trước khi có id cọc).
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
    if (pressed) pressedBtn = id;
    else if (pressedBtn === id) pressedBtn = null;
    // Nút là công tắc 2 đầu: nhấn thì đóng T1–T2 trong netlist (LED nối tiếp
    // qua nút sáng lên), nhả thì mở ra — đồng bộ lại netlist + panel Kiểm tra
    // trước, rồi mới tác động mức logic vào chân PIC (giữ hành vi active-low
    // cũ: nhấn kéo chân về mức 0, nhả thì pull-up kéo lên mức 1).
    syncToCpu();
    if (b && typeof b.pressButton === 'function') b.pressButton(id, pressed);
    const top = btnTops.get(id);
    if (top) top.position.y = pressed ? 8.2 : 9;
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
  // --- Tiếng còi buzzer (Web Audio): chạy trên luồng âm thanh riêng của
  // trình duyệt nên không làm nặng vòng vẽ 3D. Sóng vuông 2300 Hz, gain
  // 0.04, phát liên tục trong lúc còi bật, dừng khi còi tắt.
  let audioCtx = null; let buzzOsc = null; let buzzGain = null;
  function ensureAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  // Tạo AudioContext ở lần bấm chuột đầu tiên (chính sách autoplay của
  // trình duyệt chỉ cho phát tiếng sau thao tác của người dùng).
  document.addEventListener('pointerdown', () => { ensureAudioCtx(); });
  function setBuzzerSound(on) {
    if (on) {
      const ctx = ensureAudioCtx();
      if (!ctx || ctx.state !== 'running' || buzzOsc) return;
      buzzOsc = ctx.createOscillator();
      buzzOsc.type = 'square';
      buzzOsc.frequency.value = 2300;
      buzzGain = ctx.createGain();
      buzzGain.gain.value = 0.04;
      buzzOsc.connect(buzzGain);
      buzzGain.connect(ctx.destination);
      buzzOsc.start();
    } else if (buzzOsc) {
      try { buzzOsc.stop(); } catch {}
      try { buzzOsc.disconnect(); } catch {}
      try { buzzGain.disconnect(); } catch {}
      buzzOsc = null; buzzGain = null;
    }
  }
  function startLivePoll() {
    if (liveTimer) return;
    liveTimer = setInterval(() => {
      if (!sceneReady || benchView.hidden) { setBuzzerSound(false); return; }
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
        if (typeof b.getBuzzerStates === 'function') {
          let anyBuzz = false;
          for (const s of b.getBuzzerStates()) {
            const mat = buzzerMats.get(s.id);
            if (mat) mat.emissiveIntensity = s.on ? 1.2 : 0;
            if (s.on) {
              const comp = state.components.find((c) => c.id === s.id);
              if (!comp || comp.props?.sound !== false) anyBuzz = true;
            }
          }
          setBuzzerSound(anyBuzz);
        }
      } catch { /* bridge chưa sẵn: bỏ qua lần này */ }
    }, 150);
  }

  // --- Nút chế độ xem / dọn bàn ---
  $('btnView3D')?.addEventListener('click', () => {
    orbitTarget.el = 0.72; orbitTarget.r = frameR(state.size);
    $('btnView3D').setAttribute('aria-pressed', 'true');
    $('btnViewTop').setAttribute('aria-pressed', 'false');
  });
  $('btnViewTop')?.addEventListener('click', () => {
    orbitTarget.el = 1.42; orbitTarget.r = frameR(state.size) * 1.17;
    $('btnView3D').setAttribute('aria-pressed', 'false');
    $('btnViewTop').setAttribute('aria-pressed', 'true');
  });
  $('btnBenchClear')?.addEventListener('click', () => {
    state.components = state.components.filter((c) => c.type === 'pic' || c.type === 'psu');
    state.wires = state.wires.filter((w) => ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].includes(w.id));
    select(null);
    save(); rebuildAll(); syncToCpu();
    setStatus('Đã dọn hết bàn (giữ chip PIC, nguồn và dây nguồn).');
  });
  $('btnBenchDefault')?.addEventListener('click', () => {
    state = defaultBenchState(state.size);
    seq = 1; wireSeq = 100;
    select(null);
    save(); rebuildAll(); syncToCpu();
    setStatus('Đã về bàn mặc định: chip PIC + nguồn + dây nguồn.');
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
      if (drag?.mode === 'wire-end') { drag = null; if (ghostLine) ghostLine.visible = false; }
      else if (drag?.mode === 'palette') { window.removeEventListener('pointermove', onPaletteDragMove); removeGhost(); hideHighlight(); drag = null; }
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
    } else if ((e.key === 'r' || e.key === 'R') && placementMode) {
      // R xoay trong lúc đặt bằng bấm (không kéo).
      placementRot = (placementRot + 1) % 4;
      updateModeBanner();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      deleteSelected();
    }
  });

  // --- Trang chỉ còn bàn: áp netlist + tải scene ngay khi mở trang ---
  syncToCpu();
  ensureScene();

  // --- Thanh gợi ý dưới bàn: bấm × để ẩn ---
  $('benchHintClose')?.addEventListener('click', () => {
    const hint = $('benchHint');
    if (hint) hint.hidden = true;
  });

  // --- Khởi động (chưa cần Three.js cho tới khi mở tab) ---
  renderPalette();
  renderChecks();
  updateModeBanner();
  updateSizeUI();
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// bench.js — Bàn thực hành 3D (Three.js): breadboard 830 lỗ, kéo-thả linh kiện,
// đi dây, xoay 360°, Inspector trượt từ phải, netlist nối vào CPU.
// Chỉ dùng chuột (trang chỉ dùng trên web máy tính).
// Three.js tải qua CDN (importmap, three@0.160.0); nếu tải lỗi thì hiện
// thông báo trong tab bàn. Nối CPU qua window.HoaTrangBenchBridge (app.js).
import {
  PITCH, holeId, holePos, allHoles, parseHole, rowZ,
  HOLE_RADIUS, HOLE_HEIGHT, holeCenterY,
  SEGMENT_LINE_WIDTH_MM, segmentBoundaries,
  legOffsets, legsFor, picLegs, picLegsForAnchor, canPlace, benchToNetlist,
  describeTerminal, defaultBenchState, nextComponentId, compLabel,
  defaultProps, sanitizeState, boardSize, colsOf, rowsOf, railColsOf, picCol,
  picRows, picBodyDepthForRows, bodyDepth, rowLabel,
  pruneStateForSize, validateWireEnd, retargetWireEnd, togglePlacement,
  normalizeSize, holeCount, sizeLabel, sameSize,
  psuVolts, validatePsuVolts, parsePsuPost, psuPostPos, PSU_SCALE, PSU_POST_DX, PSU_POST_Y, PSU_POST_DZ,
  parseScopePost, scopePostPos, SCOPE_POST_DX, SCOPE_POST_Y, SCOPE_POST_DZ, SCOPE_DEFAULT_TX, SCOPE_DEFAULT_TZ,
  parseSerialPost, serialPostPos, SERIAL_POST_DX, SERIAL_POST_Y, SERIAL_POST_DZ, SERIAL_DEFAULT_TX, SERIAL_DEFAULT_TZ,
  clampCamTarget, zoomTowardPoint, panTarget, meterMode, crystalFreq, crystalFreqOf,
  stripKey, buildBenchNets,
} from './bench-model.js?v=20261125bp';
import { checkWiring, SIGNAL_COLORS, SEVEN_SEG_TERMS, KEYPAD_KEYS } from './wiring.js?v=20261125bp';
import { formatVolts, formatAmps, formatCurrentDirection, sevenSegDigit } from './circuit-solver.js?v=20261125bp';
import { LABS, getLab, buildLabState } from './labs.js?v=20261125bp';

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
  let pressedKeypad = null;     // phím bàn phím đang nhấn giữ {id, row, col} hoặc null
  let wireAddrError = '';       // lỗi nhập địa chỉ lỗ trong Inspector dây
  let inspAutoCloseTimer = null; // hẹn tự tắt popup Inspector sau 2s nếu không động vào
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
  const scopeHitMeshes = [];      // núm bắt vô hình ở 3 cọc hiện sóng (để kéo đầu dây vào)
  const serialHitMeshes = [];     // núm bắt vô hình ở 3 cọc màn hình Serial (để kéo đầu dây vào)
  const ledMats = new Map();      // compId -> material phát sáng LED
  const segMats = new Map();      // compId -> {a,b,c,d,e,f,g,dp: material phát sáng từng đoạn LED 7 thanh}
  const lcdTexs = new Map();      // compId -> {canvas, ctx, tex, last}
  const meterTexs = new Map();    // compId -> {canvas, ctx, tex, last, kind}
  const scopeTexs = new Map();    // compId -> {canvas, ctx, tex, last}
  const serialTexs = new Map();   // compId -> {canvas, ctx, tex, last}
  const keypadKeyMeshes = new Map(); // compId -> {row, col: mesh phím} (để tô sáng phím đang nhấn)
  const motorFans = new Map();    // compId -> {fan: mesh cánh quạt, angle, rpm} (để quay cánh quạt)
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
  // Phím bàn phím đang nhấn giữ cũng vậy (nối hàng với cột) — NHƯNG chỉ
  // cho panel Kiểm tra (checkWiring phát hiện chập khi nhấn phím) và cho
  // solver (tham số thứ 4). Netlist đưa vào CPU (resolvePeripherals) phải
  // là netlist KHÔNG nhấn phím: phím nhấn nối hàng với cột thành 1 net
  // chứa 2 chân PIC (chân hàng + chân cột), picPinInNet sẽ lấy nhầm chân
  // cột làm chân hàng (vd R1 lấy RD1 thay vì RB1) — dây nối thì cố định,
  // chỉ trạng thái đóng/mở đổi khi nhấn, nên mapping chân phải lấy từ
  // netlist chưa nhấn. CPU phát hiện phím qua pinLevel (keypadPressed),
  // không qua netlist.
  const pressedIds = () => (pressedBtn ? [pressedBtn] : []);
  function syncToCpu() {
    const b = bridge();
    if (b && typeof b.applyBenchNetlist === 'function') {
      // Truyền cả state + nút đang nhấn + phím đang nhấn để bridge tính
      // số đo đồng hồ (vôn kế/ampe kế bị lược khỏi netlist CPU nên solver
      // cần state gốc) và đồng bộ phím đang nhấn vào CPU (pinLevel).
      // Netlist vào CPU KHÔNG có phím đang nhấn (xem chú thích trên).
      b.applyBenchNetlist(benchToNetlist(state, pressedIds()), state, pressedIds(), pressedKeypad);
      for (const c of state.components) {
        if (c.type === 'pot') b.setPot(c.id, c.props?.pct ?? 0);
      }
    }
    renderChecks();
  }
  // 1 chân của đồng hồ đo (P/N) có nối tới mạch không. Chân đồng hồ chỉ
  // có nhãn stripLabels (không vào termStrip) nên describeTerminal không
  // thấy — xét trực tiếp strip của lỗ chân: có dây cắm vào strip đó,
  // hoặc strip đó chung nhóm với terminal khác (vd chân PIC, chân điện
  // trở đặt cùng strip — không cần dây) thì tính là đã nối.
  function isMeterLegWired(comp, term) {
    const leg = legsFor(comp, state.size).find((l) => l.term === term);
    if (!leg || !leg.hole) return false;
    const key = stripKey(leg.hole, state.size);
    for (const w of state.wires) {
      for (const e of [w.a, w.b]) {
        if (typeof e !== 'string') continue;
        if (parsePsuPost(e) || parseScopePost(e) || parseSerialPost(e)) continue;
        if (stripKey(e, state.size) === key) return true;
      }
    }
    const { groups, find } = buildBenchNets(state, pressedIds());
    const g = groups.get(find(key));
    if (g && (g.terms.some((t) => t !== comp.id + '.' + term) || g.vcc || g.gnd)) return true;
    return false;
  }
  function renderChecks() {
    if (!checksEl) return;
    const netlist = benchToNetlist(state, pressedIds(), pressedKeypad);
    const b = bridge();
    const warns = checkWiring(netlist, b && typeof b.getTris === 'function' ? b.getTris() : null);
    // Cảnh báo thạch anh (đứng trước các cảnh báo đấu nối): không có
    // thạch anh thì chip không có xung, chương trình không chạy được.
    // CHỈ cảnh báo khi đã nạp chương trình (Issue 14a): board thụ động
    // (chưa nạp gì, vd chỉ cắm LED/nút để thử mạch) không có thạch anh
    // là bình thường, không được báo. Không gắn linh kiện nào nên bấm
    // vào không chọn gì (xem compIdFromWarning — trả null cho cảnh báo này).
    const extra = [];
    const runSt = b && typeof b.getRunStatus === 'function' ? b.getRunStatus() : null;
    const hasProgram = !!(runSt && runSt.hasProgram);
    const cf = crystalFreq(state);
    if (hasProgram && (cf === null || cf === undefined)) {
      extra.push({
        id: 'no-crystal', kind: 'warn',
        message: 'Chưa có thạch anh — chip không có xung, chương trình không chạy được.',
        compIds: [], terminalIds: [],
      });
    } else if (hasProgram && lastCodeXtalFreq && cf !== lastCodeXtalFreq) {
      // Thạch anh trên bàn lệch với _XTAL_FREQ của code vừa nạp: xung
      // nhịp thật theo thạch anh, vòng delay sinh theo _XTAL_FREQ nên
      // delay sẽ sai tỉ lệ (vd thạch anh 4MHz mà code 20MHz thì delay
      // thực dài gấp 5 lần).
      extra.push({
        id: 'xtal-mismatch', kind: 'warn',
        message: `Thạch anh trên bàn là ${cf / 1e6} MHz nhưng code dùng _XTAL_FREQ ${lastCodeXtalFreq / 1e6} MHz — delay sẽ sai tỉ lệ.`,
        compIds: [], terminalIds: [],
      });
    }
    // Xung đột nguồn áp (Issue 18): 2 nguồn áp khác nhau trên cùng 1 net
    // (vd chân PIC output 0V nối tắt tới rail +5V) — solver chỉ tính
    // nguồn đầu, nguồn sau bị bỏ qua. Mỗi xung đột 1 cảnh báo, ghi rõ 2
    // nguồn và điện áp của chúng.
    if (b && typeof b.getSourceConflicts === 'function') {
      let conflicts = [];
      try { conflicts = b.getSourceConflicts() || []; } catch { conflicts = []; }
      for (const c of conflicts) {
        extra.push({
          id: 'src-conflict-' + c.firstKey + '-' + c.key, kind: 'warn',
          message: `Xung đột nguồn: ${c.firstKey} (${c.firstVolts}V) và ${c.key} (${c.volts}V) cùng lái 1 net — chỉ ${c.firstKey} được tính, ${c.key} bị bỏ qua. Tách 2 nguồn ra khỏi cùng 1 net.`,
          compIds: [compIdFromKey(c.firstKey), compIdFromKey(c.key)].filter(Boolean),
          terminalIds: [],
        });
      }
    }
    // Rule cho dụng cụ (Issue 14): đồng hồ đo / hiện sóng / Serial /
    // động cơ không có trong netlist CPU nên checkWiring không thấy —
    // xét riêng ở đây (bench.js có đủ state + bridge). Dụng cụ chưa nối
    // thì không làm gì được (đồng hồ hiện "—", scope không thấy sóng,
    // Serial không gửi/nhận, motor không quay) nên báo để nối dây lại.
    for (const comp of state.components) {
      if (comp.type === 'serial') {
        let sw = null;
        try { sw = b && typeof b.getSerialWiring === 'function' ? b.getSerialWiring(comp.id) : null; } catch { sw = null; }
        if (sw && !sw.tx && !sw.rx && !sw.gnd) {
          extra.push({
            id: 'serial-nowire-' + comp.id, kind: 'warn',
            message: `Màn hình Serial ${comp.id} chưa nối dây nào — nối cọc TX→RC6, RX→RC7, GND→GND thì mới gửi/nhận được.`,
            compIds: [comp.id], terminalIds: [],
          });
        } else if (sw && (sw.tx || sw.rx) && !sw.gnd) {
          const dir = (sw.tx ? 'TX' : '') + ((sw.tx && sw.rx) ? '/' : '') + (sw.rx ? 'RX' : '');
          extra.push({
            id: 'serial-nognd-' + comp.id, kind: 'warn',
            message: `Màn hình Serial ${comp.id} đã nối ${dir} nhưng chưa nối GND — UART cần chung mass, nối cọc GND→GND thì mới gửi/nhận được.`,
            compIds: [comp.id], terminalIds: [],
          });
        }
      } else if (comp.type === 'oscilloscope') {
        const wired = state.wires.some((w) => [w.a, w.b].some((e) => {
          if (typeof e !== 'string') return false;
          const sp = parseScopePost(e);
          return !!sp && sp.scopeId === comp.id;
        }));
        if (!wired) {
          extra.push({
            id: 'scope-nowire-' + comp.id, kind: 'warn',
            message: `Đồng hồ hiện sóng ${comp.id} chưa nối dây nào — nối cọc CH1/CH2 tới điểm cần xem và cọc GND về GND thì mới thấy sóng.`,
            compIds: [comp.id], terminalIds: [],
          });
        }
      } else if (comp.type === 'motor') {
        // Chân motor có trong termStrip nên describeTerminal thấy được.
        const un = [];
        for (const t of ['+', '-']) {
          const d = describeTerminal(state, comp.id + '.' + t, pressedIds());
          if (d.members.length <= 1 && !d.vcc && !d.gnd) un.push(t);
        }
        if (un.length === 2) {
          extra.push({
            id: 'motor-nowire-' + comp.id, kind: 'warn',
            message: `Động cơ ${comp.id} chưa nối dây nào — nối 2 chân +/− tới nguồn hoặc chân PIC thì mới quay.`,
            compIds: [comp.id], terminalIds: [],
          });
        } else if (un.length === 1) {
          extra.push({
            id: 'motor-half-' + comp.id, kind: 'warn',
            message: `Động cơ ${comp.id} mới nối 1 chân (chân ${un[0]} chưa nối) — nối nốt chân còn lại thì mới quay.`,
            compIds: [comp.id], terminalIds: [],
          });
        }
      } else if (comp.type === 'multimeter') {
        const un = [];
        for (const t of ['P', 'N']) {
          if (!isMeterLegWired(comp, t)) un.push(t);
        }
        if (un.length === 2) {
          extra.push({
            id: 'meter-nowire-' + comp.id, kind: 'warn',
            message: `Đồng hồ đo ${comp.id} chưa nối dây nào — nối 2 chân P/N tới điểm cần đo thì mới hiện số (đo áp: song song; đo dòng: nối tiếp qua tải).`,
            compIds: [comp.id], terminalIds: [],
          });
        } else if (un.length === 1) {
          extra.push({
            id: 'meter-half-' + comp.id, kind: 'warn',
            message: `Đồng hồ đo ${comp.id} mới nối 1 chân (chân ${un[0]} chưa nối) — nối nốt chân còn lại thì mới đo được.`,
            compIds: [comp.id], terminalIds: [],
          });
        }
      }
    }
    const all = [...extra, ...warns];
    if (!all.length) {
      checksEl.innerHTML = '<li class="check-ok">Mạch ổn — không phát hiện vấn đề đấu nối.</li>';
      return;
    }
    checksEl.innerHTML = all.map((w, i) =>
      `<li><button type="button" class="check-item ${w.kind === 'short' ? 'check-short' : w.kind === 'info' ? 'check-info' : 'check-warn'}" data-warn="${i}">${esc(w.message)}</button></li>`).join('');
    checksEl.querySelectorAll('.check-item').forEach((btn) => btn.addEventListener('click', () => {
      const w = all[Number(btn.dataset.warn)];
      const compId = compIdFromWarning(w);
      if (compId) select({ kind: 'comp', id: compId });
    }));
  }
  // Id linh kiện từ key nguồn trong xung đột (vd 'PIC.RB0' -> 'PIC1',
  // 'PSU1' -> 'PSU1', 'POT0' -> 'POT0'): để bấm cảnh báo thì chọn đúng
  // linh kiện liên quan (xem compIdFromWarning).
  function compIdFromKey(key) {
    if (!key) return null;
    if (key.startsWith('PIC.')) return 'PIC1';
    const m = key.match(/^(LED\d+|BTN\d+|POT\d+|LCD\d+|BUZ\d+|VM\d+|AM\d+|MM\d+|OSC\d+|SEG\d+|KP\d+|M\d+|SER\d+|PSU\d+)/);
    return m ? m[1] : null;
  }
  function compIdFromWarning(w) {
    for (const id of [...(w.compIds || []), ...(w.terminalIds || [])]) {
      if (id.startsWith('PIC.')) return 'PIC1';
      const m = id.match(/^(LED\d+|BTN\d+|POT\d+|LCD\d+|BUZ\d+|VM\d+|AM\d+|MM\d+|OSC\d+|SEG\d+|KP\d+|M\d+|SER\d+)/);
      if (m && state.components.some((c) => c.id === m[1])) return m[1];
    }
    return null;
  }

  // --- Khay linh kiện (bên trái) ---
  const PALETTE = [
    { type: 'led', name: 'LED', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 48 64"><line x1="18" y1="34" x2="18" y2="62" stroke="#94A3B8" stroke-width="3"/><line x1="30" y1="34" x2="30" y2="62" stroke="#94A3B8" stroke-width="3"/><circle cx="24" cy="22" r="14" fill="#DC2626" stroke="#991B1B" stroke-width="2"/><circle cx="20" cy="18" r="4" fill="#FCA5A5"/></svg>' },
    { type: 'resistor', name: 'Điện trở 220Ω', hint: 'Kéo vào lỗ breadboard', svg: '<svg viewBox="0 0 76 30"><line x1="0" y1="15" x2="14" y2="15" stroke="#94A3B8" stroke-width="3"/><line x1="62" y1="15" x2="76" y2="15" stroke="#94A3B8" stroke-width="3"/><rect x="14" y="7" width="48" height="16" rx="8" fill="#D9A066" stroke="#92400E" stroke-width="1.5"/><rect x="26" y="7" width="4" height="16" fill="#DC2626"/><rect x="34" y="7" width="4" height="16" fill="#DC2626"/><rect x="42" y="7" width="4" height="16" fill="#92400E"/></svg>' },
    { type: 'capacitor', name: 'Tụ gốm', hint: 'Kéo vào lỗ breadboard — tụ nạp cho thạch anh (22pF)', svg: '<svg viewBox="0 0 48 56"><circle cx="24" cy="18" r="13" fill="#D9A066" stroke="#92400E" stroke-width="2"/><circle cx="24" cy="18" r="5" fill="#B45309"/><line x1="14" y1="29" x2="14" y2="54" stroke="#94A3B8" stroke-width="3"/><line x1="34" y1="29" x2="34" y2="54" stroke="#94A3B8" stroke-width="3"/></svg>' },
    { type: 'crystal', name: 'Thạch anh', hint: 'Kéo vào lỗ breadboard — nối 2 chân OSC1/OSC2 của PIC', svg: '<svg viewBox="0 0 76 30"><rect x="14" y="7" width="48" height="16" rx="8" fill="#CBD5E1" stroke="#64748B" stroke-width="1.5"/><line x1="24" y1="15" x2="52" y2="15" stroke="#64748B" stroke-width="1.5"/><line x1="30" y1="23" x2="30" y2="30" stroke="#94A3B8" stroke-width="3"/><line x1="46" y1="23" x2="46" y2="30" stroke="#94A3B8" stroke-width="3"/></svg>' },
    { type: 'sevenseg', name: 'LED 7 thanh', hint: 'Kéo vào lỗ breadboard — nối các đoạn tới chân PORT, chân chung về VCC/GND', svg: '<svg viewBox="0 0 48 64"><rect x="6" y="6" width="36" height="52" rx="4" fill="#1F2937" stroke="#0F172A" stroke-width="2"/><g stroke="#EF4444" stroke-width="3" stroke-linecap="round"><line x1="14" y1="14" x2="34" y2="14"/><line x1="14" y1="32" x2="34" y2="32"/><line x1="14" y1="50" x2="34" y2="50"/><line x1="14" y1="18" x2="14" y2="28"/><line x1="34" y1="18" x2="34" y2="28"/><line x1="14" y1="36" x2="14" y2="46"/><line x1="34" y1="36" x2="34" y2="46"/></g><circle cx="40" cy="50" r="2" fill="#EF4444"/></svg>' },
    { type: 'keypad', name: 'Bàn phím 4x4', hint: 'Kéo vào lỗ breadboard — nối 4 hàng R0–R3 tới chân PORT (lái xuống 0 để quét), 4 cột C0–C3 tới chân PORT (đọc, pull-up)', svg: '<svg viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="4" fill="#1F2937" stroke="#0F172A" stroke-width="2"/><g fill="#334155" stroke="#64748B" stroke-width="1"><rect x="6" y="6" width="10" height="10" rx="2"/><rect x="20" y="6" width="10" height="10" rx="2"/><rect x="34" y="6" width="10" height="10" rx="2"/><rect x="48" y="6" width="10" height="10" rx="2"/><rect x="6" y="20" width="10" height="10" rx="2"/><rect x="20" y="20" width="10" height="10" rx="2"/><rect x="34" y="20" width="10" height="10" rx="2"/><rect x="48" y="20" width="10" height="10" rx="2"/><rect x="6" y="34" width="10" height="10" rx="2"/><rect x="20" y="34" width="10" height="10" rx="2"/><rect x="34" y="34" width="10" height="10" rx="2"/><rect x="48" y="34" width="10" height="10" rx="2"/><rect x="6" y="48" width="10" height="10" rx="2"/><rect x="20" y="48" width="10" height="10" rx="2"/><rect x="34" y="48" width="10" height="10" rx="2"/><rect x="48" y="48" width="10" height="10" rx="2"/></g></svg>' },
    { type: 'motor', name: 'Động cơ DC', hint: 'Kéo vào lỗ breadboard — nối 2 chân +/− tới nguồn hoặc chân PIC (qua điện trở hạn dòng nếu cần); tốc độ theo điện áp', svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="28" r="18" fill="#64748B" stroke="#334155" stroke-width="2"/><circle cx="32" cy="28" r="7" fill="#94A3B8" stroke="#334155" stroke-width="1.5"/><g stroke="#1E3A5F" stroke-width="3" stroke-linecap="round"><line x1="32" y1="28" x2="32" y2="12"/><line x1="32" y1="28" x2="46" y2="36"/><line x1="32" y1="28" x2="18" y2="36"/></g><line x1="24" y1="44" x2="24" y2="60" stroke="#94A3B8" stroke-width="3"/><line x1="40" y1="44" x2="40" y2="60" stroke="#94A3B8" stroke-width="3"/></svg>' },
    { type: 'multimeter', name: 'Đồng hồ đo', hint: 'Kéo vào lỗ breadboard — chọn đo áp (V) hay đo dòng (A) trong popup', svg: '<svg viewBox="0 0 76 44"><rect x="6" y="4" width="64" height="28" rx="4" fill="#1E3A5F" stroke="#0F172A" stroke-width="2"/><rect x="12" y="10" width="52" height="16" rx="2" fill="#0F172A"/><text x="38" y="22" text-anchor="middle" font-family="Fira Code, monospace" font-size="10" fill="#7DD3FC">5.00 V</text><line x1="22" y1="32" x2="22" y2="42" stroke="#94A3B8" stroke-width="3"/><line x1="54" y1="32" x2="54" y2="42" stroke="#94A3B8" stroke-width="3"/></svg>' },
    { type: 'oscilloscope', name: 'Đồng hồ hiện sóng', hint: 'Kéo thả lên mặt bàn — nối dây vào cọc CH1/CH2/GND', svg: '<svg viewBox="0 0 76 44"><rect x="6" y="4" width="64" height="28" rx="4" fill="#1E3A5F" stroke="#0F172A" stroke-width="2"/><rect x="12" y="10" width="52" height="16" rx="2" fill="#0F172A"/><path d="M14 21 V15 H22 V21 H30 V15 H38 V21 H46 V15 H54 V21" fill="none" stroke="#7DD3FC" stroke-width="1.5"/><path d="M14 24 L20 19 L26 24 L32 19 L38 24 L44 19 L50 24" fill="none" stroke="#FBBF24" stroke-width="1.5"/><circle cx="22" cy="30" r="2" fill="#7DD3FC"/><circle cx="38" cy="30" r="2" fill="#FBBF24"/><circle cx="54" cy="30" r="2" fill="#0F172A" stroke="#94A3B8" stroke-width="1"/><line x1="22" y1="32" x2="22" y2="42" stroke="#94A3B8" stroke-width="3"/><line x1="38" y1="32" x2="38" y2="42" stroke="#94A3B8" stroke-width="3"/><line x1="54" y1="32" x2="54" y2="42" stroke="#94A3B8" stroke-width="3"/></svg>' },
    { type: 'serial', name: 'Màn hình Serial', hint: 'Kéo thả lên mặt bàn — nối dây TX→RC6, RX→RC7, GND→GND (dây chỉ để mạch đầy đủ; dữ liệu chạy qua CPU)', svg: '<svg viewBox="0 0 76 44"><rect x="6" y="4" width="64" height="28" rx="4" fill="#1E3A5F" stroke="#0F172A" stroke-width="2"/><rect x="12" y="10" width="52" height="16" rx="2" fill="#0F172A"/><text x="16" y="22" font-family="Fira Code, monospace" font-size="9" fill="#4ADE80">Hi</text><line x1="28" y1="21" x2="34" y2="21" stroke="#4ADE80" stroke-width="1.5"/><circle cx="22" cy="30" r="2" fill="#4ADE80"/><circle cx="38" cy="30" r="2" fill="#FBBF24"/><circle cx="54" cy="30" r="2" fill="#0F172A" stroke="#94A3B8" stroke-width="1"/><line x1="22" y1="32" x2="22" y2="42" stroke="#94A3B8" stroke-width="3"/><line x1="38" y1="32" x2="38" y2="42" stroke="#94A3B8" stroke-width="3"/><line x1="54" y1="32" x2="54" y2="42" stroke="#94A3B8" stroke-width="3"/></svg>' },
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

  // --- Tab "Nạp viết code": editor C (XC8) + nạp file .hex + breakpoint ---
  const codeTabEl = $('benchTabCode');
  const compTabEl = $('benchTabComponents');
  const labsTabEl = $('benchTabLabs');
  const labListEl = $('benchLabList');
  const codeInput = $('benchCodeInput');
  const codeGutter = $('benchCodeGutter');
  const codeStatusEl = $('benchCodeStatus');
  const cpuPanelEl = $('benchCpuPanel');
  const hexFileInput = $('benchHexFile');
  const CODE_LS_KEY = 'hoatrang-code-v1';
  // Code C mẫu dự phòng nếu bridge chưa có (app.js luôn có).
  // Phải giống hệt DEFAULT_C_PROGRAM trong app.js.
  const FALLBACK_C = `#include <xc.h>
#define _XTAL_FREQ 4000000

void main() {
  TRISB = 0;
  while (1) {
    RB0 = 1;
    __delay_ms(500);
    RB0 = 0;
    __delay_ms(500);
  }
}`;
  let sideTab = 'components';
  let codeInitDone = false;
  let codeBreakpoints = new Set();   // số dòng có breakpoint
  let codeLineToAddr = new Map();    // dòng -> địa chỉ (lần dịch gần nhất)
  let codeLoaded = false;            // đã nạp chương trình từ editor chưa
  let codeStatusSig = '';
  let cpuPanelSig = '';              // chữ ký trạng thái CPU của panel Thanh ghi
  let codeSaveTimer = null;
  // _XTAL_FREQ của code vừa nạp thành công (để renderChecks cảnh báo khi
  // thạch anh trên bàn lệch với code) + cờ lần nạp gần nhất thiếu thạch
  // anh (chip không có xung nên chương trình nạp rồi vẫn không chạy).
  // File .hex không mang tần số nên nạp .hex thì xóa _XTAL_FREQ đã lưu.
  let lastCodeXtalFreq = null;
  let lastLoadNoCrystal = false;
  const NO_CRYSTAL_MSG = 'Chưa có thạch anh trên bàn — chip không có xung, chương trình không chạy được. Thêm thạch anh (nối OSC1/OSC2) rồi nạp lại.';

  function setCodeWide(on) { benchView.classList.toggle('code-wide', on); }
  function setSideTab(tab) {
    sideTab = tab;
    // Sang tab khác (không phải tab viết code) thì tự dừng chương trình
    // đang chạy — mạch đang sửa/đổi thì code cũ không được chạy tiếp.
    // (Mở lab cũng dừng, xem openLab — sang tab code thì không dừng.)
    if (tab !== 'code') {
      const b = bridge();
      if (b && typeof b.pauseProgram === 'function') b.pauseProgram();
    }
    document.querySelectorAll('.bench-mini-tab').forEach((b) => {
      const on = b.dataset.sideTab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (compTabEl) compTabEl.hidden = tab !== 'components';
    if (codeTabEl) codeTabEl.hidden = tab !== 'code';
    if (labsTabEl) labsTabEl.hidden = tab !== 'labs';
    // Đổi tab thì Inspector đang mở (nếu có) tự đóng.
    if (selected) select(null);
    // Chuyển tab thì panel về 20%; chỉ bấm vào phần code mới to lên 40%.
    setCodeWide(false);
    // Tab Bài Lab: ẩn hẳn bàn thực hành 3D, panel trái trải full chiều
    // rộng, các card lab xếp lưới 4 cột (xem CSS .bench-page.labs-full).
    benchView.classList.toggle('labs-full', tab === 'labs');
    if (tab === 'code') initCodeTab();
    if (tab === 'labs') renderLabList();
  }
  document.querySelectorAll('.bench-mini-tab').forEach((b) =>
    b.addEventListener('click', () => setSideTab(b.dataset.sideTab || 'components')));
  // Panel tự to/nhỏ: bấm hoặc focus vào phần code -> 40%, bấm/focus ra
  // ngoài -> 20%. Tab Linh Kiện đang mở thì luôn 20%.
  document.addEventListener('pointerdown', (e) => {
    if (sideTab !== 'code' || !codeTabEl) return;
    // Bấm nút trong tab code (Dừng, Nạp & chạy...): đừng mở rộng panel
    // ngay — panel to lên (grid animate 250ms) làm nút dịch khỏi con trỏ
    // nên click trượt, bấm phát đầu chỉ mở rộng mà không dừng/chạy được.
    // Để click chạy xong rồi mới mở rộng (handler click bên dưới).
    if (codeTabEl.contains(e.target) && e.target.closest('button')) return;
    setCodeWide(codeTabEl.contains(e.target));
  });
  document.addEventListener('focusin', (e) => {
    if (sideTab !== 'code' || !codeTabEl) return;
    if (codeTabEl.contains(e.target) && e.target.closest('button')) return;
    setCodeWide(codeTabEl.contains(e.target));
  });
  // Bấm nút trong tab code: click (hành động của nút) đã chạy xong thì
  // mới mở rộng panel — 1 lần bấm vừa dừng/chạy vừa mở rộng.
  codeTabEl.addEventListener('click', (e) => {
    if (e.target.closest('button')) setCodeWide(true);
  });

  // --- Tab "Bài Lab": các lab là card, bấm card thì nạp mạch + code mẫu
  // rồi nhảy thẳng sang tab "Nạp viết code" (bàn mạch đã nạp sẵn ở nền,
  // tab Labs chỉ để chọn lab, không cần thao tác bàn thực hành ở đây).
  // Nạp cả mạch (linh kiện + dây) lẫn code C mẫu của lab vào editor
  // (chưa nạp vào CPU — user vẫn bấm Nạp & chạy để chạy).
  function renderLabList() {
    if (!labListEl) return;
    labListEl.innerHTML = LABS.map((lab) => `
      <div class="bench-lab" data-lab="${esc(lab.id)}" role="button" tabindex="0" aria-label="Mở lab ${esc(lab.title)}">
        <strong>${esc(lab.title)}</strong>
        <p class="sub">${esc(lab.desc)}</p>
        ${lab.note ? `<p class="sub bench-lab-note">${esc(lab.note)}</p>` : ''}
        <span class="bench-lab-go">Mở lab → viết code</span>
      </div>`).join('') || '<p class="sub">Chưa có bài lab nào.</p>';
    labListEl.querySelectorAll('[data-lab]').forEach((card) => {
      card.addEventListener('click', () => openLab(card.dataset.lab));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLab(card.dataset.lab); }
      });
    });
  }
  function openLab(labId) {
    const lab = getLab(labId);
    if (!lab) { setStatus('Không tìm thấy bài lab.'); return; }
    const r = buildLabState(lab);
    if (!r.ok) { setStatus('Không mở được lab: ' + r.reason); return; }
    const sizeChanged = !sameSize(state.size, r.state.size);
    state = r.state;
    seq = 1; wireSeq = 100;
    state.components.forEach((c) => {
      const n = parseInt(String(c.id).replace(/^[A-Z]+/, ''), 10);
      if (!isNaN(n) && n >= seq) seq = n + 1;
    });
    state.wires.forEach((w) => {
      const n = parseInt(String(w.id).replace(/^W/, ''), 10);
      if (!isNaN(n) && n >= wireSeq) wireSeq = n + 1;
    });
    select(null);
    save();
    if (sizeChanged) { rebuildBoard(); updateSizeUI(); }
    rebuildAll(); syncToCpu();
    // Mở lab mới thì dừng chương trình đang chạy (nếu có) — code mẫu của
    // lab chỉ lên editor, chưa nạp/chạy; user tự bấm "Nạp & chạy" khi sẵn
    // sàng. Trước đây chương trình cũ vẫn chạy tiếp trên mạch lab mới nên
    // trông như lab tự chạy ngay khi vừa mở.
    const bPause = bridge();
    if (bPause && typeof bPause.pauseProgram === 'function') bPause.pauseProgram();
    // Nạp luôn code C mẫu của lab vào editor (ghi đè code hiện tại).
    // codeInput vẫn tồn tại trong DOM dù tab code đang hidden; nếu tab
    // code chưa init thì initCodeTab sau này phải giữ code này (xem bẫy
    // trong initCodeTab — chỉ điền code mặc định khi editor còn trống).
    if (typeof lab.code === 'string' && lab.code) {
      codeInput.value = lab.code;
      codeAssemble();
      if (codeInitDone) { pruneBreakpoints(); renderGutter(); }
      codeLoaded = false;
    }
    setStatus(`Đã mở lab ${lab.title} — mạch + code mẫu đã lên. Bấm Nạp & chạy để chạy chương trình.`);
    // Chọn card lab thì nhảy thẳng sang tab viết code (mạch đã nạp sẵn
    // ở nền; initCodeTab giữ code lab vì editor đã có code, không ghi đè).
    setSideTab('code');
  }

  // Code KHÔNG lưu localStorage nữa: refresh trang thì code về lại chương
  // trình mẫu C mặc định (FALLBACK_C). Chỉ giữ trong bộ nhớ phiên làm việc.
  function loadSavedCode() {
    try { localStorage.removeItem(CODE_LS_KEY); } catch { /* bỏ qua */ }
    return null;
  }
  function saveCode() { /* không lưu nữa */ }
  function saveCodeSoon() { /* không lưu nữa */ }
  // Dịch code C hiện tại (chỉ để lấy bảng dòng C -> địa chỉ cho gutter,
  // không nạp vào CPU). Lỗi thì codeLineToAddr rỗng — gutter vẫn hiện số
  // dòng nhưng không đặt được breakpoint; lỗi hiện qua setCodeStatus ở
  // chỗ gọi (Nạp & chạy). Trả nguyên kết quả compileC.
  function codeAssemble() {
    const b = bridge();
    const r = b && typeof b.compileCOnly === 'function'
      ? b.compileCOnly(codeInput.value)
      : { ok: false, errors: [{ line: 1, message: 'Chưa nối được CPU.' }], lineToAddr: new Map() };
    codeLineToAddr = (r.ok && r.lineToAddr) ? r.lineToAddr : new Map();
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
    // Panel "Thanh ghi" cập nhật cùng nhịp poll 150ms + ngay sau mỗi nút
    // bấm (các nút đều gọi refreshCodeStatus(true)). Đặt TRƯỚC chữ ký
    // trạng thái chạy: panel phải đổi cả khi PC/dòng không đổi (vd bấm
    // nút trên bàn làm mức PORT đổi trong lúc chương trình đang dừng).
    renderCpuPanel();
    const b = bridge();
    if (!b || typeof b.getRunStatus !== 'function') return;
    const st = b.getRunStatus();
    // Thạch anh hiện tại trên bàn (Hz, null nếu không có): để status đổi
    // ngay khi thạch anh bị gỡ giữa chừng (U1) — runner vẫn ở trạng thái
    // 'running' mà clockHz = 0 nên chương trình đứng yên, status phải
    // báo thiếu thạch anh thay vì "Đang chạy…". lastLoadNoCrystal là cờ
    // lúc nạp (giữ nguyên cơ chế đó); cờ hiện tại là "hoặc" của 2 cái:
    // nạp đã thiếu thạch anh, hoặc thạch anh vừa bị gỡ sau khi nạp.
    const crystalNow = (b && typeof b.getCrystalFreq === 'function') ? b.getCrystalFreq() : null;
    const noCrystalNow = !(crystalNow && crystalNow > 0);
    const noCrystal = lastLoadNoCrystal || noCrystalNow;
    const sig = [st.state, st.pauseReason, st.pc, st.line, st.hexMode, noCrystal].join('|');
    if (!force && sig === codeStatusSig) return;
    codeStatusSig = sig;
    let curLine = null;
    if (!st.hasProgram) {
      setCodeStatus('Chưa nạp chương trình.');
    } else if (st.state === 'running') {
      // Chương trình nạp rồi nhưng không có thạch anh: runner vẫn ở trạng
      // thái 'running' mà không chạy chu kỳ nào (clockHz = 0) — hiện
      // cảnh báo thiếu thạch anh thay cho 'Đang chạy…' để không tưởng
      // là chương trình đang chạy. Áp dụng cả khi nạp đã thiếu (cờ
      // lastLoadNoCrystal) lẫn khi thạch anh bị gỡ giữa chừng (U1).
      setCodeStatus(noCrystal ? NO_CRYSTAL_MSG : (st.hexMode ? 'Đang chạy chương trình .hex…' : 'Đang chạy…'), noCrystal);
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

  // --- Panel "Thanh ghi": trạng thái CPU trực tiếp (tab Nạp viết code) ---
  // Chỉ vẽ lại khi chữ ký trạng thái đổi (poll 150ms gọi liên tục, và
  // refreshCodeStatus(true) gọi ngay sau mỗi nút bấm). Chưa nạp chương
  // trình thì hiện "Chưa nạp chương trình.", không hiện số 0 giả.
  // Giá trị lấy từ bridge getCpuState() (CPU thật, xem cpuStateSnapshot
  // trong pic16.js); số hiển thị dạng HEX, PORT/TRIS thêm nhị phân.
  const CPU_STATE_LABEL = {
    idle: 'Đã nạp — chưa chạy', running: 'Đang chạy', paused: 'Đã dừng',
    sleep: 'SLEEP', 'no-crystal': 'Chờ thạch anh', reset: 'Giữ reset',
  };
  function cpuHex(v, digits = 2) {
    return '0x' + (v & ((1 << (digits * 4)) - 1)).toString(16).toUpperCase().padStart(digits, '0');
  }
  function cpuBin(v, bits) {
    return '0b' + (v & ((1 << bits) - 1)).toString(2).padStart(bits, '0');
  }
  function cpuFlagsHtml(flags) {
    return Object.entries(flags).map(([k, on]) =>
      `<span class="cpu-flag${on ? ' on' : ''}">${k}</span>`).join('');
  }
  function cpuSimTime(us) {
    if (!Number.isFinite(us) || us <= 0) return '0 µs';
    if (us >= 1e6) return (us / 1e6).toFixed(3) + ' s';
    if (us >= 1000) return (us / 1000).toFixed(3) + ' ms';
    return Math.round(us) + ' µs';
  }
  function cpuPanelHtml(st) {
    const portRows = ['A', 'B', 'C', 'D', 'E'].map((L) => {
      const p = st.ports[L];
      return `<tr><td>PORT${L}</td><td class="cpu-num">${cpuHex(p.port)}</td><td class="cpu-num">${cpuBin(p.port, p.bits)}</td><td class="cpu-num">${cpuHex(p.tris)}</td><td class="cpu-num">${cpuBin(p.tris, p.bits)}</td></tr>`;
    }).join('');
    return `<h2 class="cpu-panel-h">Thanh ghi <span class="cpu-state st-${st.state}">${CPU_STATE_LABEL[st.state] || st.state}</span></h2>
  <h3 class="cpu-sec">Thanh ghi chính</h3>
  <table class="cpu-table"><tbody>
    <tr><td>W</td><td class="cpu-num">${cpuHex(st.w)}</td><td>STATUS</td><td class="cpu-num">${cpuHex(st.status)}</td></tr>
    <tr><td>PCL</td><td class="cpu-num">${cpuHex(st.pcl)}</td><td>PC</td><td class="cpu-num">${cpuHex(st.pc, 4)}</td></tr>
    <tr><td>FSR</td><td class="cpu-num">${cpuHex(st.fsr)}</td><td>PCLATH</td><td class="cpu-num">${cpuHex(st.pclath)}</td></tr>
  </tbody></table>
  <div class="cpu-flags"><span class="cpu-flags-label">STATUS:</span>${cpuFlagsHtml(st.statusFlags)}</div>
  <h3 class="cpu-sec">Cổng I/O</h3>
  <table class="cpu-table"><thead><tr><th>Cổng</th><th>PORT</th><th>Nhị phân</th><th>TRIS</th><th>Nhị phân</th></tr></thead><tbody>${portRows}</tbody></table>
  <p class="sub cpu-note">TRIS: 1 = input, 0 = output.</p>
  <h3 class="cpu-sec">Timer / Ngắt</h3>
  <table class="cpu-table"><tbody>
    <tr><td>TMR0</td><td class="cpu-num">${cpuHex(st.tmr0)}</td><td>OPTION_REG</td><td class="cpu-num">${cpuHex(st.optionReg)}</td></tr>
    <tr><td>Prescaler TMR0</td><td class="cpu-num" colspan="3">${st.tmr0Prescaler}</td></tr>
    <tr><td>INTCON</td><td class="cpu-num">${cpuHex(st.intcon)}</td><td></td><td></td></tr>
  </tbody></table>
  <div class="cpu-flags"><span class="cpu-flags-label">INTCON:</span>${cpuFlagsHtml(st.intconFlags)}</div>
  <h3 class="cpu-sec">Thực thi</h3>
  <table class="cpu-table"><tbody>
    <tr><td>Chu kỳ lệnh</td><td class="cpu-num">${st.cycles.toLocaleString('en-US')}</td><td>Thời gian mô phỏng</td><td class="cpu-num">${cpuSimTime(st.simTimeUs)}</td></tr>
    <tr><td>Ngăn xếp</td><td class="cpu-num">${st.stackDepth} / 8</td><td>Xung nhịp</td><td class="cpu-num">${st.clockHz ? (st.clockHz / 1e6) + ' MHz' : '—'}</td></tr>
  </tbody></table>`;
  }
  function renderCpuPanel() {
    if (!cpuPanelEl) return;
    const b = bridge();
    const st = (b && typeof b.getCpuState === 'function') ? b.getCpuState() : null;
    if (!st || !st.hasProgram) {
      if (cpuPanelSig === 'none') return;
      cpuPanelSig = 'none';
      cpuPanelEl.innerHTML = '<h2 class="cpu-panel-h">Thanh ghi</h2><p class="sub">Chưa nạp chương trình.</p>';
      return;
    }
    const sig = JSON.stringify(st);
    if (sig === cpuPanelSig) return;
    cpuPanelSig = sig;
    cpuPanelEl.innerHTML = cpuPanelHtml(st);
  }
  function initCodeTab() {
    if (codeInitDone || !codeInput) return;
    codeInitDone = true;
    loadSavedCode();
    const b0 = bridge();
    // BẪY: openLab có thể đã nạp code lab vào editor TRƯỚC khi tab code
    // init lần đầu (user mở lab từ tab Bài Lab rồi mới sang tab code).
    // Chỉ điền code mẫu mặc định khi editor còn trống — nếu đã có code
    // (do openLab nạp) thì giữ nguyên, chỉ dịch + vẽ gutter.
    if (!codeInput.value.trim()) {
      codeInput.value = (b0 && typeof b0.defaultProgram === 'function' ? b0.defaultProgram() : FALLBACK_C);
    }
    codeAssemble();
    pruneBreakpoints();
    renderGutter();
    codeInput.addEventListener('input', () => {
      renderGutter();
      saveCodeSoon();
      if (codeLoaded) {
        codeLoaded = false;
        setCodeStatus('Code đã sửa — bấm Nạp & chạy để nạp lại.');
      }
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
      if (!codeLineToAddr.has(line)) return; // dòng trống/chú thích/#include/#define: không sinh lệnh, không đặt được
      if (codeBreakpoints.has(line)) codeBreakpoints.delete(line);
      else codeBreakpoints.add(line);
      saveCode();
      renderGutter();
      pushBreakpointsToCpu();
    });
    $('btnCodeLoadRun')?.addEventListener('click', () => {
      const b = bridge();
      if (!b) return;
      const r = b.loadC(codeInput.value);
      if (!r.ok) { setCodeStatus(codeErrorText(r.errors), true); return; }
      codeLineToAddr = r.lineToAddr || new Map();
      pruneBreakpoints();
      pushBreakpointsToCpu();
      codeLoaded = true;
      // Ghi nhớ _XTAL_FREQ + tình trạng thiếu thạch anh của lần nạp này
      // (renderChecks + refreshCodeStatus dùng để cảnh báo).
      lastCodeXtalFreq = typeof r.xtalFreq === 'number' ? r.xtalFreq : null;
      lastLoadNoCrystal = !!r.noCrystal;
      renderChecks();
      const run = b.runProgram();
      if (run.ok) setCodeStatus(r.noCrystal ? NO_CRYSTAL_MSG : 'Đang chạy…', !!r.noCrystal);
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
      // Chưa nạp chương trình thì nạp từ editor trước (biên dịch + nạp,
      // KHÔNG chạy) rồi mới bước — để bấm "Chạy từng lệnh" ngay từ đầu
      // cũng bước được từ dòng đầu tiên, không bắt phải bấm "Nạp & chạy".
      if (!codeLoaded) {
        const lr = b.loadC(codeInput.value);
        if (!lr.ok) { setCodeStatus(codeErrorText(lr.errors), true); return; }
        codeLineToAddr = lr.lineToAddr || new Map();
        pruneBreakpoints();
        pushBreakpointsToCpu();
        codeLoaded = true;
        lastCodeXtalFreq = typeof lr.xtalFreq === 'number' ? lr.xtalFreq : null;
        lastLoadNoCrystal = !!lr.noCrystal;
        renderChecks();
        if (lr.noCrystal) { setCodeStatus(NO_CRYSTAL_MSG, true); return; }
      }
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
      // File .hex không mang tần số: xóa _XTAL_FREQ của lần nạp C trước
      // (không còn cơ sở cảnh báo lệch tần số), nhưng vẫn ghi nhớ tình
      // trạng thiếu thạch anh của lần nạp này.
      lastCodeXtalFreq = null;
      lastLoadNoCrystal = !!r.noCrystal;
      renderChecks();
      const run = b.runProgram();
      setCodeStatus(run.ok
        ? (r.noCrystal ? NO_CRYSTAL_MSG
          : `Đã nạp file ${f.name}: ${r.words} word — đang chạy. Breakpoint không áp dụng cho chương trình .hex.`)
        : run.error, !run.ok || !!r.noCrystal);
      refreshCodeStatus(true);
    });
    setInterval(refreshCodeStatus, 150);
    refreshCodeStatus(true);
  }

  // --- Chọn / Inspector (panel trượt từ phải) ---
  // Popup Inspector tự tắt sau 2s nếu không động vào (Điệp lệnh 26/11):
  // mở popup thì hẹn tắt; bấm/chạm/cuộn/focus vào panel thì hủy hẹn
  // (đã động vào thì để mở cho chỉnh). Đóng popup thì hủy hẹn.
  function armInspAutoClose() {
    clearTimeout(inspAutoCloseTimer);
    inspAutoCloseTimer = setTimeout(() => { inspAutoCloseTimer = null; select(null); }, 2000);
  }
  function disarmInspAutoClose() {
    clearTimeout(inspAutoCloseTimer);
    inspAutoCloseTimer = null;
  }
  function select(sel) {
    const prevWire = selected && selected.kind === 'wire' ? selected.id : null;
    selected = sel;
    wireAddrError = '';
    // Dây được chọn vẽ lại dày + sáng hơn + có núm kéo 2 đầu.
    if (prevWire || (sel && sel.kind === 'wire')) rebuildWires();
    else updateSelectionVisual();
    renderInspector();
    if (sel) armInspAutoClose(); else disarmInspAutoClose();
  }
  function updateSelectionVisual() {
    if (!sceneReady) return;
    const selComp = selected && selected.kind === 'comp'
      ? state.components.find((c) => c.id === selected.id) : null;
    if (selComp && selComp.type !== 'psu' && selComp.type !== 'oscilloscope' && selComp.type !== 'serial' && selComp.type !== 'pic') showHighlightForComp(selComp.id);
    else hideHighlight();
  }
  // Chuỗi đoạn đang sáng của 1 LED 7 thanh ('a, b, c' / 'Không đoạn nào sáng')
  // — dùng chung cho popup Inspector lúc mở và vòng poll cập nhật live.
  function segOnText(on) {
    const list = SEVEN_SEG_TERMS.filter((t) => on && on[t]);
    return list.length ? list.join(', ') : 'Không đoạn nào sáng';
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
      const pos = (comp.type === 'psu' || comp.type === 'oscilloscope' || comp.type === 'serial') ? `Trên bàn (${Math.round(comp.tx)}, ${Math.round(comp.tz)})` : 'BB: ' + comp.anchor;
      let body = '';
      if (comp.type === 'resistor') {
        body = `<label class="bench-insp-label" for="inspResVal">Giá trị điện trở (Ω)</label>
          <input class="input" id="inspResVal" type="number" min="1" max="10000000" step="1" value="${comp.props?.value ?? 220}">
          <p class="sub">Điện trở nối 2 strip của nó — dùng nối tiếp với LED để hạn dòng.</p>`;
      } else if (comp.type === 'capacitor') {
        body = `<label class="bench-insp-label" for="inspCapVal">Giá trị tụ (pF)</label>
          <input class="input" id="inspCapVal" type="number" min="1" step="1" value="${comp.props?.value ?? 22}">
          <p class="sub">Tụ gốm hở mạch với DC — chỉ làm tụ nạp cho mạch dao động thạch anh, không ảnh hưởng dòng DC.</p>`;
      } else if (comp.type === 'crystal') {
        const freq = comp.props?.freq ?? 4000000;
        // Trạng thái sống: thạch anh này có đang cấp xung cho chip không
        // (Issue 17) — vòng poll cập nhật ô này (xem updateInspectorCrystal).
        const wiredFreq = crystalFreqOf(state, comp.id);
        body = `<label class="bench-insp-label" for="inspXtalFreq">Tần số thạch anh</label>
          <select class="select" id="inspXtalFreq">${[4000000, 8000000, 20000000].map((f) => `<option value="${f}"${freq === f ? ' selected' : ''}>${f / 1e6} MHz</option>`).join('')}</select>
          <label class="bench-insp-label">Trạng thái (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Xung</span><span id="inspCrystalState">${wiredFreq ? 'Xung đang dùng: ' + (wiredFreq / 1e6) + ' MHz' : 'Chưa có thạch anh'}</span></div>
          </div>
          <p class="sub">Xung nhịp của chip lấy từ thạch anh này. Không có thạch anh thì chip không chạy. Thạch anh phải cắm đúng 2 strip OSC1/OSC2 của PIC thì mới cấp xung (đặt ở chỗ khác trên bàn thì không tính).</p>`;
      } else if (comp.type === 'sevenseg') {
        // Số đang hiện lấy từ bridge ngay lúc mở popup; vòng poll cập
        // nhật live 2 ô này (xem updateInspectorSeg), không vẽ lại popup.
        const b = bridge();
        const segs = b && typeof b.getSevenSegStates === 'function' ? b.getSevenSegStates() : null;
        const s = segs ? segs.find((x) => x.id === comp.id) : null;
        const digit = s ? sevenSegDigit(s.on) : null;
        const common = comp.props?.common === 'anode' ? 'anode' : 'cathode';
        body = `<label class="bench-insp-label" for="inspSegCommon">Chân chung</label>
          <select class="select" id="inspSegCommon">
            <option value="cathode"${common === 'cathode' ? ' selected' : ''}>Chung cathode (đoạn sáng khi mức 1, chung về GND)</option>
            <option value="anode"${common === 'anode' ? ' selected' : ''}>Chung anode (đoạn sáng khi mức 0, chung về VCC)</option>
          </select>
          <label class="bench-insp-label">Đang hiện</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Đang sáng</span><span id="inspSegOn">${esc(segOnText(s ? s.on : null))}</span></div>
            <div class="bench-conn"><span>Hiện số</span><span id="inspSegDigit">${digit === null ? '—' : esc(digit)}</span></div>
          </div>
          <p class="sub">Mỗi đoạn là 1 LED nối về chân chung: đoạn sáng khi đoạn và chân chung ở mức ngược nhau (xem chế độ chân chung ở trên). Số cập nhật live khi mạch hoặc chân PIC đổi trạng thái.</p>`;
      } else if (comp.type === 'keypad') {
        // Bàn phím 4x4: phím đang nhấn (live, vòng poll cập nhật ô này),
        // cách quét + ghi chú nối dây. Phím nhấn giữ trên panel 3D (bấm
        // vào phím vuông) thì hàng của nó nối với cột của nó.
        // Phím nhấn mà hàng/cột chưa nối tới chân PIC thì CPU không đọc
        // được — Inspector hiện ghi chú "chưa nối dây" thay vì "Đang
        // nhấn" (Issue 16). Vòng poll cập nhật ô này (xem
        // updateInspectorKeypad): có phím trong CPU thì hiện phím, đang
        // nhấn giữ mà CPU không thấy thì hiện ghi chú chưa nối dây.
        const b = bridge();
        const kps = b && typeof b.getKeypadState === 'function' ? b.getKeypadState() : null;
        const s = kps ? kps.find((x) => x.id === comp.id) : null;
        const mapping = b && typeof b.getMapping === 'function' ? b.getMapping() : null;
        const kpMap = mapping && mapping.keypads ? mapping.keypads.find((x) => x.id === comp.id) : null;
        const unwiredRows = kpMap ? kpMap.rows.map((p, i) => (p ? null : 'R' + i)).filter(Boolean) : [];
        const unwiredCols = kpMap ? kpMap.cols.map((p, i) => (p ? null : 'C' + i)).filter(Boolean) : [];
        const unwiredNote = (unwiredRows.length || unwiredCols.length)
          ? `Chưa nối dây: ${[...unwiredRows, ...unwiredCols].join(', ')} chưa tới chân PIC — phím dùng hàng/cột đó CPU không đọc được.`
          : '';
        const pressedHere = pressedKeypad && pressedKeypad.id === comp.id ? pressedKeypad : null;
        const pressedText = s
          ? 'Phím "' + esc(s.key) + '" (hàng ' + s.row + ', cột ' + s.col + ')'
          : pressedHere
            ? 'Đã nhấn phím "' + esc(KEYPAD_KEYS[pressedHere.row][pressedHere.col]) + '" nhưng chưa nối dây nên CPU không đọc được'
            : 'Không nhấn phím nào';
        body = `<label class="bench-insp-label">Đang nhấn</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Phím</span><span id="inspKeypadPressed">${pressedText}</span></div>
          </div>
          ${unwiredNote ? `<p class="sub">${esc(unwiredNote)}</p>` : ''}
          <p class="sub">Bấm giữ 1 phím vuông trên panel 3D để nhấn phím đó (nhả chuột thì nhả phím). Phím đang nhấn nối hàng của nó với cột của nó — CPU quét bằng cách lái từng hàng R0–R3 xuống 0 rồi đọc cột C0–C3 (cột có pull-up nên đọc 0 khi phím nhấn, 1 khi không nhấn). Nối 4 hàng tới chân PORT làm đầu ra, 4 cột tới chân PORT làm đầu vào.</p>`;
      } else if (comp.type === 'motor') {
        // Động cơ DC: điện áp/dòng/tốc độ live (vòng poll cập nhật 3 ô
        // này) + điện trở cuộn dây (đổi được). Tốc độ tỷ lệ với điện áp:
        // 20V = 1000 vòng/phút, 0V = 0, điện áp âm = quay ngược.
        const b = bridge();
        const motors = b && typeof b.getMotorState === 'function' ? b.getMotorState() : null;
        const m = motors ? motors.find((x) => x.id === comp.id) : null;
        body = `<label class="bench-insp-label">Số đo (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Điện áp</span><span id="inspMotorVolts">${m ? formatVolts(m.volts) : '—'}</span></div>
            <div class="bench-conn"><span>Dòng</span><span id="inspMotorAmps">${m ? formatAmps(m.amps) : '—'}</span></div>
            <div class="bench-conn"><span>Tốc độ (trung bình)</span><span id="inspMotorRpm">${m && m.rpm !== null && m.rpm !== undefined ? Math.round(m.rpm) + ' vòng/phút' : '—'}</span></div>
          </div>
          <label class="bench-insp-label" for="inspMotorVal">Điện trở cuộn dây (Ω)</label>
          <input class="input" id="inspMotorVal" type="number" min="1" max="10000" step="1" value="${comp.props?.value ?? 100}">
          <p class="sub">Động cơ là tải trở: dòng = điện áp / điện trở cuộn dây (mặc định 100Ω, 5V → 50mA). Tốc độ tỷ lệ với điện áp (20V = 1000 vòng/phút). Tốc độ hiện là trung bình trượt (EMA) theo điện áp tức thời — PWM thì hiện tốc độ trung bình theo duty cycle. Đấu qua chân PIC thì tốc độ theo mức chân; PWM (CCP) thì tốc độ theo điện áp trung bình (duty cycle). Nối 2 chân +/− tới nguồn hoặc chân PIC; đảo cực thì quay ngược.</p>`;
      } else if (comp.type === 'led') {
        // Ô chọn màu luôn hiện đúng màu thật của LED: nếu màu hiện tại
        // không nằm trong bảng màu (vd LED Lab 2 cũ màu #16A34A, hoặc
        // mạch đã lưu từ trước) thì thêm nó làm lựa chọn đang chọn, tránh
        // trình duyệt tự nhảy về lựa chọn đầu tiên (Đỏ) khi không có
        // option nào khớp.
        // Trạng thái sống (Issue 17): vòng poll cập nhật ô này (xem
        // updateInspectorLed) theo điện áp đã giải — sáng/tắt theo mạch
        // thật, không theo mức logic.
        const curLedColor = comp.props?.color || '#DC2626';
        const ledOpts = LED_COLORS.some((c) => c.value === curLedColor)
          ? LED_COLORS.map((c) => `<option value="${c.value}"${curLedColor === c.value ? ' selected' : ''}>${c.name}</option>`).join('')
          : `<option value="${curLedColor}" selected>Màu hiện tại (${curLedColor})</option>` + LED_COLORS.map((c) => `<option value="${c.value}">${c.name}</option>`).join('');
        const bLed = bridge();
        const ledStates = bLed && typeof bLed.getLedStates === 'function' ? bLed.getLedStates() : null;
        const ledSt = ledStates ? ledStates.find((x) => x.id === comp.id) : null;
        body = `<label class="bench-insp-label" for="inspLedColor">Màu LED</label>
          <select class="select" id="inspLedColor">${ledOpts}</select>
          <label class="bench-insp-label">Trạng thái (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>LED</span><span id="inspLedState">${ledSt ? (ledSt.on ? 'Đang sáng' : 'Tắt') : '—'}</span></div>
          </div>
          <p class="sub">LED sáng khi anode ở mức 1 và cathode về GND (hoặc mức 0).</p>`;
      } else if (comp.type === 'pot') {
        // Số volt wiper đọc từ SOLVER (điện áp thật của net chân VCC ×
        // pct), không tính (pct/100)*5: PSU 3V, núm 50% thì ~1,5V; chân
        // GND chưa nối thì wiper lơ lửng, hiện "—".
        // Ô nhập số (U2) bên cạnh thanh trượt: gõ số thì slider đổi theo,
        // kéo slider thì ô số đổi theo (đồng bộ 2 chiều, xem wiring bên
        // dưới). Thanh trượt một mình không gõ được số chính xác (vd 50%).
        const pct = comp.props?.pct ?? 0;
        const b = bridge();
        const wv = b && typeof b.getPotVolts === 'function' ? b.getPotVolts(comp.id) : null;
        body = `<label class="bench-insp-label" for="inspPotRange">Chiết áp — <span id="inspPotVal">${wv === null || wv === undefined ? '—' : wv.toFixed(2) + ' V'}</span></label>
          <input type="range" class="pot-slider" id="inspPotRange" min="0" max="100" step="1" value="${pct}">
          <label class="bench-insp-label" for="inspPotNum">Vị trí núm xoay (%)</label>
          <input class="input" id="inspPotNum" type="number" min="0" max="100" step="1" value="${pct}">
          <p class="sub">Wiper nối kênh AN nào thì ADC đọc điện áp đó (0 đến điện áp nguồn). Chân GND chưa nối thì wiper lơ lửng, ADC đọc 0.</p>`;
      } else if (comp.type === 'button') {
        // Trạng thái sống (Issue 17): vòng poll cập nhật ô này (xem
        // updateInspectorButton) theo nút đang nhấn giữ trên bàn.
        body = `<label class="bench-insp-label">Trạng thái (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Nút</span><span id="inspButtonState">${pressedBtn === comp.id ? 'Đang nhấn' : 'Thả'}</span></div>
          </div>
          <p class="sub">Nhấn giữ linh kiện trên bàn: nối 2 chân T1–T2 với nhau như công tắc (vd nối tiếp nguồn–LED qua nút thì nhấn mới sáng). Nếu 1 chân nối chân PIC thì nhấn kéo chân đó về mức 0 (active-low, có pull-up).</p>`;
      } else if (comp.type === 'lcd') {
        const b = bridge();
        const lcd = b && typeof b.getMapping === 'function' ? b.getMapping().lcd : null;
        // 2 dòng chữ đang hiện, cập nhật live (Issue 17): vòng poll cập
        // nhật 2 ô này (xem updateInspectorLcd) theo DDRAM của CPU.
        const lcdText = b && typeof b.getLcd === 'function' ? b.getLcd() : null;
        const line0 = lcdText && lcdText.lines ? lcdText.lines[0] : '';
        const line1 = lcdText && lcdText.lines ? lcdText.lines[1] : '';
        body = (lcd && lcd.id
          ? `<p class="sub">${lcd.complete ? 'LCD đã nối đủ dây, hiện chữ theo code.' : 'LCD chưa nối đủ dây — thiếu: ' + (lcd.missing.join(', ') || 'không rõ') + '.'}</p>`
          : `<p class="sub">LCD hiển thị 2 dòng 16 ký tự theo code (data + RS/E).</p>`)
          + `<label class="bench-insp-label">Đang hiện (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Dòng 1</span><span id="inspLcdLine0">${esc(line0 || '—')}</span></div>
            <div class="bench-conn"><span>Dòng 2</span><span id="inspLcdLine1">${esc(line1 || '—')}</span></div>
          </div>`;
      } else if (comp.type === 'buzzer') {
        const soundOn = comp.props?.sound !== false;
        // Trạng thái sống (Issue 17): vòng poll cập nhật ô này (xem
        // updateInspectorBuzzer) theo điện áp đã giải.
        const bBuz = bridge();
        const buzStates = bBuz && typeof bBuz.getBuzzerStates === 'function' ? bBuz.getBuzzerStates() : null;
        const buzSt = buzStates ? buzStates.find((x) => x.id === comp.id) : null;
        body = `<label class="bench-insp-row"><input type="checkbox" id="inspBuzzerSound"${soundOn ? ' checked' : ''}> Phát tiếng khi còi kêu</label>
          <label class="bench-insp-label">Trạng thái (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Còi</span><span id="inspBuzzerState">${buzSt ? (buzSt.on ? 'Đang kêu' : 'Không kêu') : '—'}</span></div>
          </div>
          <p class="sub">Còi kêu khi chân + ra mức 1 (chân PIC mức cao hoặc nối thẳng nguồn 0–10V) và chân − về GND.</p>`;
      } else if (comp.type === 'multimeter') {
        // Đồng hồ đo: chọn chế độ trong popup, đổi lúc nào cũng được.
        // Chế độ V: số đo áp (chữ cyan) + áp từng chân P/N. Chế độ A:
        // số đo dòng (chữ vàng) + chiều dòng P -> N.
        const b = bridge();
        const mode = meterMode(comp);
        const readings = b && typeof b.getMeterReadings === 'function' ? b.getMeterReadings() : null;
        const r = readings ? (mode === 'V'
          ? (readings.voltmeters || []).find((v) => v.id === comp.id)
          : (readings.ammeters || []).find((a) => a.id === comp.id)) : null;
        const valHtml = mode === 'V'
          ? `<div class="bench-meter-val vm" id="inspMeterVal">${r ? formatVolts(r.volts) : '—'}</div>
          <div class="bench-conns">
            <div class="bench-conn"><span>Chân P</span><span id="inspMeterVP">${r ? formatVolts(r.vP) : '—'}</span></div>
            <div class="bench-conn"><span>Chân N</span><span id="inspMeterVN">${r ? formatVolts(r.vN) : '—'}</span></div>
          </div>`
          : `<div class="bench-meter-val am" id="inspMeterVal">${r ? formatAmps(r.amps) : '—'}</div>
          <div class="bench-conns">
            <div class="bench-conn"><span>Chiều dòng</span><span id="inspMeterDir">${r ? formatCurrentDirection(r.amps) : '—'}</span></div>
          </div>`;
        body = `<label class="bench-insp-label">Chế độ đo</label>
          <div class="bench-meter-mode">
            <button type="button" class="btn btn-small${mode === 'V' ? ' btn-accent' : ''}" data-act="meter-mode" data-mode="V">Đo áp (V)</button>
            <button type="button" class="btn btn-small${mode === 'A' ? ' btn-accent' : ''}" data-act="meter-mode" data-mode="A">Đo dòng (A)</button>
          </div>
          <label class="bench-insp-label">Số đo</label>
          ${valHtml}
          <p class="sub">${mode === 'V'
            ? 'Đo hiệu điện áp giữa 2 chân (P − N). Trở kháng vô cùng nên không ảnh hưởng mạch. Chân nào chưa nối tới nguồn thì hiện "—".'
            : 'Đo dòng chạy qua nó (nối tiếp, 0Ω nên không ảnh hưởng mạch). Dòng dương chạy từ chân P sang N. Chập nguồn thì hiện "OL".'}
            Đổi chế độ là mạch đổi theo ngay (chế độ A nối 2 chân như dây, chế độ V ngắt ra). Số đo cập nhật live khi mạch hoặc chân PIC đổi trạng thái.</p>`;
      } else if (comp.type === 'oscilloscope') {
        // Đồng hồ hiện sóng 2 kênh: số đo live CH1/CH2 (mẫu mới nhất),
        // nút xóa sóng, ghi chú giới hạn lấy mẫu.
        const b = bridge();
        const data = b && typeof b.getScopeData === 'function' ? b.getScopeData() : null;
        const entry = data ? data.find((d) => d.id === comp.id) : null;
        const samples = entry ? entry.samples : [];
        const last = samples.length ? samples[samples.length - 1] : [null, null];
        body = `<label class="bench-insp-label">Số đo (mẫu mới nhất)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>CH1</span><span id="inspScopeCH1">${formatVolts(last[0])}</span></div>
            <div class="bench-conn"><span>CH2</span><span id="inspScopeCH2">${formatVolts(last[1])}</span></div>
          </div>
          <button type="button" class="btn btn-small" data-act="scope-clear">Xóa sóng</button>
          <p class="sub">Màn hình vẽ sóng CH1 (cyan) và CH2 (vàng) so với GND, thang −0,5..5,5V, cửa sổ 12 giây. Lấy mẫu 20 lần/giây nên tín hiệu nhanh hơn ~10Hz sẽ bị méo (giới hạn lấy mẫu, không phải lỗi mạch). Cọc nào chưa nối dây thì kênh đó hiện "—".</p>`;
      } else if (comp.type === 'serial') {
        // Màn hình Serial: gõ ký tự + Gửi (vào RCREG, đặt RCIF), log đã
        // nhận (live, vòng poll cập nhật), nút Xóa. Dữ liệu CHỈ chạy khi
        // đấu đúng dây (Issue 6): cọc TX nối PIC.RC6, cọc RX nối PIC.RC7,
        // cọc GND nối GND (UART cần chung mass, như mạch thật). Chưa nối
        // đủ thì CPU phát không hiện log, gõ Gửi cũng không vào CPU.
        // Trạng thái nối dây hiện ở dưới (vòng poll cập nhật).
        const b = bridge();
        const text = b && typeof b.getSerialText === 'function' ? (b.getSerialText(comp.id) || '') : '';
        const sw = b && typeof b.getSerialWiring === 'function' ? b.getSerialWiring(comp.id) : null;
        const wiringText = !sw ? '—'
          : `TX→RC6: ${sw.tx ? 'đã nối' : 'chưa nối'} · RX→RC7: ${sw.rx ? 'đã nối' : 'chưa nối'} · GND: ${sw.gnd ? 'đã nối' : 'chưa nối'}`;
        body = `<label class="bench-insp-label" for="inspSerialInput">Gửi tới PIC (nhập rồi bấm Gửi hoặc Enter)</label>
          <div class="bench-serial-send">
            <input class="input" id="inspSerialInput" type="text" autocomplete="off" spellcheck="false" placeholder="vd: A">
            <button type="button" class="btn btn-accent btn-small" data-act="serial-send">Gửi</button>
          </div>
          <label class="bench-insp-label">Đấu nối (live)</label>
          <div class="bench-conns">
            <div class="bench-conn"><span>Dây</span><span id="inspSerialWiring">${esc(wiringText)}</span></div>
          </div>
          <label class="bench-insp-label">Đã nhận từ PIC</label>
          <pre class="bench-serial-log" id="inspSerialLog">${esc(text)}</pre>
          <button type="button" class="btn btn-small" data-act="serial-clear">Xóa</button>
          <p class="sub">CPU phát ký tự qua TXREG (TXEN=1, SPEN=1) thì hiện ở đây (tối đa 4000 ký tự, hiện 8 dòng cuối trên màn hình 3D). Gõ rồi bấm Gửi thì từng ký tự vào RCREG (đặt cờ RCIF, ngắt nếu bật). Phải nối đủ TX→RC6, RX→RC7, GND→GND thì mới gửi/nhận được — chưa nối dây thì không gửi/nhận được (như mạch thật).</p>`;
      } else if (comp.type === 'pic') {
        // Tên đầu nối kề: chân PIC thì chỉ lấy tên chân (RB0), cọc
        // scope/Serial thì "cọc CH1 của OSC0" (Issue 13), chân linh kiện
        // khác (điện trở/tụ/thạch anh/đồng hồ) thì giữ nguyên id
        // (R0.L1, MM0.P...) để biết đang nối tới linh kiện nào.
        const fmtMember = (m) => {
          if (m.startsWith('PIC.')) return m.slice(4);
          const sp = parseScopePost(m);
          if (sp) return 'cọc ' + sp.term + ' của ' + sp.scopeId;
          const sr = parseSerialPost(m);
          if (sr) return 'cọc ' + sr.term + ' của ' + sr.serialId;
          return m;
        };
        const conns = legsFor(comp, state.size).map((l) => {
          const d = describeTerminal(state, l.term, pressedIds());
          const others = d.members.filter((m) => m !== l.term);
          if (!others.length && !d.vcc && !d.gnd) return null;
          const txt = [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map(fmtMember)].join(', ');
          return `<div class="bench-conn"><span>${l.term.slice(4)}</span><span>${esc(txt)}</span></div>`;
        }).filter(Boolean);
        const pa = parseHole(comp.anchor, state.size);
        const pc = pa ? pa.c : picCol(state.size);
        const rT = pa ? pa.r : picRows(state.size)[0];
        const rB = rT + 6;
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
      // Mục nối: đồng hồ đo / hiện sóng / màn hình Serial không đưa chân
      // vào netlist CPU (describeTerminal không thấy chân của nó) nên bỏ
      // qua — thông tin nối đã nằm trong mục số đo ở trên (áp từng chân /
      // chiều dòng / CH1/CH2 live / cọc TX/RX/GND). Không đưa chân scope/
      // Serial vào netlist: vừa tránh wiring.js thiếu định nghĩa loại này,
      // vừa tránh làm đứt chuỗi dây nối trong benchToNetlist (dây nối các
      // terminal liên tiếp trong cùng net, terminal lạ ở giữa sẽ chặn mạch).
      const skipConns = comp.type === 'multimeter' || comp.type === 'oscilloscope' || comp.type === 'serial';
      const conns = comp.type !== 'pic' && comp.type !== 'psu' && !skipConns
        ? `<div class="bench-conns">${legsFor(comp, state.size).map((l) => {
          const term = comp.id + '.' + l.term;
          const d = describeTerminal(state, term, pressedIds());
          const others = d.members.filter((m) => m !== term);
          const txt = others.length || d.vcc || d.gnd
            ? [...(d.vcc ? ['+5V'] : []), ...(d.gnd ? ['GND'] : []), ...others.map((m) => m.startsWith('PIC.') ? m.slice(4) : m)].join(', ')
            : 'chưa nối';
          return `<div class="bench-conn"><span>${l.term}</span><span>${esc(txt)}</span></div>`;
        }).join('')}</div>` : '';
      // Mục "Chân": từng chân cắm vào lỗ nào (chỉ đọc). PSU, hiện sóng và
      // màn hình Serial không có chân dạng lỗ nên bỏ qua. Chân treo ngoài
      // board (hole null) thì hiện "ngoài board". Tên chân bỏ tiền tố
      // 'PIC.' (PIC.RA0 -> RA0).
      const legs = (comp.type === 'psu' || comp.type === 'oscilloscope' || comp.type === 'serial') ? [] : legsFor(comp, state.size);
      const pins = legs.length ? `<label class="bench-insp-label">Chân</label><div class="bench-conns">${legs.map((l) => {
        const term = l.term.startsWith('PIC.') ? l.term.slice(4) : l.term;
        return `<div class="bench-conn"><span>${esc(term)}</span><span>${l.hole ? esc(holeName(l.hole)) : 'ngoài board'}</span></div>`;
      }).join('')}</div>` : '';
      // Mục "Cọc" (chỉ hiện sóng ngoài bàn): 3 cọc CH1/CH2/GND + trạng
      // thái nối dây của từng cọc (đầu dây kia, hoặc 'chưa nối dây').
      const posts = comp.type === 'oscilloscope' ? `<label class="bench-insp-label">Cọc</label><div class="bench-conns">${['CH1', 'CH2', 'GND'].map((term) => {
        const postId = comp.id + '.' + term;
        const w = state.wires.find((x) => x.a === postId || x.b === postId);
        const other = w ? (w.a === postId ? w.b : w.a) : null;
        return `<div class="bench-conn"><span>${term}</span><span>${other ? esc(holeName(other)) : 'chưa nối dây'}</span></div>`;
      }).join('')}</div>` : comp.type === 'serial' ? `<label class="bench-insp-label">Cọc</label><div class="bench-conns">${['TX', 'RX', 'GND'].map((term) => {
        const postId = comp.id + '.' + term;
        const w = state.wires.find((x) => x.a === postId || x.b === postId);
        const other = w ? (w.a === postId ? w.b : w.a) : null;
        return `<div class="bench-conn"><span>${term}</span><span>${other ? esc(holeName(other)) : 'chưa nối dây'}</span></div>`;
      }).join('')}</div>` : '';
      const canDelete = comp.type !== 'pic' && comp.type !== 'psu';
      inspectorEl.innerHTML = `
        <div class="bench-insp-head"><div><strong>${esc(compLabel(comp))}</strong><div class="bench-insp-pos">${esc(pos)}</div></div>
        <button type="button" class="bench-insp-close" data-act="close" aria-label="Đóng">×</button></div>
        <div class="bench-insp-body">${body}${conns}${pins}${posts}</div>
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
      const capInput = inspectorEl.querySelector('#inspCapVal');
      if (capInput) capInput.addEventListener('change', () => {
        const v = Math.round(Number(capInput.value));
        if (v >= 1) {
          comp.props = { ...(comp.props || {}), value: v };
          save(); syncToCpu(); renderInspector();
          setStatus('Đã đổi ' + compLabel(comp) + ' thành ' + v + 'pF.');
        } else { capInput.value = comp.props?.value ?? 22; }
      });
      const xtalSel = inspectorEl.querySelector('#inspXtalFreq');
      if (xtalSel) xtalSel.addEventListener('change', () => {
        const f = Number(xtalSel.value);
        if (![4000000, 8000000, 20000000].includes(f)) { xtalSel.value = comp.props?.freq ?? 4000000; return; }
        comp.props = { ...(comp.props || {}), freq: f };
        save(); syncToCpu(); renderInspector();
        setStatus('Đã đổi ' + compLabel(comp) + ' thành ' + (f / 1e6) + ' MHz — nạp lại chương trình để áp dụng xung mới.');
      });
      const segSel = inspectorEl.querySelector('#inspSegCommon');
      if (segSel) segSel.addEventListener('change', () => {
        const common = segSel.value === 'anode' ? 'anode' : 'cathode';
        comp.props = { ...(comp.props || {}), common };
        save(); syncToCpu(); renderInspector();
        setStatus('Đã đổi ' + compLabel(comp) + ' sang chung ' + common + '.');
      });
      const ledSel = inspectorEl.querySelector('#inspLedColor');
      if (ledSel) ledSel.addEventListener('change', () => {
        comp.props = { ...(comp.props || {}), color: ledSel.value };
        save(); rebuildAll(); renderInspector();
        setStatus('Đã đổi màu LED.');
      });
      const potRange = inspectorEl.querySelector('#inspPotRange');
      const potNum = inspectorEl.querySelector('#inspPotNum');
      // Đặt lại núm xoay (dùng chung cho slider + ô nhập số): đổi props,
      // áp vào CPU qua bridge, hiện lại số volt theo solver.
      const applyPotPct = (pctRaw) => {
        let pct = Math.round(Number(pctRaw));
        if (!Number.isFinite(pct)) pct = comp.props?.pct ?? 0;
        pct = Math.max(0, Math.min(100, pct));
        comp.props = { ...(comp.props || {}), pct };
        const b = bridge();
        if (b && typeof b.setPot === 'function') b.setPot(comp.id, pct);
        if (potRange) potRange.value = String(pct);
        if (potNum) potNum.value = String(pct);
        const valEl = inspectorEl.querySelector('#inspPotVal');
        if (valEl) {
          const wv = b && typeof b.getPotVolts === 'function' ? b.getPotVolts(comp.id) : null;
          valEl.textContent = (wv === null || wv === undefined) ? '—' : wv.toFixed(2) + ' V';
        }
        return pct;
      };
      if (potRange) {
        potRange.addEventListener('input', () => {
          applyPotPct(potRange.value);
        });
        potRange.addEventListener('change', () => save());
      }
      // Ô nhập số (U2): gõ số (vd 50) thì slider đổi theo; số ngoài
      // 0–100 thì kẹp lại 0–100. Đổi xong mới lưu (change), như slider.
      if (potNum) {
        potNum.addEventListener('change', () => {
          applyPotPct(potNum.value);
          save();
        });
        potNum.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); applyPotPct(potNum.value); save(); }
          e.stopPropagation();
        });
      }
      const buzzerSound = inspectorEl.querySelector('#inspBuzzerSound');
      if (buzzerSound) buzzerSound.addEventListener('change', () => {
        comp.props = { ...(comp.props || {}), sound: buzzerSound.checked };
        save();
        setStatus(buzzerSound.checked ? 'Đã bật tiếng còi.' : 'Đã tắt tiếng còi (còi vẫn sáng khi kêu).');
      });
      // Đồng hồ đo: bấm nút chế độ thì đổi mode + vẽ lại bàn (chế độ A
      // nối 2 chân như dây, chế độ V ngắt ra — mạch/CPU đổi theo) rồi
      // mở lại Inspector ở chế độ mới. Không cần đặt lại linh kiện.
      inspectorEl.querySelectorAll('[data-act="meter-mode"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode === 'A' ? 'A' : 'V';
          if (meterMode(comp) === mode) return;
          comp.props = { ...(comp.props || {}), mode };
          save(); rebuildAll(); renderInspector(); syncToCpu();
          setStatus('Đã đổi ' + compLabel(comp) + ' sang chế độ đo ' + (mode === 'V' ? 'áp (V)' : 'dòng (A)') + '.');
        });
      });
      // Đồng hồ hiện sóng: bấm "Xóa sóng" thì xóa bộ nhớ vòng trong
      // app.js, vẽ lại màn hình rỗng ngay (không chờ vòng poll) và mở
      // lại Inspector (2 ô CH1/CH2 về "—").
      inspectorEl.querySelector('[data-act="scope-clear"]')?.addEventListener('click', () => {
        const b = bridge();
        if (b && typeof b.clearScope === 'function') b.clearScope(comp.id);
        const t = scopeTexs.get(comp.id);
        if (t) { t.last = ''; drawScopeWaveform(t, []); }
        renderInspector();
        setStatus('Đã xóa sóng ' + compLabel(comp) + '.');
      });
      // Động cơ DC: đổi điện trở cuộn dây trong popup (1–10000Ω). Đổi
      // xong thì đồng bộ lại solver (dòng/tốc độ đổi theo) + vẽ lại
      // Inspector (3 ô live về giá trị mới).
      const motorInput = inspectorEl.querySelector('#inspMotorVal');
      if (motorInput) motorInput.addEventListener('change', () => {
        const v = Math.round(Number(motorInput.value));
        if (v >= 1 && v <= 10000) {
          comp.props = { ...(comp.props || {}), value: v };
          save(); syncToCpu(); renderInspector();
          setStatus('Đã đổi ' + compLabel(comp) + ' thành ' + v + 'Ω.');
        } else { motorInput.value = comp.props?.value ?? 100; }
      });
      // Màn hình Serial: bấm "Gửi" (hoặc Enter trong ô nhập) thì gửi
      // từng ký tự vào CPU qua receiveChar (vào RCREG, đặt RCIF). Gửi
      // xong thì xóa ô nhập (log đã nhận vẫn giữ). Bấm "Xóa" thì xóa log
      // đã nhận + vẽ lại màn hình 3D rỗng ngay.
      const serialSend = () => {
        const inp = inspectorEl.querySelector('#inspSerialInput');
        if (!inp) return;
        const text = inp.value;
        if (!text) return;
        const b = bridge();
        let sent = 0;
        if (b && typeof b.sendSerial === 'function') sent = b.sendSerial(comp.id, text) || 0;
        if (sent > 0) {
          inp.value = '';
          setStatus('Đã gửi ' + sent + ' ký tự tới PIC.');
        } else {
          // Gửi 0 ký tự: hoặc toàn ký tự không phải ASCII, hoặc màn hình
          // chưa nối dây RX/GND (Issue 6) — báo rõ để nối dây lại.
          const sw = b && typeof b.getSerialWiring === 'function' ? b.getSerialWiring(comp.id) : null;
          if (sw && (!sw.rx || !sw.gnd)) {
            setStatus('Chưa gửi được — màn hình chưa nối dây: nối cọc RX→RC7 và cọc GND→GND thì mới gửi vào PIC được.');
          } else {
            setStatus('Không gửi được (chỉ gửi ký tự ASCII).');
          }
        }
      };
      inspectorEl.querySelector('[data-act="serial-send"]')?.addEventListener('click', serialSend);
      const serialInput = inspectorEl.querySelector('#inspSerialInput');
      if (serialInput) serialInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); serialSend(); }
        e.stopPropagation();
      });
      inspectorEl.querySelector('[data-act="serial-clear"]')?.addEventListener('click', () => {
        const b = bridge();
        if (b && typeof b.clearSerial === 'function') b.clearSerial(comp.id);
        const t = serialTexs.get(comp.id);
        if (t) { t.last = ''; drawSerialScreen(t, ''); }
        renderInspector();
        setStatus('Đã xóa log ' + compLabel(comp) + '.');
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
      const sp = parseScopePost(e);
      if (sp) return 'cọc ' + sp.term + ' của ' + sp.scopeId;
      const sr = parseSerialPost(e);
      if (sr) return 'cọc ' + sr.term + ' của ' + sr.serialId;
      return e;
    }
    if (e && typeof e.x === 'number') return 'cọc nguồn';
    return '?';
  }
  // Thường hoá địa chỉ người dùng gõ: trim, chữ hàng về thường
  // ('C12' -> 'c12', 'AA12' -> 'aa12'), chữ rail về hoa ('t+5' -> 'T+5'),
  // cọc nguồn về dạng chuẩn ('psu1.+' -> 'PSU1.+'), cọc hiện sóng về dạng
  // chuẩn ('osc1.ch1' -> 'OSC1.CH1'), cọc Serial về dạng chuẩn
  // ('ser0.tx' -> 'SER0.TX').
  function normalizeHoleInput(v) {
    const s = String(v || '').trim();
    let m = s.match(/^([a-zA-Z]+)(\d+)$/);
    if (m) return m[1].toLowerCase() + m[2];
    m = s.match(/^([tTbB])([+-])(\d+)$/);
    if (m) return m[1].toUpperCase() + m[2] + m[3];
    m = s.match(/^psu(\d+)\.([+-])$/i);
    if (m) return 'PSU' + m[1] + '.' + m[2];
    m = s.match(/^osc(\d+)\.(ch1|ch2|gnd)$/i);
    if (m) return 'OSC' + m[1] + '.' + m[2].toUpperCase();
    m = s.match(/^ser(\d+)\.(tx|rx|gnd)$/i);
    if (m) return 'SER' + m[1] + '.' + m[2].toUpperCase();
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
      const newR = clamp(oldR * Math.exp(e.deltaY * 0.001), 60, 900);
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
      const z = py(rowZ(r, rows));
      ctx.fillText(rowLabel(r), px(-bodyW / 2 + 2.6), z);
      ctx.fillText(rowLabel(r), px(bodyW / 2 - 2.6), z);
    }
    if (railColsOf(size) > 0) {
      // Dấu +/− của rail: T+ và B+ là +, T− và B− là −.
      const railZ = (r) => py(rowZ(r, rows));
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
    // không bao giờ che được lỗ. Màu #64748B đậm (thay #CBD5E1 mờ) + rộng
    // 1.5mm để nhìn rõ ranh giới đoạn, tránh nhầm khi kéo linh kiện qua đoạn.
    ctx.fillStyle = '#64748B';
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
        strip.position.set(((rc + 1) / 2 - (cols + 1) / 2) * PITCH, BOARD_TOP + 0.08, rowZ(r, rows));
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
  // Chân kim loại cắm lỗ: cao 7mm (mặc định) để CHỒNG vào thân/dây nối ít
  // nhất 0.5mm, nhìn ngang không còn thấy khe hở. Chân 5.5mm cũ chỉ chạm
  // mép (LED/nút đáy thân y=5.5) và hở 0.55mm với dây nối điện trở (đáy
  // y=6.05) nên linh kiện nhìn như lơ lửng. Chân ở x ngoài thân (điện trở
  // x=0/x=10.16) chỉ nối qua dây ngang nên càng cần chồng vào dây.
  function legMesh(x, z, h = 7) {
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
      // Thân chip + 40 chân cắm vào lỗ, theo lỗ neo của chip (không căn
      // giữa lại theo size — đổi size board không dời chip).
      // Chân treo ngoài board (Mini 170) vẫn vẽ nhưng nhô lên khỏi mặt board.
      // Thân chip nằm giữa 2 hàng chân (z = điểm giữa 2 hàng chân).
      const cols = colsOf(state.size);
      const rows = rowsOf(state.size);
      const pa = parseHole(comp.anchor, state.size);
      const rT = pa ? pa.r : picRows(state.size)[0];
      const rB = rT + 6;
      const c0 = pa ? pa.c : picCol(state.size);
      // Thân chip nằm giữa 2 hàng chân theo tọa độ Z thật (có khe hở đoạn);
      // sâu thân tính từ 2 hàng chân neo, không dùng picRows theo size.
      const chipZ = (rowZ(rT, rows) + rowZ(rB, rows)) / 2;
      const cx = (c0 + 9.5 - (cols + 1) / 2) * PITCH;
      const body = new THREE.Mesh(new THREE.BoxGeometry(52.5, 4.5, picBodyDepthForRows(rT, rB, rows)), stdMat(0x0F172A, { roughness: 0.4 }));
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
      dot.position.set(cx - 24.13, BOARD_TOP + 8.5, rowZ(rT, rows));
      g.add(dot);
      const pinMat = stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 });
      const chipLegs = picLegsForAnchor(comp.anchor, state.size);
      for (const leg of (chipLegs.length ? chipLegs : picLegs(state.size))) {
        const px = (leg.c - (cols + 1) / 2) * PITCH;
        const pz = rowZ(leg.r, rows);
        const pin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.5, 0.7), pinMat);
        // Chân không có lỗ (treo ngoài board) nhô lên để nhìn rõ là chưa cắm.
        pin.position.set(px, BOARD_TOP + (leg.hole ? 2.2 : 4.6), pz);
        g.add(pin);
      }
      return g;
    }
    if (comp.type === 'psu') {
      // Hộp nguồn đặt trên mặt bàn, mặt trước quay về phía breadboard.
      // Thu nhỏ toàn bộ khối nguồn còn một nửa (PSU_SCALE = 0.5): gốc
      // group ở mặt bàn (y=0) nên đáy hộp vẫn chạm bàn sau khi scale;
      // thân hộp còn 60×35×40, cọc/màn hình/núm bắt thu theo đúng tỉ lệ.
      g.position.set(comp.tx, 0, comp.tz);
      g.scale.set(PSU_SCALE, PSU_SCALE, PSU_SCALE);
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
    if (comp.type === 'oscilloscope') {
      // Đồng hồ hiện sóng NGOÀI BÀN (như khối nguồn): ngồi trên mặt bàn,
      // không anchor, không chân lỗ. Thân máy 100×60×50 (mm), màn hình
      // ĐỨNG ở mặt trước (plane 80×42, canvas 512×288), 3 cọc CH1/CH2/GND
      // ở mặt trước dưới màn hình. Màn hình vẽ bằng cùng tọa độ 256×144
      // cũ: ctx đã scale(2,2) ngay khi tạo nên drawScopeWaveform không
      // cần đổi logic vẽ (fillRect(0,0,256,144) phủ kín canvas 512×288).
      g.position.set(comp.tx, 0, comp.tz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(100, 60, 50), stdMat(0x1E3A5F, { roughness: 0.5 }));
      body.position.y = 30;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 288;
      const ctx = cv.getContext('2d');
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 42),
        new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.set(0, 34, 25.2);
      g.add(screen);
      const t = { canvas: cv, ctx, tex, last: '' };
      scopeTexs.set(comp.id, t);
      drawScopeWaveform(t, []);
      // 3 cọc ở mặt trước dưới màn hình (CH1 cyan, CH2 vàng, GND tối),
      // mỗi cọc có núm bắt vô hình (sphere r=8) để bấm nối dây (pickScopePost).
      for (const [term, dx, col] of [['CH1', -SCOPE_POST_DX, 0x7DD3FC], ['CH2', 0, 0xFBBF24], ['GND', SCOPE_POST_DX, 0x0F172A]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 8, 16), stdMat(col));
        post.rotation.x = Math.PI / 2;
        post.position.set(dx, SCOPE_POST_Y, SCOPE_POST_DZ);
        g.add(post);
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(8, 10, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.set(dx, SCOPE_POST_Y, SCOPE_POST_DZ);
        hit.userData = { scopePostId: comp.id + '.' + term };
        g.add(hit);
        scopeHitMeshes.push(hit);
      }
      return g;
    }
    if (comp.type === 'serial') {
      // Màn hình Serial NGOÀI BÀN (như đồng hồ hiện sóng): ngồi trên mặt
      // bàn, không anchor, không chân lỗ. Thân máy 100×60×50 (mm), màn
      // hình ĐỨNG ở mặt trước (plane 80×42, canvas 512×288), 3 cọc
      // TX/RX/GND ở mặt trước dưới màn hình. Màn hình vẽ bằng cùng tọa
      // độ 256×144 cũ (ctx đã scale(2,2) ngay khi tạo nên drawSerialScreen
      // không cần đổi logic vẽ). Dữ liệu chạy qua CPU (onTx/receiveChar),
      // dây/cọc chỉ để mạch trông đầy đủ (TX->RC6, RX->RC7, GND->GND).
      g.position.set(comp.tx, 0, comp.tz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(100, 60, 50), stdMat(0x1E3A5F, { roughness: 0.5 }));
      body.position.y = 30;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 288;
      const ctx = cv.getContext('2d');
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 42),
        new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.set(0, 34, 25.2);
      g.add(screen);
      const t = { canvas: cv, ctx, tex, last: '' };
      serialTexs.set(comp.id, t);
      drawSerialScreen(t, '');
      // 3 cọc ở mặt trước dưới màn hình (TX xanh lá, RX vàng, GND tối),
      // mỗi cọc có núm bắt vô hình (sphere r=8) để bấm nối dây (pickSerialPost).
      for (const [term, dx, col] of [['TX', -SERIAL_POST_DX, 0x4ADE80], ['RX', 0, 0xFBBF24], ['GND', SERIAL_POST_DX, 0x0F172A]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 8, 16), stdMat(col));
        post.rotation.x = Math.PI / 2;
        post.position.set(dx, SERIAL_POST_Y, SERIAL_POST_DZ);
        g.add(post);
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(8, 10, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.set(dx, SERIAL_POST_Y, SERIAL_POST_DZ);
        hit.userData = { serialPostId: comp.id + '.' + term };
        g.add(hit);
        serialHitMeshes.push(hit);
      }
      return g;
    }
    // Linh kiện cắm lỗ: gốc nhóm ở lỗ neo, chân theo legOffsets.
    // Chân kim loại phải rơi đúng lỗ: khoảng cách Z theo hàng dùng rowZ
    // (linh kiện xoay mà chân qua ranh giới đoạn thì 2 chân cách 5.08mm,
    // không phải 2.54mm). Thân linh kiện vẽ theo local, không xoay theo khe.
    const anchor = holePos(comp.anchor, state.size);
    const anchorPa = parseHole(comp.anchor, state.size);
    const anchorR = anchorPa ? anchorPa.r : 0;
    const compRows = rowsOf(state.size);
    g.position.set(anchor.x, BOARD_TOP, anchor.z);
    g.rotation.y = -((comp.rot || 0) * Math.PI) / 2;
    const offs = legOffsets(comp.type, comp.rot || 0);
    // Đồng hồ (đo và hiện sóng): hộp đáy y=8 (cao hơn các linh kiện khác)
    // nên chân phải dài 9mm mới chồng 1mm vào thân; các loại khác chân
    // 7mm là đủ (xem legMesh). Chân chui vào trong thân là bình thường,
    // không chọc xuyên qua đỉnh linh kiện nào (thân thấp nhất là điện
    // trở, đỉnh y=7.65, mà chân điện trở ở x=0/x=10.16 nằm ngoài thân).
    const legH = comp.type === 'multimeter' ? 9 : 7;
    for (const o of offs) g.add(legMesh(o.dc * PITCH, rowZ(anchorR + o.dr, compRows) - rowZ(anchorR, compRows), legH));
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
    } else if (comp.type === 'multimeter') {
      // Đồng hồ số: hộp navy 20×6×12, đáy y=8, đỉnh y=14. Chân kim loại
      // dài 9mm (xem vòng legOffsets phía trên) chui 1mm vào đáy hộp nên
      // nhìn ngang không hở. Màn hình nằm ngửa trên nóc, 2 chấm màu ở mặt
      // trước đánh dấu cực (đỏ = chân P, tối = chân N). Màu chữ màn hình
      // theo chế độ đo: cyan khi đo áp (V), vàng hổ phách khi đo dòng (A).
      // Chân kim loại đã thêm ở vòng legOffsets phía trên (2 chân cách
      // nhau 4 cột, dùng rowZ).
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 12), stdMat(0x1E3A5F, { roughness: 0.5 }));
      body.position.set(5.08, 11, 0);
      body.castShadow = true;
      g.add(body);
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 144;
      const tex = new THREE.CanvasTexture(cv);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 9),
        new THREE.MeshBasicMaterial({ map: tex }));
      screen.rotation.x = -Math.PI / 2;
      screen.position.set(5.08, 14.15, 0);
      g.add(screen);
      const t = { canvas: cv, ctx: cv.getContext('2d'), tex, last: '', mode: meterMode(comp) };
      meterTexs.set(comp.id, t);
      drawMeterTexture(t, '—');
      const dotR = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 12), stdMat(0xDC2626));
      dotR.rotation.x = Math.PI / 2;
      dotR.position.set(1.27, 11, 6.15);
      g.add(dotR);
      const dotB = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 12), stdMat(0x0F172A));
      dotB.rotation.x = Math.PI / 2;
      dotB.position.set(8.89, 11, 6.15);
      g.add(dotB);
    } else if (comp.type === 'capacitor') {
      // Tụ gốm: đĩa tròn đứng trên cạnh giữa 2 chân (như bánh xe nhỏ),
      // màu nâu vàng gốm. Chân đã vẽ ở vòng legOffsets phía trên.
      // Đĩa phải đủ lớn để chạm cả 2 chân: 2 chân cách nhau 4 cột =
      // 10,16mm nên bán kính 5,5mm (đường kính 11mm) để chân cắm vào
      // mép đĩa; bán kính 3mm cũ để đĩa lơ lửng giữa 2 chân, không chạm.
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 1.5, 24), stdMat(0xD9A066));
      disc.rotation.x = Math.PI / 2;
      disc.position.set(5.08, 8, 0);
      disc.castShadow = true;
      g.add(disc);
    } else if (comp.type === 'crystal') {
      // Thạch anh HC-49/U: vỏ kim loại bạc nằm ngang dọc theo cột, dài
      // 11mm, đường kính 4,5mm, ôm trên 2 chân cách nhau 1 cột. Chân đã
      // vẽ ở vòng legOffsets phía trên.
      const can = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 11, 16), stdMat(0xCBD5E1, { metalness: 0.8, roughness: 0.3 }));
      can.rotation.z = Math.PI / 2;
      can.position.set(1.27, 8, 0);
      can.castShadow = true;
      g.add(can);
    } else if (comp.type === 'sevenseg') {
      // LED 7 thanh: thân chữ nhật tối, mặt trên có 7 đoạn + chấm thập
      // phân, mỗi đoạn là 1 mesh riêng với material phát sáng riêng để
      // vòng poll bật/tắt từng đoạn (như LED). Vị trí thân + đoạn tính
      // từ chính offs của chân (cùng khung local với vòng legOffsets
      // phía trên) nên thân luôn ôm đúng 2 hàng chân ở mọi góc xoay;
      // chân cao 7mm, đáy thân ở y=6 nên chân vẫn lộ 6mm dưới thân
      // (như đồng hồ đo chui 1mm vào thân).
      const zOf = (dr) => rowZ(anchorR + dr, compRows) - rowZ(anchorR, compRows);
      const posOf = (o) => ({ x: o.dc * PITCH, z: zOf(o.dr) });
      const xs = offs.map((o) => o.dc * PITCH), zs = offs.map((o) => zOf(o.dr));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(...xs) - Math.min(...xs) + 2.5, 6, Math.max(...zs) - Math.min(...zs) + 2.5),
        stdMat(0x1F2937, { roughness: 0.5 }));
      body.position.set(cx, 9, cz);
      body.castShadow = true;
      g.add(body);
      // Hướng đoạn: u = dọc hàng chân trên (a -> dp), v = từ hàng trên
      // xuống hàng dưới (a -> e). Đoạn ngang dài theo u, đoạn dọc dài
      // theo v; góc xoay của mesh tính từ hướng đó nên đúng ở mọi rot.
      const aOff = offs.find((o) => o.term === 'a');
      const dpOff = offs.find((o) => o.term === 'dp');
      const eOff = offs.find((o) => o.term === 'e');
      const aPos = aOff ? posOf(aOff) : { x: 0, z: 0 };
      const u = dpOff ? { x: posOf(dpOff).x - aPos.x, z: posOf(dpOff).z - aPos.z } : { x: 10.16, z: 0 };
      const v = eOff ? { x: posOf(eOff).x - aPos.x, z: posOf(eOff).z - aPos.z } : { x: 0, z: 15.24 };
      const segY = 12.35;
      const mats = {};
      const mkSeg = (term, fu, fv, len, dir) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x7F1D1D, emissive: new THREE.Color(0xDC2626), emissiveIntensity: 0.12, roughness: 0.3 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 1.8), mat);
        m.position.set(aPos.x + u.x * fu + v.x * fv, segY, aPos.z + u.z * fu + v.z * fv);
        // Xoay mesh để cạnh dài (+x local) trùng hướng dir.
        m.rotation.y = Math.atan2(-dir.z, dir.x);
        g.add(m);
        mats[term] = mat;
      };
      // a trên cùng, g giữa, d dưới cùng (ngang, dài theo u); f/b trên,
      // e/c dưới (dọc, dài theo v); dp là chấm tròn góc dưới-phải.
      mkSeg('a', 0.5, 0.1, 7, u);
      mkSeg('g', 0.5, 0.5, 7, u);
      mkSeg('d', 0.5, 0.9, 7, u);
      mkSeg('f', 0.12, 0.3, 5, v);
      mkSeg('b', 0.88, 0.3, 5, v);
      mkSeg('e', 0.12, 0.7, 5, v);
      mkSeg('c', 0.88, 0.7, 5, v);
      const dpMat = new THREE.MeshStandardMaterial({ color: 0x7F1D1D, emissive: new THREE.Color(0xDC2626), emissiveIntensity: 0.12, roughness: 0.3 });
      const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 12), dpMat);
      dp.position.set(aPos.x + u.x * 1.0 + v.x * 0.88, segY, aPos.z + u.z * 1.0 + v.z * 0.88);
      g.add(dp);
      mats.dp = dpMat;
      segMats.set(comp.id, mats);
    } else if (comp.type === 'keypad') {
      // Bàn phím ma trận 4x4: panel tối phẳng ôm 2 hàng chân (R0–R3 ở
      // hàng trên, C0–C3 ở hàng dưới, cách nhau 5 hàng), trên mặt panel
      // có 16 phím vuông 4×4, mỗi phím là 1 mesh riêng (để tô sáng /
      // nhấn xuống khi bấm). Vị trí panel + phím tính từ chính offs của
      // chân (cùng khung local với vòng legOffsets phía trên) nên panel
      // luôn ôm đúng 2 hàng chân ở mọi góc xoay.
      const zOf = (dr) => rowZ(anchorR + dr, compRows) - rowZ(anchorR, compRows);
      const xs = offs.map((o) => o.dc * PITCH), zs = offs.map((o) => zOf(o.dr));
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(maxX - minX + 4, 3, maxZ - minZ + 4),
        stdMat(0x1F2937, { roughness: 0.5 }));
      body.position.set((minX + maxX) / 2, 7.5, (minZ + maxZ) / 2);
      body.castShadow = true;
      g.add(body);
      // 16 phím: hàng 0..3 (R0–R3) từ trên xuống, cột 0..3 (C0–C3) từ
      // trái sang. Mỗi phím 1.8×1×1.8mm, cách nhau đều trên mặt panel
      // (y=9.5). userData ghi {keypadId, row, col} để bấm phím trong 3D
      // (xem pickKeypadKey) và để vòng poll tô sáng phím đang nhấn.
      const keyMeshes = {};
      const keyMat = (row, col) => new THREE.MeshStandardMaterial({
        color: 0x334155, emissive: new THREE.Color(0x059669), emissiveIntensity: 0, roughness: 0.4,
      });
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const mat = keyMat(row, col);
          const key = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8), mat);
          const fx = minX + 1 + ((maxX - minX - 2) * col) / 3;
          const fz = minZ + 1 + ((maxZ - minZ - 2) * row) / 3;
          key.position.set(fx, 9.5, fz);
          key.castShadow = true;
          key.userData = { keypadId: comp.id, row, col, key: KEYPAD_KEYS[row][col], baseY: 9.5 };
          g.add(key);
          keyMeshes[row + ',' + col] = { mesh: key, mat };
        }
      }
      keypadKeyMeshes.set(comp.id, keyMeshes);
    } else if (comp.type === 'motor') {
      // Động cơ DC: thân trụ đứng (bán kính 6mm, cao 10mm) + trục + cánh
      // quạt 3 cánh trên đỉnh. Trục quay quanh trục Y (quạt nằm ngang
      // trên đỉnh, quay như cánh quạt thật). Cánh quạt là 1 group riêng
      // (motorFans) để vòng poll xoay theo rpm. Thân nằm giữa 2 chân
      // (x=1.27mm, z=0), chân cao 7mm, đáy thân ở y=6.
      const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 10, 20), stdMat(0x64748B, { metalness: 0.4, roughness: 0.5 }));
      body.position.set(1.27, 11, 0);
      body.castShadow = true;
      g.add(body);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 4, 12), stdMat(0xCBD5E1, { metalness: 0.7, roughness: 0.35 }));
      shaft.position.set(1.27, 17.5, 0);
      g.add(shaft);
      const fan = new THREE.Group();
      fan.position.set(1.27, 19.5, 0);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 2.2), stdMat(0xDC2626, { roughness: 0.4 }));
        blade.position.x = 3.2;
        blade.castShadow = true;
        const arm = new THREE.Group();
        arm.rotation.y = (i * 2 * Math.PI) / 3;
        arm.add(blade);
        fan.add(arm);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.2, 12), stdMat(0x0F172A));
      fan.add(hub);
      g.add(fan);
      motorFans.set(comp.id, { fan, angle: 0, rpm: 0 });
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
    // Chữ to hơn trước (52px -> 60px) để bù cho việc khối nguồn thu nhỏ 50%
    // (màn hình còn 26×10mm): chữ vẫn đọc được trên màn hình nhỏ.
    ctx.font = '700 60px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number(volts).toFixed(2), 108, 48);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 30px "Fira Code", monospace';
    ctx.fillText('V', 220, 48);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  // Vẽ số đo lên màn hình đồng hồ (CanvasTexture). Chỉ gọi khi chuỗi số
  // đổi (vòng poll so sánh với t.last), không vẽ lại mỗi frame.
  // Chữ xanh cyan khi đo áp (V), vàng hổ phách khi đo dòng (A) — đổi
  // chế độ trong popup thì màu màn hình đổi theo. Chữ co lại nếu dài
  // quá màn hình (vd "-12.34 V").
  function drawMeterTexture(t, text) {
    const ctx = t.ctx;
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 256, 144);
    ctx.fillStyle = t.mode === 'A' ? '#FBBF24' : '#7DD3FC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 56;
    ctx.font = '700 ' + size + 'px "Fira Code", monospace';
    while (ctx.measureText(text).width > 236 && size > 24) {
      size -= 4;
      ctx.font = '700 ' + size + 'px "Fira Code", monospace';
    }
    ctx.fillText(text, 128, 76);
    t.tex.needsUpdate = true;
  }
  // Vẽ sóng 2 kênh lên màn hình đồng hồ hiện sóng (canvas 256×144).
  // Thang áp CỐ ĐỊNH −0,5..5,5V (lưới ngang mỗi 1V) vì tín hiệu PIC là
  // 0–5V; trục thời gian là bộ nhớ vòng 240 mẫu × 50ms = 12 giây, mẫu
  // mới nhất ở mép phải (roll mode). Mẫu null (kênh floating) thì ngắt
  // đường vẽ, để khoảng trống chứ không vẽ bừa 0V. Chỉ gọi khi key mẫu
  // đổi (vòng poll so sánh với t.last), không vẽ lại mỗi lần hẹn giờ.
  const SCOPE_V_MIN = -0.5, SCOPE_V_MAX = 5.5, SCOPE_GRID_TOP = 16, SCOPE_GRID_BOTTOM = 128;
  function drawScopeWaveform(t, samples) {
    const ctx = t.ctx;
    const W = 256;
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, W, 144);
    const yOf = (v) => SCOPE_GRID_BOTTOM - ((v - SCOPE_V_MIN) / (SCOPE_V_MAX - SCOPE_V_MIN)) * (SCOPE_GRID_BOTTOM - SCOPE_GRID_TOP);
    // Lưới mờ: ngang mỗi 1V, dọc mỗi 24 mẫu (≈1,2 giây).
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 0; v <= 5; v++) { const y = yOf(v); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (let i = 0; i <= 240; i += 24) { const x = (i / 240) * W; ctx.moveTo(x, SCOPE_GRID_TOP); ctx.lineTo(x, SCOPE_GRID_BOTTOM); }
    ctx.stroke();
    // Vẽ 1 kênh: polyline qua các mẫu, ngắt khi gặp null. x theo số mẫu
    // hiện có (mẫu mới nhất ở phải); khi bộ nhớ chưa đầy thì sóng giãn
    // đầy màn hình, đủ 240 mẫu thì đúng thang 12 giây.
    const drawCh = (idx, color) => {
      const n = samples.length;
      if (n === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let penDown = false;
      for (let i = 0; i < n; i++) {
        const v = samples[i][idx];
        if (v === null || v === undefined) { penDown = false; continue; }
        const x = n > 1 ? (i / (n - 1)) * W : W;
        const y = yOf(Math.max(SCOPE_V_MIN, Math.min(SCOPE_V_MAX, v)));
        if (!penDown) { ctx.moveTo(x, y); penDown = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawCh(0, '#7DD3FC');
    drawCh(1, '#FBBF24');
    // Hàng chữ trên: giá trị mẫu mới nhất từng kênh ("—" nếu floating).
    const last = samples.length ? samples[samples.length - 1] : [null, null];
    ctx.font = '600 13px "Fira Code", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7DD3FC';
    ctx.fillText('CH1 ' + formatVolts(last[0]), 6, 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FBBF24';
    ctx.fillText('CH2 ' + formatVolts(last[1]), W - 6, 9);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 11px "Fira Code", monospace';
    ctx.fillText('12s · 50ms/mẫu', W / 2, 137);
    t.tex.needsUpdate = true;
  }
  // Vẽ 1 hàng LCD 16 ô lên canvas (canvas 256×64, mỗi ô 16px, font đã
  // đặt sẵn 28px monospace, baseline 'middle', màu #7CFFB2). Ô thường:
  // vẽ ký tự; ô custom (mã CGRAM): vẽ bitmap 5×8 (mỗi hàng là số 5 bit,
  // bit 4 = cột trái nhất).
  function drawLcdLine(ctx, cells, y) {
    for (let i = 0; i < 16; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const x = i * 16;
      if (cell.custom) {
        const px = 2.6, w = 5 * px, h = 8 * px;
        const ox = x + (16 - w) / 2, oy = y - h / 2;
        for (let r = 0; r < 8; r++) {
          const row = cell.custom[r] || 0;
          for (let c = 0; c < 5; c++) {
            if ((row >> (4 - c)) & 1) ctx.fillRect(ox + c * px, oy + r * px, px, px);
          }
        }
      } else if (cell.ch && cell.ch !== ' ') {
        ctx.fillText(cell.ch, x, y);
      }
    }
  }
  // Vẽ văn bản đã nhận lên màn hình Serial (canvas 256×144, chữ xanh lá
  // monospace trên nền tối, như terminal). Chỉ hiện 8 dòng cuối, mỗi dòng
  // tối đa 32 ký tự (màn hình 80×42mm, canvas 512×288, ctx đã scale(2,2)).
  // Ký tự không in được (ngoài 32..126, trừ \t) hiện thành '·'. Chỉ gọi
  // khi chuỗi văn bản đổi (vòng poll so sánh với t.last).
  function drawSerialScreen(t, text) {
    const ctx = t.ctx;
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 256, 144);
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const visible = lines.slice(-8);
    const cleanLine = (line) => [...line].map((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 32 && c <= 126) || c === 9 ? ch : '·';
    }).join('').slice(0, 32);
    ctx.fillStyle = '#4ADE80';
    ctx.font = '400 13px "Fira Code", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    visible.forEach((line, i) => ctx.fillText(cleanLine(line), 6, 6 + i * 16));
    // Con trỏ ở cuối dòng cuối (vạch đứng sau ký tự cuối).
    const lastLine = visible.length ? cleanLine(visible[visible.length - 1]) : '';
    const cursorX = 6 + ctx.measureText(lastLine).width;
    ctx.fillRect(Math.min(cursorX, 248), 6 + (visible.length - 1) * 16, 2, 13);
    t.tex.needsUpdate = true;
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
    // Dây ôm sát mặt board: vòng cung thấp (điểm giữa chỉ +10mm, điểm kề
    // đầu dây +5mm) thay cho vòng cao cũ (+42/+18). Đầu dây ở mặt board
    // (y = BOARD_TOP = 8), thân chip cao 4.5mm (đỉnh ~12.5) nên dây cao
    // ~10mm vẫn vượt qua chip mà không chạm; ống dây bán kính 0.75 giữ
    // nguyên, ống bắt vô hình 3.2 giữ nguyên để kéo đầu dây vẫn làm việc.
    const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 10, (a.z + b.z) / 2);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x, a.y, a.z), up(a, 5), mid, up(b, 5), new THREE.Vector3(b.x, b.y, b.z),
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
          new THREE.SphereGeometry(1.8, 14, 14),
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
      // Cọc hiện sóng (OSC1.CH1/CH2/GND) lấy vị trí từ thân máy trên bàn.
      const sp = parseScopePost(e);
      if (sp) return scopePostPos(state, e);
      // Cọc màn hình Serial (SER0.TX/RX/GND) lấy vị trí từ thân máy trên bàn.
      const sr = parseSerialPost(e);
      if (sr) return serialPostPos(state, e);
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
    scopeHitMeshes.length = 0;
    serialHitMeshes.length = 0;
    ledMats.clear(); lcdTexs.clear(); meterTexs.clear(); scopeTexs.clear(); serialTexs.clear(); keypadKeyMeshes.clear(); motorFans.clear(); buzzerMats.clear(); btnTops.clear(); segMats.clear();
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
    if (type === 'oscilloscope') {
      // Hiện sóng ngoài bàn: đặt bằng tx/tz như nguồn, xóa được (không
      // fixed). Không truyền tọa độ (tx=tz=0) thì về vị trí mặc định cạnh
      // phải nguồn (tx=130, tz=-150).
      const id = nextComponentId(state, 'oscilloscope');
      const comp = {
        id, type: 'oscilloscope',
        tx: (tx === 0 && tz === 0) ? SCOPE_DEFAULT_TX : tx,
        tz: (tx === 0 && tz === 0) ? SCOPE_DEFAULT_TZ : tz,
        fixed: false, props: defaultProps('oscilloscope'),
      };
      state.components.push(comp);
      save(); rebuildAll(); syncToCpu();
      select({ kind: 'comp', id });
      setStatus('Đã đặt ' + compLabel(comp) + ' lên bàn.');
      return id;
    }
    if (type === 'serial') {
      // Màn hình Serial ngoài bàn: đặt bằng tx/tz như nguồn/hiện sóng,
      // xóa được (không fixed). Không truyền tọa độ (tx=tz=0) thì về vị
      // trí mặc định cạnh TRÁI nguồn (tx=-130, tz=-150), đối xứng với
      // hiện sóng ở cạnh phải.
      const id = nextComponentId(state, 'serial');
      const comp = {
        id, type: 'serial',
        tx: (tx === 0 && tz === 0) ? SERIAL_DEFAULT_TX : tx,
        tz: (tx === 0 && tz === 0) ? SERIAL_DEFAULT_TZ : tz,
        fixed: false, props: defaultProps('serial'),
      };
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
    // Hàng từ z: tìm hàng có tọa độ rowZ gần điểm bấm nhất (hàng cách nhau
    // 1 PITCH trong đoạn, 2 PITCH qua ranh giới đoạn — không còn công thức
    // tuyến tính z/PITCH + (rows−1)/2).
    const rows = rowsOf(state.size);
    const candRows = [-2, -1, ...Array.from({ length: rows }, (_, i) => i), rows, rows + 1];
    let best = null, bestD = 1e9;
    for (const r of candRows) {
      const z = rowZ(r, rows);
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
  // Cọc hiện sóng (CH1/CH2/GND) của đồng hồ hiện sóng: điểm thả hợp lệ
  // cho đầu dây (cả kéo đầu dây vào cọc lẫn đi dây mới bắt đầu/kết thúc
  // ở cọc), mirror pickPsuPost.
  function pickScopePost(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside || !scopeHitMeshes.length) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scopeHitMeshes, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.scopePostId ? u.scopePostId : null;
  }
  // Cọc màn hình Serial (TX/RX/GND): điểm thả hợp lệ cho đầu dây, mirror
  // pickScopePost.
  function pickSerialPost(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside || !serialHitMeshes.length) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(serialHitMeshes, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.serialPostId ? u.serialPostId : null;
  }
  // Phím của bàn phím 4x4: bấm vào 1 phím vuông trên panel thì trả
  // {keypadId, row, col, key} (để nhấn giữ phím, như nút bấm). Raycast
  // vào mesh phím của mọi bàn phím đang có trên bàn.
  function pickKeypadKey(e) {
    const ndc = pointerNdc(e);
    if (!ndc.inside || !keypadKeyMeshes.size) return null;
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    for (const [, keys] of keypadKeyMeshes) {
      for (const [, k] of Object.entries(keys)) meshes.push(k.mesh);
    }
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.keypadId ? { keypadId: u.keypadId, row: u.row, col: u.col, key: u.key } : null;
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
  // Hộp bao quanh chân linh kiện (highlight khi đặt/chọn): rộng/sâu theo
  // khoảng cách thật giữa các chân — chiều sâu dùng rowZ nên linh kiện xoay
  // mà chân qua ranh giới đoạn thì hộp dài thêm đúng 1 khe hở.
  function footprintBox(type, rot, anchorR = 0, rows = 10) {
    const offs = legOffsets(type, rot);
    if (!offs.length) return { w: 12, d: 12, cx: 0, cz: 0 };
    const dcs = offs.map((o) => o.dc), drs = offs.map((o) => o.dr);
    const minDc = Math.min(...dcs), maxDc = Math.max(...dcs);
    const minDr = Math.min(...drs), maxDr = Math.max(...drs);
    const zLo = rowZ(anchorR + minDr, rows), zHi = rowZ(anchorR + maxDr, rows);
    return {
      w: (maxDc - minDc + 1) * PITCH + 6,
      d: (zHi - zLo) + PITCH + 6,
      cx: ((minDc + maxDc) / 2) * PITCH,
      cz: ((zLo + zHi) / 2) - rowZ(anchorR, rows),
    };
  }
  function showHighlight(anchor, type, rot, ok) {
    if (!sceneReady) return;
    const p = holePos(anchor, state.size);
    if (!p) { highlightBox.visible = false; return; }
    const pa = parseHole(anchor, state.size);
    const fp = footprintBox(type, rot, pa ? pa.r : 0, rowsOf(state.size));
    highlightBox.visible = true;
    highlightBox.scale.set(fp.w, 1, fp.d);
    highlightBox.material.color.set(ok ? 0x059669 : 0xDC2626);
    highlightBox.position.set(p.x + fp.cx, BOARD_TOP + 0.8, p.z + fp.cz);
    highlightBox.rotation.y = 0;
  }
  function showHighlightForComp(id) {
    const comp = state.components.find((c) => c.id === id);
    if (!comp || comp.type === 'psu' || comp.type === 'oscilloscope' || comp.type === 'serial' || !sceneReady) { hideHighlight(); return; }
    showHighlight(comp.anchor, comp.type, comp.rot || 0, true);
    highlightBox.material.color.set(0x059669);
  }
  function hideHighlight() { if (highlightBox) highlightBox.visible = false; }
  function showTableHighlight(x, z, ok, w = 124, d = 84) {
    if (!sceneReady) return;
    highlightBox.visible = true;
    highlightBox.scale.set(w, 1, d);
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
    if (drag.type === 'psu' || drag.type === 'oscilloscope' || drag.type === 'serial') {
      const pt = pickTablePoint(e);
      if (!pt) { drag.valid = false; hideHighlight(); return; }
      drag.tx = pt.x; drag.tz = pt.z;
      const blocked = Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64;
      drag.valid = !blocked;
      // Ô sáng theo cỡ thân máy: nguồn 60×40 -> 124×84, hiện sóng 100×50
      // -> 112×62, màn hình Serial 100×50 -> 112×62 (cùng cỡ hiện sóng).
      if (drag.type === 'psu') showTableHighlight(pt.x, pt.z, !blocked);
      else showTableHighlight(pt.x, pt.z, !blocked, 112, 62);
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
    if (d.type === 'psu' || d.type === 'oscilloscope' || d.type === 'serial') {
      if (d.valid) placeComponent(d.type, null, 0, d.tx, d.tz);
      else setStatus('Không đặt được ' + (d.type === 'psu' ? 'nguồn' : d.type === 'oscilloscope' ? 'hiện sóng' : 'màn hình Serial') + ' ở đây (đè lên breadboard).');
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
      const hole = pickHole(e) || pickPsuPost(e) || pickScopePost(e) || pickSerialPost(e);
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
      if (placementMode === 'psu' || placementMode === 'oscilloscope' || placementMode === 'serial') {
        const pt = pickTablePoint(e);
        if (pt && !(Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64)) {
          const id = placeComponent(placementMode, null, 0, pt.x, pt.z);
          if (id) setPlacementMode(null); // đặt 1 lần thì thoát chế độ đặt
        } else setStatus('Không đặt được ' + (placementMode === 'psu' ? 'nguồn' : placementMode === 'oscilloscope' ? 'hiện sóng' : 'màn hình Serial') + ' ở đây (đè lên breadboard).');
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
      // Bấm vào 1 phím của bàn phím 4x4 thì nhấn giữ phím đó (như nút
      // bấm), không kéo di chuyển bàn phím. Nhả chuột thì phím nhả ra
      // (xem onCanvasPointerUp).
      const kpKey = comp.type === 'keypad' ? pickKeypadKey(e) : null;
      if (kpKey) {
        select({ kind: 'comp', id: comp.id });
        pressBenchKeypad(comp.id, { row: kpKey.row, col: kpKey.col });
        drag = { mode: 'keypad', id: comp.id, startX: e.clientX, startY: e.clientY };
        renderer.domElement.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      select({ kind: 'comp', id: comp.id });
      if (comp.type === 'button') {
        pressBenchButton(comp.id, true);
      }
      if (comp.type === 'pic') return; // chip cố định, chỉ chọn để xem
      if (comp.type === 'psu' || comp.type === 'oscilloscope' || comp.type === 'serial') {
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
    // Hover ở chế độ đặt: hiện ô sáng báo vị trí sắp đặt (lỗ cho linh
    // kiện cắm lỗ, mặt bàn cho nguồn/hiện sóng) + góc xoay hiện tại.
    if (!drag && placementMode) {
      if (placementMode === 'psu' || placementMode === 'oscilloscope' || placementMode === 'serial') {
        const pt = pickTablePoint(e);
        if (!pt) { hideHighlight(); return; }
        const blocked = Math.abs(pt.x) < 145 && Math.abs(pt.z) < 64;
        if (placementMode === 'psu') showTableHighlight(pt.x, pt.z, !blocked);
        else showTableHighlight(pt.x, pt.z, !blocked, 112, 62);
        return;
      }
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
      // Đích thả: lỗ breadboard/rail, cọc nguồn (+/−), cọc hiện sóng hoặc
      // cọc màn hình Serial.
      const hole = pickHole(e);
      const post = hole ? null : (pickPsuPost(e) || pickScopePost(e) || pickSerialPost(e));
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
      const t = state.components.find((c) => c.id === drag.id)?.type;
      if (t === 'oscilloscope' || t === 'serial') showTableHighlight(pt.x, pt.z, !blocked, 112, 62);
      else showTableHighlight(pt.x, pt.z, !blocked);
    }
  }
  function onCanvasPointerUp(e) {
    if (pressedBtn) { pressBenchButton(pressedBtn, false); pressedBtn = null; }
    if (pressedKeypad) { pressBenchKeypad(pressedKeypad.id, null); }
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
          if (w.id === 'W6' && typeof w.a === 'object') w.a = { x: comp.tx - PSU_POST_DX, y: PSU_POST_Y, z: comp.tz + PSU_POST_DZ };
          if (w.id === 'W7' && typeof w.a === 'object') w.a = { x: comp.tx + PSU_POST_DX, y: PSU_POST_Y, z: comp.tz + PSU_POST_DZ };
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
  // Nhấn/nhả 1 phím bàn phím 4x4 (nhấn giữ): key = {row, col} hoặc null
  // (nhả). Phím là công tắc đóng hàng với cột trong netlist (như nút bấm)
  // + mức cột tính ở CPU khi quét (pinLevel). Đồng bộ netlist + panel
  // Kiểm tra, rồi báo bridge để CPU biết phím đang nhấn; phím nhấn xuống
  // 0.4mm + tô sáng xanh lá, nhả thì về lại.
  function pressBenchKeypad(id, key) {
    const b = bridge();
    pressedKeypad = key ? { id, row: key.row, col: key.col } : null;
    syncToCpu();
    if (b && typeof b.pressKeypad === 'function') b.pressKeypad(id, key || null);
    highlightKeypadKey(id, key);
  }
  // Tô sáng phím đang nhấn trên panel 3D (xanh lá + nhấn xuống 0.4mm),
  // phím khác về lại màu tối. key = {row, col} hoặc null (không phím nào).
  function highlightKeypadKey(id, key) {
    const keys = keypadKeyMeshes.get(id);
    if (!keys) return;
    for (const [rc, k] of Object.entries(keys)) {
      const isPressed = key && rc === key.row + ',' + key.col;
      k.mat.emissiveIntensity = isPressed ? 1.5 : 0;
      k.mesh.position.y = (k.mesh.userData.baseY ?? 9.5) - (isPressed ? 0.4 : 0);
    }
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
      // Cánh quạt động cơ DC quay theo rpm (đã làm mượt bằng EMA trong
      // live poll): góc quay += rpm/60 vòng/giây × 2π × dt. dt tính từ
      // thời gian thực giữa 2 frame (kẹp 0,1s để tab ẩn lâu không nhảy vọt).
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - (tick._last || now)) / 1000));
      tick._last = now;
      for (const [, m] of motorFans) {
        if (!m.fan) continue;
        m.angle = (m.angle || 0) + ((m.rpm || 0) / 60) * 2 * Math.PI * dt;
        m.fan.rotation.y = m.angle;
      }
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
          let ledStates = null;
          try { ledStates = b.getLedStates(); } catch { ledStates = null; }
          if (ledStates) {
            for (const s of ledStates) {
              const m = ledMats.get(s.id);
              if (m) m.emissiveIntensity = s.on ? 1.8 : 0.12;
            }
            updateInspectorLed(ledStates);
          }
        }
        if (typeof b.getLcd === 'function') {
          const lcd = b.getLcd();
          updateInspectorLcd(lcd);
          for (const [, t] of lcdTexs) {
            // Key gồm cả pattern CGRAM: 2 trạng thái có cùng chuỗi lines
            // nhưng pattern khác nhau (vd Đ vs ệ) vẫn phải vẽ lại.
            const cellsKey = lcd.cells
              ? lcd.cells.map((ln) => ln.map((c) => (c.custom ? '#' + c.custom.map((v) => v.toString(16)).join('') : c.ch)).join('')).join('|')
              : lcd.lines[0] + '|' + lcd.lines[1];
            // Key gồm cả displayOn: lệnh tắt màn hình (0x08) phải vẽ
            // lại ngay (màn hình tối) dù DDRAM không đổi; 0x0C bật lại
            // thì chữ về (DDRAM giữ nguyên khi tắt).
            const key = (lcd.complete ? '1' : '0') + '|' + (lcd.displayOn === false ? '0' : '1') + '|' + cellsKey;
            if (key === t.last) continue;
            t.last = key;
            const ctx = t.ctx;
            ctx.fillStyle = '#123524';
            ctx.fillRect(0, 0, 256, 64);
            ctx.fillStyle = '#7CFFB2';
            ctx.font = '28px "Fira Code", monospace';
            ctx.textBaseline = 'middle';
            if (lcd.complete && lcd.cells && lcd.displayOn !== false) {
              drawLcdLine(ctx, lcd.cells[0], 18);
              drawLcdLine(ctx, lcd.cells[1], 48);
            } else if (lcd.complete && lcd.displayOn === false) {
              // Display off (lệnh 0x08): màn hình tối, không vẽ chữ —
              // DDRAM giữ nguyên nên 0x0C bật lại thì chữ về.
            } else {
              ctx.fillText(lcd.complete ? lcd.lines[0] : 'CHUA NOI DU DAY', 8, 18);
              ctx.fillText(lcd.complete ? lcd.lines[1] : '', 8, 48);
            }
            t.tex.needsUpdate = true;
          }
        }
        if (typeof b.getBuzzerStates === 'function') {
          let anyBuzz = false;
          let buzzerStates = null;
          try { buzzerStates = b.getBuzzerStates(); } catch { buzzerStates = null; }
          if (buzzerStates) {
            for (const s of buzzerStates) {
              const mat = buzzerMats.get(s.id);
              if (mat) mat.emissiveIntensity = s.on ? 1.2 : 0;
              if (s.on) {
                const comp = state.components.find((c) => c.id === s.id);
                if (!comp || comp.props?.sound !== false) anyBuzz = true;
              }
            }
            setBuzzerSound(anyBuzz);
            updateInspectorBuzzer(buzzerStates);
          }
        }
        if (typeof b.getMeterReadings === 'function') {
          let readings = null;
          let meterErr = false;
          try { readings = b.getMeterReadings(); } catch { readings = null; meterErr = true; }
          if (readings) {
            const byId = new Map();
            for (const v of readings.voltmeters || []) byId.set(v.id, { text: formatVolts(v.volts), data: v });
            for (const a of readings.ammeters || []) byId.set(a.id, { text: formatAmps(a.amps), data: a });
            for (const [id, t] of meterTexs) {
              // Màu màn hình theo chế độ hiện tại của linh kiện (đổi mode
              // trong popup thì vẽ lại ngay cả khi chuỗi số trùng nhau).
              const comp = state.components.find((c) => c.id === id);
              const mode = comp ? meterMode(comp) : 'V';
              if (t.mode !== mode) { t.mode = mode; t.last = ''; }
              const r = byId.get(id);
              const text = r ? r.text : '—';
              if (text === t.last) continue;
              t.last = text;
              drawMeterTexture(t, text);
            }
            updateInspectorMeter(byId);
          } else if (meterErr) {
            // Đọc số đo lỗi (exception): vẽ "—" thay vì giữ số cũ
            // (Issue 20a) — số cũ là của mạch trước khi lỗi, giữ lại sẽ
            // nhầm là số đo hiện tại.
            for (const [, t] of meterTexs) {
              if (t.last !== '—') { t.last = '—'; drawMeterTexture(t, '—'); }
            }
            updateInspectorMeter(new Map());
          }
        }
        if (typeof b.getScopeData === 'function') {
          let scopeData = null;
          try { scopeData = b.getScopeData(); } catch { scopeData = null; }
          if (scopeData) {
            const byId = new Map(scopeData.map((d) => [d.id, d.samples]));
            for (const [id, t] of scopeTexs) {
              const samples = byId.get(id) || [];
              // Key: độ dài buffer + 3 mẫu cuối (đủ bắt mọi thay đổi sóng:
              // buffer chỉ thêm mẫu mới và cắt đầu, sóng cũ đã vẽ từ trước).
              const key = samples.length + '|' + samples.slice(-3).map((s) => s.join(',')).join(';');
              if (key === t.last) continue;
              t.last = key;
              drawScopeWaveform(t, samples);
            }
            updateInspectorScope(byId);
          }
        }
        if (typeof b.getSevenSegStates === 'function') {
          let segStates = null;
          try { segStates = b.getSevenSegStates(); } catch { segStates = null; }
          if (segStates) {
            // Đoạn nào sáng thì phát sáng đỏ mạnh, đoạn tắt thì tối lại
            // (như LED: emissiveIntensity 1.8 khi sáng, 0.12 khi tắt).
            for (const s of segStates) {
              const mats = segMats.get(s.id);
              if (!mats) continue;
              for (const t of SEVEN_SEG_TERMS) {
                const m = mats[t];
                if (m) m.emissiveIntensity = s.on && s.on[t] ? 1.8 : 0.12;
              }
            }
            updateInspectorSeg(segStates);
          }
        }
        // Bàn phím 4x4: tô sáng phím đang nhấn trên panel 3D (đồng bộ với
        // trạng thái CPU — phím nhấn từ 3D đã tô sáng ngay khi bấm, ở đây
        // chỉ để chắc chắn khi phím đổi từ nơi khác).
        if (typeof b.getKeypadState === 'function') {
          let kpStates = null;
          try { kpStates = b.getKeypadState(); } catch { kpStates = null; }
          if (kpStates) {
            const pressedById = new Map(kpStates.map((s) => [s.id, s]));
            for (const [id] of keypadKeyMeshes) {
              const s = pressedById.get(id);
              highlightKeypadKey(id, s ? { row: s.row, col: s.col } : null);
            }
            updateInspectorKeypad(kpStates);
          }
        }
        // Động cơ DC: tốc độ quay theo điện áp (làm mượt bằng EMA để PWM
        // không làm quạt giật — solver đọc điện áp tức thời nên PWM 50%
        // sẽ nhảy 0V/5V theo từng lần poll; EMA 0,3 làm tốc độ ổn định
        // quanh giá trị trung bình theo duty cycle).
        if (typeof b.getMotorState === 'function') {
          let motors = null;
          try { motors = b.getMotorState(); } catch { motors = null; }
          if (motors) {
            for (const m of motors) {
              const f = motorFans.get(m.id);
              if (!f) continue;
              const target = m.rpm ?? 0;
              f.rpm = (f.rpm || 0) + (target - (f.rpm || 0)) * 0.3;
            }
            updateInspectorMotor(motors);
          }
        }
        // Màn hình Serial: vẽ lại khi văn bản đã nhận đổi (chỉ so sánh
        // chuỗi, không vẽ lại mỗi lần hẹn giờ).
        if (typeof b.getSerialText === 'function') {
          for (const [id, t] of serialTexs) {
            let text = '';
            try { text = b.getSerialText(id) || ''; } catch { text = ''; }
            if (text === t.last) continue;
            t.last = text;
            drawSerialScreen(t, text);
          }
          updateInspectorSerial();
        }
        // Thạch anh + nút nhấn: trạng thái sống chỉ đọc từ bench state
        // (không cần bridge) — thạch anh nào đang cấp xung, nút nào
        // đang nhấn giữ (Issue 17).
        updateInspectorCrystal();
        updateInspectorButton();
      } catch { /* bridge chưa sẵn: bỏ qua lần này */ }
    }, 150);
  }
  // Inspector đang mở trên 1 đồng hồ thì cập nhật số đo live (chỉ đổi
  // text của các ô đã có, không render lại toàn bộ Inspector). Ô phụ
  // hiện theo chế độ hiện tại: áp từng chân khi đo áp, chiều dòng khi
  // đo dòng.
  function updateInspectorMeter(byId) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'multimeter') return;
    const r = byId.get(comp.id);
    const valEl = inspectorEl.querySelector('#inspMeterVal');
    if (valEl) valEl.textContent = r ? r.text : '—';
    if (meterMode(comp) === 'V') {
      const vpEl = inspectorEl.querySelector('#inspMeterVP');
      const vnEl = inspectorEl.querySelector('#inspMeterVN');
      if (vpEl) vpEl.textContent = r ? formatVolts(r.data.vP) : '—';
      if (vnEl) vnEl.textContent = r ? formatVolts(r.data.vN) : '—';
    } else {
      const dirEl = inspectorEl.querySelector('#inspMeterDir');
      if (dirEl) dirEl.textContent = r ? formatCurrentDirection(r.data.amps) : '—';
    }
  }
  // Inspector đang mở trên 1 đồng hồ hiện sóng thì cập nhật số đo live
  // (chỉ đổi text của 2 ô CH1/CH2 đã có, không render lại Inspector).
  function updateInspectorScope(byId) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'oscilloscope') return;
    const samples = byId.get(comp.id) || [];
    const last = samples.length ? samples[samples.length - 1] : [null, null];
    const ch1El = inspectorEl.querySelector('#inspScopeCH1');
    const ch2El = inspectorEl.querySelector('#inspScopeCH2');
    if (ch1El) ch1El.textContent = formatVolts(last[0]);
    if (ch2El) ch2El.textContent = formatVolts(last[1]);
  }
  // Inspector đang mở trên 1 LED 7 thanh thì cập nhật readout live (chỉ
  // đổi text 2 ô "Đang sáng" / "Hiện số" đã có, không render lại
  // Inspector). Không có trạng thái (vd chưa nối CPU) thì hiện "—".
  function updateInspectorSeg(segStates) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'sevenseg') return;
    const s = (segStates || []).find((x) => x.id === comp.id);
    const onEl = inspectorEl.querySelector('#inspSegOn');
    const digitEl = inspectorEl.querySelector('#inspSegDigit');
    if (onEl) onEl.textContent = s ? segOnText(s.on) : '—';
    if (digitEl) {
      const digit = s ? sevenSegDigit(s.on) : null;
      digitEl.textContent = digit === null ? '—' : digit;
    }
  }
  // Inspector đang mở trên 1 LED thì cập nhật trạng thái sáng/tắt live
  // (Issue 17): chỉ đổi text ô "Đang sáng"/"Tắt" đã có, không render lại
  // Inspector. Không có trạng thái thì hiện "—".
  function updateInspectorLed(ledStates) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'led') return;
    const s = (ledStates || []).find((x) => x.id === comp.id);
    const el = inspectorEl.querySelector('#inspLedState');
    if (el) el.textContent = s ? (s.on ? 'Đang sáng' : 'Tắt') : '—';
  }
  // Inspector đang mở trên 1 còi thì cập nhật trạng thái kêu/không kêu
  // live (Issue 17).
  function updateInspectorBuzzer(buzzerStates) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'buzzer') return;
    const s = (buzzerStates || []).find((x) => x.id === comp.id);
    const el = inspectorEl.querySelector('#inspBuzzerState');
    if (el) el.textContent = s ? (s.on ? 'Đang kêu' : 'Không kêu') : '—';
  }
  // Inspector đang mở trên 1 thạch anh thì cập nhật xung đang dùng live
  // (Issue 17): thạch anh này có đang cấp xung cho chip không (cắm đúng
  // strip OSC1/OSC2). Không cấp xung thì "Chưa có thạch anh".
  function updateInspectorCrystal() {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'crystal') return;
    const el = inspectorEl.querySelector('#inspCrystalState');
    if (!el) return;
    const freq = crystalFreqOf(state, comp.id);
    el.textContent = freq ? 'Xung đang dùng: ' + (freq / 1e6) + ' MHz' : 'Chưa có thạch anh';
  }
  // Inspector đang mở trên 1 LCD thì cập nhật 2 dòng chữ đang hiện live
  // (Issue 17): chỉ đổi text 2 ô đã có, không render lại Inspector.
  // LCD tắt màn hình (displayOn=false) thì 2 dòng hiện "—" (DDRAM vẫn
  // giữ chữ, bật lại thì chữ về).
  function updateInspectorLcd(lcd) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'lcd') return;
    const l0El = inspectorEl.querySelector('#inspLcdLine0');
    const l1El = inspectorEl.querySelector('#inspLcdLine1');
    if (!lcd || lcd.displayOn === false) {
      if (l0El) l0El.textContent = '—';
      if (l1El) l1El.textContent = '—';
      return;
    }
    if (l0El) l0El.textContent = (lcd.lines && lcd.lines[0]) || '—';
    if (l1El) l1El.textContent = (lcd.lines && lcd.lines[1]) || '—';
  }
  // Inspector đang mở trên 1 nút nhấn thì cập nhật trạng thái nhấn/thả
  // live (Issue 17): nút đang nhấn giữ trên bàn (pressedBtn) hay đã thả.
  function updateInspectorButton() {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'button') return;
    const el = inspectorEl.querySelector('#inspButtonState');
    if (el) el.textContent = pressedBtn === comp.id ? 'Đang nhấn' : 'Thả';
  }
  // Inspector đang mở trên 1 bàn phím 4x4 thì cập nhật phím đang nhấn live
  // (chỉ đổi text ô "Đang nhấn" đã có, không render lại Inspector).
  // Phím đang nhấn giữ trên bàn (pressedKeypad) mà CPU không thấy (hàng/
  // cột chưa nối tới chân PIC) thì hiện ghi chú "chưa nối dây" thay vì
  // "Đang nhấn" (Issue 16).
  function updateInspectorKeypad(kpStates) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'keypad') return;
    const s = (kpStates || []).find((x) => x.id === comp.id);
    const el = inspectorEl.querySelector('#inspKeypadPressed');
    if (!el) return;
    if (s) el.textContent = 'Phím "' + s.key + '" (hàng ' + s.row + ', cột ' + s.col + ')';
    else if (pressedKeypad && pressedKeypad.id === comp.id) el.textContent = 'Đã nhấn phím "' + KEYPAD_KEYS[pressedKeypad.row][pressedKeypad.col] + '" nhưng chưa nối dây nên CPU không đọc được';
    else el.textContent = 'Không nhấn phím nào';
  }
  // Inspector đang mở trên 1 động cơ DC thì cập nhật V/A/RPM live (chỉ đổi
  // text 3 ô đã có, không render lại Inspector). RPM hiện theo EMA (đã làm
  // mượt trong live poll) nên PWM hiện tốc độ trung bình theo duty cycle.
  function updateInspectorMotor(motors) {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'motor') return;
    const m = (motors || []).find((x) => x.id === comp.id);
    const f = motorFans.get(comp.id);
    const vEl = inspectorEl.querySelector('#inspMotorVolts');
    const aEl = inspectorEl.querySelector('#inspMotorAmps');
    const rEl = inspectorEl.querySelector('#inspMotorRpm');
    if (vEl) vEl.textContent = m ? formatVolts(m.volts) : '—';
    if (aEl) aEl.textContent = m ? formatAmps(m.amps) : '—';
    if (rEl) rEl.textContent = m && m.rpm !== null && m.rpm !== undefined ? Math.round(f ? (f.rpm || 0) : m.rpm) + ' vòng/phút' : '—';
  }
  // Inspector đang mở trên 1 màn hình Serial thì cập nhật log đã nhận live
  // (chỉ đổi text ô log đã có, không render lại Inspector). Cuộn xuống
  // cuối log sau mỗi lần đổi (nếu người dùng chưa cuộn lên xem lại).
  // Đồng thời cập nhật dòng trạng thái đấu nối TX/RX/GND (Issue 6).
  function updateInspectorSerial() {
    if (!selected || selected.kind !== 'comp') return;
    const comp = state.components.find((c) => c.id === selected.id);
    if (!comp || comp.type !== 'serial') return;
    const b = bridge();
    if (!b || typeof b.getSerialText !== 'function') return;
    const logEl = inspectorEl.querySelector('#inspSerialLog');
    if (logEl) {
      let text = '';
      try { text = b.getSerialText(comp.id) || ''; } catch { text = ''; }
      if (logEl.textContent !== text) {
        logEl.textContent = text;
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
    const wEl = inspectorEl.querySelector('#inspSerialWiring');
    if (wEl && typeof b.getSerialWiring === 'function') {
      let sw = null;
      try { sw = b.getSerialWiring(comp.id); } catch { sw = null; }
      wEl.textContent = !sw ? '—'
        : `TX→RC6: ${sw.tx ? 'đã nối' : 'chưa nối'} · RX→RC7: ${sw.rx ? 'đã nối' : 'chưa nối'} · GND: ${sw.gnd ? 'đã nối' : 'chưa nối'}`;
    }
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

  // --- Khởi động (chưa cần Three.js cho tới khi mở tab) ---
  renderPalette();
  renderChecks();
  updateModeBanner();
  updateSizeUI();

  // Động vào popup Inspector (rê chuột vào, bấm, cuộn, tab vào) thì hủy
  // hẹn tự tắt — gắn 1 lần ở panel (không gắn trong renderInspector vì
  // innerHTML thay mỗi lần vẽ lại sẽ nhân đôi listener).
  if (inspectorEl) {
    for (const ev of ['pointerenter', 'pointerdown', 'wheel', 'focusin']) {
      inspectorEl.addEventListener(ev, disarmInspAutoClose);
    }
  }

  // Deep-link ?lab=<id>: mở thẳng lab đó (trang Lý thuyết link tới lab
  // cụ thể, vd /thuc-hanh/pic16f877a/?lab=chay-tung-lenh). Id lạ thì bỏ
  // qua, mở bàn như thường. ?from=<trang lý thuyết>: hiện nút quay lại
  // đúng trang đó (chỉ chấp nhận đường dẫn nội bộ /ly-thuyet/...).
  try {
    const params = new URLSearchParams(location.search);
    const deepLab = params.get('lab');
    if (deepLab && getLab(deepLab)) openLab(deepLab);
    const from = params.get('from');
    if (from && from.startsWith('/ly-thuyet/')) {
      const backEl = document.getElementById('benchBackTheory');
      if (backEl) { backEl.href = from; backEl.hidden = false; }
    }
  } catch { /* URL lạ: bỏ qua */ }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

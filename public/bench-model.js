// bench-model.js — Mô hình lỗ/strip của bàn thực hành 3D (không DOM, không Three.js).
// Breadboard 830 lỗ: 63 cột x 10 hàng (a–e, f–j) + 4 rail (T+/T−/B+/B−).
// Hàng a–e của mỗi cột nối nhau thành 1 strip, f–j nối nhau, rail chạy suốt
// chiều dài (mọi lỗ rail + là +5V, mọi lỗ rail − là GND).
// Chân linh kiện cắm thẳng vào lỗ, breadboard chính là đế (kiểu ohmimic).
// Trạng thái bàn: { components: [{id, type, anchor, rot, props, fixed?}],
//   wires: [{id, a, b, color}] } với a/b là id lỗ ('c12', 'T+40') hoặc
//   điểm 3D {x, y, z} (đầu dây gắn vào cọc nguồn).
// benchToNetlist(state) dịch trạng thái bàn thành netlist kiểu wiring.js
// (terminal 'PIC.RB0', 'LED0.A', 'VCC', 'GND') để nối vào CPU.

export const PITCH = 2.54;       // khoảng cách lỗ (mm)
export const COLS = 63;          // cột 1..63
export const RAIL_COLS = 50;     // rail: 50 lỗ mỗi rail
export const PIC_COL = 22;       // chip PIC cắm ở cột 22..41
export const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
// Hàng trong lưới nội bộ: T+ = -2, T− = -1, a..j = 0..9, B+ = 10, B− = 11
const RAIL_ROW = { 'T+': -2, 'T-': -1, 'B+': 10, 'B-': 11 };
const ROW_NAME = { '-2': 'T+', '-1': 'T-', '10': 'B+', '11': 'B-' };

// Id lỗ từ (hàng nội bộ, cột). Trả null nếu ngoài board.
export function holeId(r, c) {
  if (r >= 0 && r <= 9) {
    if (c < 1 || c > COLS) return null;
    return ROWS[r] + c;
  }
  if (r in ROW_NAME) {
    if (c < 1 || c > RAIL_COLS) return null;
    return ROW_NAME[r] + c;
  }
  return null;
}

// Phân tích id lỗ -> {r, c} (r là hàng nội bộ) hoặc null nếu sai định dạng.
export function parseHole(id) {
  if (typeof id !== 'string') return null;
  let m = id.match(/^([a-j])(\d+)$/);
  if (m) {
    const c = Number(m[2]);
    if (c >= 1 && c <= COLS) return { r: ROWS.indexOf(m[1]), c };
    return null;
  }
  m = id.match(/^([TB])([+-])(\d+)$/);
  if (m) {
    const c = Number(m[3]);
    if (c < 1 || c > RAIL_COLS) return null;
    return { r: RAIL_ROW[m[1] + m[2]], c };
  }
  return null;
}

export function isRailHole(id) {
  const p = parseHole(id);
  return !!p && (p.r < 0 || p.r > 9);
}

// Khóa strip của một lỗ: 'S' + mặt (T: a–e, B: f–j) + cột, hoặc 'RAIL+'/'RAIL-'.
export function stripKey(id) {
  const p = parseHole(id);
  if (!p) return null;
  if (p.r < 0 || p.r > 9) return (p.r === -2 || p.r === 10) ? 'RAIL+' : 'RAIL-';
  return 'S' + (p.r <= 4 ? 'T' : 'B') + p.c;
}

// Vị trí 3D của tâm lỗ trên mặt bàn (mm, gốc ở giữa board, y tính riêng).
export function holePos(id) {
  const p = parseHole(id);
  if (!p) return null;
  return { x: (p.c - 32) * PITCH, z: (p.r - 4.5) * PITCH };
}

// Mọi lỗ trên board (để vẽ InstancedMesh): [{id, x, z}]
export function allHoles() {
  const out = [];
  for (let r = -2; r <= 11; r++) {
    if (r === -2 || r === -1 || r === 10 || r === 11) {
      for (let c = 1; c <= RAIL_COLS; c++) {
        const id = holeId(r, c);
        const p = holePos(id);
        out.push({ id, x: p.x, z: p.z });
      }
    } else {
      for (let c = 1; c <= COLS; c++) {
        const id = holeId(r, c);
        const p = holePos(id);
        out.push({ id, x: p.x, z: p.z });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chân linh kiện: bố cục theo (dc, dr) tính từ lỗ neo (anchor), rot = 0.
// ---------------------------------------------------------------------------
export const LEG_LAYOUTS = {
  led: [{ term: 'A', dc: 0, dr: 0 }, { term: 'K', dc: 1, dr: 0 }],
  resistor: [{ term: 'L1', dc: 0, dr: 0 }, { term: 'L2', dc: 4, dr: 0 }],
  button: [{ term: 'T1', dc: 0, dr: 0 }, { term: 'T2', dc: 1, dr: 0 }],
  pot: [{ term: 'VCC', dc: 0, dr: 0 }, { term: 'W', dc: 1, dr: 0 }, { term: 'GND', dc: 2, dr: 0 }],
  lcd: [
    { term: 'RS', dc: 0, dr: 0 }, { term: 'E', dc: 1, dr: 0 },
    { term: 'D0', dc: 2, dr: 0 }, { term: 'D1', dc: 3, dr: 0 },
    { term: 'D2', dc: 4, dr: 0 }, { term: 'D3', dc: 5, dr: 0 },
    { term: 'D4', dc: 6, dr: 0 }, { term: 'D5', dc: 7, dr: 0 },
    { term: 'D6', dc: 8, dr: 0 }, { term: 'D7', dc: 9, dr: 0 },
  ],
  buzzer: [{ term: 'P', dc: 0, dr: 0 }, { term: 'N', dc: 1, dr: 0 }],
};

// Chân chip PIC16F877A DIP-40 (rộng 600 mil = 6 bước lỗ): chân 1..20 ở hàng b,
// chân 21..40 ở hàng h, cột PIC_COL..PIC_COL+19. Thứ tự chân khớp datasheet
// (và khớp PIC_PINS trong wiring.js — test kiểm chứng điều này).
export const PIC_PIN_IDS_LEFT = ['MCLR', 'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5', 'RE0', 'RE1', 'RE2', 'VDD', 'VSS', 'OSC1', 'OSC2', 'RC0', 'RC1', 'RC2', 'RC3', 'RD0', 'RD1'];
export const PIC_PIN_IDS_RIGHT = ['RD2', 'RD3', 'RC4', 'RC5', 'RC6', 'RC7', 'RD4', 'RD5', 'RD6', 'RD7', 'VSS', 'VDD', 'RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7'];

// Chân chip: [{term: 'PIC.RA0', hole: 'b23', pin: 2}] — pin 1 ở (b, PIC_COL),
// pin 20 ở (b, PIC_COL+19), pin 21 ở (h, PIC_COL+19), pin 40 ở (h, PIC_COL).
export function picLegs() {
  const out = [];
  PIC_PIN_IDS_LEFT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(1, PIC_COL + i), pin: i + 1 });
  });
  PIC_PIN_IDS_RIGHT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(7, PIC_COL + 19 - i), pin: 21 + i });
  });
  return out;
}

// Xoay offset (dc, dr) quanh lỗ neo theo rot (0..3, mỗi bước 90°).
export function rotateOffset(dc, dr, rot) {
  const r = ((rot % 4) + 4) % 4;
  if (r === 0) return { dc, dr };
  if (r === 1) return { dc: -dr, dr: dc };
  if (r === 2) return { dc: -dc, dr: -dr };
  return { dc: dr, dr: -dc };
}

// Offset chân (dc, dr) của 1 linh kiện theo rot — dùng để vẽ mesh 3D.
export function legOffsets(type, rot = 0) {
  const layout = LEG_LAYOUTS[type];
  if (!layout) return [];
  return layout.map((l) => {
    const o = rotateOffset(l.dc, l.dr, rot);
    return { term: l.term, dc: o.dc, dr: o.dr };
  });
}

// Lỗ của từng chân linh kiện: [{term, hole}] (hole null nếu rơi ngoài board).
export function legsFor(comp) {
  if (comp.type === 'pic') {
    return picLegs().map((l) => ({ term: l.term, hole: l.hole }));
  }
  if (comp.type === 'psu') return [];
  const anchor = parseHole(comp.anchor);
  if (!anchor) return [];
  return legOffsets(comp.type, comp.rot || 0).map((l) => ({
    term: l.term,
    hole: holeId(anchor.r + l.dr, anchor.c + l.dc),
  }));
}

// Lỗ nào đang bị chân nào chiếm: Map hole -> compId (trừ ignoreId).
export function occupancy(state, ignoreId = null) {
  const occ = new Map();
  for (const comp of state.components) {
    if (comp.id === ignoreId) continue;
    for (const leg of legsFor(comp)) {
      if (leg.hole) occ.set(leg.hole, comp.id);
    }
  }
  return occ;
}

// Đặt được linh kiện không? Kiểm tra chân ngoài board, lỗ đã có chân,
// và chân nằm dưới thân chip PIC (hàng b..h, cột PIC_COL..PIC_COL+19).
export function canPlace(state, type, anchor, rot = 0, ignoreId = null) {
  if (type === 'psu') return { ok: true, legs: [] }; // nguồn đặt trên mặt bàn, không cần lỗ
  const legs = legsFor({ type, anchor, rot });
  if (!legs.length) return { ok: false, reason: 'Không đặt được linh kiện này lên lỗ.' };
  for (const leg of legs) {
    if (!leg.hole || !parseHole(leg.hole)) return { ok: false, reason: 'Chân linh kiện rơi ra ngoài board.' };
  }
  const occ = occupancy(state, ignoreId);
  for (const leg of legs) {
    if (occ.has(leg.hole)) return { ok: false, reason: 'Lỗ ' + leg.hole + ' đã có chân cắm.' };
  }
  if (type !== 'pic') {
    for (const leg of legs) {
      const p = parseHole(leg.hole);
      if (p.r >= 1 && p.r <= 7 && p.c >= PIC_COL && p.c < PIC_COL + 20) {
        return { ok: false, reason: 'Chân nằm dưới thân chip PIC.' };
      }
    }
  }
  return { ok: true, legs };
}

// ---------------------------------------------------------------------------
// Net (union-find trên strip): dây và điện trở nối các strip với nhau.
// ---------------------------------------------------------------------------
function makeUnionFind() {
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ensure = (k) => { if (!parent.has(k)) parent.set(k, k); };
  return { find, union, ensure };
}

// Nhóm các terminal theo net: { groups: Map root -> {terms, vcc, gnd, strips},
//   termRoot: Map term -> root, resistorRoots: Set root }.
// - terminal = 'LED0.A', 'PIC.RB0'...
// - điện trở nối 2 strip của nó (như 1 dây); dây nối 2 strip của 2 đầu.
// - nhóm chạm RAIL+ là +5V, chạm RAIL- là GND.
export function buildBenchNets(state) {
  const { find, union, ensure } = makeUnionFind();
  ensure('RAIL+');
  ensure('RAIL-');
  const termStrip = new Map();
  const resistorStrips = new Set();
  for (const comp of state.components) {
    if (comp.type === 'pic') {
      for (const leg of picLegs()) {
        const key = stripKey(leg.hole);
        if (!key) continue;
        ensure(key);
        termStrip.set(leg.term, key);
      }
      continue;
    }
    if (comp.type === 'psu') continue;
    const legs = legsFor(comp);
    if (comp.type === 'resistor') {
      const keys = legs.map((l) => stripKey(l.hole)).filter(Boolean);
      keys.forEach((k) => { ensure(k); resistorStrips.add(k); });
      for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
      continue;
    }
    for (const leg of legs) {
      const key = stripKey(leg.hole);
      if (!key) continue;
      ensure(key);
      termStrip.set(comp.id + '.' + leg.term, key);
    }
  }
  for (const w of state.wires) {
    const ka = typeof w.a === 'string' ? stripKey(w.a) : null;
    const kb = typeof w.b === 'string' ? stripKey(w.b) : null;
    if (ka && kb) { ensure(ka); ensure(kb); union(ka, kb); }
  }
  const groups = new Map();
  for (const [term, key] of termStrip) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, { terms: [], vcc: false, gnd: false, strips: new Set() });
    groups.get(root).terms.push(term);
    groups.get(root).strips.add(key);
  }
  const vccRoot = find('RAIL+');
  const gndRoot = find('RAIL-');
  for (const [root, g] of groups) {
    g.vcc = root === vccRoot;
    g.gnd = root === gndRoot;
  }
  const resistorRoots = new Set([...resistorStrips].map((k) => find(k)));
  return { groups, termRoot: new Map([...termStrip].map(([t, k]) => [t, find(k)])), resistorRoots, find };
}

// Mô tả 1 terminal: các thành viên cùng net (chân PIC, VCC/GND, đầu linh kiện).
export function describeTerminal(state, term) {
  const { groups, termRoot } = buildBenchNets(state);
  const root = termRoot.get(term);
  if (root === undefined) return { members: [], vcc: false, gnd: false };
  const g = groups.get(root);
  return { members: g.terms, vcc: g.vcc, gnd: g.gnd };
}

// ---------------------------------------------------------------------------
// Dịch trạng thái bàn thành netlist kiểu wiring.js (để resolvePeripherals).
// ---------------------------------------------------------------------------
const KIND_LABEL = { led: 'LED', button: 'Nút', pot: 'Chiết áp', lcd: 'LCD', buzzer: 'Còi' };
export function compLabel(comp) {
  const n = comp.id.replace(/^[A-Z]+/, '');
  if (comp.type === 'pic') return 'PIC16F877A';
  if (comp.type === 'psu') return 'Nguồn 5V';
  if (comp.type === 'resistor') return 'R' + n + ' (' + (comp.props?.value ?? 220) + 'Ω)';
  return (KIND_LABEL[comp.type] || comp.type) + ' ' + n;
}

export function benchToNetlist(state) {
  const { groups, termRoot, resistorRoots, find } = buildBenchNets(state);
  const components = [];
  for (const comp of state.components) {
    if (comp.type === 'pic' || comp.type === 'psu' || comp.type === 'resistor') continue;
    const c = {
      id: comp.id, kind: comp.type, label: compLabel(comp),
      x: 0, y: 0, fixed: !!comp.fixed,
    };
    if (comp.type === 'led') {
      // LED có điện trở nối tiếp nếu net của anode chứa strip của 1 điện trở
      const root = termRoot.get(comp.id + '.A');
      c.hasResistor = !!(root && resistorRoots.has(root));
    }
    components.push(c);
  }
  const wires = [];
  let n = 1;
  for (const [, g] of groups) {
    const ts = g.terms;
    for (let i = 1; i < ts.length; i++) wires.push({ id: 'BW' + (n++), a: ts[i - 1], b: ts[i] });
    if (g.vcc && ts.length) wires.push({ id: 'BW' + (n++), a: ts[0], b: 'VCC' });
    if (g.gnd && ts.length) wires.push({ id: 'BW' + (n++), a: ts[0], b: 'GND' });
  }
  // Dây nối rail + với rail − (nối tắt nguồn): đưa vào netlist để checkWiring thấy
  if (find('RAIL+') === find('RAIL-')) wires.push({ id: 'BW' + (n++), a: 'VCC', b: 'GND' });
  return { components, wires };
}

// ---------------------------------------------------------------------------
// Id linh kiện mới (khớp mẫu wiring.js: LED0, BTN0, POT0, LCD0, BUZ0, R0).
// ---------------------------------------------------------------------------
const ID_PREFIX = { led: 'LED', resistor: 'R', button: 'BTN', pot: 'POT', lcd: 'LCD', buzzer: 'BUZ', psu: 'PSU' };
export function nextComponentId(state, type) {
  const pre = ID_PREFIX[type] || 'C';
  let n = -1;
  for (const c of state.components) {
    const m = c.id.match(new RegExp('^' + pre + '(\\d+)$'));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return pre + (n + 1);
}

export function defaultProps(type) {
  if (type === 'led') return { color: '#DC2626' };
  if (type === 'resistor') return { value: 220 };
  if (type === 'pot') return { pct: 0 };
  return {};
}

// Trạng thái bàn mặc định: chip PIC cắm sẵn (cột 22..41, hàng b/h), nguồn 5V
// trên bàn, dây nguồn VDD/VSS/MCLR về rail.
export function defaultBenchState() {
  return {
    components: [
      { id: 'PIC1', type: 'pic', anchor: 'b22', rot: 0, fixed: true, props: {} },
      { id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: {} },
    ],
    wires: [
      { id: 'W1', a: 'b22', b: 'T+22', color: '#DC2626' }, // MCLR (chân 1) -> +rail
      { id: 'W2', a: 'b32', b: 'T+32', color: '#DC2626' }, // VDD (chân 11) -> +rail
      { id: 'W3', a: 'h30', b: 'T+30', color: '#DC2626' }, // VDD (chân 32) -> +rail
      { id: 'W4', a: 'b33', b: 'T-33', color: '#0F172A' }, // VSS (chân 12) -> -rail
      { id: 'W5', a: 'h31', b: 'T-31', color: '#0F172A' }, // VSS (chân 31) -> -rail
      { id: 'W6', a: { x: -12, y: 28, z: -108 }, b: 'T+40', color: '#DC2626' }, // cọc + nguồn -> +rail
      { id: 'W7', a: { x: 12, y: 28, z: -108 }, b: 'T-40', color: '#0F172A' }, // cọc - nguồn -> -rail
    ],
  };
}

// Lọc trạng thái đọc từ localStorage: chỉ giữ linh kiện/dây còn hợp lệ.
export function sanitizeState(raw) {
  if (!raw || !Array.isArray(raw.components) || !Array.isArray(raw.wires)) return defaultBenchState();
  const components = [];
  for (const c of raw.components) {
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string') continue;
    if (c.type === 'pic') { components.push({ id: 'PIC1', type: 'pic', anchor: 'b22', rot: 0, fixed: true, props: {} }); continue; }
    if (c.type === 'psu') {
      if (typeof c.tx === 'number' && typeof c.tz === 'number') {
        components.push({ id: c.id, type: 'psu', tx: c.tx, tz: c.tz, fixed: true, props: {} });
      }
      continue;
    }
    if (!LEG_LAYOUTS[c.type] || !parseHole(c.anchor)) continue;
    const chk = canPlace({ components }, c.type, c.anchor, c.rot || 0);
    if (!chk.ok) continue;
    components.push({ id: c.id, type: c.type, anchor: c.anchor, rot: c.rot || 0, props: c.props || defaultProps(c.type) });
  }
  if (!components.some((c) => c.type === 'pic')) {
    components.unshift({ id: 'PIC1', type: 'pic', anchor: 'b22', rot: 0, fixed: true, props: {} });
  }
  if (!components.some((c) => c.type === 'psu')) {
    components.push({ id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: {} });
  }
  const wires = [];
  for (const w of raw.wires) {
    if (!w || typeof w.id !== 'string' || typeof w.color !== 'string') continue;
    const okEnd = (e) => (typeof e === 'string' && !!parseHole(e))
      || (e && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.z === 'number');
    if (okEnd(w.a) && okEnd(w.b)) wires.push({ id: w.id, a: w.a, b: w.b, color: w.color });
  }
  return { components, wires };
}

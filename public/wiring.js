// wiring.js — Netlist breadboard cho PIC16F877A (không phụ thuộc DOM).
// Model: netlist = { components: [...], wires: [...] }.
//  - Terminal ID: 'PIC.RB0' (chân chip), 'VCC' / 'GND' (thanh nguồn),
//    '<id>.<term>' (đầu nối linh kiện, vd 'LED0.A', 'LCD1.D3').
//  - resolvePeripherals(netlist) biến netlist thành cấu hình ngoại vi mà
//    CPU (pic16.js) hiểu: LED nào nối chân nào, nút nào nối chân nào,
//    wiper chiết áp nối kênh AN nào, LCD RS/E/Dx nối chân nào...
//  - checkWiring(netlist, tris?) kiểm tra đấu nối kiểu Ohmimic (mức đơn giản).
// Chạy được cả trong trình duyệt (ES module) lẫn Node để test tự động.

// ---------------------------------------------------------------------------
// Chân chip PIC16F877A (DIP-40), theo datasheet
// ---------------------------------------------------------------------------
export const PIC_PINS = [
  { num: 1, id: 'MCLR', label: 'MCLR', port: null, bit: null },
  { num: 2, id: 'RA0', label: 'RA0/AN0', port: 0, bit: 0, analog: 0 },
  { num: 3, id: 'RA1', label: 'RA1/AN1', port: 0, bit: 1, analog: 1 },
  { num: 4, id: 'RA2', label: 'RA2/AN2', port: 0, bit: 2, analog: 2 },
  { num: 5, id: 'RA3', label: 'RA3/AN3', port: 0, bit: 3, analog: 3 },
  { num: 6, id: 'RA4', label: 'RA4/T0CKI', port: 0, bit: 4 },
  { num: 7, id: 'RA5', label: 'RA5/AN4', port: 0, bit: 5, analog: 4 },
  { num: 8, id: 'RE0', label: 'RE0/AN5', port: 4, bit: 0, analog: 5 },
  { num: 9, id: 'RE1', label: 'RE1/AN6', port: 4, bit: 1, analog: 6 },
  { num: 10, id: 'RE2', label: 'RE2/AN7', port: 4, bit: 2, analog: 7 },
  { num: 11, id: 'VDD', label: 'VDD', port: null, bit: null },
  { num: 12, id: 'VSS', label: 'VSS', port: null, bit: null },
  { num: 13, id: 'OSC1', label: 'OSC1', port: null, bit: null },
  { num: 14, id: 'OSC2', label: 'OSC2', port: null, bit: null },
  { num: 15, id: 'RC0', label: 'RC0/T1OSO', port: 2, bit: 0 },
  { num: 16, id: 'RC1', label: 'RC1/CCP2', port: 2, bit: 1 },
  { num: 17, id: 'RC2', label: 'RC2/CCP1', port: 2, bit: 2 },
  { num: 18, id: 'RC3', label: 'RC3/SCK', port: 2, bit: 3 },
  { num: 19, id: 'RD0', label: 'RD0', port: 3, bit: 0 },
  { num: 20, id: 'RD1', label: 'RD1', port: 3, bit: 1 },
  { num: 21, id: 'RD2', label: 'RD2', port: 3, bit: 2 },
  { num: 22, id: 'RD3', label: 'RD3', port: 3, bit: 3 },
  { num: 23, id: 'RC4', label: 'RC4/SDI', port: 2, bit: 4 },
  { num: 24, id: 'RC5', label: 'RC5/SDO', port: 2, bit: 5 },
  { num: 25, id: 'RC6', label: 'RC6/TX', port: 2, bit: 6 },
  { num: 26, id: 'RC7', label: 'RC7/RX', port: 2, bit: 7 },
  { num: 27, id: 'RD4', label: 'RD4', port: 3, bit: 4 },
  { num: 28, id: 'RD5', label: 'RD5', port: 3, bit: 5 },
  { num: 29, id: 'RD6', label: 'RD6', port: 3, bit: 6 },
  { num: 30, id: 'RD7', label: 'RD7', port: 3, bit: 7 },
  { num: 31, id: 'VSS', label: 'VSS', port: null, bit: null },
  { num: 32, id: 'VDD', label: 'VDD', port: null, bit: null },
  { num: 33, id: 'RB0', label: 'RB0/INT', port: 1, bit: 0 },
  { num: 34, id: 'RB1', label: 'RB1', port: 1, bit: 1 },
  { num: 35, id: 'RB2', label: 'RB2', port: 1, bit: 2 },
  { num: 36, id: 'RB3', label: 'RB3/PGM', port: 1, bit: 3 },
  { num: 37, id: 'RB4', label: 'RB4', port: 1, bit: 4 },
  { num: 38, id: 'RB5', label: 'RB5', port: 1, bit: 5 },
  { num: 39, id: 'RB6', label: 'RB6/PGC', port: 1, bit: 6 },
  { num: 40, id: 'RB7', label: 'RB7/PGD', port: 1, bit: 7 },
];
// PIN_BY_ID: id -> pin đầu tiên mang id đó (VDD/VSS có 2 chân, lấy chân đầu)
export const PIN_BY_ID = {};
for (const p of PIC_PINS) if (!(p.id in PIN_BY_ID)) PIN_BY_ID[p.id] = p;

export const SIGNAL_COLORS = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C'];

// ---------------------------------------------------------------------------
// Định nghĩa linh kiện: mỗi loại có các đầu nối (terminal) riêng
// ---------------------------------------------------------------------------
export const COMPONENT_DEFS = {
  led: { name: 'LED', terms: ['A', 'K'], termLabels: { A: 'Anode (+)', K: 'Cathode (−)' } },
  button: { name: 'Nút nhấn', terms: ['T1', 'T2'], termLabels: { T1: 'Chân 1', T2: 'Chân 2' } },
  pot: { name: 'Chiết áp', terms: ['VCC', 'W', 'GND'], termLabels: { VCC: '+5V', W: 'Wiper', GND: 'GND' } },
  lcd: { name: 'LCD 16x2', terms: ['VSS', 'VDD', 'RS', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], termLabels: { VSS: 'VSS (GND)', VDD: 'VDD (+5V)', RS: 'RS', E: 'E', D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4', D5: 'D5', D6: 'D6', D7: 'D7' } },
  buzzer: { name: 'Còi buzzer', terms: ['P', 'N'], termLabels: { P: 'Chân +', N: 'Chân −' } },
  // LED 7 thanh: 8 đoạn (a–g + dp) + 1 chân chung COM. Thứ tự khớp
  // LEG_LAYOUTS trong bench-model.js (hàng trên a/b/c/d/dp, hàng dưới
  // e/f/g/COM). Chân chung loại 'cathode' (chung về GND, đoạn sáng khi
  // mức 1) hoặc 'anode' (chung về VCC, đoạn sáng khi mức 0).
  sevenseg: { name: 'LED 7 thanh', terms: ['a', 'b', 'c', 'd', 'dp', 'e', 'f', 'g', 'COM'], termLabels: { a: 'Đoạn a', b: 'Đoạn b', c: 'Đoạn c', d: 'Đoạn d', dp: 'Chấm thập phân', e: 'Đoạn e', f: 'Đoạn f', g: 'Đoạn g', COM: 'Chân chung' } },
  // Bàn phím ma trận 4x4: 4 hàng R0–R3 (PIC lái xuống mức 0 để quét) +
  // 4 cột C0–C3 (PIC đọc, pull-up). Thứ tự khớp LEG_LAYOUTS trong
  // bench-model.js (hàng trên R0–R3, hàng dưới C0–C3, cách nhau 5 hàng).
  keypad: { name: 'Bàn phím 4x4', terms: ['R0', 'R1', 'R2', 'R3', 'C0', 'C1', 'C2', 'C3'], termLabels: { R0: 'Hàng 0', R1: 'Hàng 1', R2: 'Hàng 2', R3: 'Hàng 3', C0: 'Cột 0', C1: 'Cột 1', C2: 'Cột 2', C3: 'Cột 3' } },
  // Động cơ DC: 2 chân +/−, tải trở trong solver (xem circuit-solver.js).
  motor: { name: 'Động cơ DC', terms: ['+', '-'], termLabels: { '+': 'Chân +', '-': 'Chân −' } },
};
// Nhãn phím của bàn phím 4x4 theo hàng/cột: hàng 0 = 1,2,3,A ...
export const KEYPAD_KEYS = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];

export function componentTerminals(comp) {
  return COMPONENT_DEFS[comp.kind].terms.map((t) => `${comp.id}.${t}`);
}

const KIND_PREFIX = { led: 'LED', button: 'BTN', pot: 'POT', lcd: 'LCD', buzzer: 'BUZ', keypad: 'KP', motor: 'M' };
const KIND_LABEL = { led: 'LED', button: 'Nút', pot: 'Chiết áp', lcd: 'LCD', buzzer: 'Còi', keypad: 'Bàn phím 4x4', motor: 'Động cơ DC' };

export function nextComponentId(netlist, kind) {
  const pre = KIND_PREFIX[kind];
  let n = -1;
  for (const c of netlist.components) {
    const m = c.id.match(new RegExp(`^${pre}(\\d+)$`));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return pre + (n + 1);
}

export function createComponent(kind, id, x, y) {
  const num = id.replace(/^[A-Z]+/, '');
  const comp = { id, kind, label: `${KIND_LABEL[kind]} ${num}`, x, y, fixed: false };
  if (kind === 'led') comp.hasResistor = true; // LED thêm từ khay luôn kèm điện trở 220Ω
  return comp;
}

// ---------------------------------------------------------------------------
// Mạch mẫu mặc định: đúng board cũ (LED PORTB, nút RC0–RC3, LCD PORTD/RE0/RE1,
// chiết áp AN0). VDD/VSS/MCLR nối sẵn nguồn (không phải dây do user đi).
// ---------------------------------------------------------------------------
export function defaultNetlist() {
  const components = [];
  const wires = [];
  let wseq = 1;
  const wire = (a, b) => wires.push({ id: 'W' + (wseq++), a, b });
  // 8 LED trên PORTB, mỗi LED kèm điện trở 220Ω, cathode về GND
  for (let i = 0; i < 8; i++) {
    components.push({ id: 'LED' + i, kind: 'led', label: 'RB' + i, x: 640 + i * 38, y: 130, fixed: true, hasResistor: true });
    wire('LED' + i + '.A', 'PIC.RB' + i);
    wire('LED' + i + '.K', 'GND');
  }
  // 4 nút nhấn RC0–RC3, đầu còn lại về GND (active-low)
  for (let i = 0; i < 4; i++) {
    components.push({ id: 'BTN' + i, kind: 'button', label: 'RC' + i, x: 130, y: 300 + i * 72, fixed: true });
    wire('BTN' + i + '.T1', 'PIC.RC' + i);
    wire('BTN' + i + '.T2', 'GND');
  }
  // Chiết áp: VCC – wiper AN0 (RA0) – GND
  components.push({ id: 'POT1', kind: 'pot', label: 'Chiết áp AN0', x: 140, y: 120, fixed: true });
  wire('POT1.VCC', 'VCC');
  wire('POT1.W', 'PIC.RA0');
  wire('POT1.GND', 'GND');
  // LCD 16x2: RS=RE0, E=RE1, D0–D7 = RD0–RD7; nguồn VDD→+5V, VSS→GND
  // (như thật — LCD không nguồn thì không hiện chữ).
  components.push({ id: 'LCD1', kind: 'lcd', label: 'LCD 16x2', x: 330, y: 690, fixed: true });
  wire('LCD1.RS', 'PIC.RE0');
  wire('LCD1.E', 'PIC.RE1');
  for (let i = 0; i < 8; i++) wire('LCD1.D' + i, 'PIC.RD' + i);
  wire('LCD1.VDD', 'VCC');
  wire('LCD1.VSS', 'GND');
  return { components, wires };
}

// ---------------------------------------------------------------------------
// Phân giải net (union-find): các terminal nối dây với nhau thì cùng 1 net
// ---------------------------------------------------------------------------
export function buildNets(netlist) {
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const all = new Set(['VCC', 'GND']);
  for (const p of PIC_PINS) all.add('PIC.' + p.id);
  for (const c of netlist.components) for (const t of componentTerminals(c)) all.add(t);
  for (const t of all) parent.set(t, t);
  for (const w of netlist.wires) {
    if (parent.has(w.a) && parent.has(w.b)) union(w.a, w.b);
  }
  const nets = new Map();
  for (const t of all) {
    const r = find(t);
    if (!nets.has(r)) nets.set(r, { id: r, members: [] });
    nets.get(r).members.push(t);
  }
  const netOf = new Map();
  for (const [root, net] of nets) for (const m of net.members) netOf.set(m, root);
  return { netOf, nets: [...nets.values()] };
}

// ---------------------------------------------------------------------------
// Ánh xạ netlist -> cấu hình ngoại vi cho CPU
// pressedKeypad (tùy chọn): phím bàn phím đang nhấn giữ {id, row, col}.
// Phím nhấn nối hàng với cột thành 1 net (công tắc đóng) — chỉ tính cho
// kiểm tra "có nguồn" (VCC/GND) của LED/còi/7 thanh/chiết áp (xem
// hasTermClosed dưới), KHÔNG cho picPinInNet: mapping chân lấy từ
// netlist chưa nhấn (phím nhấn không được làm CPU tưởng chân hàng là
// chân cột, vd R1 lấy nhầm RD1). Netlist đưa vào CPU luôn là netlist
// chưa nhấn (xem syncToCpu trong bench.js); phím nhấn chỉ truyền riêng
// vào đây (và vào solver, xem circuit-solver.js) để 1 mạch chỉ có 1 đáp
// án: vôn kế đọc 5V qua phím nhấn thì LED cũng sáng.
// ---------------------------------------------------------------------------
export function resolvePeripherals(netlist, pressedKeypad = null) {
  const { netOf, nets } = buildNets(netlist);
  // Điện áp danh định của nguồn (benchToNetlist mang theo netlist.psu.volts):
  // LED nối VCC chỉ sáng khi 0 < volts ≤ 10: 0V thì net VCC không có điện,
  // trên 10V thì LED tắt trong lúc điện áp cao (không cháy vĩnh viễn, hạ
  // xuống ≤10V thì sáng lại). Netlist không mang psu thì mặc định coi như
  // 5V (tương thích netlist cũ như defaultNetlist).
  const psuVoltsRaw = Number(netlist.psu?.volts);
  const psuLedOn = !Number.isFinite(psuVoltsRaw) ? true : (psuVoltsRaw > 0 && psuVoltsRaw <= 10);
  const membersOf = (term) => {
    const root = netOf.get(term);
    if (!root) return [];
    const net = nets.find((n) => n.id === root);
    return net ? net.members : [];
  };
  const hasTerm = (term, t) => membersOf(term).includes(t);
  const picPinInNet = (term) => {
    for (const m of membersOf(term)) {
      if (m.startsWith('PIC.')) {
        const pin = PIN_BY_ID[m.slice(4)];
        if (pin && pin.port !== null) return pin;
      }
    }
    return null;
  };
  // Phím bàn phím đang nhấn nối hàng với cột thành 1 net: 1 đầu nối ở
  // net hàng thì "thấy" VCC/GND của net cột và ngược lại. CHỈ dùng cho
  // kiểm tra "có nguồn" (hasTermClosed) — KHÔNG dùng cho picPinInNet ở
  // trên (mapping chân lấy từ netlist chưa nhấn).
  const keyRowTerm = pressedKeypad && pressedKeypad.id
    ? pressedKeypad.id + '.R' + pressedKeypad.row : null;
  const keyColTerm = pressedKeypad && pressedKeypad.id
    ? pressedKeypad.id + '.C' + pressedKeypad.col : null;
  const hasTermClosed = (term, t) => {
    if (hasTerm(term, t)) return true;
    if (!keyRowTerm || !keyColTerm) return false;
    const members = membersOf(term);
    if (members.includes(keyRowTerm)) return hasTerm(keyColTerm, t);
    if (members.includes(keyColTerm)) return hasTerm(keyRowTerm, t);
    return false;
  };
  // Màu cho từng net: VCC đỏ, GND đen, tín hiệu xoay vòng bảng màu
  let sigIdx = 0;
  const netColor = new Map();
  for (const n of nets) {
    if (n.members.includes('VCC')) netColor.set(n.id, '#DC2626');
    else if (n.members.includes('GND')) netColor.set(n.id, '#0F172A');
    else netColor.set(n.id, SIGNAL_COLORS[sigIdx++ % SIGNAL_COLORS.length]);
  }
  const netsOut = nets.map((n) => ({
    id: n.id, members: n.members,
    kind: n.members.includes('VCC') ? 'vcc' : n.members.includes('GND') ? 'gnd' : 'signal',
    color: netColor.get(n.id),
  }));

  const leds = netlist.components.filter((c) => c.kind === 'led').map((c) => ({
    id: c.id, label: c.label, hasResistor: c.hasResistor !== false,
    pin: picPinInNet(c.id + '.A'),
    // Cathode về GND và anode nối VCC: tính cả đường qua phím bàn phím
    // đang nhấn (hasTermClosed) — VCC -> hàng phím, cột phím -> anode
    // thì LED sáng khi nhấn phím, như solver (1 mạch, 1 đáp án).
    gnd: hasTermClosed(c.id + '.K', 'GND'),
    // Anode nối net VCC chỉ tính là "có nguồn" khi 0 < psu.volts ≤ 10.
    // 0V thì net VCC không có điện, trên 10V thì LED tắt trong lúc điện
    // áp cao. Netlist không mang psu (vd defaultNetlist) thì mặc định 5V.
    vccAnode: psuLedOn && hasTermClosed(c.id + '.A', 'VCC'),
    cathPin: picPinInNet(c.id + '.K'),
  }));
  const buttons = netlist.components.filter((c) => c.kind === 'button').map((c) => {
    const pinT1 = picPinInNet(c.id + '.T1');
    const pinT2 = picPinInNet(c.id + '.T2');
    const pin = pinT1 || pinT2;
    const otherTerm = pinT1 ? c.id + '.T2' : c.id + '.T1';
    const otherLevel = hasTerm(otherTerm, 'VCC') ? 1 : hasTerm(otherTerm, 'GND') ? 0 : null;
    // Chân PIC ở đầu còn lại (nút nối 2 chân PIC với nhau): mức khi nhấn
    // là mức live của chân đó (xem applyButtonToCpu), không phải hằng số.
    const otherPin = pinT1 ? pinT2 : pinT1;
    // Mức khi thả ra: đầu kia là VCC (active-high) thì chân thả nổi về 0
    // (kéo xuống); GND (active-low, pull-up), chân PIC hay nổi thì về 1.
    const idleLevel = otherLevel === 1 ? 0 : 1;
    return { id: c.id, label: c.label, pin, otherLevel, otherPin, idleLevel };
  });
  const pots = netlist.components.filter((c) => c.kind === 'pot').map((c) => {
    const wiper = picPinInNet(c.id + '.W');
    return {
      id: c.id, label: c.label,
      wiper: wiper ? { ...wiper, analog: wiper.analog ?? null } : null,
      vcc: hasTermClosed(c.id + '.VCC', 'VCC'),
      gnd: hasTermClosed(c.id + '.GND', 'GND'),
    };
  });
  const lcdComp = netlist.components.find((c) => c.kind === 'lcd') || null;
  // LCD đủ dây khi nối đủ RS + E + D0–D7 (8-bit) HOẶC RS + E + D4–D7
  // (4-bit, chuẩn HD44780: D0–D3 không cần nối). mode cho pic16.js biết
  // cách chốt dữ liệu (lcdTick: 4-bit chốt từng nibble trên D4–D7).
  // Chưa đủ dây nào: missing liệt kê theo hướng gần đủ hơn (thiếu ít
  // đầu hơn) để thông báo "thiếu: ..." chỉ đúng chỗ cần nối thêm.
  let lcd = { id: null, rs: null, e: null, d: [null, null, null, null, null, null, null, null], complete: false, missing: [], mode: null, fixed: {}, vddWired: false, vssWired: false };
  if (lcdComp) {
    const rs = picPinInNet(lcdComp.id + '.RS');
    const e = picPinInNet(lcdComp.id + '.E');
    const d = [];
    for (let i = 0; i < 8; i++) d.push(picPinInNet(lcdComp.id + '.D' + i));
    // Nguồn LCD (như thật): VDD/VSS đã nối dây chưa — net có hơn 1
    // thành viên nghĩa là chân đã nối tới đâu đó (dây, rail, chân khác
    // chung strip). Dùng cho checkWiring cảnh báo thiếu nguồn.
    const vddWired = membersOf(lcdComp.id + '.VDD').length > 1;
    const vssWired = membersOf(lcdComp.id + '.VSS').length > 1;
    // Đầu nối LCD nối tới rail cố định (VCC/GND) mà không phải chân PIC:
    // RS/E/Dx có mức cố định, không điều khiển được bằng code — ghi lại
    // để checkWiring báo "đã nối tới +5V (mức cố định)" thay vì "thiếu
    // RS" (Issue 14c: RS→VCC có mặt, chỉ cố định mức, không phải thiếu).
    const fixed = {};
    for (const t of ['RS', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) {
      if (hasTerm(lcdComp.id + '.' + t, 'VCC')) fixed[t] = 'VCC';
      else if (hasTerm(lcdComp.id + '.' + t, 'GND')) fixed[t] = 'GND';
    }
    const missing8 = [];
    if (!rs) missing8.push('RS');
    if (!e) missing8.push('E');
    d.forEach((p, i) => { if (!p) missing8.push('D' + i); });
    const missing4 = [];
    if (!rs) missing4.push('RS');
    if (!e) missing4.push('E');
    d.slice(4).forEach((p, i) => { if (!p) missing4.push('D' + (i + 4)); });
    if (missing8.length === 0) {
      lcd = { id: lcdComp.id, rs, e, d, complete: true, missing: [], mode: '8bit', fixed, vddWired, vssWired };
    } else if (missing4.length === 0) {
      lcd = { id: lcdComp.id, rs, e, d, complete: true, missing: [], mode: '4bit', fixed, vddWired, vssWired };
    } else {
      lcd = { id: lcdComp.id, rs, e, d, complete: false, missing: missing4.length < missing8.length ? missing4 : missing8, mode: null, fixed, vddWired, vssWired };
    }
  }
  const buzzers = netlist.components.filter((c) => c.kind === 'buzzer').map((c) => ({
    id: c.id, label: c.label,
    pin: picPinInNet(c.id + '.P'),
    // Chân − cũng có thể là chân PIC (low-side drive, như cathPin của
    // LED): P→VCC, N→RB0 ngõ ra mức 0 thì còi kêu.
    nPin: picPinInNet(c.id + '.N'),
    // Chân − về GND và chân + nối VCC: tính cả đường qua phím bàn phím
    // đang nhấn (hasTermClosed), như LED ở trên.
    gnd: hasTermClosed(c.id + '.N', 'GND'),
    // Chân + nối net VCC chỉ tính là "có nguồn" khi 0 < psu.volts ≤ 10
    // (cùng quy tắc LED nối VCC).
    vccP: psuLedOn && hasTermClosed(c.id + '.P', 'VCC'),
  }));
  // LED 7 thanh: mỗi đoạn ghi lại chân PIC trong net của nó (nếu có) và
  // net đó có VCC/GND không; chân chung COM cũng vậy. Trạng thái sáng/
  // tắt của từng đoạn tính ở sevenSegStates (cần mức chân của CPU).
  const sevensegs = netlist.components.filter((c) => c.kind === 'sevenseg').map((c) => {
    const termInfo = (t) => ({
      pin: picPinInNet(c.id + '.' + t),
      // VCC/GND của từng đoạn và chân chung: tính cả đường qua phím bàn
      // phím đang nhấn (hasTermClosed), như LED ở trên.
      vcc: hasTermClosed(c.id + '.' + t, 'VCC'),
      gnd: hasTermClosed(c.id + '.' + t, 'GND'),
    });
    const seg = {};
    for (const t of SEVEN_SEG_TERMS) seg[t] = termInfo(t);
    return {
      id: c.id, label: c.label,
      common: c.common === 'anode' ? 'anode' : 'cathode',
      seg, com: termInfo('COM'),
    };
  });
  // Bàn phím ma trận 4x4: 4 hàng R0–R3 và 4 cột C0–C3, mỗi đầu nối ghi
  // lại chân PIC trong net của nó (nếu có). Mức cột khi quét tính ở
  // CPU (pinLevel, xem pic16.js) theo phím đang nhấn + mức hàng, không
  // tính ở đây.
  const keypads = netlist.components.filter((c) => c.kind === 'keypad').map((c) => ({
    id: c.id, label: c.label,
    rows: ['R0', 'R1', 'R2', 'R3'].map((t) => picPinInNet(c.id + '.' + t)),
    cols: ['C0', 'C1', 'C2', 'C3'].map((t) => picPinInNet(c.id + '.' + t)),
  }));
  return { leds, buttons, pots, lcd, buzzers, sevensegs, keypads, nets: netsOut, netOf, psuLedOn };
}

// Điện áp đã giải của 1 đầu nối ('LED0.A', 'PIC.RB0', 'VCC', 'GND'):
// tra node của đầu nối qua nets (kết quả buildSolverNets trong
// circuit-solver.js) rồi đọc nodeVoltage (Map node -> volt, null =
// floating). Trả số volt, hoặc null nếu đầu nối chưa nối dây / node
// floating / đầu nối không hợp lệ.
// Bản cũ (cpu, members) chỉ biết VCC=1, GND=0, chân PIC -> mức chân,
// nên LED/còi/đoạn 7 thanh sau chiết áp hay cầu phân áp không bao giờ
// bật; bản mới trả điện áp thật đã giải nên thống nhất được 2 mô hình
// mạch (logic VCC/GND/PIC và solver MNA): solver dùng chính hàm này
// để quyết định diode bật/tắt (xem solveCircuit trong circuit-solver.js).
export function netLevel(nodeVoltage, nets, term) {
  if (!nodeVoltage || !nets || typeof term !== 'string') return null;
  let node = null;
  if (term === 'VCC') node = nets.railPlus;
  else if (term === 'GND') node = nets.railMinus;
  else if (term.startsWith('PIC.')) node = nets.nodeOfPicPin(term.slice(4));
  else {
    const dot = term.indexOf('.');
    if (dot > 0) node = nets.nodeOfTerm(term.slice(0, dot), term.slice(dot + 1));
  }
  if (!node) return null;
  const v = nodeVoltage.get(node);
  return (v === null || v === undefined) ? null : v;
}

// --- Đường LEGACY cho ledStates/buzzerStates/sevenSegStates (chỉ dùng
// cho các test wiring cũ) ---
// Các test wiring cũ gọi ledStates(cpu, mapping) với netlist
// defaultNetlist — không có bench state nên không giải solver được.
// Trong các test đó LED/còi/đoạn chỉ nối chân PIC/VCC/GND (không có
// chiết áp/cầu phân áp), nên tính điện áp 2 đầu từ mapping + mức chân
// CPU rồi áp ngưỡng ≥2V như solver cho cùng kết quả. Đừng dùng dạng
// (cpu, mapping) cho bàn 3D hay test mới — nó KHÔNG thấy điện áp
// chiết áp/cầu phân áp; bàn 3D và test mới phải dùng dạng
// (solveResult, state).
function pinVoltsLegacy(cpu, pin) {
  if (!pin || pin.port === null || pin.port === undefined) return null;
  if (cpu.pinDirection(pin.port, pin.bit) !== 'out') return null;
  return cpu.pinLevel(pin.port, pin.bit) === 1 ? 5 : 0;
}
function ledStatesLegacy(cpu, mapping) {
  return mapping.leds.map((led) => {
    const vA = led.vccAnode ? 5 : pinVoltsLegacy(cpu, led.pin);
    const vK = led.gnd ? 0 : pinVoltsLegacy(cpu, led.cathPin);
    return { id: led.id, on: vA !== null && vK !== null && (vA - vK) >= 2 };
  });
}
function buzzerStatesLegacy(cpu, mapping) {
  return mapping.buzzers.map((bz) => {
    const vP = bz.vccP ? 5 : pinVoltsLegacy(cpu, bz.pin);
    // Như LED (cathPin): chân − cũng có thể là chân PIC ngõ ra — P→VCC,
    // N→RB0=0 thì kêu; N→RB0=1 thì tắt; N nổi (không GND, không chân
    // output) thì không kêu.
    const vN = bz.gnd ? 0 : pinVoltsLegacy(cpu, bz.nPin);
    return { id: bz.id, on: vP !== null && vN !== null && (vP - vN) >= 2 };
  });
}
function sevenSegStatesLegacy(cpu, mapping) {
  const psuLedOn = mapping.psuLedOn !== false;
  const levelOf = (info) => {
    if (!info) return null;
    if (info.vcc && psuLedOn) return 5;
    if (info.gnd) return 0;
    return pinVoltsLegacy(cpu, info.pin);
  };
  return (mapping.sevensegs || []).map((seg) => {
    const vCom = levelOf(seg.com);
    const on = {};
    for (const t of SEVEN_SEG_TERMS) {
      const vS = levelOf(seg.seg[t]);
      let lit = false;
      if (vS !== null && vCom !== null) {
        lit = seg.common === 'cathode' ? (vS - vCom) >= 2 : (vCom - vS) >= 2;
      }
      on[t] = lit;
    }
    return { id: seg.id, common: seg.common, on };
  });
}

// Trạng thái LED: SÁNG/TỐI theo kết quả solver (solveCircuit) — cùng 1
// nguồn sự thật với đồng hồ đo và đồng hồ hiện sóng. KHÔNG tự tính từ
// mức logic nữa (bản cũ chỉ biết VCC/GND/chân PIC nên LED sau chiết áp,
// cầu phân áp hay nguồn khác không phải VCC/PIC thì không bao giờ sáng).
// Trả [{id, on}] như cũ.
// Hai dạng gọi: ledStates(solveResult, state) — đường chính (bàn 3D +
// test solver), đọc ledOn từ kết quả solveCircuit; ledStates(cpu,
// mapping) — LEGACY, chỉ cho test wiring cũ (xem chú thích trên).
export function ledStates(a, b) {
  if (a && typeof a.pinLevel === 'function' && b && Array.isArray(b.leds)) {
    return ledStatesLegacy(a, b);
  }
  const solveResult = a, state = b;
  const onMap = solveResult && solveResult.ledOn;
  return (state && state.components ? state.components : [])
    .filter((c) => c.type === 'led')
    .map((c) => ({ id: c.id, on: onMap ? onMap.get(c.id) === true : false }));
}

// LED 7 thanh: 8 đoạn (a–g + dp). Trả [{id, common, on: {a, b, c, d,
// e, f, g, dp}}] — on[t] = đoạn t đang sáng. Trạng thái đoạn lấy từ
// kết quả solver (solveCircuit, đọc segOn) như ledStates — cùng 1 nguồn
// sự thật với đồng hồ đo; KHÔNG tự tính từ mức logic nữa (bản cũ chỉ
// biết VCC/GND/chân PIC nên đoạn nối chiết áp không bao giờ sáng).
// Hai dạng gọi: sevenSegStates(solveResult, state) — đường chính;
// sevenSegStates(cpu, mapping) — LEGACY, chỉ cho test wiring cũ.
export const SEVEN_SEG_TERMS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
export function sevenSegStates(a, b) {
  if (a && typeof a.pinLevel === 'function' && b && Array.isArray(b.sevensegs)) {
    return sevenSegStatesLegacy(a, b);
  }
  const solveResult = a, state = b;
  const segOn = solveResult && solveResult.segOn;
  return (state && state.components ? state.components : [])
    .filter((c) => c.type === 'sevenseg')
    .map((c) => {
      const common = c.props?.common === 'anode' ? 'anode' : 'cathode';
      const on = {};
      for (const t of SEVEN_SEG_TERMS) on[t] = segOn ? segOn.get(c.id + '.' + t) === true : false;
      return { id: c.id, common, on };
    });
}

// Trạng thái còi: KÊU/TẮT theo kết quả solver (solveCircuit, đọc
// buzzerOn) — còi kêu khi điện áp đã giải trên 2 chân P−N ≥
// BUZZER_ON_VOLTS (xem circuit-solver.js). Trả [{id, on}] như cũ.
// Hai dạng gọi: buzzerStates(solveResult, state) — đường chính;
// buzzerStates(cpu, mapping) — LEGACY, chỉ cho test wiring cũ.
export function buzzerStates(a, b) {
  if (a && typeof a.pinLevel === 'function' && b && Array.isArray(b.buzzers)) {
    return buzzerStatesLegacy(a, b);
  }
  const solveResult = a, state = b;
  const onMap = solveResult && solveResult.buzzerOn;
  return (state && state.components ? state.components : [])
    .filter((c) => c.type === 'buzzer')
    .map((c) => ({ id: c.id, on: onMap ? onMap.get(c.id) === true : false }));
}

// Nhấn/thả nút: đóng mạch giữa chân PIC và đầu còn lại (GND=0, VCC=1,
// chân PIC khác = mức live của chân đó lúc nhấn). Thả ra thì chân về
// idleLevel của nút (đầu kia VCC -> 0, GND / chân PIC / nổi -> 1),
// KHÔNG phải lúc nào cũng 1 như trước — nút active-high về VCC mà thả
// vẫn 1 thì CPU không bao giờ thấy lần nhấn.
export function applyButtonToCpu(cpu, mapping, buttonId, pressed) {
  const b = mapping.buttons.find((x) => x.id === buttonId);
  if (!b || !b.pin) return false;
  let level;
  if (pressed) {
    // Đầu kia là chân PIC thì lấy mức live của nó (có thể đổi theo code,
    // vd RB1 đang là ngõ ra mức 0); đầu kia là VCC/GND thì lấy otherLevel.
    level = (b.otherPin && typeof cpu.pinLevel === 'function')
      ? cpu.pinLevel(b.otherPin.port, b.otherPin.bit)
      : (b.otherLevel ?? 1);
  } else {
    level = b.idleLevel ?? 1;
  }
  cpu.setPinInput(b.pin.port, b.pin.bit, level);
  return true;
}

// Chiết áp: wiper nối kênh AN nào thì đặt điện áp cho kênh đó
export function applyPotToCpu(cpu, mapping, potId, volts) {
  const p = mapping.pots.find((x) => x.id === potId);
  if (!p || !p.wiper || p.wiper.analog === null || p.wiper.analog === undefined) return false;
  cpu.setAnalog(p.wiper.analog, volts);
  return true;
}

// Bàn phím ma trận: phím đang nhấn (nhấn giữ) của 1 bàn phím. key =
// {row, col} (0..3) hoặc null (không nhấn phím nào). Chỉ ghi lại phím
// đang nhấn vào CPU (cpu.setKeypadPressed) khi hàng VÀ cột của phím đó
// đều chạm tới chân PIC — keypad chưa nối dây (hàng/cột treo) thì CPU
// không đọc được phím nên không ghi, tránh Inspector hiện "Đang nhấn"
// dù phím chưa nối gì (Issue 16). Mức cột tính ngay lúc CPU đọc chân
// (pinLevel) nên không cần cập nhật portInput ở đây. Trả false nếu
// không có bàn phím đó trong mapping; trả true khi bàn phím có mặt
// (kể cả khi phím chưa nối dây — công tắc hàng/cột vẫn đóng về mặt vật
// lý nên solver/bridge vẫn dùng pressedKeypad để nối mạch, chỉ CPU là
// không ghi phím).
export function applyKeypadToCpu(cpu, mapping, keypadId, key) {
  const kp = (mapping.keypads || []).find((x) => x.id === keypadId);
  if (!kp) return false;
  if (typeof cpu.setKeypadPressed !== 'function') return false;
  if (key) {
    const r = Number(key.row), c = Number(key.col);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 3 || c < 0 || c > 3) return false;
    // Hàng hoặc cột chưa tới chân PIC thì phím này CPU không đọc được:
    // xóa phím đang nhấn (nếu có) thay vì ghi phím mới.
    if (!kp.rows[r] || !kp.cols[c]) { cpu.setKeypadPressed(keypadId, null); return true; }
  }
  cpu.setKeypadPressed(keypadId, key || null);
  return true;
}

// ---------------------------------------------------------------------------
// Kiểm tra đấu nối (kiểu Ohmimic, mức đơn giản).
// checkWiring(netlist, tris?) — tris là mảng [TRISA..TRISE] của CPU (nếu có)
// để phát hiện 2 chân output nối trực tiếp nhau.
// Trả về [{ id, kind: 'short'|'warn', message, wireIds, compIds, terminalIds }]
// ---------------------------------------------------------------------------
export function checkWiring(netlist, tris = null) {
  const { netOf, nets } = buildNets(netlist);
  // Quy tắc LED theo điện áp nguồn: chỉ khi 0 < volts ≤ 10 thì LED nối VCC
  // mới sáng (và cảnh báo "sáng liên tục"/"anode đã có +5V" mới đúng);
  // 0V hoặc trên 10V thì LED tắt nên không cảnh báo sáng. Netlist không
  // mang psu thì mặc định coi như 5V.
  const psuVoltsRaw = Number(netlist.psu?.volts);
  const psuLedOn = !Number.isFinite(psuVoltsRaw) ? true : (psuVoltsRaw > 0 && psuVoltsRaw <= 10);
  const psuOverVolts = Number.isFinite(psuVoltsRaw) && psuVoltsRaw > 10;
  const warnings = [];
  const hasInNet = (members, t) => members.includes(t);
  const wiresInNet = (root) => netlist.wires.filter((w) => netOf.get(w.a) === root || netOf.get(w.b) === root).map((w) => w.id);
  const picPinsInNet = (members) => {
    const out = [];
    for (const m of members) {
      if (m.startsWith('PIC.')) {
        const pin = PIN_BY_ID[m.slice(4)];
        if (pin && pin.port !== null) out.push(pin);
      }
    }
    return out;
  };
  const driverTermsInNet = (members) => {
    // Đầu nối "lái" tín hiệu: wiper chiết áp (nguồn áp thật) và 2 đầu
    // nút nhấn (công tắc nối tới nguồn khác). Anode LED và chân + còi
    // là TẢI (chỉ hút dòng, không lái mức) nên KHÔNG tính: 2 LED cùng
    // 1 chân PIC (vd 2 anode vào RB0) là bình thường, không phải xung
    // đột (Issue 14b). 2 đầu của CÙNG 1 nút bấm chỉ tính là 1 nguồn
    // (nút là công tắc, không phải 2 nguồn tín hiệu): nhấn nút nối
    // T1–T2 vào cùng net thì không được báo chân PIC xung đột với
    // chính cái nút đó.
    const seen = new Set();
    const out = [];
    for (const m of members) {
      const mm = m.match(/^(BTN\d+)\.T[12]$|^(POT\d+)\.W$/);
      if (mm) {
        const compId = mm.slice(1).find(Boolean);
        if (!seen.has(compId)) { seen.add(compId); out.push(m); }
      }
    }
    return out;
  };

  for (const n of nets) {
    // 1. Nối tắt VCC – GND
    if (hasInNet(n.members, 'VCC') && hasInNet(n.members, 'GND')) {
      warnings.push({
        id: 'short-' + n.id, kind: 'short',
        message: 'Nối tắt +5V – GND: net này nối cả thanh +5V và thanh GND, sẽ chập nguồn.',
        wireIds: wiresInNet(n.id), compIds: [], terminalIds: n.members,
      });
    }
    // 5. Hai chân output nối trực tiếp nhau (cần biết TRIS hiện tại)
    if (tris) {
      const pins = picPinsInNet(n.members);
      const outs = pins.filter((p) => ((tris[p.port] >> p.bit) & 1) === 0);
      if (outs.length >= 2) {
        warnings.push({
          id: 'outout-' + n.id, kind: 'short',
          message: `Hai chân output nối trực tiếp nhau: ${outs.map((p) => p.id).join(', ')} đều đang là ngõ ra, có thể làm hỏng chân.`,
          wireIds: wiresInNet(n.id), compIds: [], terminalIds: n.members,
        });
      }
    }
    // 6. Một chân PIC bị 2 nguồn tín hiệu lái cùng lúc
    const pins = picPinsInNet(n.members);
    const drivers = driverTermsInNet(n.members);
    if (pins.length >= 1 && drivers.length >= 2) {
      warnings.push({
        id: 'conflict-' + n.id, kind: 'warn',
        message: `Chân ${pins[0].id} nối tới ${drivers.length} nguồn tín hiệu cùng lúc (${drivers.join(', ')}), mức logic sẽ xung đột.`,
        wireIds: wiresInNet(n.id), compIds: [], terminalIds: n.members,
      });
    }
  }

  // 2. Nút nhấn nối VCC – GND (nhấn sẽ chập nguồn)
  for (const c of netlist.components.filter((x) => x.kind === 'button')) {
    const t1 = buildNets(netlist).nets.find((n) => n.members.includes(c.id + '.T1'));
    const t2 = buildNets(netlist).nets.find((n) => n.members.includes(c.id + '.T2'));
    const t1V = t1 && t1.members.includes('VCC');
    const t1G = t1 && t1.members.includes('GND');
    const t2V = t2 && t2.members.includes('VCC');
    const t2G = t2 && t2.members.includes('GND');
    if ((t1V && t2G) || (t2V && t1G)) {
      warnings.push({
        id: 'btnshort-' + c.id, kind: 'short',
        message: `Nút ${c.label} nối thẳng VCC–GND: nhấn nút sẽ nối tắt nguồn.`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.T1', c.id + '.T2'],
      });
    }
  }

  // 3. LED không qua điện trở / nối thẳng VCC–GND
  for (const c of netlist.components.filter((x) => x.kind === 'led')) {
    if (c.hasResistor === false) {
      warnings.push({
        id: 'ledr-' + c.id, kind: 'warn',
        message: `LED ${c.label} không có điện trở hạn dòng, dễ cháy LED và quá dòng chân PIC.`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.A', c.id + '.K'],
      });
    }
    const aNet = buildNets(netlist).nets.find((n) => n.members.includes(c.id + '.A'));
    const kNet = buildNets(netlist).nets.find((n) => n.members.includes(c.id + '.K'));
    // Chỉ cảnh báo "sáng liên tục" khi LED thật sự sáng liên tục, tức
    // 0 < volts ≤ 10: 0V hoặc trên 10V thì LED không sáng nên không cảnh báo.
    if (psuLedOn && aNet && kNet && aNet.members.includes('VCC') && kNet.members.includes('GND')) {
      warnings.push({
        id: 'ledvcc-' + c.id, kind: 'warn',
        message: `LED ${c.label} nối thẳng VCC–GND nên sẽ sáng liên tục, không điều khiển được bằng code.`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.A', c.id + '.K'],
      });
    }
    // Nguồn quá 10V: LED nối VCC tắt trong lúc điện áp cao (solver giữ
    // lý tưởng, không cháy), nhưng mạch thật thì LED/còi CÓ THỂ CHÁY ở
    // áp này — cảnh báo đúng bản chất đó thay vì chỉ nói "LED không
    // sáng" (Issue 14d). Ghi điện áp thật vào thông báo.
    if (psuOverVolts && aNet && aNet.members.includes('VCC')) {
      warnings.push({
        id: 'ledover-' + c.id, kind: 'warn',
        message: `Nguồn đang ở ${String(Math.round(psuVoltsRaw * 100) / 100)}V, vượt quá 10V — LED ${c.label} có thể cháy trong mạch thật (mô phỏng chỉ tắt LED khi quá 10V, hạ xuống 10V trở xuống thì sáng lại).`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.A', c.id + '.K'],
      });
    }
    if (aNet && kNet && aNet.id === kNet.id) {
      warnings.push({
        id: 'ledshort-' + c.id, kind: 'warn',
        message: `LED ${c.label} anode và cathode nối cùng 1 net (nối tắt 2 đầu LED) nên LED không sáng.`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.A', c.id + '.K'],
      });
    } else if (psuLedOn && aNet && aNet.members.includes('VCC') && kNet && !kNet.members.includes('GND') && kNet.members.length <= 1) {
      warnings.push({
        id: 'lednognd-' + c.id, kind: 'warn',
        message: `LED ${c.label} anode đã có +5V nhưng cathode chưa nối về GND nên LED không sáng — nối cathode về thanh GND.`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.A', c.id + '.K'],
      });
    }
  }

  // Còi nối VCC ở nguồn quá 10V: như LED (Issue 14d) — mô phỏng tắt còi
  // khi quá 10V, mạch thật thì còi có thể cháy.
  for (const c of netlist.components.filter((x) => x.kind === 'buzzer')) {
    if (!psuOverVolts) continue;
    const pNet = buildNets(netlist).nets.find((n) => n.members.includes(c.id + '.P'));
    if (pNet && pNet.members.includes('VCC')) {
      warnings.push({
        id: 'buzover-' + c.id, kind: 'warn',
        message: `Nguồn đang ở ${String(Math.round(psuVoltsRaw * 100) / 100)}V, vượt quá 10V — còi ${c.label} có thể cháy trong mạch thật (mô phỏng chỉ tắt còi khi quá 10V, hạ xuống 10V trở xuống thì kêu lại).`,
        wireIds: [], compIds: [c.id], terminalIds: [c.id + '.P', c.id + '.N'],
      });
    }
  }

  // 4. LCD thiếu dây (lcdMap dùng lại ở quy tắc 7: LCD 4-bit thì D0–D3
  // không nối là đúng, không cảnh báo "chưa nối dây").
  // Đầu nối đã nối tới rail cố định (vd RS→VCC) thì KHÔNG phải "thiếu"
  // — nó có mặt, chỉ ở mức cố định (không điều khiển được bằng code):
  // chỉ còn đầu cố định thì ghi chú info, không cảnh báo thiếu (Issue
  // 14c); còn đầu thật sự thiếu thì cảnh báo thiếu + ghi chú kèm.
  const lcdComp = netlist.components.find((x) => x.kind === 'lcd');
  let lcdMap = null;
  if (lcdComp) {
    lcdMap = resolvePeripherals(netlist);
    if (!lcdMap.lcd.complete) {
      const fixed = lcdMap.lcd.fixed || {};
      const trulyMissing = lcdMap.lcd.missing.filter((t) => !fixed[t]);
      const fixedNote = Object.entries(fixed)
        .filter(([t]) => lcdMap.lcd.missing.includes(t))
        .map(([t, lvl]) => `${t} đã nối tới ${lvl === 'VCC' ? '+5V' : 'GND'} (mức cố định, không điều khiển được bằng code)`)
        .join('; ');
      if (trulyMissing.length > 0) {
        warnings.push({
          id: 'lcd-' + lcdComp.id, kind: 'warn',
          message: `LCD ${lcdComp.label} chưa nối đủ dây — thiếu: ${trulyMissing.join(', ')}. Nối đủ RS, E và D0–D7 (8-bit) hoặc RS, E và D4–D7 (4-bit) thì LCD hiện chữ.` + (fixedNote ? ` ${fixedNote}.` : ''),
          wireIds: [], compIds: [lcdComp.id],
          terminalIds: trulyMissing.map((t) => lcdComp.id + '.' + t),
        });
      } else if (fixedNote) {
        warnings.push({
          id: 'lcd-fixed-' + lcdComp.id, kind: 'info',
          message: `LCD ${lcdComp.label}: ${fixedNote} — LCD vẫn hiện được chữ dữ liệu, nhưng không gửi được lệnh qua chân đó (vd lệnh xóa màn hình cần RS ở mức 0).`,
          wireIds: [], compIds: [lcdComp.id],
          terminalIds: Object.keys(fixed).filter((t) => lcdMap.lcd.missing.includes(t)).map((t) => lcdComp.id + '.' + t),
        });
      }
    }
    // 4b. LCD chưa nối nguồn (như thật: LCD cần VDD/VSS mới hiện chữ).
    // Cảnh báo riêng với thiếu dây dữ liệu ở trên — kể cả khi RS/E/D đã
    // đủ, thiếu nguồn thì màn hình vẫn tối. Nêu rõ chân nào thiếu.
    const missingPower = [];
    if (!lcdMap.lcd.vddWired) missingPower.push('VDD');
    if (!lcdMap.lcd.vssWired) missingPower.push('VSS');
    if (missingPower.length > 0) {
      warnings.push({
        id: 'lcd-power-' + lcdComp.id, kind: 'warn',
        message: `LCD ${lcdComp.label} chưa nối nguồn — thiếu: ${missingPower.join(', ')}. Nối VDD→+5V và VSS→GND thì LCD mới hiện chữ.`,
        wireIds: [], compIds: [lcdComp.id],
        terminalIds: missingPower.map((t) => lcdComp.id + '.' + t),
      });
    }
  }

  // 8. Chip PIC mất nguồn / giữ reset (Issue 8). Chỉ netlist từ bàn 3D
  // (có netlist.psu) mới xét: defaultNetlist() không có chip trên bàn
  // nên mọi chân PIC trong đó đều là singleton, không phân biệt được
  // "chưa nối" với "không có chip". Hạn chế đã biết: VDD có 2 chân
  // (11, 32) nhưng netlist chỉ giữ 1 terminal 'PIC.VDD' (chân 32, xem
  // buildBenchNets) — chỉ nối chân 11 mà không nối chân 32 thì cảnh báo
  // này vẫn hiện dù chip đã có nguồn; solver (tính cả 2 chân) mới là
  // chuẩn cho hành vi chạy. MCLR chỉ cảnh báo khi net chứa GND mà không
  // chứa VCC (2 rail nối tắt nhau thì net chứa cả 2, không tính là
  // MCLR thấp — mạch nối tắt đó đã có cảnh báo riêng).
  if (netlist.psu) {
    const vddNet = nets.find((n) => n.members.includes('PIC.VDD'));
    const vddWired = !!(vddNet && vddNet.members.includes('VCC'));
    const voltsOk = !Number.isFinite(psuVoltsRaw) || (psuVoltsRaw > 0 && psuVoltsRaw <= 5.5);
    if (!vddWired || !voltsOk) {
      let reason;
      if (Number.isFinite(psuVoltsRaw) && psuVoltsRaw <= 0) reason = 'Nguồn đang ở 0V nên chip không có điện';
      else if (Number.isFinite(psuVoltsRaw) && psuVoltsRaw > 5.5) reason = `Nguồn đang ở ${String(Math.round(psuVoltsRaw * 100) / 100)}V, vượt quá 5.5V nên chip không chạy được (quá áp có thể làm hỏng chip)`;
      else reason = 'Chân VDD chưa nối về nguồn +5V nên chip không có điện';
      warnings.push({
        id: 'pic-nopower', kind: 'warn',
        message: `${reason} — chương trình không chạy, chân PIC không ra mức. Nối VDD về thanh +5V và để nguồn trong khoảng trên 0 đến 5.5V.`,
        wireIds: [], compIds: [], terminalIds: ['PIC.VDD'],
      });
    }
    const mclrNet = nets.find((n) => n.members.includes('PIC.MCLR'));
    if (mclrNet && mclrNet.members.includes('GND') && !mclrNet.members.includes('VCC')) {
      warnings.push({
        id: 'pic-mclr', kind: 'warn',
        message: 'MCLR đang nối về GND — chip giữ ở reset, chương trình không chạy. Nối MCLR về +5V (hoặc để nổi) thì chip mới chạy.',
        wireIds: [], compIds: [], terminalIds: ['PIC.MCLR'],
      });
    }
  }

  // 7. Đầu nối linh kiện chưa nối dây nào.
  // Đầu nối chỉ tính là "chưa nối" khi net của nó chỉ có 1 thành viên
  // VÀ nó không xuất hiện trong dây nào của netlist. Netlist từ
  // benchToNetlist có dây tới cả đầu nối "thụ động" (chân điện trở/tụ/
  // thạch anh, chân đồng hồ chế độ V, cọc scope/Serial — xem
  // buildBenchNets): đầu nối chỉ nối tới những đầu đó (vd chân PIC chỉ
  // nối dây tới cọc CH1 của scope) thì net vẫn chỉ có 1 thành viên
  // (buildNets bỏ qua đầu thụ động) nhưng thực tế đã nối — không được
  // báo "chưa nối" (Issue 13).
  const wiredTerms = new Set();
  for (const w of netlist.wires || []) { wiredTerms.add(w.a); wiredTerms.add(w.b); }
  for (const c of netlist.components) {
    for (const t of componentTerminals(c)) {
      // LCD 4-bit: D0–D3 không nối là đúng (không phải "chưa nối dây").
      if (c.kind === 'lcd' && lcdMap && lcdMap.lcd.mode === '4bit' && /^D[0-3]$/.test(t.split('.')[1] || '')) continue;
      const root = netOf.get(t);
      const net = nets.find((n) => n.id === root);
      if (net && net.members.length === 1 && !wiredTerms.has(t)) {
        warnings.push({
          id: 'open-' + t, kind: 'warn',
          message: `${c.label}: đầu nối ${t.split('.')[1]} chưa nối dây nào.`,
          wireIds: [], compIds: [c.id], terminalIds: [t],
        });
      }
    }
  }
  return warnings;
}

// Tiện cho debug trong console trình duyệt
if (typeof globalThis !== 'undefined') {
  globalThis.WIRING = { defaultNetlist, resolvePeripherals, checkWiring, PIC_PINS };
}

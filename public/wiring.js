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
  lcd: { name: 'LCD 16x2', terms: ['RS', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], termLabels: { RS: 'RS', E: 'E', D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4', D5: 'D5', D6: 'D6', D7: 'D7' } },
  buzzer: { name: 'Còi buzzer', terms: ['P', 'N'], termLabels: { P: 'Chân +', N: 'Chân −' } },
};

export function componentTerminals(comp) {
  return COMPONENT_DEFS[comp.kind].terms.map((t) => `${comp.id}.${t}`);
}

const KIND_PREFIX = { led: 'LED', button: 'BTN', pot: 'POT', lcd: 'LCD', buzzer: 'BUZ' };
const KIND_LABEL = { led: 'LED', button: 'Nút', pot: 'Chiết áp', lcd: 'LCD', buzzer: 'Còi' };

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
  // LCD 16x2: RS=RE0, E=RE1, D0–D7 = RD0–RD7
  components.push({ id: 'LCD1', kind: 'lcd', label: 'LCD 16x2', x: 330, y: 690, fixed: true });
  wire('LCD1.RS', 'PIC.RE0');
  wire('LCD1.E', 'PIC.RE1');
  for (let i = 0; i < 8; i++) wire('LCD1.D' + i, 'PIC.RD' + i);
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
// ---------------------------------------------------------------------------
export function resolvePeripherals(netlist) {
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
    gnd: hasTerm(c.id + '.K', 'GND'),
    // Anode nối net VCC chỉ tính là "có nguồn" khi 0 < psu.volts ≤ 10.
    // 0V thì net VCC không có điện, trên 10V thì LED tắt trong lúc điện
    // áp cao. Netlist không mang psu (vd defaultNetlist) thì mặc định 5V.
    vccAnode: psuLedOn && hasTerm(c.id + '.A', 'VCC'),
    cathPin: picPinInNet(c.id + '.K'),
  }));
  const buttons = netlist.components.filter((c) => c.kind === 'button').map((c) => {
    const pinT1 = picPinInNet(c.id + '.T1');
    const pinT2 = picPinInNet(c.id + '.T2');
    const pin = pinT1 || pinT2;
    const otherTerm = pinT1 ? c.id + '.T2' : c.id + '.T1';
    const otherLevel = hasTerm(otherTerm, 'VCC') ? 1 : hasTerm(otherTerm, 'GND') ? 0 : null;
    return { id: c.id, label: c.label, pin, otherLevel };
  });
  const pots = netlist.components.filter((c) => c.kind === 'pot').map((c) => {
    const wiper = picPinInNet(c.id + '.W');
    return {
      id: c.id, label: c.label,
      wiper: wiper ? { ...wiper, analog: wiper.analog ?? null } : null,
      vcc: hasTerm(c.id + '.VCC', 'VCC'),
      gnd: hasTerm(c.id + '.GND', 'GND'),
    };
  });
  const lcdComp = netlist.components.find((c) => c.kind === 'lcd') || null;
  let lcd = { id: null, rs: null, e: null, d: [null, null, null, null, null, null, null, null], complete: false, missing: [] };
  if (lcdComp) {
    const rs = picPinInNet(lcdComp.id + '.RS');
    const e = picPinInNet(lcdComp.id + '.E');
    const d = [];
    for (let i = 0; i < 8; i++) d.push(picPinInNet(lcdComp.id + '.D' + i));
    const missing = [];
    if (!rs) missing.push('RS');
    if (!e) missing.push('E');
    d.forEach((p, i) => { if (!p) missing.push('D' + i); });
    lcd = { id: lcdComp.id, rs, e, d, complete: missing.length === 0, missing };
  }
  const buzzers = netlist.components.filter((c) => c.kind === 'buzzer').map((c) => ({
    id: c.id, label: c.label,
    pin: picPinInNet(c.id + '.P'),
    gnd: hasTerm(c.id + '.N', 'GND'),
    // Chân + nối net VCC chỉ tính là "có nguồn" khi 0 < psu.volts ≤ 10
    // (cùng quy tắc LED nối VCC).
    vccP: psuLedOn && hasTerm(c.id + '.P', 'VCC'),
  }));
  return { leds, buttons, pots, lcd, buzzers, nets: netsOut, netOf };
}

// Mức logic của một net (dùng cho LED/còi): VCC=1, GND=0, chân PIC -> mức chân đó
export function netLevel(cpu, members) {
  if (members.includes('VCC')) return 1;
  if (members.includes('GND')) return 0;
  for (const m of members) {
    if (m.startsWith('PIC.')) {
      const pin = PIN_BY_ID[m.slice(4)];
      if (pin && pin.port !== null) return cpu.pinLevel(pin.port, pin.bit);
    }
  }
  return null; // thả nổi
}

export function ledStates(cpu, mapping) {
  return mapping.leds.map((led) => {
    let on = false;
    // Anode đã có +5V (từ nguồn hoặc rail +): LED sáng khi cathode về
    // GND, hoặc cathode nối chân PIC đang là ngõ ra mức 0. Không cần
    // điện trở nối tiếp mới sáng (thiếu điện trở chỉ là cảnh báo).
    if (led.vccAnode) {
      if (led.cathPin) {
        on = cpu.pinDirection(led.cathPin.port, led.cathPin.bit) === 'out' && cpu.pinLevel(led.cathPin.port, led.cathPin.bit) === 0;
      } else if (led.gnd) on = true;
    } else if (led.pin && led.gnd) {
      const anodeHigh = cpu.pinDirection(led.pin.port, led.pin.bit) === 'out' && cpu.pinLevel(led.pin.port, led.pin.bit) === 1;
      on = anodeHigh;
    } else if (led.pin && led.cathPin) {
      const anodeHigh = cpu.pinDirection(led.pin.port, led.pin.bit) === 'out' && cpu.pinLevel(led.pin.port, led.pin.bit) === 1;
      const cathLow = cpu.pinDirection(led.cathPin.port, led.cathPin.bit) === 'out' && cpu.pinLevel(led.cathPin.port, led.cathPin.bit) === 0;
      on = anodeHigh && cathLow;
    }
    return { id: led.id, on };
  });
}

// Trạng thái còi: kêu khi chân − về GND và chân + có nguồn — hoặc nối
// thẳng VCC (0 < psu.volts ≤ 10, cùng quy tắc LED) hoặc chân PIC đang
// là ngõ ra mức 1. Thiếu GND thì không kêu.
export function buzzerStates(cpu, mapping) {
  return mapping.buzzers.map((bz) => {
    let on = false;
    if (bz.gnd) {
      if (bz.vccP) on = true;
      else if (bz.pin) {
        on = cpu.pinDirection(bz.pin.port, bz.pin.bit) === 'out' && cpu.pinLevel(bz.pin.port, bz.pin.bit) === 1;
      }
    }
    return { id: bz.id, on };
  });
}

// Nhấn/thả nút: đóng mạch giữa chân PIC và đầu còn lại (GND=0, VCC=1)
export function applyButtonToCpu(cpu, mapping, buttonId, pressed) {
  const b = mapping.buttons.find((x) => x.id === buttonId);
  if (!b || !b.pin) return false;
  const level = pressed ? (b.otherLevel ?? 1) : 1; // thả ra: pull-up kéo lên 1
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
    // Đầu nối "lái" tín hiệu: anode LED, 2 đầu nút nhấn, wiper chiết áp, chân + còi.
    // 2 đầu của CÙNG 1 nút bấm chỉ tính là 1 nguồn (nút là công tắc, không
    // phải 2 nguồn tín hiệu): nhấn nút nối T1–T2 vào cùng net thì không được
    // báo chân PIC xung đột với chính cái nút đó.
    const seen = new Set();
    const out = [];
    for (const m of members) {
      const mm = m.match(/^(LED\d+)\.A$|^(BTN\d+)\.T[12]$|^(POT\d+)\.W$|^(BUZ\d+)\.P$/);
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
    // Nguồn quá 10V: LED nối VCC tắt trong lúc điện áp cao (chưa cháy),
    // nhắc hạ điện áp xuống ≤10V. Ghi điện áp thật vào thông báo.
    if (psuOverVolts && aNet && aNet.members.includes('VCC')) {
      warnings.push({
        id: 'ledover-' + c.id, kind: 'warn',
        message: `Nguồn đang ở ${String(Math.round(psuVoltsRaw * 100) / 100)}V, vượt quá 10V nên LED ${c.label} không sáng — hạ điện áp xuống 10V trở xuống.`,
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

  // 4. LCD thiếu dây
  const lcdComp = netlist.components.find((x) => x.kind === 'lcd');
  if (lcdComp) {
    const map = resolvePeripherals(netlist);
    if (!map.lcd.complete) {
      warnings.push({
        id: 'lcd-' + lcdComp.id, kind: 'warn',
        message: `LCD ${lcdComp.label} chưa nối đủ dây — thiếu: ${map.lcd.missing.join(', ')}. LCD sẽ không hiện chữ cho tới khi nối đủ RS, E và D0–D7.`,
        wireIds: [], compIds: [lcdComp.id],
        terminalIds: map.lcd.missing.map((t) => lcdComp.id + '.' + t),
      });
    }
  }

  // 7. Đầu nối linh kiện chưa nối dây nào
  for (const c of netlist.components) {
    for (const t of componentTerminals(c)) {
      const root = netOf.get(t);
      const net = nets.find((n) => n.id === root);
      if (net && net.members.length === 1) {
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

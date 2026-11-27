// circuit-solver.js — Bộ giải mạch DC (MNA) cho đồng hồ đo (multimeter).
// Không DOM, không Three.js: chạy được cả trong trình duyệt (ES module)
// lẫn Node để test tự động.
// Mô hình: mỗi strip trên breadboard là 1 node (nối bằng dây/nút nhấn);
// điện trở, LED, đồng hồ đo (chế độ A) là NHÁNH giữa 2 node; PSU và
// chân PIC output là nguồn áp. Giải bằng Modified Nodal Analysis + khử Gauss.
// - Đồng hồ đo chế độ V (đo áp): trở kháng vô cùng, không có nhánh
//   (không ảnh hưởng mạch); đọc V(chân P) − V(chân N).
// - Đồng hồ đo chế độ A (đo dòng): nguồn áp 0V giữa 2 chân P/N, dòng
//   qua nó = biến dòng của nguồn (chiều P -> N).
// - LED đang sáng: nguồn áp 2V nối tiếp 10Ω (nút phụ giữa điện trở và
//   nguồn); LED tắt: hở mạch. Trạng thái sáng/tắt KHÔNG lấy từ mức logic
//   (VCC/GND/chân PIC) nữa mà quyết định từ ĐIỆN ÁP ĐÃ GIẢI (xem
//   solveCircuit): giải 1 lần hở mạch lấy điện áp 2 đầu diode, diode nào
//   có điện áp thuận trong [2V, 10V] thì bật rồi giải lại; diode nào có
//   dòng nhánh âm thì tắt đi, giải lại. Nhờ vậy LED/đoạn 7 thanh sau
//   chiết áp, cầu phân áp hay nguồn bất kỳ đều sáng đúng như thật.
// - Còi buzzer: tải dẫn 220Ω giữa 2 chân P/N, luôn có mặt khi đã nối
//   dây (như điện trở); tiếng kêu theo điện áp P−N đã giải (≥ 2V).
// - Net không nối tới nguồn áp nào và không có đường về GND thì floating
//   (điện áp null, không gán 0V bừa); nhánh trong mạch floating thì dòng 0.
import {
  DEFAULT_SIZE, legsFor, stripKey, parseHole, parsePsuPost, parseScopePost, parseSerialPost, psuVolts,
  normalizeWireEnd, meterMode,
} from './bench-model.js?v=20261125bp';
import { netLevel, sevenSegStates, SEVEN_SEG_TERMS, PIC_PINS } from './wiring.js?v=20261125bp';

export const LED_FORWARD_VOLTS = 2.0;  // sụt áp thuận LED khi sáng
export const LED_SERIES_OHMS = 10;     // điện trở nối tiếp trong mô hình LED
// Điện áp thuận tối đa mà LED / đoạn 7 thanh / còi còn bật: trên 10V thì
// TẮT (không cháy, hạ áp xuống ≤10V thì bật lại). Đây là quy tắc cũ của
// ledStates/buzzerStates/sevenSegStates (chỉ tính "có nguồn" khi
// 0 < psu.volts ≤ 10, xem wiring.js: psuLedOn), giữ nguyên để hành vi ở
// áp cao không đổi — test (h-b) LED 12V tắt, (l-d) còi 12V tắt.
export const LED_MAX_VOLTS = 10;
export const PIC_OUTPUT_VOLTS = 5;     // chân PIC output mức cao
// Còi buzzer: mô hình tải dẫn BUZZER_OHMS giữa 2 chân P/N (5V -> ~22,7mA,
// như còi piezo 5V thật). Nhánh dẫn LUÔN có mặt khi đã nối dây (như điện
// trở) nên dòng/áp qua còi tính đúng; tiếng kêu (buzzerOn) tính riêng từ
// điện áp đã giải: kêu khi V(P)−V(N) ≥ BUZZER_ON_VOLTS (cùng ngưỡng 2V
// như LED — dưới 2V còi piezo thực tế không đủ áp để kêu).
export const BUZZER_OHMS = 220;
export const BUZZER_ON_VOLTS = 2.0;

// ---------------------------------------------------------------------------
// Net cho solver: union-find trên strip — CHỈ dây và nút nhấn (đang nhấn)
// mới nối strip. Điện trở/LED/đồng hồ đo (chế độ A) KHÔNG nối strip
// (chúng là nhánh giữa 2 node, để solver tính dòng qua). Khác
// buildBenchNets (ở đó điện trở và đồng hồ đo chế độ A nối 2 strip như
// dây để netlist CPU thấy mạch kín).
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

export function buildSolverNets(state, pressedIds = [], pressedKeypad = null) {
  const size = state.size ?? DEFAULT_SIZE;
  const { find, union, ensure } = makeUnionFind();
  ensure('RAIL+');
  ensure('RAIL-');
  const legStrip = new Map();   // 'COMP.term' -> stripKey
  const picPinStrip = new Map(); // 'PIC.RB0' -> stripKey
  for (const comp of state.components) {
    if (comp.type === 'pic') {
      for (const leg of legsFor(comp, size)) {
        const key = leg.hole ? stripKey(leg.hole, size) : null;
        if (!key) continue;
        ensure(key);
        picPinStrip.set(leg.term, key);
      }
      continue;
    }
    if (comp.type === 'psu') continue;
    for (const leg of legsFor(comp, size)) {
      const key = leg.hole ? stripKey(leg.hole, size) : null;
      if (!key) continue;
      ensure(key);
      legStrip.set(comp.id + '.' + leg.term, key);
    }
  }
  // Đầu dây -> strip: lỗ -> strip của lỗ; cọc nguồn -> RAIL+/RAIL-;
  // cọc hiện sóng -> node riêng 'SCOPE:OSC1.CH1' (để union-find nối strip
  // với cọc; scope chỉ quan sát, không phải nhánh mạch); cọc màn hình
  // Serial -> node riêng 'SERIAL:SER0.TX' (cũng chỉ quan sát, không nối
  // mạch); đầu {x,y,z} cũ -> cọc nguồn/cọc hiện sóng/cọc Serial nếu khớp
  // vị trí cọc (normalizeWireEnd).
  const endStripKey = (e) => {
    if (typeof e === 'string') {
      const pp = parsePsuPost(e);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
      if (parseScopePost(e)) return 'SCOPE:' + e;
      if (parseSerialPost(e)) return 'SERIAL:' + e;
      return stripKey(e, size);
    }
    const norm = normalizeWireEnd(state, e);
    if (typeof norm === 'string') {
      const pp = parsePsuPost(norm);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
      if (parseScopePost(norm)) return 'SCOPE:' + norm;
      if (parseSerialPost(norm)) return 'SERIAL:' + norm;
    }
    return null;
  };
  for (const w of state.wires) {
    const ka = endStripKey(w.a);
    const kb = endStripKey(w.b);
    if (ka && kb) { ensure(ka); ensure(kb); union(ka, kb); }
  }
  // Nút bấm đang nhấn giữ = công tắc đóng: nối 2 strip của 2 chân T1–T2.
  for (const comp of state.components) {
    if (comp.type !== 'button' || !pressedIds.includes(comp.id)) continue;
    const keys = legsFor(comp, size).map((l) => (l.hole ? stripKey(l.hole, size) : null)).filter(Boolean);
    keys.forEach((k) => ensure(k));
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  // Phím bàn phím đang nhấn giữ = công tắc đóng: nối strip của hàng đó
  // với strip của cột đó (như nút bấm). Chỉ nối đúng 1 cặp hàng/cột của
  // phím đang nhấn; các hàng/cột khác vẫn tách nhau.
  if (pressedKeypad && pressedKeypad.id) {
    const kp = state.components.find((c) => c.id === pressedKeypad.id && c.type === 'keypad');
    if (kp) {
      const legs = legsFor(kp, size);
      const rowLeg = legs.find((l) => l.term === 'R' + pressedKeypad.row);
      const colLeg = legs.find((l) => l.term === 'C' + pressedKeypad.col);
      const kRow = rowLeg && rowLeg.hole ? stripKey(rowLeg.hole, size) : null;
      const kCol = colLeg && colLeg.hole ? stripKey(colLeg.hole, size) : null;
      if (kRow && kCol) { ensure(kRow); ensure(kCol); union(kRow, kCol); }
    }
  }
  const nodeOfStrip = (key) => (key ? find(key) : null);
  return {
    nodeOfStrip,
    nodeOfTerm: (compId, term) => nodeOfStrip(legStrip.get(compId + '.' + term)),
    nodeOfPicPin: (pinId) => nodeOfStrip(picPinStrip.get('PIC.' + pinId)),
    // Node của 1 cọc hiện sóng ('SCOPE:OSC1.CH1'): dùng lại nodeOfStrip
    // để find đúng root sau union (cọc nối strip nào thì cùng root đó);
    // cọc chưa nối dây thì không có node (undefined -> coi như null).
    nodeOfScopeTerm: (compId, term) => nodeOfStrip('SCOPE:' + compId + '.' + term),
    // Node của 1 cọc màn hình Serial ('SERIAL:SER0.TX'): như scope
    // (chỉ quan sát, không nối mạch). Serial không đọc điện áp qua solver
    // (dữ liệu đi qua CPU onTx/receiveChar) nhưng giữ hàm này để
    // Inspector "Cọc" tra được node của cọc khi cần.
    nodeOfSerialTerm: (compId, term) => nodeOfStrip('SERIAL:' + compId + '.' + term),
    railPlus: find('RAIL+'),
    railMinus: find('RAIL-'),
  };
}

// ---------------------------------------------------------------------------
// Giải hệ tuyến tính A·x = b bằng khử Gauss + chọn trụ từng phần.
// Trả mảng x, hoặc null nếu ma trận suy biến (|trụ| < 1e-12).
// ---------------------------------------------------------------------------
export function solveLinear(A, b) {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    if (piv !== col) { const t = M[col]; M[col] = M[piv]; M[piv] = t; }
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

// ---------------------------------------------------------------------------
// Giải mạch DC bằng MNA. Trả về:
// {
//   ok: boolean,              // false nếu ma trận suy biến (không giải được)
//   nodeVoltage: Map,         // root node -> volts (number); null = floating;
//                            // node RAIL- (GND) = 0
//   branchCurrent: Map,       // id linh kiện 2 chân -> dòng (A); Infinity =
//                            // chập nguồn (dòng không xác định, vd đồng hồ
//                            // đo chế độ A đấu tắt trực tiếp qua PSU)
//   nets,                     // kết quả buildSolverNets (để tra node của chân)
//   ledOn: Map,               // id LED -> boolean (đang sáng? quyết định từ
//                            // điện áp thuận đã giải, xem dưới)
//   segOn: Map,               // 'SEG0.a' -> boolean (đoạn 7 thanh đang sáng?)
//   buzzerOn: Map,            // id còi -> boolean (đang kêu? V(P)−V(N) ≥ 2V)
//   sourceConflicts: [{      // xung đột nguồn áp (Issue 18): 2 nguồn áp
//     nodeA, nodeB,           // khác nhau trên cùng 1 cặp node — nguồn đầu
//     firstKey, firstKind, firstVolts, // thắng, nguồn sau bị bỏ qua (ghi
//     key, kind, volts }]     // lại để hiện cảnh báo, không bỏ lặng).
//                            // volts là điện áp theo chiều chuẩn (nodeA ->
//                            // nodeB, nodeA < nodeB theo thứ tự chuỗi).
//                            // Ampe kế (nguồn 0V để đo) không tính là xung
//                            // đột — chập ampe kế đã có cảnh báo riêng.
// }
// Dòng qua điện trở / còi = (V_A − V_B)/R; dòng qua LED/đồng hồ đo chế độ A =
// biến dòng của nguồn áp tương ứng trong MNA (chiều từ chân +/P sang
// chân −/N).
// Diode (LED, đoạn 7 thanh) bật/tắt theo ĐIỆN ÁP ĐÃ GIẢI chứ không theo
// mức logic: lần 1 giải hở mạch toàn bộ diode, diode nào có điện áp thuận
// trong [LED_FORWARD_VOLTS, LED_MAX_VOLTS] thì bật; các lần sau bỏ diode
// nào có dòng nhánh âm rồi giải lại (tối đa 3 vòng + 1 lần giải cuối).
// ---------------------------------------------------------------------------
export function solveCircuit(state, cpu, pressedIds = [], pressedKeypad = null) {
  const size = state.size ?? DEFAULT_SIZE;
  const nets = buildSolverNets(state, pressedIds, pressedKeypad);
  const ref = nets.railMinus;

  // --- Nguồn của chip PIC (Issue 8): chip chỉ "sống" khi có nguồn ---
  // VDD nối tới rail + (nối trực tiếp cọc PSU+ cũng về rail+) và điện áp
  // nguồn trong (0, 5.5V]: PSU 0V thì chip không có điện, quá 5.5V thì
  // chip quá áp (chết) — cả 2 trường hợp chân PIC đều không lái mức.
  // VDD có 2 chân (11, 32): chỉ cần 1 chân nối rail+ là chip có nguồn.
  // (nodeOfPicPin('VDD') chỉ giữ 1 trong 2 chân nên phải quét cả 2 chân
  // bằng legsFor.) Không có PSU thì rail không có nguồn -> chip chết.
  // Điện áp chân mức cao theo điện áp nguồn thật (PSU 3.3V -> chân ra
  // 3.3V), không cứng 5V. MCLR nối về GND thì chip giữ ở reset (xem
  // isHeldInReset trong pic16.js); 2 rail nối tắt nhau thì không tính là
  // MCLR thấp (mạch nối tắt đó đã có cảnh báo riêng, và các test p0-b/c
  // nối tắt rail vẫn phải chạy).
  const psu = state.components.find((c) => c.type === 'psu');
  const psuV = psuVolts(psu);
  let vddOnRail = false;
  const picComp = state.components.find((c) => c.type === 'pic');
  if (picComp) {
    for (const leg of legsFor(picComp, size)) {
      if (leg.term !== 'PIC.VDD' || !leg.hole) continue;
      if (nets.nodeOfStrip(stripKey(leg.hole, size)) === nets.railPlus) { vddOnRail = true; break; }
    }
  }
  const picPowered = !!psu && vddOnRail && psuV > 0 && psuV <= 5.5;
  const picSupplyVolts = picPowered ? psuV : null;
  const mclrNode = nets.nodeOfPicPin('MCLR');
  const mclrLow = !!mclrNode && mclrNode === nets.railMinus && nets.railPlus !== nets.railMinus;
  const powerInfo = { picPowered, picSupplyVolts, mclrLow };

  // --- 1 lần giải MNA với 1 tập diode (LED / đoạn 7 thanh) đang bật ---
  // ledSet: Set id LED đang bật; segSet: Set 'SEG0.a' đoạn đang bật.
  // Trả { ok, nodeVoltage, branchCurrent } (chưa có nets và các tập
  // on/off — hàm ngoài bọc thêm). Toàn bộ phần lắp mạch MNA của bản cũ
  // nằm trong này, không đổi logic, chỉ khác: tập diode bật là đối số
  // (thay vì lấy từ ledStates/sevenSegStates theo mức logic), và thêm
  // nhánh dẫn của còi buzzer (xem dưới).
  // potVolts: Map id chiết áp -> điện áp wiper (V) đã tính trước từ 1
  // lần giải không có chiết áp (xem cuối solveCircuit); null = bỏ qua
  // mọi nguồn chiết áp (lần giải thăm dò). Nhánh nguồn chiết áp chỉ nối
  // W–GND nên không ảnh hưởng tới V(chân VCC) của chính nó, 1 lần giải
  // thăm dò là đủ chính xác, không cần lặp.
  const runMna = (ledSet, segSet, potVolts = null) => {
    const psu = state.components.find((c) => c.type === 'psu');
    const psuV = psuVolts(psu);

    const conductances = []; // {nodeA, nodeB, g, key}
    const vSources = [];     // {nodeP, nodeN, volts, key, kind}
    const shorted = new Set(); // id linh kiện bị chập (dòng = Infinity)
    // Nguồn áp trùng nhau trên cùng 1 cặp node thì chỉ giữ cái đầu tiên
    // (ưu tiên PSU, rồi chân PIC, đồng hồ đo chế độ A, LED). Cái bị loại
    // có dòng không xác định (2 nguồn áp lý tưởng song song) -> Infinity.
    // Xung đột nguồn (Issue 18): 2 nguồn áp KHÁC NHAU trên cùng 1 cặp
    // node — nguồn đầu thắng (giữ hành vi cũ), nguồn sau bị bỏ qua, và
    // ghi lại vào sourceConflicts để hiện cảnh báo (trước đây bỏ lặng).
    // Ampe kế (nguồn 0V để đo dòng) không tính là xung đột nguồn — chập
    // ampe kế qua PSU đã có cảnh báo riêng (dòng OL + nối tắt VCC–GND).
    const sourceByPair = new Map();
    const sourceConflicts = [];
    const addVSource = (nodeP, nodeN, volts, key, kind) => {
      if (!nodeP || !nodeN || nodeP === nodeN) {
        if (kind === 'ammeter' || kind === 'led') shorted.add(key);
        return false;
      }
      const pair = [nodeP, nodeN].sort().join('|');
      // Điện áp theo chiều chuẩn để so sánh + ghi ra (Issue 18): nếu 1
      // đầu là GND (RAIL-) thì lấy GND làm mốc — điện áp ghi ra là điện
      // áp của đầu còn lại so với GND (dễ đọc: chân PIC mức cao ghi 5V
      // chứ không phải -5V như khi chuẩn hoá theo thứ tự chuỗi, vì
      // 'RAIL-' < 'S...' nên chiều chuẩn bị đảo). Cặp không có GND thì
      // theo thứ tự chuỗi (V(đầu nhỏ) − V(đầu lớn)).
      const hasGnd = nodeP === 'RAIL-' || nodeN === 'RAIL-';
      const canon = hasGnd
        ? (nodeP === 'RAIL-' ? -volts : volts)
        : (nodeP < nodeN ? volts : -volts);
      const prev = sourceByPair.get(pair);
      if (prev !== undefined) {
        if (Math.abs(canon - prev.canon) > 1e-9 && kind !== 'ammeter' && prev.kind !== 'ammeter') {
          const [nodeA, nodeB] = [nodeP, nodeN].sort();
          sourceConflicts.push({ nodeA, nodeB, firstKey: prev.key, firstKind: prev.kind, firstVolts: prev.canon, key, kind, volts: canon });
        }
        if (kind === 'ammeter' || kind === 'led') shorted.add(key);
        return false;
      }
      sourceByPair.set(pair, { canon, key, kind, volts });
      vSources.push({ nodeP, nodeN, volts, key, kind });
      return true;
    };

    // Nguồn PSU TRƯỚC (ưu tiên khi trùng cặp node), rồi chân PIC output,
    // sau đó mới tới các nhánh linh kiện. Thứ tự này quan trọng: đồng hồ
    // đo chế độ A là nguồn 0V, nếu đăng ký trước PSU thì nó chiếm cặp node
    // (RAIL+/RAIL-) và làm PSU bị loại (mạch mất nguồn, đồng hồ chế độ V
    // đọc 0V, đồng hồ chế độ A đọc 0 thay vì OL). PSU đăng ký trước thì
    // đồng hồ chế độ A đấu tắt qua PSU bị đánh dấu chập (dòng Infinity ->
    // hiển thị OL), PSU vẫn giữ 5V.
    if (psu) addVSource(nets.railPlus, nets.railMinus, psuV, psu.id, 'psu');
    // Chân PIC output CHỈ lái khi chip có nguồn (picPowered, xem đầu
    // solveCircuit): mất nguồn thì chân thả nổi (không phải nguồn áp
    // 5V/0V lý tưởng), đồng hồ đo trên net đó đọc null, LED không sáng,
    // động cơ không quay. Điện áp mức cao = điện áp nguồn thật (psuV),
    // không cứng 5V: PSU 3.3V thì chân ra 3.3V.
    if (picPowered) {
      for (const pin of PIC_PINS) {
        if (pin.port === null) continue;
        if (cpu.pinDirection(pin.port, pin.bit) !== 'out') continue; // input: trở kháng cao
        const node = nets.nodeOfPicPin(pin.id);
        if (!node) continue;
        const level = cpu.pinLevel(pin.port, pin.bit);
        addVSource(node, nets.railMinus, level ? psuV : 0, 'PIC.' + pin.id, 'picpin');
      }
    }

    for (const comp of state.components) {
      if (comp.type === 'resistor') {
        const n1 = nets.nodeOfTerm(comp.id, 'L1');
        const n2 = nets.nodeOfTerm(comp.id, 'L2');
        const R = Number(comp.props?.value);
        if (!n1 || !n2 || n1 === n2 || !(R > 0) || !Number.isFinite(R)) continue;
        conductances.push({ nodeA: n1, nodeB: n2, g: 1 / R, key: comp.id, kind: 'resistor' });
      } else if (comp.type === 'led') {
        if (!ledSet.has(comp.id)) continue; // tắt: hở mạch
        const nA = nets.nodeOfTerm(comp.id, 'A');
        const nK = nets.nodeOfTerm(comp.id, 'K');
        if (!nA || !nK || nA === nK) continue; // chập 2 đầu: không có dòng qua LED
        const aux = 'AUX:LED:' + comp.id;
        conductances.push({ nodeA: nA, nodeB: aux, g: 1 / LED_SERIES_OHMS, key: comp.id, kind: 'led' });
        addVSource(aux, nK, LED_FORWARD_VOLTS, comp.id, 'led');
      } else if (comp.type === 'sevenseg') {
        // 8 đoạn, mỗi đoạn sáng là 1 nhánh LED (2V + 10Ω) giữa node của
        // đoạn và node chân chung. Chung cathode: dòng chạy từ đoạn
        // (anode) về COM (cathode); chung anode: từ COM (anode) về đoạn
        // (cathode). Đoạn tắt là hở mạch (không có nhánh).
        const common = comp.props?.common === 'anode' ? 'anode' : 'cathode';
        const nCom = nets.nodeOfTerm(comp.id, 'COM');
        if (!nCom) continue; // chân chung chưa nối: không đoạn nào sáng được
        for (const t of SEVEN_SEG_TERMS) {
          if (!segSet.has(comp.id + '.' + t)) continue;
          const nSeg = nets.nodeOfTerm(comp.id, t);
          if (!nSeg || nSeg === nCom) continue;
          const aux = 'AUX:SEG:' + comp.id + '.' + t;
          const nodeP = common === 'cathode' ? nSeg : nCom;
          const nodeN = common === 'cathode' ? nCom : nSeg;
          conductances.push({ nodeA: nodeP, nodeB: aux, g: 1 / LED_SERIES_OHMS, key: comp.id + '.' + t, kind: 'led' });
          addVSource(aux, nodeN, LED_FORWARD_VOLTS, comp.id + '.' + t, 'led');
        }
      } else if (comp.type === 'motor') {
        // Động cơ DC: tải trở (điện trở cuộn dây, mặc định 100Ω) giữa 2
        // chân +/−. Dòng qua động cơ = (V+ − V−)/R; tốc độ quay tỷ lệ với
        // điện áp (xem motorReadings). Không phải nguồn áp, chỉ là 1 nhánh
        // dẫn như điện trở (không nối 2 strip như dây).
        const nP = nets.nodeOfTerm(comp.id, '+');
        const nN = nets.nodeOfTerm(comp.id, '-');
        const R = Number(comp.props?.value);
        if (!nP || !nN || nP === nN || !(R > 0) || !Number.isFinite(R)) continue;
        conductances.push({ nodeA: nP, nodeB: nN, g: 1 / R, key: comp.id, kind: 'motor' });
      } else if (comp.type === 'buzzer') {
        // Còi buzzer: tải dẫn giữa 2 chân P/N (điện trở BUZZER_OHMS),
        // LUÔN có mặt khi đã nối dây (như điện trở) — trước đây còi hoàn
        // toàn vắng mặt trong solver nên dòng qua còi = 0, sụt áp = 0,
        // đồng hồ đo nối tiếp đọc 0.0mA dù còi đang kêu. Tiếng kêu
        // (buzzerOn) tính riêng từ điện áp đã giải, xem cuối hàm.
        const nP = nets.nodeOfTerm(comp.id, 'P');
        const nN = nets.nodeOfTerm(comp.id, 'N');
        if (!nP || !nN || nP === nN) continue;
        conductances.push({ nodeA: nP, nodeB: nN, g: 1 / BUZZER_OHMS, key: comp.id, kind: 'buzzer' });
      } else if (comp.type === 'multimeter' && meterMode(comp) === 'A') {
        // Chế độ A: nguồn áp 0V giữa 2 chân P/N (dòng đo P -> N). Chế độ V
        // không có nhánh (trở kháng vô cùng). kind 'ammeter' giữ nguyên để
        // logic MNA (shorted/branchCurrent) không đổi.
        const nP = nets.nodeOfTerm(comp.id, 'P');
        const nN = nets.nodeOfTerm(comp.id, 'N');
        if (!nP || !nN) continue;
        if (nP === nN) { shorted.add(comp.id); continue; }
        addVSource(nP, nN, 0, comp.id, 'ammeter');
      } else if (comp.type === 'pot') {
        // Chiết áp: wiper là nguồn áp giữa chân W và chân GND, điện áp =
        // pct × (V(chân VCC) − V(chân GND)) — Vref là điện áp THẬT của
        // net chân VCC (PSU 3V, núm 50% -> ~1,5V), KHÔNG cứng 5V. Điện
        // áp từng chiết áp tính trước ở cuối solveCircuit (potVolts, từ
        // 1 lần giải không có chiết áp) rồi truyền vào đây. Nhờ vậy đồng
        // hồ đo chế độ V (và mọi mạch khác) đọc được điện áp ra của
        // chiết áp. Chiết áp là nguồn lý tưởng: không nhánh trở, không
        // hút dòng (ampe kế trên chân VCC của nó đọc 0).
        // - Chân GND chưa nối dây (nG null) thì KHÔNG mượn railMinus:
        //   wiper lơ lửng, đồng hồ đọc "—", ADC đọc 0.
        // - Wiper bị chân PIC output chiếm (nối tắt tới RB0=1...) thì
        //   chân PIC thắng: bỏ nguồn chiết áp để solver không bị 2 nguồn
        //   áp mâu thuẫn trên cùng 1 net (vd chân GND lại nối 1 chân
        //   output khác thì ma trận MNA suy biến, cả mạch giải sai).
        const nW = nets.nodeOfTerm(comp.id, 'W');
        const nG = nets.nodeOfTerm(comp.id, 'GND');
        if (!nW || !nG || nW === nG) continue;
        let picDrivesWiper = false;
        // Chip mất nguồn thì chân output không lái gì (picPowered):
        // chiết áp lại là nguồn duy nhất trên net wiper.
        if (picPowered) {
          for (const pin of PIC_PINS) {
            if (pin.port === null) continue;
            if (cpu.pinDirection(pin.port, pin.bit) !== 'out') continue;
            if (nets.nodeOfPicPin(pin.id) === nW) { picDrivesWiper = true; break; }
          }
        }
        if (picDrivesWiper) continue;
        const volts = potVolts ? potVolts.get(comp.id) : undefined;
        if (typeof volts !== 'number') continue;
        addVSource(nW, nG, volts, comp.id, 'pot');
      }
    }

    // Node nào có đường về GND (qua nhánh dẫn hoặc nguồn áp) thì điện áp
    // xác định; còn lại là floating. BFS từ node GND qua mọi nhánh.
    const adj = new Map(); // node -> Set(node kề)
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    };
    for (const c of conductances) link(c.nodeA, c.nodeB);
    for (const s of vSources) link(s.nodeP, s.nodeN);
    const grounded = new Set([ref]);
    const queue = [ref];
    while (queue.length) {
      const cur = queue.pop();
      for (const nb of adj.get(cur) || []) {
        if (!grounded.has(nb)) { grounded.add(nb); queue.push(nb); }
      }
    }
    const isGrounded = (node) => node === ref || grounded.has(node);

    // Chỉ số MNA cho node grounded (trừ node GND làm mốc).
    const nodeIndex = new Map();
    for (const node of grounded) {
      if (node !== ref) nodeIndex.set(node, nodeIndex.size);
    }
    const n = nodeIndex.size;
    // Chỉ giữ nguồn áp mà cả 2 đầu đều grounded (nguồn trong mạch floating
    // thì không có dòng); nhánh dẫn mà 1 đầu floating thì dòng 0.
    const liveSources = vSources.filter((s) => isGrounded(s.nodeP) && isGrounded(s.nodeN));
    const m = liveSources.length;
    const A = Array.from({ length: n + m }, () => new Array(n + m).fill(0));
    const z = new Array(n + m).fill(0);
    const idx = (node) => nodeIndex.get(node); // undefined nếu là node GND
    for (const c of conductances) {
      if (!isGrounded(c.nodeA) || !isGrounded(c.nodeB)) continue;
      const i = idx(c.nodeA), j = idx(c.nodeB);
      if (i !== undefined) {
        A[i][i] += c.g;
        if (j !== undefined) A[i][j] -= c.g;
      }
      if (j !== undefined) {
        A[j][j] += c.g;
        if (i !== undefined) A[j][i] -= c.g;
      }
    }
    liveSources.forEach((s, k) => {
      const p = idx(s.nodeP), q = idx(s.nodeN);
      if (p !== undefined) A[p][n + k] += 1;
      if (q !== undefined) A[q][n + k] -= 1;
      if (p !== undefined) A[n + k][p] += 1;
      if (q !== undefined) A[n + k][q] -= 1;
      z[n + k] = s.volts;
    });
    const x = solveLinear(A, z);

    const nodeVoltage = new Map();
    for (const node of adj.keys()) nodeVoltage.set(node, null);
    nodeVoltage.set(ref, 0);
    const branchCurrent = new Map();
    for (const c of conductances) branchCurrent.set(c.key, 0);
    for (const s of vSources) {
      if (s.kind === 'ammeter' || s.kind === 'led') branchCurrent.set(s.key, 0);
    }
    for (const id of shorted) branchCurrent.set(id, Infinity);
    if (x === null) return { ok: false, nodeVoltage, branchCurrent, sourceConflicts };
    for (const [node, i] of nodeIndex) nodeVoltage.set(node, x[i]);
    // Dòng qua điện trở / động cơ DC / còi = (V_A − V_B) × g (0 nếu 1 đầu
    // floating). Dòng qua LED lấy từ biến dòng của nguồn áp 2V ở dưới
    // (không tính bằng điện trở 10Ω vì nút phụ không phải node strip).
    for (const c of conductances) {
      if (c.kind !== 'resistor' && c.kind !== 'motor' && c.kind !== 'buzzer') continue;
      const vA = nodeVoltage.get(c.nodeA);
      const vB = nodeVoltage.get(c.nodeB);
      if (vA === null || vA === undefined || vB === null || vB === undefined) {
        branchCurrent.set(c.key, 0);
      } else {
        branchCurrent.set(c.key, (vA - vB) * c.g);
      }
    }
    // Dòng qua nguồn áp = biến dòng MNA (chiều từ nodeP sang nodeN).
    liveSources.forEach((s, k) => {
      if (s.kind === 'ammeter' || s.kind === 'led') branchCurrent.set(s.key, x[n + k]);
    });
    return { ok: true, nodeVoltage, branchCurrent, sourceConflicts };
  };

  // --- Quyết định LED / đoạn 7 thanh / còi bật hay tắt từ ĐIỆN ÁP ĐÃ GIẢI ---
  // Trước đây trạng thái lấy từ ledStates/sevenSegStates/buzzerStates
  // (mức logic VCC/GND/chân PIC) nên LED sau chiết áp, cầu phân áp hay
  // nguồn khác không phải VCC/PIC thì không bao giờ sáng — và solver
  // cũng bỏ luôn nhánh LED đó (hở mạch) nên đồng hồ đo nối tiếp đọc sai.
  // Giờ quyết định từ điện áp thuận trên diode:
  //   - Lần 1: giải với mọi diode TẮT (hở mạch) để lấy điện áp hở mạch
  //     ở 2 đầu mỗi diode; diode nào có điện áp thuận trong
  //     [LED_FORWARD_VOLTS, LED_MAX_VOLTS] thì bật (dưới 2V chưa đủ mở
  //     diode; trên 10V thì tắt theo quy tắc cũ 0 < volts ≤ 10 — test
  //     (h-b) LED 12V tắt, (l-d) còi 12V tắt).
  //   - Các lần sau: giải với tập diode đang bật; diode nào có dòng
  //     nhánh ÂM (ngược chiều — mạch không duy trì được 2V thuận) thì
  //     tắt đi, giải lại. Tối đa 3 vòng + 1 lần giải cuối để điện áp
  //     trả về khớp đúng tập on/off cuối cùng.
  // Còi không phải diode: nhánh dẫn của nó luôn có mặt trong solver
  // (như điện trở); tiếng kêu chỉ tính từ điện áp P−N đã giải, cập nhật
  // lại sau mỗi lần giải.
  // Hạn chế đã biết: 2 diode nối tiếp nhau mà nút giữa thả nổi khi hở
  // mạch (vd 2 LED nối tiếp VCC -> LED -> LED -> GND) thì lần 1 không
  // thấy điện áp thuận nên cả 2 vẫn tắt — mạch này không có trong lab nào.
  const ledOn = new Map();    // id LED -> boolean (đang sáng?)
  const segOn = new Map();    // 'SEG0.a' -> boolean (đoạn đang sáng?)
  const buzzerOn = new Map(); // id còi -> boolean (đang kêu?)
  // Điện áp thuận (V) trên 1 diode giữa 2 đầu nối, từ 1 kết quả giải
  // (dùng netLevel để thống nhất với mô hình logic): null nếu 1 trong
  // 2 đầu floating / chưa nối dây.
  const fwdVolts = (nodeVoltage, termP, termN) => {
    const vp = netLevel(nodeVoltage, nets, termP);
    const vn = netLevel(nodeVoltage, nets, termN);
    if (vp === null || vn === null) return null;
    return vp - vn;
  };
  const diodeOn = (v) => v !== null && v >= LED_FORWARD_VOLTS && v <= LED_MAX_VOLTS;
  // Quyết định LED + đoạn 7 thanh từ điện áp đã giải.
  const decideDiodes = (nodeVoltage) => {
    for (const comp of state.components) {
      if (comp.type === 'led') {
        ledOn.set(comp.id, diodeOn(fwdVolts(nodeVoltage, comp.id + '.A', comp.id + '.K')));
      } else if (comp.type === 'sevenseg') {
        const common = comp.props?.common === 'anode' ? 'anode' : 'cathode';
        for (const t of SEVEN_SEG_TERMS) {
          // Chung cathode: thuận = V(đoạn) − V(COM); chung anode:
          // thuận = V(COM) − V(đoạn).
          const v = common === 'cathode'
            ? fwdVolts(nodeVoltage, comp.id + '.' + t, comp.id + '.COM')
            : fwdVolts(nodeVoltage, comp.id + '.COM', comp.id + '.' + t);
          segOn.set(comp.id + '.' + t, diodeOn(v));
        }
      }
    }
  };
  // Quyết định tiếng kêu của còi từ điện áp đã giải: kêu khi
  // V(P)−V(N) ≥ BUZZER_ON_VOLTS (cùng ngưỡng 2V như LED), và ≤
  // LED_MAX_VOLTS (cùng quy tắc >10V tắt như LED — test (l-d)).
  const decideBuzzers = (nodeVoltage) => {
    for (const comp of state.components) {
      if (comp.type !== 'buzzer') continue;
      const v = fwdVolts(nodeVoltage, comp.id + '.P', comp.id + '.N');
      buzzerOn.set(comp.id, v !== null && v >= BUZZER_ON_VOLTS && v <= LED_MAX_VOLTS);
    }
  };
  // Bỏ diode đang bật nào có dòng nhánh âm (ngược) trong kết quả vừa
  // giải — mạch thật không duy trì được điện áp thuận 2V trên nó.
  // Trả true nếu có diode nào bị tắt (cần giải lại).
  const dropReversed = (branchCurrent) => {
    let dropped = false;
    for (const [id, on] of ledOn) {
      if (!on) continue;
      const i = branchCurrent.get(id);
      if (i !== undefined && Number.isFinite(i) && i < -1e-9) { ledOn.set(id, false); dropped = true; }
    }
    for (const [key, on] of segOn) {
      if (!on) continue;
      const i = branchCurrent.get(key);
      if (i !== undefined && Number.isFinite(i) && i < -1e-9) { segOn.set(key, false); dropped = true; }
    }
    return dropped;
  };
  const ledSet = () => new Set([...ledOn].filter(([, on]) => on).map(([id]) => id));
  const segSet = () => new Set([...segOn].filter(([, on]) => on).map(([k]) => k));

  // Điện áp wiper của từng chiết áp: pct × (V(chân VCC) − V(chân GND)),
  // với V(chân VCC)/V(chân GND) lấy từ 1 lần giải thăm dò KHÔNG có
  // chiết áp. Nhánh nguồn chiết áp chỉ nối W–GND nên không ảnh hưởng
  // tới V(chân VCC) của chính nó — 1 lần giải là chính xác, không cần
  // lặp. Chiết áp nào thiếu chân (VCC/GND chưa nối tới nguồn nào, điện
  // áp null ở lần thăm dò) thì không có trong map -> không lái wiper.
  // Vref ở đây là điện áp thật của net chân VCC (psuVolts của PSU, mức
  // chân PIC output, hay cầu phân áp...), KHÔNG cứng 5V.
  const computePotVolts = (nodeVoltage) => {
    const map = new Map();
    const psu = state.components.find((c) => c.type === 'psu');
    const psuV = psuVolts(psu);
    for (const comp of state.components) {
      if (comp.type !== 'pot') continue;
      const nV = nets.nodeOfTerm(comp.id, 'VCC');
      const nG = nets.nodeOfTerm(comp.id, 'GND');
      if (!nV || !nG) continue;
      // Chân VCC nối thẳng rail + thì Vref = điện áp danh định của PSU
      // (psuVolts — nguồn sự thật duy nhất cho Vref). Lần giải thăm dò
      // cho cùng 1 số khi mạch bình thường, nhưng không đọc được khi 2
      // rail bị nối tắt (node rail+ trùng node mốc GND nên thăm dò = 0)
      // — mạch nối tắt đó vẫn cho chiết áp lái wiper như cũ (test p0-b/c:
      // chân GND của chiết áp a30 chung strip với chân VDD của PIC nên
      // dây T-30 nối tắt 2 rail trong mô hình solver).
      const vV = nV === nets.railPlus ? psuV : nodeVoltage.get(nV);
      const vG = nodeVoltage.get(nG);
      if (typeof vV !== 'number' || typeof vG !== 'number') continue;
      const pct = Math.max(0, Math.min(100, Number(comp.props?.pct ?? 0) || 0));
      map.set(comp.id, (pct / 100) * (vV - vG));
    }
    return map;
  };
  let potVolts = new Map();
  if (state.components.some((c) => c.type === 'pot')) {
    const probe = runMna(new Set(), new Set(), null);
    if (probe.ok) potVolts = computePotVolts(probe.nodeVoltage);
  }

  // Lần 1: hở mạch toàn bộ diode -> điện áp hở mạch -> tập bật ban đầu.
  const open = runMna(new Set(), new Set(), potVolts);
  if (!open.ok) {
    return { ok: false, nodeVoltage: open.nodeVoltage, branchCurrent: open.branchCurrent, nets, ledOn, segOn, buzzerOn, sourceConflicts: open.sourceConflicts || [], ...powerInfo };
  }
  decideDiodes(open.nodeVoltage);
  decideBuzzers(open.nodeVoltage);
  // Các lần sau: giải với tập đang bật, bỏ diode ngược dòng, giải lại.
  let result = open;
  let stale = false; // tập on/off đã đổi sau lần giải cuối -> cần giải lại 1 lần
  for (let round = 0; round < 3; round++) {
    const solved = runMna(ledSet(), segSet(), potVolts);
    if (!solved.ok) { result = solved; stale = false; break; }
    result = solved;
    decideBuzzers(solved.nodeVoltage); // còi: cập nhật theo điện áp mới nhất
    stale = dropReversed(solved.branchCurrent);
    if (!stale) break;
  }
  if (stale) {
    // Vòng cuối vẫn còn diode bị tắt: giải thêm 1 lần cuối để điện áp
    // trả về khớp đúng tập on/off cuối cùng.
    const solved = runMna(ledSet(), segSet(), potVolts);
    if (solved.ok) { result = solved; decideBuzzers(solved.nodeVoltage); }
  }
  return { ok: result.ok, nodeVoltage: result.nodeVoltage, branchCurrent: result.branchCurrent, nets, ledOn, segOn, buzzerOn, sourceConflicts: result.sourceConflicts || [], ...powerInfo };
}

// ---------------------------------------------------------------------------
// Đấu nối của từng màn hình Serial trên bàn (Issue 6): cọc TX có nối tới
// chân PIC.RC6 (TX của UART) không, cọc RX có nối PIC.RC7 (RX) không,
// cọc GND có nối về GND (chung mass) không. Trả Map id -> {tx, rx, gnd}.
// Dùng cho app.js (chỉ giao ký tự TX/RX cho màn hình đấu đúng dây) và
// test được ở Node. Cọc chưa nối dây thì cả 3 đều false.
// ---------------------------------------------------------------------------
export function serialWiringMap(solved, state) {
  const out = new Map();
  if (!solved || !solved.nets || !state || !Array.isArray(state.components)) return out;
  for (const comp of state.components.filter((c) => c.type === 'serial')) {
    const txNode = solved.nets.nodeOfSerialTerm(comp.id, 'TX');
    const rxNode = solved.nets.nodeOfSerialTerm(comp.id, 'RX');
    const gndNode = solved.nets.nodeOfSerialTerm(comp.id, 'GND');
    out.set(comp.id, {
      tx: !!txNode && txNode === solved.nets.nodeOfPicPin('RC6'),
      rx: !!rxNode && rxNode === solved.nets.nodeOfPicPin('RC7'),
      gnd: !!gndNode && gndNode === solved.nets.railMinus,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Định dạng số đo để hiển thị (màn hình 3D + Inspector). Tách riêng thành
// hàm thuần để test được ở Node.
// - Đồng hồ chế độ V: null (chân floating) -> "—"; không hữu hạn -> "OL";
//   còn lại "5.00 V" (2 số lẻ).
// - Đồng hồ chế độ A: không hữu hạn (chập nguồn) -> "OL"; |dòng| >= 1A ->
//   "1.20 A"; còn lại đổi ra mA, 1 số lẻ ("13.0 mA", "0.0 mA", "-500.0 mA").
// ---------------------------------------------------------------------------
export function formatVolts(volts) {
  if (volts === null || volts === undefined) return '—';
  if (!Number.isFinite(volts)) return 'OL';
  return volts.toFixed(2) + ' V';
}
export function formatAmps(amps) {
  if (amps === null || amps === undefined) return '—';
  if (!Number.isFinite(amps)) return 'OL';
  if (Math.abs(amps) >= 1) return amps.toFixed(2) + ' A';
  return (amps * 1000).toFixed(1) + ' mA';
}
// Chiều dòng qua đồng hồ đo chế độ A: dương = chạy từ chân P sang N,
// âm = ngược lại, 0 = không có dòng, không hữu hạn = OL (chập nguồn).
export function formatCurrentDirection(amps) {
  if (amps === null || amps === undefined) return '—';
  if (!Number.isFinite(amps)) return 'OL';
  if (amps > 0) return 'P → N';
  if (amps < 0) return 'N → P';
  return 'Không có dòng';
}

// ---------------------------------------------------------------------------
// Số đo của mọi đồng hồ đo trên bàn. Giữ nguyên hình dạng cũ để code gọi
// (app.js bridge, bench.js poll/Inspector) không phải đổi:
// { voltmeters: [{id, mode:'V', volts, vP, vN}], ammeters: [{id, mode:'A', amps}] }.
// Đồng hồ ở chế độ V vào danh sách voltmeters, chế độ A vào ammeters.
// - Chế độ V: volts = V(chân P) − V(chân N); null nếu 1 trong 2 chân
//   floating (không nối tới nguồn áp nào, không có đường về GND). 2 chân
//   cùng 1 net -> 0V (kể cả net đó floating, vì 2 đầu đo là cùng 1 điểm).
// - Chế độ A: amps = dòng từ chân P sang chân N (đơn vị A); 0 nếu hở mạch;
//   Infinity nếu chập nguồn (dòng không xác định, vd đấu tắt qua PSU).
// pressedIds: id các nút đang nhấn giữ (nút nhấn = công tắc đóng).
// ---------------------------------------------------------------------------
export function meterReadings(state, cpu, pressedIds = [], pressedKeypad = null) {
  const { nodeVoltage, branchCurrent, nets } = solveCircuit(state, cpu, pressedIds, pressedKeypad);
  const voltmeters = [];
  const ammeters = [];
  for (const comp of state.components) {
    if (comp.type !== 'multimeter') continue;
    if (meterMode(comp) === 'V') {
      const nP = nets.nodeOfTerm(comp.id, 'P');
      const nN = nets.nodeOfTerm(comp.id, 'N');
      let volts, vP = null, vN = null;
      if (!nP || !nN) {
        volts = null; // chân rơi ngoài board
      } else if (nP === nN) {
        volts = 0; // 2 chân cùng 1 net
        const v = nodeVoltage.get(nP);
        vP = vN = (v === null || v === undefined) ? null : v;
      } else {
        const p = nodeVoltage.get(nP);
        const n = nodeVoltage.get(nN);
        vP = (p === null || p === undefined) ? null : p;
        vN = (n === null || n === undefined) ? null : n;
        volts = (vP === null || vN === null) ? null : vP - vN;
      }
      // vP/vN: điện áp từng chân (null nếu floating) — Inspector hiện riêng.
      voltmeters.push({ id: comp.id, mode: 'V', volts, vP, vN });
    } else {
      ammeters.push({ id: comp.id, mode: 'A', amps: branchCurrent.get(comp.id) ?? 0 });
    }
  }
  return { voltmeters, ammeters };
}

// ---------------------------------------------------------------------------
// Điện áp 2 kênh của mọi đồng hồ hiện sóng trên bàn. Cùng mẫu meterReadings
// (chế độ V): CH1 = V(cọc CH1) − V(cọc GND), CH2 = V(cọc CH2) −
// V(cọc GND). Trả [{id, ch1, ch2}] (mỗi kênh là số volt hoặc null).
// - Cọc GND floating (null) -> cả 2 kênh null (không có mốc đo).
// - Cọc kênh floating -> kênh đó null, kênh còn lại vẫn đọc được.
// - 2 cọc cùng 1 net -> hiệu 0V (kể cả net đó floating, vì 2 đầu đo là
//   cùng 1 điểm). Cọc chưa nối dây (không có node) -> kênh đó null.
// pressedIds: id các nút đang nhấn giữ (nút nhấn = công tắc đóng).
// ---------------------------------------------------------------------------
export const SCOPE_MAX_SAMPLES = 240; // bộ nhớ vòng: 240 mẫu × 50ms = 12 giây
// Đẩy 1 mẫu [ch1, ch2] vào bộ nhớ vòng, cắt bớt đầu mảng khi vượt giới
// hạn (mẫu mới nhất luôn ở cuối). Hàm thuần để test được ở Node.
export function pushScopeSample(buf, sample) {
  buf.push(sample);
  if (buf.length > SCOPE_MAX_SAMPLES) buf.splice(0, buf.length - SCOPE_MAX_SAMPLES);
  return buf;
}
export function scopeVoltages(state, cpu, pressedIds = [], pressedKeypad = null) {
  const { nodeVoltage, nets } = solveCircuit(state, cpu, pressedIds, pressedKeypad);
  const out = [];
  for (const comp of state.components) {
    if (comp.type !== 'oscilloscope') continue;
    // Mốc đo là node cọc GND (không còn là chân lỗ): GND chưa nối dây
    // (không có node) hoặc floating -> cả 2 kênh null.
    const nG = nets.nodeOfScopeTerm(comp.id, 'GND');
    const vG = (nG === null || nG === undefined) ? null : nodeVoltage.get(nG);
    const gndV = (vG === null || vG === undefined) ? null : vG;
    const readCh = (term) => {
      if (gndV === null) return null; // GND floating: không có mốc đo
      const n = nets.nodeOfScopeTerm(comp.id, term);
      if (!n) return null; // cọc chưa nối dây
      if (n === nG) return 0; // 2 cọc cùng 1 net
      const v = nodeVoltage.get(n);
      if (v === null || v === undefined) return null; // kênh floating
      return v - gndV;
    };
    out.push({ id: comp.id, ch1: readCh('CH1'), ch2: readCh('CH2') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Điện áp, dòng và tốc độ quay của mọi động cơ DC trên bàn. Trả [{id,
// volts, amps, rpm}] (mỗi giá trị là số hoặc null nếu 1 đầu floating).
// - volts: V(chân +) − V(chân −); null nếu 1 trong 2 chân floating
//   (không nối tới nguồn áp nào, không có đường về GND). 2 chân cùng 1
//   net -> 0V (kể cả net đó floating, vì 2 đầu là cùng 1 điểm).
// - amps: dòng qua động cơ = volts/R (R = điện trở cuộn dây, mặc định
//   100Ω); 0 nếu floating.
// - rpm: tốc độ quay, tỷ lệ với điện áp: 20V = 1000 vòng/phút
//   (MOTOR_MAX_RPM), 0V = 0, điện áp âm = quay ngược (rpm âm). PWM:
//   tốc độ theo điện áp trung bình theo chu kỳ (duty cycle) — vì solver
//   đọc điện áp tức thời nên bench.js làm mượt rpm bằng trung bình trượt
//   (EMA) trong live poll; test Node thì lấy trung bình nhiều mẫu.
// pressedIds: id các nút đang nhấn giữ; pressedKeypad: phím đang nhấn.
// ---------------------------------------------------------------------------
export const MOTOR_MAX_RPM = 1000; // tốc độ ở 20V (1000 vòng/phút)
export function motorReadings(state, cpu, pressedIds = [], pressedKeypad = null) {
  const { nodeVoltage, branchCurrent, nets } = solveCircuit(state, cpu, pressedIds, pressedKeypad);
  const out = [];
  for (const comp of state.components) {
    if (comp.type !== 'motor') continue;
    const nP = nets.nodeOfTerm(comp.id, '+');
    const nN = nets.nodeOfTerm(comp.id, '-');
    let volts, amps;
    if (!nP || !nN) {
      volts = null; amps = null; // chân rơi ngoài board
    } else if (nP === nN) {
      volts = 0; amps = 0; // 2 chân cùng 1 net
    } else {
      const p = nodeVoltage.get(nP);
      const n = nodeVoltage.get(nN);
      volts = (p === null || p === undefined || n === null || n === undefined) ? null : p - n;
      amps = volts === null ? null : (branchCurrent.get(comp.id) ?? 0);
    }
    const rpm = volts === null ? null : (volts / 20) * MOTOR_MAX_RPM;
    out.push({ id: comp.id, volts, amps, rpm });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trạng thái đoạn của mọi LED 7 thanh trên bàn: [{id, common, on: {a, b,
// c, d, e, f, g, dp}}] (xem sevenSegStates trong wiring.js). Dùng cho
// màn hình 3D (đoạn nào sáng thì phát sáng) và Inspector (hiện "Đang
// sáng: a, b, c" / số đang hiện). Đi qua solver MNA như mọi số đo khác:
// giải mạch 1 lần rồi đọc segOn từ kết quả (đoạn nối chiết áp hay nguồn
// bất kỳ cũng sáng đúng, không chỉ chân PIC/VCC).
export function sevenSegReadings(state, cpu, pressedIds = [], pressedKeypad = null) {
  const result = solveCircuit(state, cpu, pressedIds, pressedKeypad);
  return sevenSegStates(result, state);
}

// Chuyển trạng thái đoạn đang sáng thành chữ số đang hiện (nếu khớp mẫu
// 7 đoạn chuẩn): a–g theo bảng mã; dp không tính vào số. Trả '0'–'9',
// 'A'–'F' khi khớp, null khi không phải số/chữ hex (vd chỉ sáng vài đoạn
// rời). Hàm thuần để test được ở Node và để Inspector hiện gọn.
export function sevenSegDigit(on) {
  if (!on) return null;
  const key = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].filter((t) => on[t]).sort().join('');
  if (key === 'abcdef') return '0';
  if (key === 'bc') return '1';
  if (key === 'abdeg') return '2';
  if (key === 'abcdg') return '3';
  if (key === 'bcfg') return '4';
  if (key === 'acdfg') return '5';
  if (key === 'acdefg') return '6';
  if (key === 'abc') return '7';
  if (key === 'abcdefg') return '8';
  if (key === 'abcdfg') return '9';
  if (key === 'abcefg') return 'A';
  if (key === 'cdefg') return 'b';
  if (key === 'adef') return 'C';
  if (key === 'bcdeg') return 'd';
  if (key === 'adefg') return 'E';
  if (key === 'aefg') return 'F';
  return null;
}



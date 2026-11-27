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
//   nguồn); LED tắt: hở mạch. Trạng thái sáng/tắt lấy từ ledStates có sẵn.
// - Net không nối tới nguồn áp nào và không có đường về GND thì floating
//   (điện áp null, không gán 0V bừa); nhánh trong mạch floating thì dòng 0.
import {
  DEFAULT_SIZE, legsFor, stripKey, parseHole, parsePsuPost, parseScopePost, parseSerialPost, psuVolts,
  benchToNetlist, normalizeWireEnd, meterMode,
} from './bench-model.js?v=20261125be';
import { resolvePeripherals, ledStates, sevenSegStates, SEVEN_SEG_TERMS, PIC_PINS } from './wiring.js?v=20261125be';

export const LED_FORWARD_VOLTS = 2.0;  // sụt áp thuận LED khi sáng
export const LED_SERIES_OHMS = 10;     // điện trở nối tiếp trong mô hình LED
export const PIC_OUTPUT_VOLTS = 5;     // chân PIC output mức cao

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
// }
// Dòng qua điện trở = (V_A − V_B)/R; dòng qua LED/đồng hồ đo chế độ A =
// biến dòng của nguồn áp tương ứng trong MNA (chiều từ chân +/P sang
// chân −/N).
// ---------------------------------------------------------------------------
export function solveCircuit(state, cpu, pressedIds = [], pressedKeypad = null) {
  const size = state.size ?? DEFAULT_SIZE;
  const nets = buildSolverNets(state, pressedIds, pressedKeypad);
  const ref = nets.railMinus;
  // LED nào đang sáng (theo ledStates có sẵn): chỉ LED sáng mới là nhánh
  // (2V + 10Ω); LED tắt là hở mạch.
  const mapping = resolvePeripherals(benchToNetlist(state, pressedIds, pressedKeypad));
  const ledOn = new Map(ledStates(cpu, mapping).map((s) => [s.id, s.on]));
  // Đoạn nào của LED 7 thanh đang sáng (theo sevenSegStates): mỗi đoạn
  // sáng là 1 nhánh LED (2V + 10Ω) giữa node của đoạn và node chân chung.
  const segOn = new Map();
  for (const s of sevenSegStates(cpu, mapping)) {
    for (const [t, lit] of Object.entries(s.on)) {
      if (lit) segOn.set(s.id + '.' + t, true);
    }
  }
  const psu = state.components.find((c) => c.type === 'psu');
  const psuV = psuVolts(psu);

  const conductances = []; // {nodeA, nodeB, g, key}
  const vSources = [];     // {nodeP, nodeN, volts, key, kind}
  const shorted = new Set(); // id linh kiện bị chập (dòng = Infinity)
  // Nguồn áp trùng nhau trên cùng 1 cặp node thì chỉ giữ cái đầu tiên
  // (ưu tiên PSU, rồi chân PIC, đồng hồ đo chế độ A, LED). Cái bị loại
  // có dòng không xác định (2 nguồn áp lý tưởng song song) -> Infinity.
  const sourceByPair = new Map();
  const addVSource = (nodeP, nodeN, volts, key, kind) => {
    if (!nodeP || !nodeN || nodeP === nodeN) {
      if (kind === 'ammeter' || kind === 'led') shorted.add(key);
      return false;
    }
    const pair = [nodeP, nodeN].sort().join('|');
    // Điện áp theo chiều chuẩn (node nhỏ -> node lớn theo thứ tự chuỗi).
    const canon = nodeP < nodeN ? volts : -volts;
    const prev = sourceByPair.get(pair);
    if (prev !== undefined) {
      if (Math.abs(canon - prev) > 1e-9) { /* xung đột: nguồn đầu thắng */ }
      if (kind === 'ammeter' || kind === 'led') shorted.add(key);
      return false;
    }
    sourceByPair.set(pair, canon);
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
  for (const pin of PIC_PINS) {
    if (pin.port === null) continue;
    if (cpu.pinDirection(pin.port, pin.bit) !== 'out') continue; // input: trở kháng cao
    const node = nets.nodeOfPicPin(pin.id);
    if (!node) continue;
    const level = cpu.pinLevel(pin.port, pin.bit);
    addVSource(node, nets.railMinus, level ? PIC_OUTPUT_VOLTS : 0, 'PIC.' + pin.id, 'picpin');
  }

  for (const comp of state.components) {
    if (comp.type === 'resistor') {
      const n1 = nets.nodeOfTerm(comp.id, 'L1');
      const n2 = nets.nodeOfTerm(comp.id, 'L2');
      const R = Number(comp.props?.value);
      if (!n1 || !n2 || n1 === n2 || !(R > 0) || !Number.isFinite(R)) continue;
      conductances.push({ nodeA: n1, nodeB: n2, g: 1 / R, key: comp.id, kind: 'resistor' });
    } else if (comp.type === 'led') {
      if (!ledOn.get(comp.id)) continue; // tắt: hở mạch
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
        if (!segOn.get(comp.id + '.' + t)) continue;
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
    } else if (comp.type === 'multimeter' && meterMode(comp) === 'A') {
      // Chế độ A: nguồn áp 0V giữa 2 chân P/N (dòng đo P -> N). Chế độ V
      // không có nhánh (trở kháng vô cùng). kind 'ammeter' giữ nguyên để
      // logic MNA (shorted/branchCurrent) không đổi.
      const nP = nets.nodeOfTerm(comp.id, 'P');
      const nN = nets.nodeOfTerm(comp.id, 'N');
      if (!nP || !nN) continue;
      if (nP === nN) { shorted.add(comp.id); continue; }
      addVSource(nP, nN, 0, comp.id, 'ammeter');
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
  if (x === null) return { ok: false, nodeVoltage, branchCurrent, nets };
  for (const [node, i] of nodeIndex) nodeVoltage.set(node, x[i]);
  // Dòng qua điện trở / động cơ DC = (V_A − V_B) × g (0 nếu 1 đầu
  // floating). Dòng qua LED lấy từ biến dòng của nguồn áp 2V ở dưới
  // (không tính bằng điện trở 10Ω vì nút phụ không phải node strip).
  for (const c of conductances) {
    if (c.kind !== 'resistor' && c.kind !== 'motor') continue;
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
  return { ok: true, nodeVoltage, branchCurrent, nets };
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
// - rpm: tốc độ quay, tỷ lệ với điện áp: 5V = tốc độ tối đa
//   MOTOR_MAX_RPM (6000 vòng/phút, động cơ DC đồ chơi 5V), 0V = 0,
//   điện áp âm = quay ngược (rpm âm). PWM: tốc độ theo điện áp trung
//   bình theo chu kỳ (duty cycle) — vì solver đọc điện áp tức thời nên
//   bench.js làm mượt rpm bằng trung bình trượt (EMA) trong live poll;
//   test Node thì lấy trung bình nhiều mẫu.
// pressedIds: id các nút đang nhấn giữ; pressedKeypad: phím đang nhấn.
// ---------------------------------------------------------------------------
export const MOTOR_MAX_RPM = 6000; // tốc độ tối đa ở 5V (động cơ DC đồ chơi)
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
    const rpm = volts === null ? null : (volts / 5) * MOTOR_MAX_RPM;
    out.push({ id: comp.id, volts, amps, rpm });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trạng thái đoạn của mọi LED 7 thanh trên bàn: [{id, common, on: {a, b,
// c, d, e, f, g, dp}}] (xem sevenSegStates trong wiring.js). Dùng cho
// màn hình 3D (đoạn nào sáng thì phát sáng) và Inspector (hiện "Đang
// sáng: a, b, c" / số đang hiện). Không cần solver MNA: trạng thái đoạn
// tính từ mức logic của net (chân PIC output / VCC / GND), như ledStates.
// ---------------------------------------------------------------------------
export function sevenSegReadings(state, cpu, pressedIds = [], pressedKeypad = null) {
  const mapping = resolvePeripherals(benchToNetlist(state, pressedIds, pressedKeypad));
  return sevenSegStates(cpu, mapping);
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



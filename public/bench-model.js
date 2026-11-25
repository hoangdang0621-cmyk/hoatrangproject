// bench-model.js — Mô hình lỗ/strip của bàn thực hành 3D (không DOM, không Three.js).
// Breadboard đổi được kích thước: 3 mẫu sẵn (Mini 170 lỗ, Nửa 400 lỗ,
// Đầy đủ 830 lỗ) hoặc tự điền rộng (số cột 5–99) × dài (số hàng 5–100,
// bội số của 5) + chọn có rail nguồn hay không. Hàng là chữ cái a–z theo số hàng.
// Nửa trên của mỗi cột (các hàng trên rãnh) nối nhau thành 1 strip,
// nửa dưới nối nhau, rail chạy suốt chiều dài (mọi lỗ rail + là +5V,
// mọi lỗ rail − là GND).
// Chân linh kiện cắm thẳng vào lỗ, breadboard chính là đế (kiểu ohmimic).
// Trạng thái bàn: { size, components: [{id, type, anchor, rot, props, fixed?}],
//   wires: [{id, a, b, color}] } với a/b là id lỗ ('c12', 'T+40') hoặc
//   điểm 3D {x, y, z} (đầu dây gắn vào cọc nguồn).
// benchToNetlist(state) dịch trạng thái bàn thành netlist kiểu wiring.js
// (terminal 'PIC.RB0', 'LED0.A', 'VCC', 'GND') để nối vào CPU.

export const PITCH = 2.54;       // khoảng cách lỗ (mm)
// Size bo mạch: 3 mẫu sẵn (kiểu ohmimic) hoặc tự điền {cols, rows, rails}.
// 830 = 63 cột x 10 hàng + 4 rail x 50; 400 = 30 x 10 + 4 x 25;
// 170 = 17 x 10, không có rail (đúng board mini thật).
// Tự điền: rộng 5–99 cột, dài 5–100 hàng (chỉ bội số của 5: 5, 10, 15...
// 100), rail bật/tắt; rail bật thì dài bằng số cột. Hàng là chữ cái a–z
// Chip PIC DIP-40 rộng 20 cột nên trên board Mini 17 cột thì 6 chân ngoài
// cùng (MCLR, RD0, RD1, RD2, RD3, RB7) treo ngoài board — giới hạn vật lý thật.
export const BOARD_SIZES = {
  830: { cols: 63, rows: 10, railCols: 50 },
  400: { cols: 30, rows: 10, railCols: 25 },
  170: { cols: 17, rows: 10, railCols: 0 },
};
export const BOARD_SIZE_IDS = [170, 400, 830];
export const DEFAULT_SIZE = 830;
export const CUSTOM_COLS_MIN = 5;
export const CUSTOM_COLS_MAX = 99;
export const CUSTOM_ROWS_MIN = 5;
export const CUSTOM_ROWS_MAX = 100;
// Chuẩn hoá size thành giá trị lưu trong state: số (mẫu sẵn) hoặc
// {cols, rows, rails} (tự điền, cột kẹp 5–99, hàng làm tròn XUỐNG về bội
// số 5 gần nhất rồi kẹp 5–100: 12 -> 10, 2 -> 5, 150 -> 100; state cũ
// {cols, rails} không có rows thì mặc định 10 hàng). Không hợp lệ -> 830.
export function normalizeSize(size) {
  if (typeof size === 'number' && BOARD_SIZES[size]) return size;
  if (size && typeof size === 'object') {
    const cols = Math.round(Number(size.cols));
    if (Number.isFinite(cols)) {
      const rowsRaw = Math.round(Number(size.rows));
      const rows = Number.isFinite(rowsRaw)
        ? Math.max(CUSTOM_ROWS_MIN, Math.min(CUSTOM_ROWS_MAX, Math.floor(rowsRaw / 5) * 5))
        : 10;
      return {
        cols: Math.max(CUSTOM_COLS_MIN, Math.min(CUSTOM_COLS_MAX, cols)),
        rows,
        rails: !!size.rails,
      };
    }
  }
  return DEFAULT_SIZE;
}
// Mô tả size: {id, cols, rows, railCols} — id là số mẫu sẵn hoặc 'custom'.
export function boardSize(size) {
  const s = normalizeSize(size);
  if (typeof s === 'number') return { id: s, ...BOARD_SIZES[s] };
  return { id: 'custom', cols: s.cols, rows: s.rows, railCols: s.rails ? s.cols : 0 };
}
export function colsOf(size) { return boardSize(size).cols; }
export function rowsOf(size) { return boardSize(size).rows; }
export function railColsOf(size) { return boardSize(size).railCols; }
// Tổng số lỗ trên board (cols x rows + 4 rail).
export function holeCount(size) {
  const s = boardSize(size);
  return s.cols * s.rows + 4 * s.railCols;
}
// Chiều sâu thân board (mm): từ rail T+ tới rail B− + lề 7mm mỗi bên.
// Dùng để vẽ mesh, đóng khung camera và nhận diện bấm vào thân board.
export function bodyDepth(size) {
  return (rowsOf(size) + 3) * PITCH + 14;
}
// Tên hiển thị của size: tên mẫu sẵn hoặc 'Tùy chỉnh · N lỗ'.
export function sizeLabel(size) {
  const s = boardSize(size);
  if (s.id === 170) return 'Mini 170 lỗ';
  if (s.id === 400) return 'Nửa 400 lỗ';
  if (s.id === 830) return 'Đầy đủ 830 lỗ';
  return `Tùy chỉnh · ${holeCount(size)} lỗ`;
}
// Hai size có bằng nhau không (so theo id + cols + rows + railCols).
export function sameSize(a, b) {
  const x = boardSize(a), y = boardSize(b);
  return x.id === y.id && x.cols === y.cols && x.rows === y.rows && x.railCols === y.railCols;
}
// Cột bắt đầu của chip PIC (căn giữa board): 830 -> 22, 400 -> 6,
// 170 -> 0 (chip tràn nửa cột mỗi bên); board tự điền theo cùng công thức.
export function picCol(size) { return Math.max(0, Math.floor((colsOf(size) - 20) / 2) + 1); }
// Hàng chân chip PIC (internal 0-indexed), luôn 2 hàng ở 2 đoạn 5 khác
// nhau: hàng trên là hàng 2 (b), hàng dưới là hàng max(6, rows-2)
// (số 1-indexed). Board 10 hàng -> (2, 8) = b/h như cũ; board 5 hàng
// -> (2, 6) với hàng 6 treo ngoài board (holeId null); board 100 hàng
// -> (2, 98) = b1/t4.
export function picRows(size) {
  const rows = rowsOf(size);
  return [1, Math.max(5, rows - 3)];
}
// Lỗ neo của chip PIC (chân 1): hàng chân trên, cột picCol (kẹp về 1).
export function picAnchor(size) {
  const r = picRows(size)[0];
  return holeId(r, Math.max(1, picCol(size)), size) ?? (rowLabel(r, rowsOf(size)) + '1');
}
export const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

// Nhãn của hàng r (0-indexed) trên board có `rows` hàng.
// Board <=26 hàng: chữ đơn a-z như cũ. Board >26 hàng: toàn bộ nhãn
// chuyển sang chữ+số khối: hàng 1-26 là a1-z1, 27-52 là a2-z2,
// 53-78 là a3-z3, 79-100 là a4-v4 (chữ lặp lại mỗi 26 hàng, số là khối).
export function rowLabel(r, rows) {
  if (rows <= 26) return ROWS[r];
  return ROWS[r % 26] + (Math.floor(r / 26) + 1);
}
// Hàng trong lưới nội bộ: T+ = -2, T− = -1, a..z = 0..rows-1,
// B+ = rows, B− = rows+1 (B+/B− phụ thuộc số hàng).
const railRowName = (r, rows) => (r === -2 ? 'T+' : r === -1 ? 'T-' : r === rows ? 'B+' : r === rows + 1 ? 'B-' : null);
const railRowOf = (name, rows) => (name === 'T+' ? -2 : name === 'T-' ? -1 : name === 'B+' ? rows : name === 'B-' ? rows + 1 : null);

// Id lỗ từ (hàng nội bộ, cột) trên board size cho trước. Trả null nếu ngoài board.
export function holeId(r, c, size = DEFAULT_SIZE) {
  const rows = rowsOf(size);
  if (r >= 0 && r < rows) {
    if (c < 1 || c > colsOf(size)) return null;
    return rowLabel(r, rows) + c;
  }
  const name = railRowName(r, rows);
  if (name) {
    if (c < 1 || c > railColsOf(size)) return null;
    return name + c;
  }
  return null;
}

// Phân tích id lỗ -> {r, c} (r là hàng nội bộ) hoặc null nếu sai định dạng
// hoặc ngoài board size cho trước. Định dạng theo số hàng của board:
// board <=26 hàng: 1 chữ + toàn bộ số sau là cột (vd c12 = hàng c cột 12);
// board >26 hàng: 1 chữ + 1 số khối + số còn lại là cột
// (vd c112 = hàng c1 cột 12, b25 = hàng b2 cột 5).
export function parseHole(id, size = DEFAULT_SIZE) {
  if (typeof id !== 'string') return null;
  const rows = rowsOf(size);
  if (rows <= 26) {
    const m = id.match(/^([a-z])(\d+)$/);
    if (m) {
      const r = ROWS.indexOf(m[1]);
      const c = Number(m[2]);
      if (r >= 0 && r < rows && c >= 1 && c <= colsOf(size)) return { r, c };
      return null;
    }
  } else {
    const m = id.match(/^([a-z])(\d)(\d+)$/);
    if (m) {
      const r = (Number(m[2]) - 1) * 26 + ROWS.indexOf(m[1]);
      const c = Number(m[3]);
      if (r >= 0 && r < rows && c >= 1 && c <= colsOf(size)) return { r, c };
      return null;
    }
  }
  const m = id.match(/^([TB])([+-])(\d+)$/);
  if (m) {
    const c = Number(m[3]);
    if (c < 1 || c > railColsOf(size)) return null;
    return { r: railRowOf(m[1] + m[2], rows), c };
  }
  return null;
}

export function isRailHole(id, size = DEFAULT_SIZE) {
  const p = parseHole(id, size);
  return !!p && (p.r < 0 || p.r >= rowsOf(size));
}

// Khóa strip của một lỗ: 'S' + số đoạn (mỗi đoạn 5 hàng: 1-5, 6-10,
// 11-15...) + cột, hoặc 'RAIL+'/'RAIL-'. Board 10 hàng thì đoạn 0 = a-e,
// đoạn 1 = f-j như cũ.
export function stripKey(id, size = DEFAULT_SIZE) {
  const p = parseHole(id, size);
  if (!p) return null;
  if (p.r < 0 || p.r >= rowsOf(size)) return (p.r === -2 || p.r === rowsOf(size)) ? 'RAIL+' : 'RAIL-';
  return 'S' + Math.floor(p.r / 5) + 'x' + p.c;
}

// Vị trí 3D của tâm lỗ trên mặt bàn (mm, gốc ở giữa board, y tính riêng).
export function holePos(id, size = DEFAULT_SIZE) {
  const p = parseHole(id, size);
  if (!p) return null;
  return { x: (p.c - (colsOf(size) + 1) / 2) * PITCH, z: (p.r - (rowsOf(size) - 1) / 2) * PITCH };
}

// Mọi lỗ trên board (để vẽ InstancedMesh): [{id, x, z}]
export function allHoles(size = DEFAULT_SIZE) {
  const out = [];
  const rows = rowsOf(size);
  for (const r of [-2, -1, rows, rows + 1]) {
    for (let c = 1; c <= railColsOf(size); c++) {
      const id = holeId(r, c, size);
      const p = holePos(id, size);
      out.push({ id, x: p.x, z: p.z });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= colsOf(size); c++) {
      const id = holeId(r, c, size);
      const p = holePos(id, size);
      out.push({ id, x: p.x, z: p.z });
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

// Chân chip PIC16F877A DIP-40 (rộng 600 mil = 6 bước lỗ): chân 1..20 ở hàng
// chân trên, chân 21..40 ở hàng chân dưới (picRows: b/h với board 10 hàng,
// 2 hàng kề rãnh với board khác), cột picCol(size)..picCol(size)+19.
// Thứ tự chân khớp datasheet (và khớp PIC_PINS trong wiring.js — test
// kiểm chứng điều này).
export const PIC_PIN_IDS_LEFT = ['MCLR', 'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5', 'RE0', 'RE1', 'RE2', 'VDD', 'VSS', 'OSC1', 'OSC2', 'RC0', 'RC1', 'RC2', 'RC3', 'RD0', 'RD1'];
export const PIC_PIN_IDS_RIGHT = ['RD2', 'RD3', 'RC4', 'RC5', 'RC6', 'RC7', 'RD4', 'RD5', 'RD6', 'RD7', 'VSS', 'VDD', 'RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7'];

// Chân chip: [{term: 'PIC.RA0', hole: 'b23', pin: 2, r: 1, c: 23}] —
// pin 1 ở (hàng chân trên, picCol), pin 20 ở (hàng chân trên, picCol+19),
// pin 21 ở (hàng chân dưới, picCol+19), pin 40 ở (hàng chân dưới, picCol).
// Trên board Mini 170 thì 6 chân ngoài cùng có hole = null (treo ngoài
// board, xem ghi chú ở BOARD_SIZES).
export function picLegs(size = DEFAULT_SIZE) {
  const pc = picCol(size);
  const [rT, rB] = picRows(size);
  const out = [];
  PIC_PIN_IDS_LEFT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(rT, pc + i, size), pin: i + 1, r: rT, c: pc + i });
  });
  PIC_PIN_IDS_RIGHT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(rB, pc + 19 - i, size), pin: 21 + i, r: rB, c: pc + 19 - i });
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
// size lấy từ state.size khi gọi qua các hàm nhận state, mặc định 830.
export function legsFor(comp, size = DEFAULT_SIZE) {
  if (comp.type === 'pic') {
    return picLegs(size).map((l) => ({ term: l.term, hole: l.hole }));
  }
  if (comp.type === 'psu') return [];
  const anchor = parseHole(comp.anchor, size);
  if (!anchor) return [];
  return legOffsets(comp.type, comp.rot || 0).map((l) => ({
    term: l.term,
    hole: holeId(anchor.r + l.dr, anchor.c + l.dc, size),
  }));
}

// Lỗ nào đang bị chân nào chiếm: Map hole -> compId (trừ ignoreId).
export function occupancy(state, ignoreId = null) {
  const size = state.size ?? DEFAULT_SIZE;
  const occ = new Map();
  for (const comp of state.components) {
    if (comp.id === ignoreId) continue;
    for (const leg of legsFor(comp, size)) {
      if (leg.hole) occ.set(leg.hole, comp.id);
    }
  }
  return occ;
}

// Đặt được linh kiện không? Kiểm tra chân ngoài board, lỗ đã có chân,
// và chân nằm dưới thân chip PIC (hàng b..h, cột picCol..picCol+19).
export function canPlace(state, type, anchor, rot = 0, ignoreId = null) {
  const size = state.size ?? DEFAULT_SIZE;
  if (type === 'psu') return { ok: true, legs: [] }; // nguồn đặt trên mặt bàn, không cần lỗ
  const legs = legsFor({ type, anchor, rot }, size);
  if (!legs.length) return { ok: false, reason: 'Không đặt được linh kiện này lên lỗ.' };
  for (const leg of legs) {
    if (!leg.hole || !parseHole(leg.hole, size)) return { ok: false, reason: 'Chân linh kiện rơi ra ngoài board.' };
  }
  const occ = occupancy(state, ignoreId);
  for (const leg of legs) {
    if (occ.has(leg.hole)) return { ok: false, reason: 'Lỗ ' + leg.hole + ' đã có chân cắm.' };
  }
  if (type !== 'pic') {
    const pc = picCol(size);
    const [rT, rB] = picRows(size);
    for (const leg of legs) {
      const p = parseHole(leg.hole, size);
      if (p.r >= rT && p.r <= rB && p.c >= pc && p.c < pc + 20) {
        return { ok: false, reason: 'Chân nằm dưới thân chip PIC.' };
      }
    }
  }
  return { ok: true, legs };
}

// Bật/tắt chế độ đặt linh kiện dính: bấm lại đúng thẻ đang chọn thì thoát.
export function togglePlacement(current, clicked) {
  return current === clicked ? null : clicked;
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
// - nút bấm đang nhấn giữ (pressedIds) = công tắc đóng: nối 2 strip của
//   2 chân T1–T2 lại với nhau; nhả ra thì 2 chân tách ra như cũ.
// - nhóm chạm RAIL+ là +5V, chạm RAIL- là GND.
export function buildBenchNets(state, pressedIds = []) {
  const size = state.size ?? DEFAULT_SIZE;
  const { find, union, ensure } = makeUnionFind();
  ensure('RAIL+');
  ensure('RAIL-');
  const termStrip = new Map();
  const resistorStrips = new Set();
  for (const comp of state.components) {
    if (comp.type === 'pic') {
      for (const leg of picLegs(size)) {
        const key = leg.hole ? stripKey(leg.hole, size) : null;
        if (!key) continue;
        ensure(key);
        termStrip.set(leg.term, key);
      }
      continue;
    }
    if (comp.type === 'psu') continue;
    const legs = legsFor(comp, size);
    if (comp.type === 'resistor') {
      const keys = legs.map((l) => (l.hole ? stripKey(l.hole, size) : null)).filter(Boolean);
      keys.forEach((k) => { ensure(k); resistorStrips.add(k); });
      for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
      continue;
    }
    for (const leg of legs) {
      const key = leg.hole ? stripKey(leg.hole, size) : null;
      if (!key) continue;
      ensure(key);
      termStrip.set(comp.id + '.' + leg.term, key);
    }
  }
  // Nút bấm đang nhấn giữ = công tắc đóng: nối 2 strip của 2 chân T1–T2
  // lại với nhau (như 1 dây nối tắt 2 strip). Trạng thái nhấn giữ là nhất
  // thời (nhấn giữ chuột), không lưu vào localStorage — người gọi truyền
  // pressedIds vào mỗi lần dựng netlist.
  for (const comp of state.components) {
    if (comp.type !== 'button' || !pressedIds.includes(comp.id)) continue;
    const keys = legsFor(comp, size).map((l) => (l.hole ? stripKey(l.hole, size) : null)).filter(Boolean);
    keys.forEach((k) => ensure(k));
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  // Strip của 1 đầu dây: lỗ -> strip của lỗ đó; cọc nguồn -> RAIL+/RAIL-;
  // đầu {x,y,z} cũ -> cọc nguồn nếu khớp vị trí cọc, còn không thì bỏ qua.
  const endStripKey = (e) => {
    if (typeof e === 'string') {
      const pp = parsePsuPost(e);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
      return stripKey(e, size);
    }
    const norm = normalizeWireEnd(state, e);
    if (typeof norm === 'string') {
      const pp = parsePsuPost(norm);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
    }
    return null;
  };
  for (const w of state.wires) {
    const ka = endStripKey(w.a);
    const kb = endStripKey(w.b);
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
export function describeTerminal(state, term, pressedIds = []) {
  const { groups, termRoot } = buildBenchNets(state, pressedIds);
  const root = termRoot.get(term);
  if (root === undefined) return { members: [], vcc: false, gnd: false };
  const g = groups.get(root);
  return { members: g.terms, vcc: g.vcc, gnd: g.gnd };
}

// ---------------------------------------------------------------------------
// Dịch trạng thái bàn thành netlist kiểu wiring.js (để resolvePeripherals).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Nguồn chung (PSU): điện áp danh định điều chỉnh được 0–24V, mặc định 5V.
// Chỉ là giá trị hiển thị/danh định — không mô phỏng analog.
// ---------------------------------------------------------------------------
export const PSU_VOLTS_MIN = 0;
export const PSU_VOLTS_MAX = 24;
export const PSU_VOLTS_DEFAULT = 5;
export function psuVolts(comp) {
  const v = Number(comp?.props?.volts);
  if (!Number.isFinite(v)) return PSU_VOLTS_DEFAULT;
  return Math.min(PSU_VOLTS_MAX, Math.max(PSU_VOLTS_MIN, v));
}
export function formatVolts(v) {
  return String(Math.round(v * 100) / 100);
}
// Kiểm tra điện áp người dùng nhập: số thập phân 0–24; sai thì từ chối
// (không kẹp lén) để UI báo đỏ.
export function validatePsuVolts(raw) {
  if (raw === '' || raw === null || raw === undefined) return { ok: false, reason: 'Nhập điện áp nguồn (V).' };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { ok: false, reason: 'Điện áp phải là số.' };
  if (v < PSU_VOLTS_MIN || v > PSU_VOLTS_MAX) return { ok: false, reason: `Điện áp phải từ ${PSU_VOLTS_MIN} đến ${PSU_VOLTS_MAX} V.` };
  return { ok: true, volts: Math.round(v * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Cọc nguồn: đầu dây gắn vào cọc +/− của 1 khối nguồn, id 'PSU1.+' / 'PSU1.-'.
// Cọc + nối về rail + (VCC), cọc − nối về rail − (GND).
// ---------------------------------------------------------------------------
export function parsePsuPost(id) {
  const m = typeof id === 'string' ? id.match(/^PSU(\d+)\.([+-])$/) : null;
  return m ? { psuId: 'PSU' + m[1], sign: m[2] } : null;
}
// Vị trí 3D của cọc nguồn trên bàn (mm): cọc + ở x = tx−12, cọc − ở
// x = tx+12, cao y = 28, mặt trước hộp nguồn z = tz+42.
export function psuPostPos(state, id) {
  const pp = parsePsuPost(id);
  if (!pp) return null;
  const comp = state.components.find((c) => c.id === pp.psuId && c.type === 'psu');
  if (!comp) return null;
  return { x: comp.tx + (pp.sign === '+' ? -12 : 12), y: 28, z: comp.tz + 42 };
}
// Đầu dây {x,y,z} cũ (lưu trước khi có id cọc) -> id cọc nếu khớp vị trí cọc nguồn.
export function normalizeWireEnd(state, e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.x === 'number' && typeof e.z === 'number') {
    for (const c of state.components) {
      if (c.type !== 'psu') continue;
      if (Math.abs(e.x - (c.tx - 12)) < 6 && Math.abs(e.z - (c.tz + 42)) < 6) return c.id + '.+';
      if (Math.abs(e.x - (c.tx + 12)) < 6 && Math.abs(e.z - (c.tz + 42)) < 6) return c.id + '.-';
    }
  }
  return e;
}

const KIND_LABEL = { led: 'LED', button: 'Nút', pot: 'Chiết áp', lcd: 'LCD', buzzer: 'Còi' };
export function compLabel(comp) {
  const n = comp.id.replace(/^[A-Z]+/, '');
  if (comp.type === 'pic') return 'PIC16F877A';
  if (comp.type === 'psu') return 'Nguồn ' + formatVolts(psuVolts(comp)) + 'V';
  if (comp.type === 'resistor') return 'R' + n + ' (' + (comp.props?.value ?? 220) + 'Ω)';
  return (KIND_LABEL[comp.type] || comp.type) + ' ' + n;
}

export function benchToNetlist(state, pressedIds = []) {
  const { groups, termRoot, resistorRoots, find } = buildBenchNets(state, pressedIds);
  const components = [];
  for (const comp of state.components) {
    if (comp.type === 'pic' || comp.type === 'psu' || comp.type === 'resistor') continue;
    const c = {
      id: comp.id, kind: comp.type, label: compLabel(comp),
      x: 0, y: 0, fixed: !!comp.fixed,
    };
    if (comp.type === 'led') {
      // LED có điện trở nối tiếp nếu net của anode chứa strip của 1 điện trở,
      // hoặc điện trở nằm sau 1 công tắc (nút bấm) đang mở: anode nối 1 đầu
      // nút, đầu kia của nút nối tới strip có điện trở (nhấn nút thì mạch
      // kín lại và điện trở đó hạn dòng cho LED).
      const root = termRoot.get(comp.id + '.A');
      let hasR = !!(root && resistorRoots.has(root));
      if (!hasR && root) {
        for (const b of state.components) {
          if (b.type !== 'button') continue;
          const r1 = termRoot.get(b.id + '.T1');
          const r2 = termRoot.get(b.id + '.T2');
          if ((r1 === root && r2 !== undefined && resistorRoots.has(r2))
            || (r2 === root && r1 !== undefined && resistorRoots.has(r1))) { hasR = true; break; }
        }
      }
      c.hasResistor = hasR;
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
  // Điện áp danh định của nguồn (để cầu nối CPU thấy được; không mô phỏng analog).
  const psu = state.components.find((c) => c.type === 'psu');
  return { components, wires, psu: { volts: psuVolts(psu) } };
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
  if (type === 'psu') return { volts: PSU_VOLTS_DEFAULT };
  return {};
}

// Trạng thái bàn mặc định theo size: chip PIC cắm sẵn (căn giữa board),
// nguồn trên bàn, dây nguồn VDD/VSS/MCLR về rail. Board Mini 170 không
// có rail nên không có dây nguồn mặc định.
export function defaultBenchState(size = DEFAULT_SIZE) {
  const s = boardSize(size);
  const legs = picLegs(size);
  const legByPin = new Map(legs.map((l) => [l.pin, l]));
  const wires = [];
  // Dây nguồn của chip: chân PIC -> rail cùng cột (cột rail kẹp về railCols).
  const power = [
    { id: 'W1', pin: 1, rail: 'T+' }, { id: 'W2', pin: 11, rail: 'T+' },
    { id: 'W3', pin: 32, rail: 'T+' }, { id: 'W4', pin: 12, rail: 'T-' },
    { id: 'W5', pin: 31, rail: 'T-' },
  ];
  for (const p of power) {
    const leg = legByPin.get(p.pin);
    if (!leg || !leg.hole || s.railCols === 0) continue;
    wires.push({ id: p.id, a: leg.hole, b: p.rail + Math.min(leg.c, s.railCols), color: p.rail === 'T+' ? '#DC2626' : '#0F172A' });
  }
  // Dây nguồn: cọc +/− của PSU về rail (cột 40, kẹp về railCols).
  if (s.railCols > 0) {
    const rc = Math.min(40, s.railCols);
    wires.push({ id: 'W6', a: 'PSU1.+', b: 'T+' + rc, color: '#DC2626' });
    wires.push({ id: 'W7', a: 'PSU1.-', b: 'T-' + rc, color: '#0F172A' });
  }
  return {
    size: normalizeSize(size),
    components: [
      { id: 'PIC1', type: 'pic', anchor: picAnchor(size), rot: 0, fixed: true, props: {} },
      { id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: defaultProps('psu') },
    ],
    wires,
  };
}

// Lọc trạng thái đọc từ localStorage: chỉ giữ linh kiện/dây còn hợp lệ
// trên size của nó (state cũ không có size thì mặc định 830).
export function sanitizeState(raw) {
  if (!raw || !Array.isArray(raw.components) || !Array.isArray(raw.wires)) return defaultBenchState();
  const size = normalizeSize(raw.size);
  const components = [];
  for (const c of raw.components) {
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string') continue;
    if (c.type === 'pic') { components.push({ id: 'PIC1', type: 'pic', anchor: picAnchor(size), rot: 0, fixed: true, props: {} }); continue; }
    if (c.type === 'psu') {
      if (typeof c.tx === 'number' && typeof c.tz === 'number') {
        components.push({ id: c.id, type: 'psu', tx: c.tx, tz: c.tz, fixed: true, props: { volts: psuVolts(c) } });
      }
      continue;
    }
    if (!LEG_LAYOUTS[c.type] || !parseHole(c.anchor, size)) continue;
    const chk = canPlace({ size, components }, c.type, c.anchor, c.rot || 0);
    if (!chk.ok) continue;
    components.push({ id: c.id, type: c.type, anchor: c.anchor, rot: c.rot || 0, props: c.props || defaultProps(c.type) });
  }
  if (!components.some((c) => c.type === 'pic')) {
    components.unshift({ id: 'PIC1', type: 'pic', anchor: picAnchor(size), rot: 0, fixed: true, props: {} });
  }
  if (!components.some((c) => c.type === 'psu')) {
    components.push({ id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: defaultProps('psu') });
  }
  const wires = [];
  for (const w of raw.wires) {
    if (!w || typeof w.id !== 'string' || typeof w.color !== 'string') continue;
    // Đầu dây hợp lệ: lỗ trên board, cọc nguồn (PSU1.+/PSU1.-), hoặc điểm 3D cũ.
    const okEnd = (e) => {
      if (typeof e === 'string') {
        if (parseHole(e, size)) return true;
        const pp = parsePsuPost(e);
        return !!pp && components.some((c) => c.id === pp.psuId);
      }
      return e && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.z === 'number';
    };
    // Đầu {x,y,z} cũ khớp cọc nguồn thì đổi thành id cọc.
    const na = normalizeWireEnd({ components }, w.a);
    const nb = normalizeWireEnd({ components }, w.b);
    if (okEnd(na) && okEnd(nb)) wires.push({ id: w.id, a: na, b: nb, color: w.color });
  }
  return { size, components, wires };
}

// ---------------------------------------------------------------------------
// Đổi size bo mạch: giữ linh kiện/dây mà lỗ còn tồn tại trên size mới,
// gỡ cái nào ngoài board; dây nguồn mặc định (W1–W7) được nối lại theo
// chân PIC và rail của size mới. Trả {state, removed: {components, wires}}.
// ---------------------------------------------------------------------------
export function pruneStateForSize(state, newSize) {
  const size = normalizeSize(newSize);
  const oldSize = normalizeSize(state.size);
  const removed = { components: [], wires: [] };
  const legs = picLegs(size);
  const legByPin = new Map(legs.map((l) => [l.pin, l]));
  const oldLegs = picLegs(oldSize);
  const pinOfHole = new Map(oldLegs.filter((l) => l.hole).map((l) => [l.hole, l.pin]));
  // Đầu rail 'T+40' -> kẹp cột về railCols của size mới (null nếu hết rail).
  const remapRail = (id) => {
    const p = parseHole(id, oldSize);
    if (!p) return null;
    const rc = railColsOf(size);
    if (rc === 0) return null;
    if (p.r >= 0 && p.r < rowsOf(oldSize)) return id;
    const rowName = railRowName(p.r, rowsOf(oldSize));
    return rowName + Math.min(p.c, rc);
  };
  const keptComponents = [
    { id: 'PIC1', type: 'pic', anchor: picAnchor(size), rot: 0, fixed: true, props: {} },
  ];
  const probe = { size, components: keptComponents, wires: [] };
  for (const comp of state.components) {
    if (comp.type === 'pic') continue;
    if (comp.type === 'psu') {
      if (typeof comp.tx === 'number' && typeof comp.tz === 'number') {
        keptComponents.push({ id: comp.id, type: 'psu', tx: comp.tx, tz: comp.tz, fixed: true, props: { volts: psuVolts(comp) } });
      }
      continue;
    }
    if (!LEG_LAYOUTS[comp.type] || !parseHole(comp.anchor, size)) { removed.components.push(comp.id); continue; }
    const chk = canPlace(probe, comp.type, comp.anchor, comp.rot || 0);
    if (!chk.ok) { removed.components.push(comp.id); continue; }
    keptComponents.push({ id: comp.id, type: comp.type, anchor: comp.anchor, rot: comp.rot || 0, props: comp.props || defaultProps(comp.type) });
  }
  const keptWires = [];
  const seen = new Set();
  const wireKey = (a, b) => {
    const k = (e) => (typeof e === 'string' ? e : `P${e.x},${e.y},${e.z}`);
    return [k(a), k(b)].sort().join('|');
  };
  for (const w of state.wires) {
    if (!w || typeof w.id !== 'string' || typeof w.color !== 'string') continue;
    // Đầu {x,y,z} cũ khớp cọc nguồn thì đổi thành id cọc.
    let a = normalizeWireEnd(state, w.a), b = normalizeWireEnd(state, w.b);
    if (['W1', 'W2', 'W3', 'W4', 'W5'].includes(w.id)) {
      // Đầu a là chân PIC: đổi sang lỗ chân mới của cùng pin.
      const pin = typeof a === 'string' ? pinOfHole.get(a) : null;
      const leg = pin ? legByPin.get(pin) : null;
      if (!leg || !leg.hole) { removed.wires.push(w.id); continue; }
      a = leg.hole;
      const rb = typeof b === 'string' ? remapRail(b) : b;
      if (rb === null) { removed.wires.push(w.id); continue; }
      b = rb;
    } else if (w.id === 'W6' || w.id === 'W7') {
      const rb = typeof b === 'string' ? remapRail(b) : b;
      if (rb === null) { removed.wires.push(w.id); continue; }
      b = rb;
    } else {
      // Đầu dây hợp lệ: lỗ trên board, cọc nguồn, hoặc điểm 3D cũ.
      const okEnd = (e) => {
        if (typeof e === 'string') {
          if (parseHole(e, size)) return true;
          const pp = parsePsuPost(e);
          return !!pp && keptComponents.some((c) => c.id === pp.psuId);
        }
        return e && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.z === 'number';
      };
      if (!okEnd(a) || !okEnd(b)) { removed.wires.push(w.id); continue; }
    }
    const key = wireKey(a, b);
    if (seen.has(key)) { removed.wires.push(w.id); continue; }
    seen.add(key);
    keptWires.push({ id: w.id, a, b, color: w.color });
  }
  return { state: { size, components: keptComponents, wires: keptWires }, removed };
}

// ---------------------------------------------------------------------------
// Chuyển 1 đầu dây sang lỗ mới (kéo đầu dây / nhập địa chỉ lỗ trong popup).
// Kiểm tra trước bằng validateWireEnd rồi mới áp dụng bằng retargetWireEnd.
// ---------------------------------------------------------------------------
export function validateWireEnd(state, wireId, end, newHole) {
  const size = normalizeSize(state.size);
  const w = state.wires.find((x) => x.id === wireId);
  if (!w) return { ok: false, reason: 'Không tìm thấy dây.' };
  if (end !== 'a' && end !== 'b') return { ok: false, reason: 'Đầu dây không hợp lệ.' };
  // Đích hợp lệ: lỗ trên board hoặc cọc nguồn (PSU1.+/PSU1.-) của nguồn đang có trên bàn.
  const pp = parsePsuPost(newHole);
  if (pp) {
    if (!state.components.some((c) => c.id === pp.psuId && c.type === 'psu')) {
      return { ok: false, reason: 'Không có nguồn ' + pp.psuId + ' trên bàn.' };
    }
  } else if (!parseHole(newHole, size)) {
    return { ok: false, reason: 'Địa chỉ "' + newHole + '" không hợp lệ trên board ' + sizeLabel(size) + ' (lỗ vd c12, hoặc cọc nguồn PSU1.+/PSU1.-).' };
  }
  const other = end === 'a' ? w.b : w.a;
  if (other === newHole) return { ok: false, reason: 'Hai đầu dây trùng nhau.' };
  const dup = state.wires.some((x) => x.id !== wireId
    && ((x.a === newHole && x.b === other) || (x.b === newHole && x.a === other)));
  if (dup) return { ok: false, reason: 'Đã có dây nối 2 điểm này rồi.' };
  return { ok: true };
}
export function retargetWireEnd(state, wireId, end, newHole) {
  const v = validateWireEnd(state, wireId, end, newHole);
  if (!v.ok) return v;
  const w = state.wires.find((x) => x.id === wireId);
  if (end === 'a') w.a = newHole; else w.b = newHole;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Camera: pan + zoom về điểm trỏ chuột (hàm thuần, test được bằng Node).
// CamTarget là {x, z} trên mặt bàn (mm), gốc ở giữa bàn làm việc.
// ---------------------------------------------------------------------------

// Kẹp target camera trong vùng bàn làm việc (mặt bàn tableW x tableD,
// gốc ở giữa) cộng lề margin, để pan không lạc khỏi bàn.
export function clampCamTarget(x, z, tableW = 900, tableD = 600, margin = 120) {
  return {
    x: Math.max(-tableW / 2 - margin, Math.min(tableW / 2 + margin, x)),
    z: Math.max(-tableD / 2 - margin, Math.min(tableD / 2 + margin, z)),
  };
}

// Zoom về điểm trỏ: target dịch dần về `point` (điểm trên mặt bàn dưới
// con trỏ) khi zoom vào. factor = rMoi / rCu (<1 khi zoom vào):
// zoom vào càng sâu thì target càng gần điểm trỏ; zoom ra thì không dịch.
export function zoomTowardPoint(target, point, factor) {
  const t = Math.max(0, Math.min(1, 1 - factor));
  return {
    x: target.x + (point.x - target.x) * t,
    z: target.z + (point.z - target.z) * t,
  };
}

// Pan theo kéo chuột: dx/dy là delta pixel màn hình (dx>0 kéo sang phải,
// dy>0 kéo xuống dưới), az là góc phương vị camera (rad), scale là số
// mm trên mặt bàn tương ứng 1 pixel tại độ sâu của target.
// Kéo sang phải thì cảnh đi theo chuột (target dịch sang trái màn hình);
// kéo xuống thì target dịch về phía người xem.
export function panTarget(target, dx, dy, az, scale) {
  const rx = Math.cos(az), rz = -Math.sin(az); // hướng "phải màn hình" trên mặt bàn
  const fx = Math.sin(az), fz = Math.cos(az);  // hướng "về phía người xem" trên mặt bàn
  return {
    x: target.x - dx * scale * rx + dy * scale * fx,
    z: target.z - dx * scale * rz + dy * scale * fz,
  };
}

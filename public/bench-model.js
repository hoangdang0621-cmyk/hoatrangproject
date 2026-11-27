// bench-model.js — Mô hình lỗ/strip của bàn thực hành 3D (không DOM, không Three.js).
// Breadboard đổi được kích thước: 3 mẫu sẵn (Mini 170 lỗ, Nửa 400 lỗ,
// Đầy đủ 830 lỗ) hoặc tự điền rộng (số cột 5–100) × dài (số hàng 5–100,
// bội số của 5) + chọn có rail nguồn hay không. Hàng đặt tên kiểu bảng
// tính: a–z, aa–az, ba–bz, ... (hàng 27 là aa, hàng 100 là cv).
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
// Khe hở vật lý giữa các đoạn 5 hàng (mm): thêm 1 PITCH ở mỗi ranh giới
// đoạn (sau hàng 5, 10, 15...) để các đoạn tách xa hẳn ra, nhìn là phân
// biệt được đoạn — vd hàng e tới hàng f thành 5.08mm (gấp đôi khoảng cách
// hàng thường 2.54mm). Khoảng cách hàng trong cùng đoạn vẫn đúng 1 PITCH.
export const SEGMENT_GAP_MM = PITCH;
// Tọa độ Z (mm) của hàng r trên board có `rows` hàng, gốc ở giữa board.
// Hàng chính 0..rows-1: z = r*PITCH + floor(r/5)*SEGMENT_GAP_MM rồi căn
// giữa bằng cách trừ nửa tổng chiều sâu ((rows-1)*PITCH + số ranh giới*GAP).
// Hàng rail: r=-1/-2 nằm trên hàng a, r=rows/rows+1 nằm dưới hàng cuối,
// mỗi hàng rail cách nhau đúng 1 PITCH (không có khe hở đoạn ở rail).
export function rowZ(r, rows) {
  const gaps = Math.floor((rows - 1) / 5) * SEGMENT_GAP_MM;
  const z0 = -((rows - 1) * PITCH + gaps) / 2;
  if (r >= 0 && r < rows) return z0 + r * PITCH + Math.floor(r / 5) * SEGMENT_GAP_MM;
  if (r < 0) return z0 + r * PITCH;
  return z0 + (rows - 1) * PITCH + gaps + (r - rows + 1) * PITCH;
}
// Lỗ board (InstancedMesh hình trụ trong bench.js): bán kính, cao, số cạnh
// giữ nguyên; mặt trên lỗ cao hơn mặt board 0.35mm để không tranh depth
// buffer với mặt board (z-fighting: mặt lỗ cũ chỉ cao hơn 0.05mm trong khi
// sai số depth ở xa ~0.06mm → lỗ nháy/nhòe, xoay camera mới hết).
export const HOLE_RADIUS = 0.95;
export const HOLE_HEIGHT = 0.6;
export const HOLE_TOP_ABOVE_BOARD = 0.35;
// Tâm trụ lỗ theo mặt board: mặt trên = boardTop + 0.35, đáy chìm 0.25mm
// trong thân board.
export function holeCenterY(boardTop) { return boardTop + HOLE_TOP_ABOVE_BOARD - HOLE_HEIGHT / 2; }
// Độ chính xác depth buffer (mm) tại khoảng cách z, depth buffer 24-bit:
// dz ≈ z² / (near × 2^24). Camera PerspectiveCamera(42, 1, 1, 5000).
export function depthPrecisionAt(z, near = 1) { return (z * z) / (near * 16777216); }
// Khoảng cách camera tới board xa nhất: bán kính orbit kẹp tối đa 900mm
// (wheel zoom) cộng lệch target → lấy tròn 1000mm làm trường hợp xấu nhất.
export const MAX_CAMERA_DISTANCE = 1000;
// Vạch chia đoạn 5 hàng: rộng 1.5mm, vẽ trong texture mặt board (không phải
// khối 3D) để không bao giờ che lỗ — lỗ là đĩa 3D cao hơn mặt board 0.35mm
// còn vạch nằm phẳng trên mặt board. Có khe hở vật lý SEGMENT_GAP_MM nên
// ranh giới cách tâm lỗ kề 2.54mm (= PITCH, nửa khe hở 5.08mm), mép lỗ
// cách ranh giới 2.54 − 0.95 = 1.59mm, lớn hơn nửa bề rộng vạch 0.75mm:
// vạch không chạm tới lỗ nào. Màu đậm #64748B (thay #CBD5E1 mờ) + khe hở
// vật lý để nhìn rõ ranh giới đoạn, tránh nhầm khi kéo linh kiện qua đoạn.
export const SEGMENT_LINE_WIDTH_MM = 1.5;
// Vị trí z (mm) của ranh giới giữa các đoạn 5 hàng (sau hàng 5, 10, 15...),
// tính từ tâm board: điểm giữa 2 hàng lỗ kề ranh giới. Có khe hở vật lý
// nên ranh giới cách mỗi lỗ 2.54mm (= PITCH, nửa khe hở 5.08mm), không
// còn 1.27mm như trước; board 10 hàng thì chỉ 1 ranh giới ở z = 0 (giữa e/f).
export function segmentBoundaries(size) {
  const rows = rowsOf(size);
  const out = [];
  for (let b = 5; b < rows; b += 5) out.push((rowZ(b - 1, rows) + rowZ(b, rows)) / 2);
  return out;
}
// Size bo mạch: 3 mẫu sẵn (kiểu ohmimic) hoặc tự điền {cols, rows, rails}.
// 830 = 63 cột x 10 hàng + 4 rail x 50; 400 = 30 x 10 + 4 x 25;
// 170 = 17 x 10, không có rail (đúng board mini thật).
// Tự điền: rộng 5–100 cột, dài 5–100 hàng (chỉ bội số của 5: 5, 10, 15...
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
export const CUSTOM_COLS_MAX = 100;
export const CUSTOM_ROWS_MIN = 5;
export const CUSTOM_ROWS_MAX = 100;
// Chuẩn hoá size thành giá trị lưu trong state: số (mẫu sẵn) hoặc
// {cols, rows, rails} (tự điền, cột kẹp 5–100, hàng làm tròn XUỐNG về bội
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
// Chiều sâu thân board (mm): từ rail T+ tới rail B− + lề 7mm mỗi bên,
// cộng thêm 1 khe hở đoạn cho mỗi ranh giới 5 hàng trên board.
// Dùng để vẽ mesh, đóng khung camera và nhận diện bấm vào thân board.
export function bodyDepth(size) {
  const rows = rowsOf(size);
  return (rows + 3) * PITCH + 14 + Math.floor((rows - 1) / 5) * SEGMENT_GAP_MM;
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
// Hàng chân chip PIC (internal 0-indexed). Chân là một phần của CHIP,
// không phải của board: chip là một khối duy nhất (thân + chân đi cùng
// nhau), căn giữa board; 2 hàng chân cách nhau CỐ ĐỊNH 6 hàng, đối xứng
// qua tâm chip. Tâm chip (0-indexed, có thể .5) = (rows−1)/2; hàng chân
// trên = floor(tâm) − 3, hàng dưới = trên + 6. Kiểm tra: 10 hàng -> (2, 8)
// b/h; 15 hàng -> (5, 11) e/k; 30 hàng -> (12, 18) l/r; 100 hàng -> (47, 53) au/ba.
// Board <=6 hàng thì hàng trên tính ra <1 (0-indexed <0) -> fallback
// (2, 6), hàng 6 treo ngoài board nếu board <6 hàng (holeId null).
// KHÔNG BAO GIỜ tính chân trực tiếp từ số hàng (không dùng rows−2).
export function picRows(size) {
  const rows = rowsOf(size);
  const upper = Math.floor((rows - 1) / 2) - 3;
  if (upper < 0) return [1, 5];
  return [upper, upper + 6];
}
// Chiều sâu thân chip PIC (mm) theo 2 hàng chân rT/rB: hiệu tọa độ Z thật
// của 2 hàng chân + lề 1,5mm mỗi bên. 2 hàng chân cách nhau cố định 6 hàng
// nhưng có thể có ranh giới đoạn nằm giữa (vd board 830: chân ở hàng b và
// h, ranh giới e/f ở giữa nên khoảng cách = 6*2.54 + 2.54 = 17.78mm, thân
// chip = 20.78mm). Tính từ chỉ số hàng chính: (rB−rT)*PITCH + số ranh
// giới giữa 2 hàng*SEGMENT_GAP_MM — bằng hiệu rowZ khi cả 2 hàng còn
// trong board; dùng công thức này thay vì rowZ vì rB có thể là hàng chính
// treo ngoài board (fallback board 5 hàng: rB=5, rowZ(5,5) lại hiểu là
// rail B+ nên sẽ tính sai).
export function picBodyDepthForRows(rT, rB, rows) {
  return (rB - rT) * PITCH + (Math.floor(rB / 5) - Math.floor(rT / 5)) * SEGMENT_GAP_MM + 3;
}
export function picBodyDepth(size) {
  const [rT, rB] = picRows(size);
  return picBodyDepthForRows(rT, rB, rowsOf(size));
}
// Lỗ neo của chip PIC (chân 1): hàng chân trên, cột picCol (kẹp về 1).
export function picAnchor(size) {
  const r = picRows(size)[0];
  return holeId(r, Math.max(1, picCol(size)), size) ?? (rowLabel(r) + '1');
}
// Nhãn của hàng r (0-indexed), kiểu bảng tính: a–z, aa–az, ba–bz, ...,
// cv (hàng 100). Không còn số trong nhãn, không chuyển chế độ theo số
// hàng: hàng 1→a, 26→z, 27→aa, 52→az, 53→ba, 100→cv. Nhãn chỉ phụ
// thuộc r, không phụ thuộc tổng số hàng của board.
export function rowLabel(r) {
  let n = r + 1;
  let label = '';
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}
// Đổi nhãn hàng (a, z, aa, ab, ..., cv) về chỉ số hàng 0-indexed;
// trả -1 nếu nhãn sai định dạng (rỗng, có số, có chữ hoa).
export function rowIndexFromLabel(label) {
  if (typeof label !== 'string' || !/^[a-z]+$/.test(label)) return -1;
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n - 1;
}
// Chuyển 1 id lỗ từ định dạng cũ sang định dạng mới, dùng khi tải state
// đã lưu trước khi đổi nhãn hàng. Board >26 hàng cũ dùng chữ+số khối
// (vd c112 = hàng c1 cột 12, b25 = hàng b2 cột 5); parser mới đọc sai
// các id này (c112 thành hàng c cột 112, b25 thành hàng b cột 25) nên
// phải đổi bằng quy tắc parse CŨ với số hàng đã lưu, rồi định dạng lại
// bằng rowLabel mới. Board <=26 hàng thì id cũ đã đúng định dạng mới.
// Id rail (T+/B-) và cọc nguồn (PSU1.+/-) không khớp mẫu lỗ nên giữ
// nguyên. Chỉ gọi 1 lần cho state cũ — state mới đã có cờ labelFormat
// 'sheet' thì không gọi nữa, vì id mới 'a12' trùng chữ với id cũ 'a12'
// nhưng nghĩa khác (hàng a cột 12 thay vì hàng a1 cột 2).
export function migrateOldHoleId(id, oldRows) {
  if (typeof id !== 'string' || oldRows <= 26) return id;
  const m = id.match(/^([a-z])(\d)(\d+)$/);
  if (!m) return id;
  const r = (Number(m[2]) - 1) * 26 + (m[1].charCodeAt(0) - 97);
  const c = Number(m[3]);
  if (r < 0 || r >= oldRows || c < 1) return id;
  return rowLabel(r) + c;
}
// Định dạng nhãn hàng của các id lỗ trong state đã lưu: 'sheet' (kiểu
// bảng tính). State lưu trước khi đổi nhãn không có trường này.
export const HOLE_LABEL_FORMAT = 'sheet';
// Hàng trong lưới nội bộ: T+ = -2, T− = -1, a..z = 0..rows-1,
// B+ = rows, B− = rows+1 (B+/B− phụ thuộc số hàng).
const railRowName = (r, rows) => (r === -2 ? 'T+' : r === -1 ? 'T-' : r === rows ? 'B+' : r === rows + 1 ? 'B-' : null);
const railRowOf = (name, rows) => (name === 'T+' ? -2 : name === 'T-' ? -1 : name === 'B+' ? rows : name === 'B-' ? rows + 1 : null);

// Id lỗ từ (hàng nội bộ, cột) trên board size cho trước. Trả null nếu ngoài board.
export function holeId(r, c, size = DEFAULT_SIZE) {
  const rows = rowsOf(size);
  if (r >= 0 && r < rows) {
    if (c < 1 || c > colsOf(size)) return null;
    return rowLabel(r) + c;
  }
  const name = railRowName(r, rows);
  if (name) {
    if (c < 1 || c > railColsOf(size)) return null;
    return name + c;
  }
  return null;
}

// Phân tích id lỗ -> {r, c} (r là hàng nội bộ) hoặc null nếu sai định dạng
// hoặc ngoài board size cho trước. Một định dạng duy nhất cho mọi board:
// nhãn hàng kiểu bảng tính (a–z, aa, ab, ...) + số cột
// (vd c12 = hàng c cột 12, aa12 = hàng aa cột 12, cv99 = hàng cv cột 99).
// Id rail (T+40, T-5, B+42, B-1) vẫn giữ nguyên như cũ.
export function parseHole(id, size = DEFAULT_SIZE) {
  if (typeof id !== 'string') return null;
  const rows = rowsOf(size);
  const m = id.match(/^([a-z]+)(\d+)$/);
  if (m) {
    const r = rowIndexFromLabel(m[1]);
    const c = Number(m[2]);
    if (r >= 0 && r < rows && c >= 1 && c <= colsOf(size)) return { r, c };
    return null;
  }
  const m2 = id.match(/^([TB])([+-])(\d+)$/);
  if (m2) {
    const c = Number(m2[3]);
    if (c < 1 || c > railColsOf(size)) return null;
    return { r: railRowOf(m2[1] + m2[2], rows), c };
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
// Hàng tính theo rowZ nên có khe hở đoạn (hàng e–f cách nhau 5.08mm).
export function holePos(id, size = DEFAULT_SIZE) {
  const p = parseHole(id, size);
  if (!p) return null;
  return { x: (p.c - (colsOf(size) + 1) / 2) * PITCH, z: rowZ(p.r, rowsOf(size)) };
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
  // LCD 16x2 HD44780: 12 chân. Thứ tự khớp chân thật của module:
  // VSS(1), VDD(2), RS(4), E(6), D0–D7(7–14) — VO(3) chỉnh độ tương
  // phản và RW(5) không mô phỏng (RW nối GND trong, VO bỏ qua).
  // VDD/VSS nằm BÊN TRÁI RS (dc -2/-1) như module thật; các chân cũ
  // RS, E, D0–D7 GIỮ NGUYÊN vị trí (dc 0–9) để không vỡ lab đã đấu.
  lcd: [
    { term: 'VSS', dc: -2, dr: 0 }, { term: 'VDD', dc: -1, dr: 0 },
    { term: 'RS', dc: 0, dr: 0 }, { term: 'E', dc: 1, dr: 0 },
    { term: 'D0', dc: 2, dr: 0 }, { term: 'D1', dc: 3, dr: 0 },
    { term: 'D2', dc: 4, dr: 0 }, { term: 'D3', dc: 5, dr: 0 },
    { term: 'D4', dc: 6, dr: 0 }, { term: 'D5', dc: 7, dr: 0 },
    { term: 'D6', dc: 8, dr: 0 }, { term: 'D7', dc: 9, dr: 0 },
  ],
  buzzer: [{ term: 'P', dc: 0, dr: 0 }, { term: 'N', dc: 1, dr: 0 }],
  // Đồng hồ đo (multimeter): 2 chân P (+) và N (−), cách nhau 4 cột như
  // điện trở. Mode 'V' (đo áp): trở kháng vô cùng, không nối 2 strip.
  // Mode 'A' (đo dòng): 0Ω, nối 2 strip như dây (xem buildBenchNets),
  // dòng đo từ P sang N. Mode nằm trong props.mode ('V' mặc định).
  multimeter: [{ term: 'P', dc: 0, dr: 0 }, { term: 'N', dc: 4, dr: 0 }],
  // Tụ gốm: 2 chân như điện trở (cách 4 cột). Hở mạch với DC — không
  // nối 2 strip trong netlist (xem buildBenchNets), chỉ là tụ nạp cho
  // mạch dao động thạch anh.
  capacitor: [{ term: 'L1', dc: 0, dr: 0 }, { term: 'L2', dc: 4, dr: 0 }],
  // Thạch anh: 2 chân OSC1/OSC2, cách nhau 1 cột (nối 2 chân OSC kề
  // nhau của PIC). Hở mạch với DC như tụ gốm; tần số của nó là xung
  // nhịp cho CPU (xem crystalFreq).
  crystal: [{ term: 'OSC1', dc: 0, dr: 0 }, { term: 'OSC2', dc: 1, dr: 0 }],
  // LED 7 thanh: gói DIP 2 hàng chân (như chip PIC nhưng nhỏ hơn).
  // Hàng trên (dr 0): a, b, c, d, dp. Hàng dưới (dr 5): e, f, g, COM
  // (chân chung). 2 hàng CÁCH NHAU 5 HÀNG (khác đoạn strip) để chân
  // hàng trên và hàng dưới cùng cột không bị nối tắt qua strip (vd chân
  // a ở a10 và chân e ở f10 phải khác strip). Mỗi đoạn là 1 LED nối về
  // chân chung (xem solver).
  sevenseg: [
    { term: 'a', dc: 0, dr: 0 }, { term: 'b', dc: 1, dr: 0 },
    { term: 'c', dc: 2, dr: 0 }, { term: 'd', dc: 3, dr: 0 },
    { term: 'dp', dc: 4, dr: 0 },
    { term: 'e', dc: 0, dr: 5 }, { term: 'f', dc: 1, dr: 5 },
    { term: 'g', dc: 2, dr: 5 }, { term: 'COM', dc: 3, dr: 5 },
  ],
  // Bàn phím ma trận 4x4: 2 hàng chân như LED 7 thanh (hàng trên R0–R3,
  // hàng dưới C0–C3, cách nhau 5 hàng để không nối tắt qua strip).
  // Phím đang nhấn nối hàng của nó với cột của nó (công tắc đóng, xem
  // buildBenchNets); CPU quét bằng cách lái từng hàng xuống 0 rồi đọc cột.
  keypad: [
    { term: 'R0', dc: 0, dr: 0 }, { term: 'R1', dc: 1, dr: 0 },
    { term: 'R2', dc: 2, dr: 0 }, { term: 'R3', dc: 3, dr: 0 },
    { term: 'C0', dc: 0, dr: 5 }, { term: 'C1', dc: 1, dr: 5 },
    { term: 'C2', dc: 2, dr: 5 }, { term: 'C3', dc: 3, dr: 5 },
  ],
  // Động cơ DC: 2 chân +/− cách nhau 1 cột như còi. Tải trở trong
  // solver (điện trở cuộn dây, mặc định 100Ω) — không nối 2 strip như
  // dây, mà là nhánh dẫn giữa 2 node (xem circuit-solver.js).
  motor: [{ term: '+', dc: 0, dr: 0 }, { term: '-', dc: 1, dr: 0 }],
  // Đồng hồ hiện sóng KHÔNG còn trong bảng chân: nó là linh kiện NGOÀI
  // BÀN (như khối nguồn), ngồi trên mặt bàn, nối dây vào 3 cọc CH1/CH2/GND
  // ở mặt trước thân máy (xem parseScopePost/scopePostPos ở dưới). Trở
  // kháng vô cùng như multimeter chế độ V: chỉ đọc điện áp, không ảnh
  // hưởng mạch (không thêm terminal vào netlist CPU, xem buildBenchNets).
  // Màn hình Serial cũng vậy (xem parseSerialPost/serialPostPos).
};

// Chế độ của đồng hồ đo: 'A' (đo dòng) hoặc 'V' (đo áp, mặc định khi
// props.mode thiếu/sai). Dùng chung cho buildBenchNets, solver, bench.js
// để 3 chỗ không lệch nhau khi đổi mode trong popup Inspector.
export function meterMode(comp) {
  return comp && comp.props && comp.props.mode === 'A' ? 'A' : 'V';
}

// Chân chip PIC16F877A DIP-40 (rộng 600 mil = 6 bước lỗ): chân 1..20 ở hàng
// chân trên, chân 21..40 ở hàng chân dưới (picRows: đối xứng qua tâm chip,
// cách nhau cố định 6 hàng), cột picCol(size)..picCol(size)+19.
// Thứ tự chân khớp datasheet (và khớp PIC_PINS trong wiring.js — test
// kiểm chứng điều này).
export const PIC_PIN_IDS_LEFT = ['MCLR', 'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5', 'RE0', 'RE1', 'RE2', 'VDD', 'VSS', 'OSC1', 'OSC2', 'RC0', 'RC1', 'RC2', 'RC3', 'RD0', 'RD1'];
export const PIC_PIN_IDS_RIGHT = ['RD2', 'RD3', 'RC4', 'RC5', 'RC6', 'RC7', 'RD4', 'RD5', 'RD6', 'RD7', 'VSS', 'VDD', 'RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7'];

// Chân chip: [{term: 'PIC.RA0', hole: 'b23', pin: 2, r: 1, c: 23}] —
// pin 1 ở (hàng chân trên, picCol), pin 20 ở (hàng chân trên, picCol+19),
// pin 21 ở (hàng chân dưới, picCol+19), pin 40 ở (hàng chân dưới, picCol).
// Trên board Mini 170 thì 6 chân ngoài cùng có hole = null (treo ngoài
// board, xem ghi chú ở BOARD_SIZES).
// Chân chip theo LỖ NEO (anchor) của chip — không theo size board.
// Chip là 1 khối: 2 hàng chân cách nhau cố định 6 hàng, hàng trên = hàng
// của lỗ neo, hàng dưới = hàng neo + 6, cột neo..neo+19. Đổi size board
// (mở thêm hàng/cột ở vùng trống) KHÔNG được dời chip: chip giữ nguyên
// lỗ neo, mạch đã cắm (vd Lab 1) vẫn nguyên. picCol/picRows chỉ dùng để
// tính lỗ neo MẶC ĐỊNH cho board mới (picAnchor), không dùng để đặt chân.
export function picLegsForAnchor(anchor, size = DEFAULT_SIZE) {
  const a = typeof anchor === 'string' ? parseHole(anchor, size) : anchor;
  if (!a) return [];
  const rT = a.r, rB = a.r + 6, c0 = a.c;
  const out = [];
  PIC_PIN_IDS_LEFT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(rT, c0 + i, size), pin: i + 1, r: rT, c: c0 + i });
  });
  PIC_PIN_IDS_RIGHT.forEach((id, i) => {
    out.push({ term: 'PIC.' + id, hole: holeId(rB, c0 + 19 - i, size), pin: 21 + i, r: rB, c: c0 + 19 - i });
  });
  return out;
}
// Chân chip trên board mới (chưa có chip): căn giữa board theo size.
// Giữ nguyên công thức cũ (picCol có thể = 0 trên board hẹp như Mini 170,
// chân 1/40 treo ngoài board) để test vị trí căn giữa không đổi.
// Chân chip ĐÃ CẮM thì đi theo lỗ neo (picLegsForAnchor), không dùng hàm này.
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
    // Chân chip đi theo lỗ neo của chip (không theo size board).
    const a = parseHole(comp.anchor, size);
    return (a ? picLegsForAnchor(a, size) : picLegs(size)).map((l) => ({ term: l.term, hole: l.hole }));
  }
  if (comp.type === 'psu' || comp.type === 'oscilloscope' || comp.type === 'serial') return [];
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
  if (type === 'psu' || type === 'oscilloscope' || type === 'serial') return { ok: true, legs: [] }; // nguồn / hiện sóng / màn hình Serial đặt trên mặt bàn, không cần lỗ
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
    // Vùng thân chip theo lỗ neo THẬT của chip trên bàn (không phải vị trí
    // căn giữa theo size), để đổi size board không làm lệch vùng cấm.
    const pic = state.components.find((c) => c.type === 'pic');
    const pa = pic ? parseHole(pic.anchor, size) : null;
    const pc = pa ? pa.c : picCol(size);
    const rT = pa ? pa.r : picRows(size)[0];
    const rB = rT + 6;
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
// - phím bàn phím đang nhấn giữ (pressedKeypad = {id, row, col}) = công
//   tắc đóng: nối strip của hàng đó với strip của cột đó lại với nhau.
// - nhóm chạm RAIL+ là +5V, chạm RAIL- là GND.
export function buildBenchNets(state, pressedIds = [], pressedKeypad = null) {
  const size = state.size ?? DEFAULT_SIZE;
  const { find, union, ensure } = makeUnionFind();
  ensure('RAIL+');
  ensure('RAIL-');
  const termStrip = new Map();
  const resistorStrips = new Set();
  // Nhãn kề (adjacency) của các đầu nối "thụ động" — chân điện trở/tụ/
  // thạch anh, chân đồng hồ đo, cọc scope/Serial: chúng không phải
  // terminal netlist CPU (không vào termStrip) nhưng là đầu nối thật
  // trên strip. Ghi lại để describeTerminal liệt kê chúng làm "hàng
  // xóm" và benchToNetlist nối dây tới chúng (Issue 13): đầu nối chỉ
  // nối tới những đầu này (vd chân PIC chỉ nối dây tới cọc CH1 của
  // scope) thì không còn báo "chưa nối" sai. stripKey -> Set(nhãn).
  const stripLabels = new Map();
  const addLabel = (strip, label) => {
    if (!strip || !label) return;
    if (!stripLabels.has(strip)) stripLabels.set(strip, new Set());
    stripLabels.get(strip).add(label);
  };
  for (const comp of state.components) {
    if (comp.type === 'pic') {
      // Chân chip theo lỗ neo của chip trên bàn (legsFor dùng anchor).
      for (const leg of legsFor(comp, size)) {
        const key = leg.hole ? stripKey(leg.hole, size) : null;
        if (!key) continue;
        ensure(key);
        termStrip.set(leg.term, key);
      }
      continue;
    }
    if (comp.type === 'psu') continue;
    const legs = legsFor(comp, size);
    // Chân của linh kiện "thụ động": ghi nhãn kề lên strip của nó
    // (điện trở, tụ gốm, thạch anh, đồng hồ đo cả 2 chế độ). Riêng điện
    // trở và đồng hồ chế độ A vẫn nối 2 strip như dây (khối dưới).
    if (comp.type === 'resistor' || comp.type === 'capacitor' || comp.type === 'crystal' || comp.type === 'multimeter') {
      for (const leg of legs) {
        const key = leg.hole ? stripKey(leg.hole, size) : null;
        if (!key) continue;
        ensure(key);
        addLabel(key, comp.id + '.' + leg.term);
      }
    }
    // Điện trở nối 2 strip của nó (như 1 dây). Đồng hồ đo ở chế độ A
    // cũng vậy (0Ω, dòng chạy qua như dây) nhưng KHÔNG tính là điện trở
    // hạn dòng cho LED (không vào resistorStrips) — LED chỉ có đồng hồ
    // đo dòng vẫn bị cảnh báo thiếu điện trở. Đồng hồ ở chế độ V
    // (trở kháng vô cùng): không nối 2 strip, không thêm terminal vào
    // netlist.
    if (comp.type === 'resistor' || (comp.type === 'multimeter' && meterMode(comp) === 'A')) {
      const keys = legs.map((l) => (l.hole ? stripKey(l.hole, size) : null)).filter(Boolean);
      keys.forEach((k) => { ensure(k); if (comp.type === 'resistor') resistorStrips.add(k); });
      for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
      continue;
    }
    if (comp.type === 'multimeter') continue;
    // Đồng hồ hiện sóng cũng là quan sát thụ động (trở kháng vô cùng):
    // không thêm terminal vào netlist (như multimeter chế độ V).
    // Tụ gốm và thạch anh cũng vậy: hở mạch với DC, không nối 2 strip
    // của nó trong netlist (chúng chỉ là tụ nạp / nguồn xung cho mạch
    // dao động, không phải nhánh dẫn).
    if (comp.type === 'oscilloscope' || comp.type === 'capacitor' || comp.type === 'crystal') continue;
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
  // Strip của 1 đầu dây: lỗ -> strip của lỗ đó; cọc nguồn -> RAIL+/RAIL-;
  // cọc hiện sóng / cọc màn hình Serial -> null (chỉ quan sát, không nối
  // gì trong netlist CPU); đầu {x,y,z} cũ -> cọc nguồn/cọc hiện sóng/cọc
  // Serial nếu khớp vị trí cọc, còn không thì bỏ qua. Dây 1 đầu lỗ + 1
  // đầu cọc scope/Serial bị bỏ qua ở vòng union dưới (kiểm ka && kb) nên
  // strip của lỗ đó không đổi.
  const endStripKey = (e) => {
    if (typeof e === 'string') {
      const pp = parsePsuPost(e);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
      if (parseScopePost(e)) return null;
      if (parseSerialPost(e)) return null;
      return stripKey(e, size);
    }
    const norm = normalizeWireEnd(state, e);
    if (typeof norm === 'string') {
      const pp = parsePsuPost(norm);
      if (pp) return pp.sign === '+' ? 'RAIL+' : 'RAIL-';
      if (parseScopePost(norm)) return null;
      if (parseSerialPost(norm)) return null;
    }
    return null;
  };
  // Cọc scope/Serial của 1 đầu dây (id cọc, hoặc null nếu đầu dây không
  // phải cọc): đầu {x,y,z} cũ thì normalizeWireEnd đổi thành id cọc
  // rồi mới xét.
  const postOfEnd = (e) => {
    if (typeof e === 'string') {
      if (parseScopePost(e)) return e;
      if (parseSerialPost(e)) return e;
      return null;
    }
    const norm = normalizeWireEnd(state, e);
    if (typeof norm === 'string') {
      if (parseScopePost(norm)) return norm;
      if (parseSerialPost(norm)) return norm;
    }
    return null;
  };
  for (const w of state.wires) {
    const ka = endStripKey(w.a);
    const kb = endStripKey(w.b);
    if (ka && kb) { ensure(ka); ensure(kb); union(ka, kb); }
    // Cọc scope/Serial: dây từ lỗ tới cọc thì cọc là đầu nối thật trên
    // strip của lỗ đó (chỉ quan sát, không nối mạch) — ghi nhãn kề để
    // đầu nối ở lỗ đó không báo "chưa nối" sai (Issue 13).
    const postA = postOfEnd(w.a), postB = postOfEnd(w.b);
    if (postA && kb) { ensure(kb); addLabel(kb, postA); }
    if (postB && ka) { ensure(ka); addLabel(ka, postB); }
  }
  const groups = new Map();
  for (const [term, key] of termStrip) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, { terms: [], vcc: false, gnd: false, strips: new Set() });
    groups.get(root).terms.push(term);
    groups.get(root).strips.add(key);
  }
  // Ghi nhãn kề vào nhóm: mỗi strip có nhãn thì nhãn đó thành thành viên
  // của nhóm chứa strip (để describeTerminal liệt kê + benchToNetlist
  // nối dây tới nó). Strip không thuộc nhóm nào (không có terminal thật
  // trên strip đó) thì bỏ nhãn (không có gì để mô tả).
  for (const [strip, labels] of stripLabels) {
    const root = find(strip);
    const g = groups.get(root);
    if (!g) continue;
    for (const label of labels) {
      if (!g.terms.includes(label)) g.terms.push(label);
    }
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
// Tỉ lệ khối nguồn (PSU): thu nhỏ 50% (Điệp lệnh 25/11: "cho cục nguồn bé đi 50%").
// Offset cọc nguồn so với tâm khối nguồn (đã thu nhỏ 50% từ 12/28/42).
export const PSU_SCALE = 0.5;
export const PSU_POST_DX = 6;  // |x| cọc so với tx
export const PSU_POST_Y = 14;  // cao cọc
export const PSU_POST_DZ = 21; // z cọc so với tz (mặt trước hộp)
// Vị trí cọc cũ trước khi thu nhỏ (để normalizeWireEnd đổi đầu dây {x,y,z} đã lưu từ trước).
const PSU_POST_DX_OLD = 12;
const PSU_POST_DZ_OLD = 42;
// Vị trí 3D của cọc nguồn trên bàn (mm): cọc + ở x = tx−6, cọc − ở
// x = tx+6, cao y = 14, mặt trước hộp nguồn z = tz+21.
export function psuPostPos(state, id) {
  const pp = parsePsuPost(id);
  if (!pp) return null;
  const comp = state.components.find((c) => c.id === pp.psuId && c.type === 'psu');
  if (!comp) return null;
  return { x: comp.tx + (pp.sign === '+' ? -PSU_POST_DX : PSU_POST_DX), y: PSU_POST_Y, z: comp.tz + PSU_POST_DZ };
}
// Đầu dây {x,y,z} cũ (lưu trước khi có id cọc) -> id cọc nếu khớp vị trí cọc nguồn.
// Chấp nhận cả vị trí cọc mới (đã thu nhỏ 50%) và vị trí cũ (state lưu trước khi thu nhỏ).
export function normalizeWireEnd(state, e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.x === 'number' && typeof e.z === 'number') {
    for (const c of state.components) {
      if (c.type !== 'psu') continue;
      for (const [dx, dz, sign] of [[-PSU_POST_DX, PSU_POST_DZ, '+'], [PSU_POST_DX, PSU_POST_DZ, '-'], [-PSU_POST_DX_OLD, PSU_POST_DZ_OLD, '+'], [PSU_POST_DX_OLD, PSU_POST_DZ_OLD, '-']]) {
        if (Math.abs(e.x - (c.tx + dx)) < 6 && Math.abs(e.z - (c.tz + dz)) < 6) return c.id + '.' + sign;
      }
    }
    // Đầu {x,y,z} cũ khớp cọc hiện sóng thì đổi thành id cọc ('OSC1.CH1'...).
    for (const c of state.components) {
      if (c.type !== 'oscilloscope') continue;
      for (const [term, dx] of [['CH1', -SCOPE_POST_DX], ['CH2', 0], ['GND', SCOPE_POST_DX]]) {
        if (Math.abs(e.x - (c.tx + dx)) < 6 && Math.abs(e.z - (c.tz + SCOPE_POST_DZ)) < 6) return c.id + '.' + term;
      }
    }
    // Đầu {x,y,z} cũ khớp cọc màn hình Serial thì đổi thành id cọc ('SER0.TX'...).
    for (const c of state.components) {
      if (c.type !== 'serial') continue;
      for (const [term, dx] of [['TX', -SERIAL_POST_DX], ['RX', 0], ['GND', SERIAL_POST_DX]]) {
        if (Math.abs(e.x - (c.tx + dx)) < 6 && Math.abs(e.z - (c.tz + SERIAL_POST_DZ)) < 6) return c.id + '.' + term;
      }
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
// Cọc của đồng hồ hiện sóng: linh kiện NGOÀI BÀN (như khối nguồn), ngồi
// trên mặt bàn, nối dây từ lỗ breadboard vào 3 cọc CH1/CH2/GND ở mặt
// trước thân máy (id 'OSC1.CH1' / 'OSC1.CH2' / 'OSC1.GND').
// Thân máy 100 rộng × 60 cao × 50 sâu (mm), KHÔNG scale như PSU nên tọa
// độ cọc là tọa độ 3D thật: cọc ở mặt trước (z = tz+26), cao y = 10,
// CH1 x = tx−28, CH2 x = tx, GND x = tx+28.
// Vị trí mặc định khi đặt mới / khi migrate scope cũ: tx=130, tz=-150
// (cạnh phải nguồn, sau board, không chồng nguồn: nguồn rộng 60 ở tx=0
// trải −30..30; scope rộng 100 ở tx=130 trải 80..180).
// ---------------------------------------------------------------------------
export const SCOPE_POST_DX = 28; // |x| cọc CH1/GND so với tx (CH2 ở giữa)
export const SCOPE_POST_Y = 10;  // cao cọc
export const SCOPE_POST_DZ = 26; // z cọc so với tz (mặt trước hộp sâu 50 ở +25, cọc nhô +1)
export const SCOPE_DEFAULT_TX = 130;
export const SCOPE_DEFAULT_TZ = -150;
export function parseScopePost(id) {
  const m = typeof id === 'string' ? id.match(/^OSC(\d+)\.(CH1|CH2|GND)$/) : null;
  return m ? { scopeId: 'OSC' + m[1], term: m[2] } : null;
}
// Vị trí 3D của cọc hiện sóng trên bàn (mm).
export function scopePostPos(state, id) {
  const sp = parseScopePost(id);
  if (!sp) return null;
  const comp = state.components.find((c) => c.id === sp.scopeId && c.type === 'oscilloscope');
  if (!comp) return null;
  const dx = sp.term === 'CH1' ? -SCOPE_POST_DX : sp.term === 'GND' ? SCOPE_POST_DX : 0;
  return { x: comp.tx + dx, y: SCOPE_POST_Y, z: comp.tz + SCOPE_POST_DZ };
}
// Lỗ chân CŨ của scope cắm lỗ (trước khi đổi sang linh kiện ngoài bàn):
// 3 chân CH1/CH2/GND cách nhau 2 cột từ lỗ neo (dc 0/2/4, dr 0). Chỉ dùng
// trong migration sanitizeState (LEG_LAYOUTS đã bỏ scope nên 3 số này
// hardcode ở đây, không lấy từ bảng chân nữa).
export const SCOPE_LEG_DC_OLD = { CH1: 0, CH2: 2, GND: 4 };

// ---------------------------------------------------------------------------
// Cọc của màn hình Serial: linh kiện NGOÀI BÀN (như đồng hồ hiện sóng),
// ngồi trên mặt bàn, nối dây từ lỗ breadboard vào 3 cọc TX/RX/GND ở mặt
// trước thân máy (id 'SER0.TX' / 'SER0.RX' / 'SER0.GND').
// Thân máy 100 rộng × 60 cao × 50 sâu (mm) như scope; cọc ở mặt trước
// (z = tz+26), cao y = 10, TX x = tx−28, RX x = tx, GND x = tx+28.
// Vị trí mặc định khi đặt mới: tx=-130, tz=-150 (cạnh TRÁI nguồn, đối
// xứng với scope ở cạnh phải tx=130; nguồn rộng 60 ở tx=0 trải −30..30;
// màn hình Serial rộng 100 ở tx=-130 trải −180..−80, không chồng nguồn).
// Dữ liệu KHÔNG đi qua dây/cọc: CPU phát qua onTx, nhận qua receiveChar
// (xem pic16.js + app.js). Dây/cọc chỉ để mạch trông đầy đủ/thật như
// đấu nối thật (TX->RC6, RX->RC7, GND->GND).
// ---------------------------------------------------------------------------
export const SERIAL_POST_DX = 28; // |x| cọc TX/GND so với tx (RX ở giữa)
export const SERIAL_POST_Y = 10;  // cao cọc
export const SERIAL_POST_DZ = 26; // z cọc so với tz (mặt trước hộp sâu 50 ở +25, cọc nhô +1)
export const SERIAL_DEFAULT_TX = -130;
export const SERIAL_DEFAULT_TZ = -150;
export function parseSerialPost(id) {
  const m = typeof id === 'string' ? id.match(/^SER(\d+)\.(TX|RX|GND)$/) : null;
  return m ? { serialId: 'SER' + m[1], term: m[2] } : null;
}
// Vị trí 3D của cọc màn hình Serial trên bàn (mm).
export function serialPostPos(state, id) {
  const sp = parseSerialPost(id);
  if (!sp) return null;
  const comp = state.components.find((c) => c.id === sp.serialId && c.type === 'serial');
  if (!comp) return null;
  const dx = sp.term === 'TX' ? -SERIAL_POST_DX : sp.term === 'GND' ? SERIAL_POST_DX : 0;
  return { x: comp.tx + dx, y: SERIAL_POST_Y, z: comp.tz + SERIAL_POST_DZ };
}

const KIND_LABEL = { led: 'LED', button: 'Nút', pot: 'Chiết áp', lcd: 'LCD', buzzer: 'Còi', multimeter: 'Đồng hồ đo', oscilloscope: 'Đồng hồ hiện sóng', capacitor: 'Tụ gốm', crystal: 'Thạch anh', sevenseg: 'LED 7 thanh', keypad: 'Bàn phím 4x4', motor: 'Động cơ DC', serial: 'Màn hình Serial' };
export function compLabel(comp) {
  const n = comp.id.replace(/^[A-Z]+/, '');
  if (comp.type === 'pic') return 'PIC16F877A';
  if (comp.type === 'psu') return 'Nguồn ' + formatVolts(psuVolts(comp)) + 'V';
  if (comp.type === 'resistor') return 'R' + n + ' (' + (comp.props?.value ?? 220) + 'Ω)';
  return (KIND_LABEL[comp.type] || comp.type) + ' ' + n;
}

export function benchToNetlist(state, pressedIds = [], pressedKeypad = null) {
  const { groups, termRoot, resistorRoots, find } = buildBenchNets(state, pressedIds, pressedKeypad);
  const components = [];
  for (const comp of state.components) {
    // Đồng hồ đo và đồng hồ hiện sóng không phải ngoại vi cho CPU nên
    // không đưa vào netlist (tránh componentTerminals trong wiring.js
    // thiếu định nghĩa cho loại này). Đồng hồ đo ở chế độ A vẫn nối mạch
    // qua buildBenchNets (nối 2 strip như dây); chế độ V và hiện sóng
    // không nối gì. Tụ gốm và thạch anh cũng không đưa vào netlist (hở
    // mạch với DC); xung nhịp lấy từ crystalFreq(state), không qua netlist.
    // Động cơ DC cũng không đưa vào netlist (tải trở trong solver, không
    // phải ngoại vi CPU). Màn hình Serial cũng vậy (giao tiếp qua CPU
    // onTx/receiveChar, không qua netlist).
    if (comp.type === 'pic' || comp.type === 'psu' || comp.type === 'resistor' || comp.type === 'multimeter' || comp.type === 'oscilloscope' || comp.type === 'capacitor' || comp.type === 'crystal' || comp.type === 'motor' || comp.type === 'serial') continue;
    const c = {
      id: comp.id, kind: comp.type, label: compLabel(comp),
      x: 0, y: 0, fixed: !!comp.fixed,
    };
    if (comp.type === 'sevenseg') {
      // Chân chung của LED 7 thanh: 'cathode' (đoạn sáng khi mức 1,
      // chung về GND) hoặc 'anode' (đoạn sáng khi mức 0, chung về VCC).
      c.common = comp.props?.common === 'anode' ? 'anode' : 'cathode';
    }
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
const ID_PREFIX = { led: 'LED', resistor: 'R', button: 'BTN', pot: 'POT', lcd: 'LCD', buzzer: 'BUZ', psu: 'PSU', multimeter: 'MM', oscilloscope: 'OSC', capacitor: 'C', crystal: 'X', sevenseg: 'SEG', keypad: 'KP', motor: 'M', serial: 'SER' };
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
  if (type === 'multimeter') return { mode: 'V' };
  if (type === 'capacitor') return { value: 22 }; // pF (tụ nạp thạch anh)
  if (type === 'crystal') return { freq: 4000000 }; // Hz
  if (type === 'sevenseg') return { common: 'cathode' }; // 'cathode' | 'anode'
  if (type === 'motor') return { value: 100 }; // Ω (điện trở cuộn dây động cơ DC)
  return {};
}

// ---------------------------------------------------------------------------
// Thạch anh: tần số dao động (Hz) của thạch anh trên bàn, hoặc null nếu
// không có thạch anh nối đúng mạch dao động. Đây là xung nhịp thật cho
// CPU — không có thạch anh thì chip không có xung, chương trình không
// chạy (xem app.js loadC: noCrystal -> clockHz = 0). _XTAL_FREQ trong
// code C chỉ dùng để sinh vòng delay, không phải xung nhịp.
// Một thạch anh chỉ cấp xung khi CẢ 2 chân của nó CHUNG STRIP với 2 chân
// OSC1 (chân 13) / OSC2 (chân 14) của PIC: chân thạch anh cắm vào cùng
// đoạn 5 hàng, cùng cột với chân OSC (vd board 830: thạch anh a34/a35
// chung strip với OSC1 b34 / OSC2 b35; board 100x20: f53/f54 chung strip
// với g53/g54). Thạch anh đặt ở chỗ khác trên bàn — dù vẫn nằm trên
// board — KHÔNG cấp xung. Thạch anh đối xứng nên 2 chân đổi cho nhau
// vẫn được. Tụ nạp (load cap 22pF) KHÔNG bắt buộc để có xung (thạch anh
// thật vẫn dao động khi thiếu tụ, chỉ kém ổn định). Thạch anh chỉ nối
// tới strip OSC qua DÂY NHẢY (không cắm trực tiếp vào strip OSC) cũng
// chưa được tính — phải cắm chân thạch anh vào đúng strip OSC.
// Chế độ dao động RC (điện trở + tụ trên OSC1, không có thạch anh) KHÔNG
// được mô phỏng (xem ghi chú FOSC ở pic16.js): không có thạch anh nối
// đúng thì không có xung.
// Ngoại lệ: state rút gọn chưa có anchor cho thạch anh (fixture test,
// linh kiện chưa đặt lên board nên không xác định được chân) thì giữ
// hành vi cũ — trả tần số của thạch anh đó. Trên bàn thật thạch anh
// luôn có anchor nên nhánh này không chạy trong app.
// ---------------------------------------------------------------------------
export const CRYSTAL_FREQS = [4000000, 8000000, 20000000]; // 4 / 8 / 20 MHz
export function crystalFreq(state) {
  const size = state.size ?? DEFAULT_SIZE;
  const comps = state.components || [];
  // Strip của 2 chân OSC của PIC (null nếu không có chip, hoặc chân OSC
  // treo ngoài board) — tính theo lỗ neo THẬT của chip trên bàn.
  let osc1Strip = null, osc2Strip = null;
  const pic = comps.find((c) => c.type === 'pic');
  if (pic) {
    const picLegs_ = legsFor(pic, size);
    const o1 = picLegs_.find((l) => l.term === 'PIC.OSC1');
    const o2 = picLegs_.find((l) => l.term === 'PIC.OSC2');
    osc1Strip = o1 && o1.hole ? stripKey(o1.hole, size) : null;
    osc2Strip = o2 && o2.hole ? stripKey(o2.hole, size) : null;
  }
  let unplacedFreq = null;
  for (const x of comps) {
    if (x.type !== 'crystal') continue;
    const f = Number(x.props?.freq);
    if (!Number.isFinite(f) || f <= 0) continue;
    const legs = legsFor(x, size);
    const l1 = legs.find((l) => l.term === 'OSC1');
    const l2 = legs.find((l) => l.term === 'OSC2');
    // Thạch anh chưa có anchor (không xác định được chân): để dành trả
    // theo hành vi cũ ở cuối (chỉ dùng cho fixture rút gọn, xem trên).
    if (!l1 || !l2) { if (unplacedFreq === null) unplacedFreq = f; continue; }
    const s1 = l1.hole ? stripKey(l1.hole, size) : null;
    const s2 = l2.hole ? stripKey(l2.hole, size) : null;
    // Chân rơi ngoài board, không có chip, hoặc chân OSC treo ngoài
    // board thì không thể nối thành mạch dao động.
    if (!s1 || !s2 || !osc1Strip || !osc2Strip) continue;
    if ((s1 === osc1Strip && s2 === osc2Strip) || (s1 === osc2Strip && s2 === osc1Strip)) return f;
  }
  return unplacedFreq;
}
// Tần số của 1 thạch anh cụ thể (theo id) NẾU nó nối đúng mạch dao động
// (2 chân chung strip với OSC1/OSC2 của PIC), null nếu nó chưa nối đúng
// (đặt ở chỗ khác trên bàn, chân rơi ngoài board, hoặc không có chip).
// Dùng cho Inspector thạch anh hiện "Xung đang dùng: 4 MHz" / "chưa có
// thạch anh" (Issue 17). Thạch anh chưa có anchor (fixture rút gọn) thì
// giữ hành vi cũ — trả tần số của nó, như crystalFreq.
// crystalFreq(state) trả tần số của thạch anh ĐẦU TIÊN nối đúng (xung
// nhịp cho CPU); hàm này trả theo từng thạch anh để Inspector biết
// chính xác thạch anh nào đang cấp xung.
export function crystalFreqOf(state, crystalId) {
  const size = state.size ?? DEFAULT_SIZE;
  const comps = state.components || [];
  let osc1Strip = null, osc2Strip = null;
  const pic = comps.find((c) => c.type === 'pic');
  if (pic) {
    const picLegs_ = legsFor(pic, size);
    const o1 = picLegs_.find((l) => l.term === 'PIC.OSC1');
    const o2 = picLegs_.find((l) => l.term === 'PIC.OSC2');
    osc1Strip = o1 && o1.hole ? stripKey(o1.hole, size) : null;
    osc2Strip = o2 && o2.hole ? stripKey(o2.hole, size) : null;
  }
  const x = comps.find((c) => c.type === 'crystal' && c.id === crystalId);
  if (!x) return null;
  const f = Number(x.props?.freq);
  if (!Number.isFinite(f) || f <= 0) return null;
  const legs = legsFor(x, size);
  const l1 = legs.find((l) => l.term === 'OSC1');
  const l2 = legs.find((l) => l.term === 'OSC2');
  if (!l1 || !l2) return f; // chưa có anchor (fixture rút gọn): giữ hành vi cũ
  const s1 = l1.hole ? stripKey(l1.hole, size) : null;
  const s2 = l2.hole ? stripKey(l2.hole, size) : null;
  if (!s1 || !s2 || !osc1Strip || !osc2Strip) return null;
  if ((s1 === osc1Strip && s2 === osc2Strip) || (s1 === osc2Strip && s2 === osc1Strip)) return f;
  return null;
}
// Chuẩn hóa props của 3 loại mới khi đọc state đã lưu: tụ phải là số
// pF dương, thạch anh phải là 1 trong 3 tần số cho phép, LED 7 thanh
// common chỉ nhận 'cathode'/'anode', động cơ DC điện trở cuộn dây phải
// là số Ω dương. Loại khác giữ nguyên props.
export function cleanNewProps(type, props) {
  const p = { ...defaultProps(type), ...(props || {}) };
  if (type === 'capacitor') {
    const v = Number(p.value);
    p.value = Number.isFinite(v) && v > 0 ? v : 22;
  } else if (type === 'crystal') {
    const f = Number(p.freq);
    p.freq = CRYSTAL_FREQS.includes(f) ? f : 4000000;
  } else if (type === 'sevenseg') {
    p.common = p.common === 'anode' ? 'anode' : 'cathode';
  } else if (type === 'motor') {
    const v = Number(p.value);
    p.value = Number.isFinite(v) && v > 0 ? v : 100;
  }
  return p;
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
    labelFormat: HOLE_LABEL_FORMAT,
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
  // State lưu trước khi đổi nhãn hàng (không có cờ labelFormat) thì id lỗ
  // còn ở định dạng cũ — chuyển 1 lần theo số hàng đã lưu. State mới đã
  // có cờ thì id đã đúng, không chuyển lại.
  const oldRows = rowsOf(size);
  const migrate = raw.labelFormat !== HOLE_LABEL_FORMAT ? (id) => migrateOldHoleId(id, oldRows) : (id) => id;
  // Migration scope cắm lỗ cũ -> scope ngoài bàn: với mỗi scope cũ (có
  // anchor, chưa có tx/tz), tính strip của 3 lỗ chân cũ (CH1/CH2/GND) để
  // viết lại đầu dây nào nằm trên strip đó thành id cọc tương ứng. Dây
  // thường cắm vào lỗ KỀ trong cùng strip (vd b50) chứ không cắm đúng lỗ
  // chân (a50 đã bị chân chiếm) nên phải so theo strip, không so theo lỗ.
  const scopeMigrations = []; // {id, legStrip: Map stripKey -> term}
  for (const c of raw.components || []) {
    if (!c || c.type !== 'oscilloscope' || (typeof c.tx === 'number' && typeof c.tz === 'number')) continue;
    const anchor = parseHole(migrate(c.anchor), size);
    if (!anchor) continue; // anchor không parse được: scope này bị xóa ở dưới, không đoán bừa
    const legStrip = new Map();
    for (const [term, dc] of Object.entries(SCOPE_LEG_DC_OLD)) {
      const hole = holeId(anchor.r, anchor.c + dc, size);
      if (hole) legStrip.set(stripKey(hole, size), term);
    }
    scopeMigrations.push({ id: c.id, legStrip });
  }
  // Viết lại 1 đầu dây theo migration: lỗ nào nằm trên strip chân cũ thì
  // thành id cọc scope ('OSC0.CH1'...), đầu còn lại giữ nguyên.
  const migrateScopeWireEnd = (e) => {
    if (typeof e !== 'string') return e;
    const k = stripKey(e, size);
    if (!k) return e;
    for (const m of scopeMigrations) {
      const term = m.legStrip.get(k);
      if (term) return m.id + '.' + term;
    }
    return e;
  };
  const components = [];
  for (const c of raw.components) {
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string') continue;
    if (c.type === 'pic') {
      // Chip GIỮ NGUYÊN lỗ neo đã lưu (đổi size board không dời chip).
      // Chỉ căn giữa lại khi lỗ neo cũ không còn vừa trên board này.
      const migrated = migrate(c.anchor);
      const a = parseHole(migrated, size);
      const fits = a && a.r >= 0 && a.r + 6 < rowsOf(size) && a.c >= 1 && a.c + 19 <= colsOf(size);
      components.push({ id: 'PIC1', type: 'pic', anchor: fits ? migrated : picAnchor(size), rot: 0, fixed: true, props: {} });
      continue;
    }
    if (c.type === 'psu') {
      if (typeof c.tx === 'number' && typeof c.tz === 'number') {
        components.push({ id: c.id, type: 'psu', tx: c.tx, tz: c.tz, fixed: true, props: { volts: psuVolts(c) } });
      }
      continue;
    }
    if (c.type === 'oscilloscope') {
      // Scope mới (ngoài bàn, có tx/tz): giữ nguyên vị trí. Scope cũ
      // (cắm lỗ, có anchor): migrate về vị trí mặc định cạnh phải nguồn
      // (tx=130, tz=-150), bỏ anchor/rot; dây đã viết lại theo strip chân
      // cũ (scopeMigrations). Anchor không parse được thì xóa scope
      // (không đoán bừa vị trí chân).
      if (typeof c.tx === 'number' && typeof c.tz === 'number') {
        components.push({ id: c.id, type: 'oscilloscope', tx: c.tx, tz: c.tz, fixed: false, props: {} });
      } else if (parseHole(migrate(c.anchor), size)) {
        components.push({ id: c.id, type: 'oscilloscope', tx: SCOPE_DEFAULT_TX, tz: SCOPE_DEFAULT_TZ, fixed: false, props: {} });
      }
      continue;
    }
    if (c.type === 'serial') {
      // Màn hình Serial ngoài bàn (có tx/tz): giữ nguyên vị trí. Serial
      // không có bản cắm lỗ cũ nên thiếu tx/tz thì về vị trí mặc định
      // cạnh trái nguồn (tx=-130, tz=-150).
      if (typeof c.tx === 'number' && typeof c.tz === 'number') {
        components.push({ id: c.id, type: 'serial', tx: c.tx, tz: c.tz, fixed: false, props: {} });
      } else {
        components.push({ id: c.id, type: 'serial', tx: SERIAL_DEFAULT_TX, tz: SERIAL_DEFAULT_TZ, fixed: false, props: {} });
      }
      continue;
    }
    // Đồng hồ cũ (vôn kế/ampe kế) -> multimeter, GIỮ NGUYÊN id để dây
    // và mạch đã lưu không vỡ; mode theo loại cũ (V cho vôn kế, A cho
    // ampe kế). Phải chuyển TRƯỚC khi kiểm tra LEG_LAYOUTS (2 loại cũ
    // không còn trong bảng nữa, không chuyển thì linh kiện bị rớt mất).
    let type = c.type;
    let props = c.props ? { ...c.props } : {};
    if (type === 'voltmeter') { type = 'multimeter'; props.mode = 'V'; }
    else if (type === 'ammeter') { type = 'multimeter'; props.mode = 'A'; }
    if (type === 'multimeter' && props.mode !== 'A') props.mode = 'V';
    const anchor = migrate(c.anchor);
    if (!LEG_LAYOUTS[type] || !parseHole(anchor, size)) continue;
    const chk = canPlace({ size, components }, type, anchor, c.rot || 0);
    if (!chk.ok) continue;
    // Tụ/thạch anh/LED 7 thanh/động cơ DC: chuẩn hóa props (tụ pF dương,
    // thạch anh đúng 1 trong 3 tần số, common chỉ cathode/anode, động cơ
    // điện trở cuộn dây Ω dương); loại khác giữ nguyên props đã lưu
    // (thiếu thì lấy mặc định).
    const finalProps = (type === 'capacitor' || type === 'crystal' || type === 'sevenseg' || type === 'motor')
      ? cleanNewProps(type, props)
      : (Object.keys(props).length ? props : defaultProps(type));
    components.push({ id: c.id, type, anchor, rot: c.rot || 0, props: finalProps });
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
    // Đầu dây hợp lệ: lỗ trên board, cọc nguồn (PSU1.+/PSU1.-), cọc hiện
    // sóng (OSC1.CH1/CH2/GND), cọc màn hình Serial (SER0.TX/RX/GND),
    // hoặc điểm 3D cũ.
    const okEnd = (e) => {
      if (typeof e === 'string') {
        if (parseHole(e, size)) return true;
        const pp = parsePsuPost(e);
        if (pp) return components.some((c) => c.id === pp.psuId);
        const sp = parseScopePost(e);
        if (sp) return components.some((c) => c.id === sp.scopeId && c.type === 'oscilloscope');
        const sr = parseSerialPost(e);
        return !!sr && components.some((c) => c.id === sr.serialId && c.type === 'serial');
      }
      return e && typeof e.x === 'number' && typeof e.y === 'number' && typeof e.z === 'number';
    };
    // Đầu {x,y,z} cũ khớp cọc nguồn/cọc hiện sóng thì đổi thành id cọc;
    // đầu dây trên strip chân scope cũ thì viết lại thành id cọc scope.
    const na = migrateScopeWireEnd(normalizeWireEnd({ components }, migrate(w.a)));
    const nb = migrateScopeWireEnd(normalizeWireEnd({ components }, migrate(w.b)));
    if (okEnd(na) && okEnd(nb)) wires.push({ id: w.id, a: na, b: nb, color: w.color });
  }
  return { size, components, wires, labelFormat: HOLE_LABEL_FORMAT };
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
  // Chip GIỮ NGUYÊN lỗ neo khi đổi size (board chỉ mở thêm ở vùng trống,
  // vd lab ở hàng a–j thì mở thêm từ j trở đi, vùng a–j không động vào).
  // Chỉ căn giữa lại (picAnchor) khi lỗ neo cũ không còn vừa trên size mới
  // (board thu nhỏ quá, chip tràn ra ngoài).
  const oldPic = state.components.find((c) => c.type === 'pic');
  const oldAnchor = oldPic ? parseHole(oldPic.anchor, oldSize) : null;
  const picFits = (a, s) => !!a && a.r >= 0 && a.r + 6 < rowsOf(s) && a.c >= 1 && a.c + 19 <= colsOf(s);
  const keptAnchor = picFits(oldAnchor, size) ? oldPic.anchor : picAnchor(size);
  const legs = picLegsForAnchor(parseHole(keptAnchor, size), size);
  const legByPin = new Map(legs.map((l) => [l.pin, l]));
  const oldLegs = oldAnchor ? picLegsForAnchor(oldAnchor, oldSize) : picLegs(oldSize);
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
    { id: 'PIC1', type: 'pic', anchor: keptAnchor, rot: 0, fixed: true, props: {} },
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
    if (comp.type === 'oscilloscope') {
      // Scope ngoài bàn: giữ nguyên vị trí (không theo size board). Scope
      // cũ cắm lỗ (không có tx/tz) thì bỏ — migration chỉ làm ở
      // sanitizeState (nơi viết lại được dây), ở đây không đoán bừa.
      if (typeof comp.tx === 'number' && typeof comp.tz === 'number') {
        keptComponents.push({ id: comp.id, type: 'oscilloscope', tx: comp.tx, tz: comp.tz, fixed: false, props: {} });
      } else {
        removed.components.push(comp.id);
      }
      continue;
    }
    if (comp.type === 'serial') {
      // Màn hình Serial ngoài bàn: giữ nguyên vị trí (không theo size board).
      if (typeof comp.tx === 'number' && typeof comp.tz === 'number') {
        keptComponents.push({ id: comp.id, type: 'serial', tx: comp.tx, tz: comp.tz, fixed: false, props: {} });
      } else {
        removed.components.push(comp.id);
      }
      continue;
    }
    // Đồng hồ cũ (vôn kế/ampe kế) -> multimeter, giữ nguyên id (như
    // sanitizeState). State trong bộ nhớ thường đã qua sanitizeState nên
    // đây chỉ là phòng thủ khi prune được gọi trên state chưa migrate.
    let type = comp.type;
    let props = comp.props ? { ...comp.props } : {};
    if (type === 'voltmeter') { type = 'multimeter'; props.mode = 'V'; }
    else if (type === 'ammeter') { type = 'multimeter'; props.mode = 'A'; }
    if (type === 'multimeter' && props.mode !== 'A') props.mode = 'V';
    if (!LEG_LAYOUTS[type] || !parseHole(comp.anchor, size)) { removed.components.push(comp.id); continue; }
    const chk = canPlace(probe, type, comp.anchor, comp.rot || 0);
    if (!chk.ok) { removed.components.push(comp.id); continue; }
    const finalProps = (type === 'capacitor' || type === 'crystal' || type === 'sevenseg' || type === 'motor')
      ? cleanNewProps(type, props)
      : (Object.keys(props).length ? props : defaultProps(type));
    keptComponents.push({ id: comp.id, type, anchor: comp.anchor, rot: comp.rot || 0, props: finalProps });
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
      // Đầu dây hợp lệ: lỗ trên board, cọc nguồn, cọc hiện sóng, cọc màn
      // hình Serial, hoặc điểm 3D cũ.
      const okEnd = (e) => {
        if (typeof e === 'string') {
          if (parseHole(e, size)) return true;
          const pp = parsePsuPost(e);
          if (pp) return keptComponents.some((c) => c.id === pp.psuId);
          const sp = parseScopePost(e);
          if (sp) return keptComponents.some((c) => c.id === sp.scopeId && c.type === 'oscilloscope');
          const sr = parseSerialPost(e);
          return !!sr && keptComponents.some((c) => c.id === sr.serialId && c.type === 'serial');
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
  return { state: { size, components: keptComponents, wires: keptWires, labelFormat: HOLE_LABEL_FORMAT }, removed };
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
  // Đích hợp lệ: lỗ trên board, cọc nguồn (PSU1.+/PSU1.-) của nguồn đang
  // có trên bàn, cọc hiện sóng (OSC1.CH1/CH2/GND) của hiện sóng đang có
  // trên bàn, hoặc cọc màn hình Serial (SER0.TX/RX/GND) của màn hình
  // Serial đang có trên bàn.
  const pp = parsePsuPost(newHole);
  const sp = parseScopePost(newHole);
  const sr = parseSerialPost(newHole);
  if (pp) {
    if (!state.components.some((c) => c.id === pp.psuId && c.type === 'psu')) {
      return { ok: false, reason: 'Không có nguồn ' + pp.psuId + ' trên bàn.' };
    }
  } else if (sp) {
    if (!state.components.some((c) => c.id === sp.scopeId && c.type === 'oscilloscope')) {
      return { ok: false, reason: 'Không có hiện sóng ' + sp.scopeId + ' trên bàn.' };
    }
  } else if (sr) {
    if (!state.components.some((c) => c.id === sr.serialId && c.type === 'serial')) {
      return { ok: false, reason: 'Không có màn hình Serial ' + sr.serialId + ' trên bàn.' };
    }
  } else if (!parseHole(newHole, size)) {
    return { ok: false, reason: 'Địa chỉ "' + newHole + '" không hợp lệ trên board ' + sizeLabel(size) + ' (lỗ vd c12, cọc nguồn PSU1.+/PSU1.-, cọc hiện sóng OSC1.CH1, hoặc cọc Serial SER0.TX).' };
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

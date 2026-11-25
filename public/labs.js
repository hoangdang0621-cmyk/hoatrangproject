// labs.js — Danh sách bài lab mẫu cho tab "Bài Lab" (bàn thực hành 3D).
// Mỗi lab chỉ liệt kê linh kiện + dây RIÊNG của lab; chip PIC, nguồn và
// dây nguồn mặc định lấy từ defaultBenchState(size) khi mở lab (buildLabState).
// Thêm lab mới chỉ cần thêm 1 phần tử vào mảng LABS.
// Lỗ chân RB0 (h29), vị trí điện trở/LED và dây nối đã tính bằng legsFor /
// canPlace trên board mặc định 830 và kiểm chứng bằng netlist (test q).
import { defaultBenchState, defaultProps, canPlace, parseHole, parsePsuPost } from './bench-model.js?v=20261125ad';

export const LABS = [
  {
    id: 'led-blink',
    title: 'Điều khiển LED',
    desc: 'LED nối vào chân RB0 của PIC qua điện trở 220Ω, cathode về GND. Sang tab "Nạp viết code" bấm Nạp & chạy để xem LED nhấp nháy theo nhịp chip.',
    size: 830,
    components: [
      { id: 'R0', type: 'resistor', anchor: 'i45', rot: 0, props: { value: 220 } },
      { id: 'LED0', type: 'led', anchor: 'i52', rot: 0, props: { color: '#DC2626' } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    wires: [
      { id: 'LAB1-W1', a: 'i29', b: 'j45', color: '#DC2626' }, // RB0 (strip h29) -> chân điện trở (strip i45)
      { id: 'LAB1-W2', a: 'j49', b: 'j52', color: '#DC2626' }, // điện trở (strip i49) -> anode LED (strip i52)
      { id: 'LAB1-W3', a: 'j53', b: 'B-50', color: '#0F172A' }, // cathode LED (strip i53) -> GND (rail -)
    ],
  },
  {
    id: 'led-lcd',
    title: 'Điều khiển LED + LCD',
    desc: 'Đấu nối sẵn — LCD 16x2 chế độ 8-bit: RS→RE0 (chân 8), E→RE1 (chân 9), D0→RD0 (chân 19), D1→RD1 (chân 20), D2→RD2 (chân 21), D3→RD3 (chân 22), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30). LED xanh lá → RB1 (chân 34) qua điện trở 220Ω, cathode về GND. Trên bàn: LCD neo a54 (RS=a54 … D7=a63), điện trở R1 neo i45, LED1 neo i52. Chương trình: khởi tạo LCD (0x38, 0x0C, 0x01, 0x06), ghi chữ lên dòng 1 và nháy LED RB1.',
    size: 830,
    components: [
      { id: 'R1', type: 'resistor', anchor: 'i45', rot: 0, props: { value: 220 } },
      { id: 'LED1', type: 'led', anchor: 'i52', rot: 0, props: { color: '#16A34A' } },
      { id: 'LCD1', type: 'lcd', anchor: 'a54', rot: 0, props: {} },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // LCD 8-bit (RS=RE0, E=RE1, D0–D7=RD0–RD7): mỗi dây nối strip của 1 chân LCD
    // tới strip của chân PIC tương ứng. Chân PIC (neo b22): RE0=b29, RE1=b30,
    // RD0=b40, RD1=b41, RD2=h41, RD3=h40, RD4=h35, RD5=h34, RD6=h33, RD7=h32.
    // LCD neo a54 (ngoài cột chip 22–41 để khỏi chung strip với chân PIC).
    wires: [
      { id: 'LAB2-W1', a: 'i28', b: 'j45', color: '#DC2626' }, // RB1 (strip h28) -> chân điện trở (strip i45)
      { id: 'LAB2-W2', a: 'j49', b: 'j52', color: '#DC2626' }, // điện trở (strip i49) -> anode LED (strip i52)
      { id: 'LAB2-W3', a: 'j53', b: 'B-50', color: '#0F172A' }, // cathode LED (strip i53) -> GND (rail -)
      { id: 'LAB2-W4', a: 'b54', b: 'a29', color: '#2563EB' }, // LCD.RS (strip a54) -> RE0 (strip b29)
      { id: 'LAB2-W5', a: 'b55', b: 'a30', color: '#2563EB' }, // LCD.E (strip a55) -> RE1 (strip b30)
      { id: 'LAB2-W6', a: 'b56', b: 'a40', color: '#2563EB' }, // LCD.D0 (strip a56) -> RD0 (strip b40)
      { id: 'LAB2-W7', a: 'b57', b: 'a41', color: '#2563EB' }, // LCD.D1 (strip a57) -> RD1 (strip b41)
      { id: 'LAB2-W8', a: 'b58', b: 'i41', color: '#2563EB' }, // LCD.D2 (strip a58) -> RD2 (strip h41)
      { id: 'LAB2-W9', a: 'b59', b: 'i40', color: '#2563EB' }, // LCD.D3 (strip a59) -> RD3 (strip h40)
      { id: 'LAB2-W10', a: 'b60', b: 'i35', color: '#2563EB' }, // LCD.D4 (strip a60) -> RD4 (strip h35)
      { id: 'LAB2-W11', a: 'b61', b: 'i34', color: '#2563EB' }, // LCD.D5 (strip a61) -> RD5 (strip h34)
      { id: 'LAB2-W12', a: 'b62', b: 'i33', color: '#2563EB' }, // LCD.D6 (strip a62) -> RD6 (strip h33)
      { id: 'LAB2-W13', a: 'b63', b: 'i32', color: '#2563EB' }, // LCD.D7 (strip a63) -> RD7 (strip h32)
    ],
  },
];

export function getLab(id) {
  return LABS.find((l) => l.id === id) || null;
}

// Dựng state đầy đủ của 1 lab: bàn mặc định (chip + nguồn + dây nguồn)
// + linh kiện/dây riêng của lab. Trả {ok, state} hoặc {ok:false, reason}.
export function buildLabState(lab) {
  if (!lab || !Array.isArray(lab.components) || !Array.isArray(lab.wires)) {
    return { ok: false, reason: 'Bài lab không hợp lệ.' };
  }
  const state = defaultBenchState(lab.size);
  for (const comp of lab.components) {
    if (!comp || typeof comp.id !== 'string' || typeof comp.type !== 'string' || typeof comp.anchor !== 'string') {
      return { ok: false, reason: 'Linh kiện trong lab không hợp lệ.' };
    }
    const chk = canPlace(state, comp.type, comp.anchor, comp.rot || 0);
    if (!chk.ok) return { ok: false, reason: `Không đặt được ${comp.id} vào lỗ ${comp.anchor}: ${chk.reason}` };
    state.components.push({
      id: comp.id, type: comp.type, anchor: comp.anchor, rot: comp.rot || 0,
      props: { ...defaultProps(comp.type), ...(comp.props || {}) },
    });
  }
  const seen = new Set();
  for (const w of lab.wires) {
    if (!w || typeof w.id !== 'string' || typeof w.color !== 'string') {
      return { ok: false, reason: 'Dây trong lab không hợp lệ.' };
    }
    const okEnd = (e) => {
      if (typeof e !== 'string') return false;
      if (parseHole(e, state.size)) return true;
      return !!parsePsuPost(e);
    };
    if (!okEnd(w.a) || !okEnd(w.b)) {
      return { ok: false, reason: `Dây ${w.id} có đầu không hợp lệ trên board.` };
    }
    if (w.a === w.b) return { ok: false, reason: `Dây ${w.id} có 2 đầu trùng nhau.` };
    const key = [w.a, w.b].sort().join('|');
    if (seen.has(key)) return { ok: false, reason: `Dây ${w.id} trùng với 1 dây khác trong lab.` };
    seen.add(key);
    if (state.wires.some((x) => (x.a === w.a && x.b === w.b) || (x.a === w.b && x.b === w.a))) {
      return { ok: false, reason: `Dây ${w.id} trùng với dây nguồn mặc định.` };
    }
    state.wires.push({ id: w.id, a: w.a, b: w.b, color: w.color });
  }
  return { ok: true, state };
}

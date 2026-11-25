// labs.js — Danh sách bài lab mẫu cho tab "Bài Lab" (bàn thực hành 3D).
// Mỗi lab chỉ liệt kê linh kiện + dây RIÊNG của lab; chip PIC, nguồn và
// dây nguồn mặc định lấy từ defaultBenchState(size) khi mở lab (buildLabState).
// Thêm lab mới chỉ cần thêm 1 phần tử vào mảng LABS.
// Lỗ chân RB0 (h29), vị trí điện trở/LED và dây nối đã tính bằng legsFor /
// canPlace trên board mặc định 830 và kiểm chứng bằng netlist (test q).
import { defaultBenchState, defaultProps, canPlace, parseHole, parsePsuPost } from './bench-model.js?v=20261125t';

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
    wires: [
      { id: 'LAB1-W1', a: 'h29', b: 'i45', color: '#DC2626' }, // RB0 -> chân điện trở
      { id: 'LAB1-W2', a: 'i49', b: 'i52', color: '#DC2626' }, // điện trở -> anode LED
      { id: 'LAB1-W3', a: 'i53', b: 'B-50', color: '#0F172A' }, // cathode LED -> GND (rail -)
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

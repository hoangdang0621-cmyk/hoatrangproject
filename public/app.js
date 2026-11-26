// app.js — Bootstrap gọn cho trang chỉ có bàn thực hành 3D.
// Tạo CPU PIC16F877A và cầu nối bench ↔ CPU. Chip ĐỨNG YÊN khi mở trang:
// chưa nạp chương trình nào; code mẫu nằm sẵn trong tab "Nạp viết code",
// người dùng bấm "Nạp & chạy" thì chip mới chạy. ProgramRunner điều khiển
// chạy/tạm dừng/chạy từng lệnh/breakpoint.
import { createCPU, ProgramRunner, cyclesForElapsedMs } from './pic16.js?v=20261125aq';
import {
  resolvePeripherals, ledStates, buzzerStates,
  applyButtonToCpu, applyPotToCpu,
} from './wiring.js?v=20261125r';
import { defaultBenchState, benchToNetlist } from './bench-model.js?v=20261125aw';
import { meterReadings, scopeVoltages, pushScopeSample, SCOPE_MAX_SAMPLES } from './circuit-solver.js?v=20261125aw';
import { compileC } from './c-compiler.js?v=20261125ar';

const cpu = createCPU();
cpu.clockHz = 4000000;
const runner = new ProgramRunner(cpu);

// Netlist ban đầu = bàn mặc định (chip PIC + nguồn + dây nguồn về rail).
let mapping = resolvePeripherals(benchToNetlist(defaultBenchState()));
cpu.setWiring(mapping);
let potVoltsById = {};         // id chiết áp -> volt (0..5)

// Áp điện áp của mọi chiết áp vào đúng kênh AN đã nối dây
function applyAllPots() {
  for (const p of mapping.pots) applyPotToCpu(cpu, mapping, p.id, potVoltsById[p.id] ?? 0);
}
applyAllPots();

// Chương trình C mẫu cho tab "Nạp viết code": nhấp nháy LED RB0
// (code mẫu Lab 1, nhiều dòng). Chỉ là code mẫu mở sẵn trong editor —
// chip không tự chạy nó. Phải giống hệt FALLBACK_C trong bench.js.
const DEFAULT_C_PROGRAM = `#include <xc.h>
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

// Vòng lặp chạy 1x thời gian thực theo cpu.clockHz (mặc định 4MHz:
// 1 triệu lệnh/giây; loadC đổi clockHz theo _XTAL_FREQ của code vừa
// dịch, vd code 20MHz thì 5 triệu lệnh/giây). ProgramRunner
// chỉ step khi đang ở trạng thái running, còn lại tick là no-op.
// Đo thời gian thực đã trôi qua rồi chạy bù đủ số chu kỳ, thay vì mặc định
// mỗi lần hẹn giờ là đúng 50ms: trong trình duyệt, khi cảnh 3D nặng thì
// hẹn giờ chạy chậm hơn 50ms mà mỗi lần vẫn chỉ chạy 50ms mô phỏng, nên
// mô phỏng tụt sau giờ thực (code ON 3s hiện ra ~8s). Chặn 500000 chu kỳ
// (500ms) để tránh chạy bù vô hạn khi tab bị ẩn đi lâu rồi quay lại.
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const elapsedMs = now - lastTick;
  lastTick = now;
  const cycles = cyclesForElapsedMs(elapsedMs, cpu.clockHz);
  if (cycles > 0) runner.tick(cycles);
  // Lấy mẫu sóng cho đồng hồ hiện sóng (cả khi CPU pause: tín hiệu tĩnh
  // thì sóng phẳng, đúng hành vi).
  sampleScopes();
}, 50);

// --- Cầu nối cho bàn thực hành 3D (bench.js) ---
// Netlist bench là nguồn sự thật cho CPU: đổi dây/linh kiện trên bàn thì
// chip chạy theo dây mới.
// Đồng hồ đo cần cả state đầy đủ (vôn kế/ampe kế bị lược khỏi netlist CPU),
// nên applyBenchNetlist nhận thêm state + pressedIds để getMeterReadings
// gọi solver được; bench.js truyền 2 tham số này ở syncToCpu().
let benchStateForMeters = null;
let pressedIdsForMeters = [];
// Bộ nhớ vòng của đồng hồ hiện sóng: id scope -> mảng mẫu [ch1, ch2]
// (mỗi mẫu là [volt CH1, volt CH2], null = kênh floating). Lấy mẫu mỗi
// nhịp 50ms (20 mẫu/giây), giữ tối đa SCOPE_MAX_SAMPLES mẫu = 12 giây.
// SCOPE_MAX_SAMPLES lấy từ circuit-solver.js (1 chỗ duy nhất) để hàm
// pushScopeSample dùng chung và test được ở Node.
const scopeBuffers = new Map();
function sampleScopes() {
  if (!benchStateForMeters) return;
  const scopes = benchStateForMeters.components.filter((c) => c.type === 'oscilloscope');
  if (!scopes.length) { if (scopeBuffers.size) scopeBuffers.clear(); return; }
  for (const id of [...scopeBuffers.keys()]) {
    if (!scopes.some((c) => c.id === id)) scopeBuffers.delete(id);
  }
  let readings;
  try { readings = scopeVoltages(benchStateForMeters, cpu, pressedIdsForMeters); } catch { return; }
  for (const r of readings) {
    const buf = scopeBuffers.get(r.id) || [];
    pushScopeSample(buf, [r.ch1, r.ch2]);
    scopeBuffers.set(r.id, buf);
  }
}
window.HoaTrangBenchBridge = {
  applyBenchNetlist(nl, st, pressed) {
    mapping = resolvePeripherals(nl);
    cpu.setWiring(mapping);
    applyAllPots();
    if (st) { benchStateForMeters = st; pressedIdsForMeters = pressed || []; }
  },
  getLedStates: () => ledStates(cpu, mapping),
  getBuzzerStates: () => buzzerStates(cpu, mapping),
  getMeterReadings: () => {
    if (!benchStateForMeters) return { voltmeters: [], ammeters: [] };
    try { return meterReadings(benchStateForMeters, cpu, pressedIdsForMeters); }
    catch { return { voltmeters: [], ammeters: [] }; }
  },
  // Đồng hồ hiện sóng: toàn bộ bộ nhớ vòng (để bench.js vẽ sóng), và xóa
  // sóng 1 scope (nút "Xóa sóng" trong Inspector).
  getScopeData: () => [...scopeBuffers.entries()].map(([id, samples]) => ({ id, samples })),
  clearScope: (id) => { scopeBuffers.delete(id); },
  getLcd: () => ({ lines: cpu.lcd.getLines(), cells: cpu.lcd.getDisplayCells(), complete: !mapping.lcd.id || mapping.lcd.complete }),
  getPin: (port, bit) => ({ dir: cpu.pinDirection(port, bit), level: cpu.pinLevel(port, bit) }),
  getTris: () => cpu.tris,
  getMapping: () => mapping,
  pressButton: (id, pressed) => applyButtonToCpu(cpu, mapping, id, pressed),
  setPot: (id, volts) => { potVoltsById[id] = volts; applyPotToCpu(cpu, mapping, id, volts); },
  // --- Tab "Nạp viết code": soạn code C (XC8) / nạp file .hex ---
  defaultProgram: () => DEFAULT_C_PROGRAM,
  // Dịch code C trong editor rồi nạp vào CPU. compileC trả lineToAddr
  // theo dòng C, nhưng runner.loadAsm tự set map theo dòng HỢP NGỮ đã
  // sinh — nên BẮT BUỘC ghi đè lại bằng map dòng C, không thì breakpoint
  // và dòng hiện tại sẽ chỉ sai dòng. Lỗi thì không nạp gì.
  // clockHz PHẢI theo _XTAL_FREQ của code vừa dịch (r.xtalFreq): vòng
  // delay sinh theo tần số đó, runner nhịp theo cpu.clockHz — lệch nhau
  // thì delay sai giờ thực (vd code 20MHz mà clockHz còn 4MHz thì
  // __delay_ms(250) chạy thành 1,25 giây). File .hex không mang tần số
  // nên loadHex trả clockHz về 4MHz như trước đây.
  loadC(source) {
    const r = compileC(source);
    if (!r.ok) return { ok: false, errors: r.errors };
    cpu.clockHz = r.xtalFreq;
    const loaded = runner.loadAsm(r.asm);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    runner.lineToAddr = r.lineToAddr;
    runner.addrToLine = new Map([...r.lineToAddr].map(([l, a]) => [a, l]));
    applyAllPots();
    return { ok: true, lineToAddr: r.lineToAddr };
  },
  // Chỉ dịch C, không nạp gì (để bench.js dùng cho gutter/breakpoint).
  compileCOnly(source) { return compileC(source); },
  loadHex(text) { const r = runner.loadHex(text); if (r.ok) { cpu.clockHz = 4000000; applyAllPots(); } return r; },
  runProgram: () => runner.run(),
  pauseProgram: () => runner.pause(),
  stepProgram: () => runner.stepOnce(),
  setBreakpointLines: (lines) => runner.setBreakpointLines(lines),
  getRunStatus: () => runner.getStatus(),
};

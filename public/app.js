// app.js — Bootstrap gọn cho trang chỉ có bàn thực hành 3D.
// Tạo CPU PIC16F877A và cầu nối bench ↔ CPU. Chip ĐỨNG YÊN khi mở trang:
// chưa nạp chương trình nào; code mẫu nằm sẵn trong tab "Nạp viết code",
// người dùng bấm "Nạp & chạy" thì chip mới chạy. ProgramRunner điều khiển
// chạy/tạm dừng/chạy từng lệnh/breakpoint.
import { createCPU, ProgramRunner, cyclesForElapsedMs } from './pic16.js?v=20261125ah';
import {
  resolvePeripherals, ledStates, buzzerStates,
  applyButtonToCpu, applyPotToCpu,
} from './wiring.js?v=20261125r';
import { defaultBenchState, benchToNetlist } from './bench-model.js?v=20261125al';
import { meterReadings } from './circuit-solver.js?v=20261125al';
import { compileC } from './c-compiler.js?v=20261125ao';

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

// Vòng lặp chạy 1x thời gian thực @4MHz (1 triệu lệnh/giây). ProgramRunner
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
}, 50);

// --- Cầu nối cho bàn thực hành 3D (bench.js) ---
// Netlist bench là nguồn sự thật cho CPU: đổi dây/linh kiện trên bàn thì
// chip chạy theo dây mới.
// Đồng hồ đo cần cả state đầy đủ (vôn kế/ampe kế bị lược khỏi netlist CPU),
// nên applyBenchNetlist nhận thêm state + pressedIds để getMeterReadings
// gọi solver được; bench.js truyền 2 tham số này ở syncToCpu().
let benchStateForMeters = null;
let pressedIdsForMeters = [];
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
  getLcd: () => ({ lines: cpu.lcd.getLines(), complete: !mapping.lcd.id || mapping.lcd.complete }),
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
  loadC(source) {
    const r = compileC(source);
    if (!r.ok) return { ok: false, errors: r.errors };
    const loaded = runner.loadAsm(r.asm);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    runner.lineToAddr = r.lineToAddr;
    runner.addrToLine = new Map([...r.lineToAddr].map(([l, a]) => [a, l]));
    applyAllPots();
    return { ok: true, lineToAddr: r.lineToAddr };
  },
  // Chỉ dịch C, không nạp gì (để bench.js dùng cho gutter/breakpoint).
  compileCOnly(source) { return compileC(source); },
  loadHex(text) { const r = runner.loadHex(text); if (r.ok) applyAllPots(); return r; },
  runProgram: () => runner.run(),
  pauseProgram: () => runner.pause(),
  stepProgram: () => runner.stepOnce(),
  setBreakpointLines: (lines) => runner.setBreakpointLines(lines),
  getRunStatus: () => runner.getStatus(),
};

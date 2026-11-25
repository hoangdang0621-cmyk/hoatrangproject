// app.js — Bootstrap gọn cho trang chỉ có bàn thực hành 3D.
// Tạo CPU PIC16F877A và cầu nối bench ↔ CPU. Chip ĐỨNG YÊN khi mở trang:
// chưa nạp chương trình nào; code mẫu nằm sẵn trong tab "Nạp viết code",
// người dùng bấm "Nạp & chạy" thì chip mới chạy. ProgramRunner điều khiển
// chạy/tạm dừng/chạy từng lệnh/breakpoint.
import { createCPU, ProgramRunner, cyclesForElapsedMs } from './pic16.js?v=20261125ac';
import {
  resolvePeripherals, ledStates, buzzerStates,
  applyButtonToCpu, applyPotToCpu,
} from './wiring.js?v=20261125r';
import { defaultBenchState, benchToNetlist } from './bench-model.js?v=20261125z';

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

// Chương trình mẫu cho tab "Nạp viết code": nhấp nháy LED RB0.
// Chỉ là code mẫu mở sẵn trong editor — chip không tự chạy nó.
const DEFAULT_PROGRAM = `; Nhap nhay LED RB0 - chuong trinh mac dinh chay san tren ban
    ORG 0
    BANKSEL TRISB
    CLRF TRISB
    BANKSEL PORTB
LOOP
    BSF PORTB, 0
    CALL DELAY
    BCF PORTB, 0
    CALL DELAY
    GOTO LOOP
DELAY
    MOVLW 0xFF
    MOVWF 0x20
D1
    MOVLW 0xFF
    MOVWF 0x21
D2
    DECFSZ 0x21, F
    GOTO D2
    DECFSZ 0x20, F
    GOTO D1
    RETURN
    END`;

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
window.HoaTrangBenchBridge = {
  applyBenchNetlist(nl) {
    mapping = resolvePeripherals(nl);
    cpu.setWiring(mapping);
    applyAllPots();
  },
  getLedStates: () => ledStates(cpu, mapping),
  getBuzzerStates: () => buzzerStates(cpu, mapping),
  getLcd: () => ({ lines: cpu.lcd.getLines(), complete: !mapping.lcd.id || mapping.lcd.complete }),
  getPin: (port, bit) => ({ dir: cpu.pinDirection(port, bit), level: cpu.pinLevel(port, bit) }),
  getTris: () => cpu.tris,
  getMapping: () => mapping,
  pressButton: (id, pressed) => applyButtonToCpu(cpu, mapping, id, pressed),
  setPot: (id, volts) => { potVoltsById[id] = volts; applyPotToCpu(cpu, mapping, id, volts); },
  // --- Tab "Nạp viết code": soạn code hợp ngữ / nạp file .hex ---
  defaultProgram: () => DEFAULT_PROGRAM,
  loadAsm(source) { const r = runner.loadAsm(source); if (r.ok) applyAllPots(); return r; },
  loadHex(text) { const r = runner.loadHex(text); if (r.ok) applyAllPots(); return r; },
  runProgram: () => runner.run(),
  pauseProgram: () => runner.pause(),
  stepProgram: () => runner.stepOnce(),
  setBreakpointLines: (lines) => runner.setBreakpointLines(lines),
  getRunStatus: () => runner.getStatus(),
};

// app.js — Bootstrap gọn cho trang chỉ có bàn thực hành 3D.
// Tạo CPU PIC16F877A, chạy sẵn chương trình nhấp nháy RB0 mặc định để bàn
// sống (LED nối vào strip RB0 sẽ nhấp nháy theo chip), và cầu nối bench ↔ CPU.
// Trang này không nạp code khác: mọi tương tác đều diễn ra trên bàn 3D.
import { assemble, createCPU } from './pic16.js?v=20261125d';
import {
  resolvePeripherals, ledStates,
  applyButtonToCpu, applyPotToCpu,
} from './wiring.js?v=20261125b';
import { defaultBenchState, benchToNetlist } from './bench-model.js?v=20261125h';

const cpu = createCPU();
cpu.clockHz = 4000000;

// Netlist ban đầu = bàn mặc định (chip PIC + nguồn 5V + dây nguồn về rail).
let mapping = resolvePeripherals(benchToNetlist(defaultBenchState()));
cpu.setWiring(mapping);
let potVoltsById = {};         // id chiết áp -> volt (0..5)

// Áp điện áp của mọi chiết áp vào đúng kênh AN đã nối dây
function applyAllPots() {
  for (const p of mapping.pots) applyPotToCpu(cpu, mapping, p.id, potVoltsById[p.id] ?? 0);
}
applyAllPots();

// Chương trình mặc định chạy sẵn trên chip: nhấp nháy LED RB0.
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
const asmResult = assemble(DEFAULT_PROGRAM);
if (!asmResult.errors.length) {
  cpu.loadProgram(asmResult.program);
  applyAllPots();
  // Vòng lặp chạy 1x thời gian thực @4MHz (1 triệu lệnh/giây).
  const timerId = setInterval(() => {
    let budget = 50000; // 50ms x 1M lệnh/giây
    while (budget > 0 && !cpu.sleeping) {
      const before = cpu.cycles;
      cpu.step();
      budget -= Math.max(1, cpu.cycles - before);
    }
    if (cpu.sleeping) clearInterval(timerId);
  }, 50);
}

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
  getLcd: () => ({ lines: cpu.lcd.getLines(), complete: !mapping.lcd.id || mapping.lcd.complete }),
  getPin: (port, bit) => ({ dir: cpu.pinDirection(port, bit), level: cpu.pinLevel(port, bit) }),
  getTris: () => cpu.tris,
  getMapping: () => mapping,
  pressButton: (id, pressed) => applyButtonToCpu(cpu, mapping, id, pressed),
  setPot: (id, volts) => { potVoltsById[id] = volts; applyPotToCpu(cpu, mapping, id, volts); },
};

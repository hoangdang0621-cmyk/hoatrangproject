// app.js — Bootstrap gọn cho trang chỉ có bàn thực hành 3D.
// Tạo CPU PIC16F877A và cầu nối bench ↔ CPU. Chip ĐỨNG YÊN khi mở trang:
// chưa nạp chương trình nào; code mẫu nằm sẵn trong tab "Nạp viết code",
// người dùng bấm "Nạp & chạy" thì chip mới chạy. ProgramRunner điều khiển
// chạy/tạm dừng/chạy từng lệnh/breakpoint.
import { createCPU, ProgramRunner, cyclesForElapsedMs } from './pic16.js?v=20261125be';
import {
  resolvePeripherals, ledStates, buzzerStates, sevenSegStates,
  applyButtonToCpu, applyPotToCpu, applyKeypadToCpu,
} from './wiring.js?v=20261125be';
import { defaultBenchState, benchToNetlist, crystalFreq } from './bench-model.js?v=20261125be';
import { meterReadings, motorReadings, scopeVoltages, pushScopeSample, SCOPE_MAX_SAMPLES } from './circuit-solver.js?v=20261125be';
import { compileC } from './c-compiler.js?v=20261125be';

const cpu = createCPU();
cpu.clockHz = 4000000;
const runner = new ProgramRunner(cpu);

// Màn hình Serial: bộ đệm văn bản đã nhận của từng màn hình (id -> chuỗi
// ký tự). CPU phát ký tự qua TX (onTx) thì nối vào bộ đệm của MỌI màn
// hình đang có trên bàn (thường chỉ 1 cái). Giới hạn 4000 ký tự/màn hình
// (cắt bớt đầu khi vượt). Ghi chú: dữ liệu KHÔNG đi qua dây/cọc — dây
// TX/RX/GND chỉ để mạch trông đầy đủ (xem bench-model.js).
const SERIAL_BUFFER_MAX = 4000;
const serialBuffers = new Map();
cpu.onTx = (code) => {
  if (typeof code !== 'number' || code < 0 || code > 255) return;
  const ch = String.fromCharCode(code);
  for (const [id, buf] of serialBuffers) {
    let next = buf + ch;
    if (next.length > SERIAL_BUFFER_MAX) next = next.slice(next.length - SERIAL_BUFFER_MAX);
    serialBuffers.set(id, next);
  }
};

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
// Phím bàn phím đang nhấn giữ ({id, row, col} hoặc null) — để
// getMeterReadings/getScopeData/getMotorState gọi solver với đúng mạch
// (phím nhấn nối hàng với cột). bench.js truyền vào applyBenchNetlist
// (tham số thứ 4) mỗi lần đồng bộ, như pressedIds của nút bấm.
let pressedKeypadForMeters = null;
// Tần số thạch anh trên bàn (Hz) — xung nhịp thật cho CPU. null khi
// chưa có thạch anh (xem applyBenchNetlist + loadC).
let benchCrystalFreq = null;
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
  try { readings = scopeVoltages(benchStateForMeters, cpu, pressedIdsForMeters, pressedKeypadForMeters); } catch { return; }
  for (const r of readings) {
    const buf = scopeBuffers.get(r.id) || [];
    pushScopeSample(buf, [r.ch1, r.ch2]);
    scopeBuffers.set(r.id, buf);
  }
}
window.HoaTrangBenchBridge = {
  applyBenchNetlist(nl, st, pressed, pressedKeypad) {
    mapping = resolvePeripherals(nl);
    cpu.setWiring(mapping);
    applyAllPots();
    if (st) {
      benchStateForMeters = st; pressedIdsForMeters = pressed || [];
      pressedKeypadForMeters = pressedKeypad || null;
      // Đồng bộ phím bàn phím đang nhấn vào CPU (để pinLevel tính mức
      // cột khi quét). bench.js cũng gọi pressKeypad riêng khi bấm phím;
      // gọi lại ở đây cho chắc (vd khi nạp state đã lưu).
      if (pressedKeypadForMeters && pressedKeypadForMeters.id) {
        applyKeypadToCpu(cpu, mapping, pressedKeypadForMeters.id, { row: pressedKeypadForMeters.row, col: pressedKeypadForMeters.col });
      } else {
        for (const kp of mapping.keypads || []) applyKeypadToCpu(cpu, mapping, kp.id, null);
      }
      // Đồng bộ bộ đệm Serial với màn hình đang có trên bàn: màn hình mới
      // thì tạo bộ đệm rỗng, màn hình đã xóa thì bỏ bộ đệm của nó.
      const serialIds = new Set(st.components.filter((c) => c.type === 'serial').map((c) => c.id));
      for (const id of [...serialBuffers.keys()]) {
        if (!serialIds.has(id)) serialBuffers.delete(id);
      }
      for (const id of serialIds) {
        if (!serialBuffers.has(id)) serialBuffers.set(id, '');
      }
      // Xung nhịp lấy từ thạch anh trên bàn (tần số của thạch anh đầu
      // tiên, null nếu chưa có). Đổi/thêm/bớt thạch anh thì lần nạp
      // chương trình sau mới áp dụng tần số mới.
      benchCrystalFreq = crystalFreq(st);
    }
  },
  getLedStates: () => ledStates(cpu, mapping),
  getBuzzerStates: () => buzzerStates(cpu, mapping),
  // LED 7 thanh: đoạn nào đang sáng (để bench.js vẽ màn hình 3D và
  // Inspector hiện "Đang sáng: a, b, c"). Tần số thạch anh hiện tại
  // (Hz, null nếu chưa có thạch anh) — để bench.js hiện cảnh báo.
  getSevenSegStates: () => sevenSegStates(cpu, mapping),
  getCrystalFreq: () => benchCrystalFreq,
  getMeterReadings: () => {
    if (!benchStateForMeters) return { voltmeters: [], ammeters: [] };
    try { return meterReadings(benchStateForMeters, cpu, pressedIdsForMeters, pressedKeypadForMeters); }
    catch { return { voltmeters: [], ammeters: [] }; }
  },
  // Động cơ DC: điện áp, dòng, tốc độ quay (để bench.js vẽ cánh quạt
  // quay và Inspector hiện V/A/RPM). Trả [{id, volts, amps, rpm}].
  getMotorState: () => {
    if (!benchStateForMeters) return [];
    try { return motorReadings(benchStateForMeters, cpu, pressedIdsForMeters, pressedKeypadForMeters); }
    catch { return []; }
  },
  // Bàn phím ma trận: phím đang nhấn giữ của từng bàn phím (để bench.js
  // tô sáng phím đang nhấn trên panel 3D và Inspector hiện "Đang nhấn:
  // 5"). Trả [{id, row, col, key}] (key = nhãn phím vd '5', 'A', '*').
  getKeypadState: () => [...cpu.keypadPressed.entries()].map(([id, k]) => ({
    id, row: k.row, col: k.col,
    key: ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'][k.row * 4 + k.col] || '?',
  })),
  // Bấm/nhả 1 phím bàn phím (nhấn giữ): key = {row, col} (0..3) hoặc
  // null (nhả phím). Đặt vào CPU (pinLevel tính mức cột khi quét) và
  // lưu lại cho solver (applyBenchNetlist sẽ đồng bộ lại khi bench.js
  // gọi syncToCpu). Trả true nếu có bàn phím đó.
  pressKeypad: (id, key) => {
    const ok = applyKeypadToCpu(cpu, mapping, id, key || null);
    if (ok) pressedKeypadForMeters = key ? { id, row: key.row, col: key.col } : null;
    return ok;
  },
  // Đồng hồ hiện sóng: toàn bộ bộ nhớ vòng (để bench.js vẽ sóng), và xóa
  // sóng 1 scope (nút "Xóa sóng" trong Inspector).
  getScopeData: () => [...scopeBuffers.entries()].map(([id, samples]) => ({ id, samples })),
  clearScope: (id) => { scopeBuffers.delete(id); },
  // Màn hình Serial: văn bản đã nhận (để bench.js vẽ màn hình 3D và
  // Inspector hiện log). Trả chuỗi ký tự của màn hình id ('' nếu không
  // có). sendSerial gửi từng ký tự người dùng gõ vào CPU qua receiveChar
  // (vào RCREG, đặt RCIF, ngắt nếu bật); chỉ gửi ký tự ASCII 0..255.
  // clearSerial xóa log 1 màn hình (nút "Xóa" trong Inspector).
  getSerialText: (id) => serialBuffers.get(id) || '',
  sendSerial: (id, text) => {
    if (typeof text !== 'string' || !text.length) return 0;
    let sent = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 0 || code > 255) continue;
      cpu.receiveChar(code);
      sent++;
    }
    return sent;
  },
  clearSerial: (id) => { serialBuffers.set(id, ''); },
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
  // XUNG NHỊP lấy từ THẠCH ANH trên bàn (benchCrystalFreq), không phải
  // từ _XTAL_FREQ của code: _XTAL_FREQ chỉ dùng để sinh vòng delay
  // (__delay_ms) — chip thật cũng vậy, tần số dao động do thạch anh
  // quyết định. Không có thạch anh thì chip không có xung: chương
  // trình vẫn nạp vào CPU (để xem code) nhưng clockHz = 0 nên runner
  // không chạy chu kỳ nào (cyclesForElapsedMs = 0) — phải thêm thạch
  // anh (nối OSC1/OSC2) rồi bấm Nạp & chạy lại. Trả thêm noCrystal để
  // bench.js hiện đúng thông báo, và xtalFreq (từ code) để bench.js
  // cảnh báo khi thạch anh lệch với _XTAL_FREQ (delay sẽ sai tỉ lệ).
  // File .hex không mang tần số nên trước đây loadHex trả clockHz về
  // 4MHz; giờ cũng lấy từ thạch anh trên bàn (không có thì 0).
  loadC(source) {
    const r = compileC(source);
    if (!r.ok) return { ok: false, errors: r.errors };
    const noCrystal = !(benchCrystalFreq && benchCrystalFreq > 0);
    cpu.clockHz = noCrystal ? 0 : benchCrystalFreq;
    const loaded = runner.loadAsm(r.asm);
    if (!loaded.ok) return { ok: false, errors: loaded.errors };
    runner.lineToAddr = r.lineToAddr;
    runner.addrToLine = new Map([...r.lineToAddr].map(([l, a]) => [a, l]));
    applyAllPots();
    return { ok: true, lineToAddr: r.lineToAddr, noCrystal, xtalFreq: r.xtalFreq };
  },
  // Chỉ dịch C, không nạp gì (để bench.js dùng cho gutter/breakpoint).
  compileCOnly(source) { return compileC(source); },
  loadHex(text) {
    const r = runner.loadHex(text);
    if (r.ok) {
      const noCrystal = !(benchCrystalFreq && benchCrystalFreq > 0);
      cpu.clockHz = noCrystal ? 0 : benchCrystalFreq;
      applyAllPots();
      return { ...r, noCrystal };
    }
    return r;
  },
  runProgram: () => runner.run(),
  pauseProgram: () => runner.pause(),
  stepProgram: () => runner.stepOnce(),
  setBreakpointLines: (lines) => runner.setBreakpointLines(lines),
  getRunStatus: () => runner.getStatus(),
};

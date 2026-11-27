// test-pic16.mjs — Kiểm thử xác định cho lõi pic16.js (KHÔNG đưa vào public/).
// Chạy: node test-pic16.mjs   (exit 0 = tất cả pass)
import { readFileSync } from 'node:fs';
import { assemble, createCPU, parseIntelHex, exportHex, disassemble, ProgramRunner, cyclesForElapsedMs, LCD, applySolvedVoltages } from './public/pic16.js';
import { defaultNetlist, resolvePeripherals, checkWiring, ledStates, buzzerStates, sevenSegStates, SEVEN_SEG_TERMS, applyButtonToCpu, applyPotToCpu, applyKeypadToCpu, KEYPAD_KEYS, PIC_PINS } from './public/wiring.js';
import { PITCH, SEGMENT_GAP_MM, rowZ, HOLE_RADIUS, HOLE_HEIGHT, HOLE_TOP_ABOVE_BOARD, holeCenterY, depthPrecisionAt, MAX_CAMERA_DISTANCE, SEGMENT_LINE_WIDTH_MM, segmentBoundaries, allHoles, stripKey, parseHole, holePos, holeId, rowLabel, rowIndexFromLabel, migrateOldHoleId, picLegs, picLegsForAnchor, picAnchor, legsFor, canPlace, buildBenchNets, benchToNetlist, defaultBenchState, sanitizeState, boardSize, picCol, picRows, picBodyDepth, picBodyDepthForRows, bodyDepth, pruneStateForSize, validateWireEnd, retargetWireEnd, togglePlacement, normalizeSize, holeCount, sizeLabel, sameSize, compLabel, nextComponentId, defaultProps, psuVolts, validatePsuVolts, parsePsuPost, psuPostPos, PSU_SCALE, PSU_POST_DX, PSU_POST_Y, PSU_POST_DZ, parseScopePost, scopePostPos, SCOPE_POST_DX, SCOPE_POST_Y, SCOPE_POST_DZ, SCOPE_DEFAULT_TX, SCOPE_DEFAULT_TZ, parseSerialPost, serialPostPos, SERIAL_POST_DX, SERIAL_POST_Y, SERIAL_POST_DZ, SERIAL_DEFAULT_TX, SERIAL_DEFAULT_TZ, normalizeWireEnd, clampCamTarget, zoomTowardPoint, panTarget, meterMode, crystalFreq, CRYSTAL_FREQS, cleanNewProps } from './public/bench-model.js';
import { LABS, getLab, buildLabState } from './public/labs.js';
import { buildSolverNets, solveLinear, solveCircuit, meterReadings, motorReadings, MOTOR_MAX_RPM, scopeVoltages, pushScopeSample, SCOPE_MAX_SAMPLES, formatVolts, formatAmps, formatCurrentDirection, LED_FORWARD_VOLTS, LED_SERIES_OHMS, PIC_OUTPUT_VOLTS, sevenSegReadings, sevenSegDigit, BUZZER_OHMS, BUZZER_ON_VOLTS, LED_MAX_VOLTS } from './public/circuit-solver.js';
import { compileC, C_VERSION } from './public/c-compiler.js';

// Fixture C thật của Điệp (khôi phục từ chat, lưu bền trong repo thay vì
// /tmp — /tmp bị xóa khi VM thay). Đọc bằng đường dẫn tương đối từ file test.
const readFixture = (name) => readFileSync(new URL(`./test/fixtures/${name}`, import.meta.url), 'utf8');

// Các chương trình Assembly dùng để kiểm thử — inline tại đây (file
// public/examples.js chứa các bài lab mẫu đã bị gỡ ngày 25/11/2026 nên test
// không import từ đó nữa). Chỉ giữ id + code, không còn hướng dẫn lab.
const DELAY_SUB = `DELAY
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
    RETURN`;

const LCD_SUBS = `LCD_CMD
    MOVWF PORTD
    BCF PORTE, 0
    BSF PORTE, 1
    BCF PORTE, 1
    CALL DSHORT
    RETURN
LCD_DATA
    MOVWF PORTD
    BSF PORTE, 0
    BSF PORTE, 1
    BCF PORTE, 1
    CALL DSHORT
    RETURN
DSHORT
    MOVLW 0x20
    MOVWF 0x22
DS1
    DECFSZ 0x22, F
    GOTO DS1
    RETURN`;

const LCD_INIT = `    BANKSEL TRISD
    CLRF TRISD
    BANKSEL TRISE
    CLRF TRISE
    BANKSEL PORTD
    CALL DSHORT
    MOVLW 0x38
    CALL LCD_CMD
    MOVLW 0x0C
    CALL LCD_CMD
    MOVLW 0x01
    CALL LCD_CMD
    MOVLW 0x06
    CALL LCD_CMD`;

const EXAMPLES = [
  { id: 'blink', code:
`; Nhap nhay LED RB0 - delay bang vong lap
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
${DELAY_SUB}
    END` },
  { id: 'chase', code:
`; LED chay tren PORTB - xoay trai qua co C
    ORG 0
    BANKSEL TRISB
    CLRF TRISB
    BANKSEL PORTB
    MOVLW 0x01
    MOVWF 0x20
LOOP
    MOVF 0x20, W
    MOVWF PORTB
    CALL DELAY
    BCF STATUS, C
    RLF 0x20, F
    BTFSS STATUS, C
    GOTO LOOP
    MOVLW 0x01
    MOVWF 0x20
    GOTO LOOP
${DELAY_SUB}
    END` },
  { id: 'button', code:
`; Nut nhan RC0 (active-low) bat LED RB0
    ORG 0
    BANKSEL TRISC
    MOVLW 0x0F
    MOVWF TRISC
    BANKSEL TRISB
    CLRF TRISB
    BANKSEL PORTC
LOOP
    BTFSC PORTC, 0
    GOTO TAT
    BSF PORTB, 0
    GOTO LOOP
TAT
    BCF PORTB, 0
    GOTO LOOP
    END` },
  { id: 'lcd', code:
`; LCD 16x2: data PORTD, RS=RE0, E=RE1
    ORG 0
${LCD_INIT}
    MOVLW 'H'
    CALL LCD_DATA
    MOVLW 'e'
    CALL LCD_DATA
    MOVLW 'l'
    CALL LCD_DATA
    MOVLW 'l'
    CALL LCD_DATA
    MOVLW 'o'
    CALL LCD_DATA
    MOVLW ' '
    CALL LCD_DATA
    MOVLW 'P'
    CALL LCD_DATA
    MOVLW 'I'
    CALL LCD_DATA
    MOVLW 'C'
    CALL LCD_DATA
    MOVLW '1'
    CALL LCD_DATA
    MOVLW '6'
    CALL LCD_DATA
    MOVLW 'F'
    CALL LCD_DATA
    MOVLW '8'
    CALL LCD_DATA
    MOVLW '7'
    CALL LCD_DATA
    MOVLW '7'
    CALL LCD_DATA
    MOVLW 'A'
    CALL LCD_DATA
    MOVLW 0xC0
    CALL LCD_CMD
    MOVLW 'H'
    CALL LCD_DATA
    MOVLW 'O'
    CALL LCD_DATA
    MOVLW 'A'
    CALL LCD_DATA
    MOVLW 'T'
    CALL LCD_DATA
    MOVLW 'R'
    CALL LCD_DATA
    MOVLW 'A'
    CALL LCD_DATA
    MOVLW 'N'
    CALL LCD_DATA
    MOVLW 'G'
    CALL LCD_DATA
    MOVLW ' '
    CALL LCD_DATA
    MOVLW 'L'
    CALL LCD_DATA
    MOVLW 'A'
    CALL LCD_DATA
    MOVLW 'B'
    CALL LCD_DATA
LOOP
    GOTO LOOP
${LCD_SUBS}
    END` },
  { id: 'adc', code:
`; Doc ADC AN0 (chiet ap 0-5V) hien thi len LCD
    ORG 0
${LCD_INIT}
    BANKSEL TRISA
    MOVLW 0x01
    MOVWF TRISA
    BANKSEL ADCON1
    MOVLW 0x8E
    MOVWF ADCON1
    BANKSEL ADCON0
    MOVLW 0x81
    MOVWF ADCON0
MAIN
    BANKSEL ADCON0
    BSF ADCON0, 1
WAIT
    BTFSC ADCON0, 1
    GOTO WAIT
    BANKSEL PORTD
    MOVLW 0x80
    CALL LCD_CMD
    MOVLW 'A'
    CALL LCD_DATA
    MOVLW 'N'
    CALL LCD_DATA
    MOVLW '0'
    CALL LCD_DATA
    MOVLW '='
    CALL LCD_DATA
    BANKSEL ADRESL
    MOVF ADRESL, W
    MOVWF 0x21
    BANKSEL ADRESH
    MOVF ADRESH, W
    MOVWF 0x20
    CALL DISP_NUM
    GOTO MAIN
DISP_NUM
    MOVLW 0x03
    MOVWF 0x22
    MOVLW 0xE8
    MOVWF 0x23
    CALL DIGIT
    MOVLW 0x00
    MOVWF 0x22
    MOVLW 0x64
    MOVWF 0x23
    CALL DIGIT
    MOVLW 0x00
    MOVWF 0x22
    MOVLW 0x0A
    MOVWF 0x23
    CALL DIGIT
    MOVLW 0x00
    MOVWF 0x22
    MOVLW 0x01
    MOVWF 0x23
    CALL DIGIT
    RETURN
DIGIT
    CLRF 0x24
DL1
    MOVF 0x22, W
    SUBWF 0x20, W
    BTFSS STATUS, Z
    GOTO DL1B
    MOVF 0x23, W
    SUBWF 0x21, W
    BTFSC STATUS, C
    GOTO DL1C
    GOTO DL1D
DL1B
    BTFSS STATUS, C
    GOTO DL1D
DL1C
    MOVF 0x23, W
    SUBWF 0x21, F
    BTFSS STATUS, C
    DECF 0x20, F
    MOVF 0x22, W
    SUBWF 0x20, F
    INCF 0x24, F
    GOTO DL1
DL1D
    MOVF 0x24, W
    ADDLW '0'
    CALL LCD_DATA
    RETURN
${LCD_SUBS}
    END` },
  { id: 'uart', code:
`; UART echo 9600 baud @4MHz: nhan ky tu roi gui lai
    ORG 0
    BANKSEL TXSTA
    MOVLW 0x24
    MOVWF TXSTA
    MOVLW 0x19
    MOVWF SPBRG
    BANKSEL RCSTA
    MOVLW 0x90
    MOVWF RCSTA
LOOP
    BANKSEL PIR1
    BTFSS PIR1, 5
    GOTO LOOP
    MOVF RCREG, W
    MOVWF TXREG
    GOTO LOOP
    END` },
  { id: 'timer0', code:
`; Timer0 tran thi dao LED RB0 (prescaler 1:256)
    ORG 0
    BANKSEL TRISB
    CLRF TRISB
    BANKSEL OPTION_REG
    MOVLW 0x07
    MOVWF OPTION_REG
    BANKSEL TMR0
    CLRF TMR0
    BANKSEL PORTB
LOOP
    BANKSEL INTCON
    BTFSS INTCON, 2
    GOTO LOOP
    BCF INTCON, 2
    BANKSEL PORTB
    MOVF PORTB, W
    XORLW 0x01
    MOVWF PORTB
    GOTO LOOP
    END` },
];

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  ${detail}`); }
}
function loadExample(id) {
  const ex = EXAMPLES.find((e) => e.id === id);
  const r = assemble(ex.code);
  check(`assemble:${id} không lỗi`, r.errors.length === 0, JSON.stringify(r.errors.slice(0, 3)));
  const cpu = createCPU();
  cpu.loadProgram(r.program);
  return { ex, cpu, asm: r };
}

// (0) Tất cả 7 chương trình kiểm thử đều dịch được
for (const ex of EXAMPLES) {
  const r = assemble(ex.code);
  check(`assemble:${ex.id} không lỗi`, r.errors.length === 0, JSON.stringify(r.errors.slice(0, 2)));
}

// Chạy tới khi đủ số CHU KỲ (không phải số lệnh: GOTO/CALL tốn 2 chu kỳ)
function runUntil(cpu, targetCycles) {
  let guard = 0;
  while (cpu.cycles < targetCycles && guard++ < targetCycles * 4) cpu.step();
}

// (a) Blink RB0: PORTB đổi trạng thái đúng theo thời gian
{
  const { cpu } = loadExample('blink');
  runUntil(cpu, 100000);
  const p1 = cpu.readPort(1) & 1;
  check('(a) blink: sau 100k chu kỳ RB0=1', p1 === 1, `PORTB=${cpu.readPort(1).toString(16)} cycles=${cpu.cycles}`);
  runUntil(cpu, 300000); // đã qua 1 lần DELAY (~196k chu kỳ) -> RB0=0
  const p2 = cpu.readPort(1) & 1;
  check('(a) blink: sau 300k chu kỳ RB0=0', p2 === 0, `PORTB=${cpu.readPort(1).toString(16)} cycles=${cpu.cycles}`);
  runUntil(cpu, 500000); // qua DELAY thứ 2 -> RB0=1 trở lại
  const p3 = cpu.readPort(1) & 1;
  check('(a) blink: sau 500k chu kỳ RB0=1 trở lại', p3 === 1, `PORTB=${cpu.readPort(1).toString(16)} cycles=${cpu.cycles}`);
}

// (b) Nút nhấn RC0 rẽ nhánh đúng (BTFSC)
{
  const { cpu } = loadExample('button');
  cpu.setPinInput(2, 0, 1); // chưa nhấn: RC0=1
  cpu.run(200);
  check('(b) button: chưa nhấn -> RB0=0', (cpu.readPort(1) & 1) === 0, `PORTB=${cpu.readPort(1).toString(16)}`);
  cpu.setPinInput(2, 0, 0); // nhấn giữ: RC0=0
  cpu.run(200);
  check('(b) button: nhấn RC0 -> RB0=1', (cpu.readPort(1) & 1) === 1, `PORTB=${cpu.readPort(1).toString(16)}`);
  cpu.setPinInput(2, 0, 1); // thả ra
  cpu.run(200);
  check('(b) button: thả ra -> RB0=0', (cpu.readPort(1) & 1) === 0, `PORTB=${cpu.readPort(1).toString(16)}`);
}

// (c) ADC: AN0=2.5V -> ADRES ~512, GO=0, ADIF=1
{
  const cpu = createCPU();
  cpu.setAnalog(0, 2.5);
  // BANKSEL ADCON1 (bank1) -> ADCON1=0x8E (ADFM=1, AN0 analog)
  cpu.writeFile(0x03, 0x20); // STATUS RP0=1 (bank1) — ghi trực tiếp cho gọn
  cpu.writeFile(0x1f, 0x8e); // ADCON1
  cpu.writeFile(0x03, 0x00); // về bank0
  cpu.writeFile(0x1f, 0x81); // ADCON0: ADON=1
  cpu.writeFile(0x1f, 0x83); // ADCON0: ADON=1, GO=1
  cpu.run(100);
  const res = (cpu.sfr.ADRESH << 8) | cpu.sfr.ADRESL;
  check('(c) ADC: ADRES ~512 với 2.5V', Math.abs(res - 512) <= 1, `ADRES=${res}`);
  check('(c) ADC: GO=0 sau chuyển đổi', ((cpu.sfr.ADCON0 >> 1) & 1) === 0, `ADCON0=${cpu.sfr.ADCON0.toString(16)}`);
  check('(c) ADC: ADIF=1', ((cpu.sfr.PIR1 >> 6) & 1) === 1, `PIR1=${cpu.sfr.PIR1.toString(16)}`);
  // Kiểm tra thêm qua ví dụ ADC đầy đủ: LCD phải hiện AN0=0512
  const t = loadExample('adc');
  t.cpu.setAnalog(0, 2.5);
  t.cpu.run(200000);
  const lines = t.cpu.lcd.getLines();
  check('(c) ADC ví dụ: LCD hiện AN0=0512', lines[0].startsWith('AN0=0512'), `LCD="${lines[0]}"`);
}

// (d) LCD: ghi clear + "HI" thì DDRAM chứa đúng ký tự
{
  const { cpu } = loadExample('lcd');
  cpu.run(500000);
  const lines = cpu.lcd.getLines();
  check('(d) LCD: dòng 1 = Hello PIC16F877A', lines[0] === 'Hello PIC16F877A', `LCD0="${lines[0]}"`);
  check('(d) LCD: dòng 2 = HOATRANG LAB', lines[1].startsWith('HOATRANG LAB'), `LCD1="${lines[1]}"`);
  // Kiểm tra trực tiếp ở mức lõi: clear + ghi "HI"
  const c2 = createCPU();
  const poke = (rs, data) => {
    c2.writeFile(0x08, data); // PORTD = data (bank0)
    c2.writeFile(0x09, rs ? 0x01 : 0x00); // PORTE: RS, E=0
    c2.writeFile(0x09, rs ? 0x03 : 0x02); // E=1 -> chốt
    c2.writeFile(0x09, rs ? 0x01 : 0x00); // E=0
  };
  poke(0, 0x01); // clear
  poke(1, 0x48); // 'H'
  poke(1, 0x49); // 'I'
  check('(d) LCD lõi: DDRAM chứa "HI"', c2.lcd.getLines()[0].startsWith('HI'), `LCD="${c2.lcd.getLines()[0]}"`);
}

// (e) UART: ghi TXREG thì terminal nhận đúng ký tự + echo qua ví dụ
{
  const cpu = createCPU();
  cpu.writeFile(0x03, 0x20); // bank1
  cpu.writeFile(0x18, 0x24); // TXSTA: TXEN=1, BRGH=1
  cpu.writeFile(0x03, 0x00); // bank0
  cpu.writeFile(0x18, 0x90); // RCSTA: SPEN=1, CREN=1
  cpu.writeFile(0x19, 0x41); // TXREG = 'A'
  check('(e) UART lõi: TXREG -> txLog có 0x41', cpu.txLog.includes(0x41), `txLog=${JSON.stringify(cpu.txLog)}`);
  const { cpu: c2 } = loadExample('uart');
  c2.run(100);
  c2.receiveChar(0x42); // 'B' vào RX
  c2.run(100);
  check('(e) UART ví dụ: echo B -> TX phát 0x42', c2.txLog.includes(0x42), `txLog=${JSON.stringify(c2.txLog)}`);
}

// (f) Timer0: tràn -> TMR0IF, ví dụ timer đảo LED
{
  const { cpu } = loadExample('timer0');
  runUntil(cpu, 1000); // prescaler 1:256 -> TMR0 tăng 1 mỗi 256 chu kỳ
  check('(f) timer0: TMR0 đang đếm lên', cpu.sfr.TMR0 > 0, `TMR0=${cpu.sfr.TMR0}`);
  runUntil(cpu, 200000); // TMR0 tràn ở 65536 chu kỳ -> LED đảo 3 lần -> RB0=1
  check('(f) timer0: LED RB0 đã đảo ít nhất 1 lần', cpu.cycles > 0 && (cpu.readPort(1) & 1) === 1, `PORTB=${cpu.readPort(1).toString(16)} cycles=${cpu.cycles}`);
}

// (g) Intel HEX: export -> parse roundtrip giữ nguyên chương trình
{
  const r = assemble(EXAMPLES[0].code);
  const hex = exportHex(r.program);
  const back = parseIntelHex(hex);
  let same = back.errors.length === 0;
  for (let i = 0; i < 8192 && same; i++) same = back.program[i] === r.program[i];
  check('(g) HEX roundtrip giống hệt', same, `errors=${JSON.stringify(back.errors)}`);
  check('(g) disassemble GOTO', disassemble(0x2800 | 5).startsWith('GOTO'), disassemble(0x2805));
}

// (h) Ngắt TMR0: GIE+TMR0IE -> nhảy vector 0x04 khi tràn
{
  const cpu = createCPU();
  const prog = new Uint16Array(8192);
  // 0x00: GOTO MAIN ; 0x04 (ISR): BCF INTCON,TMR0IF ; RETFIE
  // MAIN: BSF INTCON,GIE ; BSF INTCON,TMR0IE ; LOOP: GOTO LOOP
  const asm = assemble(`
    ORG 0
    GOTO MAIN
    ORG 4
    BCF INTCON, 2
    RETFIE
MAIN
    BSF INTCON, 7
    BSF INTCON, 5
    CLRF TMR0
LOOP
    GOTO LOOP
    END`);
  check('(h) assemble ISR không lỗi', asm.errors.length === 0, JSON.stringify(asm.errors));
  cpu.loadProgram(asm.program);
  cpu.run(70000); // TMR0 tràn (256 chu kỳ, prescaler 1:2 mặc định OPTION=0xFF? PSA=1 -> không prescaler)
  check('(h) ngắt TMR0: PC đã qua vector 0x04 (ISR chạy)', cpu.cycles > 0 && ((cpu.sfr.INTCON >> 2) & 1) === 0, `INTCON=${cpu.sfr.INTCON.toString(16)} PC=${cpu.pc.toString(16)}`);
}

// ===========================================================================
// WIRING (breadboard): netlist là nguồn sự thật, ngoại vi đọc cấu hình từ dây
// ===========================================================================
function loadWiredExample(id, netlist, codeTransform = null) {
  const ex = EXAMPLES.find((e) => e.id === id);
  const code = codeTransform ? codeTransform(ex.code) : ex.code;
  const r = assemble(code);
  check(`wiring assemble:${id} không lỗi`, r.errors.length === 0, JSON.stringify(r.errors.slice(0, 2)));
  const cpu = createCPU();
  const mapping = resolvePeripherals(netlist);
  cpu.setWiring(mapping);
  cpu.loadProgram(r.program); // loadProgram -> reset() nhưng wiring phải còn
  return { ex, cpu, mapping, asm: r };
}
// Đổi 1 dây: gỡ (a,b) cũ, thêm (a2,b2) mới
function rewire(netlist, a, b, a2, b2) {
  netlist.wires = netlist.wires.filter((w) => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
  netlist.wires.push({ id: 'W' + (900 + netlist.wires.length), a: a2, b: b2 });
}

// (w-a) LED anode đổi RB0 -> RB1: blink RB1 thì LED0 sáng theo RB1, không theo RB0
{
  const net = defaultNetlist();
  rewire(net, 'LED0.A', 'PIC.RB0', 'LED0.A', 'PIC.RB1');
  const { cpu, mapping } = loadWiredExample('blink', net, (c) => c.replaceAll('PORTB, 0', 'PORTB, 1'));
  runUntil(cpu, 100000);
  const led0on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(w-a) LED0 theo RB1: sau 100k chu kỳ LED0 sáng, RB0 vẫn 0', led0on && (cpu.readPort(1) & 1) === 0, `LED0=${led0on} PORTB=${cpu.readPort(1).toString(16)}`);
  runUntil(cpu, 300000);
  const led0off = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(w-a) LED0 theo RB1: sau 300k chu kỳ LED0 tắt', !led0off, `LED0=${led0off} PORTB=${cpu.readPort(1).toString(16)}`);
}

// (w-b) Nút nối RC2: nhấn thì code đọc RC2 = 0
{
  const net = defaultNetlist();
  rewire(net, 'BTN0.T1', 'PIC.RC0', 'BTN0.T1', 'PIC.RC2');
  const { cpu, mapping } = loadWiredExample('button', net, (c) => c.replaceAll('PORTC, 0', 'PORTC, 2'));
  cpu.run(200);
  check('(w-b) nút RC2: chưa nhấn -> RB0=0', (cpu.readPort(1) & 1) === 0, `PORTB=${cpu.readPort(1).toString(16)}`);
  applyButtonToCpu(cpu, mapping, 'BTN0', true);
  check('(w-b) nút RC2: nhấn -> RC2 đọc được 0', (cpu.readPort(2) & 0x04) === 0, `PORTC=${cpu.readPort(2).toString(16)}`);
  cpu.run(200);
  check('(w-b) nút RC2: nhấn -> RB0=1', (cpu.readPort(1) & 1) === 1, `PORTB=${cpu.readPort(1).toString(16)}`);
  applyButtonToCpu(cpu, mapping, 'BTN0', false);
  cpu.run(200);
  check('(w-b) nút RC2: thả ra -> RB0=0', (cpu.readPort(1) & 1) === 0, `PORTB=${cpu.readPort(1).toString(16)}`);
}

// (w-c) Wiper chiết áp nối AN1, 2.5V -> ADC kênh 1 ≈ 512
{
  const net = defaultNetlist();
  rewire(net, 'POT1.W', 'PIC.RA0', 'POT1.W', 'PIC.RA1');
  const mapping = resolvePeripherals(net);
  check('(w-c) chiết áp: wiper đã sang AN1', mapping.pots[0].wiper && mapping.pots[0].wiper.analog === 1, JSON.stringify(mapping.pots[0].wiper));
  const cpu = createCPU();
  cpu.setWiring(mapping);
  const applied = applyPotToCpu(cpu, mapping, 'POT1', 2.5);
  check('(w-c) chiết áp: applyPotToCpu trả true, AN1=2.5V', applied && cpu.analogVolts[1] === 2.5, `applied=${applied} AN1=${cpu.analogVolts[1]}`);
  cpu.writeFile(0x03, 0x20); // bank1
  cpu.writeFile(0x1f, 0x8d); // ADCON1: ADFM=1, AN0-AN1 analog
  cpu.writeFile(0x03, 0x00); // bank0
  cpu.writeFile(0x1f, 0x07); // ADCON0 theo quy ước của model này: ADON=bit0, GO=bit1, CHS0=bit2 -> kênh 1 + bắt đầu chuyển đổi
  cpu.run(100);
  const res = (cpu.sfr.ADRESH << 8) | cpu.sfr.ADRESL;
  check('(w-c) ADC kênh 1: ADRES ~512 với 2.5V', Math.abs(res - 512) <= 1, `ADRES=${res}`);
}

// (w-d) LCD mạch mẫu (RS=RE0, E=RE1, D0–D7=RD0–RD7) hiện đúng chữ, wiring còn sau reset
{
  const net = defaultNetlist();
  const { cpu, mapping } = loadWiredExample('lcd', net);
  check('(w-d) LCD mạch mẫu: mapping complete, RS=RE0 E=RE1', mapping.lcd.complete && mapping.lcd.rs.id === 'RE0' && mapping.lcd.e.id === 'RE1', JSON.stringify(mapping.lcd.missing));
  check('(w-d) wiring còn sau loadProgram/reset', cpu.wiring !== null && cpu.wiring.lcd.complete, 'wiring bị xoá');
  cpu.run(500000);
  const lines = cpu.lcd.getLines();
  check('(w-d) LCD mạch mẫu: dòng 1 = Hello PIC16F877A', lines[0] === 'Hello PIC16F877A', `LCD0="${lines[0]}"`);
  check('(w-d) LCD mạch mẫu: dòng 2 = HOATRANG LAB', lines[1].startsWith('HOATRANG LAB'), `LCD1="${lines[1]}"`);
}

// (w-e) Đổi dây LCD sang PORTC: code ghi qua PORTC thì LCD vẫn hiện đúng
{
  const net = defaultNetlist();
  for (let i = 0; i < 8; i++) rewire(net, `LCD1.D${i}`, `PIC.RD${i}`, `LCD1.D${i}`, `PIC.RC${i}`);
  const mapping = resolvePeripherals(net);
  check('(w-e) LCD sang PORTC: mapping complete, D0=RC0 D7=RC7', mapping.lcd.complete && mapping.lcd.d[0].id === 'RC0' && mapping.lcd.d[7].id === 'RC7', JSON.stringify(mapping.lcd.d.map((p) => p && p.id)));
  const { cpu } = loadWiredExample('lcd', net, (c) => c.replaceAll('PORTD', 'PORTC').replaceAll('TRISD', 'TRISC'));
  cpu.run(500000);
  const lines = cpu.lcd.getLines();
  check('(w-e) LCD PORTC: dòng 1 = Hello PIC16F877A', lines[0] === 'Hello PIC16F877A', `LCD0="${lines[0]}"`);
  check('(w-e) LCD PORTC: dòng 2 = HOATRANG LAB', lines[1].startsWith('HOATRANG LAB'), `LCD1="${lines[1]}"`);
}

// (w-f) Phát hiện nối tắt VCC–GND
{
  const net = defaultNetlist();
  net.wires.push({ id: 'W900', a: 'VCC', b: 'GND' });
  const warns = checkWiring(net);
  check('(w-f) nối tắt VCC–GND bị phát hiện', warns.some((w) => w.kind === 'short' && w.message.toLowerCase().includes('nối tắt')), JSON.stringify(warns.map((w) => w.message)));
  const clean = checkWiring(defaultNetlist());
  check('(w-f) mạch mẫu không có cảnh báo nào', clean.length === 0, JSON.stringify(clean.map((w) => w.message)));
}

// (w-g) Mạch mẫu mặc định cho kết quả giống hệt test cũ
{
  const net = defaultNetlist();
  const mapping = resolvePeripherals(net);
  check('(w-g) mạch mẫu: LED0->RB0, BTN0->RC0, POT->AN0, LCD đủ dây',
    mapping.leds[0].pin.id === 'RB0' && mapping.buttons[0].pin.id === 'RC0' &&
    mapping.pots[0].wiper.analog === 0 && mapping.lcd.complete,
    JSON.stringify({ led: mapping.leds[0].pin, btn: mapping.buttons[0].pin, pot: mapping.pots[0].wiper, lcd: mapping.lcd.complete }));
  const { cpu } = loadWiredExample('blink', net);
  runUntil(cpu, 100000);
  check('(w-g) blink mạch mẫu: sau 100k chu kỳ RB0=1', (cpu.readPort(1) & 1) === 1, `PORTB=${cpu.readPort(1).toString(16)}`);
  runUntil(cpu, 300000);
  check('(w-g) blink mạch mẫu: sau 300k chu kỳ RB0=0', (cpu.readPort(1) & 1) === 0, `PORTB=${cpu.readPort(1).toString(16)}`);
  const adc = loadWiredExample('adc', net);
  applyPotToCpu(adc.cpu, adc.mapping, 'POT1', 2.5);
  adc.cpu.run(200000);
  check('(w-g) adc mạch mẫu: LCD hiện AN0=0512', adc.cpu.lcd.getLines()[0].startsWith('AN0=0512'), `LCD="${adc.cpu.lcd.getLines()[0]}"`);
}

// (w-h) LCD chưa nối đủ dây: không crash, LCD không chốt chữ sai
{
  const net = defaultNetlist();
  net.wires = net.wires.filter((w) => !(w.a === 'LCD1.D7' && w.b === 'PIC.RD7'));
  const mapping = resolvePeripherals(net);
  check('(w-h) LCD thiếu D7: complete=false, missing=[D7]', !mapping.lcd.complete && mapping.lcd.missing.join(',') === 'D7', JSON.stringify(mapping.lcd.missing));
  const warns = checkWiring(net);
  check('(w-h) LCD thiếu dây được cảnh báo', warns.some((w) => w.message.includes('thiếu: D7')), JSON.stringify(warns.map((w) => w.message)));
  const { cpu } = loadWiredExample('lcd', net);
  let crashed = false;
  try { cpu.run(500000); } catch { crashed = true; }
  check('(w-h) LCD thiếu dây: chạy không crash, không hiện chữ', !crashed && cpu.lcd.getLines()[0].trim() === '', `LCD0="${cpu.lcd.getLines()[0]}"`);
}

// ===========================================================================
// BENCH 3D: mô hình lỗ/strip breadboard + dịch sang netlist cho CPU
// (PIC chân 1 ở b22, chân 20 ở b41, chân 21 ở h41, chân 40 ở h22;
//  RB0 là chân 33 -> lỗ h29; RC2 là chân 17 -> lỗ b38)
// ===========================================================================
// (b-a) Lưới lỗ/strip
{
  check('(b-a) board 830 lỗ', allHoles().length === 830, `holes=${allHoles().length}`);
  check('(b-a) a12 và e12 cùng strip, f12 khác strip',
    stripKey('a12') === stripKey('e12') && stripKey('a12') !== stripKey('f12'),
    `${stripKey('a12')} vs ${stripKey('f12')}`);
  check('(b-a) rail + là VCC, rail - là GND',
    stripKey('T+5') === 'RAIL+' && stripKey('B+5') === 'RAIL+' && stripKey('T-5') === 'RAIL-' && stripKey('B-5') === 'RAIL-',
    `${stripKey('T+5')}/${stripKey('T-5')}`);
  const p = parseHole('c12');
  check('(b-a) parseHole c12 = hàng c, cột 12', p && p.r === 2 && p.c === 12, JSON.stringify(p));
  check('(b-a) parseHole T+40 = rail trên +, cột 40', (() => { const q = parseHole('T+40'); return q && q.r === -2 && q.c === 40; })(), JSON.stringify(parseHole('T+40')));
  check('(b-a) parseHole sai định dạng trả null', parseHole('x99') === null && parseHole('a64') === null && parseHole('T+51') === null, '');
  const pos = holePos('b22');
  check('(b-a) holePos b22 = (-25.40, -10.16)mm (hàng b cách tâm 10.16mm vì có khe hở đoạn)', pos && Math.abs(pos.x + 25.4) < 0.01 && Math.abs(pos.z + 10.16) < 0.01, JSON.stringify(pos));
}

// (b-b) Chân chip khớp datasheet / wiring.js
{
  const legs = picLegs();
  check('(b-b) chip có 40 chân', legs.length === 40, `legs=${legs.length}`);
  const byPin = Object.fromEntries(legs.map((l) => [l.pin, l.hole]));
  check('(b-b) chân 1 MCLR=b22, chân 20 RD1=b41', byPin[1] === 'b22' && byPin[20] === 'b41', `${byPin[1]}/${byPin[20]}`);
  check('(b-b) chân 21 RD2=h41, chân 40 RB7=h22', byPin[21] === 'h41' && byPin[40] === 'h22', `${byPin[21]}/${byPin[40]}`);
  check('(b-b) chân 33 RB0=h29, chân 17 RC2=b38', byPin[33] === 'h29' && byPin[17] === 'b38', `${byPin[33]}/${byPin[17]}`);
  const ids = legs.map((l) => l.term.slice(4));
  const ref = PIC_PINS.map((p) => p.id);
  check('(b-b) thứ tự chân khớp PIC_PINS trong wiring.js', JSON.stringify(ids) === JSON.stringify(ref), JSON.stringify(ids.slice(0, 5)));
}

// (b-c) LED trên bàn: anode vào strip RB0 (h29), cathode về rail GND
{
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'h29', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'h30', b: 'T-5', color: '#0F172A' });
  const mapping = resolvePeripherals(benchToNetlist(st));
  check('(b-c) LED bàn: anode -> RB0, cathode -> GND, không kèm điện trở',
    mapping.leds[0].pin.id === 'RB0' && mapping.leds[0].gnd === true && mapping.leds[0].hasResistor === false,
    JSON.stringify(mapping.leds[0]));
  const warns = checkWiring(benchToNetlist(st));
  check('(b-c) LED bàn không điện trở được cảnh báo', warns.some((w) => w.message.includes('không có điện trở')), JSON.stringify(warns.map((w) => w.message)));
}

// (b-d) LED trên bàn chạy thật theo code (blink RB0 -> LED0 sáng)
{
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'h29', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'h30', b: 'T-5', color: '#0F172A' });
  const { cpu, mapping } = loadWiredExample('blink', benchToNetlist(st));
  runUntil(cpu, 100000);
  const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(b-d) LED bàn RB0: sau 100k chu kỳ LED0 sáng', on, `LED0=${on} PORTB=${cpu.readPort(1).toString(16)}`);
  runUntil(cpu, 300000);
  const off = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(b-d) LED bàn RB0: sau 300k chu kỳ LED0 tắt', !off, `LED0=${off}`);
}

// (b-e) Dây nối 2 strip: LED ở c10, dây c10 -> b38 (strip RC2) thì LED theo RC2
{
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'c10', b: 'b38', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const mapping = resolvePeripherals(benchToNetlist(st));
  check('(b-e) dây c10-b38: LED anode -> RC2', mapping.leds[0].pin.id === 'RC2', JSON.stringify(mapping.leds[0].pin));
}

// (b-f) Điện trở nối tiếp LED thì hết cảnh báo thiếu điện trở
{
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st.components.push({ id: 'R0', type: 'resistor', anchor: 'c10', rot: 0, props: { value: 220 } });
  st.wires.push({ id: 'W10', a: 'c14', b: 'b38', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const nl = benchToNetlist(st);
  const mapping = resolvePeripherals(nl);
  check('(b-f) điện trở nối tiếp: LED hasResistor=true, anode -> RC2',
    mapping.leds[0].hasResistor === true && mapping.leds[0].pin.id === 'RC2',
    JSON.stringify(mapping.leds[0]));
  const warns = checkWiring(nl);
  check('(b-f) điện trở nối tiếp: hết cảnh báo thiếu điện trở', !warns.some((w) => w.message.includes('không có điện trở')), JSON.stringify(warns.map((w) => w.message)));
}

// (b-g) Nối tắt rail + với rail - bị phát hiện
{
  const st = defaultBenchState();
  st.wires.push({ id: 'W10', a: 'T+5', b: 'T-5', color: '#DC2626' });
  const warns = checkWiring(benchToNetlist(st));
  check('(b-g) dây nối rail + với rail - -> cảnh báo nối tắt', warns.some((w) => w.kind === 'short' && w.message.includes('Nối tắt')), JSON.stringify(warns.map((w) => w.message)));
  const clean = checkWiring(benchToNetlist(defaultBenchState()));
  check('(b-g) bàn mặc định không có cảnh báo nào', clean.length === 0, JSON.stringify(clean.map((w) => w.message)));
}

// (b-h) canPlace: lỗ đã có chân, dưới thân chip, ngoài board
{
  const st = defaultBenchState();
  check('(b-h) LED vào lỗ chân PIC (b22) không đặt được', canPlace(st, 'led', 'b22', 0).ok === false, JSON.stringify(canPlace(st, 'led', 'b22', 0)));
  check('(b-h) LED dưới thân chip (d30) không đặt được', canPlace(st, 'led', 'd30', 0).ok === false, '');
  check('(b-h) LED vào a10 đặt được', canPlace(st, 'led', 'a10', 0).ok === true, '');
  check('(b-h) LED ở j62 xoay 90° rơi ra ngoài board', canPlace(st, 'led', 'j62', 1).ok === false, JSON.stringify(canPlace(st, 'led', 'j62', 1)));
  check('(b-h) LED ở a10 xoay 90° đặt được (chân sang b10)', canPlace(st, 'led', 'a10', 1).ok === true, '');
}

// (b-i) sanitizeState: dữ liệu rác -> về bàn mặc định
{
  const s = sanitizeState({ components: [{ id: 'X', type: 'led', anchor: 'zzz' }], wires: 'rong' });
  check('(b-i) sanitize rác: có chip PIC + nguồn 5V', s.components.some((c) => c.type === 'pic') && s.components.some((c) => c.type === 'psu'), JSON.stringify(s.components.map((c) => c.type)));
  check('(b-i) sanitize rác: linh kiện lỗi bị loại', s.components.length === 2, `n=${s.components.length}`);
}

// ===========================================================================
// SIZE BO MẠCH (170/400/830) + CHUYỂN ĐẦU DÂY + ĐẶT DÍNH
// ===========================================================================
// (c-a) Số lỗ theo từng size
{
  check('(c-a) board 170 lỗ', allHoles(170).length === 170, `holes=${allHoles(170).length}`);
  check('(c-a) board 400 lỗ', allHoles(400).length === 400, `holes=${allHoles(400).length}`);
  check('(c-a) board 830 lỗ', allHoles(830).length === 830, `holes=${allHoles(830).length}`);
  check('(c-a) mặc định là 830', allHoles().length === 830 && boardSize().id === 830 && boardSize(999).id === 830, '');
}

// (c-b) Strip/rail nối đúng theo size
{
  check('(c-b) a12/e12 cùng strip trên 400, f12 khác strip',
    stripKey('a12', 400) === stripKey('e12', 400) && stripKey('a12', 400) !== stripKey('f12', 400), '');
  check('(c-b) rail 400: T+25 hợp lệ, T+26 ngoài board',
    (() => { const q = parseHole('T+25', 400); return q && q.r === -2 && q.c === 25; })() && parseHole('T+26', 400) === null, '');
  check('(c-b) board 170 không có rail, a17 hợp lệ, a18 ngoài board',
    parseHole('T+1', 170) === null && parseHole('B-1', 170) === null
    && (() => { const q = parseHole('a17', 170); return q && q.c === 17; })() && parseHole('a18', 170) === null, '');
  const p = holePos('a1', 170);
  check('(c-b) holePos a1 trên 170 = x -20.32mm, z -12.70mm (gốc giữa board, có khe hở đoạn)',
    p && Math.abs(p.x + 20.32) < 0.01 && Math.abs(p.z + 12.7) < 0.01, JSON.stringify(p));
  check('(c-b) rail 830 vẫn 50 lỗ', parseHole('T+50', 830) !== null && parseHole('T+51', 830) === null, '');
}

// (c-c) Chip PIC vừa trên cả 3 size (căn giữa board)
// Lưu ý vật lý: DIP-40 rộng 20 cột nên trên board Mini 17 cột thì 6 chân
// ngoài cùng (MCLR, RD0, RD1, RD2, RD3, RB7) treo ngoài board — chip vẫn
// căn giữa, 34 chân còn lại cắm đúng lỗ.
{
  for (const size of [830, 400]) {
    const legs = picLegs(size);
    check(`(c-c) chip ${size}: đủ 40 chân trong board`,
      legs.length === 40 && legs.every((l) => !!l.hole), `valid=${legs.filter((l) => l.hole).length}`);
  }
  const legs170 = picLegs(170);
  const dangling = legs170.filter((l) => !l.hole).map((l) => l.pin);
  check('(c-c) chip 170: căn giữa (picCol=0), 34 chân trong board, 6 chân treo ngoài là 1/19/20/21/22/40',
    picCol(170) === 0 && legs170.length === 40 && legs170.filter((l) => l.hole).length === 34
    && JSON.stringify(dangling) === JSON.stringify([1, 19, 20, 21, 22, 40]), JSON.stringify(dangling));
  check('(c-c) chip 400 căn giữa (picCol=6), chip 830 như cũ (picCol=22)',
    picCol(400) === 6 && picCol(830) === 22, `${picCol(400)}/${picCol(830)}`);
}

// (c-d) Đổi size: linh kiện/dây ngoài board bị loại, trong board được giữ
{
  const st = defaultBenchState(830);
  st.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  st.components.push({ id: 'LED1', type: 'led', anchor: 'a60', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'a10', b: 'a11', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c10', b: 'b38', color: '#2563EB' });
  const r400 = pruneStateForSize(st, 400);
  check('(c-d) 830->400: LED a10 giữ, LED a60 gỡ',
    r400.state.components.some((c) => c.id === 'LED0') && !r400.state.components.some((c) => c.id === 'LED1')
    && r400.removed.components.join(',') === 'LED1', JSON.stringify(r400.removed.components));
  check('(c-d) 830->400: dây a10-a11 giữ, dây c10-b38 gỡ (b38 ngoài board)',
    r400.state.wires.some((w) => w.id === 'W10') && !r400.state.wires.some((w) => w.id === 'W11')
    && r400.removed.wires.join(',') === 'W11', JSON.stringify(r400.removed.wires));
  check('(c-d) 830->400: dây nguồn W1-W7 được nối lại theo chân PIC/rail mới',
    (() => {
      const w1 = r400.state.wires.find((w) => w.id === 'W1');
      const w6 = r400.state.wires.find((w) => w.id === 'W6');
      return w1 && w1.a === 'b6' && w1.b === 'T+22' && w6 && w6.b === 'T+25';
    })(), JSON.stringify(r400.state.wires.filter((w) => ['W1', 'W6'].includes(w.id))));
  const r170 = pruneStateForSize(st, 170);
  check('(c-d) 830->170: hết dây nguồn mặc định (board mini không có rail) + dây W11 ngoài board',
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].every((id) => r170.removed.wires.includes(id))
    && r170.removed.wires.includes('W11') && r170.removed.wires.length === 8, JSON.stringify(r170.removed.wires));
  check('(c-d) 830->170: chip PIC + nguồn 5V vẫn còn, LED a10 giữ',
    r170.state.components.some((c) => c.type === 'pic') && r170.state.components.some((c) => c.type === 'psu')
    && r170.state.components.some((c) => c.id === 'LED0'), '');
  const rSame = pruneStateForSize(st, 830);
  check('(c-d) đổi size về chính nó: không gỡ gì',
    rSame.removed.components.length === 0 && rSame.removed.wires.length === 0, JSON.stringify(rSame.removed));
}

// (c-e) Địa chỉ lỗ hợp lệ/không hợp lệ (popup dây dùng parseHole)
{
  check('(c-e) "c12" hợp lệ', (() => { const p = parseHole('c12'); return p && p.r === 2 && p.c === 12; })(), '');
  check('(c-e) "z99" không hợp lệ', parseHole('z99') === null, '');
  check('(c-e) "C12" (hoa) không hợp lệ ở model — UI phải thường hoá trước',
    parseHole('C12') === null, '');
  check('(c-e) "T+5" (rail) hợp lệ, "a0" và "" không hợp lệ',
    parseHole('T+5') !== null && parseHole('a0') === null && parseHole('') === null, '');
  check('(c-e) "c12 " (thừa khoảng trắng) không hợp lệ — UI phải trim trước',
    parseHole('c12 ') === null, '');
}

// (c-f) Đổi đầu dây sang lỗ mới thì netlist đổi theo
{
  const st = defaultBenchState(830);
  st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'c10', b: 'b38', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  let mapping = resolvePeripherals(benchToNetlist(st));
  check('(c-f) trước khi đổi: LED anode -> RC2', mapping.leds[0].pin.id === 'RC2', JSON.stringify(mapping.leds[0].pin));
  const ok = retargetWireEnd(st, 'W10', 'b', 'h29');
  mapping = resolvePeripherals(benchToNetlist(st));
  check('(c-f) đổi đầu dây sang h29: LED anode -> RB0',
    ok.ok === true && mapping.leds[0].pin.id === 'RB0', JSON.stringify(mapping.leds[0].pin));
  const before = JSON.stringify(st.wires);
  check('(c-f) đổi sang lỗ trùng đầu kia thì lỗi, state không đổi',
    retargetWireEnd(st, 'W10', 'b', 'c10').ok === false && JSON.stringify(st.wires) === before, '');
  check('(c-f) đổi sang lỗ sai ("z99") thì lỗi, state không đổi',
    retargetWireEnd(st, 'W10', 'b', 'z99').ok === false && JSON.stringify(st.wires) === before, '');
  st.wires.push({ id: 'W12', a: 'c10', b: 'h30', color: '#2563EB' });
  check('(c-f) đổi sang cặp lỗ đã có dây thì lỗi',
    retargetWireEnd(st, 'W10', 'b', 'h30').ok === false, '');
  check('(c-f) validateWireEnd không đổi state',
    validateWireEnd(st, 'W10', 'b', 'b38').ok === true && st.wires.find((w) => w.id === 'W10').b === 'h29', '');
}

// (c-g) Đặt dính: bấm thẻ đang chọn thì thoát, bấm thẻ khác thì chuyển
{
  check('(c-g) chưa chọn -> bấm LED thì chọn LED', togglePlacement(null, 'led') === 'led', '');
  check('(c-g) đang chọn LED -> bấm lại LED thì thoát', togglePlacement('led', 'led') === null, '');
  check('(c-g) đang chọn LED -> bấm điện trở thì chuyển sang điện trở',
    togglePlacement('led', 'resistor') === 'resistor', '');
}

// ===========================================================================
// SIZE TỰ ĐIỀN {cols, rails} — popup Bo mạch (bấm vào board)
// ===========================================================================
// (d-a) normalizeSize: chuẩn hoá giá trị lưu trong state
{
  check('(d-a) {cols:42, rails:true} giữ nguyên (rows mặc định 10)',
    JSON.stringify(normalizeSize({ cols: 42, rails: true })) === JSON.stringify({ cols: 42, rows: 10, rails: true }), JSON.stringify(normalizeSize({ cols: 42, rails: true })));
  check('(d-a) cols 3 kẹp lên 5, cols 100 giữ nguyên, cols 150 kẹp xuống 100',
    normalizeSize({ cols: 3, rails: false }).cols === 5 && normalizeSize({ cols: 100, rails: true }).cols === 100
    && normalizeSize({ cols: 150, rails: true }).cols === 100, '');
  check('(d-a) cols không phải số / size lạ -> 830',
    normalizeSize({ cols: 'abc' }) === 830 && normalizeSize(999) === 830 && normalizeSize() === 830, '');
  check('(d-a) mẫu sẵn 400 giữ nguyên số', normalizeSize(400) === 400, '');
}

// (d-b) boardSize + holeCount với size tự điền
{
  const s = boardSize({ cols: 42, rails: true });
  check('(d-b) custom 42 cột có rail: id custom, cols 42, railCols 42',
    s.id === 'custom' && s.cols === 42 && s.railCols === 42, JSON.stringify(s));
  check('(d-b) custom 42 cột không rail: railCols 0',
    boardSize({ cols: 42, rails: false }).railCols === 0, '');
  check('(d-b) holeCount: 42 cột có rail = 588, không rail = 420, 5 cột không rail = 50',
    holeCount({ cols: 42, rails: true }) === 588 && holeCount({ cols: 42, rails: false }) === 420
    && holeCount({ cols: 5, rails: false }) === 50, '');
  check('(d-b) allHoles custom 42 cột có rail = 588 lỗ',
    allHoles({ cols: 42, rails: true }).length === 588, `holes=${allHoles({ cols: 42, rails: true }).length}`);
}

// (d-c) parseHole theo giới hạn của size tự điền
{
  check('(d-c) custom 42: a42 hợp lệ, a43 ngoài board',
    parseHole('a42', { cols: 42, rails: true }) !== null && parseHole('a43', { cols: 42, rails: true }) === null, '');
  check('(d-c) custom 42 có rail: T+42 hợp lệ, T+43 ngoài board',
    parseHole('T+42', { cols: 42, rails: true }) !== null && parseHole('T+43', { cols: 42, rails: true }) === null, '');
  check('(d-c) custom 42 không rail: T+1 không hợp lệ',
    parseHole('T+1', { cols: 42, rails: false }) === null, '');
  check('(d-c) stripKey rail trên custom: T+5 -> RAIL+',
    stripKey('T+5', { cols: 42, rails: true }) === 'RAIL+', '');
}

// (d-d) picCol theo công thức + chip vừa/không vừa trên size tự điền
{
  check('(d-d) picCol: custom 42 -> 12, custom 63 có rail -> 22 (như 830), custom 30 -> 6, custom 10 -> 0',
    picCol({ cols: 42, rails: true }) === 12 && picCol({ cols: 63, rails: true }) === 22
    && picCol({ cols: 30, rails: false }) === 6 && picCol({ cols: 10, rails: false }) === 0, '');
  check('(d-d) chip 42 cột: đủ 40 chân trong board',
    (() => { const legs = picLegs({ cols: 42, rails: true }); return legs.length === 40 && legs.every((l) => !!l.hole); })(), '');
  check('(d-d) chip 10 cột: 20 chân trong board, 20 chân treo ngoài',
    (() => { const legs = picLegs({ cols: 10, rails: false }); return legs.filter((l) => l.hole).length === 20 && legs.filter((l) => !l.hole).length === 20; })(), '');
}

// (d-e) Đổi size sang tự điền: giữ/loại linh kiện + dây nguồn nối lại
{
  const st = defaultBenchState(830);
  st.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  st.components.push({ id: 'LED1', type: 'led', anchor: 'a60', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'a10', b: 'a11', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c10', b: 'b38', color: '#2563EB' });
  const r30 = pruneStateForSize(st, { cols: 30, rails: true });
  check('(d-e) 830->{30 cột, có rail}: LED a10 giữ, LED a60 gỡ',
    r30.state.components.some((c) => c.id === 'LED0') && !r30.state.components.some((c) => c.id === 'LED1')
    && r30.removed.components.join(',') === 'LED1', JSON.stringify(r30.removed.components));
  check('(d-e) 830->{30 cột, có rail}: dây W1 nối lại b6->T+22, W6 về T+30',
    (() => {
      const w1 = r30.state.wires.find((w) => w.id === 'W1');
      const w6 = r30.state.wires.find((w) => w.id === 'W6');
      return w1 && w1.a === 'b6' && w1.b === 'T+22' && w6 && w6.b === 'T+30';
    })(), JSON.stringify(r30.state.wires.filter((w) => ['W1', 'W6'].includes(w.id))));
  const r30nr = pruneStateForSize(st, { cols: 30, rails: false });
  check('(d-e) 830->{30 cột, không rail}: hết dây nguồn W1-W7',
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].every((id) => r30nr.removed.wires.includes(id)), JSON.stringify(r30nr.removed.wires));
  const st42 = defaultBenchState({ cols: 42, rails: true });
  const rSame = pruneStateForSize(st42, { cols: 42, rails: true });
  check('(d-e) đổi size tự điền về chính nó: không gỡ gì, size giữ nguyên {cols:42, rows:10, rails:true}',
    rSame.removed.components.length === 0 && rSame.removed.wires.length === 0
    && JSON.stringify(rSame.state.size) === JSON.stringify({ cols: 42, rows: 10, rails: true }), JSON.stringify(rSame.state.size));
}

// (d-f) sanitizeState giữ nguyên size tự điền
{
  const s = sanitizeState({
    size: { cols: 42, rails: true },
    components: [
      { id: 'PIC1', type: 'pic', anchor: 'b13', rot: 0, fixed: true, props: {} },
      { id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } },
    ],
    wires: [],
  });
  check('(d-f) sanitize giữ size tự điền {cols:42, rows:10, rails:true} + LED a10',
    JSON.stringify(s.size) === JSON.stringify({ cols: 42, rows: 10, rails: true })
    && s.components.some((c) => c.id === 'LED0'), JSON.stringify(s.size));
  check('(d-f) sanitize kẹp cols lạ: {cols:3} -> 5, size 999 -> 830',
    sanitizeState({ size: { cols: 3 }, components: [], wires: [] }).size.cols === 5
    && sanitizeState({ size: 999, components: [], wires: [] }).size === 830, '');
}

// (d-g) sameSize: so sánh size (mẫu sẵn vs tự điền)
{
  check('(d-g) sameSize: 830==830, 830!=400',
    sameSize(830, 830) && !sameSize(830, 400), '');
  check('(d-g) custom 63 cột có rail != 830 (railCols 63 vs 50)',
    !sameSize({ cols: 63, rails: true }, 830), '');
  check('(d-g) custom giống nhau thì bằng, khác rails/cols thì khác',
    sameSize({ cols: 42, rails: true }, { cols: 42, rails: true })
    && !sameSize({ cols: 42, rails: true }, { cols: 42, rails: false })
    && !sameSize({ cols: 42, rails: true }, { cols: 43, rails: true }), '');
}

// (d-h) Công thức cột từ x (pickHole trong bench.js): c = round(x/PITCH + (cols+1)/2)
{
  for (const size of [170, 400, 830, { cols: 42, rails: true }, { cols: 5, rails: false }]) {
    const cols = boardSize(size).cols;
    const ids = ['a1', `e${Math.min(20, cols)}`, `j${cols}`];
    const ok = ids.every((id) => {
      const p = holePos(id, size);
      if (!p) return false;
      return Math.round(p.x / PITCH + (cols + 1) / 2) === parseHole(id, size).c;
    });
    check(`(d-h) nghịch đảo holePos trên ${JSON.stringify(size)}: cột tính lại đúng`, ok, '');
  }
}

// (d-i) sizeLabel hiển thị
{
  check('(d-i) sizeLabel mẫu sẵn: Mini/Nửa/Đầy đủ',
    sizeLabel(170) === 'Mini 170 lỗ' && sizeLabel(400) === 'Nửa 400 lỗ' && sizeLabel(830) === 'Đầy đủ 830 lỗ', '');
  check('(d-i) sizeLabel tự điền: 42 cột có rail -> "Tùy chỉnh · 588 lỗ", 5 cột không rail -> "Tùy chỉnh · 50 lỗ"',
    sizeLabel({ cols: 42, rails: true }) === 'Tùy chỉnh · 588 lỗ'
    && sizeLabel({ cols: 5, rails: false }) === 'Tùy chỉnh · 50 lỗ', '');
}

// (d-j) validateWireEnd theo giới hạn size tự điền
{
  const st = defaultBenchState({ cols: 42, rails: true });
  st.wires.push({ id: 'W10', a: 'a10', b: 'a11', color: '#2563EB' });
  check('(d-j) custom 42: đổi đầu dây sang a43 thì lỗi, sang a42 thì được',
    validateWireEnd(st, 'W10', 'b', 'a43').ok === false && validateWireEnd(st, 'W10', 'b', 'a42').ok === true, '');
  const r = retargetWireEnd(st, 'W10', 'b', 'a42');
  check('(d-j) retarget sang a42 áp dụng đúng vào state',
    r.ok === true && st.wires.find((w) => w.id === 'W10').b === 'a42', JSON.stringify(st.wires.find((w) => w.id === 'W10')));
}

// ===========================================================================
// TỰ ĐIỀN RỘNG (SỐ CỘT 5–100) × DÀI (SỐ HÀNG 5–100, BỘI SỐ CỦA 5) — popup Bo mạch
// ===========================================================================
// (e-a) normalizeSize: chuẩn hoá rows về bội số của 5 (làm tròn xuống, kẹp 5–100)
{
  check('(e-a) {cols:42, rows:12, rails:true} làm tròn xuống 10',
    JSON.stringify(normalizeSize({ cols: 42, rows: 12, rails: true })) === JSON.stringify({ cols: 42, rows: 10, rails: true }), JSON.stringify(normalizeSize({ cols: 42, rows: 12, rails: true })));
  check('(e-a) rows 1 -> 5, rows 27 -> 25, rows 99 -> 95, rows 150 -> 100; rows 30 giữ nguyên',
    normalizeSize({ cols: 42, rows: 1 }).rows === 5 && normalizeSize({ cols: 42, rows: 27 }).rows === 25
    && normalizeSize({ cols: 42, rows: 99 }).rows === 95 && normalizeSize({ cols: 42, rows: 150 }).rows === 100
    && normalizeSize({ cols: 42, rows: 30 }).rows === 30, '');
  check('(e-a) {cols:42} không có rows -> rows 10; rows chữ -> 10',
    normalizeSize({ cols: 42 }).rows === 10 && normalizeSize({ cols: 42, rows: 'abc' }).rows === 10, '');
  check('(e-a) mẫu sẵn 830 giữ nguyên số (rows 10 qua boardSize)',
    normalizeSize(830) === 830 && boardSize(830).rows === 10, '');
  check('(e-a) size cũ {cols, rails} không rows -> rows 10',
    normalizeSize({ cols: 42, rails: false }).rows === 10, '');
}

// (e-b) holeCount = cols x rows + 4 rail
{
  check('(e-b) 42 cột x 10 hàng có rail = 588 lỗ',
    holeCount({ cols: 42, rows: 10, rails: true }) === 588, `holes=${holeCount({ cols: 42, rows: 10, rails: true })}`);
  check('(e-b) 20 cột x 5 hàng không rail = 100 lỗ; 99 x 25 có rail = 2871 lỗ; 100 x 25 có rail = 2900 lỗ',
    holeCount({ cols: 20, rows: 5, rails: false }) === 100
    && holeCount({ cols: 99, rows: 25, rails: true }) === 2871
    && holeCount({ cols: 100, rows: 25, rails: true }) === 2900, '');
  check('(e-b) allHoles 42x10 có rail = 588; 20x5 không rail = 100',
    allHoles({ cols: 42, rows: 10, rails: true }).length === 588
    && allHoles({ cols: 20, rows: 5, rails: false }).length === 100, '');
  check('(e-b) allHoles 99x25 có rail = 2871, không lỗ trùng id; 100x25 = 2900',
    (() => {
      const ids = allHoles({ cols: 99, rows: 25, rails: true }).map((h) => h.id);
      return ids.length === 2871 && new Set(ids).size === 2871;
    })()
    && (() => {
      const ids = allHoles({ cols: 100, rows: 25, rails: true }).map((h) => h.id);
      return ids.length === 2900 && new Set(ids).size === 2900;
    })(), '');
  check('(e-b) sizeLabel 42x10 có rail -> "Tùy chỉnh · 588 lỗ"',
    sizeLabel({ cols: 42, rows: 10, rails: true }) === 'Tùy chỉnh · 588 lỗ', '');
}

// (e-c) Strip nối theo đoạn 5 hàng; rail B+/B− theo rows
{
  const s15 = { cols: 42, rows: 15, rails: true };
  check('(e-c) 15 hàng: a5/e5 cùng strip (đoạn 1-5), a5/f5 khác strip, f5/j5 cùng strip (đoạn 6-10), k5 khác cả hai (đoạn 11-15)',
    stripKey('a5', s15) === stripKey('e5', s15) && stripKey('a5', s15) !== stripKey('f5', s15)
    && stripKey('f5', s15) === stripKey('j5', s15) && stripKey('k5', s15) !== stripKey('f5', s15), '');
  check('(e-c) 10 hàng: a5/e5 cùng strip, f5/j5 cùng strip, a5/f5 khác strip (như cũ)',
    stripKey('a5', 830) === stripKey('e5', 830) && stripKey('f5', 830) === stripKey('j5', 830) && stripKey('a5', 830) !== stripKey('f5', 830), '');
  check('(e-c) 5 hàng: a1/b1/c1/e1 cùng 1 strip (chỉ 1 đoạn 5)',
    stripKey('a1', { cols: 20, rows: 5, rails: false }) === stripKey('b1', { cols: 20, rows: 5, rails: false })
    && stripKey('a1', { cols: 20, rows: 5, rails: false }) === stripKey('e1', { cols: 20, rows: 5, rails: false }), '');
  check('(e-c) 15 hàng: B+ là hàng 15, B− là hàng 16',
    (() => { const q = parseHole('B+42', s15); return q && q.r === 15 && q.c === 42; })()
    && (() => { const q = parseHole('B-42', s15); return q && q.r === 16 && q.c === 42; })(), '');
  check('(e-c) rows 2 không còn hợp lệ: boardSize({cols:20, rows:2}) làm tròn lên 5 hàng',
    boardSize({ cols: 20, rows: 2, rails: false }).rows === 5
    && normalizeSize({ cols: 20, rows: 2, rails: false }).rows === 5, '');
}

// (e-d) picRows + picLegs: chân đi theo chip — 2 hàng chân cách nhau cố
// định 6 hàng, đối xứng qua tâm chip (hàng trên = floor((rows+1)/2) − 3).
{
  check('(e-d) picRows: 830 -> [1,7] (b/h), 15 hàng -> [4,10] (e/k), 5 hàng -> [1,5] (hàng 6 treo), 25 hàng -> [9,15] (j/p)',
    JSON.stringify(picRows(830)) === JSON.stringify([1, 7])
    && JSON.stringify(picRows({ cols: 42, rows: 15, rails: true })) === JSON.stringify([4, 10])
    && JSON.stringify(picRows({ cols: 20, rows: 5, rails: false })) === JSON.stringify([1, 5])
    && JSON.stringify(picRows({ cols: 20, rows: 25, rails: false })) === JSON.stringify([9, 15]), '');
  check('(e-d) chip 42 cột x 15 hàng: đủ 40 chân, chân 1 ở hàng e, chân 21 ở hàng k',
    (() => {
      const legs = picLegs({ cols: 42, rows: 15, rails: true });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].r === 4 && legs[0].hole === 'e12' && legs[20].r === 10 && legs[20].hole === 'k31';
    })(), '');
  check('(e-d) chip 20 cột x 5 hàng: 20 chân cắm được (hàng b), 20 chân hàng 6 treo ngoài board',
    (() => {
      const legs = picLegs({ cols: 20, rows: 5, rails: false });
      return legs.length === 40 && legs.slice(0, 20).every((l) => !!l.hole) && legs[0].hole === 'b1'
        && legs.slice(20).every((l) => !l.hole);
    })(), '');
  check('(e-d) chip 20 cột x 25 hàng: đủ 40 chân, chân 1 ở j1, chân 40 ở p1',
    (() => {
      const legs = picLegs({ cols: 20, rows: 25, rails: false });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].hole === 'j1' && legs[39].hole === 'p1';
    })(), '');
  check('(e-d) chip 99 cột x 25 hàng: picCol=40, chân 1 ở j40',
    picCol({ cols: 99, rows: 25, rails: true }) === 40
    && picLegs({ cols: 99, rows: 25, rails: true })[0].hole === 'j40', '');
}

// (e-e) Địa chỉ lỗ: nhãn hàng kiểu bảng tính + số cột
{
  check('(e-e) "k5" trên board 10 hàng thì sai, trên board 15 hàng thì đúng (hàng 10)',
    parseHole('k5', 830) === null
    && (() => { const p = parseHole('k5', { cols: 42, rows: 15, rails: true }); return p && p.r === 10 && p.c === 5; })(), '');
  check('(e-e) "l12" trên 15 hàng thì đúng (hàng 11), "p1" thì sai',
    (() => { const p = parseHole('l12', { cols: 42, rows: 15, rails: true }); return p && p.r === 11 && p.c === 12; })()
    && parseHole('p1', { cols: 42, rows: 15, rails: true }) === null, '');
  check('(e-e) "y99" trên board 99x25 thì đúng (hàng 24, cột 99), "a100" thì sai',
    (() => { const p = parseHole('y99', { cols: 99, rows: 25, rails: true }); return p && p.r === 24 && p.c === 99; })()
    && parseHole('a100', { cols: 99, rows: 25, rails: true }) === null, '');
  check('(e-e) "y100" trên board 100x25 thì đúng (hàng 24, cột 100), "a101" thì sai',
    (() => { const p = parseHole('y100', { cols: 100, rows: 25, rails: true }); return p && p.r === 24 && p.c === 100; })()
    && parseHole('a101', { cols: 100, rows: 25, rails: true }) === null, '');
  check('(e-e) "K5" hoa vẫn sai ở model (UI thường hoá trước)',
    parseHole('K5', { cols: 42, rows: 15, rails: true }) === null, '');
}

// (e-f) Đổi size có rows khác: giữ/loại linh kiện + dây nguồn nối lại
{
  const st15 = defaultBenchState({ cols: 42, rows: 15, rails: true });
  st15.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  st15.components.push({ id: 'LED1', type: 'led', anchor: 'k10', rot: 0, props: { color: '#DC2626' } });
  st15.wires.push({ id: 'W10', a: 'k10', b: 'a11', color: '#2563EB' });
  check('(e-f) bàn mặc định 42x15: đủ 7 dây nguồn W1–W7, neo chip e12 (hàng chân trên = hàng e), label "Tùy chỉnh · 798 lỗ"',
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].every((id) => st15.wires.some((w) => w.id === id))
    && st15.components.find((c) => c.type === 'pic').anchor === 'e12'
    && sizeLabel({ cols: 42, rows: 15, rails: true }) === 'Tùy chỉnh · 798 lỗ', JSON.stringify(st15.components.find((c) => c.type === 'pic')));
  const r830 = pruneStateForSize(st15, 830);
  check('(e-f) 42x15 -> 830: LED k10 + dây W10 bị gỡ (hàng k ngoài board), LED a10 giữ',
    !r830.state.components.some((c) => c.id === 'LED1') && r830.state.components.some((c) => c.id === 'LED0')
    && !r830.state.wires.some((w) => w.id === 'W10') && r830.removed.components.join(',') === 'LED1'
    && r830.removed.wires.join(',') === 'W10', JSON.stringify(r830.removed));
  const st830 = defaultBenchState(830);
  st830.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  const r42x15 = pruneStateForSize(st830, { cols: 42, rows: 15, rails: true });
  check('(e-f) 830 -> 42x15: LED a10 giữ, chip GIỮ neo b22 (không căn giữa lại e12), dây nguồn W1 giữ b22->T+22, W6 về T+40',
    r42x15.state.components.some((c) => c.id === 'LED0')
    && r42x15.state.components.find((c) => c.type === 'pic').anchor === 'b22'
    && (() => {
      const w1 = r42x15.state.wires.find((w) => w.id === 'W1');
      const w6 = r42x15.state.wires.find((w) => w.id === 'W6');
      return w1 && w1.a === 'b22' && w1.b === 'T+22' && w6 && w6.b === 'T+40';
    })(), JSON.stringify(r42x15.state.wires.filter((w) => ['W1', 'W6'].includes(w.id))));
  const rSame = pruneStateForSize(st15, { cols: 42, rows: 15, rails: true });
  check('(e-f) đổi size 42x15 về chính nó: không gỡ gì, size giữ nguyên',
    rSame.removed.components.length === 0 && rSame.removed.wires.length === 0
    && JSON.stringify(rSame.state.size) === JSON.stringify({ cols: 42, rows: 15, rails: true }), JSON.stringify(rSame.state.size));
}

// (s) Đổi size board: chip + linh kiện đã cắm GIỮ NGUYÊN lỗ neo (board chỉ
// mở thêm ở vùng trống). Lab 1 đang chạy ở hàng a–j, mở board thêm hàng
// (j->z...) thì vùng a–j không động vào, mạch vẫn chạy.
{
  const { state: labState } = buildLabState(LABS[0]);
  const r60 = pruneStateForSize(labState, { cols: 63, rows: 60, rails: true });
  const pic60 = r60.state.components.find((c) => c.type === 'pic');
  check('(s-a) mở board 10 -> 60 hàng: chip GIỮ neo b22 (không nhảy về tâm board mới), R0/LED0 giữ nguyên lỗ, không gỡ linh kiện',
    pic60 && pic60.anchor === 'b22'
    && r60.state.components.find((c) => c.id === 'R0').anchor === 'i45'
    && r60.state.components.find((c) => c.id === 'LED0').anchor === 'i52'
    && r60.removed.components.length === 0, JSON.stringify(r60.state.components.map((c) => c.id + ':' + (c.anchor || ''))));
  check('(s-b) mở board 10 -> 60 hàng: 3 dây lab giữ nguyên đầu, không dây nào bị gỡ',
    r60.removed.wires.length === 0
    && ['LAB1-W1', 'LAB1-W2', 'LAB1-W3'].every((id) => r60.state.wires.some((w) => w.id === id))
    && r60.state.wires.find((w) => w.id === 'LAB1-W1').a === 'i29'
    && r60.state.wires.find((w) => w.id === 'LAB1-W1').b === 'j45'
    && r60.state.wires.find((w) => w.id === 'LAB1-W2').a === 'j49'
    && r60.state.wires.find((w) => w.id === 'LAB1-W2').b === 'j52'
    && r60.state.wires.find((w) => w.id === 'LAB1-W3').a === 'j53'
    && r60.state.wires.find((w) => w.id === 'LAB1-W3').b === 'B-50', JSON.stringify(r60.state.wires.filter((w) => w.id.startsWith('LAB1'))));
  check('(s-c) mở board 10 -> 60 hàng: netlist lab vẫn đúng (LED0 = RB0, về GND, có điện trở, 0 cảnh báo) và RB0=1 thì LED SÁNG',
    (() => {
      const nl = benchToNetlist(r60.state);
      const mapping = resolvePeripherals(nl);
      const led = mapping.leds.find((l) => l.id === 'LED0');
      if (!led || !led.pin || led.pin.id !== 'RB0' || led.gnd !== true || led.hasResistor !== true) return false;
      if (checkWiring(nl, null).length !== 0) return false;
      const cpu = createCPU();
      cpu.setWiring(mapping);
      cpu.writeFile(0x03, 0x20);
      cpu.writeFile(0x06, 0x00);
      cpu.writeFile(0x03, 0x00);
      cpu.writeFile(0x06, 0x01);
      return ledStates(cpu, mapping).find((s) => s.id === 'LED0').on === true;
    })(), '');
  check('(s-d) mở board rộng thêm cột (63 -> 100 cột): chip vẫn giữ neo b22, lab vẫn nối đúng RB0',
    (() => {
      const r100 = pruneStateForSize(labState, { cols: 100, rows: 10, rails: true });
      const pic = r100.state.components.find((c) => c.type === 'pic');
      const mapping = resolvePeripherals(benchToNetlist(r100.state));
      const led = mapping.leds.find((l) => l.id === 'LED0');
      return pic && pic.anchor === 'b22' && led && led.pin && led.pin.id === 'RB0' && led.gnd === true && led.hasResistor === true;
    })(), '');
  check('(s-e) thu board nhỏ lại quá (63 -> 20 cột): chip không vừa ở b22 nên căn giữa lại, lab bị gỡ (không còn RB0)',
    (() => {
      const r20 = pruneStateForSize(labState, { cols: 20, rows: 10, rails: false });
      const pic = r20.state.components.find((c) => c.type === 'pic');
      return pic && pic.anchor !== 'b22' && pic.anchor === picAnchor({ cols: 20, rows: 10, rails: false });
    })(), '');
}

// (e-g) normalizeSize kẹp cols 5–100 / rows 5–100 (bội số của 5)
{
  check('(e-g) {cols:3, rows:1} -> cols 5, rows 5',
    (() => { const s = normalizeSize({ cols: 3, rows: 1 }); return s.cols === 5 && s.rows === 5; })(), '');
  check('(e-g) {cols:150, rows:150} -> cols 100, rows 100; {cols:150, rows:99} -> rows 95',
    (() => { const s = normalizeSize({ cols: 150, rows: 150 }); return s.cols === 100 && s.rows === 100; })()
    && normalizeSize({ cols: 150, rows: 99 }).rows === 95, '');
  check('(e-g) {cols:99, rows:26, rails:true} -> rows 25; {cols:42, rows:12} -> rows 10',
    normalizeSize({ cols: 99, rows: 26, rails: true }).rows === 25
    && normalizeSize({ cols: 42, rows: 12 }).rows === 10, '');
}

// (e-h) Nghịch đảo holePos theo cả 2 chiều (pickHole trong bench.js):
// cột vẫn tuyến tính, hàng tìm bằng hàng có rowZ gần nhất (hàng cách nhau
// 1 PITCH trong đoạn, 2 PITCH qua ranh giới đoạn nên không còn công thức
// tuyến tính z/PITCH + (rows−1)/2).
{
  for (const size of [830, { cols: 42, rows: 15, rails: true }, { cols: 20, rows: 5, rails: false }]) {
    const cols = boardSize(size).cols;
    const rows = boardSize(size).rows;
    const midRow = rowLabel(Math.floor(rows / 2));
    const lastRow = rowLabel(rows - 1);
    const ids = ['a1', `${midRow}${Math.min(5, cols)}`, `${lastRow}${cols}`];
    const ok = ids.every((id) => {
      const p = holePos(id, size);
      if (!p) return false;
      let best = null, bestD = 1e9;
      for (let r = 0; r < rows; r++) { const d = Math.abs(rowZ(r, rows) - p.z); if (d < bestD) { bestD = d; best = r; } }
      return Math.round(p.x / PITCH + (cols + 1) / 2) === parseHole(id, size).c
        && best === parseHole(id, size).r;
    });
    check(`(e-h) nghịch đảo holePos trên ${JSON.stringify(size)}: cột + hàng tính lại đúng`, ok, '');
  }
}

// (e-i) canPlace: vùng dưới thân chip theo hàng chân mới
{
  const st = defaultBenchState({ cols: 42, rows: 15, rails: true });
  check('(e-i) 42x15: LED ở f20/g20 (hàng chân chip, trong cột chip) không đặt được',
    canPlace(st, 'led', 'f20', 0).ok === false && canPlace(st, 'led', 'g20', 0).ok === false, '');
  check('(e-i) 42x15: LED ở e20/h20 (trong dải hàng chân chip e–k) không đặt được; LED ở a20/n20 (ngoài hàng chân chip) đặt được',
    canPlace(st, 'led', 'e20', 0).ok === false && canPlace(st, 'led', 'h20', 0).ok === false
    && canPlace(st, 'led', 'a20', 0).ok === true && canPlace(st, 'led', 'n20', 0).ok === true, '');
  check('(e-i) 42x15: LED ở f40 (hàng chân chip nhưng ngoài cột chip) đặt được',
    canPlace(st, 'led', 'f40', 0).ok === true, '');
  check('(e-i) 42x15: LED ở a10 đặt được, LED ở l42 (không xoay) rơi ngoài board vì chân thứ 2 sang cột 43',
    canPlace(st, 'led', 'a10', 0).ok === true && canPlace(st, 'led', 'l42', 0).ok === false, '');
  check('(e-i) 42x5: LED ở a5 đặt được (ngoài cột chip), LED ở a20 đặt được (hàng a ngoài thân chip vì hàng chân dưới treo ngoài board), LED ở b20 không đặt được (dưới thân chip)',
    canPlace(defaultBenchState({ cols: 42, rows: 5, rails: false }), 'led', 'a5', 0).ok === true
    && canPlace(defaultBenchState({ cols: 42, rows: 5, rails: false }), 'led', 'a20', 0).ok === true
    && canPlace(defaultBenchState({ cols: 42, rows: 5, rails: false }), 'led', 'b20', 0).ok === false, '');
}

// (e-j) validateWireEnd theo chữ hàng của board
{
  const st = defaultBenchState({ cols: 42, rows: 15, rails: true });
  st.wires.push({ id: 'W10', a: 'a10', b: 'a11', color: '#2563EB' });
  check('(e-j) 42x15: đổi đầu dây sang k5/l5 thì được, sang p5/k43 thì lỗi',
    validateWireEnd(st, 'W10', 'b', 'k5').ok === true && validateWireEnd(st, 'W10', 'b', 'l5').ok === true
    && validateWireEnd(st, 'W10', 'b', 'p5').ok === false && validateWireEnd(st, 'W10', 'b', 'k43').ok === false, '');
  const r = retargetWireEnd(st, 'W10', 'b', 'k5');
  check('(e-j) retarget sang k5 áp dụng đúng vào state',
    r.ok === true && st.wires.find((w) => w.id === 'W10').b === 'k5', JSON.stringify(st.wires.find((w) => w.id === 'W10')));
}

// (e-k) sameSize so sánh cả rows
{
  check('(e-k) sameSize: 42x15 == 42x15, 42x15 != 42x10, 42x15 có rail != 42x15 không rail',
    sameSize({ cols: 42, rows: 15, rails: true }, { cols: 42, rows: 15, rails: true })
    && !sameSize({ cols: 42, rows: 15, rails: true }, { cols: 42, rows: 10, rails: true })
    && !sameSize({ cols: 42, rows: 15, rails: true }, { cols: 42, rows: 15, rails: false }), '');
  check('(e-k) sameSize: mẫu sẵn 830 == boardSize 63x10, != custom 63x10 có rail',
    sameSize(830, { cols: 63, rows: 10, rails: true }) === false
    && sameSize(830, 830), '');
}

// (e-l) bodyDepth: chiều sâu thân board theo rows (+ 1 khe hở đoạn cho mỗi
// ranh giới 5 hàng: 830 có 1 ranh giới -> +2.54; 20x25 có 4 -> +10.16;
// 20x5 không có ranh giới -> không đổi)
{
  check('(e-l) bodyDepth 830 = 49.56mm; 20x25 = 95.28mm; 20x5 = 34.32mm',
    Math.abs(bodyDepth(830) - 49.56) < 0.01
    && Math.abs(bodyDepth({ cols: 20, rows: 25, rails: false }) - 95.28) < 0.01
    && Math.abs(bodyDepth({ cols: 20, rows: 5, rails: false }) - 34.32) < 0.01,
    `${bodyDepth(830)}/${bodyDepth({ cols: 20, rows: 25, rails: false })}/${bodyDepth({ cols: 20, rows: 5, rails: false })}`);
}

// ===========================================================================
// ĐẶT 1 LẦN + CỌC NGUỒN + ĐIỆN ÁP NGUỒN
// ===========================================================================
// (f-a) Đặt 1 lần: vào chế độ đặt -> đặt 1 cái -> thoát; chọn lại mới đặt tiếp được
{
  let mode = togglePlacement(null, 'led'); // bấm thẻ LED
  check('(f-a) bấm thẻ LED -> vào chế độ đặt LED', mode === 'led', '');
  const st = defaultBenchState();
  check('(f-a) đặt được LED vào a10', canPlace(st, 'led', 'a10', 0).ok === true, '');
  st.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  mode = togglePlacement(mode, mode); // đặt xong 1 cái thì thoát (UI gọi setPlacementMode(null))
  check('(f-a) đặt 1 lần xong thì thoát chế độ đặt', mode === null, '');
  mode = togglePlacement(mode, 'led'); // chọn lại thẻ LED
  check('(f-a) chọn lại thẻ LED thì vào lại chế độ đặt', mode === 'led', '');
  check('(f-a) đặt cái nữa vào a12 được', canPlace(st, 'led', 'a12', 0).ok === true, '');
}

// (f-b) Cọc nguồn: parse + vị trí + dây mặc định W6/W7 + netlist về VCC
{
  check('(f-b) parsePsuPost: PSU1.+ -> {PSU1, +}, PSU1.- -> {PSU1, -}; "c12"/"PSU1.x" không phải cọc nguồn',
    (() => { const p = parsePsuPost('PSU1.+'); return p && p.psuId === 'PSU1' && p.sign === '+'; })()
    && (() => { const p = parsePsuPost('PSU1.-'); return p && p.psuId === 'PSU1' && p.sign === '-'; })()
    && parsePsuPost('c12') === null && parsePsuPost('PSU1.x') === null, '');
  const st = defaultBenchState();
  check('(f-b) vị trí cọc PSU1: + ở (-6, 14, -129), − ở (6, 14, -129)',
    (() => { const p = psuPostPos(st, 'PSU1.+'); return p && p.x === -6 && p.y === 14 && p.z === -129; })()
    && (() => { const p = psuPostPos(st, 'PSU1.-'); return p && p.x === 6 && p.y === 14 && p.z === -129; })()
    && psuPostPos(st, 'PSU9.+') === null, '');
  check('(f-b) dây mặc định W6/W7 nối cọc nguồn về rail: W6 = PSU1.+ -> T+40, W7 = PSU1.- -> T-40',
    st.wires.find((w) => w.id === 'W6').a === 'PSU1.+' && st.wires.find((w) => w.id === 'W6').b === 'T+40'
    && st.wires.find((w) => w.id === 'W7').a === 'PSU1.-' && st.wires.find((w) => w.id === 'W7').b === 'T-40',
    JSON.stringify(st.wires.filter((w) => ['W6', 'W7'].includes(w.id))));
  const st2 = defaultBenchState();
  st2.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st2.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
  st2.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const mapping = resolvePeripherals(benchToNetlist(st2));
  check('(f-b) dây PSU1.+ -> c10: LED anode về VCC, cathode về GND',
    mapping.leds[0].vccAnode === true && mapping.leds[0].gnd === true, JSON.stringify(mapping.leds[0]));
  check('(f-b) dây PSU1.+ -> c10: không có cảnh báo nối tắt',
    !checkWiring(benchToNetlist(st2)).some((w) => w.kind === 'short'),
    JSON.stringify(checkWiring(benchToNetlist(st2)).map((w) => w.message)));
}

// (f-c) Đổi đầu dây sang cọc nguồn — cả 2 chiều (lỗ -> nguồn và nguồn -> lỗ)
{
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st.wires.push({ id: 'W10', a: 'c10', b: 'b38', color: '#2563EB' });
  check('(f-c) chiều lỗ -> nguồn: đổi đầu B sang PSU1.+ thì được',
    validateWireEnd(st, 'W10', 'b', 'PSU1.+').ok === true, JSON.stringify(validateWireEnd(st, 'W10', 'b', 'PSU1.+')));
  const r1 = retargetWireEnd(st, 'W10', 'b', 'PSU1.+');
  let mapping = resolvePeripherals(benchToNetlist(st));
  check('(f-c) lỗ -> nguồn: LED anode về VCC sau khi đổi đầu sang PSU1.+',
    r1.ok === true && st.wires.find((w) => w.id === 'W10').b === 'PSU1.+' && mapping.leds[0].vccAnode === true, '');
  check('(f-c) chiều nguồn -> lỗ: đổi đầu B từ PSU1.+ sang h29 thì được',
    validateWireEnd(st, 'W10', 'b', 'h29').ok === true, '');
  const r2 = retargetWireEnd(st, 'W10', 'b', 'h29');
  mapping = resolvePeripherals(benchToNetlist(st));
  check('(f-c) nguồn -> lỗ: LED anode -> RB0 sau khi đổi đầu ra h29',
    r2.ok === true && mapping.leds[0].pin.id === 'RB0', JSON.stringify(mapping.leds[0].pin));
  check('(f-c) đổi sang PSU9.+ (không có nguồn này) thì lỗi, state không đổi',
    validateWireEnd(st, 'W10', 'b', 'PSU9.+').ok === false && st.wires.find((w) => w.id === 'W10').b === 'h29', '');
  st.wires.push({ id: 'W11', a: 'PSU1.+', b: 'a20', color: '#DC2626' });
  check('(f-c) đổi đầu B sang PSU1.+ khi đầu A đã là PSU1.+ thì lỗi (2 đầu trùng nhau)',
    validateWireEnd(st, 'W11', 'b', 'PSU1.+').ok === false, '');
}

// (f-d) Điện áp nguồn: mặc định 5V, đổi 12V lưu vào state, giá trị sai bị từ chối
{
  const st = defaultBenchState();
  const psu = st.components.find((c) => c.type === 'psu');
  check('(f-d) voltage mặc định của nguồn là 5V', psuVolts(psu) === 5, JSON.stringify(psu.props));
  check('(f-d) netlist mang theo psu.volts = 5', benchToNetlist(st).psu.volts === 5, JSON.stringify(benchToNetlist(st).psu));
  check('(f-d) validatePsuVolts: 12 được, 0 và 24 được, 3.3 được',
    validatePsuVolts('12').ok === true && validatePsuVolts('12').volts === 12
    && validatePsuVolts(0).ok === true && validatePsuVolts(24).ok === true
    && validatePsuVolts('3.3').ok === true && validatePsuVolts('3.3').volts === 3.3, '');
  check('(f-d) validatePsuVolts: -1, 30, "abc", "" đều bị từ chối',
    validatePsuVolts(-1).ok === false && validatePsuVolts(30).ok === false
    && validatePsuVolts('abc').ok === false && validatePsuVolts('').ok === false, '');
  psu.props = { volts: 12 };
  check('(f-d) đổi nguồn sang 12V: label "Nguồn 12V", netlist psu.volts = 12',
    compLabel(psu) === 'Nguồn 12V' && benchToNetlist(st).psu.volts === 12, compLabel(psu));
  check('(f-d) nguồn không có props -> mặc định 5V, label "Nguồn 5V"',
    psuVolts({ type: 'psu' }) === 5 && psuVolts() === 5 && compLabel({ id: 'PSU1', type: 'psu' }) === 'Nguồn 5V', '');
}

// (f-e) normalizeWireEnd + sanitizeState: đầu dây {x,y,z} cũ -> id cọc; giữ voltage
{
  const st = defaultBenchState();
  check('(f-e) normalizeWireEnd: điểm cọc + cũ -> PSU1.+, cọc − cũ -> PSU1.-, điểm lạ giữ nguyên, lỗ giữ nguyên',
    normalizeWireEnd(st, { x: -12, y: 28, z: -108 }) === 'PSU1.+'
    && normalizeWireEnd(st, { x: 12, y: 28, z: -108 }) === 'PSU1.-'
    && JSON.stringify(normalizeWireEnd(st, { x: 0, y: 28, z: -108 })) === JSON.stringify({ x: 0, y: 28, z: -108 })
    && normalizeWireEnd(st, 'c12') === 'c12', '');
  const old = {
    size: 830,
    components: [
      { id: 'PIC1', type: 'pic', anchor: 'b22', rot: 0, fixed: true, props: {} },
      { id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: {} },
    ],
    wires: [
      { id: 'W6', a: { x: -12, y: 28, z: -108 }, b: 'T+40', color: '#DC2626' },
      { id: 'W7', a: { x: 12, y: 28, z: -108 }, b: 'T-40', color: '#0F172A' },
    ],
  };
  const s = sanitizeState(old);
  check('(f-e) sanitizeState: dây nguồn cũ {x,y,z} đổi thành PSU1.+/PSU1.-',
    s.wires.find((w) => w.id === 'W6').a === 'PSU1.+' && s.wires.find((w) => w.id === 'W7').a === 'PSU1.-', JSON.stringify(s.wires));
  check('(f-e) sanitizeState: nguồn cũ không có props.volts -> mặc định 5V',
    psuVolts(s.components.find((c) => c.type === 'psu')) === 5, '');
  const old12 = JSON.parse(JSON.stringify(old));
  old12.components[1].props = { volts: 12 };
  const s12 = sanitizeState(old12);
  check('(f-e) sanitizeState giữ voltage 12V của nguồn đã lưu',
    psuVolts(s12.components.find((c) => c.type === 'psu')) === 12, '');
  const r400 = pruneStateForSize(s12, 400);
  check('(f-e) đổi size giữ voltage 12V của nguồn, W6/W7 vẫn là cọc nguồn về rail mới',
    psuVolts(r400.state.components.find((c) => c.type === 'psu')) === 12
    && r400.state.wires.find((w) => w.id === 'W6').a === 'PSU1.+'
    && r400.state.wires.find((w) => w.id === 'W7').a === 'PSU1.-'
    && r400.state.wires.find((w) => w.id === 'W6').b === 'T+25', JSON.stringify(r400.state.wires.filter((w) => ['W6', 'W7'].includes(w.id))));
}

// ===========================================================================
// (g) NHÃN HÀNG KIỂU BẢNG TÍNH a/aa/ab + STRIP ĐOẠN 5 + PAN/ZOOM + LED VCC (round 25/11)
// ===========================================================================
// (g-a) rowLabel kiểu bảng tính: a–z, aa–az, ba–bz, ..., cv (hàng 100)
{
  check('(g-a) rowLabel: hàng 0->a, 25->z, 26->aa, 27->ab, 51->az, 52->ba, 99->cv',
    rowLabel(0) === 'a' && rowLabel(25) === 'z' && rowLabel(26) === 'aa' && rowLabel(27) === 'ab'
    && rowLabel(51) === 'az' && rowLabel(52) === 'ba' && rowLabel(99) === 'cv' && rowLabel(9) === 'j', '');
  check('(g-a) rowIndexFromLabel ngược lại: a->0, z->25, aa->26, ab->27, az->51, ba->52, cv->99; nhãn sai -> -1',
    rowIndexFromLabel('a') === 0 && rowIndexFromLabel('z') === 25 && rowIndexFromLabel('aa') === 26
    && rowIndexFromLabel('ab') === 27 && rowIndexFromLabel('az') === 51 && rowIndexFromLabel('ba') === 52
    && rowIndexFromLabel('cv') === 99 && rowIndexFromLabel('') === -1 && rowIndexFromLabel('a1') === -1
    && rowIndexFromLabel('A') === -1, '');
  check('(g-a) holeId trên board 30 hàng: (26,5)->aa5, (0,12)->a12; round-trip holeId->parseHole đúng mọi hàng 0..99',
    holeId(26, 5, { cols: 42, rows: 30, rails: true }) === 'aa5'
    && holeId(0, 12, { cols: 42, rows: 30, rails: true }) === 'a12'
    && (() => {
      const size = { cols: 100, rows: 100, rails: true };
      for (let r = 0; r < 100; r++) {
        const id = holeId(r, 42, size);
        const p = parseHole(id, size);
        if (!p || p.r !== r || p.c !== 42) return false;
      }
      return true;
    })(), '');
  check('(g-a) round-trip parseHole<->holeId: mẫu hàng 0..99 × cột 1..100',
    (() => {
      const size = { cols: 100, rows: 100, rails: true };
      for (let r = 0; r < 100; r += 7) {
        for (let c = 1; c <= 100; c += 13) {
          const id = holeId(r, c, size);
          const p = parseHole(id, size);
          if (!p || p.r !== r || p.c !== c) return false;
        }
      }
      return true;
    })(), '');
}

// (g-b) Strip đoạn 5 hàng trên board dài (nhãn mới: a5/e5/f5...)
{
  const s30 = { cols: 42, rows: 30, rails: true };
  check('(g-b) board 30 hàng, cột 5: hàng a/e cùng strip (đoạn 1-5), a/f khác strip, k/o cùng strip (đoạn 11-15), p khác (đoạn 16-20)',
    stripKey('a5', s30) === stripKey('e5', s30) && stripKey('a5', s30) !== stripKey('f5', s30)
    && stripKey('k5', s30) === stripKey('o5', s30) && stripKey('k5', s30) !== stripKey('p5', s30), '');
  check('(g-b) board 30 hàng: a15 và e15 cùng strip, a15 và aa15 khác strip',
    stripKey('a15', s30) === stripKey('e15', s30) && stripKey('a15', s30) !== stripKey('aa15', s30), '');
}

// (g-c) Chân chip ở 2 đoạn 5 khác nhau
{
  check('(g-c) picRows trên board 30 hàng: [11,17] — hàng l (đoạn 3) và hàng r (đoạn 4), 2 đoạn khác nhau',
    JSON.stringify(picRows({ cols: 42, rows: 30, rails: true })) === JSON.stringify([11, 17])
    && Math.floor(11 / 5) !== Math.floor(17 / 5), '');
  check('(g-c) picRows trên board 100 hàng: [46,52], chân 1 ở au12, chân 40 ở ba12',
    JSON.stringify(picRows({ cols: 42, rows: 100, rails: true })) === JSON.stringify([46, 52])
    && picLegs({ cols: 42, rows: 100, rails: true })[0].hole === 'au12'
    && picLegs({ cols: 42, rows: 100, rails: true })[39].hole === 'ba12', '');
}

// (g-d) parseHole 1 định dạng duy nhất: nhãn hàng kiểu bảng tính + số cột
{
  const s30 = { cols: 42, rows: 30, rails: true };
  check('(g-d) board dài: "ab12" = hàng ab cột 12, "c12" = hàng c cột 12, "aa5" = hàng aa cột 5',
    (() => { const p = parseHole('ab12', s30); return p && p.r === 27 && p.c === 12; })()
    && (() => { const p = parseHole('c12', s30); return p && p.r === 2 && p.c === 12; })()
    && (() => { const p = parseHole('aa5', s30); return p && p.r === 26 && p.c === 5; })(), '');
  check('(g-d) "a1" là hàng a cột 1 (hợp lệ); "a0", "aa", "1a", "cv1" trên board 30 hàng đều sai',
    (() => { const p = parseHole('a1', s30); return p && p.r === 0 && p.c === 1; })()
    && parseHole('a0', s30) === null && parseHole('aa', s30) === null && parseHole('1a', s30) === null
    && parseHole('cv1', s30) === null, '');
  check('(g-d) board 100 hàng: "cu99" = hàng cu (r=98) cột 99, "cu100" = cột 100; rail T+5 vẫn đúng',
    (() => { const p = parseHole('cu99', { cols: 100, rows: 100, rails: true }); return p && p.r === 98 && p.c === 99; })()
    && (() => { const p = parseHole('cu100', { cols: 100, rows: 100, rails: true }); return p && p.r === 98 && p.c === 100; })()
    && (() => { const p = parseHole('T+5', { cols: 100, rows: 100, rails: true }); return p && p.r === -2 && p.c === 5; })(), '');
}

// (g-e) normalizeSize + holeCount trên board dài
{
  check('(g-e) normalizeSize: rows 30 giữ nguyên, rows 150 kẹp xuống 100',
    normalizeSize({ cols: 42, rows: 30 }).rows === 30 && normalizeSize({ cols: 42, rows: 150 }).rows === 100, '');
  check('(g-e) holeCount 42x30 có rail = 1428; allHoles 42x30 đủ 1428 id duy nhất',
    holeCount({ cols: 42, rows: 30, rails: true }) === 1428
    && (() => { const ids = allHoles({ cols: 42, rows: 30, rails: true }).map((h) => h.id); return ids.length === 1428 && new Set(ids).size === 1428; })(), '');
}

// (g-f) LED nối 5V: sáng khi mạch đủ VCC -> LED -> GND (có/không điện trở)
{
  const cpu = createCPU();
  // (a) 5V -> LED -> GND, KHÔNG điện trở
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
    const warns = checkWiring(benchToNetlist(st));
    check('(g-f) (a) 5V -> LED -> GND, không điện trở: LED SÁNG, cảnh báo thiếu điện trở vẫn còn',
      mapping.leds[0].vccAnode === true && mapping.leds[0].gnd === true && mapping.leds[0].hasResistor === false && on === true
      && warns.some((w) => w.message.includes('không có điện trở'))
      && warns.some((w) => w.message.includes('sáng liên tục')), JSON.stringify(mapping.leds[0]));
  }
  // (b) 5V -> R -> LED -> GND
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.components.push({ id: 'R0', type: 'resistor', anchor: 'd12', rot: 0, props: { value: 220 } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'd12', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'd16', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W12', a: 'c11', b: 'T-5', color: '#0F172A' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
    const warns = checkWiring(benchToNetlist(st));
    check('(g-f) (b) 5V -> R -> LED -> GND: LED SÁNG, không còn cảnh báo thiếu điện trở',
      mapping.leds[0].vccAnode === true && mapping.leds[0].gnd === true && mapping.leds[0].hasResistor === true && on === true
      && !warns.some((w) => w.message.includes('không có điện trở')), JSON.stringify(mapping.leds[0]));
  }
  // (c) anode có 5V, cathode nổi
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
    const warns = checkWiring(benchToNetlist(st));
    check('(g-f) (c) 5V -> LED, cathode nổi: LED TỐI, cảnh báo "chưa nối về GND"',
      mapping.leds[0].vccAnode === true && mapping.leds[0].gnd === false && on === false
      && warns.some((w) => w.message.includes('chưa nối về GND')), JSON.stringify(warns.map((w) => w.message)));
  }
  // (d) LED nối giữa 2 lỗ cùng strip (anode-cathode nối tắt)
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'c10', b: 'c11', color: '#2563EB' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
    const warns = checkWiring(benchToNetlist(st));
    check('(g-f) (d) LED anode-cathode nối tắt nhau: LED TỐI, cảnh báo "nối tắt 2 đầu LED"',
      on === false && warns.some((w) => w.message.includes('nối tắt 2 đầu LED')), JSON.stringify(warns.map((w) => w.message)));
  }
  // (e) anode 5V, cathode về chân RB1 đang là ngõ ra mức 0 (blink chạy)
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'h28', color: '#0F172A' });
    const { cpu: cpu2, mapping } = loadWiredExample('blink', benchToNetlist(st));
    runUntil(cpu2, 100000);
    const on = ledStates(cpu2, mapping).find((s) => s.id === 'LED0').on;
    check('(g-f) (e) 5V -> LED -> RB1 (ngõ ra mức 0): LED SÁNG',
      mapping.leds[0].vccAnode === true && mapping.leds[0].cathPin && mapping.leds[0].cathPin.id === 'RB1' && on === true, JSON.stringify(mapping.leds[0]));
  }
}

// (g-g) Hàm thuần pan/zoom-to-cursor (bench-model.js)
{
  check('(g-g) clampCamTarget: trong bàn giữ nguyên, ngoài bàn kẹp về biên ±570/±420',
    JSON.stringify(clampCamTarget(0, 0)) === JSON.stringify({ x: 0, z: 0 })
    && JSON.stringify(clampCamTarget(1000, 500)) === JSON.stringify({ x: 570, z: 420 })
    && JSON.stringify(clampCamTarget(-1000, -500)) === JSON.stringify({ x: -570, z: -420 }), '');
  check('(g-g) zoomTowardPoint: zoom vào 1 nửa thì target đi nửa đường về điểm trỏ; zoom ra thì không dịch',
    JSON.stringify(zoomTowardPoint({ x: 0, z: 0 }, { x: 100, z: 50 }, 0.5)) === JSON.stringify({ x: 50, z: 25 })
    && JSON.stringify(zoomTowardPoint({ x: 0, z: 0 }, { x: 100, z: 50 }, 1)) === JSON.stringify({ x: 0, z: 0 })
    && JSON.stringify(zoomTowardPoint({ x: 0, z: 0 }, { x: 100, z: 50 }, 1.5)) === JSON.stringify({ x: 0, z: 0 }), '');
  check('(g-g) panTarget: az=0 kéo phải 100px thì target sang trái 100mm; kéo xuống 100px thì target về phía người xem 100mm; az=90° kéo phải thì target dịch theo +z',
    JSON.stringify(panTarget({ x: 0, z: 0 }, 100, 0, 0, 1)) === JSON.stringify({ x: -100, z: 0 })
    && JSON.stringify(panTarget({ x: 0, z: 0 }, 0, 100, 0, 1)) === JSON.stringify({ x: 0, z: 100 })
    && (() => { const p = panTarget({ x: 0, z: 0 }, 100, 0, Math.PI / 2, 1); return Math.abs(p.x) < 1e-9 && p.z === 100; })(), '');
}

// ===========================================================================
// (h) HÀNG BỘI SỐ CỦA 5 + LED CHỈ SÁNG KHI 0 < VOLTS ≤ 10 (round 25/11)
// ===========================================================================
// (h-a) Hàng chỉ nhận bội số của 5: chuẩn hoá làm tròn xuống, kẹp 5–100
{
  check('(h-a) normalizeSize: rows 12->10, 27->25, 2->5, 1->5, 99->95, 150->100, 100 giữ, 5 giữ',
    normalizeSize({ cols: 42, rows: 12 }).rows === 10 && normalizeSize({ cols: 42, rows: 27 }).rows === 25
    && normalizeSize({ cols: 42, rows: 2 }).rows === 5 && normalizeSize({ cols: 42, rows: 1 }).rows === 5
    && normalizeSize({ cols: 42, rows: 99 }).rows === 95 && normalizeSize({ cols: 42, rows: 150 }).rows === 100
    && normalizeSize({ cols: 42, rows: 100 }).rows === 100 && normalizeSize({ cols: 42, rows: 5 }).rows === 5, '');
  check('(h-a) state cũ rows 12 qua sanitizeState -> 10 hàng, linh kiện còn hợp lệ được giữ',
    (() => {
      const raw = {
        size: { cols: 42, rows: 12, rails: true },
        components: [
          { id: 'PIC1', type: 'pic', anchor: 'b12', rot: 0, fixed: true, props: {} },
          { id: 'PSU1', type: 'psu', tx: 0, tz: -150, fixed: true, props: { volts: 5 } },
          { id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } },
        ],
        wires: [],
      };
      const s = sanitizeState(raw);
      return s.size.rows === 10 && s.components.some((c) => c.id === 'LED0');
    })(), '');
}

// (h-b) LED nối VCC chỉ sáng khi 0 < volts ≤ 10 (tắt ở 0V và trên 10V)
{
  const cpu = createCPU();
  // Mạch: PSU+ -> LED (c10/c11) -> GND, không điện trở
  const ledOnAt = (volts) => {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts };
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    return ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  };
  check('(h-b) LED nối VCC: 0V tắt, 5V sáng, 10V sáng, 10.5V tắt, 12V tắt, 24V tắt',
    ledOnAt(0) === false && ledOnAt(5) === true && ledOnAt(10) === true
    && ledOnAt(10.5) === false && ledOnAt(12) === false && ledOnAt(24) === false,
    `0V=${ledOnAt(0)} 5V=${ledOnAt(5)} 10V=${ledOnAt(10)} 10.5V=${ledOnAt(10.5)} 12V=${ledOnAt(12)} 24V=${ledOnAt(24)}`);
  // 12V + điện trở nối tiếp: vẫn tắt
  {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts: 12 };
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.components.push({ id: 'R0', type: 'resistor', anchor: 'd12', rot: 0, props: { value: 220 } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'd12', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'd16', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W12', a: 'c11', b: 'T-5', color: '#0F172A' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
    check('(h-b) 12V + điện trở nối tiếp: LED vẫn TẮT (quy tắc áp cho cả trường hợp có điện trở)',
      mapping.leds[0].vccAnode === false && mapping.leds[0].hasResistor === true && on === false, JSON.stringify(mapping.leds[0]));
  }
  // 0V + anode VCC + cathode về RB1 (ngõ ra mức 0): tối
  {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts: 0 };
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'h28', color: '#0F172A' });
    const { cpu: cpu2, mapping } = loadWiredExample('blink', benchToNetlist(st));
    runUntil(cpu2, 100000);
    const on = ledStates(cpu2, mapping).find((s) => s.id === 'LED0').on;
    check('(h-b) 0V + anode VCC + cathode về RB1 (ngõ ra mức 0): LED TỐI',
      mapping.leds[0].vccAnode === false && mapping.leds[0].cathPin && mapping.leds[0].cathPin.id === 'RB1' && on === false, JSON.stringify(mapping.leds[0]));
  }
  // LED chạy bằng chân PIC (anode RB0 mức cao, cathode GND): sáng dù nguồn 0V
  {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts: 0 };
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'c10', b: 'h29', color: '#2563EB' }); // anode -> strip RB0
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    const { cpu: cpu3, mapping } = loadWiredExample('blink', benchToNetlist(st));
    let guard = 0;
    while (guard++ < 40 && !(cpu3.pinDirection(1, 0) === 'out' && cpu3.pinLevel(1, 0) === 1)) {
      runUntil(cpu3, cpu3.cycles + 100000);
    }
    const on = ledStates(cpu3, mapping).find((s) => s.id === 'LED0').on;
    check('(h-b) anode RB0 mức cao + cathode GND, nguồn 0V: LED SÁNG (không phụ thuộc nguồn)',
      mapping.leds[0].pin && mapping.leds[0].pin.id === 'RB0' && mapping.leds[0].gnd === true && on === true,
      `pin=${JSON.stringify(mapping.leds[0].pin)} on=${on} cycles=${cpu3.cycles}`);
  }
}

// (h-c) Cảnh báo LED theo điện áp nguồn
{
  const warnsAt = (volts) => {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts };
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    return checkWiring(benchToNetlist(st)).map((w) => w.message);
  };
  check('(h-c) 5V: cảnh báo "sáng liên tục" có; 0V: không có; 10V: có',
    warnsAt(5).some((m) => m.includes('sáng liên tục'))
    && !warnsAt(0).some((m) => m.includes('sáng liên tục'))
    && warnsAt(10).some((m) => m.includes('sáng liên tục')), '');
  check('(h-c) 12V: không cảnh báo "sáng liên tục", có cảnh báo "vượt quá 10V" ghi 12V; 24V: ghi 24V',
    !warnsAt(12).some((m) => m.includes('sáng liên tục'))
    && warnsAt(12).some((m) => m.includes('vượt quá 10V') && m.includes('12V'))
    && warnsAt(24).some((m) => m.includes('vượt quá 10V') && m.includes('24V')), JSON.stringify(warnsAt(12)));
  check('(h-c) 0V + cathode nổi: không cảnh báo "chưa nối về GND" (anode không có điện)',
    (() => {
      const st = defaultBenchState();
      st.components.find((c) => c.type === 'psu').props = { volts: 0 };
      st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
      return checkWiring(benchToNetlist(st)).map((w) => w.message);
    })().some((m) => m.includes('chưa nối về GND')) === false, '');
}

// ===========================================================================
// (i) NÚT BẤM LÀ CÔNG TẮC 2 ĐẦU (round 25/11) — mạch của Điệp trong ảnh:
// PSU+ -> R 1Ω -> nút bấm -> LED -> GND. Nút bấm là công tắc 2 đầu: nhấn
// thì T1–T2 nối nhau, nhả thì ngắt. Dây dẫn one-shot chỉ sửa ở bench.js
// (DOM/Three.js) nên không test được bằng Node — kiểm tra bằng trình duyệt.
// ===========================================================================
// Mạch đầy đủ: LED0 ở c10/c11, R0 1Ω ở d12/d16, BTN0 ở c14/c15.
// PSU1.+ -> d12 (R L1), d16 (R L2) -> c14 (T1), c15 (T2) -> c10 (LED A),
// c11 (LED K) -> rail T- (GND).
function switchCircuit() {
  const st = defaultBenchState();
  st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
  st.components.push({ id: 'R0', type: 'resistor', anchor: 'd12', rot: 0, props: { value: 1 } });
  st.components.push({ id: 'BTN0', type: 'button', anchor: 'c14', rot: 0, props: {} });
  st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'd12', color: '#DC2626' });
  st.wires.push({ id: 'W11', a: 'd16', b: 'c14', color: '#DC2626' });
  st.wires.push({ id: 'W12', a: 'c15', b: 'c10', color: '#DC2626' });
  st.wires.push({ id: 'W13', a: 'c11', b: 'T-5', color: '#0F172A' });
  return st;
}

// (i-a) Nút bấm là công tắc ở tầng strip: nhả thì T1/T2 khác net, nhấn thì cùng net
{
  const st = switchCircuit();
  const open = buildBenchNets(st);
  const closed = buildBenchNets(st, ['BTN0']);
  check('(i-a) nút bấm là công tắc: nhả thì T1/T2 khác net, nhấn thì cùng net',
    open.termRoot.get('BTN0.T1') !== open.termRoot.get('BTN0.T2')
    && closed.termRoot.get('BTN0.T1') === closed.termRoot.get('BTN0.T2'), '');
}

// (i-b) Mạch (a)–(e): LED sáng/tối đúng từng trường hợp, kể cả điện trở 1Ω
{
  const cpu = createCPU();
  const ledOn = (st, pressedIds = []) => {
    const mapping = resolvePeripherals(benchToNetlist(st, pressedIds));
    return { on: ledStates(cpu, mapping).find((s) => s.id === 'LED0').on, mapping };
  };
  // (a) trực tiếp PSU+ -> LED -> GND
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    check('(i-b) (a) PSU+ -> LED -> GND trực tiếp: SÁNG', ledOn(st).on === true, '');
  }
  // (b) qua điện trở 1Ω, không công tắc
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.components.push({ id: 'R0', type: 'resistor', anchor: 'd12', rot: 0, props: { value: 1 } });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'd12', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'd16', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W12', a: 'c11', b: 'T-5', color: '#0F172A' });
    const r = ledOn(st);
    check('(i-b) (b) PSU+ -> R 1Ω -> LED -> GND: SÁNG, hasResistor=true (1Ω vẫn dẫn)',
      r.on === true && r.mapping.leds[0].hasResistor === true, JSON.stringify(r.mapping.leds[0]));
  }
  // (c) qua nút bấm, không điện trở
  {
    const st = defaultBenchState();
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
    st.components.push({ id: 'BTN0', type: 'button', anchor: 'c14', rot: 0, props: {} });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c14', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c15', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W12', a: 'c11', b: 'T-5', color: '#0F172A' });
    check('(i-b) (c) PSU+ -> BTN -> LED -> GND: nhấn thì SÁNG, nhả thì TỐI',
      ledOn(st, ['BTN0']).on === true && ledOn(st).on === false, '');
  }
  // (d) + (e) mạch đầy đủ
  {
    const st = switchCircuit();
    const pressed = ledOn(st, ['BTN0']);
    const released = ledOn(st);
    const warnsReleased = checkWiring(benchToNetlist(st)).map((w) => w.message);
    check('(i-b) (d) PSU+ -> R 1Ω -> BTN -> LED -> GND, nhấn: SÁNG, hasResistor=true',
      pressed.on === true && pressed.mapping.leds[0].hasResistor === true, JSON.stringify(pressed.mapping.leds[0]));
    check('(i-b) (e) mạch đầy đủ, nút KHÔNG nhấn: TỐI; không cảnh báo "không có điện trở" (điện trở nằm sau công tắc đang mở)',
      released.on === false && released.mapping.leds[0].hasResistor === true
      && !warnsReleased.some((m) => m.includes('không có điện trở')), JSON.stringify(warnsReleased));
  }
}

// (i-c) Nút bấm với chân PIC vẫn active-low + pull-up (T1 nối dây tới RB1 lỗ h28, T2 về GND)
{
  const st = defaultBenchState();
  st.components.push({ id: 'BTN0', type: 'button', anchor: 'c10', rot: 0, props: {} });
  st.wires.push({ id: 'W10', a: 'c10', b: 'h28', color: '#2563EB' });
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const cpu = createCPU();
  const mapping = resolvePeripherals(benchToNetlist(st));
  cpu.setWiring(mapping);
  check('(i-c) nút nối RB1–GND: mapping pin=RB1, otherLevel=0',
    mapping.buttons[0].pin && mapping.buttons[0].pin.id === 'RB1' && mapping.buttons[0].otherLevel === 0,
    JSON.stringify(mapping.buttons[0]));
  applyButtonToCpu(cpu, mapping, 'BTN0', true);
  check('(i-c) nút RB1: nhấn -> RB1 đọc mức 0', cpu.pinLevel(1, 1) === 0, '');
  applyButtonToCpu(cpu, mapping, 'BTN0', false);
  check('(i-c) nút RB1: nhả -> RB1 đọc mức 1 (pull-up)', cpu.pinLevel(1, 1) === 1, '');
  // Nhấn (netlist đóng công tắc): chân RB1 nối về GND nhưng KHÔNG báo xung đột giả
  const warnsPressed = checkWiring(benchToNetlist(st, ['BTN0']));
  check('(i-c) nút RB1 đang nhấn: không cảnh báo "2 nguồn tín hiệu" giả (2 đầu nút chỉ tính 1 nguồn)',
    !warnsPressed.some((w) => w.id.startsWith('conflict-') || w.message.includes('2 nguồn tín hiệu')),
    JSON.stringify(warnsPressed.map((w) => w.message)));
  // Mapping với netlist đóng: pin vẫn là RB1, otherLevel vẫn 0, nhấn vẫn kéo về 0
  const mapping2 = resolvePeripherals(benchToNetlist(st, ['BTN0']));
  const cpu2 = createCPU();
  cpu2.setWiring(mapping2);
  applyButtonToCpu(cpu2, mapping2, 'BTN0', true);
  check('(i-c) nút RB1 đang nhấn (mapping mới): nhấn -> RB1 vẫn mức 0',
    mapping2.buttons[0].pin.id === 'RB1' && mapping2.buttons[0].otherLevel === 0 && cpu2.pinLevel(1, 1) === 0,
    JSON.stringify(mapping2.buttons[0]));
}

// (i-d) Nút nối thẳng VCC–GND vẫn cảnh báo nối tắt nguồn (mở lẫn nhấn)
{
  const st = defaultBenchState();
  st.components.push({ id: 'BTN0', type: 'button', anchor: 'c14', rot: 0, props: {} });
  st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c14', color: '#DC2626' });
  st.wires.push({ id: 'W11', a: 'c15', b: 'T-5', color: '#0F172A' });
  const warnsOpen = checkWiring(benchToNetlist(st)).map((w) => w.message);
  const warnsPressed = checkWiring(benchToNetlist(st, ['BTN0'])).map((w) => w.message);
  check('(i-d) nút nối thẳng VCC–GND: cảnh báo nối tắt nguồn cả khi mở lẫn khi nhấn',
    warnsOpen.some((m) => m.includes('nối thẳng VCC–GND')) && warnsPressed.some((m) => m.includes('nối thẳng VCC–GND')),
    JSON.stringify(warnsOpen));
}

// ===========================================================================
// (j) TAB "NẠP VIẾT CODE": ProgramRunner — chạy/tạm dừng/breakpoint (round 25/11)
// Vòng chạy + editor/gutter/panel tự to-nhỏ là DOM nên không test được bằng
// Node — kiểm tra bằng trình duyệt.
// ===========================================================================
const BP_PROG = `    ORG 0
    MOVLW 0x01
    MOVWF 0x20
L1
    MOVLW 0x02
    MOVWF 0x20
    GOTO L1`;
const SLEEP_PROG = `    ORG 0
    MOVLW 0x01
    SLEEP
    MOVLW 0x02`;

// (j-a) Bảng dòng->địa chỉ của assembler (code nhấp nháy mẫu)
{
  const r = assemble(EXAMPLES.find((e) => e.id === 'blink').code);
  check('(j-a) lineToAddr: dòng BSF PORTB,0 (dòng 7) -> địa chỉ 5; BANKSEL TRISB (dòng 3) -> 0',
    r.errors.length === 0 && r.lineToAddr.get(7) === 5 && r.lineToAddr.get(3) === 0, JSON.stringify([...r.lineToAddr.entries()]));
  check('(j-a) addrToLine: địa chỉ 5 -> dòng 7, địa chỉ 0 -> dòng 3; dòng chú thích/nhãn không có địa chỉ',
    r.addrToLine.get(5) === 7 && r.addrToLine.get(0) === 3 && !r.lineToAddr.has(1) && !r.lineToAddr.has(6), '');
}

// (j-b) Breakpoint: chạy tới breakpoint thì dừng đúng địa chỉ, Chạy tiếp thì chạy tới breakpoint sau
{
  const cpu = createCPU();
  const run = new ProgramRunner(cpu);
  const loaded = run.loadAsm(BP_PROG);
  check('(j-b) loadAsm chương trình breakpoint: ok, hasProgram, idle',
    loaded.ok && run.getStatus().hasProgram && run.getStatus().state === 'idle', JSON.stringify(loaded.errors || ''));
  run.setBreakpointLines([5]);
  const started = run.run();
  const st1 = run.tick(100);
  check('(j-b) breakpoint dòng 5 (địa chỉ 2): chạy tới thì dừng, PC=2, dòng=5, W=0x01',
    started.ok && st1.state === 'paused' && st1.pauseReason === 'breakpoint' && st1.pc === 2 && st1.line === 5 && cpu.w === 0x01,
    JSON.stringify(st1) + ` W=${cpu.w}`);
  const resumed = run.run();
  const st2 = run.tick(100);
  check('(j-b) Chạy tiếp: bước qua lệnh breakpoint rồi dừng lại ở breakpoint sau, PC=2, W=0x02',
    resumed.ok && st2.state === 'paused' && st2.pauseReason === 'breakpoint' && st2.pc === 2 && st2.line === 5 && cpu.w === 0x02,
    JSON.stringify(st2) + ` W=${cpu.w}`);
}

// (j-c) Chạy từng lệnh (step) + Dừng + SLEEP
{
  const cpu = createCPU();
  const run = new ProgramRunner(cpu);
  run.loadAsm(BP_PROG);
  const s1 = run.stepOnce();
  check('(j-c) step 1: PC=1, dòng=3, W=0x01, paused/step',
    s1.ok && s1.state === 'paused' && s1.pauseReason === 'step' && s1.pc === 1 && s1.line === 3 && cpu.w === 0x01, JSON.stringify(s1));
  const s2 = run.stepOnce();
  check('(j-c) step 2: PC=2, dòng=5, W vẫn 0x01 (MOVWF không đổi W)',
    s2.ok && s2.pc === 2 && s2.line === 5 && cpu.w === 0x01, JSON.stringify(s2));
  const r = run.run();
  run.tick(100); // không có breakpoint: chạy vòng lặp vô hạn, vẫn running
  const paused = run.pause();
  check('(j-c) Dừng: từ running -> paused/user',
    r.ok && paused.state === 'paused' && paused.pauseReason === 'user', JSON.stringify(paused));
  const cpu2 = createCPU();
  const run2 = new ProgramRunner(cpu2);
  run2.loadAsm(SLEEP_PROG);
  run2.run();
  const st = run2.tick(100);
  check('(j-c) SLEEP: CPU ngủ, runner paused/sleep, PC=2',
    st.state === 'paused' && st.pauseReason === 'sleep' && st.sleeping === true && st.pc === 2, JSON.stringify(st));
}

// (j-d) Nạp file .hex: chạy được, breakpoint không áp dụng
{
  const hex = exportHex(assemble(EXAMPLES.find((e) => e.id === 'blink').code).program);
  const cpu = createCPU();
  const run = new ProgramRunner(cpu);
  const loaded = run.loadHex(hex);
  check('(j-d) loadHex chương trình blink: ok, words > 0, hexMode',
    loaded.ok && loaded.words > 0 && run.getStatus().hexMode === true, JSON.stringify(loaded));
  const kept = run.setBreakpointLines([7]);
  check('(j-d) breakpoint trên chương trình .hex: không giữ dòng nào (không có bảng dòng)',
    kept.length === 0, JSON.stringify(kept));
  run.run();
  const st = run.tick(100);
  check('(j-d) chương trình .hex chạy bình thường, không dừng ở breakpoint',
    st.state === 'running', JSON.stringify(st));
  run.pause();
}

// (j-e) Dịch lỗi thì không nạp; dịch lại thì breakpoint ở dòng không còn lệnh bị bỏ
{
  const cpu = createCPU();
  const run = new ProgramRunner(cpu);
  const noProg = run.run();
  const noStep = run.stepOnce();
  check('(j-e) chưa nạp chương trình: run()/stepOnce() báo lỗi',
    noProg.ok === false && typeof noProg.error === 'string' && noStep.ok === false, JSON.stringify(noProg));
  const bad = run.loadAsm('    ORG 0\n    FOO BAR\n');
  check('(j-e) dịch lỗi: ok=false, có errors kèm số dòng, không nạp chương trình',
    bad.ok === false && bad.errors.length > 0 && bad.errors[0].line === 2 && run.getStatus().hasProgram === false,
    JSON.stringify(bad.errors));
  run.loadAsm(BP_PROG);
  run.setBreakpointLines([5, 6]);
  check('(j-e) breakpoint dòng 5, 6 được giữ sau khi nạp',
    JSON.stringify(run.getStatus().breakpointLines) === JSON.stringify([5, 6]), JSON.stringify(run.getStatus().breakpointLines));
  const prog2 = `    ORG 0
    MOVLW 0x01
; dong chu thich
    MOVWF 0x20`;
  run.loadAsm(prog2);
  check('(j-e) dịch lại code ngắn hơn: breakpoint dòng 5, 6 (không còn lệnh) bị bỏ',
    JSON.stringify(run.getStatus().breakpointLines) === JSON.stringify([]), JSON.stringify(run.getStatus().breakpointLines));
}

// ===========================================================================
// (k) CHÂN CHIP ĐI THEO CHIP (round 25/11): 2 hàng chân cách nhau cố định
// 6 hàng, đối xứng qua tâm chip; thân chip ôm đúng 2 hàng chân.
// ===========================================================================
// (k-a) picRows theo tâm chip: 10 hàng -> (2,8); 15 -> (5,11); 20 -> (7,13);
// 25 -> (10,16); 30 -> (12,18); 100 -> (47,53); <=6 hàng (thực tế chỉ
// board 5 hàng, vì hàng làm tròn xuống bội số 5) -> fallback (2,6)
{
  check('(k-a) picRows: 10->[1,7], 15->[4,10], 20->[6,12], 25->[9,15], 30->[11,17], 100->[46,52], 5->[1,5]',
    JSON.stringify(picRows(830)) === JSON.stringify([1, 7])
    && JSON.stringify(picRows({ cols: 42, rows: 15, rails: true })) === JSON.stringify([4, 10])
    && JSON.stringify(picRows({ cols: 42, rows: 20, rails: true })) === JSON.stringify([6, 12])
    && JSON.stringify(picRows({ cols: 42, rows: 25, rails: true })) === JSON.stringify([9, 15])
    && JSON.stringify(picRows({ cols: 42, rows: 30, rails: true })) === JSON.stringify([11, 17])
    && JSON.stringify(picRows({ cols: 42, rows: 100, rails: true })) === JSON.stringify([46, 52])
    && JSON.stringify(picRows({ cols: 20, rows: 5, rails: false })) === JSON.stringify([1, 5]), '');
  check('(k-a) khoảng cách 2 hàng chân luôn 6 hàng (trừ fallback board 5 hàng là 4)',
    (() => {
      const span = (rows) => { const [a, b] = picRows({ cols: 42, rows, rails: true }); return b - a; };
      return span(10) === 6 && span(15) === 6 && span(20) === 6 && span(25) === 6 && span(30) === 6 && span(100) === 6 && span(5) === 4;
    })(), '');
  check('(k-a) 2 hàng chân đối xứng qua tâm chip (điểm giữa 2 hàng = tâm board, sai số < 1 hàng)',
    (() => {
      const mid = (rows) => { const [a, b] = picRows({ cols: 42, rows, rails: true }); return (a + b) / 2; };
      return [10, 15, 20, 25, 30, 100].every((rows) => Math.abs(mid(rows) - (rows - 1) / 2) < 1);
    })(), '');
}
// (k-b) picBodyDepth ôm đúng 2 hàng chân: hiệu tọa độ Z thật của 2 hàng
// chân + lề 3mm. 2 hàng chân cách nhau 6 hàng nhưng số ranh giới đoạn nằm
// giữa phụ thuộc vị trí tuyệt đối của chân: 830 (b–h) qua 1 ranh giới e/f
// -> 6*2.54 + 2.54 + 3 = 20.78; board 15 hàng (e–k) qua 2 ranh giới
// (e/f, j/k) -> 6*2.54 + 2*2.54 + 3 = 23.32; board 100 hàng qua 1 ranh
// giới -> 20.78. Board 5 hàng: chân (1, 5) qua 1 ranh giới (sau hàng 5)
// nên khoảng cách = 4*2.54 + 2.54 = 12.7, thân chip = 15.7mm.
{
  const near = (a, b) => Math.abs(a - b) < 0.01;
  check('(k-b) picBodyDepth: 830 -> 20.78mm, board 15 hàng -> 23.32mm (chân e–k qua 2 ranh giới), board 100 hàng -> 20.78mm, board 5 hàng -> 15.7mm',
    near(picBodyDepth(830), 20.78) && near(picBodyDepth({ cols: 42, rows: 15, rails: true }), 23.32)
    && near(picBodyDepth({ cols: 42, rows: 100, rails: true }), 20.78)
    && near(picBodyDepth({ cols: 20, rows: 5, rails: false }), 15.7), '');
}
// (k-c) Chân (leg) trên board dài vẫn ở 2 hàng chân của chip, đủ 40 chân
{
  check('(k-c) board 30 hàng: chân 1 ở l12, chân 40 ở r12, đủ 40 chân đều có lỗ',
    (() => {
      const legs = picLegs({ cols: 42, rows: 30, rails: true });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].hole === 'l12' && legs[39].hole === 'r12';
    })(), '');
  check('(k-c) board 100 hàng: chân 1 ở au12, chân 40 ở ba12',
    picLegs({ cols: 42, rows: 100, rails: true })[0].hole === 'au12'
    && picLegs({ cols: 42, rows: 100, rails: true })[39].hole === 'ba12', '');
}

// ===========================================================================
// (l) CÒI BUZZER KÊU BẰNG TIẾNG (round 25/11): model nhận cả nối thẳng nguồn
// ===========================================================================
// (l-a) P→VCC / N→GND: còi bật (chân + nối thẳng nguồn 5V)
{
  const cpu = createCPU();
  const st = defaultBenchState();
  st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
  st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const mapping = resolvePeripherals(benchToNetlist(st));
  check('(l-a) còi P→VCC/N→GND: mapping ghi vccP=true, gnd=true, không gắn chân PIC',
    mapping.buzzers[0].vccP === true && mapping.buzzers[0].gnd === true && mapping.buzzers[0].pin === null, JSON.stringify(mapping.buzzers[0]));
  check('(l-a) còi P→VCC/N→GND: buzzerStates bật',
    buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on === true, '');
}
// (l-b) P→RB0: còi kêu theo nhịp blink
{
  const st = defaultBenchState();
  st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
  st.wires.push({ id: 'W10', a: 'c10', b: 'h29', color: '#2563EB' }); // P -> strip RB0
  st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
  const r = assemble(EXAMPLES.find((e) => e.id === 'blink').code);
  const cpu = createCPU();
  const mapping = resolvePeripherals(benchToNetlist(st));
  cpu.setWiring(mapping);
  cpu.loadProgram(r.program);
  runUntil(cpu, 100000);
  check('(l-b) còi P→RB0: sau 100k chu kỳ (RB0=1) còi KÊU',
    r.errors.length === 0 && mapping.buzzers[0].pin && mapping.buzzers[0].pin.id === 'RB0'
    && buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on === true,
    `pin=${JSON.stringify(mapping.buzzers[0].pin)} PORTB=${cpu.readPort(1).toString(16)}`);
  runUntil(cpu, 300000);
  check('(l-b) còi P→RB0: sau 300k chu kỳ (RB0=0) còi TẮT',
    buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on === false,
    `PORTB=${cpu.readPort(1).toString(16)}`);
}
// (l-c) Thiếu GND thì không kêu, dù chân + có nguồn; chân + nổi cũng không kêu
{
  const cpu = createCPU();
  // P→VCC, N nổi
  {
    const st = defaultBenchState();
    st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    check('(l-c) còi P→VCC, chân − nổi: KHÔNG kêu',
      mapping.buzzers[0].vccP === true && mapping.buzzers[0].gnd === false
      && buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on === false, JSON.stringify(mapping.buzzers[0]));
  }
  // P→RB0 mức cao, N nổi + P nổi, N→GND
  {
    const st = defaultBenchState();
    st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
    st.wires.push({ id: 'W10', a: 'c10', b: 'h29', color: '#2563EB' }); // P -> strip RB0
    const mapping = resolvePeripherals(benchToNetlist(st));
    cpu.setWiring(mapping);
    cpu.writeFile(0x03, 0x20); // bank1: RP0=1
    cpu.writeFile(0x06, 0x00); // TRISB = 0 (ngõ ra)
    cpu.writeFile(0x03, 0x00); // về bank0
    cpu.writeFile(0x06, 0x01); // PORTB = 0x01 -> RB0=1
    const onNoGnd = buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on;
    const st2 = defaultBenchState();
    st2.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
    st2.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' }); // chỉ N về GND, P nổi
    const mapping2 = resolvePeripherals(benchToNetlist(st2));
    const onFloating = buzzerStates(cpu, mapping2).find((s) => s.id === 'BUZ0').on;
    check('(l-c) còi P→RB0 mức cao mà chân − nổi: KHÔNG kêu; P nổi, N→GND: KHÔNG kêu',
      mapping.buzzers[0].pin && mapping.buzzers[0].pin.id === 'RB0' && onNoGnd === false && onFloating === false,
      `pin=${JSON.stringify(mapping.buzzers[0].pin)} onNoGnd=${onNoGnd} onFloating=${onFloating}`);
  }
}
// (l-d) Còi nối VCC chỉ kêu khi 0 < volts ≤ 10 (cùng quy tắc LED)
{
  const cpu = createCPU();
  const buzzerOnAt = (volts) => {
    const st = defaultBenchState();
    st.components.find((c) => c.type === 'psu').props = { volts };
    st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
    st.wires.push({ id: 'W10', a: 'PSU1.+', b: 'c10', color: '#DC2626' });
    st.wires.push({ id: 'W11', a: 'c11', b: 'T-5', color: '#0F172A' });
    const mapping = resolvePeripherals(benchToNetlist(st));
    return buzzerStates(cpu, mapping).find((s) => s.id === 'BUZ0').on;
  };
  check('(l-d) còi nối VCC: 0V tắt',
    buzzerOnAt(0) === false, `0V=${buzzerOnAt(0)}`);
  check('(l-d) còi nối VCC: 5V kêu, 10V kêu',
    buzzerOnAt(5) === true && buzzerOnAt(10) === true, `5V=${buzzerOnAt(5)} 10V=${buzzerOnAt(10)}`);
  check('(l-d) còi nối VCC: 10.5V tắt, 12V tắt, 24V tắt',
    buzzerOnAt(10.5) === false && buzzerOnAt(12) === false && buzzerOnAt(24) === false,
    `10.5V=${buzzerOnAt(10.5)} 12V=${buzzerOnAt(12)} 24V=${buzzerOnAt(24)}`);
}

// ===========================================================================
// (m) LỖ BOARD KHÔNG NHÁY/NHÒE — Z-FIGHTING (round 25/11): mặt trên lỗ cao
// hơn mặt board 0.35mm, lớn hơn sai số depth buffer ở khoảng cách xa nhất.
// ===========================================================================
// (m-a) Mặt trên lỗ cao hơn mặt board tối thiểu 0.2mm; đáy vẫn chìm trong thân board
{
  const topY = holeCenterY(8) + HOLE_HEIGHT / 2;
  const bottomY = holeCenterY(8) - HOLE_HEIGHT / 2;
  check('(m-a) lỗ: mặt trên cao hơn mặt board 0.35mm (>= 0.2mm), đáy chìm 0.25mm trong thân board, bán kính/cao không đổi',
    HOLE_TOP_ABOVE_BOARD >= 0.2 && Math.abs(topY - 8 - HOLE_TOP_ABOVE_BOARD) < 1e-9
    && bottomY < 8 && bottomY > 0 && HOLE_RADIUS === 0.95 && HOLE_HEIGHT === 0.6,
    `topY=${topY} bottomY=${bottomY} r=${HOLE_RADIUS} h=${HOLE_HEIGHT}`);
}
// (m-b) Sai số depth buffer 24-bit ở khoảng cách camera xa nhất vẫn nhỏ hơn khoảng tách
{
  const dz1000 = depthPrecisionAt(MAX_CAMERA_DISTANCE, 1);
  const dz900 = depthPrecisionAt(900, 1);
  check('(m-b) depth buffer ở 1000mm: sai số ~0.06mm < 0.35mm (khoảng tách); khoảng tách cũ 0.05mm thì NHỎ hơn sai số nên mới nháy',
    dz1000 < HOLE_TOP_ABOVE_BOARD && dz900 < HOLE_TOP_ABOVE_BOARD && dz1000 > 0.05,
    `dz(1000)=${dz1000.toFixed(4)} dz(900)=${dz900.toFixed(4)}`);
}

// ===========================================================================
// (n) VẠCH CHIA ĐOẠN 5 HÀNG VẼ TRONG TEXTURE, KHÔNG CÒN RÃNH 3D (round 25/11):
// rãnh 3D cũ rộng 2.4mm đè lên lỗ e/f (lỗ cách ranh giới 1.27mm, bán kính
// 0.95mm); vạch texture rộng ~1mm nằm phẳng trên mặt board, lỗ là đĩa 3D
// cao hơn 0.35mm nên không bao giờ bị che.
// ===========================================================================
// (n-a) Board 10 hàng: chỉ 1 ranh giới ở z = 0 (chính giữa e/f)
{
  const b10 = segmentBoundaries(830);
  check('(n-a) board 10 hàng: 1 ranh giới đoạn ở z = 0 (chính giữa e/f)',
    b10.length === 1 && Math.abs(b10[0]) < 1e-9,
    `boundaries=${JSON.stringify(b10)}`);
}
// (n-b) Board 15 hàng: 2 ranh giới sau hàng 5 và 10, đối xứng qua tâm
{
  const b15 = segmentBoundaries({ cols: 63, rows: 15 });
  check('(n-b) board 15 hàng: 2 ranh giới ở z = -7.62 và +7.62 (sau hàng 5, 10)',
    b15.length === 2 && Math.abs(b15[0] + 7.62) < 1e-9 && Math.abs(b15[1] - 7.62) < 1e-9,
    `boundaries=${JSON.stringify(b15)}`);
}
// (n-c) Board 30 hàng: 5 ranh giới sau hàng 5, 10, 15, 20, 25
{
  const b30 = segmentBoundaries({ cols: 63, rows: 30 });
  const expect = [-30.48, -15.24, 0, 15.24, 30.48];
  check('(n-c) board 30 hàng: 5 ranh giới ở -30.48, -15.24, 0, 15.24, 30.48',
    b30.length === 5 && expect.every((e, i) => Math.abs(b30[i] - e) < 1e-9),
    `boundaries=${JSON.stringify(b30)}`);
}
// (n-d) Ranh giới nằm chính giữa 2 hàng lỗ kề (cách mỗi lỗ PITCH = 2.54mm,
// nửa khe hở vật lý 5.08mm); vạch rộng 1.5mm nằm phẳng trên mặt board
// (+0.05), mặt lỗ ở +0.35 nên vạch không che được lỗ: ranh giới tới mép
// lỗ = 2.54 − 0.95 = 1.59mm, lớn hơn nửa bề rộng vạch 0.75mm nên vạch
// không chạm tới lỗ nào.
{
  const rows = 10;
  const zB = segmentBoundaries(830)[0];
  const zE = rowZ(4, rows); // tâm lỗ hàng e (chỉ số 4)
  const zF = rowZ(5, rows); // tâm lỗ hàng f (chỉ số 5)
  check('(n-d) ranh giới cách lỗ e và f đều 2.54mm (= PITCH, nửa khe hở 5.08mm); vạch 1.5mm trong texture, mặt lỗ +0.35 cao hơn mặt board nên vạch không che được lỗ',
    Math.abs(Math.abs(zB - zE) - PITCH) < 1e-9 && Math.abs(Math.abs(zF - zB) - PITCH) < 1e-9
    && SEGMENT_LINE_WIDTH_MM === 1.5 && HOLE_TOP_ABOVE_BOARD === 0.35
    && SEGMENT_LINE_WIDTH_MM / 2 < PITCH / 2,
    `zB=${zB} zE=${zE} zF=${zF}`);
}
// (n-e) Không còn khối rãnh 3D nào trong buildBreadboardMesh (bench.js)
{
  const src = readFileSync(new URL('./public/bench.js', import.meta.url), 'utf8');
  check('(n-e) bench.js không còn khối rãnh 3D (groove / BoxGeometry 2.4mm)',
    !src.includes('groove') && !src.includes('BoxGeometry(bodyW, 0.6, 2.4)'),
    'con tim thay khoi ranh 3D');
}

// ===========================================================================
// (o) CHUYỂN ĐỔI ID LỖ CŨ (chữ+số khối) SANG NHÃN MỚI KHI TẢI STATE
// State lưu trước khi đổi nhãn: board >26 hàng dùng id cũ (c112, b25).
// sanitizeState chuyển 1 lần nhờ cờ labelFormat; state mới đã có cờ
// thì không chuyển lại (id mới 'a12' trùng chữ với id cũ 'a12' nhưng
// nghĩa khác: hàng a cột 12 thay vì hàng a1 cột 2).
// ===========================================================================
// (o-a) migrateOldHoleId
{
  check('(o-a) migrateOldHoleId: "c112"->"c12", "b25"->"ab5", "a15"->"a5", "u499"->"cu99" (board 100 hàng)',
    migrateOldHoleId('c112', 100) === 'c12' && migrateOldHoleId('b25', 100) === 'ab5'
    && migrateOldHoleId('a15', 100) === 'a5' && migrateOldHoleId('u499', 100) === 'cu99', '');
  check('(o-a) migrateOldHoleId: board <=26 hàng giữ nguyên; rail/cọc nguồn giữ nguyên; id lạ giữ nguyên',
    migrateOldHoleId('c12', 10) === 'c12' && migrateOldHoleId('a12', 26) === 'a12'
    && migrateOldHoleId('T+40', 100) === 'T+40' && migrateOldHoleId('PSU1.+', 100) === 'PSU1.+'
    && migrateOldHoleId('z99', 100) === 'z99', '');
}
// (o-b) sanitizeState chuyển id cũ sang mới (neo linh kiện + 2 đầu dây)
{
  const old = {
    size: { cols: 42, rows: 100, rails: true },
    components: [
      { id: 'PIC1', type: 'pic', anchor: 'u212', rot: 0, fixed: true, props: {} },
      { id: 'LED0', type: 'led', anchor: 'c112', rot: 0, props: { color: '#DC2626' } },
    ],
    wires: [
      { id: 'W10', a: 'b25', b: 'T+5', color: '#2563EB' },
      { id: 'W11', a: 'PSU1.+', b: 'c112', color: '#DC2626' },
    ],
  };
  const st = sanitizeState(old);
  check('(o-b) sanitizeState chuyển id cũ sang mới: LED c112->c12, dây b25->ab5, PSU/rail giữ nguyên; state có cờ labelFormat',
    st.components.some((c) => c.id === 'LED0' && c.anchor === 'c12')
    && st.wires.some((w) => w.id === 'W10' && w.a === 'ab5' && w.b === 'T+5')
    && st.wires.some((w) => w.id === 'W11' && w.a === 'PSU1.+' && w.b === 'c12')
    && st.labelFormat === 'sheet', JSON.stringify(st));
}
// (o-c) Không chuyển lại state mới: 'a12' mới giữ nguyên qua 2 lần tải
{
  const rawNew = {
    size: { cols: 42, rows: 100, rails: true },
    labelFormat: 'sheet',
    components: [{ id: 'LED0', type: 'led', anchor: 'a12', rot: 0, props: { color: '#DC2626' } }],
    wires: [{ id: 'W10', a: 'a12', b: 'a13', color: '#2563EB' }],
  };
  const st1 = sanitizeState(rawNew);
  const st2 = sanitizeState(JSON.parse(JSON.stringify(st1)));
  check('(o-c) state mới (có cờ): "a12" giữ nguyên qua 2 lần tải, không bị chuyển thành "a2"',
    st1.components.some((c) => c.id === 'LED0' && c.anchor === 'a12')
    && st2.components.some((c) => c.id === 'LED0' && c.anchor === 'a12')
    && st2.wires.some((w) => w.id === 'W10' && w.a === 'a12' && w.b === 'a13'), JSON.stringify(st2));
}
// (o-d) defaultBenchState và pruneStateForSize giữ cờ labelFormat
{
  check('(o-d) defaultBenchState và pruneStateForSize giữ cờ labelFormat',
    defaultBenchState().labelFormat === 'sheet'
    && pruneStateForSize(defaultBenchState(830), { cols: 42, rows: 15, rails: true }).state.labelFormat === 'sheet', '');
}

// ===========================================================================
// (p) INSPECTOR MỤC "CHÂN": legsFor trả đúng chân + lỗ cho từng linh kiện
// (round 25/11): còi/LED/nút/điện trở/chiết áp/LCD/PIC. Hiển thị Inspector
// là DOM nên không test bằng Node — Điệp check bằng trình duyệt thật.
// ===========================================================================
{
  check('(p-a) còi ở c10: P->c10, N->c11; LED ở c10: A->c10, K->c11; nút ở c10: T1->c10, T2->c11',
    JSON.stringify(legsFor({ type: 'buzzer', anchor: 'c10', rot: 0 }, 830))
    === JSON.stringify([{ term: 'P', hole: 'c10' }, { term: 'N', hole: 'c11' }])
    && JSON.stringify(legsFor({ type: 'led', anchor: 'c10', rot: 0 }, 830))
    === JSON.stringify([{ term: 'A', hole: 'c10' }, { term: 'K', hole: 'c11' }])
    && JSON.stringify(legsFor({ type: 'button', anchor: 'c10', rot: 0 }, 830))
    === JSON.stringify([{ term: 'T1', hole: 'c10' }, { term: 'T2', hole: 'c11' }]), '');
  check('(p-a) điện trở ở c10: L1->c10, L2->c14; chiết áp ở c10: VCC->c10, W->c11, GND->c12',
    JSON.stringify(legsFor({ type: 'resistor', anchor: 'c10', rot: 0 }, 830))
    === JSON.stringify([{ term: 'L1', hole: 'c10' }, { term: 'L2', hole: 'c14' }])
    && JSON.stringify(legsFor({ type: 'pot', anchor: 'c10', rot: 0 }, 830))
    === JSON.stringify([{ term: 'VCC', hole: 'c10' }, { term: 'W', hole: 'c11' }, { term: 'GND', hole: 'c12' }]), '');
  check('(p-a) LCD ở c10: 10 chân RS/E/D0-D7 -> c10..c19',
    (() => {
      const legs = legsFor({ type: 'lcd', anchor: 'c10', rot: 0 }, 830);
      return legs.length === 10 && legs[0].term === 'RS' && legs[0].hole === 'c10'
        && legs[1].term === 'E' && legs[1].hole === 'c11' && legs[9].term === 'D7' && legs[9].hole === 'c19';
    })(), '');
  check('(p-b) PIC trên board 42x15: đủ 40 chân, chân 1 MCLR->e12, chân 21 RD2->k31, chân 40 RB7->k12',
    (() => {
      const legs = legsFor({ type: 'pic' }, { cols: 42, rows: 15, rails: true });
      return legs.length === 40 && legs.every((l) => l.term.startsWith('PIC.') && !!l.hole)
        && legs[0].term === 'PIC.MCLR' && legs[0].hole === 'e12'
        && legs[20].term === 'PIC.RD2' && legs[20].hole === 'k31'
        && legs[39].term === 'PIC.RB7' && legs[39].hole === 'k12';
    })(), '');
  check('(p-b) PIC trên board Mini 170: đủ 40 chân, đúng 6 chân treo ngoài board có hole null (MCLR, RD0-RD3, RB7)',
    (() => {
      const legs = legsFor({ type: 'pic' }, 170);
      const nulls = legs.filter((l) => !l.hole).map((l) => l.term);
      return legs.length === 40 && nulls.length === 6
        && JSON.stringify(nulls) === JSON.stringify(['PIC.MCLR', 'PIC.RD0', 'PIC.RD1', 'PIC.RD2', 'PIC.RD3', 'PIC.RB7']);
    })(), '');
  check('(p-c) PSU không có chân dạng lỗ: legsFor trả []',
    legsFor({ type: 'psu' }, 830).length === 0, '');
}

// ===========================================================================
// (q) TAB "BÀI LAB" + LAB 1 "ĐIỀU KHIỂN LED" (round 25/11): LED nối RB0
// qua điện trở 220Ω, cathode về GND. Mở tab Bài Lab, bấm Mở lab thì mạch
// lên bàn; sang tab code bấm Nạp & chạy thì LED nhấp nháy theo nhịp chip.
// Dây lab cắm vào lỗ kề cùng đoạn strip, không cắm trùng lỗ chân linh kiện (25/11).
// Hiển thị tab là DOM nên không test bằng Node — Điệp check bằng trình
// duyệt thật.
// ===========================================================================
// (q-a) Chỉ có đúng Lab 1, đủ dữ liệu: 1 điện trở 220Ω + 1 LED + 3 dây
{
  const lab = LABS[0];
  check('(q-a) LABS có đúng 3 lab: Lab 1 Điều khiển LED (LABS[0]) + Lab 2 Điều khiển LED + LCD (LABS[1]) + Lab 3 Đếm 00–99 (LABS[2])',
    LABS.length === 3 && lab.id === 'led-blink' && lab.title === 'Điều khiển LED' && lab.size === 830
    && LABS[1].id === 'led-lcd' && LABS[2].id === 'count-2x7seg' && getLab('led-blink') === lab && getLab('khong-co') === null, JSON.stringify(LABS.map((l) => l.id)));
  check('(q-a) Lab 1 có đúng 1 điện trở 220Ω (R0 @i45) + 1 LED đỏ (LED0 @i52) + thạch anh 4MHz (X0 @a34) + 2 tụ gốm 22pF (C0 @i10, C1 @i16)',
    lab.components.length === 5
    && lab.components[0].id === 'R0' && lab.components[0].type === 'resistor' && lab.components[0].anchor === 'i45' && lab.components[0].props.value === 220
    && lab.components[1].id === 'LED0' && lab.components[1].type === 'led' && lab.components[1].anchor === 'i52' && lab.components[1].props.color === '#DC2626'
    && lab.components[2].id === 'X0' && lab.components[2].type === 'crystal' && lab.components[2].anchor === 'a34' && lab.components[2].props.freq === 4000000
    && lab.components[3].id === 'C0' && lab.components[3].type === 'capacitor' && lab.components[3].anchor === 'i10' && lab.components[3].props.value === 22
    && lab.components[4].id === 'C1' && lab.components[4].type === 'capacitor' && lab.components[4].anchor === 'i16' && lab.components[4].props.value === 22, JSON.stringify(lab.components));
  check('(q-a) Lab 1 có đúng 7 dây: 3 dây LED (RB0->điện trở, điện trở->anode LED, cathode LED->GND) + 4 dây dao động (2 tụ về OSC1/OSC2 + 2 tụ về GND)',
    lab.wires.length === 7
    && lab.wires[0].a === 'i29' && lab.wires[0].b === 'j45'
    && lab.wires[1].a === 'j49' && lab.wires[1].b === 'j52'
    && lab.wires[2].a === 'j53' && lab.wires[2].b === 'B-50'
    && lab.wires[3].a === 'j14' && lab.wires[3].b === 'c34'
    && lab.wires[4].a === 'j10' && lab.wires[4].b === 'B-10'
    && lab.wires[5].a === 'j20' && lab.wires[5].b === 'c35'
    && lab.wires[6].a === 'j16' && lab.wires[6].b === 'B-16', JSON.stringify(lab.wires));
}
// (q-b) buildLabState cho ra state hợp lệ: chip + nguồn + dây nguồn + R0 + LED0 + 3 dây lab
{
  const r = buildLabState(LABS[0]);
  check('(q-b) buildLabState Lab 1 ok: PIC1 + PSU1 + R0 + LED0 + X0 + C0 + C1, dây W1-W7 + 7 dây lab',
    r.ok && r.state.components.map((c) => c.id).join(',') === 'PIC1,PSU1,R0,LED0,X0,C0,C1'
    && r.state.wires.map((w) => w.id).join(',') === 'W1,W2,W3,W4,W5,W6,W7,LAB1-W1,LAB1-W2,LAB1-W3,LAB1-W4,LAB1-W5,LAB1-W6,LAB1-W7',
    r.ok ? JSON.stringify({ comps: r.state.components.map((c) => c.id), wires: r.state.wires.map((w) => w.id) }) : r.reason);
  check('(q-b) đầu dây RB0 ở lỗ kề i29, cùng đoạn strip với chân RB0 (h29) nhưng không trùng lỗ chân',
    r.ok && stripKey(LABS[0].wires[0].a, 830) === stripKey(picLegs(830).find((l) => l.term === 'PIC.RB0').hole, 830)
    && LABS[0].wires[0].a !== picLegs(830).find((l) => l.term === 'PIC.RB0').hole, LABS[0].wires[0].a);
  check('(q-b) không đầu dây lab nào cắm trùng lỗ chân linh kiện (chip/R0/LED0)',
    r.ok && (() => {
      const legHoles = new Set(r.state.components.flatMap((c) => legsFor(c, 830).map((l) => l.hole).filter(Boolean)));
      return LABS[0].wires.every((w) => [w.a, w.b].every((e) => !parseHole(e, 830) || !legHoles.has(e)));
    })(), '');
  check('(q-b) state lab qua sanitizeState vẫn giữ nguyên R0/LED0/X0/C0/C1 + 7 dây lab',
    r.ok && (() => {
      const s2 = sanitizeState(JSON.parse(JSON.stringify(r.state)));
      return s2.components.some((c) => c.id === 'R0') && s2.components.some((c) => c.id === 'LED0')
        && s2.components.some((c) => c.id === 'X0') && s2.components.some((c) => c.id === 'C0') && s2.components.some((c) => c.id === 'C1')
        && s2.wires.filter((w) => w.id.startsWith('LAB1-')).length === 7;
    })(), '');
  check('(q-b) buildLabState từ chối lab hỏng: linh kiện đặt chồng chip / dây đầu sai',
    buildLabState({ ...LABS[0], components: [{ id: 'R0', type: 'resistor', anchor: 'b25', rot: 0, props: { value: 220 } }] }).ok === false
    && buildLabState({ ...LABS[0], wires: [{ id: 'X1', a: 'h29', b: 'zz99', color: '#DC2626' }] }).ok === false, '');
}
// (q-c) Mạch hợp lệ qua netlist: LED0 nối RB0 qua điện trở về GND, không cảnh báo thiếu điện trở
{
  const { state } = buildLabState(LABS[0]);
  const nl = benchToNetlist(state);
  const mapping = resolvePeripherals(nl);
  const led = mapping.leds.find((l) => l.id === 'LED0');
  check('(q-c) LED0 nối đúng: anode là chân RB0 (pin 33), cathode về GND, có điện trở nối tiếp',
    led && led.pin && led.pin.id === 'RB0' && led.pin.num === 33 && led.gnd === true && led.hasResistor === true,
    JSON.stringify(led));
  const warns = checkWiring(nl, null);
  check('(q-c) checkWiring không cảnh báo gì cho mạch lab (kể cả "LED không có điện trở")',
    warns.length === 0, JSON.stringify(warns.map((w) => w.message)));
}
// (q-d) LED sáng khi RB0 mức cao, tắt khi RB0 mức thấp (CPU lái trực tiếp)
{
  const { state } = buildLabState(LABS[0]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.writeFile(0x03, 0x20); // bank1: RP0=1
  cpu.writeFile(0x06, 0x00); // TRISB = 0 (ngõ ra)
  cpu.writeFile(0x03, 0x00); // về bank0
  cpu.writeFile(0x06, 0x01); // PORTB = 0x01 -> RB0=1
  check('(q-d) RB0=1 (ngõ ra): LED0 SÁNG',
    ledStates(cpu, mapping).find((s) => s.id === 'LED0').on === true, '');
  cpu.writeFile(0x06, 0x00); // PORTB = 0x00 -> RB0=0
  check('(q-d) RB0=0 (ngõ ra): LED0 TẮT',
    ledStates(cpu, mapping).find((s) => s.id === 'LED0').on === false, '');
}
// (q-e) Chạy chương trình blink mẫu: LED nhấp nháy theo nhịp RB0
{
  const { state } = buildLabState(LABS[0]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const r = assemble(EXAMPLES.find((e) => e.id === 'blink').code);
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.loadProgram(r.program);
  runUntil(cpu, 100000);
  const onHigh = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  runUntil(cpu, 300000);
  const onLow = ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(q-e) chương trình blink: sau 100k chu kỳ (RB0=1) LED SÁNG, sau 300k chu kỳ (RB0=0) LED TẮT',
    r.errors.length === 0 && onHigh === true && onLow === false, `onHigh=${onHigh} onLow=${onLow} PORTB=${cpu.readPort(1).toString(16)}`);
}

// (r) Thu nhỏ khối nguồn 50% (Điệp lệnh 25/11: "cho cục nguồn bé đi 50%")
{
  const st = defaultBenchState();
  check('(r-a) PSU_SCALE = 0.5; offset cọc bằng một nửa giá trị cũ (DX 6, Y 14, DZ 21)',
    PSU_SCALE === 0.5 && PSU_POST_DX === 6 && PSU_POST_Y === 14 && PSU_POST_DZ === 21,
    `PSU_SCALE=${PSU_SCALE} DX=${PSU_POST_DX} Y=${PSU_POST_Y} DZ=${PSU_POST_DZ}`);
  check('(r-b) vị trí cọc PSU1 sau khi thu nhỏ: + ở (-6, 14, -129), − ở (6, 14, -129)',
    (() => { const p = psuPostPos(st, 'PSU1.+'); return p && p.x === -6 && p.y === 14 && p.z === -129; })()
    && (() => { const p = psuPostPos(st, 'PSU1.-'); return p && p.x === 6 && p.y === 14 && p.z === -129; })()
    && psuPostPos(st, 'PSU9.+') === null, '');
  check('(r-c) dây mặc định W6/W7 nối đúng cọc mới: psuPostPos(W6.a) = cọc +, psuPostPos(W7.a) = cọc -',
    (() => { const p = psuPostPos(st, st.wires.find((w) => w.id === 'W6').a); return p && p.x === -6 && p.y === 14 && p.z === -129; })()
    && (() => { const p = psuPostPos(st, st.wires.find((w) => w.id === 'W7').a); return p && p.x === 6 && p.y === 14 && p.z === -129; })(), '');
  check('(r-d) normalizeWireEnd: đầu dây ở vị trí cọc MỚI và CŨ đều đổi đúng thành id cọc; điểm lạ giữ nguyên',
    normalizeWireEnd(st, { x: -6, y: 14, z: -129 }) === 'PSU1.+'
    && normalizeWireEnd(st, { x: 6, y: 14, z: -129 }) === 'PSU1.-'
    && normalizeWireEnd(st, { x: -12, y: 28, z: -108 }) === 'PSU1.+'
    && normalizeWireEnd(st, { x: 12, y: 28, z: -108 }) === 'PSU1.-'
    && JSON.stringify(normalizeWireEnd(st, { x: 0, y: 14, z: -129 })) === JSON.stringify({ x: 0, y: 14, z: -129 }), '');
}

// ===========================================================================
// (t) KHE HỞ VẬT LÝ GIỮA CÁC ĐOẠN 5 HÀNG (Điệp lệnh 25/11: "các hàng 5 ô
// cách xa nhau xa ra. ví dụ hàng e và f cách xa nhau ra"): thêm 1 PITCH
// (2.54mm) ở mỗi ranh giới đoạn, hàng e–f thành 5.08mm (gấp đôi hàng
// thường), hàng trong cùng đoạn vẫn cách nhau đúng 1 PITCH.
// ===========================================================================
// (t-a) rowZ: khe hở đúng 1 PITCH ở mỗi ranh giới, hàng trong đoạn đúng 1 PITCH
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('(t-a) SEGMENT_GAP_MM = PITCH (2.54mm); rowZ(4,10) = -2.54, rowZ(5,10) = +2.54 (đối xứng qua tâm)',
    SEGMENT_GAP_MM === PITCH && near(rowZ(4, 10), -2.54) && near(rowZ(5, 10), 2.54)
    && near(rowZ(0, 10), -rowZ(9, 10)), `rowZ4=${rowZ(4, 10)} rowZ5=${rowZ(5, 10)}`);
  check('(t-a) hàng e–f cách nhau 2×PITCH = 5.08mm; hàng a–b và f–g cách nhau đúng 1×PITCH = 2.54mm',
    near(rowZ(5, 10) - rowZ(4, 10), 2 * PITCH)
    && near(rowZ(1, 10) - rowZ(0, 10), PITCH)
    && near(rowZ(6, 10) - rowZ(5, 10), PITCH), '');
  check('(t-a) board 100 hàng: 19 ranh giới, hàng cuối cv (99) đối xứng hàng đầu a; khe j–k cũng 5.08mm',
    near(rowZ(0, 100), -rowZ(99, 100))
    && near(rowZ(10, 100) - rowZ(9, 100), 2 * PITCH)
    && near(rowZ(11, 100) - rowZ(10, 100), PITCH), '');
}
// (t-b) bodyDepth tăng đúng số khe hở so với công thức cũ
{
  const near = (a, b) => Math.abs(a - b) < 0.01;
  check('(t-b) bodyDepth 830 = 49.56mm (47.02 cũ + đúng 1 khe hở 2.54); 20x25 = 95.28 (85.12 + 4 khe hở); 20x5 = 34.32 (0 khe hở, không đổi)',
    near(bodyDepth(830), 49.56)
    && near(bodyDepth({ cols: 20, rows: 25, rails: false }), 95.28)
    && near(bodyDepth({ cols: 20, rows: 5, rails: false }), 34.32), '');
}
// (t-c) picBodyDepth khớp hiệu tọa độ Z thật của 2 hàng chân
{
  const near = (a, b) => Math.abs(a - b) < 0.01;
  check('(t-c) picBodyDepth 830 = 20.78mm = (rowZ(7,10) − rowZ(1,10)) + 3 (17.78 + 3)',
    near(picBodyDepth(830), 20.78) && near(picBodyDepth(830), (rowZ(7, 10) - rowZ(1, 10)) + 3), '');
  check('(t-c) picBodyDepthForRows(1,7,10) = 20.78mm; chip neo ở hàng e trên board 60 hàng (chân 4–10, qua 2 ranh giới) -> 23.32mm',
    near(picBodyDepthForRows(1, 7, 10), 20.78) && near(picBodyDepthForRows(4, 10, 60), 23.32), '');
}
// (t-d) Lab 1 vẫn đúng netlist sau khi thêm khe hở (vị trí lỗ đổi mm nhưng
// strip/logic không đổi): LED0 = RB0, về GND, có điện trở, 0 cảnh báo, RB0=1 thì LED SÁNG
{
  const { state } = buildLabState(LABS[0]);
  const nl = benchToNetlist(state);
  const mapping = resolvePeripherals(nl);
  const led = mapping.leds.find((l) => l.id === 'LED0');
  check('(t-d) Lab 1 sau khe hở: LED0 nối RB0, về GND, có điện trở 220Ω, checkWiring 0 cảnh báo',
    led && led.pin && led.pin.id === 'RB0' && led.gnd === true && led.hasResistor === true
    && checkWiring(nl, null).length === 0, JSON.stringify({ pin: led && led.pin && led.pin.id, gnd: led && led.gnd, hasResistor: led && led.hasResistor }));
  check('(t-d) Lab 1 sau khe hở: RB0=1 thì LED SÁNG',
    (() => {
      const cpu = createCPU();
      cpu.setWiring(mapping);
      cpu.writeFile(0x03, 0x20);
      cpu.writeFile(0x06, 0x00);
      cpu.writeFile(0x03, 0x00);
      cpu.writeFile(0x06, 0x01);
      return ledStates(cpu, mapping).find((s) => s.id === 'LED0').on === true;
    })(), '');
}
// (t-e) holePos + allHoles theo tọa độ hàng mới (kể cả rail)
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('(t-e) holePos: f1–e1 = 5.08mm, g1–f1 = 2.54mm; rail T+1 ở z = -17.78, B−1 ở z = +17.78',
    near(holePos('f1').z - holePos('e1').z, 5.08)
    && near(holePos('g1').z - holePos('f1').z, 2.54)
    && near(holePos('T+1').z, -17.78) && near(holePos('B-1').z, 17.78), '');
  check('(t-e) allHoles: mọi lỗ có z khớp holePos (kể cả rail và hàng sau ranh giới)',
    (() => {
      const holes = allHoles(830);
      return holes.length === holeCount(830) && holes.every((h) => {
        const p = holePos(h.id, 830);
        return p && Math.abs(p.x - h.x) < 1e-9 && Math.abs(p.z - h.z) < 1e-9;
      });
    })(), '');
}
// (t-f) Nghịch đảo hàng bằng rowZ gần nhất (logic pickHole trong bench.js):
// mọi hàng + rail trên board 10 hàng và 60 hàng đều tìm lại đúng
{
  const okFor = (size) => {
    const rows = boardSize(size).rows;
    const candRows = [-2, -1, ...Array.from({ length: rows }, (_, i) => i), rows, rows + 1];
    return candRows.every((r) => {
      const z = rowZ(r, rows);
      let best = null, bestD = 1e9;
      for (const c of candRows) { const d = Math.abs(rowZ(c, rows) - z); if (d < bestD) { bestD = d; best = c; } }
      return best === r;
    });
  };
  check('(t-f) nghịch đảo hàng bằng rowZ gần nhất đúng cho mọi hàng + rail trên board 830 và board 60 hàng',
    okFor(830) && okFor({ cols: 63, rows: 60, rails: true }), '');
}

// Nhóm (u): cyclesForElapsedMs — đổi thời gian thực (ms) ra chu kỳ lệnh mô phỏng
// (4MHz: 1ms = 1000 chu kỳ). Runner dùng hàm này để chạy bù khi hẹn giờ trình
// duyệt chậm hơn 50ms, thay vì mặc định mỗi lần là 50ms (lỗi làm ON 3s hiện ~8s).
{
  check('(u-a) 50ms @4MHz = 50000 chu kỳ; 150ms (hẹn giờ chậm) = 150000 chu kỳ',
    cyclesForElapsedMs(50) === 50000 && cyclesForElapsedMs(150) === 150000, '');
  check('(u-b) 1ms = 1000 chu kỳ; 1000ms = 1000000 chu kỳ (chưa chặn)',
    cyclesForElapsedMs(1) === 1000 && cyclesForElapsedMs(1000, 4000000, 2000000) === 1000000, '');
  check('(u-c) chặn trên mặc định 500000 chu kỳ khi tab bị ẩn lâu (2000ms -> 500000, không chạy bù vô hạn)',
    cyclesForElapsedMs(2000) === 500000, '');
  check('(u-d) elapsedMs âm hoặc 0 -> 0 chu kỳ (không chạy lùi)',
    cyclesForElapsedMs(0) === 0 && cyclesForElapsedMs(-10) === 0, '');
  check('(u-e) clockHz khác: 8MHz thì 50ms = 100000 chu kỳ (gấp đôi 4MHz)',
    cyclesForElapsedMs(50, 8000000) === 100000, '');
}

// Nhóm (v): đồng hồ đo (multimeter, chế độ V/A) — solver MNA (circuit-solver.js).
// Điện áp/dòng kỳ vọng tính theo mô hình: LED sáng = sụt 2V nối tiếp 10Ω,
// chân PIC output cao = 5V / thấp = 0V, PSU = điện áp nguồn.
// Lab 1 (RB0=1): dòng = (5−2)/(220+10) ≈ 13.04mA, áp trên R ≈ 2.87V,
// áp trên LED ≈ 2.13V (nằm trong dung sai nhiệm vụ: R 3V±0.2, LED 2V±0.2,
// dòng 13.6mA±1mA).
{
  // Đặt RB0 làm output, mức cao/thấp (như test (s-c): STATUS/TRISB/PORTB).
  const setRB0 = (cpu, high) => {
    cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0x00);
    cpu.writeFile(0x03, 0x00); cpu.writeFile(0x06, high ? 0x01 : 0x00);
  };
  // Lab 1 + đồng hồ đo chế độ A nối tiếp (bỏ dây LAB1-W2, MM neo g48,
  // dây j49->j48). Đặt MM ở cột 48–52 (ngoài vùng chip 22–41) để chân
  // MM không rơi vào strip có chân PIC (đặt ở i29 thì chân i33 cùng
  // strip với RD6).
  const lab1WithMeterA = () => {
    const { state } = buildLabState(LABS[0]);
    state.wires = state.wires.filter((w) => w.id !== 'LAB1-W2');
    state.components.push({ id: 'MM0', type: 'multimeter', anchor: 'g48', rot: 0, props: { mode: 'A' } });
    state.wires.push({ id: 'T-AM', a: 'j49', b: 'j48', color: '#DC2626' });
    return state;
  };
  const approx = (v, target, tol) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v - target) <= tol;

  // (v-a) Đồng hồ đo: chân P/N, đặt được, id/nhãn, mode mặc định V.
  check('(v-a) đồng hồ đo chân P=a10, N=a14; đặt được, id MM0, nhãn "Đồng hồ đo 0", mode mặc định V',
    JSON.stringify(legsFor({ type: 'multimeter', anchor: 'a10', rot: 0 }, 830)) === JSON.stringify([{ term: 'P', hole: 'a10' }, { term: 'N', hole: 'a14' }])
    && canPlace(defaultBenchState(830), 'multimeter', 'a10').ok
    && nextComponentId(defaultBenchState(830), 'multimeter') === 'MM0'
    && compLabel({ id: 'MM0', type: 'multimeter' }) === 'Đồng hồ đo 0'
    && meterMode({ type: 'multimeter', props: {} }) === 'V'
    && meterMode({ type: 'multimeter', props: { mode: 'A' } }) === 'A'
    && meterMode({ type: 'multimeter', props: { mode: 'X' } }) === 'V', '');
  // (v-a2) Đồng hồ đo chế độ A nối 2 strip như dây trong netlist bench
  // (LED sáng qua nó được); chế độ V không nối strip nào (không ảnh
  // hưởng mạch).
  check('(v-a2) đồng hồ chế độ A nối 2 strip như dây (2 LED ở 2 strip thành cùng net qua MM); chế độ V không nối strip (2 LED vẫn tách net)',
    (() => {
      const withA = defaultBenchState(830);
      withA.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'A' } });
      withA.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      withA.components.push({ id: 'LED1', type: 'led', anchor: 'c14', rot: 0, props: { color: '#DC2626' } });
      const nA = buildBenchNets(withA);
      const withV = defaultBenchState(830);
      withV.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      withV.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      withV.components.push({ id: 'LED1', type: 'led', anchor: 'c14', rot: 0, props: { color: '#DC2626' } });
      const nV = buildBenchNets(withV);
      return nA.termRoot.get('LED0.A') === nA.termRoot.get('LED1.A')
        && nV.termRoot.get('LED0.A') !== nV.termRoot.get('LED1.A')
        && !nV.termRoot.has('MM0.P');
    })(), '');
  // (v-b) Đồng hồ đo chế độ V qua PSU +/− đọc đúng 5V.
  check('(v-b) đồng hồ đo chế độ V qua PSU +/− (dây b10->T+10, b14->T-10) đọc đúng 5V',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-V1', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-V2', a: 'b14', b: 'T-10', color: '#0F172A' });
      const r = meterReadings(st, createCPU());
      return r.voltmeters.length === 1 && r.voltmeters[0].volts === 5;
    })(), '');
  // (v-c) Đồng hồ đo chế độ V trên Lab 1: qua R ≈ 3V (±0.2), qua LED ≈ 2V (±0.2).
  check('(v-c) đồng hồ đo chế độ V Lab 1 qua điện trở (neo g45) ≈ 3V (±0.2V)',
    (() => {
      const { state } = buildLabState(LABS[0]);
      state.components.push({ id: 'MM0', type: 'multimeter', anchor: 'g45', rot: 0, props: { mode: 'V' } });
      const cpu = createCPU(); setRB0(cpu, true);
      const v = meterReadings(state, cpu).voltmeters[0].volts;
      return approx(v, 3, 0.2);
    })(), '');
  check('(v-c) đồng hồ đo chế độ V Lab 1 qua LED (neo g52 + dây j56->j53) ≈ 2V (±0.2V)',
    (() => {
      const { state } = buildLabState(LABS[0]);
      state.components.push({ id: 'MM0', type: 'multimeter', anchor: 'g52', rot: 0, props: { mode: 'V' } });
      state.wires.push({ id: 'T-V3', a: 'j56', b: 'j53', color: '#DC2626' });
      const cpu = createCPU(); setRB0(cpu, true);
      const v = meterReadings(state, cpu).voltmeters[0].volts;
      return approx(v, 2, 0.2);
    })(), '');
  // (v-d) Đồng hồ đo chế độ V 1 chân floating -> null; 2 chân cùng 1 net -> 0V.
  check('(v-d) đồng hồ đo chế độ V 1 chân floating (chỉ nối P về T+) -> null',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-V4', a: 'b10', b: 'T+10', color: '#DC2626' });
      return meterReadings(st, createCPU()).voltmeters[0].volts === null;
    })(), '');
  check('(v-d) đồng hồ đo chế độ V 2 chân cùng 1 net (cả 2 về RAIL+) -> 0V',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-V5', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-V6', a: 'b14', b: 'T+14', color: '#DC2626' });
      return meterReadings(st, createCPU()).voltmeters[0].volts === 0;
    })(), '');
  // (v-e) Đồng hồ đo chế độ A nối tiếp R 220Ω + LED (Lab 1) ≈ 13.6mA (±1mA) khi RB0=1.
  check('(v-e) đồng hồ đo chế độ A nối tiếp Lab 1, RB0=1: ≈ 13.6mA (±1mA)',
    (() => {
      const cpu = createCPU(); setRB0(cpu, true);
      const a = meterReadings(lab1WithMeterA(), cpu).ammeters[0].amps;
      return approx(a, 0.0136, 0.001);
    })(), '');
  // (v-f) Đồng hồ đo chế độ A theo chân PIC: RB0=0 thì dòng 0 (LED tắt = hở mạch).
  check('(v-f) đồng hồ đo chế độ A nối tiếp Lab 1, RB0=0: dòng 0 (LED tắt, hở mạch)',
    (() => {
      const cpu = createCPU(); setRB0(cpu, false);
      return meterReadings(lab1WithMeterA(), cpu).ammeters[0].amps === 0;
    })(), '');
  check('(v-f) RB0=0: đồng hồ đo chế độ V qua LED Lab 1 đọc 0V (anode qua R về chân 0V, cathode GND)',
    (() => {
      const { state } = buildLabState(LABS[0]);
      state.components.push({ id: 'MM0', type: 'multimeter', anchor: 'g52', rot: 0, props: { mode: 'V' } });
      state.wires.push({ id: 'T-V7', a: 'j56', b: 'j53', color: '#DC2626' });
      const cpu = createCPU(); setRB0(cpu, false);
      return meterReadings(state, cpu).voltmeters[0].volts === 0;
    })(), '');
  // (v-g) Đồng hồ đo chế độ A nối tiếp chỉ R 1kΩ với PSU 5V: I = 5/1000 = 5mA.
  check('(v-g) đồng hồ đo chế độ A + R 1kΩ + PSU 5V (T+ -> R -> AM -> T-): đúng 5mA',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 1000 } });
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'A' } });
      st.wires.push({ id: 'T-A1', a: 'b20', b: 'T+20', color: '#DC2626' });
      st.wires.push({ id: 'T-A2', a: 'b24', b: 'b30', color: '#DC2626' });
      st.wires.push({ id: 'T-A3', a: 'b34', b: 'T-34', color: '#0F172A' });
      const a = meterReadings(st, createCPU()).ammeters[0].amps;
      return approx(a, 0.005, 0.0002);
    })(), '');
  // (v-h) Đồng hồ đo chế độ A hở mạch = 0; đồng hồ đo chế độ V đổi điện áp PSU (12V) đọc đúng 12V.
  check('(v-h) đồng hồ đo chế độ A hở mạch (không nối gì) = 0',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'A' } });
      return meterReadings(st, createCPU()).ammeters[0].amps === 0;
    })(), '');
  check('(v-h) PSU 12V: đồng hồ đo chế độ V qua PSU đọc 12V; đồng hồ đo chế độ A + R 1kΩ đọc 12mA',
    (() => {
      const st = defaultBenchState(830);
      st.components.find((c) => c.type === 'psu').props.volts = 12;
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-V8', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-V9', a: 'b14', b: 'T-10', color: '#0F172A' });
      st.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 1000 } });
      st.components.push({ id: 'MM1', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'A' } });
      st.wires.push({ id: 'T-A4', a: 'b20', b: 'T+20', color: '#DC2626' });
      st.wires.push({ id: 'T-A5', a: 'b24', b: 'b30', color: '#DC2626' });
      st.wires.push({ id: 'T-A6', a: 'b34', b: 'T-34', color: '#0F172A' });
      const r = meterReadings(st, createCPU());
      return r.voltmeters[0].volts === 12 && approx(r.ammeters[0].amps, 0.012, 0.0002);
    })(), '');
  // (v-i) solveLinear: hệ 2x2 đúng; ma trận suy biến -> null; solveCircuit
  // không nguồn áp nào (chỉ điện trở rời) -> ok nhưng mọi node floating.
  check('(v-i) solveLinear: hệ [2 1; 1 3]·x = [5; 10] -> x = [1; 3]; ma trận suy biến -> null',
    (() => {
      const x = solveLinear([[2, 1], [1, 3]], [5, 10]);
      return x && Math.abs(x[0] - 1) < 1e-9 && Math.abs(x[1] - 3) < 1e-9
        && solveLinear([[1, 1], [1, 1]], [2, 2]) === null
        && JSON.stringify(solveLinear([], [])) === '[]';
    })(), '');
  check('(v-i) điện trở + đồng hồ đo chế độ A rời (không nối nguồn nào): solve ok, node của chúng floating, dòng 0',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 1000 } });
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'A' } });
      const { ok, nodeVoltage, branchCurrent, nets } = solveCircuit(st, createCPU());
      return ok === true
        && nodeVoltage.get(nets.nodeOfTerm('R1', 'L1')) === null
        && nodeVoltage.get(nets.nodeOfTerm('MM0', 'P')) === null
        && branchCurrent.get('R1') === 0
        && branchCurrent.get('MM0') === 0;
    })(), '');
  // (v-j) Hằng số mô hình LED/PIC đúng như nhiệm vụ.
  check('(v-j) LED_FORWARD_VOLTS = 2.0, LED_SERIES_OHMS = 10, PIC_OUTPUT_VOLTS = 5',
    LED_FORWARD_VOLTS === 2.0 && LED_SERIES_OHMS === 10 && PIC_OUTPUT_VOLTS === 5, '');
  // (v-k) Chiết áp là nguồn áp trong solver: đồng hồ đo chế độ V đọc được
  // điện áp wiper (pct/100 × 5V). Trước fix này chiết áp chỉ cấp cho ADC
  // (qua setPot) nên net W lơ lửng, đồng hồ hiện trống dù nối W + GND đúng.
  const potWithMeter = (pct) => {
    const st = defaultBenchState(830);
    st.components.push({ id: 'POT0', type: 'pot', anchor: 'a10', rot: 0, props: { pct } });
    st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a20', rot: 0, props: { mode: 'V' } });
    st.wires.push({ id: 'T-P1', a: 'b10', b: 'T+10', color: '#DC2626' }); // VCC chiết áp -> +5V
    st.wires.push({ id: 'T-P2', a: 'b12', b: 'T-10', color: '#0F172A' }); // GND chiết áp -> GND
    st.wires.push({ id: 'T-P3', a: 'b11', b: 'b20', color: '#2563EB' }); // W -> chân P đồng hồ
    st.wires.push({ id: 'T-P4', a: 'b24', b: 'T-10', color: '#0F172A' }); // chân N đồng hồ -> GND
    return st;
  };
  check('(v-k) chiết áp pct=83 + đồng hồ đo chế độ V (P->W, N->GND) đọc ≈ 4.15V',
    (() => {
      const v = meterReadings(potWithMeter(83), createCPU()).voltmeters[0].volts;
      return approx(v, 4.15, 0.01);
    })(), '');
  check('(v-k) chiết áp pct=0 đọc 0V; pct=100 đọc 5V',
    (() => {
      const v0 = meterReadings(potWithMeter(0), createCPU()).voltmeters[0].volts;
      const v100 = meterReadings(potWithMeter(100), createCPU()).voltmeters[0].volts;
      return v0 === 0 && v100 === 5;
    })(), '');
}

// Nhóm (w): định dạng số đo cho màn hình 3D + Inspector (giai đoạn 2),
// và điện áp từng chân đồng hồ đo chế độ V (vP/vN) trong meterReadings.
{
  check('(w-a) formatVolts: null -> "—", 5 -> "5.00 V", 0 -> "0.00 V", -2.5 -> "-2.50 V", Infinity -> "OL"',
    formatVolts(null) === '—' && formatVolts(5) === '5.00 V' && formatVolts(0) === '0.00 V'
    && formatVolts(-2.5) === '-2.50 V' && formatVolts(Infinity) === 'OL', '');
  check('(w-b) formatAmps: 0.01304 -> "13.0 mA", 0 -> "0.0 mA", 1.2 -> "1.20 A", 1 -> "1.00 A", -0.5 -> "-500.0 mA", Infinity -> "OL", null -> "—"',
    formatAmps(0.01304) === '13.0 mA' && formatAmps(0) === '0.0 mA' && formatAmps(1.2) === '1.20 A'
    && formatAmps(1) === '1.00 A' && formatAmps(-0.5) === '-500.0 mA'
    && formatAmps(Infinity) === 'OL' && formatAmps(null) === '—', '');
  check('(w-c) formatCurrentDirection: 0.013 -> "P → N", -0.013 -> "N → P", 0 -> "Không có dòng", Infinity -> "OL", null -> "—"',
    formatCurrentDirection(0.013) === 'P → N' && formatCurrentDirection(-0.013) === 'N → P'
    && formatCurrentDirection(0) === 'Không có dòng' && formatCurrentDirection(Infinity) === 'OL'
    && formatCurrentDirection(null) === '—', '');
  check('(w-d) meterReadings đồng hồ đo chế độ V qua PSU: vP = 5, vN = 0, volts = 5',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-W1', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-W2', a: 'b14', b: 'T-10', color: '#0F172A' });
      const r = meterReadings(st, createCPU()).voltmeters[0];
      return r.volts === 5 && r.vP === 5 && r.vN === 0;
    })(), '');
  check('(w-e) meterReadings đồng hồ đo chế độ V Lab 1 qua R (RB0=1): vP ≈ 5V, vN ≈ 2.13V, volts ≈ 2.87V',
    (() => {
      const { state } = buildLabState(LABS[0]);
      state.components.push({ id: 'MM0', type: 'multimeter', anchor: 'g45', rot: 0, props: { mode: 'V' } });
      const cpu = createCPU();
      cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0x00);
      cpu.writeFile(0x03, 0x00); cpu.writeFile(0x06, 0x01);
      const r = meterReadings(state, cpu).voltmeters[0];
      const approx = (v, t, tol) => typeof v === 'number' && Math.abs(v - t) <= tol;
      return approx(r.vP, 5, 0.05) && approx(r.vN, 2.13, 0.2) && approx(r.volts, 2.87, 0.2);
    })(), '');
  check('(w-f) meterReadings đồng hồ đo chế độ V 1 chân floating: vP = 5, vN = null, volts = null',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-W3', a: 'b10', b: 'T+10', color: '#DC2626' });
      const r = meterReadings(st, createCPU()).voltmeters[0];
      return r.vP === 5 && r.vN === null && r.volts === null;
    })(), '');
  check('(w-g) đồng hồ đo chế độ A đấu tắt trực tiếp qua PSU: dòng Infinity (hiển thị OL), đồng hồ đo chế độ V qua PSU cùng lúc vẫn đọc 5V (PSU không bị loại)',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'A' } });
      st.components.push({ id: 'MM1', type: 'multimeter', anchor: 'a20', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-W4', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-W5', a: 'b14', b: 'T-10', color: '#0F172A' });
      st.wires.push({ id: 'T-W6', a: 'b20', b: 'T+20', color: '#DC2626' });
      st.wires.push({ id: 'T-W7', a: 'b24', b: 'T-20', color: '#0F172A' });
      const r = meterReadings(st, createCPU());
      return r.ammeters[0].amps === Infinity && formatAmps(r.ammeters[0].amps) === 'OL'
        && r.voltmeters[0].volts === 5 && r.voltmeters[0].vP === 5 && r.voltmeters[0].vN === 0;
    })(), '');
}

// Nhóm (x): audit toàn diện 25/11 (Điệp: "lần nào chạy cũng thiếu") — tên bit
// còn thiếu, dạng số MPLAB, directive, $, EEPROM, PWM, TMR1CS, SLEEP/ADC.
// (x-a) Tên bit mới: PSPIF/PSPIE, PIR2/PIE2, CMCON, CVRCON, EECON1, PCON,
// TRISE, CSRC, SSPCON2, alias DONE/NOT_DONE — dịch được và mã hoá đúng số bit.
{
  const r = assemble(`
    BSF PIR1,PSPIF
    BSF PIE1,PSPIE
    BSF PIR2,CCP2IF
    BSF PIR2,BCLIF
    BSF PIR2,EEIF
    BSF PIR2,CMIF
    BSF PIE2,BCLIE
    BSF PIE2,EEIE
    BSF PIE2,CMIE
    BSF CMCON,CM0
    BSF CMCON,C2OUT
    BSF CVRCON,CVR3
    BSF CVRCON,CVREN
    BSF EECON1,RD
    BSF EECON1,WR
    BSF EECON1,WREN
    BSF EECON1,WRERR
    BSF EECON1,EEPGD
    BSF PCON,NOT_BOR
    BSF PCON,NOT_POR
    BSF TRISE,PSPMODE
    BSF TRISE,IBF
    BSF TXSTA,CSRC
    BSF SSPCON2,SEN
    BSF SSPCON2,GCEN
    BSF ADCON0,DONE
    BCF ADCON0,NOT_DONE
  `);
  check('(x-a) tên bit mới dịch được, 0 lỗi', r.errors.length === 0, JSON.stringify(r.errors));
  check('(x-a) BSF PIR1,PSPIF mã hoá đúng (bit7, PIR1=0x0c)', r.program[0] === (0x1400 | (7 << 7) | 0x0c), '0x' + r.program[0].toString(16));
  check('(x-a) BSF PIR2,EEIF mã hoá đúng (bit4, PIR2=0x0d)', r.program[4] === (0x1400 | (4 << 7) | 0x0d), '0x' + r.program[4].toString(16));
  check('(x-a) BSF EECON1,RD mã hoá đúng (bit0, bank2: 0x0e)', r.program[13] === (0x1400 | (0 << 7) | 0x0e), '0x' + r.program[13].toString(16));
  check('(x-a) BSF CMCON,C2OUT mã hoá đúng (bit7, bank1: 0x1c)', r.program[10] === (0x1400 | (7 << 7) | 0x1c), '0x' + r.program[10].toString(16));
  check('(x-a) BSF SSPCON2,GCEN mã hoá đúng (bit7, bank1: 0x11)', r.program[24] === (0x1400 | (7 << 7) | 0x11), '0x' + r.program[24].toString(16));
}

// (x-b) Dạng số MPLAB: .100, 0XFF, $AB, 0B1010, O'777', số âm, 'A',
// HIGH/LOW, label+1/label-2, $ (địa chỉ hiện tại).
{
  const r = assemble(`
    MOVLW .100
    MOVLW 0XFF
    MOVLW $AB
    MOVLW 0B1010
    MOVLW O'777'
    MOVLW -1
    MOVLW 'A'
    MOVLW HIGH TABLE
    MOVLW LOW TABLE
    MOVLW TABLE+1
    MOVLW TABLE-2
    GOTO TABLE
TABLE
    RETLW 0
  `);
  check('(x-b) các dạng số mới dịch được, 0 lỗi', r.errors.length === 0, JSON.stringify(r.errors));
  check("(x-b) .100=100, 0XFF=255, $AB=171, 0B1010=10, O'777'->0xFF, -1->0xFF, 'A'=65",
    r.program[0] === (0x3000 | 100) && r.program[1] === (0x3000 | 255) && r.program[2] === (0x3000 | 0xab)
    && r.program[3] === (0x3000 | 10) && r.program[4] === (0x3000 | 0xff) && r.program[5] === (0x3000 | 0xff)
    && r.program[6] === (0x3000 | 65), '');
  check('(x-b) HIGH/LOW TABLE (TABLE=12): HIGH=0, LOW=12', r.program[7] === 0x3000 && r.program[8] === (0x3000 | 12), '');
  check('(x-b) TABLE+1=13, TABLE-2=10', r.program[9] === (0x3000 | 13) && r.program[10] === (0x3000 | 10), '');
  const rd = assemble(`
    ORG 0
    NOP
LOOP
    GOTO $
    GOTO $-1
  `);
  check('(x-b) $ = địa chỉ hiện tại: GOTO $ (ở 1) -> 0x2800|1, GOTO $-1 (ở 2) -> 0x2800|1',
    rd.errors.length === 0 && rd.program[1] === (0x2800 | 1) && rd.program[2] === (0x2800 | 1), JSON.stringify(rd.errors));
}

// (x-c) Directive mới: #define/#undef, VARIABLE/CONSTANT, RADIX, RES, FILL,
// DA, DB với nhãn, PAGESEL; bỏ qua PROCESSOR/ERRORLEVEL/TITLE; lỗi rõ cho
// MACRO/IF/WHILE/DE/ORG 0x2100.
{
  const r = assemble(`
    #define LED_COUNT 5
    #define LED_PORT PORTB
    PROCESSOR 16F877A
    ERRORLEVEL -302
    TITLE "Test"
    MOVLW LED_COUNT
    MOVWF LED_PORT
    COUNT VARIABLE 0x30
    MAX CONSTANT 100
    MOVLW MAX
    RADIX HEX
    MOVLW 10
    RADIX DEC
    MOVLW 10
  `);
  check('(x-c) #define/VARIABLE/CONSTANT/RADIX/PROCESSOR/ERRORLEVEL/TITLE dịch được', r.errors.length === 0, JSON.stringify(r.errors));
  check('(x-c) #define thay text: MOVLW LED_COUNT=5, MOVWF LED_PORT=MOVWF PORTB',
    r.program[0] === (0x3000 | 5) && r.program[1] === (0x0080 | 0x06), '');
  check('(x-c) CONSTANT 100 dùng được', r.program[2] === (0x3000 | 100), '0x' + r.program[2].toString(16));
  check('(x-c) RADIX HEX: MOVLW 10=0x10; RADIX DEC: MOVLW 10=10',
    r.program[3] === (0x3000 | 0x10) && r.program[4] === (0x3000 | 10), '');
  const u = assemble(`
    #define X 5
    #undef X
    MOVLW X
  `);
  check('(x-c) #undef xoá define: MOVLW X sau #undef báo lỗi (không còn thay thế)',
    u.errors.length === 1 && /Không hiểu hằng/.test(u.errors[0].message), JSON.stringify(u.errors));
}
{
  const r = assemble(`
    ORG 0
    BUFFER RES 4
    MOVLW 0x55
    FILL 0xAA, 3
    MSG DB 'H','i'
    TABLE DA "AB"
    GOTO TABLE
  `);
  check("(x-c) RES/FILL/DB với nhãn/DA dịch được", r.errors.length === 0, JSON.stringify(r.errors));
  check('(x-c) BUFFER RES 4: MOVLW ở địa chỉ 4; FILL 0xAA,3 điền 3 word 0xAA',
    r.program[4] === (0x3000 | 0x55) && r.program[5] === 0xaa && r.program[6] === 0xaa && r.program[7] === 0xaa, '');
  check("(x-c) MSG DB 'H','i' -> 0x48,0x69; DA \"AB\" -> 1 word 0x0241 (mask 14-bit)",
    r.program[8] === 0x48 && r.program[9] === 0x69 && r.program[10] === 0x0241, '');
  check('(x-c) nhãn BUFFER=0, MSG=8, TABLE=10; GOTO TABLE -> 0x2800|10',
    r.labels.BUFFER === 0 && r.labels.MSG === 8 && r.labels.TABLE === 10 && r.program[11] === (0x2800 | 10), '');
}
{
  const pad = Array(0x800).fill('    NOP').join('\n');
  const r = assemble(`    ORG 0\n    PAGESEL FAR\n    GOTO FAR\n${pad}\nFAR\n    RETURN\n  `);
  check('(x-c) PAGESEL nhãn trang 1 (0x802): BSF PCLATH,3 + BCF PCLATH,4',
    r.errors.length === 0 && r.program[0] === (0x1400 | (3 << 7) | 0x0a) && r.program[1] === (0x1000 | (4 << 7) | 0x0a),
    JSON.stringify(r.errors));
  const m = assemble(`    MACRO DELAYX\n    NOP\n    ENDM\n    MOVLW 1\n`);
  check('(x-c) MACRO báo rõ "chưa được hỗ trợ", chỉ 1 lỗi, code sau vẫn dịch',
    m.errors.length === 1 && /MACRO.*chưa được hỗ trợ/.test(m.errors[0].message) && m.program[0] === (0x3000 | 1), JSON.stringify(m.errors));
  const i = assemble(`    IF 1\n    MOVLW 1\n    ELSE\n    MOVLW 2\n    ENDIF\n    MOVLW 3\n`);
  check('(x-c) IF/ELSE/ENDIF báo rõ "chưa được hỗ trợ", code sau ENDIF vẫn dịch',
    i.errors.length === 1 && /chưa được hỗ trợ/.test(i.errors[0].message) && i.program[0] === (0x3000 | 3), JSON.stringify(i.errors));
  const w = assemble(`    WHILE 1\n    NOP\n    ENDW\n`);
  check('(x-c) WHILE báo rõ "chưa được hỗ trợ"',
    w.errors.length === 1 && /chưa được hỗ trợ/.test(w.errors[0].message), JSON.stringify(w.errors));
  const d = assemble(`    ORG 0x2100\n    DE 0x55\n`);
  check('(x-c) ORG 0x2100 + DE báo rõ về EEPROM (không phải "Không hiểu dòng")',
    d.errors.length === 2 && /EEPROM/.test(d.errors[0].message) && /EEPROM/.test(d.errors[1].message), JSON.stringify(d.errors));
  const e = assemble(`    ERROR "het bo nho"\n`);
  check('(x-c) ERROR đẩy lỗi với đúng thông báo của code',
    e.errors.length === 1 && /het bo nho/.test(e.errors[0].message), JSON.stringify(e.errors));
}

// (x-d) EEPROM dữ liệu: ghi đúng trình tự 0x55/0xAA, đọc lại, không mở khoá
// thì không ghi, loadEeprom, EECON2 đọc về 0, dữ liệu còn sau reset.
{
  const code = `
    BANKSEL EEADR
    MOVLW 0x10
    MOVWF EEADR
    MOVLW 0x5A
    MOVWF EEDATA
    BANKSEL EECON1
    BSF EECON1,WREN
    MOVLW 0x55
    MOVWF EECON2
    MOVLW 0xAA
    MOVWF EECON2
    BSF EECON1,WR
    BANKSEL PIR2
WAIT_EE
    BTFSS PIR2,EEIF
    GOTO WAIT_EE
    BCF PIR2,EEIF
    BANKSEL EECON1
    BCF EECON1,WREN
    BSF EECON1,RD
    BANKSEL EEDATA
    MOVF EEDATA,W
    BANKSEL 0x20
    MOVWF 0x20
  `;
  const r = assemble(code);
  check('(x-d) code ghi/đọc EEPROM dịch được', r.errors.length === 0, JSON.stringify(r.errors));
  const cpu = createCPU();
  cpu.loadProgram(r.program);
  cpu.run(20000);
  check('(x-d) đọc lại được 0x5A đã ghi', cpu.ram[0x20] === 0x5a, '0x' + (cpu.ram[0x20] || 0).toString(16));
  check('(x-d) WR tự xoá sau khi ghi xong', (cpu.sfr.EECON1 & 0x02) === 0, 'EECON1=0x' + cpu.sfr.EECON1.toString(16));
  check('(x-d) dữ liệu EEPROM còn sau reset (như phần cứng thật)', (() => { cpu.reset(); return cpu.eeprom[0x10] === 0x5a; })(), '');
  const cpu2 = createCPU();
  const r2 = assemble(`
    BANKSEL EEADR
    MOVLW 0x10
    MOVWF EEADR
    MOVLW 0x99
    MOVWF EEDATA
    BANKSEL EECON1
    BSF EECON1,WREN
    BSF EECON1,WR
  `);
  cpu2.loadProgram(r2.program);
  cpu2.run(10000);
  check('(x-d) ghi không mở khoá 0x55/0xAA thì không ghi', cpu2.eeprom[0x10] === 0, '0x' + cpu2.eeprom[0x10].toString(16));
  const cpu3 = createCPU();
  cpu3.loadEeprom([0x11, 0x22, 0x33]);
  check('(x-d) loadEeprom nạp sẵn 3 byte', cpu3.eeprom[0] === 0x11 && cpu3.eeprom[1] === 0x22 && cpu3.eeprom[2] === 0x33, '');
  check('(x-d) EECON2 đọc về 0 (chỉ ghi)', (() => { const c = createCPU(); c.writeFile(0x03, 0x40); c.writeFile(0x0f, 0x55); return c.readFile(0x0f) === 0; })(), '');
}

// (x-e) PWM (CCP1->RC2): duty 50%/0%/100%, TMR2 tắt thì ra 0, pinDirection=out.
{
  const pwmCode = (ccpr1l) => `
    BANKSEL PR2
    MOVLW 3
    MOVWF PR2
    BANKSEL CCPR1L
    MOVLW ${ccpr1l}
    MOVWF CCPR1L
    MOVLW b'00001100'
    MOVWF CCP1CON
    BANKSEL T2CON
    MOVLW b'00000100'
    MOVWF T2CON
  `;
  const cpu = createCPU();
  cpu.loadProgram(assemble(pwmCode(2)).program); // duty=8, chu kỳ 16 -> 50%
  cpu.run(100);
  let highs = 0, total = 0;
  for (let k = 0; k < 400; k++) { cpu.step(); total++; if (cpu.pinLevel(2, 2) === 1) highs++; }
  const ratio = highs / total;
  check('(x-e) PWM duty 50%: RC2 cao ~nửa thời gian (0.35-0.65)', ratio > 0.35 && ratio < 0.65, 'ratio=' + ratio.toFixed(2));
  check('(x-e) PWM: pinDirection RC2 = out (CCP chiếm chân)', cpu.pinDirection(2, 2) === 'out', '');
  check('(x-e) PWM: đọc PORTC phản ánh mức PWM', ((cpu.readPort(2) >> 2) & 1) === cpu.pinLevel(2, 2), '');
  const cpu0 = createCPU();
  cpu0.loadProgram(assemble(pwmCode(0)).program); // duty 0
  cpu0.run(100);
  let h0 = 0; for (let k = 0; k < 200; k++) { cpu0.step(); if (cpu0.pinLevel(2, 2) === 1) h0++; }
  check('(x-e) PWM duty 0%: RC2 luôn 0', h0 === 0, 'h0=' + h0);
  const cpu100 = createCPU();
  cpu100.loadProgram(assemble(pwmCode(4)).program); // duty=16 >= 4*(3+1)
  cpu100.run(100);
  let h100 = 0; for (let k = 0; k < 200; k++) { cpu100.step(); if (cpu100.pinLevel(2, 2) === 1) h100++; }
  check('(x-e) PWM duty 100%: RC2 luôn 1', h100 === 200, 'h100=' + h100);
  const cpuOff = createCPU();
  cpuOff.loadProgram(assemble(`
    BANKSEL PR2
    MOVLW 3
    MOVWF PR2
    BANKSEL CCPR1L
    MOVLW 4
    MOVWF CCPR1L
    MOVLW b'00001100'
    MOVWF CCP1CON
  `).program);
  cpuOff.run(100);
  check('(x-e) PWM: TMR2 tắt thì RC2 = 0', cpuOff.pinLevel(2, 2) === 0, '');
}

// (x-f) TMR1CS=1 (clock ngoài) thì TMR1 đứng yên; TMR1CS=0 thì chạy.
// SLEEP đánh thức bằng ngắt ADC (ADCS=11, clock RC chạy trong SLEEP).
// Đọc PIR1 phải thấy ADIF (sửa mask 0xaf -> 0xcf).
{
  const cpu = createCPU();
  cpu.loadProgram(assemble(`
    BANKSEL T1CON
    MOVLW b'00000011'
    MOVWF T1CON
  `).program);
  cpu.run(1010);
  check('(x-f) TMR1CS=1: TMR1 đứng yên (clock ngoài, không có nguồn ngoài)',
    cpu.sfr.TMR1L === 0 && cpu.sfr.TMR1H === 0, `TMR1=${(cpu.sfr.TMR1H << 8) | cpu.sfr.TMR1L}`);
  const cpu2 = createCPU();
  cpu2.loadProgram(assemble(`
    BANKSEL T1CON
    MOVLW b'00000001'
    MOVWF T1CON
  `).program);
  cpu2.run(110);
  check('(x-f) TMR1CS=0: TMR1 tăng theo clock nội',
    ((cpu2.sfr.TMR1H << 8) | cpu2.sfr.TMR1L) > 0, `TMR1=${(cpu2.sfr.TMR1H << 8) | cpu2.sfr.TMR1L}`);
  const cpu3 = createCPU();
  cpu3.loadProgram(assemble(`
    BANKSEL ADCON0
    MOVLW b'11000001'
    MOVWF ADCON0
    BANKSEL PIE1
    MOVLW b'01000000'
    MOVWF PIE1
    BANKSEL INTCON
    MOVLW b'01000000'
    MOVWF INTCON
    SLEEP
    NOP
  `).program);
  cpu3.setAnalog(0, 2.5);
  cpu3.run(50);
  check('(x-f) SLEEP: CPU ngủ sau SLEEP', cpu3.sleeping === true, '');
  cpu3.writeFile(0x1f, 0xc3); // ADCON0: ADON=1, GO=1, ADCS=11 (RC)
  cpu3.run(200);
  check('(x-f) SLEEP: ngắt ADC (ADCS=11) đánh thức CPU dù GIE=0', cpu3.sleeping === false, '');
  check('(x-f) đọc PIR1 thấy ADIF (mask cũ 0xaf vô tình xoá bit ADIF)',
    (() => { const c = createCPU(); c.sfr.PIR1 |= 0x40; return (c.readSFR('PIR1') & 0x40) === 0x40; })(), '');
}

// (x-g) Tên thanh ghi mới: SSPADD/SSPSTAT/SSPCON2/CMCON/CVRCON/EEDATH/EEADRH
// (đọc/ghi qua địa chỉ đúng bank, không rơi vào GPR).
{
  const cpu = createCPU();
  cpu.writeFile(0x03, 0x20); // bank 1
  cpu.writeFile(0x13, 0x55); // SSPADD (bank1, 0x13)
  cpu.writeFile(0x14, 0x66); // SSPSTAT (bank1, 0x14)
  cpu.writeFile(0x11, 0x77); // SSPCON2 (bank1, 0x11)
  cpu.writeFile(0x1c, 0x07); // CMCON (bank1, 0x1c)
  cpu.writeFile(0x1d, 0x88); // CVRCON (bank1, 0x1d)
  check('(x-g) SSPADD/SSPSTAT/SSPCON2/CMCON/CVRCON ghi/đọc đúng bank 1',
    cpu.readFile(0x13) === 0x55 && cpu.readFile(0x14) === 0x66 && cpu.readFile(0x11) === 0x77
    && cpu.readFile(0x1c) === 0x07 && cpu.readFile(0x1d) === 0x88, '');
  cpu.writeFile(0x03, 0x40); // bank 2
  cpu.writeFile(0x1e, 0x12); // EEDATH (bank2, 0x1e)
  cpu.writeFile(0x1f, 0x03); // EEADRH (bank2, 0x1f)
  check('(x-g) EEDATH/EEADRH ghi/đọc đúng bank 2',
    cpu.readFile(0x1e) === 0x12 && cpu.readFile(0x1f) === 0x03, '');
  check('(x-g) CMCON reset = 0x07 (datasheet POR, comparator tắt)',
    createCPU().sfr.CMCON === 0x07, '');
  const r = assemble(`
    BANKSEL SSPADD
    MOVLW 0x55
    MOVWF SSPADD
    BANKSEL CMCON
    MOVLW 0x07
    MOVWF CMCON
  `);
  check('(x-g) MOVWF SSPADD/CMCON dịch được (tên thanh ghi mới)',
    r.errors.length === 0, JSON.stringify(r.errors));
}

// ===========================================================================
// (y) LAB 2 "ĐIỀU KHIỂN LED + LCD" (round 25/11, đổi sang board 100×20):
// LED xanh lá nối RB1 qua điện trở 220Ω, cathode về GND; LCD 16x2 chế độ
// 8-bit (RS=RE0, E=RE1, D0–D7=RD0–RD7). Board 100 cột × 20 hàng: PIC ở
// giữa (neo g41), LCD góc trên phải (neo a77), R+LED góc dưới giữa
// (R neo s45, LED neo s52) — thân LCD không đè lên linh kiện khác,
// điện trở nhìn thấy được. Dây LCD cắm vào lỗ kề cùng đoạn strip như Lab 1.
// Lưu ý: RD4–RD7 là chân 27–30 (m54/m53/m52/m51), KHÔNG phải chân 23–26
// (đó là RC4–RC7) — đã kiểm chứng bằng picLegsForAnchor.
// ===========================================================================
// (y-a) Lab 2 đủ dữ liệu: 1 điện trở 220Ω + 1 LED xanh lá + 1 LCD + 13 dây
// Board lớn 100 cột × 20 hàng (custom {cols:100, rows:20, rails:true}):
// PIC ở giữa (neo g41), LCD góc trên phải (neo a77), R+LED góc dưới giữa.
{
  const lab = LABS[1];
  check('(y-a) Lab 2: Điều khiển LED + LCD, board 100×20, desc liệt kê đủ bảng đấu nối',
    lab && lab.id === 'led-lcd' && lab.title === 'Điều khiển LED + LCD'
    && lab.size && lab.size.cols === 100 && lab.size.rows === 20 && lab.size.rails === true
    && lab.desc.includes('RS→RE0') && lab.desc.includes('D7→RD7') && lab.desc.includes('RB1')
    && !lab.desc.includes('100 cột') && !lab.desc.includes('Board lớn') && !lab.desc.includes('Trên bàn'),
    lab ? lab.id : 'thieu LABS[1]');
  check('(y-a) Lab 2 có đúng 1 điện trở 220Ω (R1 @s45) + 1 LED xanh lá (LED1 @s52) + 1 LCD (LCD1 @a77) + thạch anh 4MHz (X0 @f53) + 2 tụ gốm 22pF (C0 @n30, C1 @n36)',
    lab.components.length === 6
    && lab.components[0].id === 'R1' && lab.components[0].type === 'resistor' && lab.components[0].anchor === 's45' && lab.components[0].props.value === 220
    && lab.components[1].id === 'LED1' && lab.components[1].type === 'led' && lab.components[1].anchor === 's52' && lab.components[1].props.color === '#059669'
    && lab.components[2].id === 'LCD1' && lab.components[2].type === 'lcd' && lab.components[2].anchor === 'a77'
    && lab.components[3].id === 'X0' && lab.components[3].type === 'crystal' && lab.components[3].anchor === 'f53' && lab.components[3].props.freq === 4000000
    && lab.components[4].id === 'C0' && lab.components[4].type === 'capacitor' && lab.components[4].anchor === 'n30' && lab.components[4].props.value === 22
    && lab.components[5].id === 'C1' && lab.components[5].type === 'capacitor' && lab.components[5].anchor === 'n36' && lab.components[5].props.value === 22,
    JSON.stringify(lab.components));
  check('(y-a) Lab 2 có đúng 17 dây: 3 dây LED + 10 dây LCD (RS/E/D0–D7) + 4 dây dao động (2 tụ về OSC1/OSC2 + 2 tụ về GND)',
    lab.wires.length === 17
    && lab.wires[0].a === 'n47' && lab.wires[0].b === 't45'
    && lab.wires[1].a === 't49' && lab.wires[1].b === 't52'
    && lab.wires[2].a === 't53' && lab.wires[2].b === 'B-53'
    && lab.wires[3].a === 'b77' && lab.wires[3].b === 'f48'
    && lab.wires[12].a === 'b86' && lab.wires[12].b === 'k51'
    && lab.wires[13].a === 'o34' && lab.wires[13].b === 'h53'
    && lab.wires[14].a === 'o30' && lab.wires[14].b === 'B-30'
    && lab.wires[15].a === 'o40' && lab.wires[15].b === 'h54'
    && lab.wires[16].a === 'o36' && lab.wires[16].b === 'B-36',
    JSON.stringify(lab.wires.map((w) => w.a + '->' + w.b)));
}
// (y-b) buildLabState cho ra state hợp lệ + không đầu dây nào trùng lỗ chân linh kiện
{
  const r = buildLabState(LABS[1]);
  check('(y-b) buildLabState Lab 2 ok: PIC1 + PSU1 + R1 + LED1 + LCD1 + X0 + C0 + C1, dây W1-W7 + 17 dây lab',
    r.ok && r.state.components.map((c) => c.id).join(',') === 'PIC1,PSU1,R1,LED1,LCD1,X0,C0,C1'
    && r.state.wires.map((w) => w.id).join(',') === 'W1,W2,W3,W4,W5,W6,W7,LAB2-W1,LAB2-W2,LAB2-W3,LAB2-W4,LAB2-W5,LAB2-W6,LAB2-W7,LAB2-W8,LAB2-W9,LAB2-W10,LAB2-W11,LAB2-W12,LAB2-W13,LAB2-W14,LAB2-W15,LAB2-W16,LAB2-W17',
    r.ok ? JSON.stringify({ comps: r.state.components.map((c) => c.id), wires: r.state.wires.map((w) => w.id) }) : r.reason);
  check('(y-b) không đầu dây lab nào cắm trùng lỗ chân linh kiện (chip/R1/LED1/LCD1)',
    r.ok && (() => {
      const legHoles = new Set(r.state.components.flatMap((c) => legsFor(c, LABS[1].size).map((l) => l.hole).filter(Boolean)));
      return LABS[1].wires.every((w) => [w.a, w.b].every((e) => !parseHole(e, LABS[1].size) || !legHoles.has(e)));
    })(), '');
  check('(y-b) mỗi dây LCD: đầu A cùng strip với chân LCD, đầu B cùng strip với chân PIC tương ứng',
    r.ok && (() => {
      const pins = { RS: 'RE0', E: 'RE1', D0: 'RD0', D1: 'RD1', D2: 'RD2', D3: 'RD3', D4: 'RD4', D5: 'RD5', D6: 'RD6', D7: 'RD7' };
      const lcdLegs = Object.fromEntries(legsFor({ type: 'lcd', anchor: 'a77', rot: 0 }, LABS[1].size).map((l) => [l.term, l.hole]));
      const picLeg = Object.fromEntries(picLegsForAnchor({ r: 6, c: 41 }, LABS[1].size).map((l) => [l.term.slice(4), l.hole]));
      return LABS[1].wires.slice(3, 13).every((w, i) => {
        const term = ['RS', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'][i];
        return stripKey(w.a, LABS[1].size) === stripKey(lcdLegs[term], LABS[1].size)
          && stripKey(w.b, LABS[1].size) === stripKey(picLeg[pins[term]], LABS[1].size);
      });
    })(), '');
}
// (y-c) Mạch hợp lệ qua netlist: LCD đủ RS/E/D0–D7 đúng chân, LED1 nối RB1 qua R về GND, 0 cảnh báo
{
  const { state } = buildLabState(LABS[1]);
  const nl = benchToNetlist(state);
  const mapping = resolvePeripherals(nl);
  check('(y-c) LCD đủ dây và đúng chân: RS=RE0, E=RE1, D0–D7=RD0–RD7 (RD4–RD7 là chân 27–30)',
    mapping.lcd.complete === true
    && mapping.lcd.rs && mapping.lcd.rs.id === 'RE0' && mapping.lcd.e && mapping.lcd.e.id === 'RE1'
    && JSON.stringify(mapping.lcd.d.map((p) => p && p.id)) === JSON.stringify(['RD0', 'RD1', 'RD2', 'RD3', 'RD4', 'RD5', 'RD6', 'RD7']),
    JSON.stringify({ rs: mapping.lcd.rs && mapping.lcd.rs.id, e: mapping.lcd.e && mapping.lcd.e.id, d: mapping.lcd.d.map((p) => p && p.id), missing: mapping.lcd.missing }));
  const led = mapping.leds.find((l) => l.id === 'LED1');
  check('(y-c) LED1 nối đúng: anode là chân RB1 (pin 34), cathode về GND, có điện trở nối tiếp',
    led && led.pin && led.pin.id === 'RB1' && led.pin.num === 34 && led.gnd === true && led.hasResistor === true,
    JSON.stringify(led));
  const warns = checkWiring(nl, null);
  check('(y-c) checkWiring không cảnh báo gì cho mạch lab 2',
    warns.length === 0, JSON.stringify(warns.map((w) => w.message)));
}
// (y-d) LED1 sáng khi RB1 mức cao, tắt khi RB1 mức thấp (CPU lái trực tiếp)
{
  const { state } = buildLabState(LABS[1]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.writeFile(0x03, 0x20); // bank1: RP0=1
  cpu.writeFile(0x06, 0x00); // TRISB = 0 (ngõ ra)
  cpu.writeFile(0x03, 0x00); // về bank0
  cpu.writeFile(0x06, 0x02); // PORTB = 0x02 -> RB1=1
  check('(y-d) RB1=1 (ngõ ra): LED1 SÁNG',
    ledStates(cpu, mapping).find((s) => s.id === 'LED1').on === true, '');
  cpu.writeFile(0x06, 0x00); // PORTB = 0x00 -> RB1=0
  check('(y-d) RB1=0 (ngõ ra): LED1 TẮT',
    ledStates(cpu, mapping).find((s) => s.id === 'LED1').on === false, '');
}
// (y-e) Chạy chương trình mẫu: khởi tạo LCD 8-bit + ghi HELLO, đồng thời nháy LED RB1
{
  const { state } = buildLabState(LABS[1]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const r = assemble(`
    LIST P=16F877A
    #include <P16F877A.INC>
    __CONFIG _CP_OFF & _WDT_OFF & _PWRTE_ON & _XT_OSC & _LVP_OFF
    CBLOCK 0x20
        CNT
    ENDC
    ORG 0x0000
    GOTO MAIN
MAIN:
    BANKSEL TRISB
    BCF TRISB,1
    BANKSEL TRISE
    BCF TRISE,0
    BCF TRISE,1
    BANKSEL TRISD
    CLRF TRISD
    BANKSEL PORTB
    BCF PORTB,1
    CALL LCD_INIT
    MOVLW 'H'
    CALL LCD_DATA
    MOVLW 'E'
    CALL LCD_DATA
    MOVLW 'L'
    CALL LCD_DATA
    MOVLW 'L'
    CALL LCD_DATA
    MOVLW 'O'
    CALL LCD_DATA
LOOP:
    BANKSEL PORTB
    BSF PORTB,1
    CALL DELAY
    BCF PORTB,1
    CALL DELAY
    GOTO LOOP
LCD_INIT:
    BANKSEL PORTD
    MOVLW 0x38
    CALL LCD_CMD
    MOVLW 0x0C
    CALL LCD_CMD
    MOVLW 0x01
    CALL LCD_CMD
    MOVLW 0x06
    CALL LCD_CMD
    RETURN
LCD_CMD:
    BANKSEL PORTE
    BCF PORTE,0
    BANKSEL PORTD
    MOVWF PORTD
    BANKSEL PORTE
    BSF PORTE,1
    BCF PORTE,1
    CALL LCD_WAIT
    RETURN
LCD_DATA:
    BANKSEL PORTE
    BSF PORTE,0
    BANKSEL PORTD
    MOVWF PORTD
    BANKSEL PORTE
    BSF PORTE,1
    BCF PORTE,1
    CALL LCD_WAIT
    RETURN
LCD_WAIT:
    BANKSEL PORTD
    MOVLW D'20'
    MOVWF CNT
W1: DECFSZ CNT,F
    GOTO W1
    RETURN
DELAY:
    BANKSEL PORTD
    MOVLW D'100'
    MOVWF CNT
D1: DECFSZ CNT,F
    GOTO D1
    RETURN
    END`);
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.loadProgram(r.program);
  runUntil(cpu, 10000);
  check('(y-e) chương trình mẫu: LCD hiện HELLO ở dòng 1',
    r.errors.length === 0 && cpu.lcd.getLines()[0].startsWith('HELLO'),
    `errors=${JSON.stringify(r.errors)} line0=${JSON.stringify(cpu.lcd.getLines()[0])}`);
  let seenOn = false, seenOff = false;
  for (let i = 0; i < 2000 && !(seenOn && seenOff); i++) {
    cpu.step();
    const on = ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
    if (on) seenOn = true; else seenOff = true;
  }
  check('(y-e) chương trình mẫu: LED1 nhấp nháy theo RB1 (thấy cả SÁNG lẫn TẮT)',
    seenOn && seenOff, `on=${seenOn} off=${seenOff}`);
}

// (y-f) Board lớn 100×20: linh kiện cách xa nhau, thân LCD không đè lên
// linh kiện khác, không linh kiện nào thò ra ngoài mép board.
// Hộp bao (x,z) theo đúng kích thước 3D trong bench.js: LCD BoxGeometry
// (80,8,36) tâm local (11.43,9,18); PIC rộng 20 cột, sâu picBodyDepth
// (lề 1.5mm mỗi bên); R thân trụ ngang dài 7mm tâm local x=5.08;
// LED thân trụ đứng bán kính 2.6 tâm local x=1.27.
{
  const SIZE = LABS[1].size;
  const bs = boardSize(SIZE);
  check('(y-f) Lab 2 dùng board custom 100 cột × 20 hàng, có rail (2400 lỗ)',
    bs.id === 'custom' && bs.cols === 100 && bs.rows === 20 && bs.railCols === 100,
    JSON.stringify(bs));
  const hp = (hole) => holePos(hole, SIZE);
  const lcdA = hp('a77');
  const lcdBox = { x0: lcdA.x - 28.57, x1: lcdA.x + 51.43, z0: lcdA.z, z1: lcdA.z + 36 };
  const picT = hp('g41'), picB = hp('m41');
  const picBox = { x0: picT.x - 1.27, x1: picT.x + 19 * PITCH + 1.27, z0: picT.z - 1.5, z1: picB.z + 1.5 };
  const rA = hp('s45');
  const rBox = { x0: rA.x + 1.58, x1: rA.x + 8.58, z0: rA.z - 1.15, z1: rA.z + 1.15 };
  const ledA = hp('s52');
  const ledBox = { x0: ledA.x + 1.27 - 2.6, x1: ledA.x + 1.27 + 2.6, z0: ledA.z - 2.6, z1: ledA.z + 2.6 };
  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  check('(y-f) thân LCD KHÔNG đè lên chip PIC / điện trở / LED (điện trở nhìn thấy được)',
    !overlap(lcdBox, picBox) && !overlap(lcdBox, rBox) && !overlap(lcdBox, ledBox),
    JSON.stringify({ lcdBox, picBox, rBox, ledBox }));
  check('(y-f) chip PIC KHÔNG đè lên điện trở / LED',
    !overlap(picBox, rBox) && !overlap(picBox, ledBox), '');
  const gapCols = (xA1, xB0) => Math.floor((xB0 - xA1) / PITCH);
  check('(y-f) khe hở PIC -> LCD >= 5 cột, LED -> LCD >= 5 cột (dễ nhìn)',
    gapCols(picBox.x1, lcdBox.x0) >= 5 && gapCols(ledBox.x1, lcdBox.x0) >= 5,
    `PIC->LCD ${gapCols(picBox.x1, lcdBox.x0)} cột, LED->LCD ${gapCols(ledBox.x1, lcdBox.x0)} cột`);
  const bx0 = hp('a1').x, bx1 = hp('a100').x, bz = bodyDepth(SIZE) / 2;
  const inside = (b) => b.x0 >= bx0 && b.x1 <= bx1 && b.z0 >= -bz && b.z1 <= bz;
  check('(y-f) không linh kiện nào thò ra ngoài mép board (LCD/PIC/R/LED)',
    inside(lcdBox) && inside(picBox) && inside(rBox) && inside(ledBox),
    `board x ${bx0.toFixed(1)}..${bx1.toFixed(1)} z ±${bz.toFixed(1)}; LCD ${JSON.stringify(lcdBox)}`);
}

// Nhóm (bb): Lab 3 "Đếm 00–99 trên 2 LED 7 thanh" — 2 LED 7 thanh cạnh
// nhau (hàng chục PORTD, hàng đơn vị PORTB, chung cathode về GND) +
// thạch anh 4MHz + 2 tụ gốm 22pF (bắt buộc để chip có xung).
// (bb-a) Lab 3 đủ dữ liệu: 2 LED 7 thanh + thạch anh + 2 tụ + 22 dây
{
  const lab = LABS[2];
  check('(bb-a) Lab 3: Đếm 00–99 trên 2 LED 7 thanh, board 100×20 có rail',
    lab && lab.id === 'count-2x7seg' && lab.title === 'Đếm 00–99 trên 2 LED 7 thanh'
    && lab.size && lab.size.cols === 100 && lab.size.rows === 20 && lab.size.rails === true
    && lab.desc.includes('RD0–RD7') && lab.desc.includes('RB0–RB7') && lab.desc.includes('thạch anh')
    && !lab.desc.includes('100 cột') && !lab.desc.includes('Board lớn') && !lab.desc.includes('Trên bàn'),
    lab ? lab.id : 'thieu LABS[2]');
  check('(bb-a) Lab 3 có đúng 2 LED 7 thanh (SEG0 @a10, SEG1 @a16) + thạch anh 4MHz (X0 @f53) + 2 tụ gốm 22pF (C0 @n30, C1 @n36)',
    lab.components.length === 5
    && lab.components[0].id === 'SEG0' && lab.components[0].type === 'sevenseg' && lab.components[0].anchor === 'a10' && lab.components[0].props.common === 'cathode'
    && lab.components[1].id === 'SEG1' && lab.components[1].type === 'sevenseg' && lab.components[1].anchor === 'a16' && lab.components[1].props.common === 'cathode'
    && lab.components[2].id === 'X0' && lab.components[2].type === 'crystal' && lab.components[2].anchor === 'f53' && lab.components[2].props.freq === 4000000
    && lab.components[3].id === 'C0' && lab.components[3].type === 'capacitor' && lab.components[3].anchor === 'n30' && lab.components[3].props.value === 22
    && lab.components[4].id === 'C1' && lab.components[4].type === 'capacitor' && lab.components[4].anchor === 'n36' && lab.components[4].props.value === 22,
    JSON.stringify(lab.components));
  check('(bb-a) Lab 3 có đúng 22 dây: 8 đoạn + COM của SEG0, 8 đoạn + COM của SEG1, 4 dây dao động',
    lab.wires.length === 22
    && lab.wires[0].a === 'b10' && lab.wires[0].b === 'f59'   // SEG0.a -> RD0
    && lab.wires[7].a === 'b14' && lab.wires[7].b === 'k51'   // SEG0.dp -> RD7
    && lab.wires[8].a === 'g13' && lab.wires[8].b === 'B-13'  // SEG0.COM -> GND
    && lab.wires[9].a === 'b16' && lab.wires[9].b === 'k48'   // SEG1.a -> RB0
    && lab.wires[16].a === 'b20' && lab.wires[16].b === 'k41' // SEG1.dp -> RB7
    && lab.wires[17].a === 'g19' && lab.wires[17].b === 'B-19' // SEG1.COM -> GND
    && lab.wires[18].a === 'o34' && lab.wires[18].b === 'h53' // C0 -> OSC1
    && lab.wires[19].a === 'o30' && lab.wires[19].b === 'B-30' // C0 -> GND
    && lab.wires[20].a === 'o40' && lab.wires[20].b === 'h54' // C1 -> OSC2
    && lab.wires[21].a === 'o36' && lab.wires[21].b === 'B-36', // C1 -> GND
    JSON.stringify(lab.wires.map((w) => w.a + '->' + w.b)));
}
// (bb-b) buildLabState cho ra state hợp lệ + mỗi đầu dây cùng strip với chân nó nối
{
  const r = buildLabState(LABS[2]);
  check('(bb-b) buildLabState Lab 3 ok: PIC1 + PSU1 + SEG0 + SEG1 + X0 + C0 + C1, dây W1-W7 + 22 dây lab',
    r.ok && r.state.components.map((c) => c.id).join(',') === 'PIC1,PSU1,SEG0,SEG1,X0,C0,C1'
    && r.state.wires.map((w) => w.id).join(',') === 'W1,W2,W3,W4,W5,W6,W7,LAB3-W1,LAB3-W2,LAB3-W3,LAB3-W4,LAB3-W5,LAB3-W6,LAB3-W7,LAB3-W8,LAB3-W9,LAB3-W10,LAB3-W11,LAB3-W12,LAB3-W13,LAB3-W14,LAB3-W15,LAB3-W16,LAB3-W17,LAB3-W18,LAB3-W19,LAB3-W20,LAB3-W21,LAB3-W22',
    r.ok ? JSON.stringify({ comps: r.state.components.map((c) => c.id), wires: r.state.wires.map((w) => w.id) }) : r.reason);
  check('(bb-b) không đầu dây lab nào cắm trùng lỗ chân linh kiện (chip/SEG0/SEG1/X0/C0/C1)',
    r.ok && (() => {
      const legHoles = new Set(r.state.components.flatMap((c) => legsFor(c, LABS[2].size).map((l) => l.hole).filter(Boolean)));
      return LABS[2].wires.every((w) => [w.a, w.b].every((e) => !parseHole(e, LABS[2].size) || !legHoles.has(e)));
    })(), '');
  check('(bb-b) mỗi dây đoạn: đầu A cùng strip với chân 7 thanh, đầu B cùng strip với chân PIC tương ứng',
    r.ok && (() => {
      const segLegs = (id) => Object.fromEntries(legsFor({ type: 'sevenseg', anchor: id === 'SEG0' ? 'a10' : 'a16', rot: 0 }, LABS[2].size).map((l) => [l.term, l.hole]));
      const picLeg = Object.fromEntries(picLegsForAnchor({ r: 6, c: 41 }, LABS[2].size).map((l) => [l.term.slice(4), l.hole]));
      const terms = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
      const pinsD = ['RD0', 'RD1', 'RD2', 'RD3', 'RD4', 'RD5', 'RD6', 'RD7'];
      const pinsB = ['RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7'];
      const legs0 = segLegs('SEG0'), legs1 = segLegs('SEG1');
      return LABS[2].wires.slice(0, 8).every((w, i) =>
        stripKey(w.a, LABS[2].size) === stripKey(legs0[terms[i]], LABS[2].size)
        && stripKey(w.b, LABS[2].size) === stripKey(picLeg[pinsD[i]], LABS[2].size))
        && LABS[2].wires.slice(9, 17).every((w, i) =>
          stripKey(w.a, LABS[2].size) === stripKey(legs1[terms[i]], LABS[2].size)
          && stripKey(w.b, LABS[2].size) === stripKey(picLeg[pinsB[i]], LABS[2].size));
    })(), '');
}
// (bb-c) Mạch hợp lệ qua netlist: SEG0 nối RD0–RD7, SEG1 nối RB0–RB7, COM về GND, 0 cảnh báo
{
  const { state } = buildLabState(LABS[2]);
  const nl = benchToNetlist(state);
  const mapping = resolvePeripherals(nl);
  check('(bb-c) SEG0 (hàng chục) nối đúng RD0–RD7, COM về GND',
    mapping.sevensegs.length === 2
    && mapping.sevensegs[0].id === 'SEG0'
    && JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((t) => mapping.sevensegs[0].seg[t] && mapping.sevensegs[0].seg[t].pin && mapping.sevensegs[0].seg[t].pin.id)) === JSON.stringify(['RD0', 'RD1', 'RD2', 'RD3', 'RD4', 'RD5', 'RD6', 'RD7'])
    && mapping.sevensegs[0].com && mapping.sevensegs[0].com.gnd === true,
    JSON.stringify(mapping.sevensegs[0]));
  check('(bb-c) SEG1 (hàng đơn vị) nối đúng RB0–RB7, COM về GND',
    mapping.sevensegs[1].id === 'SEG1'
    && JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((t) => mapping.sevensegs[1].seg[t] && mapping.sevensegs[1].seg[t].pin && mapping.sevensegs[1].seg[t].pin.id)) === JSON.stringify(['RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7'])
    && mapping.sevensegs[1].com && mapping.sevensegs[1].com.gnd === true,
    JSON.stringify(mapping.sevensegs[1]));
  check('(bb-c) Lab 3 có thạch anh 4MHz (crystalFreq), checkWiring 0 cảnh báo',
    crystalFreq(state) === 4000000 && checkWiring(nl, null).length === 0,
    `crystalFreq=${crystalFreq(state)} warns=${JSON.stringify(checkWiring(nl, null).map((w) => w.message))}`);
}
// (bb-d) Chạy code mẫu C: đếm 00 -> 01 -> 02 -> 10, đoạn sáng đúng số
{
  const { state } = buildLabState(LABS[2]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const c = compileC(LABS[2].code);
  check('(bb-d) code Lab 3 biên dịch 0 lỗi (bảng tra const, 2 biến đếm, __delay_ms 500)',
    c.ok && c.errors.length === 0 && c.xtalFreq === 4000000, JSON.stringify(c.errors || []));
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.loadProgram(c.program);
  const segs = () => sevenSegStates(cpu, mapping);
  runUntil(cpu, 250000); // giữa khoảng 00
  check('(bb-d) 00: PORTD=0x3F PORTB=0x3F, 2 LED đều hiện số 0',
    cpu.readPort(3) === 0x3F && cpu.readPort(1) === 0x3F
    && sevenSegDigit(segs()[0].on) === '0' && sevenSegDigit(segs()[1].on) === '0',
    `PORTD=${cpu.readPort(3).toString(16)} PORTB=${cpu.readPort(1).toString(16)} SEG0=${sevenSegDigit(segs()[0].on)} SEG1=${sevenSegDigit(segs()[1].on)}`);
  runUntil(cpu, 750000); // giữa khoảng 01
  check('(bb-d) 01: PORTD=0x3F PORTB=0x06, SEG0 hiện 0, SEG1 hiện 1',
    cpu.readPort(3) === 0x3F && cpu.readPort(1) === 0x06
    && sevenSegDigit(segs()[0].on) === '0' && sevenSegDigit(segs()[1].on) === '1',
    `PORTD=${cpu.readPort(3).toString(16)} PORTB=${cpu.readPort(1).toString(16)} SEG0=${sevenSegDigit(segs()[0].on)} SEG1=${sevenSegDigit(segs()[1].on)}`);
  runUntil(cpu, 1250000); // giữa khoảng 02
  check('(bb-d) 02: PORTD=0x3F PORTB=0x5B, SEG0 hiện 0, SEG1 hiện 2',
    cpu.readPort(3) === 0x3F && cpu.readPort(1) === 0x5B
    && sevenSegDigit(segs()[0].on) === '0' && sevenSegDigit(segs()[1].on) === '2',
    `PORTD=${cpu.readPort(3).toString(16)} PORTB=${cpu.readPort(1).toString(16)} SEG0=${sevenSegDigit(segs()[0].on)} SEG1=${sevenSegDigit(segs()[1].on)}`);
  runUntil(cpu, 5250000); // giữa khoảng 10
  check('(bb-d) 10: PORTD=0x06 PORTB=0x3F, SEG0 hiện 1, SEG1 hiện 0 (chục tăng, đơn vị quay về 0)',
    cpu.readPort(3) === 0x06 && cpu.readPort(1) === 0x3F
    && sevenSegDigit(segs()[0].on) === '1' && sevenSegDigit(segs()[1].on) === '0',
    `PORTD=${cpu.readPort(3).toString(16)} PORTB=${cpu.readPort(1).toString(16)} SEG0=${sevenSegDigit(segs()[0].on)} SEG1=${sevenSegDigit(segs()[1].on)} cycles=${cpu.cycles}`);
}

// Nhóm (z): gộp vôn kế + ampe kế thành 1 linh kiện "Đồng hồ đo"
// (multimeter) — đổi chế độ V/A trong popup Inspector, migration
// state cũ (voltmeter/ammeter) sang multimeter giữ nguyên id.
{
  const approx = (v, target, tol) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v - target) <= tol;
  // Mạch dùng chung: PSU 5V -> R 1kΩ -> đồng hồ đo -> T- (nối tiếp).
  const seriesState = (mode) => {
    const st = defaultBenchState(830);
    st.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 1000 } });
    st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode } });
    st.wires.push({ id: 'T-Z1', a: 'b20', b: 'T+20', color: '#DC2626' });
    st.wires.push({ id: 'T-Z2', a: 'b24', b: 'b30', color: '#DC2626' });
    st.wires.push({ id: 'T-Z3', a: 'b34', b: 'T-34', color: '#0F172A' });
    return st;
  };
  // (z-a) Cùng 1 mạch nối tiếp R 1kΩ: mode V đọc 5V (hở mạch nên không
  // sụt áp qua R: vP=5, vN=0), mode A đọc 5mA; mỗi mode chỉ xuất hiện
  // trong đúng 1 danh sách, kèm trường mode.
  check('(z-a) cùng mạch nối tiếp R 1kΩ: mode V đọc 5V (vP=5, vN=0), mode A đọc 5mA; entry có trường mode',
    (() => {
      const rV = meterReadings(seriesState('V'), createCPU());
      const rA = meterReadings(seriesState('A'), createCPU());
      return rV.voltmeters.length === 1 && rV.voltmeters[0].volts === 5 && rV.voltmeters[0].vP === 5 && rV.voltmeters[0].vN === 0
        && rV.voltmeters[0].mode === 'V' && rV.ammeters.length === 0
        && rA.ammeters.length === 1 && approx(rA.ammeters[0].amps, 0.005, 0.0002) && rA.ammeters[0].mode === 'A'
        && rA.voltmeters.length === 0;
    })(), '');
  // (z-b) Đổi mode V->A trên cùng 1 state (như bấm nút trong popup):
  // 2 LED ở 2 strip tách net (V) rồi chung net (A); đổi lại A->V thì
  // tách ra. Không cần đặt lại linh kiện.
  check('(z-b) đổi mode V->A trên cùng 1 state: 2 LED tách net (V) rồi chung net (A); đổi lại A->V thì tách ra',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'V' } });
      st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      st.components.push({ id: 'LED1', type: 'led', anchor: 'c14', rot: 0, props: { color: '#DC2626' } });
      const mm = st.components.find((c) => c.id === 'MM0');
      const sepV = buildBenchNets(st).termRoot.get('LED0.A') !== buildBenchNets(st).termRoot.get('LED1.A');
      mm.props.mode = 'A';
      const joinA = buildBenchNets(st).termRoot.get('LED0.A') === buildBenchNets(st).termRoot.get('LED1.A');
      const ampsA = meterReadings(st, createCPU()).ammeters.length === 1;
      mm.props.mode = 'V';
      const sepV2 = buildBenchNets(st).termRoot.get('LED0.A') !== buildBenchNets(st).termRoot.get('LED1.A');
      return sepV && joinA && ampsA && sepV2;
    })(), '');
  // (z-c) sanitizeState: voltmeter VM0 -> multimeter mode V (giữ id VM0),
  // ammeter AM0 -> multimeter mode A (giữ id AM0); không còn type cũ.
  check('(z-c) sanitizeState: VM0 cũ -> multimeter mode V (giữ id), AM0 cũ -> multimeter mode A (giữ id), không còn type cũ',
    (() => {
      const raw = defaultBenchState(830);
      raw.components.push({ id: 'VM0', type: 'voltmeter', anchor: 'a10', rot: 0, props: {} });
      raw.components.push({ id: 'AM0', type: 'ammeter', anchor: 'a30', rot: 0, props: {} });
      const s = sanitizeState(raw);
      const vm = s.components.find((c) => c.id === 'VM0');
      const am = s.components.find((c) => c.id === 'AM0');
      return vm && vm.type === 'multimeter' && vm.props.mode === 'V' && vm.anchor === 'a10'
        && am && am.type === 'multimeter' && am.props.mode === 'A' && am.anchor === 'a30'
        && JSON.stringify(legsFor(vm, 830)) === JSON.stringify([{ term: 'P', hole: 'a10' }, { term: 'N', hole: 'a14' }])
        && JSON.stringify(legsFor(am, 830)) === JSON.stringify([{ term: 'P', hole: 'a30' }, { term: 'N', hole: 'a34' }])
        && !s.components.some((c) => c.type === 'voltmeter' || c.type === 'ammeter');
    })(), '');
  // (z-d) Sau migration, đồng hồ cũ vẫn đo đúng: VM0 cũ (mode V) qua PSU
  // đọc 5V; AM0 cũ (mode A) nối tiếp R 1kΩ đọc 5mA.
  check('(z-d) sau migration: VM0 cũ (mode V) qua PSU đọc 5V; AM0 cũ (mode A) nối tiếp R 1kΩ đọc 5mA',
    (() => {
      const raw = defaultBenchState(830);
      raw.components.push({ id: 'VM0', type: 'voltmeter', anchor: 'a10', rot: 0, props: {} });
      raw.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 1000 } });
      raw.components.push({ id: 'AM0', type: 'ammeter', anchor: 'a30', rot: 0, props: {} });
      raw.wires.push({ id: 'T-Z4', a: 'b10', b: 'T+10', color: '#DC2626' });
      raw.wires.push({ id: 'T-Z5', a: 'b14', b: 'T-10', color: '#0F172A' });
      raw.wires.push({ id: 'T-Z6', a: 'b20', b: 'T+20', color: '#DC2626' });
      raw.wires.push({ id: 'T-Z7', a: 'b24', b: 'b30', color: '#DC2626' });
      raw.wires.push({ id: 'T-Z8', a: 'b34', b: 'T-34', color: '#0F172A' });
      const s = sanitizeState(raw);
      const r = meterReadings(s, createCPU());
      return r.voltmeters.length === 1 && r.voltmeters[0].id === 'VM0' && r.voltmeters[0].volts === 5
        && r.ammeters.length === 1 && r.ammeters[0].id === 'AM0' && approx(r.ammeters[0].amps, 0.005, 0.0002);
    })(), '');
  // (z-e) pruneStateForSize cũng migrate đồng hồ cũ (đổi size board).
  check('(z-e) pruneStateForSize: VM0/AM0 cũ -> multimeter đúng mode (V/A), giữ id',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'VM0', type: 'voltmeter', anchor: 'a10', rot: 0, props: {} });
      st.components.push({ id: 'AM0', type: 'ammeter', anchor: 'a30', rot: 0, props: {} });
      const { state } = pruneStateForSize(st, 830);
      const vm = state.components.find((c) => c.id === 'VM0');
      const am = state.components.find((c) => c.id === 'AM0');
      return vm && vm.type === 'multimeter' && vm.props.mode === 'V'
        && am && am.type === 'multimeter' && am.props.mode === 'A';
    })(), '');
  // (z-f) defaultProps(multimeter) = {mode:'V'}; đặt 2 đồng hồ mới -> MM0 rồi MM1.
  check('(z-f) defaultProps(multimeter) = {mode:"V"}; đặt 2 đồng hồ mới -> MM0 rồi MM1',
    (() => {
      const st = defaultBenchState(830);
      const id1 = nextComponentId(st, 'multimeter');
      st.components.push({ id: id1, type: 'multimeter', anchor: 'a10', rot: 0, props: defaultProps('multimeter') });
      const id2 = nextComponentId(st, 'multimeter');
      return JSON.stringify(defaultProps('multimeter')) === JSON.stringify({ mode: 'V' })
        && id1 === 'MM0' && id2 === 'MM1';
    })(), '');
  // (z-g) Đồng hồ đo chế độ A đấu tắt qua PSU vẫn OL (không làm mất nguồn);
  // đổi sang mode V thì đọc 5V như vôn kế.
  check('(z-g) đồng hồ đấu tắt qua PSU: mode A -> OL; đổi sang mode V -> đọc 5V',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a10', rot: 0, props: { mode: 'A' } });
      st.wires.push({ id: 'T-Z9', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-Z10', a: 'b14', b: 'T-10', color: '#0F172A' });
      const rA = meterReadings(st, createCPU());
      const mm = st.components.find((c) => c.id === 'MM0');
      mm.props.mode = 'V';
      const rV = meterReadings(st, createCPU());
      return rA.ammeters.length === 1 && rA.ammeters[0].amps === Infinity
        && rV.voltmeters.length === 1 && rV.voltmeters[0].volts === 5;
    })(), '');
}

// ===========================================================================
// (aa) TRÌNH BIÊN DỊCH C (XC8 subset): compileC nối
// parseC -> generateC -> assemble. Chuỗi C mẫu Lab 1 / Lab 2 dưới đây là
// NGUYÊN VĂN — subagent editor sẽ đưa đúng 2 chuỗi này vào labs.js.
// ===========================================================================
// Lab 1 C: nháy LED RB0, nửa chu kỳ 500ms (đo được 500014 chu kỳ).
const LAB1_C = "#include <xc.h>\n#define _XTAL_FREQ 4000000\nvoid main(){ TRISB = 0; while(1){ RB0 = 1; __delay_ms(500); RB0 = 0; __delay_ms(500); } }";
// Lab 2 C: khởi tạo LCD 8-bit (RS=RE0, E=RE1, D0–D7=RD0–RD7), ghi "HELLO",
// rồi nháy LED RB1, nửa chu kỳ 500ms. LCD_CMD ghi PORTD rồi xung E với
// RE0=0; LCD_DATA thì RE0=1 trước; LCD_WAIT chờ ngắn (__delay_us(100)).
// Theo bản hợp ngữ chuẩn nhóm (y-e): init 0x38, 0x0C, 0x01, 0x06.
const LAB2_C = `#include <xc.h>
#define _XTAL_FREQ 4000000

void LCD_WAIT() {
  __delay_us(100);
}

void LCD_CMD(unsigned char c) {
  RE0 = 0;
  PORTD = c;
  RE1 = 1;
  RE1 = 0;
  LCD_WAIT();
}

void LCD_DATA(unsigned char c) {
  RE0 = 1;
  PORTD = c;
  RE1 = 1;
  RE1 = 0;
  LCD_WAIT();
}

void main() {
  TRISB = 0;
  TRISD = 0;
  TRISE = 0;
  RB1 = 0;
  LCD_CMD(0x38);
  LCD_CMD(0x0C);
  LCD_CMD(0x01);
  LCD_CMD(0x06);
  LCD_DATA('H');
  LCD_DATA('E');
  LCD_DATA('L');
  LCD_DATA('L');
  LCD_DATA('O');
  while(1) {
    RB1 = 1;
    __delay_ms(500);
    RB1 = 0;
    __delay_ms(500);
  }
}`;

// Biên dịch C rồi chạy tới đủ số chu kỳ (không nạp khi compile lỗi).
function runC(src, cycles) {
  const r = compileC(src);
  const cpu = createCPU();
  if (r.ok && r.program) { cpu.loadProgram(r.program); runUntil(cpu, cycles); }
  return { r, cpu };
}
// Như runC nhưng gắn mapping Lab (LED/LCD đọc từ dây thật trên board).
function runLabC(labIdx, src, cycles) {
  const { state } = buildLabState(LABS[labIdx]);
  const mapping = resolvePeripherals(benchToNetlist(state));
  const r = compileC(src);
  const cpu = createCPU();
  cpu.setWiring(mapping);
  if (r.ok && r.program) { cpu.loadProgram(r.program); runUntil(cpu, cycles); }
  return { r, cpu, mapping };
}
// Tính biểu thức 16-bit rồi đọc lại qua PORTB (byte thấp) + PORTD (byte cao).
function eval16(expr) {
  const { r, cpu } = runC(`void main(){ TRISB = 0; TRISD = 0; int x = ${expr}; PORTB = x; PORTD = x >> 8; }`, 5000);
  return { r, lo: cpu.readPort(1), hi: cpu.readPort(3) };
}
// Đo 1 nửa chu kỳ BẬT của LED (từ cạnh lên tới cạnh xuống kế tiếp):
// bước cho tới khi LED tắt, rồi tới khi LED sáng lại, rồi tới khi tắt.
// Trả {half, tOff1, tOn, ok} — ok=false nếu hết bước mà chưa đủ 3 cạnh.
function measureOnHalf(cpu, isOn) {
  let steps = 0;
  const MAX = 5000000;
  while (isOn() && steps++ < MAX) cpu.step();
  if (steps >= MAX) return { half: -1, tOff1: -1, tOn: -1, ok: false };
  const tOff1 = cpu.cycles;
  while (!isOn() && steps++ < MAX) cpu.step();
  if (steps >= MAX) return { half: -1, tOff1, tOn: -1, ok: false };
  const tOn = cpu.cycles;
  while (isOn() && steps++ < MAX) cpu.step();
  if (steps >= MAX) return { half: -1, tOff1, tOn, ok: false };
  return { half: cpu.cycles - tOn, tOff1, tOn, ok: true };
}

// (aa-a) Lab 1 C: compile ok, LED0 SÁNG rồi TẮT, nửa chu kỳ ~500000 (±20%)
{
  check('(aa-a) C_VERSION = 20261125ax', C_VERSION === '20261125ax', String(C_VERSION));
  const { r, cpu, mapping } = runLabC(0, LAB1_C, 100000);
  const led0 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  check('(aa-a) Lab 1 C: compileC ok, 0 lỗi, có program',
    r.ok && r.errors.length === 0 && r.program !== null, JSON.stringify(r.errors.slice(0, 2)));
  check('(aa-a) Lab 1 C: sau 100k chu kỳ LED0 SÁNG (RB0=1, nửa chu kỳ đầu)',
    r.ok && led0() === true, `on=${led0()} PORTB=${cpu.readPort(1).toString(16)}`);
  const m = measureOnHalf(cpu, led0);
  check('(aa-a) Lab 1 C: LED0 TẮT ở ~500k chu kỳ rồi SÁNG lại ở ~1000k (nửa chu kỳ ~500000 ±20%)',
    m.ok && Math.abs(m.tOff1 - 500000) <= 100000 && Math.abs(m.half - 500000) <= 100000,
    `tOff1=${m.tOff1} tOn=${m.tOn} half=${m.half}`);
}
// (aa-b) Lab 2 C: compile ok, LCD hiện HELLO, LED1 SÁNG rồi TẮT
{
  const { r, cpu, mapping } = runLabC(1, LAB2_C, 20000);
  const led1 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
  check('(aa-b) Lab 2 C: compileC ok, 0 lỗi, có program',
    r.ok && r.errors.length === 0 && r.program !== null, JSON.stringify(r.errors.slice(0, 2)));
  check('(aa-b) Lab 2 C: sau 20k chu kỳ LCD dòng 1 bắt đầu "HELLO"',
    r.ok && cpu.lcd.getLines()[0].startsWith('HELLO'),
    `line0=${JSON.stringify(cpu.lcd.getLines()[0])} errors=${JSON.stringify(r.errors.slice(0, 2))}`);
  check('(aa-b) Lab 2 C: LED1 SÁNG ở 20k chu kỳ, TẮT ở 600k, SÁNG lại ở 1200k',
    r.ok && led1() === true
    && (() => { runUntil(cpu, 600000); return led1() === false; })()
    && (() => { runUntil(cpu, 1200000); return led1() === true; })(),
    `on20k=${led1()} cycles=${cpu.cycles}`);
}
// (aa-c) C cơ bản: if/else, while, for, hàm, mảng, toán tử bit, PORTBbits, #define, __delay_ms
{
  const tIf = runC(`void main(){ TRISB = 0; TRISD = 0; if (1) PORTB = 0x55; else PORTB = 0; if (0) PORTD = 0xAA; else PORTD = 0x11; }`, 5000);
  check('(aa-c) if/else: if(1) -> PORTB=0x55, if(0) -> else PORTD=0x11',
    tIf.r.ok && tIf.cpu.readPort(1) === 0x55 && tIf.cpu.readPort(3) === 0x11,
    JSON.stringify(tIf.r.errors) + ` B=${tIf.cpu.readPort(1)} D=${tIf.cpu.readPort(3)}`);
  const tWhile = runC(`void main(){ TRISB = 0; TRISD = 0; int i = 0; while (i < 300) i++; PORTB = i; PORTD = i >> 8; }`, 20000);
  check('(aa-c) while đếm tới 300 (int 16-bit): PORTB=44 (byte thấp), PORTD=1 (byte cao)',
    tWhile.r.ok && tWhile.cpu.readPort(1) === 44 && tWhile.cpu.readPort(3) === 1,
    JSON.stringify(tWhile.r.errors) + ` B=${tWhile.cpu.readPort(1)} D=${tWhile.cpu.readPort(3)}`);
  const tFor = runC(`void main(){ TRISB = 0; int s = 0; for (int j = 0; j < 10; j++) s += j; PORTB = s; }`, 5000);
  check('(aa-c) for: tổng 0..9 = 45',
    tFor.r.ok && tFor.cpu.readPort(1) === 45,
    JSON.stringify(tFor.r.errors) + ` B=${tFor.cpu.readPort(1)}`);
  const tAdd = runC(`int add(int a, int b){ return a + b; }\nvoid main(){ TRISB = 0; PORTB = add(200, 100); }`, 5000);
  check('(aa-c) hàm có tham số + trả về: add(200,100)=300 -> PORTB=44 (byte thấp)',
    tAdd.r.ok && tAdd.cpu.readPort(1) === 44,
    JSON.stringify(tAdd.r.errors) + ` B=${tAdd.cpu.readPort(1)}`);
  const tArr = runC(`int a[3];\nvoid main(){ TRISB = 0; a[0] = 10; a[1] = 20; a[2] = a[0] + a[1]; PORTB = a[2]; }`, 5000);
  check('(aa-c) mảng: a[2]=a[0]+a[1]=30 -> PORTB=30',
    tArr.r.ok && tArr.cpu.readPort(1) === 30,
    JSON.stringify(tArr.r.errors) + ` B=${tArr.cpu.readPort(1)}`);
  const tBit = runC(`void main(){ TRISB = 0; TRISC = 0; TRISD = 0; PORTB = (0x5A ^ 0x3C); PORTC = ~0xF0; PORTD = (0xF0 & 0x0F) | (1 << 3); }`, 5000);
  check('(aa-c) toán tử bit: 0x5A^0x3C=0x66, ~0xF0=0x0F, (0xF0&0x0F)|(1<<3)=8',
    tBit.r.ok && tBit.cpu.readPort(1) === 0x66 && tBit.cpu.readPort(2) === 0x0F && tBit.cpu.readPort(3) === 8,
    JSON.stringify(tBit.r.errors) + ` B=${tBit.cpu.readPort(1)} C=${tBit.cpu.readPort(2)} D=${tBit.cpu.readPort(3)}`);
  const tBits = runC(`void main(){ TRISB = 0; PORTBbits.RB0 = 1; PORTBbits.RB1 = 1; PORTBbits.RB0 = 0; }`, 5000);
  check('(aa-c) PORTBbits.RB0/RB1: đặt 1,1 rồi xoá RB0 -> PORTB=0x02',
    tBits.r.ok && tBits.cpu.readPort(1) === 0x02,
    JSON.stringify(tBits.r.errors) + ` B=${tBits.cpu.readPort(1)}`);
  const tDef = runC(`#define VAL 0xA5\nvoid main(){ TRISB = 0; PORTB = VAL; }`, 5000);
  check('(aa-c) #define: PORTB=VAL (0xA5) -> 0xA5',
    tDef.r.ok && tDef.cpu.readPort(1) === 0xA5,
    JSON.stringify(tDef.r.errors) + ` B=${tDef.cpu.readPort(1)}`);
  // __delay_ms(10): đo bằng cạnh RB0 (TRISB=0 xong latch 0, rồi RB0=1,
  // rồi RB0=0 sau delay) — không đo từ chu kỳ 0 vì lúc reset RB0 đang
  // là ngõ vào đọc mức mặc định 1, dễ nhầm cạnh.
  const tDelay = runC(`void main(){ TRISB = 0; RB0 = 1; __delay_ms(10); RB0 = 0; }`, 0);
  const dt = (() => {
    const { cpu } = tDelay;
    let prev = cpu.readPort(1) & 1;
    let t1 = -1;
    let steps = 0;
    while (steps++ < 200000) {
      cpu.step();
      const b = cpu.readPort(1) & 1;
      if (prev === 0 && b === 1 && t1 < 0) t1 = cpu.cycles;
      else if (prev === 1 && b === 0 && t1 >= 0) return cpu.cycles - t1;
      prev = b;
    }
    return -1;
  })();
  check('(aa-c) __delay_ms(10) ~10000 chu kỳ (±20%)',
    tDelay.r.ok && dt >= 8000 && dt <= 12000,
    JSON.stringify(tDelay.r.errors) + ` dt=${dt}`);
}
// (aa-d) Số học 16-bit qua compileC (đọc lại bằng PORTB/PORTD)
{
  const cases = [
    ['300 + 200', 244, 1], ['1000 - 1', 231, 3], ['25 * 4', 100, 0],
    ['100 / 7', 14, 0], ['100 % 7', 2, 0], ['1 << 8', 0, 1],
  ];
  const expect = { '300 + 200': 500, '1000 - 1': 999, '25 * 4': 100, '100 / 7': 14, '100 % 7': 2, '1 << 8': 256 };
  for (const [expr, lo, hi] of cases) {
    const v = eval16(expr);
    check(`(aa-d) ${expr}=${expect[expr]} -> PORTB=${lo}, PORTD=${hi}`,
      v.r.ok && v.lo === lo && v.hi === hi,
      JSON.stringify(v.r.errors) + ` got B=${v.lo} D=${v.hi}`);
  }
}
// (aa-e) Lỗi C báo đúng dòng / đúng loại
{
  const eSemi = compileC(`#include <xc.h>\n#define _XTAL_FREQ 4000000\nvoid main(){\n  TRISB = 0\n  PORTB = 1;\n}`);
  check('(aa-e) thiếu ; báo đúng dòng 4 (dòng TRISB = 0), không sinh program',
    !eSemi.ok && eSemi.program === null && eSemi.errors.length > 0 && eSemi.errors[0].line === 4,
    JSON.stringify(eSemi.errors));
  const eUndecl = compileC(`void main(){ TRISB = 0; PORTB = foo; }`);
  check('(aa-e) biến chưa khai báo: báo tên foo, không sinh program',
    !eUndecl.ok && eUndecl.program === null && eUndecl.errors.some((e) => e.message.includes('foo')),
    JSON.stringify(eUndecl.errors));
  const eNoMain = compileC(`void foo(){ PORTB = 1; }`);
  check('(aa-e) hàm main thiếu: báo có chữ main, không sinh program',
    !eNoMain.ok && eNoMain.program === null && eNoMain.errors.some((e) => e.message.includes('main')),
    JSON.stringify(eNoMain.errors));
  const eRec = compileC(`int f(){ return f(); }\nvoid main(){ PORTB = f(); }`);
  check('(aa-e) gọi đệ quy: báo đệ quy, không sinh program',
    !eRec.ok && eRec.program === null && eRec.errors.some((e) => e.message.includes('đệ quy')),
    JSON.stringify(eRec.errors));
  const eDelayVar = compileC(`void main(){ int d = 10; TRISB = 0; __delay_ms(d); }`);
  check('(aa-e) __delay_ms với biến: báo cần hằng số, không sinh program',
    !eDelayVar.ok && eDelayVar.program === null && eDelayVar.errors.some((e) => e.message.includes('hằng số')),
    JSON.stringify(eDelayVar.errors));
  const ePtr = compileC(`char **p;\nvoid main(){ TRISB = 0; PORTB = 1; }`);
  check('(aa-e) con trỏ nhiều cấp (**p): báo "chưa hỗ trợ con trỏ", không sinh program',
    !ePtr.ok && ePtr.program === null && ePtr.errors.some((e) => e.message.includes('chưa hỗ trợ con trỏ')),
    JSON.stringify(ePtr.errors));
}
// (aa-f) lineToAddr: map dòng C -> địa chỉ lệnh đầu tiên của dòng đó
{
  const PRETTY_LAB1 = `#include <xc.h>
#define _XTAL_FREQ 4000000
void main(){
  TRISB = 0;
  while(1){
    RB0 = 1;
    __delay_ms(500);
    RB0 = 0;
    __delay_ms(500);
  }
}`;
  const r = compileC(PRETTY_LAB1);
  check('(aa-f) lineToAddr có map cho dòng while (5), RB0=1 (6), __delay_ms (7), TRISB=0 (4), RB0=0 (8)',
    r.ok && [4, 5, 6, 7, 8].every((l) => r.lineToAddr.has(l)),
    JSON.stringify([...r.lineToAddr.entries()]));
  check('(aa-f) dòng #include (1) / #define (2) KHÔNG map (không sinh lệnh)',
    r.ok && !r.lineToAddr.has(1) && !r.lineToAddr.has(2),
    JSON.stringify([...r.lineToAddr.entries()]));
  // Breakpoint theo dòng C: ProgramRunner giữ lineToAddr C (editor sẽ
  // gán runner.lineToAddr = r.lineToAddr sau khi loadProgram), đặt
  // breakpoint dòng 6 thì chạy tới đúng dòng 6 thì dừng.
  const cpu = createCPU();
  const runner = new ProgramRunner(cpu);
  const loaded = runner.loadAsm(r.asm);
  runner.lineToAddr = r.lineToAddr;
  runner.addrToLine = new Map([...r.lineToAddr].map(([l, a]) => [a, l]));
  const kept6 = runner.setBreakpointLines([6]);
  const kept1 = runner.setBreakpointLines([1]);
  runner.setBreakpointLines([6]);
  runner.run();
  const st = runner.tick(50000);
  check('(aa-f) breakpoint dòng 6 đặt được, dòng 1 (không map) bị loại',
    loaded.ok && JSON.stringify(kept6) === '[6]' && JSON.stringify(kept1) === '[]',
    JSON.stringify({ kept6, kept1 }));
  check('(aa-f) chạy tới breakpoint thì dừng đúng dòng C 6 (RB0 = 1)',
    st.pauseReason === 'breakpoint' && st.line === 6,
    JSON.stringify(st));
}
// (aa-g) asm trả kèm: hợp ngữ thật, không còn từ khoá C
{
  const r = compileC(LAB1_C);
  check('(aa-g) asm chứa "ORG 0" và "BANKSEL"',
    r.ok && r.asm.includes('ORG 0') && r.asm.includes('BANKSEL'), r.asm.slice(0, 120));
  check('(aa-g) asm không chứa từ khoá C: "while(", "void main", "#include"',
    r.ok && !r.asm.includes('while(') && !r.asm.includes('void main') && !r.asm.includes('#include'),
    r.asm.slice(0, 200));
}

// (ab-a) Code mẫu lab trong labs.js: chuỗi C, compile ok, 0 lỗi
{
  for (let i = 0; i < 2; i++) {
    const code = LABS[i].code;
    const r = compileC(typeof code === 'string' ? code : '');
    check(`(ab-a) LABS[${i}].code là chuỗi C (có "#include <xc.h>" và "void main"), compileC ok 0 lỗi`,
      typeof code === 'string' && code.includes('#include <xc.h>') && code.includes('void main')
      && r.ok && r.errors.length === 0 && r.program !== null,
      JSON.stringify((r.errors || []).slice(0, 2)));
  }
}
// (ab-b) Chạy code mẫu lab trên đúng board lab: Lab 1 LED0 SÁNG rồi TẮT;
// Lab 2 LCD dòng 1 "HELLO", LED1 SÁNG rồi TẮT
{
  const { r, cpu, mapping } = runLabC(0, LABS[0].code, 100000);
  const led0 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED0').on;
  const on100k = led0();
  const m = measureOnHalf(cpu, led0);
  check('(ab-b) Lab 1 code mẫu: LED0 SÁNG ở 100k chu kỳ, TẮT ở ~500k rồi SÁNG lại (nửa chu kỳ ~500000 ±20%)',
    r.ok && on100k === true
    && m.ok && Math.abs(m.tOff1 - 500000) <= 100000 && Math.abs(m.half - 500000) <= 100000,
    `on100k=${on100k} tOff1=${m.tOff1} tOn=${m.tOn} half=${m.half}`);
  const l2 = runLabC(1, LABS[1].code, 20000);
  const led1 = () => ledStates(l2.cpu, l2.mapping).find((s) => s.id === 'LED1').on;
  check('(ab-b) Lab 2 code mẫu: LCD dòng 1 bắt đầu "HELLO"',
    l2.r.ok && l2.cpu.lcd.getLines()[0].startsWith('HELLO'),
    `line0=${JSON.stringify(l2.cpu.lcd.getLines()[0])} errors=${JSON.stringify(l2.r.errors.slice(0, 2))}`);
  check('(ab-b) Lab 2 code mẫu: LED1 SÁNG ở 20k chu kỳ, TẮT ở 600k, SÁNG lại ở 1200k',
    l2.r.ok && led1() === true
    && (() => { runUntil(l2.cpu, 600000); return led1() === false; })()
    && (() => { runUntil(l2.cpu, 1200000); return led1() === true; })(),
    `on20k=${led1()} cycles=${l2.cpu.cycles}`);
}
// (ab-c) lineToAddr của code mẫu Lab 1: có map cho dòng "TRISB = 0" và
// dòng "RB0 = 1" (tìm số dòng bằng split, không hard-code tuyệt đối)
{
  const lines = LABS[0].code.split('\n');
  const trisLine = lines.findIndex((l) => l.includes('TRISB = 0')) + 1;
  const rb0Line = lines.findIndex((l) => l.includes('RB0 = 1')) + 1;
  const r = compileC(LABS[0].code);
  check(`(ab-c) code mẫu Lab 1: lineToAddr có map cho dòng "TRISB = 0" (dòng ${trisLine}) và "RB0 = 1" (dòng ${rb0Line})`,
    r.ok && trisLine > 0 && rb0Line > 0 && r.lineToAddr.has(trisLine) && r.lineToAddr.has(rb0Line),
    JSON.stringify([...r.lineToAddr.entries()]));
}
// (ab-d) Code mẫu mặc định không còn hợp ngữ cũ
{
  check('(ab-d) code mẫu Lab 1 không chứa hợp ngữ cũ: "BSF PORTB", "BANKSEL", "ORG 0"',
    !LABS[0].code.includes('BSF PORTB') && !LABS[0].code.includes('BANKSEL') && !LABS[0].code.includes('ORG 0'),
    LABS[0].code.split('\n').slice(0, 3).join(' / '));
}

// ===========================================================================
// (ac) CON TRỎ 1 CẤP (v=20261125ap): tham số con trỏ, *p, &x, p[i], p+n,
// p++, p--, p+=, so sánh, p-q, cast con trỏ; lỗi **p, p->x, mảng con trỏ.
// Mọi test chạy trên CPU thật, assert giá trị RAM đọc lại qua PORTB/PORTD.
// ===========================================================================
// (ac-a) Tham số con trỏ + pattern[i]; truyền mảng vào con trỏ (decay);
// &a[i] + *p ghi
{
  const tGet = runC(`unsigned char getAt(unsigned char *p, unsigned char i){ return p[i]; }\nvoid main(){ TRISB = 0; unsigned char a[4] = {10, 20, 30, 40}; PORTB = getAt(a, 2); }`, 5000);
  check('(ac-a) tham số con trỏ + p[i]: getAt(a,2)=30 (mảng truyền vào decay thành địa chỉ)',
    tGet.r.ok && tGet.cpu.readPort(1) === 30,
    JSON.stringify(tGet.r.errors) + ` B=${tGet.cpu.readPort(1)}`);
  const tSum = runC(`const unsigned char pat[8] = {1, 2, 3, 4, 5, 6, 7, 8};\nunsigned char sum(unsigned char *p){ unsigned char s = 0; unsigned char i; for (i = 0; i < 8; i++) s += p[i]; return s; }\nvoid main(){ TRISB = 0; PORTB = sum(pat); }`, 5000);
  check('(ac-a) vòng lặp pattern[i] kiểu LCD_CreateChar: sum(1..8)=36',
    tSum.r.ok && tSum.cpu.readPort(1) === 36,
    JSON.stringify(tSum.r.errors) + ` B=${tSum.cpu.readPort(1)}`);
  const tPut = runC(`void put(unsigned char *p, unsigned char v){ *p = v; }\nvoid main(){ TRISB = 0; unsigned char a[3]; put(&a[1], 0x5A); PORTB = a[1]; }`, 5000);
  check('(ac-a) &a[1] + *p ghi: a[1]=0x5A',
    tPut.r.ok && tPut.cpu.readPort(1) === 0x5A,
    JSON.stringify(tPut.r.errors) + ` B=${tPut.cpu.readPort(1)}`);
}
// (ac-b) *p đọc/ghi: char* và int* (int* đọc/ghi đủ 2 byte little-endian)
{
  const tInt = runC(`void main(){ TRISB = 0; TRISD = 0; int x = 0x1234; int *p = &x; *p = 0x5678; PORTB = x; PORTD = x >> 8; }`, 5000);
  check('(ac-b) int* ghi: *p=0x5678 -> x=0x5678 (PORTB=0x78, PORTD=0x56)',
    tInt.r.ok && tInt.cpu.readPort(1) === 0x78 && tInt.cpu.readPort(3) === 0x56,
    JSON.stringify(tInt.r.errors) + ` B=${tInt.cpu.readPort(1)} D=${tInt.cpu.readPort(3)}`);
  const tIntR = runC(`void main(){ TRISB = 0; TRISD = 0; int x = 0x1234; int *p = &x; PORTB = *p; PORTD = *p >> 8; }`, 5000);
  check('(ac-b) int* đọc: *p=0x1234 -> PORTB=0x34, PORTD=0x12',
    tIntR.r.ok && tIntR.cpu.readPort(1) === 0x34 && tIntR.cpu.readPort(3) === 0x12,
    JSON.stringify(tIntR.r.errors) + ` B=${tIntR.cpu.readPort(1)} D=${tIntR.cpu.readPort(3)}`);
  const tChar = runC(`void main(){ TRISB = 0; unsigned char c = 0; unsigned char *q = &c; *q = 0xA5; PORTB = c; }`, 5000);
  check('(ac-b) char* ghi: *q=0xA5 -> c=0xA5',
    tChar.r.ok && tChar.cpu.readPort(1) === 0xA5,
    JSON.stringify(tChar.r.errors) + ` B=${tChar.cpu.readPort(1)}`);
  const tCharR = runC(`void main(){ TRISB = 0; unsigned char c = 0x3C; unsigned char *q = &c; PORTB = *q; }`, 5000);
  check('(ac-b) char* đọc: c=0x3C -> *q=0x3C',
    tCharR.r.ok && tCharR.cpu.readPort(1) === 0x3C,
    JSON.stringify(tCharR.r.errors) + ` B=${tCharR.cpu.readPort(1)}`);
}
// (ac-c) p+i (char* nhảy 1, int* nhảy 2); p++/p-- (int* nhảy 2 byte); p+=
{
  const tPc = runC(`void main(){ TRISB = 0; unsigned char a[4] = {11, 22, 33, 44}; unsigned char *p = a; PORTB = *(p + 2); }`, 5000);
  check('(ac-c) char* + 2 nhảy 2 byte: *(p+2)=33',
    tPc.r.ok && tPc.cpu.readPort(1) === 33,
    JSON.stringify(tPc.r.errors) + ` B=${tPc.cpu.readPort(1)}`);
  const tPi = runC(`void main(){ TRISB = 0; TRISD = 0; int b[3] = {0x1111, 0x2222, 0x3333}; int *q = b; int v = *(q + 1); PORTB = v; PORTD = v >> 8; }`, 5000);
  check('(ac-c) int* + 1 nhảy 2 byte: *(q+1)=0x2222 (PORTB=0x22, PORTD=0x22)',
    tPi.r.ok && tPi.cpu.readPort(1) === 0x22 && tPi.cpu.readPort(3) === 0x22,
    JSON.stringify(tPi.r.errors) + ` B=${tPi.cpu.readPort(1)} D=${tPi.cpu.readPort(3)}`);
  const tPp = runC(`void main(){ TRISB = 0; unsigned char a[3] = {7, 8, 9}; unsigned char *p = a; p++; PORTB = *p; }`, 5000);
  check('(ac-c) char* p++ nhảy 1: *p=8',
    tPp.r.ok && tPp.cpu.readPort(1) === 8,
    JSON.stringify(tPp.r.errors) + ` B=${tPp.cpu.readPort(1)}`);
  const tIp = runC(`void main(){ TRISB = 0; int b[3] = {100, 200, 300}; int *q = b; q++; PORTB = *q; }`, 5000);
  check('(ac-c) int* q++ nhảy 2 byte: *q=200',
    tIp.r.ok && tIp.cpu.readPort(1) === 200,
    JSON.stringify(tIp.r.errors) + ` B=${tIp.cpu.readPort(1)}`);
  const tIm = runC(`void main(){ TRISB = 0; int b[3] = {100, 200, 300}; int *q = b; q++; q--; PORTB = *q; }`, 5000);
  check('(ac-c) int* q++ rồi q-- về chỗ cũ: *q=100',
    tIm.r.ok && tIm.cpu.readPort(1) === 100,
    JSON.stringify(tIm.r.errors) + ` B=${tIm.cpu.readPort(1)}`);
  const tPa = runC(`void main(){ TRISB = 0; TRISD = 0; int b[3] = {100, 200, 300}; int *q = b; q += 2; PORTB = *q; PORTD = *q >> 8; }`, 5000);
  check('(ac-c) int* q+=2 nhảy 4 byte: *q=300 (PORTB=44, PORTD=1)',
    tPa.r.ok && tPa.cpu.readPort(1) === 44 && tPa.cpu.readPort(3) === 1,
    JSON.stringify(tPa.r.errors) + ` B=${tPa.cpu.readPort(1)} D=${tPa.cpu.readPort(3)}`);
  const tIdx = runC(`void main(){ TRISB = 0; int b[3] = {100, 200, 300}; int *q = b; PORTB = q[2]; }`, 5000);
  check('(ac-c) q[2] với con trỏ int: 300 -> PORTB=44 (byte thấp)',
    tIdx.r.ok && tIdx.cpu.readPort(1) === 44,
    JSON.stringify(tIdx.r.errors) + ` B=${tIdx.cpu.readPort(1)}`);
}
// (ac-d) &x, &arr[0], &arr[1], cast tới con trỏ
{
  const tAx = runC(`void main(){ TRISB = 0; TRISD = 0; int x = 0x3456; int *p = &x; PORTB = *p; PORTD = *p >> 8; }`, 5000);
  check('(ac-d) &x: p=&x, *p=0x3456 (PORTB=0x56, PORTD=0x34)',
    tAx.r.ok && tAx.cpu.readPort(1) === 0x56 && tAx.cpu.readPort(3) === 0x34,
    JSON.stringify(tAx.r.errors) + ` B=${tAx.cpu.readPort(1)} D=${tAx.cpu.readPort(3)}`);
  const tA0 = runC(`void main(){ TRISB = 0; unsigned char a[2] = {0xAB, 0xCD}; unsigned char *q = &a[0]; PORTB = *q; }`, 5000);
  check('(ac-d) &a[0]: *q=0xAB',
    tA0.r.ok && tA0.cpu.readPort(1) === 0xAB,
    JSON.stringify(tA0.r.errors) + ` B=${tA0.cpu.readPort(1)}`);
  const tA1 = runC(`void main(){ TRISB = 0; unsigned char a[2] = {0xAB, 0xCD}; unsigned char *q = &a[1]; PORTB = *q; }`, 5000);
  check('(ac-d) &a[1]: *q=0xCD',
    tA1.r.ok && tA1.cpu.readPort(1) === 0xCD,
    JSON.stringify(tA1.r.errors) + ` B=${tA1.cpu.readPort(1)}`);
  const tCast = runC(`void main(){ TRISB = 0; unsigned char a[3] = {9, 8, 7}; unsigned char *p; p = (unsigned char *)a; PORTB = *p; }`, 5000);
  check('(ac-d) cast (unsigned char *)a: *p=9',
    tCast.r.ok && tCast.cpu.readPort(1) === 9,
    JSON.stringify(tCast.r.errors) + ` B=${tCast.cpu.readPort(1)}`);
  const tRet = runC(`unsigned char *first(unsigned char *a){ return a; }\nvoid main(){ TRISB = 0; unsigned char a[2] = {0x77, 0x66}; PORTB = *first(a); }`, 5000);
  check('(ac-d) hàm trả con trỏ: *first(a)=0x77',
    tRet.r.ok && tRet.cpu.readPort(1) === 0x77,
    JSON.stringify(tRet.r.errors) + ` B=${tRet.cpu.readPort(1)}`);
}
// (ac-e) So sánh con trỏ (==, !=, <) và p - q (chia theo elemWidth)
{
  const tCmp = runC(`void main(){ TRISB = 0; TRISC = 0; TRISD = 0; unsigned char a[4] = {1, 2, 3, 4}; unsigned char *p = a; unsigned char *q = a + 2; PORTB = (p == q); PORTC = (p != q); PORTD = (p < q); }`, 5000);
  check('(ac-e) so sánh con trỏ: p==q -> 0, p!=q -> 1, p<q -> 1',
    tCmp.r.ok && tCmp.cpu.readPort(1) === 0 && tCmp.cpu.readPort(2) === 1 && tCmp.cpu.readPort(3) === 1,
    JSON.stringify(tCmp.r.errors) + ` B=${tCmp.cpu.readPort(1)} C=${tCmp.cpu.readPort(2)} D=${tCmp.cpu.readPort(3)}`);
  const tDq = runC(`void main(){ TRISB = 0; unsigned char a[4] = {1, 2, 3, 4}; unsigned char *p = a; unsigned char *q = a + 2; int d = q - p; PORTB = d; }`, 5000);
  check('(ac-e) char* q-p = 2 (hiệu số phần tử)',
    tDq.r.ok && tDq.cpu.readPort(1) === 2,
    JSON.stringify(tDq.r.errors) + ` B=${tDq.cpu.readPort(1)}`);
  const tDi = runC(`void main(){ TRISB = 0; int b[4] = {0, 0, 0, 0}; int *x = b; int *y = b + 3; int d = y - x; PORTB = d; }`, 5000);
  check('(ac-e) int* y-x = 3 (hiệu byte 6 chia 2)',
    tDi.r.ok && tDi.cpu.readPort(1) === 3,
    JSON.stringify(tDi.r.errors) + ` B=${tDi.cpu.readPort(1)}`);
  const tIf = runC(`void main(){ TRISB = 0; unsigned char a[2] = {5, 6}; unsigned char *p = a; if (p) PORTB = *p; }`, 5000);
  check('(ac-e) if (p): con trỏ khác 0 là đúng -> PORTB=5',
    tIf.r.ok && tIf.cpu.readPort(1) === 5,
    JSON.stringify(tIf.r.errors) + ` B=${tIf.cpu.readPort(1)}`);
}
// (ac-f) Lỗi con trỏ: **p, p->x, mảng con trỏ, *biến-thường, &bit
{
  const eMulti = compileC(`char **p;\nvoid main(){ TRISB = 0; PORTB = 1; }`);
  check('(ac-f) **p: báo "chưa hỗ trợ con trỏ nhiều cấp", không sinh program',
    !eMulti.ok && eMulti.program === null && eMulti.errors.some((e) => e.message.includes('chưa hỗ trợ con trỏ nhiều cấp')),
    JSON.stringify(eMulti.errors));
  const eArrow = compileC(`int *p;\nvoid main(){ TRISB = 0; p->x = 1; }`);
  check('(ac-f) p->x: báo "chưa hỗ trợ p->x", không sinh program',
    !eArrow.ok && eArrow.program === null && eArrow.errors.some((e) => e.message.includes('p->x')),
    JSON.stringify(eArrow.errors));
  const eArrPtr = compileC(`char *a[3];\nvoid main(){ TRISB = 0; PORTB = 1; }`);
  check('(ac-f) mảng con trỏ char *a[3]: báo "chưa hỗ trợ mảng con trỏ", không sinh program',
    !eArrPtr.ok && eArrPtr.program === null && eArrPtr.errors.some((e) => e.message.includes('chưa hỗ trợ mảng con trỏ')),
    JSON.stringify(eArrPtr.errors));
  const eDeref = compileC(`void main(){ int x = 5; *x = 1; }`);
  check('(ac-f) *x với x là int (không phải con trỏ): báo "không phải con trỏ", không sinh program',
    !eDeref.ok && eDeref.program === null && eDeref.errors.some((e) => e.message.includes('không phải con trỏ')),
    JSON.stringify(eDeref.errors));
  const eAddrBit = compileC(`void main(){ int *p; p = &RB0; }`);
  check('(ac-f) &RB0: báo "không lấy địa chỉ của bit", không sinh program',
    !eAddrBit.ok && eAddrBit.program === null && eAddrBit.errors.some((e) => e.message.includes('không lấy địa chỉ của bit')),
    JSON.stringify(eAddrBit.errors));
}
// (ac-g) Code thật của Điệp (test/fixtures/diep-lcd-scroll.c): LCD cuộn "Hello Diep"
// (ký tự tự tạo Đ=0, ệ=1) + LED RB1 nháy mỗi bước, chạy trên board led-lcd.
// Chuỗi kỳ vọng tính bằng code từ message (mã 0/1 hiện thành ' ' vì LCD
// chưa mô phỏng CGRAM — xem ghi chú trong báo cáo).
{
  let diepSrc = null;
  try { diepSrc = readFixture('diep-lcd-scroll.c'); } catch (e) { diepSrc = null; }
  check('(ac-g) đọc được test/fixtures/diep-lcd-scroll.c', typeof diepSrc === 'string' && diepSrc.length > 0,
    diepSrc === null ? 'không đọc được file' : `dài ${diepSrc.length} ký tự`);
  if (diepSrc) {
    const r = compileC(diepSrc);
    check('(ac-g) code Điệp compileC ok, 0 lỗi',
      r.ok && r.errors.length === 0 && r.program !== null, JSON.stringify((r.errors || []).slice(0, 2)));
    const { state } = buildLabState(getLab('led-lcd'));
    const mapping = resolvePeripherals(benchToNetlist(state));
    const cpu = createCPU();
    cpu.setWiring(mapping);
    if (r.ok && r.program) cpu.loadProgram(r.program);
    const led1 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
    const MSG = ['H', 'e', 'l', 'l', 'o', ' ', 0, 'i', 1, 'p'];
    const expLine = (pos) => {
      let s = '';
      for (let col = 0; col < 16; col++) {
        const ix = col - pos;
        let ch = ' ';
        if (ix >= 0 && ix < 10) { const m = MSG[ix]; ch = (typeof m === 'number') ? ' ' : m; }
        s += ch;
      }
      return s;
    };
    // Lấy mẫu 11 bước cuộn (pos 15..5): mỗi khi dòng 1 đổi, đợi thêm
    // 100k chu kỳ (ghi xong hàng + LED đã đổi) rồi ghi lại (line, led).
    const samples = [];
    let last = cpu.lcd.getLines()[0];
    let guard = 0;
    // 11 bước x ~1,26M chu kỳ/bước + khởi tạo ~0,4M: cần ~15M chu kỳ,
    // tức ~750 lần chạy 20k chu kỳ — guard 1000 cho dư.
    while (samples.length < 11 && guard++ < 1000) {
      runUntil(cpu, cpu.cycles + 20000);
      const l0 = cpu.lcd.getLines()[0];
      if (l0 !== last) {
        last = l0;
        runUntil(cpu, cpu.cycles + 100000);
        const cur = cpu.lcd.getLines()[0];
        samples.push({ line: cur, led: led1() });
        last = cur;
      }
    }
    const expected = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map(expLine);
    check('(ac-g) LCD cuộn đúng 11 bước liên tiếp pos=15..5 ("               H" -> "     Hello  i p ")',
      r.ok && JSON.stringify(samples.map((s) => s.line)) === JSON.stringify(expected),
      `got=${JSON.stringify(samples.map((s) => s.line))}`);
    check('(ac-g) LED RB1 đổi trạng thái mỗi bước cuộn (xen kẽ SÁNG/TẮT)',
      r.ok && samples.length === 11
      && samples.every((s, i) => s.led === (i % 2 === 0)),
      `leds=${samples.map((s) => (s.led ? 1 : 0)).join(',')}`);
    check('(ac-g) dòng 2 LCD vẫn trống trong lúc cuộn',
      r.ok && cpu.lcd.getLines()[1] === '                ',
      `line1=${JSON.stringify(cpu.lcd.getLines()[1])}`);
    check('(ac-g) mã ký tự tự tạo 0 (Đ) và 1 (ệ) có trong DDRAM thô ở bước pos=5 nhưng hiện thành khoảng trắng (CGRAM chưa mô phỏng)',
      r.ok && samples.length === 11 && samples[10].line === expLine(5)
      && cpu.lcd.ddram[11] === 0 && cpu.lcd.ddram[13] === 1,
      `line=${JSON.stringify(samples.length ? samples[10].line : '')} ddram[11]=${cpu.lcd.ddram[11]} ddram[13]=${cpu.lcd.ddram[13]}`);
  } else {
    check('(ac-g) code Điệp compileC ok, 0 lỗi (bỏ qua: không đọc được file)', false, 'không đọc được test/fixtures/diep-lcd-scroll.c');
  }
}

// (ad) DELAY ĐÚNG CHU KỲ Ở MỌI TẦN SỐ (v=20261125ap) — phát hiện sau vụ
// con trỏ: parent đo __delay_ms(250)@20MHz bằng cách ĐẾM SỐ LẦN step()
// được 831207 và tưởng delay ngắn 1,5 lần. Thực ra step() = 1 lệnh,
// còn chu kỳ lệnh mới là đơn vị thời gian: GOTO/CALL tốn 2 chu kỳ/1 step
// nên đếm step chỉ ra ~2/3 số chu kỳ (831207/1250020 = 0,665). Đo đúng
// phải đo HIỆU cpu.cycles giữa 2 cạnh RB0 (mẫu (aa-c)). Nhóm này khóa
// cách đo đúng + độ chính xác chu kỳ ở 4/8/10/20MHz + việc compileC trả
// xtalFreq để app.js đặt cpu.clockHz theo code (không thì code 20MHz
// chạy chậm 5 lần giờ thực vì runner vẫn nhịp theo 4MHz).
// (ad-a) Độ chính xác chu kỳ delay (đo bằng cpu.cycles, cạnh RB0)
{
  // Đo delay bằng hiệu cpu.cycles giữa cạnh lên và cạnh xuống của RB0.
  // src: chương trình RB0=1 -> delay -> RB0=0. Trả -1 nếu không thấy cạnh.
  const delayCycles = (src, maxSteps) => {
    const r = compileC(src);
    if (!r.ok) return { ok: false, dt: -1, steps: -1, errors: r.errors };
    const cpu = createCPU();
    cpu.loadProgram(r.program);
    let prev = cpu.readPort(1) & 1;
    let t1 = -1;
    let steps = 0;
    let s1 = -1;
    while (steps++ < maxSteps) {
      cpu.step();
      const b = cpu.readPort(1) & 1;
      if (prev === 0 && b === 1 && t1 < 0) { t1 = cpu.cycles; s1 = steps; }
      else if (prev === 1 && b === 0 && t1 >= 0) return { ok: true, dt: cpu.cycles - t1, steps: steps - s1, errors: [] };
      prev = b;
    }
    return { ok: true, dt: -1, steps: -1, errors: [] };
  };
  const dl = (freq, code) => `#include <xc.h>\n#define _XTAL_FREQ ${freq}\nvoid main(){ TRISB=0; RB0=1; ${code}; RB0=0; while(1){} }`;
  const cases = [
    // [tên, src, kỳ vọng chu kỳ, dung sai]
    ['__delay_ms(250) @20MHz', dl(20000000, '__delay_ms(250)'), 1250000, 0.01],
    ['__delay_ms(500) @4MHz', dl(4000000, '__delay_ms(500)'), 500000, 0.01],
    ['__delay_ms(100) @20MHz', dl(20000000, '__delay_ms(100)'), 500000, 0.01],
    ['__delay_ms(1000) @8MHz', dl(8000000, '__delay_ms(1000)'), 2000000, 0.01],
    ['__delay_ms(1000) @20MHz', dl(20000000, '__delay_ms(1000)'), 5000000, 0.01],
    ['__delay_ms(100) @10MHz', dl(10000000, '__delay_ms(100)'), 250000, 0.01],
    ['__delay_ms(40) @20MHz (LCD_Init)', dl(20000000, '__delay_ms(40)'), 200000, 0.01],
    ['__delay_ms(2) @20MHz (LCD_Command)', dl(20000000, '__delay_ms(2)'), 10000, 0.01],
    ['__delay_ms(1) @4MHz', dl(4000000, '__delay_ms(1)'), 1000, 0.02],
    ['__delay_us(100) @20MHz', dl(20000000, '__delay_us(100)'), 500, 0.05],
    ['__delay_us(50) @20MHz (LCD_Pulse)', dl(20000000, '__delay_us(50)'), 250, 0.10],
  ];
  for (const [name, src, expect, tol] of cases) {
    const m = delayCycles(src, Math.ceil(expect * 2) + 100000);
    const lo = expect * (1 - tol), hi = expect * (1 + tol);
    check(`(ad-a) ${name}: ~${expect} chu kỳ (±${Math.round(tol * 100)}%)`,
      m.ok && m.dt >= lo && m.dt <= hi,
      JSON.stringify(m.errors) + ` dt=${m.dt}`);
  }
  // Delay rất nhỏ (__delay_us(2) = 10 chu kỳ, đường NOP): chi phí ghi
  // RB0 + lấy mẫu cạnh (~12 chu kỳ) át cả delay nên chỉ khóa "vẫn ngắn"
  // (< 40 chu kỳ cạnh-cạnh), không khóa giá trị tuyệt đối.
  const mUs2 = delayCycles(dl(20000000, '__delay_us(2)'), 100000);
  check('(ad-a) __delay_us(2) @20MHz: delay rất nhỏ, cạnh-cạnh < 40 chu kỳ',
    mUs2.ok && mUs2.dt >= 0 && mUs2.dt < 40,
    JSON.stringify(mUs2.errors) + ` dt=${mUs2.dt}`);
}

// (ad-b) BẪY ĐẾM STEP: __delay_ms(250)@20MHz đếm step chỉ ~831k nhưng
// cpu.cycles đúng ~1,25M — khóa để sau này không ai "sửa" delay theo
// số step nữa (GOTO 2 chu kỳ/1 step nên step/chu kỳ ~0,665).
{
  const src = '#include <xc.h>\n#define _XTAL_FREQ 20000000\nvoid main(){ TRISB=0; RB0=1; __delay_ms(250); RB0=0; while(1){} }';
  const r = compileC(src);
  const cpu = createCPU();
  if (r.ok) cpu.loadProgram(r.program);
  let prev = cpu.readPort(1) & 1;
  let t1 = -1, s1 = -1, steps = 0, dt = -1, dsteps = -1;
  while (steps++ < 3000000) {
    cpu.step();
    const b = cpu.readPort(1) & 1;
    if (prev === 0 && b === 1 && t1 < 0) { t1 = cpu.cycles; s1 = steps; }
    else if (prev === 1 && b === 0 && t1 >= 0) { dt = cpu.cycles - t1; dsteps = steps - s1; break; }
    prev = b;
  }
  check('(ad-b) __delay_ms(250)@20MHz: cpu.cycles ~1250000 (±1%) nhưng số step chỉ ~831k (tỷ lệ step/cycle ~0,665)',
    r.ok && dt >= 1237500 && dt <= 1262500 && dsteps >= 800000 && dsteps <= 860000 && dsteps / dt < 0.7,
    `cycles=${dt} steps=${dsteps} ratio=${dt > 0 ? (dsteps / dt).toFixed(3) : '?'}`);
}

// (ad-c) compileC trả xtalFreq (để app.js đặt cpu.clockHz theo code)
{
  const c20 = compileC('#include <xc.h>\n#define _XTAL_FREQ 20000000\nvoid main(){ TRISB=0; }');
  const c4 = compileC('void main(){ TRISB=0; }');
  const c8 = compileC('#include <xc.h>\n#define _XTAL_FREQ 8000000\nvoid main(){ TRISB=0; }');
  check('(ad-c) compileC trả xtalFreq: 20MHz -> 20000000, mặc định -> 4000000, 8MHz -> 8000000',
    c20.ok && c20.xtalFreq === 20000000 && c4.ok && c4.xtalFreq === 4000000 && c8.ok && c8.xtalFreq === 8000000,
    `20M=${c20.xtalFreq} macdinh=${c4.xtalFreq} 8M=${c8.xtalFreq}`);
}

// (ad-d) Nhịp giờ thực theo clockHz: 50ms ở 20MHz = 250000 chu kỳ.
// LƯU Ý: cyclesForElapsedMs chặn trên mặc định 500000 chu kỳ/tick
// (chống chạy bù vô hạn khi tab bị ẩn) nên 250ms@20MHz (=1250000)
// với cap mặc định chỉ ra 500000 — muốn đủ phải truyền maxCycles lớn.
{
  check('(ad-d) cyclesForElapsedMs theo tần số code: 50ms@20MHz=250000, 50ms@10MHz=125000, 1000ms@20MHz=5000000 (cap lớn), 250ms@20MHz bị chặn 500000 bởi cap mặc định',
    cyclesForElapsedMs(50, 20000000) === 250000
    && cyclesForElapsedMs(50, 10000000) === 125000
    && cyclesForElapsedMs(1000, 20000000, 10000000) === 5000000
    && cyclesForElapsedMs(250, 20000000) === 500000,
    `50ms@20M=${cyclesForElapsedMs(50, 20000000)} 250ms@20M=${cyclesForElapsedMs(250, 20000000)}`);
}

// (ad-e) Nhịp nháy LED ở 20MHz: 1 chu kỳ ON+OFF (2x250ms) ~2,5M chu kỳ;
// code cuộn LCD của Điệp: khoảng cách 2 lần LED RB1 đổi trạng thái liên
// tiếp ~1,25M chu kỳ (delay 250ms + lệnh LCD mỗi bước).
{
  const blink = compileC('#include <xc.h>\n#define _XTAL_FREQ 20000000\nvoid main(){ TRISB=0; while(1){ RB0=1; __delay_ms(250); RB0=0; __delay_ms(250); } }');
  const cpuB = createCPU();
  if (blink.ok) cpuB.loadProgram(blink.program);
  let prev = cpuB.readPort(1) & 1;
  let first = -1, period = -1, steps = 0;
  while (steps++ < 10000000) {
    cpuB.step();
    const b = cpuB.readPort(1) & 1;
    if (prev === 0 && b === 1) {
      if (first < 0) first = cpuB.cycles;
      else { period = cpuB.cycles - first; break; }
    }
    prev = b;
  }
  check('(ad-e) Nháy LED @20MHz: chu kỳ ON+OFF ~2500000 chu kỳ (±1%)',
    blink.ok && period >= 2475000 && period <= 2525000,
    `period=${period}`);
  // Code cuộn của Điệp (nếu đọc được file): LED đổi trạng thái mỗi bước.
  let diepSrc = null;
  try { diepSrc = readFixture('diep-lcd-scroll.c'); } catch (e) { diepSrc = null; }
  if (diepSrc) {
    const r = compileC(diepSrc);
    const { state } = buildLabState(getLab('led-lcd'));
    const mapping = resolvePeripherals(benchToNetlist(state));
    const cpu = createCPU();
    cpu.setWiring(mapping);
    if (r.ok && r.program) cpu.loadProgram(r.program);
    const led1 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
    let prevLed = led1();
    let tPrev = -1, gap = -1, guard = 0;
    // Chờ qua khởi tạo + 2 lần LED đổi trạng thái (mỗi lần cách ~1,26M
    // chu kỳ): chạy từng chặng 20k chu kỳ, tối đa ~6M chu kỳ.
    while (guard++ < 300 && gap < 0) {
      runUntil(cpu, cpu.cycles + 20000);
      const cur = led1();
      if (cur !== prevLed) {
        if (tPrev < 0) tPrev = cpu.cycles;
        else { gap = cpu.cycles - tPrev; break; }
        prevLed = cur;
      }
    }
    check('(ad-e) Code cuộn LCD @20MHz: 2 lần LED RB1 đổi trạng thái liên tiếp cách nhau ~1,25-1,35M chu kỳ (250ms + lệnh LCD)',
      r.ok && gap >= 1200000 && gap <= 1400000,
      `gap=${gap}`);
  } else {
    check('(ad-e) Code cuộn LCD @20MHz (bỏ qua: không đọc được test/fixtures/diep-lcd-scroll.c)', false, 'không đọc được file');
  }
}

// (ae) CBLOCK BANK 2/3 (v=20261125aq) — NGUYÊN NHÂN GỐC VỤ KẸT CODE 2 HÀNG.
// Lỗi: assembler pic16.js cắt địa chỉ CBLOCK còn 8-bit ("v & 0xff") nên
// CBLOCK 0x110 (bank 2) thành 0x10 (bank 0). Codegen cấp phát đúng
// (USER_BANKS: bank1 0xA0-0xEF, bank2 0x110-0x16F, bank3 0x190-0x1EF)
// nhưng assembler gán symbol bank 2/3 về bank 0, làm biến cục bộ
// (title[] 17B + i/j/len) CHỒNG lên biến tạm __C_T1/__C_T2/__C_T3 và
// thanh ghi SFR: title[] ghi vào T1CON/TMR2..., len/i/j bị con trỏ
// text[i+j] ghi đè (__C_T2 == j) nên vòng lặp cuộn kẹt trong delay,
// LCD chỉ hiện 'c'. Chỉ cần khai báo thêm mảng thứ hai (dù không dùng)
// cũng đủ gây kẹt vì nó đẩy i/j/len sang bank 2. Sửa: "v & 0x1ff"
// (RAM 9-bit, 0x000-0x1FF).
// (ae-a) Assembler: CBLOCK 0x110/0x190 gán đúng địa chỉ 9-bit.
{
  const asm = assemble(`
    ORG 0
    GOTO MAIN
MAIN
    BANKSEL FOO
    MOVLW 0x55
    MOVWF FOO
    MOVLW 0x66
    MOVWF BAR
    MOVLW 0x77
    MOVWF BAR+1
    BANKSEL BAZ
    MOVLW 0x99
    MOVWF BAZ
LOOP
    GOTO LOOP
CBLOCK 0x110
FOO
BAR:2
ENDC
CBLOCK 0x190
BAZ
ENDC
    END`);
  check('(ae-a) assemble CBLOCK bank 2/3 không lỗi', asm.errors.length === 0, JSON.stringify(asm.errors));
  const cpu = createCPU();
  cpu.loadProgram(asm.program);
  for (let i = 0; i < 200; i++) cpu.step();
  check('(ae-a) CBLOCK 0x110: FOO ở 0x110=0x55, BAR ở 0x111=0x66/0x112=0x77 (không rơi về bank 0)',
    cpu.ram[0x110] === 0x55 && cpu.ram[0x111] === 0x66 && cpu.ram[0x112] === 0x77,
    `ram[0x110]=${cpu.ram[0x110]} ram[0x111]=${cpu.ram[0x111]} ram[0x112]=${cpu.ram[0x112]}`);
  check('(ae-a) CBLOCK 0x190 (bank 3): BAZ ở 0x190=0x99',
    cpu.ram[0x190] === 0x99, `ram[0x190]=${cpu.ram[0x190]}`);
  check('(ae-a) bank 0 không bị ghi đè: ram[0x10]=0, ram[0x11]=0 (chỗ FOO/BAR cũ khi lỗi)',
    cpu.ram[0x10] === 0 && cpu.ram[0x11] === 0,
    `ram[0x10]=${cpu.ram[0x10]} ram[0x11]=${cpu.ram[0x11]}`);
}

// (ae-b) C: 2 mảng cục bộ, mảng thứ hai KHÔNG dùng (Test E tối giản) —
// không kẹt, title[]/len/i ở đúng bank 2, không chồng lên biến tạm.
{
  // Đọc địa chỉ symbol từ CBLOCK trong asm sinh ra (đỡ hardcode).
  const cblockAddrs = (asmText) => {
    const map = {};
    let base = null;
    for (const ln of asmText.split('\n')) {
      const t = ln.trim();
      const mC = t.match(/^CBLOCK\s+(0x[0-9A-Fa-f]+|\d+)$/i);
      if (mC) { base = parseInt(mC[1], mC[1].toLowerCase().startsWith('0x') ? 16 : 10); continue; }
      if (/^ENDC$/i.test(t)) { base = null; continue; }
      if (base !== null) {
        const mS = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::(\d+))?$/);
        if (mS) { map[mS[1]] = base; base += mS[2] ? parseInt(mS[2], 10) : 1; }
      }
    }
    return map;
  };
  const src = `#include <xc.h>
void main(void)
{
    const char text[] = "                cong hoa xa hoi chu nghia viet nam                ";
    const char title[] = "    VIET NAM    ";
    unsigned char len = 66;
    unsigned char i = 0;
    unsigned char j = 0;
    while (1) { i++; j++; }
}`;
  const r = compileC(src);
  check('(ae-b) 2 mảng cục bộ compile ok, 0 lỗi', r.ok, JSON.stringify(r.errors));
  if (r.ok) {
    const sym = cblockAddrs(r.asm);
    // text[] ở bank 1, title[]/len/i/j ở bank 2 (>= 0x110).
    const t1 = sym['__L_main_1'], tLen = sym['__L_main_2'], tI = sym['__L_main_3'], tJ = sym['__L_main_4'];
    check('(ae-b) title[]/len/i/j cấp ở bank 2 (địa chỉ >= 0x110), text[] ở bank 1',
      t1 >= 0x110 && tLen >= 0x110 && tI >= 0x110 && tJ >= 0x110 && sym['__L_main_0'] >= 0xA0 && sym['__L_main_0'] < 0x100,
      `text=${sym['__L_main_0']?.toString(16)} title=${t1?.toString(16)} len=${tLen?.toString(16)} i=${tI?.toString(16)} j=${tJ?.toString(16)}`);
    const cpu = createCPU();
    cpu.loadProgram(r.program);
    for (let s = 0; s < 200000; s++) cpu.step();
    check('(ae-b) sau init: title[0]=32 (space), title[4]=86 (V), len=66 — không còn 0 do ghi nhầm bank 0',
      cpu.ram[t1] === 32 && cpu.ram[t1 + 4] === 86 && cpu.ram[tLen] === 66,
      `title[0]=${cpu.ram[t1]} title[4]=${cpu.ram[t1 + 4]} len=${cpu.ram[tLen]}`);
    check('(ae-b) i/j tăng đồng bộ trong vòng lặp (|i-j| <= 1 do lấy mẫu giữa 2 lệnh tăng): 2 biến độc lập, không bị biến tạm ghi đè',
      Math.abs(cpu.ram[tI] - cpu.ram[tJ]) <= 1,
      `i=${cpu.ram[tI]} j=${cpu.ram[tJ]} len=${cpu.ram[tLen]}`);
  }
}

// (ae-c) Code LCD 2 hàng thật của Điệp (test/fixtures/diep-xc8-v2-fixed.c):
// hàng 1 "    VIET NAM    ", hàng 2 cuộn "cong hoa xa hoi chu nghia
// viet nam", LED nháy mỗi bước, KHÔNG kẹt (2 ảnh chụp cách nhau 1 bước
// cuộn phải khác nhau).
{
  let diepSrc = null;
  try { diepSrc = readFixture('diep-xc8-v2-fixed.c'); } catch (e) { diepSrc = null; }
  if (diepSrc) {
    const r = compileC(diepSrc);
    check('(ae-c) code 2 hàng của Điệp compile ok, 0 lỗi', r.ok, JSON.stringify(r.errors));
    const { state } = buildLabState(getLab('led-lcd'));
    const mapping = resolvePeripherals(benchToNetlist(state));
    const cpu = createCPU();
    cpu.setWiring(mapping);
    if (r.ok && r.program) cpu.loadProgram(r.program);
    const led1 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
    // Chờ qua khởi tạo + ghi tiêu đề (tối đa ~2M chu kỳ).
    let guard = 0;
    while (guard++ < 100 && !cpu.lcd.getLines()[0].includes('VIET')) runUntil(cpu, cpu.cycles + 20000);
    const l1 = cpu.lcd.getLines()[0];
    check('(ae-c) hàng 1 hiện "    VIET NAM    " sau khởi tạo',
      l1 === '    VIET NAM    ', JSON.stringify(l1));
    // Chờ hàng 2 bắt đầu có chữ (cuộn vào từ phải) rồi mới chụp.
    guard = 0;
    while (guard++ < 100 && cpu.lcd.getLines()[1].trim().length === 0) runUntil(cpu, cpu.cycles + 20000);
    // 2 ảnh chụp hàng 2 cách nhau 1 bước cuộn (~1,3M chu kỳ): phải khác
    // nhau (chứng minh không kẹt trong delay). Đầu chuỗi cuộn chỉ lộ
    // 1-2 chữ ('c' rồi 'co') nên kiểm tra: phần chữ hiện ra là tiền tố
    // của "cong hoa xa hoi..." và dài ra theo từng bước (chữ chạy vào).
    runUntil(cpu, cpu.cycles + 1300000);
    const snap1 = cpu.lcd.getLines()[1];
    const ledA = led1();
    runUntil(cpu, cpu.cycles + 1300000);
    const snap2 = cpu.lcd.getLines()[1];
    const ledB = led1();
    const strip = (s) => s.replace(/^ +/, '');
    const isPrefix = (s) => 'cong hoa xa hoi chu nghia viet nam'.startsWith(strip(s)) && strip(s).length > 0;
    check('(ae-c) hàng 2 cuộn, không kẹt: 2 ảnh chụp cách 1 bước cuộn khác nhau, chữ hiện ra là tiền tố "cong hoa..." và dài ra',
      snap1 !== snap2 && isPrefix(snap1) && isPrefix(snap2) && strip(snap2).length > strip(snap1).length,
      `snap1=${JSON.stringify(snap1)} snap2=${JSON.stringify(snap2)}`);
    check('(ae-c) LED RB1 đổi trạng thái giữa 2 bước cuộn',
      ledA !== ledB, `ledA=${ledA} ledB=${ledB}`);
    check('(ae-c) hàng 1 vẫn giữ tiêu đề sau khi cuộn',
      cpu.lcd.getLines()[0] === '    VIET NAM    ', JSON.stringify(cpu.lcd.getLines()[0]));
  } else {
    check('(ae-c) code 2 hàng của Điệp (bỏ qua: không đọc được test/fixtures/diep-xc8-v2-fixed.c)', false, 'không đọc được file');
  }
}

// (af) C chuẩn kiểu XC8 (v=20261125ar): nối chuỗi kề nhau, strlen,
// truyền chuỗi literal vào hàm, sizeof, + strcpy/strcat/strcmp/memset/
// memcpy. Mục tiêu Điệp chốt: sinh viên paste code XC8 vào là chạy.
{
  // Đọc địa chỉ symbol từ CBLOCK trong asm sinh ra (đỡ hardcode).
  const afAddrs = (asmText) => {
    const map = {};
    let base = null;
    for (const ln of asmText.split('\n')) {
      const t = ln.trim();
      const mC = t.match(/^CBLOCK\s+(0x[0-9A-Fa-f]+|\d+)$/i);
      if (mC) { base = parseInt(mC[1], mC[1].toLowerCase().startsWith('0x') ? 16 : 10); continue; }
      if (/^ENDC$/i.test(t)) { base = null; continue; }
      if (base !== null) {
        const mS = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::(\d+))?$/);
        if (mS) { map[mS[1]] = base; base += mS[2] ? parseInt(mS[2], 10) : 1; }
      }
    }
    return map;
  };
  const afRun = (src, steps = 2000000) => {
    const r = compileC(src);
    const cpu = createCPU();
    if (r.ok && r.program) { cpu.loadProgram(r.program); for (let s = 0; s < steps; s++) cpu.step(); }
    return { r, cpu, sym: r.ok ? afAddrs(r.asm) : {} };
  };
  const afRd = (cpu, sym, name) => cpu.ram[sym[name]];
  const afRd16 = (cpu, sym, name) => {
    const v = cpu.ram[sym[name]] | (cpu.ram[sym[name] + 1] << 8);
    return v >= 0x8000 ? v - 0x10000 : v;
  };
  const afRdStr = (cpu, addr, len) => {
    let o = '';
    for (let i = 0; i < len; i++) { const c = cpu.ram[addr + i]; if (c === 0) break; o += String.fromCharCode(c); }
    return o;
  };

  // (af-a) Nối chuỗi kề nhau.
  {
    const r1 = compileC('void main(){ const char s[] = "ab" "cd"; while(1){} }');
    check('(af-a) nối 2 literal kề nhau compile ok', r1.ok, JSON.stringify(r1.errors));
    const r2 = compileC('void main(){ const char s[] =\n"ab"\n"cd"\n"ef"; while(1){} }');
    check('(af-a) nối 3 literal xuống dòng compile ok', r2.ok, JSON.stringify(r2.errors));
    const r3 = compileC('void main(){ const char s[] = "ab" /* gop */ "cd"; while(1){} }');
    check('(af-a) nối chuỗi có comment xen giữa compile ok', r3.ok, JSON.stringify(r3.errors));
    const t = afRun('#include <xc.h>\nvoid main(){ const char s[] = "ab" "cd" "ef"; while(1){} }');
    check('(af-a) nội dung mảng nối = "abcdef" (+ byte 0)',
      t.r.ok && afRdStr(t.cpu, t.sym['__L_main_0'], 7) === 'abcdef' && t.cpu.ram[t.sym['__L_main_0'] + 6] === 0,
      t.r.ok ? JSON.stringify(afRdStr(t.cpu, t.sym['__L_main_0'], 7)) : JSON.stringify(t.r.errors));
    const r4 = compileC('void f(const char *s){ while(*s){ s++; } }\nvoid main(){ f("ab" "cd"); while(1){} }');
    check('(af-a) nối chuỗi trong tham số hàm compile ok', r4.ok, JSON.stringify(r4.errors));
  }

  // (af-b) strlen: literal, mảng, con trỏ giữa chuỗi, chuỗi rỗng.
  {
    const t = afRun('#include <xc.h>\nunsigned char v1, v2, v3, v4;\nvoid main(){ const char s[] = "Hello"; v1 = strlen("Hello"); v2 = strlen(s); v3 = strlen(s+2); char e[] = ""; v4 = strlen(e); while(1){} }');
    check('(af-b) strlen chạy đúng: literal=5, mảng=5, p+2=3, rỗng=0',
      t.r.ok && afRd(t.cpu, t.sym, 'v1') === 5 && afRd(t.cpu, t.sym, 'v2') === 5
      && afRd(t.cpu, t.sym, 'v3') === 3 && afRd(t.cpu, t.sym, 'v4') === 0,
      t.r.ok ? `v1=${afRd(t.cpu, t.sym, 'v1')} v2=${afRd(t.cpu, t.sym, 'v2')} v3=${afRd(t.cpu, t.sym, 'v3')} v4=${afRd(t.cpu, t.sym, 'v4')}` : JSON.stringify(t.r.errors));
  }

  // (af-c) Truyền chuỗi literal trực tiếp vào hàm (LCD).
  {
    const src = `#include <xc.h>
#define LCD_RS PORTEbits.RE0
#define LCD_EN PORTEbits.RE1
void LCD_Enable(void){ LCD_EN=1; __delay_us(5); LCD_EN=0; __delay_us(50); }
void LCD_Command(unsigned char c){ LCD_RS=0; PORTD=c; LCD_Enable(); __delay_ms(2); }
void LCD_Char(unsigned char d){ LCD_RS=1; PORTD=d; LCD_Enable(); }
void LCD_String(const char *s){ while(*s){ LCD_Char(*s++); } }
void main(void){ TRISD=0; TRISE=0; ADCON1=0x06; __delay_ms(40); LCD_Command(0x38); LCD_Command(0x0C); LCD_Command(0x01); LCD_Command(0x80); LCD_String("HELLO"); LCD_Command(0xC0); LCD_String("WORLD"); while(1){} }`;
    const { r, cpu } = runLabC(1, src, 2000000);
    check('(af-c) LCD_String("HELLO")/("WORLD") compile ok', r.ok, JSON.stringify(r.errors));
    check('(af-c) hàng 1 = "HELLO", hàng 2 = "WORLD" (2 literal khác nhau không ghi đè)',
      r.ok && cpu.lcd.getLines()[0] === 'HELLO           ' && cpu.lcd.getLines()[1] === 'WORLD           ',
      r.ok ? JSON.stringify(cpu.lcd.getLines()) : '');
  }

  // (af-d) sizeof: kiểu, biến, mảng, con trỏ, trong biểu thức.
  {
    const t = afRun('#include <xc.h>\nunsigned char v1, v2, v3, v4, v5, v6;\nunsigned int w1, w2;\nint arr[10];\nchar *p;\nvoid main(){ char s[] = "Hello"; v1 = sizeof(int); v2 = sizeof(char); v3 = sizeof(unsigned char); v4 = sizeof(s); v5 = sizeof(p); v6 = sizeof(s)-1; w1 = sizeof(arr); w2 = sizeof(unsigned char*); while(1){} }');
    check('(af-d) sizeof đúng: int=2, char=1, uchar=1, char[6]=6, ptr=2, s-1=5, int[10]=20, uchar*=2',
      t.r.ok && afRd(t.cpu, t.sym, 'v1') === 2 && afRd(t.cpu, t.sym, 'v2') === 1
      && afRd(t.cpu, t.sym, 'v3') === 1 && afRd(t.cpu, t.sym, 'v4') === 6
      && afRd(t.cpu, t.sym, 'v5') === 2 && afRd(t.cpu, t.sym, 'v6') === 5
      && afRd16(t.cpu, t.sym, 'w1') === 20 && afRd16(t.cpu, t.sym, 'w2') === 2,
      t.r.ok ? `v1=${afRd(t.cpu, t.sym, 'v1')} v2=${afRd(t.cpu, t.sym, 'v2')} v3=${afRd(t.cpu, t.sym, 'v3')} v4=${afRd(t.cpu, t.sym, 'v4')} v5=${afRd(t.cpu, t.sym, 'v5')} v6=${afRd(t.cpu, t.sym, 'v6')} w1=${afRd16(t.cpu, t.sym, 'w1')} w2=${afRd16(t.cpu, t.sym, 'w2')}` : JSON.stringify(t.r.errors));
    const r2 = compileC('void main(){ char s[] = "Hello"; unsigned char n; n = sizeof(s); while(1){} }');
    check('(af-d) sizeof(mảng) trong biểu thức compile ok', r2.ok, JSON.stringify(r2.errors));
  }

  // (af-e) Code gốc của Điệp (test/fixtures/diep-xc8-v2.c) NGUYÊN VẸN, không sửa.
  {
    let diepSrc = null;
    try { diepSrc = readFixture('diep-xc8-v2.c'); } catch (e) { diepSrc = null; }
    if (diepSrc) {
      const r = compileC(diepSrc);
      check('(af-e) code gốc Điệp compile ok, 0 lỗi (không sửa file)', r.ok, JSON.stringify(r.errors));
      const { state } = buildLabState(getLab('led-lcd'));
      const mapping = resolvePeripherals(benchToNetlist(state));
      const cpu = createCPU();
      cpu.setWiring(mapping);
      if (r.ok && r.program) cpu.loadProgram(r.program);
      const led1 = () => ledStates(cpu, mapping).find((s) => s.id === 'LED1').on;
      // Chờ qua khởi tạo + ghi tiêu đề (tối đa ~2M chu kỳ).
      let guard = 0;
      while (guard++ < 100 && !cpu.lcd.getLines()[0].includes('VIET')) runUntil(cpu, cpu.cycles + 20000);
      check('(af-e) hàng 1 = "    VIET NAM    " cố định',
        cpu.lcd.getLines()[0] === '    VIET NAM    ', JSON.stringify(cpu.lcd.getLines()[0]));
      // Chờ hàng 2 bắt đầu có chữ (cuộn vào từ phải) rồi mới chụp.
      guard = 0;
      while (guard++ < 100 && cpu.lcd.getLines()[1].trim().length === 0) runUntil(cpu, cpu.cycles + 20000);
      // 2 ảnh chụp hàng 2 cách nhau 1 bước cuộn (~1,3M chu kỳ): phải khác
      // nhau (chứng minh không kẹt trong delay). Đầu chuỗi cuộn chỉ lộ
      // 1-2 chữ ('c' rồi 'co') nên kiểm tra: phần chữ hiện ra là tiền tố
      // của "cong hoa xa hoi..." và dài ra theo từng bước (chữ chạy vào).
      runUntil(cpu, cpu.cycles + 1300000);
      const snap1 = cpu.lcd.getLines()[1];
      const ledA = led1();
      runUntil(cpu, cpu.cycles + 1300000);
      const snap2 = cpu.lcd.getLines()[1];
      const ledB = led1();
      const strip = (s) => s.replace(/^ +/, '');
      const isPrefix = (s) => 'cong hoa xa hoi chu nghia viet nam'.startsWith(strip(s)) && strip(s).length > 0;
      check('(af-e) hàng 2 cuộn, không kẹt: 2 ảnh chụp cách 1 bước khác nhau, chữ là tiền tố "cong hoa..." và dài ra',
        snap1 !== snap2 && isPrefix(snap1) && isPrefix(snap2) && strip(snap2).length > strip(snap1).length,
        `snap1=${JSON.stringify(snap1)} snap2=${JSON.stringify(snap2)}`);
      check('(af-e) LED RB1 đổi trạng thái giữa 2 bước cuộn',
        ledA !== ledB, `ledA=${ledA} ledB=${ledB}`);
    } else {
      check('(af-e) code gốc Điệp (bỏ qua: không đọc được test/fixtures/diep-xc8-v2.c)', false, 'không đọc được file');
    }
  }

  // (af-f) 5 hàm chuỗi/bộ nhớ: strcpy, strcat, strcmp, memset, memcpy.
  {
    const t = afRun(`#include <xc.h>
char dst[20];
char src[10];
int c1, c2, c3, c4, c5, c6, c7;
unsigned char l1, l2;
void main(){
  strcpy(dst, "Hello");
  c1 = strcmp(dst, "Hello");
  c2 = strcmp(dst, "Hellp");
  c3 = strcmp("Abc", "Abd");
  c6 = strcmp("Hellp", "Hello");
  c7 = strcmp("b", "a");
  strcat(dst, " World");
  l1 = strlen(dst);
  memcpy(src, dst, 5);
  src[5] = 0;
  memset(dst+6, (char)88, 3);
  c4 = strcmp(src, "Hello");
  c5 = strcmp("", "");
  l2 = strlen(src);
  while(1){}
}`);
    check('(af-f) strcpy+strcat+memset: dst = "Hello XXXld"',
      t.r.ok && afRdStr(t.cpu, t.sym['dst'], 20) === 'Hello XXXld',
      t.r.ok ? JSON.stringify(afRdStr(t.cpu, t.sym['dst'], 20)) : JSON.stringify(t.r.errors));
    check('(af-f) memcpy 5 ký tự: src = "Hello"',
      t.r.ok && afRdStr(t.cpu, t.sym['src'], 10) === 'Hello',
      t.r.ok ? JSON.stringify(afRdStr(t.cpu, t.sym['src'], 10)) : '');
    check('(af-f) strcmp: bằng=0, "Hello"/"Hellp"=-1, "Abc"/"Abd"=-1, ngược=+1, rỗng=0',
      t.r.ok && afRd16(t.cpu, t.sym, 'c1') === 0 && afRd16(t.cpu, t.sym, 'c2') === -1
      && afRd16(t.cpu, t.sym, 'c3') === -1 && afRd16(t.cpu, t.sym, 'c6') === 1
      && afRd16(t.cpu, t.sym, 'c7') === 1 && afRd16(t.cpu, t.sym, 'c4') === 0
      && afRd16(t.cpu, t.sym, 'c5') === 0,
      t.r.ok ? `c1=${afRd16(t.cpu, t.sym, 'c1')} c2=${afRd16(t.cpu, t.sym, 'c2')} c3=${afRd16(t.cpu, t.sym, 'c3')} c6=${afRd16(t.cpu, t.sym, 'c6')} c7=${afRd16(t.cpu, t.sym, 'c7')} c4=${afRd16(t.cpu, t.sym, 'c4')} c5=${afRd16(t.cpu, t.sym, 'c5')}` : '');
    check('(af-f) strlen sau strcat/memcpy: dst=11, src=5',
      t.r.ok && afRd(t.cpu, t.sym, 'l1') === 11 && afRd(t.cpu, t.sym, 'l2') === 5,
      t.r.ok ? `l1=${afRd(t.cpu, t.sym, 'l1')} l2=${afRd(t.cpu, t.sym, 'l2')}` : '');
  }
}

// Nhóm (ag): đồng hồ hiện sóng 2 kênh (oscilloscope) — scopeVoltages
// (circuit-solver.js) + bộ nhớ vòng pushScopeSample. Điện áp kỳ vọng tính
// theo mô hình solver: chân PIC output cao = 5V / thấp = 0V, PSU = 5V,
// net floating thì điện áp null (không gán 0V bừa).
// Scope là linh kiện NGOÀI BÀN (version aw): đặt bằng tx/tz (mặc định
// tx=130, tz=-150, cạnh phải nguồn), nối dây từ lỗ breadboard vào 3 cọc
// CH1/CH2/GND ('OSC0.CH1'...), không còn chân cắm lỗ.
{
  // Bàn Lab 1 + scope ngoài bàn: CH1 -> RB0, CH2 -> RB1, GND -> rail -.
  // Dây nối thẳng strip của chân PIC (f29 = strip RB0, f28 = strip RB1)
  // vào cọc scope; GND nối rail B-50 vào cọc GND.
  const lab1WithScope = () => {
    const { state } = buildLabState(LABS[0]);
    state.components.push({ id: 'OSC0', type: 'oscilloscope', tx: 130, tz: -150, fixed: false, props: {} });
    state.wires.push({ id: 'T-S1', a: 'f29', b: 'OSC0.CH1', color: '#DC2626' });
    state.wires.push({ id: 'T-S2', a: 'f28', b: 'OSC0.CH2', color: '#DC2626' });
    state.wires.push({ id: 'T-S3', a: 'B-50', b: 'OSC0.GND', color: '#0F172A' });
    return state;
  };
  // TRISB=0 (tất cả PORTB output), PORTB=0 (RB0=RB1=0) — như helper
  // setRB0 ở nhóm (v), nhưng đặt cả 2 chân về 0 để đo CH2.
  const setPortsB0 = (cpu) => {
    cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0x00);
    cpu.writeFile(0x03, 0x00); cpu.writeFile(0x06, 0x00);
  };
  const approx = (v, target, tol) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v - target) <= tol;

  // (ag-a) Scope trên Lab 1 chạy code thật: CH1 theo RB0 (5V khi RB0=1,
  // 0V khi RB0=0), CH2 theo RB1 luôn 0V (TRISB=0, RB1 không bật).
  check('(ag-a) scope Lab 1 chạy code thật: CH1 ~5V khi RB0=1, ~0V khi RB0=0, CH2 luôn 0V',
    (() => {
      const state = lab1WithScope();
      const mapping = resolvePeripherals(benchToNetlist(state));
      const cpu = createCPU();
      cpu.setWiring(mapping);
      const r = compileC(LABS[0].code);
      if (!r.ok || !r.program) return false;
      cpu.loadProgram(r.program);
      // Chờ tới khi RB0 lên 1 (đầu pha ON), rồi đọc scope. Đọc PORTB
      // bằng readPort(1) (pinLevel nhận chỉ số cổng dạng số, không phải
      // chữ 'B' — dùng chữ thì luôn đọc 0). Chạy nóng 10k chu kỳ trước
      // khi chờ: lúc reset PORTB đọc 0xFF (tất cả input đọc cao) nên
      // RB0 "đọc" là 1 ngay từ chu kỳ 0 dù code chưa chạy; chạy nóng
      // qua đoạn khởi động thì TRISB=0 và RB0=1 là thật (pha ON dài
      // 500k chu kỳ nên 10k chu kỳ chạy nóng không bỏ lỡ pha ON).
      runUntil(cpu, cpu.cycles + 10000);
      let guard = 0;
      while (((cpu.readPort(1) & 1) !== 1) && guard++ < 50) runUntil(cpu, cpu.cycles + 100000);
      if ((cpu.readPort(1) & 1) !== 1) return false;
      const on = scopeVoltages(state, cpu)[0];
      // Chờ tới khi RB0 xuống 0 (pha OFF, ~2M chu kỳ delay), rồi đọc scope.
      guard = 0;
      while (((cpu.readPort(1) & 1) !== 0) && guard++ < 50) runUntil(cpu, cpu.cycles + 100000);
      if ((cpu.readPort(1) & 1) !== 0) return false;
      const off = scopeVoltages(state, cpu)[0];
      return on && approx(on.ch1, 5, 0.05) && approx(on.ch2, 0, 0.05)
        && off && approx(off.ch1, 0, 0.05) && approx(off.ch2, 0, 0.05);
    })(), '');
  // (ag-b) GND không nối (floating) -> cả 2 kênh null; CH1 không nối ->
  // CH1 null, CH2 vẫn đọc được (RB1 output 0V).
  check('(ag-b) GND floating (không nối dây T-S3) -> cả 2 kênh null',
    (() => {
      const state = lab1WithScope();
      state.wires = state.wires.filter((w) => w.id !== 'T-S3');
      const cpu = createCPU();
      cpu.setWiring(resolvePeripherals(benchToNetlist(state)));
      setPortsB0(cpu);
      const r = scopeVoltages(state, cpu)[0];
      return r && r.ch1 === null && r.ch2 === null;
    })(), '');
  check('(ag-b) CH1 floating (không nối dây T-S1) -> CH1 null, CH2 vẫn 0V',
    (() => {
      const state = lab1WithScope();
      state.wires = state.wires.filter((w) => w.id !== 'T-S1');
      const cpu = createCPU();
      cpu.setWiring(resolvePeripherals(benchToNetlist(state)));
      setPortsB0(cpu);
      const r = scopeVoltages(state, cpu)[0];
      return r && r.ch1 === null && r.ch2 === 0;
    })(), '');
  // (ag-c) CH1 và GND cùng 1 net (cả 2 về RAIL+) -> hiệu 0V; CH2 không
  // nối -> null.
  check('(ag-c) CH1 và GND cùng 1 net (cả 2 về RAIL+) -> CH1 = 0V; CH2 không nối -> null',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'OSC0', type: 'oscilloscope', tx: 130, tz: -150, fixed: false, props: {} });
      st.wires.push({ id: 'T-C1', a: 'T+10', b: 'OSC0.CH1', color: '#DC2626' });
      st.wires.push({ id: 'T-C2', a: 'T+14', b: 'OSC0.GND', color: '#DC2626' });
      const r = scopeVoltages(st, createCPU())[0];
      return r && r.ch1 === 0 && r.ch2 === null;
    })(), '');
  // (ag-d) Bộ nhớ vòng: đẩy 300 mẫu (mô phỏng 300 nhịp sampleScopes) thì
  // buffer giữ đúng 240 mẫu (SCOPE_MAX_SAMPLES), mẫu mới nhất ở cuối,
  // mẫu cũ nhất là mẫu 61 (300-240+1).
  check('(ag-d) bộ nhớ vòng: 300 mẫu -> giữ 240 mẫu, mới nhất ở cuối, cũ nhất là mẫu 61',
    (() => {
      const buf = [];
      for (let i = 1; i <= 300; i++) pushScopeSample(buf, [i, -i]);
      return SCOPE_MAX_SAMPLES === 240 && buf.length === 240
        && buf[0][0] === 61 && buf[0][1] === -61
        && buf[239][0] === 300 && buf[239][1] === -300;
    })(), '');
  // (ag-e) Scope ngoài bàn: không chân lỗ, đặt được (canPlace ok, legs
  // rỗng), id OSC0, nhãn "Đồng hồ hiện sóng 0", không props đặc biệt ({}),
  // parseScopePost/scopePostPos đúng tọa độ cọc (CH1 x=tx-28, CH2 x=tx,
  // GND x=tx+28, y=10, z=tz+26), vị trí mặc định tx=130, tz=-150.
  check('(ag-e) scope ngoài bàn: legsFor=[]; canPlace ok; id OSC0; nhãn "Đồng hồ hiện sóng 0"; cọc đúng tọa độ',
    JSON.stringify(legsFor({ type: 'oscilloscope', tx: 130, tz: -150 }, 830)) === '[]'
    && canPlace(defaultBenchState(830), 'oscilloscope', null).ok
    && canPlace(defaultBenchState(830), 'oscilloscope', null).legs.length === 0
    && nextComponentId(defaultBenchState(830), 'oscilloscope') === 'OSC0'
    && compLabel({ id: 'OSC0', type: 'oscilloscope' }) === 'Đồng hồ hiện sóng 0'
    && JSON.stringify(defaultProps('oscilloscope')) === '{}'
    && JSON.stringify(parseScopePost('OSC1.CH1')) === JSON.stringify({ scopeId: 'OSC1', term: 'CH1' })
    && JSON.stringify(parseScopePost('OSC12.GND')) === JSON.stringify({ scopeId: 'OSC12', term: 'GND' })
    && parseScopePost('OSC1.X') === null && parseScopePost('PSU1.+') === null && parseScopePost('a10') === null
    && JSON.stringify(scopePostPos({ components: [{ id: 'OSC1', type: 'oscilloscope', tx: 130, tz: -150 }] }, 'OSC1.CH1')) === JSON.stringify({ x: 102, y: 10, z: -124 })
    && JSON.stringify(scopePostPos({ components: [{ id: 'OSC1', type: 'oscilloscope', tx: 130, tz: -150 }] }, 'OSC1.CH2')) === JSON.stringify({ x: 130, y: 10, z: -124 })
    && JSON.stringify(scopePostPos({ components: [{ id: 'OSC1', type: 'oscilloscope', tx: 130, tz: -150 }] }, 'OSC1.GND')) === JSON.stringify({ x: 158, y: 10, z: -124 })
    && scopePostPos({ components: [{ id: 'OSC1', type: 'oscilloscope', tx: 130, tz: -150 }] }, 'OSC9.CH1') === null
    && scopePostPos({ components: [{ id: 'OSC1', type: 'oscilloscope', tx: 130, tz: -150 }] }, 'PSU1.+') === null
    && SCOPE_POST_DX === 28 && SCOPE_POST_Y === 10 && SCOPE_POST_DZ === 26
    && SCOPE_DEFAULT_TX === 130 && SCOPE_DEFAULT_TZ === -150, '');
  // (ag-e2) Dây tới cọc scope không nối strip nào trong netlist bench (2
  // LED ở 2 strip vẫn tách net dù mỗi strip có 1 dây vào cọc scope) và
  // scope không vào netlist CPU; nhưng trong solver, node cọc scope
  // chính là node của strip đã nối vào cọc đó.
  check('(ag-e2) dây tới cọc scope không nối strip (2 LED vẫn tách net), scope không vào netlist CPU, node cọc = node strip',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'OSC0', type: 'oscilloscope', tx: 130, tz: -150, fixed: false, props: {} });
      st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      st.components.push({ id: 'LED1', type: 'led', anchor: 'c14', rot: 0, props: { color: '#DC2626' } });
      st.wires.push({ id: 'T-E1', a: 'c10', b: 'OSC0.CH1', color: '#DC2626' });
      st.wires.push({ id: 'T-E2', a: 'c14', b: 'OSC0.CH2', color: '#DC2626' });
      const n = buildBenchNets(st);
      const nl = benchToNetlist(st);
      const sn = buildSolverNets(st);
      return n.termRoot.get('LED0.A') !== n.termRoot.get('LED1.A')
        && !n.termRoot.has('OSC0.CH1')
        && !nl.components.some((c) => c.id === 'OSC0')
        && sn.nodeOfScopeTerm('OSC0', 'CH1') === sn.nodeOfTerm('LED0', 'A')
        && sn.nodeOfScopeTerm('OSC0', 'CH2') === sn.nodeOfTerm('LED1', 'A')
        && (sn.nodeOfScopeTerm('OSC0', 'GND') === null || sn.nodeOfScopeTerm('OSC0', 'GND') === undefined);
    })(), '');
  // (ag-f) Migration scope cũ (cắm lỗ, anchor a50) -> scope ngoài bàn:
  // dây cũ vào lỗ kề cùng strip với chân cũ (b50/b52/b54, cùng strip với
  // a50/a52/a54) được viết lại thành cọc OSC0.CH1/CH2/GND; scope có tx/tz
  // mặc định, không còn anchor; scopeVoltages vẫn đọc đúng RB0 (đặt tay
  // TRISB=0, PORTB=0x01 -> RB0=1, RB1=0).
  check('(ag-f) migration: scope cũ anchor a50 + dây vào lỗ chân cũ -> tx/tz, dây thành cọc OSC0.CH1/CH2/GND, vẫn đọc đúng RB0',
    (() => {
      const raw = defaultBenchState(830);
      raw.components.push({ id: 'OSC0', type: 'oscilloscope', anchor: 'a50', rot: 0, props: {} });
      raw.wires.push({ id: 'T-S1', a: 'b50', b: 'f29', color: '#DC2626' });
      raw.wires.push({ id: 'T-S2', a: 'b52', b: 'f28', color: '#DC2626' });
      raw.wires.push({ id: 'T-S3', a: 'b54', b: 'B-50', color: '#0F172A' });
      const st = sanitizeState(raw);
      const sc = st.components.find((c) => c.id === 'OSC0');
      if (!sc || sc.type !== 'oscilloscope' || sc.tx !== 130 || sc.tz !== -150 || sc.anchor) return false;
      const wEnds = new Set(st.wires.flatMap((w) => [w.a, w.b]));
      if (!wEnds.has('OSC0.CH1') || !wEnds.has('OSC0.CH2') || !wEnds.has('OSC0.GND')) return false;
      if (st.wires.some((w) => ['b50', 'b52', 'b54'].includes(w.a) || ['b50', 'b52', 'b54'].includes(w.b))) return false;
      if (!st.wires.some((w) => w.a === 'OSC0.CH1' && w.b === 'f29')) return false;
      const cpu = createCPU();
      cpu.setWiring(resolvePeripherals(benchToNetlist(st)));
      cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0x00); // TRISB=0 (bank 1)
      cpu.writeFile(0x03, 0x00); cpu.writeFile(0x06, 0x01); // PORTB=0x01 (bank 0) -> RB0=1, RB1=0
      const r = scopeVoltages(st, cpu)[0];
      return r && Math.abs(r.ch1 - 5) <= 0.05 && r.ch2 === 0;
    })(), '');
  // (ag-f2) Migration: scope cũ anchor hỏng (không parse được) -> scope
  // bị xóa, không đoán bừa vị trí chân.
  check('(ag-f2) migration: scope cũ anchor hỏng -> scope bị xóa, không đoán bừa',
    (() => {
      const raw = defaultBenchState(830);
      raw.components.push({ id: 'OSC0', type: 'oscilloscope', anchor: 'zz999', rot: 0, props: {} });
      const st = sanitizeState(raw);
      return !st.components.some((c) => c.id === 'OSC0');
    })(), '');
  // (ag-f3) validate/retarget đầu dây sang cọc scope: OSC0.CH1 hợp lệ
  // (scope đang có trên bàn), OSC9.CH1 bị từ chối (không có scope đó).
  check('(ag-f3) validate/retarget đầu dây sang cọc scope: OSC0.CH1 ok, OSC9.CH1 từ chối',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'OSC0', type: 'oscilloscope', tx: 130, tz: -150, fixed: false, props: {} });
      st.wires.push({ id: 'T-V1', a: 'f29', b: 'B-50', color: '#DC2626' });
      const v1 = validateWireEnd(st, 'T-V1', 'b', 'OSC0.CH1');
      const v2 = validateWireEnd(st, 'T-V1', 'b', 'OSC9.CH1');
      if (!v1.ok || v2.ok) return false;
      const r = retargetWireEnd(st, 'T-V1', 'b', 'OSC0.CH1');
      return r.ok && st.wires.find((w) => w.id === 'T-V1').b === 'OSC0.CH1';
    })(), '');
  // (ag-g) drawScopeWaveform vẽ đúng lên canvas 512×288 với ctx đã
  // scale(2,2): trích hàm từ bench.js, chạy với ctx giả lập transform,
  // kiểm tra nền phủ kín 512×288, chữ CH1/CH2 đúng mẫu mới nhất, và
  // không lỗi khi buffer rỗng. Bench.js cũng phải tạo canvas scope
  // 512×288 + ctx.setTransform(2,0,0,2,0,0); nhánh scope cũ (màn nằm
  // ngửa trên nóc) đã xóa.
  check('(ag-g) drawScopeWaveform trên canvas 512x288 + ctx scale(2,2): nền phủ kín, chữ CH1/CH2 đúng, buffer rỗng không lỗi',
    (() => {
      const src = readFileSync(new URL('./public/bench.js', import.meta.url), 'utf8');
      const start = src.indexOf('function drawScopeWaveform(t, samples) {');
      const end = src.indexOf('function drawLcdLine(', start);
      if (start < 0 || end < 0) return false;
      const fnSrc = src.slice(start, end);
      const body = fnSrc.slice(fnSrc.indexOf('{') + 1, fnSrc.lastIndexOf('\n  }'));
      if (!body.includes('fillRect(0, 0, W, 144)')) return false;
      const calls = [];
      const ctx = {
        scaleX: 1, scaleY: 1,
        setTransform(a, _b, _c, d) { this.scaleX = a; this.scaleY = d; },
        fillRect(x, y, w, h) { calls.push(['fillRect', x * this.scaleX, y * this.scaleY, w * this.scaleX, h * this.scaleY]); },
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        fillText(text) { calls.push(['fillText', String(text)]); },
        set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
        set font(_v) {}, set textBaseline(_v) {}, set textAlign(_v) {},
      };
      const draw = new Function('t', 'samples', 'SCOPE_V_MIN', 'SCOPE_V_MAX', 'SCOPE_GRID_TOP', 'SCOPE_GRID_BOTTOM', 'formatVolts', body);
      const t = { ctx, tex: {} };
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      draw(t, [[5, 0], [0, 5]], -0.5, 5.5, 16, 128, formatVolts);
      const bgOk = calls.some((c) => c[0] === 'fillRect' && c[1] === 0 && c[2] === 0 && c[3] === 512 && c[4] === 288);
      const chOk = calls.some((c) => c[0] === 'fillText' && c[1] === 'CH1 0.00 V')
        && calls.some((c) => c[0] === 'fillText' && c[1] === 'CH2 5.00 V');
      if (!bgOk || !chOk || t.tex.needsUpdate !== true) return false;
      // Buffer rỗng: vẽ nền + chữ "—", không lỗi.
      calls.length = 0;
      t.tex.needsUpdate = false;
      draw(t, [], -0.5, 5.5, 16, 128, formatVolts);
      return calls.some((c) => c[0] === 'fillRect' && c[3] === 512 && c[4] === 288)
        && calls.some((c) => c[0] === 'fillText' && c[1] === 'CH1 —')
        && calls.some((c) => c[0] === 'fillText' && c[1] === 'CH2 —')
        && t.tex.needsUpdate === true;
    })(), '');
  check('(ag-g2) bench.js tạo canvas scope 512x288 + ctx.setTransform(2,0,0,2,0,0); nhánh scope cũ đã xóa',
    (() => {
      const src = readFileSync(new URL('./public/bench.js', import.meta.url), 'utf8');
      return src.includes('cv.width = 512; cv.height = 288')
        && src.includes('ctx.setTransform(2, 0, 0, 2, 0, 0)')
        && src.includes("new THREE.BoxGeometry(100, 60, 50)")
        && src.includes('pickScopePost') && src.includes('scopePostPos(state, e)')
        && !src.includes('trên nóc vẽ sóng');
    })(), '');
}

// Nhóm (ah): lệnh shift màn hình LCD 0x18/0x1C (v=20261125ax) — trước đây
// command() bỏ qua hẳn 0x10-0x1F nên code Điệp shift 32 lần mà chữ đứng yên.
{
  const L1 = '0123456789ABCDEF';
  const L2 = 'SCROLL 0x18     ';
  const BLANK = '                ';
  const write2Lines = (lcd) => {
    const w = (s) => { for (const ch of s) lcd.writeData(ch.charCodeAt(0)); };
    lcd.command(0x38); lcd.command(0x0C); lcd.command(0x01); lcd.command(0x06);
    w(L1); lcd.command(0xC0); w(L2);
  };
  const lcd = new LCD();
  write2Lines(lcd);
  check('(ah-a) LCD shift: ban đầu 2 dòng đủ', JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `got=${JSON.stringify(lcd.getLines())}`);
  lcd.command(0x18);
  check('(ah-b) sau 0x18 x1: dòng 1 "123456789ABCDEF ", dòng 2 "CROLL 0x18      "',
    lcd.getLines()[0] === '123456789ABCDEF ' && lcd.getLines()[1] === 'CROLL 0x18      ',
    `got=${JSON.stringify(lcd.getLines())}`);
  check('(ah-c) getDisplayCells phản ánh shift: ô đầu dòng 1 sau 0x18 x1 là "1"',
    lcd.getDisplayCells()[0][0].ch === '1' && lcd.getDisplayCells()[1][0].ch === 'C',
    `cells=${lcd.getDisplayCells()[0][0].ch}/${lcd.getDisplayCells()[1][0].ch}`);
  for (let i = 0; i < 15; i++) lcd.command(0x18);
  check('(ah-d) sau 0x18 x16: cả 2 dòng toàn khoảng trắng (chữ đã trôi hết)',
    lcd.getLines()[0] === BLANK && lcd.getLines()[1] === BLANK,
    `got=${JSON.stringify(lcd.getLines())}`);
  for (let i = 0; i < 16; i++) lcd.command(0x1C);
  check('(ah-e) sau 0x1C x16: về đúng 2 dòng ban đầu',
    JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `got=${JSON.stringify(lcd.getLines())}`);
  for (let i = 0; i < 40; i++) lcd.command(0x18);
  check('(ah-f) shift 40 lần quay vòng về đúng ban đầu',
    JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `got=${JSON.stringify(lcd.getLines())}`);
  // Dịch con trỏ: addr đổi, nội dung + shift không đổi (addr đang ở 0x50
  // sau khi ghi 2 dòng: dòng 2 viết đủ 16 ký tự từ 0x40).
  const addrBefore = lcd.addr;
  lcd.command(0x14);
  check('(ah-g) 0x14 dịch con trỏ phải: addr 0x50->0x51, nội dung và shift không đổi',
    lcd.addr === 0x51 && lcd.shift === 0 && JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `addr=${lcd.addr.toString(16)} shift=${lcd.shift}`);
  lcd.command(0x10);
  check('(ah-h) 0x10 dịch con trỏ trái: addr về 0x50, nội dung không đổi',
    lcd.addr === addrBefore && JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `addr=${lcd.addr.toString(16)}`);
  // Quay vòng con trỏ ở ranh giới dòng.
  lcd.command(0x80 | 0x27); lcd.command(0x14);
  const w1 = lcd.addr === 0x40;
  lcd.command(0x80 | 0x40); lcd.command(0x10);
  const w2 = lcd.addr === 0x27;
  lcd.command(0x80 | 0x00); lcd.command(0x10);
  const w3 = lcd.addr === 0x67;
  lcd.command(0x80 | 0x67); lcd.command(0x14);
  const w4 = lcd.addr === 0x00;
  check('(ah-i) dịch con trỏ quay vòng đúng ranh giới (0x27->0x40, 0x40->0x27, 0x00->0x67, 0x67->0x00)',
    w1 && w2 && w3 && w4, `w=${[w1, w2, w3, w4].join(',')}`);
  // 0x01 clear và 0x02 return home đều reset shift về 0.
  for (let i = 0; i < 5; i++) lcd.command(0x18);
  lcd.command(0x01);
  const clearOk = lcd.shift === 0 && lcd.getLines()[0] === BLANK && lcd.getLines()[1] === BLANK;
  write2Lines(lcd);
  const afterClearWriteOk = JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]);
  check('(ah-j) 0x01 clear reset shift về 0 (ghi lại hiện đúng từ đầu)',
    clearOk && afterClearWriteOk, `shift=${lcd.shift} lines=${JSON.stringify(lcd.getLines())}`);
  for (let i = 0; i < 5; i++) lcd.command(0x18);
  lcd.command(0x02);
  check('(ah-k) 0x02 return home reset shift về 0, DDRAM giữ nguyên',
    lcd.shift === 0 && lcd.addr === 0 && JSON.stringify(lcd.getLines()) === JSON.stringify([L1, L2]),
    `shift=${lcd.shift} addr=${lcd.addr} lines=${JSON.stringify(lcd.getLines())}`);
}

// Nhóm (ah) e2e: code thật của Điệp (test/fixtures/diep-lcd-shift.c), bản
// rút ngắn delay 1000ms -> 10ms (chỉ đổi delay, giữ nguyên logic), chạy trên
// CPU thật với board led-lcd. Lấy mẫu dòng LCD mỗi 20k chu kỳ, ghi lại mỗi
// lần dòng đổi để kiểm tra pha 1 trôi trái, pha 2 trôi về, cuối SHIFT DONE.
{
  let diepSrc = null;
  try { diepSrc = readFixture('diep-lcd-shift.c'); } catch (e) { diepSrc = null; }
  check('(ah-l) đọc được test/fixtures/diep-lcd-shift.c',
    typeof diepSrc === 'string' && diepSrc.length > 0,
    diepSrc === null ? 'không đọc được file' : `dài ${diepSrc.length} ký tự`);
  if (diepSrc) {
    const shortSrc = diepSrc.replaceAll('__delay_ms(1000)', '__delay_ms(10)');
    const r = compileC(shortSrc);
    check('(ah-m) code shift rút ngắn compileC ok, 0 lỗi',
      r.ok && r.errors.length === 0 && r.program !== null, JSON.stringify((r.errors || []).slice(0, 2)));
    const { state } = buildLabState(getLab('led-lcd'));
    const mapping = resolvePeripherals(benchToNetlist(state));
    const cpu = createCPU();
    cpu.setWiring(mapping);
    if (r.ok && r.program) cpu.loadProgram(r.program);
    const L1 = '0123456789ABCDEF';
    const L2 = 'SCROLL 0x18     ';
    const BLANK = '                ';
    // Lấy mẫu mỗi 5k chu kỳ tới 1M (mỗi vòng lặp ~10k chu kỳ: __delay_ms(10)
    // @4MHz = 10.000 chu kỳ lệnh, vì 1 chu kỳ lệnh = 1us; SHIFT DONE tới
    // ~360k chu kỳ): mỗi lần dòng đổi thì ghi lại (khử trùng lặp liên tiếp).
    // Bước 5k đủ mịn để không bỏ sót trạng thái trống (chỉ tồn tại ~10k
    // chu kỳ giữa shift trái cuối và shift phải đầu).
    const samples = [];
    let last = null;
    let guard = 0;
    while (cpu.cycles < 1000000 && guard++ < 300) {
      runUntil(cpu, cpu.cycles + 5000);
      const cur = cpu.lcd.getLines();
      const key = cur[0] + '|' + cur[1];
      if (key !== last) { last = key; samples.push(cur); }
    }
    const blankIx = (() => {
      // Trạng thái trống lúc đầu (chưa ghi gì) cũng là 2 dòng trống — phải
      // tìm trạng thái trống SAU KHI 2 dòng đầy đã hiện (tức cuối pha 1).
      const firstFullIx = samples.findIndex((s) => s[0] === L1 && s[1] === L2);
      if (firstFullIx < 0) return -1;
      return samples.findIndex((s, i) => i > firstFullIx && s[0] === BLANK && s[1] === BLANK);
    })();
    const backIx = blankIx >= 0
      ? samples.findIndex((s, i) => i > blankIx && s[0] === L1 && s[1] === L2)
      : -1;
    check('(ah-n) pha 1: sau 16 shift trái, 2 dòng toàn khoảng trắng',
      r.ok && blankIx >= 0, `samples=${samples.length} blankIx=${blankIx}`);
    check('(ah-o) pha 2: sau 16 shift phải, 2 dòng về đúng ban đầu',
      r.ok && backIx > blankIx, `blankIx=${blankIx} backIx=${backIx}`);
    const lastS = samples[samples.length - 1];
    check('(ah-p) cuối: hiện "SHIFT DONE" / "0x18 + 0x1C"',
      r.ok && lastS && lastS[0].startsWith('SHIFT DONE') && lastS[1].startsWith('0x18 + 0x1C'),
      `last=${JSON.stringify(lastS)} samples=${samples.length}`);
  }
}

// (ba) Linh kiện mới: tụ gốm, thạch anh, LED 7 thanh (version ba)
// ---------------------------------------------------------------------------
// Trạng thái 7 thanh dùng chung cho test (ba-e/f/g): bàn 830 mặc định +
// LED 7 thanh SEG0 neo a10 (chung cathode), các đoạn a–g nối tới RB0–RB6
// (qua dây từ strip đoạn tới strip chân PIC), COM về GND (cathode) hoặc
// VCC (anode, đổi dây COM). dp không nối (để tắt).
function sevenSegTestState(common) {
  const st = defaultBenchState(830);
  st.components.push({ id: 'SEG0', type: 'sevenseg', anchor: 'a10', rot: 0, props: { common } });
  const segWire = [
    // [đoạn, lỗ kề strip đoạn, lỗ kề strip chân PIC, chân PIC]
    ['a', 'b10', 'i29', 'RB0'], ['b', 'b11', 'i28', 'RB1'],
    ['c', 'b12', 'i27', 'RB2'], ['d', 'b13', 'i26', 'RB3'],
    ['e', 'g10', 'i25', 'RB4'], ['f', 'g11', 'i24', 'RB5'],
    ['g', 'g12', 'i23', 'RB6'],
  ];
  let n = 1;
  for (const [seg, ha, hb] of segWire) {
    st.wires.push({ id: 'SEG-W' + (n++), a: ha, b: hb, color: '#2563EB' });
  }
  // Chân chung: cathode -> GND (B-13), anode -> VCC (T+13).
  st.wires.push({ id: 'SEG-W' + (n++), a: 'g13', b: common === 'anode' ? 'T+13' : 'B-13', color: '#0F172A' });
  return st;
}
// Đặt TRISB=0 (ngõ ra) + PORTB theo giá trị cho trước, trả CPU đã nối mapping.
function cpuWithPortB(state, portB) {
  const mapping = resolvePeripherals(benchToNetlist(state));
  const cpu = createCPU();
  cpu.setWiring(mapping);
  cpu.writeFile(0x03, 0x20); // bank1: RP0=1
  cpu.writeFile(0x06, 0x00); // TRISB = 0 (ngõ ra)
  cpu.writeFile(0x03, 0x00); // về bank0
  cpu.writeFile(0x06, portB); // PORTB
  return { cpu, mapping };
}
// (ba-a) Tụ gốm: 2 chân như điện trở, mặc định 22pF, id prefix C
{
  const legs = legsFor({ type: 'capacitor', anchor: 'a10', rot: 0 }, 830);
  check('(ba-a) tụ gốm: 2 chân L1/L2 cách nhau 4 cột (a10, a14), như điện trở',
    legs.length === 2 && legs[0].term === 'L1' && legs[0].hole === 'a10'
    && legs[1].term === 'L2' && legs[1].hole === 'a14',
    JSON.stringify(legs));
  check('(ba-a) tụ gốm: defaultProps value 22 (pF); nextComponentId prefix C; compLabel "Tụ gốm 0"',
    defaultProps('capacitor').value === 22
    && nextComponentId(defaultBenchState(), 'capacitor') === 'C0'
    && compLabel({ id: 'C0', type: 'capacitor' }) === 'Tụ gốm 0',
    `props=${JSON.stringify(defaultProps('capacitor'))} id=${nextComponentId(defaultBenchState(), 'capacitor')}`);
  check('(ba-a) tụ gốm: đặt được lên board (canPlace ok), chuẩn hóa props (value âm -> 22)',
    canPlace(defaultBenchState(), 'capacitor', 'a10', 0).ok === true
    && cleanNewProps('capacitor', { value: -5 }).value === 22
    && cleanNewProps('capacitor', { value: 100 }).value === 100,
    '');
}
// (ba-b) Thạch anh: 2 chân OSC1/OSC2 cách nhau 1 cột, mặc định 4MHz, id prefix X
{
  const legs = legsFor({ type: 'crystal', anchor: 'a34', rot: 0 }, 830);
  check('(ba-b) thạch anh: 2 chân OSC1/OSC2 kề nhau (a34, a35) để nối 2 chân OSC của PIC',
    legs.length === 2 && legs[0].term === 'OSC1' && legs[0].hole === 'a34'
    && legs[1].term === 'OSC2' && legs[1].hole === 'a35',
    JSON.stringify(legs));
  check('(ba-b) thạch anh: defaultProps freq 4000000; nextComponentId prefix X; compLabel "Thạch anh 0"',
    defaultProps('crystal').freq === 4000000
    && nextComponentId(defaultBenchState(), 'crystal') === 'X0'
    && compLabel({ id: 'X0', type: 'crystal' }) === 'Thạch anh 0',
    '');
  check('(ba-b) crystalFreq: bàn mặc định (không thạch anh) -> null; thạch anh 4/8/20MHz -> đúng tần số',
    crystalFreq(defaultBenchState()) === null
    && crystalFreq({ components: [{ id: 'X0', type: 'crystal', props: { freq: 4000000 } }] }) === 4000000
    && crystalFreq({ components: [{ id: 'X0', type: 'crystal', props: { freq: 8000000 } }] }) === 8000000
    && crystalFreq({ components: [{ id: 'X0', type: 'crystal', props: { freq: 20000000 } }] }) === 20000000,
    '');
  check('(ba-b) thạch anh: tần số lạ (12MHz) chuẩn hóa về 4MHz; CRYSTAL_FREQS = [4, 8, 20] MHz',
    cleanNewProps('crystal', { freq: 12000000 }).freq === 4000000
    && CRYSTAL_FREQS.join(',') === '4000000,8000000,20000000',
    '');
}
// (ba-c) LED 7 thanh: 9 chân, 2 hàng cách nhau 5 hàng (khác strip), id prefix SEG
{
  const legs = legsFor({ type: 'sevenseg', anchor: 'a10', rot: 0 }, 830);
  const byTerm = Object.fromEntries(legs.map((l) => [l.term, l.hole]));
  check('(ba-c) LED 7 thanh: 9 chân a/b/c/d/dp (hàng trên) + e/f/g/COM (hàng dưới, dr 5)',
    legs.length === 9
    && byTerm.a === 'a10' && byTerm.b === 'a11' && byTerm.c === 'a12' && byTerm.d === 'a13' && byTerm.dp === 'a14'
    && byTerm.e === 'f10' && byTerm.f === 'f11' && byTerm.g === 'f12' && byTerm.COM === 'f13',
    JSON.stringify(legs));
  check('(ba-c) LED 7 thanh: 2 chân cùng cột nhưng khác hàng (a/a10 và e/f10) KHÁC strip — không nối tắt',
    stripKey('a10', 830) !== stripKey('f10', 830)
    && stripKey('a11', 830) !== stripKey('f11', 830)
    && stripKey('a13', 830) !== stripKey('f13', 830),
    `a10=${stripKey('a10', 830)} f10=${stripKey('f10', 830)}`);
  check('(ba-c) LED 7 thanh: defaultProps common cathode; nextComponentId prefix SEG; compLabel "LED 7 thanh 0"; common lạ -> cathode',
    defaultProps('sevenseg').common === 'cathode'
    && nextComponentId(defaultBenchState(), 'sevenseg') === 'SEG0'
    && compLabel({ id: 'SEG0', type: 'sevenseg' }) === 'LED 7 thanh 0'
    && cleanNewProps('sevenseg', { common: 'anode' }).common === 'anode'
    && cleanNewProps('sevenseg', { common: 'xxx' }).common === 'cathode',
    '');
  check('(ba-c) LED 7 thanh: đặt được lên board trống (canPlace ok)',
    canPlace(defaultBenchState(), 'sevenseg', 'a10', 0).ok === true, '');
}
// (ba-d) Tụ gốm + thạch anh hở mạch với DC: không có trong netlist, không nối strip
{
  const st = defaultBenchState(830);
  st.components.push({ id: 'C0', type: 'capacitor', anchor: 'a10', rot: 0, props: { value: 22 } });
  st.components.push({ id: 'X0', type: 'crystal', anchor: 'a34', rot: 0, props: { freq: 4000000 } });
  const { termRoot } = buildBenchNets(st);
  const nl = benchToNetlist(st);
  check('(ba-d) tụ/thạch anh: chân không có trong netlist (termRoot không có C0.L1, X0.OSC1)',
    termRoot.get('C0.L1') === undefined && termRoot.get('C0.L2') === undefined
    && termRoot.get('X0.OSC1') === undefined && termRoot.get('X0.OSC2') === undefined,
    `C0.L1=${termRoot.get('C0.L1')} X0.OSC1=${termRoot.get('X0.OSC1')}`);
  check('(ba-d) tụ/thạch anh: không có trong benchToNetlist (không phải ngoại vi CPU)',
    nl.components.every((c) => c.kind !== 'capacitor' && c.kind !== 'crystal'),
    JSON.stringify(nl.components.map((c) => c.kind)));
  // Tụ nối strip RB0 với GND (qua 2 dây): vì tụ hở mạch nên RB0 KHÔNG
  // nối về GND, checkWiring không báo chập, LED0 vẫn sáng khi RB0=1.
  const st2 = defaultBenchState(830);
  st2.components.push({ id: 'C0', type: 'capacitor', anchor: 'i10', rot: 0, props: { value: 22 } });
  st2.components.push({ id: 'LED0', type: 'led', anchor: 'i52', rot: 0, props: { color: '#DC2626' } });
  st2.components.push({ id: 'R0', type: 'resistor', anchor: 'i45', rot: 0, props: { value: 220 } });
  st2.wires.push({ id: 'T1', a: 'j14', b: 'i29', color: '#2563EB' }); // tụ (strip i14) -> RB0 (strip h29)
  st2.wires.push({ id: 'T2', a: 'j10', b: 'B-10', color: '#0F172A' }); // tụ (strip i10) -> GND
  st2.wires.push({ id: 'T3', a: 'i29', b: 'j45', color: '#DC2626' }); // RB0 -> điện trở
  st2.wires.push({ id: 'T4', a: 'j49', b: 'j52', color: '#DC2626' }); // điện trở -> anode LED
  st2.wires.push({ id: 'T5', a: 'j53', b: 'B-50', color: '#0F172A' }); // cathode LED -> GND
  const warns2 = checkWiring(benchToNetlist(st2), null);
  const { cpu: cpu2, mapping: map2 } = cpuWithPortB(st2, 0x01);
  check('(ba-d) tụ nối RB0–GND (qua dây): RB0 KHÔNG chập về GND, checkWiring 0 cảnh báo, LED0 vẫn sáng khi RB0=1',
    warns2.length === 0 && ledStates(cpu2, map2).find((s) => s.id === 'LED0').on === true,
    `warns=${JSON.stringify(warns2.map((w) => w.message))}`);
}
// (ba-e) LED 7 thanh chung cathode: đoạn sáng khi chân PIC mức 1 và COM về GND
{
  const st = sevenSegTestState('cathode');
  const { cpu, mapping } = cpuWithPortB(st, 0x7f); // RB0–RB6 = 1
  const seg = sevenSegStates(cpu, mapping).find((s) => s.id === 'SEG0');
  check('(ba-e) chung cathode, PORTB=0x7F: các đoạn a–g SÁNG, dp TẮT (không nối), hiện số 8',
    seg && seg.common === 'cathode'
    && ['a', 'b', 'c', 'd', 'e', 'f', 'g'].every((t) => seg.on[t] === true)
    && seg.on.dp === false && sevenSegDigit(seg.on) === '8',
    JSON.stringify(seg && seg.on));
  const { cpu: cpu1 } = cpuWithPortB(st, 0x06); // chỉ RB1, RB2 = 1
  const seg1 = sevenSegStates(cpu1, mapping).find((s) => s.id === 'SEG0');
  check('(ba-e) chung cathode, PORTB=0x06: chỉ đoạn b, c SÁNG, hiện số 1',
    seg1 && seg1.on.b === true && seg1.on.c === true
    && ['a', 'd', 'e', 'f', 'g', 'dp'].every((t) => seg1.on[t] === false)
    && sevenSegDigit(seg1.on) === '1',
    JSON.stringify(seg1 && seg1.on));
  const { cpu: cpu0 } = cpuWithPortB(st, 0x00); // tất cả mức 0
  const seg0 = sevenSegStates(cpu0, mapping).find((s) => s.id === 'SEG0');
  check('(ba-e) chung cathode, PORTB=0x00: tất cả đoạn TẮT, không hiện số (null)',
    seg0 && Object.values(seg0.on).every((v) => v === false) && sevenSegDigit(seg0.on) === null,
    JSON.stringify(seg0 && seg0.on));
  // sevenSegReadings (qua circuit-solver) cho cùng kết quả.
  const rd = sevenSegReadings(st, cpu, []);
  check('(ba-e) sevenSegReadings (circuit-solver) khớp sevenSegStates',
    rd.length === 1 && rd[0].id === 'SEG0' && rd[0].on.a === true && rd[0].on.dp === false,
    JSON.stringify(rd));
}
// (ba-f) LED 7 thanh chung anode: đoạn sáng khi chân PIC mức 0 và COM về VCC
{
  const st = sevenSegTestState('anode');
  const { cpu, mapping } = cpuWithPortB(st, 0x00); // tất cả mức 0
  const seg = sevenSegStates(cpu, mapping).find((s) => s.id === 'SEG0');
  check('(ba-f) chung anode, PORTB=0x00: các đoạn a–g SÁNG, dp TẮT, hiện số 8',
    seg && seg.common === 'anode'
    && ['a', 'b', 'c', 'd', 'e', 'f', 'g'].every((t) => seg.on[t] === true)
    && seg.on.dp === false && sevenSegDigit(seg.on) === '8',
    JSON.stringify(seg && seg.on));
  const { cpu: cpuH } = cpuWithPortB(st, 0x7f); // tất cả mức 1
  const segH = sevenSegStates(cpuH, mapping).find((s) => s.id === 'SEG0');
  check('(ba-f) chung anode, PORTB=0x7F: tất cả đoạn TẮT (đoạn mức 1, chung VCC — không thuận)',
    segH && Object.values(segH.on).every((v) => v === false),
    JSON.stringify(segH && segH.on));
}
// (ba-g) Solver: đoạn sáng là 1 nhánh LED (2V + 10Ω) — dòng qua đoạn ~0.3A; đoạn tắt không có nhánh
{
  const st = sevenSegTestState('cathode');
  const { cpu } = cpuWithPortB(st, 0x7f); // a–g sáng
  const { ok, branchCurrent } = solveCircuit(st, cpu, []);
  const iA = branchCurrent.get('SEG0.a');
  const iG = branchCurrent.get('SEG0.g');
  check('(ba-g) solver: đoạn sáng có dòng qua nhánh (a, g ≈ 0.3A = (5V−2V)/10Ω), đoạn tắt (dp) không có nhánh',
    ok === true && Number.isFinite(iA) && Math.abs(iA - 0.3) < 0.02
    && Number.isFinite(iG) && Math.abs(iG - 0.3) < 0.02
    && branchCurrent.has('SEG0.dp') === false,
    `ok=${ok} iA=${iA} iG=${iG} hasDp=${branchCurrent.has('SEG0.dp')}`);
  // Đoạn sáng nhưng chân chung chưa nối (COM thả nổi) thì không sáng:
  // gỡ dây COM, đoạn a phải tắt và không có nhánh trong solver.
  const st2 = sevenSegTestState('cathode');
  st2.wires = st2.wires.filter((w) => w.id !== 'SEG-W8'); // gỡ dây COM->GND
  const { cpu: cpu2, mapping: map2 } = cpuWithPortB(st2, 0x7f);
  const seg2 = sevenSegStates(cpu2, map2).find((s) => s.id === 'SEG0');
  const r2 = solveCircuit(st2, cpu2, []);
  check('(ba-g) COM chưa nối: tất cả đoạn TẮT, solver không có nhánh đoạn nào',
    seg2 && Object.values(seg2.on).every((v) => v === false)
    && r2.ok === true && [...r2.branchCurrent.keys()].every((k) => !k.startsWith('SEG0.')),
    JSON.stringify(seg2 && seg2.on));
}
// (ba-h) sevenSegDigit: bảng mã số 0–9, A–F và null khi không phải số
{
  const on = (...ts) => { const o = { a: false, b: false, c: false, d: false, e: false, f: false, g: false, dp: false }; for (const t of ts) o[t] = true; return o; };
  check('(ba-h) sevenSegDigit: 0–9 đúng bảng mã 7 đoạn',
    sevenSegDigit(on('a', 'b', 'c', 'd', 'e', 'f')) === '0'
    && sevenSegDigit(on('b', 'c')) === '1'
    && sevenSegDigit(on('a', 'b', 'd', 'e', 'g')) === '2'
    && sevenSegDigit(on('a', 'b', 'c', 'd', 'g')) === '3'
    && sevenSegDigit(on('b', 'c', 'f', 'g')) === '4'
    && sevenSegDigit(on('a', 'c', 'd', 'f', 'g')) === '5'
    && sevenSegDigit(on('a', 'c', 'd', 'e', 'f', 'g')) === '6'
    && sevenSegDigit(on('a', 'b', 'c')) === '7'
    && sevenSegDigit(on('a', 'b', 'c', 'd', 'e', 'f', 'g')) === '8'
    && sevenSegDigit(on('a', 'b', 'c', 'd', 'f', 'g')) === '9',
    '');
  check('(ba-h) sevenSegDigit: A–F (b/C/d/E/F) và dp không ảnh hưởng số; mẫu lạ -> null',
    sevenSegDigit(on('a', 'b', 'c', 'e', 'f', 'g')) === 'A'
    && sevenSegDigit(on('c', 'd', 'e', 'f', 'g')) === 'b'
    && sevenSegDigit(on('a', 'd', 'e', 'f')) === 'C'
    && sevenSegDigit(on('b', 'c', 'd', 'e', 'g')) === 'd'
    && sevenSegDigit(on('a', 'd', 'e', 'f', 'g')) === 'E'
    && sevenSegDigit(on('a', 'e', 'f', 'g')) === 'F'
    && sevenSegDigit(on('a', 'b', 'c', 'dp')) === '7' // dp không tính vào số
    && sevenSegDigit(on('a', 'g')) === null
    && sevenSegDigit(null) === null,
    '');
}
// (ba-i) Lab 1/2 có thạch anh 4MHz (crystalFreq) — bàn mặc định thì không có
{
  check('(ba-i) crystalFreq: Lab 1 và Lab 2 đều 4000000 (thạch anh X0); bàn mặc định null',
    crystalFreq(buildLabState(LABS[0]).state) === 4000000
    && crystalFreq(buildLabState(LABS[1]).state) === 4000000
    && crystalFreq(defaultBenchState()) === null,
    '');
  check('(ba-i) Lab 1/2 desc nhắc tới thạch anh + tụ gốm (chỉ linh kiện + đấu nối, không vi phạm quy tắc desc)',
    LABS[0].desc.includes('Thạch anh') && LABS[0].desc.includes('tụ gốm 22pF')
    && LABS[1].desc.includes('Thạch anh') && LABS[1].desc.includes('tụ gốm 22pF')
    && !LABS[0].desc.includes('100 cột') && !LABS[1].desc.includes('100 cột'),
    LABS[0].desc);
}

// Nhóm (be): 3 linh kiện mới — bàn phím 4x4 (keypad), động cơ DC (motor),
// màn hình Serial (serial). Version be (2026-11-27).
// - Keypad: 2 hàng chân (R0–R3 ở dr 0, C0–C3 ở dr 5, cách nhau 5 hàng để
//   không nối tắt qua strip). Phím nhấn nối hàng với cột (công tắc đóng)
//   trong netlist/solver; CPU phát hiện qua pinLevel (keypadPressed) —
//   quét hàng: lái hàng xuống 0, cột đọc 0 khi phím nhấn, 1 khi không
//   (pull-up). Mapping chân lấy từ netlist KHÔNG nhấn phím (phím nhấn nối
//   hàng+cột thành 1 net chứa 2 chân PIC, picPinInNet sẽ lấy nhầm).
// - Motor: tải trở (điện trở cuộn dây mặc định 100Ω) giữa 2 chân +/−;
//   RPM = volts/20 × 1000. PWM: tốc độ theo điện áp trung bình (duty).
// - Serial: linh kiện ngoài bàn (như scope), 3 cọc TX/RX/GND; dữ liệu
//   chạy qua CPU onTx/receiveChar, dây/cọc chỉ để mạch đầy đủ.
{
  const approx = (v, target, tol) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v - target) <= tol;
  // Bàn phím KP0 neo a10, nối hàng R0–R3 -> RB0–RB3 (h29/h28/h27/h26),
  // cột C0–C3 -> RD0–RD3 (b40/b41/h41/h40).
  const keypadState = () => {
    const st = defaultBenchState(830);
    st.components.push({ id: 'KP0', type: 'keypad', anchor: 'a10', rot: 0, props: {} });
    st.wires.push({ id: 'T-R0', a: 'a10', b: 'h29', color: '#DC2626' });
    st.wires.push({ id: 'T-R1', a: 'a11', b: 'h28', color: '#DC2626' });
    st.wires.push({ id: 'T-R2', a: 'a12', b: 'h27', color: '#DC2626' });
    st.wires.push({ id: 'T-R3', a: 'a13', b: 'h26', color: '#DC2626' });
    st.wires.push({ id: 'T-C0', a: 'f10', b: 'b40', color: '#2563EB' });
    st.wires.push({ id: 'T-C1', a: 'f11', b: 'b41', color: '#2563EB' });
    st.wires.push({ id: 'T-C2', a: 'f12', b: 'h41', color: '#2563EB' });
    st.wires.push({ id: 'T-C3', a: 'f13', b: 'h40', color: '#2563EB' });
    return st;
  };
  // (be-a) Keypad: chân, đặt được, id/nhãn, bảng phím.
  check('(be-a) keypad chân R0–R3 a10–a13, C0–C3 f10–f13; đặt được, id KP0, nhãn "Bàn phím 4x4 0", KEYPAD_KEYS đúng',
    JSON.stringify(legsFor({ type: 'keypad', anchor: 'a10', rot: 0 }, 830)) === JSON.stringify([
      { term: 'R0', hole: 'a10' }, { term: 'R1', hole: 'a11' }, { term: 'R2', hole: 'a12' }, { term: 'R3', hole: 'a13' },
      { term: 'C0', hole: 'f10' }, { term: 'C1', hole: 'f11' }, { term: 'C2', hole: 'f12' }, { term: 'C3', hole: 'f13' },
    ])
    && canPlace(defaultBenchState(830), 'keypad', 'a10').ok
    && nextComponentId(defaultBenchState(830), 'keypad') === 'KP0'
    && compLabel({ id: 'KP0', type: 'keypad' }) === 'Bàn phím 4x4 0'
    && KEYPAD_KEYS[0].join('') === '123A' && KEYPAD_KEYS[1].join('') === '456B'
    && KEYPAD_KEYS[2].join('') === '789C' && KEYPAD_KEYS[3].join('') === '*0#D', '');
  // (be-b) Keypad: phím nhấn nối hàng với cột trong netlist, không nhấn thì tách.
  check('(be-b) keypad netlist: nhấn phím 5 (hàng 1, cột 1) -> R1 và C1 cùng net, R0/C0 vẫn tách; không nhấn -> R1/C1 tách',
    (() => {
      const st = keypadState();
      const pressed = { id: 'KP0', row: 1, col: 1 };
      const n = buildBenchNets(st, [], pressed);
      const nFree = buildBenchNets(st, []);
      return n.termRoot.get('KP0.R1') === n.termRoot.get('KP0.C1')
        && n.termRoot.get('KP0.R0') !== n.termRoot.get('KP0.C0')
        && nFree.termRoot.get('KP0.R1') !== nFree.termRoot.get('KP0.C1');
    })(), '');
  // (be-c) Keypad: resolvePeripherals từ netlist KHÔNG nhấn phím -> hàng
  // RB0–RB3, cột RD0–RD3. (Netlist CÓ nhấn phím thì R1/C1 cùng net chứa
  // cả RB1 lẫn RD1 nên picPinInNet lấy nhầm — xem syncToCpu bench.js.)
  check('(be-c) keypad resolvePeripherals (netlist không nhấn): 1 keypad, hàng RB0–RB3, cột RD0–RD3',
    (() => {
      const m = resolvePeripherals(benchToNetlist(keypadState(), []));
      return m.keypads.length === 1
        && m.keypads[0].rows.map((p) => p && p.id).join(',') === 'RB0,RB1,RB2,RB3'
        && m.keypads[0].cols.map((p) => p && p.id).join(',') === 'RD0,RD1,RD2,RD3';
    })(), '');
  // (be-d) Keypad: CPU quét phát hiện phím đang nhấn (end-to-end).
  // TRISB RB0–RB3 output, TRISD RD0–RD3 input; lái RB1 xuống 0, nhấn phím
  // '5' (hàng 1, cột 1) -> RD1 đọc 0, các cột khác 1; lái hàng khác thì
  // RD1 đọc 1; nhả phím thì RD1 đọc 1; phím 'A' (hàng 0, cột 3) tương tự.
  check('(be-d) keypad quét: nhấn 5 + lái RB1 xuống 0 -> RD1=0, cột khác=1; lái RB0 -> RD1=1; nhả -> RD1=1; phím A + RB0 -> RD3=0',
    (() => {
      const mapping = resolvePeripherals(benchToNetlist(keypadState(), []));
      const cpu = createCPU();
      cpu.setWiring(mapping);
      cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0xF0); cpu.writeFile(0x08, 0xFF);
      cpu.writeFile(0x03, 0x00);
      cpu.writeFile(0x06, 0xFD); // RB1=0, các hàng khác=1
      if (!(cpu.pinLevel(3, 0) === 1 && cpu.pinLevel(3, 1) === 1 && cpu.pinLevel(3, 2) === 1 && cpu.pinLevel(3, 3) === 1)) return false;
      applyKeypadToCpu(cpu, mapping, 'KP0', { row: 1, col: 1 });
      if (!(cpu.pinLevel(3, 1) === 0 && cpu.pinLevel(3, 0) === 1 && cpu.pinLevel(3, 2) === 1 && cpu.pinLevel(3, 3) === 1)) return false;
      cpu.writeFile(0x06, 0xFE); // RB0=0, RB1=1
      if (cpu.pinLevel(3, 1) !== 1) return false;
      cpu.writeFile(0x06, 0xFD); // RB1=0 lại
      if (cpu.pinLevel(3, 1) !== 0) return false;
      applyKeypadToCpu(cpu, mapping, 'KP0', null);
      if (cpu.pinLevel(3, 1) !== 1) return false;
      applyKeypadToCpu(cpu, mapping, 'KP0', { row: 0, col: 3 });
      cpu.writeFile(0x06, 0xFE); // RB0=0
      return cpu.pinLevel(3, 3) === 0 && cpu.pinLevel(3, 1) === 1;
    })(), '');
  // (be-e) Motor: chân, đặt được, id/nhãn, điện trở mặc định 100Ω.
  check('(be-e) motor chân + a10, - a11; đặt được, id M0, nhãn "Động cơ DC 0", R mặc định 100Ω, MOTOR_MAX_RPM=1000',
    JSON.stringify(legsFor({ type: 'motor', anchor: 'a10', rot: 0 }, 830)) === JSON.stringify([{ term: '+', hole: 'a10' }, { term: '-', hole: 'a11' }])
    && canPlace(defaultBenchState(830), 'motor', 'a10').ok
    && nextComponentId(defaultBenchState(830), 'motor') === 'M0'
    && compLabel({ id: 'M0', type: 'motor' }) === 'Động cơ DC 0'
    && defaultProps('motor').value === 100 && MOTOR_MAX_RPM === 1000, '');
  // (be-f) Motor qua PSU 5V: V=5, I=50mA (R=100Ω), RPM=250 (20V mới là
  // 1000); R=50Ω thì I=100mA, RPM vẫn 250; chưa nối dây thì null.
  check('(be-f) motor qua PSU 5V: V=5, I=50mA, RPM=250; R=50Ω -> I=100mA, RPM vẫn 250; chưa nối -> null',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'M0', type: 'motor', anchor: 'a10', rot: 0, props: { value: 100 } });
      st.wires.push({ id: 'T-M1', a: 'a10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-M2', a: 'a11', b: 'T-10', color: '#0F172A' });
      const cpu = createCPU();
      const r = motorReadings(st, cpu);
      if (!(r.length === 1 && approx(r[0].volts, 5, 0.01) && approx(r[0].amps, 0.05, 0.001) && approx(r[0].rpm, 250, 1))) return false;
      st.components.find((c) => c.id === 'M0').props.value = 50;
      const r2 = motorReadings(st, cpu);
      if (!(approx(r2[0].amps, 0.1, 0.001) && approx(r2[0].rpm, 250, 1))) return false;
      const st2 = defaultBenchState(830);
      st2.components.push({ id: 'M0', type: 'motor', anchor: 'a10', rot: 0, props: { value: 100 } });
      const r3 = motorReadings(st2, cpu);
      return r3.length === 1 && r3[0].volts === null && r3[0].amps === null && r3[0].rpm === null;
    })(), '');
  // (be-g) Motor nối chân PIC RB0: RB0=1 -> 250 RPM, RB0=0 -> 0 RPM.
  check('(be-g) motor RB0=1: V=5, I=50mA, RPM=250; RB0=0: V=0, I=0, RPM=0',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'M0', type: 'motor', anchor: 'a10', rot: 0, props: { value: 100 } });
      st.wires.push({ id: 'T-M1', a: 'a10', b: 'h29', color: '#DC2626' });
      st.wires.push({ id: 'T-M2', a: 'a11', b: 'B-11', color: '#0F172A' });
      const cpu = createCPU();
      const setRB0 = (high) => {
        cpu.writeFile(0x03, 0x20); cpu.writeFile(0x06, 0x00);
        cpu.writeFile(0x03, 0x00); cpu.writeFile(0x06, high ? 0x01 : 0x00);
      };
      setRB0(true);
      const rHi = motorReadings(st, cpu);
      if (!(approx(rHi[0].volts, 5, 0.01) && approx(rHi[0].amps, 0.05, 0.001) && approx(rHi[0].rpm, 250, 1))) return false;
      setRB0(false);
      const rLo = motorReadings(st, cpu);
      return approx(rLo[0].volts, 0, 0.01) && approx(rLo[0].amps, 0, 0.001) && approx(rLo[0].rpm, 0, 1);
    })(), '');
  // (be-h) Motor PWM 50% (CCP1 -> RC2, PR2=255, CCPR1L=127): tốc độ trung
  // bình ~125 (80–170), có lúc 0 và lúc 250. Chu kỳ PWM 256 dài hơn
  // bước lấy mẫu 20 nên không aliasing (PR2=3, chu kỳ 4, lấy mẫu mỗi 20
  // thì luôn trúng cùng 1 pha — đã dính 1 lần).
  check('(be-h) motor PWM 50% (CCP1, PR2=255, CCPR1L=127): RPM trung bình 80–170, min=0, max=250',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'M0', type: 'motor', anchor: 'a10', rot: 0, props: { value: 100 } });
      st.wires.push({ id: 'T-M1', a: 'a10', b: 'b38', color: '#DC2626' }); // RC2 (CCP1, pin 17)
      st.wires.push({ id: 'T-M2', a: 'a11', b: 'B-11', color: '#0F172A' });
      const cpu = createCPU();
      cpu.loadProgram(assemble(`
        BANKSEL PR2
        MOVLW 255
        MOVWF PR2
        BANKSEL CCPR1L
        MOVLW 127
        MOVWF CCPR1L
        MOVLW b'00001100'
        MOVWF CCP1CON
        BANKSEL T2CON
        MOVLW b'00000100'
        MOVWF T2CON
      `).program);
      cpu.run(100);
      let sum = 0, n = 0, min = 1e9, max = -1e9;
      for (let i = 0; i < 200; i++) {
        for (let k = 0; k < 20; k++) cpu.step();
        const r = motorReadings(st, cpu);
        if (r.length && r[0].rpm !== null) {
          sum += r[0].rpm; n++;
          min = Math.min(min, r[0].rpm); max = Math.max(max, r[0].rpm);
        }
      }
      const avg = n ? sum / n : 0;
      return n > 10 && avg > 80 && avg < 170 && min === 0 && max === 250;
    })(), '');
  // (be-i) Serial: cọc TX/RX/GND đúng tọa độ mặt trước, ngoài bàn
  // (legsFor=[]), đặt được, id SER0, nhãn "Màn hình Serial 0", vị trí
  // mặc định (-130,-150) đối xứng scope (+130,-150).
  check('(be-i) serial cọc TX/RX/GND đúng tọa độ; legsFor=[]; id SER0; nhãn "Màn hình Serial 0"; mặc định (-130,-150)',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'SER0', type: 'serial', tx: -130, tz: -150, fixed: false, props: {} });
      const tx = serialPostPos(st, 'SER0.TX');
      const rx = serialPostPos(st, 'SER0.RX');
      const gnd = serialPostPos(st, 'SER0.GND');
      const pTx = parseSerialPost('SER0.TX');
      return tx && tx.x === -158 && tx.y === 10 && tx.z === -124
        && rx && rx.x === -130 && rx.y === 10 && rx.z === -124
        && gnd && gnd.x === -102 && gnd.y === 10 && gnd.z === -124
        && pTx && pTx.serialId === 'SER0' && pTx.term === 'TX'
        && parseSerialPost('SER0.RX').term === 'RX' && parseSerialPost('SER0.GND').term === 'GND'
        && parseSerialPost('OSC0.CH1') === null && parseSerialPost('SER0.CH1') === null
        && serialPostPos(st, 'SER9.TX') === null
        && legsFor({ type: 'serial', tx: -130, tz: -150 }, 830).length === 0
        && canPlace(defaultBenchState(830), 'serial').ok
        && nextComponentId(defaultBenchState(830), 'serial') === 'SER0'
        && compLabel({ id: 'SER0', type: 'serial' }) === 'Màn hình Serial 0'
        && SERIAL_DEFAULT_TX === -130 && SERIAL_DEFAULT_TZ === -150
        && SERIAL_POST_DX === 28 && SERIAL_POST_Y === 10 && SERIAL_POST_DZ === 26;
    })(), '');
  // (be-j) Serial: dây tới cọc Serial không nối strip (không ảnh hưởng
  // mạch, như scope); Serial không vào netlist CPU; validate/retarget
  // đầu dây sang cọc Serial (SER0.TX ok, SER9.TX từ chối).
  check('(be-j) serial: dây tới cọc không nối strip; serial không vào netlist CPU; validate/retarget SER0.TX ok, SER9.TX từ chối',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'SER0', type: 'serial', tx: -130, tz: -150, fixed: false, props: {} });
      st.components.push({ id: 'LED0', type: 'led', anchor: 'c10', rot: 0, props: { color: '#DC2626' } });
      st.components.push({ id: 'LED1', type: 'led', anchor: 'c14', rot: 0, props: { color: '#DC2626' } });
      st.wires.push({ id: 'T-S1', a: 'a10', b: 'SER0.TX', color: '#4ADE80' });
      const n = buildBenchNets(st);
      if (n.termRoot.get('LED0.A') === n.termRoot.get('LED1.A')) return false;
      if (benchToNetlist(st, []).components.some((c) => c.id === 'SER0')) return false;
      st.wires.push({ id: 'T-V1', a: 'f29', b: 'B-50', color: '#DC2626' });
      const v1 = validateWireEnd(st, 'T-V1', 'b', 'SER0.TX');
      const v2 = validateWireEnd(st, 'T-V1', 'b', 'SER9.TX');
      if (!v1.ok || v2.ok) return false;
      const r = retargetWireEnd(st, 'T-V1', 'b', 'SER0.TX');
      return r.ok && st.wires.find((w) => w.id === 'T-V1').b === 'SER0.TX';
    })(), '');
  // (be-k) Serial: chương trình C UART thật gửi "Hi" qua TXREG (onTx nối
  // vào buffer như app.js); gửi 'A' về qua receiveChar -> RCREG=65,
  // RCIF=1 (đọc qua readSFR); đọc RCREG -> RCIF xóa. Dùng TRISC=0x80
  // (RC7 input) vì trình biên dịch chưa hiểu tên bit trần TRISC6/TRISC7.
  check('(be-k) serial end-to-end: code C UART gửi "Hi" (onTx + txLog); receiveChar A -> RCREG=65, RCIF=1; đọc RCREG -> RCIF xóa',
    (() => {
      const uartC = `#include <xc.h>
#define _XTAL_FREQ 4000000

void main() {
  TRISC = 0x80;
  SPBRG = 25;
  TXSTA = 0x24;
  RCSTA = 0x90;
  while (!PIR1bits.TXIF);
  TXREG = 'H';
  while (!PIR1bits.TXIF);
  TXREG = 'i';
  while (1);
}
`;
      const compiled = compileC(uartC);
      if (!compiled.ok) return false;
      const cpu = createCPU();
      cpu.clockHz = 4000000;
      let buf = '';
      cpu.onTx = (code) => { buf += String.fromCharCode(code); };
      const runner = new ProgramRunner(cpu);
      const loaded = runner.loadAsm(compiled.asm);
      if (!loaded.ok) return false;
      runner.run();
      for (let i = 0; i < 200000 && buf.length < 2; i++) cpu.step();
      if (buf !== 'Hi') return false;
      if (!(cpu.txLog.length === 2 && cpu.txLog[0] === 72 && cpu.txLog[1] === 105)) return false;
      cpu.receiveChar(65); // 'A'
      if (!(cpu.sfr.RCREG === 65 && ((cpu.readSFR('PIR1') >> 5) & 1) === 1)) return false;
      const readBack = cpu.readFile(0x1A); // RCREG
      return readBack === 65 && ((cpu.readSFR('PIR1') >> 5) & 1) === 0;
    })(), '');
  // (be-l) bench.js có đủ 3 linh kiện mới trong palette + hàm vẽ màn hình
  // Serial + bridge keypad/motor/serial (kiểm tra bằng chuỗi, như (ag-g2)).
  check('(be-l) bench.js: palette có keypad/motor/serial; drawSerialScreen + serialTexs + pickSerialPost + pressBenchKeypad + getMotorState/getSerialText/sendSerial/getKeypadState',
    (() => {
      const src = readFileSync(new URL('./public/bench.js', import.meta.url), 'utf8');
      return src.includes("type: 'keypad'") && src.includes("type: 'motor'") && src.includes("type: 'serial'")
        && src.includes('Bàn phím 4x4') && src.includes('Động cơ DC') && src.includes('Màn hình Serial')
        && src.includes('function drawSerialScreen(') && src.includes('serialTexs')
        && src.includes('pickSerialPost') && src.includes('serialPostPos(state, e)')
        && src.includes('pressBenchKeypad') && src.includes('keypadKeyMeshes')
        && src.includes('motorFans') && src.includes('getMotorState')
        && src.includes('getSerialText') && src.includes('sendSerial') && src.includes('getKeypadState')
        && src.includes("type: 'keypad'") && src.includes('SERIAL_DEFAULT_TX');
    })(), '');
  // (be-m) app.js có bridge keypad/motor/serial + hook onTx nối buffer.
  check('(be-m) app.js: getKeypadState/pressKeypad/getMotorState/getSerialText/sendSerial/clearSerial + cpu.onTx nối serialBuffers',
    (() => {
      const src = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
      return src.includes('getKeypadState') && src.includes('pressKeypad')
        && src.includes('getMotorState') && src.includes('motorReadings')
        && src.includes('getSerialText') && src.includes('sendSerial') && src.includes('clearSerial')
        && src.includes('cpu.onTx') && src.includes('serialBuffers');
    })(), '');
}

// Nhóm (p0): P0 Issues 1+2 — LED/7 đoạn/còi quyết định từ điện áp đã giải
// (không còn theo mức logic VCC/GND/chân PIC), còi có nhánh trong solver.
{
  const approx = (v, target, tol) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v - target) <= tol;
  // Chiết áp POT0 (a10: VCC=a10, W=a11, GND=a12), VCC->+5V, GND->GND.
  const potState = (pct) => {
    const st = defaultBenchState(830);
    st.components.push({ id: 'POT0', type: 'pot', anchor: 'a10', rot: 0, props: { pct } });
    st.wires.push({ id: 'T-P1', a: 'b10', b: 'T+10', color: '#DC2626' });
    st.wires.push({ id: 'T-P2', a: 'b12', b: 'T-10', color: '#0F172A' });
    return st;
  };
  // Chiết áp -> R 220Ω -> LED -> GND, ampe kế nối tiếp (W=b11, R=a20/a24, LED=c30/c31, MM=a40/a44).
  const potLedState = (pct) => {
    const st = potState(pct);
    st.components.push({ id: 'R0', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 220 } });
    st.components.push({ id: 'LED0', type: 'led', anchor: 'c30', rot: 0, props: { color: '#DC2626' } });
    st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a40', rot: 0, props: { mode: 'A' } });
    st.wires.push({ id: 'T-A1', a: 'b11', b: 'b20', color: '#2563EB' });
    st.wires.push({ id: 'T-A2', a: 'b24', b: 'b30', color: '#2563EB' });
    st.wires.push({ id: 'T-A3', a: 'b31', b: 'b40', color: '#2563EB' });
    st.wires.push({ id: 'T-A4', a: 'b44', b: 'T-40', color: '#0F172A' });
    return st;
  };
  const ledOnOf = (st, cpu) => ledStates(solveCircuit(st, cpu), st);
  const buzOnOf = (st, cpu) => buzzerStates(solveCircuit(st, cpu), st);
  const segOnOf = (st, cpu) => sevenSegStates(solveCircuit(st, cpu), st);
  // (p0-a) Pot 100% -> R220 -> LED: LED SÁNG, ampe kế ≈ 13.04mA = (5-2)/(220+10).
  check('(p0-a) pot 100% -> R220 -> LED -> GND: LED SÁNG, ampe kế ≈ 13.04mA',
    (() => {
      const st = potLedState(100);
      const cpu = createCPU();
      return ledOnOf(st, cpu).find((s) => s.id === 'LED0').on === true
        && approx(meterReadings(st, cpu).ammeters[0].amps, 0.01304, 0.001);
    })(), '');
  // (p0-a) Pot 0%: LED TỐI, dòng 0.
  check('(p0-a) pot 0% -> R220 -> LED -> GND: LED TỐI, dòng 0',
    (() => {
      const st = potLedState(0);
      const cpu = createCPU();
      return ledOnOf(st, cpu).find((s) => s.id === 'LED0').on === false
        && meterReadings(st, cpu).ammeters[0].amps === 0;
    })(), '');
  // (p0-b) Đoạn a 7 thanh nối wiper 100%, COM -> GND: chỉ đoạn a SÁNG, dòng ≈ 0.3A.
  check('(p0-b) đoạn a 7 thanh nối wiper 100%, COM->GND: chỉ a SÁNG, dòng ≈ 0.3A',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'POT0', type: 'pot', anchor: 'a30', rot: 0, props: { pct: 100 } });
      st.components.push({ id: 'SEG0', type: 'sevenseg', anchor: 'a10', rot: 0, props: { common: 'cathode' } });
      st.wires.push({ id: 'T-B1', a: 'b30', b: 'T+30', color: '#DC2626' });
      st.wires.push({ id: 'T-B2', a: 'b32', b: 'T-30', color: '#0F172A' });
      st.wires.push({ id: 'T-B3', a: 'b31', b: 'b10', color: '#2563EB' });
      st.wires.push({ id: 'T-B4', a: 'g13', b: 'B-13', color: '#0F172A' });
      const cpu = createCPU();
      const seg = segOnOf(st, cpu).find((s) => s.id === 'SEG0');
      return seg && seg.on.a === true && ['b', 'c', 'd', 'e', 'f', 'g', 'dp'].every((t) => seg.on[t] === false)
        && approx(solveCircuit(st, cpu).branchCurrent.get('SEG0.a'), 0.3, 0.02);
    })(), '');
  // (p0-c) Còi P -> wiper 100%, N -> GND: còi KÊU, dòng ≈ 22.7mA (5V/220Ω).
  check('(p0-c) còi P->wiper 100%, N->GND: còi KÊU, dòng ≈ 22.7mA',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'POT0', type: 'pot', anchor: 'a30', rot: 0, props: { pct: 100 } });
      st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
      st.wires.push({ id: 'T-C1', a: 'b30', b: 'T+30', color: '#DC2626' });
      st.wires.push({ id: 'T-C2', a: 'b32', b: 'T-30', color: '#0F172A' });
      st.wires.push({ id: 'T-C3', a: 'b31', b: 'b10', color: '#2563EB' });
      st.wires.push({ id: 'T-C4', a: 'b11', b: 'T-10', color: '#0F172A' });
      const cpu = createCPU();
      return buzOnOf(st, cpu).find((s) => s.id === 'BUZ0').on === true
        && approx(solveCircuit(st, cpu).branchCurrent.get('BUZ0'), 5 / 220, 0.001);
    })(), '');
  // (p0-d) PSU+ -> MM(A) -> còi -> GND + vôn kế ngang còi: ≈ 22.7mA (không phải 0), ≈ 5V.
  check('(p0-d) PSU+ -> MM(A) -> còi -> GND: ampe kế ≈ 22.7mA, vôn kế ngang còi ≈ 5V',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a20', rot: 0, props: { mode: 'A' } });
      st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
      st.components.push({ id: 'MM1', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-D1', a: 'b20', b: 'T+20', color: '#DC2626' });
      st.wires.push({ id: 'T-D2', a: 'b24', b: 'b10', color: '#2563EB' });
      st.wires.push({ id: 'T-D3', a: 'b11', b: 'T-10', color: '#0F172A' });
      st.wires.push({ id: 'T-D4', a: 'b30', b: 'b10', color: '#2563EB' });
      st.wires.push({ id: 'T-D5', a: 'b34', b: 'b11', color: '#2563EB' });
      const r = meterReadings(st, createCPU());
      return approx(r.ammeters.find((m) => m.id === 'MM0').amps, 5 / 220, 0.001)
        && approx(r.voltmeters.find((m) => m.id === 'MM1').volts, 5, 0.05);
    })(), '');
  // (p0-e) PSU+ -> còi -> R 220Ω -> GND: điểm giữa ≈ 2.5V (cầu phân áp 220/220), dòng ≈ 11.36mA.
  check('(p0-e) PSU+ -> còi -> R220 -> GND: điểm giữa ≈ 2.5V, dòng qua còi ≈ 11.36mA',
    (() => {
      const st = defaultBenchState(830);
      st.components.push({ id: 'BUZ0', type: 'buzzer', anchor: 'c10', rot: 0, props: {} });
      st.components.push({ id: 'R0', type: 'resistor', anchor: 'a20', rot: 0, props: { value: 220 } });
      st.components.push({ id: 'MM0', type: 'multimeter', anchor: 'a30', rot: 0, props: { mode: 'V' } });
      st.wires.push({ id: 'T-E1', a: 'b10', b: 'T+10', color: '#DC2626' });
      st.wires.push({ id: 'T-E2', a: 'b11', b: 'b20', color: '#2563EB' });
      st.wires.push({ id: 'T-E3', a: 'b24', b: 'T-20', color: '#0F172A' });
      st.wires.push({ id: 'T-E4', a: 'b30', b: 'b11', color: '#2563EB' });
      st.wires.push({ id: 'T-E5', a: 'b34', b: 'T-30', color: '#0F172A' });
      const cpu = createCPU();
      return approx(meterReadings(st, cpu).voltmeters[0].volts, 2.5, 0.05)
        && approx(solveCircuit(st, cpu).branchCurrent.get('BUZ0'), 5 / 440, 0.0005);
    })(), '');
  // (p0-f) Hằng số mô hình còi / ngưỡng: BUZZER_OHMS=220, BUZZER_ON_VOLTS=2.0, LED_MAX_VOLTS=10.
  check('(p0-f) BUZZER_OHMS=220, BUZZER_ON_VOLTS=2.0, LED_MAX_VOLTS=10',
    BUZZER_OHMS === 220 && BUZZER_ON_VOLTS === 2.0 && LED_MAX_VOLTS === 10, '');
}

// Nhóm (w-i): P0 Issue 3 + 4 — CPU đọc MẠCH (solver), không chỉ chiết áp.
// Đạo hàm giống hệt applyBenchNetlist trong app.js: setWiring rồi
// applySolvedVoltages từ solveCircuit.
function applySolvedToCpu(cpu, st, potVolts = {}) {
  const mapping = resolvePeripherals(benchToNetlist(st));
  cpu.setWiring(mapping);
  const solved = solveCircuit(st, cpu);
  applySolvedVoltages(cpu, mapping, solved, { potVolts, vccVolts: 5 });
  return mapping;
}
function adcReadAn0(cpu) { // ADCON1: ADFM=1; ADCON0: ADON+GO, kênh AN0
  cpu.writeFile(0x03, 0x20); cpu.writeFile(0x1f, 0x80); // bank1: ADCON1
  cpu.writeFile(0x03, 0x00); cpu.writeFile(0x1f, 0x03); // bank0: ADCON0
  cpu.run(100);
  return (cpu.sfr.ADRESH << 8) | cpu.sfr.ADRESL;
}
function setTrisLatch(cpu, port, trisVal, latchVal) {
  cpu.writeFile(0x03, 0x20); cpu.writeFile(0x05 + port, trisVal); // TRISx (bank1)
  cpu.writeFile(0x03, 0x00); cpu.writeFile(0x05 + port, latchVal); // PORTx latch
}
// Lỗ chân PIC (board 830): RA0=chân 2, RB0=chân 33, RB1=chân 34, RB2=chân 35.
const PIN_HOLE = new Map(picLegs(830).map((l) => [l.pin, l.hole]));
const RA0_HOLE = PIN_HOLE.get(2), RB0_HOLE = PIN_HOLE.get(33);
const RB1_HOLE = PIN_HOLE.get(34), RB2_HOLE = PIN_HOLE.get(35);
function dividerState(r1, r2) { // cầu phân áp R1 (VCC->mid) + R2 (mid->GND), mid -> RA0
  const st = defaultBenchState(830);
  st.components.push({ id: 'R1', type: 'resistor', anchor: 'a20', rot: 0, props: { value: r1 } });
  st.components.push({ id: 'R2', type: 'resistor', anchor: 'a30', rot: 0, props: { value: r2 } });
  let n = 100;
  const w = (a, b) => st.wires.push({ id: 'W' + (n++), a, b });
  w('b20', 'T+20'); w('b24', 'b30'); w('b34', 'T-34'); w(RA0_HOLE, 'b24');
  return st;
}
function wireState(a, b) {
  const st = defaultBenchState(830);
  st.wires.push({ id: 'W901', a, b });
  return st;
}

// (w-i) Issue 3: divider 10k/10k -> AN0 ≈ 512 (không phải 0 như trước fix)
{
  const cpu = createCPU();
  applySolvedToCpu(cpu, dividerState(10000, 10000));
  check('(w-i) divider 10k/10k -> AN0 ≈ 512', Math.abs(adcReadAn0(cpu) - 512) <= 2, `ADRES=${(cpu.sfr.ADRESH << 8) | cpu.sfr.ADRESL} AN0=${cpu.analogVolts[0]}V`);
  // Gỡ divider -> ADC 0, không giữ giá trị cũ.
  const cpu2 = createCPU();
  applySolvedToCpu(cpu2, defaultBenchState(830));
  check('(w-i) gỡ divider -> AN0 = 0 (không stale)', adcReadAn0(cpu2) === 0, `ADRES=${(cpu2.sfr.ADRESH << 8) | cpu2.sfr.ADRESL}`);
  // VCC -> AN0 ≈ 1023; GND -> AN0 = 0.
  const cpuV = createCPU();
  applySolvedToCpu(cpuV, wireState(RA0_HOLE, 'T+23'));
  check('(w-i) VCC -> AN0 ≈ 1023', Math.abs(adcReadAn0(cpuV) - 1023) <= 1, `ADRES=${(cpuV.sfr.ADRESH << 8) | cpuV.sfr.ADRESL}`);
  const cpuG = createCPU();
  applySolvedToCpu(cpuG, wireState(RA0_HOLE, 'T-23'));
  check('(w-i) GND -> AN0 = 0', adcReadAn0(cpuG) === 0, `ADRES=${(cpuG.sfr.ADRESH << 8) | cpuG.sfr.ADRESL}`);
  // Divider 30k/10k -> mid 1.25V -> ADC ≈ 256, mức số RA0 = 0 (ngưỡng 2,5V).
  const cpu3 = createCPU();
  applySolvedToCpu(cpu3, dividerState(30000, 10000));
  check('(w-i) divider 30k/10k -> AN0 ≈ 256, RA0 số = 0', Math.abs(adcReadAn0(cpu3) - 256) <= 2 && (cpu3.readPort(0) & 1) === 0,
    `ADRES=${(cpu3.sfr.ADRESH << 8) | cpu3.sfr.ADRESL} PORTA=0x${cpu3.readPort(0).toString(16)}`);
}

// (w-i) Issue 4: chân input nối GND/VCC/chân output khác đọc đúng, theo live.
{
  const gnd = createCPU();
  applySolvedToCpu(gnd, wireState(RB0_HOLE, 'T-29'));
  setTrisLatch(gnd, 1, 0xff, 0); // TRISB=input hết
  check('(w-i) RB0->GND đọc 0', (gnd.readPort(1) & 1) === 0, `PORTB=0x${gnd.readPort(1).toString(16)}`);
  const vcc = createCPU();
  applySolvedToCpu(vcc, wireState(RB0_HOLE, 'T+29'));
  setTrisLatch(vcc, 1, 0xff, 0);
  check('(w-i) RB0->VCC đọc 1', (vcc.readPort(1) & 1) === 1, `PORTB=0x${vcc.readPort(1).toString(16)}`);
  // RB1 output nối RB2 input: RB1=1 -> RB2=1, RB1=0 -> RB2=0 (theo live).
  const st = wireState(RB1_HOLE, RB2_HOLE);
  const hi = createCPU();
  applySolvedToCpu(hi, st);
  setTrisLatch(hi, 1, 0xfd, 0x02); // RB1 output, latch 1
  check('(w-i) RB1=1 -> RB2 đọc 1', (hi.readPort(1) & 0x04) === 0x04, `PORTB=0x${hi.readPort(1).toString(16)}`);
  const lo = createCPU();
  applySolvedToCpu(lo, st);
  setTrisLatch(lo, 1, 0xfd, 0x00); // RB1 output, latch 0
  check('(w-i) RB1=0 -> RB2 đọc 0', (lo.readPort(1) & 0x04) === 0, `PORTB=0x${lo.readPort(1).toString(16)}`);
}

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);


// test-pic16.mjs — Kiểm thử xác định cho lõi pic16.js (KHÔNG đưa vào public/).
// Chạy: node test-pic16.mjs   (exit 0 = tất cả pass)
import { readFileSync } from 'node:fs';
import { assemble, createCPU, parseIntelHex, exportHex, disassemble, ProgramRunner } from './public/pic16.js';
import { defaultNetlist, resolvePeripherals, checkWiring, ledStates, buzzerStates, applyButtonToCpu, applyPotToCpu, PIC_PINS } from './public/wiring.js';
import { PITCH, HOLE_RADIUS, HOLE_HEIGHT, HOLE_TOP_ABOVE_BOARD, holeCenterY, depthPrecisionAt, MAX_CAMERA_DISTANCE, SEGMENT_LINE_WIDTH_MM, segmentBoundaries, allHoles, stripKey, parseHole, holePos, holeId, rowLabel, rowIndexFromLabel, migrateOldHoleId, picLegs, legsFor, canPlace, buildBenchNets, benchToNetlist, defaultBenchState, sanitizeState, boardSize, picCol, picRows, picBodyDepth, bodyDepth, pruneStateForSize, validateWireEnd, retargetWireEnd, togglePlacement, normalizeSize, holeCount, sizeLabel, sameSize, compLabel, psuVolts, validatePsuVolts, parsePsuPost, psuPostPos, normalizeWireEnd, clampCamTarget, zoomTowardPoint, panTarget } from './public/bench-model.js';
import { LABS, getLab, buildLabState } from './public/labs.js';

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
  check('(b-a) holePos b22 = (-25.40, -8.89)mm', pos && Math.abs(pos.x + 25.4) < 0.01 && Math.abs(pos.z + 8.89) < 0.01, JSON.stringify(pos));
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
  check('(c-b) holePos a1 trên 170 = x -20.32mm (gốc giữa board)',
    p && Math.abs(p.x + 20.32) < 0.01 && Math.abs(p.z + 11.43) < 0.01, JSON.stringify(p));
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
  check('(e-f) 830 -> 42x15: LED a10 giữ, dây nguồn W1 nối lại e12->T+22, W6 về T+40',
    r42x15.state.components.some((c) => c.id === 'LED0')
    && (() => {
      const w1 = r42x15.state.wires.find((w) => w.id === 'W1');
      const w6 = r42x15.state.wires.find((w) => w.id === 'W6');
      return w1 && w1.a === 'e12' && w1.b === 'T+22' && w6 && w6.b === 'T+40';
    })(), JSON.stringify(r42x15.state.wires.filter((w) => ['W1', 'W6'].includes(w.id))));
  const rSame = pruneStateForSize(st15, { cols: 42, rows: 15, rails: true });
  check('(e-f) đổi size 42x15 về chính nó: không gỡ gì, size giữ nguyên',
    rSame.removed.components.length === 0 && rSame.removed.wires.length === 0
    && JSON.stringify(rSame.state.size) === JSON.stringify({ cols: 42, rows: 15, rails: true }), JSON.stringify(rSame.state.size));
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

// (e-h) Nghịch đảo holePos theo cả 2 chiều (pickHole trong bench.js)
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
      return Math.round(p.x / PITCH + (cols + 1) / 2) === parseHole(id, size).c
        && Math.round(p.z / PITCH + (rows - 1) / 2) === parseHole(id, size).r;
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

// (e-l) bodyDepth: chiều sâu thân board theo rows
{
  check('(e-l) bodyDepth 830 = 47.02mm; 20x25 = 85.12mm; 20x5 = 34.32mm',
    Math.abs(bodyDepth(830) - 47.02) < 0.01
    && Math.abs(bodyDepth({ cols: 20, rows: 25, rails: false }) - 85.12) < 0.01
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
  check('(f-b) vị trí cọc PSU1: + ở (-12, 28, -108), − ở (12, 28, -108)',
    (() => { const p = psuPostPos(st, 'PSU1.+'); return p && p.x === -12 && p.y === 28 && p.z === -108; })()
    && (() => { const p = psuPostPos(st, 'PSU1.-'); return p && p.x === 12 && p.y === 28 && p.z === -108; })()
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
// (k-b) picBodyDepth ôm đúng 2 hàng chân: khoảng cách chân x PITCH + lề 3mm
{
  const near = (a, b) => Math.abs(a - b) < 0.01;
  check('(k-b) picBodyDepth: board >=10 hàng -> 18.24mm (6 hàng x 2.54 + 3), board 5 hàng -> 13.16mm',
    near(picBodyDepth(830), 18.24) && near(picBodyDepth({ cols: 42, rows: 15, rails: true }), 18.24)
    && near(picBodyDepth({ cols: 42, rows: 100, rails: true }), 18.24)
    && near(picBodyDepth({ cols: 20, rows: 5, rails: false }), 13.16), '');
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
  check('(n-b) board 15 hàng: 2 ranh giới ở z = -6.35 và +6.35 (sau hàng 5, 10)',
    b15.length === 2 && Math.abs(b15[0] + 6.35) < 1e-9 && Math.abs(b15[1] - 6.35) < 1e-9,
    `boundaries=${JSON.stringify(b15)}`);
}
// (n-c) Board 30 hàng: 5 ranh giới sau hàng 5, 10, 15, 20, 25
{
  const b30 = segmentBoundaries({ cols: 63, rows: 30 });
  const expect = [-25.4, -12.7, 0, 12.7, 25.4];
  check('(n-c) board 30 hàng: 5 ranh giới ở -25.4, -12.7, 0, 12.7, 25.4',
    b30.length === 5 && expect.every((e, i) => Math.abs(b30[i] - e) < 1e-9),
    `boundaries=${JSON.stringify(b30)}`);
}
// (n-d) Ranh giới nằm chính giữa 2 hàng lỗ kề (cách mỗi lỗ PITCH/2 = 1.27mm);
// vạch rộng 1mm nằm phẳng trên mặt board (+0.05), mặt lỗ ở +0.35 nên vạch
// không che được lỗ
{
  const rows = 10;
  const zB = segmentBoundaries(830)[0];
  const zE = (4 - (rows - 1) / 2) * PITCH; // tâm lỗ hàng e (chỉ số 4)
  const zF = (5 - (rows - 1) / 2) * PITCH; // tâm lỗ hàng f (chỉ số 5)
  check('(n-d) ranh giới cách lỗ e và f đều 1.27mm (= PITCH/2); vạch 1mm trong texture, mặt lỗ +0.35 cao hơn mặt board nên vạch không che được lỗ',
    Math.abs(Math.abs(zB - zE) - PITCH / 2) < 1e-9 && Math.abs(Math.abs(zF - zB) - PITCH / 2) < 1e-9
    && SEGMENT_LINE_WIDTH_MM === 1 && HOLE_TOP_ABOVE_BOARD === 0.35,
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
// Hiển thị tab là DOM nên không test bằng Node — Điệp check bằng trình
// duyệt thật.
// ===========================================================================
// (q-a) Chỉ có đúng Lab 1, đủ dữ liệu: 1 điện trở 220Ω + 1 LED + 3 dây
{
  const lab = LABS[0];
  check('(q-a) LABS chỉ có đúng 1 lab: Điều khiển LED, board mặc định 830',
    LABS.length === 1 && lab.id === 'led-blink' && lab.title === 'Điều khiển LED' && lab.size === 830
    && getLab('led-blink') === lab && getLab('khong-co') === null, JSON.stringify(LABS.map((l) => l.id)));
  check('(q-a) Lab 1 có đúng 1 điện trở 220Ω (R0 @i45) + 1 LED đỏ (LED0 @i52)',
    lab.components.length === 2
    && lab.components[0].id === 'R0' && lab.components[0].type === 'resistor' && lab.components[0].anchor === 'i45' && lab.components[0].props.value === 220
    && lab.components[1].id === 'LED0' && lab.components[1].type === 'led' && lab.components[1].anchor === 'i52' && lab.components[1].props.color === '#DC2626', JSON.stringify(lab.components));
  check('(q-a) Lab 1 có đúng 3 dây: RB0->điện trở, điện trở->anode LED, cathode LED->GND',
    lab.wires.length === 3
    && lab.wires[0].a === 'h29' && lab.wires[0].b === 'i45'
    && lab.wires[1].a === 'i49' && lab.wires[1].b === 'i52'
    && lab.wires[2].a === 'i53' && lab.wires[2].b === 'B-50', JSON.stringify(lab.wires));
}
// (q-b) buildLabState cho ra state hợp lệ: chip + nguồn + dây nguồn + R0 + LED0 + 3 dây lab
{
  const r = buildLabState(LABS[0]);
  check('(q-b) buildLabState Lab 1 ok: PIC1 + PSU1 + R0 + LED0, dây W1-W7 + 3 dây lab',
    r.ok && r.state.components.map((c) => c.id).join(',') === 'PIC1,PSU1,R0,LED0'
    && r.state.wires.map((w) => w.id).join(',') === 'W1,W2,W3,W4,W5,W6,W7,LAB1-W1,LAB1-W2,LAB1-W3',
    r.ok ? JSON.stringify({ comps: r.state.components.map((c) => c.id), wires: r.state.wires.map((w) => w.id) }) : r.reason);
  check('(q-b) đầu dây RB0 trong lab trùng đúng lỗ chân RB0 tính bằng picLegs (không hardcode sai)',
    r.ok && LABS[0].wires[0].a === picLegs(830).find((l) => l.term === 'PIC.RB0').hole, LABS[0].wires[0].a);
  check('(q-b) state lab qua sanitizeState vẫn giữ nguyên R0/LED0 + 3 dây lab',
    r.ok && (() => {
      const s2 = sanitizeState(JSON.parse(JSON.stringify(r.state)));
      return s2.components.some((c) => c.id === 'R0') && s2.components.some((c) => c.id === 'LED0')
        && s2.wires.filter((w) => w.id.startsWith('LAB1-')).length === 3;
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

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

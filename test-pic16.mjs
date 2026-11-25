// test-pic16.mjs — Kiểm thử xác định cho lõi pic16.js (KHÔNG đưa vào public/).
// Chạy: node test-pic16.mjs   (exit 0 = tất cả pass)
import { assemble, createCPU, parseIntelHex, exportHex, disassemble } from './public/pic16.js';
import { defaultNetlist, resolvePeripherals, checkWiring, ledStates, applyButtonToCpu, applyPotToCpu, PIC_PINS } from './public/wiring.js';
import { PITCH, allHoles, stripKey, parseHole, holePos, picLegs, canPlace, benchToNetlist, defaultBenchState, sanitizeState, boardSize, picCol, picRows, bodyDepth, pruneStateForSize, validateWireEnd, retargetWireEnd, togglePlacement, normalizeSize, holeCount, sizeLabel, sameSize, compLabel, psuVolts, validatePsuVolts, parsePsuPost, psuPostPos, normalizeWireEnd } from './public/bench-model.js';

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
  check('(d-a) cols 3 kẹp lên 5, cols 100 kẹp xuống 99',
    normalizeSize({ cols: 3, rails: false }).cols === 5 && normalizeSize({ cols: 100, rails: true }).cols === 99, '');
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
// TỰ ĐIỀN RỘNG (SỐ CỘT 5–99) × DÀI (SỐ HÀNG 2–26) — popup Bo mạch
// ===========================================================================
// (e-a) normalizeSize: chuẩn hoá rows
{
  check('(e-a) {cols:42, rows:12, rails:true} giữ nguyên',
    JSON.stringify(normalizeSize({ cols: 42, rows: 12, rails: true })) === JSON.stringify({ cols: 42, rows: 12, rails: true }), JSON.stringify(normalizeSize({ cols: 42, rows: 12, rails: true })));
  check('(e-a) rows 1 kẹp lên 2, rows 30 kẹp xuống 26',
    normalizeSize({ cols: 42, rows: 1 }).rows === 2 && normalizeSize({ cols: 42, rows: 30 }).rows === 26, '');
  check('(e-a) {cols:42} không có rows -> rows 10; rows chữ -> 10',
    normalizeSize({ cols: 42 }).rows === 10 && normalizeSize({ cols: 42, rows: 'abc' }).rows === 10, '');
  check('(e-a) mẫu sẵn 830 giữ nguyên số (rows 10 qua boardSize)',
    normalizeSize(830) === 830 && boardSize(830).rows === 10, '');
  check('(e-a) size cũ {cols, rails} không rows -> rows 10',
    normalizeSize({ cols: 42, rails: false }).rows === 10, '');
}

// (e-b) holeCount = cols x rows + 4 rail
{
  check('(e-b) 42 cột x 12 hàng có rail = 672 lỗ',
    holeCount({ cols: 42, rows: 12, rails: true }) === 672, `holes=${holeCount({ cols: 42, rows: 12, rails: true })}`);
  check('(e-b) 20 cột x 5 hàng không rail = 100 lỗ; 99 x 26 có rail = 2970 lỗ',
    holeCount({ cols: 20, rows: 5, rails: false }) === 100
    && holeCount({ cols: 99, rows: 26, rails: true }) === 2970, '');
  check('(e-b) allHoles 42x12 có rail = 672; 20x5 không rail = 100',
    allHoles({ cols: 42, rows: 12, rails: true }).length === 672
    && allHoles({ cols: 20, rows: 5, rails: false }).length === 100, '');
  check('(e-b) allHoles 99x26 có rail = 2970, không lỗ trùng id',
    (() => {
      const ids = allHoles({ cols: 99, rows: 26, rails: true }).map((h) => h.id);
      return ids.length === 2970 && new Set(ids).size === 2970;
    })(), '');
  check('(e-b) sizeLabel 42x12 có rail -> "Tùy chỉnh · 672 lỗ"',
    sizeLabel({ cols: 42, rows: 12, rails: true }) === 'Tùy chỉnh · 672 lỗ', '');
}

// (e-c) Strip tách ở giữa theo rows; rail B+/B− theo rows
{
  const s12 = { cols: 42, rows: 12, rails: true };
  check('(e-c) 12 hàng: a5/f5 cùng strip, a5/g5 khác strip',
    stripKey('a5', s12) === stripKey('f5', s12) && stripKey('a5', s12) !== stripKey('g5', s12), '');
  check('(e-c) 5 hàng: a1/b1 cùng strip, a1/c1 khác strip',
    stripKey('a1', { cols: 20, rows: 5, rails: false }) === stripKey('b1', { cols: 20, rows: 5, rails: false })
    && stripKey('a1', { cols: 20, rows: 5, rails: false }) !== stripKey('c1', { cols: 20, rows: 5, rails: false }), '');
  check('(e-c) 12 hàng: B+ là hàng 12, B− là hàng 13',
    (() => { const q = parseHole('B+42', s12); return q && q.r === 12 && q.c === 42; })()
    && (() => { const q = parseHole('B-42', s12); return q && q.r === 13 && q.c === 42; })(), '');
  check('(e-c) 2 hàng: chỉ có a/b, strip a1/b1 khác nhau (rãnh ở giữa)',
    parseHole('c1', { cols: 20, rows: 2, rails: false }) === null
    && stripKey('a1', { cols: 20, rows: 2, rails: false }) !== stripKey('b1', { cols: 20, rows: 2, rails: false }), '');
}

// (e-d) picRows + picLegs theo rows
{
  check('(e-d) picRows: 830 -> [1,7] (b/h), 12 hàng -> [5,6] (f/g), 6 hàng -> [2,3] (c/d), 2 hàng -> [0,1] (a/b), 26 hàng -> [12,13] (m/n)',
    JSON.stringify(picRows(830)) === JSON.stringify([1, 7])
    && JSON.stringify(picRows({ cols: 42, rows: 12, rails: true })) === JSON.stringify([5, 6])
    && JSON.stringify(picRows({ cols: 20, rows: 6, rails: false })) === JSON.stringify([2, 3])
    && JSON.stringify(picRows({ cols: 20, rows: 2, rails: false })) === JSON.stringify([0, 1])
    && JSON.stringify(picRows({ cols: 20, rows: 26, rails: false })) === JSON.stringify([12, 13]), '');
  check('(e-d) chip 42 cột x 12 hàng: đủ 40 chân, chân 1 ở hàng f, chân 21 ở hàng g',
    (() => {
      const legs = picLegs({ cols: 42, rows: 12, rails: true });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].r === 5 && legs[0].hole === 'f12' && legs[20].r === 6 && legs[20].hole === 'g31';
    })(), '');
  check('(e-d) chip 20 cột x 6 hàng: đủ 40 chân, chân 1 ở c1, chân 40 ở d1',
    (() => {
      const legs = picLegs({ cols: 20, rows: 6, rails: false });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].hole === 'c1' && legs[39].hole === 'd1';
    })(), '');
  check('(e-d) chip 20 cột x 2 hàng: đủ 40 chân, chân 1 ở a1, chân 21 ở b20',
    (() => {
      const legs = picLegs({ cols: 20, rows: 2, rails: false });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].hole === 'a1' && legs[20].hole === 'b20';
    })(), '');
  check('(e-d) chip 20 cột x 26 hàng: đủ 40 chân, chân 1 ở m1, chân 40 ở n1',
    (() => {
      const legs = picLegs({ cols: 20, rows: 26, rails: false });
      return legs.length === 40 && legs.every((l) => !!l.hole) && legs[0].hole === 'm1' && legs[39].hole === 'n1';
    })(), '');
  check('(e-d) chip 99 cột x 26 hàng: picCol=40, chân 1 ở m40',
    picCol({ cols: 99, rows: 26, rails: true }) === 40
    && picLegs({ cols: 99, rows: 26, rails: true })[0].hole === 'm40', '');
}

// (e-e) Địa chỉ lỗ: chữ hàng a–z theo số hàng
{
  check('(e-e) "k5" trên board 10 hàng thì sai, trên board 12 hàng thì đúng (hàng 10)',
    parseHole('k5', 830) === null
    && (() => { const p = parseHole('k5', { cols: 42, rows: 12, rails: true }); return p && p.r === 10 && p.c === 5; })(), '');
  check('(e-e) "l12" trên 12 hàng thì đúng (hàng 11), "m1" thì sai',
    (() => { const p = parseHole('l12', { cols: 42, rows: 12, rails: true }); return p && p.r === 11 && p.c === 12; })()
    && parseHole('m1', { cols: 42, rows: 12, rails: true }) === null, '');
  check('(e-e) "z99" trên board 99x26 thì đúng (hàng 25, cột 99), "a100" thì sai',
    (() => { const p = parseHole('z99', { cols: 99, rows: 26, rails: true }); return p && p.r === 25 && p.c === 99; })()
    && parseHole('a100', { cols: 99, rows: 26, rails: true }) === null, '');
  check('(e-e) "K5" hoa vẫn sai ở model (UI thường hoá trước)',
    parseHole('K5', { cols: 42, rows: 12, rails: true }) === null, '');
}

// (e-f) Đổi size có rows khác: giữ/loại linh kiện + dây nguồn nối lại
{
  const st12 = defaultBenchState({ cols: 42, rows: 12, rails: true });
  st12.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  st12.components.push({ id: 'LED1', type: 'led', anchor: 'k10', rot: 0, props: { color: '#DC2626' } });
  st12.wires.push({ id: 'W10', a: 'k10', b: 'a11', color: '#2563EB' });
  check('(e-f) bàn mặc định 42x12: đủ 7 dây nguồn W1–W7, neo chip f12 (hàng chân trên của board 12 hàng), label "Tùy chỉnh · 672 lỗ"',
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].every((id) => st12.wires.some((w) => w.id === id))
    && st12.components.find((c) => c.type === 'pic').anchor === 'f12'
    && sizeLabel({ cols: 42, rows: 12, rails: true }) === 'Tùy chỉnh · 672 lỗ', JSON.stringify(st12.components.find((c) => c.type === 'pic')));
  const r830 = pruneStateForSize(st12, 830);
  check('(e-f) 42x12 -> 830: LED k10 + dây W10 bị gỡ (hàng k ngoài board), LED a10 giữ',
    !r830.state.components.some((c) => c.id === 'LED1') && r830.state.components.some((c) => c.id === 'LED0')
    && !r830.state.wires.some((w) => w.id === 'W10') && r830.removed.components.join(',') === 'LED1'
    && r830.removed.wires.join(',') === 'W10', JSON.stringify(r830.removed));
  const st830 = defaultBenchState(830);
  st830.components.push({ id: 'LED0', type: 'led', anchor: 'a10', rot: 0, props: { color: '#DC2626' } });
  const r42x12 = pruneStateForSize(st830, { cols: 42, rows: 12, rails: true });
  check('(e-f) 830 -> 42x12: LED a10 giữ, dây nguồn W1 nối lại f12->T+22, W6 về T+40',
    r42x12.state.components.some((c) => c.id === 'LED0')
    && (() => {
      const w1 = r42x12.state.wires.find((w) => w.id === 'W1');
      const w6 = r42x12.state.wires.find((w) => w.id === 'W6');
      return w1 && w1.a === 'f12' && w1.b === 'T+22' && w6 && w6.b === 'T+40';
    })(), JSON.stringify(r42x12.state.wires.filter((w) => ['W1', 'W6'].includes(w.id))));
  const rSame = pruneStateForSize(st12, { cols: 42, rows: 12, rails: true });
  check('(e-f) đổi size 42x12 về chính nó: không gỡ gì, size giữ nguyên',
    rSame.removed.components.length === 0 && rSame.removed.wires.length === 0
    && JSON.stringify(rSame.state.size) === JSON.stringify({ cols: 42, rows: 12, rails: true }), JSON.stringify(rSame.state.size));
}

// (e-g) normalizeSize kẹp cols 5–99 / rows 2–26
{
  check('(e-g) {cols:3, rows:1} -> cols 5, rows 2',
    (() => { const s = normalizeSize({ cols: 3, rows: 1 }); return s.cols === 5 && s.rows === 2; })(), '');
  check('(e-g) {cols:150, rows:99} -> cols 99, rows 26',
    (() => { const s = normalizeSize({ cols: 150, rows: 99 }); return s.cols === 99 && s.rows === 26; })(), '');
  check('(e-g) {cols:99, rows:26, rails:true} giữ nguyên',
    JSON.stringify(normalizeSize({ cols: 99, rows: 26, rails: true })) === JSON.stringify({ cols: 99, rows: 26, rails: true }), '');
}

// (e-h) Nghịch đảo holePos theo cả 2 chiều (pickHole trong bench.js)
{
  for (const size of [830, { cols: 42, rows: 12, rails: true }, { cols: 20, rows: 5, rails: false }]) {
    const cols = boardSize(size).cols;
    const rows = boardSize(size).rows;
    const midRow = String.fromCharCode(97 + Math.floor(rows / 2));
    const lastRow = String.fromCharCode(96 + rows);
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
  const st = defaultBenchState({ cols: 42, rows: 12, rails: true });
  check('(e-i) 42x12: LED ở f20/g20 (hàng chân chip, trong cột chip) không đặt được',
    canPlace(st, 'led', 'f20', 0).ok === false && canPlace(st, 'led', 'g20', 0).ok === false, '');
  check('(e-i) 42x12: LED ở e20/h20 (ngoài hàng chân chip) đặt được',
    canPlace(st, 'led', 'e20', 0).ok === true && canPlace(st, 'led', 'h20', 0).ok === true, '');
  check('(e-i) 42x12: LED ở f40 (hàng chân chip nhưng ngoài cột chip) đặt được',
    canPlace(st, 'led', 'f40', 0).ok === true, '');
  check('(e-i) 42x12: LED ở a10 đặt được, LED ở l42 (không xoay) rơi ngoài board vì chân thứ 2 sang cột 43',
    canPlace(st, 'led', 'a10', 0).ok === true && canPlace(st, 'led', 'l42', 0).ok === false, '');
  check('(e-i) 42x2: LED ở a5 đặt được (ngoài cột chip), LED ở a20 không đặt được (dưới thân chip)',
    canPlace(defaultBenchState({ cols: 42, rows: 2, rails: false }), 'led', 'a5', 0).ok === true
    && canPlace(defaultBenchState({ cols: 42, rows: 2, rails: false }), 'led', 'a20', 0).ok === false, '');
}

// (e-j) validateWireEnd theo chữ hàng của board
{
  const st = defaultBenchState({ cols: 42, rows: 12, rails: true });
  st.wires.push({ id: 'W10', a: 'a10', b: 'a11', color: '#2563EB' });
  check('(e-j) 42x12: đổi đầu dây sang k5/l5 thì được, sang m5/k43 thì lỗi',
    validateWireEnd(st, 'W10', 'b', 'k5').ok === true && validateWireEnd(st, 'W10', 'b', 'l5').ok === true
    && validateWireEnd(st, 'W10', 'b', 'm5').ok === false && validateWireEnd(st, 'W10', 'b', 'k43').ok === false, '');
  const r = retargetWireEnd(st, 'W10', 'b', 'k5');
  check('(e-j) retarget sang k5 áp dụng đúng vào state',
    r.ok === true && st.wires.find((w) => w.id === 'W10').b === 'k5', JSON.stringify(st.wires.find((w) => w.id === 'W10')));
}

// (e-k) sameSize so sánh cả rows
{
  check('(e-k) sameSize: 42x12 == 42x12, 42x12 != 42x10, 42x12 có rail != 42x12 không rail',
    sameSize({ cols: 42, rows: 12, rails: true }, { cols: 42, rows: 12, rails: true })
    && !sameSize({ cols: 42, rows: 12, rails: true }, { cols: 42, rows: 10, rails: true })
    && !sameSize({ cols: 42, rows: 12, rails: true }, { cols: 42, rows: 12, rails: false }), '');
  check('(e-k) sameSize: mẫu sẵn 830 == boardSize 63x10, != custom 63x10 có rail',
    sameSize(830, { cols: 63, rows: 10, rails: true }) === false
    && sameSize(830, 830), '');
}

// (e-l) bodyDepth: chiều sâu thân board theo rows
{
  check('(e-l) bodyDepth 830 = 47.02mm; 20x26 = 87.66mm; 20x2 = 26.7mm',
    Math.abs(bodyDepth(830) - 47.02) < 0.01
    && Math.abs(bodyDepth({ cols: 20, rows: 26, rails: false }) - 87.66) < 0.01
    && Math.abs(bodyDepth({ cols: 20, rows: 2, rails: false }) - 26.7) < 0.01,
    `${bodyDepth(830)}/${bodyDepth({ cols: 20, rows: 26, rails: false })}/${bodyDepth({ cols: 20, rows: 2, rails: false })}`);
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

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

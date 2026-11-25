// test-pic16.mjs — Kiểm thử xác định cho lõi pic16.js (KHÔNG đưa vào public/).
// Chạy: node test-pic16.mjs   (exit 0 = tất cả pass)
import { assemble, createCPU, parseIntelHex, exportHex, disassemble } from './public/pic16.js';
import { EXAMPLES } from './public/examples.js';
import { defaultNetlist, resolvePeripherals, checkWiring, ledStates, applyButtonToCpu, applyPotToCpu } from './public/wiring.js';

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

// (0) Tất cả 7 ví dụ đều dịch được
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

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

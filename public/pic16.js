// pic16.js — Lõi mô phỏng PIC16F877A (assembler + CPU + ngoại vi).
// Không phụ thuộc DOM: chạy được trong trình duyệt (ES module) và trong Node
// để test tự động. UI nằm ở app.js / examples.js.
// Viết mới hoàn toàn, theo datasheet PIC16F877A (35 lệnh 14-bit, 8K program,
// RAM 368 byte, 4 bank, stack 8 mức, TMR0, ADC 10-bit, USART, LCD HD44780).

// ---------------------------------------------------------------------------
// Bảng thanh ghi: tên -> địa chỉ 7-bit trong bank (địa chỉ đầy đủ = bank*0x80 + a)
// ---------------------------------------------------------------------------
export const REGISTERS = {
  INDF: 0x00, TMR0: 0x01, PCL: 0x02, STATUS: 0x03, FSR: 0x04,
  PORTA: 0x05, PORTB: 0x06, PORTC: 0x07, PORTD: 0x08, PORTE: 0x09,
  PCLATH: 0x0a, INTCON: 0x0b, PIR1: 0x0c, PIR2: 0x0d,
  TMR1L: 0x0e, TMR1H: 0x0f, T1CON: 0x10, TMR2: 0x11, T2CON: 0x12,
  SSPBUF: 0x13, SSPCON: 0x14, CCPR1L: 0x15, CCPR1H: 0x16, CCP1CON: 0x17,
  RCSTA: 0x18, TXREG: 0x19, RCREG: 0x1a, CCPR2L: 0x1b, CCPR2H: 0x1c,
  CCP2CON: 0x1d, ADRESH: 0x1e, ADCON0: 0x1f,
  OPTION_REG: 0x81, TRISA: 0x85, TRISB: 0x86, TRISC: 0x87, TRISD: 0x88,
  TRISE: 0x89, PIE1: 0x8c, PIE2: 0x8d, PCON: 0x8e, PR2: 0x92,
  TXSTA: 0x98, SPBRG: 0x99, ADRESL: 0x9e, ADCON1: 0x9f,
  EEDATA: 0x10c, EEADR: 0x10d, EECON1: 0x10e, EECON2: 0x10f,
};

// Tên bit thường dùng trong toán hạng bit (BSF STATUS,RP0 / BTFSS INTCON,TMR0IF ...)
const BIT_NAMES = {
  C: 0, DC: 1, Z: 2, PD: 3, TO: 4, RP0: 5, RP1: 6, IRP: 7,
  RBIF: 0, INTF: 1, TMR0IF: 2, RBIE: 3, INTE: 4, TMR0IE: 5, PEIE: 6, GIE: 7,
  ADON: 0, GO: 1, GO_DONE: 1, CHS0: 2, CHS1: 3, CHS2: 4, ADCS0: 6, ADCS1: 7,
  ADIF: 6, RCIF: 5, TXIF: 4, TMR1IF: 0, TMR2IF: 1, CCP1IF: 2, SSPIF: 3,
  TX9: 6, TXEN: 5, SYNC: 4, BRGH: 2, TRMT: 1, TX9D: 0,
  SPEN: 7, RX9: 6, SREN: 5, CREN: 4, ADDEN: 3, FERR: 2, OERR: 1, RX9D: 0,
  PS0: 0, PS1: 1, PS2: 2, PSA: 3, T0SE: 4, T0CS: 5, INTEDG: 6, RBPU: 7,
  ADFM: 7, PCFG0: 0, PCFG1: 1, PCFG2: 2, PCFG3: 3,
};

// Bit STATUS
const ST_C = 0, ST_DC = 1, ST_Z = 2, ST_PD = 3, ST_TO = 4, ST_RP0 = 5, ST_RP1 = 6, ST_IRP = 7;

// Bản đồ SFR theo bank (địa chỉ 7-bit -> tên), dùng để phân biệt PORTx/TRISx/OPTION...
const SFR_MAP = [
  // bank 0
  { 0x00: 'INDF', 0x01: 'TMR0', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x05: 'PORTA', 0x06: 'PORTB', 0x07: 'PORTC', 0x08: 'PORTD', 0x09: 'PORTE',
    0x0a: 'PCLATH', 0x0b: 'INTCON', 0x0c: 'PIR1', 0x0d: 'PIR2',
    0x0e: 'TMR1L', 0x0f: 'TMR1H', 0x10: 'T1CON', 0x11: 'TMR2', 0x12: 'T2CON',
    0x13: 'SSPBUF', 0x14: 'SSPCON', 0x15: 'CCPR1L', 0x16: 'CCPR1H',
    0x17: 'CCP1CON', 0x18: 'RCSTA', 0x19: 'TXREG', 0x1a: 'RCREG',
    0x1b: 'CCPR2L', 0x1c: 'CCPR2H', 0x1d: 'CCP2CON', 0x1e: 'ADRESH', 0x1f: 'ADCON0' },
  // bank 1
  { 0x00: 'INDF', 0x01: 'OPTION_REG', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x05: 'TRISA', 0x06: 'TRISB', 0x07: 'TRISC', 0x08: 'TRISD', 0x09: 'TRISE',
    0x0a: 'PCLATH', 0x0b: 'INTCON', 0x0c: 'PIE1', 0x0d: 'PIE2', 0x0e: 'PCON',
    0x12: 'PR2', 0x13: 'SSPADD', 0x14: 'SSPSTAT', 0x18: 'TXSTA', 0x19: 'SPBRG',
    0x1e: 'ADRESL', 0x1f: 'ADCON1' },
  // bank 2
  { 0x00: 'INDF', 0x01: 'TMR0', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x06: 'PORTB', 0x0a: 'PCLATH', 0x0b: 'INTCON',
    0x0c: 'EEDATA', 0x0d: 'EEADR', 0x0e: 'EECON1', 0x0f: 'EECON2' },
  // bank 3
  { 0x00: 'INDF', 0x01: 'OPTION_REG', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x06: 'TRISB', 0x0a: 'PCLATH', 0x0b: 'INTCON' },
];

const PORT_BITS = [6, 8, 8, 8, 3]; // số chân thật của PORTA..PORTE
const PORT_NAMES = ['PORTA', 'PORTB', 'PORTC', 'PORTD', 'PORTE'];

// ---------------------------------------------------------------------------
// Tiện ích số
// ---------------------------------------------------------------------------
function parseNumberToken(tok, symbols) {
  const t = String(tok).trim();
  if (t === '') return null;
  if (/^'.'$/.test(t) || /^"."$/.test(t)) return t.charCodeAt(1); // 'A'
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^\$[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(1), 16);
  if (/^0b[01]+$/.test(t)) return parseInt(t.slice(2), 2);
  if (/^H'[0-9a-fA-F]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 16);
  if (/^B'[01]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 2);
  if (/^D'[0-9]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 10);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  const up = t.toUpperCase();
  if (up in REGISTERS) return REGISTERS[up];
  if (symbols && up in symbols) return symbols[up];
  return null;
}

// Tách comment ';' nhưng giữ nguyên ký tự trong ngoặc '...' / "..."
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ';') return line.slice(0, i);
  }
  return line;
}

// ---------------------------------------------------------------------------
// LCD HD44780 (16x2): state machine theo lệnh, dữ liệu qua PORTD, RS=RE0, E=RE1
// ---------------------------------------------------------------------------
export class LCD {
  constructor() { this.reset(); }
  reset() {
    this.ddram = new Uint8Array(128).fill(0x20);
    this.addr = 0; this.displayOn = true; this.cursorOn = false; this.blink = false;
    this.entryInc = true;
  }
  command(cmd) {
    if (cmd === 0x01) { this.ddram.fill(0x20); this.addr = 0; } // Clear display
    else if (cmd === 0x02) { this.addr = 0; } // Return home
    else if ((cmd & 0xfc) === 0x04) { this.entryInc = !!(cmd & 0x02); } // Entry mode
    else if ((cmd & 0xf8) === 0x08) { // Display on/off
      this.displayOn = !!(cmd & 0x04); this.cursorOn = !!(cmd & 0x02); this.blink = !!(cmd & 0x01);
    } else if (cmd & 0x80) { this.addr = cmd & 0x7f; } // Set DDRAM address
    // 0x20-0x3F function set, 0x10-0x1F shift, 0x40+ CGRAM: không cần cho bài lab
  }
  writeData(ch) {
    this.ddram[this.addr & 0x7f] = ch & 0xff;
    if (this.entryInc) {
      this.addr++;
      if (this.addr === 0x28) this.addr = 0x40; // hết dòng 1 -> sang dòng 2
      else if (this.addr === 0x68) this.addr = 0x00;
    } else {
      this.addr--;
      if (this.addr === 0x3f) this.addr = 0x27;
      else if (this.addr < 0) this.addr = 0x67;
    }
  }
  getLines() {
    const dec = (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ');
    let l0 = '', l1 = '';
    for (let i = 0; i < 16; i++) l0 += dec(this.ddram[i]);
    for (let i = 0; i < 16; i++) l1 += dec(this.ddram[0x40 + i]);
    return [l0, l1];
  }
  getText() { const [a, b] = this.getLines(); return a + '\n' + b; }
}

// ---------------------------------------------------------------------------
// ASSEMBLER 2-pass cho 35 lệnh PIC16F877A
// Pass 1: gom nhãn + EQU, tính địa chỉ từng dòng (BANKSEL = 2 lệnh).
// Pass 2: mã hoá. Trả về { program, errors, lineToAddr, addrToLine, listing, labels }
// ---------------------------------------------------------------------------
const MNEMONICS = new Set(['NOP', 'RETURN', 'RETFIE', 'RETLW', 'CALL', 'GOTO',
  'MOVLW', 'MOVWF', 'MOVF', 'CLRF', 'CLRW', 'ADDWF', 'ADDLW', 'SUBWF', 'SUBLW',
  'ANDWF', 'ANDLW', 'IORWF', 'IORLW', 'XORWF', 'XORLW', 'INCF', 'DECFSZ',
  'INCFSZ', 'DECF', 'COMF', 'RLF', 'RRF', 'SWAPF', 'BSF', 'BCF', 'BTFSS',
  'BTFSC', 'SLEEP', 'CLRWDT']);

function splitOperands(s) {
  // Tách theo dấu phẩy, giữ nguyên 'x' trong ngoặc đơn
  const out = []; let cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out.filter((x) => x !== '');
}

function bankOfAddress(addr) { return (addr >> 7) & 3; }

function encodeInstruction(mn, ops, symbols, lineNo) {
  const err = (m) => ({ error: m });
  const num = (tok) => {
    const v = parseNumberToken(tok, symbols);
    return v === null ? undefined : v;
  };
  // Lệnh không toán hạng
  if (mn === 'NOP') return { code: 0x0000, size: 1 };
  if (mn === 'RETURN') return { code: 0x0008, size: 1 };
  if (mn === 'RETFIE') return { code: 0x0009, size: 1 };
  if (mn === 'CLRW') return { code: 0x0100, size: 1 };
  if (mn === 'SLEEP') return { code: 0x0063, size: 1 };
  if (mn === 'CLRWDT') return { code: 0x0064, size: 1 };
  // Lệnh literal 8-bit: MOVLW/RETLW/ADDLW/SUBLW/ANDLW/IORLW/XORLW
  const litBase = { MOVLW: 0x3000, RETLW: 0x3400, ADDLW: 0x3e00, SUBLW: 0x3c00, ANDLW: 0x3900, IORLW: 0x3800, XORLW: 0x3a00 };
  if (mn in litBase) {
    if (ops.length !== 1) return err(`${mn} cần 1 toán hạng`);
    const k = num(ops[0]);
    if (k === undefined) return err(`Không hiểu hằng "${ops[0]}"`);
    return { code: litBase[mn] | (k & 0xff), size: 1 };
  }
  // CALL / GOTO: địa chỉ 11-bit
  if (mn === 'CALL' || mn === 'GOTO') {
    if (ops.length !== 1) return err(`${mn} cần 1 nhãn/địa chỉ`);
    const k = num(ops[0]);
    if (k === undefined) return err(`Không hiểu nhãn "${ops[0]}"`);
    return { code: (mn === 'CALL' ? 0x2000 : 0x2800) | (k & 0x7ff), size: 1 };
  }
  // MOVWF / CLRF: 1 toán hạng file
  if (mn === 'MOVWF' || mn === 'CLRF') {
    if (ops.length !== 1) return err(`${mn} cần 1 thanh ghi`);
    const f = num(ops[0]);
    if (f === undefined) return err(`Không hiểu thanh ghi "${ops[0]}"`);
    return { code: (mn === 'MOVWF' ? 0x0080 : 0x0180) | (f & 0x7f), size: 1 };
  }
  // Lệnh byte: f[,d] — d mặc định F (1), trừ MOVF cũng mặc định F
  const byteBase = { ADDWF: 0x0700, ANDWF: 0x0500, CLRWDT2: 0, COMF: 0x0900, DECF: 0x0300, DECFSZ: 0x0b00, INCF: 0x0a00, INCFSZ: 0x0f00, IORWF: 0x0400, MOVF: 0x0800, RLF: 0x0d00, RRF: 0x0c00, SUBWF: 0x0200, SWAPF: 0x0e00, XORWF: 0x0600 };
  if (mn in byteBase) {
    if (ops.length < 1 || ops.length > 2) return err(`${mn} cần dạng: ${mn} f [,W|F]`);
    const f = num(ops[0]);
    if (f === undefined) return err(`Không hiểu thanh ghi "${ops[0]}"`);
    let d = 1;
    if (ops.length === 2) {
      const t = ops[1].toUpperCase();
      if (t === 'W' || t === '0') d = 0;
      else if (t === 'F' || t === '1') d = 1;
      else return err(`Đích phải là W hoặc F, nhận "${ops[1]}"`);
    }
    return { code: byteBase[mn] | (d << 7) | (f & 0x7f), size: 1 };
  }
  // Lệnh bit: f,b
  const bitBase = { BCF: 0x1000, BSF: 0x1400, BTFSC: 0x1800, BTFSS: 0x1c00 };
  if (mn in bitBase) {
    if (ops.length !== 2) return err(`${mn} cần dạng: ${mn} f, bit`);
    const f = num(ops[0]);
    if (f === undefined) return err(`Không hiểu thanh ghi "${ops[0]}"`);
    let b = num(ops[1]);
    if (b === undefined) {
      const bn = ops[1].toUpperCase();
      if (bn in BIT_NAMES) b = BIT_NAMES[bn];
      else return err(`Không hiểu bit "${ops[1]}"`);
    }
    if (b < 0 || b > 7) return err(`Số bit phải 0..7, nhận ${b}`);
    return { code: bitBase[mn] | (b << 7) | (f & 0x7f), size: 1 };
  }
  return err(`Lệnh không hỗ trợ: ${mn}`);
}

export function assemble(source) {
  const lines = String(source).split(/\r?\n/);
  const errors = [];
  const labels = {};      // TÊN -> địa chỉ
  const symbols = {};     // EQU + nhãn (dùng khi parse số)
  const lineInfo = [];    // mỗi dòng: { lineNo, label, mnemonic, ops, addr, size }
  let pc = 0;

  // --- Pass 1: quét nhãn, EQU, ORG; tính địa chỉ ---
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const clean = stripComment(lines[i]).trim();
    if (!clean) { lineInfo.push({ lineNo }); continue; }
    // Tách nhãn ở đầu: "LOOP:" hoặc "LOOP" đứng một mình / trước lệnh
    let rest = clean; let label = null;
    const mColon = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (mColon) { label = mColon[1]; rest = mColon[2].trim(); }
    const info = { lineNo, label, addr: pc };
    if (label) {
      const up = label.toUpperCase();
      if (up in labels) errors.push({ line: lineNo, message: `Nhãn "${label}" bị trùng` });
      labels[up] = pc; symbols[up] = pc;
    }
    if (!rest) { lineInfo.push(info); continue; }
    const parts = rest.split(/\s+/);
    const first = parts[0].toUpperCase();
    const tail = rest.slice(parts[0].length).trim();
    // EQU: "TEN EQU giá trị" (nhãn nằm ở đầu dòng, không có dấu :)
    if (parts.length >= 3 && parts[1].toUpperCase() === 'EQU') {
      const v = parseNumberToken(parts.slice(2).join(' '), symbols);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `EQU không hiểu giá trị "${parts.slice(2).join(' ')}"` });
      else { symbols[parts[0].toUpperCase()] = v; }
      info.directive = 'EQU'; lineInfo.push(info); continue;
    }
    if (first === 'ORG') {
      const v = parseNumberToken(tail, symbols);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `ORG không hiểu "${tail}"` });
      else pc = v & 0x1fff;
      info.directive = 'ORG'; info.addr = pc; lineInfo.push(info); continue;
    }
    if (first === 'END') { info.directive = 'END'; lineInfo.push(info); break; }
    if (first === '__CONFIG' || first === 'CONFIG') { info.directive = 'CONFIG'; lineInfo.push(info); continue; }
    if (first === 'LIST' || first === '#INCLUDE' || first === 'INCLUDE') { info.directive = 'IGNORE'; lineInfo.push(info); continue; }
    if (first === 'BANKSEL') {
      info.mnemonic = 'BANKSEL'; info.ops = splitOperands(tail); info.size = 2; info.addr = pc;
      pc += 2; lineInfo.push(info); continue;
    }
    if (first === 'DB' || first === 'DW' || first === 'DATA') {
      info.mnemonic = first; info.ops = splitOperands(tail); info.size = info.ops.length; info.addr = pc;
      pc += info.ops.length; lineInfo.push(info); continue;
    }
    if (first === 'DT') { // DT "chuỗi": mỗi ký tự -> 1 word (RETLW-style data)
      const strMatch = tail.match(/"([^"]*)"/);
      const text = strMatch ? strMatch[1] : tail;
      info.mnemonic = 'DT'; info.ops = [text]; info.size = text.length; info.addr = pc;
      pc += text.length; lineInfo.push(info); continue;
    }
    if (MNEMONICS.has(first)) {
      info.mnemonic = first; info.ops = splitOperands(tail); info.size = 1; info.addr = pc;
      pc += 1; lineInfo.push(info); continue;
    }
    // Nhãn đứng một mình trên dòng (không có dấu ':'): "LOOP"
    if (parts.length === 1) {
      const up = parts[0].toUpperCase();
      if (!(up in labels)) { labels[up] = info.addr; symbols[up] = info.addr; }
      info.label = parts[0];
      lineInfo.push(info); continue;
    }
    // Nhãn không có dấu ':' đứng trước lệnh: "LOOP MOVLW 0x10"
    if (parts.length >= 2 && MNEMONICS.has(parts[1].toUpperCase())) {
      const lbl = parts[0];
      const up = lbl.toUpperCase();
      if (!(up in labels)) { labels[up] = info.addr; symbols[up] = info.addr; }
      info.label = lbl;
      info.mnemonic = parts[1].toUpperCase();
      info.ops = splitOperands(rest.slice(parts[0].length + parts[1].length).trim());
      info.size = 1; info.addr = pc; pc += 1; lineInfo.push(info); continue;
    }
    errors.push({ line: lineNo, message: `Không hiểu dòng: "${clean}"` });
    lineInfo.push(info);
  }

  // --- Pass 2: mã hoá ---
  const program = new Uint16Array(8192);
  const lineToAddr = new Map(); const addrToLine = new Map();
  const listing = [];
  for (const info of lineInfo) {
    if (info.directive === 'END') break;
    if (!info.mnemonic) continue;
    if (info.mnemonic === 'BANKSEL') {
      const target = parseNumberToken(info.ops[0] || '', symbols);
      if (target === undefined || target === null) {
        errors.push({ line: info.lineNo, message: `BANKSEL không hiểu "${info.ops[0] || ''}"` });
        continue;
      }
      const bank = bankOfAddress(target);
      const ops = [
        0x1000 | (ST_RP0 << 7) | 0x03, // BCF/BSF STATUS,RP0
        0x1000 | (ST_RP1 << 7) | 0x03,
      ];
      // Mã hoá: BCF = 0x1000|..., BSF = 0x1400|...
      const c0 = ((bank & 1) ? 0x1400 : 0x1000) | (ST_RP0 << 7) | 0x03;
      const c1 = ((bank & 2) ? 0x1400 : 0x1000) | (ST_RP1 << 7) | 0x03;
      program[info.addr] = c0; program[info.addr + 1] = c1;
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      listing.push({ addr: info.addr, code: c0, text: `BANKSEL ${info.ops[0]}`, line: info.lineNo });
      listing.push({ addr: info.addr + 1, code: c1, text: '', line: info.lineNo });
      continue;
    }
    if (info.mnemonic === 'DB' || info.mnemonic === 'DW' || info.mnemonic === 'DATA') {
      info.ops.forEach((tok, idx) => {
        const v = parseNumberToken(tok, symbols);
        if (v === null || v === undefined) errors.push({ line: info.lineNo, message: `DB/DW không hiểu "${tok}"` });
        else program[info.addr + idx] = v & 0x3fff;
      });
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      continue;
    }
    if (info.mnemonic === 'DT') {
      const text = info.ops[0];
      for (let idx = 0; idx < text.length; idx++) program[info.addr + idx] = text.charCodeAt(idx) & 0x3fff;
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      continue;
    }
    const r = encodeInstruction(info.mnemonic, info.ops, symbols, info.lineNo);
    if (r.error) { errors.push({ line: info.lineNo, message: r.error }); continue; }
    program[info.addr] = r.code;
    lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
    listing.push({ addr: info.addr, code: r.code, text: `${info.mnemonic}${info.ops.length ? ' ' + info.ops.join(', ') : ''}`, line: info.lineNo });
  }
  return { program, errors, labels, lineToAddr, addrToLine, listing };
}

// ---------------------------------------------------------------------------
// DISASSEMBLER: opcode 14-bit -> chuỗi gợi nhớ (phục vụ panel Listing)
// ---------------------------------------------------------------------------
const BYTE_MN = { 0x07: 'ADDWF', 0x05: 'ANDWF', 0x09: 'COMF', 0x03: 'DECF', 0x0b: 'DECFSZ', 0x0a: 'INCF', 0x0f: 'INCFSZ', 0x04: 'IORWF', 0x08: 'MOVF', 0x0d: 'RLF', 0x0c: 'RRF', 0x02: 'SUBWF', 0x0e: 'SWAPF', 0x06: 'XORWF' };
const REG_NAME_BY_ADDR = {};
for (const [k, v] of Object.entries(REGISTERS)) REG_NAME_BY_ADDR[v] = k;

export function disassemble(op, addr = 0) {
  op &= 0x3fff;
  const f = op & 0x7f, d = (op >> 7) & 1, b = (op >> 7) & 7;
  const fname = REG_NAME_BY_ADDR[f] || ('0x' + f.toString(16).toUpperCase().padStart(2, '0'));
  const dst = d ? 'F' : 'W';
  if (op === 0x0000) return 'NOP';
  if (op === 0x0008) return 'RETURN';
  if (op === 0x0009) return 'RETFIE';
  if (op === 0x0063) return 'SLEEP';
  if (op === 0x0064) return 'CLRWDT';
  if (op === 0x0100) return 'CLRW';
  if ((op & 0xff80) === 0x0080) return `MOVWF ${fname}`;
  if ((op & 0xff80) === 0x0180) return `CLRF ${fname}`;
  if ((op & 0x3f00) === 0x3000) return `MOVLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3400) return `RETLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3e00) return `ADDLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3c00) return `SUBLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3900) return `ANDLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3800) return `IORLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3f00) === 0x3a00) return `XORLW 0x${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
  if ((op & 0x3800) === 0x2000) return `CALL 0x${(op & 0x7ff).toString(16).toUpperCase().padStart(3, '0')}`;
  if ((op & 0x3800) === 0x2800) return `GOTO 0x${(op & 0x7ff).toString(16).toUpperCase().padStart(3, '0')}`;
  if ((op & 0x3c00) === 0x1000) return `BCF ${fname}, ${b}`;
  if ((op & 0x3c00) === 0x1400) return `BSF ${fname}, ${b}`;
  if ((op & 0x3c00) === 0x1800) return `BTFSC ${fname}, ${b}`;
  if ((op & 0x3c00) === 0x1c00) return `BTFSS ${fname}, ${b}`;
  const top = (op >> 8) & 0x3f;
  if (top in BYTE_MN) return `${BYTE_MN[top]} ${fname}, ${dst}`;
  return `DW 0x${op.toString(16).toUpperCase().padStart(4, '0')}`;
}

function isTwoCycle(op) {
  op &= 0x3fff;
  if (op === 0x0008 || op === 0x0009) return true;
  if ((op & 0x3800) === 0x2000 || (op & 0x3800) === 0x2800) return true;
  return false;
}

// ---------------------------------------------------------------------------
// CPU PIC16F877A
// ---------------------------------------------------------------------------
export class PIC16F877A {
  constructor() {
    this.program = new Uint16Array(8192);
    this.config = 0x3fff;
    this.lcd = new LCD();
    this.analogVolts = [0, 0, 0, 0, 0, 0, 0, 0]; // AN0..AN7 (V)
    this.txLog = [];        // mã ký tự đã phát qua TX
    this.onTx = null;       // callback(code) khi CPU phát 1 ký tự
    this.onLcd = null;
    this.reset();
  }

  reset() {
    this.ram = new Uint8Array(512);
    this.pc = 0; this.w = 0; this.cycles = 0; this.halted = false; this.sleeping = false;
    this.stack = new Uint16Array(8); this.sp = 0;
    this.sfr = {
      STATUS: 0x18, PCLATH: 0, FSR: 0, INTCON: 0, OPTION: 0xff, TMR0: 0,
      TMR1L: 0, TMR1H: 0, T1CON: 0, TMR2: 0, T2CON: 0, PR2: 0xff,
      PIR1: 0, PIR2: 0, PIE1: 0, PIE2: 0, PCON: 0,
      TXSTA: 0x02, RCSTA: 0, SPBRG: 0, TXREG: 0, RCREG: 0,
      ADRESH: 0, ADRESL: 0, ADCON0: 0, ADCON1: 0,
      SSPBUF: 0, SSPCON: 0, SSPADD: 0, SSPSTAT: 0,
      CCPR1L: 0, CCPR1H: 0, CCP1CON: 0, CCPR2L: 0, CCPR2H: 0, CCP2CON: 0,
      EEDATA: 0, EEADR: 0, EECON1: 0, EECON2: 0,
    };
    this.portLatch = [0, 0, 0, 0, 0];
    this.portInput = [0x3f, 0xff, 0xff, 0xff, 0x07]; // mức ngoài: nút nhấn có pull-up -> 1
    this.tris = [0x3f, 0xff, 0xff, 0xff, 0x07];
    this.txEmpty = true; this.rxReady = false;
    this.adcCountdown = 0;
    this.tmr0Prescale = 0; this.tmr1Prescale = 0; this.tmr2Prescale = 0; this.tmr2Postscale = 0;
    this.prevRB0 = 1; this.prevRB47 = 0xf0;
    this.prevE = 0;
    this.lcd.reset();
    this.txLog = [];
  }

  loadProgram(program, config = 0x3fff) {
    this.program = program;
    this.config = config;
    this.reset();
  }

  // --- Thời gian mô phỏng: 1 chu kỳ lệnh = 4 chu kỳ clock ---
  get simTimeUs() { return (this.cycles * 4 * 1e6) / this.clockHz; }
  clockHz = 4000000;

  bank() { return (this.sfr.STATUS >> 5) & 3; }

  // Đọc file register (địa chỉ 7-bit trong bank hiện tại)
  readFile(addr7) {
    addr7 &= 0x7f;
    if (addr7 === 0x00) return this.readIndirect();
    const name = SFR_MAP[this.bank()][addr7];
    if (name) return this.readSFR(name);
    // GPR: bank*128 + addr, vùng 0x70-0x7F là RAM chung mọi bank
    const phys = addr7 >= 0x70 ? addr7 : this.bank() * 0x80 + addr7;
    return this.ram[phys];
  }

  writeFile(addr7, value) {
    addr7 &= 0x7f; value &= 0xff;
    if (addr7 === 0x00) { this.writeIndirect(value); return; }
    const name = SFR_MAP[this.bank()][addr7];
    if (name) { this.writeSFR(name, value); return; }
    const phys = addr7 >= 0x70 ? addr7 : this.bank() * 0x80 + addr7;
    this.ram[phys] = value;
  }

  readIndirect() {
    const addr = (((this.sfr.STATUS >> 7) & 1) << 8) | (this.sfr.FSR & 0xff);
    if (addr === 0) return 0;
    if (addr < 0x20) return 0; // trỏ vào vùng SFR: bỏ qua cho đơn giản
    return this.ram[addr & 0x1ff];
  }
  writeIndirect(value) {
    const addr = (((this.sfr.STATUS >> 7) & 1) << 8) | (this.sfr.FSR & 0xff);
    if (addr === 0 || addr < 0x20) return;
    this.ram[addr & 0x1ff] = value & 0xff;
  }

  readPort(i) {
    let v = 0;
    for (let b = 0; b < PORT_BITS[i]; b++) {
      const bit = (this.tris[i] >> b) & 1 ? (this.portInput[i] >> b) & 1 : (this.portLatch[i] >> b) & 1;
      v |= bit << b;
    }
    return v;
  }
  // Mức chân thật (kể cả input): dùng cho GPIO Inspector / Logic analyzer
  pinLevel(portIdx, bit) {
    return (this.tris[portIdx] >> bit) & 1
      ? (this.portInput[portIdx] >> bit) & 1
      : (this.portLatch[portIdx] >> bit) & 1;
  }
  pinDirection(portIdx, bit) { return ((this.tris[portIdx] >> bit) & 1) ? 'in' : 'out'; }

  readSFR(name) {
    switch (name) {
      case 'PCL': return this.pc & 0xff;
      case 'STATUS': return this.sfr.STATUS;
      case 'FSR': return this.sfr.FSR;
      case 'PCLATH': return this.sfr.PCLATH;
      case 'INTCON': return this.sfr.INTCON;
      case 'OPTION_REG': return this.sfr.OPTION;
      case 'TMR0': return this.sfr.TMR0;
      case 'PORTA': case 'PORTB': case 'PORTC': case 'PORTD': case 'PORTE':
        return this.readPort(PORT_NAMES.indexOf(name));
      case 'TRISA': case 'TRISB': case 'TRISC': case 'TRISD': case 'TRISE':
        return this.tris[PORT_NAMES.indexOf(name.replace('TRIS', 'PORT'))];
      case 'PIR1': {
        let v = this.sfr.PIR1 & 0xaf; // giữ ADIF/TMR1IF/TMR2IF/CCP1IF/SSPIF, bỏ TXIF/RCIF cũ
        if (this.txEmpty) v |= 0x10;
        if (this.rxReady) v |= 0x20;
        return v;
      }
      case 'TXSTA': return (this.sfr.TXSTA & 0xfd) | (this.txEmpty ? 0x02 : 0);
      case 'RCREG': { const v = this.sfr.RCREG; this.rxReady = false; return v; }
      default: return this.sfr[name] ?? 0;
    }
  }

  writeSFR(name, value) {
    value &= 0xff;
    switch (name) {
      case 'PCL':
        this.pc = ((this.sfr.PCLATH & 0x1f) << 8) | value; return;
      case 'STATUS': this.sfr.STATUS = value; return;
      case 'FSR': this.sfr.FSR = value; return;
      case 'PCLATH': this.sfr.PCLATH = value & 0x1f; return;
      case 'INTCON': this.sfr.INTCON = value; return;
      case 'OPTION_REG': this.sfr.OPTION = value; return;
      case 'TMR0': this.sfr.TMR0 = value; this.tmr0Prescale = 0; return;
      case 'PORTA': case 'PORTB': case 'PORTC': case 'PORTD': case 'PORTE': {
        const i = PORT_NAMES.indexOf(name);
        const mask = (1 << PORT_BITS[i]) - 1;
        this.portLatch[i] = value & mask;
        if (name === 'PORTE') this.lcdClock(value);
        return;
      }
      case 'TRISA': case 'TRISB': case 'TRISC': case 'TRISD': case 'TRISE': {
        const i = PORT_NAMES.indexOf(name.replace('TRIS', 'PORT'));
        this.tris[i] = value & ((1 << PORT_BITS[i]) - 1);
        return;
      }
      case 'TXREG': {
        this.sfr.TXREG = value;
        if ((this.sfr.TXSTA & 0x20) && (this.sfr.RCSTA & 0x80)) {
          // TXEN=1 và SPEN=1: phát ngay (mô phỏng ở mức ký tự, đủ cho terminal)
          this.txEmpty = false;
          this.txLog.push(value);
          if (this.onTx) this.onTx(value);
          this.txEmpty = true;
        }
        return;
      }
      case 'PIR1': this.sfr.PIR1 = value & 0xcf; return; // TXIF/RCIF chỉ đọc
      case 'ADCON0': {
        const wasGo = (this.sfr.ADCON0 >> 1) & 1;
        this.sfr.ADCON0 = value;
        if (!wasGo && ((value >> 1) & 1) && (value & 1)) {
          this.adcCountdown = 20; // ~20 chu kỳ lệnh cho một lần chuyển đổi
        }
        return;
      }
      default: this.sfr[name] = value; return;
    }
  }

  // Xung E của LCD: phát hiện cạnh lên của RE1, chốt lệnh/dữ liệu theo RS=RE0
  lcdClock(porteValue) {
    const e = (porteValue >> 1) & 1;
    if (this.prevE === 0 && e === 1) {
      const rs = porteValue & 1;
      const data = this.portLatch[3]; // PORTD
      if (rs) this.lcd.writeData(data); else this.lcd.command(data);
      if (this.onLcd) this.onLcd();
    }
    this.prevE = e;
  }

  // Board tác động từ ngoài: mức logic vào 1 chân (vd nút nhấn RC0=0 khi nhấn)
  setPinInput(portIdx, bit, level) {
    const old = (this.portInput[portIdx] >> bit) & 1;
    if (level) this.portInput[portIdx] |= (1 << bit);
    else this.portInput[portIdx] &= ~(1 << bit);
    if (portIdx === 1 && bit === 0 && old !== level) {
      // RB0/INT: cạnh theo INTEDG (OPTION bit6: 1=cạnh lên, 0=cạnh xuống)
      const rising = (this.sfr.OPTION >> 6) & 1;
      if ((rising && level === 1) || (!rising && level === 0)) this.sfr.INTCON |= 0x02;
    }
    if (portIdx === 1 && bit >= 4 && bit <= 7) {
      // RB4-RB7 đổi mức -> RBIF (ngắt PORTB)
      const cur = (this.portInput[1] >> 4) & 0xf;
      if (cur !== this.prevRB47) { this.sfr.INTCON |= 0x01; this.prevRB47 = cur; }
    }
    this.prevRB0 = level;
  }

  setAnalog(channel, volts) { this.analogVolts[channel & 7] = Math.max(0, Math.min(5, volts)); }

  receiveChar(code) {
    if (!(this.sfr.RCSTA & 0x80)) return; // SPEN=0: UART tắt
    this.sfr.RCREG = code & 0xff;
    this.rxReady = true;
  }

  // --- Ngắt ---
  interruptPending() {
    const intcon = this.sfr.INTCON;
    if (!(intcon & 0x80)) return false; // GIE=0
    if ((intcon & 0x04) && (intcon & 0x20)) return true; // TMR0IF & TMR0IE
    if ((intcon & 0x02) && (intcon & 0x10)) return true; // INTF & INTE
    if ((intcon & 0x01) && (intcon & 0x08)) return true; // RBIF & RBIE
    if (intcon & 0x40) { // PEIE
      const pir1 = this.readSFR('PIR1'), pie1 = this.sfr.PIE1;
      if ((pir1 & 0x40) && (pie1 & 0x40)) return true; // ADIF & ADIE
      if ((pir1 & 0x20) && (pie1 & 0x20)) return true; // RCIF & RCIE
      if ((pir1 & 0x10) && (pie1 & 0x10)) return true; // TXIF & TXIE
      if ((pir1 & 0x01) && (pie1 & 0x01)) return true; // TMR1IF
      if ((pir1 & 0x02) && (pie1 & 0x02)) return true; // TMR2IF
    }
    return false;
  }

  pushStack(v) { this.stack[this.sp] = v & 0x1fff; this.sp = (this.sp + 1) & 7; }
  popStack() { this.sp = (this.sp - 1) & 7; return this.stack[this.sp]; }

  setFlag(bit, v) { if (v) this.sfr.STATUS |= (1 << bit); else this.sfr.STATUS &= ~(1 << bit); }
  getFlag(bit) { return (this.sfr.STATUS >> bit) & 1; }

  // --- Ngoại vi chạy theo từng chu kỳ lệnh ---
  tickPeripherals() {
    // TMR0: clock nội (T0CS=0), prescaler theo OPTION_REG khi PSA=0
    const opt = this.sfr.OPTION;
    if (!((opt >> 5) & 1)) { // T0CS=0: clock nội
      const psa = (opt >> 3) & 1;
      const ps = opt & 7;
      if (psa) this.incTMR0();
      else {
        this.tmr0Prescale++;
        if (this.tmr0Prescale >= (1 << (ps + 1))) { this.tmr0Prescale = 0; this.incTMR0(); }
      }
    }
    // TMR1: chạy khi TMR1ON (T1CON bit0), clock nội Fosc/4
    if (this.sfr.T1CON & 1) {
      this.tmr1Prescale++;
      const ps = (this.sfr.T1CON >> 4) & 3;
      if (this.tmr1Prescale >= (1 << ps)) {
        this.tmr1Prescale = 0;
        const v = ((this.sfr.TMR1H << 8) | this.sfr.TMR1L) + 1;
        this.sfr.TMR1L = v & 0xff; this.sfr.TMR1H = (v >> 8) & 0xff;
        if (v >= 0x10000) this.sfr.PIR1 |= 0x01;
      }
    }
    // TMR2: prescaler + postscaler, so với PR2
    if (this.sfr.T2CON & 0x04) { // TMR2ON
      this.tmr2Prescale++;
      const ps = this.sfr.T2CON & 3;
      const rate = ps === 0 ? 1 : ps === 1 ? 4 : 16;
      if (this.tmr2Prescale >= rate) {
        this.tmr2Prescale = 0;
        this.sfr.TMR2++;
        if (this.sfr.TMR2 > this.sfr.PR2) {
          this.sfr.TMR2 = 0;
          this.tmr2Postscale++;
          const post = ((this.sfr.T2CON >> 3) & 0xf) + 1;
          if (this.tmr2Postscale >= post) { this.tmr2Postscale = 0; this.sfr.PIR1 |= 0x02; }
        }
      }
    }
    // ADC: đếm ngược rồi chốt kết quả
    if (this.adcCountdown > 0) {
      this.adcCountdown--;
      if (this.adcCountdown === 0) this.finishAdc();
    }
  }

  incTMR0() {
    this.sfr.TMR0 = (this.sfr.TMR0 + 1) & 0xff;
    if (this.sfr.TMR0 === 0) this.sfr.INTCON |= 0x04; // TMR0IF
  }

  finishAdc() {
    const ch = (this.sfr.ADCON0 >> 2) & 7;
    const v = Math.round((this.analogVolts[ch] / 5) * 1023);
    const result = Math.max(0, Math.min(1023, v));
    if (this.sfr.ADCON1 & 0x80) { // ADFM=1: căn phải
      this.sfr.ADRESL = result & 0xff;
      this.sfr.ADRESH = (result >> 8) & 0x03;
    } else { // căn trái
      this.sfr.ADRESH = (result >> 2) & 0xff;
      this.sfr.ADRESL = (result & 3) << 6;
    }
    this.sfr.ADCON0 &= ~0x02; // GO=0
    this.sfr.PIR1 |= 0x40;    // ADIF=1
  }

  // --- Thực thi 1 lệnh ---
  step() {
    if (this.sleeping) {
      // SLEEP: dừng cho tới khi có ngắt (kể cả khi GIE=0 vẫn đánh thức)
      const intcon = this.sfr.INTCON;
      const wake = (intcon & 0x04) || (intcon & 0x02) || (intcon & 0x01);
      if (!wake) return { addr: this.pc, op: 0, skipped: false };
      this.sleeping = false;
      this.setFlag(ST_PD, 1);
    }
    if (this.halted) return { addr: this.pc, op: 0, skipped: false };
    const addr = this.pc & 0x1fff;
    const op = this.program[addr] & 0x3fff;
    this.pc = (addr + 1) & 0x1fff; // mặc định sang lệnh kế
    let cyc = 1; let skipped = false;
    const f = op & 0x7f, d = (op >> 7) & 1, b = (op >> 7) & 7;
    const k8 = op & 0xff, k11 = op & 0x7ff;
    const readF = () => this.readFile(f);
    const writeF = (v) => { if (d) this.writeFile(f, v); else this.w = v & 0xff; };
    const doSkip = () => {
      skipped = true;
      const nextOp = this.program[this.pc & 0x1fff] & 0x3fff;
      this.pc = (this.pc + 1) & 0x1fff;
      cyc += isTwoCycle(nextOp) ? 2 : 1;
    };
    const setZ = (v) => this.setFlag(ST_Z, (v & 0xff) === 0);

    if (op === 0x0000) { /* NOP */ }
    else if (op === 0x0008) { this.pc = this.popStack(); cyc = 2; }
    else if (op === 0x0009) { this.pc = this.popStack(); this.sfr.INTCON |= 0x80; cyc = 2; }
    else if (op === 0x0063) { this.sleeping = true; this.setFlag(ST_PD, 0); this.setFlag(ST_TO, 1); }
    else if (op === 0x0064) { this.setFlag(ST_TO, 1); this.setFlag(ST_PD, 1); /* CLRWDT */ }
    else if (op === 0x0100) { this.w = 0; this.setFlag(ST_Z, 1); }
    else if ((op & 0xff80) === 0x0080) { this.writeFile(f, this.w); }
    else if ((op & 0xff80) === 0x0180) { this.writeFile(f, 0); this.setFlag(ST_Z, 1); }
    else if ((op & 0x3f00) === 0x3000) { this.w = k8; }
    else if ((op & 0x3f00) === 0x3400) { this.w = k8; this.pc = this.popStack(); cyc = 2; }
    else if ((op & 0x3f00) === 0x3e00) { const r = this.w + k8; this.setFlag(ST_C, r > 0xff); this.setFlag(ST_DC, ((this.w & 0xf) + (k8 & 0xf)) > 0xf); this.w = r & 0xff; setZ(this.w); }
    else if ((op & 0x3f00) === 0x3c00) { const r = (k8 - this.w) & 0xff; this.setFlag(ST_C, k8 >= this.w); this.setFlag(ST_DC, (k8 & 0xf) >= (this.w & 0xf)); this.w = r; setZ(r); }
    else if ((op & 0x3f00) === 0x3900) { this.w &= k8; setZ(this.w); }
    else if ((op & 0x3f00) === 0x3800) { this.w |= k8; setZ(this.w); }
    else if ((op & 0x3f00) === 0x3a00) { this.w ^= k8; setZ(this.w); }
    else if ((op & 0x3800) === 0x2000) { this.pushStack(this.pc); this.pc = ((this.sfr.PCLATH & 0x18) << 8) | k11; cyc = 2; }
    else if ((op & 0x3800) === 0x2800) { this.pc = ((this.sfr.PCLATH & 0x18) << 8) | k11; cyc = 2; }
    else if ((op & 0x3c00) === 0x1000) { this.writeFile(f, readF() & ~(1 << b)); }
    else if ((op & 0x3c00) === 0x1400) { this.writeFile(f, readF() | (1 << b)); }
    else if ((op & 0x3c00) === 0x1800) { if (!((readF() >> b) & 1)) doSkip(); }
    else if ((op & 0x3c00) === 0x1c00) { if ((readF() >> b) & 1) doSkip(); }
    else {
      const top = (op >> 8) & 0x3f;
      switch (top) {
        case 0x07: { const r = this.w + readF(); this.setFlag(ST_C, r > 0xff); this.setFlag(ST_DC, ((this.w & 0xf) + (readF() & 0xf)) > 0xf); writeF(r); setZ(r); break; }
        case 0x05: { const r = this.w & readF(); writeF(r); setZ(r); break; }
        case 0x09: { const r = (~readF()) & 0xff; writeF(r); setZ(r); break; }
        case 0x03: { const r = (readF() - 1) & 0xff; writeF(r); setZ(r); break; }
        case 0x0b: { const r = (readF() - 1) & 0xff; writeF(r); if (r === 0) doSkip(); break; }
        case 0x0a: { const r = (readF() + 1) & 0xff; writeF(r); setZ(r); break; }
        case 0x0f: { const r = (readF() + 1) & 0xff; writeF(r); if (r === 0) doSkip(); break; }
        case 0x04: { const r = this.w | readF(); writeF(r); setZ(r); break; }
        case 0x08: { const r = readF(); writeF(r); setZ(r); break; }
        case 0x0d: { const v = readF(); const nc = (v >> 7) & 1; const r = ((v << 1) & 0xff) | this.getFlag(ST_C); writeF(r); this.setFlag(ST_C, nc); break; }
        case 0x0c: { const v = readF(); const nc = v & 1; const r = (v >> 1) | (this.getFlag(ST_C) << 7); writeF(r); this.setFlag(ST_C, nc); break; }
        case 0x02: { const v = readF(); const r = (v - this.w) & 0xff; this.setFlag(ST_C, v >= this.w); this.setFlag(ST_DC, (v & 0xf) >= (this.w & 0xf)); writeF(r); setZ(r); break; }
        case 0x0e: { const v = readF(); const r = ((v & 0x0f) << 4) | ((v >> 4) & 0x0f); writeF(r); break; }
        case 0x06: { const r = this.w ^ readF(); writeF(r); setZ(r); break; }
        default: { /* opcode lạ: coi như NOP */ break; }
      }
    }
    this.cycles += cyc;
    for (let i = 0; i < cyc; i++) this.tickPeripherals();
    // Ngắt: sau mỗi lệnh, nếu đủ điều kiện thì nhảy tới vector 0x04
    if (this.interruptPending()) {
      this.pushStack(this.pc);
      this.sfr.INTCON &= ~0x80; // GIE=0
      this.pc = 0x04;
      this.cycles += 2;
    }
    return { addr, op, skipped };
  }

  // Chạy n lệnh (dùng cho test + vòng lặp UI)
  run(n) { for (let i = 0; i < n; i++) { if (this.halted || this.sleeping) break; this.step(); } }

  // Đọc RAM bank 0 vùng GPR 0x20-0x7F (phục vụ panel giám sát)
  readRamBank0() {
    const out = [];
    for (let a = 0x20; a <= 0x7f; a++) out.push(this.ram[a]);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Intel HEX: nạp .hex (từ MPLAB XC8/mikroC...) và xuất .hex từ program memory
// ---------------------------------------------------------------------------
export function parseIntelHex(text) {
  const program = new Uint16Array(8192);
  const errors = [];
  let config = 0x3fff; let base = 0; let words = 0;
  const lines = String(text).split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    if (!line.startsWith(':')) { errors.push({ line: li + 1, message: 'Dòng HEX phải bắt đầu bằng :' }); continue; }
    const bytes = [];
    for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.slice(i, i + 2), 16));
    if (bytes.length < 5) { errors.push({ line: li + 1, message: 'Dòng HEX quá ngắn' }); continue; }
    const len = bytes[0];
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.slice(4, 4 + len);
    let sum = 0; for (const b of bytes) sum += b;
    if ((sum & 0xff) !== 0) { errors.push({ line: li + 1, message: 'Checksum HEX sai' }); continue; }
    if (type === 0x04) { base = ((data[0] << 8) | data[1]) << 16; continue; }
    if (type === 0x01) break;
    if (type !== 0x00) continue;
    const byteAddr = base + addr;
    for (let i = 0; i + 1 < data.length; i += 2) {
      const wordAddr = (byteAddr + i) / 2;
      const word = (data[i] | (data[i + 1] << 8)) & 0x3fff;
      if (wordAddr === 0x2007) { config = word; continue; }
      if (wordAddr >= 0 && wordAddr < 8192) { program[wordAddr] = word; words++; }
    }
  }
  return { program, config, errors, words };
}

export function exportHex(program, config = 0x3fff) {
  let last = 0;
  for (let i = 8191; i >= 0; i--) { if (program[i] !== 0) { last = i; break; } }
  const lines = [];
  const rec = (byteAddr, type, dataBytes) => {
    const bytes = [dataBytes.length, (byteAddr >> 8) & 0xff, byteAddr & 0xff, type, ...dataBytes];
    let sum = 0; for (const b of bytes) sum += b;
    bytes.push((-sum) & 0xff);
    return ':' + bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  };
  for (let w = 0; w <= last; w += 8) {
    const data = [];
    for (let j = 0; j < 8; j++) {
      const word = program[w + j] || 0;
      data.push(word & 0xff, (word >> 8) & 0xff);
    }
    lines.push(rec(w * 2, 0, data));
  }
  if (config !== 0x3fff) lines.push(rec(0x400e, 0, [config & 0xff, (config >> 8) & 0xff]));
  lines.push(':00000001FF');
  return lines.join('\n') + '\n';
}

export function createCPU() { return new PIC16F877A(); }

// Tiện cho debug trong console trình duyệt (không ảnh hưởng Node test)
if (typeof globalThis !== 'undefined') {
  globalThis.PIC16 = { assemble, disassemble, parseIntelHex, exportHex, createCPU, PIC16F877A, LCD, REGISTERS };
}

// pic16.js — Lõi mô phỏng PIC16F877A (assembler + CPU + ngoại vi).
// Không phụ thuộc DOM: chạy được trong trình duyệt (ES module) và trong Node
// để test tự động. UI nằm ở app.js.
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
  OPTION_REG: 0x81, OPTION: 0x81, TRISA: 0x85, TRISB: 0x86, TRISC: 0x87, TRISD: 0x88,
  TRISE: 0x89, PIE1: 0x8c, PIE2: 0x8d, PCON: 0x8e, SSPCON2: 0x91, PR2: 0x92,
  SSPADD: 0x93, SSPSTAT: 0x94, TXSTA: 0x98, SPBRG: 0x99,
  CMCON: 0x9c, CVRCON: 0x9d, ADRESL: 0x9e, ADCON1: 0x9f,
  EEDATA: 0x10c, EEADR: 0x10d, EECON1: 0x10e, EECON2: 0x10f,
  EEDATH: 0x11e, EEADRH: 0x11f,
};

// Tên bit thường dùng trong toán hạng bit (BSF STATUS,RP0 / BTFSS INTCON,TMR0IF ...)
const BIT_NAMES = {
  C: 0, DC: 1, Z: 2, PD: 3, TO: 4, RP0: 5, RP1: 6, IRP: 7,
  RBIF: 0, INTF: 1, TMR0IF: 2, RBIE: 3, INTE: 4, TMR0IE: 5, PEIE: 6, GIE: 7,
  ADON: 0, GO: 1, GO_DONE: 1, DONE: 1, NOT_DONE: 1, CHS0: 2, CHS1: 3, CHS2: 4, ADCS0: 6, ADCS1: 7,
  ADIF: 6, RCIF: 5, TXIF: 4, TMR1IF: 0, TMR2IF: 1, CCP1IF: 2, SSPIF: 3, PSPIF: 7,
  TX9: 6, TXEN: 5, SYNC: 4, BRGH: 2, TRMT: 1, TX9D: 0, CSRC: 7,
  SPEN: 7, RX9: 6, SREN: 5, CREN: 4, ADDEN: 3, FERR: 2, OERR: 1, RX9D: 0,
  PS0: 0, PS1: 1, PS2: 2, PSA: 3, T0SE: 4, T0CS: 5, INTEDG: 6, RBPU: 7,
  ADFM: 7, PCFG0: 0, PCFG1: 1, PCFG2: 2, PCFG3: 3,
  PSPMODE: 4, IBOV: 5, OBF: 6, IBF: 7,
  NOT_BOR: 0, NOT_POR: 1,
  CCP2IF: 0, BCLIF: 3, EEIF: 4, CMIF: 6,
  CM0: 0, CM1: 1, CM2: 2, CIS: 3, C1INV: 4, C2INV: 5, C1OUT: 6, C2OUT: 7,
  CVR0: 0, CVR1: 1, CVR2: 2, CVR3: 3, CVRSS: 4, CVRR: 5, CVROE: 6, CVREN: 7,
  RD: 0, WR: 1, WREN: 2, WRERR: 3, EEPGD: 7,
  SEN: 0, RSEN: 1, PEN: 2, RCEN: 3, ACKEN: 4, ACKDT: 5, ACKSTAT: 6, GCEN: 7,
  TMR1ON: 0, TMR1CS: 1, T1SYNC: 2, NOT_T1SYNC: 2, T1OSCEN: 3, T1CKPS0: 4, T1CKPS1: 5,
  T2CKPS0: 0, T2CKPS1: 1, TMR2ON: 2, TOUTPS0: 3, TOUTPS1: 4, TOUTPS2: 5, TOUTPS3: 6,
  CCP1M0: 0, CCP1M1: 1, CCP1M2: 2, CCP1M3: 3, CCP1Y: 4, CCP1X: 5,
  CCP2M0: 0, CCP2M1: 1, CCP2M2: 2, CCP2M3: 3, CCP2Y: 4, CCP2X: 5,
  SSPM0: 0, SSPM1: 1, SSPM2: 2, SSPM3: 3, CKP: 4, SSPEN: 5, SSPOV: 6, WCOL: 7,
  BF: 0, UA: 1, R_NW: 2, D_NA: 5, CKE: 6, SMP: 7,
  TMR1IE: 0, TMR2IE: 1, CCP1IE: 2, SSPIE: 3, TXIE: 4, RCIE: 5, ADIE: 6, PSPIE: 7,
  CCP2IE: 0, BCLIE: 3, EEIE: 4, CMIE: 6,
  RA0: 0, RA1: 1, RA2: 2, RA3: 3, RA4: 4, RA5: 5,
  RB0: 0, RB1: 1, RB2: 2, RB3: 3, RB4: 4, RB5: 5, RB6: 6, RB7: 7,
  RC0: 0, RC1: 1, RC2: 2, RC3: 3, RC4: 4, RC5: 5, RC6: 6, RC7: 7,
  RD0: 0, RD1: 1, RD2: 2, RD3: 3, RD4: 4, RD5: 5, RD6: 6, RD7: 7,
  RE0: 0, RE1: 1, RE2: 2,
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
    0x11: 'SSPCON2', 0x12: 'PR2', 0x13: 'SSPADD', 0x14: 'SSPSTAT', 0x18: 'TXSTA', 0x19: 'SPBRG',
    0x1c: 'CMCON', 0x1d: 'CVRCON', 0x1e: 'ADRESL', 0x1f: 'ADCON1' },
  // bank 2
  { 0x00: 'INDF', 0x01: 'TMR0', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x06: 'PORTB', 0x0a: 'PCLATH', 0x0b: 'INTCON',
    0x0c: 'EEDATA', 0x0d: 'EEADR', 0x0e: 'EECON1', 0x0f: 'EECON2',
    0x1e: 'EEDATH', 0x1f: 'EEADRH' },
  // bank 3
  { 0x00: 'INDF', 0x01: 'OPTION_REG', 0x02: 'PCL', 0x03: 'STATUS', 0x04: 'FSR',
    0x06: 'TRISB', 0x0a: 'PCLATH', 0x0b: 'INTCON' },
];

const PORT_BITS = [6, 8, 8, 8, 3]; // số chân thật của PORTA..PORTE
const PORT_NAMES = ['PORTA', 'PORTB', 'PORTC', 'PORTD', 'PORTE'];

// ---------------------------------------------------------------------------
// Tiện ích số
// ---------------------------------------------------------------------------
// Tìm vị trí toán tử + / - ở cấp ngoài cùng (bỏ qua ký tự trong '...' và dấu âm ở đầu).
function findAddSubOp(t) {
  let q = null;
  for (let i = 1; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === '+' || ch === '-') return i;
  }
  return -1;
}

// radix: cơ số mặc định cho số không có tiền tố (10 mặc định; directive RADIX đổi được)
// curAddr: địa chỉ lệnh hiện tại — ký hiệu $ trong MPLAB (vd GOTO $-1 = lặp tại chỗ)
function parseNumberToken(tok, symbols, radix = 10, curAddr = null) {
  const t = String(tok).trim();
  if (t === '') return null;
  // HIGH/LOW: HIGH label = byte cao, LOW label = byte thấp (bảng tra, PCLATH)
  const hl = t.match(/^(HIGH|LOW)\s+(.+)$/i);
  if (hl) {
    const v = parseNumberToken(hl[2], symbols, radix, curAddr);
    if (v === null) return null;
    return hl[1].toUpperCase() === 'HIGH' ? (v >> 8) & 0xff : v & 0xff;
  }
  // Biểu thức cộng/trừ đơn giản: A+B, A-B, label+1 (đệ quy, chỉ + và -)
  const opIdx = findAddSubOp(t);
  if (opIdx > 0) {
    const a = parseNumberToken(t.slice(0, opIdx), symbols, radix, curAddr);
    const b = parseNumberToken(t.slice(opIdx + 1), symbols, radix, curAddr);
    if (a === null || b === null) return null;
    return t[opIdx] === '+' ? a + b : a - b;
  }
  if (t === '$') return curAddr; // địa chỉ hiện tại (GOTO $ = lặp tại chỗ)
  if (/^'.'$/.test(t) || /^"."$/.test(t)) return t.charCodeAt(1); // 'A'
  if (/^0x[0-9a-fA-F]+$/i.test(t)) return parseInt(t, 16);
  if (/^\$[0-9a-fA-F]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
  if (/^H'[0-9a-fA-F]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 16);
  if (/^B'[01]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 2);
  if (/^D'[0-9]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 10);
  if (/^O'[0-7]+'$/.test(t.toUpperCase())) return parseInt(t.slice(2, -1), 8);
  if (/^\.[0-9]+$/.test(t)) return parseInt(t.slice(1), 10); // .100 kiểu MPLAB
  if (/^-?[0-9]+$/.test(t)) return parseInt(t, radix); // số trần theo RADIX (mặc định thập phân)
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
    // CGRAM 64 byte: 8 ký tự tự tạo × 8 hàng, mỗi hàng chỉ 5 bit có nghĩa
    // (bit 4 = cột trái nhất). Mất khi mất nguồn, giống HD44780 thật.
    this.cgram = new Uint8Array(64);
    this.addr = 0; this.addrIsCgram = false;
    this.displayOn = true; this.cursorOn = false; this.blink = false;
    this.entryInc = true;
    // Offset cửa sổ hiển thị (0..39), CHUNG cho cả 2 dòng: lệnh shift
    // màn hình (0x18/0x1C) trượt cửa sổ này trong DDRAM, không sửa DDRAM.
    this.shift = 0;
  }
  command(cmd) {
    if (cmd === 0x01) { this.ddram.fill(0x20); this.addr = 0; this.addrIsCgram = false; this.shift = 0; } // Clear display: chỉ DDRAM, CGRAM giữ nguyên; màn hình về vị trí gốc
    else if (cmd === 0x02) { this.addr = 0; this.addrIsCgram = false; this.shift = 0; } // Return home: con trỏ về 0, màn hình về vị trí gốc
    else if ((cmd & 0xfc) === 0x04) { this.entryInc = !!(cmd & 0x02); } // Entry mode
    else if ((cmd & 0xf8) === 0x08) { // Display on/off
      this.displayOn = !!(cmd & 0x04); this.cursorOn = !!(cmd & 0x02); this.blink = !!(cmd & 0x01);
    } else if ((cmd & 0xf0) === 0x10) { // Cursor/display shift (0x10-0x1F): bit 3 = S/C, bit 2 = R/L
      const toDisplay = !!(cmd & 0x08); // S/C: 1 = dịch màn hình, 0 = dịch con trỏ
      const toRight = !!(cmd & 0x04); // R/L: 1 = phải, 0 = trái
      if (toDisplay) {
        // Dịch màn hình: dịch trái (0x18) thì cửa sổ trượt sang phải trong
        // DDRAM (ký tự trái trôi ra, ký tự phải hiện vào); dịch phải (0x1C)
        // thì ngược lại. Không đổi DDRAM, không đổi con trỏ.
        this.shift = (this.shift + (toRight ? 39 : 1)) % 40;
      } else {
        // Dịch con trỏ (0x14 phải / 0x10 trái): quay vòng như writeData,
        // không đổi DDRAM, không đổi shift.
        if (toRight) {
          this.addr++;
          if (this.addr === 0x28) this.addr = 0x40;
          else if (this.addr === 0x68) this.addr = 0x00;
        } else {
          this.addr--;
          if (this.addr === 0x3f) this.addr = 0x27;
          else if (this.addr < 0) this.addr = 0x67;
        }
      }
    } else if (cmd & 0x80) { this.addr = cmd & 0x7f; this.addrIsCgram = false; } // Set DDRAM address
    else if (cmd & 0x40) { this.addr = cmd & 0x3f; this.addrIsCgram = true; } // Set CGRAM address (0x40-0x7F)
    // 0x20-0x3F function set: không cần cho bài lab
  }
  writeData(ch) {
    if (this.addrIsCgram) {
      this.cgram[this.addr & 0x3f] = ch & 0x1f; // mỗi hàng CGRAM chỉ 5 bit
      if (this.entryInc) this.addr = (this.addr + 1) & 0x3f; // tự tăng, quay vòng trong 64 byte
      else this.addr = (this.addr - 1) & 0x3f;
      return;
    }
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
  // Pattern 8 hàng (mỗi hàng 5 bit) của ký tự tự tạo mã code (0-7). Trả về mảng mới.
  getCustomChar(code) {
    const base = (code & 0x07) * 8;
    return Array.from(this.cgram.slice(base, base + 8));
  }
  // Mỗi ô màn hình: { ch, custom } — custom là mảng 8 hàng (5 bit) khi mã
  // DDRAM < 0x10 (HD44780: mã 0-7 và 8-15 đều trỏ tới cùng ký tự CGRAM 0-7),
  // ngược lại null. getLines() giữ nguyên (mã 0-7 vẫn là ' ') để test cũ không đổi.
  getDisplayCells() {
    const cell = (b) => {
      const ch = (b >= 32 && b < 127) ? String.fromCharCode(b) : ' ';
      return { ch, custom: b < 0x10 ? this.getCustomChar(b) : null };
    };
    const line = (base) => { const out = []; for (let i = 0; i < 16; i++) out.push(cell(this.ddram[base + (this.shift + i) % 40])); return out; };
    return [line(0), line(0x40)];
  }
  getLines() {
    const dec = (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ');
    let l0 = '', l1 = '';
    for (let i = 0; i < 16; i++) l0 += dec(this.ddram[(this.shift + i) % 40]);
    for (let i = 0; i < 16; i++) l1 += dec(this.ddram[0x40 + (this.shift + i) % 40]);
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

function encodeInstruction(mn, ops, symbols, lineNo, radix = 10, curAddr = null) {
  const err = (m) => ({ error: m });
  const num = (tok) => {
    const v = parseNumberToken(tok, symbols, radix, curAddr);
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

// Thay thế #define theo từng từ (toàn từ, không chạm chuỗi '...' / "...").
// Lặp tối đa 5 lần để #define lồng nhau (A -> B -> 0x20) cũng thay được.
function applyDefines(line, defines) {
  const names = Object.keys(defines);
  if (!names.length) return line;
  const parts = line.split(/('[^']*'|"[^"]*")/g);
  for (let i = 0; i < parts.length; i += 2) {
    let seg = parts[i];
    for (let iter = 0; iter < 5; iter++) {
      let changed = false;
      for (const name of names) {
        const re = new RegExp(`\\b${name}\\b`, 'gi');
        const next = seg.replace(re, defines[name]);
        if (next !== seg) { seg = next; changed = true; }
      }
      if (!changed) break;
    }
    parts[i] = seg;
  }
  return parts.join('');
}

export function assemble(source) {
  const lines = String(source).split(/\r?\n/);
  const errors = [];
  const labels = {};      // TÊN -> địa chỉ
  const symbols = {};     // EQU + CBLOCK + nhãn (dùng khi parse số)
  const lineInfo = [];    // mỗi dòng: { lineNo, label, mnemonic, ops, addr, size }
  let pc = 0;
  let cblockAddr = null;  // null = ngoài khối CBLOCK; số = địa chỉ tiếp theo để gán
  let radix = 10;         // cơ số mặc định cho số trần (directive RADIX đổi được)
  const defines = {};     // #define NAME -> chuỗi thay thế (theo thứ tự xuất hiện)
  let skipDepth = 0;      // >0 = đang bỏ qua khối chưa hỗ trợ (MACRO / IF / WHILE / #ifdef)
  let skipKind = null;    // 'MACRO' | 'IF' | 'WHILE' | 'IFDEF'

  // --- Pass 1: quét nhãn, EQU, ORG; tính địa chỉ ---
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const clean0 = stripComment(lines[i]).trim();
    if (!clean0) { lineInfo.push({ lineNo }); continue; }
    // Khối chưa hỗ trợ: bỏ qua tới ENDM/ENDIF/ENDW/#ENDIF tương ứng (đếm
    // lồng nhau), chỉ báo 1 lỗi rõ ràng ở dòng mở khối.
    if (skipDepth > 0) {
      const sk = clean0.split(/\s+/)[0].toUpperCase();
      if (sk === 'MACRO' || sk === 'IF' || sk === 'WHILE' || sk === '#IFDEF' || sk === '#IFNDEF') skipDepth++;
      else if (sk === 'ENDM' || sk === 'ENDIF' || sk === 'ENDW' || sk === '#ENDIF') {
        skipDepth--;
        if (skipDepth === 0) skipKind = null;
      }
      lineInfo.push({ lineNo }); continue;
    }
    // #define / #undef: ghi lại rồi bỏ dòng; áp dụng cho các dòng sau.
    {
      const firstTok = clean0.split(/\s+/)[0].toUpperCase();
      if (firstTok === '#DEFINE' || firstTok === 'DEFINE') {
        const mDef = clean0.match(/^#?DEFINE\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/i);
        if (mDef) defines[mDef[1].toUpperCase()] = mDef[2].trim();
        else errors.push({ line: lineNo, message: `#define không hiểu dòng: "${clean0}"` });
        lineInfo.push({ lineNo, directive: 'DEFINE' }); continue;
      }
      if (firstTok === '#UNDEF' || firstTok === 'UNDEF') {
        const mUn = clean0.match(/^#?UNDEF\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
        if (mUn) delete defines[mUn[1].toUpperCase()];
        else errors.push({ line: lineNo, message: `#undef không hiểu dòng: "${clean0}"` });
        lineInfo.push({ lineNo, directive: 'UNDEF' }); continue;
      }
    }
    const clean = applyDefines(clean0, defines);
    // CBLOCK/ENDC và tên biến trong khối: xử lý TRƯỚC khi tách nhãn, vì
    // "X:3" trong CBLOCK là giữ 3 byte, không phải nhãn code "X:".
    {
      const firstTok = clean.split(/\s+/)[0].toUpperCase();
      if (firstTok === 'CBLOCK') {
        const tailC = clean.slice(clean.split(/\s+/)[0].length).trim();
        const v = parseNumberToken(tailC, symbols, radix, pc);
        if (v === null || v === undefined) errors.push({ line: lineNo, message: `CBLOCK không hiểu "${tailC}"` });
        // RAM là 9-bit (0x000-0x1FF, 4 bank): KHÔNG cắt còn 8-bit.
        // Lỗi cũ: "v & 0xff" biến CBLOCK 0x110 (bank 2) thành 0x10
        // (bank 0), làm biến bank 2/3 chồng lên biến tạm __C_T0.. và
        // thanh ghi SFR, chương trình kẹt/currupt khi có 2 mảng cục bộ
        // lớn (text[] + title[]) đẩy biến sang bank 2.
        else cblockAddr = v & 0x1ff;
        lineInfo.push({ lineNo, directive: 'CBLOCK' }); continue;
      }
      if (firstTok === 'ENDC') {
        cblockAddr = null;
        lineInfo.push({ lineNo, directive: 'ENDC' }); continue;
      }
      if (cblockAddr !== null) {
        // Trong khối CBLOCK: mỗi dòng là 1 tên biến, chiếm 1 byte, địa chỉ tăng dần.
        // Cho phép "TEN:n" để giữ n byte (mặc định 1).
        const mRes = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::(\d+))?$/);
        if (mRes) {
          const up = mRes[1].toUpperCase();
          const n = mRes[2] ? parseInt(mRes[2], 10) : 1;
          if (up in symbols) errors.push({ line: lineNo, message: `Tên "${mRes[1]}" bị trùng trong CBLOCK` });
          else symbols[up] = cblockAddr;
          cblockAddr += n;
          lineInfo.push({ lineNo, directive: 'CBLOCK' }); continue;
        }
        errors.push({ line: lineNo, message: `CBLOCK không hiểu dòng: "${clean}"` });
        lineInfo.push({ lineNo }); continue;
      }
    }
    // Tách nhãn ở đầu: "LOOP:" hoặc "LOOP" đứng một mình / trước lệnh
    let rest = clean; let label = null;
    const mColon = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (mColon) { label = mColon[1]; rest = mColon[2].trim(); }
    const info = { lineNo, label, addr: pc, radix };
    if (label) {
      const up = label.toUpperCase();
      if (up in labels) errors.push({ line: lineNo, message: `Nhãn "${label}" bị trùng` });
      labels[up] = pc; symbols[up] = pc;
    }
    if (!rest) { lineInfo.push(info); continue; }
    // Nhãn không dấu ':' đứng trước lệnh/directive: "LOOP MOVLW 0x10",
    // "MSG DB 'Hi'", "BUFFER RES 16" — tách nhãn ra rồi xử lý phần còn lại.
    // (EQU / VARIABLE / CONSTANT giữ nguyên dạng "TÊN <từ khoá> giá trị" nên
    // không tách ở đây, chúng tự lấy tên từ parts[0] bên dưới.)
    {
      const mLbl = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
      if (mLbl) {
        const second = mLbl[2].split(/\s+/)[0].toUpperCase();
        const isDirOrMn = MNEMONICS.has(second) || second === 'DB' || second === 'DW' || second === 'DATA'
          || second === 'DT' || second === 'DA' || second === 'RES' || second === 'FILL'
          || second === 'BANKSEL' || second === 'PAGESEL';
        if (isDirOrMn) {
          const lbl = mLbl[1];
          const up = lbl.toUpperCase();
          if (!(up in labels)) { labels[up] = info.addr; symbols[up] = info.addr; }
          info.label = lbl;
          rest = mLbl[2].trim();
        }
      }
    }
    const parts = rest.split(/\s+/);
    const first = parts[0].toUpperCase();
    const tail = rest.slice(parts[0].length).trim();
    // EQU: "TEN EQU giá trị" (nhãn nằm ở đầu dòng, không có dấu :) hoặc
    // "TEN: EQU giá trị" (nhãn đã tách bởi dấu :, tên nằm trong info.label)
    if (first === 'EQU') {
      const eqName = info.label || parts[0];
      const eqVal = info.label ? tail : parts.slice(2).join(' ');
      const v = parseNumberToken(eqVal, symbols, radix, pc);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `EQU không hiểu giá trị "${eqVal}"` });
      else { symbols[eqName.toUpperCase()] = v; }
      info.directive = 'EQU'; lineInfo.push(info); continue;
    }
    if (parts.length >= 3 && parts[1].toUpperCase() === 'EQU') {
      const v = parseNumberToken(parts.slice(2).join(' '), symbols, radix, pc);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `EQU không hiểu giá trị "${parts.slice(2).join(' ')}"` });
      else { symbols[parts[0].toUpperCase()] = v; }
      info.directive = 'EQU'; lineInfo.push(info); continue;
    }
    // VARIABLE / CONSTANT: "TÊN VARIABLE giá trị" / "TÊN CONSTANT giá trị"
    // (tên nằm ở parts[0], giống EQU). Giá trị cho phép có dấu '=' ở đầu.
    if (parts.length >= 3 && (parts[1].toUpperCase() === 'VARIABLE' || parts[1].toUpperCase() === 'CONSTANT')) {
      let vcVal = parts.slice(2).join(' ').trim();
      if (vcVal.startsWith('=')) vcVal = vcVal.slice(1).trim();
      const v = parseNumberToken(vcVal, symbols, radix, pc);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `${parts[1].toUpperCase()} không hiểu giá trị "${vcVal}"` });
      else { symbols[parts[0].toUpperCase()] = v; }
      info.directive = parts[1].toUpperCase(); lineInfo.push(info); continue;
    }
    if (first === 'VARIABLE' || first === 'CONSTANT') {
      // Dạng "TÊN: VARIABLE giá trị" (nhãn đã tách bởi dấu :)
      if (!info.label) { errors.push({ line: lineNo, message: `${first} cần tên biến (viết "TÊN ${first} giá trị")` }); lineInfo.push(info); continue; }
      let vcVal = tail.trim();
      if (vcVal.startsWith('=')) vcVal = vcVal.slice(1).trim();
      const v = parseNumberToken(vcVal, symbols, radix, pc);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `${first} không hiểu giá trị "${vcVal}"` });
      else { symbols[info.label.toUpperCase()] = v; }
      info.directive = first; lineInfo.push(info); continue;
    }
    if (first === 'ORG') {
      const v = parseNumberToken(tail, symbols, radix, pc);
      if (v === null || v === undefined) errors.push({ line: lineNo, message: `ORG không hiểu "${tail}"` });
      else if (v >= 0x2100) errors.push({ line: lineNo, message: `ORG 0x${v.toString(16).toUpperCase()} là vùng dữ liệu EEPROM (0x2100+), chưa được hỗ trợ — ghi EEPROM bằng EECON1/EEADR trong code thay vì nạp sẵn` });
      else pc = v & 0x1fff;
      info.directive = 'ORG'; info.addr = pc; lineInfo.push(info); continue;
    }
    if (first === 'END') { info.directive = 'END'; lineInfo.push(info); break; }
    if (first === '__CONFIG' || first === 'CONFIG') { info.directive = 'CONFIG'; lineInfo.push(info); continue; }
    if (first === 'LIST' || first === '#INCLUDE' || first === 'INCLUDE') { info.directive = 'IGNORE'; lineInfo.push(info); continue; }
    // Chỉ thị chỉ ảnh hưởng listing / không ảnh hưởng code: bỏ qua an toàn.
    if (first === 'PROCESSOR' || first === 'ERRORLEVEL' || first === 'TITLE' || first === 'PAGE'
      || first === 'SUBTITLE' || first === 'MESSG' || first === 'EXPAND' || first === 'NOEXPAND'
      || first === 'NOLIST' || first === 'SET') { info.directive = 'IGNORE'; lineInfo.push(info); continue; }
    // RADIX: đổi cơ số mặc định cho số trần (DEC/HEX/OCT/BIN hoặc 10/16/8/2).
    if (first === 'RADIX') {
      const rUp = tail.toUpperCase();
      const rMap = { DEC: 10, HEX: 16, OCT: 8, BIN: 2, '10': 10, '16': 16, '8': 8, '2': 2 };
      if (rUp in rMap) radix = rMap[rUp];
      else errors.push({ line: lineNo, message: `RADIX không hiểu "${tail}" (dùng DEC, HEX, OCT hoặc BIN)` });
      info.directive = 'RADIX'; lineInfo.push(info); continue;
    }
    // Khối chưa hỗ trợ: báo lỗi rõ ràng (không phải "Không hiểu dòng") rồi bỏ
    // qua tới từ khoá đóng khối tương ứng.
    if (first === 'MACRO') {
      errors.push({ line: lineNo, message: `MACRO chưa được hỗ trợ — viết thẳng code ra thay vì dùng macro, hoặc chia macro thành chương trình con (CALL/RETURN)` });
      skipDepth = 1; skipKind = 'MACRO'; lineInfo.push({ lineNo, directive: 'MACRO' }); continue;
    }
    if (first === 'IF') {
      errors.push({ line: lineNo, message: `IF/ELSE/ENDIF (dịch có điều kiện) chưa được hỗ trợ — tách thành 2 bản code riêng, hoặc dùng EQU rồi sửa tay giá trị` });
      skipDepth = 1; skipKind = 'IF'; lineInfo.push({ lineNo, directive: 'IF' }); continue;
    }
    if (first === 'WHILE') {
      errors.push({ line: lineNo, message: `WHILE/ENDW (lặp lúc dịch) chưa được hỗ trợ — viết lặp lại bằng tay, hoặc dùng DB/DW liệt kê giá trị` });
      skipDepth = 1; skipKind = 'WHILE'; lineInfo.push({ lineNo, directive: 'WHILE' }); continue;
    }
    if (first === '#IFDEF' || first === '#IFNDEF') {
      errors.push({ line: lineNo, message: `${first}/#ELSE/#ENDIF chưa được hỗ trợ — bỏ khối điều kiện, chỉ giữ nhánh code cần dùng` });
      skipDepth = 1; skipKind = 'IFDEF'; lineInfo.push({ lineNo, directive: 'IFDEF' }); continue;
    }
    if (first === 'ENDM' || first === 'ENDIF' || first === 'ENDW' || first === '#ENDIF' || first === 'ELSE' || first === '#ELSE') {
      errors.push({ line: lineNo, message: `${first} không có ${first === 'ENDM' ? 'MACRO' : first === 'ENDIF' || first === '#ENDIF' ? 'IF/#IFDEF' : first === 'ENDW' ? 'WHILE' : 'IF'} tương ứng (khối mở đã bị bỏ qua hoặc thiếu)` });
      lineInfo.push(info); continue;
    }
    if (first === 'DE') {
      errors.push({ line: lineNo, message: `DE (dữ liệu EEPROM nạp sẵn) chưa được hỗ trợ — ghi EEPROM bằng EECON1/EEADR trong code` });
      lineInfo.push(info); continue;
    }
    if (first === 'ERROR') {
      errors.push({ line: lineNo, message: `ERROR (theo code): ${tail || '(không có thông báo)'}` });
      lineInfo.push(info); continue;
    }
    if (first === 'BANKSEL') {
      info.mnemonic = 'BANKSEL'; info.ops = splitOperands(tail); info.size = 2; info.addr = pc;
      pc += 2; lineInfo.push(info); continue;
    }
    if (first === 'PAGESEL') {
      // PAGESEL nhãn: đặt PCLATH bit 3-4 theo trang (bit 11-12) của nhãn (2 lệnh).
      info.mnemonic = 'PAGESEL'; info.ops = splitOperands(tail); info.size = 2; info.addr = pc;
      pc += 2; lineInfo.push(info); continue;
    }
    if (first === 'RES') {
      // RES n: giữ n word (điền 0). Nhãn đứng trước (nếu có) đã tách ở trên.
      const v = parseNumberToken(tail, symbols, radix, pc);
      if (v === null || v === undefined || v < 0) errors.push({ line: lineNo, message: `RES không hiểu "${tail}"` });
      else { info.mnemonic = 'RES'; info.ops = [String(v)]; info.size = v; info.addr = pc; pc += v; }
      lineInfo.push(info); continue;
    }
    if (first === 'FILL') {
      // FILL giá trị, số lượng: điền n word bằng giá trị cho trước.
      const fOps = splitOperands(tail);
      const fv = fOps.length >= 1 ? parseNumberToken(fOps[0], symbols, radix, pc) : null;
      const fn = fOps.length >= 2 ? parseNumberToken(fOps[1], symbols, radix, pc) : null;
      if (fv === null || fv === undefined || fn === null || fn === undefined || fn < 0) errors.push({ line: lineNo, message: `FILL cần dạng: FILL giá_trị, số_lượng` });
      else { info.mnemonic = 'FILL'; info.ops = [String(fv), String(fn)]; info.size = fn; info.addr = pc; pc += fn; }
      lineInfo.push(info); continue;
    }
    if (first === 'DA') {
      // DA "chuỗi": nén 2 ký tự vào 1 word (ký tự đầu ở byte thấp).
      const strMatch = tail.match(/"([^"]*)"/);
      const text = strMatch ? strMatch[1] : tail;
      info.mnemonic = 'DA'; info.ops = [text]; info.size = Math.ceil(text.length / 2); info.addr = pc;
      pc += info.size; lineInfo.push(info); continue;
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
      const target = parseNumberToken(info.ops[0] || '', symbols, info.radix || 10, info.addr);
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
    if (info.mnemonic === 'PAGESEL') {
      const target = parseNumberToken(info.ops[0] || '', symbols, info.radix || 10, info.addr);
      if (target === undefined || target === null) {
        errors.push({ line: info.lineNo, message: `PAGESEL không hiểu "${info.ops[0] || ''}"` });
        continue;
      }
      const page = (target >> 11) & 3; // bit 11-12 của địa chỉ -> PCLATH bit 3-4
      const c0 = ((page & 1) ? 0x1400 : 0x1000) | (3 << 7) | 0x0a; // BSF/BCF PCLATH,3
      const c1 = ((page & 2) ? 0x1400 : 0x1000) | (4 << 7) | 0x0a; // BSF/BCF PCLATH,4
      program[info.addr] = c0; program[info.addr + 1] = c1;
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      listing.push({ addr: info.addr, code: c0, text: `PAGESEL ${info.ops[0]}`, line: info.lineNo });
      listing.push({ addr: info.addr + 1, code: c1, text: '', line: info.lineNo });
      continue;
    }
    if (info.mnemonic === 'RES') {
      // Đã giữ chỗ ở pass 1, program mặc định là 0 (NOP) nên không cần ghi gì.
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      continue;
    }
    if (info.mnemonic === 'FILL') {
      const fv = parseInt(info.ops[0], 10), fn = parseInt(info.ops[1], 10);
      for (let idx = 0; idx < fn; idx++) program[info.addr + idx] = fv & 0x3fff;
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      continue;
    }
    if (info.mnemonic === 'DA') {
      const text = info.ops[0];
      for (let idx = 0; idx < text.length; idx += 2) {
        const lo = text.charCodeAt(idx) & 0xff;
        const hi = idx + 1 < text.length ? text.charCodeAt(idx + 1) & 0xff : 0;
        program[info.addr + (idx >> 1)] = ((hi << 8) | lo) & 0x3fff; // word 14-bit
      }
      lineToAddr.set(info.lineNo, info.addr); addrToLine.set(info.addr, info.lineNo);
      continue;
    }
    if (info.mnemonic === 'DB' || info.mnemonic === 'DW' || info.mnemonic === 'DATA') {
      info.ops.forEach((tok, idx) => {
        const v = parseNumberToken(tok, symbols, info.radix || 10, info.addr);
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
    const r = encodeInstruction(info.mnemonic, info.ops, symbols, info.lineNo, info.radix || 10, info.addr);
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
    this.wiring = null; // cấu hình ngoại vi từ netlist breadboard (wiring.js); null = đấu cứng cũ
    this.analogVolts = [0, 0, 0, 0, 0, 0, 0, 0]; // AN0..AN7 (V)
    this.txLog = [];        // mã ký tự đã phát qua TX
    this.onTx = null;       // callback(code) khi CPU phát 1 ký tự
    this.onLcd = null;
    // Bàn phím ma trận đang nhấn: id bàn phím -> {row, col} (0..3) hoặc
    // null (không nhấn phím nào). Đặt bằng setKeypadPressed (xem dưới);
    // pinLevel dùng nó để tính mức cột khi CPU đọc (xem pinLevel).
    this.keypadPressed = new Map();
    // EEPROM dữ liệu (256 byte): KHÔNG xoá khi reset (như phần cứng thật,
    // dữ liệu ghi rồi vẫn còn sau khi nạp lại code). Xoá tay bằng loadEeprom([]).
    this.eeprom = new Uint8Array(256);
    this.eeUnlock = 0;      // 0=chưa mở, 1=đã ghi 0x55, 2=đã ghi 0x55+0xAA
    this.eeWriteCountdown = 0; // chu kỳ lệnh còn lại của lần ghi EEPROM đang chạy
    this.eeWriteAddr = 0; this.eeWriteData = 0; // chốt khi bắt đầu ghi
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
      SSPBUF: 0, SSPCON: 0, SSPADD: 0, SSPSTAT: 0, SSPCON2: 0,
      CCPR1L: 0, CCPR1H: 0, CCP1CON: 0, CCPR2L: 0, CCPR2H: 0, CCP2CON: 0,
      CMCON: 0x07, CVRCON: 0,
      EEDATA: 0, EEADR: 0, EECON1: 0, EECON2: 0, EEDATH: 0, EEADRH: 0,
    };
    this.portLatch = [0, 0, 0, 0, 0];
    this.portInput = [0x3f, 0xff, 0xff, 0xff, 0x07]; // mức ngoài: nút nhấn có pull-up -> 1
    this.tris = [0x3f, 0xff, 0xff, 0xff, 0x07];
    this.txEmpty = true; this.rxReady = false;
    this.adcCountdown = 0;
    this.eeUnlock = 0; this.eeWriteCountdown = 0; // ghi EEPROM đang chạy thì huỷ
    this.ccp1Pwm = 0; this.ccp2Pwm = 0; // mức ra PWM tức thời (CCP1->RC2, CCP2->RC1)
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
    for (let b = 0; b < PORT_BITS[i]; b++) v |= this.pinLevel(i, b) << b;
    return v;
  }
  // Mức chân thật (kể cả input): dùng cho GPIO Inspector / Logic analyzer.
  // PWM của CCP chiếm chân (bất chấp TRISC): CCP1 -> RC2, CCP2 -> RC1.
  // Bàn phím ma trận: cột là input có pull-up (mức 1) trừ khi phím đang
  // nhấn nối cột đó với 1 hàng đang là output mức 0 thì cột đọc 0. Tính
  // ngay lúc đọc (không qua portInput) để luôn đồng bộ với vòng quét hàng
  // của CPU — quét hàng đổi liên tục theo từng lệnh nên không thể cập nhật
  // trước bằng setPinInput như nút nhấn.
  pinLevel(portIdx, bit) {
    if (portIdx === 2 && bit === 2 && (this.sfr.CCP1CON & 0x0f) === 0x0c) return this.ccp1Pwm;
    if (portIdx === 2 && bit === 1 && (this.sfr.CCP2CON & 0x0f) === 0x0c) return this.ccp2Pwm;
    if (((this.tris[portIdx] >> bit) & 1) === 1) {
      const kps = this.wiring && this.wiring.keypads;
      if (kps) {
        for (const kp of kps) {
          const c = kp.cols.findIndex((p) => p && p.port === portIdx && p.bit === bit);
          if (c < 0) continue;
          const pressed = this.keypadPressed.get(kp.id);
          if (pressed && pressed.col === c) {
            const rowPin = kp.rows[pressed.row];
            if (rowPin && ((this.tris[rowPin.port] >> rowPin.bit) & 1) === 0
              && ((this.portLatch[rowPin.port] >> rowPin.bit) & 1) === 0) return 0;
          }
          return 1; // cột có pull-up
        }
      }
      return (this.portInput[portIdx] >> bit) & 1;
    }
    return (this.portLatch[portIdx] >> bit) & 1;
  }
  pinDirection(portIdx, bit) {
    if (portIdx === 2 && bit === 2 && (this.sfr.CCP1CON & 0x0f) === 0x0c) return 'out';
    if (portIdx === 2 && bit === 1 && (this.sfr.CCP2CON & 0x0f) === 0x0c) return 'out';
    return ((this.tris[portIdx] >> bit) & 1) ? 'in' : 'out';
  }

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
        let v = this.sfr.PIR1 & 0xcf; // giữ ADIF/PSPIF/TMR1IF/TMR2IF/CCP1IF/SSPIF, bỏ TXIF/RCIF cũ để tính lại
        if (this.txEmpty) v |= 0x10;
        if (this.rxReady) v |= 0x20;
        return v;
      }
      case 'TXSTA': return (this.sfr.TXSTA & 0xfd) | (this.txEmpty ? 0x02 : 0);
      case 'RCREG': { const v = this.sfr.RCREG; this.rxReady = false; return v; }
      case 'EECON2': return 0; // thanh ghi chỉ ghi (chuỗi mở khoá), đọc về 0
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
        this.lcdTick(); // LCD chốt theo cạnh lên của E — chân E có thể đã đổi dây
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
      case 'EECON2': {
        // Chuỗi mở khoá ghi EEPROM: phải ghi 0x55 rồi 0xAA, ghi khác -> reset.
        if (value === 0x55) this.eeUnlock = 1;
        else if (value === 0xaa && this.eeUnlock === 1) this.eeUnlock = 2;
        else this.eeUnlock = 0;
        this.sfr.EECON2 = value; return;
      }
      case 'EECON1': {
        this.sfr.EECON1 = value;
        // Đọc EEPROM dữ liệu: RD=1, EEPGD=0 -> EEDATA = eeprom[EEADR], RD tự xoá.
        if ((value & 0x01) && !(value & 0x80)) {
          this.sfr.EEDATA = this.eeprom[this.sfr.EEADR & 0xff];
          this.sfr.EECON1 &= ~0x01;
        }
        // Ghi EEPROM dữ liệu: WR=1, WREN=1, EEPGD=0, đã mở khoá 0x55/0xAA.
        // Ghi mất ~4ms (4000 chu kỳ lệnh @4MHz): WR giữ 1 trong lúc ghi, xong
        // phần cứng tự xoá WR và đặt EEIF. Không mở khoá đúng -> không ghi.
        if ((value & 0x02) && (value & 0x04) && !(value & 0x80) && this.eeUnlock === 2) {
          this.eeWriteAddr = this.sfr.EEADR & 0xff;
          this.eeWriteData = this.sfr.EEDATA;
          this.eeWriteCountdown = 4000;
          this.eeUnlock = 0;
        }
        return;
      }
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

  // Cấu hình ngoại vi từ netlist breadboard (resolvePeripherals trong wiring.js).
  // Gọi sau mỗi lần đổi dây; reset/loadProgram không xoá wiring.
  setWiring(mapping) {
    this.wiring = mapping || null;
    const w = this.wiring && this.wiring.lcd;
    if (w && w.e) this.prevE = this.pinLevel(w.e.port, w.e.bit);
    else if (!w) this.prevE = (this.portLatch[4] >> 1) & 1;
    else this.prevE = 0;
  }

  // Xung E của LCD: phát hiện cạnh lên của E, chốt lệnh/dữ liệu theo RS.
  // Có wiring: RS/E/D0–D7 đọc từ chân PIC đã nối dây (bất kỳ PORT nào).
  // Không wiring: giữ hành vi cũ (data PORTD, RS=RE0, E=RE1).
  // Wiring LCD chưa đủ dây: không chốt gì (LCD hiện "chưa nối đủ dây" ở UI).
  lcdTick() {
    const w = this.wiring && this.wiring.lcd;
    let rs, e, data;
    if (w && w.complete) {
      const bit = (pin) => (pin ? this.pinLevel(pin.port, pin.bit) : 0);
      rs = bit(w.rs); e = bit(w.e);
      data = 0;
      for (let i = 0; i < 8; i++) data |= bit(w.d[i]) << i;
    } else if (w) {
      const bit = (pin) => (pin ? this.pinLevel(pin.port, pin.bit) : 0);
      this.prevE = bit(w.e); // đồng bộ để khỏi bắt cạnh giả khi nối lại dây
      return;
    } else {
      rs = this.portLatch[4] & 1;
      e = (this.portLatch[4] >> 1) & 1;
      data = this.portLatch[3];
    }
    if (this.prevE === 0 && e === 1) {
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

  // Nạp sẵn dữ liệu EEPROM (mảng byte, tối đa 256). Dùng cho test và cho
  // code cần dữ liệu có sẵn (thay cho directive DE chưa hỗ trợ).
  loadEeprom(bytes) {
    this.eeprom.fill(0);
    const arr = bytes || [];
    for (let i = 0; i < arr.length && i < 256; i++) this.eeprom[i] = arr[i] & 0xff;
  }

  // Bàn phím ma trận: phím đang nhấn (nhấn giữ) của 1 bàn phím, key =
  // {row, col} (0..3) hoặc null (không nhấn phím nào). Chỉ ghi lại phím
  // đang nhấn; mức cột tính ngay lúc CPU đọc (xem pinLevel) nên không
  // cần cập nhật portInput ở đây.
  setKeypadPressed(id, key) {
    if (!key) { this.keypadPressed.delete(id); return; }
    const r = Number(key.row), c = Number(key.col);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 3 || c < 0 || c > 3) return;
    this.keypadPressed.set(id, { row: r, col: c });
  }

  setAnalog(channel, volts) { this.analogVolts[channel & 7] = Math.max(0, Math.min(5, volts)); }

  receiveChar(code) {
    if (!(this.sfr.RCSTA & 0x80)) return; // SPEN=0: UART tắt
    this.sfr.RCREG = code & 0xff;
    this.rxReady = true;
  }

  // Có ngắt nào đang chờ mà đã được phép không (không xét GIE — dùng cho
  // cả đánh thức SLEEP lẫn quyết định nhảy ISR).
  anyEnabledInterrupt() {
    const intcon = this.sfr.INTCON;
    if ((intcon & 0x04) && (intcon & 0x20)) return true; // TMR0IF & TMR0IE
    if ((intcon & 0x02) && (intcon & 0x10)) return true; // INTF & INTE
    if ((intcon & 0x01) && (intcon & 0x08)) return true; // RBIF & RBIE
    if (intcon & 0x40) { // PEIE
      const pir1 = this.readSFR('PIR1'), pie1 = this.sfr.PIE1;
      if ((pir1 & 0x40) && (pie1 & 0x40)) return true; // ADIF & ADIE
      if ((pir1 & 0x20) && (pie1 & 0x20)) return true; // RCIF & RCIE
      if ((pir1 & 0x10) && (pie1 & 0x10)) return true; // TXIF & TXIE
      if ((pir1 & 0x01) && (pie1 & 0x01)) return true; // TMR1IF & TMR1IE
      if ((pir1 & 0x02) && (pie1 & 0x02)) return true; // TMR2IF & TMR2IE
      if ((pir1 & 0x04) && (pie1 & 0x04)) return true; // CCP1IF & CCP1IE
      if ((pir1 & 0x08) && (pie1 & 0x08)) return true; // SSPIF & SSPIE
      if ((pir1 & 0x80) && (pie1 & 0x80)) return true; // PSPIF & PSPIE
      const pir2 = this.sfr.PIR2, pie2 = this.sfr.PIE2;
      if ((pir2 & 0x01) && (pie2 & 0x01)) return true; // CCP2IF & CCP2IE
      if ((pir2 & 0x08) && (pie2 & 0x08)) return true; // BCLIF & BCLIE
      if ((pir2 & 0x10) && (pie2 & 0x10)) return true; // EEIF & EEIE
      if ((pir2 & 0x40) && (pie2 & 0x40)) return true; // CMIF & CMIE
    }
    return false;
  }

  interruptPending() {
    return (this.sfr.INTCON & 0x80) && this.anyEnabledInterrupt(); // GIE=1
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
    // TMR1: chạy khi TMR1ON (bit0) và clock nội (TMR1CS=0). TMR1CS=1 là clock
    // ngoài ở chân RC0/T1CKI — không có nguồn clock ngoài trong mô phỏng nên
    // timer đứng yên (trước đây chạy cả khi TMR1CS=1, sai datasheet).
    if ((this.sfr.T1CON & 1) && !((this.sfr.T1CON >> 1) & 1)) {
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
    // EEPROM: ghi đang chờ -> hết ~4ms thì chốt, WR=0, EEIF=1
    if (this.eeWriteCountdown > 0) {
      this.eeWriteCountdown--;
      if (this.eeWriteCountdown === 0) {
        this.eeprom[this.eeWriteAddr] = this.eeWriteData;
        this.sfr.EECON1 &= ~0x02; // WR=0
        this.sfr.PIR2 |= 0x10;    // EEIF=1
      }
    }
    // PWM (CCP1->RC2, CCP2->RC1): mode 1100, Timer2 đang chạy. Duty 10-bit =
    // CCPRxL:CCPxCON<5:4>, chu kỳ = 4*(PR2+1) đơn vị 1/4 TMR2. So sánh theo
    // TMR2*4 (bỏ qua pha 2-bit mịn — độ phân giải duty ~0.4%, đủ cho bài lab).
    // Timer2 tắt -> ra 0.
    if ((this.sfr.T2CON & 0x04) && (this.sfr.CCP1CON & 0x0f) === 0x0c) {
      const duty1 = (this.sfr.CCPR1L << 2) | ((this.sfr.CCP1CON >> 4) & 3);
      this.ccp1Pwm = (this.sfr.TMR2 * 4 < duty1) ? 1 : 0;
    } else this.ccp1Pwm = 0;
    if ((this.sfr.T2CON & 0x04) && (this.sfr.CCP2CON & 0x0f) === 0x0c) {
      const duty2 = (this.sfr.CCPR2L << 2) | ((this.sfr.CCP2CON >> 4) & 3);
      this.ccp2Pwm = (this.sfr.TMR2 * 4 < duty2) ? 1 : 0;
    } else this.ccp2Pwm = 0;
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
      // ADC với clock RC nội (ADCS=11) vẫn chạy trong SLEEP và có thể đánh thức
      // CPU khi xong (ADIF). Các clock Fosc/2/8/32 dừng theo Fosc nên ADC đứng.
      if (this.adcCountdown > 0 && ((this.sfr.ADCON0 >> 6) & 3) === 3) {
        this.adcCountdown--;
        if (this.adcCountdown === 0) this.finishAdc();
      }
      // SLEEP: dừng cho tới khi có ngắt được phép (kể cả ngắt ngoại vi khi
      // PEIE=1, và kể cả khi GIE=0 vẫn đánh thức — chỉ khác là GIE=0 thì
      // chạy tiếp lệnh sau SLEEP thay vì nhảy vào ISR).
      if (!this.anyEnabledInterrupt()) return { addr: this.pc, op: 0, skipped: false };
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

  // Chạy n lệnh (dùng cho test + vòng lặp UI). KHÔNG dừng khi CPU ngủ:
  // step() tự xử lý SLEEP (ADC clock RC vẫn chạy, kiểm tra đánh thức) nên
  // phải step tiếp thì CPU mới tỉnh lại được.
  run(n) { for (let i = 0; i < n; i++) { if (this.halted) break; this.step(); } }

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

// ---------------------------------------------------------------------------
// ProgramRunner: điều khiển chạy/tạm dừng/breakpoint cho chương trình đã nạp.
// Dùng cho tab "Nạp viết code": editor hợp ngữ (assemble) hoặc file .hex.
// Không phụ thuộc DOM: app.js gọi tick() theo nhịp 50ms, bench.js gọi các
// phương thức qua bridge. Breakpoint lưu theo SỐ DÒNG của editor; địa chỉ
// suy ra từ lineToAddr của lần dịch gần nhất. Chạy tới breakpoint thì dừng
// TRƯỚC khi thực thi lệnh ở đó; "Chạy tiếp" bước qua lệnh đó rồi mới kiểm
// tra breakpoint tiếp (kẻo dừng lại ngay cùng 1 lệnh).
// ---------------------------------------------------------------------------
export class ProgramRunner {
  constructor(cpu) {
    this.cpu = cpu;
    this.state = 'idle';        // 'idle' | 'running' | 'paused'
    this.pauseReason = null;    // 'breakpoint' | 'step' | 'user' | 'sleep'
    this.hasProgram = false;
    this.hexMode = false;
    this.lineToAddr = new Map();
    this.addrToLine = new Map();
    this.breakpointLines = new Set();
    this.justResumed = false;
  }

  get breakpointAddrs() {
    const out = new Set();
    for (const l of this.breakpointLines) {
      const a = this.lineToAddr.get(l);
      if (a !== undefined) out.add(a);
    }
    return out;
  }

  loadAsm(source) {
    const r = assemble(source);
    if (r.errors.length) return { ok: false, errors: r.errors };
    this.cpu.loadProgram(r.program);
    this.lineToAddr = r.lineToAddr;
    this.addrToLine = r.addrToLine;
    this.hexMode = false;
    this.hasProgram = true;
    this.state = 'idle';
    this.pauseReason = null;
    this.justResumed = false;
    // Bỏ breakpoint ở dòng không còn dịch ra lệnh sau khi dịch lại.
    this.breakpointLines = new Set([...this.breakpointLines].filter((l) => this.lineToAddr.has(l)));
    return { ok: true, lineToAddr: r.lineToAddr, addrToLine: r.addrToLine };
  }

  loadHex(text) {
    const r = parseIntelHex(text);
    if (r.errors.length) return { ok: false, errors: r.errors };
    this.cpu.loadProgram(r.program, r.config);
    this.lineToAddr = new Map();
    this.addrToLine = new Map();
    this.hexMode = true;
    this.hasProgram = true;
    this.state = 'idle';
    this.pauseReason = null;
    this.justResumed = false;
    this.breakpointLines.clear();
    return { ok: true, words: r.words };
  }

  // Chỉ giữ các dòng còn dịch ra lệnh (theo lần dịch gần nhất); trả về
  // danh sách dòng breakpoint còn hiệu lực, đã sắp xếp.
  setBreakpointLines(lines) {
    this.breakpointLines = new Set([...lines].filter((l) => this.lineToAddr.has(l)));
    return [...this.breakpointLines].sort((a, b) => a - b);
  }

  run() {
    if (!this.hasProgram) return { ok: false, error: 'Chưa nạp chương trình.' };
    if (this.cpu.sleeping) {
      this.cpu.step(); // kiểm tra đánh thức: ngắt đang chờ sẽ đánh thức CPU
      if (this.cpu.sleeping) return { ok: false, error: 'CPU đang SLEEP — không chạy được.' };
    }
    if (this.state === 'paused' && this.pauseReason === 'breakpoint') this.justResumed = true;
    this.state = 'running';
    this.pauseReason = null;
    return { ok: true };
  }

  pause() {
    if (this.state === 'running') { this.state = 'paused'; this.pauseReason = 'user'; }
    return this.getStatus();
  }

  stepOnce() {
    if (!this.hasProgram) return { ok: false, error: 'Chưa nạp chương trình.' };
    if (this.state === 'running') return { ok: false, error: 'Đang chạy — bấm Dừng trước.' };
    this.cpu.step();
    this.state = 'paused';
    this.pauseReason = 'step';
    return { ok: true, ...this.getStatus() };
  }

  // Step theo đợt nhỏ (ngân sách tính theo chu kỳ lệnh, như vòng chạy cũ):
  // kiểm tra PC trước mỗi lệnh, chạm breakpoint thì dừng.
  tick(budget = 50000) {
    if (this.state !== 'running') return this.getStatus();
    let b = budget;
    if (this.justResumed) {
      if (!this.cpu.sleeping && !this.cpu.halted) {
        const c0 = this.cpu.cycles; this.cpu.step(); b -= Math.max(1, this.cpu.cycles - c0);
      }
      this.justResumed = false;
    }
    const bps = this.breakpointAddrs;
    while (b > 0 && !this.cpu.sleeping && !this.cpu.halted) {
      if (bps.has(this.cpu.pc & 0x1fff)) {
        this.state = 'paused'; this.pauseReason = 'breakpoint';
        return this.getStatus();
      }
      const c0 = this.cpu.cycles; this.cpu.step(); b -= Math.max(1, this.cpu.cycles - c0);
    }
    if (this.cpu.sleeping) { this.state = 'paused'; this.pauseReason = 'sleep'; }
    return this.getStatus();
  }

  getStatus() {
    const pc = this.cpu.pc & 0x1fff;
    return {
      state: this.state,
      pauseReason: this.pauseReason,
      pc,
      line: this.addrToLine.get(pc) ?? null,
      hasProgram: this.hasProgram,
      hexMode: this.hexMode,
      sleeping: this.cpu.sleeping,
      breakpointLines: [...this.breakpointLines].sort((a, b) => a - b),
    };
  }
}

export function createCPU() { return new PIC16F877A(); }

// Đổi thời gian thực đã trôi qua (ms) ra số chu kỳ lệnh mô phỏng tương ứng.
// PIC chạy 4 chu kỳ dao động cho 1 chu kỳ lệnh, nên ở clockHz thì
// 1ms = clockHz/4000 chu kỳ lệnh (ở 4MHz là 1000 chu kỳ/ms).
// Chặn trên để tránh chạy bù vô hạn khi tab bị ẩn đi lâu rồi quay lại.
export function cyclesForElapsedMs(elapsedMs, clockHz = 4000000, maxCycles = 500000) {
  return Math.min(Math.max(0, Math.round((elapsedMs * clockHz) / 4000)), maxCycles);
}

// Tiện cho debug trong console trình duyệt (không ảnh hưởng Node test)
if (typeof globalThis !== 'undefined') {
  globalThis.PIC16 = { assemble, disassemble, parseIntelHex, exportHex, createCPU, PIC16F877A, ProgramRunner, LCD, REGISTERS };
}

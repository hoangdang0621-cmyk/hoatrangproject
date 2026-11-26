// c-codegen.js — CODEGEN cho trình biên dịch C (tập con XC8) của PIC16F877A.
//
// Nhận AST từ parseC() trong public/c-frontend.js, sinh HỢP NGỮ mà
// assemble() trong public/pic16.js ăn được. Subagent compileC sẽ nối:
//   parseC(source) -> generateC(ast, xtalFreq) -> assemble(asm)
//
// Cách dùng:
//   import { generateC } from './c-codegen.js';
//   const { asm, asmLineToCLine, errors } = generateC(ast, xtalFreq);
//   // errors = []  -> asm dùng được (assemble 0 lỗi), asmLineToCLine là
//   //                Map: số dòng HỢP NGỮ -> số dòng C gốc.
//   // errors != [] -> asm = '' (không sinh program sai), errors[i] =
//   //                {line, message} với line là dòng C gốc.
//
// ---------------------------------------------------------------------------
// KIẾN TRÚC (đọc kỹ trước khi sửa file này):
//
// Kiểu dữ liệu: int / unsigned int = 16-bit, little-endian (byte thấp ở địa
//   chỉ thấp, byte cao ở địa chỉ+1). char / unsigned char = 8-bit. Mọi phép
//   số học hai ngôi đều tính ở 16-bit (theo luật thăng cấp số nguyên của C:
//   char thăng lên int), rồi cắt theo nơi dùng; chỉ riêng '/', '%' và '>>'
//   là BẮT BUỘC tính đủ 16-bit kể cả khi nơi dùng chỉ cần 8-bit (vì byte
//   thấp của thương/số dư/dịch phải phụ thuộc byte cao của toán hạng).
//   So sánh có dấu (int/char) thì lật bit dấu của byte cao rồi so không dấu.
//   Toán tử && || ! và ?: ngắn mạch đúng ngữ nghĩa C (chỉ tính vế cần).
//
// Cấp phát (địa chỉ CỐ ĐỊNH, CBLOCK, không có stack phần mềm):
//   - Biến tạm cho biểu thức: pool __C_T0..__C_T47 ở bank 0 (0x20-0x4F),
//     cấp phát theo ngăn xếp lúc biên dịch biểu thức (allocTemp/freeTemp),
//     giải phóng ngay sau khi dùng xong. Mọi genExpr() trả về 1 biến tạm
//     đúng bằng độ rộng yêu cầu (want), bên gọi phải freeTemp() sau khi dùng.
//   - Slot trợ giúp runtime ở bank 0 (0x50-0x64): __C_MA/__C_MB/__C_MR/
//     __C_MC (nhân), __C_DA/__C_DB/__C_DQ/__C_DR/__C_DC (chia), __C_SH
//     (đếm dịch), __C_SG (cờ dấu cho chia có dấu), __C_D0/__C_D1/__C_D2
//     (đếm delay).
//   - Biến người dùng (toàn cục + cục bộ + tham số + trả về) bắt đầu ở
//     bank 1 (0xA0-0xEF), rồi bank 2 (0x110-0x16F), bank 3 (0x190-0x1EF).
//     Biến 16-bit và mảng KHÔNG BAO GIỜ cắt qua ranh giới bank (hết chỗ thì
//     nhảy sang bank sau). Hết RAM -> lỗi "tràn bộ nhớ RAM".
//   - Tham số hàm: slot __P_<tên hàm>_<i> (riêng từng hàm). Giá trị trả:
//     slot __R_<tên hàm> (+ W = byte thấp). Biến cục bộ: slot
//     __L_<tên hàm>_<số thứ tự khai báo> (mỗi khai báo 1 slot riêng, kể cả
//     khi trùng tên ở khối lồng nhau). Không đệ quy nên slot cố định là an
//     toàn; đệ quy bị phát hiện qua đồ thị gọi hàm và báo lỗi.
//
// Bank: codegen THEO DÕI bank hiện tại (curBank). Trước mỗi lần truy cập
//   file/SFR ở bank khác thì chèn BANKSEL <tên symbol> (assembler tự sinh
//   2 lệnh BCF/BSF STATUS,RP0/RP1) rồi cập nhật curBank. Chỉ chèn khi bank
//   đổi. QUY ƯỚC BANK SAU CALL: sau mỗi CALL và ở đầu mỗi hàm/nhãn nhảy,
//   bank được coi là KHÔNG BIẾT (curBank = -1) nên lần truy cập tiếp theo
//   luôn BANKSEL lại — an toàn tuyệt đối, chỉ tốn thêm vài lệnh. Các thanh
//   ghi ở mọi bank (STATUS, PCL, FSR, PCLATH, INTCON, INDF) và vùng RAM
//   chung 0x70-0x7F thì không cần BANKSEL.
//   NGUYÊN TẮC AN TOÀN VỚI LỆNH NHẢY CÓ ĐIỀU KIỆN: không bao giờ để BANKSEL
//   (2 từ lệnh) đứng ngay sau 1 lệnh skip (BTFSC/BTFSS/DECFSZ/INCFSZ) —
//   lệnh skip chỉ bỏ qua ĐÚNG 1 từ lệnh, sẽ bỏ qua nửa đầu của BANKSEL và
//   làm lệch RP0/RP1. Vì vậy mọi ensureBank() đều được gọi TRƯỚC khi phát
//   lệnh skip, hoặc sau 1 nhãn/GOTO. Các vòng lặp delay và hàm trợ giúp
//   dùng nhãn keepBank (không reset curBank) vì chu kỳ của chúng được tính
//   chính xác và mọi slot đều ở bank 0.
//
// Hàm: ghi tham số vào slot __P_..., CALL nhãn __C_FN_<tên>, lấy giá trị
//   trả từ slot __R_... Hàm kết thúc bằng RETURN (nhãn __C_FN_<tên>_RET).
//   Chương trình: ORG 0; GOTO __C_START; __C_START khởi tạo biến toàn cục
//   rồi CALL __C_FN_MAIN; sau main là __C_HALT: GOTO __C_HALT để CPU
//   không chạy lạc. Không dùng ngắt nên vector 0x04 không cần.
//
// Nhân/chia/modulo 16-bit: PIC không có lệnh nhân/chia nên dùng hàm trợ
//   giúp __C_MUL16 (cộng-dịch 16 vòng) và __C_DIV16 (trừ-dịch không dấu
//   16 vòng, chia cho 0 trả thương 0, dư = số bị chia). Chia có dấu thì
//   lấy trị tuyệt đối, chia không dấu, rồi đổi dấu kết quả theo quy tắc C
//   (thương âm khi 2 dấu khác nhau, số dư cùng dấu với số bị chia).
//
// __delay_ms/__delay_us: CHỈ nhận hằng số. Vòng lặp đếm 16-bit (D1:D0) +
//   vòng ngoài (D2), công thức chu kỳ CHÍNH XÁC (đếm từng lệnh, xem
//   emitDelay): tổng = R*(3*lo + 776*hi + 11) + 2 chu kỳ lệnh, với R là
//   số lần lặp ngoài, hi/lo là 2 byte của bộ đếm trong. Ở 4MHz, 1 chu kỳ
//   lệnh = 1us nên __delay_ms(m) cần m*1000 chu kỳ. Sai số sau khi giải
//   (R,hi,lo) tối ưu thường < 5 chu kỳ (< 0,01% với delay ms). LƯU Ý:
//   hệ số 776 (không phải 774) là vì lệnh skip (DECFSZ/BTFSC) trong
//   simulator này tốn 3 chu kỳ khi lệnh bị skip là GOTO 2 chu kỳ.
//   ĐO DELAY PHẢI ĐO BẰNG cpu.cycles (hiệu 2 cạnh), KHÔNG đếm số lần
//   step(): GOTO/CALL tốn 2 chu kỳ nhưng chỉ 1 step nên đếm step ra
//   ~2/3 số chu kỳ thật (vd __delay_ms(250)@20MHz: 831207 step nhưng
//   1250020 chu kỳ — đã từng nhầm là delay ngắn 1,5 lần).
//
// Giới hạn (xem thêm ở cuối báo cáo codegen):
//   - Con trỏ 1 cấp ĐÃ hỗ trợ: biến/tham số/trả về kiểu con trỏ, *p, &x,
//     p[i], p+n, p-n, p-q, p++/p--, p+=n, so sánh con trỏ, mảng decay
//     thành con trỏ khi truyền vào hàm. CHƯA hỗ trợ: con trỏ nhiều cấp
//     (**p), p->x, (*p).x, mảng con trỏ (char *a[3]).
//   - Con trỏ trỏ vào thanh ghi SFR (vd &PORTB) thì *p KHÔNG chạy được:
//     readIndirect/writeIndirect trong pic16.js trả 0 / bỏ qua ghi khi
//     địa chỉ < 0x20 (vùng SFR). Con trỏ chỉ dùng được với RAM (GPR).
//   - CHƯA hỗ trợ số thực (frontend đã chặn), struct/enum/typedef.
//   - Đệ quy (trực tiếp/gián tiếp): báo lỗi, không sinh code.
//   - Program < 2048 từ lệnh (CALL/GOTO 11-bit, PCLATH luôn 0).
//   - Tên biến/hàm của người dùng không được trùng nhau khi bỏ hoa/thường
//     (assembler không phân biệt hoa/thường) và không được trùng tên hệ
//     thống (thanh ghi, lệnh, __C_*).
// ---------------------------------------------------------------------------

import { REGISTERS } from './pic16.js?v=20261125aq';

// Số bit của tên bit (sao chép từ BIT_NAMES trong pic16.js — bảng đó không
// export nên codegen giữ 1 bản riêng; chỉ dùng để tra số bit, không ảnh
// hưởng hành vi CPU).
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

// --- Vùng nhớ cố định -------------------------------------------------------
const TEMP_BASE = 0x20;        // pool biến tạm __C_T0..__C_T47 (bank 0)
const TEMP_POOL_SIZE = 48;     // 0x20-0x4F
const USER_BANKS = [           // bank GPR cho biến người dùng
  [0xA0, 0xF0],                // bank 1: 0xA0-0xEF
  [0x110, 0x170],              // bank 2: 0x110-0x16F
  [0x190, 0x1F0],              // bank 3: 0x190-0x1EF
];

// Slot trợ giúp runtime (bank 0, sau pool tạm): tên -> {addr, size}
const HELPER_SLOTS = [
  ['__C_MA', 0x50, 2], ['__C_MB', 0x52, 2], ['__C_MR', 0x54, 2], ['__C_MC', 0x56, 1],
  ['__C_DA', 0x57, 2], ['__C_DB', 0x59, 2], ['__C_DQ', 0x5B, 2], ['__C_DR', 0x5D, 2], ['__C_DC', 0x5F, 1],
  ['__C_SH', 0x60, 1], ['__C_SG', 0x61, 1],
  ['__C_D0', 0x62, 1], ['__C_D1', 0x63, 1], ['__C_D2', 0x64, 1],
];
const HELPER = {};
for (const [name, addr, size] of HELPER_SLOTS) HELPER[name] = { name, addr, size };

// Thanh ghi có ở mọi bank (không cần BANKSEL) + RAM chung 0x70-0x7F.
const COMMON_ADDRS = new Set([0x00, 0x02, 0x03, 0x04, 0x0a, 0x0b]);

// Tên bit -> thanh ghi chứa nó (dùng cho ident bit kiểu GIE, ADON... và
// cho member dạng INTCONbits.GIE). RA0..RE2 và TRISxN xử lý bằng mẫu riêng.
const BIT_REG = {};
{
  const groups = {
    STATUS: ['C', 'DC', 'Z', 'PD', 'TO', 'RP0', 'RP1', 'IRP'],
    INTCON: ['RBIF', 'INTF', 'TMR0IF', 'RBIE', 'INTE', 'TMR0IE', 'PEIE', 'GIE'],
    OPTION_REG: ['PS0', 'PS1', 'PS2', 'PSA', 'T0SE', 'T0CS', 'INTEDG', 'RBPU'],
    ADCON0: ['ADON', 'GO', 'GO_DONE', 'DONE', 'NOT_DONE', 'CHS0', 'CHS1', 'CHS2', 'ADCS0', 'ADCS1'],
    PIR1: ['ADIF', 'RCIF', 'TXIF', 'TMR1IF', 'TMR2IF', 'CCP1IF', 'SSPIF', 'PSPIF'],
    PIE1: ['TMR1IE', 'TMR2IE', 'CCP1IE', 'SSPIE', 'TXIE', 'RCIE', 'ADIE', 'PSPIE'],
    PIR2: ['CCP2IF', 'BCLIF', 'EEIF', 'CMIF'],
    PIE2: ['CCP2IE', 'BCLIE', 'EEIE', 'CMIE'],
    TXSTA: ['TX9', 'TXEN', 'SYNC', 'BRGH', 'TRMT', 'TX9D', 'CSRC'],
    RCSTA: ['SPEN', 'RX9', 'SREN', 'CREN', 'ADDEN', 'FERR', 'OERR', 'RX9D'],
    T1CON: ['TMR1ON', 'TMR1CS', 'T1SYNC', 'NOT_T1SYNC', 'T1OSCEN', 'T1CKPS0', 'T1CKPS1'],
    T2CON: ['T2CKPS0', 'T2CKPS1', 'TMR2ON', 'TOUTPS0', 'TOUTPS1', 'TOUTPS2', 'TOUTPS3'],
    SSPCON: ['SSPM0', 'SSPM1', 'SSPM2', 'SSPM3', 'CKP', 'SSPEN', 'SSPOV', 'WCOL'],
    SSPSTAT: ['BF', 'UA', 'R_NW', 'D_NA', 'CKE', 'SMP'],
    CCP1CON: ['CCP1M0', 'CCP1M1', 'CCP1M2', 'CCP1M3', 'CCP1Y', 'CCP1X'],
    CCP2CON: ['CCP2M0', 'CCP2M1', 'CCP2M2', 'CCP2M3', 'CCP2Y', 'CCP2X'],
    ADCON1: ['ADFM', 'PCFG0', 'PCFG1', 'PCFG2', 'PCFG3'],
    TRISE: ['PSPMODE', 'IBOV', 'OBF', 'IBF'],
    PCON: ['NOT_BOR', 'NOT_POR'],
    EECON1: ['RD', 'WR', 'WREN', 'WRERR', 'EEPGD'],
    CMCON: ['CM0', 'CM1', 'CM2', 'CIS', 'C1INV', 'C2INV', 'C1OUT', 'C2OUT'],
    CVRCON: ['CVR0', 'CVR1', 'CVR2', 'CVR3', 'CVRSS', 'CVRR', 'CVROE', 'CVREN'],
    SSPCON2: ['SEN', 'RSEN', 'PEN', 'RCEN', 'ACKEN', 'ACKDT', 'ACKSTAT', 'GCEN'],
  };
  for (const [reg, bits] of Object.entries(groups)) {
    for (const b of bits) BIT_REG[b] = reg;
  }
}

const MNEMONIC_WORDS = new Set([
  'MOVLW', 'MOVWF', 'MOVF', 'CLRF', 'CLRW', 'ADDWF', 'ADDLW', 'SUBWF', 'SUBLW',
  'ANDWF', 'ANDLW', 'IORWF', 'IORLW', 'XORWF', 'XORLW', 'INCF', 'DECFSZ', 'INCFSZ',
  'DECF', 'COMF', 'RLF', 'RRF', 'SWAPF', 'BSF', 'BCF', 'BTFSS', 'BTFSC', 'CALL',
  'GOTO', 'RETURN', 'RETLW', 'NOP', 'SLEEP', 'CLRWDT', 'RETFIE',
  'ORG', 'END', 'CBLOCK', 'ENDC', 'EQU', 'BANKSEL', 'PAGESEL', 'LIST', 'INCLUDE',
  'CONFIG', 'RADIX', 'RES', 'FILL', 'DB', 'DW', 'DT', 'DA', 'DATA', 'DE', 'IF',
  'WHILE', 'MACRO', 'ENDM', 'ENDIF', 'ENDW', 'ELSE', 'ERROR', 'SET', 'PROCESSOR',
  'ERRORLEVEL', 'TITLE', 'PAGE', 'SUBTITLE', 'MESSG', 'EXPAND', 'NOEXPAND',
  'NOLIST', 'VARIABLE', 'CONSTANT', 'HIGH', 'LOW',
  // Lưu ý: 'W' và 'F' (đích W/F của lệnh byte) KHÔNG cấm — chúng là tên
  // biến/hàm 1 chữ cái hợp lệ trong C, assembler chỉ tra chúng ở vị trí
  // toán hạng file qua bảng symbol nên không nhầm được.
]);

// Kiểu C -> độ rộng (byte) / có dấu không. 'void' không có độ rộng.
function typeWidth(t) { return (t === 'char' || t === 'uchar') ? 1 : 2; }
function typeSigned(t) { return !(t === 'uchar' || t === 'uint'); }
function hex2(v) { return '0x' + (v & 0xff).toString(16).toUpperCase().padStart(2, '0'); }

// Giải tên bit: 'RB0' -> {reg:'PORTB', bit:0}, 'TRISB0' -> {reg:'TRISB'},
// 'GIE' -> {reg:'INTCON', bit:7}. Trả null nếu không phải tên bit.
function resolveBitName(name) {
  let m = /^R([A-E])([0-7])$/.exec(name);
  if (m) return { reg: 'PORT' + m[1], bit: Number(m[2]) };
  m = /^TRIS([A-E])([0-7])$/.exec(name);
  if (m) return { reg: 'TRIS' + m[1], bit: Number(m[2]) };
  if (name in BIT_NAMES && name in BIT_REG) {
    return { reg: BIT_REG[name], bit: BIT_NAMES[name] };
  }
  return null;
}

// Giải member Xbits.Y: baseName 'PORTBbits' -> thanh ghi PORTB, field 'RB0'
// -> bit 0 (tra cứu BIT_NAMES trước, rồi lấy số cuối tên field).
function resolveMember(baseName, field) {
  const base = baseName.replace(/bits$/i, '').toUpperCase();
  if (!(base in REGISTERS)) return { error: `không hiểu thanh ghi ${baseName}` };
  let bit = null;
  if (field in BIT_NAMES) bit = BIT_NAMES[field];
  else {
    const m = /(\d+)$/.exec(field);
    if (m) bit = Number(m[1]);
  }
  if (bit === null || bit < 0 || bit > 7) return { error: `không hiểu bit ${field}` };
  return { reg: base, regAddr: REGISTERS[base], bit };
}

// Tính giá trị biểu thức hằng (cho __delay_ms/us và kiểm tra hằng số).
// Trả số nguyên, hoặc null nếu không phải hằng số.
function evalConst(node) {
  if (!node) return null;
  switch (node.kind) {
    case 'num': return Math.trunc(node.value);
    case 'unary': {
      const v = evalConst(node.expr);
      if (v === null) return null;
      switch (node.op) {
        case '-': return -v;
        case '+': return v;
        case '!': return v ? 0 : 1;
        case '~': return ~v;
        default: return null;
      }
    }
    case 'binary': {
      const a = evalConst(node.left);
      const b = evalConst(node.right);
      if (a === null || b === null) return null;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : Math.trunc(a / b);
        case '%': return b === 0 ? null : a % b;
        case '<<': return a << b;
        case '>>': return a >> b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        case '&&': return (a && b) ? 1 : 0;
        case '||': return (a || b) ? 1 : 0;
        default: return null;
      }
    }
    default: return null;
  }
}

export function generateC(ast, xtalFreq = 4000000) {
  if (!ast || ast.kind !== 'program' || !Array.isArray(ast.decls)) {
    return { asm: '', asmLineToCLine: new Map(), errors: [{ line: 1, message: 'chương trình C không hợp lệ' }] };
  }
  const freq = Number(xtalFreq);
  const g = new Codegen(ast, Number.isFinite(freq) && freq > 0 ? Math.trunc(freq) : 4000000);
  return g.run();
}

class Codegen {
  constructor(ast, xtalFreq) {
    this.ast = ast;
    this.xtalFreq = xtalFreq;
    this.errors = [];
    this.errSeen = new Set();
    this.out = [];              // [{text, line}] — phần code (sau CBLOCK)
    this.allocs = [];           // [{name, addr, size}] — mọi symbol CBLOCK
    this.addrToSym = new Map(); // addr -> tên symbol đầu tiên ở đó
    this.labelN = 0;
    this.tempTop = 0;           // byte đã dùng trong pool tạm (0..48)
    this.curBank = -1;          // bank hiện tại: 0..3, -1 = không biết
    this.curFunc = null;        // func info đang sinh code
    this.scopes = [];           // ngăn xếp Map tên biến -> varInfo
    this.loopStack = [];        // [{breakLabel, continueLabel}]
    this.funcs = new Map();     // tên hàm -> func info
    this.globals = [];          // [{decl, info}]
    this.usedMul = false;
    this.usedDiv = false;
    this.allocBankIdx = 0;      // con trỏ cấp phát biến người dùng
    this.allocAddr = USER_BANKS[0][0];
  }

  err(line, message) {
    const key = `${line}|${message}`;
    if (this.errSeen.has(key)) return;
    this.errSeen.add(key);
    this.errors.push({ line: line || 1, message });
  }

  run() {
    this.prepass();
    if (this.errors.length) return { asm: '', asmLineToCLine: new Map(), errors: this.errors };
    this.emitCode();
    if (this.errors.length) return { asm: '', asmLineToCLine: new Map(), errors: this.errors };
    return { asm: this.buildAsm(), asmLineToCLine: this.buildMap(), errors: [] };
  }

  // =========================================================================
  // TIỀN XỬ LÝ: thu thập hàm, kiểm tra tên/đệ quy/con trỏ, cấp phát slot
  // =========================================================================
  prepass() {
    // Slot cố định: pool tạm + trợ giúp runtime (bank 0).
    for (let i = 0; i < TEMP_POOL_SIZE; i++) {
      this.allocs.push({ name: `__C_T${i}`, addr: TEMP_BASE + i, size: 1 });
      if (!this.addrToSym.has(TEMP_BASE + i)) this.addrToSym.set(TEMP_BASE + i, `__C_T${i}`);
    }
    for (const [name, addr, size] of HELPER_SLOTS) {
      this.allocs.push({ name, addr, size });
      if (!this.addrToSym.has(addr)) this.addrToSym.set(addr, name);
    }

    // Thu thập hàm (bỏ prototype body=null) + biến toàn cục.
    const seenNames = new Map(); // tên thường -> {kind, line} (không phân biệt hoa/thường)
    const claimName = (name, kind, line) => {
      const up = name.toUpperCase();
      if (up.startsWith('__C_')) { this.err(line, `tên ${name} trùng với tên hệ thống`); return; }
      if (up in REGISTERS || up in BIT_NAMES || MNEMONIC_WORDS.has(up) || name.toLowerCase().endsWith('bits')) {
        this.err(line, `tên ${name} trùng với tên hệ thống`);
        return;
      }
      const prev = seenNames.get(up);
      if (prev) this.err(line, `tên ${name} trùng với tên ${prev.kind} ${prev.name} (không phân biệt hoa/thường)`);
      else seenNames.set(up, { kind, name });
    };
    const funcDefs = [];
    for (const d of this.ast.decls) {
      if (d.kind === 'func') {
        if (d.body) {
          claimName(d.name, 'hàm', d.line);
          if (d.pointer && d.pointer > 1) this.err(d.line, 'chưa hỗ trợ con trỏ nhiều cấp');
          funcDefs.push(d);
        }
      } else if (d.kind === 'vardecl') {
        claimName(d.name, 'biến', d.line);
      }
    }
    for (const fn of funcDefs) {
      const retWidth = fn.pointer ? 2 : fn.returnType === 'void' ? 0 : typeWidth(fn.returnType);
      const info = {
        def: fn, name: fn.name, returnType: fn.returnType,
        retWidth, retSigned: fn.pointer ? false : typeSigned(fn.returnType),
        retIsPointer: !!fn.pointer,
        retElemWidth: fn.pointer ? typeWidth(fn.returnType) : 1,
        retElemSigned: fn.pointer ? typeSigned(fn.returnType) : false,
        label: `__C_FN_${fn.name}`, retLabel: `__C_FN_${fn.name}_RET`,
        retSym: null, retAddr: null, params: [], localCount: 0,
      };
      this.funcs.set(fn.name, info);
      fn.params.forEach((p, i) => {
        // Tên tham số KHÔNG kiểm tra trùng toàn cục: tham số sống trong
        // phạm vi hàm, che tên toàn cục là hợp lệ; slot __P_<hàm>_<i> cũng
        // riêng từng hàm nên không đụng nhau.
        if (p.pointer && p.pointer > 1) this.err(fn.line, 'chưa hỗ trợ con trỏ nhiều cấp');
        const w = p.pointer ? 2 : typeWidth(p.type);
        const slot = this.allocNamed(`__P_${fn.name}_${i}`, w, fn.line);
        info.params.push({ name: p.name, type: p.type, width: w, signed: p.pointer ? false : typeSigned(p.type), addr: slot ? slot.addr : 0, sym: slot ? slot.name : '', isPointer: !!p.pointer, elemWidth: typeWidth(p.type), elemSigned: typeSigned(p.type) });
      });
      if (retWidth > 0) {
        const slot = this.allocNamed(`__R_${fn.name}`, retWidth, fn.line);
        info.retSym = slot ? slot.name : '';
        info.retAddr = slot ? slot.addr : 0;
      }
    }

    // Biến toàn cục.
    for (const d of this.ast.decls) {
      if (d.kind !== 'vardecl') continue;
      const info = this.allocVarDecl(d);
      if (info) this.globals.push({ decl: d, info });
    }
    // Biến cục bộ từng hàm (đi bộ toàn bộ thân hàm, mỗi khai báo 1 slot).
    for (const fn of funcDefs) {
      const info = this.funcs.get(fn.name);
      this.walkStmtForAlloc(fn.body, info);
    }

    // Đồ thị gọi hàm -> phát hiện đệ quy (trực tiếp/gián tiếp).
    this.checkRecursion(funcDefs);
    // case trùng giá trị trong mỗi switch.
    for (const fn of funcDefs) this.walkStmtForSwitch(fn.body);
  }

  // Cấp phát địa chỉ cho 1 VarDecl. Trả varInfo, gắn lên node._info.
  // Trả null khi lỗi (đã ghi errors).
  allocVarDecl(d) {
    if (d.pointer && d.pointer > 1) { this.err(d.line, 'chưa hỗ trợ con trỏ nhiều cấp'); return null; }
    if (d.pointer && d.isArray) { this.err(d.line, 'chưa hỗ trợ mảng con trỏ'); return null; }
    const width = d.pointer ? 2 : typeWidth(d.type);
    const signed = d.pointer ? false : typeSigned(d.type);
    let count = 1;
    let elemWidth = typeWidth(d.type);
    if (d.isArray) {
      if (d.arraySize !== null && d.arraySize !== undefined) {
        count = d.arraySize;
      } else if (d.init && d.init.kind === 'str') {
        count = d.init.value.length + 1; // +1 cho '\0'
      } else if (Array.isArray(d.init)) {
        count = d.init.length;
      } else {
        this.err(d.line, `mảng ${d.name} chưa rõ kích thước`);
        return null;
      }
      if (count <= 0) { this.err(d.line, `mảng ${d.name} chưa rõ kích thước`); return null; }
      if (Array.isArray(d.init) && d.init.length > count) {
        this.err(d.line, `quá nhiều phần tử khởi tạo cho mảng ${d.name}`);
        return null;
      }
      if (d.init && d.init.kind === 'str' && d.arraySize !== null && d.arraySize !== undefined
        && d.init.value.length + 1 > d.arraySize) {
        this.err(d.line, `chuỗi khởi tạo dài hơn mảng ${d.name}`);
        return null;
      }
    } else if (d.init && d.init.kind === 'str') {
      this.err(d.line, 'chuỗi chỉ dùng để khởi tạo mảng char');
      return null;
    }
    const total = d.isArray ? elemWidth * count : width;
    const slot = this.allocNamed(d.name, total, d.line);
    if (!slot) return null;
    const info = {
      name: d.name, addr: slot.addr, sym: slot.name,
      width: d.isArray ? elemWidth * count : width,
      signed, isArray: !!d.isArray, elemWidth, elemSigned: typeSigned(d.type), count,
      isPointer: !!d.pointer,
    };
    d._info = info;
    return info;
  }

  // Cấp phát n byte cho biến người dùng (không cắt qua ranh giới bank).
  allocNamed(name, n, line) {
    let addr = -1;
    while (this.allocBankIdx < USER_BANKS.length) {
      const [start, end] = USER_BANKS[this.allocBankIdx];
      if (this.allocAddr < start) this.allocAddr = start;
      if (this.allocAddr + n <= end) {
        addr = this.allocAddr;
        this.allocAddr += n;
        break;
      }
      this.allocBankIdx++;
      if (this.allocBankIdx < USER_BANKS.length) this.allocAddr = USER_BANKS[this.allocBankIdx][0];
    }
    if (addr < 0) {
      this.err(line || 1, 'tràn bộ nhớ RAM (hết thanh ghi file)');
      return null;
    }
    this.allocs.push({ name, addr, size: n });
    if (!this.addrToSym.has(addr)) this.addrToSym.set(addr, name);
    return { name, addr };
  }

  // Đi bộ câu lệnh để cấp phát biến cục bộ (mỗi khai báo 1 slot riêng).
  walkStmtForAlloc(stmt, fnInfo) {
    if (!stmt) return;
    if (Array.isArray(stmt)) { for (const s of stmt) this.walkStmtForAlloc(s, fnInfo); return; }
    switch (stmt.kind) {
      case 'vardecl': {
        // Tính đúng độ rộng TRƯỚC khi cấp slot: con trỏ chiếm 2 byte
        // (địa chỉ 16-bit), không phải typeWidth của kiểu gốc.
        if (stmt.pointer && stmt.pointer > 1) this.err(stmt.line, 'chưa hỗ trợ con trỏ nhiều cấp');
        if (stmt.pointer && stmt.isArray) this.err(stmt.line, 'chưa hỗ trợ mảng con trỏ');
        const baseWidth = typeWidth(stmt.type);
        const allocWidth = stmt.pointer ? 2
          : stmt.isArray ? baseWidth * this.arrayCountOf(stmt) : baseWidth;
        const slot = this.allocNamed(`__L_${fnInfo.name}_${fnInfo.localCount++}`, allocWidth, stmt.line);
        if (slot) {
          stmt._info = {
            name: stmt.name, addr: slot.addr, sym: slot.name,
            width: allocWidth,
            signed: stmt.pointer ? false : typeSigned(stmt.type), isArray: !!stmt.isArray,
            elemWidth: baseWidth, elemSigned: typeSigned(stmt.type),
            count: stmt.isArray ? this.arrayCountOf(stmt) : 1,
            isPointer: !!stmt.pointer,
          };
        } else {
          // allocVarDecl đã báo lỗi tràn RAM; vẫn gắn info giả để khỏi crash
          stmt._info = { name: stmt.name, addr: 0, sym: '__C_T0', width: baseWidth, signed: typeSigned(stmt.type), isArray: !!stmt.isArray, elemWidth: baseWidth, elemSigned: typeSigned(stmt.type), count: 1, isPointer: !!stmt.pointer };
        }
        // Kiểm tra chuỗi / kích thước mảng như biến toàn cục.
        if (!stmt.isArray && stmt.init && stmt.init.kind === 'str') this.err(stmt.line, 'chuỗi chỉ dùng để khởi tạo mảng char');
        if (stmt.isArray && stmt.arraySize === null && !(stmt.init && (stmt.init.kind === 'str' || Array.isArray(stmt.init)))) {
          this.err(stmt.line, `mảng ${stmt.name} chưa rõ kích thước`);
        }
        if (stmt.isArray && Array.isArray(stmt.init) && stmt.arraySize !== null && stmt.init.length > stmt.arraySize) {
          this.err(stmt.line, `quá nhiều phần tử khởi tạo cho mảng ${stmt.name}`);
        }
        break;
      }
      case 'block':
        for (const s of stmt.stmts) this.walkStmtForAlloc(s, fnInfo);
        break;
      case 'if':
        this.walkStmtForAlloc(stmt.then, fnInfo);
        if (stmt.else) this.walkStmtForAlloc(stmt.else, fnInfo);
        break;
      case 'while': case 'dowhile':
        this.walkStmtForAlloc(stmt.body, fnInfo);
        break;
      case 'for':
        if (stmt.init) this.walkStmtForAlloc(stmt.init, fnInfo);
        this.walkStmtForAlloc(stmt.body, fnInfo);
        break;
      case 'switch':
        for (const c of stmt.cases) for (const s of c.stmts) this.walkStmtForAlloc(s, fnInfo);
        if (stmt.defaultStmts) for (const s of stmt.defaultStmts) this.walkStmtForAlloc(s, fnInfo);
        break;
      default:
        break;
    }
  }

  arrayCountOf(d) {
    if (d.arraySize !== null && d.arraySize !== undefined) return d.arraySize;
    if (d.init && d.init.kind === 'str') return d.init.value.length + 1;
    if (Array.isArray(d.init)) return d.init.length;
    return 1;
  }

  // Thu thập tên hàm được gọi trong 1 biểu thức (kèm dòng + hàm chứa).
  collectCallsExpr(node, out) {
    if (!node) return;
    if (Array.isArray(node)) { for (const e of node) this.collectCallsExpr(e, out); return; }
    switch (node.kind) {
      case 'call': out.push({ name: node.name, line: node.line }); for (const a of node.args) this.collectCallsExpr(a, out); break;
      case 'binary': this.collectCallsExpr(node.left, out); this.collectCallsExpr(node.right, out); break;
      case 'unary': this.collectCallsExpr(node.expr, out); break;
      case 'assign': this.collectCallsExpr(node.target, out); this.collectCallsExpr(node.value, out); break;
      case 'index': this.collectCallsExpr(node.base, out); this.collectCallsExpr(node.index, out); break;
      case 'ternary': this.collectCallsExpr(node.cond, out); this.collectCallsExpr(node.then, out); this.collectCallsExpr(node.else, out); break;
      default: break;
    }
  }

  collectCallsStmt(stmt, out) {
    if (!stmt) return;
    if (Array.isArray(stmt)) { for (const s of stmt) this.collectCallsStmt(s, out); return; }
    switch (stmt.kind) {
      case 'vardecl': if (stmt.init) this.collectCallsExpr(stmt.init, out); break;
      case 'expr': if (stmt.expr) this.collectCallsExpr(stmt.expr, out); break;
      case 'if': this.collectCallsExpr(stmt.cond, out); this.collectCallsStmt(stmt.then, out); if (stmt.else) this.collectCallsStmt(stmt.else, out); break;
      case 'while': case 'dowhile': this.collectCallsExpr(stmt.cond, out); this.collectCallsStmt(stmt.body, out); break;
      case 'for':
        if (stmt.init) this.collectCallsStmt(stmt.init, out);
        if (stmt.cond) this.collectCallsExpr(stmt.cond, out);
        if (stmt.incr) this.collectCallsExpr(stmt.incr, out);
        this.collectCallsStmt(stmt.body, out);
        break;
      case 'switch':
        this.collectCallsExpr(stmt.expr, out);
        for (const c of stmt.cases) for (const s of c.stmts) this.collectCallsStmt(s, out);
        if (stmt.defaultStmts) for (const s of stmt.defaultStmts) this.collectCallsStmt(s, out);
        break;
      case 'return': if (stmt.expr) this.collectCallsExpr(stmt.expr, out); break;
      case 'block': for (const s of stmt.stmts) this.collectCallsStmt(s, out); break;
      default: break;
    }
  }

  checkRecursion(funcDefs) {
    const graph = new Map(); // tên hàm -> Set tên hàm được gọi
    const callSites = [];    // {caller, callee, line}
    for (const fn of funcDefs) {
      const sites = [];
      this.collectCallsStmt(fn.body, sites);
      const callees = new Set();
      for (const s of sites) {
        if (s.name === '__delay_ms' || s.name === '__delay_us') continue;
        callees.add(s.name);
        callSites.push({ caller: fn.name, callee: s.name, line: s.line });
      }
      graph.set(fn.name, callees);
    }
    // callee có với tới caller không (DFS)?
    const reaches = (from, target, seen = new Set()) => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      const next = graph.get(from);
      if (!next) return false;
      for (const n of next) if (reaches(n, target, seen)) return true;
      return false;
    };
    for (const s of callSites) {
      if (!this.funcs.has(s.callee)) continue; // hàm lạ: frontend đã báo
      if (reaches(s.callee, s.caller)) {
        this.err(s.line, 'gọi hàm đệ quy (chưa hỗ trợ)');
      }
    }
  }

  walkStmtForSwitch(stmt) {
    if (!stmt) return;
    if (Array.isArray(stmt)) { for (const s of stmt) this.walkStmtForSwitch(s); return; }
    switch (stmt.kind) {
      case 'switch': {
        const seen = new Set();
        for (const c of stmt.cases) {
          if (seen.has(c.value)) this.err(stmt.line, `giá trị case ${c.value} bị trùng`);
          seen.add(c.value);
          for (const s of c.stmts) this.walkStmtForSwitch(s);
        }
        if (stmt.defaultStmts) for (const s of stmt.defaultStmts) this.walkStmtForSwitch(s);
        break;
      }
      case 'block': for (const s of stmt.stmts) this.walkStmtForSwitch(s); break;
      case 'if': this.walkStmtForSwitch(stmt.then); if (stmt.else) this.walkStmtForSwitch(stmt.else); break;
      case 'while': case 'dowhile': this.walkStmtForSwitch(stmt.body); break;
      case 'for': if (stmt.init) this.walkStmtForSwitch(stmt.init); this.walkStmtForSwitch(stmt.body); break;
      default: break;
    }
  }

  // =========================================================================
  // PHÁT LỆNH + THEO DÕI BANK + BIẾN TẠM
  // =========================================================================
  emit(text, line = null) { this.out.push({ text, line: line || null }); }
  newLabel() { return `__C_L${++this.labelN}`; }

  // Phát nhãn. Mọi nhãn nhảy đều reset bank về "không biết", TRỪ nhãn
  // keepBank (vòng lặp delay / hàm trợ giúp — mọi slot đều ở bank 0 và
  // chu kỳ đã tính chính xác, không được chèn BANKSEL giữa chừng).
  emitLabel(name, line = null, keepBank = false) {
    this.emit(`${name}:`, line);
    if (!keepBank) this.curBank = -1;
  }

  bankOf(addr) {
    if (COMMON_ADDRS.has(addr & 0x7f) && addr < 0x20) return -1;
    if (addr >= 0x70 && addr <= 0x7f) return -1; // RAM chung
    return (addr >> 7) & 3;
  }

  // Đảm bảo bank hiện tại đúng cho địa chỉ addr. symName là tên symbol
  // (CBLOCK / thanh ghi) để BANKSEL tra được. Không chèn gì nếu đã đúng bank.
  // CHỈ gọi khi vị trí hiện tại KHÔNG nằm ngay sau 1 lệnh skip.
  ensureBank(addr, symName, line = null) {
    const b = this.bankOf(addr);
    if (b < 0 || this.curBank === b) return;
    const sym = symName || this.addrToSym.get(addr) || `0x${addr.toString(16).toUpperCase()}`;
    this.emit(`BANKSEL ${sym}`, line);
    this.curBank = b;
  }

  // --- Biến tạm (pool __C_T0..47, ngăn xếp) --------------------------------
  allocTemp(n) {
    if (this.tempTop + n > TEMP_POOL_SIZE) {
      this.err(1, 'biểu thức quá phức tạp (hết biến tạm)');
      return { addr: TEMP_BASE, sym: '__C_T0', width: n, signed: false };
    }
    const off = this.tempTop;
    this.tempTop += n;
    return { addr: TEMP_BASE + off, sym: `__C_T${off}`, width: n, signed: false };
  }
  freeTemp(n) { this.tempTop = Math.max(0, this.tempTop - n); }
  // Biến tạm đang ở đỉnh ngăn xếp, đổi độ rộng tại chỗ (dùng cho ++/cast).
  resizeTopTemp(t, newWidth) {
    const base = t.addr - TEMP_BASE;
    this.tempTop = base + newWidth;
    t.width = newWidth;
  }

  // --- Lệnh cơ bản trên 1 byte file -----------------------------------------
  ref(sym, i) { return i === 0 ? sym : `${sym}+${i}`; }
  emitMovlw(v, line) { this.emit(`MOVLW ${hex2(v)}`, line); }
  emitMovfW(addr, sym, i, line) {
    this.ensureBank(addr + i, sym, line);
    this.emit(`MOVF ${this.ref(sym, i)}, W`, line);
  }
  emitMovwf(addr, sym, i, line) {
    this.ensureBank(addr + i, sym, line);
    this.emit(`MOVWF ${this.ref(sym, i)}`, line);
  }
  emitClrf(addr, sym, i, line) {
    this.ensureBank(addr + i, sym, line);
    this.emit(`CLRF ${this.ref(sym, i)}`, line);
  }
  // Ghi 1 byte hằng vào file.
  setByte(addr, sym, i, value, line) {
    this.emitMovlw(value, line);
    this.emitMovwf(addr, sym, i, line);
  }

  // Chép giá trị src (temp/var, có thể hẹp hơn dst) vào dst (địa chỉ + tên).
  // Hẹp hơn thì lấp byte cao: mở rộng dấu nếu src.signed, ngược lại lấp 0.
  // Rộng hơn thì cắt (chỉ chép dstWidth byte thấp).
  copyValue(src, dstAddr, dstSym, dstWidth, line) {
    const n = Math.min(src.width, dstWidth);
    for (let i = 0; i < n; i++) {
      this.emitMovfW(src.addr, src.sym, i, line);
      this.emitMovwf(dstAddr, dstSym, i, line);
    }
    if (dstWidth > src.width) this.fillHigh(dstAddr, dstSym, src, dstWidth, line);
  }

  // Lấp các byte cao của dst (từ src.width tới dstWidth-1) theo dấu của src.
  fillHigh(dstAddr, dstSym, src, dstWidth, line) {
    if (!src.signed) {
      for (let i = src.width; i < dstWidth; i++) this.emitClrf(dstAddr, dstSym, i, line);
      return;
    }
    const lz = this.newLabel();
    const ld = this.newLabel();
    this.ensureBank(src.addr + src.width - 1, src.sym, line);
    this.emit(`BTFSS ${this.ref(src.sym, src.width - 1)}, 7`, line);
    this.emit(`GOTO ${lz}`, line);
    this.emitMovlw(0xff, line);
    for (let i = src.width; i < dstWidth; i++) this.emitMovwf(dstAddr, dstSym, i, line);
    this.emit(`GOTO ${ld}`, line);
    this.emitLabel(lz, line);
    for (let i = src.width; i < dstWidth; i++) this.emitClrf(dstAddr, dstSym, i, line);
    this.emitLabel(ld, line);
  }

  // Đảo dấu 1 biến tạm tại chỗ (16-bit: bù 1 + cộng 1; 8-bit: COMF + INCF).
  negateTemp(t, line) {
    if (t.width === 1) {
      this.ensureBank(t.addr, t.sym, line);
      this.emit(`COMF ${t.sym}, F`, line);
      this.emit(`INCF ${t.sym}, F`, line);
      return;
    }
    this.ensureBank(t.addr, t.sym, line);
    this.emit(`COMF ${t.sym}, F`, line);
    this.ensureBank(t.addr + 1, t.sym, line);
    this.emit(`COMF ${t.sym}+1, F`, line);
    this.ensureBank(t.addr, t.sym, line);
    this.emit(`INCF ${t.sym}, F`, line);
    this.ensureBank(t.addr + 1, t.sym, line);
    this.emit(`BTFSC STATUS, Z`, line);
    this.emit(`INCF ${t.sym}+1, F`, line);
  }

  // =========================================================================
  // TRA CỨU BIẾN / LVALUE
  // =========================================================================
  lookupVar(name, line) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v) return v;
    }
    if (name in REGISTERS) {
      return { name, addr: REGISTERS[name], sym: name, width: 1, signed: false, isSFR: true };
    }
    const bit = resolveBitName(name);
    if (bit) {
      return {
        name, addr: REGISTERS[bit.reg], sym: bit.reg, width: 1, signed: false,
        isBit: true, bitReg: bit.reg, bitRegAddr: REGISTERS[bit.reg], bit: bit.bit,
      };
    }
    if (/bits$/i.test(name)) {
      this.err(line, `${name} chỉ dùng với .tên bit (vd ${name}.RB0)`);
    } else {
      this.err(line, `chưa khai báo biến ${name}`);
    }
    return { name, addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false };
  }

  // Mô tả vế trái gán: {kind:'file'|'bit'|'index', ...}. Không tính toán
  // biểu thức chỉ số ở đây (để bên ghi/đọc tự tính khi cần).
  resolveLvalue(node) {
    if (!node) return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false };
    switch (node.kind) {
      case 'ident': {
        const v = this.lookupVar(node.name, node.line);
        if (v.isBit) return { kind: 'bit', reg: v.bitReg, regAddr: v.bitRegAddr, bit: v.bit, width: 1, signed: false, line: node.line };
        if (v.isArray) { this.err(node.line, 'không gán được cho mảng'); return { kind: 'file', addr: v.addr, sym: v.sym, width: v.width, signed: v.signed, line: node.line }; }
        return { kind: 'file', addr: v.addr, sym: v.sym, width: v.width, signed: v.signed, isPointer: !!v.isPointer, elemWidth: v.elemWidth || 1, elemSigned: !!v.elemSigned, line: node.line };
      }
      case 'member': {
        if (node.arrow) { this.err(node.line, 'chưa hỗ trợ p->x (truy cập thành viên qua con trỏ)'); return { kind: 'bit', reg: 'PORTB', regAddr: 0x06, bit: 0, width: 1, signed: false, line: node.line }; }
        const r = resolveMember(node.baseName, node.field);
        if (r.error) { this.err(node.line, r.error); return { kind: 'bit', reg: 'PORTB', regAddr: 0x06, bit: 0, width: 1, signed: false, line: node.line }; }
        return { kind: 'bit', reg: r.reg, regAddr: r.regAddr, bit: r.bit, width: 1, signed: false, line: node.line };
      }
      case 'index': {
        const base = node.base;
        if (base && base.kind === 'ident') {
          const v = this.lookupVar(base.name, base.line);
          if (v.isArray) {
            return { kind: 'index', baseAddr: v.addr, baseSym: v.sym, elemWidth: v.elemWidth, elemSigned: v.elemSigned, width: v.elemWidth, signed: v.elemSigned, indexNode: node.index, line: node.line };
          }
          if (v.isPointer) {
            return { kind: 'ptrindex', ptrNode: base, indexNode: node.index, elemWidth: v.elemWidth, elemSigned: !!v.elemSigned, width: v.elemWidth, signed: !!v.elemSigned, line: node.line };
          }
          this.err(node.line, `${base.name} không phải mảng hay con trỏ`);
          return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false, line: node.line };
        }
        // Cơ số là biểu thức bất kỳ (vd (p+1)[i], f()[i]): phải trả con trỏ.
        if (base && this.typeOf(base).isPointer) {
          const bt = this.typeOf(base);
          return { kind: 'ptrindex', ptrNode: base, indexNode: node.index, elemWidth: bt.elemWidth || 1, elemSigned: !!bt.elemSigned, width: bt.elemWidth || 1, signed: !!bt.elemSigned, line: node.line };
        }
        this.err(node.line, 'cơ số của [ ] không phải mảng hay con trỏ');
        return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false, line: node.line };
      }
      case 'unary':
        if (node.op === '*') {
          // *p: chỉ lưu node con trỏ, địa chỉ tính lúc đọc/ghi (để p thay
          // đổi giữa các lần dùng vẫn đúng).
          const pt = this.typeOf(node.expr);
          if (!pt.isPointer) {
            this.err(node.line, 'toán hạng của * không phải con trỏ');
            return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false, line: node.line };
          }
          return { kind: 'deref', ptrNode: node.expr, elemWidth: pt.elemWidth || 1, elemSigned: !!pt.elemSigned, width: pt.elemWidth || 1, signed: !!pt.elemSigned, line: node.line };
        }
        this.err(node.line, 'vế trái phép gán không hợp lệ');
        return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false, line: node.line };
      default:
        this.err(node.line, 'vế trái phép gán không hợp lệ');
        return { kind: 'file', addr: TEMP_BASE, sym: '__C_T0', width: 1, signed: false, line: node.line };
    }
  }

  // Tính địa chỉ hiệu dụng của a[i] vào 1 biến tạm 2 byte (đỉnh ngăn xếp),
  // trả temp đó. Bên gọi phải freeTemp(2) sau khi dùng xong.
  computeIndexAddr(lv, line) {
    const a = this.allocTemp(2);
    a.width = 2; a.signed = false;
    const idx = this.genExpr(lv.indexNode, 2, true);
    if (lv.elemWidth === 1) {
      this.copyValue(idx, a.addr, a.sym, 2, line);
    } else {
      // a = idx * 2 (dịch trái 1)
      this.copyValue(idx, a.addr, a.sym, 2, line);
      this.emit('BCF STATUS, C', line);
      this.ensureBank(a.addr, a.sym, line);
      this.emit(`RLF ${a.sym}, F`, line);
      this.ensureBank(a.addr + 1, a.sym, line);
      this.emit(`RLF ${a.sym}+1, F`, line);
    }
    this.freeTemp(idx.width);
    // a += địa chỉ đầu mảng (cộng hằng 16-bit có nhớ)
    this.emitMovlw(lv.baseAddr & 0xff, line);
    this.ensureBank(a.addr, a.sym, line);
    this.emit(`ADDWF ${a.sym}, F`, line);
    this.ensureBank(a.addr + 1, a.sym, line);
    this.emitMovlw((lv.baseAddr >> 8) & 0xff, line);
    this.emit('BTFSC STATUS, C', line);
    this.emit('ADDLW 1', line);
    this.emit(`ADDWF ${a.sym}+1, F`, line);
    return a;
  }

  // Tính địa chỉ hiệu dụng của lvalue dạng index/ptrindex vào 1 biến tạm
  // 2 byte (đỉnh ngăn xếp), trả temp đó. Bên gọi phải freeTemp(2) sau khi
  // dùng xong. Với 'ptrindex': t = giá trị con trỏ, idx = chỉ số (2 byte),
  // idx nhân elemWidth rồi cộng vào t. Chỉ free idx ở đây; temp t trả về
  // cho bên gọi (free t trong hàm này sẽ làm mất temp kết quả vì t nằm
  // dưới idx trên ngăn xếp tạm).
  computeEffAddr(lv, line) {
    if (lv.kind === 'index') return this.computeIndexAddr(lv, line);
    const t = this.genExpr(lv.ptrNode, 2, true);
    const idx = this.genExpr(lv.indexNode, 2, true);
    if (lv.elemWidth === 2) {
      // idx <<= 1 (phần tử int rộng 2 byte)
      this.emit('BCF STATUS, C', line);
      this.ensureBank(idx.addr, idx.sym, line);
      this.emit(`RLF ${idx.sym}, F`, line);
      this.ensureBank(idx.addr + 1, idx.sym, line);
      this.emit(`RLF ${idx.sym}+1, F`, line);
    }
    this.computeBinary('+', t, idx, line);
    this.freeTemp(idx.width);
    return t;
  }

  // Nạp FSR/IRP từ địa chỉ 16-bit trong temp a (a phải là đỉnh ngăn xếp).
  setFsrFromTemp(a, line) {
    this.emitMovfW(a.addr, a.sym, 0, line);
    this.emit('MOVWF FSR', line);
    this.emit('BCF STATUS, IRP', line);
    this.ensureBank(a.addr + 1, a.sym, line);
    this.emit(`BTFSC ${a.sym}+1, 0`, line);
    this.emit('BSF STATUS, IRP', line);
  }

  // Đọc lvalue vào biến tạm mới (độ rộng want). Trả temp.
  readLvalue(lv, want, line) {
    if (lv.kind === 'file') {
      const r = this.allocTemp(want);
      r.signed = lv.signed;
      this.copyValue({ addr: lv.addr, sym: lv.sym, width: lv.width, signed: lv.signed }, r.addr, r.sym, want, line);
      return r;
    }
    if (lv.kind === 'bit') {
      const r = this.allocTemp(want);
      r.signed = false;
      this.emitClrf(r.addr, r.sym, 0, line);
      if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
      const ld = this.newLabel();
      this.ensureBank(lv.regAddr, lv.reg, line);
      this.emit(`BTFSS ${lv.reg}, ${lv.bit}`, line);
      this.emit(`GOTO ${ld}`, line);
      this.emitMovlw(1, line);
      this.emitMovwf(r.addr, r.sym, 0, line);
      this.emitLabel(ld, line);
      return r;
    }
    // deref (*p): đọc n byte của phần tử qua INDF. Kết quả r cấp phát
    // TRƯỚC, temp địa chỉ p nằm trên r nên free p xong r vẫn còn nguyên.
    if (lv.kind === 'deref') {
      const r = this.allocTemp(want);
      r.signed = lv.elemSigned;
      const p = this.genExpr(lv.ptrNode, 2, true);
      this.setFsrFromTemp(p, line);
      const n = Math.min(want, lv.elemWidth);
      for (let i = 0; i < n; i++) {
        this.emit('MOVF INDF, W', line);
        this.emitMovwf(r.addr, r.sym, i, line);
        if (i < n - 1) this.emit('INCF FSR, F', line);
      }
      if (want > lv.elemWidth) {
        // Lấp byte cao theo dấu của phần tử trỏ tới.
        const fill = { addr: r.addr, sym: r.sym, width: lv.elemWidth, signed: lv.elemSigned };
        this.fillHigh(r.addr, r.sym, fill, want, line);
      }
      this.freeTemp(p.width);
      return r;
    }
    // index / ptrindex: đọc qua INDF, địa chỉ tính bằng computeEffAddr.
    const r = this.allocTemp(want);
    r.signed = lv.elemSigned;
    const a = this.computeEffAddr(lv, line);
    this.setFsrFromTemp(a, line);
    const n = Math.min(want, lv.elemWidth);
    for (let i = 0; i < n; i++) {
      this.emit('MOVF INDF, W', line);
      this.emitMovwf(r.addr, r.sym, i, line);
      if (i < n - 1) this.emit('INCF FSR, F', line);
    }
    if (want > lv.elemWidth) {
      // Lấp byte cao theo dấu của phần tử.
      const fill = { addr: r.addr, sym: r.sym, width: lv.elemWidth, signed: lv.elemSigned };
      this.fillHigh(r.addr, r.sym, fill, want, line);
    }
    this.freeTemp(a.width);
    return r;
  }

  // Ghi biến tạm v vào lvalue.
  storeLvalue(lv, v, line) {
    if (lv.kind === 'file') {
      this.copyValue(v, lv.addr, lv.sym, lv.width, line);
      return;
    }
    if (lv.kind === 'bit') {
      // Ghi bit = (v != 0) ? 1 : 0 — kiểm tra TOÀN BỘ giá trị (v=256 vẫn là 1).
      const lclear = this.newLabel();
      const ldone = this.newLabel();
      this.emitMovfW(v.addr, v.sym, 0, line);
      if (v.width === 2) {
        this.ensureBank(v.addr + 1, v.sym, line);
        this.emit(`IORWF ${v.sym}+1, W`, line);
      }
      this.emit('BTFSC STATUS, Z', line);
      this.emit(`GOTO ${lclear}`, line);
      this.ensureBank(lv.regAddr, lv.reg, line);
      this.emit(`BSF ${lv.reg}, ${lv.bit}`, line);
      this.emit(`GOTO ${ldone}`, line);
      this.emitLabel(lclear, line);
      this.ensureBank(lv.regAddr, lv.reg, line);
      this.emit(`BCF ${lv.reg}, ${lv.bit}`, line);
      this.emitLabel(ldone, line);
      return;
    }
    // deref (*p): ghi từng byte của v vào INDF. v đã tính TRƯỚC khi
    // storeLvalue được gọi nên p nằm trên v trong ngăn xếp tạm — đúng
    // kỷ luật (p là đỉnh khi setFsrFromTemp).
    if (lv.kind === 'deref') {
      const p = this.genExpr(lv.ptrNode, 2, true);
      this.setFsrFromTemp(p, line);
      for (let i = 0; i < lv.elemWidth; i++) {
        this.emitMovfW(v.addr, v.sym, i, line);
        this.emit('MOVWF INDF', line);
        if (i < lv.elemWidth - 1) this.emit('INCF FSR, F', line);
      }
      this.freeTemp(p.width);
      return;
    }
    // index / ptrindex: chép v vào 1 temp đúng độ rộng phần tử rồi ghi qua INDF.
    const t = this.allocTemp(lv.elemWidth);
    t.signed = v.signed;
    this.copyValue(v, t.addr, t.sym, lv.elemWidth, line);
    const a = this.computeEffAddr(lv, line);
    this.setFsrFromTemp(a, line);
    for (let i = 0; i < lv.elemWidth; i++) {
      this.emitMovfW(t.addr, t.sym, i, line);
      this.emit('MOVWF INDF', line);
      if (i < lv.elemWidth - 1) this.emit('INCF FSR, F', line);
    }
    this.freeTemp(a.width);
    this.freeTemp(t.width);
  }

  // =========================================================================
  // KIỂU CỦA BIỂU THỨC (độ rộng tự nhiên theo byte, có dấu không, con trỏ?)
  // typeOf trả {width, signed, isPointer, elemWidth, elemSigned}:
  //   - con trỏ (kể cả mảng đã decay): width 2, signed false, isPointer
  //     true, elemWidth/elemSigned là kiểu phần tử trỏ tới.
  //   - số nguyên: width theo byte, signed theo luật thăng cấp C.
  // naturalWidth/signedOf chỉ là vỏ bọc để code cũ không đổi hành vi với
  // mọi node không phải con trỏ.
  // =========================================================================
  typeOf(node) {
    const ptr = (elemWidth, elemSigned) => ({
      width: 2, signed: false, isPointer: true,
      elemWidth: elemWidth || 1, elemSigned: !!elemSigned,
    });
    const plain = (width, signed) => ({
      width, signed: !!signed, isPointer: false,
      elemWidth: width, elemSigned: !!signed,
    });
    if (!node) return plain(1, false);
    switch (node.kind) {
      case 'num': return plain(node.type === 'char' ? 1 : 2, true);
      case 'str': return plain(1, false);
      case 'ident': {
        const v = this.lookupVar(node.name, node.line);
        if (v.isBit || v.isSFR) return plain(1, false);
        if (v.isPointer) return ptr(v.elemWidth, v.elemSigned);
        if (v.isArray) return ptr(v.elemWidth, v.elemSigned); // mảng decay
        return plain(v.width, v.signed);
      }
      case 'member': return plain(1, false);
      case 'index': {
        const b = node.base;
        if (b && b.kind === 'ident') {
          const v = this.lookupVar(b.name, b.line);
          if (v.isArray || v.isPointer) return plain(v.elemWidth, v.elemSigned);
        } else if (b) {
          const bt = this.typeOf(b);
          if (bt.isPointer) return plain(bt.elemWidth, bt.elemSigned);
        }
        return plain(1, false);
      }
      case 'binary': {
        if (['&&', '||', '<', '>', '<=', '>=', '==', '!='].includes(node.op)) {
          return plain(1, false);
        }
        const lt = this.typeOf(node.left);
        const rt = this.typeOf(node.right);
        if (node.op === '+' || node.op === '-') {
          if (lt.isPointer && rt.isPointer) {
            // p - q: hiệu số phần tử (int có dấu); p + q vô nghĩa.
            if (node.op === '-') return plain(2, true);
            return plain(2, false);
          }
          if (lt.isPointer) return ptr(lt.elemWidth, lt.elemSigned);
          if (rt.isPointer) return ptr(rt.elemWidth, rt.elemSigned);
        }
        return plain(Math.max(lt.width, rt.width), lt.signed && rt.signed);
      }
      case 'unary': {
        if (node.op === '!') return plain(1, false);
        if (node.op === 'cast') {
          if (node.pointer) return ptr(typeWidth(node.castType), typeSigned(node.castType));
          if (node.castType === 'void') return plain(1, false);
          return plain(typeWidth(node.castType), typeSigned(node.castType));
        }
        if (node.op === '*') {
          // *p: kiểu phần tử trỏ tới.
          const t = this.typeOf(node.expr);
          return plain(t.elemWidth || 1, t.elemSigned);
        }
        if (node.op === '&') {
          // &x: kiểu phần tử là kiểu của x (mảng -> phần tử mảng,
          // *p -> pointee, biến thường -> chính kiểu biến).
          const e = node.expr;
          if (e && e.kind === 'ident') {
            const v = this.lookupVar(e.name, e.line);
            if (v.isArray || v.isPointer) return ptr(v.elemWidth, v.elemSigned);
            return ptr(v.width, v.signed);
          }
          const t = this.typeOf(node.expr);
          return ptr(t.isPointer ? t.elemWidth : t.width, t.isPointer ? t.elemSigned : t.signed);
        }
        // '++'/'--'/'-'/'+'/'~': cùng kiểu với toán hạng.
        return this.typeOf(node.expr);
      }
      case 'assign': return this.typeOf(node.target);
      case 'call': {
        if (node.name === '__delay_ms' || node.name === '__delay_us') return plain(1, false);
        const fn = this.funcs.get(node.name);
        if (!fn) return plain(1, false);
        if (fn.retIsPointer) return ptr(fn.retElemWidth, fn.retElemSigned);
        return plain(fn.retWidth || 1, fn.retSigned);
      }
      case 'ternary': {
        const tt = this.typeOf(node.then);
        const et = this.typeOf(node.else);
        if (tt.isPointer) return ptr(tt.elemWidth, tt.elemSigned);
        if (et.isPointer) return ptr(et.elemWidth, et.elemSigned);
        return plain(Math.max(tt.width, et.width), tt.signed && et.signed);
      }
      default: return plain(1, false);
    }
  }

  naturalWidth(node) {
    return this.typeOf(node).width;
  }

  signedOf(node) {
    return this.typeOf(node).signed;
  }

  // Đổi độ rộng của biến tạm đang ở đỉnh ngăn xếp (lấp byte cao theo dấu
  // khi mở rộng, cắt khi thu hẹp). temp PHẢI là biến tạm vừa cấp phát gần nhất.
  adjustTempWidth(t, want, line) {
    if (t.width === want) return;
    if (t.width < want) {
      this.fillHigh(t.addr, t.sym, { addr: t.addr, sym: t.sym, width: t.width, signed: t.signed }, want, line);
    }
    this.resizeTopTemp(t, want);
  }

  dummyTemp(want) {
    return { addr: TEMP_BASE, sym: '__C_T0', width: want, signed: false };
  }

  // =========================================================================
  // BIỂU THỨC: genExpr(node, wantBytes, valueUsed) -> temp {addr, sym, width, signed}
  // Luôn trả về temp ĐÚNG độ rộng want (1 hoặc 2 byte). Bên gọi freeTemp().
  // =========================================================================
  genExpr(node, want, valueUsed = true) {
    if (!node) return this.dummyTemp(want);
    const line = node.line;
    switch (node.kind) {
      case 'num': {
        const r = this.allocTemp(want);
        r.signed = true;
        const v = node.value & 0xffff;
        this.setByte(r.addr, r.sym, 0, v & 0xff, line);
        if (want === 2) this.setByte(r.addr, r.sym, 1, (v >> 8) & 0xff, line);
        return r;
      }
      case 'str':
        this.err(line, 'chuỗi chỉ dùng để khởi tạo mảng char');
        return this.dummyTemp(want);
      case 'ident': {
        const v = this.lookupVar(node.name, line);
        if (v.isArray) {
          // Mảng decay thành con trỏ tới phần tử đầu: địa chỉ hằng 2 byte.
          const r = this.allocTemp(2);
          r.signed = false;
          this.setByte(r.addr, r.sym, 0, v.addr & 0xff, line);
          this.setByte(r.addr, r.sym, 1, (v.addr >> 8) & 0xff, line);
          this.adjustTempWidth(r, want, line);
          return r;
        }
        if (v.isBit) {
          const lv = { kind: 'bit', reg: v.bitReg, regAddr: v.bitRegAddr, bit: v.bit, width: 1, signed: false, line };
          return this.readLvalue(lv, want, line);
        }
        const r = this.allocTemp(want);
        r.signed = !!v.signed;
        this.copyValue({ addr: v.addr, sym: v.sym, width: v.width, signed: !!v.signed }, r.addr, r.sym, want, line);
        return r;
      }
      case 'member': {
        if (node.arrow) { this.err(line, 'chưa hỗ trợ con trỏ'); return this.dummyTemp(want); }
        const m = resolveMember(node.baseName, node.field);
        if (m.error) { this.err(line, m.error); return this.dummyTemp(want); }
        const lv = { kind: 'bit', reg: m.reg, regAddr: m.regAddr, bit: m.bit, width: 1, signed: false, line };
        return this.readLvalue(lv, want, line);
      }
      case 'index': {
        const lv = this.resolveLvalue(node);
        if (lv.kind !== 'index' && lv.kind !== 'ptrindex') return this.dummyTemp(want);
        return this.readLvalue(lv, want, line);
      }
      case 'binary': {
        if (['&&', '||', '<', '>', '<=', '>=', '==', '!='].includes(node.op)) {
          const r = this.allocTemp(want);
          r.signed = false;
          this.emitClrf(r.addr, r.sym, 0, line);
          if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
          const lset = this.newLabel();
          const lend = this.newLabel();
          this.genCond(node, lset, lend);
          this.emitLabel(lset, line);
          this.emitMovlw(1, line);
          this.emitMovwf(r.addr, r.sym, 0, line);
          this.emitLabel(lend, line);
          return r;
        }
        // Số học / bit / dịch: tính tại chỗ vào toán hạng trái.
        // Con trỏ: p + n / p - n (n đếm theo phần tử), p - q (hiệu số
        // phần tử). So sánh con trỏ đã xử lý ở nhánh quan hệ phía trên
        // (genCond/compareBranch tính đủ 16-bit nhờ typeOf).
        const lt = this.typeOf(node.left);
        const rt = this.typeOf(node.right);
        if ((node.op === '+' || node.op === '-') && (lt.isPointer || rt.isPointer)) {
          if (lt.isPointer && rt.isPointer) {
            if (node.op === '-') {
              // p - q: trừ 16-bit rồi chia cho elemWidth (dịch phải số học).
              const a = this.genExpr(node.left, 2, true);
              const b = this.genExpr(node.right, 2, true);
              this.computeBinary('-', a, b, line);
              this.freeTemp(b.width);
              if (lt.elemWidth === 2) {
                this.emit('BCF STATUS, C', line);
                this.ensureBank(a.addr + 1, a.sym, line);
                this.emit(`BTFSC ${a.sym}+1, 7`, line);
                this.emit('BSF STATUS, C', line);
                this.ensureBank(a.addr + 1, a.sym, line);
                this.emit(`RRF ${a.sym}+1, F`, line);
                this.ensureBank(a.addr, a.sym, line);
                this.emit(`RRF ${a.sym}, F`, line);
              }
              a.signed = true;
              this.adjustTempWidth(a, want, line);
              return a;
            }
            // p + q vô nghĩa trong C: rơi xuống đường số học thường.
          } else if (lt.isPointer || node.op === '+') {
            // p + n, p - n, n + p: n nhân elemWidth rồi cộng/trừ 16-bit.
            const ptrIsLeft = lt.isPointer;
            const elemW = (ptrIsLeft ? lt : rt).elemWidth || 1;
            const a = this.genExpr(ptrIsLeft ? node.left : node.right, 2, true);
            const b = this.genExpr(ptrIsLeft ? node.right : node.left, 2, true);
            if (elemW === 2) {
              // b <<= 1 (phần tử int rộng 2 byte)
              this.emit('BCF STATUS, C', line);
              this.ensureBank(b.addr, b.sym, line);
              this.emit(`RLF ${b.sym}, F`, line);
              this.ensureBank(b.addr + 1, b.sym, line);
              this.emit(`RLF ${b.sym}+1, F`, line);
            }
            this.computeBinary(node.op, a, b, line);
            this.freeTemp(b.width);
            a.signed = false;
            this.adjustTempWidth(a, want, line);
            return a;
          }
          // n - p vô nghĩa: rơi xuống đường số học thường.
        }
        let cw = want;
        if (node.op === '/' || node.op === '%') cw = 2;
        else if (node.op === '>>') cw = Math.max(want, this.naturalWidth(node.left));
        const a = this.genExpr(node.left, cw, true);
        const b = this.genExpr(node.right, cw, true);
        a.signed = this.signedOf(node.left);
        b.signed = this.signedOf(node.right);
        this.computeBinary(node.op, a, b, line);
        this.freeTemp(b.width);
        a.signed = this.signedOf(node);
        this.adjustTempWidth(a, want, line);
        return a;
      }
      case 'unary': {
        if (node.op === '*') {
          // *p: đọc phần tử qua INDF (FSR/IRP). Lưu ý giới hạn CPU:
          // p trỏ vào SFR (địa chỉ < 0x20) thì đọc trả 0 (pic16.js).
          const pt = this.typeOf(node.expr);
          if (!pt.isPointer) {
            this.err(line, 'toán hạng của * không phải con trỏ');
            return this.dummyTemp(want);
          }
          const ew = pt.elemWidth || 1;
          if (!valueUsed) {
            const p0 = this.genExpr(node.expr, 2, true);
            this.freeTemp(p0.width);
            const r0 = this.allocTemp(want);
            r0.signed = false;
            this.emitClrf(r0.addr, r0.sym, 0, line);
            if (want === 2) this.emitClrf(r0.addr, r0.sym, 1, line);
            return r0;
          }
          // Kết quả r cấp phát TRƯỚC, temp địa chỉ p nằm trên r: free p
          // xong r vẫn còn nguyên (đừng cấp p trước r — temp sau sẽ
          // cấp chồng lên r và ghi đè giá trị vừa đọc).
          const r = this.allocTemp(want);
          r.signed = !!pt.elemSigned;
          const p = this.genExpr(node.expr, 2, true);
          this.setFsrFromTemp(p, line);
          const n = Math.min(want, ew);
          for (let i = 0; i < n; i++) {
            this.emit('MOVF INDF, W', line);
            this.emitMovwf(r.addr, r.sym, i, line);
            if (i < n - 1) this.emit('INCF FSR, F', line);
          }
          if (want > ew) {
            const fill = { addr: r.addr, sym: r.sym, width: ew, signed: !!pt.elemSigned };
            this.fillHigh(r.addr, r.sym, fill, want, line);
          }
          this.freeTemp(p.width);
          return r;
        }
        if (node.op === '&') {
          // &x: địa chỉ hằng 2 byte; &a[i]/&p[i]: địa chỉ hiệu dụng;
          // &*p: chính giá trị con trỏ. &bit -> lỗi; &SFR cho phép
          // (trả số địa chỉ, dù *p trỏ SFR không chạy được trên CPU).
          const e = node.expr;
          if (e.kind === 'unary' && e.op === '*') {
            const t = this.genExpr(e.expr, 2, true);
            t.signed = false;
            this.adjustTempWidth(t, want, line);
            return t;
          }
          if (e.kind === 'member') {
            this.err(line, 'không lấy địa chỉ của bit');
            return this.dummyTemp(want);
          }
          if (e.kind === 'index') {
            const lv = this.resolveLvalue(e);
            if (lv.kind !== 'index' && lv.kind !== 'ptrindex') return this.dummyTemp(want);
            const a = this.computeEffAddr(lv, line);
            a.signed = false;
            this.adjustTempWidth(a, want, line);
            return a;
          }
          if (e.kind === 'ident') {
            const v = this.lookupVar(e.name, e.line);
            if (v.isBit) {
              this.err(line, 'không lấy địa chỉ của bit');
              return this.dummyTemp(want);
            }
            const a = this.allocTemp(2);
            a.signed = false;
            this.setByte(a.addr, a.sym, 0, v.addr & 0xff, line);
            this.setByte(a.addr, a.sym, 1, (v.addr >> 8) & 0xff, line);
            this.adjustTempWidth(a, want, line);
            return a;
          }
          this.err(line, 'không lấy được địa chỉ của biểu thức này');
          return this.dummyTemp(want);
        }
        if (node.op === 'cast') {
          if (node.pointer) {
            // Ép kiểu tới con trỏ: no-op, chỉ đổi kiểu (giữ nguyên 2 byte).
            const t = this.genExpr(node.expr, 2, true);
            t.signed = false;
            this.adjustTempWidth(t, want, line);
            return t;
          }
          if (node.castType === 'void') {
            const t = this.genExpr(node.expr, 1, false);
            this.freeTemp(t.width);
            const r = this.allocTemp(want);
            r.signed = false;
            this.emitClrf(r.addr, r.sym, 0, line);
            if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
            return r;
          }
          const cw = typeWidth(node.castType);
          const t = this.genExpr(node.expr, cw, true);
          t.signed = typeSigned(node.castType);
          this.adjustTempWidth(t, want, line);
          return t;
        }
        if (node.op === '++' || node.op === '--') {
          return this.genIncDec(node.expr, node.prefix, node.op === '++' ? 1 : -1, want, line);
        }
        if (node.op === '!') {
          const r = this.allocTemp(want);
          r.signed = false;
          this.emitClrf(r.addr, r.sym, 0, line);
          if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
          const nw = this.naturalWidth(node.expr);
          const a = this.genExpr(node.expr, nw, true);
          this.emitMovfW(a.addr, a.sym, 0, line);
          if (a.width === 2) {
            this.ensureBank(a.addr + 1, a.sym, line);
            this.emit(`IORWF ${a.sym}+1, W`, line);
          }
          this.ensureBank(r.addr, r.sym, line);
          this.emit('BTFSC STATUS, Z', line);
          this.emit(`INCF ${r.sym}, F`, line);
          this.freeTemp(a.width);
          return r;
        }
        if (node.op === '-') {
          const a = this.genExpr(node.expr, want, true);
          this.negateTemp(a, line);
          a.signed = this.signedOf(node);
          return a;
        }
        if (node.op === '~') {
          const a = this.genExpr(node.expr, want, true);
          for (let i = 0; i < a.width; i++) {
            this.ensureBank(a.addr + i, a.sym, line);
            this.emit(`COMF ${this.ref(a.sym, i)}, F`, line);
          }
          a.signed = this.signedOf(node);
          return a;
        }
        // '+' một ngôi: giữ nguyên giá trị.
        return this.genExpr(node.expr, want, true);
      }
      case 'assign':
        return this.genAssign(node, want, line);
      case 'call':
        return this.genCall(node, want, valueUsed, line);
      case 'ternary': {
        const r = this.allocTemp(want);
        r.signed = this.signedOf(node);
        const lthen = this.newLabel();
        const lelse = this.newLabel();
        const lend = this.newLabel();
        this.genCond(node.cond, lthen, lelse);
        this.emitLabel(lthen, line);
        const t = this.genExpr(node.then, want, true);
        this.copyValue(t, r.addr, r.sym, want, line);
        this.freeTemp(t.width);
        this.emit(`GOTO ${lend}`, line);
        this.emitLabel(lelse, line);
        const e = this.genExpr(node.else, want, true);
        this.copyValue(e, r.addr, r.sym, want, line);
        this.freeTemp(e.width);
        this.emitLabel(lend, line);
        return r;
      }
      default:
        this.err(line, `biểu thức chưa hỗ trợ (${node.kind})`);
        return this.dummyTemp(want);
    }
  }

  // ++/-- tiền tố (prefix=true) và hậu tố (prefix=false) trên 1 lvalue.
  genIncDec(targetNode, prefix, delta, want, line) {
    const lv = this.resolveLvalue(targetNode);
    if (lv.kind === 'bit') {
      this.err(line, 'không tăng/giảm được bit');
      return this.dummyTemp(want);
    }
    // Con trỏ: p++/p-- nhảy theo kích thước phần tử (int* nhảy 2 byte),
    // còn *p++/p[i]++ thì tăng GIÁ TRỊ phần tử nên delta giữ ±1.
    if (lv.kind === 'file' && lv.isPointer) delta *= lv.elemWidth;
    const w = lv.width;
    if (prefix) {
      const r = this.readLvalue(lv, w, line);
      r.signed = lv.signed;
      this.incDecTemp(r, delta, line);
      this.storeLvalue(lv, r, line);
      this.adjustTempWidth(r, want, line);
      return r;
    }
    const r = this.readLvalue(lv, w, line);
    r.signed = lv.signed;
    const n = this.allocTemp(w);
    n.signed = lv.signed;
    this.copyValue(r, n.addr, n.sym, w, line);
    this.incDecTemp(n, delta, line);
    this.storeLvalue(lv, n, line);
    this.freeTemp(n.width);
    this.adjustTempWidth(r, want, line);
    return r;
  }

  // Tăng/giảm 1 biến tạm tại chỗ (delta = +1, -1, +2 hoặc -2;
  // ±2 dùng cho p++ với con trỏ int*).
  incDecTemp(t, delta, line) {
    if (delta === 1) {
      if (t.width === 1) {
        this.ensureBank(t.addr, t.sym, line);
        this.emit(`INCF ${t.sym}, F`, line);
      } else {
        this.ensureBank(t.addr, t.sym, line);
        this.emit(`INCF ${t.sym}, F`, line);
        this.ensureBank(t.addr + 1, t.sym, line);
        this.emit('BTFSC STATUS, Z', line);
        this.emit(`INCF ${t.sym}+1, F`, line);
      }
      return;
    }
    if (delta === -1) {
      if (t.width === 1) {
        this.ensureBank(t.addr, t.sym, line);
        this.emit(`DECF ${t.sym}, F`, line);
      } else {
        this.emitMovlw(1, line);
        this.ensureBank(t.addr, t.sym, line);
        this.emit(`SUBWF ${t.sym}, F`, line);
        this.ensureBank(t.addr + 1, t.sym, line);
        this.emit('BTFSS STATUS, C', line);
        this.emit(`DECF ${t.sym}+1, F`, line);
      }
      return;
    }
    // delta = ±2 (chỉ gặp với biến tạm 2 byte: con trỏ int*).
    const mag = Math.abs(delta);
    this.emitMovlw(mag, line);
    this.ensureBank(t.addr, t.sym, line);
    if (delta > 0) {
      this.emit(`ADDWF ${t.sym}, F`, line);
      if (t.width === 2) {
        this.ensureBank(t.addr + 1, t.sym, line);
        this.emit('BTFSC STATUS, C', line);
        this.emit(`INCF ${t.sym}+1, F`, line);
      }
    } else {
      this.emit(`SUBWF ${t.sym}, F`, line);
      if (t.width === 2) {
        this.ensureBank(t.addr + 1, t.sym, line);
        this.emit('BTFSS STATUS, C', line);
        this.emit(`DECF ${t.sym}+1, F`, line);
      }
    }
  }

  genAssign(node, want, line) {
    const lv = this.resolveLvalue(node.target);
    const op = node.op;
    if (op === '=') {
      const evalWidth = Math.max(want, lv.width);
      const v = this.genExpr(node.value, evalWidth, true);
      this.storeLvalue(lv, v, line);
      v.signed = lv.signed;
      this.adjustTempWidth(v, want, line);
      return v;
    }
    // Gán hợp: đọc -> tính (luôn 16-bit) -> ghi lại.
    const t = this.readLvalue(lv, 2, line);
    t.signed = lv.signed;
    const v = this.genExpr(node.value, 2, true);
    v.signed = this.signedOf(node.value);
    // p += n / p -= n (lv chính là biến con trỏ): n đếm theo phần tử,
    // nhân với elemWidth trước khi cộng (int* thì n *= 2).
    if (lv.kind === 'file' && lv.isPointer && (op === '+=' || op === '-=')
      && lv.elemWidth === 2) {
      this.emit('BCF STATUS, C', line);
      this.ensureBank(v.addr, v.sym, line);
      this.emit(`RLF ${v.sym}, F`, line);
      this.ensureBank(v.addr + 1, v.sym, line);
      this.emit(`RLF ${v.sym}+1, F`, line);
    }
    this.computeBinary(op.slice(0, -1), t, v, line);
    this.storeLvalue(lv, t, line);
    this.freeTemp(v.width);
    t.signed = lv.signed;
    this.adjustTempWidth(t, want, line);
    return t;
  }

  // Tính a = a <op> b tại chỗ (a, b cùng độ rộng cw = 1 hoặc 2 byte).
  computeBinary(op, a, b, line) {
    const w = a.width;
    const top = w - 1;
    switch (op) {
      case '+': {
        if (w === 1) {
          this.emitMovfW(a.addr, a.sym, 0, line);
          this.ensureBank(b.addr, b.sym, line);
          this.emit(`ADDWF ${b.sym}, W`, line);
          this.emitMovwf(a.addr, a.sym, 0, line);
        } else {
          this.emitMovfW(a.addr, a.sym, 0, line);
          this.ensureBank(b.addr, b.sym, line);
          this.emit(`ADDWF ${b.sym}, W`, line);
          this.emitMovwf(a.addr, a.sym, 0, line);
          this.emitMovfW(a.addr, a.sym, 1, line);
          this.emit('BTFSC STATUS, C', line);
          this.emit('ADDLW 1', line);
          this.ensureBank(b.addr + 1, b.sym, line);
          this.emit(`ADDWF ${b.sym}+1, W`, line);
          this.emitMovwf(a.addr, a.sym, 1, line);
        }
        break;
      }
      case '-': {
        if (w === 1) {
          this.emitMovfW(b.addr, b.sym, 0, line);
          this.ensureBank(a.addr, a.sym, line);
          this.emit(`SUBWF ${a.sym}, W`, line);
          this.emitMovwf(a.addr, a.sym, 0, line);
        } else {
          this.emitMovfW(b.addr, b.sym, 0, line);
          this.ensureBank(a.addr, a.sym, line);
          this.emit(`SUBWF ${a.sym}, W`, line);
          this.emitMovwf(a.addr, a.sym, 0, line);
          this.emitMovfW(b.addr, b.sym, 1, line);
          this.emit('BTFSS STATUS, C', line);
          this.emit('ADDLW 1', line);
          this.ensureBank(a.addr + 1, a.sym, line);
          this.emit(`SUBWF ${a.sym}+1, W`, line);
          this.emitMovwf(a.addr, a.sym, 1, line);
        }
        break;
      }
      case '&': case '|': case '^': {
        const mn = op === '&' ? 'ANDWF' : op === '|' ? 'IORWF' : 'XORWF';
        for (let i = 0; i < w; i++) {
          this.emitMovfW(a.addr, a.sym, i, line);
          this.ensureBank(b.addr + i, b.sym, line);
          this.emit(`${mn} ${this.ref(b.sym, i)}, W`, line);
          this.emitMovwf(a.addr, a.sym, i, line);
        }
        break;
      }
      case '*': {
        this.usedMul = true;
        const ma = HELPER.__C_MA, mb = HELPER.__C_MB, mr = HELPER.__C_MR;
        this.copyValue(a, ma.addr, ma.name, 2, line);
        this.copyValue(b, mb.addr, mb.name, 2, line);
        this.emit('CALL __C_MUL16', line);
        this.curBank = -1;
        this.copyValue({ addr: mr.addr, sym: mr.name, width: 2, signed: false }, a.addr, a.sym, w, line);
        break;
      }
      case '/': case '%': {
        this.usedDiv = true;
        const sg = HELPER.__C_SG;
        const da = HELPER.__C_DA, db = HELPER.__C_DB;
        const dq = HELPER.__C_DQ, dr = HELPER.__C_DR;
        this.emitClrf(sg.addr, sg.name, 0, line);
        // Cờ dấu: SG bit0 = a âm, bit1 = b âm.
        let l1 = this.newLabel();
        this.ensureBank(a.addr + top, a.sym, line);
        this.emit(`BTFSS ${this.ref(a.sym, top)}, 7`, line);
        this.emit(`GOTO ${l1}`, line);
        this.ensureBank(sg.addr, sg.name, line);
        this.emit(`BSF ${sg.name}, 0`, line);
        this.emitLabel(l1, line);
        l1 = this.newLabel();
        this.ensureBank(b.addr + top, b.sym, line);
        this.emit(`BTFSS ${this.ref(b.sym, top)}, 7`, line);
        this.emit(`GOTO ${l1}`, line);
        this.ensureBank(sg.addr, sg.name, line);
        this.emit(`BSF ${sg.name}, 1`, line);
        this.emitLabel(l1, line);
        // Trị tuyệt đối của a, b.
        l1 = this.newLabel();
        this.ensureBank(sg.addr, sg.name, line);
        this.emit(`BTFSS ${sg.name}, 0`, line);
        this.emit(`GOTO ${l1}`, line);
        this.negateTemp(a, line);
        this.emitLabel(l1, line);
        l1 = this.newLabel();
        this.ensureBank(sg.addr, sg.name, line);
        this.emit(`BTFSS ${sg.name}, 1`, line);
        this.emit(`GOTO ${l1}`, line);
        this.negateTemp(b, line);
        this.emitLabel(l1, line);
        this.copyValue(a, da.addr, da.name, 2, line);
        this.copyValue(b, db.addr, db.name, 2, line);
        this.emit('CALL __C_DIV16', line);
        this.curBank = -1;
        const src = op === '/' ? dq : dr;
        this.copyValue({ addr: src.addr, sym: src.name, width: 2, signed: false }, a.addr, a.sym, 2, line);
        if (op === '/') {
          // Đổi dấu thương khi 2 dấu khác nhau.
          const l5 = this.newLabel(), l6 = this.newLabel(), l7 = this.newLabel();
          this.ensureBank(sg.addr, sg.name, line);
          this.emit(`BTFSS ${sg.name}, 0`, line);
          this.emit(`GOTO ${l5}`, line);
          this.ensureBank(sg.addr, sg.name, line);
          this.emit(`BTFSC ${sg.name}, 1`, line);
          this.emit(`GOTO ${l7}`, line);
          this.emit(`GOTO ${l6}`, line);
          this.emitLabel(l5, line);
          this.ensureBank(sg.addr, sg.name, line);
          this.emit(`BTFSS ${sg.name}, 1`, line);
          this.emit(`GOTO ${l7}`, line);
          this.emitLabel(l6, line);
          this.negateTemp(a, line);
          this.emitLabel(l7, line);
        } else {
          // Số dư cùng dấu với số bị chia.
          const l8 = this.newLabel();
          this.ensureBank(sg.addr, sg.name, line);
          this.emit(`BTFSS ${sg.name}, 0`, line);
          this.emit(`GOTO ${l8}`, line);
          this.negateTemp(a, line);
          this.emitLabel(l8, line);
        }
        break;
      }
      case '<<': case '>>': {
        const sh = HELPER.__C_SH;
        this.emitMovfW(b.addr, b.sym, 0, line);
        this.emitMovwf(sh.addr, sh.name, 0, line);
        const ldone = this.newLabel();
        const lloop = this.newLabel();
        this.ensureBank(sh.addr, sh.name, line);
        this.emit(`MOVF ${sh.name}, F`, line);
        this.emit('BTFSC STATUS, Z', line);
        this.emit(`GOTO ${ldone}`, line);
        this.emitLabel(lloop, line);
        this.emit('BCF STATUS, C', line);
        if (op === '<<') {
          for (let i = 0; i < w; i++) {
            this.ensureBank(a.addr + i, a.sym, line);
            this.emit(`RLF ${this.ref(a.sym, i)}, F`, line);
          }
        } else if (a.signed) {
          // Dịch phải số học: C = bit dấu trước khi RRF byte cao.
          this.ensureBank(a.addr + top, a.sym, line);
          this.emit(`BTFSC ${this.ref(a.sym, top)}, 7`, line);
          this.emit('BSF STATUS, C', line);
          for (let i = top; i >= 0; i--) {
            this.ensureBank(a.addr + i, a.sym, line);
            this.emit(`RRF ${this.ref(a.sym, i)}, F`, line);
          }
        } else {
          for (let i = top; i >= 0; i--) {
            this.ensureBank(a.addr + i, a.sym, line);
            this.emit(`RRF ${this.ref(a.sym, i)}, F`, line);
          }
        }
        this.ensureBank(sh.addr, sh.name, line);
        this.emit(`DECFSZ ${sh.name}, F`, line);
        this.emit(`GOTO ${lloop}`, line);
        this.emitLabel(ldone, line);
        break;
      }
      default:
        this.err(line, `toán tử ${op} chưa hỗ trợ`);
        break;
    }
  }

  // =========================================================================
  // ĐIỀU KIỆN: genCond(node, labelTrue, labelFalse) — nhảy tới đúng 1 nhãn
  // =========================================================================
  bitInfoOfExpr(node) {
    if (!node) return null;
    if (node.kind === 'member') {
      if (node.arrow) return null;
      const m = resolveMember(node.baseName, node.field);
      return m.error ? null : { reg: m.reg, regAddr: m.regAddr, bit: m.bit };
    }
    if (node.kind === 'ident') {
      const v = this.lookupVar(node.name, node.line);
      if (v.isBit) return { reg: v.bitReg, regAddr: v.bitRegAddr, bit: v.bit };
    }
    return null;
  }

  genCond(node, labelTrue, labelFalse) {
    const line = node ? node.line : 1;
    if (!node) { this.emit(`GOTO ${labelFalse}`, line); return; }
    switch (node.kind) {
      case 'binary':
        if (node.op === '&&') {
          const lm = this.newLabel();
          this.genCond(node.left, lm, labelFalse);
          this.emitLabel(lm, line);
          this.genCond(node.right, labelTrue, labelFalse);
          return;
        }
        if (node.op === '||') {
          const lm = this.newLabel();
          this.genCond(node.left, labelTrue, lm);
          this.emitLabel(lm, line);
          this.genCond(node.right, labelTrue, labelFalse);
          return;
        }
        if (['<', '>', '<=', '>=', '==', '!='].includes(node.op)) {
          this.compareBranch(node.op, node.left, node.right, labelTrue, labelFalse, line);
          return;
        }
        break;
      case 'unary':
        if (node.op === '!') { this.genCond(node.expr, labelFalse, labelTrue); return; }
        break;
      case 'num':
        this.emit(`GOTO ${node.value !== 0 ? labelTrue : labelFalse}`, line);
        return;
      default:
        break;
    }
    const bit = this.bitInfoOfExpr(node);
    if (bit) {
      this.ensureBank(bit.regAddr, bit.reg, line);
      this.emit(`BTFSS ${bit.reg}, ${bit.bit}`, line);
      this.emit(`GOTO ${labelFalse}`, line);
      this.emit(`GOTO ${labelTrue}`, line);
      return;
    }
    const t = this.genExpr(node, 2, true);
    this.emitMovfW(t.addr, t.sym, 0, line);
    this.ensureBank(t.addr + 1, t.sym, line);
    this.emit(`IORWF ${t.sym}+1, W`, line);
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${labelFalse}`, line);
    this.emit(`GOTO ${labelTrue}`, line);
    this.freeTemp(t.width);
  }

  // Rẽ nhánh so sánh: nhảy tới labelTrue / labelFalse.
  compareBranch(op, leftNode, rightNode, labelTrue, labelFalse, line) {
    const cw = Math.max(this.naturalWidth(leftNode), this.naturalWidth(rightNode));
    const a = this.genExpr(leftNode, cw, true);
    const b = this.genExpr(rightNode, cw, true);
    const signed = this.signedOf(leftNode) && this.signedOf(rightNode);
    if (signed && op !== '==' && op !== '!=') {
      // So sánh có dấu: lật bit dấu của byte cao rồi so không dấu.
      const top = cw - 1;
      this.emitMovlw(0x80, line);
      this.ensureBank(a.addr + top, a.sym, line);
      this.emit(`XORWF ${this.ref(a.sym, top)}, F`, line);
      this.emitMovlw(0x80, line);
      this.ensureBank(b.addr + top, b.sym, line);
      this.emit(`XORWF ${this.ref(b.sym, top)}, F`, line);
    }
    const eq = (lEq, lNe) => this.eqBranch(a, b, cw, lEq, lNe, line);
    const lt = (x, y, lLt, lGe) => this.ltBranch(x, y, cw, lLt, lGe, line);
    if (op === '==') eq(labelTrue, labelFalse);
    else if (op === '!=') eq(labelFalse, labelTrue);
    else if (op === '<') lt(a, b, labelTrue, labelFalse);
    else if (op === '>') lt(b, a, labelTrue, labelFalse);
    else if (op === '<=') {
      const lm = this.newLabel();
      eq(labelTrue, lm);
      this.emitLabel(lm, line);
      lt(a, b, labelTrue, labelFalse);
    } else if (op === '>=') {
      const lm = this.newLabel();
      eq(labelTrue, lm);
      this.emitLabel(lm, line);
      lt(b, a, labelTrue, labelFalse);
    }
    this.freeTemp(b.width);
    this.freeTemp(a.width);
  }

  // A == B ? labelEq : labelNe (so sánh không dấu, W đã dùng xong).
  eqBranch(a, b, w, labelEq, labelNe, line) {
    this.emitMovfW(b.addr, b.sym, 0, line);
    this.ensureBank(a.addr, a.sym, line);
    this.emit(`SUBWF ${a.sym}, W`, line);
    if (w === 1) {
      this.emit('BTFSC STATUS, Z', line);
      this.emit(`GOTO ${labelEq}`, line);
      this.emit(`GOTO ${labelNe}`, line);
      return;
    }
    this.emit('BTFSS STATUS, Z', line);
    this.emit(`GOTO ${labelNe}`, line);
    this.emitMovfW(b.addr, b.sym, 1, line);
    this.ensureBank(a.addr + 1, a.sym, line);
    this.emit(`SUBWF ${a.sym}+1, W`, line);
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${labelEq}`, line);
    this.emit(`GOTO ${labelNe}`, line);
  }

  // A < B (không dấu) ? labelLt : labelGe.
  ltBranch(a, b, w, labelLt, labelGe, line) {
    if (w === 1) {
      this.emitMovfW(b.addr, b.sym, 0, line);
      this.ensureBank(a.addr, a.sym, line);
      this.emit(`SUBWF ${a.sym}, W`, line);
      this.emit('BTFSS STATUS, C', line);
      this.emit(`GOTO ${labelLt}`, line);
      this.emit(`GOTO ${labelGe}`, line);
      return;
    }
    this.emitMovfW(b.addr, b.sym, 1, line);
    this.ensureBank(a.addr + 1, a.sym, line);
    this.emit(`SUBWF ${a.sym}+1, W`, line);
    const leq = this.newLabel();
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${leq}`, line);
    this.emit('BTFSC STATUS, C', line);
    this.emit(`GOTO ${labelGe}`, line);
    this.emit(`GOTO ${labelLt}`, line);
    this.emitLabel(leq, line);
    this.emitMovfW(b.addr, b.sym, 0, line);
    this.ensureBank(a.addr, a.sym, line);
    this.emit(`SUBWF ${a.sym}, W`, line);
    this.emit('BTFSS STATUS, C', line);
    this.emit(`GOTO ${labelLt}`, line);
    this.emit(`GOTO ${labelGe}`, line);
  }

  // =========================================================================
  // GỌI HÀM + DELAY
  // =========================================================================
  genCall(node, want, valueUsed, line) {
    const name = node.name;
    if (name === '__delay_ms' || name === '__delay_us') {
      if (node.args.length !== 1) {
        this.err(line, `${name} cần 1 đối số`);
      } else {
        const v = evalConst(node.args[0]);
        if (v === null) {
          this.err(line, `${name} cần hằng số`);
        } else if (v < 0) {
          this.err(line, 'delay phải >= 0');
        } else {
          // 1 chu kỳ lệnh = 4 / _XTAL_FREQ giây.
          const cycles = name === '__delay_ms'
            ? Math.round((v * this.xtalFreq) / 4000)
            : Math.round((v * this.xtalFreq) / 4000000);
          this.emitDelay(cycles, line);
        }
      }
      if (valueUsed) this.err(line, 'hàm void không trả về giá trị');
      const r = this.allocTemp(want);
      r.signed = false;
      this.emitClrf(r.addr, r.sym, 0, line);
      if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
      return r;
    }
    const fn = this.funcs.get(name);
    if (!fn) {
      this.err(line, `chưa khai báo hàm ${name}`);
      return this.dummyTemp(want);
    }
    if (fn.returnType === 'void' && valueUsed) {
      this.err(line, 'hàm void không trả về giá trị');
    }
    if (node.args.length !== fn.params.length) {
      this.err(line, `hàm ${name} cần ${fn.params.length} đối số`);
    }
    const r = this.allocTemp(want);
    r.signed = fn.retSigned;
    const n = Math.min(node.args.length, fn.params.length);
    for (let i = 0; i < n; i++) {
      const p = fn.params[i];
      const a = this.genExpr(node.args[i], p.width, true);
      this.copyValue(a, p.addr, p.sym, p.width, line);
      this.freeTemp(a.width);
    }
    this.emit(`CALL ${fn.label}`, line);
    this.curBank = -1; // sau CALL, bank là không biết (xem ghi chú đầu file)
    if (fn.returnType !== 'void') {
      this.copyValue(
        { addr: fn.retAddr, sym: fn.retSym, width: fn.retWidth, signed: fn.retSigned },
        r.addr, r.sym, want, line,
      );
      // Quy ước: W = byte thấp của giá trị trả.
      this.emitMovfW(fn.retAddr, fn.retSym, 0, line);
    } else {
      this.emitClrf(r.addr, r.sym, 0, line);
      if (want === 2) this.emitClrf(r.addr, r.sym, 1, line);
    }
    return r;
  }

  // Chọn (R, hi, lo) sao cho tổng chu kỳ R*(3*lo + 776*hi + 11) + 2 gần
  // nhất với target. R tối đa: mỗi lần lặp ngoài tối đa 198656 chu kỳ.
  delayParams(target) {
    if (target <= 15) return { nops: target, total: target };
    let best = null;
    const r0 = Math.max(1, Math.ceil((target - 2) / 198656));
    for (let R = Math.max(1, r0 - 1); R <= r0 + 1; R++) {
      const per = (target - 2) / R;
      const inner = per - 11;
      const hi0 = Math.max(0, Math.min(255, Math.floor((inner - 3) / 776)));
      for (let hi = Math.max(0, hi0 - 2); hi <= Math.min(255, hi0 + 2); hi++) {
        const lo0 = Math.round((inner - 3 - 776 * hi) / 3);
        for (let lo = Math.max(1, lo0 - 4); lo <= Math.min(255, lo0 + 4); lo++) {
          const total = R * (3 * lo + 776 * hi + 11) + 2;
          const e = Math.abs(total - target);
          if (!best || e < best.err) best = { R, hi, lo, total, err: e };
        }
      }
    }
    return best;
  }

  // Sinh delay inline. Công thức chu kỳ (đếm từng lệnh, ĐÃ KIỂM CHỨNG
  // bằng đo PC trên CPU mô phỏng — xem ghi chú về lệnh skip ở dưới):
  //   vòng trong (D1:D0): mỗi lần D0 đếm 1 tốn 3 chu kỳ (DECFSZ+GOTO),
  //     lần D0 về 0 cũng tốn 3 (DECFSZ skip GOTO = 3 chu kỳ trong
  //     simulator này, vì lệnh bị skip là GOTO 2 chu kỳ) -> mỗi lần chạy
  //     trong tốn 3*k chu kỳ (k = số đếm). Sau mỗi lần chạy (trừ lần cuối):
  //     MOVF+BTFSC-skip-GOTO+DECF+CLRF+GOTO = 1+3+1+1+2 = 8 chu kỳ.
  //     Sau lần cuối: MOVF+BTFSC+GOTO = 1+1+2 = 4 chu kỳ.
  //     -> tổng vòng trong = 3*lo + 776*hi + 4 chu kỳ.
  //   vòng ngoài: nạp D1/D0 tốn 4 + vòng trong + DECFSZ D2 (3 chu kỳ,
  //     kể cả lần cuối vì skip GOTO cũng tốn 3) -> mỗi lần lặp ngoài =
  //     3*lo + 776*hi + 11 chu kỳ.
  //   cộng 2 chu kỳ nạp D2 ở đầu -> tổng = R*(3*lo + 776*hi + 11) + 2
  //   (chưa kể BANKSEL trước vòng lặp nếu bank lúc gọi khác bank 0 —
  //   đã trừ 2 chu kỳ đó vào target trước khi giải).
  //   Vòng lặp nhỏ nhất (R=1, hi=0, lo=1) tốn 16 chu kỳ nên delay <= 15
  //   chu kỳ thì dùng NOP (1 chu kỳ mỗi NOP) cho chính xác.
  emitDelay(cycles, line) {
    if (cycles <= 0) return;
    const bankCost = this.curBank === 0 ? 0 : 2;
    const target = cycles - bankCost;
    if (target <= 0) {
      // Delay quá ngắn, không đủ chỗ cho BANKSEL: dùng NOP, bank thành không biết.
      for (let i = 0; i < cycles; i++) this.emit('NOP', line);
      this.curBank = -1;
      return;
    }
    if (target <= 15) {
      this.ensureBank(HELPER.__C_D0.addr, HELPER.__C_D0.name, line);
      for (let i = 0; i < target; i++) this.emit('NOP', line);
      return;
    }
    const p = this.delayParams(target);
    const d0 = HELPER.__C_D0, d1 = HELPER.__C_D1, d2 = HELPER.__C_D2;
    this.emit(`; delay ~${p.total + bankCost} chu ky (R=${p.R}, hi=${p.hi}, lo=${p.lo})`, line);
    this.ensureBank(d2.addr, d2.name, line);
    this.emitMovlw(p.R, line);
    this.emitMovwf(d2.addr, d2.name, 0, line);
    const lOut = this.newLabel(), lIn = this.newLabel(), lChk = this.newLabel();
    this.emitLabel(lOut, line, true);
    this.emitMovlw(p.hi, line);
    this.emitMovwf(d1.addr, d1.name, 0, line);
    this.emitMovlw(p.lo, line);
    this.emitMovwf(d0.addr, d0.name, 0, line);
    this.emitLabel(lIn, line, true);
    this.emit(`DECFSZ ${d0.name}, F`, line);
    this.emit(`GOTO ${lIn}`, line);
    this.emit(`MOVF ${d1.name}, F`, line);
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${lChk}`, line);
    this.emit(`DECF ${d1.name}, F`, line);
    this.emit(`CLRF ${d0.name}`, line);
    this.emit(`GOTO ${lIn}`, line);
    this.emitLabel(lChk, line, true);
    this.emit(`DECFSZ ${d2.name}, F`, line);
    this.emit(`GOTO ${lOut}`, line);
    // curBank vẫn là 0 (mọi slot delay ở bank 0, nhãn keepBank).
  }

  // =========================================================================
  // CÂU LỆNH
  // =========================================================================
  genBlock(block) {
    this.scopes.push(new Map());
    for (const s of block.stmts) this.genStmt(s);
    this.scopes.pop();
  }

  genStmt(stmt) {
    if (!stmt) return;
    if (Array.isArray(stmt)) { for (const s of stmt) this.genStmt(s); return; }
    const line = stmt.line;
    switch (stmt.kind) {
      case 'block':
        this.genBlock(stmt);
        break;
      case 'vardecl': {
        const info = stmt._info;
        if (info) this.scopes[this.scopes.length - 1].set(stmt.name, info);
        this.genVarDeclInit(stmt, info, line);
        break;
      }
      case 'expr': {
        if (stmt.expr) {
          const t = this.genExpr(stmt.expr, 1, false);
          this.freeTemp(t.width);
        }
        break;
      }
      case 'if': {
        const lthen = this.newLabel();
        const lelse = this.newLabel();
        const lend = this.newLabel();
        this.genCond(stmt.cond, lthen, lelse);
        this.emitLabel(lthen, line);
        this.genStmt(stmt.then);
        this.emit(`GOTO ${lend}`, line);
        this.emitLabel(lelse, line);
        if (stmt.else) this.genStmt(stmt.else);
        this.emitLabel(lend, line);
        break;
      }
      case 'while': {
        const lcond = this.newLabel();
        const lbody = this.newLabel();
        const lend = this.newLabel();
        this.emitLabel(lcond, line);
        this.genCond(stmt.cond, lbody, lend);
        this.emitLabel(lbody, line);
        this.loopStack.push({ breakLabel: lend, continueLabel: lcond });
        this.genStmt(stmt.body);
        this.loopStack.pop();
        this.emit(`GOTO ${lcond}`, line);
        this.emitLabel(lend, line);
        break;
      }
      case 'dowhile': {
        const lbody = this.newLabel();
        const lcond = this.newLabel();
        const lend = this.newLabel();
        this.emitLabel(lbody, line);
        this.loopStack.push({ breakLabel: lend, continueLabel: lcond });
        this.genStmt(stmt.body);
        this.loopStack.pop();
        this.emitLabel(lcond, line);
        this.genCond(stmt.cond, lbody, lend);
        this.emitLabel(lend, line);
        break;
      }
      case 'for': {
        this.scopes.push(new Map());
        if (stmt.init) this.genStmt(stmt.init);
        const lcond = this.newLabel();
        const lbody = this.newLabel();
        const lincr = this.newLabel();
        const lend = this.newLabel();
        this.emitLabel(lcond, line);
        if (stmt.cond) this.genCond(stmt.cond, lbody, lend);
        this.emitLabel(lbody, line);
        this.loopStack.push({ breakLabel: lend, continueLabel: lincr });
        this.genStmt(stmt.body);
        this.loopStack.pop();
        this.emitLabel(lincr, line);
        if (stmt.incr) {
          const t = this.genExpr(stmt.incr, 1, false);
          this.freeTemp(t.width);
        }
        this.emit(`GOTO ${lcond}`, line);
        this.emitLabel(lend, line);
        this.scopes.pop();
        break;
      }
      case 'break': {
        const ctx = this.loopStack[this.loopStack.length - 1];
        if (!ctx) this.err(line, 'break ở ngoài vòng lặp hoặc switch');
        else this.emit(`GOTO ${ctx.breakLabel}`, line);
        break;
      }
      case 'continue': {
        const ctx = this.loopStack[this.loopStack.length - 1];
        if (!ctx || !ctx.continueLabel) this.err(line, 'continue ở ngoài vòng lặp');
        else this.emit(`GOTO ${ctx.continueLabel}`, line);
        break;
      }
      case 'return': {
        const fn = this.curFunc;
        if (!fn) { this.err(line, 'return ở ngoài hàm'); break; }
        if (stmt.expr && fn.retWidth > 0) {
          const v = this.genExpr(stmt.expr, fn.retWidth, true);
          this.copyValue(v, fn.retAddr, fn.retSym, fn.retWidth, line);
          this.emitMovfW(fn.retAddr, fn.retSym, 0, line); // W = byte thấp
          this.freeTemp(v.width);
        } else if (stmt.expr) {
          const v = this.genExpr(stmt.expr, 1, false);
          this.freeTemp(v.width);
        }
        this.emit(`GOTO ${fn.retLabel}`, line);
        break;
      }
      case 'switch': {
        // Tính giá trị switch ở 16-bit để case 300 không khớp nhầm char 44.
        const sw = this.genExpr(stmt.expr, 2, true);
        const lend = this.newLabel();
        const ldefault = stmt.defaultStmts ? this.newLabel() : lend;
        const caseLabels = stmt.cases.map(() => this.newLabel());
        stmt.cases.forEach((c, i) => {
          const v = c.value & 0xffff;
          const lnext = this.newLabel();
          this.emitMovlw(v & 0xff, line);
          this.ensureBank(sw.addr, sw.sym, line);
          this.emit(`SUBWF ${sw.sym}, W`, line);
          this.emit('BTFSS STATUS, Z', line);
          this.emit(`GOTO ${lnext}`, line);
          this.emitMovlw((v >> 8) & 0xff, line);
          this.ensureBank(sw.addr + 1, sw.sym, line);
          this.emit(`SUBWF ${sw.sym}+1, W`, line);
          this.emit('BTFSC STATUS, Z', line);
          this.emit(`GOTO ${caseLabels[i]}`, line);
          this.emitLabel(lnext, line);
        });
        this.emit(`GOTO ${ldefault}`, line);
        this.scopes.push(new Map());
        const outer = this.loopStack[this.loopStack.length - 1];
        this.loopStack.push({ breakLabel: lend, continueLabel: outer ? outer.continueLabel : null });
        stmt.cases.forEach((c, i) => {
          this.emitLabel(caseLabels[i], line);
          for (const s of c.stmts) this.genStmt(s);
        });
        if (stmt.defaultStmts) {
          this.emitLabel(ldefault, line);
          for (const s of stmt.defaultStmts) this.genStmt(s);
        }
        this.loopStack.pop();
        this.scopes.pop();
        this.emitLabel(lend, line);
        this.freeTemp(sw.width);
        break;
      }
      default:
        this.err(line, `câu lệnh chưa hỗ trợ (${stmt.kind})`);
        break;
    }
  }

  // Khởi tạo 1 biến (cục bộ hoặc toàn cục). Slot đã cấp phát ở prepass.
  genVarDeclInit(decl, info, line) {
    if (!decl || !decl.init || !info) return;
    if (info.isArray) {
      if (decl.init.kind === 'str') {
        const bytes = [...decl.init.value].map((c) => c.charCodeAt(0) & 0xff);
        bytes.push(0); // '\0' kết chuỗi
        for (let i = 0; i < info.count; i++) {
          this.setByte(info.addr, info.sym, i, i < bytes.length ? bytes[i] : 0, line);
        }
        return;
      }
      if (Array.isArray(decl.init)) {
        decl.init.forEach((e, j) => {
          const v = this.genExpr(e, info.elemWidth, true);
          for (let i = 0; i < info.elemWidth; i++) {
            this.emitMovfW(v.addr, v.sym, i, line);
            this.emitMovwf(info.addr, info.sym, j * info.elemWidth + i, line);
          }
          this.freeTemp(v.width);
        });
        for (let j = decl.init.length; j < info.count; j++) {
          for (let i = 0; i < info.elemWidth; i++) {
            this.emitClrf(info.addr, info.sym, j * info.elemWidth + i, line);
          }
        }
        return;
      }
      this.err(line, 'khởi tạo mảng phải dùng { } hoặc chuỗi');
      return;
    }
    if (decl.init.kind === 'str') {
      this.err(line, 'chuỗi chỉ dùng để khởi tạo mảng char');
      return;
    }
    const v = this.genExpr(decl.init, info.width, true);
    this.copyValue(v, info.addr, info.sym, info.width, line);
    this.freeTemp(v.width);
  }

  // =========================================================================
  // HÀM + KHUNG CHƯƠNG TRÌNH + HÀM TRỢ GIÚP RUNTIME
  // =========================================================================
  genFunction(fnInfo) {
    this.curFunc = fnInfo;
    const globalScope = new Map();
    for (const { decl, info } of this.globals) {
      if (decl.line < fnInfo.def.line) globalScope.set(decl.name, info);
    }
    const paramScope = new Map();
    for (const p of fnInfo.params) {
      if (p.name) paramScope.set(p.name, { name: p.name, addr: p.addr, sym: p.sym, width: p.width, signed: p.signed, isPointer: p.isPointer, elemWidth: p.elemWidth, elemSigned: p.elemSigned });
    }
    this.scopes = [globalScope, paramScope];
    this.emitLabel(fnInfo.label);
    this.genBlock(fnInfo.def.body);
    this.emitLabel(fnInfo.retLabel);
    this.emit('RETURN');
    this.scopes = [];
    this.curFunc = null;
  }

  emitCode() {
    if (!this.funcs.has('main')) {
      this.err(1, 'hàm main không có');
      return;
    }
    this.emit('ORG 0');
    this.emit('GOTO __C_START');
    this.emitLabel('__C_START');
    // Khởi tạo biến toàn cục (chạy 1 lần trước main).
    const globalScope = new Map();
    for (const { decl, info } of this.globals) globalScope.set(decl.name, info);
    this.scopes = [globalScope];
    this.curFunc = null;
    for (const { decl, info } of this.globals) {
      if (decl.init) this.genVarDeclInit(decl, info, decl.line);
    }
    this.scopes = [];
    this.emit('CALL __C_FN_MAIN');
    this.curBank = -1;
    this.emitLabel('__C_HALT');
    this.emit('GOTO __C_HALT');
    for (const fnInfo of this.funcs.values()) this.genFunction(fnInfo);
    if (this.usedMul) this.emitMul16();
    if (this.usedDiv) this.emitDiv16();
    this.emit('END');
  }

  // __C_MUL16: MR = MA * MB, không dấu 16-bit, cộng-dịch 16 vòng.
  // MA, MB bị hủy; MR giữ kết quả; MC là bộ đếm.
  emitMul16() {
    const ma = HELPER.__C_MA, mb = HELPER.__C_MB, mr = HELPER.__C_MR, mc = HELPER.__C_MC;
    const line = null;
    this.emitLabel('__C_MUL16');
    this.emit('; __C_MUL16: MR = MA * MB (16-bit, cong-dich 16 vong)', null);
    this.emitClrf(mr.addr, mr.name, 0, line);
    this.emitClrf(mr.addr, mr.name, 1, line);
    this.emitMovlw(16, line);
    this.emitMovwf(mc.addr, mc.name, 0, line);
    const lloop = this.newLabel(), lnoadd = this.newLabel();
    this.emitLabel(lloop, line, true);
    this.ensureBank(mb.addr, mb.name, line);
    this.emit(`BTFSS ${mb.name}, 0`, line);
    this.emit(`GOTO ${lnoadd}`, line);
    this.emitMovfW(ma.addr, ma.name, 0, line);
    this.ensureBank(mr.addr, mr.name, line);
    this.emit(`ADDWF ${mr.name}, F`, line);
    this.emitMovfW(ma.addr, ma.name, 1, line);
    this.emit('BTFSC STATUS, C', line);
    this.emit('ADDLW 1', line);
    this.ensureBank(mr.addr + 1, mr.name, line);
    this.emit(`ADDWF ${mr.name}+1, F`, line);
    this.emitLabel(lnoadd, line, true);
    this.emit('BCF STATUS, C', line);
    this.ensureBank(ma.addr, ma.name, line);
    this.emit(`RLF ${ma.name}, F`, line);
    this.ensureBank(ma.addr + 1, ma.name, line);
    this.emit(`RLF ${ma.name}+1, F`, line);
    this.emit('BCF STATUS, C', line);
    this.ensureBank(mb.addr + 1, mb.name, line);
    this.emit(`RRF ${mb.name}+1, F`, line);
    this.ensureBank(mb.addr, mb.name, line);
    this.emit(`RRF ${mb.name}, F`, line);
    this.ensureBank(mc.addr, mc.name, line);
    this.emit(`DECFSZ ${mc.name}, F`, line);
    this.emit(`GOTO ${lloop}`, line);
    this.emit('RETURN', line);
  }

  // __C_DIV16: DQ = DA / DB, DR = DA % DB, không dấu 16-bit, trừ-dịch 16 vòng.
  // DA bị hủy; DB giữ nguyên. DB == 0 -> DQ = 0, DR = DA.
  emitDiv16() {
    const da = HELPER.__C_DA, db = HELPER.__C_DB;
    const dq = HELPER.__C_DQ, dr = HELPER.__C_DR, dc = HELPER.__C_DC;
    const line = null;
    this.emitLabel('__C_DIV16');
    this.emit('; __C_DIV16: DQ = DA / DB, DR = DA % DB (khong dau 16-bit)', null);
    this.emitMovfW(db.addr, db.name, 0, line);
    this.ensureBank(db.addr + 1, db.name, line);
    this.emit(`IORWF ${db.name}+1, W`, line);
    const lzero = this.newLabel();
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${lzero}`, line);
    this.emitClrf(dq.addr, dq.name, 0, line);
    this.emitClrf(dq.addr, dq.name, 1, line);
    this.emitClrf(dr.addr, dr.name, 0, line);
    this.emitClrf(dr.addr, dr.name, 1, line);
    this.emitMovlw(16, line);
    this.emitMovwf(dc.addr, dc.name, 0, line);
    const lloop = this.newLabel(), leq = this.newLabel(), lge = this.newLabel(), llt = this.newLabel();
    this.emitLabel(lloop, line, true);
    this.emit('BCF STATUS, C', line);
    this.ensureBank(da.addr, da.name, line);
    this.emit(`RLF ${da.name}, F`, line);
    this.ensureBank(da.addr + 1, da.name, line);
    this.emit(`RLF ${da.name}+1, F`, line);
    this.ensureBank(dr.addr, dr.name, line);
    this.emit(`RLF ${dr.name}, F`, line);
    this.ensureBank(dr.addr + 1, dr.name, line);
    this.emit(`RLF ${dr.name}+1, F`, line);
    this.emit('BCF STATUS, C', line);
    this.ensureBank(dq.addr, dq.name, line);
    this.emit(`RLF ${dq.name}, F`, line);
    this.ensureBank(dq.addr + 1, dq.name, line);
    this.emit(`RLF ${dq.name}+1, F`, line);
    // So sánh DR >= DB ?
    this.emitMovfW(db.addr, db.name, 1, line);
    this.ensureBank(dr.addr + 1, dr.name, line);
    this.emit(`SUBWF ${dr.name}+1, W`, line);
    this.emit('BTFSC STATUS, Z', line);
    this.emit(`GOTO ${leq}`, line);
    this.emit('BTFSC STATUS, C', line);
    this.emit(`GOTO ${lge}`, line);
    this.emit(`GOTO ${llt}`, line);
    this.emitLabel(leq, line, true);
    this.emitMovfW(db.addr, db.name, 0, line);
    this.ensureBank(dr.addr, dr.name, line);
    this.emit(`SUBWF ${dr.name}, W`, line);
    this.emit('BTFSC STATUS, C', line);
    this.emit(`GOTO ${lge}`, line);
    this.emit(`GOTO ${llt}`, line);
    this.emitLabel(lge, line, true);
    // DR -= DB; đặt bit 0 của thương.
    this.emitMovfW(db.addr, db.name, 0, line);
    this.ensureBank(dr.addr, dr.name, line);
    this.emit(`SUBWF ${dr.name}, F`, line);
    this.emitMovfW(db.addr, db.name, 1, line);
    this.emit('BTFSS STATUS, C', line);
    this.emit('ADDLW 1', line);
    this.ensureBank(dr.addr + 1, dr.name, line);
    this.emit(`SUBWF ${dr.name}+1, F`, line);
    this.ensureBank(dq.addr, dq.name, line);
    this.emit(`BSF ${dq.name}, 0`, line);
    this.emitLabel(llt, line, true);
    this.ensureBank(dc.addr, dc.name, line);
    this.emit(`DECFSZ ${dc.name}, F`, line);
    this.emit(`GOTO ${lloop}`, line);
    this.emit('RETURN', line);
    this.emitLabel(lzero, line, true);
    this.emitClrf(dq.addr, dq.name, 0, line);
    this.emitClrf(dq.addr, dq.name, 1, line);
    this.emitMovfW(da.addr, da.name, 0, line);
    this.emitMovwf(dr.addr, dr.name, 0, line);
    this.emitMovfW(da.addr, da.name, 1, line);
    this.emitMovwf(dr.addr, dr.name, 1, line);
    this.emit('RETURN', line);
  }

  // =========================================================================
  // LẮP RÁP VĂN BẢN ASM HOÀN CHỈNH + BẢN ĐỒ DÒNG
  // =========================================================================
  buildAsm() {
    const lines = [];
    const push = (text, line = null) => lines.push({ text, line });
    push('; c-codegen.js: hop ngu sinh tu C (XC8 subset) cho PIC16F877A');
    push('; Kieu: int/uint 16-bit little-endian; char/uchar 8-bit.');
    push('; Tham so: slot __P_<ham>_<i>; tra ve: slot __R_<ham> (+ W = byte thap).');
    push('; Bien tam: pool __C_T0..47 (bank 0). Quy uoc bank sau CALL: khong biet.');
    push('; Program < 2048 tu lenh (CALL/GOTO 11-bit, PCLATH luon 0).');
    // CBLOCK: gom symbol theo từng đoạn địa chỉ liên tục.
    const sorted = [...this.allocs].sort((a, b) => a.addr - b.addr);
    let expect = null;
    for (const a of sorted) {
      if (expect === null || a.addr !== expect) {
        if (expect !== null) push('ENDC');
        push(`CBLOCK 0x${a.addr.toString(16).toUpperCase()}`);
      }
      push(a.size > 1 ? `${a.name}:${a.size}` : a.name);
      expect = a.addr + a.size;
    }
    if (expect !== null) push('ENDC');
    for (const o of this.out) push(o.text, o.line);
    const text = lines.map((l) => l.text).join('\n') + '\n';
    this._finalLines = lines;
    return text;
  }

  buildMap() {
    const map = new Map();
    const lines = this._finalLines || [];
    lines.forEach((l, i) => {
      if (l.line !== null && l.line !== undefined) map.set(i + 1, l.line);
    });
    return map;
  }
}

// c-frontend.js — FRONTEND cho trình biên dịch C (tập con XC8) của PIC16F877A.
//
// Đọc code C -> tiền xử lý -> lexer -> parser -> cây AST.
// KHÔNG sinh hợp ngữ, KHÔNG sinh mã máy: subagent codegen sẽ đọc AST này
// và sinh hợp ngữ rồi dùng assemble() trong public/pic16.js.
//
// Cách dùng:
//   import { parseC } from './c-frontend.js';
//   const { ast, errors, xtalFreq } = parseC(source);
//   // errors = []  -> ast hợp lệ, dùng được cho codegen
//   // errors != [] -> ast = null, báo lỗi cho sinh viên (errors[i] = {line, message})
//   // xtalFreq lấy từ #define _XTAL_FREQ, mặc định 4000000 (4 MHz)
//
// ---------------------------------------------------------------------------
// DẠNG AST (hợp đồng với codegen — đừng đổi tên kind/field nếu không báo
// cho subagent codegen):
//
// Program   {kind:'program', decls:[FuncDef|VarDecl...], defines:{TÊN: 'giá trị'}}
//   defines: toàn bộ #define (dạng chuỗi, vd _XTAL_FREQ -> '4000000'),
//   để codegen tra cứu. Không có trong hợp đồng gốc nhưng cần cho codegen.
// FuncDef   {kind:'func', name, returnType, params:[{name, type}], body:Block|null, line}
//   returnType/type là chuỗi: 'void' | 'char' | 'uchar' | 'int' | 'uint'
//   (unsigned char -> 'uchar', unsigned int -> 'uint'). body = null chỉ khi
//   là khai báo mẫu (prototype) dạng `void f(int);` — codegen bỏ qua.
//   Param có thể có thêm field pointer:true (vd `char *s`).
// VarDecl   {kind:'vardecl', type, name, arraySize:number|null, init:Expr|null|Expr[],
//            isArray:boolean, line}
//   arraySize = null khi không phải mảng, hoặc mảng không ghi kích thước
//   (vd `char s[] = "hi";` — phân biệt bằng isArray). Mảng khởi tạo
//   `{1,2,3}` thì init là mảng các Expr; `char s[]="hi"` thì init là Str.
//   Có thể có thêm field pointer:true (vd `char *p;`).
// Block     {kind:'block', stmts:[Stmt...], line}
// Stmt:
//   ExprStmt {kind:'expr', expr:Expr|null, line}        (expr=null: câu lệnh `;`)
//   If       {kind:'if', cond, then:Stmt, else:Stmt|null, line}
//   While    {kind:'while', cond, body:Stmt, line}
//   DoWhile  {kind:'dowhile', cond, body:Stmt, line}
//   For      {kind:'for', init:Stmt|null, cond:Expr|null, incr:Expr|null, body:Stmt, line}
//     init là VarDecl (1 biến, vd `for (int i=0;...)`), hoặc Block chứa nhiều
//     VarDecl (vd `for (int i=0, j=0;...)`), hoặc ExprStmt, hoặc null.
//   Break    {kind:'break', line}
//   Continue {kind:'continue', line}
//   Return   {kind:'return', expr:Expr|null, line}
//   Switch   {kind:'switch', expr, cases:[{value:number, stmts:[Stmt...]}],
//             defaultStmts:[Stmt...]|null, line}
//   VarDecl  (khai báo biến cục bộ — dùng chung node VarDecl ở trên)
// Expr:
//   Num     {kind:'num', value:number, type:'int'|'char', line}
//           ('A' -> value 65, type 'char'; số nguyên -> type 'int')
//   Str     {kind:'str', value:string, line}
//   Ident   {kind:'ident', name:string, line}
//   Binary  {kind:'binary', op, left, right, line}
//           op: '+','-','*','/','%','<<','>>','<','>','<=','>=','==','!=',
//               '&','|','^','&&','||'
//   Unary   {kind:'unary', op, expr, prefix:boolean, line}
//           op: '-','!','~','++','--','+','*','&'
//           ('*' và '&' là con trỏ: parser nhận cú pháp, codegen báo
//           "chưa hỗ trợ con trỏ". 'cast' xem dưới.)
//           Riêng ép kiểu `(unsigned char)x` -> {kind:'unary', op:'cast',
//           castType:'uchar', expr, prefix:true, line}.
//   Assign  {kind:'assign', op, target, value, line}
//           op: '=','+=','-=','*=','/=','%=','&=','|=','^=','<<=','>>='
//           target thường là Ident | Member | Index (hoặc Unary '*' cho *p=...)
//   Call    {kind:'call', name:string, args:[Expr...], line}
//           Hai hàm builtin __delay_ms/__delay_us được parser chấp nhận mà
//           không cần định nghĩa (codegen xử lý riêng, theo _XTAL_FREQ).
//   Index   {kind:'index', base:Expr, index:Expr, line}      (a[i])
//   Member  {kind:'member', baseName:string, field:string, line}
//           CHỈ dạng Xbits.Y, vd PORTBbits.RB0 (baseName là tên struct,
//           field là tên bit). Dạng con trỏ p->x cũng ra node này nhưng
//           có thêm field arrow:true (codegen báo "chưa hỗ trợ con trỏ").
//   Ternary {kind:'ternary', cond, then, else, line}
// ---------------------------------------------------------------------------
// Thứ tự ưu tiên toán tử (thấp -> cao): gán < ?: < || < && < | < ^ < & <
// ==/!= < quan hệ < shift < cộng/trừ < nhân/chia/mod < một ngôi < hậu tố
// (call/index/member/++/--).
//
// Kiểm tra ngữ nghĩa tối thiểu ở parser: hàm main phải tồn tại; biến dùng
// trước khi khai báo trong cùng phạm vi -> lỗi; gọi hàm chưa định nghĩa ->
// lỗi (trừ __delay_ms/__delay_us); return có giá trị trong hàm void -> lỗi;
// break/continue ngoài vòng lặp/switch -> lỗi. KHÔNG kiểm tra kiểu chặt.
//
// Lỗi trả về dạng [{line, message}] — line là số dòng C GỐC, message tiếng
// Việt ngắn gọn cho sinh viên. Gặp lỗi cú pháp đầu tiên thì dừng parse
// (ast=null); lỗi ngữ nghĩa thì gom nhiều lỗi một lúc.
// ---------------------------------------------------------------------------

// --- Tên thanh ghi / bit PIC16F877A (từ public/pic16.js: REGISTERS +
// BIT_NAMES) và các struct bit kiểu XC8 (PORTBbits, TRISBbits...). Những tên
// này được coi là "đã khai báo sẵn" (do #include <xc.h> cung cấp) nên dùng
// trong code C không bị báo "chưa khai báo biến". ---
const SFR_NAMES = new Set([
  // REGISTERS (pic16.js)
  'INDF', 'TMR0', 'PCL', 'STATUS', 'FSR', 'PORTA', 'PORTB', 'PORTC', 'PORTD',
  'PORTE', 'PCLATH', 'INTCON', 'PIR1', 'PIR2', 'TMR1L', 'TMR1H', 'T1CON',
  'TMR2', 'T2CON', 'SSPBUF', 'SSPCON', 'CCPR1L', 'CCPR1H', 'CCP1CON',
  'RCSTA', 'TXREG', 'RCREG', 'CCPR2L', 'CCPR2H', 'CCP2CON', 'ADRESH',
  'ADCON0', 'OPTION_REG', 'OPTION', 'TRISA', 'TRISB', 'TRISC', 'TRISD',
  'TRISE', 'PIE1', 'PIE2', 'PCON', 'SSPCON2', 'PR2', 'SSPADD', 'SSPSTAT',
  'TXSTA', 'SPBRG', 'CMCON', 'CVRCON', 'ADRESL', 'ADCON1', 'EEDATA',
  'EEADR', 'EECON1', 'EECON2', 'EEDATH', 'EEADRH',
  // BIT_NAMES (pic16.js)
  'C', 'DC', 'Z', 'PD', 'TO', 'RP0', 'RP1', 'IRP', 'RBIF', 'INTF', 'TMR0IF',
  'RBIE', 'INTE', 'TMR0IE', 'PEIE', 'GIE', 'ADON', 'GO', 'GO_DONE', 'DONE',
  'NOT_DONE', 'CHS0', 'CHS1', 'CHS2', 'ADCS0', 'ADCS1', 'ADIF', 'RCIF',
  'TXIF', 'TMR1IF', 'TMR2IF', 'CCP1IF', 'SSPIF', 'PSPIF', 'TX9', 'TXEN',
  'SYNC', 'BRGH', 'TRMT', 'TX9D', 'CSRC', 'SPEN', 'RX9', 'SREN', 'CREN',
  'ADDEN', 'FERR', 'OERR', 'RX9D', 'PS0', 'PS1', 'PS2', 'PSA', 'T0SE',
  'T0CS', 'INTEDG', 'RBPU', 'ADFM', 'PCFG0', 'PCFG1', 'PCFG2', 'PCFG3',
  'PSPMODE', 'IBOV', 'OBF', 'IBF', 'NOT_BOR', 'NOT_POR', 'CCP2IF', 'BCLIF',
  'EEIF', 'CMIF', 'CM0', 'CM1', 'CM2', 'CIS', 'C1INV', 'C2INV', 'C1OUT',
  'C2OUT', 'CVR0', 'CVR1', 'CVR2', 'CVR3', 'CVRSS', 'CVRR', 'CVROE',
  'CVREN', 'RD', 'WR', 'WREN', 'WRERR', 'EEPGD', 'SEN', 'RSEN', 'PEN',
  'RCEN', 'ACKEN', 'ACKDT', 'ACKSTAT', 'GCEN', 'TMR1ON', 'TMR1CS', 'T1SYNC',
  'NOT_T1SYNC', 'T1OSCEN', 'T1CKPS0', 'T1CKPS1', 'T2CKPS0', 'T2CKPS1',
  'TMR2ON', 'TOUTPS0', 'TOUTPS1', 'TOUTPS2', 'TOUTPS3', 'CCP1M0', 'CCP1M1',
  'CCP1M2', 'CCP1M3', 'CCP1Y', 'CCP1X', 'CCP2M0', 'CCP2M1', 'CCP2M2',
  'CCP2M3', 'CCP2Y', 'CCP2X', 'SSPM0', 'SSPM1', 'SSPM2', 'SSPM3', 'CKP',
  'SSPEN', 'SSPOV', 'WCOL', 'BF', 'UA', 'R_NW', 'D_NA', 'CKE', 'SMP',
  'TMR1IE', 'TMR2IE', 'CCP1IE', 'SSPIE', 'TXIE', 'RCIE', 'ADIE', 'PSPIE',
  'CCP2IE', 'BCLIE', 'EEIE', 'CMIE',
  'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5',
  'RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7',
  'RC0', 'RC1', 'RC2', 'RC3', 'RC4', 'RC5', 'RC6', 'RC7',
  'RD0', 'RD1', 'RD2', 'RD3', 'RD4', 'RD5', 'RD6', 'RD7',
  'RE0', 'RE1', 'RE2',
  // Struct bit kiểu XC8 (tên ...bits — parser còn chấp nhận mọi tên
  // kết thúc bằng "bits", nên danh sách này chỉ để tra cứu rõ ràng)
  'PORTAbits', 'PORTBbits', 'PORTCbits', 'PORTDbits', 'PORTEbits',
  'TRISAbits', 'TRISBbits', 'TRISCbits', 'TRISDbits', 'TRISEbits',
  'INTCONbits', 'STATUSbits', 'ADCON0bits', 'ADCON1bits', 'TXSTAbits',
  'RCSTAbits', 'PIR1bits', 'PIR2bits', 'PIE1bits', 'PIE2bits', 'T1CONbits',
  'T2CONbits', 'OPTION_REGbits', 'SSPCONbits', 'SSPSTATbits', 'CCP1CONbits',
  'CCP2CONbits', 'CMCONbits', 'CVRCONbits', 'EECON1bits',
]);

// Hàm builtin do codegen xử lý riêng (không cần định nghĩa trong code C).
const BUILTIN_FUNCS = new Set(['__delay_ms', '__delay_us']);

const DEFAULT_XTAL_FREQ = 4000000;

const KEYWORDS = new Set([
  'void', 'char', 'unsigned', 'int', 'signed', 'short', 'long', 'float',
  'double', 'const', 'static', 'volatile', 'if', 'else', 'while', 'do',
  'for', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'struct', 'enum', 'typedef',
]);

const TYPE_KEYWORDS = new Set([
  'void', 'char', 'unsigned', 'int', 'signed', 'short', 'long', 'float', 'double',
]);
const QUALIFIERS = new Set(['const', 'static', 'volatile']);
const UNSUPPORTED_TYPES = new Set(['short', 'long', 'float', 'double']);

// ===========================================================================
// TIỀN XỬ LÝ — xử lý theo dòng để GIỮ NGUYÊN số dòng (lỗi báo đúng dòng C gốc)
// ===========================================================================

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Bỏ comment // và /* */ nhưng giữ nguyên số dòng: ký tự trong comment
// thành khoảng trắng, ký tự xuống dòng giữ nguyên. Không chạm // hay /*
// nằm trong chuỗi "..." / ký tự '...'.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | str | chr
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (state === 'code') {
      if (ch === '/' && nx === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && nx === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (ch === '"') { state = 'str'; out += ch; i++; continue; }
      if (ch === "'") { state = 'chr'; out += ch; i++; continue; }
      out += ch; i++; continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch; i++; continue; }
      out += ' '; i++; continue;
    }
    if (state === 'block') {
      if (ch === '*' && nx === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (ch === '\n' ? '\n' : ' '); i++; continue;
    }
    if (state === 'str' || state === 'chr') {
      const close = state === 'str' ? '"' : "'";
      out += ch;
      if (ch === '\\' && i + 1 < n) { out += src[i + 1]; i += 2; continue; }
      if (ch === close) state = 'code';
      i++; continue;
    }
  }
  return out;
}

// Giá trị #define mà chứa toán tử thì bọc trong (...) để khi thay thế vào
// giữa biểu thức không sai thứ tự ưu tiên (vd X=1+2, dùng `a*X` -> `a*(1+2)`).
function wrapDefineValue(v) {
  const s = v.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s; // định danh
  if (/^-?(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+(\.[0-9]*)?)([uUlL]*)$/.test(s)) return s; // số
  if (/^'([^'\\]|\\.)'$/.test(s) || /^"(?:[^"\\]|\\.)*"$/.test(s)) return s; // ký tự / chuỗi
  if (s.startsWith('(') && s.endsWith(')') && parensMatch(s)) return s;
  if (/[+\-*\/%<>&|^?:]/.test(s)) return `(${s})`;
  return s;
}

function parensMatch(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0 && i !== s.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// Thay tên #define bằng giá trị trong 1 dòng code (chỉ thay toàn từ, không
// chạm chuỗi "..." / ký tự '...'). Lặp để #define lồng nhau cũng thay được.
function substituteDefines(line, defines) {
  const names = Object.keys(defines);
  if (!names.length) return line;
  const parts = line.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g);
  for (let p = 0; p < parts.length; p += 2) {
    let seg = parts[p];
    for (let iter = 0; iter < 8; iter++) {
      let changed = false;
      for (const name of names) {
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
        const next = seg.replace(re, defines[name]);
        if (next !== seg) { seg = next; changed = true; }
      }
      if (!changed) break;
    }
    parts[p] = seg;
  }
  return parts.join('');
}

// --- Tính giá trị biểu thức hằng số đơn giản (dùng cho _XTAL_FREQ, #if,
// kích thước mảng, giá trị case). Trả về số nguyên, hoặc null nếu không
// tính được (vd còn tên chưa define). ---
function evalConstString(str, defines) {
  let s = String(str);
  // defined(TÊN) / defined TÊN -> 1 hoặc 0
  s = s.replace(/defined\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
    (_, n) => (n in defines ? '1' : '0'));
  s = s.replace(/defined\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, n) => (n in defines ? '1' : '0'));
  s = substituteDefines(s, defines);
  const tokens = tokenizeConstExpr(s);
  if (!tokens) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseOr() {
    let v = parseAnd();
    while (peek() === '||') { next(); const r = parseAnd(); if (v === null || r === null) return null; v = (v || r) ? 1 : 0; }
    return v;
  }
  function parseAnd() {
    let v = parseBitOr();
    while (peek() === '&&') { next(); const r = parseBitOr(); if (v === null || r === null) return null; v = (v && r) ? 1 : 0; }
    return v;
  }
  function parseBitOr() {
    let v = parseBitXor();
    while (peek() === '|') { next(); const r = parseBitXor(); if (v === null || r === null) return null; v = v | r; }
    return v;
  }
  function parseBitXor() {
    let v = parseBitAnd();
    while (peek() === '^') { next(); const r = parseBitAnd(); if (v === null || r === null) return null; v = v ^ r; }
    return v;
  }
  function parseBitAnd() {
    let v = parseEq();
    while (peek() === '&') { next(); const r = parseEq(); if (v === null || r === null) return null; v = v & r; }
    return v;
  }
  function parseEq() {
    let v = parseRel();
    while (peek() === '==' || peek() === '!=') {
      const op = next(); const r = parseRel();
      if (v === null || r === null) return null;
      v = op === '==' ? (v === r ? 1 : 0) : (v !== r ? 1 : 0);
    }
    return v;
  }
  function parseRel() {
    let v = parseShift();
    while (peek() === '<' || peek() === '>' || peek() === '<=' || peek() === '>=') {
      const op = next(); const r = parseShift();
      if (v === null || r === null) return null;
      v = op === '<' ? (v < r ? 1 : 0) : op === '>' ? (v > r ? 1 : 0)
        : op === '<=' ? (v <= r ? 1 : 0) : (v >= r ? 1 : 0);
    }
    return v;
  }
  function parseShift() {
    let v = parseAdd();
    while (peek() === '<<' || peek() === '>>') {
      const op = next(); const r = parseAdd();
      if (v === null || r === null) return null;
      v = op === '<<' ? v << r : v >> r;
    }
    return v;
  }
  function parseAdd() {
    let v = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = next(); const r = parseMul();
      if (v === null || r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseMul() {
    let v = parseUnary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(); const r = parseUnary();
      if (v === null || r === null) return null;
      if (op === '*') v = v * r;
      else if (op === '/') { if (r === 0) return null; v = Math.trunc(v / r); }
      else { if (r === 0) return null; v = v % r; }
    }
    return v;
  }
  function parseUnary() {
    const t = peek();
    if (t === '-') { next(); const v = parseUnary(); return v === null ? null : -v; }
    if (t === '+') { next(); return parseUnary(); }
    if (t === '~') { next(); const v = parseUnary(); return v === null ? null : ~v; }
    if (t === '!') { next(); const v = parseUnary(); return v === null ? null : (v ? 0 : 1); }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = next();
    if (typeof t === 'number') return Math.trunc(t);
    if (t === '(') {
      const v = parseOr();
      if (next() !== ')') return null;
      return v;
    }
    return null; // còn định danh lạ, chuỗi, ... -> không tính được
  }
  const result = parseOr();
  if (pos !== tokens.length) return null;
  return result;
}

// Tách biểu thức hằng thành token (số -> number, toán tử/dấu ngoặc -> chuỗi).
// Trả null nếu gặp ký tự lạ.
function tokenizeConstExpr(s) {
  const tokens = [];
  let i = 0;
  const ops = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||'];
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'") {
      const m = s.slice(i).match(/^'(\\.|[^'\\])'/);
      if (!m) return null;
      tokens.push(unescapeChar(m[1]));
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let m = s.slice(i).match(/^0[xX][0-9a-fA-F]+[uUlL]*/);
      if (m) { tokens.push(parseInt(m[0].replace(/[uUlL]+$/, ''), 16)); i += m[0].length; continue; }
      m = s.slice(i).match(/^0[bB][01]+[uUlL]*/);
      if (m) { tokens.push(parseInt(m[0].replace(/[uUlL]+$/, '').slice(2), 2)); i += m[0].length; continue; }
      m = s.slice(i).match(/^[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?[uUlL]*/);
      if (m) { tokens.push(Number(m[0].replace(/[uUlL]+$/, ''))); i += m[0].length; continue; }
      return null;
    }
    let matched = false;
    for (const op of ops) {
      if (s.startsWith(op, i)) { tokens.push(op); i += op.length; matched = true; break; }
    }
    if (matched) continue;
    if ('+-*/%<>&|^!~()'.includes(ch)) { tokens.push(ch); i++; continue; }
    return null; // định danh còn sót, chuỗi, ... -> không tính được
  }
  return tokens;
}

// Giải mã 1 ký tự escape trong '...' thành mã ký tự (vd '\n' -> 10).
function unescapeChar(body) {
  if (body.length === 1) return body.charCodeAt(0);
  if (body[0] !== '\\') return body.charCodeAt(0);
  const e = body[1];
  switch (e) {
    case 'n': return 10;
    case 't': return 9;
    case 'r': return 13;
    case '0': return 0;
    case 'a': return 7;
    case 'b': return 8;
    case 'f': return 12;
    case 'v': return 11;
    case '\\': return 92;
    case "'": return 39;
    case '"': return 34;
    case 'x': {
      const hex = body.slice(2);
      const v = parseInt(hex, 16);
      return Number.isNaN(v) ? 0 : v;
    }
    default: {
      if (/[0-7]/.test(e)) {
        const v = parseInt(body.slice(1), 8);
        return Number.isNaN(v) ? 0 : v;
      }
      return e.charCodeAt(0);
    }
  }
}

// Giải mã nội dung chuỗi "..." (đã bỏ dấu ngoặc) thành giá trị thật.
function unescapeString(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const e = body[i + 1];
    if (e === undefined) { out += '\\'; break; }
    if (e === 'x') {
      const m = body.slice(i + 2).match(/^[0-9a-fA-F]+/);
      if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += 1 + m[0].length; continue; }
      out += 'x'; i++; continue;
    }
    if (/[0-7]/.test(e)) {
      const m = body.slice(i + 1).match(/^[0-7]{1,3}/);
      out += String.fromCharCode(parseInt(m[0], 8)); i += m[0].length; continue;
    }
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      default: out += e; break;
    }
    i++;
  }
  return out;
}

// Tiền xử lý: trả {code, errors, defines, xtalFreq}.
// code giữ nguyên số dòng với source gốc (dòng directive / dòng bị #if loại
// thành dòng trống) để lexer/parser báo lỗi đúng dòng C gốc.
export function preprocessC(source) {
  const errors = [];
  const defines = {};
  const noComment = stripComments(String(source));
  const lines = noComment.split('\n');
  const out = [];
  // Ngăn xếp #if: {parentActive, active, taken, seenElse, line}
  const condStack = [];
  const isActive = () => condStack.every((f) => f.active);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    const dirMatch = trimmed.match(/^#\s*([A-Za-z]+)\b\s*(.*)$/);
    if (dirMatch) {
      const dir = dirMatch[1].toLowerCase();
      const rest = dirMatch[2] || '';
      // --- Nhóm điều kiện: xử lý cả khi nhánh ngoài đang tắt (để đếm lồng) ---
      if (dir === 'ifdef' || dir === 'ifndef' || dir === 'if') {
        const parentActive = isActive();
        let cond = false;
        if (parentActive) {
          if (dir === 'ifdef' || dir === 'ifndef') {
            const nm = (rest.trim().split(/\s+/)[0] || '');
            cond = dir === 'ifdef' ? (nm in defines) : !(nm in defines);
          } else {
            const v = evalConstString(rest, defines);
            cond = v !== null && v !== 0;
          }
        }
        condStack.push({
          parentActive, active: parentActive && cond,
          taken: parentActive && cond, seenElse: false, line: lineNo,
        });
        out.push('');
        continue;
      }
      if (dir === 'elif') {
        const top = condStack[condStack.length - 1];
        if (!top) {
          errors.push({ line: lineNo, message: 'thừa #elif (không có #if tương ứng)' });
          out.push(''); continue;
        }
        if (top.seenElse) {
          errors.push({ line: lineNo, message: '#elif đặt sau #else' });
          top.active = false; out.push(''); continue;
        }
        let cond = false;
        if (top.parentActive && !top.taken) {
          const v = evalConstString(rest, defines);
          cond = v !== null && v !== 0;
        }
        top.active = top.parentActive && !top.taken && cond;
        if (top.active) top.taken = true;
        out.push(''); continue;
      }
      if (dir === 'else') {
        const top = condStack[condStack.length - 1];
        if (!top) {
          errors.push({ line: lineNo, message: 'thừa #else (không có #if tương ứng)' });
          out.push(''); continue;
        }
        if (top.seenElse) errors.push({ line: lineNo, message: 'trùng #else' });
        top.seenElse = true;
        top.active = top.parentActive && !top.taken;
        top.taken = true;
        out.push(''); continue;
      }
      if (dir === 'endif') {
        if (!condStack.length) {
          errors.push({ line: lineNo, message: 'thừa #endif (không có #if tương ứng)' });
        } else condStack.pop();
        out.push(''); continue;
      }
      // --- Các directive còn lại: chỉ có hiệu lực khi nhánh đang bật ---
      if (!isActive()) { out.push(''); continue; }
      if (dir === 'define') {
        const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/s);
        if (!m) {
          errors.push({ line: lineNo, message: '#define không hiểu' });
          out.push(''); continue;
        }
        const name = m[1];
        const afterName = rest.slice(name.length);
        if (afterName.startsWith('(')) {
          // Macro hàm f(x)... — không hỗ trợ (không có khoảng trắng giữa
          // tên và '(' mới tính là macro hàm; `#define X (1+2)` thì không).
          errors.push({ line: lineNo, message: `macro hàm chưa hỗ trợ (${name})` });
          out.push(''); continue;
        }
        const value = (m[2] || '').trim();
        defines[name] = value === '' ? '1' : wrapDefineValue(value);
        out.push(''); continue;
      }
      if (dir === 'undef') {
        const nm = (rest.trim().split(/\s+/)[0] || '');
        if (nm) delete defines[nm];
        out.push(''); continue;
      }
      if (dir === 'include') { out.push(''); continue; } // <xc.h> hay khác: bỏ qua
      if (dir === 'pragma') { out.push(''); continue; } // #pragma config: bỏ qua
      if (dir === 'error') {
        errors.push({ line: lineNo, message: (rest.trim() || '#error') });
        out.push(''); continue;
      }
      if (dir === 'warning') { out.push(''); continue; }
      out.push(''); continue; // directive lạ: bỏ qua lặng
    }
    // Dòng code thường: nhánh #if đang tắt -> thành dòng trống (giữ số dòng)
    if (!isActive()) { out.push(''); continue; }
    out.push(substituteDefines(line, defines));
  }
  if (condStack.length) {
    const f = condStack[condStack.length - 1];
    errors.push({ line: f.line, message: '#if chưa có #endif' });
  }
  // _XTAL_FREQ: tính từ giá trị define (đã mở rộng các define khác)
  let xtalFreq = DEFAULT_XTAL_FREQ;
  if ('_XTAL_FREQ' in defines) {
    const v = evalConstString(defines['_XTAL_FREQ'], defines);
    if (v !== null && Number.isFinite(v) && v > 0) xtalFreq = Math.trunc(v);
  }
  return { code: out.join('\n'), errors, defines, xtalFreq };
}

// ===========================================================================
// LEXER — tách token, mỗi token có line = dòng C gốc
// ===========================================================================

// Token: {type, value, line}
//   type 'num': value là số (JS number), kèm raw (chuỗi gốc) và isFloat
//   type 'char': value là mã ký tự (vd 'A' -> 65)
//   type 'str': value là chuỗi đã giải escape
//   type 'ident' | 'keyword': value là tên / từ khoá
//   type 'op': value là toán tử / dấu câu
//   type 'eof': cuối file
const OPERATORS = [
  '<<=', '>>=', '...', '++', '--', '->', '<=', '>=', '==', '!=', '&&',
  '||', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  ';', ',', '(', ')', '{', '}', '[', ']', ':', '?', '.', '=',
  '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '#',
];

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}
function isIdentChar(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

export function tokenizeC(code) {
  const tokens = [];
  const errors = [];
  let i = 0;
  let line = 1;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }
    // Định danh / từ khoá
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentChar(code[j])) j++;
      const word = code.slice(i, j);
      tokens.push({ type: KEYWORDS.has(word) ? 'keyword' : 'ident', value: word, line });
      i = j;
      continue;
    }
    // Số: 0x.., 0b.., 0.., thập phân, số thực (1.5, .5, 1e3)
    if (isDigit(ch) || (ch === '.' && isDigit(code[i + 1] || ''))) {
      const startLine = line;
      const rest = code.slice(i);
      let m = rest.match(/^0[xX][0-9a-fA-F]+[uUlL]*/);
      if (m) {
        tokens.push({ type: 'num', value: parseInt(m[0].replace(/[uUlL]+$/, ''), 16), raw: m[0], isFloat: false, line: startLine });
        i += m[0].length;
        continue;
      }
      m = rest.match(/^0[bB][01]+[uUlL]*/);
      if (m) {
        const digits = m[0].replace(/[uUlL]+$/, '').slice(2);
        tokens.push({ type: 'num', value: parseInt(digits, 2), raw: m[0], isFloat: false, line: startLine });
        i += m[0].length;
        continue;
      }
      m = rest.match(/^(?:[0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?[uUlLfF]*/);
      if (m) {
        const raw = m[0];
        const clean = raw.replace(/[uUlLfF]+$/, '');
        const isFloat = /[.eE]/.test(clean) || /[fF]$/.test(raw);
        let value;
        if (/^0[0-9]+$/.test(clean) && !/[.eE]/.test(clean)) {
          // Số bát phân (0..); chứa 8/9 thì đọc như thập phân cho đỡ gắt
          value = /^[0-7]+$/.test(clean.slice(1)) ? parseInt(clean, 8) : parseInt(clean, 10);
        } else {
          value = isFloat ? parseFloat(clean) : parseInt(clean, 10);
        }
        if (Number.isNaN(value)) {
          errors.push({ line: startLine, message: `số không hợp lệ "${raw}"` });
        } else {
          tokens.push({ type: 'num', value, raw, isFloat, line: startLine });
        }
        i += raw.length;
        continue;
      }
      errors.push({ line: startLine, message: `số không hợp lệ "${rest.slice(0, 8)}"` });
      i++;
      continue;
    }
    // Ký tự 'A', '\n', '\0', '\x41'
    if (ch === "'") {
      const startLine = line;
      let j = i + 1;
      let body = '';
      let closed = false;
      while (j < n) {
        const c = code[j];
        if (c === '\n') break;
        if (c === '\\' && j + 1 < n) { body += code.slice(j, j + 2); j += 2; continue; }
        if (c === "'") { closed = true; j++; break; }
        body += c; j++;
      }
      if (!closed) {
        errors.push({ line: startLine, message: 'ký tự chưa đóng' });
        i = j;
        continue;
      }
      // Ký tự nhiều chữ ('AB') thì lấy chữ đầu — đủ cho code lab
      let value = 0;
      if (body.length > 0) {
        if (body[0] === '\\') {
          if (body[1] === 'x') {
            const hex = body.slice(2).match(/^[0-9a-fA-F]+/);
            value = hex ? parseInt(hex[0], 16) : 0;
          } else if (/[0-7]/.test(body[1] || '')) {
            const oct = body.slice(1).match(/^[0-7]{1,3}/);
            value = oct ? parseInt(oct[0], 8) : 0;
          } else {
            value = unescapeChar(body.slice(0, 2));
          }
        } else {
          value = body.charCodeAt(0);
        }
      }
      tokens.push({ type: 'char', value, line: startLine });
      i = j;
      continue;
    }
    // Chuỗi "..."
    if (ch === '"') {
      const startLine = line;
      let j = i + 1;
      let body = '';
      let closed = false;
      while (j < n) {
        const c = code[j];
        if (c === '\n') break;
        if (c === '\\' && j + 1 < n) { body += code.slice(j, j + 2); j += 2; continue; }
        if (c === '"') { closed = true; j++; break; }
        body += c; j++;
      }
      if (!closed) {
        errors.push({ line: startLine, message: 'chuỗi chưa đóng' });
        i = j;
        continue;
      }
      tokens.push({ type: 'str', value: unescapeString(body), line: startLine });
      i = j;
      continue;
    }
    // Toán tử / dấu câu (dài trước, ngắn sau)
    let matched = false;
    for (const op of OPERATORS) {
      if (code.startsWith(op, i)) {
        tokens.push({ type: 'op', value: op, line });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // Ký tự lạ
    errors.push({ line, message: `ký tự lạ "${ch}"` });
    i++;
  }
  tokens.push({ type: 'eof', value: '', line });
  return { tokens, errors };
}

// Tính giá trị biểu thức hằng từ node AST (dùng cho kích thước mảng và
// giá trị case). Trả số nguyên, hoặc null nếu không phải hằng số.
function evalConstExpr(node) {
  if (!node) return null;
  switch (node.kind) {
    case 'num': return Math.trunc(node.value);
    case 'unary': {
      const v = evalConstExpr(node.expr);
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
      const a = evalConstExpr(node.left);
      const b = evalConstExpr(node.right);
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

// ===========================================================================
// PARSER — đệ quy xuống, ra AST theo hợp đồng ở đầu file
// ===========================================================================

class CError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
    this.message = message;
  }
}

const ASSIGN_OPS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=',
]);

// Mức ưu tiên toán tử hai ngôi, từ thấp tới cao (không tính gán và ?:)
const BINARY_LEVELS = [
  ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='],
  ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
];

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  next() {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  err(tok, message) {
    return new CError(tok.line, message);
  }
  checkOp(v) {
    const t = this.peek();
    return t.type === 'op' && t.value === v;
  }
  matchOp(v) {
    if (this.checkOp(v)) { this.next(); return true; }
    return false;
  }
  expectOp(v, message) {
    if (this.checkOp(v)) return this.next();
    throw this.err(this.peek(), message || `thiếu dấu ${v}`);
  }
  // Thiếu ';' thì báo ở dòng câu lệnh vừa kết thúc (token ngay trước đó),
  // chứ không phải dòng của token kế tiếp — vd `x = 2` ở dòng 3 mà thiếu
  // ';' thì lỗi phải là dòng 3, dù `PORTB` nằm ở dòng 4.
  expectSemicolon() {
    if (this.checkOp(';')) return this.next();
    const prev = this.tokens[Math.max(0, this.pos - 1)];
    throw this.err(prev, 'thiếu dấu ;');
  }
  checkKw(v) {
    const t = this.peek();
    return t.type === 'keyword' && t.value === v;
  }
  matchKw(v) {
    if (this.checkKw(v)) { this.next(); return true; }
    return false;
  }
  expectKw(v, message) {
    if (this.checkKw(v)) return this.next();
    throw this.err(this.peek(), message || `thiếu từ khoá ${v}`);
  }
  expectIdent(message) {
    const t = this.peek();
    if (t.type === 'ident') return this.next();
    throw this.err(t, message || 'cần tên');
  }
  isTypeStart(tok) {
    return tok.type === 'keyword'
      && (TYPE_KEYWORDS.has(tok.value) || QUALIFIERS.has(tok.value));
  }

  // --- Chương trình ---
  parseProgram() {
    const decls = [];
    while (this.peek().type !== 'eof') {
      const ds = this.parseExternalDecl();
      decls.push(...ds);
    }
    return { kind: 'program', decls };
  }

  // Kiểu dữ liệu -> chuỗi 'void'|'char'|'uchar'|'int'|'uint'.
  // 'signed' bỏ qua; short/long/float/double -> lỗi.
  parseType() {
    while (this.peek().type === 'keyword' && QUALIFIERS.has(this.peek().value)) this.next();
    let unsigned = false;
    let base = null;
    while (true) {
      const t = this.peek();
      if (t.type !== 'keyword') break;
      const v = t.value;
      if (v === 'unsigned') { unsigned = true; this.next(); continue; }
      if (v === 'signed') { this.next(); continue; }
      if (v === 'void' || v === 'char' || v === 'int') { base = v; this.next(); continue; }
      if (UNSUPPORTED_TYPES.has(v)) {
        throw this.err(t, `kiểu short/long/float chưa hỗ trợ (gặp "${v}")`);
      }
      break;
    }
    if (!base && !unsigned) {
      const t = this.peek();
      throw this.err(t, `kiểu dữ liệu không hiểu${t.type !== 'eof' ? ` "${t.value}"` : ''}`);
    }
    if (base === 'void') return 'void';
    if (base === 'char') return unsigned ? 'uchar' : 'char';
    return unsigned ? 'uint' : 'int'; // base 'int' hoặc chỉ 'unsigned'
  }

  parsePointerStars() {
    let count = 0;
    while (this.checkOp('*')) { this.next(); count++; }
    return count;
  }

  // Khai báo cấp cao nhất: định nghĩa hàm, khai báo mẫu, hoặc biến toàn cục.
  // Trả về mảng (1 FuncDef, hoặc nhiều VarDecl nếu khai báo nhiều biến 1 dòng).
  parseExternalDecl() {
    if (this.matchOp(';')) return []; // dấu ; thừa ở cấp cao nhất: bỏ qua
    const t = this.peek();
    if (t.type === 'keyword' && (t.value === 'struct' || t.value === 'enum' || t.value === 'typedef')) {
      throw this.err(t, `${t.value} chưa hỗ trợ`);
    }
    const line = t.line;
    const type = this.parseType();
    const pointer = this.parsePointerStars();
    const nameTok = this.expectIdent('cần tên hàm hoặc tên biến');
    if (this.checkOp('(')) {
      // Hàm
      this.next(); // (
      const params = this.parseParams();
      if (this.matchOp(';')) {
        // Khai báo mẫu (prototype): body = null, codegen bỏ qua
        return [{ kind: 'func', name: nameTok.value, returnType: type, params, body: null, line }];
      }
      const body = this.parseBlock();
      const node = { kind: 'func', name: nameTok.value, returnType: type, params, body, line };
      if (pointer) node.pointer = true;
      return [node];
    }
    // Biến toàn cục (có thể nhiều biến 1 dòng: int a, b = 2;)
    const first = this.parseDeclaratorRest(type, nameTok, pointer);
    const decls = [first];
    while (this.matchOp(',')) decls.push(this.parseDeclarator(type));
    this.expectSemicolon();
    return decls;
  }

  parseParams() {
    // '(' đã được ăn. Trả [{name, type}] — name '' khi tham số không tên
    // (chỉ hợp lệ ở khai báo mẫu).
    const params = [];
    if (this.matchOp(')')) return params;
    if (this.checkKw('void')) {
      this.next();
      this.expectOp(')', 'thiếu dấu )');
      return params;
    }
    while (true) {
      if (this.checkOp('...')) throw this.err(this.peek(), 'tham số ... chưa hỗ trợ');
      const type = this.parseType();
      const pointer = this.parsePointerStars();
      let name = '';
      if (this.peek().type === 'ident') name = this.next().value;
      if (this.matchOp('[')) this.expectOp(']', 'thiếu dấu ]'); // tham số mảng
      const p = { name, type };
      if (pointer) p.pointer = true;
      params.push(p);
      if (this.matchOp(',')) continue;
      break;
    }
    this.expectOp(')', 'thiếu dấu )');
    return params;
  }

  // Một khai báo biến: tên đã đọc, còn [kích thước] và = khởi tạo.
  parseDeclaratorRest(type, nameTok, pointer) {
    let arraySize = null;
    let isArray = false;
    if (this.matchOp('[')) {
      isArray = true;
      if (!this.matchOp(']')) {
        const sz = this.parseExpression();
        const v = evalConstExpr(sz);
        if (v === null || v < 0 || !Number.isFinite(v)) {
          throw this.err(sz, 'kích thước mảng phải là hằng số');
        }
        arraySize = v;
        this.expectOp(']', 'thiếu dấu ]');
      }
    }
    let init = null;
    if (this.matchOp('=')) init = this.parseInitializer(isArray);
    const node = {
      kind: 'vardecl', type, name: nameTok.value,
      arraySize, init, isArray, line: nameTok.line,
    };
    if (pointer) node.pointer = true;
    return node;
  }

  // Một khai báo biến đầy đủ (đọc cả '*' và tên).
  parseDeclarator(type) {
    const pointer = this.parsePointerStars();
    const nameTok = this.expectIdent('cần tên biến');
    return this.parseDeclaratorRest(type, nameTok, pointer);
  }

  // Khởi tạo: {1,2,3} -> mảng Expr; còn lại -> 1 Expr (số, ký tự, chuỗi...).
  // Khởi tạo vô định kiểu {x} cho biến thường thì mở ra thành Expr đó.
  parseInitializer(isArray) {
    if (this.matchOp('{')) {
      const items = [];
      if (!this.checkOp('}')) {
        while (true) {
          items.push(this.parseAssign());
          if (this.matchOp(',')) {
            if (this.checkOp('}')) break;
            continue;
          }
          break;
        }
      }
      this.expectOp('}', 'thiếu dấu }');
      if (!isArray && items.length === 1) return items[0];
      return items;
    }
    return this.parseAssign();
  }

  // --- Khối và câu lệnh ---
  parseBlock() {
    const open = this.expectOp('{', 'thiếu dấu {');
    const stmts = [];
    while (!this.checkOp('}')) {
      if (this.peek().type === 'eof') throw this.err(this.peek(), 'thiếu dấu }');
      const s = this.parseStatement();
      if (Array.isArray(s)) stmts.push(...s);
      else if (s) stmts.push(s);
    }
    this.next(); // }
    return { kind: 'block', stmts, line: open.line };
  }

  // parseStatement có thể trả về 1 Stmt hoặc mảng Stmt (khai báo nhiều
  // biến cục bộ 1 dòng: `int a, b = 2;`).
  parseStatement() {
    const t = this.peek();
    if (t.type === 'op' && t.value === '{') return this.parseBlock();
    if (t.type === 'op' && t.value === ';') {
      this.next();
      return { kind: 'expr', expr: null, line: t.line };
    }
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'do': return this.parseDoWhile();
        case 'for': return this.parseFor();
        case 'switch': return this.parseSwitch();
        case 'break':
          this.next();
          this.expectSemicolon();
          return { kind: 'break', line: t.line };
        case 'continue':
          this.next();
          this.expectSemicolon();
          return { kind: 'continue', line: t.line };
        case 'return': {
          this.next();
          let expr = null;
          if (!this.checkOp(';')) expr = this.parseExpression();
          this.expectSemicolon();
          return { kind: 'return', expr, line: t.line };
        }
        case 'case':
        case 'default':
          throw this.err(t, 'case/default chỉ dùng trong switch');
        case 'else':
          throw this.err(t, 'else không có if tương ứng');
        case 'struct':
        case 'enum':
        case 'typedef':
          throw this.err(t, `${t.value} chưa hỗ trợ`);
        default:
          if (this.isTypeStart(t)) {
            const type = this.parseType();
            const decls = [this.parseDeclarator(type)];
            while (this.matchOp(',')) decls.push(this.parseDeclarator(type));
            this.expectSemicolon();
            return decls;
          }
          throw this.err(t, `không hiểu câu lệnh bắt đầu bằng "${t.value}"`);
      }
    }
    // Câu lệnh biểu thức
    const expr = this.parseExpression();
    this.expectSemicolon();
    return { kind: 'expr', expr, line: t.line };
  }

  // Biến 1 Stmt (hoặc mảng Stmt từ khai báo nhiều biến) thành 1 Stmt duy nhất.
  asStmt(s, line) {
    if (Array.isArray(s)) return { kind: 'block', stmts: s, line };
    return s;
  }

  parseIf() {
    const kw = this.expectKw('if');
    this.expectOp('(', 'thiếu dấu (');
    const cond = this.parseExpression();
    this.expectOp(')', 'thiếu dấu )');
    const then = this.asStmt(this.parseStatement(), kw.line);
    let els = null;
    if (this.matchKw('else')) els = this.asStmt(this.parseStatement(), kw.line);
    return { kind: 'if', cond, then, else: els, line: kw.line };
  }

  parseWhile() {
    const kw = this.expectKw('while');
    this.expectOp('(', 'thiếu dấu (');
    const cond = this.parseExpression();
    this.expectOp(')', 'thiếu dấu )');
    const body = this.asStmt(this.parseStatement(), kw.line);
    return { kind: 'while', cond, body, line: kw.line };
  }

  parseDoWhile() {
    const kw = this.expectKw('do');
    const body = this.asStmt(this.parseStatement(), kw.line);
    this.expectKw('while', 'thiếu while sau do');
    this.expectOp('(', 'thiếu dấu (');
    const cond = this.parseExpression();
    this.expectOp(')', 'thiếu dấu )');
    this.expectSemicolon();
    return { kind: 'dowhile', cond, body, line: kw.line };
  }

  parseFor() {
    const kw = this.expectKw('for');
    this.expectOp('(', 'thiếu dấu (');
    let init = null;
    if (!this.checkOp(';')) {
      if (this.isTypeStart(this.peek())) {
        const type = this.parseType();
        const decls = [this.parseDeclarator(type)];
        while (this.matchOp(',')) decls.push(this.parseDeclarator(type));
        init = decls.length === 1
          ? decls[0]
          : { kind: 'block', stmts: decls, line: kw.line };
      } else {
        const e = this.parseExpression();
        init = { kind: 'expr', expr: e, line: e.line };
      }
    }
    this.expectSemicolon();
    let cond = null;
    if (!this.checkOp(';')) cond = this.parseExpression();
    this.expectSemicolon();
    let incr = null;
    if (!this.checkOp(')')) incr = this.parseExpression();
    this.expectOp(')', 'thiếu dấu )');
    const body = this.asStmt(this.parseStatement(), kw.line);
    return { kind: 'for', init, cond, incr, body, line: kw.line };
  }

  parseSwitch() {
    const kw = this.expectKw('switch');
    this.expectOp('(', 'thiếu dấu (');
    const expr = this.parseExpression();
    this.expectOp(')', 'thiếu dấu )');
    this.expectOp('{', 'thiếu dấu {');
    const cases = [];
    let defaultStmts = null;
    let cur = null; // {value, stmts} của case/default đang đọc
    while (!this.checkOp('}')) {
      if (this.peek().type === 'eof') throw this.err(this.peek(), 'thiếu dấu }');
      if (this.checkKw('case')) {
        this.next();
        const vExpr = this.parseExpression();
        const v = evalConstExpr(vExpr);
        if (v === null) throw this.err(vExpr, 'giá trị case phải là hằng số');
        this.expectOp(':', 'thiếu dấu :');
        cur = { value: v, stmts: [] };
        cases.push(cur);
        continue;
      }
      if (this.checkKw('default')) {
        const dt = this.next();
        this.expectOp(':', 'thiếu dấu :');
        if (defaultStmts !== null) throw this.err(dt, 'switch chỉ có 1 default');
        defaultStmts = [];
        cur = { value: null, stmts: defaultStmts };
        continue;
      }
      if (!cur) throw this.err(this.peek(), 'lệnh trong switch phải nằm trong case hoặc default');
      const s = this.parseStatement();
      if (Array.isArray(s)) cur.stmts.push(...s);
      else cur.stmts.push(s);
    }
    this.next(); // }
    return { kind: 'switch', expr, cases, defaultStmts, line: kw.line };
  }

  // --- Biểu thức ---
  parseExpression() {
    return this.parseAssign();
  }

  parseAssign() {
    const lhs = this.parseTernary();
    const t = this.peek();
    if (t.type === 'op' && ASSIGN_OPS.has(t.value)) {
      const op = this.next().value;
      if (!this.isValidTarget(lhs)) {
        throw this.err(t, 'vế trái phép gán không hợp lệ');
      }
      const value = this.parseAssign(); // gán kết hợp phải (a = b = 0)
      return { kind: 'assign', op, target: lhs, value, line: lhs.line };
    }
    return lhs;
  }

  isValidTarget(node) {
    if (!node) return false;
    if (node.kind === 'ident' || node.kind === 'member' || node.kind === 'index') return true;
    if (node.kind === 'unary' && node.op === '*') return true; // *p = ...
    return false;
  }

  parseTernary() {
    const cond = this.parseBinary(0);
    if (this.matchOp('?')) {
      const then = this.parseExpression();
      this.expectOp(':', 'thiếu dấu :');
      const els = this.parseTernary();
      return { kind: 'ternary', cond, then, else: els, line: cond.line };
    }
    return cond;
  }

  parseBinary(level) {
    if (level >= BINARY_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    while (true) {
      const t = this.peek();
      if (t.type !== 'op' || !BINARY_LEVELS[level].includes(t.value)) break;
      const op = this.next().value;
      const right = this.parseBinary(level + 1);
      left = { kind: 'binary', op, left, right, line: left.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'op'
      && ['-', '!', '~', '++', '--', '*', '&', '+'].includes(t.value)) {
      this.next();
      const expr = this.parseUnary();
      return { kind: 'unary', op: t.value, expr, prefix: true, line: t.line };
    }
    // Ép kiểu: (kiểu)expr — nhận ra nhờ token sau '(' là từ khoá kiểu
    // (tên biến không thể là từ khoá nên không nhầm với (a+b)).
    if (t.type === 'op' && t.value === '(' && this.isTypeStart(this.peek(1))) {
      this.next(); // (
      const castType = this.parseType();
      this.expectOp(')', 'thiếu dấu )');
      const expr = this.parseUnary();
      return { kind: 'unary', op: 'cast', castType, expr, prefix: true, line: t.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '(') {
        if (expr.kind !== 'ident') throw this.err(t, 'chỉ gọi hàm theo tên');
        this.next();
        const args = [];
        if (!this.checkOp(')')) {
          while (true) {
            args.push(this.parseAssign());
            if (this.matchOp(',')) continue;
            break;
          }
        }
        this.expectOp(')', 'thiếu dấu )');
        expr = { kind: 'call', name: expr.name, args, line: expr.line };
        continue;
      }
      if (t.type === 'op' && t.value === '[') {
        this.next();
        const index = this.parseExpression();
        this.expectOp(']', 'thiếu dấu ]');
        expr = { kind: 'index', base: expr, index, line: expr.line };
        continue;
      }
      if (t.type === 'op' && (t.value === '.' || t.value === '->')) {
        const isArrow = t.value === '->';
        this.next();
        const fieldTok = this.peek();
        if (fieldTok.type !== 'ident') {
          throw this.err(fieldTok, 'thiếu tên trường (sau dấu .)');
        }
        this.next();
        if (expr.kind !== 'ident') {
          throw this.err(t, 'chỉ hỗ trợ truy cập bit dạng Xbits.Y');
        }
        const node = { kind: 'member', baseName: expr.name, field: fieldTok.value, line: expr.line };
        if (isArrow) node.arrow = true; // p->x: con trỏ, codegen báo chưa hỗ trợ
        expr = node;
        continue;
      }
      if (t.type === 'op' && (t.value === '++' || t.value === '--')) {
        this.next();
        expr = { kind: 'unary', op: t.value, expr, prefix: false, line: t.line };
        continue;
      }
      break;
    }
    return expr;
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === 'num') {
      this.next();
      if (t.isFloat) throw this.err(t, 'số thực chưa hỗ trợ');
      return { kind: 'num', value: t.value, type: 'int', line: t.line };
    }
    if (t.type === 'char') {
      this.next();
      return { kind: 'num', value: t.value, type: 'char', line: t.line };
    }
    if (t.type === 'str') {
      this.next();
      return { kind: 'str', value: t.value, line: t.line };
    }
    if (t.type === 'ident') {
      this.next();
      return { kind: 'ident', name: t.value, line: t.line };
    }
    if (t.type === 'op' && t.value === '(') {
      this.next();
      const e = this.parseExpression();
      this.expectOp(')', 'thiếu dấu )');
      return e;
    }
    throw this.err(t, 'cần biểu thức');
  }
}

// ===========================================================================
// KIỂM TRA NGỮ NGHĨA TỐI THIỂU — đi bộ trên AST sau khi parse xong
// ===========================================================================
// - hàm main phải tồn tại
// - biến dùng trước khi khai báo trong cùng phạm vi -> lỗi
//   (phạm vi: toàn cục + từng khối; biến toàn cục chỉ thấy được trong hàm
//   nào định nghĩa SAU dòng khai báo của nó; tên SFR/bit PIC coi như đã
//   khai báo sẵn nhờ #include <xc.h>; mọi tên kết thúc bằng "bits" cũng
//   được coi là struct bit XC8 có sẵn)
// - gọi hàm chưa định nghĩa -> lỗi (trừ __delay_ms/__delay_us; hàm định
//   nghĩa sau vẫn được gọi vì đã gom tên hàm trước)
// - return có giá trị trong hàm void -> lỗi
// - break/continue ngoài vòng lặp/switch -> lỗi
// - khai báo trùng tên trong cùng phạm vi -> lỗi
// KHÔNG kiểm tra kiểu chặt (gán int vào char cứ cho qua, codegen tự cắt).
// Đệ quy (hàm tự gọi mình) KHÔNG báo ở đây — codegen báo sau.

function checkSemantics(ast) {
  const errors = [];
  const funcs = new Map(); // tên -> FuncDef
  const globals = []; // VarDecl toàn cục, theo thứ tự xuất hiện
  for (const d of ast.decls) {
    if (d.kind === 'func') {
      const prev = funcs.get(d.name);
      if (prev && prev.body && d.body) {
        errors.push({ line: d.line, message: `hàm ${d.name} đã định nghĩa` });
      } else if (!prev) {
        funcs.set(d.name, d);
      }
    } else if (d.kind === 'vardecl') {
      globals.push(d);
    }
  }
  if (!funcs.has('main')) {
    errors.push({ line: 1, message: 'hàm main không có' });
  }

  // Phạm vi toàn cục "gốc": chỉ chứa tên SFR/bit (dòng 0 = luôn thấy được).
  const seedScope = () => {
    const m = new Map();
    for (const name of SFR_NAMES) m.set(name, 0);
    return m;
  };

  // --- Kiểm tra biến toàn cục (khởi tạo chỉ được dùng biến khai báo trước) ---
  {
    const scope = seedScope();
    const userGlobals = new Set();
    for (const g of globals) {
      if (g.init) checkExpr(g.init, [scope], errors, funcs);
      if (userGlobals.has(g.name)) {
        errors.push({ line: g.line, message: `biến ${g.name} đã khai báo` });
      } else {
        userGlobals.add(g.name);
        scope.set(g.name, g.line);
      }
    }
  }

  // --- Kiểm tra từng hàm ---
  for (const fn of funcs.values()) {
    if (!fn.body) continue; // prototype: không có thân để kiểm tra
    const ctx = { ret: fn.returnType, loop: 0, sw: 0 };
    const globalScope = seedScope();
    for (const g of globals) {
      if (g.line < fn.line) globalScope.set(g.name, g.line);
    }
    const scopes = [globalScope];
    const paramScope = new Map();
    for (const p of fn.params) {
      if (p.name) paramScope.set(p.name, fn.line);
    }
    scopes.push(paramScope);
    checkBlock(fn.body, scopes, ctx, errors, funcs);
  }
  return errors;
}

// Tìm tên biến trong ngăn xếp phạm vi (tìm từ khối trong cùng ra ngoài).
// Trả về dòng khai báo, hoặc undefined nếu chưa khai báo.
function lookupVar(scopes, name) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].has(name)) return scopes[i].get(name);
  }
  return undefined;
}

function declareVar(scopes, decl, errors) {
  const cur = scopes[scopes.length - 1];
  if (cur.has(decl.name)) {
    errors.push({ line: decl.line, message: `biến ${decl.name} đã khai báo` });
    return;
  }
  cur.set(decl.name, decl.line);
}

// Kiểm tra phần khởi tạo của 1 VarDecl rồi mới ghi tên vào phạm vi hiện tại
// (để `int a = a;` bị báo "chưa khai báo biến a" — đúng như C).
function checkVarDecl(decl, scopes, errors, funcs) {
  if (decl.init) checkExpr(decl.init, scopes, errors, funcs);
  declareVar(scopes, decl, errors);
}

function checkBlock(block, scopes, ctx, errors, funcs) {
  scopes.push(new Map());
  for (const s of block.stmts) checkStmt(s, scopes, ctx, errors, funcs);
  scopes.pop();
}

function checkStmt(stmt, scopes, ctx, errors, funcs) {
  switch (stmt.kind) {
    case 'block':
      checkBlock(stmt, scopes, ctx, errors, funcs);
      break;
    case 'vardecl':
      checkVarDecl(stmt, scopes, errors, funcs);
      break;
    case 'expr':
      if (stmt.expr) checkExpr(stmt.expr, scopes, errors, funcs);
      break;
    case 'if':
      checkExpr(stmt.cond, scopes, errors, funcs);
      checkStmt(stmt.then, scopes, ctx, errors, funcs);
      if (stmt.else) checkStmt(stmt.else, scopes, ctx, errors, funcs);
      break;
    case 'while':
    case 'dowhile':
      checkExpr(stmt.cond, scopes, errors, funcs);
      ctx.loop++;
      checkStmt(stmt.body, scopes, ctx, errors, funcs);
      ctx.loop--;
      break;
    case 'for': {
      scopes.push(new Map()); // biến khởi tạo chỉ sống trong vòng for
      if (stmt.init) {
        if (stmt.init.kind === 'vardecl') checkVarDecl(stmt.init, scopes, errors, funcs);
        else if (stmt.init.kind === 'block') {
          for (const d of stmt.init.stmts) checkVarDecl(d, scopes, errors, funcs);
        } else if (stmt.init.kind === 'expr' && stmt.init.expr) {
          checkExpr(stmt.init.expr, scopes, errors, funcs);
        }
      }
      if (stmt.cond) checkExpr(stmt.cond, scopes, errors, funcs);
      if (stmt.incr) checkExpr(stmt.incr, scopes, errors, funcs);
      ctx.loop++;
      checkStmt(stmt.body, scopes, ctx, errors, funcs);
      ctx.loop--;
      scopes.pop();
      break;
    }
    case 'switch': {
      checkExpr(stmt.expr, scopes, errors, funcs);
      ctx.sw++;
      scopes.push(new Map());
      for (const c of stmt.cases) {
        for (const s of c.stmts) checkStmt(s, scopes, ctx, errors, funcs);
      }
      if (stmt.defaultStmts) {
        for (const s of stmt.defaultStmts) checkStmt(s, scopes, ctx, errors, funcs);
      }
      scopes.pop();
      ctx.sw--;
      break;
    }
    case 'break':
      if (ctx.loop === 0 && ctx.sw === 0) {
        errors.push({ line: stmt.line, message: 'break ở ngoài vòng lặp hoặc switch' });
      }
      break;
    case 'continue':
      if (ctx.loop === 0) {
        errors.push({ line: stmt.line, message: 'continue ở ngoài vòng lặp' });
      }
      break;
    case 'return':
      if (ctx.ret === 'void' && stmt.expr) {
        errors.push({ line: stmt.line, message: 'hàm void không được trả về giá trị' });
      }
      if (stmt.expr) checkExpr(stmt.expr, scopes, errors, funcs);
      break;
    default:
      break;
  }
}

function checkExpr(expr, scopes, errors, funcs) {
  if (!expr) return;
  if (Array.isArray(expr)) {
    for (const e of expr) checkExpr(e, scopes, errors, funcs);
    return;
  }
  switch (expr.kind) {
    case 'num':
    case 'str':
      break;
    case 'ident':
      if (lookupVar(scopes, expr.name) === undefined) {
        errors.push({ line: expr.line, message: `chưa khai báo biến ${expr.name}` });
      }
      break;
    case 'member':
      // PORTBbits.RB0: baseName là struct bit có sẵn (tên ...bits) hoặc
      // biến đã khai báo. p->x (arrow) thì p phải là biến đã khai báo.
      if (!expr.baseName.endsWith('bits')
        && lookupVar(scopes, expr.baseName) === undefined) {
        errors.push({ line: expr.line, message: `chưa khai báo biến ${expr.baseName}` });
      }
      break;
    case 'call':
      if (!funcs.has(expr.name) && !BUILTIN_FUNCS.has(expr.name)) {
        errors.push({ line: expr.line, message: `chưa khai báo hàm ${expr.name}` });
      }
      for (const a of expr.args) checkExpr(a, scopes, errors, funcs);
      break;
    case 'index':
      checkExpr(expr.base, scopes, errors, funcs);
      checkExpr(expr.index, scopes, errors, funcs);
      break;
    case 'binary':
      checkExpr(expr.left, scopes, errors, funcs);
      checkExpr(expr.right, scopes, errors, funcs);
      break;
    case 'unary':
      checkExpr(expr.expr, scopes, errors, funcs);
      break;
    case 'assign':
      checkExpr(expr.target, scopes, errors, funcs);
      checkExpr(expr.value, scopes, errors, funcs);
      break;
    case 'ternary':
      checkExpr(expr.cond, scopes, errors, funcs);
      checkExpr(expr.then, scopes, errors, funcs);
      checkExpr(expr.else, scopes, errors, funcs);
      break;
    default:
      break;
  }
}

// ===========================================================================
// ĐIỂM VÀO CHÍNH
// ===========================================================================

// parseC(source) -> {ast, errors, xtalFreq}
//   ast: cây Program (xem dạng AST ở đầu file), hoặc null khi có lỗi.
//   errors: [{line, message}] — line là dòng C gốc, message tiếng Việt.
//   xtalFreq: số lấy từ #define _XTAL_FREQ, mặc định 4000000.
export function parseC(source) {
  const pre = preprocessC(source);
  if (pre.errors.length > 0) {
    return { ast: null, errors: pre.errors, xtalFreq: pre.xtalFreq };
  }
  const lex = tokenizeC(pre.code);
  if (lex.errors.length > 0) {
    return { ast: null, errors: lex.errors, xtalFreq: pre.xtalFreq };
  }
  let ast;
  try {
    ast = new Parser(lex.tokens).parseProgram();
  } catch (e) {
    if (e instanceof CError) {
      return { ast: null, errors: [{ line: e.line, message: e.message }], xtalFreq: pre.xtalFreq };
    }
    throw e;
  }
  ast.defines = pre.defines; // để codegen tra cứu #define (vd _XTAL_FREQ)
  const semErrors = checkSemantics(ast);
  if (semErrors.length > 0) {
    return { ast: null, errors: semErrors, xtalFreq: pre.xtalFreq };
  }
  return { ast, errors: [], xtalFreq: pre.xtalFreq };
}

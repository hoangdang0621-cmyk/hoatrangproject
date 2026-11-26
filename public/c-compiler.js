// c-compiler.js — API CÔNG KHAI của trình biên dịch C (tập con XC8) cho PIC16F877A.
//
// Nối 3 tầng đã có thành 1 lệnh gọi duy nhất mà tab "Nạp viết code" dùng:
//   parseC(source)            [public/c-frontend.js]
//     -> generateC(ast, xtalFreq) [public/c-codegen.js]
//     -> assemble(asm)        [public/pic16.js]
//
// Cách dùng (editor):
//   import { compileC } from './c-compiler.js';
//   const r = compileC(source);
//   // r.ok === true  -> r.program (Uint16Array) nạp bằng cpu.loadProgram(),
//   //                  r.lineToAddr (Map dòng C -> địa chỉ) để đặt breakpoint
//   //                  theo dòng C, r.asm là hợp ngữ đã sinh (để xem lại),
//   //                  r.xtalFreq là tần số thạch anh từ #define _XTAL_FREQ
//   //                  (mặc định 4000000) — tab code DÙNG NÓ để đặt
//   //                  cpu.clockHz, không thì code 20MHz chạy chậm 5 lần
//   //                  giờ thực (vòng delay sinh cho 20MHz nhưng runner
//   //                  vẫn nhịp theo 4MHz).
//   // r.ok === false -> r.errors = [{line, message}] với line là dòng C gốc,
//   //                  hiển thị lỗi ngay tại dòng đó trong editor.
//
// Lỗi ở tầng assemble (lẽ ra không xảy ra vì codegen chỉ sinh asm hợp lệ)
// được map ngược về dòng C gần nhất qua g.asmLineToCLine.

import { parseC } from './c-frontend.js?v=20261125ap';
import { generateC } from './c-codegen.js?v=20261125aq';
import { assemble } from './pic16.js?v=20261125aq';

export const C_VERSION = '20261125aq';

export function compileC(source) {
  // Bước 1: tiền xử lý + lexer + parser -> AST (lỗi: dòng C gốc).
  const p = parseC(source);
  if (p.errors.length > 0) {
    return { ok: false, program: null, errors: p.errors, lineToAddr: new Map(), asm: '', xtalFreq: p.xtalFreq };
  }
  // Bước 2: AST -> hợp ngữ (lỗi: dòng C gốc).
  const g = generateC(p.ast, p.xtalFreq);
  if (g.errors.length > 0) {
    return { ok: false, program: null, errors: g.errors, lineToAddr: new Map(), asm: '', xtalFreq: p.xtalFreq };
  }
  // Bước 3: hợp ngữ -> mã máy. Lỗi assemble map về dòng C: tra
  // g.asmLineToCLine theo dòng asm; không có thì lấy dòng C gần nhất
  // đã map trước đó, cuối cùng mặc định dòng 1.
  const a = assemble(g.asm);
  if (a.errors.length > 0) {
    const errors = [];
    let lastCLine = 1;
    for (const e of a.errors) {
      const cLine = g.asmLineToCLine.get(e.line);
      if (cLine !== null && cLine !== undefined) lastCLine = cLine;
      errors.push({ line: lastCLine, message: e.message });
    }
    return { ok: false, program: null, errors, lineToAddr: new Map(), asm: g.asm, xtalFreq: p.xtalFreq };
  }
  // Bước 4 (ok): dựng lineToAddr (dòng C -> địa chỉ lệnh đầu tiên của
  // dòng đó). Dòng #define / #include không sinh lệnh nên không có map.
  const lineToAddr = new Map();
  for (const [asmLine, addr] of a.lineToAddr) {
    const cLine = g.asmLineToCLine.get(asmLine);
    if (cLine !== null && cLine !== undefined && !lineToAddr.has(cLine)) {
      lineToAddr.set(cLine, addr);
    }
  }
  return { ok: true, program: a.program, errors: [], lineToAddr, asm: g.asm, xtalFreq: p.xtalFreq };
}

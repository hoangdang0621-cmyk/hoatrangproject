// labs.js — Danh sách bài lab mẫu cho tab "Bài Lab" (bàn thực hành 3D).
// Mỗi lab chỉ liệt kê linh kiện + dây RIÊNG của lab; chip PIC, nguồn và
// dây nguồn mặc định lấy từ defaultBenchState(size) khi mở lab (buildLabState).
// Thêm lab mới chỉ cần thêm 1 phần tử vào mảng LABS.
// Lỗ chân RB0 (h29), vị trí điện trở/LED và dây nối đã tính bằng legsFor /
// canPlace trên board mặc định 830 và kiểm chứng bằng netlist (test q).
import { defaultBenchState, defaultProps, canPlace, parseHole, parsePsuPost } from './bench-model.js?v=20261125bn';

export const LABS = [
  {
    id: 'led-blink',
    title: 'Điều khiển LED',
    desc: 'LED nối vào chân RB0 của PIC qua điện trở 220Ω, cathode về GND. Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
#define _XTAL_FREQ 4000000

void main() {
  TRISB = 0;
  while (1) {
    RB0 = 1;
    __delay_ms(500);
    RB0 = 0;
    __delay_ms(500);
  }
}`,
    size: 830,
    components: [
      { id: 'R0', type: 'resistor', anchor: 'i45', rot: 0, props: { value: 220 } },
      { id: 'LED0', type: 'led', anchor: 'i52', rot: 0, props: { color: '#DC2626' } },
      // Mạch dao động thạch anh: thạch anh 4MHz nối 2 chân OSC (b34/b35,
      // hàng a là hàng duy nhất còn trống trong 2 strip OSC vì thân chip
      // phủ hàng b–h); 2 tụ gốm 22pF ở hàng i, CỘT 10–20 (ngoài cột chip
      // 22–41: strip hàng i trong cột chip đã chứa chân PIC — nối strip
      // đó về GND sẽ chập chân PIC, vd i30 là strip VDD h30). Mỗi tụ
      // 1 chân về strip OSC (qua dây) và 1 chân về GND (qua dây).
      // Tụ/thạch anh hở mạch với DC nên không ảnh hưởng netlist — xung
      // nhịp lấy từ crystalFreq(state).
      { id: 'X0', type: 'crystal', anchor: 'a34', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'i10', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'i16', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    wires: [
      { id: 'LAB1-W1', a: 'i29', b: 'j45', color: '#DC2626' }, // RB0 (strip h29) -> chân điện trở (strip i45)
      { id: 'LAB1-W2', a: 'j49', b: 'j52', color: '#DC2626' }, // điện trở (strip i49) -> anode LED (strip i52)
      { id: 'LAB1-W3', a: 'j53', b: 'B-50', color: '#0F172A' }, // cathode LED (strip i53) -> GND (rail -)
      { id: 'LAB1-W4', a: 'j14', b: 'c34', color: '#059669' }, // tụ C0 (strip i14) -> OSC1 (strip a34/b34, lỗ c34 dưới thân chip như dây LCD Lab 2)
      { id: 'LAB1-W5', a: 'j10', b: 'B-10', color: '#0F172A' }, // tụ C0 (strip i10) -> GND (rail -)
      { id: 'LAB1-W6', a: 'j20', b: 'c35', color: '#059669' }, // tụ C1 (strip i20) -> OSC2 (strip a35/b35, lỗ c35 dưới thân chip)
      { id: 'LAB1-W7', a: 'j16', b: 'B-16', color: '#0F172A' }, // tụ C1 (strip i16) -> GND (rail -)
    ],
  },
  {
    id: 'led-lcd',
    title: 'Điều khiển LED + LCD',
    desc: 'LCD 16x2 chế độ 8-bit đấu sẵn: RS→RE0 (chân 8), E→RE1 (chân 9), D0→RD0 (chân 19), D1→RD1 (chân 20), D2→RD2 (chân 21), D3→RD3 (chân 22), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30). LED xanh lá → RB1 (chân 34) qua điện trở 220Ω, cathode về GND. Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
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
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      { id: 'R1', type: 'resistor', anchor: 's45', rot: 0, props: { value: 220 } },
      { id: 'LED1', type: 'led', anchor: 's52', rot: 0, props: { color: '#059669' } }, // xanh lá trong bảng màu (dropdown hiện đúng "Xanh lá")
      { id: 'LCD1', type: 'lcd', anchor: 'a77', rot: 0, props: {} },
      // Mạch dao động thạch anh: thạch anh 4MHz nối 2 chân OSC (g53/g54,
      // hàng f là hàng duy nhất còn trống trong 2 strip OSC vì thân chip
      // phủ hàng g–m); 2 tụ gốm 22pF ở hàng n, CỘT 30–40 (ngoài cột chip
      // 41–60: strip hàng n trong cột chip đã chứa chân PIC — nối strip
      // đó về GND sẽ chập chân PIC, vd n44 là strip RB4 m44). Mỗi tụ
      // 1 chân về strip OSC (qua dây) và 1 chân về GND (qua dây).
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // Bố cục board 100×20: PIC neo g41 (cột 41–60, hàng g/m); LCD neo a77
    // ở góc trên phải (thân LCD phủ cột ~66–97, hàng a–m, không đè PIC/R/LED);
    // R1 neo s45 + LED1 neo s52 ở góc dưới giữa (cách PIC 6 hàng, cách LCD ~13 cột).
    // LCD 8-bit (RS=RE0, E=RE1, D0–D7=RD0–RD7): mỗi dây nối strip của 1 chân LCD
    // tới strip của chân PIC tương ứng. Chân PIC (neo g41): RE0=g48, RE1=g49,
    // RD0=g59, RD1=g60, RD2=m60, RD3=m59, RD4=m54, RD5=m53, RD6=m52, RD7=m51.
    wires: [
      { id: 'LAB2-W1', a: 'n47', b: 't45', color: '#DC2626' }, // RB1 (strip m47) -> chân điện trở (strip s45)
      { id: 'LAB2-W2', a: 't49', b: 't52', color: '#DC2626' }, // điện trở (strip s49) -> anode LED (strip s52)
      { id: 'LAB2-W3', a: 't53', b: 'B-53', color: '#0F172A' }, // cathode LED (strip s53) -> GND (rail -)
      { id: 'LAB2-W4', a: 'b77', b: 'f48', color: '#2563EB' }, // LCD.RS (strip a77) -> RE0 (strip g48)
      { id: 'LAB2-W5', a: 'b78', b: 'f49', color: '#2563EB' }, // LCD.E (strip a78) -> RE1 (strip g49)
      { id: 'LAB2-W6', a: 'b79', b: 'f59', color: '#2563EB' }, // LCD.D0 (strip a79) -> RD0 (strip g59)
      { id: 'LAB2-W7', a: 'b80', b: 'f60', color: '#2563EB' }, // LCD.D1 (strip a80) -> RD1 (strip g60)
      { id: 'LAB2-W8', a: 'b81', b: 'k60', color: '#2563EB' }, // LCD.D2 (strip a81) -> RD2 (strip m60)
      { id: 'LAB2-W9', a: 'b82', b: 'k59', color: '#2563EB' }, // LCD.D3 (strip a82) -> RD3 (strip m59)
      { id: 'LAB2-W10', a: 'b83', b: 'k54', color: '#2563EB' }, // LCD.D4 (strip a83) -> RD4 (strip m54)
      { id: 'LAB2-W11', a: 'b84', b: 'k53', color: '#2563EB' }, // LCD.D5 (strip a84) -> RD5 (strip m53)
      { id: 'LAB2-W12', a: 'b85', b: 'k52', color: '#2563EB' }, // LCD.D6 (strip a85) -> RD6 (strip m52)
      { id: 'LAB2-W13', a: 'b86', b: 'k51', color: '#2563EB' }, // LCD.D7 (strip a86) -> RD7 (strip m51)
      { id: 'LAB2-W14', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB2-W15', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB2-W16', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB2-W17', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
  {
    id: 'count-2x7seg',
    title: 'Đếm 00–99 trên 2 LED 7 thanh',
    desc: 'LED 7 thanh hàng chục (chung cathode) nối RD0–RD7: a→RD0, b→RD1, c→RD2, d→RD3, e→RD4, f→RD5, g→RD6, dp→RD7; LED 7 thanh hàng đơn vị nối RB0–RB7: a→RB0, b→RB1, c→RB2, d→RB3, e→RB4, f→RB5, g→RB6, dp→RB7; chân chung cả 2 về GND. Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
#define _XTAL_FREQ 4000000

const unsigned char seg[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

void main() {
  unsigned char chuc = 0, donvi = 0;
  TRISB = 0;
  TRISD = 0;
  while (1) {
    PORTD = seg[chuc];
    PORTB = seg[donvi];
    __delay_ms(500);
    donvi++;
    if (donvi >= 10) {
      donvi = 0;
      chuc++;
      if (chuc >= 10) chuc = 0;
    }
  }
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      // 2 LED 7 thanh cạnh nhau, góc trên trái (cột 10–14 và 16–20,
      // hàng a/f): hàng chục bên trái (SEG0, PORTD), hàng đơn vị bên
      // phải (SEG1, PORTB) — đọc trái sang phải là chục rồi đơn vị.
      // Mỗi đoạn là 1 nhánh LED trong solver (2V + 10Ω) nên không cần
      // điện trở ngoài. Chân chung cathode về GND (qua dây).
      { id: 'SEG0', type: 'sevenseg', anchor: 'a10', rot: 0, props: { common: 'cathode' } },
      { id: 'SEG1', type: 'sevenseg', anchor: 'a16', rot: 0, props: { common: 'cathode' } },
      // Mạch dao động thạch anh (y hệt Lab 2: cùng board 100×20, cùng
      // neo PIC g41): thạch anh 4MHz nối 2 chân OSC (g53/g54, hàng f
      // là hàng duy nhất còn trống trong 2 strip OSC vì thân chip phủ
      // hàng g–m); 2 tụ gốm 22pF ở hàng n, CỘT 30–40 (ngoài cột chip
      // 41–60). Mỗi tụ 1 chân về strip OSC (qua dây) và 1 chân về GND.
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // Chân PIC (neo g41): RD0=g59, RD1=g60, RD2=m60, RD3=m59, RD4=m54,
    // RD5=m53, RD6=m52, RD7=m51; RB0=m48, RB1=m47, RB2=m46, RB3=m45,
    // RB4=m44, RB5=m43, RB6=m42, RB7=m41. Chân 7 thanh: SEG0 a–dp ở
    // hàng a (a10–a14), e/f/g/COM ở hàng f (f10–f13); SEG1 a–dp ở hàng
    // a (a16–a20), e/f/g/COM ở hàng f (f16–f19). Đầu dây phía 7 thanh
    // lấy lỗ kề hàng b (cho chân hàng a) hoặc hàng g (cho chân hàng f);
    // đầu dây phía PIC lấy lỗ kề hàng f (cho chân hàng g) hoặc hàng k
    // (cho chân hàng m) — theo đúng tiền lệ Lab 2 (dây LCD/OSC cũng
    // cắm lỗ dưới thân chip).
    wires: [
      // SEG0 (hàng chục) -> PORTD
      { id: 'LAB3-W1', a: 'b10', b: 'f59', color: '#2563EB' }, // SEG0.a (strip a10) -> RD0 (strip g59)
      { id: 'LAB3-W2', a: 'b11', b: 'f60', color: '#2563EB' }, // SEG0.b (strip a11) -> RD1 (strip g60)
      { id: 'LAB3-W3', a: 'b12', b: 'k60', color: '#2563EB' }, // SEG0.c (strip a12) -> RD2 (strip m60)
      { id: 'LAB3-W4', a: 'b13', b: 'k59', color: '#2563EB' }, // SEG0.d (strip a13) -> RD3 (strip m59)
      { id: 'LAB3-W5', a: 'g10', b: 'k54', color: '#2563EB' }, // SEG0.e (strip f10) -> RD4 (strip m54)
      { id: 'LAB3-W6', a: 'g11', b: 'k53', color: '#2563EB' }, // SEG0.f (strip f11) -> RD5 (strip m53)
      { id: 'LAB3-W7', a: 'g12', b: 'k52', color: '#2563EB' }, // SEG0.g (strip f12) -> RD6 (strip m52)
      { id: 'LAB3-W8', a: 'b14', b: 'k51', color: '#2563EB' }, // SEG0.dp (strip a14) -> RD7 (strip m51)
      { id: 'LAB3-W9', a: 'g13', b: 'B-13', color: '#0F172A' }, // SEG0.COM (strip f13) -> GND (rail -)
      // SEG1 (hàng đơn vị) -> PORTB
      { id: 'LAB3-W10', a: 'b16', b: 'k48', color: '#2563EB' }, // SEG1.a (strip a16) -> RB0 (strip m48)
      { id: 'LAB3-W11', a: 'b17', b: 'k47', color: '#2563EB' }, // SEG1.b (strip a17) -> RB1 (strip m47)
      { id: 'LAB3-W12', a: 'b18', b: 'k46', color: '#2563EB' }, // SEG1.c (strip a18) -> RB2 (strip m46)
      { id: 'LAB3-W13', a: 'b19', b: 'k45', color: '#2563EB' }, // SEG1.d (strip a19) -> RB3 (strip m45)
      { id: 'LAB3-W14', a: 'g16', b: 'k44', color: '#2563EB' }, // SEG1.e (strip f16) -> RB4 (strip m44)
      { id: 'LAB3-W15', a: 'g17', b: 'k43', color: '#2563EB' }, // SEG1.f (strip f17) -> RB5 (strip m43)
      { id: 'LAB3-W16', a: 'g18', b: 'k42', color: '#2563EB' }, // SEG1.g (strip f18) -> RB6 (strip m42)
      { id: 'LAB3-W17', a: 'b20', b: 'k41', color: '#2563EB' }, // SEG1.dp (strip a20) -> RB7 (strip m41)
      { id: 'LAB3-W18', a: 'g19', b: 'B-19', color: '#0F172A' }, // SEG1.COM (strip f19) -> GND (rail -)
      // Mạch dao động (y hệt Lab 2)
      { id: 'LAB3-W19', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB3-W20', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB3-W21', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB3-W22', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
  {
    id: 'alu-tinh-toan',
    title: 'ALU tính toán',
    desc: 'LCD 16x2 chế độ 8-bit đấu sẵn: RS→RE0 (chân 8), E→RE1 (chân 9), D0→RD0 (chân 19), D1→RD1 (chân 20), D2→RD2 (chân 21), D3→RD3 (chân 22), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30). Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
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
  unsigned char kq;
  TRISD = 0;
  TRISE = 0;
  LCD_CMD(0x38);
  LCD_CMD(0x0C);
  LCD_CMD(0x01);
  LCD_CMD(0x06);
  while (1) {
    kq = 4 + 2;
    LCD_CMD(0x01);
    __delay_ms(2);
    LCD_DATA('4');
    LCD_DATA('+');
    LCD_DATA('2');
    LCD_DATA('=');
    LCD_DATA('0' + kq);
    __delay_ms(1500);
    kq = 7 - 2;
    LCD_CMD(0x01);
    __delay_ms(2);
    LCD_DATA('7');
    LCD_DATA('-');
    LCD_DATA('2');
    LCD_DATA('=');
    LCD_DATA('0' + kq);
    __delay_ms(1500);
    kq = 3 & 5;
    LCD_CMD(0x01);
    __delay_ms(2);
    LCD_DATA('3');
    LCD_DATA(' ');
    LCD_DATA('A');
    LCD_DATA('N');
    LCD_DATA('D');
    LCD_DATA(' ');
    LCD_DATA('5');
    LCD_DATA('=');
    LCD_DATA('0' + kq);
    __delay_ms(1500);
    kq = 6 + 4 - 3;
    LCD_CMD(0x01);
    __delay_ms(2);
    LCD_DATA('6');
    LCD_DATA('+');
    LCD_DATA('4');
    LCD_DATA('-');
    LCD_DATA('3');
    LCD_DATA('=');
    LCD_DATA('0' + kq);
    __delay_ms(1500);
    kq = (4 & 3) | 1;
    LCD_CMD(0x01);
    __delay_ms(2);
    LCD_DATA('4');
    LCD_DATA(' ');
    LCD_DATA('A');
    LCD_DATA('N');
    LCD_DATA('D');
    LCD_DATA(' ');
    LCD_DATA('3');
    LCD_DATA(' ');
    LCD_DATA('O');
    LCD_DATA('R');
    LCD_DATA(' ');
    LCD_DATA('1');
    LCD_DATA('=');
    LCD_DATA('0' + kq);
    __delay_ms(1500);
  }
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      { id: 'LCD1', type: 'lcd', anchor: 'a77', rot: 0, props: {} },
      // Mạch dao động thạch anh (y hệt Lab 2: cùng board 100×20, cùng
      // neo PIC g41): thạch anh 4MHz nối 2 chân OSC (g53/g54, hàng f
      // là hàng duy nhất còn trống trong 2 strip OSC vì thân chip phủ
      // hàng g–m); 2 tụ gốm 22pF ở hàng n, CỘT 30–40 (ngoài cột chip
      // 41–60). Mỗi tụ 1 chân về strip OSC (qua dây) và 1 chân về GND.
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // LCD 8-bit (RS=RE0, E=RE1, D0–D7=RD0–RD7) — dây y hệt Lab 2 (W4–W13);
    // dao động y hệt Lab 2 (W14–W17). Chân PIC (neo g41): RE0=g48, RE1=g49,
    // RD0=g59, RD1=g60, RD2=m60, RD3=m59, RD4=m54, RD5=m53, RD6=m52, RD7=m51.
    wires: [
      { id: 'LAB4-W1', a: 'b77', b: 'f48', color: '#2563EB' }, // LCD.RS (strip a77) -> RE0 (strip g48)
      { id: 'LAB4-W2', a: 'b78', b: 'f49', color: '#2563EB' }, // LCD.E (strip a78) -> RE1 (strip g49)
      { id: 'LAB4-W3', a: 'b79', b: 'f59', color: '#2563EB' }, // LCD.D0 (strip a79) -> RD0 (strip g59)
      { id: 'LAB4-W4', a: 'b80', b: 'f60', color: '#2563EB' }, // LCD.D1 (strip a80) -> RD1 (strip g60)
      { id: 'LAB4-W5', a: 'b81', b: 'k60', color: '#2563EB' }, // LCD.D2 (strip a81) -> RD2 (strip m60)
      { id: 'LAB4-W6', a: 'b82', b: 'k59', color: '#2563EB' }, // LCD.D3 (strip a82) -> RD3 (strip m59)
      { id: 'LAB4-W7', a: 'b83', b: 'k54', color: '#2563EB' }, // LCD.D4 (strip a83) -> RD4 (strip m54)
      { id: 'LAB4-W8', a: 'b84', b: 'k53', color: '#2563EB' }, // LCD.D5 (strip a84) -> RD5 (strip m53)
      { id: 'LAB4-W9', a: 'b85', b: 'k52', color: '#2563EB' }, // LCD.D6 (strip a85) -> RD6 (strip m52)
      { id: 'LAB4-W10', a: 'b86', b: 'k51', color: '#2563EB' }, // LCD.D7 (strip a86) -> RD7 (strip m51)
      { id: 'LAB4-W11', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB4-W12', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB4-W13', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB4-W14', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
  {
    id: 'chay-tung-lenh',
    title: 'Chạy từng lệnh',
    desc: 'LCD 16x2 chế độ 8-bit đấu sẵn: RS→RE0 (chân 8), E→RE1 (chân 9), D0→RD0 (chân 19), D1→RD1 (chân 20), D2→RD2 (chân 21), D3→RD3 (chân 22), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30). Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
#define _XTAL_FREQ 4000000

// BÀI LAB: Chạy từng lệnh — xem chu trình Fetch – Decode – Execute.
// Cách học:
//   1. Bấm "Nạp & chạy": LCD hiện "4+2=6" (kết quả cuối cùng).
//   2. Bấm "Dừng", rồi bấm "Chạy từng lệnh" nhiều lần: mỗi lần bấm là
//      1 lệnh được thực thi. Xem LCD và biến thay đổi từng bước.
//   3. Đặt breakpoint (chấm đỏ) ở dòng "kq = a + b;" rồi bấm
//      "Nạp & chạy": chương trình dừng đúng chỗ đó, bấm "Chạy tiếp"
//      để chạy nốt.
// Trình tự 3 bước trong main (như mục 2.6 trong bài giảng):
//   Bước 1 - LOAD A: nạp 4 vào thanh ghi A.
//   Bước 2 - LOAD B: nạp 2 vào thanh ghi B.
//   Bước 3 - ADD: cộng A + B, kết quả 6 vào thanh ghi C.

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
  unsigned char a;
  unsigned char b;
  unsigned char kq;
  TRISD = 0;
  TRISE = 0;
  LCD_CMD(0x38);
  LCD_CMD(0x0C);
  LCD_CMD(0x01);
  LCD_CMD(0x06);
  a = 4;       // Bước 1 - LOAD A
  b = 2;       // Bước 2 - LOAD B
  kq = a + b;  // Bước 3 - ADD (kq = 6)
  LCD_DATA('4');
  LCD_DATA('+');
  LCD_DATA('2');
  LCD_DATA('=');
  LCD_DATA('0' + kq);
  while (1) {
  }
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      { id: 'LCD1', type: 'lcd', anchor: 'a77', rot: 0, props: {} },
      // Mạch dao động thạch anh (y hệt Lab 2/4).
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // LCD 8-bit y hệt Lab 2/4; dao động y hệt Lab 2/4.
    wires: [
      { id: 'LAB5-W1', a: 'b77', b: 'f48', color: '#2563EB' }, // LCD.RS (strip a77) -> RE0 (strip g48)
      { id: 'LAB5-W2', a: 'b78', b: 'f49', color: '#2563EB' }, // LCD.E (strip a78) -> RE1 (strip g49)
      { id: 'LAB5-W3', a: 'b79', b: 'f59', color: '#2563EB' }, // LCD.D0 (strip a79) -> RD0 (strip g59)
      { id: 'LAB5-W4', a: 'b80', b: 'f60', color: '#2563EB' }, // LCD.D1 (strip a80) -> RD1 (strip g60)
      { id: 'LAB5-W5', a: 'b81', b: 'k60', color: '#2563EB' }, // LCD.D2 (strip a81) -> RD2 (strip m60)
      { id: 'LAB5-W6', a: 'b82', b: 'k59', color: '#2563EB' }, // LCD.D3 (strip a82) -> RD3 (strip m59)
      { id: 'LAB5-W7', a: 'b83', b: 'k54', color: '#2563EB' }, // LCD.D4 (strip a83) -> RD4 (strip m54)
      { id: 'LAB5-W8', a: 'b84', b: 'k53', color: '#2563EB' }, // LCD.D5 (strip a84) -> RD5 (strip m53)
      { id: 'LAB5-W9', a: 'b85', b: 'k52', color: '#2563EB' }, // LCD.D6 (strip a85) -> RD6 (strip m52)
      { id: 'LAB5-W10', a: 'b86', b: 'k51', color: '#2563EB' }, // LCD.D7 (strip a86) -> RD7 (strip m51)
      { id: 'LAB5-W11', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB5-W12', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB5-W13', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB5-W14', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
  {
    id: 'nhap-xu-ly-xuat',
    title: 'Nhập – Xử lý – Xuất',
    desc: 'Nút nhấn nối RB0 (chân 33), đầu còn lại về GND (nhấn = mức 0). LED xanh lá → RB1 (chân 34) qua điện trở 220Ω, cathode về GND. LCD 16x2 chế độ 8-bit đấu sẵn: RS→RE0 (chân 8), E→RE1 (chân 9), D0→RD0 (chân 19), D1→RD1 (chân 20), D2→RD2 (chân 21), D3→RD3 (chân 22), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30). Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
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
  unsigned char chuc = 0;
  unsigned char donvi = 0;
  unsigned char led = 0;
  TRISB = 0x01;
  TRISD = 0;
  TRISE = 0;
  RB1 = 0;
  LCD_CMD(0x38);
  LCD_CMD(0x0C);
  LCD_CMD(0x01);
  LCD_CMD(0x06);
  LCD_DATA('D');
  LCD_DATA('E');
  LCD_DATA('M');
  LCD_DATA(':');
  LCD_DATA(' ');
  LCD_DATA('0');
  LCD_DATA('0');
  while (1) {
    if (RB0 == 0) {
      donvi++;
      if (donvi >= 10) {
        donvi = 0;
        chuc++;
        if (chuc >= 10) chuc = 0;
      }
      LCD_CMD(0x02);
      LCD_DATA('D');
      LCD_DATA('E');
      LCD_DATA('M');
      LCD_DATA(':');
      LCD_DATA(' ');
      LCD_DATA('0' + chuc);
      LCD_DATA('0' + donvi);
      if (led == 0) {
        led = 1;
        RB1 = 1;
      } else {
        led = 0;
        RB1 = 0;
      }
      while (RB0 == 0) {
      }
      __delay_ms(20);
    }
  }
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      { id: 'R1', type: 'resistor', anchor: 's45', rot: 0, props: { value: 220 } },
      { id: 'LED1', type: 'led', anchor: 's52', rot: 0, props: { color: '#059669' } }, // xanh lá trong bảng màu
      { id: 'LCD1', type: 'lcd', anchor: 'a77', rot: 0, props: {} },
      // Mạch dao động thạch anh (y hệt Lab 2/4/5).
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
      // Nút nhấn ở hàng p (đoạn strip p-t, KHÔNG chứa chân PIC — chân PIC
      // ở hàng g/m, đoạn f-j/k-o). p60/p61 không trùng strip với R1/LED1
      // (hàng s) hay LCD (hàng a). T1 -> RB0, T2 -> GND (active-low:
      // nhấn = 0, thả = 1 nhờ pull-up).
      { id: 'BTN0', type: 'button', anchor: 'p60', rot: 0, props: {} },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // LED y hệt Lab 2 (W1–W3); LCD 8-bit y hệt Lab 2 (W4–W13); dao động
    // y hệt Lab 2 (W16–W19). Nút nhấn: T1 (p60) -> RB0 (m48) qua lỗ kề
    // q60/k48; T2 (p61) -> GND qua lỗ kề q61. Chân PIC (neo g41):
    // RB0=m48, RB1=m47; RE0=g48, RE1=g49; RD0=g59, RD1=g60, RD2=m60,
    // RD3=m59, RD4=m54, RD5=m53, RD6=m52, RD7=m51.
    wires: [
      { id: 'LAB6-W1', a: 'n47', b: 't45', color: '#DC2626' }, // RB1 (strip m47) -> chân điện trở (strip s45)
      { id: 'LAB6-W2', a: 't49', b: 't52', color: '#DC2626' }, // điện trở (strip s49) -> anode LED (strip s52)
      { id: 'LAB6-W3', a: 't53', b: 'B-53', color: '#0F172A' }, // cathode LED (strip s53) -> GND (rail -)
      { id: 'LAB6-W4', a: 'b77', b: 'f48', color: '#2563EB' }, // LCD.RS (strip a77) -> RE0 (strip g48)
      { id: 'LAB6-W5', a: 'b78', b: 'f49', color: '#2563EB' }, // LCD.E (strip a78) -> RE1 (strip g49)
      { id: 'LAB6-W6', a: 'b79', b: 'f59', color: '#2563EB' }, // LCD.D0 (strip a79) -> RD0 (strip g59)
      { id: 'LAB6-W7', a: 'b80', b: 'f60', color: '#2563EB' }, // LCD.D1 (strip a80) -> RD1 (strip g60)
      { id: 'LAB6-W8', a: 'b81', b: 'k60', color: '#2563EB' }, // LCD.D2 (strip a81) -> RD2 (strip m60)
      { id: 'LAB6-W9', a: 'b82', b: 'k59', color: '#2563EB' }, // LCD.D3 (strip a82) -> RD3 (strip m59)
      { id: 'LAB6-W10', a: 'b83', b: 'k54', color: '#2563EB' }, // LCD.D4 (strip a83) -> RD4 (strip m54)
      { id: 'LAB6-W11', a: 'b84', b: 'k53', color: '#2563EB' }, // LCD.D5 (strip a84) -> RD5 (strip m53)
      { id: 'LAB6-W12', a: 'b85', b: 'k52', color: '#2563EB' }, // LCD.D6 (strip a85) -> RD6 (strip m52)
      { id: 'LAB6-W13', a: 'b86', b: 'k51', color: '#2563EB' }, // LCD.D7 (strip a86) -> RD7 (strip m51)
      { id: 'LAB6-W14', a: 'q60', b: 'k48', color: '#F59E0B' }, // nút T1 (strip p60) -> RB0 (strip m48)
      { id: 'LAB6-W15', a: 'q61', b: 'B-61', color: '#0F172A' }, // nút T2 (strip p61) -> GND (rail -)
      { id: 'LAB6-W16', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB6-W17', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB6-W18', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB6-W19', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
  {
    id: 'lcd-4bit',
    title: 'LCD 4-bit',
    desc: 'LCD 16x2 chế độ 4-bit đấu sẵn: RS→RE0 (chân 8), E→RE1 (chân 9), D4→RD4 (chân 27), D5→RD5 (chân 28), D6→RD6 (chân 29), D7→RD7 (chân 30); D0–D3 không đấu. Thạch anh 4MHz nối OSC1 (chân 13) – OSC2 (chân 14), mỗi chân thạch anh có 1 tụ gốm 22pF về GND.',
    code: `#include <xc.h>
#define _XTAL_FREQ 4000000

void LCD_WAIT() {
  __delay_us(100);
}

void LCD_NIBBLE(unsigned char c) {
  PORTD = c & 0xF0;
  RE1 = 1;
  RE1 = 0;
  LCD_WAIT();
}

void LCD_CMD(unsigned char c) {
  RE0 = 0;
  LCD_NIBBLE(c);
  LCD_NIBBLE(c << 4);
}

void LCD_DATA(unsigned char c) {
  RE0 = 1;
  LCD_NIBBLE(c);
  LCD_NIBBLE(c << 4);
}

void main() {
  TRISD = 0;
  TRISE = 0;
  __delay_ms(20);
  LCD_CMD(0x33);
  LCD_CMD(0x32);
  LCD_CMD(0x28);
  LCD_CMD(0x0C);
  LCD_CMD(0x01);
  LCD_CMD(0x06);
  LCD_DATA('H');
  LCD_DATA('E');
  LCD_DATA('L');
  LCD_DATA('L');
  LCD_DATA('O');
  while (1) {
  }
}`,
    size: { cols: 100, rows: 20, rails: true },
    components: [
      { id: 'LCD1', type: 'lcd', anchor: 'a77', rot: 0, props: {} },
      // Mạch dao động thạch anh (y hệt Lab 2/4/5/6).
      { id: 'X0', type: 'crystal', anchor: 'f53', rot: 0, props: { freq: 4000000 } },
      { id: 'C0', type: 'capacitor', anchor: 'n30', rot: 0, props: { value: 22 } },
      { id: 'C1', type: 'capacitor', anchor: 'n36', rot: 0, props: { value: 22 } },
    ],
    // Quy tắc dây lab: cắm vào lỗ kề trong cùng đoạn strip (5 hàng), KHÔNG cắm trùng lỗ chân linh kiện.
    // LCD 4-bit: chỉ RS, E, D4–D7 (D0–D3 KHÔNG đấu — chuẩn HD44780, dữ
    // liệu đi 2 nibble trên 4 dây D4–D7). Dây lấy đúng các dây tương ứng
    // của Lab 2: RS (b77->f48), E (b78->f49), D4 (b83->k54), D5 (b84->k53),
    // D6 (b85->k52), D7 (b86->k51). Dao động y hệt Lab 2.
    wires: [
      { id: 'LAB7-W1', a: 'b77', b: 'f48', color: '#2563EB' }, // LCD.RS (strip a77) -> RE0 (strip g48)
      { id: 'LAB7-W2', a: 'b78', b: 'f49', color: '#2563EB' }, // LCD.E (strip a78) -> RE1 (strip g49)
      { id: 'LAB7-W3', a: 'b83', b: 'k54', color: '#2563EB' }, // LCD.D4 (strip a83) -> RD4 (strip m54)
      { id: 'LAB7-W4', a: 'b84', b: 'k53', color: '#2563EB' }, // LCD.D5 (strip a84) -> RD5 (strip m53)
      { id: 'LAB7-W5', a: 'b85', b: 'k52', color: '#2563EB' }, // LCD.D6 (strip a85) -> RD6 (strip m52)
      { id: 'LAB7-W6', a: 'b86', b: 'k51', color: '#2563EB' }, // LCD.D7 (strip a86) -> RD7 (strip m51)
      { id: 'LAB7-W7', a: 'o34', b: 'h53', color: '#059669' }, // tụ C0 (strip n34) -> OSC1 (strip f53/g53, lỗ h53 dưới thân chip)
      { id: 'LAB7-W8', a: 'o30', b: 'B-30', color: '#0F172A' }, // tụ C0 (strip n30) -> GND (rail -)
      { id: 'LAB7-W9', a: 'o40', b: 'h54', color: '#059669' }, // tụ C1 (strip n40) -> OSC2 (strip f54/g54, lỗ h54 dưới thân chip)
      { id: 'LAB7-W10', a: 'o36', b: 'B-36', color: '#0F172A' }, // tụ C1 (strip n36) -> GND (rail -)
    ],
  },
];

export function getLab(id) {
  return LABS.find((l) => l.id === id) || null;
}

// Dựng state đầy đủ của 1 lab: bàn mặc định (chip + nguồn + dây nguồn)
// + linh kiện/dây riêng của lab. Trả {ok, state} hoặc {ok:false, reason}.
export function buildLabState(lab) {
  if (!lab || !Array.isArray(lab.components) || !Array.isArray(lab.wires)) {
    return { ok: false, reason: 'Bài lab không hợp lệ.' };
  }
  const state = defaultBenchState(lab.size);
  for (const comp of lab.components) {
    if (!comp || typeof comp.id !== 'string' || typeof comp.type !== 'string' || typeof comp.anchor !== 'string') {
      return { ok: false, reason: 'Linh kiện trong lab không hợp lệ.' };
    }
    const chk = canPlace(state, comp.type, comp.anchor, comp.rot || 0);
    if (!chk.ok) return { ok: false, reason: `Không đặt được ${comp.id} vào lỗ ${comp.anchor}: ${chk.reason}` };
    state.components.push({
      id: comp.id, type: comp.type, anchor: comp.anchor, rot: comp.rot || 0,
      props: { ...defaultProps(comp.type), ...(comp.props || {}) },
    });
  }
  const seen = new Set();
  for (const w of lab.wires) {
    if (!w || typeof w.id !== 'string' || typeof w.color !== 'string') {
      return { ok: false, reason: 'Dây trong lab không hợp lệ.' };
    }
    const okEnd = (e) => {
      if (typeof e !== 'string') return false;
      if (parseHole(e, state.size)) return true;
      return !!parsePsuPost(e);
    };
    if (!okEnd(w.a) || !okEnd(w.b)) {
      return { ok: false, reason: `Dây ${w.id} có đầu không hợp lệ trên board.` };
    }
    if (w.a === w.b) return { ok: false, reason: `Dây ${w.id} có 2 đầu trùng nhau.` };
    const key = [w.a, w.b].sort().join('|');
    if (seen.has(key)) return { ok: false, reason: `Dây ${w.id} trùng với 1 dây khác trong lab.` };
    seen.add(key);
    if (state.wires.some((x) => (x.a === w.a && x.b === w.b) || (x.a === w.b && x.b === w.a))) {
      return { ok: false, reason: `Dây ${w.id} trùng với dây nguồn mặc định.` };
    }
    state.wires.push({ id: w.id, a: w.a, b: w.b, color: w.color });
  }
  return { ok: true, state };
}

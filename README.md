# HoaTrang — Mô phỏng PIC16F877A

Trang web mô phỏng vi điều khiển PIC16F877A ngay trên trình duyệt, không cần
cài đặt. Viết chương trình Assembly, dịch, chạy và quan sát chip hoạt động
như trên board thật: LED, nút nhấn, LCD, ADC, UART, thanh ghi, ngắt và timer.
Trang này chỉ dùng trên máy tính.

## Dùng nhanh

1. Chọn một bài lab ở menu ví dụ mẫu (mặc định: Nhấp nháy LED RB0).
2. Bấm **Dịch & Nạp** (hoặc Ctrl+Enter) để dịch code Assembly và nạp vào chip.
3. Bấm **Chạy tất cả** để chạy. Đổi tốc độ 0.1x / 0.5x / 1x / Tối đa,
   bấm **Chạy từng lệnh** để chạy từng lệnh một, bấm **Reset** để chạy lại từ đầu.
4. Làm theo panel **Bài học** từng bước để biết cần quan sát gì ở mỗi bước.
5. Bấm vào số dòng trong editor để đặt breakpoint: chương trình chạy tới đó
   sẽ dừng lại.

## Viết chương trình Assembly

- Soạn code trong editor, đủ 35 lệnh của PIC16F877A: `MOVLW`, `MOVWF`,
  `MOVF`, `CLRF`, `ADDWF`, `SUBWF`, `ANDWF`, `IORWF`, `XORWF`, `INCF`,
  `DECF`, `INCFSZ`, `DECFSZ`, `BSF`, `BCF`, `BTFSS`, `BTFSC`, `GOTO`,
  `CALL`, `RETURN`, `RETLW`, `NOP`, `SLEEP`, `CLRWDT`...
- Dùng nhãn (`ten_nhan:`), `EQU` đặt tên hằng/thanh ghi, `ORG` đặt địa chỉ,
  `BANKSEL` chuyển bank, chú thích bằng dấu `;`.
- Lỗi dịch hiện kèm số dòng, bấm vào lỗi để nhảy tới đúng dòng đó.
- Chọn tần số thạch anh 1 / 4 / 8 / 20 MHz (mặc định 4 MHz, một lệnh tốn
  4 chu kỳ clock như chip thật).

## Dùng board

Board đấu dây như kit PIC phổ biến, mọi chân đều nối sẵn với chip
(đổi dây được ở tab Đấu nối — xem mục bên dưới):

- **8 LED trên PORTB (RB0–RB7):** sáng khi chân là output (`TRISB = 0`)
  và mức ra là 1. Muốn LED nhấp nháy thì viết code đảo bit PORTB.
- **4 nút nhấn RC0–RC3:** nhấn giữ là mức 0 (active-low, có pull-up).
  Đọc bằng `BTFSS` / `BTFSC PORTC, 0`... để rẽ nhánh theo nút.
- **Chiết áp AN0:** kéo thanh trượt 0–5V, chip đọc qua ADC 10-bit
  (kênh AN0, kết quả 0–1023 trong `ADRESH:ADRESL`). Bật ADC bằng
  `ADCON0` (bit `ADON`, rồi set `GO` để bắt đầu chuyển đổi).
- **LCD 16x2:** data nối PORTD, RS = RE0, E = RE1. Gửi lệnh qua PORTD
  rồi tạo xung E để LCD nhận: lệnh xóa màn hình, đặt vị trí con trỏ,
  ghi ký tự.
- **Terminal UART:** chip gửi ký tự qua `TXREG` (chân RC6/TX) thì hiện
  trong terminal; gõ ký tự vào terminal để gửi vào `RCREG` (chân RC7/RX),
  mặc định baud 9600 ở 4 MHz.

## Đấu nối breadboard

Tab **Đấu nối (Breadboard)** cho thấy đúng sơ đồ dây của board: chip
PIC16F877A (DIP-40) ở giữa, thanh +5V (đỏ) bên trái, thanh GND (đen) bên
phải, VDD/VSS/MCLR đã nối sẵn nguồn. Mọi linh kiện trên board đều là linh
kiện trên breadboard — đổi dây ở đây thì board và code chạy theo dây mới.

- **Kéo dây:** kéo-thả chuột từ một đầu nối (chấm tròn) tới đầu nối khác.
  Dây đỏ = +5V,
  dây đen = GND, dây màu = tín hiệu.
- **Xoá dây:** bấm vào dây để chọn rồi bấm **Xoá dây đã chọn** (hoặc phím
  Delete).
- **Thêm linh kiện:** bấm nút trong khay linh kiện — LED (kèm sẵn điện trở
  220Ω), nút nhấn, chiết áp, LCD 16x2, còi buzzer. Mỗi linh kiện có các
  đầu nối riêng: LED 2 đầu (A/K), nút 2 đầu, chiết áp 3 đầu (VCC/Wiper/
  GND), LCD 10 đầu (RS/E/D0–D7), còi 2 đầu.
- **Xoá linh kiện:** bấm chọn linh kiện đã thêm rồi bấm **Xoá linh kiện**.
  Linh kiện của mạch mẫu không xoá được, chỉ xoá/sửa dây của nó.
- **Về mạch mẫu:** nút **Về mạch mẫu** khôi phục đấu nối mặc định (LED
  RB0–RB7, nút RC0–RC3, LCD PORTD/RE0/RE1, chiết áp AN0). Đấu nối tự lưu
  trên máy (localStorage), mở lại trang vẫn còn.
- **Còi buzzer:** nối chân + vào một chân digital; còi kêu khi chân đó ra
  mức 1. Tiếng bíp (WebAudio) mặc định tắt, bấm **Bật tiếng còi** trên
  board để nghe.

### Mạch mẫu mặc định

8 LED RB0–RB7 (mỗi LED kèm R 220Ω, cathode về GND), 4 nút RC0–RC3 (đầu
còn lại về GND, active-low), chiết áp VCC–RA0 (AN0)–GND, LCD RS=RE0,
E=RE1, D0–D7=RD0–RD7. Các lab mẫu chạy đúng với mạch này.

### Cảnh báo thường gặp (panel "Kiểm tra")

- **Nối tắt +5V–GND:** dây nối cả 2 thanh nguồn — sẽ chập nguồn, gỡ ngay.
- **LED không có điện trở:** LED nối thẳng chân PIC mà không qua điện trở
  hạn dòng, dễ cháy LED.
- **LCD chưa nối đủ dây:** thiếu RS, E hoặc D0–D7 — LCD không hiện chữ
  cho tới khi nối đủ.
- **Hai chân output nối trực tiếp:** 2 chân cùng là ngõ ra (TRIS=0) nối
  nhau, có thể hỏng chân.
- **Chân PIC nối 2 nguồn tín hiệu:** 2 linh kiện cùng lái một chân, mức
  logic xung đột.
- **Đầu nối chưa nối dây:** đầu nối của linh kiện còn bỏ trống.

Bấm vào một cảnh báo để tô sáng dây/linh kiện liên quan.

## Các bài lab mẫu

| Bài | Học được gì |
| --- | --- |
| Nhấp nháy LED RB0 | `TRISB`, vòng lặp trễ, đảo bit PORTB |
| LED chạy PORTB | Dịch bit, `RLF`, vòng lặp |
| Nút nhấn RC0 bật LED | Đọc input, `BTFSS` rẽ nhánh |
| LCD "Hello PIC16F877A" | Giao tiếp LCD HD44780 qua PORTD/RE0/RE1 |
| Đọc ADC AN0 hiện lên LCD | `ADCON0`, chờ `GO`, đọc `ADRESH:ADRESL` |
| UART echo 9600 | `TXSTA`/`RCSTA`, `TXREG`/`RCREG`, ngắt nhận |
| Timer0 nhấp nháy LED | `OPTION_REG` prescaler, cờ `TMR0IF`, ngắt tràn |

## Giám sát chip đang chạy

- **Thanh ghi:** W, STATUS (từng cờ C, DC, Z), PCL, PCLATH, FSR, TMR0,
  INTCON, PORTA–PORTE, TRISA–TRISE, ADCON0/1, ADRESH/L, TXSTA/RCSTA.
- **RAM bank 0:** bảng hex 0x20–0x7F cập nhật theo thời gian thực.
- **Listing:** code đã dịch kèm địa chỉ, dòng đang chạy (PC) được tô sáng.
- **GPIO Inspector:** 33 chân, mỗi chân hiện hướng (in/out theo TRISx)
  và mức 0 / 1 / Z (Z là chân input đang thả nổi).
- **Logic Analyzer:** vẽ dạng sóng 4 chân chọn được (mặc định RB0, RB1,
  RC0, RC6/TX), kèm ước lượng tần số và duty của kênh đầu tiên.
- **Trạng thái:** thời gian mô phỏng, số chu kỳ CPU, PC hiện tại.

## Nạp file ngoài

- **Nạp file .hex:** bấm "Nạp file .hex", chọn file Intel HEX biên dịch
  từ MPLAB XC8, mikroC hoặc trình biên dịch PIC khác (kèm config word).
  Chip sẽ chạy đúng firmware đó.
- **Tải về:** tải code Assembly đang soạn (`.asm`) hoặc chương trình đã
  dịch (`.hex`) về máy.

Chức năng lấy cảm hứng từ cách tổ chức bàn thí nghiệm của
[ohmimic.com](https://ohmimic.com/vi) (board trực quan, bài lab từng bước,
inspector GPIO, logic analyzer) — nhưng toàn bộ code mô phỏng PIC viết mới
hoàn toàn, không copy code hay giao diện của trang đó.

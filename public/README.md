# HoaTrang — Mô phỏng PIC16F877A

Trang web mô phỏng vi điều khiển PIC16F877A ngay trên trình duyệt:
soạn Assembly, dịch, chạy từng lệnh hoặc chạy thời gian thực, quan sát
LED, nút nhấn, LCD 16x2, ADC, UART, thanh ghi, RAM và Logic Analyzer.

## Dùng nhanh

1. Chọn ví dụ mẫu (mặc định: Nhấp nháy LED RB0).
2. Bấm **Dịch & Nạp** (hoặc Ctrl+Enter).
3. Bấm **Chạy tất cả**; đổi tốc độ 0.1x / 0.5x / 1x / Tối đa; bấm
   **Chạy từng lệnh** để step; bấm vào số dòng để đặt breakpoint.
4. Tương tác với board: nhấn giữ nút RC0–RC3, kéo chiết áp AN0,
   gõ ký tự vào Terminal UART.
5. Làm theo panel **Bài học** để quan sát từng bước.

## Viết chương trình Assembly

Đủ 35 lệnh: `MOVLW`, `MOVWF`, `MOVF`, `CLRF`, `ADDWF`, `SUBWF`,
`ANDWF`, `IORWF`, `XORWF`, `INCF`, `DECF`, `INCFSZ`, `DECFSZ`,
`BSF`, `BCF`, `BTFSS`, `BTFSC`, `GOTO`, `CALL`, `RETURN`, `RETLW`,
`NOP`, `SLEEP`, `CLRWDT`... Dùng nhãn (`ten:`), `EQU`, `ORG`,
`BANKSEL`, chú thích bằng `;`. Lỗi dịch hiện kèm số dòng, bấm vào lỗi
để nhảy tới đúng dòng. Tần số thạch anh chọn được 1 / 4 / 8 / 20 MHz.

## Dùng board

- **8 LED PORTB (RB0–RB7):** sáng khi chân là output và mức ra là 1.
- **4 nút nhấn RC0–RC3:** nhấn giữ là mức 0 (active-low). Đọc bằng
  `BTFSS` / `BTFSC PORTC, n` để rẽ nhánh theo nút.
- **Chiết áp AN0:** kéo thanh trượt 0–5V, chip đọc qua ADC 10-bit,
  kết quả 0–1023 trong `ADRESH:ADRESL` (bật `ADON`, set `GO` để chuyển đổi).
- **LCD 16x2:** data PORTD, RS = RE0, E = RE1. Gửi lệnh/ký tự qua PORTD
  rồi tạo xung E.
- **Terminal UART:** chip gửi qua `TXREG` (RC6/TX) thì hiện trong
  terminal; gõ ký tự để gửi vào `RCREG` (RC7/RX). Mặc định 9600 baud.

## Các bài lab mẫu

Nhấp nháy LED RB0 · LED chạy PORTB · Nút nhấn RC0 bật LED ·
LCD "Hello PIC16F877A" · Đọc ADC AN0 hiện lên LCD · UART echo 9600 ·
Timer0 nhấp nháy LED.

## Giám sát chip đang chạy

Thanh ghi (W, STATUS, PCL, FSR, TMR0, INTCON, PORTx, TRISx, ADCONx...),
bảng RAM bank 0, listing với dòng PC tô sáng, GPIO Inspector 33 chân
(hướng + mức 0/1/Z), Logic Analyzer 4 kênh kèm tần số/duty, thời gian mô
phỏng và số chu kỳ CPU.

## Nạp file ngoài

**Nạp file .hex** Intel HEX từ MPLAB XC8, mikroC hoặc trình biên dịch PIC
khác để chạy firmware có sẵn. **Tải về** code Assembly (`.asm`) hoặc chương
trình đã dịch (`.hex`).

Chức năng lấy cảm hứng từ cách tổ chức bàn thí nghiệm của ohmimic.com
(board trực quan, bài lab từng bước, thanh điều khiển tốc độ, inspector
GPIO, logic analyzer) — nhưng viết mới hoàn toàn cho PIC16F877A, không
copy code hay giao diện của trang đó. Giao diện theo design system riêng
(navy #1E3A5F, accent #059669, Fira Code / Fira Sans).

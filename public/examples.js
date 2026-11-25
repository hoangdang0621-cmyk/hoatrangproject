// examples.js — 7 bài lab mẫu cho PIC16F877A (code Assembly + hướng dẫn từng bước).
// Không phụ thuộc DOM: app.js import để hiển thị, test Node import để kiểm chứng
// mọi ví dụ đều dịch được và chạy đúng.

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

export const EXAMPLES = [
  {
    id: 'blink',
    name: 'Nhấp nháy LED RB0',
    desc: 'LED trên RB0 bật/tắt liên tục nhờ vòng lặp trễ bằng phần mềm.',
    code:
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
    END`,
    lab: [
      { t: 'Nạp chương trình', d: 'Bấm nút "Dịch & Nạp" (hoặc Ctrl+Enter). Kiểm tra thanh trạng thái báo "Đã nạp" và không có lỗi assembler.' },
      { t: 'Chạy mô phỏng', d: 'Bấm "Chạy tất cả" ở tốc độ 1x. Quan sát LED RB0 trên board nhấp nháy đều, khoảng 0,4 giây một chu kỳ.' },
      { t: 'Xem thanh ghi', d: 'Nhìn panel Thanh ghi: PORTB đổi giữa 0x01 và 0x00 theo nhịp LED; PC nhảy quanh vòng LOOP và chương trình con DELAY.' },
      { t: 'Chạy từng lệnh', d: 'Bấm "Tạm dừng" rồi bấm "Chạy từng lệnh" vài lần: xem dòng lệnh hiện tại (highlight vàng) đi qua BSF, CALL, DECFSZ.' },
      { t: 'Thử đổi tốc độ', d: 'Chuyển tốc độ sang 0.1x để thấy LED đổi chậm, rồi sang "Tối đa" để thấy LED nhấp nháy rất nhanh. Logic Analyzer sẽ vẽ dạng sóng vuông của RB0.' },
    ],
  },
  {
    id: 'chase',
    name: 'LED chạy trên PORTB',
    desc: 'Một LED sáng duy nhất chạy vòng quanh 8 LED của PORTB (xoay trái qua cờ C).',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". Quan sát vệt sáng chạy từ RB0 sang RB7 rồi quay lại RB0.' },
      { t: 'Theo dõi RLF', d: 'Tạm dừng rồi Step qua lệnh RLF 0x20,F: giá trị ô nhớ 0x20 nhân đôi mỗi vòng (01 -> 02 -> 04 ... -> 80), cờ C bật lên khi tràn khỏi RB7.' },
      { t: 'Xem Logic Analyzer', d: 'Mở panel Logic Analyzer: 4 chân RB0, RB1, RC0, RC6 vẽ dạng sóng; RB0 và RB1 lệch pha nhau đúng một nhịp LED.' },
    ],
  },
  {
    id: 'button',
    name: 'Nút nhấn RC0 bật LED RB0',
    desc: 'Nhấn giữ nút RC0 (mức 0, active-low) thì LED RB0 sáng, thả ra thì tắt.',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". Lúc chưa nhấn, LED RB0 tắt.' },
      { t: 'Nhấn nút', d: 'Nhấn giữ nút RC0 trên board: LED RB0 sáng ngay. Thả ra: LED tắt. Đây là nút active-low (nhấn = mức 0).' },
      { t: 'Xem GPIO Inspector', d: 'Khi nhấn, hàng RC0 trong bảng GPIO đổi: hướng Vào, mức 0. BTFSC PORTC,0 rẽ nhánh theo đúng mức này.' },
    ],
  },
  {
    id: 'lcd',
    name: 'LCD hiển thị "Hello PIC16F877A"',
    desc: 'Khởi tạo LCD 16x2 (data PORTD, RS=RE0, E=RE1) và in dòng chữ lên 2 hàng.',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". LCD hiện dòng 1 "Hello PIC16F877A" và dòng 2 "HOATRANG LAB".' },
      { t: 'Xem xung E', d: 'Tạm dừng, Step từng lệnh qua LCD_CMD: mỗi lần BSF PORTE,1 (xung E lên) thì 1 ký tự mới xuất hiện trên LCD.' },
      { t: 'Hiểu lệnh LCD', d: '0x38: giao tiếp 8-bit; 0x0C: bật hiển thị; 0x01: xoá màn hình; 0xC0: nhảy về đầu dòng 2. Xem lại code khởi tạo ở đầu chương trình.' },
    ],
  },
  {
    id: 'adc',
    name: 'Đọc ADC AN0 hiển thị lên LCD',
    desc: 'Chiết áp AN0 (0-5V) được ADC 10-bit đọc rồi hiển thị giá trị 0-1023 lên LCD.',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". LCD hiện "AN0=xxxx" với xxxx là giá trị ADC hiện tại (0-1023).' },
      { t: 'Xoay chiết áp', d: 'Kéo thanh trượt chiết áp AN0 trên board: kéo về 0V thì LCD hiện 0000, kéo lên 5V thì hiện 1023. Giữa chừng, giá trị đổi theo.' },
      { t: 'Kiểm tra 2.5V', d: 'Đặt chiết áp đúng 2.5V: giá trị ADC phải xấp xỉ 512 (một nửa thang 1023). Đây là cách kiểm chứng ADC 10-bit.' },
      { t: 'Xem thanh ghi ADC', d: 'Mở panel Thanh ghi: ADCON0 có GO=0 sau mỗi lần chuyển đổi xong, ADRESH/ADRESL giữ kết quả; cờ ADIF trong PIR1 bật lên (bit 6).' },
      { t: 'Hiểu cách đổi số', d: 'Chương trình con DISP_NUM chia số 10-bit cho 1000, 100, 10, 1 bằng phép trừ lặp để ra 4 chữ số thập phân rồi cộng với ký tự \'0\' để in lên LCD.' },
    ],
  },
  {
    id: 'uart',
    name: 'UART echo (9600 baud)',
    desc: 'Nhận 1 ký tự từ terminal (RC7/RX) rồi gửi trả lại đúng ký tự đó (RC6/TX).',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". CPU đang chờ ký tự ở chân RX (RC7).' },
      { t: 'Gõ thử 1 ký tự', d: 'Gõ "A" vào ô nhập của Terminal UART rồi bấm Gửi (hoặc Enter): terminal hiện lại "A" — đó là ký tự CPU echo về qua TX (RC6).' },
      { t: 'Xem cờ RCIF', d: 'Khi ký tự tới, cờ RCIF (PIR1 bit 5) bật lên; lệnh MOVF RCREG,W đọc xong thì RCIF tự tắt. TXREG phát xong thì TXIF bật.' },
      { t: 'Thử một chuỗi', d: 'Gõ "HELLO": từng ký tự được echo lại theo đúng thứ tự. Baud 9600 @4MHz nhờ SPBRG=25, BRGH=1.' },
    ],
  },
  {
    id: 'timer0',
    name: 'Timer0 nhấp nháy LED',
    desc: 'TMR0 tràn sau mỗi ~65ms thì đảo trạng thái LED RB0 — nhấp nháy bằng ngắt/tràn timer thay vì delay phần mềm.',
    code:
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
    END`,
    lab: [
      { t: 'Nạp và chạy', d: 'Bấm "Dịch & Nạp" rồi "Chạy tất cả". LED RB0 nhấp nháy đều nhờ TMR0 tràn, không dùng vòng lặp trễ.' },
      { t: 'Xem TMR0 đếm', d: 'Nhìn panel Thanh ghi: TMR0 tăng dần 0 -> 255 rồi về 0, cờ TMR0IF (INTCON bit 2) bật lên mỗi lần tràn.' },
      { t: 'Đổi prescaler', d: 'Thử sửa MOVLW 0x07 thành 0x00 (prescaler 1:2) rồi nạp lại: LED nhấp nháy nhanh hơn hẳn vì TMR0 tràn sớm hơn.' },
    ],
  },
];

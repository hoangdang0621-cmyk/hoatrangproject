# HoaTrang — Bàn thực hành 3D PIC16F877A

Trang web là một bàn thí nghiệm 3D cho vi điều khiển PIC16F877A, chạy ngay
trên trình duyệt. Trên bàn có sẵn breadboard chọn được 3 size (Mini 170
lỗ, Nửa 400 lỗ, Đầy đủ 830 lỗ), chip PIC16F877A cắm sẵn vắt qua rãnh giữa,
nguồn 5V đặt phía sau đã nối dây về rail. Linh kiện trên bàn nối vào chip
thật — đổi dây trên bàn thì chip chạy theo dây mới.
Trang này chỉ dùng trên máy tính.

Chip chạy sẵn chương trình nhấp nháy LED RB0: nối một LED (kèm điện trở
nối tiếp) vào strip của chân RB0 thì LED nhấp nháy theo nhịp chip.

## Dùng nhanh

1. **Đặt linh kiện:** kéo linh kiện từ khay **Linh Kiện** bên trái thả
   vào lỗ breadboard — chân cắm thẳng vào lỗ, breadboard chính là đế.
   Ô xanh là đặt được, ô đỏ là không (lỗ đã có chân, dưới thân chip,
   ngoài bàn). Bấm phím R trong lúc kéo để xoay linh kiện 90°.
   Bấm vào khay (không kéo) rồi bấm vào lỗ cũng đặt được — và bấm 1 lần
   thì giữ chế độ đặt (đặt dính): bấm liên tục nhiều lỗ để thả nhiều cái,
   bấm lại đúng thẻ đó hoặc Esc để thoát. R vẫn xoay trong lúc đặt dính.
2. **Xoay bàn:** kéo chuột vào chỗ trống trên bàn để xoay 360°, cuộn
   chuột để zoom. Nút **3D** / **Từ trên** đổi góc nhìn.
3. **Đi dây:** bấm **Dây dẫn** rồi bấm lỗ bắt đầu và lỗ kết thúc, dây
   hiện thành đường cong nối 2 lỗ. Chọn màu dây trong bảng 8 màu.
   Bấm chọn 1 dây thì dây highlight (sáng + dày hơn, 2 đầu hiện núm
   tròn): kéo núm tròn tới lỗ khác để cắm lại đầu dây đó, hoặc nhập
   địa chỉ lỗ cho từng đầu dây trong Inspector (vd `c12`, `T+5`).
4. **Chỉnh linh kiện:** bấm chọn linh kiện thì panel Inspector trượt từ
   phải sang — đổi giá trị điện trở, màu LED, mức chiết áp (%), xem chân
   nào nối đi đâu, xoá linh kiện/dây (hoặc phím Delete).
5. **Kiểm tra:** panel bên trái liệt kê cảnh báo đấu nối trên bàn, bấm
   vào cảnh báo để chọn linh kiện liên quan.
6. **Chọn size bo mạch:** nút Mini 170 / Nửa 400 / Đầy đủ 830 ngay trên
   thanh công cụ của bàn. Đổi size thì chip tự căn lại giữa board,
   linh kiện/dây còn trên board mới được giữ nguyên, cái ngoài board
   bị gỡ (có ghi chú ở dòng trạng thái).

## Khay linh kiện

- **LED:** 2 đầu A/K. Sáng khi anode ở mức 1 và cathode về GND (hoặc mức 0).
- **Điện trở 220Ω:** 2 đầu, nối tiếp với LED để hạn dòng. Đổi được giá
  trị Ω trong Inspector, vạch màu trên thân đổi theo.
- **Nút nhấn:** 2 đầu, active-low (nhấn giữ là mức 0, có pull-up).
- **Chiết áp:** 3 đầu VCC/Wiper/GND. Wiper nối kênh AN nào thì ADC của
  chip đọc điện áp đó (0–5V, 10-bit).
- **LCD 16x2:** 10 đầu RS/E/D0–D7. Nối đủ dây thì hiện chữ theo chương
  trình chạy trên chip.
- **Còi buzzer:** 2 đầu. Còi kêu khi chân + ra mức 1.
- **Nguồn 5V:** đặt lên mặt bàn, cọc + (đỏ) và − (đen) nối vào rail
  trên/dưới của breadboard.
- **Dây dẫn:** bấm 2 lỗ để nối, dây hiện thành đường cong màu.

## Breadboard (3 size)

Hàng a–e của mỗi cột nối với nhau thành một strip, hàng f–j nối với nhau
thành một strip riêng; 2 rail +/− chạy suốt chiều dài (mọi lỗ rail + là
+5V, mọi lỗ rail − là GND). Chip PIC16F877A luôn căn giữa board: cắm ở
cột 22–41 trên board 830, cột 6–25 trên board 400, cột 1–17 trên board
Mini (chip DIP-40 rộng 20 cột nên trên board Mini thì 6 chân ngoài cùng
MCLR/RD0/RD1/RD2/RD3/RB7 treo ngoài board, 34 chân còn lại cắm đúng lỗ).
Dây nguồn VDD/VSS/MCLR đã nối sẵn về rail (board Mini không có rail nên
không có dây nguồn mặc định).

## Cảnh báo thường gặp (panel "Kiểm tra")

- **Nối tắt +5V–GND:** dây nối cả 2 rail nguồn — sẽ chập nguồn, gỡ ngay.
- **LED không có điện trở:** LED nối thẳng chân chip mà không qua điện trở
  hạn dòng, dễ cháy LED.
- **LCD chưa nối đủ dây:** thiếu RS, E hoặc D0–D7 — LCD không hiện chữ
  cho tới khi nối đủ.
- **Hai chân output nối trực tiếp:** 2 chân cùng là ngõ ra nối nhau, có
  thể hỏng chân.
- **Chân chip nối 2 nguồn tín hiệu:** 2 linh kiện cùng lái một chân, mức
  logic xung đột.
- **Đầu nối chưa nối dây:** đầu nối của linh kiện còn bỏ trống.

Bấm vào một cảnh báo để chọn linh kiện liên quan.

## Bàn mặc định

Bàn mặc định có chip PIC + nguồn 5V + dây nguồn VDD/VSS/MCLR về rail.
Nút **Dọn hết bàn** giữ lại chip, nguồn và dây nguồn; nút **Về bàn mặc
định** khôi phục toàn bộ. Trạng thái bàn tự lưu trên máy (localStorage),
mở lại trang vẫn còn.

Bố cục lấy cảm hứng từ bàn thí nghiệm của
[ohmimic.com/vi/bench](https://ohmimic.com/vi/bench) (bàn 3D xoay được,
breadboard làm đế cắm, inspector bên phải) — nhưng toàn bộ code mô phỏng
PIC viết mới hoàn toàn, không copy code hay giao diện của trang đó.

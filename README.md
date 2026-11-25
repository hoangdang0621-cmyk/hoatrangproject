# HoaTrang — Bàn thực hành 3D PIC16F877A

Trang web là một bàn thí nghiệm 3D cho vi điều khiển PIC16F877A, chạy ngay
trên trình duyệt. Trên bàn có sẵn breadboard đổi được kích thước (3 mẫu
sẵn Mini 170 lỗ, Nửa 400 lỗ, Đầy đủ 830 lỗ, hoặc tự điền rộng × dài), chip
PIC16F877A cắm sẵn vắt qua rãnh giữa, nguồn đặt phía sau đã nối dây
về rail. Linh kiện trên bàn nối vào chip thật — đổi dây trên bàn thì chip
chạy theo dây mới.
Trang này chỉ dùng trên máy tính. Trang chính của trang web là
index.html (3 mục Lý thuyết, Bài tập, Thực hành); bấm Thực hành để vào
bàn thực hành (thuc-hanh/).

Chip đứng yên khi mở trang (chưa nạp chương trình nào). Tab **Nạp viết
code** bên trái mở sẵn code mẫu nhấp nháy LED RB0: nối một LED (kèm điện
trở nối tiếp) vào strip của chân RB0, rồi bấm **Nạp & chạy** thì LED
nhấp nháy theo nhịp chip. Hoặc mở tab **Bài Lab** bấm **Mở lab** ở bài
**Điều khiển LED** để có sẵn mạch đó trên bàn.

## Dùng nhanh

1. **Đặt linh kiện:** kéo linh kiện từ khay **Linh Kiện** bên trái thả
   vào lỗ breadboard — chân cắm thẳng vào lỗ, breadboard chính là đế.
   Ô xanh là đặt được, ô đỏ là không (lỗ đã có chân, dưới thân chip,
   ngoài bàn). Bấm phím R trong lúc kéo để xoay linh kiện 90°.
   Bấm vào khay (không kéo) rồi bấm vào lỗ cũng đặt được — bấm 1 lần
   thì đặt đúng 1 cái rồi tự thoát chế độ đặt; muốn thả cái nữa thì bấm
   chọn lại thẻ đó. Bấm lại đúng thẻ đó hoặc Esc để thoát trước khi đặt.
   R vẫn xoay trong lúc đặt bằng bấm.
2. **Xoay bàn:** kéo chuột vào chỗ trống trên bàn để xoay 360°; chuột
   phải hoặc Shift+kéo để dịch góc nhìn; cuộn chuột để zoom vào điểm
   trỏ. Nút **3D** / **Từ trên** đổi góc nhìn.
3. **Đi dây:** bấm **Dây dẫn** rồi bấm lỗ bắt đầu và lỗ kết thúc, dây
   hiện thành đường cong nối 2 lỗ. Nối xong 1 dây thì tự thoát chế độ dây
   (one-shot như đặt linh kiện) — muốn nối nữa thì bấm lại **Dây dẫn**.
   Chọn màu dây trong bảng 8 màu. Bấm chọn 1 dây thì dây highlight (sáng + dày hơn, 2 đầu hiện núm
   tròn): kéo núm tròn tới lỗ khác hoặc cọc +/− của nguồn để cắm lại
   đầu dây đó, hoặc nhập địa chỉ cho từng đầu dây trong Inspector
   (vd `c12`, `T+5`, cọc nguồn `PSU1.+` / `PSU1.-`).
4. **Chỉnh linh kiện:** bấm chọn linh kiện thì panel Inspector trượt từ
   phải sang — đổi giá trị điện trở, màu LED, mức chiết áp (%), điện áp
   nguồn (0–24V), xem chân nào nối đi đâu, xoá linh kiện/dây (hoặc phím Delete).
5. **Kiểm tra:** panel bên trái liệt kê cảnh báo đấu nối trên bàn, bấm
   vào cảnh báo để chọn linh kiện liên quan.
6. **Nạp viết code:** tab **Nạp viết code** cạnh tab **Linh Kiện** —
   soạn hợp ngữ trong editor (bấm vào số dòng bên trái để đặt/bỏ
   breakpoint, chỉ dòng dịch ra lệnh mới đặt được), bấm **Nạp & chạy**
   để dịch + nạp + chạy; **Chạy tiếp** chạy tiếp tới breakpoint sau,
   **Chạy từng lệnh** chạy đúng 1 lệnh, **Dừng** tạm dừng giữ nguyên
   trạng thái CPU. Bấm **Nạp file .hex** để nạp file Intel HEX (chạy
   luôn, breakpoint không áp dụng cho chương trình .hex). Bấm vào phần
   code thì panel trái tự rộng lên 40%, bấm ra ngoài thì tự về 20%.
   Code và breakpoint tự lưu trên máy (localStorage), mở lại trang vẫn còn.
6. **Chọn size bo mạch:** nhấn chuột vào board (thân board hoặc lỗ
   trống) để mở popup **Bo mạch** bên phải: bấm 1 trong 3 mẫu sẵn (Mini
   170 / Nửa 400 / Đầy đủ 830 lỗ) để áp dụng ngay, hoặc tự điền rộng
   (số cột 5–100) × dài (số hàng 5–100, bội số của 5) + chọn có rail nguồn rồi bấm Áp
   dụng. Đổi size thì chip tự căn lại giữa board, linh kiện/dây còn trên
   board mới được giữ nguyên, cái ngoài board bị gỡ (có ghi chú ở dòng
   trạng thái).
7. **Bài Lab:** tab **Bài Lab** cạnh tab **Nạp viết code** — list các
   bài lab mẫu, bấm **Mở lab** để nạp mạch của bài đó lên bàn (thay mạch
   hiện tại; chip PIC, nguồn và dây nguồn mặc định vẫn giữ nguyên). Lab
   1 **Điều khiển LED**: LED nối RB0 qua điện trở 220Ω, cathode về GND
   — mở lab rồi sang tab **Nạp viết code** bấm **Nạp & chạy** thì LED
   nhấp nháy theo nhịp chip.

## Khay linh kiện

- **LED:** 2 đầu A/K. Sáng khi anode ở mức 1 và cathode về GND (hoặc mức 0),
  hoặc anode có điện từ nguồn/rail + và cathode về GND — LED nối VCC chỉ
  sáng khi 0 < điện áp nguồn ≤ 10V (0V thì tắt, trên 10V thì tắt trong lúc
  điện áp cao, hạ xuống ≤10V thì sáng lại; nhớ thêm điện trở hạn dòng).
- **Điện trở 220Ω:** 2 đầu, nối tiếp với LED để hạn dòng. Đổi được giá
  trị Ω trong Inspector, vạch màu trên thân đổi theo.
- **Nút nhấn:** 2 đầu, là công tắc: nhấn giữ thì nối 2 chân T1–T2 với
  nhau (vd nối tiếp nguồn–LED qua nút thì nhấn mới sáng), nhả ra thì ngắt.
  Nếu 1 chân nối chân PIC thì nhấn kéo chân đó về mức 0 (active-low, có
  pull-up).
- **Chiết áp:** 3 đầu VCC/Wiper/GND. Wiper nối kênh AN nào thì ADC của
  chip đọc điện áp đó (0–5V, 10-bit).
- **LCD 16x2:** 10 đầu RS/E/D0–D7. Nối đủ dây thì hiện chữ theo chương
  trình chạy trên chip.
- **Còi buzzer:** 2 đầu. Còi kêu bằng tiếng (Web Audio, sóng vuông 2300 Hz)
  khi chân + ra mức 1 — chân PIC mức cao hoặc nối thẳng nguồn 0–10V — và
  chân − về GND. Bấm vào còi để tắt/bật tiếng trong Inspector.
- **Nguồn:** nguồn chung đặt lên mặt bàn, cọc + (đỏ) và − (đen) nối
  vào rail trên/dưới của breadboard. Bấm vào nguồn để mở Inspector và
  đổi điện áp (0–24V, mặc định 5V); màn hình trên nguồn và nhãn nguồn
  hiện đúng voltage hiện tại (vd Nguồn 12V).
- **Dây dẫn:** bấm 2 lỗ để nối, dây hiện thành đường cong màu.

## Breadboard

Nhãn hàng kiểu bảng tính: a–z, aa–az, ba–bz... (hàng 27 là aa, hàng 52
là az, hàng 53 là ba, hàng 100 là cv); địa chỉ lỗ dạng nhãn hàng + số
cột, vd `aa12` = hàng aa cột 12, `c12` = hàng c cột 12. Mỗi đoạn 5 hàng
nối nhau thành một strip
(hàng 1–5, 6–10, 11–15...; board 10 hàng thì vẫn a–e và f–j, vạch chia
đoạn ở giữa); 2 rail +/− chạy suốt chiều dài (mọi lỗ rail + nối về cọc
+ của nguồn, mọi lỗ rail − nối về cọc − của nguồn). Chip PIC16F877A luôn căn giữa board: cắm ở
cột 22–41 trên board 830, cột 6–25 trên board 400, cột 1–17 trên board
Mini (chip DIP-40 rộng 20 cột nên trên board Mini thì 6 chân ngoài cùng
MCLR/RD0/RD1/RD2/RD3/RB7 treo ngoài board, 34 chân còn lại cắm đúng lỗ).
Chip là một khối duy nhất (thân + chân đi cùng nhau), căn giữa board:
2 hàng chân cách nhau cố định 6 hàng, đối xứng qua tâm chip (vd board
10 hàng → b/h, 15 hàng → e/k, 30 hàng → l/r, 100 hàng → au/ba; board
5 hàng → b/f với hàng 6 treo ngoài board). Thân chip ôm đúng 2 hàng
chân. Board tự điền rộng 5–100 cột × dài 5–100 hàng (chỉ bội số của 5)
cũng căn giữa chip theo cùng cách; rail nguồn tùy chọn, bật thì rail
dài bằng số cột. Dây nguồn VDD/VSS/MCLR đã nối
sẵn về rail (board Mini không có rail nên không có dây nguồn mặc định).

## Cảnh báo thường gặp (panel "Kiểm tra")

- **Nối tắt +5V–GND:** dây nối cả 2 rail nguồn — sẽ chập nguồn, gỡ ngay.
- **LED không có điện trở:** LED nối thẳng chân chip mà không qua điện trở
  hạn dòng, dễ cháy LED.
- **LED có nguồn nhưng chưa nối về GND:** anode đã có điện mà cathode còn
  nổi — LED không sáng, nối cathode về thanh GND.
- **LED nối VCC mà nguồn quá 10V:** nguồn đang ở 12V thì LED không sáng
  (chưa cháy, chỉ tắt trong lúc điện áp cao) — hạ điện áp xuống 10V trở xuống.
- **LED nối tắt 2 đầu:** anode và cathode nối cùng 1 net nên LED không sáng.
- **LCD chưa nối đủ dây:** thiếu RS, E hoặc D0–D7 — LCD không hiện chữ
  cho tới khi nối đủ.
- **Hai chân output nối trực tiếp:** 2 chân cùng là ngõ ra nối nhau, có
  thể hỏng chân.
- **Chân chip nối 2 nguồn tín hiệu:** 2 linh kiện cùng lái một chân, mức
  logic xung đột.
- **Đầu nối chưa nối dây:** đầu nối của linh kiện còn bỏ trống.

Bấm vào một cảnh báo để chọn linh kiện liên quan.

## Bàn mặc định

Bàn mặc định có chip PIC + nguồn + dây nguồn VDD/VSS/MCLR về rail.
Nút **Dọn hết bàn** giữ lại chip, nguồn và dây nguồn; nút **Về bàn mặc
định** khôi phục toàn bộ. Trạng thái bàn tự lưu trên máy (localStorage),
mở lại trang vẫn còn.

Bố cục lấy cảm hứng từ bàn thí nghiệm của
[ohmimic.com/vi/bench](https://ohmimic.com/vi/bench) (bàn 3D xoay được,
breadboard làm đế cắm, inspector bên phải) — nhưng toàn bộ code mô phỏng
PIC viết mới hoàn toàn, không copy code hay giao diện của trang đó.

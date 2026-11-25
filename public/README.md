# HoaTrang — Bàn thực hành 3D PIC16F877A

Bàn thí nghiệm 3D cho vi điều khiển PIC16F877A, chạy ngay trên trình
duyệt: breadboard đổi được kích thước (3 mẫu sẵn Mini 170 lỗ, Nửa 400
lỗ, Đầy đủ 830 lỗ, hoặc tự điền rộng × dài), chip PIC16F877A cắm sẵn, nguồn
phía sau đã nối dây về rail. Linh kiện trên bàn nối vào chip thật —
đổi dây trên bàn thì chip chạy theo dây mới. Trang này chỉ dùng trên
máy tính. Trang chính của trang web là index.html (3 mục Lý thuyết,
Bài tập, Thực hành); bấm Thực hành để vào bàn thực hành này (thuc-hanh/).

Chip đứng yên khi mở trang (chưa nạp chương trình nào). Tab **Nạp viết
code** mở sẵn code mẫu nhấp nháy LED RB0: nối một LED (kèm điện trở nối
tiếp) vào strip của chân RB0, rồi bấm **Nạp & chạy** thì LED nhấp nháy
theo nhịp chip.

## Dùng nhanh

- **Đặt linh kiện:** kéo từ khay **Linh Kiện** bên trái thả vào lỗ
  breadboard (chân cắm thẳng vào lỗ). Ô xanh là đặt được, ô đỏ là không.
  Phím R xoay linh kiện 90° trong lúc kéo. Bấm vào khay rồi bấm vào lỗ
  cũng đặt được — bấm 1 lần thì đặt đúng 1 cái rồi tự thoát chế độ đặt;
  muốn thả cái nữa thì bấm chọn lại thẻ đó. Bấm lại thẻ đó hoặc Esc để
  thoát trước khi đặt.
- **Xoay bàn:** kéo chỗ trống để xoay 360°; chuột phải hoặc Shift+kéo
  để dịch góc nhìn; cuộn chuột để zoom vào điểm trỏ; nút
  **3D** / **Từ trên** đổi góc nhìn.
- **Đi dây:** bấm **Dây dẫn** rồi bấm 2 điểm; nối xong 1 dây thì tự thoát
  chế độ dây (one-shot) — muốn nối nữa thì bấm lại **Dây dẫn**. Chọn màu
  dây trong bảng màu. Bấm chọn 1 dây thì dây highlight, kéo núm tròn ở 2
  đầu để cắm lại (sang lỗ khác hoặc cọc +/− của nguồn), hoặc nhập địa chỉ
  cho từng đầu trong Inspector (vd `c12`, `T+5`, cọc nguồn `PSU1.+` /
  `PSU1.-`; địa chỉ dạng nhãn hàng kiểu bảng tính + số cột, vd `aa12` =
  hàng aa cột 12).
- **Nạp viết code:** tab **Nạp viết code** cạnh tab **Linh Kiện** —
  soạn hợp ngữ trong editor (bấm vào số dòng bên trái để đặt/bỏ
  breakpoint, chỉ dòng dịch ra lệnh mới đặt được), bấm **Nạp & chạy**
  để dịch + nạp + chạy; **Chạy tiếp** chạy tiếp tới breakpoint sau,
  **Chạy từng lệnh** chạy đúng 1 lệnh, **Dừng** tạm dừng giữ nguyên
  trạng thái CPU. Bấm **Nạp file .hex** để nạp file Intel HEX (chạy
  luôn, breakpoint không áp dụng cho chương trình .hex). Bấm vào phần
  code thì panel trái tự rộng lên 40%, bấm ra ngoài thì tự về 20%.
  Code và breakpoint tự lưu trên máy, mở lại trang vẫn còn.
- **Bài Lab:** tab **Bài Lab** cạnh tab **Nạp viết code** — list các
  bài lab mẫu, bấm **Mở lab** để nạp mạch của bài đó lên bàn (thay mạch
  hiện tại; chip PIC, nguồn và dây nguồn mặc định vẫn giữ nguyên). Lab 1
  **Điều khiển LED**: LED nối RB0 qua điện trở 220Ω, cathode về GND —
  mở lab rồi sang tab **Nạp viết code** bấm **Nạp & chạy** thì LED nhấp
  nháy theo nhịp chip.
- **Chọn size bo mạch:** nhấn vào board (thân board hoặc lỗ trống) để
  mở popup **Bo mạch** bên phải: bấm 1 trong 3 mẫu sẵn để áp dụng ngay,
  hoặc tự điền rộng (số cột 5–100) × dài (số hàng 5–100, bội số của 5) + chọn có rail
  nguồn rồi bấm Áp dụng; đổi size thì chip căn lại giữa, linh kiện/dây
  ngoài board mới bị gỡ (có ghi chú ở dòng trạng thái).
- **Nút nhấn:** là công tắc 2 đầu — nhấn giữ thì nối 2 chân T1–T2 với
  nhau (vd nối tiếp nguồn–LED qua nút thì nhấn mới sáng), nhả ra thì ngắt;
  nếu 1 chân nối chân PIC thì nhấn kéo chân đó về mức 0 (active-low, có
  pull-up).
- **Inspector:** bấm chọn linh kiện thì panel trượt từ phải sang để đổi
  tính chất (giá trị điện trở, màu LED, mức chiết áp, điện áp nguồn
  0–24V), xem chân nối đi đâu, xoá linh kiện/dây (phím Delete).
- **Kiểm tra:** panel bên trái liệt kê cảnh báo đấu nối (nối tắt, LED
  thiếu điện trở, LED có nguồn nhưng chưa nối về GND, LED nối tắt 2 đầu,
  nguồn quá 10V nên LED không sáng, LCD thiếu dây...), bấm vào cảnh báo
  để chọn linh kiện liên quan.

## Breadboard

Nhãn hàng kiểu bảng tính: a–z, aa–az, ba–bz... (hàng 27 là aa, hàng 52
là az, hàng 53 là ba, hàng 100 là cv).
Mỗi đoạn 5 hàng nối nhau thành một strip (hàng 1–5, 6–10, 11–15...;
board 10 hàng thì vẫn a–e và f–j, vạch chia đoạn ở giữa); 2 rail +/− chạy suốt
chiều dài. Chip PIC16F877A luôn căn giữa board (cột 22–41 trên board
830, cột 6–25 trên board 400, cột 1–17 trên board Mini — trên board
Mini thì 6 chân ngoài cùng MCLR/RD0/RD1/RD2/RD3/RB7 treo ngoài board).
Chip là một khối duy nhất (thân + chân đi cùng nhau), căn giữa board:
2 hàng chân cách nhau cố định 6 hàng, đối xứng qua tâm chip (vd board
10 hàng → b/h, 15 hàng → e/k, 30 hàng → l/r, 100 hàng → au/ba; board
5 hàng → b/f với hàng 6 treo ngoài board). Thân chip ôm đúng 2 hàng
chân. Board tự điền rộng 5–100 cột × dài 5–100 hàng (chỉ bội số của 5)
cũng căn giữa chip theo cùng cách; rail nguồn tùy chọn, bật thì rail
dài bằng số cột. Dây nguồn VDD/VSS/MCLR đã nối
sẵn về rail (board Mini không có rail nên không có dây nguồn mặc định).

Bàn mặc định có chip + nguồn + dây nguồn. Nút **Dọn hết bàn** giữ lại
chip, nguồn và dây nguồn; nút **Về bàn mặc định** khôi phục toàn bộ.
Trạng thái bàn tự lưu trên máy, mở lại trang vẫn còn.

Bố cục lấy cảm hứng từ bàn thí nghiệm của
[ohmimic.com/vi/bench](https://ohmimic.com/vi/bench) — nhưng viết mới
hoàn toàn cho PIC16F877A, không copy code hay giao diện của trang đó.
Giao diện theo design system riêng (navy #1E3A5F, accent #059669,
Fira Code / Fira Sans).

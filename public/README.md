# HoaTrang — Bàn thực hành 3D PIC16F877A

Bàn thí nghiệm 3D cho vi điều khiển PIC16F877A, chạy ngay trên trình
duyệt: breadboard đổi được kích thước (3 mẫu sẵn Mini 170 lỗ, Nửa 400
lỗ, Đầy đủ 830 lỗ, hoặc tự điền rộng × dài), chip PIC16F877A cắm sẵn, nguồn
phía sau đã nối dây về rail. Linh kiện trên bàn nối vào chip thật —
đổi dây trên bàn thì chip chạy theo dây mới. Trang này chỉ dùng trên
máy tính. Trang chính của trang web là index.html (3 mục Lý thuyết,
Bài tập, Thực hành); bấm Thực hành để vào bàn thực hành này (thuc-hanh/).

Chip chạy sẵn chương trình nhấp nháy LED RB0: nối một LED (kèm điện trở
nối tiếp) vào strip của chân RB0 thì LED nhấp nháy theo nhịp chip.

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
- **Đi dây:** bấm **Dây dẫn** rồi bấm 2 điểm; chọn màu dây trong bảng màu.
  Bấm chọn 1 dây thì dây highlight, kéo núm tròn ở 2 đầu để cắm lại
  (sang lỗ khác hoặc cọc +/− của nguồn), hoặc nhập địa chỉ cho từng đầu
  trong Inspector (vd `c12`, `T+5`, cọc nguồn `PSU1.+` / `PSU1.-`;
  board >26 hàng thì địa chỉ dạng chữ+số khối, vd `c112` = hàng c1
  cột 12, `b25` = hàng b2 cột 5).
- **Chọn size bo mạch:** nhấn vào board (thân board hoặc lỗ trống) để
  mở popup **Bo mạch** bên phải: bấm 1 trong 3 mẫu sẵn để áp dụng ngay,
  hoặc tự điền rộng (số cột 5–99) × dài (số hàng 2–99) + chọn có rail
  nguồn rồi bấm Áp dụng; đổi size thì chip căn lại giữa, linh kiện/dây
  ngoài board mới bị gỡ (có ghi chú ở dòng trạng thái).
- **Inspector:** bấm chọn linh kiện thì panel trượt từ phải sang để đổi
  tính chất (giá trị điện trở, màu LED, mức chiết áp, điện áp nguồn
  0–24V), xem chân nối đi đâu, xoá linh kiện/dây (phím Delete).
- **Kiểm tra:** panel bên trái liệt kê cảnh báo đấu nối (nối tắt, LED
  thiếu điện trở, LED có nguồn nhưng chưa nối về GND, LED nối tắt 2 đầu,
  LCD thiếu dây...), bấm vào cảnh báo để chọn linh kiện liên quan.

## Breadboard

Nhãn hàng: board ≤26 hàng thì chữ đơn a–z; board >26 hàng thì nhãn
chữ+số khối (hàng 1–26 là a1–z1, 27–52 là a2–z2, 53–78 là a3–z3...).
Mỗi đoạn 5 hàng nối nhau thành một strip (hàng 1–5, 6–10, 11–15...;
board 10 hàng thì vẫn a–e và f–j, rãnh ở giữa); 2 rail +/− chạy suốt
chiều dài. Chip PIC16F877A luôn căn giữa board (cột 22–41 trên board
830, cột 6–25 trên board 400, cột 1–17 trên board Mini — trên board
Mini thì 6 chân ngoài cùng MCLR/RD0/RD1/RD2/RD3/RB7 treo ngoài board).
Board 10 hàng thì chip ở hàng b/h; board khác thì chân trên ở hàng b,
chân dưới ở hàng max(6, số hàng−2) (vd 12 hàng → b/j, 6 hàng → b/f;
board <6 hàng thì hàng chân dưới treo ngoài board). Board tự điền rộng
5–99 cột × dài 2–99 hàng cũng căn giữa chip theo cùng cách; rail nguồn
tùy chọn, bật thì rail dài bằng số cột. Dây nguồn VDD/VSS/MCLR đã nối
sẵn về rail (board Mini không có rail nên không có dây nguồn mặc định).

Bàn mặc định có chip + nguồn + dây nguồn. Nút **Dọn hết bàn** giữ lại
chip, nguồn và dây nguồn; nút **Về bàn mặc định** khôi phục toàn bộ.
Trạng thái bàn tự lưu trên máy, mở lại trang vẫn còn.

Bố cục lấy cảm hứng từ bàn thí nghiệm của
[ohmimic.com/vi/bench](https://ohmimic.com/vi/bench) — nhưng viết mới
hoàn toàn cho PIC16F877A, không copy code hay giao diện của trang đó.
Giao diện theo design system riêng (navy #1E3A5F, accent #059669,
Fira Code / Fira Sans).

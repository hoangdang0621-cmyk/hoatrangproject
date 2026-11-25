# HoaTrang — Bàn thực hành 3D PIC16F877A

Bàn thí nghiệm 3D cho vi điều khiển PIC16F877A, chạy ngay trên trình
duyệt: breadboard 830 lỗ, chip PIC16F877A cắm sẵn, nguồn 5V phía sau đã
nối dây về rail. Linh kiện trên bàn nối vào chip thật — đổi dây trên bàn
thì chip chạy theo dây mới. Trang này chỉ dùng trên máy tính.

Chip chạy sẵn chương trình nhấp nháy LED RB0: nối một LED (kèm điện trở
nối tiếp) vào strip của chân RB0 thì LED nhấp nháy theo nhịp chip.

## Dùng nhanh

- **Đặt linh kiện:** kéo từ khay **Linh Kiện** bên trái thả vào lỗ
  breadboard (chân cắm thẳng vào lỗ). Ô xanh là đặt được, ô đỏ là không.
  Phím R xoay linh kiện 90° trong lúc kéo. Bấm vào khay rồi bấm vào lỗ
  cũng đặt được.
- **Xoay bàn:** kéo chỗ trống để xoay 360°, cuộn chuột để zoom, nút
  **3D** / **Từ trên** đổi góc nhìn.
- **Đi dây:** bấm **Dây dẫn** rồi bấm 2 lỗ; chọn màu dây trong bảng màu.
- **Inspector:** bấm chọn linh kiện thì panel trượt từ phải sang để đổi
  tính chất (giá trị điện trở, màu LED, mức chiết áp), xem chân nối đi
  đâu, xoá linh kiện/dây (phím Delete).
- **Kiểm tra:** panel bên trái liệt kê cảnh báo đấu nối (nối tắt, LED
  thiếu điện trở, LCD thiếu dây...), bấm vào cảnh báo để chọn linh kiện
  liên quan.

## Breadboard 830 lỗ

Hàng a–e của mỗi cột nối nhau, hàng f–j nối nhau; 2 rail +/− chạy suốt
chiều dài. Chip PIC16F877A cắm ở cột 22–41 (chân 1–20 hàng b, chân 21–40
hàng h). Dây nguồn VDD/VSS/MCLR đã nối sẵn về rail.

Bàn mặc định có chip + nguồn + dây nguồn. Nút **Dọn hết bàn** giữ lại
chip, nguồn và dây nguồn; nút **Về bàn mặc định** khôi phục toàn bộ.
Trạng thái bàn tự lưu trên máy, mở lại trang vẫn còn.

Bố cục lấy cảm hứng từ bàn thí nghiệm của
[ohmimic.com/vi/bench](https://ohmimic.com/vi/bench) — nhưng viết mới
hoàn toàn cho PIC16F877A, không copy code hay giao diện của trang đó.
Giao diện theo design system riêng (navy #1E3A5F, accent #059669,
Fira Code / Fira Sans).

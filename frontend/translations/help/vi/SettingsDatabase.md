## Cơ sở dữ liệu

Cơ sở dữ liệu nơi NPMpro lưu máy chủ, chứng chỉ, người dùng, nhật ký và thống kê. Mặc định là SQLite, một tệp duy nhất, và đó là lựa chọn được khuyến nghị. Từ đây bạn có thể chuyển mọi thứ sang MySQL, MariaDB, PostgreSQL hoặc một tệp SQLite mới. Việc chuyển không làm thay đổi cơ sở dữ liệu đang dùng.

### Cơ sở dữ liệu đang dùng

Hiện hệ quản trị và phiên bản, vị trí, kích thước và **Nguồn** của kết nối: **Mặc định** (tệp SQLite `/data/npmpro/database.sqlite`), **Tệp cài đặt cơ sở dữ liệu** (`/data/npmpro/database.json`, do việc chuyển ghi ra) hoặc **Môi trường** (các biến `DB_MYSQL_*` hoặc `DB_POSTGRES_*`). Sau khi chuyển, nó cho biết bạn chuyển khi nào và từ hệ quản trị nào.

### Bảng

Mọi bảng với số dòng và kích thước. Thẻ này có thể thu gọn.

### Chuyển sang cơ sở dữ liệu khác

Trước tiên hãy tạo một cơ sở dữ liệu trống và một người dùng có thể tạo bảng trên máy chủ của bạn; NPMpro không tạo cơ sở dữ liệu. Yêu cầu: MySQL 8.0, MariaDB 10.6 hoặc PostgreSQL 13 trở lên.

1. Chọn **Hệ quản trị** và nhập **Máy chủ**, **Cổng**, **Tên cơ sở dữ liệu**, **Người dùng** và **Mật khẩu**. Bật **Dùng TLS** nếu máy chủ cần (với MySQL và MariaDB bạn cũng có thể **Kiểm tra chứng chỉ máy chủ** và **Kiểm tra tên máy chủ**). Chuyển sang SQLite không cần gì cả: nó tạo một tệp mới trong `/data/npmpro`.
2. **Kiểm tra kết nối**. Nó kiểm tra phiên bản, cơ sở dữ liệu có trống không và người dùng có tạo được bảng không. Nó không thay đổi gì.
3. **Di chuyển**, rồi gõ từ mà nó yêu cầu và nhấp **Di chuyển ngay**.

NPMpro tạm dừng thay đổi, tạo bản sao lưu an toàn, tạo các bảng, sao chép và kiểm tra từng dòng, rồi khởi động lại trên cơ sở dữ liệu mới. Các trang của bạn vẫn được phục vụ. Trang tải lại khi NPMpro phản hồi trở lại, và bạn có thể phải đăng nhập lại.

Nếu một bước lỗi, NPMpro vẫn ở trên cơ sở dữ liệu đang dùng và cửa sổ nêu bước đã dừng. Cơ sở dữ liệu cũ không bao giờ bị xóa, nên bạn có thể quay lại: xóa `/data/npmpro/database.json` và khởi động lại container.

Nếu kết nối đến từ các biến `DB_MYSQL_*` hoặc `DB_POSTGRES_*`, mục này chỉ đọc. Để chuyển, hãy tạo bản sao lưu, trỏ các biến đến cơ sở dữ liệu mới, khởi động lại và khôi phục bản sao lưu.

Xem thêm trong wiki: Database.

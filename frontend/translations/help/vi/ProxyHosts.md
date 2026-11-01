## Máy chủ proxy là gì?

Máy chủ proxy là cửa trước của một dịch vụ web. Khách truy cập mở tên miền của bạn trong NPMpro, và NPMpro chuyển yêu cầu đến dịch vụ phía sau. Nó cũng có thể thêm TLS (HTTPS) cho các dịch vụ không có sẵn. Máy chủ proxy là cách dùng NPMpro phổ biến nhất.

Dùng **Nhân bản** trong menu của máy chủ để sao chép máy chủ vào một cửa sổ Thêm mới. Bản sao bắt đầu mà không có tên miền, vì một tên miền chỉ có thể thuộc về một máy chủ đang bật.

### Chi tiết

- **Danh sách tên miền**: các tên khách truy cập dùng. Bắt buộc. Với chứng chỉ mới, ký tự đại diện (`*.example.com`) cần thử thách DNS.
- **Giao thức**: cách NPMpro nói chuyện với dịch vụ: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (phục vụ tệp hoặc PHP từ một thư mục) hoặc `empty` (không có upstream). Mặc định `http://`. Đổi giao thức sẽ tắt các tùy chọn không phù hợp với nó.
- **Tên máy chủ / IP / Đường dẫn chuyển tiếp**: địa chỉ của dịch vụ. Bạn có thể thêm đường dẫn con, ví dụ `127.0.0.1/path`. Với `path`, hãy nhập một thư mục. Gắn tệp của bạn dưới `/var/www`; chỉ quản trị viên mới dùng được thư mục nằm ngoài đó. Tên bắt đầu bằng `cu_` trỏ đến khối upstream nginx của riêng bạn (xem Load balancing trong wiki).
- **Chuyển tiếp cổng**: tùy chọn. Với `path` đó là phiên bản PHP.
- **Nhóm**: nhãn tự do giúp danh sách dài gọn gàng.
- **Tùy chọn** (tất cả mặc định tắt):
  - **Gửi header noindex và chặn một số user agent của bot**: yêu cầu công cụ tìm kiếm không lập chỉ mục trang và chặn một số trình thu thập dữ liệu.
  - **Tắt CrowdSec AppSec**: tắt CrowdSec AppSec chỉ cho máy chủ này. Chỉ có tác dụng nếu AppSec đã được thiết lập.
  - **Tắt bộ đệm yêu cầu** và **Tắt bộ đệm phản hồi**: cho upstream http và https. Hãy giữ bộ đệm bật trừ khi bạn truyền phát hoặc tải lên tệp lớn qua đường truyền nhanh và ổn định. Tắt bộ đệm yêu cầu cũng tắt AppSec.
  - **Bật nén từ upstream**: để dịch vụ tự nén phản hồi của nó. Hãy để tắt trừ khi dịch vụ cần. Không dùng cho `path` và `empty`.
  - **Bật fancyindex**: hiển thị danh sách tệp khi thư mục không có tệp index. Chỉ cho `path`.
- **X-Frame-Options**: `SAMEORIGIN` (mặc định), `DENY`, `none` (xóa header) hoặc `upstream` (giữ nguyên những gì dịch vụ gửi).
- **Auth Request**: đặt một bước đăng nhập hoặc kiểm tra bot trước máy chủ (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Mặc định `none`. **Upstream của Auth Request** là tùy chọn; để trống thì dùng giá trị mặc định trong Cài đặt, Xác thực chuyển tiếp.
- **Danh sách truy cập toàn cục**: **Có thể truy cập công khai** (mặc định, không đăng nhập) hoặc **Tùy chỉnh**, một hoặc nhiều Danh sách truy cập.

Websocket luôn được bật.

### Quy tắc đường dẫn tùy chỉnh (Vị trí)

Một vị trí gửi một đường dẫn của máy chủ (ví dụ `/api/`) đến một dịch vụ khác. Mỗi vị trí có **Đã bật**, một đường dẫn với kiểu khớp tùy chọn (`=`, `~`, `~*`, `^~` hoặc `@`), giao thức, máy chủ, cổng, tùy chọn, Auth Request và danh sách truy cập riêng. Danh sách truy cập của nó có thể là **Toàn cục**, dùng các danh sách của máy chủ. Nó không kế thừa Auth Request của máy chủ. Hãy thêm dấu gạch chéo ở cuối đường dẫn trừ khi bạn muốn khớp tiền tố. Quản trị viên có thể thêm cấu hình nginx tùy chỉnh cho từng vị trí bằng nút bánh răng.

### TLS

- **Chứng chỉ TLS**: Không có, Yêu cầu chứng chỉ mới, hoặc một chứng chỉ có sẵn. Các tùy chọn bên dưới cần có chứng chỉ.
- **Chứng chỉ mTLS**: một tổ chức cấp chứng chỉ máy khách. **Đặt mTLS là tùy chọn** cho phép khách không có chứng chỉ vào. **mTLS bỏ qua Auth Request** cho phép khách có chứng chỉ hợp lệ bỏ qua Auth Request.
- **Bắt buộc HTTPS** chuyển hướng HTTP sang HTTPS. **Hỗ trợ HTTP/3** cho phép HTTP/3 (QUIC).
- **Bật HSTS (2 năm)**: cần Bắt buộc HTTPS. **HSTS tên miền con+Preload** cần HSTS.
- Với chứng chỉ mới: **Dùng lại khóa (không khuyến nghị)** và **Dùng thử thách DNS**, với nhà cung cấp, thông tin xác thực và số giây lan truyền.

### Nâng cao

Cấu hình nginx tùy chỉnh cho toàn bộ máy chủ (khối server) và cho vị trí chính `location /`. Chỉ quản trị viên mới có thể thay đổi.

Xem thêm trong wiki: Host options.

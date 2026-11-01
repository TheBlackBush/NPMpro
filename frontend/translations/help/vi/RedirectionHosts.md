## Máy chủ chuyển hướng là gì?

Máy chủ chuyển hướng đưa khách truy cập của một tên miền đến địa chỉ khác. Hãy dùng khi một trang đổi tên miền và các liên kết cũ vẫn cần hoạt động, hoặc để đưa `www` về tên chính.

Dùng **Nhân bản** trong menu của máy chủ để sao chép máy chủ vào một cửa sổ Thêm mới. Bản sao bắt đầu mà không có tên miền, vì một tên miền chỉ có thể thuộc về một máy chủ đang bật.

### Chi tiết

- **Danh sách tên miền**: các tên được chuyển hướng. Bắt buộc. Ký tự đại diện chỉ được phép cho chứng chỉ mới với thử thách DNS.
- **Giao thức**: giao thức của đích. "giữ nguyên (giống yêu cầu)" là mặc định và giữ `http` hoặc `https` của lượt truy cập. Hoặc chọn `http` hay `https`.
- **Chuyển tiếp Tên miền**: tên miền mà khách được đưa đến, ví dụ `example.com`. Bắt buộc.
- **Mã HTTP**: mã phản hồi. Mặc định 301 Moved permanently. Các lựa chọn khác: 302 Moved temporarily, 303 See other, 307 Temporary redirect và 308 Permanent redirect. Dùng 301 hoặc 308 khi việc chuyển là vĩnh viễn; trình duyệt và công cụ tìm kiếm ghi nhớ chúng.
- **Nhóm**: nhãn tự do giúp danh sách dài gọn gàng. Chọn một nhóm đang dùng hoặc gõ tên mới.
- **Bảo toàn đường dẫn** (mặc định tắt): thêm đường dẫn và query gốc vào đích. Khi bật, `old.example/a?b=1` chuyển đến `new.example/a?b=1`. Khi tắt, mọi khách đều đến phần đầu của đích.

### TLS

- **Chứng chỉ TLS**: Không có, Yêu cầu chứng chỉ mới, hoặc một chứng chỉ có sẵn. Các tùy chọn bên dưới cần có chứng chỉ.
- **Chứng chỉ mTLS**: một tổ chức cấp chứng chỉ máy khách. **Đặt mTLS là tùy chọn** cho phép khách không có chứng chỉ máy khách vào.
- **Bắt buộc HTTPS**: chuyển hướng HTTP sang HTTPS trước.
- **Hỗ trợ HTTP/3**: cho phép HTTP/3 (QUIC).
- **Bật HSTS (2 năm)**: cần Bắt buộc HTTPS. **HSTS tên miền con+Preload** cần HSTS.
- Với chứng chỉ mới: **Dùng lại khóa (không khuyến nghị)** và **Dùng thử thách DNS**, với nhà cung cấp, thông tin xác thực và số giây lan truyền.

Tất cả tùy chọn TLS mặc định tắt.

### Nâng cao

Cấu hình nginx tùy chỉnh được thêm vào bên trong khối server của máy chủ. Chỉ quản trị viên mới có thể thay đổi; người dùng khác chỉ xem được.

Xem thêm trong wiki: Host options.

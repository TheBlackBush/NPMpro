## Mạng

Cho NPMpro biết proxy nào phía trước nó đáng tin về địa chỉ thật của máy khách. Nếu không, nhật ký, danh sách truy cập và CrowdSec chỉ thấy địa chỉ của proxy, không phải của khách truy cập.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi TRUST_IP"). Hãy dùng UI cho mọi thứ không đặt trong container.

- **IP proxy tin cậy**: mỗi dòng một địa chỉ IPv4 hoặc IPv6 hoặc dải CIDR, ví dụ `10.0.0.0/8`, `192.168.1.5` hoặc `fd00::/8`. Các yêu cầu từ những địa chỉ này được phép chuyển IP máy khách thật trong `X-Forwarded-For`. Dùng cho bộ cân bằng tải hoặc tunnel nằm ngay phía trước NPMpro. Mặc định: trống (không tin ai). Biến: `TRUST_IP` (phân tách bằng dấu cách). Có hiệu lực sau lần reload nginx mà việc lưu chạy.
- **Tin cậy Cloudflare**: lấy các dải IP của Cloudflare, làm mới thường xuyên và tin cậy chúng, để nginx thấy IP máy khách thật phía sau Cloudflare. Mặc định: tắt. Biến: `TRUST_CLOUDFLARE`. Có hiệu lực sau lần reload nginx mà việc lưu chạy. Hãy đọc trước các ghi chú về Cloudflare trong wiki (Security): đặt Cloudflare phía trước NPMpro có những cái giá về quyền riêng tư và bảo mật.

Chỉ tin các địa chỉ bạn kiểm soát hoặc hoàn toàn tin cậy. Một địa chỉ được tin cậy có thể tự nhận là bất kỳ khách truy cập nào.

Nếu việc lưu không qua kiểm tra nginx, không có gì được lưu và thông báo của nginx được hiển thị.

Xem thêm trong wiki: Security.

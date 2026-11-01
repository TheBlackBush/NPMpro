## Nâng cao

Các cài đặt thay đổi nhẹ cách NPMpro hoạt động.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi TZ"). Hãy dùng UI cho mọi thứ không đặt trong container.

- **Múi giờ**: múi giờ của container. Nó quyết định thời gian trong nhật ký, báo cáo GoAccess và các tác vụ theo lịch như sao lưu theo lịch. Dùng tên như `Europe/Berlin`. Mặc định: `UTC`. Biến: `TZ`. Có hiệu lực sau khi khởi động lại container: lưu sẽ ghi nhận nó, và mục này liệt kê nó trong "Khởi động lại container để áp dụng".
- **Định dạng cấu hình nginx**: định dạng các cấu hình NPMpro ghi ra bằng nginxbeautifier. Hãy tắt nếu nó lỗi với các cấu hình tùy chỉnh hoặc nâng cao không chuẩn. Mặc định: bật. Biến: `DISABLE_NGINX_BEAUTIFIER` (đảo ngược: `true` tắt định dạng). Có hiệu lực ngay.
- **Ảnh hồ sơ Gravatar**: hiện ảnh Gravatar của người dùng không có ảnh đại diện tải lên. Để lấy ảnh, NPMpro gửi mã băm địa chỉ email của người dùng đến Gravatar, vì vậy hãy tắt nếu điều đó quan trọng với bạn. Mặc định: bật. Biến: `DISABLE_GRAVATAR` (đảo ngược: `true` tắt nó). Có hiệu lực ngay; ảnh của người dùng đổi ở lần lưu hồ sơ tiếp theo, và các ảnh đã lấy vẫn giữ đến lúc đó.

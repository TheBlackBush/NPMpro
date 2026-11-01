## GeoIP

NPMpro tự tải các cơ sở dữ liệu MaxMind GeoLite2 miễn phí và tra cứu quốc gia và mạng ngay trên máy chủ của bạn, nên IP của khách không bao giờ bị gửi đi đâu. Bạn không cần container geoipupdate riêng. Các cơ sở dữ liệu này phục vụ bản đồ và danh sách của Giám sát, GoAccess và các quy tắc quốc gia của nginx.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện "Được đặt bởi môi trường"). Hãy dùng UI cho mọi thứ không đặt trong container. Lưu sẽ bắt đầu tải về ở nền, và trạng thái bên dưới cập nhật khi xong.

### Tài khoản MaxMind

Bạn cần một tài khoản MaxMind miễn phí và một khóa giấy phép (trong MaxMind: Account, Manage license keys). Có liên kết đăng ký trên trang.

- **ID tài khoản**: biến `GEOIP_ACCOUNT_ID`.
- **Khóa giấy phép**: được lưu đã mã hóa và không bao giờ hiện lại. Nếu khóa đã lưu không giải mã được, hãy nhập lại. Biến: `GEOIP_LICENSE_KEY`.

### Cơ sở dữ liệu

- **GeoLite2 Country**: quốc gia cho bản đồ, danh sách quốc gia và quy tắc quốc gia của nginx. Mặc định bật.
- **GeoLite2 ASN**: mạng (số và tên AS) cho danh sách mạng. Mặc định bật.
- **GeoLite2 City**: tùy chọn, thành phố cho GoAccess. Dung lượng tải lớn hơn nhiều. Mặc định tắt.

Biến: `GEOIP_EDITIONS`, phân tách bằng dấu cách, ví dụ `GeoLite2-Country GeoLite2-ASN`. Khi không chọn cơ sở dữ liệu nào, không có gì được tải hay cập nhật, và các cơ sở dữ liệu đã tải được giữ lại.

### Trạng thái

Hiện lần cập nhật cuối và lỗi cuối. NPMpro cập nhật các cơ sở dữ liệu khi bạn đổi tài khoản hoặc cơ sở dữ liệu, khi bạn nhấp **Cập nhật ngay**, và tự động mỗi 3 ngày. Cập nhật tự động bị lỗi sẽ được thử lại sau 24 giờ. **Cập nhật ngay** cần ID tài khoản và khóa giấy phép đã lưu.

Khi không có cơ sở dữ liệu, bản đồ và các danh sách quốc gia và mạng bị ẩn; phần còn lại vẫn hoạt động.

Xem thêm trong wiki: Monitoring.

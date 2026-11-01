## Nhật ký & giám sát

Các tệp nhật ký, báo cáo nhật ký GoAccess và thống kê lưu lượng đằng sau trang Giám sát.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi LOGROTATE", hoặc "Được đặt bởi môi trường" cho thống kê). Hãy dùng UI cho mọi thứ không đặt trong container. Các cài đặt đánh dấu "Cần khởi động lại" được lưu ngay nhưng chỉ được đọc khi container khởi động; mục này sau đó liệt kê chúng trong "Khởi động lại container để áp dụng".

### Tệp nhật ký

- **Ghi tệp nhật ký**: ghi nhật ký error, stream và access của nginx vào `/data/nginx/logs` và xoay vòng hằng ngày. Mặc định: tắt. Biến: `LOGROTATE`. Có hiệu lực sau lần reload nginx mà việc lưu chạy. Nó vẫn bật khi GoAccess đang chạy.
- **Số lần xoay vòng nhật ký được giữ**: giữ bao nhiêu tệp nhật ký đã xoay vòng trước khi tệp cũ nhất bị xóa, từ 1 đến 1000. Mặc định: 3. Biến: `LOGROTATIONS`. Có hiệu lực ngay.

### GoAccess

- **Báo cáo GoAccess**: chạy GoAccess, một báo cáo nhật ký web cho quản trị viên, dưới `/goaccess` của giao diện web. Mặc định: tắt. Biến: `GOA`. Có hiệu lực sau khi khởi động lại container. Nó không bật thống kê lưu lượng.

Khi báo cáo bật, các tùy chọn này hiện ra. Tất cả có hiệu lực sau khi khởi động lại container. Một biến, `GOACLA`, thay thế tất cả bằng các tùy chọn GoAccess của riêng bạn và khóa chúng.

- **Giữ dữ liệu báo cáo**: 1 đến 366 ngày. Mặc định: 30.
- **Ẩn danh IP khách truy cập**: Tắt, Mức 1 (mặc định), Mức 2 (mạnh) hoặc Mức 3 (nghiêm ngặt). Mức 1 ẩn byte cuối của IPv4 (64 bit cuối của IPv6), mức 2 ẩn hai byte (80 bit), mức 3 ẩn ba byte (96 bit).
- **Bỏ chuỗi truy vấn**: xóa chuỗi truy vấn khỏi URL trong báo cáo, để các token trong URL không bị lưu. Mặc định: bật.
- **Phiên bản hệ điều hành đầy đủ**: hiện phiên bản đầy đủ, không chỉ họ hệ điều hành. Mặc định: bật.
- **Phân giải tên máy chủ**: tra cứu tên máy chủ của IP khách truy cập. Việc này gửi các truy vấn DNS cho chúng. Mặc định: bật.

### Giám sát

Các mục này điều khiển tab Lưu lượng của trang Giám sát. Tất cả có hiệu lực ngay khi lưu. Biến: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Thống kê lưu lượng**: đọc nhật ký access của nginx và đếm yêu cầu theo máy chủ, trạng thái, quốc gia và mạng. Mặc định: tắt. Tắt nó sẽ dừng đếm mới; thống kê đã lưu vẫn còn đến khi hết hạn, trừ khi bạn chọn "Đồng thời xóa thống kê đã lưu" trong hộp thoại.
- **Giữ thống kê trong**: 7 đến 365 ngày. Mặc định: 30. Dữ liệu theo phút được giữ 24 giờ, dữ liệu theo giờ được giữ bấy nhiêu ngày.
- **Hiển thị IP khách truy cập**: lưu IP khách truy cập theo giờ để liệt kê các IP hàng đầu. Mặc định: tắt, vì quyền riêng tư. Tắt nó sẽ xóa các IP đã lưu.
- **Đếm khách truy cập duy nhất**: lưu một mã băm có khóa của mỗi IP khách theo máy chủ và ngày để đếm khách duy nhất. Mặc định: tắt. Tắt nó sẽ xóa các mã băm.
- **Giới hạn khách truy cập mỗi máy chủ mỗi ngày**: 1000 đến 1000000. Mặc định: 100000. Máy chủ đạt giới hạn sẽ ngừng đếm khách mới trong ngày đó và hiện dấu cộng.

Quốc gia và mạng cần các cơ sở dữ liệu GeoIP (Cài đặt, GeoIP).

Xem thêm trong wiki: Monitoring.

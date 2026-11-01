## Xác thực chuyển tiếp

Xác thực chuyển tiếp đặt một bước đăng nhập hoặc kiểm tra bot trước máy chủ proxy. Với mỗi yêu cầu, nginx trước tiên hỏi một dịch vụ xác thực xem khách có được qua không. NPMpro tích hợp sẵn cho Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia và Authentik. Bạn chạy nhà cung cấp trong container riêng của nó.

Trang này đặt địa chỉ mặc định (upstream) của từng nhà cung cấp. Máy chủ proxy bật kiểm tra bằng **Auth Request** trong Tùy chọn ở tab Chi tiết (hoặc trên một vị trí tùy chỉnh).

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi AUTH_REQUEST_AUTHELIA_UPSTREAM"). Hãy dùng UI cho mọi thứ không đặt trong container. Mọi cài đặt ở đây có hiệu lực sau lần reload nginx mà việc lưu chạy. Nếu kiểm tra nginx lỗi, không có gì được lưu.

### Upstream mặc định

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: được dùng bởi các máy chủ proxy có nhà cung cấp đó mà không có upstream riêng. Giá trị riêng của máy chủ được ưu tiên. Mặc định: trống (không có). Biến: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Định dạng: `scheme://host:port`, ví dụ `http://127.0.0.1:9091`, hoặc `scheme://cu_name` cho khối upstream nginx của riêng bạn có tên bắt đầu bằng `cu_`. Dùng `http` hoặc `https`; cổng là bắt buộc; địa chỉ IPv6 đặt trong dấu ngoặc vuông. Không có đường dẫn, không có khoảng trắng và không có ký tự nào trong `; { } # " ' $ \`.

Bạn không thể để trống một mặc định khi còn máy chủ proxy dùng nhà cung cấp đó mà không có upstream riêng. Thông báo sẽ liệt kê các máy chủ đó.

Một máy chủ dùng nhà cung cấp mà không có upstream ở đâu cả sẽ bị "Lỗi cấu hình".

### Anubis

- **Ảnh Anubis tùy chỉnh**: hiện `happy.webp`, `reject.webp` và `pensive.webp` của bạn trên các trang thử thách Anubis. Mặc định: bật khi cả ba tệp tồn tại và không trống, còn lại tắt. Biến: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Các ảnh đặt trong `public/anubis` trong thư mục dữ liệu của bạn.

Xem thêm trong wiki: Forward-Authentication.

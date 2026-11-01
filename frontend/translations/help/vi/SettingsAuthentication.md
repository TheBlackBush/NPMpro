## Xác thực

Đăng nhập vào giao diện web NPMpro bằng nhà cung cấp OIDC (ví dụ Authentik, Keycloak hoặc Google), bên cạnh hoặc thay cho mật khẩu. Đây không phải xác thực chuyển tiếp: nó không bảo vệ các máy chủ proxy của bạn. Xem Cài đặt, Xác thực chuyển tiếp cho việc đó.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện "Được đặt bởi môi trường"). Nếu cả bốn biến kết nối đều được đặt, OIDC hoạt động mà không cần bật trong UI. Hãy dùng UI cho mọi thứ không đặt trong container. Mọi thứ ở đây có hiệu lực khi bạn lưu.

### Nhà cung cấp

- **Bật đăng nhập OIDC**: hiện nút đăng nhập trên trang đăng nhập.
- **Issuer URL**: địa chỉ gốc discovery của nhà cung cấp, ví dụ `https://accounts.example.com`. Biến: `OIDC_ISSUER_URL`.
- **Client ID** và **Client secret**: lấy từ nhà cung cấp của bạn. Secret được lưu đã mã hóa và không bao giờ hiện lại; để trống để giữ nguyên. Nếu bạn đổi issuer URL hoặc client ID, hãy nhập lại secret. Biến: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Tên miền chuyển hướng**: tên miền mọi người dùng để mở NPMpro, kèm cổng nếu không phải 443. Bắt buộc, vì nó tạo ra URL callback. Biến: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: chỉ đọc. Hãy đăng ký nó làm redirect URI tại nhà cung cấp của bạn.
- **Scope**: mặc định `openid email profile`. Hãy đổi nếu nhà cung cấp của bạn chỉ cho phép một số, ví dụ `openid email`.
- **Kiểm tra kết nối**: kiểm tra NPMpro có thể kết nối đến issuer.

### Nút đăng nhập

Nút trên trang đăng nhập: **Tên hiển thị** (văn bản sau "Đăng nhập bằng"), **Màu** (một màu có sẵn hoặc `#rrggbb` của bạn) và **Biểu tượng** (có sẵn, tải lên dạng PNG, JPEG, WebP hoặc SVG tối đa 256 KB, hoặc tải xuống từ một URL). Có bản xem trước.

### Quy tắc đăng nhập

- **Yêu cầu email đã xác minh**: từ chối người dùng mà nhà cung cấp chưa xác minh email. Mặc định: bật. Biến: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Bỏ qua xác thực hai yếu tố sau OIDC**: tin vào kiểm tra đa yếu tố của chính nhà cung cấp. Mặc định: tắt. Biến: `OIDC_SKIP_MFA`.
- **Tắt đăng nhập bằng mật khẩu**: chỉ OIDC mới đăng nhập được. Bạn chỉ có thể bật nó từ một phiên đã đăng nhập bằng OIDC. Biến: `OIDC_DISABLE_PASSWORD`; để khôi phục đăng nhập bằng mật khẩu, đặt nó thành `false` và tạo lại container.

### Người dùng mới

- **Tạo người dùng ở lần đăng nhập đầu tiên** (mặc định: tắt): người chưa có tài khoản sẽ được tạo tài khoản với các quyền bên dưới.
- **Tên miền email được phép**: phân tách bằng dấu phẩy; để trống là cho phép mọi tên miền. Với danh sách trống và không yêu cầu email đã xác minh, bất kỳ ai nhà cung cấp của bạn chấp nhận đều có tài khoản.
- **Quyền mặc định cho người dùng mới**: đặt theo từng mục. Người dùng mới không bao giờ là quản trị viên.

Xem thêm trong wiki: Authentication.

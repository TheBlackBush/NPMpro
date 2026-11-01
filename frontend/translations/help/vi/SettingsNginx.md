## nginx

Các cài đặt của chính nginx áp dụng cho mọi máy chủ: số worker nó chạy, quy tắc TLS và các mô-đun tùy chọn. Lưu sẽ kiểm tra cấu hình và reload nginx. Cấu hình không qua kiểm tra sẽ không được áp dụng.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi NGINX_WORKER_PROCESSES"). Hãy dùng UI cho mọi thứ không đặt trong container. Mọi cài đặt ở đây có hiệu lực sau lần reload nginx mà việc lưu chạy.

### Worker

- **Tiến trình worker**: "Tự động (một cho mỗi luồng CPU)" hoặc một số tối đa bằng số luồng CPU mà container thấy. Mặc định: một cho mỗi luồng, nhiều nhất 4. Biến: `NGINX_WORKER_PROCESSES`.
- **Kết nối mỗi worker**: số kết nối đang mở mà mỗi worker xử lý cùng lúc, từ 64 đến 65535. Mặc định: 512. Biến: `NGINX_WORKER_CONNECTIONS`.
- **Thời gian chờ tắt worker**: thời gian các worker cũ giữ kết nối sau khi reload. Một giá trị thời gian nginx như `30s`, `10m` hoặc `1h`; `0` nghĩa là không giới hạn. Mặc định: `1h`. Biến: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Ghi nhật ký

- **Ghi lỗi không tìm thấy tệp**: ghi một dòng nhật ký lỗi cho mỗi yêu cầu một tệp không tồn tại. Mặc định: tắt. Biến: `NGINX_LOG_NOT_FOUND`.

### TLS cho mọi máy chủ

Tắt TLS 1.2 hoặc các đường cong NIST P sẽ chặn các trình duyệt và máy khách cũ hơn. TLS 1.3 luôn bật.

- **Cho phép TLS 1.2**: mặc định bật. Biến: `NGINX_DISABLE_TLS12` (đảo ngược: `true` tắt TLS 1.2).
- **Chỉ trao đổi khóa hậu lượng tử**: chỉ cho phép X25519MLKEM768, cần máy khách mới. Nó tắt TLS 1.2 và các đường cong NIST P và khóa chúng khi đang bật. Mặc định: tắt. Biến: `NGINX_FORCE_X25519MLKEM768`.
- **Cho phép các đường cong NIST P**: secp521r1, secp384r1 và prime256v1 cho trao đổi khóa, bên cạnh X25519. Mặc định: bật. Biến: `NGINX_TRUST_SECPR1`.
- **Cho phép chữ ký RSA PKCS#1**: cho máy khách cũ không dùng được RSA-PSS. Mặc định: tắt. Biến: `NGINX_TRUST_RSA_PKCS1`.

### Mô-đun

Tất cả mặc định tắt. Chỉ bật một mô-đun khi cấu hình tùy chỉnh của bạn cần nó. Tắt một mô-đun trong khi cấu hình tùy chỉnh vẫn dùng nó sẽ làm kiểm tra nginx lỗi.

- **njs (JavaScript)**: các directive `js_*`. Biến: `NGINX_LOAD_NJS_MODULE`.
- **Xác thực LDAP**: các directive `auth_ldap`. Biến: `NGINX_LOAD_LDAP_MODULE`.
- **Upstream NTLM**: `ntlm` trong các khối upstream. Biến: `NGINX_LOAD_NTLM_MODULE`.
- **Trạng thái lưu lượng máy chủ ảo**: các directive `vhost_traffic_status_*`. Biến: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Xem thêm trong wiki: Configuration.

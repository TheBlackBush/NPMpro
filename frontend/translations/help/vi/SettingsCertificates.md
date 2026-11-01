## Chứng chỉ & TLS

Mặc định cho các chứng chỉ NPMpro yêu cầu từ máy chủ ACME của bạn (Let's Encrypt trừ khi bạn đặt máy chủ khác bằng `ACME_SERVER`), cách chúng được staple và gia hạn, và chứng chỉ nào trả lời cho các máy chủ không xác định. Đây là mục Cài đặt, không phải trang danh sách Chứng chỉ.

Biến đặt trên container được ưu tiên hơn UI và khóa trường (trường hiện huy hiệu khóa như "Được đặt bởi ACME_KEY_TYPE"). Một số trường đi theo trường khác: `ACME_KEY_SIZE` đứng riêng là một đường cong ECDSA giữ loại khóa ở ECDSA, và Must-Staple giữ OCSP stapling luôn bật. Hãy dùng UI cho mọi thứ không đặt trong container.

### Yêu cầu chứng chỉ

Các mục này có hiệu lực từ yêu cầu chứng chỉ tiếp theo.

- **Loại khóa**: `ECDSA` (mặc định, khuyến nghị: khóa nhỏ hơn, bắt tay nhanh hơn) hoặc `RSA` cho các máy khách không dùng được ECDSA. Biến: `ACME_KEY_TYPE`.
- **Kích thước khóa**: đường cong cho ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; mặc định `secp384r1`) hoặc số bit cho RSA (`2048`, `3072`, `4096`; mặc định `4096`). Biến: `ACME_KEY_SIZE`.
- **Hồ sơ ACME**: hồ sơ được yêu cầu từ máy chủ, được kiểm tra với máy chủ khi bạn lưu. Để trống thì dùng mặc định của máy chủ. Với Let's Encrypt, mặc định là `shortlived`; các máy khách cần Common Name không hoạt động với chứng chỉ `shortlived` và `tlsserver`. Biến: `ACME_PROFILE` (`none` cho trống).
- **OCSP Must-Staple**: đánh dấu chứng chỉ mới là must-staple và giữ OCSP stapling luôn bật. Chỉ cho các CA hỗ trợ (ZeroSSL); Let's Encrypt từ chối các yêu cầu như vậy. Mặc định: bật cho Google Trust Services và ZeroSSL, còn lại tắt. Biến: `ACME_MUST_STAPLE`.
- **Xác minh chứng chỉ máy chủ ACME**: mặc định bật. Chỉ tắt cho máy chủ ACME riêng có chứng chỉ tự ký. Biến: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Cả hai có hiệu lực sau lần reload nginx mà việc lưu chạy, và cả hai đều tắt nén chứng chỉ TLS.

- **OCSP stapling cho chứng chỉ ACME**: gửi phản hồi OCSP cùng chứng chỉ từ máy chủ ACME, khi CA có cung cấp OCSP. Mặc định: bật cho Google Trust Services và ZeroSSL, còn lại tắt. Biến: `ACME_OCSP_STAPLING`.
- **OCSP stapling cho chứng chỉ tùy chỉnh**: tương tự cho chứng chỉ đã tải lên. Mặc định: tắt. Biến: `CUSTOM_OCSP_STAPLING`.

### Chứng chỉ mặc định

- **Chứng chỉ cho máy chủ không xác định và giao diện web**: được dùng cho tên máy chủ mà NPMpro không có máy chủ nào và trên cổng giao diện web. Mặc định: tích hợp, một chứng chỉ giữ chỗ được tạo sẵn. Biến: `DEFAULT_CERT_ID` (ID chứng chỉ; `0` là tích hợp). Có hiệu lực sau lần reload nginx mà việc lưu chạy.

### Gia hạn

- **Chu kỳ kiểm tra gia hạn**: 1 đến 499 giờ giữa các lần kiểm tra. Chứng chỉ chỉ được gia hạn khi đến hạn. Mặc định: 3. Biến: `CERTBOT_RUN_INTERVAL`. Có hiệu lực ngay.

### ECH

- **Chu kỳ xoay vòng khóa ECH**: 1 đến 24 giờ giữa các lần chạy script ECH của bạn (`/data/tls/ech/cron.sh`). Chỉ dùng khi script không trống. Mặc định: 1. Biến: `ECH_ROTATION_INTERVAL`. Có hiệu lực ngay.

Xem thêm trong wiki: Security.

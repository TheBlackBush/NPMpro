## Hỗ trợ Chứng chỉ

### Chứng chỉ HTTP (HTTP Certificate)

Chứng chỉ được xác thực qua HTTP nghĩa là máy chủ của Certbot sẽ cố gắng truy cập vào tên miền của bạn thông qua HTTP (không phải HTTPS!). Nếu kiểm tra thành công, chứng chỉ sẽ được cấp.

Với phương thức này, bạn phải tạo trước một Proxy Host cho tên miền, có thể truy cập qua HTTP và trỏ về đúng cài đặt Nginx này.
Sau khi chứng chỉ được cấp, bạn có thể chỉnh sửa Proxy Host để sử dụng chứng chỉ đó cho kết nối HTTPS.

Tuy nhiên, Proxy Host vẫn phải hỗ trợ truy cập HTTP để việc gia hạn chứng chỉ diễn ra bình thường.

Phương thức này _không hỗ trợ_ wildcard domain.

### Chứng chỉ DNS (DNS Certificate)

Chứng chỉ được xác thực qua DNS yêu cầu bạn sử dụng plugin của DNS Provider.
Plugin này sẽ tạo các bản ghi tạm thời trong DNS của bạn để Certbot kiểm tra quyền sở hữu tên miền. Nếu hợp lệ, chứng chỉ sẽ được cấp.

Khi dùng phương thức này: Bạn không cần tạo sẵn Proxy Host trước và bạn không cần mở HTTP cho Proxy Host.

Phương thức DNS _có hỗ trợ_ wildcard domain.

#### Thông tin xác thực DNS đã lưu (Saved DNS credentials)

Thông tin xác thực của DNS Provider được lưu riêng với chứng chỉ, trong tab
_Thông tin xác thực DNS_ của trang Chứng chỉ. Sau đó, chứng chỉ chỉ cần chọn một trong các
thông tin xác thực đã lưu, nên nhiều chứng chỉ có thể dùng chung.

Các giá trị bí mật được lưu dưới dạng mã hóa và sẽ không bao giờ được hiển thị lại. Khi chỉnh sửa thông tin xác thực,
để trống một giá trị bí mật để giữ nguyên giá trị đã lưu. Khóa dùng để mã hóa là tệp
`/data/npmpro/dns-credentials.key`, hãy sao lưu tệp này cùng với cơ sở dữ liệu, nếu không
thông tin xác thực đã lưu sẽ không thể đọc được sau khi khôi phục.

Các provider không có biểu mẫu sẽ dùng ô văn bản INI, nơi bạn dán nội dung của
tệp thông tin xác thực cho provider đó.

### Chứng chỉ tùy chỉnh (Custom Certificate)

Tùy chọn này cho phép bạn tải lên chứng chỉ TLS của riêng mình, được cung cấp bởi Certificate Authority (CA) mà bạn tự chọn.

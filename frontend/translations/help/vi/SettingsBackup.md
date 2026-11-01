## Sao lưu và khôi phục

Lưu các máy chủ, chứng chỉ, người dùng và cài đặt của bạn vào một tệp `.npmpro`, và khôi phục nó trên phiên bản NPMpro này hoặc phiên bản khác. Thống kê lưu lượng và nhật ký không bao giờ nằm trong bản sao lưu.

### Tạo bản sao lưu

- **Bao gồm những gì**: các phần như máy chủ, danh sách truy cập, chứng chỉ, thông tin xác thực DNS, người dùng, cài đặt và tệp tùy chỉnh. Ban đầu tất cả đều được chọn.
- **Bao gồm thông tin bí mật**: thêm khóa riêng, mật khẩu, bí mật hai yếu tố, giá trị thông tin xác thực DNS, client secret OIDC và khóa giấy phép GeoIP. Tệp được mã hóa bằng **Cụm mật khẩu** dài ít nhất 12 ký tự, bạn nhập hai lần. NPMpro không lưu nó, nên không có nó thì không thể khôi phục bản sao lưu.
- Khi không có thông tin bí mật, tệp không được mã hóa và bỏ các thông tin bí mật ra. Nó vẫn chứa tên máy chủ, người dùng và cài đặt, vì vậy hãy giữ riêng tư.
- **Tải xuống** lưu tệp về máy tính của bạn. **Giữ trên máy chủ** lưu nó trong `/data/backups`.

### Sao lưu theo lịch

Thêm các lịch tự tạo bản sao lưu và lưu chúng trên máy chủ.

- **Khi nào**: mỗi N giờ, hằng ngày, hằng tuần hoặc hằng tháng, theo múi giờ của container.
- **Bảo vệ**: **Cụm mật khẩu** (khôi phục ở bất kỳ đâu), **Khóa phiên bản** (không cần nhớ gì, chỉ khôi phục được trên phiên bản này) hoặc **Không có thông tin bí mật**.
- **Giữ**: giữ bao nhiêu tệp của lịch này. Các tệp cũ hơn bị xóa sau mỗi lần chạy thành công.
- Một lịch có thể được chạy ngay, tạm dừng, sửa hoặc xóa. Lần chạy lỗi được hiển thị trên lịch và trên bảng điều khiển.

Sao lưu theo lịch bảo vệ bạn khỏi những thay đổi sai, không phải khỏi mất ổ đĩa. Hãy sao chép tệp sang máy khác cho việc đó.

### Bản sao lưu đã lưu

Liệt kê các tệp trên máy chủ. Tải xuống, khôi phục hoặc xóa chúng, hoặc **Tải lên bản sao lưu**. NPMpro tạo một bản sao lưu **Tự động** trước mỗi lần khôi phục, hợp nhất và chuyển cơ sở dữ liệu; nó không cần cụm mật khẩu và chỉ khôi phục được trên phiên bản này.

### Khôi phục

- **Thay thế** đổi các phần bạn chọn trên phiên bản này bằng các phần trong bản sao lưu. Tài khoản của chính bạn không bao giờ bị thay thế.
- **Hợp nhất** thêm các mục của bản sao lưu và không xóa gì. Nó hiện bản xem trước và cho bạn chọn với từng xung đột: bỏ qua, dùng mục có sẵn, thêm như mục mới, hoặc thay thế.

Lần khôi phục sẽ được hoàn tác nếu nginx từ chối kết quả. Không thể khôi phục bản sao lưu từ phiên bản NPMpro mới hơn. Một số cài đặt được khôi phục cần khởi động lại container.

Mục này không có biến môi trường.

Xem thêm trong wiki: Backup-and-restore.

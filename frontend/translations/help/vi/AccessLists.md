## Danh sách truy cập là gì?

Danh sách truy cập bảo vệ các máy chủ proxy. Nó có thể yêu cầu khách truy cập nhập tên người dùng và mật khẩu (xác thực Basic), cho phép hoặc từ chối khách theo địa chỉ IP, hoặc cả hai. Nó hữu ích cho các dịch vụ không có đăng nhập riêng, hoặc khi bạn muốn chặn các máy khách không quen biết.

Một danh sách có thể được nhiều máy chủ proxy và đường dẫn dùng chung.

### Chi tiết

- **Tên**: bắt buộc.
- **Thỏa mãn điều kiện bất kỳ** (mặc định tắt): khách được vào khi khớp với bất kỳ một kiểm tra nào, một quy tắc hoặc một người dùng hợp lệ. Khi tắt, khách phải qua cả hai. Tùy chọn này cũng bỏ qua Auth Request trên máy chủ đó.
- **Chuyển xác thực lên thượng nguồn** (mặc định tắt): chuyển tiếp header `Authorization` của khách đến dịch vụ. Khi tắt, thông tin đăng nhập được giữ riêng trong NPMpro.

### Danh sách xác thực

Thêm tên người dùng và mật khẩu. Tên người dùng phải là duy nhất trong danh sách và không được chứa `:`. Khi sửa danh sách, hãy để trống mật khẩu đã lưu để giữ nguyên.

### Quy tắc

Quy tắc cho phép hoặc từ chối một địa chỉ IP, một dải CIDR (`192.168.1.0/24`, `2001:db8::/32`) hoặc `unix:`. Chúng được áp dụng theo thứ tự bạn liệt kê, và khớp đầu tiên sẽ thắng. Hãy đặt các quy tắc cụ thể lên trước. Quy tắc `all` cuối cùng đóng danh sách, được đặt là cho phép hoặc từ chối; nó chỉ được thêm khi có ít nhất một quy tắc khác. Một danh sách cần ít nhất một người dùng hoặc một quy tắc.

### Dùng trên máy chủ proxy

Trên máy chủ proxy, chọn danh sách trong **Danh sách truy cập toàn cục** ở tab Chi tiết: **Có thể truy cập công khai** (không có danh sách) hoặc **Tùy chỉnh**. Một đường dẫn tùy chỉnh có thể dùng **Toàn cục** (các danh sách của máy chủ), **Có thể truy cập công khai** hoặc các danh sách **Tùy chỉnh** của riêng nó.

Bạn có thể gắn nhiều danh sách vào một máy chủ hoặc đường dẫn. Chúng được kiểm tra từ trên xuống dưới, theo thứ tự hiển thị, và bạn có thể di chuyển chúng lên xuống. **Thỏa mãn điều kiện bất kỳ** và **Chuyển xác thực lên thượng nguồn** chỉ có hiệu lực trên danh sách đầu tiên. Với CrowdSec, các IP bị cấm sẽ thấy trang cấm trước khi hiện yêu cầu nhập mật khẩu.

Xem thêm trong wiki: Host options.

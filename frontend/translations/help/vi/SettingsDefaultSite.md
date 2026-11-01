## Trang web mặc định

Trang mặc định là thứ nginx trả lời khi khách đến NPMpro bằng một tên máy chủ mà không máy chủ nào dùng, hoặc bằng địa chỉ IP của máy chủ. Chọn câu trả lời ở đây. Nó áp dụng cho mọi tên không xác định.

Lưu sẽ kiểm tra lựa chọn mới với nginx trước. Nếu kiểm tra lỗi, không có gì được lưu, trang mặc định trước đó vẫn giữ nguyên và lỗi nginx nằm trong nhật ký container.

- **Trang chúc mừng** (mặc định): hiện trang chào mừng của NPMpro.
- **Trang 404**: trả lời bằng trang 404 Not Found.
- **Không có phản hồi (444)**: đóng kết nối mà không trả lời gì. Dùng để không cho trình quét thấy gì. Các yêu cầu HTTPS cho tên không xác định bị từ chối ngay trong lúc bắt tay TLS.
- **Chuyển hướng**: đưa khách đến địa chỉ khác bằng chuyển hướng tạm thời (302). Nhập URL `http://` hoặc `https://` đầy đủ, không có khoảng trắng, dấu ngoặc kép hay `; { } #`, tối đa 255 ký tự.
- **HTML tùy chỉnh**: hiện trang HTML của riêng bạn. **HTTP Status Code** bên dưới là tùy chọn, từ 400 đến 599. Để trống cho 200 (OK).

Với mọi lựa chọn trừ Không có phản hồi, các yêu cầu đến tên không xác định qua HTTP thường trước tiên được chuyển hướng sang HTTPS, và các yêu cầu HTTPS dùng chứng chỉ được chọn làm **Chứng chỉ mặc định** trong Cài đặt, Chứng chỉ & TLS.

Mục này không có biến môi trường, nên thay đổi có hiệu lực khi bạn lưu.

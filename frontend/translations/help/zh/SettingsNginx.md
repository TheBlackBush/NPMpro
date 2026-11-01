## nginx

适用于所有主机的 nginx 自身设置：运行多少个 worker、TLS 规则和可选模块。保存时会测试配置并重新加载 nginx。未通过测试的配置不会被应用。

在容器上设置的变量优先于界面，并会锁定对应字段（字段上会显示锁定徽章，例如“由 NGINX_WORKER_PROCESSES 设置”）。凡是没有在容器中设置的内容，请在界面中设置。这里的每项设置都在保存时执行的 nginx 重新加载之后生效。

### Worker

- **worker 进程**：“自动（每个 CPU 线程一个）”，或不超过容器可见 CPU 线程数的数字。默认值：每个线程一个，最多 4 个。变量：`NGINX_WORKER_PROCESSES`。
- **每个 worker 的连接数**：每个 worker 同时处理的打开连接数，64 到 65535。默认值：512。变量：`NGINX_WORKER_CONNECTIONS`。
- **worker 关闭超时**：重新加载后，旧 worker 保持其连接的时长。为 nginx 时间值，例如 `30s`、`10m` 或 `1h`；`0` 表示不限制。默认值：`1h`。变量：`NGINX_WORKER_SHUTDOWN_TIMEOUT`。

### 日志

- **记录文件未找到错误**：每当请求不存在的文件时，写入一行错误日志。默认值：关闭。变量：`NGINX_LOG_NOT_FOUND`。

### 所有主机的 TLS

关闭 TLS 1.2 或 NIST P 曲线会把较旧的浏览器和客户端拒之门外。TLS 1.3 始终开启。

- **允许 TLS 1.2**：默认开启。变量：`NGINX_DISABLE_TLS12`（取反：`true` 表示关闭 TLS 1.2）。
- **仅使用后量子密钥交换**：只允许 X25519MLKEM768，这需要较新的客户端。它会关闭 TLS 1.2 和 NIST P 曲线，并在开启期间将其锁定。默认值：关闭。变量：`NGINX_FORCE_X25519MLKEM768`。
- **允许 NIST P 曲线**：在 X25519 之外，为密钥交换提供 secp521r1、secp384r1 和 prime256v1。默认值：开启。变量：`NGINX_TRUST_SECPR1`。
- **允许 RSA PKCS#1 签名**：用于无法使用 RSA-PSS 的旧客户端。默认值：关闭。变量：`NGINX_TRUST_RSA_PKCS1`。

### 模块

默认全部关闭。只有在你的自定义配置需要时才开启某个模块。在自定义配置仍在使用某个模块时将其关闭，会使 nginx 测试失败。

- **njs (JavaScript)**：`js_*` 指令。变量：`NGINX_LOAD_NJS_MODULE`。
- **LDAP 认证**：`auth_ldap` 指令。变量：`NGINX_LOAD_LDAP_MODULE`。
- **NTLM 上游**：upstream 块中的 `ntlm`。变量：`NGINX_LOAD_NTLM_MODULE`。
- **虚拟主机流量状态**：`vhost_traffic_status_*` 指令。变量：`NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`。

更多内容见 wiki：Configuration。

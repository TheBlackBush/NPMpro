## CrowdSec

将 NPMpro 内置的 CrowdSec bouncer 连接到你的 CrowdSec 容器。发往你的主机的每个请求都会根据 CrowdSec 本地 API（LAPI）的决策进行检查，设置了 AppSec 地址时还会根据 AppSec 规则检查。保存后会立即通过重新加载 nginx 应用设置；容器不会重启。

NPMpro 根据这些设置写入 `/data/crowdsec/crowdsec.conf`。对该文件的手动修改会被覆盖。同一文件夹中的 `ban.html` 和 `captcha.html` 可以由你自行编辑。

在容器上设置的变量优先于界面并锁定对应字段：`CROWDSEC_ENABLED`、`CROWDSEC_LAPI_URL`、`CROWDSEC_API_KEY`、`CROWDSEC_APPSEC_URL`。

### 状态与测试连接

显示 nginx 是否已加载 bouncer，以及 NPMpro 上次连接 LAPI 的时间。**测试连接**会检查表单中的值：使用密钥（或 TLS 客户端证书）向 LAPI 发送一次决策请求，设置了 AppSec 地址时再向 AppSec 发送一次请求。密钥字段留空则使用已保存的密钥。

在 bouncer 开启的情况下保存时，会先运行同样的测试。失败时会显示原因，**仍然保存**仍可保存，例如 CrowdSec 尚未运行时。

如果 AppSec 失败、**无法连接 AppSec 时**设为**拒绝请求**且管理界面受检查，则不会提供**仍然保存**，因为这样保存会把你锁在管理界面之外：请修正 **API 密钥**或 **AppSec 地址**，把失败处理方式改为**放行请求**，或开启**将管理界面排除在 CrowdSec 之外**。

### 连接

- **启用 bouncer**：检查每个请求。
- **LAPI 地址**：例如 `http://127.0.0.1:8080`。
- **API 密钥**：来自 `docker exec crowdsec cscli bouncers add npmpro`。加密存储，之后不再显示。**删除已保存的密钥**会将其删除。
- **TLS 客户端证书**：代替密钥，使用 `/data/crowdsec/` 下的证书文件和密钥文件；需要 `https://` 的 LAPI 地址。 设置 AppSec URL 后，即使使用 TLS 客户端证书，也会显示并必须填写 **API 密钥**，因为 AppSec 使用 API 密钥认证；没有密钥时 AppSec 会拒绝所有请求。
- **验证 TLS 证书**：检查 https 的 LAPI 或 AppSec 地址的证书。

### 拦截

- **模式**：实时模式为每个客户端 IP 向 LAPI 查询，并将响应缓存指定的秒数；流式模式按指定间隔下载所有决策。
- **对封禁的响应**：封禁页面（可选状态码，默认 403）、重定向，或不带页面的状态码。
- **后备处置**和**决策类型**：bouncer 无法执行的决策如何处理，以及执行哪些类型。
- **将管理界面排除在 CrowdSec 之外**：对管理界面的请求会跳过 bouncer 和 AppSec。在使用 AppSec 的拒绝方式之前先开启它，这样 CrowdSec 故障就不会把你锁在外面。

### 验证码

提供商（reCAPTCHA、hCaptcha、Cloudflare Turnstile）、其站点密钥和密钥，以及已通过的验证码保持有效的时长。用于验证码类型的决策。

### AppSec

- **AppSec 地址**：例如 `http://127.0.0.1:7422`；留空则关闭 AppSec。
- **无法连接 AppSec 时**：AppSec 不可用时，拒绝会拦截每个受检请求；放行则不检查这些请求。

### 高级

LAPI 请求超时、场景过滤、排除的路径、内部请求、AppSec 超时和选项，以及封禁页面和验证码页面的文件（带**预览**）。

### 被锁在外面了？

重新启动 CrowdSec，或在容器上设置 `CROWDSEC_ENABLED=false` 并重新创建容器；然后在此修正设置。

更多内容见 wiki：CrowdSec。

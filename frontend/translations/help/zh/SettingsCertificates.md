## 证书与 TLS

向你的 ACME 服务器（除非用 `ACME_SERVER` 另行指定，否则为 Let's Encrypt）申请证书时的默认值、证书的装订与续期方式，以及由哪张证书应答未知主机。这是设置中的一个区域，不是证书列表页面。

在容器上设置的变量优先于界面，并会锁定对应字段（字段上会显示锁定徽章，例如“由 ACME_KEY_TYPE 设置”）。有些字段会跟随另一个字段：单独设置且为 ECDSA 曲线的 `ACME_KEY_SIZE` 会让密钥类型保持为 ECDSA，Must-Staple 会让 OCSP 装订保持开启。凡是没有在容器中设置的内容，请在界面中设置。

### ACME 账户

**ACME 账户。** 卡片显示与证书颁发机构（CA）的连接状态：已连接、等待中（暂时无法访问 CA）、失败（附 CA 的消息）或未连接。**更改**或**连接**会打开一个窗口，在其中选择 CA（Let's Encrypt、ZeroSSL、Google Trust Services，或其他 CA 的目录 URL，https，不能是本主机）、邮箱和 EAB 密钥。ZeroSSL 需要邮箱，Google 需要邮箱和 EAB 密钥。**连接**会注册账户；无法访问的 CA 也可以先保存，并在下次证书申请时连接。**重试**会再次尝试连接。每个 CA 都有自己的账户；证书会保留在签发它的 CA，直到重新签发。**替换账户**是**更改**旁边的按钮：它会注册新账户，并将该 CA 的证书移到新账户；仅在旧账户的密钥已泄露时才停用它。

**其他 CA。** 在主连接下方，此列表包含在更多 CA 的账户，每个一行，带有状态和按钮（**更改**、**重试** 或 **替换账户**、**移除**）；**添加 CA** 会打开同一个窗口。每个证书向其窗口中选择的 CA 申请，并一直归属于它。只有管理员可以添加 CA；有权管理证书的用户可在其中选择。当实例或某个证书正在使用该 CA 时，**移除** 会被拒绝；账户本身仍保留在该 CA，其文件仍保留在磁盘上。

### 证书申请

这些设置从下一次证书申请起生效。

- **密钥类型**：`ECDSA`（默认，推荐：密钥更小、握手更快）或用于无法使用 ECDSA 的客户端的 `RSA`。变量：`ACME_KEY_TYPE`。
- **密钥长度**：ECDSA 时为曲线（`secp256r1`、`secp384r1`、`secp521r1`；默认 `secp384r1`），RSA 时为位数（`2048`、`3072`、`4096`；默认 `4096`）。变量：`ACME_KEY_SIZE`。
- **ACME 配置文件**：向服务器申请的配置文件，保存时会与服务器核对。留空则使用服务器默认值。使用 Let's Encrypt 时默认为 `shortlived`；需要 Common Name 的客户端无法使用 `shortlived` 和 `tlsserver` 证书。列表显示 CA 提供的配置文件；服务器默认值由 CA 自行选择。变量：`ACME_PROFILE`（`none` 表示留空）。
- **OCSP Must-Staple**：把新证书标记为 must-staple，并让 OCSP 装订保持开启。仅适用于支持它的 CA（ZeroSSL）；Let's Encrypt 会拒绝此类请求。默认值：Google Trust Services 和 ZeroSSL 为开启，其他为关闭。变量：`ACME_MUST_STAPLE`。
- **验证 ACME 服务器证书**：默认开启。仅在使用带自签名证书的私有 ACME 服务器时才将其关闭。变量：`ACME_SERVER_TLS_VERIFY`。

### 装订

两者都在保存时执行的 nginx 重新加载之后生效，并且都会关闭 TLS 证书压缩。

- **ACME 证书的 OCSP 装订**：当 CA 提供 OCSP 时，随 ACME 服务器的证书一起发送 OCSP 响应。默认值：Google Trust Services 和 ZeroSSL 为开启，其他为关闭。变量：`ACME_OCSP_STAPLING`。
- **自定义证书的 OCSP 装订**：对上传的证书执行同样的操作。默认值：关闭。变量：`CUSTOM_OCSP_STAPLING`。

### 默认证书

- **未知主机和 Web 界面的证书**：用于 NPMpro 中没有对应主机的主机名，以及 Web 界面端口。默认值：内置，即生成的占位证书。变量：`DEFAULT_CERT_ID`（证书 ID；`0` 表示内置）。在保存时执行的 nginx 重新加载之后生效。

### 续期

- **续期检查间隔**：两次检查之间相隔 1 到 499 小时。证书只在到期时才续期。默认值：3。变量：`CERTBOT_RUN_INTERVAL`。立即生效。

### ECH

- **ECH 密钥轮换间隔**：运行你的 ECH 脚本（`/data/tls/ech/cron.sh`）之间相隔 1 到 24 小时。仅在脚本不为空时使用。默认值：1。变量：`ECH_ROTATION_INTERVAL`。立即生效。

更多内容见 wiki：Security。

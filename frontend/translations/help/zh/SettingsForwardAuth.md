## 转发认证

转发认证会在代理主机前面加上登录或机器人检查。对于每个请求，nginx 会先询问认证服务该访问者是否可以通过。NPMpro 已为 Anubis、Tinyauth、OAuth2 Proxy、VoidAuth、Authelia 和 Authentik 内置了此功能。你需要在各自的容器中运行提供商。

此页面用于设置各提供商的默认地址（上游）。代理主机通过其详情选项卡选项下的**认证请求**（或自定义位置）来开启检查。

在容器上设置的变量优先于界面，并会锁定对应字段（字段上会显示锁定徽章，例如“由 AUTH_REQUEST_AUTHELIA_UPSTREAM 设置”）。凡是没有在容器中设置的内容，请在界面中设置。这里的每项设置都在保存时执行的 nginx 重新加载之后生效。如果 nginx 测试失败，则不会保存任何内容。

### 默认上游

- **Anubis 上游**、**Tinyauth 上游**、**OAuth2 Proxy 上游**、**VoidAuth 上游**、**Authelia 上游**、**Authentik 上游**：由使用该提供商但没有自己上游的代理主机使用。主机自己的值优先。默认值：空（无）。变量：`AUTH_REQUEST_ANUBIS_UPSTREAM`、`AUTH_REQUEST_TINYAUTH_UPSTREAM`、`AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`、`AUTH_REQUEST_VOIDAUTH_UPSTREAM`、`AUTH_REQUEST_AUTHELIA_UPSTREAM`、`AUTH_REQUEST_AUTHENTIK_UPSTREAM`。

格式：`scheme://host:port`，例如 `http://127.0.0.1:9091`；或者 `scheme://cu_name`，指向名称以 `cu_` 开头的你自己的 nginx 上游块。使用 `http` 或 `https`；端口必填；IPv6 地址要放在方括号中。不能有路径、空格，也不能含有 `; { } # " ' $ \`。

只要还有代理主机使用该提供商而没有自己的上游，就不能清空对应的默认值。提示信息会列出这些主机。

使用某个提供商、但任何地方都没有为它配置上游的主机会出现“配置错误”。

### Anubis

- **自定义 Anubis 图片**：在 Anubis 验证页面上显示你自己的 `happy.webp`、`reject.webp` 和 `pensive.webp`。默认值：三个文件都存在且不为空时开启，否则关闭。变量：`AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`。图片放在你数据文件夹中的 `public/anubis`。

更多内容见 wiki：Forward-Authentication。

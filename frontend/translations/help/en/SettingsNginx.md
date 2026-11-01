## nginx

Settings of nginx itself that apply to all hosts: how many workers it runs, TLS rules and optional modules. Saving tests the configuration and reloads nginx. A configuration that fails the test is not applied.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by NGINX_WORKER_PROCESSES"). Use the UI for anything not set in the container. Every setting here applies after the nginx reload that saving runs.

### Workers

- **Worker processes**: "Automatic (one per CPU thread)" or a number up to the CPU threads the container sees. Default: one per thread, at most 4. Variable: `NGINX_WORKER_PROCESSES`.
- **Connections per worker**: open connections each worker handles at once, 64 to 65535. Default: 512. Variable: `NGINX_WORKER_CONNECTIONS`.
- **Worker shutdown timeout**: how long old workers keep their connections after a reload. An nginx time value such as `30s`, `10m` or `1h`; `0` means no limit. Default: `1h`. Variable: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logging

- **Log file not found errors**: writes an error log line for each request of a missing file. Default: off. Variable: `NGINX_LOG_NOT_FOUND`.

### TLS for all hosts

Turning TLS 1.2 or the NIST P curves off shuts out older browsers and clients. TLS 1.3 is always on.

- **Allow TLS 1.2**: default on. Variable: `NGINX_DISABLE_TLS12` (inverted: `true` turns TLS 1.2 off).
- **Post-quantum key exchange only**: allows only X25519MLKEM768, which needs a recent client. It turns TLS 1.2 and the NIST P curves off and locks them while it is on. Default: off. Variable: `NGINX_FORCE_X25519MLKEM768`.
- **Allow the NIST P curves**: secp521r1, secp384r1 and prime256v1 for the key exchange, next to X25519. Default: on. Variable: `NGINX_TRUST_SECPR1`.
- **Allow RSA PKCS#1 signatures**: for old clients that cannot use RSA-PSS. Default: off. Variable: `NGINX_TRUST_RSA_PKCS1`.

### Modules

All default to off. Turn on a module only when a custom config of yours needs it. Turning one off while a custom config still uses it makes the nginx test fail.

- **njs (JavaScript)**: `js_*` directives. Variable: `NGINX_LOAD_NJS_MODULE`.
- **LDAP authentication**: `auth_ldap` directives. Variable: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM upstreams**: `ntlm` in upstream blocks. Variable: `NGINX_LOAD_NTLM_MODULE`.
- **Virtual host traffic status**: `vhost_traffic_status_*` directives. Variable: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

More in the wiki: Configuration.

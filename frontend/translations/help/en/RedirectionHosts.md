## What is a Redirection Host?

A Redirection Host sends visitors of one domain to another address. Use it when a site changes domains and old links should keep working, or to send `www` to the main name.

Use **Clone** in the host's menu to copy a host into a new Add window. The copy starts without the domain names, because a domain can belong to only one enabled host.

### Details

- **Domain Names**: the names that are redirected. Required. Wildcards are allowed for a new certificate only with the DNS challenge.
- **Scheme**: the scheme of the target. "keep (same as the request)" is the default and keeps `http` or `https` from the visit. Or choose `http` or `https`.
- **Forward Domain**: the domain visitors are sent to, for example `example.com`. Required.
- **HTTP Code**: the answer code. Default 301 Moved permanently. Other choices: 302 Moved temporarily, 303 See other, 307 Temporary redirect and 308 Permanent redirect. Use 301 or 308 when the move is for good; browsers and search engines remember them.
- **Group**: a free label that keeps long lists tidy. Pick one in use or type a new name.
- **Preserve Path** (off by default): adds the original path and query to the target. With it, `old.example/a?b=1` goes to `new.example/a?b=1`. Without it, every visitor lands on the start of the target.

### TLS

- **TLS Certificate**: None, Request a new Certificate, or an existing one. The options below need a certificate.
- **mTLS Certificate**: a client certificate authority. **Make mTLS Optional** lets visitors without a client certificate in.
- **Force HTTPS**: redirects HTTP to HTTPS first.
- **HTTP/3 Support**: allows HTTP/3 (QUIC).
- **HSTS Enabled (2 Years)**: needs Force HTTPS. **HSTS Subdomains+Preload** needs HSTS.
- For a new certificate: **Reuse Key (not recommended)** and **Use DNS Challenge**, with provider, credential and propagation seconds.

All TLS options are off by default.

### Advanced

Custom nginx config added inside the host's server block. Only administrators can change it; other users see it read-only.

More in the wiki: Host options.

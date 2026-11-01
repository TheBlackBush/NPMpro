## What is a Proxy Host?

A Proxy Host is the front door of a web service. Visitors open your domain in NPMpro, and NPMpro forwards the request to the service behind it. It can also add TLS (HTTPS) for services that have none of their own. Proxy Hosts are the most common use of NPMpro.

Use **Clone** in the host's menu to copy a host into a new Add window. The copy starts without the domain names, because a domain can belong to only one enabled host.

### Details

- **Domain Names**: the names visitors use. Required. For a new certificate, wildcards (`*.example.com`) need the DNS challenge.
- **Scheme**: how NPMpro talks to the service: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (serve files or PHP from a folder) or `empty` (no upstream). Default `http://`. A scheme change turns off options that do not fit it.
- **Forward Hostname / IP / Path**: the address of the service. You can add a sub path, for example `127.0.0.1/path`. With `path`, enter a folder instead. Mount your files under `/var/www`; only administrators can use a folder outside it. A name starting with `cu_` points to your own nginx upstream block (see Load balancing in the wiki).
- **Forward Port**: optional. With `path` it is the PHP version.
- **Group**: a free label that keeps long lists tidy.
- **Options** (all off by default):
  - **Send noindex header and block some bot user agents**: asks search engines not to index the site and blocks some crawlers.
  - **Disable Crowdsec Appsec**: turns CrowdSec AppSec off for this host only. It has an effect only if AppSec is set up.
  - **Disable Request Buffering** and **Disable Response Buffering**: for http and https upstreams. Keep buffering on unless you stream or upload big files over a fast, stable link. Turning request buffering off also turns off AppSec.
  - **Enable compression by upstream**: lets the service compress its own answers. Keep it off unless the service needs it. Not for `path` and `empty`.
  - **Enable fancyindex**: shows a file listing when a folder has no index file. Only for `path`.
- **X-Frame-Options**: `SAMEORIGIN` (default), `DENY`, `none` (removes the header) or `upstream` (keeps what the service sends).
- **Auth Request**: puts a login or bot check in front of the host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Default `none`. **Auth Request Upstream** is optional; empty uses the default from Settings, Forward authentication.
- **Global Access Lists**: **Publicly Accessible** (default, no login) or **Custom**, one or more Access Lists.

Websockets are always on.

### Custom Locations

A location sends one path of the host (for example `/api/`) to a different service. Each has **Enabled**, a path with an optional match type (`=`, `~`, `~*`, `^~` or `@`), its own scheme, host, port, options, Auth Request and access lists. Its access list can be **Global**, which uses the host's lists. It does not inherit the host's Auth Request. Add a trailing slash to a path unless you want prefix matching. Administrators can add custom nginx config per location with the gear button.

### TLS

- **TLS Certificate**: None, Request a new Certificate, or an existing one. The options below need a certificate.
- **mTLS Certificate**: a client certificate authority. **Make mTLS Optional** lets visitors without a certificate in. **mTLS bypass Auth Request** lets visitors with a valid one skip the Auth Request.
- **Force HTTPS** redirects HTTP to HTTPS. **HTTP/3 Support** allows HTTP/3 (QUIC).
- **HSTS Enabled (2 Years)**: needs Force HTTPS. **HSTS Subdomains+Preload** needs HSTS.
- For a new certificate: **Reuse Key (not recommended)** and **Use DNS Challenge**, with provider, credential and propagation seconds.

### Advanced

Custom nginx config for the whole host (server block) and for the main location `location /`. Only administrators can change it.

More in the wiki: Host options.

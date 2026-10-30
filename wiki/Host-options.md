# Host options

Notes on some options of proxy hosts, redirection hosts, 404 hosts and streams. Many forms have changed compared to nginx-proxy-manager, so check them when you migrate (see [Migrating from Nginx Proxy Manager](Migrating-from-Nginx-Proxy-Manager)).

- Forward Hostname / IP / Path: if the scheme is set to path you can just put here a path in and nginx works as a file server, otherwise you need to input ip/domain, you can also append a path to the ip/domain like `127.0.0.1/path` to proxy to a subpath.
  - Mount your files under `/var/www` for the `path` scheme (see the commented volume in `compose.yaml`). Users who are not administrators can only use an absolute path inside `/var/www` (no `..`, no nginx variables); only administrators can serve another folder.
  - For custom locations with a set path, the path of the location will be stripped. So a request `GET /cdf/abc` to a custom location `/cdf` which proxies to `127.0.0.1/abc` will proxy to `127.0.0.1/abc/abc`, a custom location `/cdf/` which proxies to `127.0.0.1/` will proxy to `127.0.0.1/abc`  and a custom location `/cdf` which proxies to `127.0.0.1` will proxy to `127.0.0.1/cdf/abc`
  - If the scheme is set to `path`, a path ending with a `/` will be searched relative to the custom location (is uses nginx alias) and a path ending without a `/` will be searched relative to the main `/` location (it uses nginx root)
- Forward Port (optional): port of upstream or php version if scheme is `path`
- Custom nginx config (the Advanced tab, the config of the `location /` block, the config of custom locations and of streams): only administrators can set or change it, because it runs with the rights of nginx. Other users see a stored value read-only and can still save the host as long as they keep it. After upgrading, administrators should review the custom nginx config of hosts owned by other users, since it could be set by anyone with the manage permission before.
- Send noindex header and block some user agents: This does what is says, it appends a header to all responses which says that the site should not be indexed while blocking requests of crawlers based on the user agent sent with the request
- Disable Crowdsec Appsec: this will disable crowdsec appsec only for one host/one location, this will only do something if appsec is configured
- Disable Response Buffering: Most time you want keep buffering enabled, you may want to disable this if you for example want to stream videos and you have a fast and stable connection to the upstream server, this effects the connection from the upstream server to NPMpro
- Disable Request Buffering: Most time you want keep buffering enabled, request buffering will always be enabled if crowdsec appsec is enabled, you may want to disable this if you for example want to upload huge files and have a fast and stable connection to the upstream server, this effects the connection from the NPMpro to the upstream server
- Enable compression by upstream: this will allow the backend to compress files, it is recommended to keep this disabled unless your backend provides precompressed assets, there may be cases where this is needed since otherwise the upstream missbehaves for some reason (like collabora in nextcloud all-in-one)
- Enable fancyindex: this will enabled fancyindex, which shows a index of all files in the folder if there is no index file, only enable this if you know what you are doing and you need the index
- Websockets: this button was removed, websockets are now always enabled
- Reuse Key: this will make the new cert always keep its key unless you force renew it, it is recommended to keep this disabled (not to keep the key), a reason to keep the key would be TLSA/pubkey pinning
- TLS to upstream (for Streams): This can be used if your stream target already uses tls but you want to override it with a NPMpro cert, do not enable if you don't set a new cert, since this will downgrade the connecting to be unencrypted
- PROXY protocol (for Streams): sends the client address to the upstream as PROXY protocol v1 or v2. nginx only supports v2 over UDP, so a stream with UDP forwarding saves v1 as v2, and then the TCP side of a stream with both TCP and UDP forwarding also sends v2
- X-Frame-Options: will control the X-Frame-Options header, none will remove the header, SAMEORIGIN/DENY will set it to these values and upstream will keep what upstream sends

## Access lists

When using multiple Access Lists on a Proxy Host or a Proxy Location, they are evaluated in a top-down order from the UI.
The `Satisfy Any` or `Pass Auth to Upstream` only get applied if they are set on the first Access List assigned to a proxy host/location. More on access lists: [Usage](Usage#access-lists).

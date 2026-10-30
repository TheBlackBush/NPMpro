# Load balancing

NPMpro can spread the requests of a proxy host or stream over several upstream servers.

1. Open and edit this file: `/opt/npmpro/custom_nginx/http_top.conf` (or `/opt/npmpro/custom_nginx/stream_top.conf` for streams), if you changed /opt/npmpro to a different path make sure to change the path to fit
2. Set the upstream directive(s) with your servers which should be load balanced (https://nginx.org/en/docs/http/ngx_http_upstream_module.html / https://nginx.org/en/docs/stream/ngx_stream_upstream_module.html), they need to run the same protocol (either http(s) or grpc(s) for proxy hosts or tcp/udp/proxy protocol for streams), like this for example:
```
upstream cu_mybackend {
  zone cu_mybackend 128k;
  server 127.0.0.1:44 resolve;
  server 127.0.0.1:33 resolve;
  server 127.0.0.1:22 resolve;
  server 192.168.1.11:44 backup resolve;
}
```
3. Configure your proxy host/stream like always in the UI, but set the hostname to the exact name of your upstream block (e.g. `cu_mybackend`) and leave the forward port field empty (ports are defined inside the upstream block)
   - The `cu_` prefix (short for **c**ustom **u**pstream) is required: NPMpro uses it to detect that the hostname refers to a custom upstream block and skips generating its own upstream block for it
   - This also works for forward authentication upstreams (settings, variables or host fields), use the scheme and the name of your upstream block without port (e.g. `http://cu_myauth`), SNI and Host header are then set to the requested host like for proxy hosts, so the servers inside the upstream block need to point directly to the auth service and not to NPMpro itself

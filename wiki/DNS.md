# DNS

Certificates & DNS holds the DNS credentials, the domains each credential manages and, from later updates, the dynamic DNS records. Everything here uses the Certificates permission: view to read, manage to change.

## Domains

A domain is a DNS zone a credential manages, such as `example.com`. It covers itself and every name below it (`www.example.com`, `*.example.com`). Add domains in the Domains tab (Add domains) or in the DNS credential window (the Domains line). Names are stored in lower case; an internationalized name is stored as punycode (`bücher.de` becomes `xn--bcher-kva.de`). A domain cannot be a wildcard or a single label. One owner keeps a domain on one credential only: a second credential of the same owner refuses it. Two users may each list the same domain on their own credentials. Domains are input help: hosts and certificates keep plain names, and deleting a domain changes neither.

## Suggestions while you type

Every Domain Names field (hosts, certificates, the certificate of a stream) suggests names as you type. Text without a dot is offered in front of each of your domains (`app` becomes `app.example.com`); text with a dot is completed against your domains and against the names your hosts and certificates already use. Wildcards such as `*.example.com` are offered only where the field takes them (a host without a new certificate, or a certificate over the DNS challenge). You can always type any other name; Enter adds what you typed.

## DNS challenge

When you request a certificate with the DNS challenge, NPMpro picks the provider and credential whose domain covers all the names and says so under the credential field. Choose another one at any time; if it does not cover every name, a note says which names it has no domain for. Names that need different credentials, or a domain two users both listed, are shown instead of being guessed. The suggestion only fills the form: the request uses the credential you see.

## Who sees what

A user limited to their own items sees only the domains of their own credentials.

## Fetch domains

For Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH and PowerDNS credentials, Fetch domains (in the Domains tab and in the credential's row menu) lists the zones the provider has and adds the ones you tick. The token needs the right to list zones: Cloudflare Zone Read, DigitalOcean `domain:read`, Hetzner Cloud a project API token with read access to its DNS zones, Gandi a personal access token that can see your domains (only the domains of your own organization are listed), OVH a right on `GET /domain/zone`, PowerDNS the API key (an `http://` endpoint is accepted only for a LAN address, any other needs `https://`). A fetch never removes a domain, and you can always type domains instead. At most 1000 zones are listed. A domain already on this credential shows as already here, one on another of your credentials shows which one, and new domains are ticked.

## DNS resolver

The resolver is the DNS server nginx uses for upstream names (a proxy host's forward host, for example). Set it in Settings, nginx, DNS resolver, or with the `NGINX_RESOLVER`, `NGINX_RESOLVER_HOSTS`, `NGINX_RESOLVER_IPV6` and `NGINX_RESOLVER_VALID` variables (see [Configuration](Configuration)). Empty servers mean the container's own `/etc/resolv.conf`. `NGINX_RESOLVER_VALID` takes a time in seconds or longer: seconds, or parts with units such as `30s`, `5m` or `1h30m` (never `ms`, not a bare `0`); empty uses each record's TTL, and `0s` or another zero such as `0m` means the same as empty.

The default is the line nginx.conf had (`resolver local=on hosts=on ipv6=on;`), so nothing changes until you set it. The line lives in `/data/npmpro/nginx/resolver.conf`, which the container writes at start. A custom `http.conf` or `stream.conf` must not add a second `resolver` line.

Addresses you set replace the container's own resolvers (local=on): a name that only the container's resolver knows, such as another container's name on a Docker network (127.0.0.11), is then no longer found unless one of your addresses answers it.

A save asks each new address once; an address that does not answer gives a warning, and the setting is still saved.

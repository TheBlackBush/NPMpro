# DNS

Certificates & DNS holds the DNS credentials, the domains each credential manages and the dynamic DNS records. Everything here uses the Certificates permission: view to read, manage to change.

## Domains

A domain is a DNS zone a credential manages, such as `example.com`. It covers itself and every name below it (`www.example.com`, `*.example.com`). Add domains in the Domains tab (Add domains) or in the DNS credential window (the Domains line). Names are stored in lower case; an internationalized name is stored as punycode (`bücher.de` becomes `xn--bcher-kva.de`). A domain cannot be a wildcard or a single label. One owner keeps a domain on one credential only: a second credential of the same owner refuses it. Two users may each list the same domain on their own credentials. Domains are input help: hosts and certificates keep plain names, and deleting a domain changes neither.

## Suggestions while you type

Every Domain Names field (hosts, certificates, the certificate of a stream) suggests names as you type. Text without a dot is offered in front of each of your domains (`app` becomes `app.example.com`); text with a dot is completed against your domains and against the names your hosts and certificates already use. Wildcards such as `*.example.com` are offered only where the field takes them (a host without a new certificate, or a certificate over the DNS challenge). You can always type any other name; Enter adds what you typed.

## DNS challenge

When you request a certificate with the DNS challenge, NPMpro picks the provider and credential whose domain covers all the names and says so under the credential field. Choose another one at any time; if it does not cover every name, a note says which names it has no domain for. Names that need different credentials, or a domain two users both listed, are shown instead of being guessed. The suggestion only fills the form: the request uses the credential you see.

## Who sees what

A user limited to their own items sees only the domains of their own credentials.

## Domains from the provider

For Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH and PowerDNS credentials, the Add domains window (from the Domains tab, or from the credential's row menu with that credential chosen) lists the zones the provider has as soon as you choose the credential, below the field for typed names. Tick the ones to add, type others if you like, and Save adds both in one step (all or none). The token needs the right to list zones: Cloudflare Zone Read, DigitalOcean `domain:read`, Hetzner Cloud a project API token with read access to its DNS zones, Gandi a personal access token that can see your domains (only the domains of your own organization are listed), OVH a right on `GET /domain/zone`, PowerDNS the API key (an `http://` endpoint is accepted only for a LAN address, any other needs `https://`). A fetch never removes a domain, and a failed list never blocks typing and saving domains. At most 1000 zones are listed. A domain already on this credential shows as already here, one on another of your credentials shows which one, and new domains are ticked.

## Dynamic DNS

A dynamic DNS record keeps a DNS name pointed at this instance, so a home or office connection with a changing public IP stays reachable by name. Records live in the Dynamic DNS tab of Certificates & DNS. A record uses one of your saved DNS credentials for its provider, so there is nothing to enter twice. The providers are Cloudflare, DigitalOcean, Hetzner Cloud and Gandi; only credentials of these providers are offered. Settings, Dynamic DNS holds the settings of the updater, and the tab shows the public address found, the next check and a **Check now** button.

### Records

A record has a full name (`home.example.com`), a credential, a zone (taken from the domains of the credential, or typed), an optional TTL (60 to 86400 seconds; empty keeps the provider's value) and an **Enabled** switch. There are two kinds:

- **Address (A, AAAA):** follows the public IP. The IP version is IPv4, IPv6 or both. IPv6 is off unless a record asks for it. An optional IPv6 suffix replaces the last 64 bits of the detected address, for a stable address of one host in the network.
- **Alias (CNAME):** points the name at a fixed target name and follows no address. The usual pairing is one address record such as `home.example.com` plus an alias such as `*.example.com` pointing to `home.example.com`: only the address record ever changes.

A wildcard name (`*.example.com`) is possible only on Cloudflare and DigitalOcean; Hetzner Cloud and Gandi refuse it when you save. A record that is missing at the provider is created. On Cloudflare the proxied setting is never changed: a new record is not proxied, and an existing one keeps what it has. A name whose record set at the provider has more than one value is never touched: the record is marked Failed instead. A name that already has a record of the other type (an address where an alias is wanted, or the reverse) is refused. Deleting a record in NPMpro leaves the DNS entry at the provider as it is.

### How the address is found

NPMpro asks public echo services over `https://`, in turn, until one answers with a single public address. Private, CGNAT, link-local, documentation and other reserved addresses are never used. An address that differs from the last known one is accepted only when a second service gives the same answer: when they disagree, or only one answers, nothing is written. The services are the defaults of `DDNS_IPV4_SERVICES` and `DDNS_IPV6_SERVICES` (see [Configuration](Configuration)) or your own list. IPv6 services are asked only while an enabled address record needs IPv6, and an alias asks for no address.

### The check

A check runs at start (one minute after) and then every period (default 5 minutes). For each enabled record NPMpro first looks up the name in DNS. When the answer already is the wanted address, nothing more happens. Only when the answer differs (or there is none) does it ask the provider's API, and it writes only when the record there really differs. A proxied Cloudflare record resolves to Cloudflare, so for it the provider is always asked. An alias is always compared at the provider.

If the DNS server of your network answers with a LAN address for your own names (split horizon), set **Resolver for checks** in Settings, Dynamic DNS (`DDNS_RESOLVER`) to a public resolver, so the lookup sees what the world sees.

The **cooldown** (default 5 minutes) is the least time between two writes of one record, so a flapping address cannot hammer the provider. A change inside the cooldown waits until the cooldown has passed. After a failed check the record is tried again later with a **backoff**: the wait doubles with each failure, starting at one period and never more than 6 hours; a success resets it. **Update now** (in the record's row menu) runs that one record at once, ignoring the backoff but not the cooldown, and shows the result. **Check now** (in the status card) runs a check of all your records at once.

### History and states

Each record keeps its last 50 changes: created, changed (old and new value), failed and recovered, with the time. Open them with **History** in the row menu. The history is deleted with the record. Provider tokens are never written to the status, the history or the log.

The state of a record is one of:

- **Pending:** waiting for its first check.
- **Updating:** a check is writing it now.
- **Up to date:** the record at the provider is what it should be (with the age of the last check).
- **Updated:** changed by the last check.
- **Failed:** the last check failed; the message says why, and the next try is shown.
- **Disabled:** not kept up to date.

Proxied is shown beside the state of a proxied Cloudflare record.

### Pause during restores

Checks are paused while a backup is restored or merged or the database is moved, and run again afterwards. The status card shows Paused, and Update now and Check now are refused meanwhile.

### Who may use it

Dynamic DNS uses the Certificates permission: view to see records and their history, manage to add, change, Update now, Check now and delete. A user limited to their own items sees only the records of their own credentials.

## DNS resolver

The resolver is the DNS server nginx uses for upstream names (a proxy host's forward host, for example). Set it in Settings, nginx, DNS resolver, or with the `NGINX_RESOLVER`, `NGINX_RESOLVER_HOSTS`, `NGINX_RESOLVER_IPV6` and `NGINX_RESOLVER_VALID` variables (see [Configuration](Configuration)). Empty servers mean the container's own `/etc/resolv.conf`. `NGINX_RESOLVER_VALID` takes a time in seconds or longer: seconds, or parts with units such as `30s`, `5m` or `1h30m` (never `ms`, not a bare `0`); empty uses each record's TTL, and `0s` or another zero such as `0m` means the same as empty.

The default is the line nginx.conf had (`resolver local=on hosts=on ipv6=on;`), so nothing changes until you set it. The line lives in `/data/npmpro/nginx/resolver.conf`, which the container writes at start. A custom `http.conf` or `stream.conf` must not add a second `resolver` line.

Addresses you set replace the container's own resolvers (local=on): a name that only the container's resolver knows, such as another container's name on a Docker network (127.0.0.11), is then no longer found unless one of your addresses answers it.

A save asks each new address once; an address that does not answer gives a warning, and the setting is still saved.

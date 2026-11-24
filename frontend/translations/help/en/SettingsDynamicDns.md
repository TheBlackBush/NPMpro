## Dynamic DNS

How NPMpro keeps the records of the Dynamic DNS tab (Certificates) pointed at its public address. Nothing is checked until a record is enabled.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by DDNS_PERIOD"). Use the UI for anything not set in the container.

- **Check every**: how often the records are checked, from `1m` to `24h` (for example `5m` or `1h30m`). Default: `5m`. Variable: `DDNS_PERIOD`. A change restarts the timer.
- **Cooldown**: the shortest time between two writes of one record, in the same format. Default: `5m`. Variable: `DDNS_COOLDOWN`.
- **IPv4 address services** and **IPv6 address services**: 2 to 10 `https://` URLs that answer with the public address. A new address is written only when a second service confirms it; an unchanged address is accepted from one. The IPv6 services are asked only while an enabled record needs IPv6. Variables: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (space separated). A service on this host, on a link-local address (such as cloud metadata), or on a multicast or reserved address is refused; private LAN addresses are allowed.
- **DNS servers for checks**: used only to look up a record's name before the provider is asked (split horizon); the address services and the providers always use the container's resolvers. Empty uses the container's resolvers here too. An IPv4 address, or an IPv6 address in brackets, with an optional port. Variable: `DDNS_RESOLVER` (space separated).

Records are added on the Dynamic DNS tab with a DNS credential of a provider that can update records.

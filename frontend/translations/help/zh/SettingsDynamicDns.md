## Dynamic DNS

How NPMpro keeps the records of the Dynamic DNS tab (Certificates) pointed at its public address. Nothing is checked until a record is enabled.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by DDNS_PERIOD"). Use the UI for anything not set in the container.

- **Check every**: how often the records are checked, from `1m` to `24h` (for example `5m` or `1h30m`). Default: `5m`. Variable: `DDNS_PERIOD`. A change restarts the timer.
- **Cooldown**: the shortest time between two writes of one record, in the same format. Default: `5m`. Variable: `DDNS_COOLDOWN`.
- **IPv4 address services** and **IPv6 address services**: `https://` URLs that answer with the public address. A new address is written only when two services agree. The IPv6 services are asked only while an enabled record needs IPv6. Variables: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (space separated). A service whose address the server may not call (a private or local address) is refused.
- **DNS servers**: the servers used to resolve the address services and the providers. Empty uses the container's resolvers. An IPv4 address, or an IPv6 address in brackets, with an optional port. Variable: `DDNS_RESOLVER` (space separated).

Records are added on the Dynamic DNS tab with a DNS credential of a provider that can update records.

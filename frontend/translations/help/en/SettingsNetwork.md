## Network

Tell NPMpro which proxies in front of it can be believed about the real client address. Without this, logs, access lists and CrowdSec see the address of the proxy, not of the visitor.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by TRUST_IP"). Use the UI for anything not set in the container.

- **Trusted proxy IPs**: one IPv4 or IPv6 address or CIDR range per line, for example `10.0.0.0/8`, `192.168.1.5` or `fd00::/8`. Requests from these addresses may pass the real client IP in `X-Forwarded-For`. Use it for a load balancer or tunnel directly in front of NPMpro. Default: empty (no one is trusted). Variable: `TRUST_IP` (space separated). Applies after the nginx reload that saving runs.
- **Trust Cloudflare**: fetches the Cloudflare IP ranges, refreshes them regularly and trusts them, so nginx sees the real client IPs behind Cloudflare. Default: off. Variable: `TRUST_CLOUDFLARE`. Applies after the nginx reload that saving runs. Read the notes on Cloudflare in the wiki (Security) first: putting Cloudflare in front of NPMpro has privacy and security costs.

Only trust addresses you control or fully rely on. A trusted address can claim to be any visitor.

If saving fails the nginx test, nothing is saved and the nginx message is shown.

More in the wiki: Security.

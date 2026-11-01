## Forward authentication

Forward authentication puts a login or a bot check in front of a proxy host. For each request, nginx first asks an authentication service whether the visitor may pass. NPMpro has this built in for Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia and Authentik. You run the provider in its own container.

This page sets the default address (upstream) of each provider. A proxy host turns the check on with **Auth Request** under Options on its Details tab (or on a custom location).

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by AUTH_REQUEST_AUTHELIA_UPSTREAM"). Use the UI for anything not set in the container. Every setting here applies after the nginx reload that saving runs. If the nginx test fails, nothing is saved.

### Default upstreams

- **Anubis upstream**, **Tinyauth upstream**, **OAuth2 Proxy upstream**, **VoidAuth upstream**, **Authelia upstream**, **Authentik upstream**: used by proxy hosts with that provider that have no upstream of their own. A host's own value wins. Default: empty (none). Variables: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Format: `scheme://host:port`, for example `http://127.0.0.1:9091`, or `scheme://cu_name` for your own nginx upstream block whose name starts with `cu_`. Use `http` or `https`; the port is required; an IPv6 address goes in brackets. No path, no spaces and none of `; { } # " ' $ \`.

You cannot empty a default while proxy hosts use that provider without their own upstream. The message lists those hosts.

A host that uses a provider with no upstream anywhere gets a "Config error".

### Anubis

- **Custom Anubis images**: shows your own `happy.webp`, `reject.webp` and `pensive.webp` on the Anubis challenge pages. Default: on when all three files exist and are not empty, otherwise off. Variable: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. The images go in `public/anubis` in your data folder.

More in the wiki: Forward-Authentication.

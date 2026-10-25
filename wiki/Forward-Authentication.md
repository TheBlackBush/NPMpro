# Forward authentication

Forward authentication puts a login (or a bot check) in front of a service that has none of its own, or that you do not want to expose without one. For every request to a protected proxy host, nginx first asks an authentication service (with the nginx `auth_request` module) whether the visitor may pass:

- the service answers 2xx: the request goes on to your service, together with headers that name the user;
- the service answers 401 (or 403): NPMpro sends the visitor to the login page or the challenge of the service instead.

NPMpro has the nginx side built in for six providers: [Anubis](#anubis), [Tinyauth](#tinyauth), [oauth2-proxy](#oauth2-proxy), [VoidAuth](#voidauth), [Authelia](#authelia) and [authentik](#authentik). You run the provider in its own container, tell NPMpro where it is, and choose it in the proxy host. No custom or advanced nginx config and no extra custom locations are needed.

## Forward authentication or OIDC login?

They are unrelated:

- **Forward authentication** (this page) protects **your proxy hosts**, the services behind NPMpro. It is set in Settings, Forward authentication and in each proxy host.
- **OIDC login** (Settings, Authentication) is the sign-in to the **NPMpro web UI** itself, see [OIDC login](https://github.com/TheBlackBush/NPMpro#oidc-login). It does not protect any proxy host.

You can use the same identity provider for both, but each is set up on its own.

Forward authentication is available for proxy hosts and their custom locations. Redirection hosts, 404 hosts and streams do not have it.

## How it works in NPMpro

### 1. The default upstream (Settings, Forward authentication)

Settings, Forward authentication (administrators) has one field per provider under **Default upstreams**: Anubis upstream, Tinyauth upstream, OAuth2 Proxy upstream, VoidAuth upstream, Authelia upstream and Authentik upstream. A proxy host that uses a provider and has no upstream of its own uses this value. Saving applies at once (nginx is reloaded); if the nginx test fails, nothing is saved and the error is shown.

The upstream is the address where NPMpro reaches the provider, in one of these forms:

- `scheme://host:port`, for example `http://127.0.0.1:9091`, `http://auth-server.lan:4180` or `http://[fd00::5]:3000`. The scheme is `http` or `https`, the port is required, an IPv6 address is written in brackets.
- `scheme://cu_name`, the name of your own nginx `upstream` block whose name starts with `cu_`, defined in `/opt/npmpro/custom_nginx/http_top.conf` (see [Load Balancing](https://github.com/TheBlackBush/NPMpro#load-balancing)). Use it to spread the checks over several provider instances.

Not allowed: a path (NPMpro adds the path of each provider itself), whitespace and any of `; { } # " ' $ \`.

With the default `network_mode: host`, NPMpro reaches a provider container through a port that the container publishes on the host, so the upstream is `http://127.0.0.1:<published port>`. Docker container names do not resolve from a container with host networking.

**Variables win.** `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM` and `AUTH_REQUEST_AUTHENTIK_UPSTREAM` in `compose.yaml` override the field and lock it in the UI ("Set by" the variable). A value in the wrong format stops the container at start with a message that explains the format. Remove the variable and recreate the container (`docker compose up -d`) to manage the field in the UI again.

**Clearing a default is refused while hosts need it.** If proxy hosts use a provider without their own upstream, emptying its default is refused with the message `<provider>_upstream: still used by proxy hosts without their own upstream: ...` and the list of those hosts. Give those hosts their own upstream or choose another Auth Request first.

The **Anubis** part of the page has the **Custom Anubis images** switch, see [Anubis](#anubis).

### 2. Choose the provider in the proxy host

1. Open the proxy host (or create one). On the **Details** tab, under **Options**, choose the provider in **Auth Request**: `anubis`, `tinyauth`, `oauth2proxy`, `voidauth`, `authelia (modern)`, `authentik` or `authentik-send-basic-auth`.
2. **Auth Request Upstream** appears below it. Keep it empty to use the default from Settings, Forward authentication, or enter an upstream for this host only (same format as above). A host's own value wins over the default.
3. Save. NPMpro writes the config, tests it, and the host is protected.

**Custom locations** have their own **Auth Request** and **Auth Request Upstream** fields: open the location on the **Custom Locations** tab, the fields are in its **Options**. A custom location does not take over the Auth Request of the host: set it on every location that needs protection, or leave it on `none` to make that path public on purpose.

One host has one upstream per provider. When the host and several custom locations use the same provider, the host's own upstream is used; if the host has none, the upstream of the first enabled location that has one; otherwise the default.

### Things to know for every provider

- **Access lists and Satisfy Any:** an access list on the same host still applies: the visitor needs to pass both. If the first access list uses Satisfy Any, a matching rule or a valid user skips the Auth Request too. The host dialog warns about this.
- **mTLS:** on the **TLS** tab, with an mTLS certificate and **Make mTLS Optional**, the switch **mTLS bypass Auth Request** lets clients with a valid client certificate skip the forward authentication. Clients without one get the normal login.
- **Helper paths:** NPMpro adds the paths that the provider needs to the protected host (listed in each section below). They take precedence over your service for these paths, so your service cannot use them.
- **No upstream at all:** if a host uses a provider and neither the host nor the default has an upstream, the nginx test fails and the host shows a red "Config error". Set the default or the host's upstream.
- **Apps and APIs:** a mobile app, a sync client or another server that calls the protected host cannot log in through a browser page. Leave the paths they use unprotected with a custom location (Auth Request `none`), or protect the host differently.

## Anubis

[Anubis](https://github.com/TecharoHQ/anubis) is not a login: it checks that the visitor is a real browser (a proof-of-work challenge) and keeps AI scrapers and bots away.

**Container:** `compose.yaml` has a commented `anubis` service:

```yaml
  anubis:
    container_name: npmpro-anubis
    restart: unless-stopped
    image: ghcr.io/techarohq/anubis:latest
    pull_policy: always
    network_mode: bridge
    ports:
      - "127.0.0.1:8923:8923"
    environment:
      - "TZ=Europe/Berlin" # your time zone
      - "TARGET= " # important: this needs to be and stay one single space
      - "POLICY_FNAME=/etc/botPolicies.yaml" # required so the status codes can be changed
    volumes:
      - "/opt/anubis.yaml:/etc/botPolicies.yaml:ro"
```

Steps:

1. Download the default bot policy file of your Anubis version to `/opt/anubis.yaml` **before** you start the container (otherwise Docker creates a folder with that name): `https://raw.githubusercontent.com/TecharoHQ/anubis/refs/tags/<version>/data/botPolicies.yaml`.
2. In that file set the status codes to 401 and 403:
   ```yaml
   status_codes:
     CHALLENGE: 401
     DENY: 403
   ```
3. Uncomment the service (keep `TARGET` as one single space) and start it: `docker compose up -d anubis`.
4. In NPMpro set **Anubis upstream** in Settings, Forward authentication to `http://127.0.0.1:8923` (or set `AUTH_REQUEST_ANUBIS_UPSTREAM`).
5. In the proxy host choose **Auth Request** `anubis` and save.

**What NPMpro does:** it forwards `/.within.website/` of the protected host to Anubis and checks every request with `/.within.website/x/cmd/anubis/api/check`. When Anubis answers 401 or 403, the visitor gets the Anubis page at the same address (with status 200); after the challenge is solved, the page loads normally.

**What the visitor sees:** a short "checking your browser" page on the first visit, then your service.

**Custom images:** to replace the "allow", "checking" and "blocked" images, put your images as `happy.webp`, `pensive.webp` and `reject.webp` into `/opt/npmpro/anubis` and turn on **Custom Anubis images** in Settings, Forward authentication. It is on by default when all three files exist and are not empty; `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES` sets it.

**Common mistakes:**

- The status codes are not changed in the policy file: then the challenge answers with a success code and nobody is checked.
- `TARGET` is empty or has another value: in this setup Anubis must not forward requests itself, NPMpro does that.
- `POLICY_FNAME` or the volume is missing, so Anubis uses its built-in policy with the default status codes.

## Tinyauth

[Tinyauth](https://tinyauth.app) is a small login service with local users, OAuth providers (Google, GitHub, any OIDC) and optional TOTP.

**Container:** run Tinyauth as described in its documentation and publish its port on the host, for example `127.0.0.1:3000:3000`. Tinyauth needs a domain of its own for its login page, for example `auth.example.com`, set as its app URL in the Tinyauth configuration. The protected hosts should be subdomains of the same parent domain (`app.example.com`), because the login cookie is set for that domain.

Steps:

1. Create a proxy host for the Tinyauth domain (`auth.example.com`, scheme `http`, `127.0.0.1`, port `3000`) with a certificate. Do not set an Auth Request on it.
2. Set **Tinyauth upstream** in Settings, Forward authentication to `http://127.0.0.1:3000` (or `AUTH_REQUEST_TINYAUTH_UPSTREAM`).
3. In the proxy host of the service choose **Auth Request** `tinyauth` and save.

**What NPMpro does:** for each request it calls `<upstream>/api/auth/nginx` (inside the internal path `/tinyauth` of the protected host), with the `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-URI` headers of the original request. On 401 or 403 it redirects the visitor to the address that Tinyauth returns in its `x-tinyauth-location` header. After the login, it passes `Remote-User`, `Remote-Email`, `Remote-Name`, `Remote-Groups`, `Remote-Sub` and `Authorization` from Tinyauth to your service.

**What the visitor sees:** a redirect to the Tinyauth login page, then back to the service.

**Common mistakes:**

- The app URL of Tinyauth does not match the domain of its proxy host, or the protected host is not under the same parent domain: the login loops or the cookie is not sent.
- Your service uses its own HTTP basic auth: the `Authorization` header sent to the service is replaced by the one from Tinyauth.
- Tinyauth and VoidAuth both default to port 3000; when you run both, publish one of them on another port.

## oauth2-proxy

[oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) logs visitors in with an OAuth2/OIDC provider (Google, GitHub, Keycloak, authentik, any OIDC issuer).

**Container:** run oauth2-proxy as described in its documentation, configured for your identity provider, and publish its port on the host, for example `127.0.0.1:4180:4180`. For this setup it typically needs:

- `--reverse-proxy=true`, so it uses the forwarded headers from NPMpro;
- `--set-xauthrequest=true`, so it returns the user and email headers (and `--pass-access-token=true` if your service needs the access token);
- `--cookie-domain` and `--whitelist-domain` set to your domain when it protects several hosts;
- as redirect URL, `https://<protected host>/oauth2/callback`, registered at your identity provider for every protected host.

oauth2-proxy does not need a proxy host of its own: NPMpro serves its pages on each protected host.

Steps:

1. Set **OAuth2 Proxy upstream** in Settings, Forward authentication to `http://127.0.0.1:4180` (or `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`).
2. In the proxy host of the service choose **Auth Request** `oauth2proxy` and save.

**What NPMpro does:** it forwards `/oauth2/` of the protected host to oauth2-proxy (the sign-in page and the callback), and checks every request with `/oauth2/auth`. On 401 it redirects to `/oauth2/sign_in?rd=<the original address>`. It passes `X-User` and `X-Email` (from `X-Auth-Request-User` and `X-Auth-Request-Email`) and `X-Access-Token` to your service and forwards the session cookie that oauth2-proxy sets, also when it is split into several cookies.

**What the visitor sees:** the oauth2-proxy sign-in page (or directly your identity provider), then the service.

**Common mistakes:**

- The callback URL of a protected host is not registered at the identity provider: the provider shows a redirect URI error.
- `--reverse-proxy` is missing: oauth2-proxy builds wrong redirect addresses.
- The service itself uses paths below `/oauth2/`: they are taken by oauth2-proxy on a protected host.

## VoidAuth

[VoidAuth](https://voidauth.app) is a self-hosted identity provider with forward authentication (proxy auth) and OIDC.

**Container:** run VoidAuth as described in its documentation and publish its port on the host, for example `127.0.0.1:3000:3000` (choose another host port if Tinyauth already uses 3000). VoidAuth needs a domain of its own, for example `auth.example.com`, set as its app URL. In the VoidAuth admin pages, add the protected domains to its proxy auth settings.

Steps:

1. Create a proxy host for the VoidAuth domain (`auth.example.com`, scheme `http`, `127.0.0.1`, its port) with a certificate. Do not set an Auth Request on it.
2. Set **VoidAuth upstream** in Settings, Forward authentication to `http://127.0.0.1:3000` (or your port; `AUTH_REQUEST_VOIDAUTH_UPSTREAM`).
3. In the proxy host of the service choose **Auth Request** `voidauth` and save.

**What NPMpro does:** it checks every request with `<upstream>/api/authz/auth-request` (the internal path `/api/authz/auth-request` of the protected host), with `X-Original-URL` and `X-Forwarded-URI` set to the original request. On 401 or 407 it redirects the visitor to the address that VoidAuth returns in its `Location` header. After the login, it passes `Remote-User`, `Remote-Groups`, `Remote-Name` and `Remote-Email` to your service.

**What the visitor sees:** the VoidAuth login page, then the service.

**Common mistakes:**

- The protected domain is not added to the proxy auth settings of VoidAuth: access is denied after the login.
- The app URL of VoidAuth does not match the domain of its proxy host.

## Authelia

[Authelia](https://www.authelia.com) is an authentication server with users, two-factor authentication and access rules per domain. The `authelia (modern)` choice uses its AuthRequest endpoint (`/api/authz/auth-request`), which current Authelia versions provide by default.

**Container:** run Authelia as described in its documentation and publish its port on the host, for example `127.0.0.1:9091:9091`. Authelia needs a domain of its own for its portal, for example `auth.example.com`. In its configuration:

- under `session.cookies`, set `domain` to your parent domain (`example.com`) and `authelia_url` to `https://auth.example.com`;
- under `access_control`, add rules for the protected domains (with `default_policy: deny`, a domain without a rule is denied).

Steps:

1. Create a proxy host for the Authelia domain (`auth.example.com`, scheme `http`, `127.0.0.1`, port `9091`) with a certificate. Do not set an Auth Request on it.
2. Set **Authelia upstream** in Settings, Forward authentication to `http://127.0.0.1:9091` (or `AUTH_REQUEST_AUTHELIA_UPSTREAM`).
3. In the proxy host of the service choose **Auth Request** `authelia (modern)` and save.

**What NPMpro does:** it checks every request with `<upstream>/api/authz/auth-request` (the internal path `/internal/authelia/authz` of the protected host), with `X-Original-Method` and `X-Original-URL` set to the original request. On 401 it redirects the visitor to the address that Authelia returns in its `Location` header (the portal, with the way back). After the login, it passes `Remote-User`, `Remote-Groups`, `Remote-Email` and `Remote-Name` to your service.

**What the visitor sees:** the Authelia portal (login and, if required, the second factor), then the service.

**Common mistakes:**

- The protected host is not under the cookie `domain` of Authelia: the login works, but the visitor is sent back to the portal again.
- No `access_control` rule matches the protected domain: Authelia denies the request (403) after the login.
- The upstream contains a path such as `/api/authz/auth-request`: it is refused, NPMpro adds the path itself.

## authentik

[authentik](https://goauthentik.io) is an identity provider with users, flows, two-factor authentication and proxy providers. NPMpro talks to the **embedded outpost** of the authentik server; other outposts are currently not supported.

**Container:** run authentik as described in its documentation and publish its https port on the host, for example `127.0.0.1:9443:9443`. In authentik:

1. Create a **Proxy Provider** in the mode **Forward auth (single application)**, with the address of the protected host as **External host** (`https://app.example.com`).
2. Create an **Application** that uses this provider.
3. Add the application to the **authentik Embedded Outpost** (Applications, Outposts).

To reach the authentik web interface and its login flows, create a proxy host for it as well, for example `auth.example.com` with scheme `https`, `127.0.0.1`, port `9443`, without an Auth Request.

Steps in NPMpro:

1. Set **Authentik upstream** in Settings, Forward authentication to `https://127.0.0.1:9443` (or `AUTH_REQUEST_AUTHENTIK_UPSTREAM`). NPMpro does not check the certificate of this upstream, so the self-signed certificate of authentik works.
2. In the proxy host of the service choose **Auth Request** `authentik`, or `authentik-send-basic-auth` (see below), and save.

**What NPMpro does:** it forwards `/outpost.goauthentik.io` of the protected host to the outpost and checks every request with `/outpost.goauthentik.io/auth/nginx`, with `X-Original-URL` set to the original request. On 401 it redirects to `/outpost.goauthentik.io/start?rd=<the original address>`, which starts the authentik login. After the login, it passes `X-authentik-username`, `X-authentik-groups`, `X-authentik-entitlements`, `X-authentik-email`, `X-authentik-name` and `X-authentik-uid` to your service and forwards the session cookie of the outpost.

`authentik-send-basic-auth` does the same and also passes the `Authorization` header from authentik to your service. Use it with the **Send HTTP-Basic Authentication** option of the proxy provider, for services that expect HTTP basic auth.

**What the visitor sees:** the authentik login flow, then the service.

**Common mistakes:**

- The application is not added to the embedded outpost, or the External host does not match the protected host exactly (scheme and domain): authentik answers with an error instead of the login.
- The upstream points to an outpost container instead of the authentik server: only the embedded outpost is supported.
- The provider is in the mode Proxy or Forward auth (domain level) instead of Forward auth (single application).

## Troubleshooting

- **"Config error" on the host:** click the status to see the nginx message. Usually no upstream is set for the chosen provider, or the custom or advanced config of the host conflicts with a helper path.
- **500 error on every request:** the provider cannot be reached at the upstream, or it answers with something other than 2xx, 401 or 403. Check that the container runs, that its port is published on `127.0.0.1`, and test it from the host, for example `curl -i http://127.0.0.1:9091`. The nginx error log in `docker logs npmpro` names the failing auth request.
- **Login loop:** the cookie of the provider is not sent back. Check the cookie domain and app URL settings of the provider and that the protected host and the provider domain share the parent domain.
- **The service is reachable without login on some paths:** these paths are custom locations without their own Auth Request, or the first access list uses Satisfy Any.

For other problems see [Troubleshooting](Troubleshooting).

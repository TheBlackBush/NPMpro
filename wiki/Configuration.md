# Configuration

Most settings live in the web UI under Settings, and that is the normal place to change them. Startup-only options are environment variables in your `compose.yaml`. This page explains how the two work together and lists every setting with its variable.

Every setting can also be set with an environment variable in your `compose.yaml`:

- **A variable wins and locks the field.** The field shows the value of the variable and cannot be changed in the UI. Its badge names the variable: "Set by ACME_KEY_TYPE". A field that another variable forces gets its own badge with the reason: "Follows ACME_KEY_SIZE" (`ACME_KEY_SIZE` set alone is an ECDSA curve, so the key type stays ECDSA; an RSA size only works together with `ACME_KEY_TYPE=rsa`), "Off because of ACME_OCSP_STAPLING" (Must-Staple needs OCSP stapling), "Required by ACME_MUST_STAPLE" (OCSP stapling stays on) and "Required by GOA" (GoAccess reads the log files, so Write log files stays on; "Required by the GoAccess report" when the setting turned GoAccess on). The Authentication, traffic statistics and GeoIP fields show "Set by environment".
- **Remove the variable to manage the field in the UI again.** Changing or removing a variable needs the container to be recreated (`docker compose up -d`), like any change in `compose.yaml`.
- **The Environment page** (Settings, Environment) lists the startup variables (ports, bindings, PUID/PGID, `NGINX_QUIC_BPF` and PHP, database, first start, ACME account) with their value or default, among them `TZ`, `GOA` and `GOACLA`, which are also settings, and every setting that a variable locks. Values of passwords, email addresses and keys are never shown, only whether they are set.
- **"Restart required" settings** (Time zone, GoAccess report and the GoAccess options) are read when the container starts. Saving them stores the value; the section then shows "Restart the container to apply" with the fields until you restart the container (`docker restart npmpro`).
- Variables that are only read at startup and have no field (ports, bindings, `PUID`/`PGID`, `DISABLE_HTTP`, `NGINX_QUIC_BPF`, PHP, database, `ACME_SERVER`, `ACME_EMAIL` and the EAB keys, `INITIAL_*`) stay in `compose.yaml`; the [compose.yaml](https://github.com/TheBlackBush/NPMpro/blob/develop/compose.yaml) lists every supported variable with its default.

When a saved setting applies:

| Settings page | Field | Variable | Applies |
|---|---|---|---|
| Certificates & TLS | Key type | `ACME_KEY_TYPE` | to the next certificate |
| Certificates & TLS | Key size | `ACME_KEY_SIZE` | to the next certificate |
| Certificates & TLS | ACME profile | `ACME_PROFILE` | to the next certificate (checked with the ACME server when you save) |
| Certificates & TLS | OCSP Must-Staple | `ACME_MUST_STAPLE` | to the next certificate |
| Certificates & TLS | Verify the ACME server certificate | `ACME_SERVER_TLS_VERIFY` | to the next certificate |
| Certificates & TLS | Renewal check interval | `CERTBOT_RUN_INTERVAL` | immediately |
| Certificates & TLS | OCSP stapling for ACME certificates | `ACME_OCSP_STAPLING` | on save, with an nginx reload |
| Certificates & TLS | OCSP stapling for custom certificates | `CUSTOM_OCSP_STAPLING` | on save, with an nginx reload |
| Certificates & TLS | Default certificate: Certificate for unknown hosts and the web UI | `DEFAULT_CERT_ID` | on save, with an nginx reload |
| Certificates & TLS | ECH key rotation interval | `ECH_ROTATION_INTERVAL` | immediately |
| Network | Trusted proxy IPs | `TRUST_IP` | on save, with an nginx reload |
| Network | Trust Cloudflare | `TRUST_CLOUDFLARE` | on save, with an nginx reload |
| Forward authentication | Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia and Authentik upstream | `AUTH_REQUEST_<PROVIDER>_UPSTREAM` (`ANUBIS`, `TINYAUTH`, `OAUTH2PROXY`, `VOIDAUTH`, `AUTHELIA`, `AUTHENTIK`) | on save, with an nginx reload |
| Forward authentication | Custom Anubis images | `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES` | on save, with an nginx reload |
| Logs & monitoring | Write log files | `LOGROTATE` | on save, with an nginx reload |
| Logs & monitoring | Log rotations kept | `LOGROTATIONS` | immediately |
| Logs & monitoring | GoAccess report | `GOA` | after a restart |
| Logs & monitoring | GoAccess options (keep report data, anonymize visitor IPs, drop query strings, full operating system versions, resolve host names) | `GOACLA` (one variable for all of them) | after a restart |
| Logs & monitoring | Traffic statistics, keep statistics for, show visitor IPs, count unique visitors, visitor limit per host and day | `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP` | on save |
| GeoIP | Account ID, license key, databases | `GEOIP_ACCOUNT_ID`, `GEOIP_LICENSE_KEY`, `GEOIP_EDITIONS` | on save (the download starts) |
| Authentication | Issuer URL, client ID, client secret, redirect domain, require a verified email, disable password login, skip two-factor after OIDC | `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_DOMAIN`, `OIDC_REQUIRE_VERIFIED_EMAIL`, `OIDC_DISABLE_PASSWORD`, `OIDC_SKIP_MFA` | on save |
| nginx | Worker processes, worker connections, worker shutdown timeout | `NGINX_WORKER_PROCESSES`, `NGINX_WORKER_CONNECTIONS`, `NGINX_WORKER_SHUTDOWN_TIMEOUT` | on save, with an nginx reload |
| nginx | Log requests for missing files | `NGINX_LOG_NOT_FOUND` | on save, with an nginx reload |
| nginx | TLS 1.2, NIST P curves (secp521r1, secp384r1, secp256r1), RSA PKCS#1 signature algorithms | `NGINX_DISABLE_TLS12` (inverted), `NGINX_TRUST_SECPR1`, `NGINX_TRUST_RSA_PKCS1` | on save, with an nginx reload |
| nginx | Post-quantum only (X25519MLKEM768): turns TLS 1.2 and the NIST P curves off and locks them | `NGINX_FORCE_X25519MLKEM768` | on save, with an nginx reload |
| nginx | Modules: njs, LDAP, NTLM, virtual host traffic status | `NGINX_LOAD_NJS_MODULE`, `NGINX_LOAD_LDAP_MODULE`, `NGINX_LOAD_NTLM_MODULE`, `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE` | on save, with an nginx reload |
| Advanced | Format nginx configs | `DISABLE_NGINX_BEAUTIFIER` (inverted) | immediately |
| Advanced | Gravatar profile pictures | `DISABLE_GRAVATAR` (inverted) | immediately (a user's picture changes at their next profile save) |
| Advanced | Time zone | `TZ` | after a restart |

Turning on post-quantum only (by `NGINX_FORCE_X25519MLKEM768` or in Settings) overrides `NGINX_DISABLE_TLS12` and `NGINX_TRUST_SECPR1`; the stored TLS 1.2 and P curve settings are not changed.

Changes that need an nginx reload are tested with `nginx -t` first: if the test fails, nothing is saved, the previous files are kept and the nginx message is shown.

## COOKIE_SECRET

`COOKIE_SECRET` is the secret that signs the session cookie of the web UI. It is a startup variable without a field in the web UI. Set it, because:

- **Without it, NPMpro creates a new random secret at every start.** Every restart, recreate and upgrade of the container then signs all users out.
- **With a static random value, users stay signed in** across restarts, recreates and upgrades. The same holds for a [database move](Database), which restarts NPMpro.
- **Keep the value.** Changing it signs everyone out once, because the existing cookies no longer match.
- **Treat it like a password.** Anyone who knows it can forge a session cookie, so do not publish it, do not commit it to a repository and keep it out of screenshots and logs.

Use a long random value (32 random bytes written as 64 hex characters is plenty). Any of these makes one:

```bash
openssl rand -hex 32
```

```bash
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; echo
```

If neither is available on your host, let the NPMpro container make one (replace `npmpro` with your container name):

```bash
docker exec npmpro node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the result into `compose.yaml` and recreate the container (`docker compose up -d`):

```yaml
    environment:
      - "COOKIE_SECRET=<the generated value>"
```

If you moved from NPMplus, users only stay signed in through the upgrade when you already used a static `COOKIE_SECRET` there and keep it, see [Upgrading from NPMplus](Upgrading-from-NPMplus).

## Prerun scripts (expert option)

If you don't know what this is, ignore it. If you need to run scripts before NPMpro launches, put them under `/opt/npmpro/prerun/*.sh` (please add `#!/usr/bin/env sh` or `#!/usr/bin/env bash` to the top of the script). You need to create this folder yourself, and also set `ENABLE_PRERUN=true` in your `compose.yaml` (shown on the Environment page). The scripts run as root on every start, before the variables are checked, so they only run when root alone can change them: the folder and every script must be owned by root (`chown -R root:root /opt/npmpro/prerun`), not be links and not be writable by group or others; anything else is skipped with a message in the log.

## Removed variables and upgrade notes

Variables that are not supported anymore, and what changed for installs that update, are on [Upgrade notes](Upgrade-notes).

# Usage

## First sign-in

Open `https://<server-ip>:81` and create the admin account on the setup page (or sign in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` if you set them on the first start). The dashboard shows your hosts and, for administrators, a short monitoring row.

You can turn on two-factor authentication (TOTP, with one-time backup codes) for your account in the user menu.

## Hosts

- **Proxy hosts** forward a domain to a service (`http`, `https`, `grpc`, `grpcs`, or `path` to serve files or PHP from a folder). The Details tab holds the per-host switches under Options, such as forward authentication (Auth Request), Disable Crowdsec Appsec and the buffering switches; the Advanced tab holds custom nginx config. Custom locations forward sub paths elsewhere.
- **Redirection hosts** send visitors of a domain to another address with the HTTP code you choose.
- **404 hosts** answer a domain with a 404 page.
- **Streams** forward TCP or UDP ports (for example a game server or SSH), optionally with TLS from an NPMpro certificate.
- Hosts can be put into groups to keep long lists tidy.

The meaning of several options differs from nginx-proxy-manager, see [Comments on some buttons](https://github.com/TheBlackBush/NPMpro#comments-on-some-buttons). Websockets are always on.

When NPMpro saves a host it tests the nginx config. If the test fails, the host gets a red "Config error" status (click it for the nginx message), and the rest of your hosts keep working. See [Troubleshooting](Troubleshooting#a-host-shows-offline-or-config-error).

## Certificates

Under Certificates you can request certificates from your ACME server (Let's Encrypt by default) or upload your own:

- **HTTP challenge:** the domain must point to NPMpro and port 80 must be reachable from the internet. The reachability check in the dialog tests this (it uses site24x7.com).
- **DNS challenge:** works without open ports and for wildcard certificates. Choose your DNS provider and enter its credentials. The credentials can be saved once (Certificates, DNS credentials tab) and reused for other certificates. They are stored encrypted with `/data/npmpro/dns-credentials.key`, which also encrypts the OIDC client secret, the MaxMind license key and the key behind the unique visitor hashes. Keep this file with your backups: without it saved DNS credentials, the client secret and the license key have to be entered again.
- **Custom certificates:** upload a certificate and key (keys protected with a passphrase are not supported). A custom certificate can be replaced later.

Certificates renew automatically; the renewal check interval, key type and size, ACME profile and OCSP options are in Settings, Certificates & TLS. The ACME server, account email and EAB keys are variables only (`ACME_SERVER`, `ACME_EMAIL`, `ACME_EAB_KID`, `ACME_EAB_HMAC_KEY`).

## Access lists

Access lists combine basic auth users and allow/deny rules for IP addresses or ranges. A host or location can use several access lists; they are evaluated top-down in the order shown in the UI, and "Satisfy Any" and "Pass Auth to Upstream" only apply when set on the first one. See [Access Lists](https://github.com/TheBlackBush/NPMpro#access-lists).

## Settings

Settings (administrators) has these pages: Default Site, Authentication, Certificates & TLS, Network, Forward authentication, Logs & monitoring, GeoIP, Advanced and Environment.

- **A variable in `compose.yaml` wins** over the saved value and locks the field. The badge names it, for example "Set by TRUST_IP", or explains an indirect lock ("Follows ACME_KEY_SIZE": `ACME_KEY_SIZE` set alone is an ECDSA curve, so the key type stays ECDSA, and an RSA size needs `ACME_KEY_TYPE=rsa` too; "Required by GOA"). Authentication, traffic statistics and GeoIP fields show "Set by environment". Remove the variable and recreate the container to manage the field in the UI again.
- **Each field says when it applies:** to the next certificate, when you save (with an nginx reload), or immediately. If the nginx test fails on save, nothing is saved and the error is shown.
- **"Restart required" fields** (Time zone in Advanced, GoAccess report and GoAccess options in Logs & monitoring) are read when the container starts. After saving, the section lists them under "Restart the container to apply" until you run `docker restart npmpro`.
- **Environment** is read-only: the startup variables (ports, bindings, users, nginx and TLS switches, modules and PHP, database and first start, the ACME account) with their value or default, and the list of settings that a variable locks. Passwords, email addresses and keys are only shown as "set" or "not set". To change one, edit `compose.yaml` and recreate the container.

The full table of fields, variables and when they apply is in the README: [Settings and environment variables](https://github.com/TheBlackBush/NPMpro#settings-and-environment-variables).

## Monitoring

The Monitoring page (administrators) has a Traffic tab and a CrowdSec tab:

- **Traffic** needs Traffic statistics turned on in Settings, Logs & monitoring. NPMpro then counts requests, bytes and status classes per host from the access log, plus countries and networks when GeoIP databases exist. Visitor IPs and unique visitors are separate opt-in settings.
- **CrowdSec** shows the active bans once the CrowdSec bouncer is configured.
- **GeoIP:** enter a free MaxMind account ID and license key in Settings, GeoIP; NPMpro downloads the GeoLite2 databases itself and updates them every 3 days.

Details and the privacy notes: [Monitoring](https://github.com/TheBlackBush/NPMpro#monitoring) and [Hints for Your Privacy Policy](https://github.com/TheBlackBush/NPMpro#hints-for-your-privacy-policy).

## GoAccess

Turn on GoAccess report in Settings, Logs & monitoring and restart the container. The report opens under `/goaccess` of the web UI, for signed-in administrators. Its options (days kept, IP anonymization, query strings, operating system versions, host name lookups) are fields in the same block. See [GoAccess](https://github.com/TheBlackBush/NPMpro#goaccess).

## OIDC sign-in

Settings, Authentication sets up sign-in with an OIDC provider: issuer URL, client ID, client secret and redirect domain, then register the shown callback URL at your provider and enable it. Users can be created on their first sign-in, limited to allowed email domains, and password sign-in can be turned off. See [OIDC login](https://github.com/TheBlackBush/NPMpro#oidc-login).

## Users and permissions

Under Users an administrator creates users, sets or resets their password, resets their MFA, revokes their sessions and sets their permissions: for each section (proxy hosts, redirection hosts, 404 hosts, streams, access lists, certificates) "Manage", "View Only" or "Hidden", and whether they see all items or only the ones they created. Administrators can also sign in as another user.

## Audit Logs

Audit Logs lists who created, updated, enabled, disabled or deleted which object, with filters for the user, the object type and the action. Each entry opens with its details.

## Password and MFA reset

If you are locked out (SQLite only):

```bash
docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]
```

The new password is read from stdin; leave it empty to keep the current one. `--disable-mfa` turns off two-factor authentication and deletes the backup codes of the user.

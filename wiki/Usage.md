# Usage

## First sign-in

Open `https://<server-ip>:81` and create the admin account on the setup page (or sign in with `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` if you set them on the first start). The dashboard shows your hosts and, for administrators, a short monitoring row.

On the login page, **Sign in** becomes available once a valid email address and a password are entered. If you leave the email field with an address that is not valid, "Invalid email address" shows under it. In the two-factor step, **Verify** becomes available once a code is entered.

You can turn on two-factor authentication (TOTP, with one-time backup codes) for your account in the user menu.

## Hosts

- **Proxy hosts** forward a domain to a service (`http`, `https`, `grpc`, `grpcs`, or `path` to serve files or PHP from a folder). The Details tab holds the per-host switches under Options, such as forward authentication (Auth Request, see [Forward authentication](Forward-Authentication)), Disable Crowdsec Appsec (see [CrowdSec](CrowdSec#appsec-and-your-hosts)) and the buffering switches; the Advanced tab holds custom nginx config (only administrators can set or change it, other users see it read-only). Custom locations forward sub paths elsewhere. With `path`, users who are not administrators can only serve files from inside `/var/www`.
- **Redirection hosts** send visitors of a domain to another address with the HTTP code you choose.
- **404 hosts** answer a domain with a 404 page.
- **Streams** forward TCP or UDP ports (for example a game server or SSH), optionally with TLS from an NPMpro certificate. A new certificate requested from the stream form needs the DNS challenge. nginx only sends PROXY protocol v2 over UDP, so when UDP forwarding is on the form switches PROXY protocol v1 to v2, and a stream with both TCP and UDP then sends v2 on the TCP side as well.
- Hosts can be put into groups to keep long lists tidy.

The meaning of several options differs from nginx-proxy-manager, see [Comments on some buttons](https://github.com/TheBlackBush/NPMpro#comments-on-some-buttons). Websockets are always on.

When you save a host, NPMpro first checks its certificates: the TLS certificate cannot be an mTLS CA ("An mTLS certificate can not be used as the SSL certificate"), the **mTLS Certificate** must be an mTLS CA certificate, and the certificate files must exist ("The certificate files are missing"). These checks run before a new certificate is requested, so a refused save leaves no unused certificate behind.

When NPMpro saves a host it tests the nginx config. If the test fails, the host gets a red "Config error" status (click it for the nginx message), and the rest of your hosts keep working. See [Troubleshooting](Troubleshooting#a-host-shows-offline-or-config-error).

## Saving forms

- **Save never stays unavailable without a reason.** While a field has an error, the button looks disabled and a red note next to it names the fields to fix ("Fix before saving: ..."); clicking it jumps to the first marked field. When an edit form has no changes, the button is disabled and a grey note says "No changes to save". Errors show once you leave a field or try to save, so an empty form does not open full of red.
- **Unsaved changes are not lost by accident.** Closing a host, certificate, access list, DNS credential, user, permissions or backup schedule window with unsaved changes asks "You have unsaved changes. Close and discard them?". Leaving a Settings page with unsaved changes asks "You have unsaved changes. Leave and discard them?" first.

## Certificates

Under Certificates you can request certificates from your ACME server (Let's Encrypt by default) or upload your own:

- **HTTP challenge:** the domain must point to NPMpro and port 80 must be reachable from the internet. The reachability check in the dialog tests this (it uses site24x7.com).
- **DNS challenge:** works without open ports and for wildcard certificates. Choose your DNS provider and a saved DNS credential. Credentials are saved once on the **DNS credentials** tab of the Certificates page (**Add DNS credential**) and reused by several certificates. Most providers have a form with one field per value; the others take the content of the provider's credentials file in **Credentials (INI)**. Secrets are never shown again: when you edit a credential, leave a secret empty to keep the saved value. A credential still used by certificates cannot be deleted or switched to another provider, and **Change DNS credential** on a certificate picks another one. They are stored encrypted with `/data/npmpro/dns-credentials.key`, which also encrypts the OIDC client secret, the MaxMind license key and the key behind the unique visitor hashes. Keep this file with your backups: without it saved DNS credentials, the client secret and the license key have to be entered again.
- **Custom certificates:** upload a certificate and key (keys protected with a passphrase are not supported). A custom certificate can be replaced later.

Certificates renew automatically; the renewal check interval, key type and size, ACME profile and OCSP options are in Settings, Certificates & TLS. The ACME server, account email and EAB keys are variables only (`ACME_SERVER`, `ACME_EMAIL`, `ACME_EAB_KID`, `ACME_EAB_HMAC_KEY`).

## Access lists

Access lists combine basic auth users and allow/deny rules for IP addresses or ranges. A host or location can use several access lists; they are evaluated top-down in the order shown in the UI, and "Satisfy Any" and "Pass Auth to Upstream" only apply when set on the first one. See [Access Lists](https://github.com/TheBlackBush/NPMpro#access-lists).

When you save an access list:

- each username can be used only once ("Authorization Usernames must be unique")
- a rule for `all` can only be the last rule, because nginx stops at the first matching rule and an earlier `allow all` would open the whole list ("An "all" Access Rule can only be the last rule")
- rule rows without an address are left out

With CrowdSec enabled, banned IPs get the ban page before the access list asks for a password, see [CrowdSec](CrowdSec#access-lists-and-forward-authentication).

## Settings

Settings (administrators) has these pages: Default Site, Authentication, Certificates & TLS, Network, nginx, Forward authentication, Logs & monitoring, GeoIP, Advanced, Backup and restore, Database and Environment. On phones and tablets the side menu is a select at the top of the page.

- **A variable in `compose.yaml` wins** over the saved value and locks the field. The badge names it, for example "Set by TRUST_IP", or explains an indirect lock ("Follows ACME_KEY_SIZE": `ACME_KEY_SIZE` set alone is an ECDSA curve, so the key type stays ECDSA, and an RSA size needs `ACME_KEY_TYPE=rsa` too; "Required by GOA"). Authentication, traffic statistics and GeoIP fields show "Set by environment". Remove the variable and recreate the container to manage the field in the UI again.
- **Each field says when it applies:** to the next certificate, when you save (with an nginx reload), or immediately. If the nginx test fails on save, nothing is saved and the error is shown.
- **"Restart required" fields** (Time zone in Advanced, GoAccess report and GoAccess options in Logs & monitoring) are read when the container starts. After saving, the section lists them under "Restart the container to apply" until you run `docker restart npmpro`.
- **Environment** is read-only: the startup variables (ports, bindings, users, nginx and TLS switches, modules and PHP, database and first start, the ACME account) with their value or default, and the list of settings that a variable locks. Passwords, email addresses and keys are only shown as "set" or "not set". To change one, edit `compose.yaml` and recreate the container.

- **Default Site** sets what nginx answers for a domain that no host uses: **Congratulations Page**, **404 Page**, **No Response (444)**, **Redirect** or **Custom HTML**. A new choice is tested with nginx before it is saved; if the test fails, nothing is saved, the previous default site stays in place, and the nginx error is in `docker logs npmpro`.
- **nginx** holds the nginx settings for all hosts. **Workers:** **Worker processes** (**Automatic (one per CPU thread)**, or a number), **Connections per worker** and **Worker shutdown timeout**. **Logging:** **Log file not found errors**. **TLS for all hosts:** **Allow TLS 1.2**, **Post-quantum key exchange only** (which turns TLS 1.2 and the NIST P curves off while it is on), **Allow the NIST P curves** and **Allow RSA PKCS#1 signatures**; turning TLS 1.2 or the P curves off shuts out older browsers and clients. **Modules:** njs, LDAP authentication, NTLM upstreams and virtual host traffic status. Saving tests the config and reloads nginx; if the test fails nothing is applied and the form shows the nginx message (for example when you turn off a module that a custom config still uses). Each field has its `NGINX_*` variable, which wins and locks the field as described above.
- **Backup and restore** and **Database** are described on their own pages: [Backup and restore](Backup-and-restore) and [Database](Database).

The full table of fields, variables and when they apply is in the README: [Settings and environment variables](https://github.com/TheBlackBush/NPMpro#settings-and-environment-variables).

## Monitoring

The Monitoring page (administrators) has a Traffic tab and a CrowdSec tab:

- **Traffic** needs Traffic statistics turned on in Settings, Logs & monitoring (or `TRAFFIC_STATS=true`; Write log files and GoAccess do not turn it on). NPMpro then counts requests, bytes and status classes per host from the access log, plus countries and networks when GeoIP databases exist. Visitor IPs and unique visitors are separate opt-in settings. Switching it off stops counting and keeps the stored statistics until they age out; tick "Also delete the stored statistics" in the dialog on saving to delete them at once.
- While traffic statistics are off and the CrowdSec bouncer is not configured, the Monitoring menu entry and the dashboard row are hidden, and `/monitoring` shows "Monitoring is off" with a link to the settings.
- **CrowdSec** shows the active bans once the CrowdSec bouncer is configured. The setup is described in [CrowdSec](CrowdSec).
- **GeoIP:** enter a free MaxMind account ID and license key in Settings, GeoIP; NPMpro downloads the GeoLite2 databases itself and updates them every 3 days.

Details and the privacy notes: [Monitoring](https://github.com/TheBlackBush/NPMpro#monitoring) and [Hints for Your Privacy Policy](https://github.com/TheBlackBush/NPMpro#hints-for-your-privacy-policy).

## GoAccess

Turn on GoAccess report in Settings, Logs & monitoring and restart the container. The report opens under `/goaccess` of the web UI, for signed-in administrators. Its options (days kept, IP anonymization, query strings, operating system versions, host name lookups) are fields in the same block. See [GoAccess](https://github.com/TheBlackBush/NPMpro#goaccess).

## OIDC sign-in

Settings, Authentication sets up sign-in with an OIDC provider: issuer URL, client ID, client secret and redirect domain, then register the shown callback URL at your provider and enable it. Users can be created on their first sign-in, limited to allowed email domains, and password sign-in can be turned off. See [OIDC login](https://github.com/TheBlackBush/NPMpro#oidc-login).

## Users and permissions

Under Users an administrator creates users, sets or resets their password, resets their MFA, revokes their sessions and sets their permissions: for each section (proxy hosts, redirection hosts, 404 hosts, streams, access lists, certificates) "Manage", "View Only" or "Hidden", and whether they see all items or only the ones they created. Administrators can also sign in as another user.

## Audit Logs

Audit Logs lists who created, updated, enabled, disabled or deleted which object, with filters for the user, the object type and the action. Each entry opens with its details. Backups, restores, scheduled backup runs (succeeded or failed) and database moves are listed too.

## Languages

The web UI is available in 24 languages: English, Azərbaycanca, Български, Čeština, Deutsch, Español, Eesti, Français, Gaeilge, Magyar, Bahasa Indonesia, Italiano, 日本語, 한국어, Nederlands, Norsk, Polski, Português (Europeu), Русский, Slovenčina, Türkçe, Українська, Tiếng Việt and 中文. A Persian translation exists too, but it cannot be chosen yet because the UI does not support right-to-left layout.

Choose the language with the flag button in the header, or on the login and setup pages. The choice is stored in your browser (not in your account), and the page reloads in the new language. English is used until you choose another one.

To fix or complete a translation, edit the files in [`frontend/translations`](https://github.com/TheBlackBush/NPMpro/tree/develop/frontend/translations) and open a pull request:

- `ui/<code>.json` holds the UI texts, with `ui/en.json` as the reference. Every language must have every key of `en.json`: the checks of a pull request fail when a key is missing or unknown.
- `help/<code>/*.md` holds the help texts that open from the forms. Every language needs every help file of `help/en` too.
- A new language also needs an entry in `lang-list.json` (its native name and flag). The [translations README](https://github.com/TheBlackBush/NPMpro/blob/develop/frontend/translations/README.md) has the details and the scripts that sort the files and list missing keys.

## Password and MFA reset

If you are locked out (only with the default SQLite database, not after a [database move](Database)):

```bash
docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]
```

The new password is read from stdin; leave it empty to keep the current one. `--disable-mfa` turns off two-factor authentication and deletes the backup codes of the user.

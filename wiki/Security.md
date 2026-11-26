# Security

How NPMpro is hardened and the security options you can add. CrowdSec (with AppSec, bot detection and rate limit bans) has its own page: [CrowdSec](CrowdSec).

## Hardening in NPMpro

- hardened TLS by default: patched nginx built with aws-lc compiled from source, enforced cipher and curve order, certificate compression (zlib-ng and brotli), optional encrypted client hello (see [Encrypted Client Hello (ECH)](Security#encrypted-client-hello-ech))
- security headers always sent, fingerprinting headers stripped, based on the OWASP secure headers project
- several access lists per host and per location, see [Usage](Usage#access-lists)
- a hardened web UI: https, strict CSP, an httpOnly cookie instead of local storage, rate limits and more
- opt-in logging: no log files on disk unless you turn them on
- CrowdSec support, including AppSec (WAF) and bot detection: [CrowdSec](CrowdSec)
- forward authentication in front of your services: [Forward authentication](Forward-Authentication)
- API tokens for scripts: stored only as a SHA-256 hash, each permission capped at the owner's, failed attempts rate limited, see [API tokens and MCP](API-tokens-and-MCP)
- the API reference at `/api-reference` is a page of the web interface with its CSP (only NPMpro's own scripts, styles
  and fonts); a token pasted there for Try it stays in the page's memory and is never stored, see
  [API reference](API-tokens-and-MCP#api-reference)
- HTTP/3: expose the https port over udp too (443/udp)
- HSTS: add your domain to the [HSTS preload list](https://hstspreload.org) if you enabled HSTS for it
- users who are not administrators cannot set raw nginx config, a request variable ($) or a unix socket (unix:) as a forward target, serve files from outside /var/www, or use a regular expression (a name starting with ~) as a domain name; values an administrator stored stay and can be kept
- a sign-in for an unknown or passwordless account takes as long as a wrong password, so the answer time does not tell which email addresses exist

## Bot detection and rate limiting

Both are described on the CrowdSec page: [Bot detection](CrowdSec#bot-detection-optional) and [Rate limiting](CrowdSec#rate-limiting-optional).

## Verify an image

Every published image (`ghcr.io/theblackbush/npmpro` and `blackbush/npmpro`, every tag) is signed by the GitHub
workflow that built it, without a key (Sigstore). To check one:

    cosign verify ghcr.io/theblackbush/npmpro:latest \
      --certificate-identity-regexp '^https://github.com/TheBlackBush/NPMpro/' \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com

## SBOM

Every image carries a list of its packages (SPDX) and its build provenance. To see them:

    docker buildx imagetools inspect ghcr.io/theblackbush/npmpro:latest --format '{{ json .SBOM }}'

Scanners such as Trivy, Grype or Docker Scout read it from the registry.

## Encrypted Client Hello (ECH)

- NPMpro supports generating and automatically rotating Encrypted Client Hello (ECH) keys. To enable and configure ECH, you need to set up a cron script that triggers the key generation and updates your DNS records.
- When the container starts, it automatically creates an empty file at `/opt/npmpro/tls/ech/cron.sh`. You need to fill this file with a script to handle your ECH keys.
- If this file is not empty, NPMpro will automatically execute it regularly, enable ECH in the nginx configuration, and reload nginx after execution.
- Inside your `cron.sh`, use the built-in `ech.sh` command to generate your keys. The syntax is: `ech.sh <public-name> <identifier> [max-name-length (default 64)]`.
- This command generates the keys in `/opt/npmpro/tls/ech/` (saving the current and previous keys) and outputs the Base64-encoded ECH config list to standard output, which you can capture to update your DNS records.
- Because ECH requires advertising your public key via an HTTPS DNS record, your `cron.sh` must push the newly generated config to your DNS provider. 
- There is an example cron.sh script for Cloudflare in the repository: [`ech-cron-cloudflare-example.sh`](https://github.com/TheBlackBush/NPMpro/blob/develop/ech-cron-cloudflare-example.sh). You can adapt this script, add your API tokens, define your zones/records, and place its contents into `/opt/npmpro/tls/ech/cron.sh`.
- By default, the container will run your `cron.sh` script and reload nginx on container start and then every hour after container start. You can change this interval with ECH key rotation interval in Settings, Certificates & TLS (or `ECH_ROTATION_INTERVAL`).
- It is recommended to use your servers hostname/PTR record as public name, make sure a (dead) host with a valid cert for your public name exists. The "identifier" is only used as part of the filename.
- It is recommended to only use one ECH key shared for all your hosts. If you configure multiple ECH keys then only the one with the alphabetically first "identifier" will be used in the retry_configs response.
- Do not set HTTPS records for FQDNs which use a CNAME record, but set them for the CNAME target, as only the HTTPS record of the CNAME target will be used by chromium.
- Deleting/clearing the cron.sh will disable ECH, but you still need to remove ECH from the HTTPS records yourself

## Geoblocking

An example, supported mainly by the community.

1. get the GeoLite2 databases: either enter your MaxMind credentials under Settings, GeoIP (see [Monitoring](Monitoring)), or deploy the legacy geoipupdate container (see the compose.yaml for an example, create credentials [here](https://www.maxmind.com/en/geolite2/signup))
2. open and edit this file: `/opt/npmpro/custom_nginx/http_top.conf`, if you changed /opt/npmpro to a different path make sure to change the path to fit, the database is only reread when nginx reloads
```yaml
geoip_country /data/goaccess/geoip/GeoLite2-Country.mmdb;

# whitelist example, you can add as many country codes as you want, country code list: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#XY
#map $geoip_country_code $geoip2_country_rule {
#  default no;
#  AA yes;
#  XY yes;
#  '' yes; # if you want to allow IPs with unknown country codes, if you don't do this make sure to allow private IPs
#}

# blacklist example, you can add as many country codes as you want, country code list: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2#XY
#map $geoip_country_code $geoip2_country_rule {
#  default yes;
#  AA no;
#  XY no;
#  '' no; # if you want to block IPs with unknown country codes, if you do this make sure to allow private IPs
#}

# uncomment if you block/don't allow IPs with unknown country codes
#geo $is_private_ip {
#  default no;
#  127.0.0.0/8 yes;
#  10.0.0.0/8 yes;
#  172.16.0.0/12 yes;
#  192.168.0.0/16 yes;
#  169.254.0.0/16 yes;
#  ::1/128 yes;
#  fc00::/7 yes;
#  fec0::/10 yes;
#}
```  
3a. to set it per location: press the gear button (on the tab itself, not the tab selection) on the details tab (or on the custom location you want to use), set your proxy settings and paste the following in the new text field at the bottom, you may want to adjust the last lines (do not use the advanced tab with this example as it may break cert renewals):
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#} 
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3b. to set it for an entire host: put this in the advanced tab:
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3c. to set it for all http hosts of them same type: put this in the `custom_nginx/server_proxy.conf` / `custom_nginx/server_redirect.conf` / `custom_nginx/server_dead.conf` file(s):
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
3d. to set it for all http hosts: put this in the `custom_nginx/server_http.conf` file:
```yaml
# uncomment if you block/don't allow IPs with unknown country codes
#if ($is_private_ip = yes) { 
#  set $geoip2_country_rule yes; 
#}
if ($request_uri ~* "^/\.well-known/acme-challenge/") {
    set $geoip2_country_rule yes;
}
if ($geoip2_country_rule = no) { 
  return 444; # this rejects the connection, but you can also return 403 to tell the client that it was denied
} 
```
4. you can create multiple rule lists by adding multiple map directive, but you need to use a unique name instead of `$geoip2_country_rule` for each rule list (you need the unique name also in the custom locations)

## ACME servers

An ACME directory URL entered in Settings must be `https://` and may not point at this host, link-local addresses (cloud metadata), multicast or reserved ranges; private LAN addresses are allowed, so a CA such as step-ca on your network works. The backend checks it on every read it makes of that directory (a Connect, the profile list, a registration), and the start does not read it: the start's profile check reads only an `ACME_SERVER` variable or the default CA. An `ACME_SERVER` variable is trusted as it is. Certbot's own connections to the CA are not checked; only administrators can choose a CA. Replace account (a button next to Change on the ACME account card) can deactivate the old account at the CA; after that it can no longer revoke, and NPMpro revokes with each certificate's own key. Replace account needs a signed-in administrator (API tokens are refused). Administrators add other CAs under Other CAs; anyone who may manage certificates chooses among the CAs set up, and the API refuses a certificate request or a re-issue at any other CA, for administrators too.

## DNS provider APIs

Calls to DNS provider APIs (zone lists and dynamic DNS) go through the outbound check: no request reaches this host, link-local or reserved addresses, and no redirect is followed. They must be `https://`; the one exception is a PowerDNS API on a private LAN address, which may use `http://` (the address is checked again when the connection opens, so a name cannot switch to another address in between). Error messages from providers are cut and every secret of the credential is replaced by `***`.

The dynamic DNS updater's address services (`DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES`) must be `https://` and go through the same outbound check, so they cannot reach this host, link-local addresses (cloud metadata), multicast or reserved ranges. Private LAN addresses are allowed, as for the other admin-set URLs; a service on your network can tell an address, but only a public unicast address it answers is ever used. An answer counts only when it is one public address, and a new address is written only when a second service confirms it: one service alone, or two that disagree, change nothing. Provider tokens never appear in the status, the history or the log.

The Custom HTTP dynamic DNS provider calls a URL an administrator sets, so only administrators can add, see or change such a record. The URL (often with a token in it) is stored encrypted and never shown again, written to the log, the history, an error or the audit log, or put in a backup without secrets. It must be `https://`, placeholders are allowed only in the path and the query, and it goes through the same outbound check as the other provider calls, at save and at every call. The account details of the Namecheap, No-IP and Dynu presets are stored encrypted in the same way; the user name and the password are never shown again (the Namecheap domain is shown).

A credential's endpoint is not an admin-only setting: any user who may manage certificates can set it, so a PowerDNS endpoint can point at a LAN address over `http://`. Choosing the credential in Add domains then sends one GET request there. The limits stay the same: the outbound check, no redirect, and from an answer other than 200 only a short message with the secrets removed. This is no more than certbot itself can already reach with such a credential, since its PowerDNS challenge contacts the same endpoint.

The DNS checks only read. The credential Test, the host check and the CAA check ask a provider for a zone page or a record, look up names in DNS and read the CA's ACME directory; they write nothing and store only states, addresses and scrubbed messages (in memory for the host check and the CAA check). The provider calls go through the outbound check and the secrets of the credential are removed from every message, as above. The challenge cleanup is the one place that deletes at a provider: only TXT records at `_acme-challenge` names that you ticked and confirmed, each read again just before its delete (a record that changed is skipped), never while a certificate request or renewal runs, and with the certificate locks held. The audit log gets the names and the count, not the values. CNAME delegations are never touched. These actions need the Certificates manage permission (the credential Test, the host check's provider read and the cleanup) and use the saved credential, so its secrets are never shown again.

The host record option (see [DNS records for a host](DNS#dns-records-for-a-host)) is off by default and writes at a provider only for a name you ticked, with a credential you can see and the Certificates manage permission. It never overwrites a record it did not create: a name that holds another value is only changed after you press **Adopt and update**. It deletes only what NPMpro created, and only the exact address it wrote; a record that holds another value by then stays. Its reach test sends one request to the public address this instance found (never to a typed or resolved address) with the host name as Host header, for a one-time file in the challenge folder that is removed afterwards, and only a public address is used. A save never waits for the provider, and the provider calls go through the outbound check as above.

## Outbound mail

The mail server is an outbound connection, so it goes through the same check as the other admin-set addresses: no loopback, link-local, multicast or reserved address, and private LAN addresses are allowed. The connection goes to the address that was checked, and every address of the name must pass. A login (user and password) is never sent in plain text to an address outside your private LAN: with **Security** set to **None**, NPMpro refuses it. See [Notifications](Notifications#how-the-mail-server-is-reached).

The mail password is encrypted in the database. It is never returned by the API or shown in the UI (the form shows only that one is set), and it goes into a backup only with secrets, where the whole file is encrypted. Saving the mail server settings needs a signed-in session, so an API token cannot change where mail goes.

## Notes on Cloudflare
- Using cloudflare proxy/tunnel before NPMpro (so between the users and NPMpro `users <=> cloudflare <=> NPMpro`) is strongly discouraged
- Why?
  - cloudflare acts like a "man in the middle" (if you want you can also call it a "wanted man-in-the-middle attack"), this means all traffic going from your users to you/from you to your users will be decrypted by cloudflare before being encrypted again and being forwarded to you/your users, if you want this is your decision (security, privacy, etc.)
  - many optimizations done by NPMpro will because of this only be used between cloudflare and NPMpro, so your users won't notice them
  - cloudflare overrides many things done/configured by NPMpro (like headers (including HSTS), HTTP/3 (QUIC), TLS settings and more), so you might need to configure them again in Cloudflare, but this is not always possible
  - cloudflare has a limit of 100MB per connection, so uploading/downloading big files may cause problems, if no chunking is used
  - because all data does not take direct way between your users and you, the connection time will increase
  - cloudflare only forwards/protects http(s) traffic on port 80/443 to you, services running on other ports/different protocols are not forwarded/protected (STUN/TURN/SSH)
  - cloudflare can't protect you if the attacker knows your real ip, as cloudflare only rewrites your dns entries to itself and then acts as a reverse proxy, direct ip connectings to you are not protected (use a firewall like ufw, make sure to allow 80/tcp and 443/tcp+udp for NPMpro, if possible don't open SSH and NPMpro GUI to the internet, but secure them behind a VPN like Wireguard)
  - if you need a WAF => use [crowdsec](CrowdSec)
  - if you want to use the "I'm under attack mode" to protect you from (ai) web scrapes => use [anubis](Forward-Authentication#anubis)
- What are reason for cloudflare?
  - The points above don't matter you (enough) and:
    - you depend on a not mentioned and unreplaceable feature of cloudflare
    - or you are under (a) DDoS-attack(s), which you can't handle yourself and the attacker does not know your real ip/does not use it to attack you, but instead your domain: you could use cloudflare as dns nameserver for your domain with the proxy disabled and only enable it if you are under an attack (only work if the attacker did not cache your real ip)
    - or you want to hide your IP and only expose http(s) services, but then: don't use NPMpro at all, install cloudflared and use cloudflare tunnels and point it directly to your upstreams, this way you can still manage everything in a GUI and you don't even need to expose any ports
- If you still want to use cloudflare proxy make sure to set `your domain => SSL/TLS => SSL/TLS encryption => Current encryption mode => Configure` to "Full (strict)"
- With Trust Cloudflare on, Cloudflare's `X-Forwarded-Proto` counts: with Flexible SSL the visitor's https reaches the upstream as https and Force HTTPS stops looping, but the link from Cloudflare to NPMpro is still plain http; prefer Full (strict).
- If you use cloudflare proxy and your local dns server resolves your domains directly to NPMpro (split dns/dns rewrites), make sure it also overrides or blocks (empty answer) their HTTPS (type 65) records, otherwise browsers may use the ECH config of cloudflare (public name `cloudflare-ech.com`) and the connection to NPMpro will fail, since NPMpro does not have the ECH keys of cloudflare
- Just using cloudflare as a dns nameserver provider for your domain is fine
- If you use cloudflare to forward mails to your inbox, note that cloudflare also acts as man-in-the-middle in this case

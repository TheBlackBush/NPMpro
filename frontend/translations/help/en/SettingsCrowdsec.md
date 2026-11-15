## CrowdSec

Connects the CrowdSec bouncer built into NPMpro to your CrowdSec container. Every request to your hosts is checked against the decisions of the CrowdSec Local API (LAPI) and, with an AppSec URL, against the AppSec rules. Saving applies the settings at once with an nginx reload; the container does not restart.

NPMpro writes `/data/crowdsec/crowdsec.conf` from these settings. Changes to that file by hand are overwritten. The ban and captcha pages are chosen in **Settings**, **Landing pages**, where a custom page can also be pasted or uploaded.

A variable set on the container wins over the UI and locks the field: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Status and Test connection

Shows whether nginx loads the bouncer and when NPMpro last reached the LAPI. **Test connection** checks the values in the form: one decisions request to the LAPI with the key (or the TLS client certificate), and with an AppSec URL one request to AppSec. A key field left empty uses the saved key.

Saving while the bouncer is on runs the same test first. When it fails, the reasons are shown and **Save anyway** saves all the same, for example when CrowdSec is not running yet.

**Save anyway** is not offered when AppSec fails, **When AppSec cannot be reached** is **Deny the request** and **Admin UI and CrowdSec** is **Checked like every host**, because that save would lock you out of the admin UI: fix the **API key** or the **AppSec URL**, set the failure action to **Let the request through**, or choose **Bans only** or **Left out** for **Admin UI and CrowdSec**.

### Connection

- **Enable the bouncer**: checks every request.
- **LAPI URL**: for example `http://127.0.0.1:8080`.
- **API key**: from `docker exec crowdsec cscli bouncers add npmpro`. Stored encrypted, never shown again. **Remove the saved key** deletes it.
- **TLS client certificate**: instead of the key, a certificate and key file under `/data/crowdsec/`; needs an `https://` LAPI URL. Once an AppSec URL is set, the **API key** field is shown and required with a TLS client certificate too, because AppSec authenticates with the API key; without it AppSec refuses every request.
- **Verify TLS certificates**: checks the certificate of an https LAPI or AppSec URL.

### Blocking

- **Mode**: live asks the LAPI per client IP and caches the answer for the given seconds; stream downloads all decisions at the given interval.
- **Answer to a ban**: the ban page (with an optional status code, 403 by default), a redirect, or a status code without a page.
- **Fallback remediation** and **Decision types**: how decisions the bouncer cannot apply are handled, and which types are enforced.
- **Admin UI and CrowdSec**: **Checked like every host** applies bans and AppSec to the admin UI. **Bans only** applies bans and captchas but no AppSec, and CrowdSec being down does not lock you out. **Left out** checks nothing. Locked out by a ban or captcha decision? See **Locked out?** below.

### Captcha

The provider (reCAPTCHA, hCaptcha, Cloudflare Turnstile), its site key and secret key, and how long a solved captcha stays valid. Used for decisions of type captcha.

### AppSec

- **AppSec URL**: for example `http://127.0.0.1:7422`; empty turns AppSec off.
- **When AppSec cannot be reached**: deny blocks every checked request while AppSec is down, let through leaves them unchecked.

### Advanced

The LAPI request timeout, scenario filters, excluded paths, internal requests, and the AppSec timeouts and options.

### Locked out?

A ban or captcha decision for your IP: run `cscli decisions delete --ip <your IP>` in the CrowdSec container. A decision from a blocklist (the community blocklist or a list from the CrowdSec console) comes back with the next pull, so also add your IP to an allowlist (CrowdSec 1.6.6 or newer): `cscli allowlists create npmpro-admins -d "admin IPs"`, then `cscli allowlists add npmpro-admins <your IP>`.

CrowdSec is down: start it again. No access to CrowdSec: set `CROWDSEC_ENABLED=false` on the container and recreate it, choose **Left out** for **Admin UI and CrowdSec** here (or remove the decision), fix the settings, then remove the variable and recreate the container again.

More in the wiki: CrowdSec.

# Landing pages

Landing pages are the pages NPMpro shows instead of a site: when nothing is set up for an address, a page is not found, the server behind a host does not answer, an access list turns a visitor away, a host is in maintenance, a certificate is missing, or CrowdSec blocks or checks a visitor. All of them share one look (an alert card with the NPMpro logo), follow the visitor's browser language (13 languages, English as the fallback) and switch between light and dark with the visitor's system setting.

## The pages

| Page | Status | When |
|---|---|---|
| Default page | 200 | A request for an address no host is set up for |
| Page not found | 404 | A 404 host, and a proxy host that chooses it for its 404 |
| Upstream error | 502, 503, 504 | The server behind a proxy host does not answer or answers with one of these errors |
| Maintenance | 503 | A proxy host in maintenance mode |
| Certificate problem | 495 | Plain HTTP to a host that forces HTTPS while its certificate files are missing |
| Denied | 401, 403 | An access list turns a visitor away |
| CrowdSec ban | set in CrowdSec | A banned visitor |
| CrowdSec captcha | 200 | A visitor CrowdSec wants to check with a captcha |

## Settings, Landing pages

Settings, Landing pages (administrators) shows a short note and three cards. Every line has a dropdown and a **Preview** button, which opens the saved page in a new tab with sample values (save first to preview a change).

- **Default site:** the answer to a request that matches no host. Options: **Congratulations Page** (the default), **404 Page**, **No Response (444)**, **Redirect** (to an address you enter) and **Custom HTML** (your own page, with an optional status code). A new choice is tested with nginx before it is saved.
- **Errors:** **Page not found** (404), **Upstream error** (502, 503, 504), **Maintenance** (503) and **Certificate problem** (495).
- **Access and security:** **Denied** (401, 403), **CrowdSec ban** and **CrowdSec captcha**.

Each line in Errors and in Access and security offers the NPMpro page (named after the page: **Not found page**, **Site unavailable page**, **Maintenance page**, **Secure connection page**, **Access denied page**, **Access blocked page**, **Captcha page**) or **Custom page**.

A host's own choice wins over these. A choice of **Global setting** in a host follows this page: changing a global page changes every host that uses it.

### Custom pages

A custom page is one HTML file, at most 1 MB, UTF-8, with its styles and images inside it (use data URLs for images). Paste it into the field or use **Upload .html**. Preview shows the saved page, not the text in the field.

A custom page can show a few values of the request with nginx's server side includes. Everything else in a `<!--# ... -->` command is refused when you save:

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Error <!--# echo var="status" --></h1>
  <p>Host: <!--# echo var="host" --></p>
  <p>Your IP: <!--# echo var="remote_addr" --></p>
  <p><!--# config timefmt="%Y-%m-%d %H:%M UTC" --><!--# echo var="date_gmt" --></p>
</body>
</html>
```

The variables are `remote_addr`, `date_gmt`, `date_local`, `status` and `host`. `config timefmt` accepts the usual date letters (`%Y %m %d %H %M %S %Z %A %b`).

## Per host

- **Proxy host, Pages tab** (between TLS and Advanced):
  - **Maintenance mode** switch: every visitor of this host gets the maintenance page (503) instead of the site. The admin UI and other hosts are not affected. Let's Encrypt's checks still work.
  - **Page not found**: **Global setting**, **Not found page**, **Custom page**, or **The site's own page** (the default: the site's own 404 stays).
  - **Upstream error**: **Global setting** (the default), **Site unavailable page**, **Custom page**, or **The upstream's own error**.
  - **Maintenance**: **Global setting**, **Maintenance page** or **Custom page**, for the page of maintenance mode.
- **404 host, Page:** **Global setting**, **Not found page** or **Custom page**.
- **Access list, Denied page:** **Global setting**, **Access denied page**, **Custom page** or **nginx's plain page**. It applies to every host and location the list is used on, and never on a host with forward authentication (the forward authentication provider answers there).
- Redirection hosts and streams have no pages.

### What the upstream error page replaces

With the upstream error page on (the default), nginx replaces the upstream's own 502, 503 and 504 answers with the page. An app that sends its own body with these codes (a maintenance page, JSON errors of an API) loses it: choose **The upstream's own error** for that host or location. An upstream's own 401 and 403 always pass through, and its own 404 does unless the host chooses a 404 page.

On a host or location with an access list (and so the denied page), the upstream's own 404 and 5xx answers pass through unchanged (nginx's own 502 and 504, when the upstream cannot be reached, still show the page). The denied page there also shows for other 403 answers of that host.

### Hosts with their own error handling

A host whose Advanced field has an `error_page` at server level keeps its own error handling and gets no landing page lines. A custom location whose own Advanced text has an `error_page` keeps it too. An existing `proxy_intercept_errors` is not repeated.

### Maintenance mode, 404 hosts and CrowdSec

Maintenance mode and 404 hosts answer before the CrowdSec bouncer does, so a banned visitor sees the maintenance or the 404 page there. Other hosts show the ban page.

## The certificate problem page

A host with **Force HTTPS** whose certificate files are missing used to fail the nginx test. Now it stays online and plain HTTP shows the certificate problem page. HTTPS requests to that host still fail in the TLS handshake, because there is no certificate to answer with, so no page can be shown there.

nginx sends this page with HTTP status 400 (the page itself shows 495). A custom certificate page that prints `status` shows 400.

## CrowdSec

Settings, CrowdSec decides how a ban is answered: a page, a redirect, or a status code (see [CrowdSec](CrowdSec)). Settings, Landing pages decides what the ban and captcha pages look like. The old files `/data/crowdsec/ban.html` and `captcha.html` are no longer read.

A custom captcha page needs the three placeholders of the bouncer and its form (it is sent when the visitor solves the captcha), otherwise a visitor cannot solve the captcha. The form must have the id `captcha-form`. A minimal example:

```html
<!DOCTYPE html>
<html>
<head>
  <script src="{{captcha_frontend_js}}" async defer></script>
</head>
<body>
  <h1>Please confirm you are human</h1>
  <form id="captcha-form" action="" method="POST">
    <div class="{{captcha_frontend_key}}" data-sitekey="{{captcha_site_key}}" data-callback="captchaCallback"></div>
  </form>
  <script>
    function captchaCallback() { document.getElementById("captcha-form").submit(); }
  </script>
</body>
</html>
```

`{{captcha_site_key}}`, `{{captcha_frontend_js}}` and `{{captcha_frontend_key}}` are filled in by the bouncer.

## Where the files are

NPMpro writes the pages as files under `/data/public/pages/` from the database whenever you save. Do not edit them: they are overwritten. They are not part of a backup (the settings and hosts hold the choices and custom pages); see [Backup and restore](Backup-and-restore).

### MySQL and MariaDB

The custom pages of Settings, Landing pages are stored in one database row. Several large custom pages can exceed a low `max_allowed_packet` of the database server, and the save is then refused. Raise `max_allowed_packet`, or keep the custom pages small.

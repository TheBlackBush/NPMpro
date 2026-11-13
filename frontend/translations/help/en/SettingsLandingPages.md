## Landing pages

The pages visitors see instead of a site: when nothing is set up for an address, a page is not found, the server behind a host does not answer, an access list turns them away, a host is in maintenance, a certificate is missing, or CrowdSec blocks or checks them. Every page comes in the visitor's browser language and in light and dark.

### Default page

What an address without a host shows: **Congratulations Page**, **404 Page**, **No Response (444)**, **Redirect** (to an address you enter) or **Custom HTML** (your own page).

### Global pages

For each page: its NPMpro page (for example **Not found page** or **Access denied page**) or a **Custom page**. A custom page is one HTML file (at most 1 MB, UTF-8) with its styles and images inside; paste it or use **Upload .html**. It can show the visitor's IP, the time, the status code and the host name with `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` and `host`; other server-side includes are refused.

Proxy hosts, 404 hosts and access lists use these pages unless they choose their own (the **Pages** tab of a proxy host, the **Page** field of a 404 host, the **Denied page** of an access list).

**Preview** opens the saved page in a new tab with sample values.

### CrowdSec

Settings, CrowdSec decides whether a ban shows a page, redirects or only answers with a status code; this section decides what the ban and captcha pages look like.

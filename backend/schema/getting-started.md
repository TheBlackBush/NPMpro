The NPMpro API is the one the NPMpro web interface uses: whatever the interface does, a script can do with the same
rules. Requests and answers are JSON. Every address starts with `/api` on the admin port, for example
`https://npm.example.com:81/api`.

## Getting started

1. **Create an API token.** Open the user menu (your picture, top right), choose **API tokens**, then **New token**,
   and pick its expiry and permissions. The token is shown once: copy it then. It looks like
   `npmpro_3f9c2a7d1b4e8f60_...`.
2. **Send it** in the `Authorization` header of every request, never in the address:

   ```sh
   curl -H "Authorization: Bearer $NPMPRO_TOKEN" https://npm.example.com:81/api/nginx/proxy-hosts
   ```

   The admin port often has a self-signed certificate: give curl that certificate with `--cacert`. Python's
   `requests` needs `verify="/path/to/ca.pem"`, and Node needs `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. The
   certificate must name the address you call. Switching the check off (`verify=False`,
   `NODE_TLS_REJECT_UNAUTHORIZED=0`) is for a quick test only. The Node example uses top-level `await`: save it as
   an `.mjs` file.
3. **Try it on this page.** Every route has a **Try it** button that runs the request on this instance as you,
   signed in. To run it as a token instead, choose **Use a token** at the top of the page and paste the token; the
   page keeps it only until you reload, and never stores it.

## What a token may do

- A token never has more than its owner: each permission is the lower of the token's and the owner's current one,
  checked on every request.
- **Administrator** (tokens of administrators only): the token acts as an administrator for settings, backups, the
  database, monitoring and the audit log. Keep such a token like the administrator's password.
- **Allow delete**: without it, every `DELETE` request and every restore that replaces parts of a backup is refused
  with 403.
- Some routes need a signed-in session and refuse every token with 403: your own account (password, MFA, sessions,
  picture, OIDC link, name and email), API tokens, user management, changes to the sign-in settings (OIDC and forward
  authentication), the session refresh and the admin port checks. In this reference their Needs line says so.
- A token stops working when it is revoked or expires, or when its owner is disabled or deleted: the answer is 401.
- When a request carries a token, the token acts and a session cookie sent with it is ignored. Only a bearer that
  starts with `npmpro_` is a token: any other `Authorization: Bearer` header is ignored.

## Examples

Create a proxy host:

```sh
curl -X POST https://npm.example.com:81/api/nginx/proxy-hosts \
  -H "Authorization: Bearer $NPMPRO_TOKEN" -H "Content-Type: application/json" \
  -d '{"domain_names":["app.example.com"],"forward_scheme":"http","forward_host":"192.168.1.20","forward_port":8080}'
```

Disable the proxy host with id 12:

```sh
curl -X POST -H "Authorization: Bearer $NPMPRO_TOKEN" https://npm.example.com:81/api/nginx/proxy-hosts/12/disable
```

Read the newest 20 audit log entries (a token with the Administrator switch):

```sh
curl -H "Authorization: Bearer $NPMPRO_TOKEN" "https://npm.example.com:81/api/audit-log?limit=20"
```

## MCP for AI assistants

AI assistants such as Claude use NPMpro through the MCP endpoint `POST /api/mcp` (Streamable HTTP, JSON answers). It
takes an API token as a bearer, never a session cookie, and offers a token only the tools its permissions allow: read
tools need view, write tools need manage, delete tools need manage and Allow delete, and the monitoring and audit log
tools need the Administrator switch. Settings, API access shows the address, client configurations and every tool.
For Claude Code:

```sh
claude mcp add --transport http npmpro https://npm.example.com:81/api/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

## Limits and errors

- Five failed sign-ins or failed token attempts from one address (an IPv6 /48) in five minutes block that address
  for the rest of the five minutes; the user routes count every refused request the same way, except a request
  refused because it carries an API token. Certificate downloads allow 10 in 10 minutes and the OIDC routes 10 in 5
  minutes. A blocked request gets 429 with `RateLimit` and `RateLimit-Policy` headers.
- A JSON body may have up to 100 kB, and a file upload up to 1 MB (an OIDC icon up to 256 KiB); a JSON body may have
  up to 16 MB where custom page HTML travels (proxy hosts, 404 hosts, access lists, Settings, Landing pages), a
  backup upload up to 2 GiB and an import file up to 200 MB. A larger JSON body gets 413.
- A request with an `Origin` header must come from the admin address itself: pages of other sites are refused with
  403 (that answer has a `message` but no `code`).
- Errors have one shape. `message` is English; `message_i18n` is the key the web interface translates; some errors
  add `output` (the nginx or certbot output) or `checks`:

  ```json
  { "error": { "code": 403, "message": "Permission Denied" } }
  ```

| Status | Meaning                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------- |
| 400    | The request does not match this reference, or a value is refused; `message` says which                |
| 401    | No valid session or token, or the token is revoked or expired, or its owner is disabled               |
| 403    | Not allowed: a permission, a session-only route, a delete without Allow delete, or a foreign `Origin` |
| 404    | The item does not exist or is not visible to you                                                      |
| 413    | The request body is larger than its limit (see above)                                                 |
| 429    | Too many requests (see above)                                                                         |
| 500    | An internal error; the container log has the details                                                  |

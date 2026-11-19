# API tokens and MCP

Scripts and AI assistants use the NPMpro API with an API token instead of a password. A token belongs to one user and
works whether password login is off, OIDC is the only sign-in, or the user has MFA.

## Rules

- A token never has more than its owner. Each permission is the lower of the token's and the owner's current one, on
  every request: lowering a user's permissions lowers their tokens at once.
- A token stops working when it is revoked, when it expires, or when its owner is disabled or deleted. A password
  change, an MFA change or "Sign out everywhere" does not end tokens: revoke them for that.
- An administrator's token acts as an administrator only when its Administrator switch is on. The switch opens the admin
  areas such as settings, the audit log, backups and monitoring, but never user management.
- The Administrator switch gives the token an administrator's control of the instance (settings, raw nginx config,
  backups, the database), except users and the sign-in settings: keep such a token like the administrator's password.
- The sign-in settings need a signed-in session: no token can save the OIDC settings (including password login on or
  off), test them or change the OIDC button icon, and no token can save the forward authentication settings. A token
  is also refused by the nginx checks of the admin pages (`/api/auth`, `/api/auth/admin`), and cannot restore or merge
  the OIDC or runtime settings of a backup.
- No token manages users, whatever its switches: creating, listing, editing, disabling and deleting users, their
  permissions and their tokens need a signed-in session. A token can read only its own user (`GET /api/users/me`, or
  its own id). A token also cannot restore or merge the Users part of a backup.
- A token cannot create, list or revoke tokens, and cannot change its owner's password, MFA, sessions, picture,
  OIDC link, name or email.
- The token is shown once when it is created. NPMpro stores only a hash of it.
- Tokens are never in backups. Restoring the Users part of a backup deletes the API tokens of every user except the
  administrator who runs the restore, even users who come back with the same name and email: they create new tokens.
  The deleted tokens are in the audit log (revoked, reason restore). Restoring other parts and merging keep every
  token.
- Creating, revoking and expiring a token and its first use are in the audit log, and every change a token makes
  shows the token's name next to the user.

## Creating a token

Open the user menu (your avatar, top right) and choose **API tokens**. The window lists your tokens with their
permissions, expiry, last use and creation date. To make one:

1. Choose **New token**.
2. **Name**: up to 100 characters, to tell the token apart from your others.
3. **Expiry**: **30 days**, **90 days** (the default), **365 days**, **On a date** (then **Expiry date**, tomorrow or
   later) or **No expiry**.
4. **Item Visibility**: **Created Items Only** or **All Items**. **All Items** is offered only when your own
   visibility is all items.
5. **Permissions**: for each of proxy hosts, redirection hosts, 404 hosts, streams, access lists and certificates,
   **Manage**, **View Only** or **Hidden**. A level above your own cannot be chosen. Choosing a section turns on what
   it needs, such as access lists for proxy hosts, when your own permissions allow it: the caps above still apply.
6. **Administrator** (only for administrators): the token acts as an administrator for settings, the audit log,
   backups and monitoring, but never for users or the sign-in settings. It is off by default; keep such a token like
   your password.
7. **Allow delete**: lets the token delete (delete requests, replace restores and the MCP delete tools). It is off by
   default.
8. **Create**. The token is shown once in a window with **Copy** and the note "This token is shown only once": copy
   it then and choose **Done**.

To end a token, choose **Revoke** on its row in the list and confirm. It stops working at once.

The window uses `POST /api/users/me/api-tokens` (described in the [API reference](#api-reference) below). The route
needs a signed-in session, so scripts do not create tokens: a token cannot create tokens.

## Administrators: Settings, API access

Administrators see every API token of every user in Settings, **API access** (under Administration). The table gives
each token's owner, permissions, expiry, last use and creation date, and **Revoke** stops any token at once, including
another user's. Users create their own tokens in the user menu; administrators cannot create or edit a token for
someone else. The section links to the API documentation.

## Using a token

    curl -H "Authorization: Bearer npmpro_..." https://npm.example.com:81/api/nginx/proxy-hosts

- Send the token in the `Authorization` header only, never in the address.
- When a request carries a token, the token acts: a session cookie sent with it is ignored. Only a bearer that starts
  with `npmpro_` is a token: any other `Authorization: Bearer` header (an auth proxy's own) is ignored, and the session
  cookie works as before.
- Without the token's Allow delete switch, every DELETE request with the token is refused, and so is a restore that
  replaces parts of a backup (a merge is allowed); turn it on for scripts and MCP clients that should delete.
- Five failed token attempts from one address in five minutes block that address for the rest of the five minutes.
- The API reference is at `/api-reference` on the admin port (signed in), see [API reference](#api-reference) below.
- Expiry: 30, 90 or 365 days, a date, or none (default 90 days).

## API reference

The API reference is at `https://<admin address>/api-reference` (signed in; `/api/docs` leads there too). It opens from
the API tokens window and from Settings, API access. The left column lists the groups and routes and has a search (press
`/`); the middle shows what a route does, what it needs (the Needs line), its parameters, request fields and answers;
the right shows the request as curl, Node or Python (one choice for the whole page), an example answer and **Try it**,
which runs the request on this instance as you. To run it as a token, choose **Use a token** at the top and paste it:
the page keeps it only until you reload. Every route has its own link, for example
`/api-reference#proxy-hosts/post-nginx-proxy-hosts`. The page follows the app's light or dark theme.

## MCP server

AI assistants can use NPMpro through the Model Context Protocol (MCP). The endpoint is
`https://<admin address>/api/mcp`, the address of the web UI with a path of its own. It is stateless and answers in
JSON. It offers 28 tools for hosts, access lists, certificates, monitoring and the audit log.

- **Token only:** the endpoint takes an API token as a bearer token (`Authorization: Bearer npmpro_...`). A session
  cookie does not work there, and OAuth is not supported yet.
- **Permissions:** a tool is listed only when the token may use it. View only gives the read tools. Write tools need
  **Manage** on the section they change. Delete tools need **Manage** and the token's **Allow delete** switch, and the
  tool refuses a call without it even when the client sends one.
- **Administrator:** the monitoring and audit log tools need a token with the **Administrator** switch on.
- **Not covered:** there are no tools for users, settings, backups or API tokens: those stay in the web UI. No tool
  returns secrets: access list passwords, certificate keys, DNS credential values and token hashes are never in a
  result.
- **Results are data:** every result is data from NPMpro, not instructions. A model with write tools can be steered by
  text in a host name or description, so check what it changes, and give a write token only to a client that needs it.
- **Limits:** a request body is limited to 100 kB, and a larger one is refused with HTTP 413. Send one JSON-RPC message
  per request: batches are refused for every protocol version (no known client sends them). The admin port may be
  reachable only in your network: an assistant on another machine must be able to reach it.

### Setup

Replace the address with your admin address and `YOUR_TOKEN` with a token from the user menu. The API access section of
Settings shows the same commands with your address.

```sh
claude mcp add --transport http npmpro https://npm.example.com:81/api/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

For clients that start a local command (a desktop app, for example), add this to the client's configuration:

```json
{
  "mcpServers": {
    "npmpro": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://npm.example.com:81/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer YOUR_TOKEN" }
    }
  }
}
```

The token goes in `env`, not in the arguments: a space inside an argument breaks on Windows.

**The client must trust the admin port's certificate.** Without a default certificate the admin port uses a self-signed
one, and Node clients such as Claude Code and `mcp-remote` refuse it with a TLS error. Do one of these:

- Set a real default certificate for the web UI: Settings, Certificates & TLS, Default certificate (`DEFAULT_CERT_ID`,
  see [Configuration](Configuration)). The address in the client must be a domain of that certificate.
- Reach the web UI through a proxy host that has a valid certificate, and use that address in the client.
- For a certificate of a private CA, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` in the client's environment (for the
  desktop configuration, in `env` next to `AUTH_HEADER`).

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`: it turns off every certificate check of that client, not only this one.

### Tools

| Tool | Needs | What it does |
| --- | --- | --- |
| `list_hosts` | View | Lists the hosts of one type (proxy, redirection, dead or stream) with their state |
| `get_host` | View | Returns one host of the given type, without its custom page HTML |
| `create_proxy_host`, `create_redirection_host`, `create_dead_host`, `create_stream` | Manage | Creates a host |
| `update_proxy_host`, `update_redirection_host`, `update_dead_host`, `update_stream` | Manage | Changes a host |
| `enable_host`, `disable_host` | Manage | Enables or disables a host of the given type |
| `delete_host` | Manage and Allow delete | Deletes a host of the given type for good |
| `list_access_lists`, `get_access_list` | View | Lists or returns access lists with their user names and rules |
| `create_access_list`, `update_access_list` | Manage | Creates or changes an access list |
| `delete_access_list` | Manage and Allow delete | Deletes an access list for good |
| `list_certificates`, `get_certificate` | View | Lists or returns certificates with provider, domains and expiry |
| `request_certificate` | Manage | Requests a Let's Encrypt certificate |
| `renew_certificate` | Manage | Renews a Let's Encrypt certificate now |
| `delete_certificate` | Manage and Allow delete | Deletes a certificate for good |
| `get_monitoring_summary` | Administrator | Returns the monitoring summary of the traffic and the hosts |
| `get_traffic` | Administrator | Returns the traffic statistics |
| `get_crowdsec_decisions` | Administrator | Returns the CrowdSec decisions and alerts |
| `list_audit_log` | Administrator | Lists audit log entries, newest first, without their details |
| `get_audit_entry` | Administrator | Returns one audit log entry with its details |

Host tools need the permission of the host's type (proxy hosts, redirection hosts, 404 hosts or streams), and the
access list and certificate tools need their own section. The token's expiry, revocation and owner rules apply to every
tool call.

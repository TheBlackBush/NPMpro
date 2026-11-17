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
  is also refused by the nginx checks of the admin pages (`/api/auth`, `/api/auth/admin`).
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

Create a token while signed in: `POST /api/users/me/api-tokens` with its name, permissions and expiry (the request is
described in the OpenAPI documentation at `/api/docs`). The answer carries the token once: copy it then.

## Using a token

    curl -H "Authorization: Bearer npmpro_..." https://npm.example.com:81/api/nginx/proxy-hosts

- Send the token in the `Authorization` header only, never in the address.
- When a request carries a token, the token acts: a session cookie sent with it is ignored. Only a bearer that starts
  with `npmpro_` is a token: any other `Authorization: Bearer` header (an auth proxy's own) is ignored, and the session
  cookie works as before.
- Without the token's Allow delete switch, every DELETE request with the token is refused, and so is a restore that
  replaces parts of a backup (a merge is allowed); turn it on for scripts and MCP clients that should delete.
- Five failed token attempts from one address in five minutes block that address for the rest of the five minutes.
- The OpenAPI documentation is at `/api/docs` on the admin port (signed in). Its Authorize button takes a token.
- Expiry: 30, 90 or 365 days, a date, or none (default 90 days).

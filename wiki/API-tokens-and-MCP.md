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
- No token manages users, whatever its switches: creating, listing, editing, disabling and deleting users, their
  permissions and their tokens need a signed-in session. A token can read only its own user (`GET /api/users/me`).
  A token also cannot restore or merge the Users part of a backup.
- A token cannot create, list or revoke tokens, and cannot change its owner's password, MFA, sessions, picture,
  OIDC link, name or email.
- The token is shown once when it is created. NPMpro stores only a hash of it.
- Tokens are never in backups. Restoring the Users part of a backup deletes the API tokens of every user except the
  administrator who runs the restore, even users who come back with the same name and email: they create new tokens.
  Restoring other parts and merging keep every token.
- Creating, revoking and expiring a token and its first use are in the audit log, and every change a token makes
  shows the token's name next to the user.

## Creating a token

(PR 1: through the API, `POST /api/users/me/api-tokens` with a signed-in session; PR 2 replaces this with the user menu steps.)

## Using a token

    curl -H "Authorization: Bearer npmpro_..." https://npm.example.com:81/api/nginx/proxy-hosts

- Send the token in the `Authorization` header only, never in the address.
- A request with both a session cookie and a token is refused (400).
- Five failed token attempts from one address in five minutes block that address for the rest of the five minutes.
- The OpenAPI documentation is at `/api/docs` on the admin port (signed in). Its Authorize button takes a token.
- Expiry: 30, 90 or 365 days, a date, or none (default 90 days).

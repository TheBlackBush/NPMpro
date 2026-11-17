## API access

Every API token of every user. Only administrators see this page.

Tokens are created by their owners in the user menu, under **API tokens**. Here you see each token with its owner, its permissions, when it expires, when it was last used and when it was created.

- **Revoke** stops a token at once. Scripts and AI assistants that use it get an authentication error from then on.
- A token never has more permissions than its owner. An administrator's token acts as an administrator only with its **Administrator** switch on, and no token manages users.
- Creating, revoking, expiry and the first use of a token are written to the audit log, with the token's name next to the user.

The API documentation opens in a new tab.

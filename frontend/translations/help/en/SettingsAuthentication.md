## Authentication

Sign-in to the NPMpro web UI with an OIDC provider (for example Authentik, Keycloak or Google), next to or instead of passwords. This is not forward authentication: it does not protect your proxy hosts. See Settings, Forward authentication for that.

A variable set on the container wins over the UI and locks the field (the field shows "Set by environment"). If the four connection variables are all set, OIDC is active without enabling it in the UI. Use the UI for anything not set in the container. Everything here applies when you save.

### Provider

- **Enable OIDC sign-in**: shows the sign-in button on the login page.
- **Issuer URL**: the provider's discovery base address, for example `https://accounts.example.com`. Variable: `OIDC_ISSUER_URL`.
- **Client ID** and **Client secret**: from your provider. The secret is stored encrypted and never shown again; leave it empty to keep it. If you change the issuer URL or client ID, enter the secret again. Variables: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Redirect domain**: the domain people use to open NPMpro, with the port if it is not 443. Required, because it builds the callback URL. Variable: `OIDC_REDIRECT_DOMAIN`.
- **Callback URL**: read-only. Register it as the redirect URI at your provider.
- **Scopes**: default `openid email profile`. Change it if your provider allows only some, for example `openid email`.
- **Test connection**: checks that NPMpro can reach the issuer.

### Login button

The button on the sign-in page: **Display name** (the text after "Sign in with"), **Colour** (a preset or your own `#rrggbb`) and **Icon** (built-in, uploaded as PNG, JPEG, WebP or SVG up to 256 KB, or downloaded from a URL). A preview is shown.

### Sign-in rules

- **Require a verified email**: refuses users whose provider has not verified their email. Default: on. Variable: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Skip two-factor after OIDC**: trusts the provider's own multi-factor check. Default: off. Variable: `OIDC_SKIP_MFA`.
- **Disable password login**: only OIDC can sign in. You can turn it on only from a session that signed in with OIDC. Variable: `OIDC_DISABLE_PASSWORD`; to restore password login set it to `false` and recreate the container.

### New users

- **Create users on their first sign-in** (default: off): a person with no account gets one with the permissions below.
- **Allowed email domains**: comma separated; empty allows any domain. With an empty list and a verified email not required, anyone your provider accepts gets an account.
- **Default permissions for new users**: set per section. New users are never administrators.

More in the wiki: Authentication.

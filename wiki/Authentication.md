# Authentication

Signing in to the NPMpro web UI: passwords, two-factor authentication and OIDC. To put a login in front of your own services, see [Forward authentication](Forward-Authentication).

## Passwords and two-factor authentication

Every user signs in with an email address and a password. Two-factor authentication (TOTP, with one-time backup codes) can be turned on for each account in the user menu. If you are locked out, the password and MFA can be reset from the command line (SQLite only): `docker exec -it npmpro password-reset.js USER_EMAIL [--disable-mfa]`, the new password is read from stdin. See [Usage](Usage#password-and-mfa-reset). The session cookie is signed with `COOKIE_SECRET`, see [Configuration](Configuration#cookie_secret).

## OIDC login

OIDC is set up under Settings, Authentication in the web UI (administrators only). Enter the issuer URL, client ID, client secret and redirect domain, register the shown callback URL at your provider, then enable it. The sign-in page then shows a button with the name, colour and icon you choose.
- Environment variables win: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_DOMAIN`, `OIDC_REQUIRE_VERIFIED_EMAIL`, `OIDC_SKIP_MFA` and `OIDC_DISABLE_PASSWORD` override the saved value of their field. The field is shown as "Set by environment" and cannot be changed in the UI. If the four connection variables are all set, OIDC is active without enabling it in the UI.
- Scopes default to `openid email profile`. A provider that only allows some scopes may need this changed (for example to `openid email`).
- Disable password login: only OIDC can then be used to sign in. This can only be turned on from a session that signed in with OIDC, and a session that signed in with a password also cannot save a change that would switch it on in effect (for example enabling OIDC while it is still set). A value set by `OIDC_DISABLE_PASSWORD` is not affected. To restore password login set `OIDC_DISABLE_PASSWORD=false` and recreate the container (`docker compose up -d`).
- Require a verified email (default on) refuses users whose provider has not verified their email address. Skip two-factor after OIDC (default off) trusts the multi-factor check of the provider.
- Create users on their first sign-in (default off): a person without an account gets one with the default permissions set on the page. Allowed email domains limit this (comma separated, empty allows any domain; they are dotted host names such as `example.com`, single-label and non-ASCII names are not accepted). Enabled users can always sign in. Warning: with an empty domain list and Require a verified email off, anyone your provider will authenticate gets an account, under any email address they can set at the provider. New users are never administrators, an access list cannot be hidden while proxy hosts are visible, and certificates cannot be hidden while any host type is visible.
- Button icon: choose a built-in icon, upload a file or download one from a URL. PNG, JPEG, WebP and SVG are accepted, up to 256 KB. SVG files that contain scripts, event handlers, embedded documents or references to other files (anything but `#` fragments and inline PNG, JPEG or WebP images) are refused.
- Sign-in errors are shown on the sign-in page by code: `not_configured`, `provider_error`, `no_email`, `email_not_verified`, `no_user` (no account and auto-create is off), `domain_not_allowed` (email domain not in the allowed list) and `user_disabled`.

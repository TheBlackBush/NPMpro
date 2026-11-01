## Certificates & TLS

Defaults for the certificates NPMpro requests from your ACME server (Let's Encrypt unless you set another with `ACME_SERVER`), how they are stapled and renewed, and which certificate answers for unknown hosts. This is the Settings section, not the Certificates list page.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by ACME_KEY_TYPE"). Some fields follow another: a lone `ACME_KEY_SIZE` that is an ECDSA curve keeps the key type on ECDSA, and Must-Staple keeps OCSP stapling on. Use the UI for anything not set in the container.

### Certificate requests

These apply from the next certificate request.

- **Key type**: `ECDSA` (default, recommended: smaller keys, faster handshakes) or `RSA` for clients that cannot use ECDSA. Variable: `ACME_KEY_TYPE`.
- **Key size**: the curve for ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; default `secp384r1`) or the bits for RSA (`2048`, `3072`, `4096`; default `4096`). Variable: `ACME_KEY_SIZE`.
- **ACME profile**: the profile requested from the server, checked with the server when you save. Empty uses the server default. With Let's Encrypt the default is `shortlived`; clients that need a Common Name do not work with `shortlived` and `tlsserver` certificates. Variable: `ACME_PROFILE` (`none` for empty).
- **OCSP Must-Staple**: marks new certificates as must-staple and keeps OCSP stapling on. Only for CAs that support it (ZeroSSL); Let's Encrypt refuses such requests. Default: on for Google Trust Services and ZeroSSL, otherwise off. Variable: `ACME_MUST_STAPLE`.
- **Verify the ACME server certificate**: default on. Turn it off only for a private ACME server with a self-signed certificate. Variable: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Both apply after the nginx reload that saving runs, and both turn TLS certificate compression off.

- **OCSP stapling for ACME certificates**: sends the OCSP response with certificates from the ACME server, when the CA offers OCSP. Default: on for Google Trust Services and ZeroSSL, otherwise off. Variable: `ACME_OCSP_STAPLING`.
- **OCSP stapling for custom certificates**: the same for uploaded certificates. Default: off. Variable: `CUSTOM_OCSP_STAPLING`.

### Default certificate

- **Certificate for unknown hosts and the web UI**: served for host names NPMpro has no host for and on the web UI port. Default: built-in, a generated placeholder. Variable: `DEFAULT_CERT_ID` (a certificate ID; `0` is built-in). Applies after the nginx reload that saving runs.

### Renewal

- **Renewal check interval**: 1 to 499 hours between checks. A certificate is renewed only when due. Default: 3. Variable: `CERTBOT_RUN_INTERVAL`. Applies at once.

### ECH

- **ECH key rotation interval**: 1 to 24 hours between runs of your ECH script (`/data/tls/ech/cron.sh`). Used only when the script is not empty. Default: 1. Variable: `ECH_ROTATION_INTERVAL`. Applies at once.

More in the wiki: Security.

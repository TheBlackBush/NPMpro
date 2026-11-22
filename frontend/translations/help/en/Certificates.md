## Certificates Help

### HTTP Certificate

A HTTP validated certificate means Certbot servers will
attempt to reach your domains over HTTP (not HTTPS!) and if successful, they
will issue your certificate.

For this method, you will have to have a _Proxy Host_ created for your domains(s) that
is accessible with HTTP and pointing to this Nginx installation. After a certificate
has been given, you can modify the _Proxy Host_ to also use this certificate for HTTPS
connections. However, the _Proxy Host_ will still need to be configured for HTTP access
in order for the certificate to renew.

This process _does not_ support wildcard domains.

### DNS Certificate

A DNS validated certificate requires you to use a DNS Provider plugin. This DNS
Provider will be used to create temporary records on your domain and then Certbot
will query those records to be sure you're the owner and if successful, they
will issue your certificate.

You do not need a _Proxy Host_ to be created prior to requesting this type of
certificate. Nor do you need to have your _Proxy Host_ configured for HTTP access.

This process _does_ support wildcard domains.

#### Saved DNS credentials

The credentials for your DNS Provider are saved separately from the certificate, on the
_DNS credentials_ tab of the Certificates page. A certificate then only picks one of the
saved credentials, so several certificates can share them.

Secrets are stored encrypted and are never shown again. When you edit a credential, leave
a secret empty to keep the saved value. The key used for the encryption is the file
`/data/npmpro/dns-credentials.key`, back it up together with the database, otherwise
the saved credentials cannot be read after a restore.

Providers without a form use the INI text box, where you paste the content of the
credentials file for that provider.

#### Domains

A credential lists the domains (DNS zones) it manages, such as `example.com`. The **Domains** tab of the Certificates page lists the domains of all your credentials.

The **Domain Names** field suggests the domains of your DNS credentials and the names hosts and certificates already use (the names of a stream come from its certificate). Typing any other name still works: `Add <name>` comes first, and Enter adds what you typed.

With the DNS challenge, the window suggests the DNS credential whose domains cover all the names and says why. You can change it at any time, and a credential you picked yourself is kept.

### Custom Certificate

Use this option to upload your own TLS Certificate, as provided by your own
Certificate Authority.

### Certificate authority

A certificate requested from an ACME server is issued by the CA chosen in its window: the instance CA (marked "default") or another CA an administrator added in Settings, Certificates & TLS, under **Other CAs**. The list shows each certificate's CA in the **CA** column. **Re-issue** in the certificate's menu requests it again from another CA under the same name; if that fails, the current certificate stays. **Edit** on an ACME certificate changes its domain names: the certificate is requested again under the same entry, the window warns about names hosts still use, and a failure changes nothing.

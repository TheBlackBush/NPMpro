## Notifications

NPMpro sends mail through an SMTP server you choose. Mail is used for the test mail now and for password reset and alerts later. The settings here can also come from container variables: a variable set on the container wins over the UI and locks its field (the field shows "Set by environment"). Use the UI for anything not set in the container.

### Mail server

Every connection is checked like other outbound requests: the server name must resolve, and local and link-local addresses are refused. Mail is considered set up when the host and the sender address are filled in.

- **Host** and **Port**: the SMTP server. Variables: `SMTP_HOST`, `SMTP_PORT` (default 587).
- **Security**: **STARTTLS** upgrades a plain connection (usually port 587), **TLS** is encrypted from the start (usually port 465), **None** sends without encryption. Variable: `SMTP_SECURITY` (`starttls`, `tls` or `none`).
- **Verify certificate**: refuse a server whose certificate is not valid. Variable: `SMTP_VERIFY_TLS` (`false` turns it off).
- **User** and **Password**: the login. The password is stored encrypted and never shown again; **Remove** deletes it, and if the saved one cannot be decrypted, type it again. Variables: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Sender name** and **Sender address**: how mail from NPMpro appears. Variables: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Reply-to**: where replies go; empty uses the sender address. Variable: `SMTP_REPLY_TO`.

With Security **None** and a user, the password would travel unencrypted, so it is only allowed for a server on your local network.

**Send test mail** sends a mail with the saved settings to the address you type (yours by default) and shows the server's answer if it fails. Save first: the button is disabled while the form has unsaved changes, and hidden until mail is set up.

### Links and language

- **Public URL**: the address people open NPMpro at, used for the links in mails, for example `https://npm.example.com`. HTTPS only, no path. **Use this browser's address** fills it with the address of this page when it is opened over HTTPS. Variable: `PUBLIC_URL`.
- **Default mail language**: the language of mails for people who have not chosen one. Each user's own interface language is remembered and used for their mails. Variable: `MAIL_LANGUAGE`.

More in the wiki: Configuration.

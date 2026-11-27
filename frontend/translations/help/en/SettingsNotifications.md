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

### Mail alerts

Shown once a mail server is set up. Mails about problems NPMpro detects, and when they are resolved; a problem that stays open is repeated.

- **Send to administrators**: every enabled administrator with a valid address gets the alerts.
- **Also send to**: more addresses, at most 20, for example a team list. A refused address is marked on its chip. Variable: `ALERT_ADDRESSES` (comma separated).
- **Events**: tick the problems you want mail about, grouped by area. Ticking one also covers its recovery.
- **Remind every (hours)**: how long a problem stays quiet before it is mailed again; 0 never repeats it, at most 168.

**Send a sample** sends an example alert at once to everyone who would get alerts, with the saved settings. Save first: the button is disabled while the form has unsaved changes. If a send fails, the message names the address.

### Links and language

- **Public URL**: the address people open NPMpro at, used for the links in mails, for example `https://npm.example.com`. HTTPS only, no path. **Use this browser's address** fills it with the address of this page when it is opened over HTTPS. Variable: `PUBLIC_URL`.
- **Default mail language**: the language of mails for people who have not chosen one. Each user's own interface language is remembered and used for their mails. Variable: `MAIL_LANGUAGE`.

### Invitations and account notices

Both need a mail server. Invitations also need the **Public URL**.

- **Invitations**: when you add a user, you can send an invitation instead of setting a password. The user gets a mail with a link to choose a password; the link works once and for 72 hours. **Send invitation again** in the user list sends a new link.
- **Account notices**: users get a mail when their password or address changes, when two-factor sign-in is turned off or when new backup codes are made.

### Webhooks

A webhook is an address of your own that NPMpro calls with a signed HTTP request when something happens, for example when a certificate was renewed. Only administrators see this card.

- **URL**: `https://` to any public host, or `http://` to an address on your local network. Redirects are not followed. The address is stored encrypted and never shown again; leave the field empty when you edit to keep it.
- **Events**: choose the events to send, or **All events**.
- **Signing secret**: shown once after you save. Store it where your receiver reads it. **Rotate secret** makes a new one; the old one keeps signing for 24 hours so your receiver can switch.
- **Send test**: sends one test event at once and shows the status and the time it took. It is not listed under Deliveries.
- **Deliveries**: the newest events of the webhook with their status, attempts and the receiver's answer. **Redeliver** sends a failed one again, for 7 days after it failed.
- A failed request is tried again up to 8 times over about 41 hours. A webhook is turned off when the receiver answers 410 Gone, or when it fails again after 3 days of failures without a success. A turned off webhook shows the reason; turn it on to use it again.
- Verify every request with any Standard Webhooks library, using the raw body and the `webhook-id` as the idempotency key.

More in the wiki: Configuration.

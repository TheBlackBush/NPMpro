# Notifications

NPMpro can send mail through your own SMTP server. Under Settings, Notifications you set the mail server, the public address of your instance and the language of the mails. Send a test mail to check the setup. The events NPMpro detects are listed under [Monitoring](Monitoring#events).

Only administrators see this page. Every setting here can also be set with an environment variable, see [Configuration](Configuration) (a set variable locks its field).

## Mail server

The card **Mail server** holds the server NPMpro sends through:

- **Host**: the name or address of the SMTP server.
- **Port**: 587 by default, any port from 1 to 65535.
- **Security**: **STARTTLS** (the default, usually port 587) starts with a plain connection and upgrades it to encrypted. **TLS** is encrypted from the start (usually port 465). **None** sends without encryption.
- **Verify certificate**: on by default. NPMpro refuses a server whose certificate is not valid. Turn it off only for a server you trust on your own network.
- **User** and **Password**: the login, when the server needs one. Leave both empty when it does not. The password is saved encrypted and is never shown again. Type a new one to change it, or choose **Remove**.
- **Sender name** and **Sender address**: who the mails come from. The sender address is one plain address, such as `npmpro@example.com`.
- **Reply-to**: where replies go. Empty means the sender address.

With **Security** set to **None**, a user name is only allowed when the host is on your private LAN. The login would otherwise travel in plain text, so NPMpro refuses the save and the send.

### Send test mail

The button **Send test mail** sits in the card header. It sends at once, to your own address by default, or to any other address you type. It uses the saved settings, so save first (the button says so while the form has unsaved changes). The test mail is not queued and is not retried.

- At most 5 test mails per minute from one IP address.
- When the mail cannot be sent, the window shows the server's error. The password is removed from it.

## How the mail server is reached

NPMpro checks the mail server like any other outbound request:

- The host name is looked up, and every address it has is checked. If one of them is refused, nothing is sent.
- Refused: loopback (`127.0.0.0/8`, `::1`), link-local addresses (`169.254.0.0/16`, `fe80::/10`, which include the cloud metadata address), and the unspecified, multicast and reserved ranges.
- Allowed: private LAN addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `fc00::/7`). A mail server on your network works.
- A host name that does not resolve is refused, with a message that says so.
- The connection goes to the address that was checked. The host name is still used for the certificate check, so **Verify certificate** checks the name you typed.
- The check runs on every save that changes the host, port, security or user, and before every send.

A mail that fails for a temporary reason (a 4xx reply from the server or a network error) is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours. A 5xx reply (for example a refused sender), a failed login or a certificate problem fails at once.

## Public URL and language

The card **Links and language** holds two settings, and your own language is taken from the interface:

- **Public URL**: the address people open NPMpro at, for example `https://npm.example.com`. It must start with `https://` and be the origin only: no path, no query, no `#` part and no user name. **Use this browser's address** fills in the address of the page you have open. The button works only when the page is opened over HTTPS; otherwise it is disabled and says so.
- **Default mail language**: the language of the mails for people who have not signed in yet or have not chosen a language. Choose one of the 13 languages of the interface.
- Each user's language is the interface language they use. NPMpro remembers it at sign-in (and again after a language change), and that user's mails come in it. Other people get the default mail language.

The host of the public URL names your instance in the mails (the test mail says "This is a test mail from NPMpro at ..."). Without a public URL, the host name of the container is used.

## What a mail contains

Every mail has a plain text part and a simple HTML part with the same text. It has no images, loads no remote content and has no tracking, so nothing in it reports back when it is opened.

## Who can change it

Saving the mail server settings needs a signed-in session. An [API token](API-tokens-and-MCP) is refused, because a token could otherwise send mail through a server you choose. The same goes for restoring the Notifications part of a backup, see [Backup and restore](Backup-and-restore#good-to-know). The password is sealed, never returned and only part of a backup made with secrets. See [Security](Security#outbound-mail).

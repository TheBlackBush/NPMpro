# Notifications

NPMpro can send mail through your own SMTP server. Under Settings, Notifications you set the mail server, the public address of your instance, the language of the mails and which problems are mailed to you (see [Mail alerts](#mail-alerts)). Send a test mail to check the setup. The events NPMpro detects are listed under [Monitoring](Monitoring#events).

Only administrators see this page. Every setting here can also be set with an environment variable, see [Configuration](Configuration) (a set variable locks its field). A value that is not valid, from a restored backup or an environment variable, is named in a red box at the top of the page; mail may not be sent until it is corrected. A `PUBLIC_URL` is used as its origin (`https://NPM.example.com/` becomes `https://npm.example.com`).

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
- When the mail cannot be sent, the window says why: a certificate that is not trusted (turn **Verify certificate** off only for a server you trust on your local network), a **Security** that does not fit the port (port 465 usually needs TLS, port 587 STARTTLS), a refused connection, a refused login or the server's own reply. The password is removed from it.

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
- Each user who picks a language with the language switch of the interface gets their mails in it. NPMpro remembers the choice right after the switch, and again at sign-in in that browser. People who never picked one (also those who use the interface in English without choosing it) get the default mail language.

The host of the public URL names your instance in the mails (the test mail says "This is a test mail from NPMpro at ..."). Without a public URL, the host name of the container is used.

## Mail alerts

The card **Mail alerts** shows once mail is set up. It mails the problems of the [events](Monitoring#events) you tick, and their recovery.

- **Send to administrators** (on by default): every enabled administrator with a valid address gets the alerts. A disabled administrator gets none.
- **Also send to**: more addresses, for example a team list. Up to 20 plain addresses. `ALERT_ADDRESSES` sets the list and locks the field (see [Configuration](Configuration)).
- **Events**: the problems the mail channel offers, grouped by area: certificates that are about to expire or could not be renewed, hosts whose nginx configuration is refused, failed backups, a GeoIP update or a CrowdSec connection that fails, dynamic DNS records that fail or are stopped, and a webhook turned off after repeated failures. Ticking an event also sends its recovery. Action events (a host created, a backup succeeded and the like) are never mailed; they go to webhooks only.
- **Remind every** (hours, default 24): while a problem stays open, its alert is repeated after this many hours. `0` never repeats it; the maximum is 168.
- **Send a sample**: sends a sample alert, marked **Sample**, at once to every current recipient. Nothing is wrong in it; it only shows what an alert looks like. The button shares the limit of 5 test mails a minute and runs one sample at a time. A server error stops the sample: the message at the top of the page says how many addresses got it and which one failed, and the rest are not tried.

How the alert mails go out:

- Each recipient gets one mail. Alerts that come within about a minute are grouped into it, so a single mail can say "3 problems, 1 resolved": the subject counts them and the body lists each one, problems first, with the error text where there is one.
- A reminder says since when the problem is open, and a recovery says when it was resolved.
- Recipients are chosen when the alert happens and checked again before the mail is sent. An administrator who was disabled, or an address that was removed from the list, gets nothing after that. The same check drops a queued alert whose event was unticked in the meantime, and every queued alert once mail is no longer set up: no mail goes out and nothing is written to the audit log.
- Each recipient gets the mail in their own language: an administrator in the language they chose (see [Public URL and language](#public-url-and-language)), an address from the list in the default mail language.
- A group that fails is tried again as a whole, on the schedule described in [How the mail server is reached](#how-the-mail-server-is-reached).
- Ticking an event sends nothing about the problems that are already open when you tick it. Their recovery and reminders follow the normal rules from then on.
- Each mail ends with the reason you get it: you are an administrator of NPMpro, or your address is listed for alerts. With a public URL set, the mail has an **Open NPMpro** button.

## Account mails

Besides the events of [Monitoring](Monitoring#events), NPMpro sends two mails about a user's own account, to that user:

- **Reset link**: "Reset your NPMpro password", sent when someone asks for a password reset and the reset is on (see [Authentication](Authentication#password-reset-by-mail)). The button opens the link, which works once and for 30 minutes. The mail is sent at once, is not queued and is not retried.
- **Reset notice**: "Your NPMpro password was reset", sent after every reset made with the link (a command line reset sends none). It gives the time (UTC), the address the request came from and how many API tokens are still active. Every session was signed out; two-factor sign-in is unchanged. Revoke the tokens under Settings, API access if you did not make the reset.

Account mails go to the address of the account and in the user's language (see [Public URL and language](#public-url-and-language)). A user who is disabled or has no password gets no reset mail.

## What a mail contains

Every mail has a plain text part and an HTML part with the same text. The HTML part has the NPMpro look (the logo, in light and dark mode). The logo is embedded in the mail, so nothing is loaded from the internet and nothing reports back when a mail is opened; there is no tracking.

## Who can change it

Saving the mail server settings needs a signed-in session. An [API token](API-tokens-and-MCP) is refused, because a token could otherwise send mail through a server you choose. The public URL and the default mail language also need a signed-in session, because the public URL is the address in password reset links. A token can still read both cards. The same goes for restoring the Notifications part of a backup, see [Backup and restore](Backup-and-restore#good-to-know). The password is sealed, never returned and only part of a backup made with secrets. See [Security](Security#outbound-mail).

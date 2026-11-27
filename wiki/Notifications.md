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
- **Events**: the problems the mail channel offers, grouped by area: certificates that are about to expire or could not be renewed, hosts whose nginx configuration is refused, failed backups, a GeoIP update or a CrowdSec connection that fails, dynamic DNS records that fail or are stopped, and a webhook that NPMpro turned off. Ticking an event also sends its recovery. Action events (a host created, a backup succeeded and the like) are never mailed; they go to webhooks only.
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

## Webhooks

A webhook is an address of your own that NPMpro calls with a signed HTTP request when something happens: a certificate was renewed, a host was created, a backup failed. Use it to copy a renewed certificate to another machine, to post to a chat or to start a script. You add webhooks under Settings, Notifications, in the card **Webhooks**. The requests follow the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) signature scheme, so any of its libraries verifies them.

Only administrators see the card. Creating and editing a webhook, and rotating its secret, need a signed-in session; see [Who can change webhooks](#who-can-change-webhooks).

### Adding a webhook

- **Name**: a name that is not used by another webhook (upper and lower case do not count).
- **URL**: where the requests go. `https://` to any public host. `http://` only to an address on your private LAN (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), because plain HTTP over the internet would show the event to everyone on the way. No user name or password in the URL (the signature is the credential), at most 2048 characters. Redirects are never followed: an answer 3xx counts as a failure, so enter the final address.
- **Events**: tick the events to send, or **All events**, which also covers the events that later versions add. The `.resolved` recovery of a problem event is its own entry, so a webhook can choose to get only the problems.
- **Verify TLS**: on by default. Turn it off only for a receiver with a self-signed certificate on your own network.
- **Enabled**.

The URL is checked when you save it (see [Security](Security#webhooks)), and again before every request. After saving, the **signing secret** is shown once, with a copy button. It starts with `whsec_`. NPMpro keeps it encrypted and cannot show it again: store it where your receiver reads it. If you lose it, rotate it.

**Send test** sends an event of the type `notification.test` at once and shows the status code and how long it took, or the error. A test is not queued and not retried, it is not recorded in the deliveries, and it does not touch the webhook's state (it can neither turn a webhook off nor count as a failure or a success). At most 5 tests per minute from one IP address, one at a time per webhook. It works also for a webhook that is turned off. **All events** never includes `notification.test`: only the button sends it.

### What is sent

A request is a `POST` with a JSON body of at most 20 KB:

```json
{
  "type": "certificate.renewed",
  "timestamp": "2026-11-27T04:00:12.345Z",
  "data": { "id": 12, "nice_name": "example.com", "domain_names": ["example.com"], "provider": "letsencrypt", "expires_on": "2027-02-25T04:00:10.000Z" }
}
```

- `type`: the event, with dots (below).
- `timestamp`: when the event happened (ISO 8601, UTC), not when it was delivered.
- `data`: the fields of the event. A field without a value is left out. Texts are cut to 300 characters, and any secret in an error text is replaced by `***`.
- When an event is larger than 20 KB, its longest list is cut until it fits and `data.truncated` is `true`.

The request has five headers:

| Header | Content |
|---|---|
| `content-type` | `application/json` |
| `user-agent` | `NPMpro-Webhooks/<version>` |
| `webhook-id` | The id of the message, for example `msg_k3j5vq2x7bnw4ztd6hy2mfa7ce`. The same on every retry and redelivery of the event. Use it as the idempotency key. |
| `webhook-timestamp` | When this attempt was made, in whole seconds since 1970. New on every retry. |
| `webhook-signature` | `v1,` and the base64 HMAC-SHA256 signature. While a rotated secret is still valid, there are two, separated by a space. |

#### Events

Problem events are sent when a problem starts, and each has a `.resolved` event with the same data when the problem is over. They are the events of [Monitoring](Monitoring#events).

| Event | Data |
|---|---|
| `certificate.expiring`, `certificate.renewal_failed` (and `.resolved`) | `id`, `nice_name`, `domain_names`, `provider`, `expires_on`; `state` and `days_left` for `expiring`; `error` for `renewal_failed` |
| `host.config_error` (and `.resolved`) | `type` (`proxy`, `redirection`, `dead` or `stream`), `id`, `domain_names` (a stream has `incoming_port` instead), `enabled`, `error` |
| `backup.failed` (and `.resolved`) | `schedule` (`id`, `name`), `error` |
| `geoip.failed`, `crowdsec.unreachable` (and `.resolved`) | `error` |
| `ddns.record_failed`, `ddns.record_stopped` (and `.resolved`) | `record` (`id`, `name`, `provider`), `error` |

Action events happen once, when something was done:

| Event | Data |
|---|---|
| `host.created`, `host.updated`, `host.deleted`, `host.enabled`, `host.disabled` | `type`, `id`, `domain_names` (a stream has `incoming_port`), `enabled`, `user` (`id`, `name`) |
| `certificate.issued`, `certificate.renewed`, `certificate.deleted` | `id`, `nice_name`, `domain_names`, `provider`, `expires_on` |
| `backup.succeeded` | `schedule` (`id`, `name`), `file`, `size` |
| `backup.restored` | `types` |
| `database.moved`, `database.move_failed` | `from`, `to`, `error` |
| `webhook.disabled` | `webhook` (`id`, `name`), `reason` (`gone` or `failing`) |
| `notification.test` | `version` (only sent by **Send test**) |

### Verifying a request

Always verify the signature before you act on a request, and verify the raw body, the exact bytes NPMpro sent: a body that was parsed and written again no longer matches. Libraries for many languages are listed at [standard-webhooks](https://github.com/standard-webhooks/standard-webhooks). Rules to follow in your receiver:

- Use the `webhook-id` as the idempotency key: a retry or a redelivery has the same id, so a receiver that saw it already answers 2xx and does nothing.
- Allow 5 minutes of clock difference. That is the default of the libraries, not a rule of the specification, so a receiver whose clock is off by more refuses every request.
- Answer with a 2xx status as soon as the request is stored, and do the work afterwards. NPMpro waits at most 15 seconds.
- Do not rely on the order. Events can arrive out of order (a retry of an older event can come after a newer one), so use the `timestamp` of the event when order matters.

Node.js (`npm install standardwebhooks`), here with Express. The route reads the body as it is:

```js
import express from "express";
import { Webhook } from "standardwebhooks";

const wh = new Webhook(process.env.WEBHOOK_SECRET); // the whsec_ text, as shown once
const app = express();

app.post("/hook", express.raw({ type: "application/json" }), (req, res) => {
	let event;
	try {
		event = wh.verify(req.body.toString("utf8"), req.headers);
	} catch {
		return res.sendStatus(400);
	}
	// event.type, event.timestamp, event.data; remember req.headers["webhook-id"] against repeats
	res.sendStatus(204);
});

app.listen(8080);
```

Python (`pip install standardwebhooks`), here with Flask:

```python
import os
from flask import Flask, request
from standardwebhooks import Webhook
from standardwebhooks.webhooks import WebhookVerificationError

wh = Webhook(os.environ["WEBHOOK_SECRET"])  # the whsec_ text, as shown once
app = Flask(__name__)

@app.post("/hook")
def hook():
    try:
        event = wh.verify(request.get_data(), dict(request.headers))
    except WebhookVerificationError:
        return "", 400
    # event["type"], event["timestamp"], event["data"]; remember request.headers["webhook-id"]
    return "", 204
```

To check without a library: the signature is `base64(HMAC-SHA256(key, id + "." + timestamp + "." + body))`, where `key` is the bytes you get by decoding the base64 part after `whsec_`, and the header holds `v1,` and that value. With the secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, the id `msg_p5jXN8AQM9LWM0D4loKWxJek`, the timestamp `1614265330` and the body `{"test": 2432232314}`, the signature is `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=` (a test vector of the libraries).

### Copy a renewed certificate

To keep a certificate on another machine up to date, make a webhook for `certificate.renewed`, and let the receiver fetch the files with an [API token](API-tokens-and-MCP). The token needs view permission on certificates. The event holds the certificate `id`:

```sh
curl -H "Authorization: Bearer npmpro_..." -o cert.zip \
  https://npm.example.com:81/api/nginx/certificates/<id>/download
unzip -o cert.zip fullchain.pem privkey.pem
```

The zip holds `fullchain.pem` and `privkey.pem` and every download is written to the audit log. The event itself never holds a key or a certificate.

### Retries

A request succeeds when the receiver answers 2xx. Anything else is a failure and is tried again, up to 8 attempts in all: the first one at once, then after about 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 24 hours, each with up to 10 % added at random. That is a bit over 41 hours in all. This is NPMpro's own schedule, shorter than the example in the Standard Webhooks specification. After the last attempt the delivery is marked failed.

- A request that gets no answer within 15 seconds counts as a failure. A connection error does too.
- A redirect (3xx) is a failure and is not followed.
- An answer with a `Retry-After` header (a number of seconds or an HTTP date) delays the next attempt at least that long, at most 24 hours. Any other value is ignored.
- **410 Gone** means the receiver is gone for good: the webhook is turned off at once, and its waiting deliveries are dropped.
- A webhook that keeps failing is turned off. NPMpro notes when the failures started (the first failure after a success). The next failure that comes after 3 days without any success turns the webhook off. Plainly: a webhook whose last event failed days ago and has had no success since is turned off by the next failure, even a single one; it is not turned off by the passing of time alone.
- A webhook that is turned off sends nothing and its waiting deliveries are dropped. It is shown with its reason (answered 410 Gone, failing for 3 days, restored without its URL). Turn it on in its window; that clears the reason and the failing period.
- A receiver that is down costs one attempt per pass: when a request gets no answer (a timeout, a connection error, a refused address), or the answer is 5xx, 408 or 429, the webhook's other waiting events wait for that retry too (with a `Retry-After`, until that time). Any other error answer, such as 400, 404 or 422, counts for that one event only: the other events are still sent, and the refused one is retried on its own schedule. At the next try the events that were not tried yet go first. One pass spends at most one minute on one webhook, and a slower receiver gets the rest in the next pass.
- A delivery fails at once, without a retry, when the stored address or secret cannot be opened (for example after the encryption key changed). Save the webhook again with its URL, or rotate the secret.

When a webhook is turned off by 410 or by repeated failure, NPMpro raises the event `webhook.disabled` and mails the alert if you ticked it under [Mail alerts](#mail-alerts).

### Deliveries and redelivery

**Deliveries** on a webhook lists its newest first: the event, when it was made, the state (waiting, sending, delivered, failed, dropped), the number of attempts, the status code, the time it took, the error and the first 2 KB of the answer. The address and the secret are removed from the error and the answer, and so is the part of the path that the hint does not show. NPMpro keeps the newest 100 rows of a webhook for at most 30 days.

**Redeliver** sends a failed delivery again at once, with the same `webhook-id` (and a new `webhook-timestamp`). It is offered only for a failed delivery whose content is still kept, which is for 7 days after the failure, and only while the webhook is turned on. A delivered row keeps no content. The content is never shown in the list.

### Changing the secret

**Rotate secret** makes a new secret and shows it once. For the next 24 hours NPMpro signs every request with both, so the header holds two signatures (`v1,<new> v1,<old>`) and either secret verifies it. Switch your receiver to the new secret within that time, then the old one stops working. Rotating again within 24 hours keeps only the secret that was in use just before.

### Who can change webhooks

The card is for administrators. Creating a webhook, editing it and rotating its secret need a signed-in session: an [API token](API-tokens-and-MCP) is refused, because a token could otherwise point a webhook at a server of its own and read the events and the secret. An administrator's token can list the webhooks, see their deliveries, send a test, redeliver and delete (delete needs the token's Allow delete switch). Restoring the Webhooks part of a backup needs a session too, see [Backup and restore](Backup-and-restore#good-to-know). See [Security](Security#webhooks).

## Account mails

Besides the events of [Monitoring](Monitoring#events), NPMpro sends mails about a user's own account, to that user. Two switches under Settings, Notifications, in the card **Mail server**, control them: **Invitations** and **Account notices**. Both are on by default and can be set with `MAIL_INVITATIONS` and `MAIL_ACCOUNT_NOTICES` (see [Configuration](Configuration)).

| Mail | To | When | Switch |
|---|---|---|---|
| **Reset link**: "Reset your NPMpro password" | The user who asked | Someone asks for a password reset (see [Authentication](Authentication#password-reset-by-mail)). The link works once and for 30 minutes. Sent at once, not queued, not retried. | The reset switch in Settings, Authentication |
| **Reset notice**: "Your NPMpro password was reset" | The user | After every reset made with the link. It gives the time (UTC), the address the request came from and how many API tokens are still active. | None: always sent, even when Account notices is off |
| **Invitation**: "You are invited to NPMpro" | The invited user | An administrator creates a user with the invitation option, or sends the invitation again (see [Invitations](Usage#invitations)). The link works once and for 72 hours. Sent at once, not queued, not retried. | Invitations |
| **Password changed** | The user | The password is changed from the account window or by an administrator. All earlier sessions were signed out. It says "by an administrator" when an administrator made the change. | Account notices |
| **Address changed** | Both the old and the new address | The email address of the user is changed. The old address is told that it is no longer used and never gets the new address; the new address is told that it is now used. | Account notices |
| **Two-factor sign-in turned off** | The user | Two-factor sign-in is turned off by the user or by an administrator (the mail says "by an administrator" for the latter). | Account notices |
| **New backup codes** | The user | The user makes new backup codes. The earlier codes no longer work. The codes are never in the mail. | Account notices |

Rules for all of them:

- Account mails go to the address of the account and in the user's language (see [Public URL and language](#public-url-and-language)). A user who is disabled or has no password gets no reset mail.
- The notices are queued, so a mail server that is down gets the retries described in [How the mail server is reached](#how-the-mail-server-is-reached). A notice that cannot be queued is logged and never fails the change that caused it.
- No mail holds a password, a code, a token or the name of an administrator. Only the invitation and reset link mails hold a link.
- Accepting an invitation sends no mail (it is audited as `invitation-accepted`).
- The password and two-factor reset from the command line (`password-reset.js`) sends no notice. Nobody can be told that way: the command runs on the host.
- Users created by their first OIDC sign-in, and users restored from a backup, get no notice, because no password is written.
- Without mail, a public URL or the switch, nothing is sent and the changes themselves work as before.

## What a mail contains

Every mail has a plain text part and an HTML part with the same text. The HTML part has the NPMpro look (the logo, in light and dark mode). The logo is embedded in the mail, so nothing is loaded from the internet and nothing reports back when a mail is opened; there is no tracking.

## Who can change it

Saving the mail server settings needs a signed-in session. An [API token](API-tokens-and-MCP) is refused, because a token could otherwise send mail through a server you choose. The public URL and the default mail language also need a signed-in session, because the public URL is the address in password reset links. A token can still read both cards. The same goes for restoring the Notifications part of a backup, see [Backup and restore](Backup-and-restore#good-to-know). The password is sealed, never returned and only part of a backup made with secrets. See [Security](Security#outbound-mail).

# DNS

Which providers support which feature: [DNS providers](DNS-providers).

Certificates & DNS holds the DNS credentials, the domains each credential manages and the dynamic DNS records. Everything here uses the Certificates permission: view to read, manage to change.

## Domains

A domain is a DNS zone a credential manages, such as `example.com`. It covers itself and every name below it (`www.example.com`, `*.example.com`). Add domains in the Domains tab (Add domains) or in the DNS credential window (the Domains line). Names are stored in lower case; an internationalized name is stored as punycode (`bücher.de` becomes `xn--bcher-kva.de`). A domain cannot be a wildcard or a single label. One owner keeps a domain on one credential only: a second credential of the same owner refuses it. Two users may each list the same domain on their own credentials. Domains are input help: hosts and certificates keep plain names, and deleting a domain changes neither.

## Suggestions while you type

Every Domain Names field (hosts, certificates, the certificate of a stream) suggests names as you type. Text without a dot is offered in front of each of your domains (`app` becomes `app.example.com`); text with a dot is completed against your domains and against the names your hosts and certificates already use. Wildcards such as `*.example.com` are offered only where the field takes them (a host without a new certificate, or a certificate over the DNS challenge). You can always type any other name; Enter adds what you typed.

## DNS challenge

When you request a certificate with the DNS challenge, NPMpro picks the provider and credential whose domain covers all the names and says so under the credential field. Choose another one at any time; if it does not cover every name, a note says which names it has no domain for. Names that need different credentials, or a domain two users both listed, are shown instead of being guessed. The suggestion only fills the form: the request uses the credential you see.

## Who sees what

A user limited to their own items sees only the domains of their own credentials.

## Domains from the provider

For Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, PowerDNS, Linode, Vultr, deSEC, bunny.net, Porkbun, IONOS and GoDaddy credentials, the Add domains window (from the Domains tab, or from the credential's row menu with that credential chosen) lists the zones the provider has as soon as you choose the credential, below the field for typed names. Tick the ones to add, type others if you like, and Save adds both in one step (all or none). The token needs the right to list zones: Cloudflare Zone Read, DigitalOcean `domain:read`, Hetzner Cloud a project API token with read access to its DNS zones, Gandi a personal access token that can see your domains (only the domains of your own organization are listed), OVH a right on `GET /domain/zone`, PowerDNS the API key (an `http://` endpoint is accepted only for a LAN address, any other needs `https://`), Linode a personal access token with read access to Domains, Vultr the API key (its access control must allow the address of this instance), deSEC a token that may read the domains, bunny.net the account API key, Porkbun the API key and secret (the key's IP list must allow this instance), IONOS a key of the IONOS DNS API (prefix and secret), GoDaddy the API key and secret of an account GoDaddy allows to use its domains API. A fetch never removes a domain, and a failed list never blocks typing and saving domains. Zones the credential cannot change are left out: secondary zones (Linode, IONOS) and Porkbun domains with API access turned off or not hosted at Porkbun. At most 1000 zones are listed. A domain already on this credential shows as already here, one on another of your credentials shows which one, and new domains are ticked.

## Test a credential

**Test** checks that a saved DNS credential still works. It is in the credential window and in the row menu of the credential (DNS credentials tab of Certificates & DNS), and needs the Certificates manage permission. Save changes first: the test reads the saved values, and the button says **Save the credential first** while the form has an unsaved change. A provider that cannot list its zones (see the Fetch domains column of [DNS providers](DNS-providers)) has nothing to test with, and the button is off.

A test only reads. It asks the provider for one page of the zone list and, when a domain of the credential is a zone on that page and the provider can read records (Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, deSEC and Porkbun), for the A record at the apex of the first such domain. A domain below a zone, or one the page does not show, is not read. Nothing is stored and nothing is written at the provider, and a test leaves no audit log entry.

The answer is one of:

- **Reading works. The write right cannot be tested without a change.** The key reads zones; whether it may also change records is shown only when a certificate request or a dynamic DNS update writes.
- **The provider refused the key.** The provider answered "unauthorized": the key is wrong, expired or revoked.
- **The key works but lacks a right:** followed by the right the credential needs, as in [Domains from the provider](#domains-from-the-provider).
- **The provider refused the key or a right is missing.** The provider refused, and cannot say which of the two it is. Check the rights listed in [Domains from the provider](#domains-from-the-provider) and any IP allow list of the key (Porkbun, Vultr), then test again.
- **The provider answered with an error.** The provider's own message is shown below.
- **The provider did not answer.** A timeout or a network failure.
- **NPMpro does not send requests to this address.** The endpoint is refused by the outbound check (see [Security](Security#dns-provider-apis)).

How a refusal reads depends on the provider. OVH always shows the general **The provider refused the key or a right is missing.** DigitalOcean, Hetzner Cloud, Linode and Porkbun tell a missing right (a 403 answer) from a wrong key. Gandi, bunny.net, deSEC, GoDaddy, IONOS, PowerDNS and Vultr show **The provider refused the key.** only for a 401 answer and the general refusal for a 403; a wrong Gandi token answers 403, so for Gandi it reads as the general refusal. Cloudflare refuses a zone call the same way for both, so after a refusal NPMpro makes a second read-only call (the token check of Cloudflare): a token Cloudflare does not know shows **The provider refused the key.**, any other refusal (an account-owned token, for example) stays the general one.

## Host check

The host check shows where each name of a proxy, redirection or 404 host points and whether it reaches this instance. It only reads. **Check DNS** at the top of a host list checks the hosts on the page shown (in requests of at most 50 hosts and 200 names), and **Check** in the DNS card of the host window checks that host. A new host is not checked by itself: save it, then press **Check** in its window or **Check DNS** in the list. The result shows as a **DNS** badge after the names in the list, with one line per name in its tooltip, and as one line per name in the DNS card with the time of the check. Streams have no names and no check. A wildcard name is **Not checked**.

NPMpro looks up the A and AAAA records of each name (through **DNS servers for checks**, see [How the address is found](#how-the-address-is-found) and [The check](#the-check)) and compares them with the public address of this instance, found as for dynamic DNS. A name is in one of these states:

- **Reaches this instance:** every address the name has is the address of this instance (IPv4, and IPv6 when the name has AAAA records).
- **Partly here:** one address family points here and the other does not.
- **Points elsewhere:** the name has addresses and they are not this instance's.
- **No address:** the name has neither an A nor an AAAA record.
- **Unknown:** the check could not decide. The reason is shown: the DNS lookup failed, timed out or got no answer from the server, the public address (or the public IPv6 address) of this instance is not known or not confirmed (two address services disagree), the provider record could not be read, or the check ran out of time. One check ends within 60 seconds, and each DNS lookup within about 6 seconds (two tries of 3 seconds); a name not checked by then is **Unknown** and is checked again the next time.
- **Not checked:** a wildcard name.

A Cloudflare record that is proxied resolves to Cloudflare, not to your address, so DNS alone says **Points elsewhere**. When the name is under a domain of one DNS credential that the user can see, NPMpro reads the record at the provider (see [Dynamic DNS](#dynamic-dns) for the providers that can read records): for a proxied Cloudflare record it then shows **Reaches this instance** with **Proxied** beside it, and the line says **via record**. If the name has no record of its own, an alias (CNAME) is followed one level (**via alias**), and on Cloudflare and DigitalOcean the wildcard record of the parent name counts (**via wildcard**). Other providers are read only when DNS alone does not already show the name here; Cloudflare is read always. When the provider cannot be read the check goes on with DNS alone and says so. One check reads the provider at most 50 times (a Cloudflare zone is looked up once per check), and stops reading a credential after the provider says it gets too many requests, so a check cannot use up the rate limit that certificate requests and dynamic DNS share; the other names then keep their DNS answer and say that the provider was not asked.

The provider read needs the Certificates manage permission, and the credential must be the only one that covers the name. A user without it gets the DNS-only answer: a name hidden behind a Cloudflare proxy then reads **Points elsewhere**. A user limited to their own items checks only their own hosts and reads only their own credentials. Results are kept in memory and reused for 30 seconds per host (and per kind of user, since the provider read depends on the permission); a host change, a restore or a restart forgets them.

## Leftover challenge records

A certificate request with the DNS challenge adds a TXT record at `_acme-challenge.<name>` and removes it afterwards. A request that was cut off can leave it behind. **Clean up challenge records** in the row menu of a DNS credential (Certificates manage permission) lists those records and deletes the ones you tick. It works for Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, deSEC and Porkbun (the Cleanup column of [DNS providers](DNS-providers)); for any other provider the entry is off.

What counts as a leftover:

- Only TXT records at `_acme-challenge` or a name below it, in the domains of this credential (at most 100 domains and 500 records in all: when the list is cut, delete these and open the window again). A domain the provider does not know as a zone (a name below a zone, for example) is named in a note with the provider's answer, and the other domains are listed.. Nothing else at the provider is listed or touched.
- A CNAME at `_acme-challenge` is a delegation you set up on purpose. It is not listed and never deleted; the window only says how many it left alone.

Each record shows its age and a state:

- **In use:** a certificate request or renewal of this instance is running. All records are **In use**, nothing can be ticked, and the delete is refused until the run ends: wait for the certificate request to end, then open the window again. The delete itself also waits for the certificate locks and is refused when it cannot take them, so a request cannot start beside it.
- **Recent:** changed less than 10 minutes ago. Another ACME client may still be using it.
- Records older than 1 hour with a known age are ticked in advance. Nothing else is: tick only what you know is a leftover.
- **Age unknown:** DigitalOcean, Hetzner Cloud, Gandi, OVH and Porkbun give no change time for a record. None of their records is ticked in advance, and another program may be using such a record.

After you tick records and press Delete, the window asks **Delete N records at the credential?** and nothing is deleted before you confirm. The records are sent in batches of 100. Each is read again first: a record that changed since the list was read is skipped (**Skipped: the record changed since the list was read**), one that is gone counts as **Already gone**, and one outside the credential's domains is skipped. If a certificate request or renewal starts while the records are deleted, the delete stops and the rest are skipped. The window lists again only when it opens and after a delete, so a ticked record keeps the values you saw; a record whose values changed loses its tick. The results list says **Deleted**, **Already gone**, **Skipped** or **Failed** for each record. The audit log keeps the names and the count, never the values (they are challenge tokens).

Gandi, deSEC and Hetzner Cloud hold all the TXT values of one name in one set, and the delete removes the whole set after it checked that it still holds the values the list showed. There is a small window between that check and the delete: a value another program adds to the same set in that moment is removed with it.

## CAA check

A CAA record at your domain says which certificate authorities may issue for it. The CAA check tells you before a request whether the CAA records of the names allow the CA that would issue the certificate. It only reads and **never blocks a request or a save**: it shows a note.

The note shows in the windows that request or re-issue an ACME certificate, and in the certificate window of a host, a moment after you stop typing names or change the CA. In the Certificates list a small warning icon after the names of an ACME certificate shows when a name is refused, limited or could not be checked, with a line per name in its tooltip. Custom certificates are not checked. List results are kept for 6 hours, or 5 minutes for a name that could not be checked (up to 25 certificates are refreshed each time the list loads, within 60 seconds), and a save, a re-issue or a renewal of a certificate forgets its result. A user who may view certificates sees the checks.

How a name is checked:

- NPMpro looks for CAA records at the name and, if there are none, at each parent name up to the top label, and uses the first set it finds (RFC 8659). A name under a wildcard starts at the name without `*.`. The climb goes up at most 16 levels: a climb that ends without finding a CAA set within 16 levels says the name could not be checked (**The name has more than 16 labels, so the lookup stopped before the top.**). An answer of no data or no such name moves up; any other failure (a timeout, a server failure) stops the climb and the name is **Unknown**.
- A wildcard name follows the `issuewild` records when there are any, otherwise `issue`.
- The CA's CAA identities come from the CA's own ACME directory. If the directory names none, Let's Encrypt uses `letsencrypt.org`, ZeroSSL uses `sectigo.com` and its related names (`trust-provider.com`, `usertrust.com`, `comodoca.com`, `comodo.com`, `entrust.net`, `affirmtrust.com`) and Google Trust Services uses `pki.goog`. A CA of your own that names none is **not checked** (the note says so).
- No CAA records anywhere, or records that set no `issue` property, allow every CA. A record that lists the CA allows it. Records that list other CAs only, or an empty `issue ";"`, refuse it (**The CAA records do not allow the CA**), and so does a record with the critical flag and a tag the check does not know.
- For Let's Encrypt the check also compares `validationmethods` with the challenge of the certificate (`dns-01` or `http-01`; a record that allows other methods only refuses) and shows `accounturi` as **The CAA records limit the account**: NPMpro does not compare the account. For the other CAs these two parameters are not compared: a record with them counts as allowing the CA, and no note is shown.

## Dynamic DNS

A dynamic DNS record keeps a DNS name pointed at this instance, so a home or office connection with a changing public IP stays reachable by name. Records live in the Dynamic DNS tab of Certificates & DNS. A record uses one of your saved DNS credentials for its provider, so there is nothing to enter twice. The providers that use a saved DNS credential are Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, deSEC, DuckDNS and Porkbun; only credentials of these providers are offered. Namecheap, No-IP, Dynu and Custom HTTP take their details in the record itself (see [Providers](#providers)). Settings, Dynamic DNS holds the settings of the updater, and the tab shows the public address found, the next check and a **Check now** button.

### Records

A record has a full name (`home.example.com`), a credential, a zone (taken from the domains of the credential, or typed), an optional TTL (from the provider's minimum to 86400 seconds: 60 on Cloudflare and Hetzner Cloud, 30 on DigitalOcean, 300 on Gandi, 600 on Porkbun, 3600 on deSEC; empty keeps the provider's value; the providers without zones take no TTL) and an **Enabled** switch. There are two kinds:

- **Address (A, AAAA):** follows the public IP. The IP version is IPv4, IPv6 or both. IPv6 is off unless a record asks for it. An optional IPv6 suffix replaces the last 64 bits of the detected address, for a stable address of one host in the network.
- **Alias (CNAME):** points the name at a fixed target name and follows no address. The usual pairing is one address record such as `home.example.com` plus an alias such as `*.example.com` pointing to `home.example.com`: only the address record ever changes.

A wildcard name (`*.example.com`) is possible only on Cloudflare and DigitalOcean; the other providers refuse it when you save, and so do alias (CNAME) records on OVH, deSEC, Porkbun, DuckDNS and the providers below that take no credential. A record that is missing at the provider is created. On Cloudflare the proxied setting is never changed: a new record is not proxied, and an existing one keeps what it has. A name whose record set at the provider has more than one value is never touched: the record is marked Failed instead. A name that already has a record of the other type at the provider (an address where an alias is wanted, or the reverse) is saved, and its first check marks it Failed with a message that says which record is in the way; nothing is written until that record is removed or the kind is changed. Deleting a record in NPMpro leaves the DNS entry at the provider as it is.

### Providers

Besides Cloudflare, DigitalOcean, Hetzner Cloud and Gandi (see the table in [DNS providers](DNS-providers)), these update records:

- **OVH:** uses an OVH credential saved under DNS credentials (see [DNS challenge](#dns-challenge)) and the zone you type or pick. A record at the zone apex is refused. OVH applies a change only after the zone is refreshed, so NPMpro asks for a refresh after every write; if the refresh fails, the update counts as failed and the next check refreshes first.
- **deSEC:** uses a deSEC credential saved under DNS credentials (see [DNS challenge](#dns-challenge)). The smallest TTL is 3600 seconds.
- **Porkbun:** uses a Porkbun credential saved under DNS credentials (see [DNS challenge](#dns-challenge)). The smallest TTL is 600 seconds.
- **DuckDNS:** uses a DuckDNS credential saved under DNS credentials; the token is on your account page at duckdns.org. The name is a single subdomain of `duckdns.org` (`home.duckdns.org`) and the zone is fixed. DuckDNS takes no TTL. An answer other than `OK` is a failure.
- **Namecheap (preset):** no DNS credential. Choose **Namecheap** as the provider and enter the **Domain** and the **Dynamic DNS password** of that domain (shown in the Advanced DNS tab). Create the host first as an A + Dynamic DNS record in the Advanced DNS tab of the domain. IPv4 only.
- **No-IP (preset):** no DNS credential. Enter the **User name** and **Password** of the No-IP account (the user name is its e-mail address); the host name is the name of the record and must belong to the account. IPv4 or both versions work; a record of IPv6 alone is not offered.
- **Dynu (preset):** no DNS credential. Enter the **User name** and the IP update **Password** of the account (set in the Dynu control panel); the host must belong to it.
- **Custom HTTP:** for any other service that updates a name with one web request. Only administrators can add, see or change such a record. Enter the **Update URL** (`https://` only), the **Method** (GET or POST; a POST sends no body) and, optionally, the text the answer must contain (**Answer must contain**; empty accepts any 2xx answer). The placeholders `{ip}` (the address of this call), `{ipv4}`, `{ipv6}` and `{name}` (the record name) may stand in the path and the query, never in the host part; each is filled URL-encoded. A record that follows both IP versions makes one call with both addresses; `{ipv4}` or `{ipv6}` is empty when the record has no address of that version. The host of the URL may not be this host, a link-local or a reserved address.

DuckDNS, the presets and Custom HTTP take no TTL, wildcard or alias record, and none of them can read a record: NPMpro calls the service whenever the address in DNS differs from the wanted one.

The passwords of the presets and the custom URL are stored encrypted and are never shown again: editing the record shows **Saved. Leave empty to keep it.** A preset password needs at least 4 characters. They never appear in the status, the history, the log or an error message.

When a provider asks NPMpro to wait, NPMpro waits at least that long: No-IP after a 911 answer 30 minutes, Dynu after a 911 answer 10 minutes. When Namecheap, No-IP or Dynu refuse the account (a wrong password, an unknown host, a blocked client), NPMpro stops: the record shows the error and gets no more automatic tries, not even from **Check now**, until you save it with a change, disable and enable it again, or press **Update now**. Those providers ask a client to stop after such an answer and may block one that goes on.

### Keep updated

The Dynamic DNS tab suggests host names to keep updated: names of your proxy, redirection and 404 hosts that sit under a domain of one of your DNS credentials whose provider has zones and can update records (so not DuckDNS, and never the presets or Custom HTTP), and that have no record yet. Wildcard names are not suggested, and at most 100 names are listed. The tab shows how many names could be kept updated and an **Add** button: with one name it opens the record window filled with the name and the credential, with several it first lists them to choose from. The proxy host window shows **Keep updated** beside such a name, with the same effect; it needs the Certificates manage permission.

### How the address is found

NPMpro asks public echo services over `https://`, in turn, until one answers with a single public address. Private, CGNAT, link-local, documentation and other reserved addresses are never used. An address that differs from the last known one is accepted only when a second service gives the same answer: when they disagree, or only one answers, nothing is written. The services are the defaults of `DDNS_IPV4_SERVICES` and `DDNS_IPV6_SERVICES` (see [Configuration](Configuration)) or your own list. IPv6 services are asked only while an enabled address record needs IPv6, and an alias asks for no address.

### The check

A check runs at start (one minute after) and then every period (default 5 minutes). For each enabled record NPMpro first looks up the name in DNS. When the answer already is the wanted address, nothing more happens. Only when the answer differs (or there is none) does it ask the provider's API, and it writes only when the record there really differs. A proxied Cloudflare record resolves to Cloudflare, so for it the provider is always asked. An alias is always compared at the provider.

DuckDNS, the presets and Custom HTTP have no way to read a record, so for them the DNS answer is the only reading. NPMpro writes when the wanted address differs from the one it last wrote. When only the DNS answer differs, it writes that same address again at most once a day, and the record shows a note that the check still answers an old address: the providers ask for no repeated updates of an unchanged address.

If the DNS server of your network answers with a LAN address for your own names (split horizon), set **DNS servers for checks** in Settings, Dynamic DNS (`DDNS_RESOLVER`) to a public resolver, so the lookup sees what the world sees. These servers are used only for this lookup of a record's name; the address services and the providers always use the container's resolvers.

The **cooldown** (default 5 minutes) is the least time between two writes of one record, so a flapping address cannot hammer the provider. A change inside the cooldown waits until the cooldown has passed. After a failed check the record is tried again later with a **backoff**: the wait doubles with each failure, starting at one period and never more than 6 hours; a success resets it. **Update now** (in the record's row menu) runs that one record at once, ignoring the backoff but not the cooldown, and shows the result. **Check now** (in the status card) runs a check of all your records at once.

### History and states

Each record keeps its last 50 changes: created, changed (old and new value), failed and recovered, with the time. Open them with **History** in the row menu. The history is deleted with the record. Provider tokens are never written to the status, the history or the log.

The state of a record is one of:

- **Pending:** waiting for its first check.
- **Updating:** shown in this browser while its **Update now** runs.
- **Up to date:** the record at the provider is what it should be (with the age of the last check).
- **Updated:** changed at the provider within the last 24 hours (with the time of the change).
- **Failed:** the last check failed; the message says why, and the next try is shown.
- **Disabled:** not kept up to date.

Proxied is shown beside the state of a proxied Cloudflare record.

### Pause during restores

Checks are paused while a backup is restored or merged or the database is moved, and run again afterwards. The status card shows Paused, and Update now and Check now are refused meanwhile.

### Who may use it

Dynamic DNS uses the Certificates permission: view to see records and their history, manage to add, change, Update now, Check now and delete. A user limited to their own items sees only the records of their own credentials.

## DNS records for a host

NPMpro can create the DNS record of a host's name for you and keep it current. The option is off by default and works per name: nothing is written at your DNS provider for a name you did not tick. It is offered for proxy, redirection and 404 hosts; streams have no names and are not covered.

Open the host window, go to the **DNS** card on the Details tab and turn on **Create DNS records for this host**. The names of the host are listed, each with a box. Tick a name and **Save**. The record is made as an A record with the public IPv4 address of this instance. A record created this way is a record of [Dynamic DNS](#dynamic-dns): the updater keeps it current when your address changes.

### What NPMpro checks first

A name can be ticked only when all of this holds, and the line of the name says what does not:

- It is a plain name. A wildcard name and a regular expression name get no record. For a wildcard use a record under Certificates & DNS, Dynamic DNS.
- Exactly one saved DNS credential that you can see covers the name (see [Domains](#domains)), and the provider of that credential can both create and delete address records: Cloudflare, DigitalOcean, Hetzner Cloud, Gandi, OVH, deSEC and Porkbun. **No saved credential covers this name** and **More than one credential covers it** end the check.
- The host is enabled.
- A public IPv4 address of this instance is known (see [How the address is found](#how-the-address-is-found)). Otherwise the line says **No public address found**.
- No other Dynamic DNS record already keeps the name. A record you made under Dynamic DNS, or a wildcard record of the zone (in Dynamic DNS or, on Cloudflare and DigitalOcean, at the provider), shows the name as covered, and no second record is made. A record of another host refuses the tick: **Another dynamic DNS record already keeps this name**.
- The provider can be read. If not, the line says **The record could not be read at the provider** or, after too many reads in one go, that the provider was not read now (save again later). A save that failed to read ends as **Failed, will try again**.
- This server can be reached from outside (next section).

### Does the name reach this server

When you tick a name, NPMpro puts a one-time file in the folder nginx serves for certificate challenges and asks for it on the public address of this instance, on port 80 with the name as the host name. Port 443 is tried only when port 80 gets no answer or redirects to https on the same name. Any other answer on port 80 counts as something else answering. If the file comes back, the line says **This server answers at** the address and port. If something else answers, it says so (probably your router).

This test runs from inside your network, so it shows only that the public address leads to this server from inside the network, not that the world can reach the name: a block by your provider or at the edge of your network stays unseen, and it can never prove that the name is unreachable. A router that does not send the request back to a server inside the network (the missing hairpin NAT) makes a working setup look unreachable. Unless the test reached this server, the box **I checked from outside that ports 80 and 443 reach this server** appears: after something else answered, when nothing answered, for a host that overrides the challenge path, and when a reachable result is older than 10 minutes. Check from outside (a phone on mobile data, for example), tick the box, and Save. Until the box is ticked (or while the test still runs), Save is refused and the box says why. A host that overrides the challenge path cannot be tested. The result of a test counts for 10 minutes.

### Save never waits for DNS

A save always keeps the host. The checks that need no provider run at once and a refusal is shown on the name; after the save a warning names each ticked name that was refused, with the reason, as the window may close. The save never looks up the public address: when NPMpro does not know it yet, the name waits and the job looks it up. The work at the provider (reading the name, creating the record) runs after the answer, one job per host at a time, so the name shows **Waiting for the provider** until it ends and then **Kept updated** or **Failed, will try again**. The host list shows a **Records** badge with the state.

### Options of a new record

- **Also an AAAA record (IPv6):** shown only when NPMpro found a public IPv6 address of this instance. It counts when the name is ticked the first time and does not change a record that already exists. To change it, untick the name, save, tick it again and save.
- **Proxied through Cloudflare:** shown only for a Cloudflare credential. It is used once, when the record is created. Without it the record is not proxied. Changing it later at Cloudflare is not undone by NPMpro.
- **TTL:** a new record gets 300 seconds, raised to the provider's minimum when that is higher (600 at Porkbun, 3600 at deSEC). A record that already exists keeps its own TTL.

The window shows what will be made before you save, for example **Will create A 203.0.113.7 (TTL 300) at Cloudflare, zone example.com after Save**.

### A record that already exists

NPMpro never overwrites a record it did not create. When the name already has a record:

- It already holds the address NPMpro would write (in every family you ticked): it is adopted at once, nothing is written, and it is kept current from then on.
- It holds something else: the name shows what is there, for example **A 198.51.100.4 already exists here**, and nothing is written. Choose **Adopt and update** to change the record to this server's address and keep it updated (the old value stays in the history), or **Leave alone** to keep the record untouched and untick the name. A name that holds a CNAME or more than one address can only be left alone (remove the record at the provider first to adopt).
- A record that appears at the name after you saved, before NPMpro wrote its own, is treated the same way: it shows as a record that already exists.

### Disable, untick and delete

- **Disabled host:** its records are paused. They stay at the provider, NPMpro stops updating them and shows **Paused while the host is disabled**; enabling the host resumes them. A disabled host cannot get new records; a host disabled while its record is being made, and a record adopted on a disabled host, are paused the same way.
- **Untick a name, remove it from the host or delete the host:** a record NPMpro created is deleted at the provider, and only the exact address it wrote; a record that holds another value now is left there, and its row stays as an orphan too (see below). An adopted record, and a name that held another record, is never deleted at the provider: NPMpro only stops managing it.
- **A failed delete** keeps the row as an orphan, **Could not be deleted at the provider**, so the host change itself still goes through. In Certificates & DNS, Dynamic DNS the row offers **Delete at the provider again** and **Forget**. Forget removes only the row and leaves the record at the provider. The host's DNS card shows its orphans too, with **Delete at the provider again**. The same orphan appears when a delete finds another value at the provider: that value stays there, **Delete at the provider again** will not remove it, and **Forget** is the way out. Ticking the name again on the same host resumes the orphan as a record to create: if the name holds another value by then, it shows as a record that already exists, and you choose **Adopt and update** or **Leave alone**; resuming needs a credential you can see. If NPMpro stops before the records of a deleted host were deleted at the provider, they become orphans at the next start; nothing is deleted at the provider then.

### In the Dynamic DNS list

A record made for a host shows **Managed by** the host's name in the Dynamic DNS list. It has a **View** button and **Open host** instead of Edit, Disable and Delete: change it in the host's DNS card.

### Rights for host records

Ticking a name needs the manage permission of the host's type, the Certificates manage permission and a saved credential that you can see. Unticking a name and **Leave alone** need only the manage permission of the host's type. **Adopt and update** needs the manage permission of the host's type, the Certificates manage permission and a credential you can see. **Delete at the provider again** and **Forget** need the Certificates manage permission and a credential you can see, not the host's permission. A user limited to their own items uses only their own credentials and hosts, and a record of a credential they cannot see shows as **Managed by another user**, without the provider's message. The public address of this instance shows in the DNS card only with the Certificates manage permission.

## DNS resolver

The resolver is the DNS server nginx uses for upstream names (a proxy host's forward host, for example). Set it in Settings, nginx, DNS resolver, or with the `NGINX_RESOLVER`, `NGINX_RESOLVER_HOSTS`, `NGINX_RESOLVER_IPV6` and `NGINX_RESOLVER_VALID` variables (see [Configuration](Configuration)). Empty servers mean the container's own `/etc/resolv.conf`. `NGINX_RESOLVER_VALID` takes a time in seconds or longer: seconds, or parts with units such as `30s`, `5m` or `1h30m` (never `ms`, not a bare `0`); empty uses each record's TTL, and `0s` or another zero such as `0m` means the same as empty.

The default is the line nginx.conf had (`resolver local=on hosts=on ipv6=on;`), so nothing changes until you set it. The line lives in `/data/npmpro/nginx/resolver.conf`, which the container writes at start. A custom `http.conf` or `stream.conf` must not add a second `resolver` line.

Addresses you set replace the container's own resolvers (local=on): a name that only the container's resolver knows, such as another container's name on a Docker network (127.0.0.11), is then no longer found unless one of your addresses answers it.

A save asks each new address once; an address that does not answer gives a warning, and the setting is still saved.

## What is an Access List?

An Access List protects proxy hosts. It can ask visitors for a username and password (Basic authentication), allow or deny visitors by IP address, or both. It helps for services that have no login of their own, or when you want to keep unknown clients out.

One list can be used by many proxy hosts and locations.

### Details

- **Name**: required.
- **Satisfy Any** (off by default): a visitor gets in when they match any one check, a rule or a valid user. Off means they must pass both. It also skips an Auth Request on that host.
- **Pass Auth to Upstream** (off by default): sends the visitor's `Authorization` header on to the service. Off keeps the login private to NPMpro.

### Authorizations

Add usernames and passwords. Usernames must be unique within the list and cannot contain `:`. When you edit a list, leave a saved password empty to keep it.

### Rules

Rules allow or deny an IP address, a CIDR range (`192.168.1.0/24`, `2001:db8::/32`) or `unix:`. They are applied in the order you list them, and the first match wins. Put specific rules first. A final `all` rule closes the list, set to allow or deny; it is added only when there is at least one other rule. A list needs at least one user or one rule.

### Use on proxy hosts

On a proxy host, choose the list under **Global Access Lists** on the Details tab: **Publicly Accessible** (no list) or **Custom**. A custom location can use **Global** (the host's lists), **Publicly Accessible** or its own **Custom** lists.

You can attach several lists to one host or location. They are checked from top to bottom, in the order shown, and you can move them up and down. **Satisfy Any** and **Pass Auth to Upstream** only count on the first list. With CrowdSec, banned IPs see the ban page before the password prompt.

More in the wiki: Host options.

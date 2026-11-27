## GeoIP

NPMpro downloads free GeoIP databases itself (DB-IP Lite or MaxMind GeoLite2) and looks up countries and networks on your server, so visitor IPs are never sent anywhere. You do not need a separate geoipupdate container. The databases feed the Monitoring map and lists, GoAccess and nginx country rules.

A variable set on the container wins over the UI and locks the field (the field shows "Set by environment"). Use the UI for anything not set in the container. Saving starts the download in the background, and the status below updates when it is done.

### Provider

- **DB-IP Lite** is the default: free, no account needed, new files every month (NPMpro checks once a week). Variable: `GEOIP_PROVIDER`.
- **MaxMind GeoLite2** is kept: it needs a free account and a license key and updates twice a week.

One provider is active at a time and only its databases are used. The files of the other provider stay on disk, so switching back needs no new download. GoAccess picks up a switch at the next container start. Variable: `GEOIP_PROVIDER` (`dbip` or `maxmind`).

### DB-IP databases

- **Country**: countries for the map, the country lists and the country rules of access lists.
- **ASN**: networks (AS number and name) for the network lists.

Both are on by default. Variable: `GEOIP_DBIP_EDITIONS`.

### MaxMind account

You need a free MaxMind account and a license key (in MaxMind: Account, Manage license keys). There is a sign-up link on the page.

- **Account ID**: variable `GEOIP_ACCOUNT_ID`.
- **License key**: stored encrypted and never shown again. If the saved key cannot be decrypted, enter it again. Variable: `GEOIP_LICENSE_KEY`.

### Databases

- **GeoLite2 Country**: countries for the map, the country lists and nginx country rules. On by default.
- **GeoLite2 ASN**: networks (AS number and name) for the network lists. On by default.
- **GeoLite2 City**: optional, cities for GoAccess. A much larger download. Off by default.

Variable: `GEOIP_EDITIONS`, space separated, for example `GeoLite2-Country GeoLite2-ASN`. With no database selected, nothing is downloaded or updated, and databases already downloaded are kept.

### Status

Shows the last update and the last error. NPMpro updates the databases when you change the account or databases, when you click **Update now**, and automatically every 3 days. A failed automatic update is tried again after 24 hours. **Update now** needs a saved account ID and license key.

Without databases, the map and the country and network lists are hidden; the rest works.

More in the wiki: Monitoring.

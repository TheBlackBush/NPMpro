## GeoIP

NPMpro downloads the free MaxMind GeoLite2 databases itself and looks up countries and networks on your server, so visitor IPs are never sent anywhere. You do not need a separate geoipupdate container. The databases feed the Monitoring map and lists, GoAccess and nginx country rules.

A variable set on the container wins over the UI and locks the field (the field shows "Set by environment"). Use the UI for anything not set in the container. Saving starts the download in the background, and the status below updates when it is done.

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

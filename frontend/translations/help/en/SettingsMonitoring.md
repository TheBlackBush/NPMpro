## Logs & monitoring

Log files, the GoAccess log report and the traffic statistics behind the Monitoring page.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by LOGROTATE", or "Set by environment" for the statistics). Use the UI for anything not set in the container. Settings marked "Restart required" are saved at once but read when the container starts; the section then lists them under "Restart the container to apply".

### Log files

- **Write log files**: writes the nginx error, stream and access logs to `/data/nginx/logs` and rotates them daily. Default: off. Variable: `LOGROTATE`. Applies after the nginx reload that saving runs. It stays on while GoAccess runs.
- **Log rotations kept**: how many rotated log files are kept before the oldest is deleted, 1 to 1000. Default: 3. Variable: `LOGROTATIONS`. Applies at once.

### GoAccess

- **GoAccess report**: runs GoAccess, a web log report for administrators, under `/goaccess` of the web UI. Default: off. Variable: `GOA`. Applies after a container restart. It does not turn traffic statistics on.

With the report on, these options show. All apply after a container restart. One variable, `GOACLA`, replaces all of them with your own GoAccess options and locks them.

- **Keep report data**: 1 to 366 days. Default: 30.
- **Anonymize visitor IPs**: Off, Level 1 (default), Level 2 (strong) or Level 3 (pedantic). Level 1 hides the last IPv4 byte (the last 64 bits of IPv6), level 2 two bytes (80 bits), level 3 three bytes (96 bits).
- **Drop query strings**: removes query strings from URLs in the report, so tokens in URLs are not stored. Default: on.
- **Full operating system versions**: shows the full version, not only the family. Default: on.
- **Resolve host names**: looks up host names of visitor IPs. This sends DNS queries for them. Default: on.

### Monitoring

These control the Traffic tab of the Monitoring page. All apply at once on save. Variables: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Traffic statistics**: reads the nginx access log and counts requests per host, status, country and network. Default: off. Turning it off stops new counting; stored statistics stay until they age out, unless you tick "Also delete the stored statistics" in the dialog.
- **Keep statistics for**: 7 to 365 days. Default: 30. Per-minute data is kept for 24 hours, hourly data for this many days.
- **Show visitor IPs**: stores visitor IPs per hour to list the top IPs. Default: off, for privacy. Turning it off deletes the stored IPs.
- **Count unique visitors**: stores a keyed hash of each visitor IP per host and day to count unique visitors. Default: off. Turning it off deletes the hashes.
- **Visitor limit per host and day**: 1000 to 1000000. Default: 100000. A host that reaches it stops counting new visitors that day and shows a plus sign.

Countries and networks need the GeoIP databases (Settings, GeoIP).

More in the wiki: Monitoring.

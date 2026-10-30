# Privacy

Hints for your privacy policy and the connections the container makes.

## Hints for Your Privacy Policy
**Note: This is not legal advice. The following points are intended to give you hints and help you identify areas that may be relevant to your privacy policy. This list may not be complete or correct.**
1. NPMpro **always** writes the nginx error logs to your Docker logs; it uses the error level “warn” (so every error nginx and the nginx modules mark as error level “warn” or higher will be logged), as it contains user information (like IPs) you should mention it in your privacy policy. With the default installation no user data should leave your system because of NPMpro (except for data sent to your backends, as this is the task of a reverse proxy), this should be the only data created by NPMpro containing user information by default.
2. If you turn on Write log files (Settings, Logs & monitoring, or `LOGROTATE=true`), the access, stream and error (also level “warn”) logs will be written to your disk and rotated daily and deleted based on your set number of set rotations. The access logs use these formats: [http](https://github.com/TheBlackBush/NPMpro/blob/develop/rootfs/usr/local/nginx/conf/nginx.conf) and [stream](https://github.com/TheBlackBush/NPMpro/blob/develop/rootfs/usr/local/nginx/conf/nginx.conf). These include user information (like IPs), so make sure to also mention that these exist and what you are doing with them.
3. If you use crowdsec, and you do **not** [disable sharing in crowdsec](https://docs.crowdsec.net/docs/next/configuration/crowdsec_configuration/#sharing), you need to mention that [this](https://docs.crowdsec.net/docs/central_api/intro/#signal-meta-data) is sent to crowdsec in your privacy policy.
4. If you're blocking IPs, for example, using access lists, GeoIP filtering, or CrowdSec block lists, make sure to mention this as well.
5. If GoAccess is enabled, it processes the access logs to generate statistics, which are saved on disk for the time set in Keep report data (default 30 days). These statistics include user information (like IPs, masked by default with anonymize level 1), so make sure to also mention this. With Resolve host names on (the default) the visitor IPs are also looked up in DNS.
6. If you enable traffic statistics (Settings, Logs & monitoring, or `TRAFFIC_STATS`), NPMpro reads the access log and stores counts per host, status class, country and network (and the bytes sent) for the set retention time. Visitor IPs are only stored if you also enable "Show visitor IPs". If you enable "Count unique visitors" (or `TRAFFIC_UNIQUE_VISITORS`), NPMpro additionally stores a keyed, truncated hash of each visitor IP per host and day (not the IP itself, the key never leaves the server) for the set retention time. The hash depends only on the IP (and the server's key), so the same visitor has the same hash on every host and day for the retention period; this is what lets the 7 and 30 day ranges count a visitor once. The hashes are pseudonymous, not anonymous: whoever can read the data folder (the database and the key both live under `/data`) could test all IPv4 addresses against them and recover the IPs. You may want to mention it, especially if your sites are used by others. The access log itself is written to disk while statistics are on and rotated like with Write log files. GeoIP lookups happen locally from the MaxMind database files on disk, no visitor IP is sent to MaxMind.
7. If you use the PHP-FPM option, error logs from PHP-FPM will also be written to Docker logs. These include user information (like IPs), so make sure to also mention this.
8. If you collect any user information (like through other custom nginx modules, modules you can load via environment variables, lua scripts, etc.), also mention it.
9. If you use the caddy http to https redirect container, you should also mention the data collected by it, since it will also collect (error) logs.
10. If you use anubis, see here: https://anubis.techaro.lol/docs/admin/configuration/impressum
11. If you do any extra custom/advanced configuration/modification, which is in someway related to the users data, then yes, keep in mind to also mention this.
12. Anything else you do with the users data, should also be mentioned. (Like what your backend does or any other proxies in front of NPMpro (like cloudflare, still not recommended), how data is stored, duration, ads, analytic tools, how data is handled if they contact you, by who/which provider, etc.)
13. This probably does not need to be mentioned, but you can include it if you want to be thorough (note: this does not apply if you're using Let's Encrypt, as they no longer support OCSP): Some clients (like Firefox) send OCSP requests to the certificate authority (CA) by default if the CA includes OCSP URLs in the certificate. This behavior can be disabled by users in Firefox. It likely does not need to be mentioned, as no data is sent to you, the client communicates directly with the CA. The check is initiated by the client itself; it's neither requested nor required by you. Your certificate simply indicates that the client can perform this check if it chooses to.
14. Also optional and likely not required: Some information about the data stored by the nameservers running your domain. This should not be required, since in most cases there's a provider between the users and your nameserver acting as a proxy. This means the DNS requests of your users are hidden behind their provider. It’s the provider who should explain to their users how they handle data in their role as a "DNS proxy."

## What connections can be expected from the NPMpro container?

- to your clients
- to your upstreams
- to your dns server for name resolution
- to your acme/ocsp server
- to github for an hourly update check
- if not turned off (Settings, Advanced) gravatar for profile pictures
- if used to your OIDC
- if used to pypi to download certbot plugins
- if used to your dns provider for acme dns challenges
- if used to www.site24x7.com for the reachability check
- if enabled to the alpine package repositories to install the inbuilt php-fpm and its extensions
- if Trust Cloudflare is on, to cloudflare to download their IPs
- if enabled to the crowdsec (container) lapi (also for the CrowdSec tab of the Monitoring page, the URL is the `API_URL` of the bouncer config)
- if GeoIP credentials are set to download.maxmind.com (and the storage location it redirects to) to download the GeoLite2 databases: when the credentials or editions are changed, when "Update now" is used, and every 3 days (a failed automatic update is retried after 24 hours)
- if enabled to your captcha provider for the crowdsec captcha remediation
- if you see more/others please report them

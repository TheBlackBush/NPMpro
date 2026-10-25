# Migrating from Nginx Proxy Manager

**Migrating back to the original nginx-proxy-manager is not possible.** Make a backup before migrating, so you can revert if needed.

1. Read [Compatibility (to Upstream)](https://github.com/TheBlackBush/NPMpro#compatibility-to-upstream) first: some DNS plugins were replaced (certificates using them must be recreated), route53 is not supported, and the web UI uses https.
2. Make a backup of your data and letsencrypt folders (a copy with `cp -a` is enough).
3. Download the latest [compose.yaml](https://raw.githubusercontent.com/TheBlackBush/NPMpro/refs/heads/develop/compose.yaml) of NPMpro.
4. Set the paths of `/data` and `/etc/letsencrypt` to the ones you used with nginx-proxy-manager (uncomment the letsencrypt volume line for this).
5. Set `TZ` (optional) and the other variables you need. Most options can also be set later in the web UI.
6. Stop nginx-proxy-manager.
7. Deploy the NPMpro compose.yaml.
8. Remove the `/etc/letsencrypt` mount, since its content was moved to `/data` during the migration, then redeploy the compose file.
9. Many forms have changed, so check every host. See [Comments on some buttons](https://github.com/TheBlackBush/NPMpro#comments-on-some-buttons).
10. If you proxy NPMpro (or NPM) through another NPMpro (or NPM) instance, change the scheme from http to https.
11. Maybe set up [CrowdSec](CrowdSec).
12. Please report all (migration) issues you have: https://github.com/TheBlackBush/NPMpro/issues

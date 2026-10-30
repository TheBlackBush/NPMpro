# Compatibility

How NPMpro differs from the upstream project and what it needs to run.

- Supported architectures: x86_64-v2/amd64v2 (check with `/lib/ld-linux-x86-64.so.2 --help`, plain x86-64 is not supported only v2 and up) and aarch64/arm64 (other archs (including 64-bit ones) and any 32-bit arch (like armhf/armv7 (dropped), armel/armv6) are not supported, because of the duration to compile).
- NPMpro is built for docker (CI builds the image and checks that it starts healthy), but podman should also work (running the NPMpro container inside an LXC container is discouraged, it will work, but it works better without, install docker/podman on the host or in a KVM and run NPMpro with this)
- MariaDB(/MySQL)/PostgreSQL may work as Databases for NPMpro (configuration like in upstream), but are unsupported, have no advantage over SQLite (at least with NPMpro) and are not recommended. Settings, Database moves an instance between SQLite, MySQL/MariaDB and PostgreSQL (see [Database](Database)).
- NPMpro uses https instead of http for the admin interface
- NPMpro won't trust cloudflare until you turn on Trust Cloudflare (Settings, Network, or `TRUST_CLOUDFLARE=true`), but please read [this](Security#notes-on-cloudflare) first.
- route53 is not supported as dns-challenge provider and Amazon CloudFront IPs can't be automatically trusted in NPMpro, even with Trust Cloudflare on.
- The following certbot dns plugins have been replaced, which means that certs using one of these providers will not renew and need to be recreated (not renewed): `certbot-dns-he`, `certbot-dns-dnspod`, `certbot-dns-online`, `certbot-dns-powerdns` and `certbot-dns-do` (`certbot-dns-do` was replaced in upstream with v2.12.4, this change is included in NPMpro)
- There are many changes and improvements to the nginx config, so please don't follow guides in the internet about custom/advanced config, they are either redundant or should not be used at all with NPMpro
- Many forms have changed behavior, see [Comments on some buttons](Host-options)

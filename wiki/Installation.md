# Installation

## Requirements

- **CPU architecture:** x86_64-v2 (amd64v2) or aarch64 (arm64). Plain x86-64 (v1) is not supported; check with `/lib/ld-linux-x86-64.so.2 --help` (it lists the supported levels). 32-bit systems are not supported.
- **Container runtime:** Docker with Docker Compose. Podman should also work. Running the container inside an LXC container works but is discouraged: install Docker on the host or in a VM.
- **Network:** the default compose file uses `network_mode: host`, which is recommended (CrowdSec and multipath TCP need it). NPMpro then listens on:
  - 80/tcp for HTTP (and the HTTP challenge of Let's Encrypt)
  - 443/tcp and 443/udp for HTTPS and HTTP/3
  - 81/tcp for the web UI (`NPM_PORT`)
- **For public certificates:** a domain whose DNS points to your server, and ports 80 and 443 forwarded to it. Without port 80 use the DNS challenge (see [Usage](Usage#certificates)).
- **Database:** nothing extra. NPMpro uses SQLite in its data folder. MariaDB/MySQL and PostgreSQL may work but are unsupported and not recommended.

## Install with Docker Compose

1. Download the [compose.yaml](https://raw.githubusercontent.com/TheBlackBush/NPMpro/refs/heads/develop/compose.yaml) of the repository into an empty folder (or paste its content into a Portainer stack).
2. Check the volume: `/opt/npmpro:/data` keeps all NPMpro data in `/opt/npmpro` on the host. Change the host path if you want.
3. Set `TZ` to your time zone. Set in `compose.yaml`, it wins over the Time zone setting (Settings, Advanced), which then shows "Set by TZ". To choose the time zone in the web UI instead (default UTC), comment `TZ` out and keep at least one other active variable (compose refuses an empty `environment:` list), or remove the `environment:` key.
4. Consider setting `COOKIE_SECRET` to a long random string: without it every restart signs all users out. Leave the other variables commented out for now. Most of them are settings in the web UI; a variable you set wins over the UI and locks the field. The file lists every supported variable with its default.
5. Start it:
   ```bash
   docker compose up -d
   docker logs -f npmpro
   ```
6. Open `https://<server-ip>:81`. Your browser warns about the certificate: the web UI uses a generated placeholder certificate until you choose a default certificate in Settings, Certificates & TLS.
7. Create the admin account on the setup page. To create it without the setup page (automated installs), set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` before the first start and remove them afterwards.

Images: `docker.io/blackbush/npmpro` or `ghcr.io/theblackbush/npmpro`, tags `latest`, `develop` and version tags such as `1.0.0`.

## Capabilities

The compose file drops all capabilities and adds back only `NET_BIND_SERVICE` and `SETGID`. Uncomment more in `cap_add` when you use a feature that needs them (the comments in `compose.yaml` name them): `BPF`, `PERFMON` and `NET_ADMIN` for `NGINX_QUIC_BPF`; `SETUID`, `CHOWN`, `FOWNER` and `DAC_OVERRIDE` when you change `PUID`/`PGID` (`SETUID` also for the built-in php-fpm); `NET_RAW` for `ping` inside the container.

Do not set `user:` for the container. It must start as root and drops to `PUID`/`PGID` itself.

## Changing variables later

Edit `compose.yaml` and run `docker compose up -d`: Compose recreates the container. A plain restart does not pick up changed variables. Settings that are marked "Restart required" in the UI (Time zone, GoAccess) are the exception: they are saved in the UI and applied by `docker restart npmpro`.

Variables can also be put into `/opt/npmpro/.env` (the `.env` file in the data folder). After changing it, recreate the container; a restart after a change of this file is refused.

## Reaching the web UI through a domain

To open the web UI with a domain and a real certificate, either choose that certificate as the default certificate (Settings, Certificates & TLS, it is used on the web UI port), or create a proxy host for the domain that forwards to `127.0.0.1` port `81` with the scheme **https** (the web UI only speaks https).

## Next steps

- [Usage](Usage) for your first hosts and certificates
- [CrowdSec](CrowdSec) to block attackers
- [Forward authentication](Forward-Authentication) to put a login in front of your services
- [Troubleshooting](Troubleshooting) when the container does not start

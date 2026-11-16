# Installation on Unraid

NPMpro has an Unraid template, `unraid-npmpro.xml` in the repository. It starts the container with bridge networking, the ports 81, 8080 and 8443, the data in `/mnt/user/appdata/npmpro` and the same reduced capabilities as `compose.yaml`. Until the first release the template uses the `develop` image.

## Install

**From the Apps tab** (once NPMpro is listed in Community Applications): Apps, search for NPMpro, Install.

**From the template file** (works now): open a terminal on the Unraid server (the `>_` icon) and run

```sh
wget -O /boot/config/plugins/dockerMan/templates-user/my-NPMpro.xml https://raw.githubusercontent.com/TheBlackBush/NPMpro/develop/unraid-npmpro.xml
```

Then Docker, Add Container, Template: choose NPMpro under User templates. Check the fields (below) and Apply.

Until the first release the container's icon stays empty: the template points the icon (and its own address) at the `main` branch, which gets these files with that release. Everything else works.

## The fields

| Field | Default | What it is |
|---|---|---|
| Web UI port | 81 | The web UI, https only. |
| HTTP port | 8080 | Container port 80: HTTP for your hosts and the Let's Encrypt HTTP challenge. |
| HTTPS port | 8443 | Container port 443 over tcp: HTTPS for your hosts. |
| HTTP/3 port | 8443 | Container port 443 over udp: HTTP/3. Keep it equal to the HTTPS port. |
| Appdata | `/mnt/user/appdata/npmpro` | All NPMpro data (database, certificates, configs, logs). |
| PUID, PGID | 99, 100 | The user and group NPMpro runs as (`nobody` and `users` on Unraid). |

Unraid passes the server's time zone to every container as `TZ`, so NPMpro uses it; it then also shows as set by the environment in Settings, Advanced, Time zone.

Show more settings for the advanced ones: `COOKIE_SECRET` (set a long random value, `openssl rand -hex 32`, so a restart or update does not sign everyone out, see [Configuration](Configuration#cookie_secret)), `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` (the first admin without the setup page, first start only), their `_FILE` forms and the Secrets folder (see below). Unraid passes an empty field as an empty variable, and NPMpro treats an empty variable as not set.

Change only the left side of a port (the host port): the container keeps listening on 81, 80 and 443, and NPMpro needs no variable for the outside ports.

## First start

Open the WebUI from the container's menu (`https://<server-ip>:81`). Your browser warns about the certificate: the web UI uses a generated placeholder certificate until you choose a default certificate in Settings, Certificates & TLS. Create the admin account on the setup page.

## Ports, your router and HTTP/3

Forward the ports of your router to the Unraid server: 80/tcp to 8080, 443/tcp to 8443 and 443/udp to 8443 (HTTP/3). Visitors then use the normal ports, and NPMpro's redirects (HTTP to HTTPS) and its HTTP/3 announcement (`Alt-Svc`) name the port the visitor used: none for 80 and 443. When you open a host directly on the server, use `https://<host>:8443`: HTTP/3 is then announced on 8443. Opening `http://<host>:8080` redirects to `https://<host>:8080`, which is the HTTP port and fails, so open the HTTPS port directly in that case.

With bridge networking NPMpro sees the real client IP for connections from other machines. Connections from the Unraid server itself, and from containers on the same server that reach it through the server's IP, may show a Docker address instead.

## br0: its own IP and the real ports

For the real ports 80 and 443 (no router port mapping needed) give NPMpro its own IP: edit the container, set Network Type to br0 (or another custom network, such as a VLAN), and set Fixed IP address. The port fields then do not apply: NPMpro listens on 80, 443 (tcp and udp) and 81 at that IP. Unraid's own web UI keeps the server's IP, so there is no clash.

On a custom network the Unraid server cannot reach the container, and the container cannot reach the server's IP, unless Settings, Docker, "Host access to custom networks" is enabled (advanced view, Docker stopped). Enable it when NPMpro proxies to containers on the server's IP.

## Capabilities

The template's Extra Parameters (advanced view) drop all capabilities and add back `NET_BIND_SERVICE`, `SETGID`, `SETUID` and `CHOWN`, like `compose.yaml`, plus `FOWNER` and `DAC_OVERRIDE`, which NPMpro needs because the template sets `PUID` and `PGID`. `no-new-privileges` is on. Add more only for a feature that needs it, see [Installation](Installation#capabilities). Do not turn on Privileged.

With `PUID` 99 and `PGID` 100 (Unraid's usual `nobody:users`) the appdata files belong to the same user as every other app's, so shares and backup tools read them as usual. NPMpro then runs as that user, nginx's workers included, so a worker shares its user with the data folder. Leave `PUID` and `PGID` empty for a stricter split: NPMpro then starts as root inside the container and runs nginx's workers as a separate user, but the appdata files belong to root on the server.

## Secrets from files

A value in a field is stored in the template on the flash drive and shown by `docker inspect`. To keep `COOKIE_SECRET` or the first admin's password out of both, put it in a file:

```sh
mkdir -p /mnt/user/appdata/npmpro-secrets
(umask 077 && openssl rand -hex 32 > /mnt/user/appdata/npmpro-secrets/cookie_secret)
```

Then, in the advanced fields, set Secrets folder to `/mnt/user/appdata/npmpro-secrets` and `COOKIE_SECRET_FILE` to `/run/secrets/cookie_secret`, and leave `COOKIE_SECRET` empty (set the value or its `_FILE` form, never both). Keep the folder outside the Appdata folder; the files must be readable by root (created in the Unraid terminal they are owned by root with mode 600). The rules are in [Secrets from files](Configuration#secrets-from-files).

## Other variables

The template has only the fields above. Every other variable (`ACME_EMAIL`, `TRUST_IP`, `LOGROTATE`, `GOA`, ...) is in [Configuration](Configuration); most are settings in the web UI too, and a variable you set wins over the UI and locks the field. To add one: edit the container, Add another Path, Port, Variable, Label or Device, Config Type Variable, the name as Key and the value.

## Updating

Docker, Check for Updates, then apply the update: Unraid pulls the new image and recreates the container with the same fields; the data in the Appdata folder stays. Read the [Upgrade notes](Upgrade-notes) first. From the first release on, the template uses the `latest` image; until then change the Repository field from `ghcr.io/theblackbush/npmpro:develop` to `ghcr.io/theblackbush/npmpro:latest` yourself once it exists.

An existing NPMpro data folder works as it is: point Appdata at it.

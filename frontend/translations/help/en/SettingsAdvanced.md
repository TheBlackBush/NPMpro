## Advanced

Settings that change how NPMpro behaves in small ways.

A variable set on the container wins over the UI and locks the field (the field shows a lock badge such as "Set by TZ"). Use the UI for anything not set in the container.

- **Time zone**: the time zone of the container. It sets the times in logs, the GoAccess report and scheduled jobs such as scheduled backups. Use a name like `Europe/Berlin`. Default: `UTC`. Variable: `TZ`. Applies after a container restart: saving stores it, and the section lists it under "Restart the container to apply".
- **Format nginx configs**: formats the configs NPMpro writes, with nginxbeautifier. Turn it off if it fails on non-standard custom or advanced configs. Default: on. Variable: `DISABLE_NGINX_BEAUTIFIER` (inverted: `true` turns formatting off). Applies at once.
- **Gravatar profile pictures**: shows the Gravatar picture of users who have no uploaded avatar. To fetch a picture, NPMpro sends a hash of the user's email address to Gravatar, so turn it off if that matters to you. Default: on. Variable: `DISABLE_GRAVATAR` (inverted: `true` turns it off). Applies at once; a user's picture changes at their next profile save, and pictures already fetched stay until then.

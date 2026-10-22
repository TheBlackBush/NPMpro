# Certbot dns-plugins

This file contains info about available Certbot DNS plugins.
This only works for plugins which use the standard argument structure, so:
`--authenticator <plugin-name> --<plugin-name>-credentials <FILE> --<plugin-name>-propagation-seconds <number>`

File Structure:

```json
{
  "cloudflare": {
    "name": "Name displayed to the user",
    "package_name": "Package name in PyPi repo",
    "credentials": "Template of the credentials file",
    "full_plugin_name": "The full plugin name as used in the commandline with certbot, e.g. 'dns-njalla'"
  },
  ...
}
```

## Saved credential fields

Field definitions for the DNS credential form live in `dns-fields.json`. Its keys must match the variable names in the plugin's INI template in `dns-plugins.json`; a unit test (`backend/test/dns-credential-values.test.js`) checks this. Providers without an entry in `dns-fields.json` (e.g. Google, TransIP) use a plain INI text box instead.

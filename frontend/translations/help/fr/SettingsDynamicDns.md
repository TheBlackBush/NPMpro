## DNS dynamique

Comment NPMpro garde les enregistrements de l'onglet DNS dynamique (Certificats) pointés vers son adresse publique. Rien n'est vérifié tant qu'un enregistrement n'est pas activé.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas du type « Défini par DDNS_PERIOD »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur.

- **Vérifier toutes les**: la fréquence de vérification des enregistrements, de `1m` à `24h` (par exemple `5m` ou `1h30m`). Par défaut: `5m`. Variable: `DDNS_PERIOD`. Une modification redémarre le minuteur.
- **Délai de repos**: le temps minimal entre deux écritures d'un même enregistrement, dans le même format. Par défaut: `5m`. Variable: `DDNS_COOLDOWN`.
- **Services d'adresse IPv4** et **Services d'adresse IPv6**: des URL `https://` qui répondent avec l'adresse publique. Une nouvelle adresse n'est écrite que si deux services concordent. Les services IPv6 ne sont interrogés que tant qu'un enregistrement activé a besoin d'IPv6. Variables: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (séparées par des espaces). Un service dont l'adresse n'est pas autorisée à être appelée par le serveur (adresse privée ou locale) est refusé.
- **Serveurs DNS**: les serveurs utilisés pour résoudre les services d'adresse et les fournisseurs. Vide : les résolveurs du conteneur. Une adresse IPv4, ou une adresse IPv6 entre crochets, avec un port facultatif. Variable: `DDNS_RESOLVER` (séparés par des espaces).

Les enregistrements s'ajoutent dans l'onglet DNS dynamique avec un identifiant DNS d'un fournisseur capable de mettre à jour des enregistrements.

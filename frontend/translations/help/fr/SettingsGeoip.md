## GeoIP

NPMpro télécharge lui-même les bases gratuites MaxMind GeoLite2 et recherche les pays et les réseaux sur votre serveur, de sorte que les IP des visiteurs ne sont jamais envoyées nulle part. Vous n'avez pas besoin d'un conteneur geoipupdate séparé. Les bases alimentent la carte et les listes de la Surveillance, GoAccess et les règles de pays de nginx.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche « Défini par l'environnement »). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur. L'enregistrement lance le téléchargement en arrière-plan, et l'état ci-dessous est mis à jour quand il est terminé.

### Compte MaxMind

Il vous faut un compte MaxMind gratuit et une clé de licence (dans MaxMind : Account, Manage license keys). Un lien d'inscription se trouve sur la page.

- **ID de compte** : variable `GEOIP_ACCOUNT_ID`.
- **Clé de licence** : stockée chiffrée et plus jamais affichée. Si la clé enregistrée ne peut pas être déchiffrée, saisissez-la de nouveau. Variable : `GEOIP_LICENSE_KEY`.

### Bases de données

- **GeoLite2 Country** : les pays pour la carte, les listes de pays et les règles de pays de nginx. Activé par défaut.
- **GeoLite2 ASN** : les réseaux (numéro et nom d'AS) pour les listes de réseaux. Activé par défaut.
- **GeoLite2 City** : facultatif, les villes pour GoAccess. Un téléchargement bien plus volumineux. Désactivé par défaut.

Variable : `GEOIP_EDITIONS`, séparées par des espaces, par exemple `GeoLite2-Country GeoLite2-ASN`. Sans base sélectionnée, rien n'est téléchargé ni mis à jour, et les bases déjà téléchargées sont conservées.

### État

Affiche la dernière mise à jour et la dernière erreur. NPMpro met à jour les bases quand vous changez le compte ou les bases, quand vous cliquez sur **Mettre à jour maintenant**, et automatiquement tous les 3 jours. Une mise à jour automatique échouée est retentée au bout de 24 heures. **Mettre à jour maintenant** demande un ID de compte et une clé de licence enregistrés.

Sans bases, la carte et les listes de pays et de réseaux sont masquées ; le reste fonctionne.

Plus dans le wiki : Monitoring.

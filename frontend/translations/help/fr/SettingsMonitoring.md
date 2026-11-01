## Journaux et surveillance

Les fichiers journaux, le rapport de journaux GoAccess et les statistiques de trafic derrière la page Surveillance.

Une variable définie sur le conteneur l'emporte sur l'interface et verrouille le champ (le champ affiche un badge cadenas comme « Défini par LOGROTATE », ou « Défini par l'environnement » pour les statistiques). Utilisez l'interface pour tout ce qui n'est pas défini dans le conteneur. Les paramètres marqués « Redémarrage requis » sont enregistrés tout de suite mais lus au démarrage du conteneur ; la section les liste alors sous « Redémarrez le conteneur pour appliquer ».

### Fichiers journaux

- **Écrire les fichiers journaux** : écrit les journaux d'erreurs, de flux et d'accès de nginx dans `/data/nginx/logs` et les fait tourner chaque jour. Par défaut : désactivé. Variable : `LOGROTATE`. S'applique après le rechargement de nginx que lance l'enregistrement. Reste activé tant que GoAccess fonctionne.
- **Rotations de journaux conservées** : combien de fichiers journaux archivés sont conservés avant que le plus ancien soit supprimé, de 1 à 1000. Par défaut : 3. Variable : `LOGROTATIONS`. S'applique immédiatement.

### GoAccess

- **Rapport GoAccess** : lance GoAccess, un rapport de journaux web pour les administrateurs, sous `/goaccess` de l'interface web. Par défaut : désactivé. Variable : `GOA`. S'applique après un redémarrage du conteneur. Il n'active pas les statistiques de trafic.

Quand le rapport est activé, ces options s'affichent. Toutes s'appliquent après un redémarrage du conteneur. Une seule variable, `GOACLA`, les remplace toutes par vos propres options GoAccess et les verrouille.

- **Conserver les données du rapport** : 1 à 366 jours. Par défaut : 30.
- **Anonymiser les IP des visiteurs** : Désactivé, Niveau 1 (par défaut), Niveau 2 (fort) ou Niveau 3 (pointilleux). Le niveau 1 masque le dernier octet IPv4 (les 64 derniers bits d'IPv6), le niveau 2 deux octets (80 bits), le niveau 3 trois octets (96 bits).
- **Supprimer les chaînes de requête** : retire les chaînes de requête des URL du rapport, de sorte que les jetons dans les URL ne sont pas stockés. Par défaut : activé.
- **Versions complètes des systèmes d'exploitation** : affiche la version complète, pas seulement la famille. Par défaut : activé.
- **Résoudre les noms d'hôtes** : recherche les noms d'hôte des IP des visiteurs. Cela envoie des requêtes DNS. Par défaut : activé.

### Surveillance

Ils pilotent l'onglet Trafic de la page Surveillance. Tous s'appliquent immédiatement à l'enregistrement. Variables : `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Statistiques de trafic** : lit le journal d'accès de nginx et compte les requêtes par hôte, statut, pays et réseau. Par défaut : désactivé. La désactivation arrête le nouveau comptage ; les statistiques stockées restent jusqu'à expiration, sauf si vous cochez « Supprimer aussi les statistiques stockées » dans la boîte de dialogue.
- **Conserver les statistiques pendant** : 7 à 365 jours. Par défaut : 30. Les données par minute sont conservées 24 heures, les données horaires pendant ce nombre de jours.
- **Afficher les IP des visiteurs** : stocke les IP des visiteurs par heure pour lister les IP les plus fréquentes. Par défaut : désactivé, par respect de la vie privée. La désactivation supprime les IP stockées.
- **Compter les visiteurs uniques** : stocke un hachage à clé de chaque IP de visiteur par hôte et par jour pour compter les visiteurs uniques. Par défaut : désactivé. La désactivation supprime les hachages.
- **Limite de visiteurs par hôte et par jour** : 1000 à 1000000. Par défaut : 100000. Un hôte qui l'atteint cesse de compter les nouveaux visiteurs ce jour-là et affiche un signe plus.

Les pays et les réseaux demandent les bases GeoIP (Paramètres, GeoIP).

Plus dans le wiki : Monitoring.

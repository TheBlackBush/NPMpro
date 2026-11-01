## Environnement

Une liste en lecture seule des variables que NPMpro lit au démarrage du conteneur. Vous ne pouvez pas les modifier ici. Pour en changer une, modifiez votre fichier compose ou le modèle de votre conteneur et recréez le conteneur.

Les valeurs des mots de passe, adresses e-mail et clés ne sont jamais affichées. Vous voyez seulement si elles sont définies ou non.

- **Paramètres définis par des variables d'environnement** : les paramètres qu'une variable verrouille actuellement dans Paramètres, avec la variable et la section. Supprimez la variable pour gérer de nouveau ce paramètre dans l'interface.
- **Groupes de variables** : les variables de démarrage comme les ports, liaisons, utilisateurs, commutateurs TLS et nginx, modules et PHP, la base de données et le premier démarrage, et le compte de certificats. Chaque ligne affiche la variable, sa valeur ou sa valeur par défaut, un état (défini ou non défini) et une description. Certaines variables sont aussi des paramètres ; leur ligne indique « paramètre ».

Plus dans le wiki : Configuration.

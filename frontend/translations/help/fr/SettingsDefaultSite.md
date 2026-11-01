## Site par défaut

Le site par défaut est ce que nginx répond quand un visiteur atteint NPMpro avec un nom d'hôte qu'aucun hôte n'utilise, ou avec l'adresse IP du serveur. Choisissez ici la réponse. Elle s'applique à tous les noms inconnus.

L'enregistrement teste d'abord le nouveau choix avec nginx. Si le test échoue, rien n'est enregistré, le site par défaut précédent reste et l'erreur nginx figure dans le journal du conteneur.

- **Page de félicitations** (par défaut) : affiche la page d'accueil de NPMpro.
- **Page 404** : répond avec une page 404 Not Found.
- **Aucune réponse (444)** : ferme la connexion sans aucune réponse. Utilisez-le pour ne rien montrer aux scanners. Les requêtes HTTPS pour des noms inconnus sont refusées pendant la négociation TLS.
- **Redirection** : envoie les visiteurs vers une autre adresse avec une redirection temporaire (302). Saisissez une URL complète `http://` ou `https://` sans espaces, guillemets ni `; { } #`, jusqu'à 255 caractères.
- **HTML personnalisé** : affiche votre propre page HTML. Le **Code de statut HTTP** en dessous est facultatif, de 400 à 599. Laissez-le vide pour 200 (OK).

Pour tous les choix sauf Aucune réponse, les requêtes vers des noms inconnus en HTTP simple sont d'abord redirigées vers HTTPS, et les requêtes HTTPS utilisent le certificat choisi comme **Certificat par défaut** dans Paramètres, Certificats et TLS.

Cette section n'a pas de variables d'environnement, donc la modification s'applique à l'enregistrement.

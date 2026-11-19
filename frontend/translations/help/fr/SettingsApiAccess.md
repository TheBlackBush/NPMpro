## Accès API

Tous les jetons API de tous les utilisateurs. Seuls les administrateurs voient cette page.

Les jetons sont créés par leurs propriétaires dans le menu utilisateur, sous **Jetons API**. Vous voyez ici chaque jeton avec son propriétaire, ses permissions, sa date d'expiration, sa dernière utilisation et sa date de création.

- **Révoquer** arrête un jeton immédiatement. Les scripts et assistants IA qui l'utilisent reçoivent ensuite une erreur d'authentification.
- Un jeton n'a jamais plus de permissions que son propriétaire. Le jeton d'un administrateur agit en administrateur uniquement avec son interrupteur **Administrateur**, et aucun jeton ne gère les utilisateurs.
- La création, la révocation, l'expiration et la première utilisation d'un jeton sont inscrites dans le journal d'audit, avec le nom du jeton à côté de l'utilisateur.

**Documentation de l'API** ouvre dans un nouvel onglet la référence de l'API de chaque point de terminaison et indique l'en-tête dans lequel un jeton est envoyé. **Serveur MCP** affiche le point de terminaison, la configuration pour Claude Code et pour Claude Desktop et les autres clients, ainsi que les outils qu'un jeton peut utiliser.

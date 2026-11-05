## Journaux d'audit

Un historique de qui a changé quoi. Seuls les administrateurs le voient.

Chaque entrée indique l'utilisateur, l'objet et l'action. Sont consignés :

- **Créé**, **Mis à jour**, **Supprimé**, **Activé** et **Désactivé** pour les hôtes proxy, les hôtes de redirection, les hôtes 404, les streams, les listes d'accès, les certificats, les identifiants DNS, les planifications de sauvegarde, les utilisateurs et les paramètres.
- Sauvegardes : **Sauvegarde réussie** et **Échec de la sauvegarde** pour les exécutions de sauvegardes planifiées.
- Déplacements de base de données : **Déplacé** et **Échec du déplacement**.

Les entrées les plus récentes viennent en premier. **Charger plus** affiche les 50 suivantes, et le nombre sous la liste indique combien sont chargées sur le total.

### Retrouver une entrée

- **Rechercher** parcourt les détails de toutes les entrées : un nom de domaine ou une adresse e-mail retrouve donc les entrées correspondantes.
- **Type d'objet**, **Action** et **Utilisateur** restreignent la liste. Ils se combinent entre eux et avec la recherche.
- Quand un filtre ou une recherche est actif, la liste indique combien d'entrées sont affichées. **Effacer les filtres** les retire tous.

### Détails

Le bouton en forme d'œil d'une ligne (**Voir les détails**) ouvre l'entrée : l'utilisateur, ce qui s'est passé et les données enregistrées avec. Pour une modification, il s'agit de l'objet tel qu'il a été enregistré. Les longues valeurs passent à la ligne, et la fenêtre défile.

Un utilisateur supprimé depuis apparaît comme **Utilisateur supprimé**. NPMpro ne supprime jamais les entrées de lui-même, et le journal d'audit ne fait pas partie d'une sauvegarde.

Plus dans le wiki : Usage (Audit Logs).

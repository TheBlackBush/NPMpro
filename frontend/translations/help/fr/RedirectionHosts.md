## Qu'est-ce qu'un hôte de redirection ?

Un hôte de redirection envoie les visiteurs d'un domaine vers une autre adresse. Utilisez-le quand un site change de domaine et que les anciens liens doivent continuer à fonctionner, ou pour envoyer `www` vers le nom principal.

Utilisez **Dupliquer** dans le menu de l'hôte pour copier un hôte dans une nouvelle fenêtre d'ajout. La copie démarre sans les noms de domaine, car un domaine ne peut appartenir qu'à un seul hôte activé.

### Détails

- **Noms de domaine** : les noms qui sont redirigés. Obligatoire. Les jokers ne sont autorisés pour un nouveau certificat qu'avec le challenge DNS.
- **Schéma** : le schéma de la cible. « conserver (identique à la requête) » est la valeur par défaut et garde `http` ou `https` de la visite. Ou choisissez `http` ou `https`.
- **Domaine de redirection** : le domaine vers lequel les visiteurs sont envoyés, par exemple `example.com`. Obligatoire.
- **Code HTTP** : le code de réponse. Par défaut 301 Moved permanently. Autres choix : 302 Moved temporarily, 303 See other, 307 Temporary redirect et 308 Permanent redirect. Utilisez 301 ou 308 quand le déménagement est définitif ; les navigateurs et les moteurs de recherche s'en souviennent.
- **Groupe** : une étiquette libre qui garde les longues listes en ordre. Choisissez-en une déjà utilisée ou saisissez un nouveau nom.
- **Préserver le chemin** (désactivé par défaut) : ajoute le chemin et la requête d'origine à la cible. Avec cette option, `old.example/a?b=1` va vers `new.example/a?b=1`. Sans elle, chaque visiteur arrive au début de la cible.

### TLS

- **Certificat TLS** : Aucun, Demander un nouveau certificat, ou un certificat existant. Les options ci-dessous demandent un certificat.
- **Certificat mTLS** : une autorité de certification de clients. **Rendre mTLS facultatif** laisse entrer les visiteurs sans certificat client.
- **Forcer HTTPS** : redirige d'abord HTTP vers HTTPS.
- **Prise en charge de HTTP/3** : autorise HTTP/3 (QUIC).
- **HSTS activé (2 ans)** : demande Forcer HTTPS. **HSTS sous-domaines + preload** demande HSTS.
- Pour un nouveau certificat : **Réutiliser la clé (déconseillé)** et **Utiliser le challenge DNS**, avec fournisseur, identifiants et secondes de propagation.

Toutes les options TLS sont désactivées par défaut.

### Avancé

Configuration nginx personnalisée ajoutée dans le bloc server de l'hôte. Seuls les administrateurs peuvent la modifier ; les autres utilisateurs la voient en lecture seule.

Plus dans le wiki : Host options.

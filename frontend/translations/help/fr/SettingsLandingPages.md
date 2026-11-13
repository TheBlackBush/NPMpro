## Pages d'accueil

Les pages que voient les visiteurs à la place d'un site : quand rien n'est configuré pour une adresse, qu'une page est introuvable, que le serveur derrière un hôte ne répond pas, qu'une liste d'accès les refuse, qu'un hôte est en maintenance, qu'un certificat est absent, ou que CrowdSec les bloque ou les vérifie. Chaque page s'affiche dans la langue du navigateur du visiteur, en clair et en sombre.

### Page par défaut

Ce que montre une adresse sans hôte : la **Page de félicitations**, la **Page 404**, **Aucune réponse (444)**, une **Redirection** ou votre propre **HTML personnalisé**.

### Pages globales

Pour chaque page : sa page NPMpro (par exemple **Page introuvable** ou **Page « Accès refusé »**) ou une **Page personnalisée**. Une page personnalisée est un fichier HTML (1 MB au plus, UTF-8) avec ses styles et ses images à l'intérieur ; collez-le ou utilisez **Téléverser un .html**. Elle peut afficher l'IP du visiteur, l'heure, le code d'état et le nom d'hôte avec `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` et `host` ; les autres inclusions côté serveur sont refusées.

Les hôtes proxy, les hôtes 404 et les listes d'accès utilisent ces pages sauf s'ils choisissent les leurs (l'onglet **Pages** d'un hôte proxy, le champ **Page** d'un hôte 404, **Refusé** d'une liste d'accès).

**Aperçu** ouvre la page enregistrée dans un nouvel onglet avec des valeurs d'exemple.

### CrowdSec

Paramètres, CrowdSec décide si un blocage affiche une page, redirige ou répond seulement par un code d'état ; cette section décide de l'aspect des pages de blocage et de captcha.

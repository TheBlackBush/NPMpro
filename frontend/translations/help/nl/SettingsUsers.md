## Gebruikers

De mensen die zich bij deze NPMpro kunnen aanmelden. Alleen beheerders zien deze lijst. Mensen kunnen zich ook aanmelden met een OIDC-provider, in te stellen onder Instellingen, Authenticatie.

De lijst toont naam, e-mailadres, rollen en status van elke gebruiker. Zoek op naam of e-mailadres en sorteer op een kolom.

### Een gebruiker toevoegen of bewerken

**Gebruiker toevoegen** vraagt om de **Volledige naam** en het **E-mailadres**. Bewerken opent hetzelfde venster, waarin u ook de avatar van de gebruiker kunt uploaden of verwijderen. Onder **Opties**:

- **Beheerder**: volledige toegang, ook tot Instellingen, Gebruikers en Logboeken. Zonder deze optie is de gebruiker een Standaardgebruiker, beperkt door de machtigingen hieronder.
- **Uitgeschakeld**: de gebruiker kan zich niet meer aanmelden en zijn openstaande sessies eindigen.

U kunt uw eigen rollen niet wijzigen en uzelf niet uitschakelen of verwijderen, en uw eigen rij biedt alleen Bewerken.

### Rijmenu

Voor de andere accounts:

- **Machtigingen**: zie hieronder.
- **Wachtwoord instellen**: stelt een nieuw wachtwoord in. Alle andere apparaten van die gebruiker worden afgemeld.
- **MFA herstellen**: alleen voor gebruikers met MFA. Het schakelt MFA uit zonder herstelcode en de gebruiker kan het opnieuw instellen.
- **Sessies intrekken**: meldt de gebruiker af op alle apparaten.
- **Uitschakelen** of **Inschakelen**: hetzelfde als de optie **Uitgeschakeld**.
- **Verwijderen**: verwijdert het account. De bijbehorende items in de Logboeken blijven staan.

### Machtigingen

Kies voor een Standaardgebruiker per onderdeel (Proxyhosts, Omgeleide Hosts, 404-Hosts, Streams, Toegangslijsten, Certificaten): **Beheren**, **Alleen weergeven** of **Verborgen**. **Zichtbaarheid** bepaalt of de gebruiker **Alle items** of **Alleen aangemaakte items** ziet.

Een keuze schakelt ook in wat het onderdeel nodig heeft: Proxyhosts hebben Toegangslijsten en Certificaten nodig, en Verborgen is niet beschikbaar zolang een ander onderdeel dit nodig heeft. Beheerders hebben overal toegang toe, dus voor hen wordt alleen de zichtbaarheid van items aangeboden.

Meer in de wiki: Usage (Users and permissions) en Authentication.

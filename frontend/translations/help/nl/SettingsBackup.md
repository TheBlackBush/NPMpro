## Back-up en herstel

Bewaar uw hosts, certificaten, gebruikers en instellingen in een `.npmpro`-bestand en herstel het op deze of een andere NPMpro-instantie. Verkeersstatistieken en logs maken nooit deel uit van een back-up.

### Back-up maken

- **Wat opnemen**: onderdelen zoals hosts, toegangslijsten, certificaten, DNS-inloggegevens, gebruikers, instellingen en eigen bestanden. In het begin zijn alle aangevinkt.
- **Geheimen opnemen**: voegt privésleutels, wachtwoorden, tweestapsgeheimen, DNS-inloggegevens, het OIDC-clientsecret en de GeoIP-licentiesleutel toe. Het bestand wordt versleuteld met een **Wachtwoordzin** van minstens 12 tekens, die u twee keer invoert. NPMpro slaat haar niet op, dus zonder haar kan de back-up niet worden hersteld.
- Zonder geheimen is het bestand niet versleuteld en laat het de geheimen weg. Het bevat nog steeds hostnamen, gebruikers en instellingen, dus houd het privé.
- **Downloaden** slaat het bestand op uw computer op. **Bewaren op server** zet het in `/data/backups`.

### Geplande back-ups

Voeg schema's toe die zelf back-ups maken en op de server bewaren.

- **Wanneer**: elke N uur, dagelijks, wekelijks of maandelijks, in de tijdzone van de container.
- **Beveiliging**: **Wachtwoordzin** (overal te herstellen), **Instantiesleutel** (niets om te onthouden, alleen op deze instantie te herstellen) of **Zonder geheimen**.
- **Bewaren**: hoeveel bestanden van dit schema worden bewaard. Oudere worden na elke geslaagde uitvoering verwijderd.
- Een schema kan nu worden uitgevoerd, gepauzeerd, bewerkt of verwijderd. Een mislukte uitvoering wordt getoond bij het schema en op het dashboard.

Geplande back-ups beschermen u tegen foute wijzigingen, niet tegen het verlies van de schijf. Kopieer de bestanden daarvoor naar een andere machine.

### Opgeslagen back-ups

Toont de bestanden op de server. Download, herstel of verwijder ze, of kies **Back-up uploaden**. NPMpro maakt vóór elk herstel, elke samenvoeging en elke databaseverplaatsing een back-up met het label **Automatisch**; die heeft geen wachtwoordzin nodig en is alleen op deze instantie te herstellen.

### Herstel

- **Vervangen** vervangt de gekozen onderdelen op deze instantie door die uit de back-up. Uw eigen account wordt nooit vervangen.
- **Samenvoegen** voegt de items uit de back-up toe en verwijdert niets. Het toont een voorbeeld en laat u bij elk conflict kiezen: overslaan, het bestaande item gebruiken, als nieuw toevoegen of vervangen.

Een herstel wordt teruggedraaid als nginx het resultaat afwijst. Een back-up van een nieuwere NPMpro-versie kan niet worden hersteld. Sommige herstelde instellingen hebben een herstart van de container nodig.

Deze sectie heeft geen omgevingsvariabelen.

Meer in de wiki: Backup-and-restore.

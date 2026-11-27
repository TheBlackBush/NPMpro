## Meldingen

NPMpro verstuurt e-mail via een SMTP-server die je zelf kiest. E-mail wordt nu gebruikt voor de testmail en later voor het opnieuw instellen van wachtwoorden en voor waarschuwingen. De instellingen hier kunnen ook uit containervariabelen komen: een variabele die op de container is gezet gaat voor op de interface en vergrendelt het veld (het veld toont "Ingesteld door omgeving"). Gebruik de interface voor alles wat niet in de container is ingesteld.

### Mailserver

Elke verbinding wordt gecontroleerd zoals andere uitgaande verzoeken: de servernaam moet worden omgezet en lokale en link-local adressen worden geweigerd. E-mail geldt als ingesteld wanneer de host en het afzenderadres zijn ingevuld.

- **Host** en **Poort**: de SMTP-server. Variabelen: `SMTP_HOST`, `SMTP_PORT` (standaard 587).
- **Beveiliging**: **STARTTLS** zet een gewone verbinding om naar een versleutelde (meestal poort 587), **TLS** is vanaf het begin versleuteld (meestal poort 465), **Geen** verstuurt zonder versleuteling. Variabele: `SMTP_SECURITY` (`starttls`, `tls` of `none`).
- **Certificaat controleren**: weigert een server met een ongeldig certificaat. Variabele: `SMTP_VERIFY_TLS` (`false` zet het uit).
- **Gebruiker** en **Wachtwoord**: de login. Het wachtwoord wordt versleuteld opgeslagen en nooit meer getoond; **Verwijderen** wist het, en als het opgeslagen wachtwoord niet kan worden ontsleuteld, typ je het opnieuw. Variabelen: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Afzendernaam** en **Afzenderadres**: hoe e-mail van NPMpro verschijnt. Variabelen: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Antwoordadres**: waar antwoorden naartoe gaan; leeg gebruikt het afzenderadres. Variabele: `SMTP_REPLY_TO`.

Met beveiliging **Geen** en een gebruiker zou het wachtwoord onversleuteld worden verstuurd, dus dat is alleen toegestaan voor een server in je lokale netwerk.

**Testmail verzenden** stuurt een mail met de opgeslagen instellingen naar het adres dat je typt (standaard het jouwe) en toont het antwoord van de server als het mislukt. Sla eerst op: de knop is uitgeschakeld zolang het formulier niet-opgeslagen wijzigingen heeft en verborgen totdat e-mail is ingesteld.

### Waarschuwingsmails

Zichtbaar zodra een mailserver is ingesteld. Mails over problemen die NPMpro detecteert en over wanneer ze zijn opgelost; een probleem dat open blijft, wordt herhaald.

- **Naar beheerders sturen**: elke ingeschakelde beheerder met een geldig adres ontvangt de waarschuwingen.
- **Ook sturen naar**: meer adressen, maximaal 20, bijvoorbeeld een teamlijst. Een geweigerd adres wordt gemarkeerd op zijn chip. Variabele: `ALERT_ADDRESSES` (door komma's gescheiden).
- **Gebeurtenissen**: vink de problemen aan waarover je mail wilt, gegroepeerd per gebied. Een gebeurtenis aanvinken dekt ook het herstel ervan.
- **Herinneren elke (uren)**: hoe lang een probleem stil blijft voordat het opnieuw wordt gemaild; 0 herhaalt het nooit, maximaal 168.

**Een voorbeeld sturen** stuurt direct een voorbeeldwaarschuwing met de opgeslagen instellingen naar iedereen die waarschuwingen zou ontvangen. Sla eerst op: de knop is uitgeschakeld zolang het formulier niet-opgeslagen wijzigingen heeft. Als een verzending mislukt, noemt de melding het adres.

### Links en taal

- **Openbare URL**: het adres waarop mensen NPMpro openen, gebruikt voor de links in mails, bijvoorbeeld `https://npm.example.com`. Alleen HTTPS, geen pad. **Adres van deze browser gebruiken** vult het met het adres van deze pagina als die via HTTPS is geopend. Variabele: `PUBLIC_URL`.
- **Standaardtaal van mails**: de taal van mails voor mensen die er geen hebben gekozen. De interfacetaal van elke gebruiker wordt onthouden en gebruikt voor zijn of haar mails. Variabele: `MAIL_LANGUAGE`.

### Webhooks

Een webhook is een eigen adres dat NPMpro aanroept met een ondertekend HTTP-verzoek wanneer er iets gebeurt, bijvoorbeeld wanneer een certificaat is vernieuwd. Alleen beheerders zien deze kaart.

- **URL**: `https://` naar elke openbare host, of `http://` naar een adres op uw lokale netwerk. Doorverwijzingen worden niet gevolgd. Het adres wordt versleuteld opgeslagen en nooit meer getoond; laat het veld bij bewerken leeg om het te behouden.
- **Gebeurtenissen**: kies de gebeurtenissen die worden verstuurd, of **Alle gebeurtenissen**.
- **Ondertekeningsgeheim**: na het opslaan eenmaal getoond. Bewaar het waar uw ontvanger het leest. **Geheim vernieuwen** maakt een nieuw geheim; het oude blijft nog 24 uur ondertekenen, zodat uw ontvanger kan overstappen.
- **Test versturen**: verstuurt direct een testgebeurtenis en toont de status en de duur. Hij staat niet bij Bezorgingen.
- **Bezorgingen**: de nieuwste gebeurtenissen van de webhook met status, pogingen en het antwoord van de ontvanger. **Opnieuw bezorgen** verstuurt een mislukte bezorging nogmaals, tot 7 dagen na de mislukking.
- Een mislukt verzoek wordt tot 8 keer herhaald in ongeveer 41 uur. Een webhook wordt uitgeschakeld wanneer de ontvanger 410 Gone antwoordt, of wanneer hij opnieuw mislukt na 3 dagen mislukkingen zonder succes. Een uitgeschakelde webhook toont de reden; schakel hem in om hem weer te gebruiken.
- Controleer elk verzoek met een willekeurige Standard Webhooks-bibliotheek, met de ongewijzigde body en de `webhook-id` als idempotentiesleutel.

Meer in de wiki: Configuration.

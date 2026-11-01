## Was ist ein Weiterleitungs-Host?

Ein Weiterleitungs-Host schickt Besucher einer Domain an eine andere Adresse. Verwenden Sie ihn, wenn eine Seite die Domain wechselt und alte Links weiter funktionieren sollen, oder um `www` auf den Hauptnamen umzuleiten.

Verwenden Sie **Klonen** im Menü des Hosts, um einen Host in ein neues Fenster zum Hinzufügen zu kopieren. Die Kopie beginnt ohne die Domainnamen, weil eine Domain nur zu einem aktivierten Host gehören kann.

### Details

- **Domains**: die Namen, die weitergeleitet werden. Erforderlich. Wildcards sind für ein neues Zertifikat nur mit der DNS Challenge erlaubt.
- **Schema**: das Schema des Ziels. „beibehalten (wie in der Anfrage)“ ist der Standard und behält `http` oder `https` des Besuchs bei. Oder wählen Sie `http` oder `https`.
- **Ziel-Domain**: die Domain, an die Besucher geschickt werden, zum Beispiel `example.com`. Erforderlich.
- **HTTP-Code**: der Antwortcode. Standard 301 Moved permanently. Weitere Auswahl: 302 Moved temporarily, 303 See other, 307 Temporary redirect und 308 Permanent redirect. Verwenden Sie 301 oder 308, wenn der Umzug dauerhaft ist; Browser und Suchmaschinen merken sie sich.
- **Gruppe**: ein freies Label, das lange Listen übersichtlich hält. Wählen Sie eine verwendete aus oder tippen Sie einen neuen Namen.
- **Pfad beibehalten** (standardmäßig aus): hängt den ursprünglichen Pfad und die Query an das Ziel an. Damit geht `old.example/a?b=1` an `new.example/a?b=1`. Ohne landet jeder Besucher am Anfang des Ziels.

### TLS

- **TLS-Zertifikate**: Keines, Neues Zertifikat anfordern oder ein vorhandenes. Die Optionen darunter brauchen ein Zertifikat.
- **mTLS-Zertifikat**: eine Zertifizierungsstelle für Clientzertifikate. **mTLS optional machen** lässt Besucher ohne Clientzertifikat herein.
- **Erzwinge HTTPS**: leitet HTTP zuerst auf HTTPS um.
- **HTTP/3-Unterstützung**: erlaubt HTTP/3 (QUIC).
- **HSTS aktiviert (2 Jahre)**: braucht Erzwinge HTTPS. **HSTS für Subdomains + Preload** braucht HSTS.
- Für ein neues Zertifikat: **Schlüssel wiederverwenden (nicht empfohlen)** und **Nutze DNS Challenge**, mit Anbieter, Zugangsdaten und Wartezeit für die Propagierung in Sekunden.

Alle TLS-Optionen sind standardmäßig aus.

### Erweitert

Eigene nginx-Konfiguration, die im Server-Block des Hosts eingefügt wird. Nur Administratoren können sie ändern; andere Benutzer sehen sie schreibgeschützt.

Mehr im Wiki: Host options.

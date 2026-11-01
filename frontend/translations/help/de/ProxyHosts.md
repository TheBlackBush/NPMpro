## Was ist ein Proxy-Host?

Ein Proxy-Host ist die Eingangstür eines Webdienstes. Besucher öffnen Ihre Domain in NPMpro, und NPMpro leitet die Anfrage an den dahinterliegenden Dienst weiter. Er kann auch TLS (HTTPS) für Dienste ergänzen, die selbst keines haben. Proxy-Hosts sind die häufigste Verwendung von NPMpro.

Verwenden Sie **Klonen** im Menü des Hosts, um einen Host in ein neues Fenster zum Hinzufügen zu kopieren. Die Kopie beginnt ohne die Domainnamen, weil eine Domain nur zu einem aktivierten Host gehören kann.

### Details

- **Domains**: die Namen, die Besucher verwenden. Erforderlich. Für ein neues Zertifikat brauchen Wildcards (`*.example.com`) die DNS Challenge.
- **Schema**: wie NPMpro mit dem Dienst spricht: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (Dateien oder PHP aus einem Ordner ausliefern) oder `empty` (kein Upstream). Standard `http://`. Eine Änderung des Schemas schaltet Optionen aus, die nicht dazu passen.
- **Forward Hostname / IP / Pfad**: die Adresse des Dienstes. Sie können einen Unterpfad angeben, zum Beispiel `127.0.0.1/path`. Bei `path` geben Sie stattdessen einen Ordner an. Binden Sie Ihre Dateien unter `/var/www` ein; nur Administratoren können einen Ordner außerhalb davon verwenden. Ein Name, der mit `cu_` beginnt, verweist auf Ihren eigenen nginx-Upstream-Block (siehe Load balancing im Wiki).
- **Ziel-Port**: optional. Bei `path` ist es die PHP-Version.
- **Gruppe**: ein freies Label, das lange Listen übersichtlich hält.
- **Optionen** (alle standardmäßig aus):
  - **noindex-Header senden und einige Bot-User-Agents blockieren**: bittet Suchmaschinen, die Seite nicht zu indexieren, und blockiert einige Crawler.
  - **Crowdsec Appsec deaktivieren**: schaltet CrowdSec AppSec nur für diesen Host ab. Wirkt nur, wenn AppSec eingerichtet ist.
  - **Request Buffering deaktivieren** und **Response Buffering deaktivieren**: für http- und https-Upstreams. Lassen Sie das Buffering an, außer Sie streamen oder laden große Dateien über eine schnelle, stabile Verbindung hoch. Wenn Sie das Request Buffering ausschalten, wird auch AppSec ausgeschaltet.
  - **Komprimierung durch Upstream aktivieren**: lässt den Dienst seine Antworten selbst komprimieren. Lassen Sie es aus, außer der Dienst braucht es. Nicht für `path` und `empty`.
  - **fancyindex aktivieren**: zeigt eine Dateiliste, wenn ein Ordner keine Indexdatei hat. Nur für `path`.
- **X-Frame-Options**: `SAMEORIGIN` (Standard), `DENY`, `none` (entfernt den Header) oder `upstream` (behält, was der Dienst sendet).
- **Auth Request**: setzt eine Anmeldung oder Bot-Prüfung vor den Host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Standard `none`. **Auth-Request-Upstream** ist optional; leer verwendet den Standard aus Einstellungen, Forward-Authentifizierung.
- **Globale Zugriffslisten**: **Öffentlich** (Standard, keine Anmeldung) oder **Benutzerdefiniert**, eine oder mehrere Zugriffslisten.

Websockets sind immer aktiv.

### Benutzerdefinierte Pfade

Eine Location leitet einen Pfad des Hosts (zum Beispiel `/api/`) an einen anderen Dienst weiter. Jede hat **Aktiviert**, einen Pfad mit optionalem Match-Typ (`=`, `~`, `~*`, `^~` oder `@`), ein eigenes Schema, einen eigenen Host, Port, eigene Optionen, einen eigenen Auth Request und eigene Zugriffslisten. Ihre Zugriffsliste kann **Global** sein, dann gelten die Listen des Hosts. Sie erbt den Auth Request des Hosts nicht. Hängen Sie an einen Pfad einen Schrägstrich an, außer Sie wollen Präfix-Matching. Administratoren können mit dem Zahnrad-Button eine eigene nginx-Konfiguration pro Location hinzufügen.

### TLS

- **TLS-Zertifikate**: Keines, Neues Zertifikat anfordern oder ein vorhandenes. Die Optionen darunter brauchen ein Zertifikat.
- **mTLS-Zertifikat**: eine Zertifizierungsstelle für Clientzertifikate. **mTLS optional machen** lässt Besucher ohne Zertifikat herein. **Auth Request bei mTLS überspringen** lässt Besucher mit einem gültigen Zertifikat den Auth Request überspringen.
- **Erzwinge HTTPS** leitet HTTP auf HTTPS um. **HTTP/3-Unterstützung** erlaubt HTTP/3 (QUIC).
- **HSTS aktiviert (2 Jahre)**: braucht Erzwinge HTTPS. **HSTS für Subdomains + Preload** braucht HSTS.
- Für ein neues Zertifikat: **Schlüssel wiederverwenden (nicht empfohlen)** und **Nutze DNS Challenge**, mit Anbieter, Zugangsdaten und Wartezeit für die Propagierung in Sekunden.

### Erweitert

Eigene nginx-Konfiguration für den ganzen Host (Server-Block) und für die Haupt-Location `location /`. Nur Administratoren können sie ändern.

Mehr im Wiki: Host options.

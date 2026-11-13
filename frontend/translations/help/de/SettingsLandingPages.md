## Landing Pages

Die Seiten, die Besucher statt einer Website sehen: wenn für eine Adresse nichts eingerichtet ist, eine Seite nicht gefunden wird, der Server hinter einem Host nicht antwortet, eine Zugriffsliste sie abweist, ein Host in Wartung ist, ein Zertifikat fehlt oder CrowdSec sie blockiert oder prüft. Jede Seite erscheint in der Browsersprache des Besuchers sowie hell und dunkel.

### Standardseite

Was eine Adresse ohne Host zeigt: die **Glückwunschseite**, die **404-Seite**, **Keine Antwort (444)**, eine **Weiterleitung** oder Ihr eigenes **Benutzerdefinierte HTML**.

### Globale Seiten

Für jede Seite: ihre NPMpro-Seite (zum Beispiel **Seite nicht gefunden** oder **Seite „Zugriff verweigert“**) oder eine **Benutzerdefinierte Seite**. Eine benutzerdefinierte Seite ist eine HTML-Datei (höchstens 1 MB, UTF-8) mit ihren Stilen und Bildern darin; fügen Sie sie ein oder nutzen Sie **.html hochladen**. Sie kann die IP des Besuchers, die Zeit, den Statuscode und den Hostnamen mit `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` und `host` anzeigen; andere Server-Side Includes werden abgelehnt.

Proxy-Hosts, 404-Hosts und Zugriffslisten verwenden diese Seiten, sofern sie keine eigenen wählen (der Tab **Seiten** eines Proxy-Hosts, das Feld **Seite** eines 404-Hosts, **Verweigert** einer Zugriffsliste).

**Vorschau** öffnet die gespeicherte Seite mit Beispielwerten in einem neuen Tab.

### CrowdSec

Unter Einstellungen, CrowdSec wird entschieden, ob eine Sperre eine Seite zeigt, weiterleitet oder nur mit einem Statuscode antwortet; dieser Abschnitt bestimmt, wie die Sperr- und Captcha-Seiten aussehen.

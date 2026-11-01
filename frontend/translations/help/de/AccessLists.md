## Was ist eine Zugriffsliste?

Eine Zugriffsliste schützt Proxy-Hosts. Sie kann von Besuchern einen Benutzernamen und ein Passwort verlangen (Basic-Authentifizierung), Besucher nach IP-Adresse zulassen oder sperren oder beides. Das hilft bei Diensten ohne eigene Anmeldung oder wenn Sie unbekannte Clients fernhalten möchten.

Eine Liste kann von mehreren Proxy-Hosts und Locations verwendet werden.

### Details

- **Name**: erforderlich.
- **Eine Bedingung genügt (Satisfy Any)** (standardmäßig aus): Ein Besucher kommt hinein, wenn eine einzige Prüfung zutrifft, eine Regel oder ein gültiger Benutzer. Aus bedeutet, dass beides bestanden werden muss. Außerdem wird ein Auth Request auf diesem Host übersprungen.
- **Authentifizierung an Upstream weiterleiten** (standardmäßig aus): reicht den `Authorization`-Header des Besuchers an den Dienst weiter. Aus hält die Anmeldung innerhalb von NPMpro privat.

### Autorisierungen

Fügen Sie Benutzernamen und Passwörter hinzu. Benutzernamen müssen innerhalb der Liste eindeutig sein und dürfen kein `:` enthalten. Wenn Sie eine Liste bearbeiten, lassen Sie ein gespeichertes Passwort leer, um es zu behalten.

### Regeln

Regeln erlauben oder sperren eine IP-Adresse, einen CIDR-Bereich (`192.168.1.0/24`, `2001:db8::/32`) oder `unix:`. Sie werden in der aufgeführten Reihenfolge angewendet, und die erste Übereinstimmung gewinnt. Setzen Sie spezifische Regeln zuerst. Eine abschließende `all`-Regel beendet die Liste, entweder als Erlauben oder als Sperren; sie wird nur hinzugefügt, wenn es mindestens eine andere Regel gibt. Eine Liste braucht mindestens einen Benutzer oder eine Regel.

### Verwendung bei Proxy-Hosts

Wählen Sie bei einem Proxy-Host die Liste unter **Globale Zugriffslisten** auf dem Tab Details: **Öffentlich** (keine Liste) oder **Benutzerdefiniert**. Eine benutzerdefinierte Location kann **Global** (die Listen des Hosts), **Öffentlich** oder mit **Benutzerdefiniert** eigene Listen verwenden.

Sie können mehrere Listen an einen Host oder eine Location hängen. Sie werden von oben nach unten in der angezeigten Reihenfolge geprüft, und Sie können sie nach oben und unten verschieben. **Eine Bedingung genügt (Satisfy Any)** und **Authentifizierung an Upstream weiterleiten** zählen nur bei der ersten Liste. Mit CrowdSec sehen gesperrte IPs die Sperrseite vor der Passwortabfrage.

Mehr im Wiki: Host options.

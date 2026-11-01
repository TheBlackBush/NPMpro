## Speciális

Beállítások, amelyek apróbb dolgokban módosítják az NPMpro működését.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: TZ"). Amit nem a konténerben állított be, azt a felületen adja meg.

- **Időzóna**: a konténer időzónája. Ez határozza meg a naplókban, a GoAccess jelentésben és az ütemezett feladatokban, például az ütemezett mentésekben szereplő időket. Használjon olyan nevet, mint `Europe/Berlin`. Alapértelmezett: `UTC`. Változó: `TZ`. A konténer újraindítása után lép életbe: a mentés eltárolja, a szakasz pedig felsorolja az "Az alkalmazáshoz indítsa újra a konténert" alatt.
- **Nginx konfigurációk formázása**: az nginxbeautifier segítségével formázza az NPMpro által írt konfigurációkat. Kapcsolja ki, ha nem szabványos egyéni vagy speciális konfigurációkon hibázik. Alapértelmezett: be. Változó: `DISABLE_NGINX_BEAUTIFIER` (fordított: a `true` kikapcsolja a formázást). Azonnal érvényesül.
- **Gravatar profilképek**: megjeleníti a Gravatar-képet azoknak a felhasználóknak, akiknek nincs feltöltött avatarjuk. A kép lekéréséhez az NPMpro a felhasználó e-mail-címének hash-ét küldi a Gravatarnak, ezért kapcsolja ki, ha ez számít Önnek. Alapértelmezett: be. Változó: `DISABLE_GRAVATAR` (fordított: a `true` kikapcsolja). Azonnal érvényesül; a felhasználó képe a következő profilmentésnél változik, a már lekért képek addig megmaradnak.

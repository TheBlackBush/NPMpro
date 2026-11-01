## Naplók és monitorozás

Naplófájlok, a GoAccess naplójelentés és a Monitorozás oldal mögötti forgalmi statisztikák.

A konténeren beállított változó felülírja a felületet, és zárolja a mezőt (a mező zár jelvényt mutat, például "Beállítja: LOGROTATE", a statisztikáknál pedig "Környezeti változó állítja be"). Amit nem a konténerben állított be, azt a felületen adja meg. A "Restart required" jelölésű beállítások azonnal mentődnek, de a konténer indulásakor olvasódnak be; a szakasz ezeket ezután felsorolja az "Az alkalmazáshoz indítsa újra a konténert" alatt.

### Naplófájlok

- **Naplófájlok írása**: az nginx error, stream és access naplóit a `/data/nginx/logs` mappába írja, és naponta rotálja. Alapértelmezett: ki. Változó: `LOGROTATE`. A mentéskor futó nginx-újratöltés után lép életbe. Bekapcsolva marad, amíg a GoAccess fut.
- **Megőrzött naplórotációk**: hány rotált naplófájlt tart meg, mielőtt a legrégebbit törli, 1-1000. Alapértelmezett: 3. Változó: `LOGROTATIONS`. Azonnal érvényesül.

### GoAccess

- **GoAccess jelentés**: elindítja a GoAccesst, egy webes naplójelentést rendszergazdáknak, a webes felület `/goaccess` címén. Alapértelmezett: ki. Változó: `GOA`. A konténer újraindítása után lép életbe. A forgalmi statisztikát nem kapcsolja be.

Bekapcsolt jelentésnél ezek a beállítások jelennek meg. Mind a konténer újraindítása után lép életbe. Egyetlen változó, a `GOACLA`, mindet lecseréli saját GoAccess-beállításaira, és zárolja őket.

- **Jelentésadatok megőrzése**: 1-366 nap. Alapértelmezett: 30.
- **Látogatói IP-k anonimizálása**: Ki, 1. szint (alapértelmezett), 2. szint (erős) vagy 3. szint (pedáns). Az 1. szint az IPv4 utolsó bájtját (IPv6 esetén az utolsó 64 bitet), a 2. szint két bájtot (80 bit), a 3. szint három bájtot (96 bit) rejt el.
- **Lekérdezési karakterláncok elhagyása**: eltávolítja a lekérdezési karakterláncokat a jelentés URL-jeiből, így az URL-ekben lévő tokenek nem tárolódnak. Alapértelmezett: be.
- **Teljes operációsrendszer-verziók**: a teljes verziót mutatja, nem csak a családot. Alapértelmezett: be.
- **Hosztnevek feloldása**: megkeresi a látogatói IP-k hosztneveit. Ehhez DNS-lekérdezéseket küld. Alapértelmezett: be.

### Monitorozás

Ezek a Monitorozás oldal Forgalom lapját vezérlik. Mind mentéskor azonnal érvényesül. Változók: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Forgalmi statisztika**: beolvassa az nginx access naplót, és kérések számát vezeti kiszolgáló, állapot, ország és hálózat szerint. Alapértelmezett: ki. Kikapcsolva leáll az új számlálás; a tárolt statisztikák megmaradnak, amíg el nem évülnek, kivéve ha a párbeszédablakban bejelöli a "A tárolt statisztikák törlése is" lehetőséget.
- **Statisztikák megőrzése**: 7-365 nap. Alapértelmezett: 30. A percenkénti adatokat 24 órán át, az óránkénti adatokat ennyi napig őrzi.
- **Látogatói IP-k megjelenítése**: óránként tárolja a látogatói IP-ket a leggyakoribb IP-k listázásához. Alapértelmezett: ki, a személyes adatok védelme miatt. Kikapcsolva törli a tárolt IP-ket.
- **Egyedi látogatók számlálása**: kiszolgálónként és naponta tárolja minden látogatói IP kulcsolt hash-ét az egyedi látogatók számolásához. Alapértelmezett: ki. Kikapcsolva törli a hash-eket.
- **Látogatói korlát kiszolgálónként és naponta**: 1000-1000000. Alapértelmezett: 100000. Az a kiszolgáló, amely eléri, aznap nem számol új látogatókat, és pluszjelet mutat.

Az országokhoz és hálózatokhoz a GeoIP adatbázisok kellenek (Beállítások, GeoIP).

Továbbiak a wikiben: Monitoring.

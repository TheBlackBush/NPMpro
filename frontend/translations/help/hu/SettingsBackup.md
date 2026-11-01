## Biztonsági mentés és visszaállítás

Mentse el a kiszolgálókat, tanúsítványokat, felhasználókat és beállításokat egy `.npmpro` fájlba, és állítsa vissza ezen vagy egy másik NPMpro példányon. A forgalmi statisztikák és a naplók soha nem részei a mentésnek.

### Biztonsági mentés létrehozása

- **Mit tartalmazzon**: részek, például kiszolgálók, hozzáférési listák, tanúsítványok, DNS hitelesítő adatok, felhasználók, beállítások és egyéni fájlok. Kezdetben mind be van jelölve.
- **Titkos adatok belefoglalása**: hozzáadja a privát kulcsokat, jelszavakat, kétlépcsős azonosítás titkait, a DNS hitelesítő adatok értékeit, az OIDC kliens titkot és a GeoIP licenckulcsot. A fájlt egy legalább 12 karakteres **Jelmondat** titkosítja, amelyet kétszer kell megadnia. Az NPMpro nem tárolja, így nélküle a mentés nem állítható vissza.
- Titkos adatok nélkül a fájl nincs titkosítva, és kihagyja a titkokat. Még így is tartalmaz kiszolgálóneveket, felhasználókat és beállításokat, ezért tartsa bizalmasan.
- A **Letöltés** a számítógépére menti a fájlt. A **Megtartás a szerveren** a `/data/backups` mappában tárolja.

### Ütemezett mentések

Adjon hozzá ütemezéseket, amelyek maguktól készítenek mentést, és a szerveren tárolják.

- **Mikor**: N óránként, naponta, hetente vagy havonta, a konténer időzónájában.
- **Védelem**: **Jelmondat** (bárhol visszaállítható), **Példánykulcs** (nem kell megjegyezni, csak ezen a példányon állítható vissza) vagy **Titkos adatok nélkül**.
- **Megtartás**: az ütemezés hány fájlját tartja meg. A régebbieket minden sikeres futás után törli.
- Az ütemezés azonnal futtatható, szüneteltethető, szerkeszthető vagy törölhető. A sikertelen futás az ütemezésnél és az irányítópulton látszik.

Az ütemezett mentések a hibás módosításoktól védenek, nem a lemez elvesztésétől. Ahhoz másolja a fájlokat másik gépre.

### Tárolt mentések

Felsorolja a szerveren lévő fájlokat. Töltse le, állítsa vissza vagy törölje őket, illetve **Biztonsági mentés feltöltése**. Az NPMpro minden visszaállítás, egyesítés és adatbázis-áthelyezés előtt **Automatikus** mentést készít; ehhez nem kell jelmondat, és csak ezen a példányon állítható vissza.

### Visszaállítás

- A **Csere** a kiválasztott részeket ezen a példányon a mentésben lévőkre cseréli. A saját fiókját soha nem cseréli le.
- Az **Egyesítés** hozzáadja a mentés elemeit, és nem töröl semmit. Előnézetet mutat, és minden ütközésnél választhat: kihagyás, a meglévő elem használata, hozzáadás újként vagy csere.

A visszaállítás visszagörgetődik, ha az nginx elutasítja az eredményt. Újabb NPMpro-verzióból származó mentés nem állítható vissza. Néhány visszaállított beállításhoz a konténer újraindítása kell.

Ennek a szakasznak nincsenek környezeti változói.

Továbbiak a wikiben: Backup-and-restore.

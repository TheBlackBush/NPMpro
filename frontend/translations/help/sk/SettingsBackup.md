## Záloha a obnova

Uložte svojich hostiteľov, certifikáty, používateľov a nastavenia do súboru `.npmpro` a obnovte ich na tejto alebo inej inštancii NPMpro. Štatistiky prevádzky a logy nikdy nie sú súčasťou zálohy.

### Vytvoriť zálohu

- **Čo zahrnúť**: časti ako hostitelia, zoznamy prístupov, certifikáty, DNS prihlasovacie údaje, používatelia, nastavenia a vlastné súbory. Spočiatku sú všetky zaškrtnuté.
- **Zahrnúť tajné údaje**: pridá súkromné kľúče, heslá, tajomstvá dvojfaktorového overenia, hodnoty DNS prihlasovacích údajov, tajný kľúč klienta OIDC a licenčný kľúč GeoIP. Súbor sa zašifruje pomocou **Heslo** s najmenej 12 znakmi, ktoré zadáte dvakrát. NPMpro ho neukladá, takže bez neho sa záloha nedá obnoviť.
- Bez tajných údajov súbor nie je zašifrovaný a tajné údaje vynecháva. Stále obsahuje mená hostiteľov, používateľov a nastavenia, preto ho udržte súkromný.
- **Stiahnuť** uloží súbor do vášho počítača. **Ponechať na serveri** ho uloží do `/data/backups`.

### Plánované zálohy

Pridajte plány, ktoré robia zálohy samy a ukladajú ich na server.

- **Kedy**: každých N hodín, denne, týždenne alebo mesačne, v časovom pásme kontajnera.
- **Ochrana**: **Heslo** (obnova kdekoľvek), **Kľúč inštancie** (nič si nemusíte pamätať, obnova len na tejto inštancii) alebo **Bez tajných údajov**.
- **Ponechať**: koľko súborov tohto plánu sa zachová. Staršie sa po každom úspešnom behu zmažú.
- Plán sa dá spustiť hneď, pozastaviť, upraviť alebo zmazať. Neúspešný beh sa zobrazí pri pláne a na paneli.

Plánované zálohy chránia pred nesprávnymi zmenami, nie pred stratou disku. Na to skopírujte súbory na iný stroj.

### Uložené zálohy

Zobrazí súbory na serveri. Stiahnite, obnovte alebo zmažte ich, alebo **Nahrať zálohu**. NPMpro vytvorí **Automatické** zálohu pred každou obnovou, zlúčením a presunom databázy; nepotrebuje heslo a obnoví sa len na tejto inštancii.

### Obnova

- **Nahradiť** vymení vybrané časti na tejto inštancii za tie zo zálohy. Váš vlastný účet sa nikdy nenahradí.
- **Zlúčiť** pridá položky zo zálohy a nič nemaže. Zobrazí náhľad a pri každom konflikte vás nechá vybrať: preskočiť, použiť existujúcu položku, pridať ako novú alebo nahradiť.

Obnova sa vráti späť, ak nginx výsledok odmietne. Zálohu z novšej verzie NPMpro nemožno obnoviť. Niektoré obnovené nastavenia vyžadujú reštart kontajnera.

Táto sekcia nemá žiadne premenné prostredia.

Viac vo wiki: Backup-and-restore.

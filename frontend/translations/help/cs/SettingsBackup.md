## Záloha a obnova

Uložte své hostitele, certifikáty, uživatele a nastavení do souboru `.npmpro` a obnovte ho na této nebo jiné instanci NPMpro. Statistiky provozu a logy nejsou nikdy součástí zálohy.

### Vytvořit zálohu

- **Co zahrnout**: části jako hostitelé, seznamy přístupů, certifikáty, přihlašovací údaje DNS, uživatelé, nastavení a vlastní soubory. Na začátku jsou všechny zaškrtnuté.
- **Zahrnout tajné údaje**: přidá soukromé klíče, hesla, tajné klíče dvoufázového ověření, hodnoty přihlašovacích údajů DNS, tajný klíč klienta OIDC a licenční klíč GeoIP. Soubor se zašifruje **Heslem** o délce alespoň 12 znaků, které zadáte dvakrát. NPMpro ho neukládá, takže bez něj nelze zálohu obnovit.
- Bez tajných údajů soubor není zašifrován a tajné údaje vynechává. Stále obsahuje názvy hostitelů, uživatele a nastavení, proto ho udržujte v soukromí.
- **Stáhnout** uloží soubor do vašeho počítače. **Ponechat na serveru** ho uloží do `/data/backups`.

### Plánované zálohy

Přidejte plány, které vytvářejí zálohy samy a ukládají je na server.

- **Kdy**: každých N hodin, denně, týdně nebo měsíčně, v časovém pásmu kontejneru.
- **Ochrana**: **Heslo** (obnoví se kdekoli), **Klíč instance** (není co si pamatovat, obnoví se jen na této instanci) nebo **Bez tajných údajů**.
- **Ponechat**: kolik souborů tohoto plánu ponechat. Starší se po každém úspěšném běhu mažou.
- Plán lze spustit hned, pozastavit, upravit nebo smazat. Neúspěšný běh se zobrazí u plánu a na nástěnce.

Plánované zálohy chrání před špatnými změnami, ne před ztrátou disku. K tomu soubory zkopírujte na jiný stroj.

### Uložené zálohy

Vypíše soubory na serveru. Stáhněte je, obnovte nebo smažte, nebo použijte **Nahrát zálohu**. NPMpro vytvoří **Automatické** zálohy před každou obnovou, sloučením a přesunem databáze; nepotřebují heslo a obnovují se jen na této instanci.

### Obnova

- **Nahradit** vymění vybrané části na této instanci za ty ze zálohy. Váš vlastní účet se nikdy nenahrazuje.
- **Sloučit** přidá položky ze zálohy a nic nesmaže. Zobrazí náhled a u každého konfliktu nechá vybrat: přeskočit, použít existující položku, přidat jako novou, nebo nahradit.

Obnova se vrátí zpět, pokud nginx výsledek odmítne. Zálohu z novější verze NPMpro nelze obnovit. Některá obnovená nastavení vyžadují restart kontejneru.

Tato sekce nemá žádné proměnné prostředí.

Více ve wiki: Backup-and-restore.

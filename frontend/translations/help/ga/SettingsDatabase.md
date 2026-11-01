## Bunachar sonraí

An bunachar sonraí ina gcoinníonn NPMpro a óstaigh, teastais, úsáideoirí, logaí agus staitisticí. De réir réamhshocraithe is SQLite é, comhad amháin, agus is é an rogha mholta é. Is féidir leat gach rud a aistriú chuig MySQL, MariaDB, PostgreSQL nó comhad nua SQLite as seo. Ní athraíonn aistriú an bunachar sonraí atá in úsáid.

### Bunachar sonraí in úsáid

Taispeánann an t-inneall agus an leagan, cá bhfuil sé, a mhéid agus **Foinse** an cheangail: **Réamhshocrú** (an comhad SQLite `/data/npmpro/database.sqlite`), **Comhad socruithe an bhunachair sonraí** (`/data/npmpro/database.json`, scríofa ag aistriú) nó **Timpeallacht** (athróga `DB_MYSQL_*` nó `DB_POSTGRES_*`). Tar éis aistrithe insíonn sé cathain agus ó cén inneall a d'aistrigh tú.

### Táblaí

Gach tábla lena shraitheanna agus a mhéid. Is féidir an cárta a laghdú.

### Aistrigh chuig bunachar sonraí eile

Cruthaigh bunachar sonraí folamh agus úsáideoir atá in ann táblaí a chruthú ar do fhreastalaí ar dtús; ní chruthaíonn NPMpro an bunachar sonraí. Ceanglais: MySQL 8.0, MariaDB 10.6 nó PostgreSQL 13 nó níos nuaí.

1. Roghnaigh an **Inneall** agus cuir isteach **Óstach**, **Port**, **Ainm an bhunachair sonraí**, **Úsáideoir** agus **Pasfhocal**. Cuir **Úsáid TLS** air má theastaíonn sé ón bhfreastalaí (do MySQL agus MariaDB is féidir **Seiceáil teastas an fhreastalaí** agus **Seiceáil ainm an fhreastalaí** a úsáid freisin). Ní theastaíonn aon rud le haistriú chuig SQLite: cruthaíonn sé comhad nua in `/data/npmpro`.
2. **Tástáil an ceangal**. Seiceálann sé an leagan, go bhfuil an bunachar sonraí folamh agus go bhfuil an t-úsáideoir in ann táblaí a chruthú. Ní athraíonn sé aon rud.
3. **Aistrigh**, ansin clóscríobh an focal a iarrtar agus cliceáil **Aistrigh anois**.

Cuireann NPMpro athruithe ar sos, déanann sé cúltaca sábháilteachta, cruthaíonn sé na táblaí, cóipeálann agus seiceálann sé gach sraith, ansin atosaíonn sé ar an mbunachar sonraí nua. Leanann do shuíomhanna de bheith á seirbheáil. Athlódáiltear an leathanach nuair a fhreagraíonn NPMpro arís, agus d'fhéadfadh go mbeadh ort logáil isteach arís.

Má theipeann ar chéim, fanann NPMpro ar an mbunachar sonraí a d'úsáid sé, agus ainmníonn an fhuinneog an chéim a stop. Ní scriostar an seanbhunachar sonraí riamh, mar sin is féidir leat dul ar ais: bain `/data/npmpro/database.json` agus atosaigh an coimeádán.

Má thagann an nasc ó athróga `DB_MYSQL_*` nó `DB_POSTGRES_*`, tá an rannán inléite amháin. Chun aistriú, déan cúltaca, díreoigh na hathróga ar an mbunachar sonraí nua, atosaigh agus athchóirigh an cúltaca.

Tuilleadh sa wiki: Database.

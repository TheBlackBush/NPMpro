## Cad is Óstach Seachfhreastalaí ann?

Is é Óstach Seachfhreastalaí doras tosaigh seirbhíse gréasáin. Osclaíonn cuairteoirí do fhearann in NPMpro, agus seolann NPMpro an t-iarratas ar aghaidh chuig an tseirbhís atá taobh thiar de. Féadann sé TLS (HTTPS) a chur leis freisin do sheirbhísí nach bhfuil ceann dá gcuid féin acu. Is iad Óstaigh Seachfhreastalaí an úsáid is coitianta de NPMpro.

Úsáid **Clónáil** i roghchlár an óstaigh chun óstach a chóipeáil isteach i bhfuinneog nua Cuir leis. Tosaíonn an chóip gan ainmneacha fearainn, mar ní féidir le fearann a bheith ag níos mó ná óstach cumasaithe amháin.

### Sonraí

- **Ainmneacha Fearainn**: na hainmneacha a úsáideann cuairteoirí. Riachtanach. I gcás teastas nua, teastaíonn Dúshlán DNS le saoróga (`*.example.com`).
- **Scéim**: an chaoi a labhraíonn NPMpro leis an tseirbhís: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (comhaid nó PHP a sheirbheáil ó fhillteán) nó `empty` (gan sruth uachtarach). Réamhshocrú `http://`. Má athraíonn tú an scéim, múchtar roghanna nach n-oireann di.
- **Óstach / IP / Cosán**: seoladh na seirbhíse. Is féidir leat fo-chosán a chur leis, mar shampla `127.0.0.1/path`. Le `path`, cuir isteach fillteán ina ionad. Feistigh do chuid comhad faoi `/var/www`; ní féidir ach le riarthóirí fillteán lasmuigh de a úsáid. Pointíonn ainm a thosaíonn le `cu_` do bhloc upstream nginx féin (féach Load balancing sa wiki).
- **Port Ar Aghaidh**: roghnach. Le `path` is é leagan PHP é.
- **Grúpa**: lipéad saor a choinníonn liostaí fada néata.
- **Roghanna** (as ar fad de réir réamhshocraithe):
  - **Seol ceanntásc noindex agus cuir bac ar roinnt user agents bot**: iarrann ar innill chuardaigh gan an suíomh a innéacsú agus cuireann bac ar roinnt crawlers.
  - **Díchumasaigh CrowdSec AppSec**: múchann CrowdSec AppSec don óstach seo amháin. Níl éifeacht aige ach amháin má tá AppSec socraithe.
  - **Díchumasaigh Maolánú Iarratas** agus **Díchumasaigh Maolánú Freagraí**: do shruthanna uachtaracha http agus https. Coinnigh an maolánú air mura sruthaíonn tú nó mura n-uaslódálann tú comhaid mhóra thar nasc tapa seasmhach. Má mhúchann tú maolánú iarratas, múchtar AppSec freisin.
  - **Cumasaigh comhbhrú ag an upstream**: ligeann don tseirbhís a freagraí féin a chomhbhrú. Coinnigh as é mura bhfuil sé ag teastáil ón tseirbhís. Ní do `path` agus `empty`.
  - **Cumasaigh fancyindex**: taispeánann liosta comhad nuair nach bhfuil comhad innéacs i bhfillteán. Do `path` amháin.
- **X-Frame-Options**: `SAMEORIGIN` (réamhshocrú), `DENY`, `none` (bainfidh sé an ceanntásc) nó `upstream` (coinníonn an méid a sheolann an tseirbhís).
- **Auth Request**: cuireann logáil isteach nó seiceáil bot os comhair an óstaigh (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Réamhshocrú `none`. Tá **Upstream Auth Request** roghnach; úsáideann folamh an réamhshocrú ó Socruithe, Fíordheimhniú ar aghaidh.
- **Liostaí Rochtana Domhanda**: **Inrochtana don Phobal** (réamhshocrú, gan logáil isteach) nó **Saincheaptha**, Liosta Rochtana amháin nó níos mó.

Bíonn Websockets ar siúl i gcónaí.

### Suíomhanna Saincheaptha

Seolann suíomh cosán amháin den óstach (mar shampla `/api/`) chuig seirbhís eile. Tá **Cumasaithe** ag gach ceann, cosán le cineál meaitseála roghnach (`=`, `~`, `~*`, `^~` nó `@`), a scéim féin, óstach, port, roghanna, Auth Request agus liostaí rochtana. Is féidir a liosta rochtana a bheith **Domhanda**, a úsáideann liostaí an óstaigh. Ní oidhrímíonn sé Auth Request an óstaigh. Cuir slais deiridh le cosán mura dteastaíonn meaitseáil réimíre uait. Is féidir le riarthóirí cumraíocht nginx saincheaptha a chur leis do gach suíomh leis an gcnaipe fiacla.

### TLS

- **Teastas TLS**: Dada, Iarr Teastas nua, nó ceann atá ann cheana. Teastaíonn teastas ó na roghanna thíos.
- **Teastas mTLS**: údarás teastais cliaint. Ligeann **Déan mTLS Roghnach** cuairteoirí gan teastas isteach. Ligeann **Seachnaíonn mTLS Auth Request** do chuairteoirí a bhfuil teastas bailí acu Auth Request a scipeáil.
- Atreoraíonn **Fórsáil HTTPS** HTTP chuig HTTPS. Ceadaíonn **Tacaíocht HTTP/3** HTTP/3 (QUIC).
- **HSTS Cumasaithe (2 Bhliain)**: teastaíonn Fórsáil HTTPS uaidh. Teastaíonn HSTS ó **Fofhearainn HSTS+Preload**.
- I gcás teastas nua: **Athúsáid an Eochair (ní mholtar)** agus **Úsáid Dúshlán DNS**, le soláthraí, dintiúir agus soicindí iomadúcháin.

### Ardleibhéal

Cumraíocht nginx saincheaptha don óstach ar fad (bloc server) agus don phríomhshuíomh `location /`. Ní féidir ach le riarthóirí é a athrú.

Tuilleadh sa wiki: Host options.

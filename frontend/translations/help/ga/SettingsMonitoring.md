## Logaí agus monatóireacht

Comhaid logaí, tuarascáil logaí GoAccess agus na staitisticí tráchta atá taobh thiar de leathanach na Monatóireachta.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag LOGROTATE", nó "Socraithe ag an timpeallacht" do na staitisticí). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán. Sábháiltear socruithe atá marcáilte "Restart required" láithreach ach léitear iad nuair a thosaíonn an coimeádán; liostaíonn an rannán ansin iad faoi "Atosaigh an coimeádán chun iad seo a chur i bhfeidhm".

### Comhaid logaí

- **Scríobh comhaid logaí**: scríobhann logaí error, stream agus access nginx chuig `/data/nginx/logs` agus rothlaíonn iad gach lá. Réamhshocrú: as. Athróg: `LOGROTATE`. Cuirtear i bhfeidhm é tar éis an athluchtaithe nginx a ritheann an tsábháil. Fanann sé air fad is a ritheann GoAccess.
- **Rothlaithe logaí a choinnítear**: cé mhéad comhad logaí rothlaithe a choinnítear sular scriostar an ceann is sine, 1 go 1000. Réamhshocrú: 3. Athróg: `LOGROTATIONS`. Cuirtear i bhfeidhm láithreach é.

### GoAccess

- **Tuarascáil GoAccess**: ritheann GoAccess, tuarascáil logaí gréasáin do riarthóirí, faoi `/goaccess` an chomhéadain ghréasáin. Réamhshocrú: as. Athróg: `GOA`. Cuirtear i bhfeidhm é tar éis atosú an choimeádáin. Ní chuireann sé staitisticí tráchta air.

Nuair atá an tuarascáil air, taispeántar na roghanna seo. Cuirtear gach ceann i bhfeidhm tar éis atosú an choimeádáin. Cuireann athróg amháin, `GOACLA`, do chuid roghanna GoAccess féin in áit gach ceann acu agus glasálann sí iad.

- **Coinnigh sonraí na tuarascála**: 1 go 366 lá. Réamhshocrú: 30.
- **Anaithnidigh IPanna cuairteoirí**: As, Leibhéal 1 (réamhshocrú), Leibhéal 2 (láidir) nó Leibhéal 3 (pedantach). Folaíonn leibhéal 1 an bheart dheireanach IPv4 (an 64 giotán deireanach de IPv6), leibhéal 2 dhá bheart (80 giotán), leibhéal 3 trí bheart (96 giotán).
- **Bain teaghráin iarratais**: bainfidh teaghráin iarratais as URLanna sa tuarascáil, mar sin ní stóráiltear comharthaí in URLanna. Réamhshocrú: air.
- **Leaganacha iomlána an chórais oibriúcháin**: taispeánann an leagan iomlán, ní an teaghlach amháin. Réamhshocrú: air.
- **Réitigh ainmneacha óstach**: déanann cuardach ar ainmneacha óstach IPanna cuairteoirí. Seolann sé seo ceisteanna DNS fúthu. Réamhshocrú: air.

### Monatóireacht

Rialaíonn siad seo cluaisín Tráchta leathanach na Monatóireachta. Cuirtear gach ceann i bhfeidhm láithreach nuair a shábhálann tú. Athróga: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Staitisticí tráchta**: léann log rochtana nginx agus comhaireann iarratais de réir óstaigh, stádais, tíre agus líonra. Réamhshocrú: as. Stopann múchadh comhaireamh nua; fanann staitisticí stóráilte go dtí go n-éagann siad, mura ticeálann tú "Scrios na staitisticí stóráilte freisin" sa dialóg.
- **Coinnigh staitisticí ar feadh**: 7 go 365 lá. Réamhshocrú: 30. Coinnítear sonraí in aghaidh an nóiméid ar feadh 24 uair an chloig, sonraí in aghaidh na huaire ar feadh an oiread sin laethanta.
- **Taispeáin IPanna cuairteoirí**: stórálann IPanna cuairteoirí in aghaidh na huaire chun na IPanna is mó a liostú. Réamhshocrú: as, ar mhaithe le príobháideachas. Scriosann múchadh na IPanna stóráilte.
- **Comhair cuairteoirí uathúla**: stórálann hash eochraithe de gach IP cuairteora in aghaidh an óstaigh agus an lae chun cuairteoirí uathúla a chomhaireamh. Réamhshocrú: as. Scriosann múchadh na hashanna.
- **Teorainn cuairteoirí in aghaidh óstaigh agus lae**: 1000 go 1000000. Réamhshocrú: 100000. Stopann óstach a shroicheann í ag comhaireamh cuairteoirí nua an lá sin agus taispeánann comhartha móide.

Teastaíonn bunachair shonraí GeoIP ó thíortha agus ó líonraí (Socruithe, GeoIP).

Tuilleadh sa wiki: Monitoring.

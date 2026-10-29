## Cabhair le Deimhnithe

### Teastas HTTP

Ciallaíonn deimhniú bailíochtaithe HTTP go ndéanfaidh freastalaithe Certbot iarracht teacht ar do fhearainn thar HTTP (ní HTTPS!) agus má éiríonn leo, eiseoidh siad do theastas.

Chun an modh seo a dhéanamh, beidh ort _Óstach Proxy_ a chruthú do do fhearainn(eanna) atá inrochtana le HTTP agus ag pointeáil chuig an suiteáil Nginx seo. Tar éis deimhniú a thabhairt, is féidir leat an _Óstach Proxy_ a mhodhnú chun an deimhniú seo a úsáid le haghaidh naisc HTTPS freisin. Mar sin féin, beidh ort an _Óstach Proxy_ a chumrú fós le haghaidh rochtain HTTP chun go ndéanfar an deimhniú a athnuachan.

_Ní thacaíonn_ an próiseas seo le fearainn fiáine.

### Teastas DNS

Éilíonn deimhniú bailíochtaithe DNS ort breiseán Soláthraí DNS a úsáid. Úsáidfear an Soláthraí DNS seo chun taifid shealadacha a chruthú ar do fhearann agus ansin déanfaidh Certbot fiosrúchán ar na taifid sin lena chinntiú gurb tusa an t-úinéir agus má éiríonn leo, eiseoidh siad do theastas.	

Ní gá duit _Óstach Proxy_ a chruthú sula n-iarrann tú an cineál seo teastais. Ní gá duit do _Óstach Proxy_ a chumrú le haghaidh rochtana HTTP ach an oiread.

_Tacaíonn_ an próiseas seo le fearainn fiáine.

#### Dintiúir DNS sábháilte

Sábháiltear na dintiúir do do Sholáthraí DNS ar leithligh ón teastas, ar an
gcluaisín _Dintiúir DNS_ ar leathanach na dTeastas. Ní roghnaíonn teastas ansin ach ceann de na
dintiúir shábháilte, ionas gur féidir le roinnt teastas iad a roinnt.

Stóráiltear rúin criptithe agus ní thaispeántar arís iad choíche. Nuair a chuireann tú dintiúr in eagar, fág
rún folamh chun an luach sábháilte a choinneáil. Is é an comhad
`/data/npmpro/dns-credentials.key` an eochair a úsáidtear don chriptiú; déan cúltaca de in éineacht leis an mbunachar sonraí, nó
ní féidir na dintiúir shábháilte a léamh tar éis athchóirithe.

Úsáideann soláthraithe gan fhoirm an bosca téacs INI, áit a ngreamaíonn tú ábhar
chomhad na ndintiúr don soláthraí sin.

### Teastas Saincheaptha

Úsáid an rogha seo chun do Theastas TLS féin a uaslódáil, mar a sholáthraíonn d'Údarás Deimhnithe féin é.
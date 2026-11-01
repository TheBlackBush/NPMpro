## GeoIP

Íoslódálann NPMpro bunachair shonraí saor in aisce MaxMind GeoLite2 é féin agus déanann sé cuardach ar thíortha agus ar líonraí ar do fhreastalaí, mar sin ní sheoltar IPanna cuairteoirí áit ar bith. Ní theastaíonn coimeádán geoipupdate ar leith uait. Beathaíonn na bunachair shonraí léarscáil agus liostaí na Monatóireachta, GoAccess agus rialacha tíre nginx.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse "Socraithe ag an timpeallacht"). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán. Tosaíonn sábháil an íoslódáil sa chúlra, agus nuashonraítear an stádas thíos nuair a bhíonn sé déanta.

### Cuntas MaxMind

Teastaíonn cuntas MaxMind saor in aisce agus eochair cheadúnais uait (i MaxMind: Account, Manage license keys). Tá nasc clárúcháin ar an leathanach.

- **Aitheantas an chuntais**: athróg `GEOIP_ACCOUNT_ID`.
- **Eochair cheadúnais**: stóráilte criptithe agus ní thaispeántar arís í. Mura féidir an eochair shábháilte a dhíchriptiú, cuir isteach arís í. Athróg: `GEOIP_LICENSE_KEY`.

### Bunachair shonraí

- **GeoLite2 Country**: tíortha don léarscáil, do liostaí tíortha agus do rialacha tíre nginx. Air de réir réamhshocraithe.
- **GeoLite2 ASN**: líonraí (uimhir AS agus ainm) do liostaí líonraí. Air de réir réamhshocraithe.
- **GeoLite2 City**: roghnach, cathracha do GoAccess. Íoslódáil i bhfad níos mó. As de réir réamhshocraithe.

Athróg: `GEOIP_EDITIONS`, scartha le spásanna, mar shampla `GeoLite2-Country GeoLite2-ASN`. Gan bunachar sonraí roghnaithe, ní íoslódáiltear ná ní nuashonraítear aon rud, agus coinnítear bunachair shonraí a íoslódáladh cheana.

### Stádas

Taispeánann an nuashonrú deireanach agus an earráid dheireanach. Nuashonraíonn NPMpro na bunachair shonraí nuair a athraíonn tú an cuntas nó na bunachair shonraí, nuair a chliceálann tú **Nuashonraigh anois**, agus go huathoibríoch gach 3 lá. Déantar iarracht eile ar nuashonrú uathoibríoch a theip tar éis 24 uair an chloig. Teastaíonn aitheantas cuntais agus eochair cheadúnais shábháilte ó **Nuashonraigh anois**.

Gan bunachair shonraí, tá an léarscáil agus na liostaí tíortha agus líonraí folaithe; oibríonn an chuid eile.

Tuilleadh sa wiki: Monitoring.

## Teastais agus TLS

Réamhshocruithe do na teastais a iarrann NPMpro ar do fhreastalaí ACME (Let's Encrypt mura socraíonn tú ceann eile le `ACME_SERVER`), an chaoi a ndéantar iad a stapláil agus a athnuachan, agus cén teastas a fhreagraíonn d'óstaigh anaithnide. Is é seo rannán na Socruithe, ní leathanach liosta na dTeastas.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag ACME_KEY_TYPE"). Leanann roinnt réimsí ceann eile: coinníonn `ACME_KEY_SIZE` leis féin ar cuar ECDSA an cineál eochrach ar ECDSA, agus coinníonn Must-Staple OCSP stapling air. Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán.

### Iarratais ar theastas

Cuirtear iad seo i bhfeidhm ón gcéad iarratas ar theastas eile.

- **Cineál eochrach**: `ECDSA` (réamhshocrú, molta: eochracha níos lú, croitheadh láimhe níos tapúla) nó `RSA` do chliaint nach féidir ECDSA a úsáid. Athróg: `ACME_KEY_TYPE`.
- **Méid na heochrach**: an cuar do ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; réamhshocrú `secp384r1`) nó na giotáin do RSA (`2048`, `3072`, `4096`; réamhshocrú `4096`). Athróg: `ACME_KEY_SIZE`.
- **Próifíl ACME**: an phróifíl a iarrtar ón bhfreastalaí, seiceáilte leis an bhfreastalaí nuair a shábhálann tú. Úsáideann folamh réamhshocrú an fhreastalaí. Le Let's Encrypt is é `shortlived` an réamhshocrú; ní oibríonn cliaint a theastaíonn Common Name uathu le teastais `shortlived` agus `tlsserver`. Athróg: `ACME_PROFILE` (`none` le haghaidh folamh).
- **OCSP Must-Staple**: marcálann teastais nua mar must-staple agus coinníonn OCSP stapling air. Do CAnna a thacaíonn leis amháin (ZeroSSL); diúltaíonn Let's Encrypt d'iarratais den sórt sin. Réamhshocrú: air do Google Trust Services agus ZeroSSL, as seachas sin. Athróg: `ACME_MUST_STAPLE`.
- **Fíoraigh teastas an fhreastalaí ACME**: air de réir réamhshocraithe. Múch é do fhreastalaí ACME príobháideach amháin a bhfuil teastas féinsínithe aige. Athróg: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Cuirtear an bheirt i bhfeidhm tar éis an athluchtaithe nginx a ritheann an tsábháil, agus múchann an bheirt comhbhrú teastas TLS.

- **OCSP stapling do theastais ACME**: seolann freagra OCSP le teastais ón bhfreastalaí ACME, nuair a thairgeann an CA OCSP. Réamhshocrú: air do Google Trust Services agus ZeroSSL, as seachas sin. Athróg: `ACME_OCSP_STAPLING`.
- **OCSP stapling do theastais shaincheaptha**: an rud céanna do theastais uaslódáilte. Réamhshocrú: as. Athróg: `CUSTOM_OCSP_STAPLING`.

### Teastas réamhshocraithe

- **Teastas d'óstaigh anaithnide agus don chomhéadan gréasáin**: seirbheáiltear é d'ainmneacha óstach nach bhfuil óstach acu in NPMpro agus ar phort an chomhéadain ghréasáin. Réamhshocrú: ionsuite, ionadchoinneálaí giniúna. Athróg: `DEFAULT_CERT_ID` (aitheantas teastais; is é `0` an ceann ionsuite). Cuirtear i bhfeidhm é tar éis an athluchtaithe nginx a ritheann an tsábháil.

### Athnuachan

- **Eatramh seiceála athnuachana**: 1 go 499 uair an chloig idir seiceálacha. Ní athnuaitear teastas ach nuair atá sé dlite. Réamhshocrú: 3. Athróg: `CERTBOT_RUN_INTERVAL`. Cuirtear i bhfeidhm láithreach é.

### ECH

- **Eatramh rothlaithe eochracha ECH**: 1 go 24 uair an chloig idir ritheanna do script ECH (`/data/tls/ech/cron.sh`). Úsáidtear é ach amháin nuair nach bhfuil an script folamh. Réamhshocrú: 1. Athróg: `ECH_ROTATION_INTERVAL`. Cuirtear i bhfeidhm láithreach é.

Tuilleadh sa wiki: Security.

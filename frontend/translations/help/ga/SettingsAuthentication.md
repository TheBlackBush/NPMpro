## Fíordheimhniú

Logáil isteach in comhéadan gréasáin NPMpro le soláthraí OIDC (mar shampla Authentik, Keycloak nó Google), taobh le pasfhocail nó in ionad iad. Ní fíordheimhniú ar aghaidh é seo: ní chosnaíonn sé d'óstaigh sheachfhreastalaí. Féach Socruithe, Fíordheimhniú ar aghaidh chuige sin.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse "Socraithe ag an timpeallacht"). Má tá na ceithre athróg nasctha go léir socraithe, tá OIDC gníomhach gan é a chumasú san UI. Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán. Cuirtear gach rud anseo i bhfeidhm nuair a shábhálann tú.

### Soláthraí

- **Cumasaigh logáil isteach OIDC**: taispeánann an cnaipe logála isteach ar an leathanach logála isteach.
- **URL an eisitheora**: bunseoladh discovery an tsoláthraí, mar shampla `https://accounts.example.com`. Athróg: `OIDC_ISSUER_URL`.
- **Aitheantas an chliaint** agus **Rún an chliaint**: ó do sholáthraí. Stóráiltear an rún criptithe agus ní thaispeántar arís é; fág folamh é chun é a choinneáil. Má athraíonn tú URL an eisitheora nó aitheantas an chliaint, cuir an rún isteach arís. Athróga: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Fearann atreoraithe**: an fearann a úsáideann daoine chun NPMpro a oscailt, le port mura 443 é. Riachtanach, mar tógann sé URL an aisghlaoigh. Athróg: `OIDC_REDIRECT_DOMAIN`.
- **URL aisghlaoch**: inléite amháin. Cláraigh é mar URI atreoraithe ag do sholáthraí.
- **Scóip**: réamhshocrú `openid email profile`. Athraigh é má cheadaíonn do sholáthraí cuid acu amháin, mar shampla `openid email`.
- **Tástáil an ceangal**: seiceálann an féidir le NPMpro an t-eisitheoir a shroicheadh.

### Cnaipe logála isteach

An cnaipe ar an leathanach logála isteach: **Ainm taispeána** (an téacs tar éis "Logáil isteach le"), **Dath** (réamhshocrú nó do `#rrggbb` féin) agus **Deilbhín** (ionsuite, uaslódáilte mar PNG, JPEG, WebP nó SVG suas le 256 KB, nó íoslódáilte ó URL). Taispeántar réamhamharc.

### Rialacha logála isteach

- **Éiligh ríomhphost fíoraithe**: diúltaíonn d'úsáideoirí nár fhíoraigh a soláthraí a ríomhphost. Réamhshocrú: air. Athróg: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Scipeáil dhá fhachtóir i ndiaidh OIDC**: tá muinín aige as seiceáil ilfhachtóra an tsoláthraí féin. Réamhshocrú: as. Athróg: `OIDC_SKIP_MFA`.
- **Díchumasaigh logáil isteach le pasfhocal**: ní féidir logáil isteach ach le OIDC. Ní féidir leat é a chur air ach ó sheisiún a logáil isteach le OIDC. Athróg: `OIDC_DISABLE_PASSWORD`; chun logáil isteach le pasfhocal a athbhunú socraigh é go `false` agus athchruthaigh an coimeádán.

### Úsáideoirí nua

- **Cruthaigh úsáideoirí ag a gcéad logáil isteach** (as de réir réamhshocraithe): faigheann duine gan cuntas ceann leis na ceadanna thíos.
- **Fearainn ríomhphoist ceadaithe**: scartha le camóga; ceadaíonn folamh aon fhearann. Le liosta folamh agus gan ríomhphost fíoraithe a éileamh, faigheann aon duine a nglacann do sholáthraí leis cuntas.
- **Ceadanna réamhshocraithe d'úsáideoirí nua**: socraithe do gach rannán. Ní riarthóirí iad úsáideoirí nua riamh.

Tuilleadh sa wiki: Authentication.

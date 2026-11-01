## Fíordheimhniú ar aghaidh

Cuireann fíordheimhniú ar aghaidh logáil isteach nó seiceáil bot os comhair óstaigh sheachfhreastalaí. Do gach iarratas, fiafraíonn nginx de sheirbhís fíordheimhnithe ar dtús an bhfuil cead ag an gcuairteoir dul thar bráid. Tá sé seo ionsuite in NPMpro d'Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia agus Authentik. Ritheann tú an soláthraí ina choimeádán féin.

Socraíonn an leathanach seo seoladh réamhshocraithe (upstream) gach soláthraí. Cuireann óstach seachfhreastalaí an tseiceáil air le **Auth Request** faoi Roghanna ar a chluaisín Sonraí (nó ar shuíomh saincheaptha).

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag AUTH_REQUEST_AUTHELIA_UPSTREAM"). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán. Cuirtear gach socrú anseo i bhfeidhm tar éis an athluchtaithe nginx a ritheann an tsábháil. Má theipeann ar an tástáil nginx, ní shábháiltear aon rud.

### Sruthanna uachtaracha réamhshocraithe

- **Anubis upstream**, **Tinyauth upstream**, **OAuth2 Proxy upstream**, **VoidAuth upstream**, **Authelia upstream**, **Authentik upstream**: úsáideann óstaigh sheachfhreastalaí leis an soláthraí sin nach bhfuil sruth uachtarach dá gcuid féin acu iad. Buaineann luach an óstaigh féin. Réamhshocrú: folamh (aon cheann). Athróga: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formáid: `scheme://host:port`, mar shampla `http://127.0.0.1:9091`, nó `scheme://cu_name` do bhloc upstream nginx féin a dtosaíonn a ainm le `cu_`. Úsáid `http` nó `https`; tá an port riachtanach; téann seoladh IPv6 idir lúibíní cearnacha. Gan cosán, gan spásanna agus gan aon cheann de `; { } # " ' $ \`.

Ní féidir réamhshocrú a fholmhú fad is a úsáideann óstaigh sheachfhreastalaí an soláthraí sin gan sruth uachtarach dá gcuid féin. Liostaíonn an teachtaireacht na hóstaigh sin.

Faigheann óstach a úsáideann soláthraí gan sruth uachtarach in áit ar bith "Earráid chumraíochta".

### Anubis

- **Íomhánna Anubis saincheaptha**: taispeánann do `happy.webp`, `reject.webp` agus `pensive.webp` féin ar leathanaigh dúshláin Anubis. Réamhshocrú: air nuair atá na trí chomhad ann agus nach bhfuil siad folamh, as seachas sin. Athróg: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Téann na híomhánna in `public/anubis` i do fhillteán sonraí.

Tuilleadh sa wiki: Forward-Authentication.

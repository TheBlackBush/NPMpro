## nginx

Socruithe nginx féin a bhaineann le gach óstach: cé mhéad oibrí a ritheann, rialacha TLS agus modúil roghnacha. Déanann sábháil tástáil ar an gcumraíocht agus athlódálann nginx. Ní chuirtear cumraíocht a theipeann ar an tástáil i bhfeidhm.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag NGINX_WORKER_PROCESSES"). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán. Cuirtear gach socrú anseo i bhfeidhm tar éis an athluchtaithe nginx a ritheann an tsábháil.

### Oibrithe

- **Próisis oibrithe**: "Uathoibríoch (ceann amháin in aghaidh snáithe CPU)" nó uimhir suas le líon na snáitheanna CPU a fheiceann an coimeádán. Réamhshocrú: ceann amháin in aghaidh an tsnáithe, 4 ar a mhéad. Athróg: `NGINX_WORKER_PROCESSES`.
- **Naisc in aghaidh an oibrí**: naisc oscailte a láimhseálann gach oibrí ag an am céanna, 64 go 65535. Réamhshocrú: 512. Athróg: `NGINX_WORKER_CONNECTIONS`.
- **Teorainn ama múchta na n-oibrithe**: cá fhad a choinníonn sean-oibrithe a naisc tar éis athluchtaithe. Luach ama nginx mar `30s`, `10m` nó `1h`; ciallaíonn `0` gan teorainn. Réamhshocrú: `1h`. Athróg: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Logáil

- **Logáil earráidí comhad gan aimsiú**: scríobhann líne log earráide do gach iarratas ar chomhad atá ar lár. Réamhshocrú: as. Athróg: `NGINX_LOG_NOT_FOUND`.

### TLS do gach óstach

Cuireann múchadh TLS 1.2 nó na gcuar NIST P brabhsálaithe agus cliaint níos sine amach. Bíonn TLS 1.3 air i gcónaí.

- **Ceadaigh TLS 1.2**: air de réir réamhshocraithe. Athróg: `NGINX_DISABLE_TLS12` (inbhéartaithe: múchann `true` TLS 1.2).
- **Malartú eochrach iar-chandamach amháin**: ceadaíonn X25519MLKEM768 amháin, a theastaíonn cliant le déanaí uaidh. Múchann sé TLS 1.2 agus na cuair NIST P agus glasálann sé iad fad atá sé air. Réamhshocrú: as. Athróg: `NGINX_FORCE_X25519MLKEM768`.
- **Ceadaigh na cuair NIST P**: secp521r1, secp384r1 agus prime256v1 don mhalartú eochrach, taobh le X25519. Réamhshocrú: air. Athróg: `NGINX_TRUST_SECPR1`.
- **Ceadaigh sínithe RSA PKCS#1**: do sheanchliaint nach féidir RSA-PSS a úsáid. Réamhshocrú: as. Athróg: `NGINX_TRUST_RSA_PKCS1`.

### Modúil

Tá siad uile as de réir réamhshocraithe. Cuir modúl air ach amháin nuair a theastaíonn sé ó do chumraíocht shaincheaptha. Má mhúchann tú modúl agus cumraíocht shaincheaptha á úsáid fós, teipeann ar an tástáil nginx.

- **njs (JavaScript)**: treoracha `js_*`. Athróg: `NGINX_LOAD_NJS_MODULE`.
- **Fíordheimhniú LDAP**: treoracha `auth_ldap`. Athróg: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreams NTLM**: `ntlm` i mbloic upstream. Athróg: `NGINX_LOAD_NTLM_MODULE`.
- **Stádas tráchta na n-óstach fíorúil**: treoracha `vhost_traffic_status_*`. Athróg: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Tuilleadh sa wiki: Configuration.

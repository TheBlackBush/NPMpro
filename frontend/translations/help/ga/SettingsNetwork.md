## Líonra

Inis do NPMpro cé na seachfhreastalaithe os a chomhair ar féidir creidiúint a thabhairt dóibh faoi sheoladh fíor an chliaint. Gan é seo, feiceann logaí, liostaí rochtana agus CrowdSec seoladh an tseachfhreastalaí, ní seoladh an chuairteora.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag TRUST_IP"). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán.

- **IPanna seachfhreastalaí iontaofa**: seoladh IPv4 nó IPv6 amháin nó raon CIDR in aghaidh na líne, mar shampla `10.0.0.0/8`, `192.168.1.5` nó `fd00::/8`. Is féidir le hiarratais ó na seoltaí seo fíor-IP an chliaint a thabhairt ar aghaidh in `X-Forwarded-For`. Úsáid é do chothromóir ualaigh nó tollán díreach os comhair NPMpro. Réamhshocrú: folamh (ní thugtar muinín d'aon duine). Athróg: `TRUST_IP` (scartha le spásanna). Cuirtear i bhfeidhm é tar éis an athluchtaithe nginx a ritheann an tsábháil.
- **Bíodh muinín agat as Cloudflare**: faigheann raonta IP Cloudflare, athnuaitear go rialta iad agus tugann muinín dóibh, mar sin feiceann nginx fíor-IPanna cliaint taobh thiar de Cloudflare. Réamhshocrú: as. Athróg: `TRUST_CLOUDFLARE`. Cuirtear i bhfeidhm é tar éis an athluchtaithe nginx a ritheann an tsábháil. Léigh na nótaí ar Cloudflare sa wiki (Security) ar dtús: tá costais príobháideachta agus slándála ag baint le Cloudflare a chur os comhair NPMpro.

Ná tabhair muinín ach do sheoltaí a rialaíonn tú nó a bhfuil muinín iomlán agat astu. Féadann seoladh iontaofa a rá gur aon chuairteoir é.

Má theipeann ar an tástáil nginx nuair a shábháiltear, ní shábháiltear aon rud agus taispeántar teachtaireacht nginx.

Tuilleadh sa wiki: Security.

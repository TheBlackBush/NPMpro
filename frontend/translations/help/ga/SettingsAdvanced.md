## Ardleibhéal

Socruithe a athraíonn an chaoi a n-iompraíonn NPMpro ar bhealaí beaga.

Buaineann athróg a shocraítear ar an gcoimeádán thar an UI agus glasálann sí an réimse (taispeánann an réimse suaitheantas glais, mar shampla "Socraithe ag TZ"). Úsáid an UI le haghaidh gach rud nach bhfuil socraithe sa choimeádán.

- **Crios ama**: crios ama an choimeádáin. Socraíonn sé na hamanna sna logaí, sa tuarascáil GoAccess agus i jabanna sceidealta, mar chúltacaí sceidealta. Úsáid ainm cosúil le `Europe/Berlin`. Réamhshocrú: `UTC`. Athróg: `TZ`. Cuirtear i bhfeidhm é tar éis atosú an choimeádáin: stórálann sábháil é, agus liostaíonn an rannán é faoi "Atosaigh an coimeádán chun iad seo a chur i bhfeidhm".
- **Formáidigh cumraíochtaí nginx**: formáidíonn sé na cumraíochtaí a scríobhann NPMpro, le nginxbeautifier. Múch é má theipeann air ar chumraíochtaí saincheaptha nó ardleibhéil neamhchaighdeánacha. Réamhshocrú: air. Athróg: `DISABLE_NGINX_BEAUTIFIER` (inbhéartaithe: múchann `true` an fhormáidiú). Cuirtear i bhfeidhm láithreach é.
- **Pictiúir phróifíle Gravatar**: taispeánann pictiúr Gravatar d'úsáideoirí nach bhfuil abhatár uaslódáilte acu. Chun pictiúr a fháil, seolann NPMpro hash de sheoladh ríomhphoist an úsáideora chuig Gravatar, mar sin múch é más cás leat é. Réamhshocrú: air. Athróg: `DISABLE_GRAVATAR` (inbhéartaithe: múchann `true` é). Cuirtear i bhfeidhm láithreach é; athraíonn pictiúr úsáideora ag a chéad sábháil próifíle eile, agus fanann pictiúir a fuarthas cheana go dtí sin.

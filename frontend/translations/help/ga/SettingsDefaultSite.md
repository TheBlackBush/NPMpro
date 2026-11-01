## Suíomh Réamhshocraithe

Is é an suíomh réamhshocraithe an rud a fhreagraíonn nginx nuair a shroicheann cuairteoir NPMpro le hainm óstaigh nach n-úsáideann aon óstach, nó le seoladh IP an fhreastalaí. Roghnaigh an freagra anseo. Baineann sé le gach ainm anaithnid.

Déanann sábháil tástáil ar an rogha nua le nginx ar dtús. Má theipeann ar an tástáil, ní shábháiltear aon rud, fanann an suíomh réamhshocraithe roimhe seo agus tá earráid nginx i log an choimeádáin.

- **Leathanach Comhghairdeas** (réamhshocrú): taispeánann leathanach fáilte NPMpro.
- **Leathanach 404**: freagraíonn le leathanach 404 Not Found.
- **Gan Freagra (444)**: dúnann an nasc gan aon fhreagra. Úsáid é chun gan aon rud a thaispeáint do scanóirí. Diúltaítear d'iarratais HTTPS d'ainmneacha anaithnide le linn chroitheadh láimhe TLS.
- **Athsheoladh**: seolann cuairteoirí chuig seoladh eile le hatreorú sealadach (302). Cuir isteach URL iomlán `http://` nó `https://` gan spásanna, comharthaí athfhriotail ná `; { } #`, suas le 255 carachtar.
- **HTML saincheaptha**: taispeánann do leathanach HTML féin. Tá an **Cód Stádais HTTP** faoi roghnach, ó 400 go 599. Fág folamh é le haghaidh 200 (OK).

I gcás gach rogha seachas Gan Freagra, atreoraítear iarratais d'ainmneacha anaithnide thar HTTP simplí chuig HTTPS ar dtús, agus úsáideann iarratais HTTPS an teastas a roghnaíodh mar **Teastas réamhshocraithe** i Socruithe, Teastais agus TLS.

Níl aon athróga timpeallachta ag an rannán seo, mar sin cuirtear an t-athrú i bhfeidhm nuair a shábhálann tú.

## O que é uma Lista de Acesso?

Uma Lista de Acesso protege hosts proxy. Pode pedir aos visitantes um nome de utilizador e uma palavra-passe (autenticação Basic), permitir ou negar visitantes pelo endereço IP, ou ambas as coisas. É útil para serviços que não têm início de sessão próprio ou quando quer manter de fora os clientes desconhecidos.

Uma lista pode ser usada por muitos hosts proxy e locations.

### Detalhes

- **Nome**: obrigatório.
- **Satisfazer Qualquer** (desativado por predefinição): um visitante entra quando cumpre qualquer uma das verificações, uma regra ou um utilizador válido. Desativado significa que tem de passar em ambas. Também ignora um Auth Request nesse host.
- **Passar Autenticação para o Upstream** (desativado por predefinição): envia o cabeçalho `Authorization` do visitante para o serviço. Desativado mantém o início de sessão privado ao NPMpro.

### Autorizações

Adicione nomes de utilizador e palavras-passe. Os nomes de utilizador têm de ser únicos na lista e não podem conter `:`. Ao editar uma lista, deixe vazia uma palavra-passe já guardada para a manter.

### Regras

As regras permitem ou negam um endereço IP, um intervalo CIDR (`192.168.1.0/24`, `2001:db8::/32`) ou `unix:`. São aplicadas pela ordem em que as lista e a primeira que corresponder ganha. Ponha primeiro as regras específicas. Uma regra final `all` fecha a lista, definida como permitir ou negar; só é adicionada quando existe pelo menos outra regra. Uma lista precisa de pelo menos um utilizador ou uma regra.

### Utilização em hosts proxy

Num host proxy, escolha a lista em **Listas de Acesso Globais** no separador Detalhes: **Acesso Público** (sem lista) ou **Personalizada**. Uma location personalizada pode usar **Global** (as listas do host), **Acesso Público** ou as suas próprias listas **Personalizada**.

Pode associar várias listas a um host ou a uma location. São verificadas de cima para baixo, pela ordem apresentada, e pode movê-las para cima e para baixo. **Satisfazer Qualquer** e **Passar Autenticação para o Upstream** só contam na primeira lista. Com o CrowdSec, os IPs banidos veem a página de banimento antes do pedido de palavra-passe.

Mais na wiki: Host options.

### Página de recusa

**Negado** (401, 403) é o que um visitante vê quando a lista o recusa (não em hosts com autenticação encaminhada): **Definição global** (a página de Definições, Páginas de destino), a **Página «Acesso negado»**, uma **Página personalizada** só para esta lista (cole ou carregue um ficheiro HTML) ou **A página simples do nginx**, que mantém a do nginx.

### Países

Permita ou bloqueie visitantes pelo país. **Regras de país** é **Desativado**, **Permitir apenas estes países** ou **Bloquear estes países**; adicione países com **Adicionar um país** (pesquise pelo nome do país no idioma da interface ou pelo código de duas letras) e dê a cada um um comentário opcional. Uma lista num modo de permitir ou bloquear precisa de pelo menos um país.

- **Bloquear visitantes cujo país é desconhecido** abrange os endereços públicos para os quais a base de dados GeoIP não tem país. O modo de permitir bloqueia-os por predefinição, o de bloquear deixa-os passar.
- **Fechar a ligação sem resposta (444)** aplica-se apenas a visitantes bloqueados por país. As recusas por IP e palavra-passe mantêm a página de recusa.
- Os endereços privados e locais passam sempre. Os países são verificados antes das regras de IP e de palavra-passe, também com **Satisfazer Qualquer**.
- As regras de país precisam de uma base de dados de países GeoIP (Definições, GeoIP). Sem ela, ou enquanto o nginx recusar a linha da base de dados, todos os visitantes passam: os países guardados mantêm-se, mas uma lista não pode receber um novo modo nem novos países até haver uma base de dados disponível.

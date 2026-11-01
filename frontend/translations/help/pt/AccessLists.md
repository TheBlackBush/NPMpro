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

## Páginas de destino

As páginas que os visitantes veem em vez de um site: quando nada está configurado para um endereço, uma página não é encontrada, o servidor por trás de um host não responde, uma lista de acesso os recusa, um host está em manutenção, falta um certificado ou o CrowdSec os bloqueia ou verifica. Cada página aparece no idioma do navegador do visitante, em claro e em escuro.

### Página predefinida

O que mostra um endereço sem host: a **Página de Parabéns**, a **Página 404**, **Sem Resposta (444)**, um **Redirecionar** ou o seu próprio **HTML Personalizado**.

### Páginas globais

Para cada página: a sua página do NPMpro (por exemplo **Página não encontrada** ou **Página «Acesso negado»**) ou uma **Página personalizada**. Uma página personalizada é um ficheiro HTML (até 1 MB, UTF-8) com os seus estilos e imagens lá dentro; cole-o ou use **Carregar .html**. Pode mostrar o IP do visitante, a hora, o código de estado e o nome do host com `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` e `host`; as outras inclusões do lado do servidor são recusadas.

Os proxy hosts, os hosts 404 e as listas de acesso usam estas páginas, a menos que escolham as suas (o separador **Páginas** de um proxy host, o campo **Página** de um host 404, **Negado** de uma lista de acesso).

**Pré-visualização** abre a página guardada num novo separador com valores de exemplo.

### CrowdSec

Definições, CrowdSec decide se um bloqueio mostra uma página, redireciona ou só responde com um código de estado; esta secção decide o aspeto das páginas de bloqueio e de captcha.

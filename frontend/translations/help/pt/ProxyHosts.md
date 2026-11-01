## O que é um Proxy Host?

Um Proxy Host é a porta de entrada de um serviço web. Os visitantes abrem o seu domínio no NPMpro e o NPMpro encaminha o pedido para o serviço que está por trás. Também pode adicionar TLS (HTTPS) a serviços que não têm o seu próprio. Os Proxy Hosts são a utilização mais comum do NPMpro.

Use **Clonar** no menu do host para copiar um host para uma nova janela de adição. A cópia começa sem os nomes de domínio, porque um domínio só pode pertencer a um host ativo.

### Detalhes

- **Nomes de Domínio**: os nomes que os visitantes usam. Obrigatório. Para um novo certificado, os carateres universais (`*.example.com`) precisam do DNS challenge.
- **Esquema**: como o NPMpro fala com o serviço: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (serve ficheiros ou PHP a partir de uma pasta) ou `empty` (sem upstream). Predefinição `http://`. Uma mudança de esquema desativa as opções que não lhe servem.
- **Hostname / IP / Caminho de Destino**: o endereço do serviço. Pode acrescentar um subcaminho, por exemplo `127.0.0.1/path`. Com `path`, indique antes uma pasta. Monte os seus ficheiros em `/var/www`; só os administradores podem usar uma pasta fora dela. Um nome que comece por `cu_` aponta para um bloco upstream do nginx seu (veja Load balancing na wiki).
- **Porta de Encaminhamento**: opcional. Com `path` é a versão do PHP.
- **Grupo**: uma etiqueta livre que mantém as listas longas arrumadas.
- **Opções** (todas desativadas por predefinição):
  - **Enviar cabeçalho noindex e bloquear alguns user agents de bots**: pede aos motores de pesquisa que não indexem o site e bloqueia alguns crawlers.
  - **Desativar CrowdSec AppSec**: desativa o CrowdSec AppSec só para este host. Só tem efeito se o AppSec estiver configurado.
  - **Desativar Buffering de Pedidos** e **Desativar Buffering de Respostas**: para upstreams http e https. Mantenha o buffering ativo, a não ser que faça streaming ou envie ficheiros grandes por uma ligação rápida e estável. Desativar o buffering de pedidos também desativa o AppSec.
  - **Ativar compressão pelo upstream**: deixa o serviço comprimir as suas próprias respostas. Mantenha desativado, a não ser que o serviço precise. Não para `path` e `empty`.
  - **Ativar fancyindex**: mostra uma lista de ficheiros quando uma pasta não tem ficheiro de índice. Só para `path`.
- **X-Frame-Options**: `SAMEORIGIN` (predefinição), `DENY`, `none` (remove o cabeçalho) ou `upstream` (mantém o que o serviço envia).
- **Auth Request**: coloca um início de sessão ou uma verificação de bots à frente do host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Predefinição `none`. **Upstream do Auth Request** é opcional; vazio usa o valor predefinido de Definições, Autenticação encaminhada.
- **Listas de Acesso Globais**: **Acesso Público** (predefinição, sem início de sessão) ou **Personalizada**, uma ou mais Listas de Acesso.

Os websockets estão sempre ativos.

### Locations Personalizados

Uma location envia um caminho do host (por exemplo `/api/`) para outro serviço. Cada uma tem **Ativado**, um caminho com um tipo de correspondência opcional (`=`, `~`, `~*`, `^~` ou `@`), o seu próprio esquema, host, porta, opções, Auth Request e listas de acesso. A sua lista de acesso pode ser **Global**, que usa as listas do host. Não herda o Auth Request do host. Acrescente uma barra final a um caminho, a não ser que queira correspondência por prefixo. Os administradores podem acrescentar configuração nginx personalizada por location com o botão da roda dentada.

### TLS

- **Certificado TLS**: Nenhum, Pedir um novo certificado, ou um existente. As opções abaixo precisam de um certificado.
- **Certificado mTLS**: uma autoridade de certificação de clientes. **Tornar mTLS Opcional** deixa entrar visitantes sem certificado. **mTLS ignora o Auth Request** deixa os visitantes com um certificado válido saltar o Auth Request.
- **Forçar HTTPS** redireciona HTTP para HTTPS. **Suporte HTTP/3** permite HTTP/3 (QUIC).
- **HSTS Ativado (2 Anos)**: precisa de Forçar HTTPS. **HSTS Subdomínios+Preload** precisa de HSTS.
- Para um novo certificado: **Reutilizar Chave (não recomendado)** e **Utilizar DNS Challenge**, com fornecedor, credencial e segundos de propagação.

### Avançado

Configuração nginx personalizada para o host inteiro (bloco server) e para a location principal `location /`. Só os administradores a podem alterar.

Mais na wiki: Host options.

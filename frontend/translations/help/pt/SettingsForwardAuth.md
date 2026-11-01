## Autenticação encaminhada

A autenticação encaminhada coloca um início de sessão ou uma verificação de bots à frente de um host proxy. Para cada pedido, o nginx pergunta primeiro a um serviço de autenticação se o visitante pode passar. O NPMpro tem isto integrado para Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia e Authentik. Executa o fornecedor no seu próprio contentor.

Esta página define o endereço predefinido (upstream) de cada fornecedor. Um host proxy ativa a verificação com **Auth Request** em Opções no separador Detalhes (ou numa location personalizada).

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por AUTH_REQUEST_AUTHELIA_UPSTREAM"). Use a interface para tudo o que não esteja definido no contentor. Todas as definições aqui se aplicam após o reload do nginx que o guardar executa. Se o teste do nginx falhar, nada é guardado.

### Upstreams predefinidos

- **Upstream Anubis**, **Upstream Tinyauth**, **Upstream OAuth2 Proxy**, **Upstream VoidAuth**, **Upstream Authelia**, **Upstream Authentik**: usados por hosts proxy com esse fornecedor que não têm upstream próprio. O valor do próprio host ganha. Predefinição: vazio (nenhum). Variáveis: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formato: `scheme://host:port`, por exemplo `http://127.0.0.1:9091`, ou `scheme://cu_name` para um bloco upstream do nginx seu cujo nome comece por `cu_`. Use `http` ou `https`; a porta é obrigatória; um endereço IPv6 vai entre parênteses retos. Sem caminho, sem espaços e sem nenhum de `; { } # " ' $ \`.

Não pode esvaziar uma predefinição enquanto hosts proxy usarem esse fornecedor sem upstream próprio. A mensagem lista esses hosts.

Um host que usa um fornecedor sem upstream em lado nenhum recebe um "Erro de configuração".

### Anubis

- **Imagens Anubis personalizadas**: mostra os seus `happy.webp`, `reject.webp` e `pensive.webp` nas páginas de desafio do Anubis. Predefinição: ativado quando os três ficheiros existem e não estão vazios, caso contrário desativado. Variável: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. As imagens ficam em `public/anubis` na sua pasta de dados.

Mais na wiki: Forward-Authentication.

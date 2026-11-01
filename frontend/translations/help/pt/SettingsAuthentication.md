## Autenticação

Início de sessão na interface web do NPMpro com um fornecedor OIDC (por exemplo Authentik, Keycloak ou Google), junto com ou em vez de palavras-passe. Isto não é autenticação encaminhada: não protege os seus hosts proxy. Para isso veja Definições, Autenticação encaminhada.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra "Definido pelo ambiente"). Se as quatro variáveis de ligação estiverem todas definidas, o OIDC fica ativo sem o ativar na interface. Use a interface para tudo o que não esteja definido no contentor. Tudo aqui se aplica ao guardar.

### Fornecedor

- **Ativar início de sessão OIDC**: mostra o botão de início de sessão na página de login.
- **URL do emissor**: o endereço base de discovery do fornecedor, por exemplo `https://accounts.example.com`. Variável: `OIDC_ISSUER_URL`.
- **Client ID** e **Client secret**: fornecidos pelo seu fornecedor. O secret é guardado cifrado e nunca mais é mostrado; deixe-o vazio para o manter. Se alterar o URL do emissor ou o client ID, volte a introduzir o secret. Variáveis: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Domínio de redirecionamento**: o domínio que as pessoas usam para abrir o NPMpro, com a porta se não for a 443. Obrigatório, porque constrói o URL de callback. Variável: `OIDC_REDIRECT_DOMAIN`.
- **URL de callback**: só de leitura. Registe-o como URI de redirecionamento no seu fornecedor.
- **Scopes**: predefinição `openid email profile`. Altere se o seu fornecedor só permitir alguns, por exemplo `openid email`.
- **Testar ligação**: verifica se o NPMpro consegue alcançar o emissor.

### Botão de início de sessão

O botão na página de início de sessão: **Nome apresentado** (o texto depois de "Iniciar sessão com"), **Cor** (uma predefinição ou o seu `#rrggbb`) e **Ícone** (integrado, carregado como PNG, JPEG, WebP ou SVG até 256 KB, ou descarregado de um URL). É mostrada uma pré-visualização.

### Regras de início de sessão

- **Exigir email verificado**: recusa utilizadores cujo fornecedor não verificou o email. Predefinição: ativado. Variável: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Ignorar dois fatores após OIDC**: confia na verificação multifator do próprio fornecedor. Predefinição: desativado. Variável: `OIDC_SKIP_MFA`.
- **Desativar início de sessão com palavra-passe**: só o OIDC pode iniciar sessão. Só o pode ativar a partir de uma sessão iniciada com OIDC. Variável: `OIDC_DISABLE_PASSWORD`; para restaurar o início de sessão com palavra-passe defina-a como `false` e recrie o contentor.

### Novos utilizadores

- **Criar utilizadores no primeiro início de sessão** (predefinição: desativado): uma pessoa sem conta recebe uma com as permissões abaixo.
- **Domínios de email permitidos**: separados por vírgulas; vazio permite qualquer domínio. Com uma lista vazia e sem exigir email verificado, qualquer pessoa que o seu fornecedor aceite obtém uma conta.
- **Permissões predefinidas para novos utilizadores**: definidas por secção. Os novos utilizadores nunca são administradores.

Mais na wiki: Authentication.

## Acesso à API

Todos os tokens de API de todos os utilizadores. Só os administradores veem esta página.

Os tokens são criados pelos seus proprietários no menu do utilizador, em **Tokens de API**. Aqui vê cada token com o seu proprietário, as permissões, quando expira, quando foi usado pela última vez e quando foi criado.

- **Revogar** para um token de imediato. Os scripts e assistentes de IA que o usam recebem um erro de autenticação a partir daí.
- Um token nunca tem mais permissões do que o seu proprietário. O token de um administrador atua como administrador apenas com o seu interruptor **Administrador**, e nenhum token gere utilizadores.
- A criação, a revogação, a expiração e a primeira utilização de um token ficam no registo de auditoria, com o nome do token junto ao utilizador.

**Documentação da API** abre num novo separador a referência da API de cada endpoint e mostra o cabeçalho em que um token é enviado. **Servidor MCP** mostra o endpoint, a configuração para o Claude Code e para o Claude Desktop e outros clientes, e as ferramentas que um token pode usar.

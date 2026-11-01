## O que é um Redirection Host?

Um Redirection Host envia os visitantes de um domínio para outro endereço. Use-o quando um site muda de domínio e as ligações antigas devem continuar a funcionar, ou para enviar `www` para o nome principal.

Use **Clonar** no menu do host para copiar um host para uma nova janela de adição. A cópia começa sem os nomes de domínio, porque um domínio só pode pertencer a um host ativo.

### Detalhes

- **Nomes de Domínio**: os nomes que são redirecionados. Obrigatório. Os carateres universais só são permitidos para um novo certificado com o DNS challenge.
- **Esquema**: o esquema do destino. "manter (igual ao pedido)" é a predefinição e mantém o `http` ou `https` da visita. Ou escolha `http` ou `https`.
- **Domínio de Destino**: o domínio para onde os visitantes são enviados, por exemplo `example.com`. Obrigatório.
- **Código HTTP**: o código de resposta. Predefinição 301 Moved permanently. Outras opções: 302 Moved temporarily, 303 See other, 307 Temporary redirect e 308 Permanent redirect. Use 301 ou 308 quando a mudança é definitiva; os browsers e os motores de pesquisa memorizam-nos.
- **Grupo**: uma etiqueta livre que mantém as listas longas arrumadas. Escolha uma em uso ou escreva um novo nome.
- **Preservar Caminho** (desativado por predefinição): acrescenta ao destino o caminho e a query originais. Com esta opção, `old.example/a?b=1` vai para `new.example/a?b=1`. Sem ela, todos os visitantes chegam ao início do destino.

### TLS

- **Certificado TLS**: Nenhum, Pedir um novo certificado, ou um existente. As opções abaixo precisam de um certificado.
- **Certificado mTLS**: uma autoridade de certificação de clientes. **Tornar mTLS Opcional** deixa entrar visitantes sem certificado de cliente.
- **Forçar HTTPS**: redireciona primeiro HTTP para HTTPS.
- **Suporte HTTP/3**: permite HTTP/3 (QUIC).
- **HSTS Ativado (2 Anos)**: precisa de Forçar HTTPS. **HSTS Subdomínios+Preload** precisa de HSTS.
- Para um novo certificado: **Reutilizar Chave (não recomendado)** e **Utilizar DNS Challenge**, com fornecedor, credencial e segundos de propagação.

Todas as opções TLS estão desativadas por predefinição.

### Avançado

Configuração nginx personalizada adicionada dentro do bloco server do host. Só os administradores a podem alterar; os outros utilizadores veem-na só de leitura.

Mais na wiki: Host options.

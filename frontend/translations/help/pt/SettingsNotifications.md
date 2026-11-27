## Notificações

O NPMpro envia correio através de um servidor SMTP à sua escolha. Por agora o correio é usado para o correio de teste e, mais tarde, para repor palavras-passe e para alertas. As definições aqui também podem vir de variáveis do contentor: uma variável definida no contentor prevalece sobre a interface e bloqueia o seu campo (o campo mostra "Definido pelo ambiente"). Use a interface para tudo o que não esteja definido no contentor.

### Servidor de correio

Cada ligação é verificada como os outros pedidos de saída: o nome do servidor tem de ser resolvido e os endereços locais e link-local são recusados. O correio considera-se configurado quando o host e o endereço do remetente estão preenchidos.

- **Host** e **Porta**: o servidor SMTP. Variáveis: `SMTP_HOST`, `SMTP_PORT` (587 por omissão).
- **Segurança**: **STARTTLS** converte uma ligação simples em encriptada (normalmente a porta 587), **TLS** é encriptado desde o início (normalmente a porta 465), **Nenhuma** envia sem encriptação. Variável: `SMTP_SECURITY` (`starttls`, `tls` ou `none`).
- **Verificar certificado**: recusa um servidor cujo certificado não é válido. Variável: `SMTP_VERIFY_TLS` (`false` desativa).
- **Utilizador** e **Palavra-passe**: o início de sessão. A palavra-passe é guardada encriptada e nunca mais mostrada; **Remover** apaga-a e, se a guardada não puder ser desencriptada, escreva-a de novo. Variáveis: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Nome do remetente** e **Endereço do remetente**: como o correio do NPMpro aparece. Variáveis: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Responder para**: para onde vão as respostas; vazio usa o endereço do remetente. Variável: `SMTP_REPLY_TO`.

Com a segurança **Nenhuma** e um utilizador, a palavra-passe viajaria sem encriptação, por isso só é permitido para um servidor da sua rede local.

**Enviar correio de teste** envia um correio com as definições guardadas para o endereço que escrever (o seu por omissão) e mostra a resposta do servidor se falhar. Guarde primeiro: o botão fica desativado enquanto o formulário tiver alterações por guardar e oculto até o correio estar configurado.

### Alertas por correio

Apresentados quando um servidor de correio está configurado. Correios sobre os problemas que o NPMpro deteta e sobre quando ficam resolvidos; um problema que continua em aberto é repetido.

- **Enviar aos administradores**: cada administrador ativado com um endereço válido recebe os alertas.
- **Enviar também para**: mais endereços, no máximo 20, por exemplo uma lista de equipa. Um endereço recusado é assinalado no seu chip. Variável: `ALERT_ADDRESSES` (separados por vírgulas).
- **Eventos**: marque os problemas sobre os quais quer receber correio, agrupados por área. Marcar um também abrange a sua resolução.
- **Lembrar a cada (horas)**: quanto tempo um problema fica em silêncio antes de ser enviado de novo; 0 nunca o repete, no máximo 168.

**Enviar um exemplo** envia de imediato um alerta de exemplo, com as definições guardadas, a todos os que receberiam alertas. Guarde primeiro: o botão fica desativado enquanto o formulário tiver alterações por guardar. Se um envio falhar, a mensagem indica o endereço.

### Ligações e idioma

- **URL público**: o endereço com que as pessoas abrem o NPMpro, usado para as ligações dos correios, por exemplo `https://npm.example.com`. Apenas HTTPS, sem caminho. **Usar o endereço deste navegador** preenche-o com o endereço desta página quando é aberta por HTTPS. Variável: `PUBLIC_URL`.
- **Idioma do correio por omissão**: o idioma dos correios para as pessoas que não escolheram um. O idioma de interface de cada utilizador é memorizado e usado para os seus correios. Variável: `MAIL_LANGUAGE`.

### Convites e avisos de conta

Ambos precisam de um servidor de e-mail. Os convites precisam também do **URL público**.

- **Convites**: ao adicionar um utilizador, pode enviar um convite em vez de definir uma palavra-passe. O utilizador recebe um e-mail com uma ligação para escolher uma palavra-passe; a ligação funciona uma só vez e durante 72 horas. **Enviar convite novamente** na lista de utilizadores envia uma nova ligação.
- **Avisos de conta**: os utilizadores recebem um e-mail quando a palavra-passe ou o endereço muda, quando o início de sessão de dois fatores é desativado ou quando são criados novos códigos de recuperação.

### Webhooks

Um webhook é um endereço seu que o NPMpro chama com um pedido HTTP assinado quando algo acontece, por exemplo quando um certificado foi renovado. Apenas os administradores veem este cartão.

- **URL**: `https://` para qualquer anfitrião público, ou `http://` para um endereço da sua rede local. Os redirecionamentos não são seguidos. O endereço é guardado cifrado e nunca mais é mostrado; deixe o campo vazio ao editar para o manter.
- **Eventos**: escolha os eventos a enviar, ou **Todos os eventos**.
- **Segredo de assinatura**: mostrado uma só vez depois de guardar. Guarde-o onde o seu recetor o lê. **Renovar segredo** cria um novo; o anterior continua a assinar durante 24 horas para que o seu recetor possa mudar.
- **Enviar teste**: envia de imediato um evento de teste e mostra o estado e o tempo que demorou. Não aparece em Entregas.
- **Entregas**: os eventos mais recentes do webhook com o estado, as tentativas e a resposta do recetor. **Entregar novamente** volta a enviar uma entrega falhada, até 7 dias depois da falha.
- Um pedido falhado é repetido até 8 vezes ao longo de cerca de 41 horas. Um webhook é desativado quando o recetor responde 410 Gone, ou quando volta a falhar após 3 dias de falhas sem qualquer sucesso. Um webhook desativado mostra o motivo; ative-o para o voltar a usar.
- Verifique cada pedido com qualquer biblioteca Standard Webhooks, com o corpo original e o `webhook-id` como chave de idempotência.

Mais na wiki: Configuration.

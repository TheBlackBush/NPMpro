## DNS dinâmico

Como o NPMpro mantém os registos do separador DNS dinâmico (Certificados) a apontar para o seu endereço público. Nada é verificado enquanto não houver um registo ativado.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo de cadeado como "Definido por DDNS_PERIOD"). Use a interface para tudo o que não estiver definido no contentor.

- **Verificar a cada**: com que frequência os registos são verificados, de `1m` a `24h` (por exemplo `5m` ou `1h30m`). Predefinição: `5m`. Variável: `DDNS_PERIOD`. Uma alteração reinicia o temporizador.
- **Tempo de espera**: o tempo mínimo entre duas escritas de um registo, no mesmo formato. Predefinição: `5m`. Variável: `DDNS_COOLDOWN`.
- **Serviços de endereço IPv4** e **Serviços de endereço IPv6**: URLs `https://` que respondem com o endereço público. Um endereço novo só é escrito quando dois serviços concordam. Os serviços IPv6 só são consultados enquanto um registo ativado precisar de IPv6. Variáveis: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (separadas por espaços). Um serviço cujo endereço o servidor não pode chamar (um endereço privado ou local) é recusado.
- **Servidores DNS**: os servidores usados para resolver os serviços de endereço e os fornecedores. Vazio usa os resolvedores do contentor. Um endereço IPv4, ou um endereço IPv6 entre parênteses retos, com uma porta opcional. Variável: `DDNS_RESOLVER` (separados por espaços).

Os registos são adicionados no separador DNS dinâmico com uma credencial DNS de um fornecedor que possa atualizar registos.

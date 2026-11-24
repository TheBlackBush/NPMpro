## DNS dinâmico

Como o NPMpro mantém os registos do separador DNS dinâmico (Certificados) a apontar para o seu endereço público. Nada é verificado enquanto não houver um registo ativado.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo de cadeado como "Definido por DDNS_PERIOD"). Use a interface para tudo o que não estiver definido no contentor.

- **Verificar a cada**: com que frequência os registos são verificados, de `1m` a `24h` (por exemplo `5m` ou `1h30m`). Predefinição: `5m`. Variável: `DDNS_PERIOD`. Uma alteração reinicia o temporizador.
- **Tempo de espera**: o tempo mínimo entre duas escritas de um registo, no mesmo formato. Predefinição: `5m`. Variável: `DDNS_COOLDOWN`.
- **Serviços de endereço IPv4** e **Serviços de endereço IPv6**: 2 a 10 URLs `https://` que respondem com o endereço público. Um endereço novo só é escrito quando um segundo serviço o confirma; um endereço inalterado é aceite de um só. Os serviços IPv6 só são consultados enquanto um registo ativado precisar de IPv6. Variáveis: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (separadas por espaços). Um serviço neste anfitrião, num endereço de ligação local (como os metadados da nuvem) ou num endereço multicast ou reservado é recusado; os endereços da rede local privada são permitidos.
- **Servidores DNS para as verificações**: usados apenas para consultar o nome de um registo antes de perguntar ao fornecedor (split horizon); os serviços de endereço e os fornecedores usam sempre os resolvedores do contentor. Vazio usa também aqui os resolvedores do contentor. Um endereço IPv4, ou um endereço IPv6 entre parênteses retos, com uma porta opcional. Variável: `DDNS_RESOLVER` (separados por espaços).

Os registos são adicionados no separador DNS dinâmico com uma credencial DNS de um fornecedor que possa atualizar registos.

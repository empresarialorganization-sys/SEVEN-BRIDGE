# SEVEN Bridge

Cloudflare Worker que conecta o plugin privado **SEVEN Browser** à extensão **SEVEN Operator** instalada no Opera/Chrome.

## Arquitetura

`ChatGPT -> SEVEN Browser -> MCP mínimo -> Cloudflare Worker -> Durable Object -> WebSocket -> Extensão`

O MCP é intencionalmente pequeno e sem espera longa:

- `seven_status` — consulta conexão do dispositivo.
- `seven_command` — enfileira um comando e devolve `commandId` imediatamente.
- `seven_result` — consulta o resultado sem polling interno.

## Dispositivo

- Código visível: 6 dígitos e permanente até o usuário gerar outro.
- Segredo do dispositivo: gerado localmente pela extensão e nunca usado como identificador público.
- `SEVEN_AGENT_KEY`: segredo interno de serviço, configurado como Cloudflare Secret e nunca commitado.
- Um Durable Object é criado por código de dispositivo.
- Apenas uma conexão WebSocket do dispositivo permanece ativa por vez.
- Revogar um dispositivo é definitivo para aquele código/segredo; a extensão deve gerar um novo código.

## Fronteira de autenticação

`SEVEN_AGENT_KEY` não é senha de usuário e não deve ser distribuída para usuários finais.

- A URL estável `/mcp` não depende de `SEVEN_AGENT_KEY`; girar a chave não muda o endereço do MCP.
- A chave continua podendo proteger integrações internas/servidor-servidor.
- Contas de usuário, senhas, sessões e workspaces pertencem à camada de conta SEVEN/Core.
- O Bridge não armazena nem valida senha bruta de usuário.
- O caminho multiusuário deve receber identidade autenticada e resolver somente o dispositivo pertencente àquele usuário.
- As rotas de compatibilidade existentes permanecem apenas para não quebrar o SEVEN Browser v1 já instalado durante a migração; não são o modelo de provisionamento para novos usuários.

## Higiene de abas

O plugin aplica a política SEVEN antes de entregar missões à extensão:

- trabalho em segundo plano;
- reutilização de abas gerenciadas;
- máximo de 3 abas novas por missão;
- grupo recolhido `SEVEN`;
- fechamento automático apenas das abas criadas pela SEVEN;
- `activate` bloqueado;
- ações diretas de `click/type/press/scroll/hover/select` são recusadas: devem ser enviadas como `mission` ou `sequence` para não escapar da política de ilha.

## Ciclo de comandos

- Comandos pendentes expiram após 10 minutos e não são reexecutados indefinidamente após reconexão.
- Resultados ficam disponíveis por 24 horas e depois são limpos pelo Durable Object Alarm.
- A extensão mantém cache local por `commandId`, evitando repetição durante reconexões válidas.

## Endpoints

- `GET /health`
- `POST /v1/device/register`
- `GET /v1/device/connect?code=XXXXXX&secret=...` — WebSocket da extensão
- `POST /v1/device/revoke`
- `GET /v1/status?code=XXXXXX` — Bearer `SEVEN_AGENT_KEY`
- `POST /v1/push` — Bearer `SEVEN_AGENT_KEY`
- `GET /v1/result?code=XXXXXX&id=<uuid>` — Bearer `SEVEN_AGENT_KEY`
- `POST/GET/DELETE /mcp` — MCP estável; autenticação tratada pelo servidor
- rotas de compatibilidade do plugin instalado — preservadas durante a migração, sem derivação de `SEVEN_AGENT_KEY`

## Desenvolvimento

```bash
npm install --ignore-scripts
npm run check
npm test
npm run deploy
```

O CI executa verificação de sintaxe e testes da política de abas em todo push/PR.

## Segurança

Nunca commite `SEVEN_AGENT_KEY`, segredo do dispositivo ou URLs-capability privadas. Não crie endpoints temporários de reparo/diagnóstico no Worker. A URL de conexão WebSocket ainda carrega o segredo do dispositivo na query por compatibilidade com a extensão instalada; migrar a autenticação do WebSocket para um handshake dedicado deve ser feito sem quebrar a extensão validada.

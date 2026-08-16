# SEVEN Bridge

Cloudflare Worker que conecta o plugin privado **SEVEN Browser** à extensão **SEVEN Operator** instalada no Opera/Chrome.

## Arquitetura

`ChatGPT -> SEVEN Browser -> MCP mínimo -> Cloudflare Worker -> Durable Object -> WebSocket -> Extensão`

O MCP é intencionalmente pequeno e sem espera longa:

- `seven_status` — consulta conexão do dispositivo.
- `seven_command` — enfileira um comando e devolve `commandId` imediatamente.
- `seven_result` — consulta o resultado sem polling interno.

Cada instalação do conector ChatGPT/Codex recebe uma URL privada vinculada no
servidor a **um único código de dispositivo**. O schema das ferramentas não
aceita código; por isso o modelo, outra conta ou um prompt não conseguem trocar
o navegador de destino.

## Dispositivo

- Código visível: 6 dígitos e permanente até o usuário gerar outro.
- Segredo do dispositivo: gerado localmente pela extensão e nunca usado como identificador público.
- `SEVEN_AGENT_KEY`: segredo do servidor, configurado como Cloudflare Secret e nunca commitado.
- Um Durable Object é criado por código de dispositivo.
- A URL MCP privada é assinada por HMAC com o segredo do servidor, o segredo
  armazenado do dispositivo e a identidade do Durable Object.
- Alterar o código na URL invalida a assinatura. Revogar o dispositivo invalida
  também a URL MCP correspondente.
- Apenas uma conexão WebSocket do dispositivo permanece ativa por vez.
- Revogar um dispositivo é definitivo para aquele código/segredo; a extensão deve gerar um novo código.

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
- `GET /v1/plugin/path?code=XXXXXX` — apenas servidor-servidor, Bearer
  `SEVEN_AGENT_KEY`; devolve a URL privada vinculada ao dispositivo
- `POST/GET /mcp` — MCP autenticado por Bearer para diagnóstico/integrações servidor-servidor
- `POST/GET /mcp/device/XXXXXX/<token>` — rota privada do conector, vinculada
  ao código no Durable Object; a URL completa nunca é armazenada no repositório

## Separação de contas

1. O app autentica a conta e resolve o dispositivo que pertence ao workspace.
2. O servidor do app solicita `/v1/plugin/path` sem expor `SEVEN_AGENT_KEY` ao navegador.
3. A conta instala a URL devolvida no seu ChatGPT/Codex.
4. O Worker valida a assinatura dentro do Durable Object daquele código antes de abrir o MCP.
5. `seven_status`, `seven_command` e `seven_result` usam sempre o mesmo stub vinculado.

Mesmo que duas contas usem o mesmo modelo/GPT, cada conexão instalada deve usar
a URL privada emitida para a própria conta. Uma URL privada é credencial e não
deve ser compartilhada.

## Desenvolvimento

```bash
npm install --ignore-scripts
npm run check
npm test
npm run deploy
```

O CI executa verificação de sintaxe e testes da política de abas em todo push/PR.

## Segurança

Nunca commite `SEVEN_AGENT_KEY`, segredo do dispositivo ou URLs-capability privadas.
As rotas legadas fixas do Usuário 1 existem somente durante a migração do
conector já instalado e devem ser removidas assim que a URL vinculada for salva
na conta principal. A URL de conexão WebSocket ainda carrega o segredo do
dispositivo na query por compatibilidade com a extensão v0.8; migrar a
autenticação do WebSocket para um handshake dedicado é o próximo hardening
planejado, sem quebrar a extensão instalada.

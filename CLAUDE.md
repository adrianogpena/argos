# Argos: plano e decisões

Este arquivo registra o que foi decidido na conversa que originou o projeto. Leia inteiro antes de mexer em qualquer coisa. O dono fala português (Brasil); converse e escreva as telas novas em português. O app de ônibus herdado está em inglês, e pode continuar assim.

## O que é

Um painel pessoal (dashboard) para os dados do dia a dia do dono. Nasceu como **Paragem**, um app de ônibus (STCP e UNIR, Porto), e vai virar **Argos**, com módulos:

| Módulo | Arquivo | Estado |
|---|---|---|
| Início (resumo) | `index.html` | pronto |
| Ônibus | `onibus.html` | pronto (herdado de Paragem) |
| Carro (km, abastecimento, consumo, manutenção, lembretes) | `carro.html` | pronto |
| Gastos (gráfico mensal e por categoria; soma o carro) | `gastos.html` | pronto |

Nome escolhido: **Argos** (o gigante de cem olhos). Cada módulo é uma página própria, sem build, sem framework. Lógica pura em `lib/*.js` (módulos ES, testáveis em Node).

## Regra número um: dados pessoais nunca entram no git

O repositório e o site são **públicos**. Portanto:

- O repositório contém **somente código**. Nada de dados reais, nem como exemplo: nem trajetos, paradas de casa/trabalho/escola, endereços, placas, valores, kms, tokens, URLs de Worker privado com segredo.
- Os dados ficam num **cofre privado**: Cloudflare Worker + KV (`vault/`), protegido por token secreto. A página só guarda a URL e o token no `localStorage` do aparelho e uma cópia dos registros para funcionar offline.
- Nunca commitar: `.env`, `.dev.vars`, `backup-*.json`, `data/`, `*.pem` (já no `.gitignore`). Nunca colar token em commit, issue, PR ou exemplo de teste.
- Testes usam dados **fictícios** (paradas `vng:1`…, nomes "Praça Exemplo"). Mantenha assim.
- Se uma tarefa pedir dado pessoal real no código, pare e proponha guardar no cofre.

## Arquitetura de segurança (decidida e implementada)

```
Aparelho ──Authorization: Bearer <token>──▶ Worker "vault" ──▶ KV
      ▲
Hospedagem estática: só código
```

- `vault/worker.js`: sem token válido responde 401. Comparação por hash em tempo constante. 8 tokens errados por IP em 15 min bloqueiam o IP (429). CORS restrito a `ALLOWED_ORIGIN` (sem ela configurada, recusa tudo). Falta de configuração falha fechado (500).
- API: `GET /v1/ping`, `GET /v1/c/:colecao`, `PUT|DELETE /v1/c/:colecao/:id`, `GET /v1/export`. Limites: registro de 8 KB, 20 000 itens por coleção.
- Coleções em uso: `car-fuel`, `car-service`, `expenses`, `bus-setup`.
- `lib/vault.js` (cliente): cache local, fila de edições offline, erros tipados (`auth`, `network`, `server`, `config`). A URL do cofre exige `https://` (exceto `localhost`, para testes).
- O token é gerado pelo dono (`openssl rand -hex 32`) e guardado com `wrangler secret put VAULT_TOKEN`. Troca de token = revoga os aparelhos antigos.
- Limite conhecido e aceito: a Cloudflare hospeda os dados. Para dado mais sensível (saúde, documentos) criptografar no navegador antes de enviar, ainda não implementado.

## Decisões do dono

1. **Etapa B** (cofre com token, acesso de vários aparelhos). Repositório pode continuar **público**.
2. Nome: **Argos**.
3. **Sem** botão "sair e apagar deste aparelho". Para revogar um aparelho, troque o token.
4. **Repositório novo, sem histórico**, e o antigo (`paragem`) será apagado. Motivo: o histórico antigo contém trajetos pessoais. A cópia limpa é um único commit inicial.
5. **Hospedagem: Cloudflare Pages, não GitHub Pages.** O dono tem outros projetos em `*.github.io`, e todos os sites de um mesmo usuário compartilham a origem (`usuario.github.io`) e portanto o `localStorage`: qualquer um deles poderia ler o token do cofre. No Cloudflare Pages o Argos tem origem própria (`argos.pages.dev` ou semelhante).
6. Quer um gráfico dos gastos (feito) e acha que o painel vai crescer com outros assuntos do dia a dia.

## Estado da migração (repositório `argus`)

Feito: renomear para Argos (chave `argos.v1` migra `paragem.v1`; cache `argos-v1`; `argos-proxy`); hospedagem trocada para Cloudflare Pages (`pages.dev`; `ALLOWED_ORIGIN` provisório `https://argos.pages.dev`, ajustar para a origem real); home em `index.html` com gasto do mês e lembretes do carro (`lib/home-core.js`); ônibus movido para `onibus.html`.

Pendente (depende do dono): criar o projeto no Cloudflare Pages; confirmar a origem real e a URL do Worker `argos-proxy` (`PAGES_PROXY` em `onibus.html`); deploy do cofre (`vault/README.md`; nunca pedir o token, use `request_credential`); no app, **Settings → Save setup to vault**; só então apagar o repositório antigo `paragem`. Ideia para a home: próximo ônibus (precisa da chamada ao vivo da STCP).

## Ideias futuras (não decididas)

- Gastos: orçamento por categoria com alerta; gastos recorrentes (aluguel, assinaturas); importar extrato bancário em CSV (processar no navegador, nunca enviar a terceiros).
- Carro: custo total por km incluindo manutenção; lembrete de seguro, IPVA/imposto e inspeção periódica.
- Outros módulos: saúde (peso, consultas, medicação), contas a vencer, treinos. Cada um é uma coleção nova no cofre e uma página nova, sem mudar o Worker.
- Criptografia no navegador para módulos sensíveis.
- Notificações (lembretes) via Cloudflare Cron + Worker.

## Convenções

- Sem build, sem dependências de runtime. HTML, CSS e JS puros; módulos ES em `lib/`.
- Visual: mesmo sistema do app de ônibus (variáveis CSS `--bg`, `--surface`, `--ink`, tema claro/escuro automático, fontes Archivo e IBM Plex Mono). Gráficos: uma cor por série, eixo único, rótulos diretos, dica ao passar o mouse e ao focar (acessível pelo teclado). Ver a skill `dataviz`.
- Texto digitado pelo usuário sempre passa por `esc()` antes de entrar em HTML.
- Valores em euro (`€`), formatados com `pt-BR`. Aceitar vírgula decimal nas entradas.
- Toda lógica nova vai em `lib/*.js` com teste em `test/*.test.mjs`.

## Testes

```
node test/core.test.mjs       lógica dos ônibus (16)
node test/vault.test.mjs      Worker do cofre e cliente (10 grupos)
node test/car.test.mjs        consumo, resumo, lembretes (9)
node test/expenses.test.mjs   gastos (7)
node test/home.test.mjs       resumo da home (3)
```

Rode os cinco antes de commitar. O `core.test.mjs` extrai o bloco `<script id="core">` do `onibus.html`. Para testar as páginas no navegador: servir a pasta com um servidor estático, rodar o `vault/worker.js` com um KV em memória (o `test/vault.test.mjs` mostra como simular) e abrir com Playwright.

## Como criar o repositório novo limpo

```bash
git clone --depth 1 <repo-antigo> temp && cd temp
mkdir ../argos
git archive HEAD | tar -x -C ../argos      # arquivos, sem a pasta .git
cd ../argos && git init -b main && git add -A
git commit -m "Argos: initial commit"
# no GitHub: criar o repositório vazio "argos" e então
git remote add origin git@github.com:<usuario>/argos.git && git push -u origin main
```

Conferir antes do push que `git log` tem **um** commit e que nenhum arquivo `backup-*.json`, `.env` ou dado pessoal veio junto.

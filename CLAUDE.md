# Argos: plano e decisões

Este arquivo registra o que foi decidido na conversa que originou o projeto. Leia inteiro antes de mexer em qualquer coisa. O dono fala português (Brasil); converse e escreva as telas novas em português. O app de ônibus herdado está em inglês, e pode continuar assim.

## O que é

Um painel pessoal (dashboard) para os dados do dia a dia do dono. Nasceu como **Paragem**, um app de ônibus (STCP e UNIR, Porto), e vai virar **Argos**, com módulos:

| Módulo | Arquivo | Estado |
|---|---|---|
| Início (resumo) | `index.html` | pronto |
| Ônibus | `onibus.html` | pronto (herdado de Paragem) |
| Carro (km, abastecimento, consumo, manutenção, lembretes) | `carro.html` | pronto |
| Gastos (gráfico mensal e por categoria; só mostra e edita; o extrato é importado pelo Claude via skill `importar-extrato`; os registros da tela Carro **não** são somados (evita contar em dobro), mas combustível e portagem do extrato entram sempre, como Transporte; `tools/expenses.mjs fuel` liga cada abastecimento do Carro ao lançamento de mesmo valor (0 a 5 dias) e o recategoriza como Combustível, para postos dentro de supermercado; meses com extrato mostram só dados reais, e o mês seguinte ao último extrato mostra só a previsão) | `gastos.html` | pronto |
| Cartão (previsão das parcelas futuras sem compras novas, data de quitação, acréscimo x baixa por extrato, "meu plano" = débito automático no mínimo + extras manuais) | `cartao.html` | pronto; lê `card-statements`/`card-lines`; lógica em `lib/card-forecast.js` |
| Saúde (peso e altura de pessoas e bichos) | `saude.html` | pronto; dados importados do Supabase uma única vez |
| Faturas (lê o QR fiscal pela câmera do celular e guarda só os campos do QR, sem imagem; coleção `receipt-qr`, id = NIF-ATCUD, com o texto bruto em `raw` e `expenseId` = lançamento de Gastos com o mesmo valor, 0 a 5 dias, via `linkQr`; `tools/expenses.mjs review` mostra o `nif:` do QR ligado a cada pendente para ajudar a categorizar; o QR não traz itens; cada QR válido é salvo na hora e a câmera continua aberta; `qr-merchants` = nome e categoria por NIF do emitente e `qr-people` = nome por NIF do comprador (campo B; 999999990 = consumidor final, sem comprador), ambos perguntados na 1ª vez; não salva se já houver fatura digital com itens de mesma data e valor; `check` diff = bases + IVA não fecham com o total; nota de crédito NC entra negativa e não liga a gasto; o IVA vem da soma dos campos por taxa, porque alguns emitentes põem em `N` a soma das bases) | `faturas.html` | pronto; parser em `lib/qr-invoice.js`, jsQR copiado em `lib/jsqr.js` (reserva sem `BarcodeDetector`) |

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
- Coleções em uso: `car-fuel`, `car-service`, `car-status` (leituras do odômetro: km, nível do tanque em % lido num mostrador deslizante, com litros estimados sobre 45 L, autonomia e consumo do painel, observação), `expenses` (lançamentos manuais e do extrato; do extrato: `source:'bank'`, `need` essencial/flexível, `auto:true` = palpite não confirmado, `key` = chave do comerciante; `label` = rótulo curto que detalha a categoria, ex.: Transporte › Combustível; categorias continuam a lista fechada, o rótulo é livre e reusado; vem do palpite/regra e a tela mostra "Detalhe por rótulo no mês"; `tools/expenses.mjs groups`/`label` rotulam o que já está gravado), `expense-rules` (regras aprendidas: id = chave do comerciante, categoria, tipo e `tag` = rótulo), `bank-lines` (arquivo morto do extrato: toda linha do banco, de todas as contas, com sinal e saldo; **nenhuma tela nem relatório lê**, serve só para conferir o extrato original; gravada por `tools/expenses.mjs raw`; cada linha tem `stmt`=AAAA-MM do extrato e `file`), `bank-months` (um registro por mês do extrato, id AAAA-MM: `status` arquivado = só em bank-lines | pendente = já em Gastos, falta validar | validado, `validatedAt`, `snapshot` com os totais; fluxo: `tools/expenses.mjs months` / `month AAAA-MM [--lines]` mostra o relatório de conferência / `validate AAAA-MM --apply`; lógica em `lib/bank-month.js`). Meses novos entram em Gastos só depois de validados, `card-statements` (extrato do cartão VISA, 1 por mês: TAN, limite, saldos, imputação do pagamento em capital/juros/selo, próximo pagamento, plano de parcelas, conferência e estado) e `card-lines` (toda linha do cartão com `kind` e o vínculo `bankLineId` com a saída da conta; nenhuma tela lê; gravados por `tools/card.mjs`, lógica em `lib/card-month.js`; o pagamento do cartão na conta é "não é gasto", o consumo entra em `expenses` com `source:'card'` na data da compra e os encargos como itens `ck` interest/stamp/fee), `bus-setup`, `health-members` (nome, tipo `human`/`pet`, espécie, sexo, nascimento, observações), `health-measures` (membro, medida `weight` em kg ou `height` em cm, valor, data; id = membro-medida-data, então a mesma medida no mesmo dia se substitui), `receipts` (uma fatura de supermercado por registro: loja, filial, data, hora, documento, total, poupança, forma de pagamento, final do cartão, conferência e `expenseId` = lançamento de Gastos com o mesmo valor, de 0 a 5 dias) e `receipt-lines` (um item por registro: nome, `pkey` = nome normalizado para comparar preços, seção da loja, IVA, `qty` ou `weightKg`, preço unitário, bruto, desconto, líquido, `kind` item/deposit/discount, categoria do produto e `need`; `auto:true` = palpite por nome, `set` grava `auto:false` e a reimportação respeita). Veja "Faturas do mercado".
- `POST /v1/c/:colecao` com `{items:[...]}` grava até 500 registros de uma vez (importações; o KV aceita ~1 escrita/s por coleção, então gravar um a um não serve). Exige `wrangler deploy` do Worker.
- `lib/vault.js` (cliente): cache local, fila de edições offline, erros tipados (`auth`, `network`, `server`, `config`). A URL do cofre exige `https://` (exceto `localhost`, para testes).
- O token é gerado pelo dono (`openssl rand -hex 32`) e guardado com `wrangler secret put VAULT_TOKEN`. Troca de token = revoga os aparelhos antigos.
- Limite conhecido e aceito: a Cloudflare hospeda os dados. Para dado mais sensível (saúde, documentos) criptografar no navegador antes de enviar, ainda não implementado.

## Decisões do dono

1. **Etapa B** (cofre com token, acesso de vários aparelhos). Repositório pode continuar **público**.
2. Nome: **Argos**.
3. **Sem** botão "sair e apagar deste aparelho". Para revogar um aparelho, troque o token.
4. **Repositório novo, sem histórico**, e o antigo (`paragem`) será apagado. Motivo: o histórico antigo contém trajetos pessoais. A cópia limpa é um único commit inicial.
5. **Hospedagem: Cloudflare Pages, não GitHub Pages.** O dono tem outros projetos em `*.github.io`, e todos os sites de um mesmo usuário compartilham a origem (`usuario.github.io`) e portanto o `localStorage`: qualquer um deles poderia ler o token do cofre. No Cloudflare Pages o Argos tem origem própria (`argos-ejb.pages.dev` ou semelhante).
6. Quer um gráfico dos gastos (feito) e acha que o painel vai crescer com outros assuntos do dia a dia.

## Estado da migração (repositório `argos`)

Feito e no ar:
- Repositório limpo `adrianogpena/argos`, sem histórico do Paragem. `main` é a produção.
- Cloudflare Pages: `https://argos-ejb.pages.dev`, deploy automático a cada push na `main`.
- Cofre (Worker `vault` + KV) em `https://vault.adrianogpena.workers.dev`, com `ALLOWED_ORIGIN` = `https://argos-ejb.pages.dev` e `VAULT_TOKEN` configurado. `/v1/ping` sem token retorna 401, como esperado.
- Proxy dos ônibus em `https://argos-proxy.adrianogpena.workers.dev` (mesmo `ALLOWED_ORIGIN`; `PAGES_PROXY` em `onibus.html` confirmado). `onibus.html` mostra as chegadas.
- Código: renomeado para Argos (chave `argos.v1` migra `paragem.v1`; cache `argos-v2`), home em `index.html` (`lib/home-core.js`), ônibus em `onibus.html`.

Migração concluída:
- O app conecta ao cofre (carro usa o token com sucesso) e o setup dos ônibus, incluindo as linhas UNIR, está salvo no cofre (`bus-setup`).
- O repositório antigo `paragem` foi apagado pelo dono.
- Lição: cada origem tem seu próprio `localStorage`; dados do site antigo não migram sozinhos, só por "Copy setup" e "Paste a setup".

Regra: nunca pedir, escrever ou registrar o token; se precisar de credencial, usar `request_credential`.

Home: card "Próximo ônibus" feito (`lib/home-bus.js`; lê `bus-setup` do cofre; STCP ao vivo pela chamada via proxy e UNIR por horário). `lib/bus-core.js` e `lib/bus-net.js` são compartilhados entre `onibus.html` e a home. Ideias: escolher linha por horário do dia (casa de manhã, trabalho à tarde) e permitir fixar quais linhas aparecem.

## Extrato do banco (feito)

**Não há importação na página.** O dono pede ao Claude para importar o extrato (PDF ou CSV, um mês ou vários) e usa a skill `.claude/skills/importar-extrato/SKILL.md`: o Claude lê o arquivo (mais confiável que um parser rígido), decide o que é gasto (poupança, depósitos a prazo e transferências próprias ficam de fora), classifica e grava com `tools/expenses.mjs` (`rules` lista as regras aprendidas; `push` simula e `--apply` grava via `POST /v1/c/expenses`). Roda no computador do dono com `VAULT_URL`/`VAULT_TOKEN` no ambiente; **as variáveis ficam em `~/.argos-vault.env`** (fora do git): quando `tools/*.mjs` pedir e elas não estiverem no ambiente, confira esse arquivo (`sed -E 's/=.*/=<oculto>/' ~/.argos-vault.env` mostra só os nomes) e carregue só dentro do comando (`set -a; . ~/.argos-vault.env; set +a; node tools/...`). Nunca imprimir, copiar nem registrar o valor do token. **Só data e valor são verdade**; categoria e tipo são palpites (`auto:true`, "revisar" na tela) até o dono editar ou confirmar; isso grava uma regra em `expense-rules`, que o script reaplica nas próximas importações. Regra com `skip:true` = "não é gasto" (poupança, depósito a prazo, conta da esposa, transferência própria): o `push` descarta; criadas com `tools/expenses.mjs rule <chave> --skip`. A categoria no formulário é dropdown fechado (`categoryOptions`/`canonicalCategory` em `lib/expenses-core.js`) com "+ Nova categoria…" no fim, para não duplicar por erro de digitação. Ids determinísticos (`bankId` em `lib/classify.js`: data+valor+descrição): reimportar nunca duplica nem sobrescreve edições. Depois de gravar, o Claude revisa os pendentes (`tools/expenses.mjs review` / `confirm`): pesquisa o nome do comerciante, confirma sozinho os de alta confiança (viram regra) e deixa "revisar" só os duvidosos. Dados do carro não entram em Gastos nem na home. Dados reais de extrato nunca entram no git, na skill nem em testes.

## Faturas do mercado (Pingo Doce, Intermarché e Lidl)

Os emails de fatura do Pingo Doce (`facturaelectronica@pingodoce.pt`) e do Intermarché (`no-reply@eticket.intermarche.com`) trazem um PDF com cada item. Fluxo: o Claude busca no Gmail, baixa os PDFs (`download_gmail_attachment`) e roda `node tools/receipts.mjs import <pdfs> [--apply]` (`pdftotext -raw`; lógica em `lib/receipt.js`). Cada fatura só grava se a soma dos itens fechar com o total pago. **Gastos não é alterado**: as faturas só detalham o lançamento genérico do mercado. Dono: essencial = comida básica, higiene/limpeza e comida de bicho; flexível = doces, snacks, refrigerantes, sumos, pastelaria/salgados, pizzas e refeições prontas, refeições na loja, jogos e brinquedos (a lista fica em `NEED_OF`/`RULES` de `lib/receipt.js`). Comandos: `report [AAAA-MM]`, `compare AAAA-MM AAAA-MM` (separa efeito do preço, da quantidade e de produtos novos/deixados; precisa de vários meses e da mesma loja/nome), `lines AAAA-MM [categoria]`, `set <categoria> <essential|flexible> <trecho>`. Importado: Pingo Doce/Intermarché de 12/2024 a 21/09/2026 vindo do Gmail (220 faturas, 2 e-mails só com imagem ignorados); Lidl de 23/11/2024 a 22/11/2026 vindo do app (ver abaixo) e mais 35 talões antigos (16/02/2024 a 16/11/2024 e 30/03/2025, que o app não deixa baixar) lidos da tela por captura ADB e transcritos à mão, com conferência da soma (0 falhas). **Lidl**: as faturas só existem no app Lidl Plus (não há e-mail e a API recusa clientes de fora, não contornar). Fluxo: o dono conecta o celular Android por USB (depuração USB, desbloqueado) e o Claude dirige o app com ADB, como uso normal da conta dele: Conta > Talões digitais > filtro de data > talão > "Mais ações" > "Descarregar fatura eletrónica", que gera `AAAA.MM.DD_<id>.pdf` em `/sdcard/Download` (texto exato, sem OCR); depois `adb pull`, `import` normal (`parseLidl`; `paid` = Total menos vale depósito, igual à lista do app e ao extrato) e apagar os PDFs do celular e do computador. O app só gera PDF de talões com menos de 2 anos; talões mais antigos abrem na tela, mas o download falha, e OCR da tela não é confiável (quebra os preços): para esses, capturar a tela (`screencap`), ler a imagem com visão (2 capturas por talão bastam; rolar 1000 px com `input swipe` lento) e transcrever em `.txt` no formato do `pdftotext -raw` (inclui "FATURA" com "No : VD …", desconto "DESCONTO 30%" e "Anulacao"; o NIF do talão não é transcrito); a lista do app tem os valores para conferir cada Total. Cuidado com a navegação por coordenadas: o menu de datas e o de ações mudam de posição entre execuções, então achar o texto na tela, e conferir a contagem de linhas da lista contra os PDFs (uma varredura só pode pular linhas). PDF sem texto (só imagem) não dá para ler e fica de fora. Compras no débito só aparecem no extrato dias depois; faturas de meses sem extrato importado ficam sem `expenseId` até o extrato entrar (rode `import` de novo). Os PDFs e os dados das faturas nunca entram no git.

## Ideias futuras (não decididas)

- Gastos: orçamento por categoria com alerta; gastos recorrentes (aluguel, assinaturas).
- Gastos em dinheiro (decidido em 2026-11-23: **não fazer agora**, o dono usa pouco dinheiro vivo). Hoje o levantamento (ATM) entra inteiro como `Outros › Levantamento`, flexível. Plano se um dia valer a pena ("carteira"): o saque continua sendo o gasto (o total do mês nunca muda, sem contagem dupla) e ganha um saldo "não detalhado"; cada despesa em dinheiro, ou QR de fatura pago em dinheiro, **reparte** esse saldo (ex.: saque de 100 = 50 Luz + 50 Lazer; o resto fica em "Levantamento"). Dados: coleção nova `cash-allocations` (saque, categoria, tipo, rótulo, valor, `qrId` opcional), sem mudar o Worker nem os lançamentos existentes; tela pequena que mostra o saldo de cada saque e deixa detalhar. O QR não traz forma de pagamento: fatura em `receipt-qr` sem lançamento do banco ligado (`linkQr` sem `expenseId`) é candidata a dinheiro e entra como sugestão. Antes de implementar, medir quanto os levantamentos pesam nos gastos (se forem poucos %, não compensa).
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

## Git

- Push direto na `main` é permitido (sem PR obrigatório), mas **sempre pergunte ao dono antes de cada push**: a `main` publica no Cloudflare Pages. Commitar localmente não precisa de pergunta; o push precisa, toda vez (aprovação anterior não vale para o próximo push).
- Antes de commitar: rodar todos os testes e conferir que o diff não leva dado pessoal (regra número um).


## Erro 500 ao gravar no cofre = limite diário de gravações do KV

Se `tools/*.mjs` ou qualquer `PUT`/`POST`/`DELETE` no cofre responder **500** com página HTML da Cloudflare (não JSON do Worker) enquanto as leituras (`GET`) funcionam, a causa é o limite diário de gravações do KV (plano gratuito, ~1000 por dia, zera à meia-noite UTC). O dono confirmou: pode tratar como certo, sem investigar mais. Não insistir em loop nem trocar de método (PUT/POST sofrem igual); avisar o dono, não mexer em nada e retomar depois que a cota zerar. Para gastar menos cota: gravar em lote (`POST` com `items`, até 500) em vez de um registro por vez.

## Testes

```
node test/core.test.mjs       lógica dos ônibus (16)
node test/vault.test.mjs      Worker do cofre e cliente (12 grupos)
node test/car.test.mjs        consumo, resumo, lembretes, leituras do odômetro (13)
node test/expenses.test.mjs   gastos (8)
node test/home.test.mjs       resumo da home (4)
node test/home-bus.test.mjs   próximo ônibus da home (4)
node test/fuelio.test.mjs     importação do Fuelio (4)
node test/health.test.mjs     saúde: peso, altura, idade, conversão do Supabase (7)
node test/classify.test.mjs   classificação e plano de importação (7)
node test/bank-month.test.mjs conferência mensal do extrato (3)
node test/card-month.test.mjs extrato do cartão: parser, conferências, vínculo com o banco (13)
node test/card-forecast.test.mjs previsão do cartão: parcelas, quitação, acréscimo x baixa, plano com extras (11)
node test/expenses-report.test.mjs relatórios de Gastos: salário com 13º/14º, fixos, previsão, ritmo (10)
node test/qr-invoice.test.mjs QR fiscal das faturas: parser (9 casos)
node test/fuel-link.test.mjs  abastecimento do Carro x Gastos: recategoriza o lançamento ligado (4)
node test/receipt.test.mjs    faturas do mercado: parser Pingo Doce/Intermarché/Lidl, categorias, vínculo com Gastos, preço x quantidade (15)
```

Rode todos antes de commitar. O `core.test.mjs` testa `lib/bus-core.js` (a lógica pura dos ônibus, antes embutida no `onibus.html`). Para testar as páginas no navegador: servir a pasta com um servidor estático, rodar o `vault/worker.js` com um KV em memória (o `test/vault.test.mjs` mostra como simular) e abrir com Playwright.

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

## Importação do Fuelio (única)

`tools/import-fuelio.mjs` lê um `vehicle-N-local.csv` do backup do Fuelio (`lib/fuelio.js`) e grava em `car-fuel` / `car-service`. Roda no computador do dono com `VAULT_URL` e `VAULT_TOKEN` no ambiente; sem `--apply` só simula. Ids estáveis: repetir sobrescreve. O app guarda um só carro: importar apenas o veículo ativo (o Captur), nunca misturar dois carros (os odômetros se confundem). Os CSVs nunca entram no git.

## Importação do Supabase (feita)

Peso e altura vieram do antigo Supabase numa importação única, já concluída (5 membros, 55 medidas em `health-members` / `health-measures`). O script foi apagado; `fromRows` em `lib/health-core.js` e seus testes ficam. Lição: ao exportar, ligar `members` e `measurements` por `member_id`, nunca só por `user_id` (isso multiplica cada medida por todos os membros).

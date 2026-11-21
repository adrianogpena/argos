---
name: importar-extrato
description: Lê extratos bancários (PDF, CSV ou texto; um mês ou vários meses num arquivo) e grava os gastos no cofre do Argos (coleção `expenses`), com categoria, tipo e rótulo. Também revisa os gastos pendentes ("palpite: confira" e "Sem categoria"): pesquisa o nome do comerciante e confirma sozinha os de alta confiança. Use quando o dono pedir para importar, ler, atualizar, lançar, revisar ou confirmar extrato(s)/gastos do banco na aba Gastos.
---

# Importar extrato para o cofre

A aba Gastos só mostra dados; **não tem mais importação**. Quem lê o extrato é você (Claude), e `tools/expenses.mjs` grava no cofre. Leia o CLAUDE.md do projeto antes: o repositório é público, então **nada do extrato (nem trecho, valor, nome, IBAN) vai para o git**, para esta skill, para testes ou para mensagem de commit.

## Passo a passo

1. **Extrair o texto do arquivo**, sempre para a pasta temporária da sessão (scratchpad) ou `data/` (ignorada pelo git), nunca para o repositório:
   - PDF: `pdftotext -raw arquivo.pdf saida.txt`. O modo `-raw` mantém cada lançamento numa linha; `-layout` embaralha colunas. Se `pdftotext` faltar, o Read com `pages` só serve se houver `pdftoppm`; senão peça ao dono para instalar poppler ou exportar CSV.
   - CSV/TXT: ler direto (pode ser Windows-1252; delimitador `;` é comum em bancos portugueses).
2. **Achar os lançamentos.** Um arquivo pode ter vários meses: cada seção tem seu período (ex.: `EXTRATO DE 2023/08/07 A 2023/08/31`). Descarte capa, mensagens legais, cabeçalhos e rodapés repetidos, `A TRANSPORTAR`/`TRANSPORTE`, resumos.
3. **Data completa.** Datas vêm às vezes sem ano (`8.07`, `07-08`); o ano vem do período da seção. Cada lançamento pode ter data do lançamento e data-valor: use a do lançamento (a primeira).
4. **Sinal pelo saldo.** Quando há coluna de saldo, calcule débito/crédito pela variação do saldo em relação à linha anterior (a posição da coluna se perde na extração de PDF). **Confira**: o saldo calculado precisa bater com o saldo final de cada seção/mês. Se não bater, há linha perdida ou lida errado; ache e corrija antes de seguir. Sem saldo, use a coluna de débito/crédito ou o sinal.
5. **Decidir o que é gasto.** Só saída de dinheiro que é consumo vira gasto. **Não entram**:
   - entradas (salário, estornos já descontados, juros);
   - poupança e investimentos: constituição/reforço de depósito a prazo, certificados, fundos, PPR;
   - transferências entre contas do próprio dono;
   - dinheiro recebido por empréstimo e o valor do empréstimo em si (as prestações entram).
   **Regras "NÃO É GASTO"**: `node tools/expenses.mjs rules` mostra as que o dono já definiu (poupança, conta da esposa, transferências próprias...). O `push` já descarta esses lançamentos sozinho; **não pergunte de novo** sobre eles. Quando o dono decidir algo novo ("isso não é gasto"), grave a regra: `node tools/expenses.mjs rule <chave> --skip "rótulo"` (a chave é a do comerciante: minúsculas, sem números e sem palavras de banco, 3 palavras no máximo, como em `descKey`; confira a chave no `rules` ou calcule com `descKey`). Regra de categoria fixa (ex.: aluguel): `rule <chave> <categoria> <essential|flexible|-> [rótulo]`. As regras ficam no cofre, nunca no git.
   Estorno/reembolso de uma compra: abata do gasto original quando for claro; senão ignore e avise. Transferência para pessoa (MB Way, TRF P/) é gasto, mas se o destino for ambíguo (própria conta? pagamento de terceiros?), **pergunte ao dono** em vez de adivinhar. Junte as dúvidas numa pergunta só.
6. **Categoria e tipo** (palpites; ficam marcados "revisar" na tela até o dono confirmar):
   - Rode `node tools/expenses.mjs rules` para ver as regras já aprendidas e as categorias em uso; **reuse as categorias existentes** e respeite as regras aprendidas (o script também as aplica por cima do seu palpite). A tela de Gastos usa dropdown fechado de categorias: escreva sempre a grafia existente (ex.: `Saúde`, não `saude`) e só crie categoria nova quando nenhuma servir.
   - Categorias usuais: Moradia, Contas (luz, água, gás, internet, telemóvel), Mercado, Saúde, Transporte (combustível, portagens, estacionamento, transporte público), Seguros, Impostos, Educação, Assinaturas, Restaurantes, Lazer, Compras, Outros.
   - Tipo: `essential` (moradia, contas, mercado, saúde, transporte do dia a dia, seguros, impostos, educação) ou `flexible` (lazer, restaurantes, assinaturas, compras). Em dúvida, deixe `need` vazio e a categoria `Sem categoria`.
   - Levantamento em caixa (ATM): `Outros`, `flexible`.
   - **Rótulo (`label`)**: as categorias são largas (Transporte junta combustível, portagem, estacionamento e transporte público), então todo gasto cuja categoria abrange coisas diferentes ganha um rótulo curto (até 30 caracteres, Title Case, singular) que diz **o que foi**, para o relatório detalhar. Veja a seção "Rótulos" abaixo. Gasto que já é específico por si só (ex.: Moradia só tem aluguel) pode ficar sem rótulo. O rótulo é palpite como a categoria: acompanha o `auto`, e a regra aprendida (`tag`) o reaplica nas próximas importações.
7. **Montar o JSON** em arquivo temporário (fora do git): `[{"date":"AAAA-MM-DD","amount":12.5,"desc":"texto do banco, sem encurtar","category":"Mercado","need":"essential","label":"Supermercado"}]`. `amount` positivo. Mantenha `desc` fiel ao texto do banco (o id e a chave do comerciante saem dele; reimportar o mesmo lançamento gera o mesmo id, então não duplica nem sobrescreve edições).
8. **Simular e mostrar ao dono**: `node tools/expenses.mjs push entradas.json` (usa `VAULT_URL`/`VAULT_TOKEN` do ambiente para checar duplicados e regras; sem eles ainda simula). Mostre total por mês, quantos lançamentos entraram quantos o `push` descartou por regra "não é gasto" e o que você mesmo deixou de fora e por quê (dúvidas novas). Só depois de o dono aprovar:
9. **Gravar**: `node tools/expenses.mjs push entradas.json --apply`. Se `VAULT_URL`/`VAULT_TOKEN` não estiverem no ambiente, **confira `~/.argos-vault.env`** e carregue-o só dentro do comando (`set -a; . ~/.argos-vault.env; set +a; node tools/expenses.mjs ...`), sem mostrar o conteúdo; só se o arquivo não existir peça ao dono. **Nunca peça, escreva nem registre o token.** O Worker precisa estar com `POST /v1/c/:colecao` (`wrangler deploy` em `vault/`).
10. **Revisar os pendentes (fase 2, sempre depois de gravar)**: tudo que entra pelo `push` fica "palpite: confira" (`auto`). Não deixe o dono confirmar um por um o que dá para verificar:
    1. `node tools/expenses.mjs review [AAAA-MM]` lista os pendentes por comerciante, maiores primeiro. Chaves do mesmo comerciante separadas por localidade/sufixo vêm unificadas num **grupo** (id do grupo + chaves entre parênteses; `descKey`, ids e regras não mudam). Colunas: qtd, total, média, primeira→última data, categoria/tipo/rótulo atuais, `motivo`, sinais (intermediário, ramo declarado no texto do banco, recorrente-baixo) e exemplo. Opções: `--motivo=X`, `--sem-motivo`, `--links` (link de busca por comerciante), `--html=arquivo` (página para o dono percorrer pesquisando; contém dados reais, gerar só no scratchpad e apagar depois), `--sugerir=decisoes.json` (decisões de alta confiança só do ramo declarado no texto do banco). Trabalhe **um mês por vez**: o dono valida mês a mês.
    2. Para cada comerciante, descubra **o que ele é**, pelo nome: use o seu conhecimento (redes, marcas, bancos, operadoras conhecidas não precisam de busca) e, para nomes que você não conhece, `WebSearch` com **só o nome do estabelecimento (e a localidade, se ajudar a desambiguar)**. Para nomes que são só razão social ("Fulano e Filhos Lda"), consulte **Racius** (`racius.com/<nome-com-hifens>/`) e **Iberinform** (`iberinform.pt/empresa/<id>/<nome>`) pela Kedalion/`WebSearch`, só com o nome da empresa e a localidade (nunca NIF do dono, valores ou datas): o CAE e a descrição de atividade mostram o ramo. O CAE é evidência do ramo, mas descreve o registro, não o que a banca vende; a marca/operadora conhecida (ex.: Áreas Portugal = restauração) também identifica o ramo, mesmo com nome de ponto de venda desconhecido. Também vale cruzar referências dentro do próprio extrato (ex.: o mesmo número de apólice ou contrato em dois lançamentos). Isso vale para os "Sem categoria" (descobrir a categoria) e para os que já têm palpite (conferir se o palpite está certo: as regras por palavra-chave erram, p. ex. uma palavra de operadora dentro do nome de um cinema).
    3. **Privacidade na busca:** envie só o nome limpo do comerciante. Nunca valores, datas, números de cartão, referências, IBAN, nem nomes de pessoas. **Transferências para pessoas e MB Way para números mascarados não se pesquisam**: ficam para o dono.
    4. **Grau de confiança** decide o `confirm`:
       - **Alta** (confirme, `confirm:true`): marca ou rede conhecida, a busca identificou claramente o negócio e o ramo, o texto do próprio banco diz o que é (farmácia, restaurante, prestação, imposto), ou é o mesmo comerciante de uma regra que o dono já confirmou. Vira regra aprendida e vale nas próximas importações.
       - **Dúvida** (`confirm:false`): a busca não achou, achou homônimos, o nome serve para mais de um ramo, ou é intermediário de pagamento (gateways, agregadores) que não diz o que foi comprado. Se tiver um palpite razoável, grave a categoria com `confirm:false` (continua "revisar" para o dono); se não tiver nenhum, **não inclua** na decisão e deixe como está. Em dúvida, nunca confirme. **Toda dúvida leva `motivo`** (`intermediário` | `pessoa` | `busca-sem-resultado` | `exterior` | `homónimos` | `ramo-ambíguo`): é gravado no gasto pendente, aparece no `review` (filtro `--motivo=`) e some ao confirmar. O script **recusa** `confirm:true` para intermediários de pagamento (hipay, ifthenpay, buyon, eupago, easypay, paypal, stripe, payshop), chaves genéricas e decisões com `motivo`. Compras no exterior sem ramo claro: `exterior`. A recorrência (mesmo comerciante, valor baixo e frequente) é só sinal de apoio, nunca critério único.
       - Busca web só acha bem empresas registradas e marcas; comércio pequeno de bairro quase nunca aparece. Não force: deixe para o dono.
    5. Monte `decisoes.json` (fora do git): `[{"key":"id-do-grupo-ou-chave","keys":["chave-extra"],"category":"Mercado","need":"essential","label":"Supermercado","confirm":true}]` (dúvida: `"confirm":false,"motivo":"busca-sem-resultado"`; `key` = id do grupo aplica a todas as chaves dele e grava uma regra por chave original; `keys` une chaves que a heurística não uniu) (`label` opcional: omitido mantém o rótulo atual; `""` remove). Chaves genéricas (como transferências MB Way) são recusadas pelo script de propósito. Reuse categorias existentes (`rules` as lista); só crie categoria nova quando for clara e nenhuma existente servir, e avise o dono.
    6. Simule: `node tools/expenses.mjs confirm decisoes.json` (mostra quantos serão confirmados, quantos ficam com dúvida, por motivo, e categorias novas; imprime RECUSADA/AVISO). Mostre o resumo ao dono e aplique com `--apply` (a confirmação automática de alta confiança já foi autorizada pelo dono; mesmo assim, avise o que fez). Só mexe em lançamentos ainda pendentes; o que o dono confirmou nunca é alterado.
    7. Ao final, relate: quantos confirmados, quantos ficaram com dúvida e **quais comerciantes** restaram para o dono (com a sua melhor hipótese e o motivo); depois o dono aceita as hipóteses e você grava com `confirm:true`, e as correções de palpite que você fez.
11. **Arquivar o extrato inteiro (sempre)**: além dos gastos, grave **todas** as linhas do extrato (gastos, entradas, poupança, transferências, todas as contas) na coleção `bank-lines`, que não aparece em tela nem relatório e só serve para conferir o original. Gere `linhas.json` (fora do git) com `[{account,accountNo,period,date,valueDate,desc,amount(com sinal: negativo = saída),balance,seq}]` e rode `node tools/expenses.mjs raw linhas.json --apply` (ids estáveis: reimportar não duplica). Assim nada que a regra "não é gasto" descartou se perde.
12. **Mês a mês (extratos novos)**: depois de arquivar em `bank-lines`, rode `node tools/expenses.mjs months --init` para criar o registro do mês em `bank-months`. O mês só entra em Gastos (`push`) depois que o dono conferir `node tools/expenses.mjs month AAAA-MM` com o extrato do banco; ao aprovar, `validate AAAA-MM --apply`.
13. **Apagar** os arquivos temporários com texto do extrato e `decisoes.json` ao terminar.

## Rótulos

Um rótulo detalha a categoria sem mudar a lista fechada de categorias. Campo `label` no gasto, `tag` na regra aprendida.

- **Reuse os rótulos existentes**: `node tools/expenses.mjs rules` mostra a coluna de rótulo por regra e `groups` mostra os gastos com o rótulo de cada comerciante. Escreva sempre a mesma grafia (`Combustível`, não `combustivel`/`Gasolina`). Crie rótulo novo só quando nenhum servir, e liste os novos ao dono no resumo.
- **Rótulo diz o quê, não onde nem quem**: `Combustível`, não `Galp`; `Farmácia`, não `Farmácia Central`. O comerciante já está na descrição.
- Vocabulário-base por categoria (estenda quando preciso):
  - Transporte: Combustível, Portagem, Estacionamento, Transporte público, Táxi/Uber, Oficina, Lavagem
  - Mercado: Supermercado, Loja de conveniência, Talho/Peixaria, Padaria, Frutaria, Loja de conveniência
  - Saúde: Farmácia, Consulta, Plano de saúde, Dentista, Exames, Ótica, Veterinário
  - Contas: Eletricidade, Água, Gás, Internet, Telemóvel, TV
  - Moradia: Aluguel, Condomínio, Manutenção, Mobília
  - Seguros: Automóvel, Saúde, Casa, Vida
  - Impostos: IMI, IUC, IRS, Segurança Social, Taxas (selo, municipais)
  - Assinaturas: Streaming, Música, Software, Jogos, Nuvem
  - Restaurantes: Restaurante, Café, Fast food, Delivery
  - Lazer: Cinema/Espetáculo, Viagem, Desporto, Jogos, Bar/Noite
  - Compras: Eletrónicos, Casa, Papelaria, Livros, Desporto, Acessórios, Presentes, Online, Hobby, Drogaria
  - Educação: Mensalidade, Material, Cursos
  - Outros: Levantamento, Comissões, Doações, Transferência
  - Empréstimo: Prestação, Comissões
  - Viagens: Voo, Hospedagem, Transporte local, Aeroporto, Outros
  - Cuidados pessoais: Beleza
  - Roupas: sem rótulo (já é específica)
- Transferências para pessoas (chave genérica `trf`): rótulo por lançamento (`id`), só se o dono disse o que foi; senão `Transferência`.
- O rótulo é por comerciante (`key`). Se o mesmo comerciante vende coisas muito diferentes (ex.: hipermercado com farmácia), rotule pelo uso mais comum e deixe o dono corrigir os destoantes na tela.
- Tela: o formulário de edição tem o campo Rótulo (com sugestões dos já usados) e a página mostra "Detalhe por rótulo no mês". Ao confirmar/editar um gasto na tela com rótulo, vira `tag` da regra.

### Rotular gastos já gravados (retroativo)

Para um gasto que já está no cofre (confirmado ou não), sem passar pelo `push`:
1. `node tools/expenses.mjs groups` lista todos os comerciantes (chave | qtd | total | categoria | tipo | rótulo | exemplo). Atenção: o sinal `-` na coluna do rótulo = sem rótulo.
2. Decida o rótulo de cada comerciante sem rótulo, pelas mesmas regras da fase de revisão (conhecimento próprio; `WebSearch` só com o nome do estabelecimento; nunca valores, datas ou nomes de pessoas). Dúvida real: deixe sem rótulo e pergunte ao dono no fim.
3. Monte `rotulos.json` (fora do git): `[{"key":"chave","label":"Combustível"}]`; para um lançamento só, `[{"id":"...","label":"..."}]`. `label: ""` remove.
4. `node tools/expenses.mjs label rotulos.json` simula (contagem por categoria > rótulo); com `--apply` grava. Não muda categoria, tipo nem `auto`; atualiza a `tag` da regra existente e só cria regra nova para gasto já confirmado pelo dono (palpite não vira regra por aqui).
5. Apague `rotulos.json` ao terminar.

## Cuidados

- Valores em euro, ponto decimal no JSON. Espaço como separador de milhar (`1 505.68`) é do banco, não do JSON.
- Mesmo comerciante, mesmo dia, mesmo valor: são lançamentos distintos (o script numera). Não deduplique você.
- Ao final, informe quantos lançamentos o extrato tinha, quantos viraram gasto e a soma por mês, para o dono conferir com o banco.
- Dados do carro não entram em Gastos (o banco já paga o combustível).

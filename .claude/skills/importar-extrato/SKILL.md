---
name: importar-extrato
description: Lê extratos bancários (PDF, CSV ou texto; um mês ou vários meses num arquivo) e grava os gastos no cofre do Argos (coleção `expenses`), com categoria e tipo. Use quando o dono pedir para importar, ler, atualizar ou lançar extrato(s) do banco na aba Gastos.
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
   Estorno/reembolso de uma compra: abata do gasto original quando for claro; senão ignore e avise. Transferência para pessoa (MB Way, TRF P/) é gasto, mas se o destino for ambíguo (própria conta? pagamento de terceiros?), **pergunte ao dono** em vez de adivinhar. Junte as dúvidas numa pergunta só.
6. **Categoria e tipo** (palpites; ficam marcados "revisar" na tela até o dono confirmar):
   - Rode `node tools/expenses.mjs rules` para ver as regras já aprendidas e as categorias em uso; **reuse as categorias existentes** e respeite as regras aprendidas (o script também as aplica por cima do seu palpite).
   - Categorias usuais: Moradia, Contas (luz, água, gás, internet, telemóvel), Mercado, Saúde, Transporte (combustível, portagens, estacionamento, transporte público), Seguros, Impostos, Educação, Assinaturas, Restaurantes, Lazer, Compras, Outros.
   - Tipo: `essential` (moradia, contas, mercado, saúde, transporte do dia a dia, seguros, impostos, educação) ou `flexible` (lazer, restaurantes, assinaturas, compras). Em dúvida, deixe `need` vazio e a categoria `Sem categoria`.
   - Levantamento em caixa (ATM): `Outros`, `flexible`.
7. **Montar o JSON** em arquivo temporário (fora do git): `[{"date":"AAAA-MM-DD","amount":12.5,"desc":"texto do banco, sem encurtar","category":"Mercado","need":"essential"}]`. `amount` positivo. Mantenha `desc` fiel ao texto do banco (o id e a chave do comerciante saem dele; reimportar o mesmo lançamento gera o mesmo id, então não duplica nem sobrescreve edições).
8. **Simular e mostrar ao dono**: `node tools/expenses.mjs push entradas.json` (usa `VAULT_URL`/`VAULT_TOKEN` do ambiente para checar duplicados e regras; sem eles ainda simula). Mostre total por mês, quantos lançamentos entraram e o que foi deixado de fora e por quê (poupança, transferências próprias, dúvidas). Só depois de o dono aprovar:
9. **Gravar**: `node tools/expenses.mjs push entradas.json --apply`. Se faltar `VAULT_URL`/`VAULT_TOKEN`, peça ao dono para rodar o comando com `!` no prompt (ele tem as variáveis). **Nunca peça, escreva nem registre o token.** O Worker precisa estar com `POST /v1/c/:colecao` (`wrangler deploy` em `vault/`).
10. **Apagar** os arquivos temporários com texto do extrato ao terminar.

## Cuidados

- Valores em euro, ponto decimal no JSON. Espaço como separador de milhar (`1 505.68`) é do banco, não do JSON.
- Mesmo comerciante, mesmo dia, mesmo valor: são lançamentos distintos (o script numera). Não deduplique você.
- Ao final, informe quantos lançamentos o extrato tinha, quantos viraram gasto e a soma por mês, para o dono conferir com o banco.
- Dados do carro não entram em Gastos (o banco já paga o combustível).

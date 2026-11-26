# Cofre privado

A página no Cloudflare Pages é pública, então ela **não guarda dados**. Os dados pessoais (carro e o que vier depois) ficam aqui, num Cloudflare Worker com um banco KV, e só são entregues a quem enviar o token secreto.

```
Seu aparelho ──(token)──▶ Worker "vault" ──▶ KV (seus dados)
      ▲
Cloudflare Pages: só código, sem dados
```

## Instalar (uma vez, uns 10 minutos, plano gratuito)

O endereço do app é `https://argos-ejb.pages.dev`. Esse é o valor de `ALLOWED_ORIGIN` (origem = esquema + domínio, sem barra no fim nem caminho).

Escolha **um** caminho: o painel da Cloudflare (funciona no celular, sem terminal) ou a linha de comando.

### A. Pelo painel da Cloudflare (celular)

1. **Gere o token.** Use o gerador de senhas do aparelho (64 caracteres, letras e números) e guarde no gerenciador de senhas. Não cole em chat, issue ou commit.
2. **Crie o banco KV.** dash.cloudflare.com → Storage & Databases → KV → Create. Nome: `VAULT`. Tipo: Standard.
3. **Crie o Worker.** Workers & Pages → Create → Workers → comece pelo modelo **Hello World**. Nome: `vault` → Deploy.
4. **Cole o código.** Abra o Worker → Edit code → apague tudo → cole o conteúdo de `vault/worker.js` → Deploy.
5. **Ligue o banco.** Worker → Settings → Bindings → Add → KV namespace. Variable name: `VAULT` (exatamente assim, maiúsculas). Namespace: o `VAULT` do passo 2. Save.
6. **Origem permitida.** Settings → Variables and Secrets → Add → tipo **Text**. Nome: `ALLOWED_ORIGIN`. Valor: `https://argos-ejb.pages.dev`. Deploy.
7. **Token.** Mesma tela → Add → tipo **Secret**. Nome: `VAULT_TOKEN`. Valor: o token do passo 1. Deploy.
8. **Teste.** Abra `https://vault.SEUNOME.workers.dev/v1/ping` no navegador. Deve responder `{"error":"unauthorized"}`. Isso é o esperado: sem token, não entra.

### B. Pela linha de comando

Pré-requisito: Node instalado.

```bash
cd vault
npx wrangler login

# 1. cria o banco e imprime um id
npx wrangler kv namespace create VAULT
#    copie o id para wrangler.toml, no lugar de REPLACE_WITH_NAMESPACE_ID

# 2. gera um token longo e aleatório. Guarde no gerenciador de senhas.
openssl rand -hex 32
npx wrangler secret put VAULT_TOKEN      # cole o token quando pedir

# 3. confira ALLOWED_ORIGIN em wrangler.toml e publique
npx wrangler deploy
```

### Conectar o app

Abra `https://argos-ejb.pages.dev/carro.html`, toque em **Cofre**, cole o endereço do Worker (`https://vault.SEUNOME.workers.dev`) e o token. Repita em cada aparelho. Se aparecer "Cannot reach the vault", confira o `ALLOWED_ORIGIN` (deve ser idêntico à origem do app).

Depois, no app de ônibus (`transporte.html`): **Settings → Save setup to vault**, para os trajetos ficarem no cofre.

## O que protege o quê

| Risco | Proteção |
|---|---|
| Alguém abre o repositório ou a página | Não há dados lá. O token nunca é commitado (`wrangler secret`, fora do git). |
| Alguém descobre o endereço do Worker | Sem o token responde 401. Após 8 erros seguidos, o IP fica bloqueado 15 minutos. O token tem 256 bits, impossível de adivinhar. |
| Outro site tenta chamar o cofre pelo navegador | CORS só aceita a origem de `ALLOWED_ORIGIN`. Sem ela configurada, recusa tudo. |
| Token comparado de forma vulnerável | Comparação por hash, em tempo constante. |
| Celular perdido | O token e uma cópia dos dados ficam no aparelho. Use bloqueio de tela. Troque o token (abaixo) e o aparelho perdido perde o acesso. |

## Limites que você deve saber

- A Cloudflare hospeda os dados e, tecnicamente, pode acessá-los. Para quilometragem e abastecimento isso é um risco aceitável. Para dados mais sensíveis (saúde, documentos), criptografe no navegador antes de enviar.
- Quem pegar o aparelho **desbloqueado** vê os dados. Para remover o acesso de um aparelho, troque o token (abaixo).
- O token não vai em URL nem em log. Nunca o cole em issue, commit ou conversa.

## Manutenção

- **Trocar o token** (suspeita de vazamento ou aparelho perdido): gere outro, `npx wrangler secret put VAULT_TOKEN` (ou, no painel, edite o secret `VAULT_TOKEN` do Worker), e entre de novo nos aparelhos que você quer manter.
- **Backup:** botão **Baixar backup (JSON)** na tela do carro. Guarde o arquivo fora do repositório (`backup-*.json` já está no `.gitignore`).
- **Testes:** `node test/vault.test.mjs` verifica autenticação, CORS, limites e o funcionamento offline.

## Para um novo módulo de dados

Cada módulo usa uma *collection* com nome próprio (`car-fuel`, `car-service`, `expenses`, `bus-setup`, …). No cliente: `vault.list('nome')`, `vault.put('nome', registro)`, `vault.del('nome', id)`. Nada muda no Worker.

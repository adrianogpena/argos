# Cofre privado

A página no GitHub Pages é pública, então ela **não guarda dados**. Os dados pessoais (carro e o que vier depois) ficam aqui, num Cloudflare Worker com um banco KV, e só são entregues a quem enviar o token secreto.

```
Seu aparelho ──(token)──▶ Worker "vault" ──▶ KV (seus dados)
      ▲
GitHub Pages: só código, sem dados
```

## Instalar (uma vez, uns 10 minutos, plano gratuito)

Pré-requisito: conta em dash.cloudflare.com e Node instalado.

```bash
cd vault
npx wrangler login

# 1. cria o banco e imprime um id
npx wrangler kv namespace create VAULT
#    copie o id para wrangler.toml, no lugar de REPLACE_WITH_NAMESPACE_ID

# 2. gera um token longo e aleatório. Guarde no gerenciador de senhas.
openssl rand -hex 32
npx wrangler secret put VAULT_TOKEN      # cole o token quando pedir

# 3. confira ALLOWED_ORIGIN em wrangler.toml (a origem do seu GitHub Pages) e publique
npx wrangler deploy
```

O deploy imprime o endereço (`https://vault.SEUNOME.workers.dev`). Abra `carro.html` no app, toque em **Cofre**, cole o endereço e o token. Repita em cada aparelho.

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

- **Trocar o token** (suspeita de vazamento ou aparelho perdido): gere outro, `npx wrangler secret put VAULT_TOKEN`, e entre de novo nos aparelhos que você quer manter.
- **Backup:** botão **Baixar backup (JSON)** na tela do carro. Guarde o arquivo fora do repositório (`backup-*.json` já está no `.gitignore`).
- **Testes:** `node test/vault.test.mjs` verifica autenticação, CORS, limites e o funcionamento offline.

## Para um novo módulo de dados

Cada módulo usa uma *collection* com nome próprio (`car-fuel`, `car-service`, `expenses`, `bus-setup`, …). No cliente: `vault.list('nome')`, `vault.put('nome', registro)`, `vault.del('nome', id)`. Nada muda no Worker.

# PLAN — Review da aba Usuários (admin)

> Status: **fases 1–4 implementadas em 2026-08-11, aguardando validação do Caio**
> Branch: `claude/aba-users-interface-review-e4ac96` (1 commit por fase)
> Fase 5 (higiene) parcialmente feita de carona: user-meta.ts + filter-users.ts
> extraídos com teste; extração de merge/duplicates-panel fica para depois.
> Disparador: aba péssima no celular e ruim no desktop — sem filtros, edição joga
> o usuário para o topo da página, fotos invisíveis na lista.

## Contexto

Fluxo real do Caio: procurar um aluno pelo nome, olhar cadastro e **foto**, muitas
vezes **em lote** ("reconhecer quem é quem"). Hoje isso exige: buscar → achar a
linha → clicar "Editar" (link pequeno na última coluna, fora da tela no mobile) →
o form abre **no topo da página** → rolar até lá em cima → fechar → rolar de volta
procurando onde estava. Sem filtro por status/faculdade/turma/data. Avatar da
lista é só a inicial do nome.

## Auditoria (código, `src/app/admin/usuarios/page.tsx` — 1174 linhas)

| Problema | Evidência |
|---|---|
| Tabela de 8 colunas sem versão mobile; ações são links de texto na última coluna | `page.tsx:979-1151` — só `overflow-x-auto`, sem cards `<md` |
| Editar abre card inline **acima** da tabela → perde posição de scroll | `page.tsx:763` — bloco `{editing && ...}` renderiza antes da tabela |
| Único filtro: busca textual + toggle "Pendentes" | `page.tsx:506-525` |
| Filtro não persiste (estado local, some em navegação/refresh) | `useState` puro, sem URL |
| Foto: lista mostra `name.charAt(0)`; selfie só chega via `?id=X&includeSelfie=1` (base64 no campo `users.selfie`) | `page.tsx:998`, `route.ts:397,410` |
| Histórico do interno também renderiza acima da tabela | `page.tsx:863` |
| Payload da lista **já tem** tudo para filtrar client-side: `isActive`, `isArchived`, `facultyAbbr`, `allRoles[].cohortName`, `createdAt` | `route.ts:410-421` |

Volumetria: seed-dev ~50 usuários; produção na casa das centenas. **Client-side
filtering basta; sem paginação/virtualização** (YAGNI — revisitar se passar de ~2k).

## Decisão de bibliotecas

Avaliado: TanStack Query, TanStack Table, Radix Dialog, vaul, nuqs.
**Nenhuma dependência nova.** Motivo: dataset pequeno já carregado inteiro
(`load()` único), o repo já tem os padrões de UI necessários (`PhotoLightbox`,
bottom-sheet do `intern-day-sheet`, `ui/*`), e filtro em URL sai com
`useSearchParams` + `router.replace` nativos do Next. "Frontend dinâmico" aqui é
arquitetura (drawer + estado em URL + fetch sob demanda), não pacote.
Se um dia a lista crescer muito: TanStack Table + virtualização é o upgrade path.

## Princípios

1. **Nada recarrega a página.** Filtro, drawer, foto: tudo estado client + URL
   (`router.replace` com `scroll: false`).
2. **A lista nunca sai do lugar.** Detalhe abre *por cima* (drawer/sheet), scroll
   e filtros intactos ao fechar.
3. **Linha inteira é clicável** (touch target grande), não um link de 6px na
   coluna 8.
4. **Foto é conteúdo de primeira classe**, não easter egg do modo edição.
5. Mobile-first: princípios do PLAN-mobile-usability valem aqui (touch ≥44px,
   nenhuma tabela cortada silenciosamente).

## Fases

### Fase 1 — Filtros persistentes (menor esforço, maior ganho imediato)

Barra de filtros acima da lista:
- **Status**: Todos / Ativos / Pendentes / Arquivados (substitui o toggle "Pendentes").
- **Faculdade**: select com as abreviações (dados já em `faculties`).
- **Turma**: select dependente da faculdade (dados já em `allCohorts`).
- **Papel**: Coordenador / Líder / Preceptor / Interno.
- **Ordenação**: Nome A-Z (padrão) / Cadastro mais recente / mais antigo (`createdAt` já vem).
- Contador "N de M usuários" + botão "limpar filtros".
- Estado espelhado na URL (`?status=&fac=&turma=&papel=&q=`): sobrevive a
  refresh/voltar, sem reload (`router.replace`, `scroll: false`).
- Mobile: filtros colapsáveis "Filtros (2)" fechados por padrão (mesmo padrão da
  escala do leader).

Tudo client-side sobre o array `users` já carregado. Zero mudança de API.

### Fase 2 — Drawer de detalhe (mata o vai-e-volta de scroll)

- Clique em **qualquer lugar da linha** abre drawer: desktop = painel lateral
  direito (~420px, overlay); mobile = bottom sheet full-height (padrão
  `intern-day-sheet`). Esc/backdrop fecha. `?u=<id>` na URL (deep-link, voltar fecha).
- Conteúdo: **foto grande no topo** (clique → `PhotoLightbox` existente), nome,
  papéis, faculdade/turma, CPF, email, telefone, cód. cadastro, data de cadastro,
  status — modo leitura primeiro; botão "Editar" troca para o form atual
  (movido para dentro do drawer).
- Ações no rodapé do drawer: Aprovar / Acesso rápido / Arquivar / Desativar
  (migradas da coluna "Ações", que encolhe para um chevron).
- **Navegação ‹ › no drawer**: anterior/próximo dentro da *lista filtrada* — é o
  fluxo "reconhecer em lote" sem nunca voltar para a lista. Setas do teclado no
  desktop.
- Selfie: fetch sob demanda ao abrir (rota da Fase 3; até lá, o endpoint
  `?id=X&includeSelfie=1` que já existe).
- Histórico do interno renderiza dentro do drawer (seção colapsável), não mais
  acima da tabela.

Esqueleto do componente (contrato, não implementação):

```tsx
// src/components/admin/user-drawer.tsx
type UserDrawerProps = {
  user: User;                       // linha já carregada (dados leves)
  onClose: () => void;
  onPrev?: () => void;              // navegação dentro da lista filtrada
  onNext?: () => void;
  onChanged: () => void;            // pós-save/arquivar/etc → recarrega lista
};
// Internamente: fetch selfie+detalhe on-open; modo "view" | "edit";
// desktop: aside fixed right; mobile: bottom sheet (reuso intern-day-sheet).
```

### Fase 3 — Fotos na lista + rota de imagem

- Nova rota `GET /api/admin/users/[id]/selfie`: decodifica o data-URL do campo
  `users.selfie` e responde imagem binária com `Cache-Control: private, max-age=3600`
  (auth igual às demais rotas admin). Lista e drawer passam a usar
  `<img src=".../selfie" loading="lazy">` — o browser resolve lazy-load e cache,
  sem base64 gigante no JSON da lista.
- Avatar real (32px) em cada linha/card no lugar da inicial; clique no avatar →
  lightbox direto, sem abrir o drawer.
- **Modo galeria**: toggle lista/grade. Grade de cards com foto grande (~160px) +
  nome + faculdade/turma, respeitando os mesmos filtros — reconhecimento em lote
  de verdade. Clique no card → mesmo drawer da Fase 2.

### Fase 4 — Mobile: cards no lugar da tabela

- `<md`: tabela vira lista de cards — avatar + nome + badges de papel/faculdade +
  status. Toque → drawer. Coluna "Ações" deixa de existir no mobile (tudo no
  drawer).
- `≥md`: tabela continua, enxuta (Turma via select permanece; Ações vira menu ⋯
  ou some, já que o drawer cobre).

### Fase 5 (opcional) — Higiene

- Extrair de `page.tsx`: `merge-panel.tsx`, `duplicates-panel.tsx`,
  `user-form.tsx`, `user-history.tsx` → página cai para ~300 linhas.
- Smoke test dos filtros (função pura `filterUsers(users, params)` + teste
  node:test).

## Ordem e entrega

Cada fase = 1 PR pequeno e reversível, nessa ordem (1 → 2 → 3 → 4; 5 quando
conveniente). Fase 1 e 2 resolvem 80% da dor relatada.

## O que fica de fora (decidido, não esquecido)

- Paginação/virtualização — dataset pequeno.
- Filtro por intervalo de datas de cadastro — ordenação por `createdAt` cobre o
  caso de uso ("quem entrou por último"); range picker só se o Caio pedir.
- Edição inline na tabela — o drawer é o lugar de editar.
- Dependências novas — ver "Decisão de bibliotecas".

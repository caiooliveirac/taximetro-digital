# PLAN — Drawer universal do interno

> Status: **em implementação 2026-08-11** · Branch: `claude/aba-users-interface-review-e4ac96`
> Continuação do PLAN-usuarios-review: o padrão de drawer aprovado vira o jeito
> único de "ver um interno" em toda a aplicação.

## Pedido

Onde quer que se clique num interno — Escala USA, Montar Escala, Escala CRU,
CRL, Faltas, Presenças — abrir a mesma janela com tudo dele: histórico,
acompanhamento de faltas, se a escala está completa. Importar do "Ver Interno"
as funcionalidades de acompanhamento (que pode ficar obsoleto como tela de
consulta). Adotar o filtro de faculdade por chips clicáveis (padrão ver-interno)
no lugar de dropdown.

## O que já existe (auditoria)

| Peça | Onde | Reuso |
|---|---|---|
| `InternHistorySection` + `useInternHistory` | `src/components/admin/intern-history-section.tsx` | **é o miolo pronto**: velocímetro (escala completa), KPIs com Faltas, quebra semanal por tipo, próximos/últimos plantões com expand, ocorrências. Busca `/api/compliance`, `/api/assignments`, `/api/case-records` por `internId` |
| `InternQuickModal` | usado em admin-dashboard e cockpit-alarms | modal central com o mesmo miolo — será substituído pelo drawer |
| Modal raso de interno | `scheduling/montar-escala.tsx:1970` | só conta plantões da semana; substituir |
| Modal de assignment | `admin-filled-schedule.tsx:2129` (USA/CRU/CRL) | é do *plantão* (ações) — permanece; nome do interno passa a abrir o drawer |
| Faltas/Presenças | `absences-view.tsx:326`, `presencas/page.tsx:177` | nome é texto morto; vira clicável (`internId` já vem da API) |
| Chips de faculdade | `ver-interno/page.tsx:351-377` | padrão a replicar na aba usuários |

Nenhum endpoint novo. Faltas = `totalAbsent` do compliance + status ABSENT nos
plantões (mesma derivação do ver-interno).

## Fases

### A — Componente `InternDrawer`
`src/components/admin/intern-drawer.tsx`: shell de drawer lateral (mesmo padrão
visual do UserDrawer: backdrop + aside direito, Esc fecha, scroll lock) com
foto (rota `/users/[id]/selfie`, fallback inicial, clique → lightbox), header
(nome + pill de faculdade + badge de compliance) e `InternHistorySection`
dentro. Rodapé: "Abrir no Ver Interno →" (`/admin/ver-interno?internId=`) para
as ações que ficam lá (criar extra, trocar turma).

### B — Acoplar nas telas
- `montar-escala.tsx`: `setInternDetail` passa a abrir o InternDrawer; modal
  raso das linhas 1970-2010 morre.
- `admin-filled-schedule.tsx` (USA/CRU/CRL): nome do interno no card do plantão
  vira clicável (stopPropagation — clique no resto do card segue abrindo o
  modal do plantão).
- `absences-view.tsx` e `presencas/page.tsx`: nome clicável na linha.

### C — Unificação
- `InternQuickModal` substituído pelo InternDrawer nos 2 usos
  (admin-dashboard, cockpit-alarms); arquivo removido.
- `UserDrawer` (aba usuários): seção de histórico custom substituída por
  `InternHistorySection` quando o usuário é interno — mesma visão em tudo.
- Filtro Faculdade da aba usuários: dropdown → chips clicáveis (padrão
  ver-interno), mantendo estado na URL.

## Fora de escopo (decidido)
- Apagar a tela ver-interno: fica como casa das *ações* (extra, turma) e do
  picker com compliance em lote; o drawer aponta para ela. Aposentar é decisão
  futura do Caio.
- AbsenceQuickModal: tem fluxo próprio de justificativa; não mexer agora.
- Endpoint dedicado de faltas/presenças por interno: derivação client-side já
  atende.

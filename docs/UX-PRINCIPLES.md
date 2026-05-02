# UX Principles — Taxímetro Digital

Diretriz transversal. Cada branch `feat/ux-*` referencia este doc.
Quando algo neste arquivo evoluir, a evolução vira commit numa branch
`feat/ux-*` que precisar dela — não em commit solto na master.

---

## Premissa

Estética ≠ design system. Os componentes são os mesmos (button, card,
badge, input). O que muda **por papel** é densidade, contraste,
hierarquia visual e quantas ações primárias podem coexistir numa tela.

Quem decide qual estética: **o usuário daquele papel**, não a marca.

---

## Por papel

### INTERN — gen Z, iPhone, mobile-first
- **Estética**: moderna, Linear/Vercel-ish. Whitespace generoso ok.
  Animações sutis (fade/scale 150-200ms) ok.
- **Densidade**: baixa-média. Uma ação primária visível por scroll.
- **Tipografia**: hierarquia clara, peso 600+ para títulos, 400 corpo.
- **Mobile**: ≤3 toques pra check-in, ≤2 toques pra ver próximo plantão.
- **Não**: gradientes pesados, cards com 6 metadados disputando atenção.

### LEADER — aluno-ajudante, desktop pra montar + mobile pra gerir
- **Desktop (montagem de escala)**: alta densidade, grid sem floreio.
  A tela atual `leader/escala/page.tsx` está no caminho certo —
  preserva.
- **Mobile (gestão)**: cockpit, não grid. Vê hoje/semana, age rápido
  (alocar reposição, swap, sortear) com 2-3 toques.
- **Não**: tentar replicar grid desktop no mobile. É outra mental model.

### PRECEPTOR — médico mais velho, iPhone, hunting é a fricção principal
- **Referências mentais**: Toast POS, Epic Haiku, app de motorista.
  **NÃO** Linear/Notion.
- **Estética**: alto contraste, zonas de toque ≥48px, uma ação primária
  por tela visível sem scroll.
- **Hierarquia brutal**: o que ele PRECISA fazer agora ocupa 60%+ da
  tela. Tudo mais é secundário ou fica fora do viewport inicial.
- **Histórico de avaliações**: visível e navegável. Admin precisa
  conseguir ler tendência (não só último valor).
- **Não**: cards bonitinhos com 6 metadados. Whitespace generoso. Ícones
  ambíguos sem label.

### COORDINATOR — desktop primário, modo monitoramento real-time
- **Referências mentais**: cockpit de ops, dispatch de logística.
  Density without clutter.
- **Hierarquia**: alarmes ativos no topo. Tudo mais é segunda camada.
- **Pergunta que a tela responde em ≤3s**: "preciso intervir em alguém
  HOJE?"
- **Não**: dashboard de auditoria com KPIs decorativos. Métricas que
  não levam a ação saem.

---

## Regras transversais

### Cores de status (4 estados, consistentes em todas as telas)
- **OK / cumprido**: emerald-500/600
- **Atenção / parcial / agendado-mas-não-cumprido-ainda**: amber-500/600
- **Crítico / falta sem reposição / abaixo-do-ritmo**: red-500/600
- **Inativo / arquivado / sem dado**: zinc-400

Reservar **azul** pra ações (botões primários, links). Não usar como status — confunde com OK e com crítico em telas de coordenador estressado.

### Densidade
- INTERN/PRECEPTOR mobile: **1 ação primária visível** sem scroll.
- LEADER desktop / COORDINATOR desktop: **densidade alta**, mas todo
  bloco visível responde a uma pergunta operacional. Bloco que não
  responde pergunta sai.

### Toque (mobile)
- Alvos mínimos 44px (Apple HIG); preferir 48px.
- Ações destrutivas/críticas requerem confirmação curta — não modal
  pesado. Padrão "long-press" é *não* uma boa ideia (preceptor
  não conhece).

### Empty states
- Diga **o que fazer**, não "nada aqui". Ex: ✅ "Sem alarmes ativos —
  todos os internos estão no ritmo." ❌ "Sem dados".

### Loading
- Esqueleto, não spinner em tela cheia. Time budget: 200ms antes de
  mostrar esqueleto (evita piscar).

### Tipografia funcional
- Sistema (San Francisco no iOS, segoe/system-ui em desktop). Não
  importar fonte custom — pesa no mobile com 4G ruim.
- Tamanhos mobile: 14 corpo / 16 input / 18-20 título / 24+ destaque.
- Tabular numbers (`font-variant-numeric: tabular-nums`) em qualquer
  coluna numérica (contagem, hora, percentual).

### Acessibilidade
- Contraste mínimo WCAG AA (4.5:1 texto). Em paleta zinc, evitar
  zinc-400 sobre zinc-100.
- `aria-label` em botões com só ícone.
- Foco visível (não remover outline; pode estilizar).

---

## Anti-padrões a evitar (vi em produtos similares morrerem)

1. **Dashboard com 8+ KPIs em cards iguais.** Hierarquia plana =
   coordenador desiste e abre planilha.
2. **Mobile com scroll horizontal pra ver coluna importante.** Se
   precisa ser visto, prioriza no viewport.
3. **Cor como única dimensão de status.** Combinar com ícone/texto
   (acessibilidade + impressão B&W).
4. **Toast/snackbar como confirmação de ação crítica.** Some rápido,
   usuário cansado perde. Confirmação inline é melhor.
5. **Modal aninhado.** Se uma ação dentro do modal abre outro modal,
   o fluxo está errado.

/**
 * Script de teste: Rotação com datas de transição explícitas por faculty
 * Problema: A função `buildRotationCohort` usa janela fixa de 49 dias
 * mas na UNIFACS a rotação é 22/mar → 26/abr (36 dias)
 * 
 * Solução: Usar mapa de transições explícitas por faculty
 */

const ROTATION_TRANSITIONS = {
  // UNIFACS: turmas explícitas com datas reais de início/fim
  unifacs: [
    { turma: 0, startDate: "2026-01-01", endDate: "2026-03-21" }, // turma anterior (exemplo)
    { turma: 1, startDate: "2026-03-22", endDate: "2026-04-26" }, // atual (36 dias)
    { turma: 2, startDate: "2026-04-27", endDate: "2026-06-14" }, // próxima (49 dias)
    { turma: 3, startDate: "2026-06-15", endDate: "2026-08-02" },
  ],
  // Outros centros podem ter outras transições
};

/**
 * Encontra a turma de rotação para um plantão em uma data específica
 * @param {string} executionDate - Data do plantão (YYYY-MM-DD)
 * @param {string} facultyCode - Código da faculdade (ex: "unifacs")
 * @returns {{ turma: number, startDate: string, endDate: string, label: string }}
 */
function findRotationByDate(executionDate, facultyCode = "unifacs") {
  const transitions = ROTATION_TRANSITIONS[facultyCode?.toLowerCase()] || 
                     ROTATION_TRANSITIONS.unifacs;
  
  const rotation = transitions.find(
    r => r.startDate <= executionDate && executionDate <= r.endDate
  );
  
  if (!rotation) {
    return {
      turma: null,
      startDate: null,
      endDate: null,
      label: "Fora de escala",
    };
  }
  
  return {
    turma: rotation.turma,
    startDate: rotation.startDate,
    endDate: rotation.endDate,
    label: `Turma ${rotation.turma + 1} (${rotation.startDate} até ${rotation.endDate})`,
  };
}

/**
 * Valida que não há sobreposições e que datas estão ordenadas
 */
function validateTransitions(facultyCode = "unifacs") {
  const transitions = ROTATION_TRANSITIONS[facultyCode?.toLowerCase()];
  
  for (let i = 0; i < transitions.length - 1; i++) {
    const current = transitions[i];
    const next = transitions[i + 1];
    
    if (current.endDate >= next.startDate) {
      console.error(
        `❌ ERRO: Sobreposição entre Turma ${current.turma} (fim: ${current.endDate}) ` +
        `e Turma ${next.turma} (início: ${next.startDate})`
      );
      return false;
    }
  }
  
  console.log(`✅ Transições validadas para ${facultyCode}`);
  return true;
}

// ============================================================================
// TESTES
// ============================================================================

console.log("=== TESTE DE ROTAÇÃO COM DATAS EXPLÍCITAS ===\n");

validateTransitions("unifacs");

const testCases = [
  { date: "2026-03-22", faculty: "unifacs", expected: 1 },
  { date: "2026-04-10", faculty: "unifacs", expected: 1 },
  { date: "2026-04-26", faculty: "unifacs", expected: 1 }, // último dia turma 1
  { date: "2026-04-27", faculty: "unifacs", expected: 2 }, // primeiro dia turma 2 ✅
  { date: "2026-05-10", faculty: "unifacs", expected: 2 },
  { date: "2026-06-14", faculty: "unifacs", expected: 2 }, // último dia turma 2
  { date: "2026-06-15", faculty: "unifacs", expected: 3 }, // primeiro dia turma 3 ✅
];

console.log("Testando classificação por data:");
testCases.forEach(tc => {
  const result = findRotationByDate(tc.date, tc.faculty);
  const status = result.turma === tc.expected ? "✅" : "❌";
  console.log(
    `${status} ${tc.date}: Turma ${result.turma} (esperado ${tc.expected}) - ${result.label}`
  );
});

console.log("\n=== COMPARAÇÃO ===");
console.log("Método ANTIGO (49 dias fixos):");
console.log("  27/abr → Turma 1 ❌ (cortado da turma atual)");
console.log("  10/mai → Turma 1 ❌ (cortado da turma atual)");

console.log("\nMétodo NOVO (datas explícitas):");
console.log("  27/abr → Turma 2 ✅");
console.log("  10/mai → Turma 2 ✅");
console.log("  (Bruna Bastos agora vê os 5 CRUs corretos)");

// ============================================================================
// SUGESTÃO DE SCHEMA PARA ARMAZENAR NO DB
// ============================================================================

console.log("\n=== SUGESTÃO DE IMPLEMENTAÇÃO NO DB ===");
console.log(`
CREATE TABLE rotation_transitions (
  id SERIAL PRIMARY KEY,
  faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  rotation_number INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE (faculty_id, rotation_number),
  CHECK (start_date <= end_date)
);

-- Inserir dados da UNIFACS
INSERT INTO rotation_transitions 
  (faculty_id, rotation_number, start_date, end_date, label)
VALUES
  ('unifacs-id', 1, '2026-03-22', '2026-04-26', 'Turma 1 - UNIFACS'),
  ('unifacs-id', 2, '2026-04-27', '2026-06-14', 'Turma 2 - UNIFACS'),
  ('unifacs-id', 3, '2026-06-15', '2026-08-02', 'Turma 3 - UNIFACS');
`);

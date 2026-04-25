import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Simula dados de uma faculdade para demonstração
  const demoData = {
    success: true,
    data: [
      {
        facultyId: "demo-faculty-1",
        facultyAbbr: "EBMSP",
        generatedAt: new Date().toISOString(),
        interns: [
          {
            internId: "intern-1",
            internName: "João Silva",
            isArchived: false,
            assignments: [
              {
                assignmentId: "assign-1",
                date: "2026-04-24",
                period: "DAY",
                baseCode: "SM01",
                baseName: "SAMU Central",
                baseType: "USA",
                status: "CHECKED_OUT",
                shift: null,
                checkinAt: "2026-04-24T08:15:00Z",
                checkoutAt: "2026-04-24T17:45:00Z",
                isJustified: false,
                absenceJustification: null,
              },
              {
                assignmentId: "assign-2",
                date: "2026-04-23",
                period: "NIGHT",
                baseCode: "CB02",
                baseName: "Ambulância 02",
                baseType: "USA",
                status: "ABSENT",
                shift: null,
                checkinAt: null,
                checkoutAt: null,
                isJustified: true,
                absenceJustification: "Consulta médica agendada",
              },
            ],
            stats: {
              totalUSAs: 2,
              totalCheckedIn: 1,
              totalCheckedOut: 1,
              totalAbsent: 1,
              totalAbsentJustified: 1,
              totalAbsentNotJustified: 0,
              totalScheduled: 0,
            },
          },
          {
            internId: "intern-2",
            internName: "Maria Santos",
            isArchived: false,
            assignments: [
              {
                assignmentId: "assign-3",
                date: "2026-04-22",
                period: "DAY",
                baseCode: "SM01",
                baseName: "SAMU Central",
                baseType: "USA",
                status: "CHECKED_OUT",
                shift: null,
                checkinAt: "2026-04-22T08:30:00Z",
                checkoutAt: "2026-04-22T17:30:00Z",
                isJustified: false,
                absenceJustification: null,
              },
              {
                assignmentId: "assign-4",
                date: "2026-04-21",
                period: "SCHEDULED",
                baseCode: "PR03",
                baseName: "Regulação",
                baseType: "CENTRAL",
                status: "SCHEDULED",
                shift: null,
                checkinAt: null,
                checkoutAt: null,
                isJustified: false,
                absenceJustification: null,
              },
            ],
            stats: {
              totalUSAs: 1,
              totalCheckedIn: 1,
              totalCheckedOut: 1,
              totalAbsent: 0,
              totalAbsentJustified: 0,
              totalAbsentNotJustified: 0,
              totalScheduled: 1,
            },
          },
        ],
      },
      {
        facultyId: "demo-faculty-2",
        facultyAbbr: "UFBA",
        generatedAt: new Date().toISOString(),
        interns: [
          {
            internId: "intern-3",
            internName: "Carlos Oliveira",
            isArchived: false,
            assignments: [
              {
                assignmentId: "assign-5",
                date: "2026-04-24",
                period: "DAY",
                baseCode: "SM01",
                baseName: "SAMU Central",
                baseType: "USA",
                status: "CHECKED_IN",
                shift: null,
                checkinAt: "2026-04-24T08:20:00Z",
                checkoutAt: null,
                isJustified: false,
                absenceJustification: null,
              },
            ],
            stats: {
              totalUSAs: 1,
              totalCheckedIn: 1,
              totalCheckedOut: 0,
              totalAbsent: 0,
              totalAbsentJustified: 0,
              totalAbsentNotJustified: 0,
              totalScheduled: 0,
            },
          },
        ],
      },
    ],
  };

  return NextResponse.json(demoData);
}

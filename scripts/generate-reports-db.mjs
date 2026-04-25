/**
 * Direct database query for attendance reports
 * Este módulo consulta o banco PostgreSQL diretamente
 * sem depender de endpoints HTTP autenticados
 */

import pkg from 'pg';
const { Client } = pkg;

export async function queryAttendanceByFaculty(databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    
    try {
        await client.connect();
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
        
        const query = `
            SELECT
                f.id as faculty_id,
                f.abbr as faculty_abbr,
                f.name as faculty_name,
                u.id as intern_id,
                u.name as intern_name,
                u.is_archived as is_archived,
                a.id as assignment_id,
                a.date as assignment_date,
                a.period as assignment_period,
                a.status as assignment_status,
                a.shift as assignment_shift,
                b.code as base_code,
                b.name as base_name,
                b.type as base_type,
                c.checked_in_at as checkin_at,
                c.checked_out_at as checkout_at,
                a.absence_justification as absence_justification,
                a.absence_justification_actor as absence_justification_actor
            FROM users u
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN roles r ON ur.role_id = r.id
            INNER JOIN faculties f ON u.faculty_id = f.id
            LEFT JOIN assignments a ON u.id = a.intern_id 
                AND a.date >= $1
                AND a.status != 'CANCELLED'
            LEFT JOIN bases b ON a.base_id = b.id
            LEFT JOIN checkins c ON a.id = c.assignment_id
            WHERE r.name = 'INTERN'
                AND u.is_archived = false
            ORDER BY f.abbr ASC, u.name ASC, a.date DESC
        `;
        
        const result = await client.query(query, [thirtyDaysAgoStr]);
        return result.rows;
    } finally {
        await client.end();
    }
}

export function processAttendanceData(rows) {
    const facultyMap = new Map();
    
    for (const row of rows) {
        const facultyKey = row.faculty_abbr;
        
        if (!facultyMap.has(facultyKey)) {
            facultyMap.set(facultyKey, {
                facultyId: row.faculty_id,
                facultyAbbr: row.faculty_abbr,
                facultyName: row.faculty_name,
                generatedAt: new Date().toISOString(),
                interns: new Map(),
            });
        }
        
        const faculty = facultyMap.get(facultyKey);
        const internKey = row.intern_id;
        
        if (!faculty.interns.has(internKey)) {
            faculty.interns.set(internKey, {
                internId: row.intern_id,
                internName: row.intern_name,
                isArchived: row.is_archived,
                assignments: [],
                stats: {
                    totalUSAs: 0,
                    totalCheckedIn: 0,
                    totalCheckedOut: 0,
                    totalAbsent: 0,
                    totalAbsentJustified: 0,
                    totalAbsentNotJustified: 0,
                    totalScheduled: 0,
                },
            });
        }
        
        const intern = faculty.interns.get(internKey);
        
        if (row.assignment_id) {
            const assignment = {
                assignmentId: row.assignment_id,
                date: row.assignment_date,
                period: row.assignment_period,
                baseCode: row.base_code,
                baseName: row.base_name,
                baseType: row.base_type,
                status: row.assignment_status,
                shift: row.assignment_shift,
                checkinAt: row.checkin_at,
                checkoutAt: row.checkout_at,
                absenceJustification: row.absence_justification,
                absenceJustificationActor: row.absence_justification_actor,
            };
            
            // Deduplicate (same assignment_id shouldn't appear twice)
            if (!intern.assignments.find(a => a.assignmentId === assignment.assignmentId)) {
                intern.assignments.push(assignment);
                
                // Update stats
                intern.stats.totalUSAs++;
                if (assignment.checkinAt) intern.stats.totalCheckedIn++;
                if (assignment.checkoutAt) intern.stats.totalCheckedOut++;
                if (assignment.status === 'ABSENT') {
                    intern.stats.totalAbsent++;
                    if (assignment.absenceJustification) {
                        intern.stats.totalAbsentJustified++;
                    } else {
                        intern.stats.totalAbsentNotJustified++;
                    }
                }
                if (assignment.status === 'SCHEDULED') intern.stats.totalScheduled++;
            }
        }
    }
    
    // Convert Map to Array and sort
    const faculties = Array.from(facultyMap.values()).map(faculty => ({
        ...faculty,
        interns: Array.from(faculty.interns.values())
            .filter(i => !i.isArchived)
            .sort((a, b) => a.internName.localeCompare(b.internName)),
    }));
    
    return faculties;
}

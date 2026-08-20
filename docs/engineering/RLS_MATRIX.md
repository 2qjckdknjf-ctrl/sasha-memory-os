# RLS policy matrix (WP-02)

Session context is set by trusted API/MCP via GUCs:

- `app.subject_id`
- `app.workspace_id`

Helper: `app.has_acl(workspace_id, resource_type, action, project_id?, sensitivity?)`.
Deny entries always win. Workspace `owner` membership grants broad access unless denied.

## Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| workspaces | member | service/owner (M1) | owner | deny app roles |
| projects | ACL read | ACL write | ACL write | owner |
| source_events | ACL read | ACL write | **deny** (append-only) | **deny** |
| artifacts | ACL read | ACL write | limited | owner |
| memory_records | ACL read + sensitivity | ACL write | ACL write | soft-delete via status |
| decisions / tasks | via memory ACL | via memory ACL | via memory ACL | cascade |
| project_state_versions | ACL read | ACL write (append version) | deny | deny |
| handoffs | ACL read | ACL write | deny | deny |
| audit_log | member | member/service | **deny** | **deny** |
| access_log | member | service | deny | deny |
| outbox_events / processing_jobs | ACL write/service | same | same | service |

## Seed subjects (synthetic)

| Subject | Key | Expected |
|---|---|---|
| Owner Sasha | `3333…301` | Full workspace access |
| ChatGPT | `3333…302` | AISTROYKA memory/project read+write (≤ internal) |
| Cursor | `3333…303` | AISTROYKA project/state/handoff; personal memory deny |

## Required negative cases

1. Wrong workspace → empty / deny  
2. Cursor reads `sensitivity=personal` memory → deny  
3. Re-insert same `source_events` idempotency key → unique violation (no duplicate)  
4. UPDATE `source_events` / `audit_log` as member → deny  
5. Agent without project ACL → cannot read other project  

SQL fixtures: `tests/security/rls_policy_cases.sql`  
Harness (no live DB yet): `tests/security/rls_matrix.test.ts`

## M14 Slice 03 review reuse

The official defensive review pack for roadmap `20.17` reuses this matrix
alongside API/MCP negative tests to keep the current stack fail-closed:

- unauthenticated MCP HTTP stays rejected when API auth is enforced
- ChatGPT Mode A stays at exactly 7 tools
- write/admin paths require explicit `project_id`
- no owner-token bypass is introduced
- no writes fall back to AISTROYKA
- payload bodies and tokens stay out of logs and review outputs

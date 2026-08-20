import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import { searchMemoriesHybrid } from '@memory-os/retrieval';
import { authorize, resolveLocalSubject, type AuthzContext } from '@memory-os/authz';

type GoldenCase = {
  id: string;
  query: string;
  actor: string;
  must_allow: boolean;
  expect_memory_title_includes?: string;
  expect_content_includes?: string;
  expect_empty_or_no_restricted?: boolean;
  expect_no_sensitivity?: string;
};

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444401';
const owner = '33333333-3333-4333-8333-333333333301';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const cursor = '33333333-3333-4333-8333-333333333303';
const roma = '33333333-3333-4333-8333-333333333304';

function authzFor(actorKey: string): AuthzContext {
  const subject = resolveLocalSubject({ actorKey });
  if (!subject) throw new Error(`unknown actor ${actorKey}`);
  const isOwner = subject.id === owner;
  return {
    subjectId: subject.id,
    workspaceId,
    isOwner,
    entries: [
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'memory',
        projectId,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: cursor,
        effect: 'allow',
        resourceType: 'memory',
        projectId,
        actions: ['read'],
        sensitivityMax: 'internal',
      },
      {
        subjectId: roma,
        effect: 'allow',
        resourceType: 'memory',
        projectId,
        actions: ['read'],
        sensitivityMax: 'internal',
      },
    ],
  };
}

describe('golden retrieval harness', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, 'golden_retrieval.json'), 'utf8'),
  ) as { cases: GoldenCase[] };
  const store = createSeededStore();

  const fixtures: Array<{
    title: string;
    text: string;
    actor: string;
    key: string;
    sensitivity?: 'internal' | 'confidential' | 'restricted';
  }> = [
    {
      title: 'WP-04 capture note',
      text: 'Manual capture path for Memory OS with quarantine hash chunks.',
      actor: chatgpt,
      key: 'eval/wp04',
    },
    {
      title: 'AISTROYKA control note',
      text: 'AISTROYKA project uses Memory OS as shared long-term memory.',
      actor: chatgpt,
      key: 'eval/aistroyka',
    },
    {
      title: 'Connector sync plan',
      text: 'Connector sync stub enqueues GitHub jobs without loading vault tokens.',
      actor: owner,
      key: 'eval/connector-sync',
    },
    {
      title: 'OCR invoice note',
      text: 'OCR scanned invoice total recorded for finance review.',
      actor: chatgpt,
      key: 'eval/ocr-invoice',
    },
    {
      title: 'Memory Core ACL note',
      text: 'Memory Core ACL temporal model and provenance for agents.',
      actor: owner,
      key: 'eval/acl',
    },
    {
      title: 'GitHub connection note',
      text: 'GitHub repos connected via broker; vault refs only.',
      actor: chatgpt,
      key: 'eval/github',
    },
    {
      title: 'Link capture note',
      text: 'Link capture uses SSRF-safe fetch for public URLs.',
      actor: cursor,
      key: 'eval/link',
    },
    {
      title: 'OAuth vault note',
      text: 'OAuth callback stores vault refs only, never raw tokens.',
      actor: owner,
      key: 'eval/vault',
    },
    {
      title: 'Auth bind note',
      text: 'Supabase Auth subject bind maps auth user to workspace subject.',
      actor: owner,
      key: 'eval/auth-bind',
    },
    {
      title: 'Ingest pipeline note',
      text: 'processing job ingest turns quarantine artifacts into candidate memories.',
      actor: owner,
      key: 'eval/ingest',
    },
    {
      title: 'Restricted passport (should not leak)',
      text: 'passport number and salary IBAN must stay restricted.',
      actor: owner,
      key: 'eval/restricted',
      sensitivity: 'restricted',
    },
    {
      title: 'Confidential salary band',
      text: 'salary band confidential compensation data for leadership only.',
      actor: owner,
      key: 'eval/confidential-salary',
      sensitivity: 'confidential',
    },
    {
      title: 'ROMA agent note',
      text: 'ROMA agent shares the same Memory Core with ChatGPT and Cursor.',
      actor: chatgpt,
      key: 'eval/roma',
    },
    {
      title: 'Hybrid retrieval note',
      text: 'Hybrid retrieval combines pgvector and FTS for project context.',
      actor: owner,
      key: 'eval/pgvector',
    },
    {
      title: 'DPIA privacy note',
      text: 'Initial DPIA privacy review covers retention and data classes.',
      actor: owner,
      key: 'eval/dpia',
    },
    {
      title: 'Temporal model note',
      text: 'Temporal memory supersedes older facts without deleting provenance.',
      actor: chatgpt,
      key: 'eval/temporal',
    },
    {
      title: 'Correction UX note',
      text: 'Correction review UX lets owner fix mistaken candidate memories.',
      actor: owner,
      key: 'eval/correction',
    },
    {
      title: 'Embedding baseline note',
      text: 'Baseline embedding adapter is swappable without lock-in.',
      actor: owner,
      key: 'eval/embedding',
    },
    {
      title: 'Consolidation worker note',
      text: 'Consolidation worker merges duplicate candidate memories overnight.',
      actor: chatgpt,
      key: 'eval/consolidation',
    },
    {
      title: 'Apple bridge note',
      text: 'Apple bridge connector will sync Notes and Reminders later.',
      actor: owner,
      key: 'eval/apple',
    },
    {
      title: 'Google Drive health note',
      text: 'Google Drive degraded connection needs reauth before file sync.',
      actor: owner,
      key: 'eval/gdrive',
    },
    {
      title: 'Gmail metadata note',
      text: 'Gmail metadata sync indexes labels without storing full bodies by default.',
      actor: chatgpt,
      key: 'eval/gmail',
    },
    {
      title: 'Calendar event note',
      text: 'Google calendar event sync captures meetings as project events.',
      actor: owner,
      key: 'eval/calendar',
    },
    {
      title: 'Provenance chain note',
      text: 'Every candidate memory keeps a provenance chain to source events.',
      actor: owner,
      key: 'eval/provenance',
    },
    {
      title: 'Hosting region note',
      text: 'Dedicated Supabase project runs in eu-central-1 region.',
      actor: owner,
      key: 'eval/region',
    },
    {
      title: 'Outbox reliability note',
      text: 'Reliable delivery uses outbox events for workers and connectors.',
      actor: chatgpt,
      key: 'eval/outbox',
    },
    {
      title: 'Synthetic GitHub PR note',
      text: 'Synthetic GitHub sync invents Pull request #215 without loading tokens.',
      actor: owner,
      key: 'eval/github-pr',
    },
    {
      title: 'Forbidden personal secrets',
      text: 'forbidden personal secrets must not surface to agent actors.',
      actor: owner,
      key: 'eval/forbidden-secrets',
      sensitivity: 'confidential',
    },
    {
      title: 'Embedding adapter note',
      text: 'Stub embedding adapter produces deterministic hash vectors for tests.',
      actor: owner,
      key: 'eval/embedding-adapter',
    },
    {
      title: 'OAuth fingerprint note',
      text: 'OAuth callback stores code fingerprint and vault ref, never raw codes.',
      actor: chatgpt,
      key: 'eval/oauth-fingerprint',
    },
    {
      title: 'Credentials ready note',
      text: 'When CLIENT_ID and CLIENT_SECRET exist, exchangeMode becomes credentials_ready.',
      actor: owner,
      key: 'eval/credentials-ready',
    },
    {
      title: 'Candidate review note',
      text: 'Candidate review queue lets owner approve or reject capture memories.',
      actor: owner,
      key: 'eval/candidate-review',
    },
    {
      title: 'Retract memory note',
      text: 'Owners can retract mistaken memories with an audit reason.',
      actor: owner,
      key: 'eval/retract',
    },
    {
      title: 'Disputed fact note',
      text: 'Agents may mark a disputed fact for human arbitration.',
      actor: chatgpt,
      key: 'eval/disputed',
    },
    {
      title: 'Tesseract OCR note',
      text: 'MEMORY_OS_OCR_ENGINE=tesseract shells out to the system CLI.',
      actor: owner,
      key: 'eval/tesseract',
    },
    {
      title: 'Fixture OCR note',
      text: 'MEMORY_OS_OCR_ENGINE=fixture reads UTF-8 payloads as OCR text.',
      actor: owner,
      key: 'eval/fixture-ocr',
    },
    {
      title: 'Dead letter note',
      text: 'Failed connector jobs eventually move to dead_letter status.',
      actor: owner,
      key: 'eval/dead-letter',
    },
    {
      title: 'RLS matrix note',
      text: 'RLS matrix documents subject visibility rules for Memory OS tables.',
      actor: chatgpt,
      key: 'eval/rls',
    },
    {
      title: 'SECURITY DEFINER note',
      text: 'API RPCs use SECURITY DEFINER with assert_api_secret checks.',
      actor: owner,
      key: 'eval/secdef',
    },
    {
      title: 'Service role policy note',
      text: 'service_role keys must never ship to the browser or Vite env.',
      actor: owner,
      key: 'eval/service-role',
    },
    {
      title: 'Vite AuthPanel note',
      text: 'Web AuthPanel binds Supabase session to subject via /v1/auth/bind.',
      actor: owner,
      key: 'eval/authpanel',
    },
    {
      title: 'Calendar selected-calendar stub note',
      text: 'Google Calendar stub emits synthetic selected-calendar events when credentials are unavailable.',
      actor: chatgpt,
      key: 'eval/cal-standup',
    },
    {
      title: 'Drive brief stub note',
      text: 'Google Drive stub invents Project brief.docx updates without credentials.',
      actor: owner,
      key: 'eval/drive-brief',
    },
    {
      title: 'Gmail pilot stub note',
      text: 'Gmail stub invents pilot inbox metadata threads without bodies.',
      actor: owner,
      key: 'eval/gmail-pilot',
    },
    {
      title: 'API secret note',
      text: 'MEMORY_OS_API_SECRET authenticates public.api_* RPCs server-side only.',
      actor: owner,
      key: 'eval/api-secret',
    },
    {
      title: 'Agentic retrieval budget note',
      text: 'Agentic retrieval budget limits tool loops during context assembly.',
      actor: chatgpt,
      key: 'eval/agentic-budget',
    },
    {
      title: 'Personal compensation confidential',
      text: 'personal compensation bands stay confidential for owner eyes only.',
      actor: owner,
      key: 'eval/personal-comp',
      sensitivity: 'confidential',
    },
    {
      title: 'Local vault AES note',
      text: 'Local vault uses AES-GCM files under .data/vault for connector tokens.',
      actor: owner,
      key: 'eval/vault-aes',
    },
    {
      title: 'OAuth peek note',
      text: 'OAuth callback peeks state before HTTP exchange and vault write.',
      actor: chatgpt,
      key: 'eval/oauth-peek',
    },
    {
      title: 'Connector pull mode note',
      text: 'MEMORY_OS_CONNECTOR_PULL_MODE=auto uses vault tokens when present else stub.',
      actor: owner,
      key: 'eval/pull-mode',
    },
    {
      title: 'GitHub vault events note',
      text: 'Vault-backed GitHub pull reads user events API without storing tokens in DB.',
      actor: cursor,
      key: 'eval/github-events',
    },
    {
      title: 'Gmail vault metadata note',
      text: 'Vault-backed Gmail metadata pull indexes subjects without full bodies.',
      actor: owner,
      key: 'eval/gmail-vault',
    },
    {
      title: 'Drive vault files note',
      text: 'Vault-backed Drive files list captures recent document changes.',
      actor: chatgpt,
      key: 'eval/drive-vault',
    },
    {
      title: 'Calendar vault events note',
      text: 'Vault-backed Calendar events list captures upcoming meetings.',
      actor: owner,
      key: 'eval/cal-vault',
    },
    {
      title: 'Hybrid RPC ranking note',
      text: 'Supabase search re-ranks RPC hits with hybrid:rpc+embed embedding cosine.',
      actor: cursor,
      key: 'eval/hybrid-rpc',
    },
    {
      title: 'OpenAI embed adapter note',
      text: 'OpenAI embedding adapter activates when MEMORY_OS_EMBED_ENGINE=openai and key set.',
      actor: owner,
      key: 'eval/openai-embed',
    },
    {
      title: 'Exchange mode exchanged note',
      text: 'Successful HTTP OAuth sets exchange_mode exchanged and tokens_in_vault true.',
      actor: chatgpt,
      key: 'eval/exchanged',
    },
    {
      title: 'Tokens outside Postgres note',
      text: 'Connector tokens never land in Postgres; only vault refs are stored.',
      actor: owner,
      key: 'eval/no-pg-tokens',
    },
    {
      title: 'Google redirect uri note',
      text: 'Google OAuth token exchange requires redirect_uri from oauth_states or env.',
      actor: owner,
      key: 'eval/redirect-uri',
    },
    {
      title: 'pnpm prefer note',
      text: 'On this machine prefer npx pnpm@9.15.9 because local Volta pnpm shim is broken.',
      actor: owner,
      key: 'eval/pnpm',
    },
    {
      title: 'Consolidation worker note v2',
      text: 'worker-consolidation merges near-duplicate candidates and marks superseded keepers.',
      actor: owner,
      key: 'eval/consolidation-v2',
    },
    {
      title: 'Duplicate capture note',
      text: 'Exact title duplicate merge keeps the newer keeper candidate during consolidation.',
      actor: chatgpt,
      key: 'eval/dup-title',
    },
    {
      title: 'Vault backend note',
      text: 'MEMORY_OS_VAULT_BACKEND=memory uses an ephemeral in-memory vault for tests.',
      actor: owner,
      key: 'eval/vault-backend',
    },
    {
      title: 'Supersede RPC note',
      text: 'api_supersede_memory sets superseded_by provenance from duplicate to keeper.',
      actor: owner,
      key: 'eval/supersede-rpc',
    },
    {
      title: 'Embed similarity consolidate note',
      text: 'Near duplicate embed similarity threshold drives consolidation pairs.',
      actor: chatgpt,
      key: 'eval/embed-sim',
    },
    {
      title: 'SQL vector reason note',
      text: 'Search reason hybrid:sql+vector appears when embedding_vector cosine is used.',
      actor: chatgpt,
      key: 'eval/sql-vector',
    },
    {
      title: 'Embedding dims note',
      text: 'Stub embeddings persist with embedding_dims=32 and HNSW index on embedding_vector.',
      actor: owner,
      key: 'eval/embed-dims',
    },
    {
      title: 'Capture embed note',
      text: 'Capture path marks memories embedded after process_now completes.',
      actor: chatgpt,
      key: 'eval/capture-embed',
    },
    {
      title: 'Gmail subject header note',
      text: 'Vault Gmail metadata pull reads Subject and From headers only.',
      actor: owner,
      key: 'eval/gmail-subject',
    },
    {
      title: 'Drive modifiedTime note',
      text: 'Drive vault pull orders files by modifiedTime descending.',
      actor: cursor,
      key: 'eval/drive-mtime',
    },
    {
      title: 'Calendar timeMin note',
      text: 'Calendar vault pull requests upcoming events with timeMin filter.',
      actor: owner,
      key: 'eval/cal-timemin',
    },
    {
      title: 'MCP sync tool note',
      text: 'MCP connections.sync enqueues connector jobs and ingests deltas.',
      actor: cursor,
      key: 'eval/mcp-sync',
    },
    {
      title: 'Auth header bind note',
      text: 'API resolves subjects via x-auth-user-id after /v1/auth/bind.',
      actor: owner,
      key: 'eval/x-auth',
    },
    {
      title: 'RLS force note',
      text: 'Tables enable FORCE ROW LEVEL SECURITY for Memory OS policies.',
      actor: chatgpt,
      key: 'eval/rls-force',
    },
    {
      title: 'Checksum quarantine note',
      text: 'Capture stores SHA-256 checksum on quarantine artifacts before ingest.',
      actor: owner,
      key: 'eval/sha256',
    },
    {
      title: 'Review after consolidate note',
      text: 'Candidate review queue still lists keepers after consolidation supersedes duplicates.',
      actor: owner,
      key: 'eval/review-consol',
    },
    {
      title: 'Cursor handoff memory note',
      text: 'Cursor can read agent handoff for project context assembly.',
      actor: cursor,
      key: 'eval/handoff-mem',
    },
    {
      title: 'Shared vault ciphertext note',
      text: 'Shared vault stores ciphertext blobs via api_vault_put get delete RPCs.',
      actor: owner,
      key: 'eval/vault-cipher',
    },
    {
      title: 'List embedding field note',
      text: 'api_list_memories returns embedding vectors for consolidation planning.',
      actor: owner,
      key: 'eval/list-embed',
    },
    {
      title: 'Vault key policy note',
      text: 'MEMORY_OS_VAULT_KEY is required outside local; do not reuse API secret.',
      actor: owner,
      key: 'eval/vault-key',
    },
    {
      title: 'Pull credentials note',
      text: 'resolvePullCredentials returns vault mode only when vault token exists.',
      actor: owner,
      key: 'eval/pull-creds',
    },
    {
      title: 'Supabase vault backend note',
      text: 'Default MEMORY_OS_VAULT_BACKEND is supabase when SUPABASE_URL is configured.',
      actor: cursor,
      key: 'eval/vault-supabase',
    },
    {
      title: 'Authorize redirect note',
      text: 'Web OAuth opens real authorize URL when provider CLIENT_ID is set.',
      actor: owner,
      key: 'eval/authorize-url',
    },
    {
      title: 'Hybrid MCP ranking note',
      text: 'MCP memory.search uses hybrid ranking with hybrid:rpc+embed reason.',
      actor: cursor,
      key: 'eval/mcp-hybrid',
    },
    {
      title: 'Sync pullMode note',
      text: 'Connector sync responses include pullMode and note for vault vs stub.',
      actor: owner,
      key: 'eval/pullmode',
    },
    {
      title: 'Connector sync worker note',
      text: 'worker connector-sync once tick ingests deltas and embeds captures.',
      actor: chatgpt,
      key: 'eval/sync-worker',
    },
    {
      title: "Outbox consolidate enqueue note",
      text: "api_enqueue_consolidation writes memory.consolidation.requested outbox events.",
      actor: owner,
      key: "eval/outbox-consol",
    },
    {
      title: "Worker interval loop note",
      text: "MEMORY_OS_WORKER_INTERVAL_MS enables consolidation and sync cron loops.",
      actor: owner,
      key: "eval/worker-interval",
    },
    {
      title: "Complete consolidation job note",
      text: "api_complete_consolidation marks consolidate jobs succeeded and publishes outbox.",
      actor: chatgpt,
      key: "eval/complete-consol",
    },
    {
      title: "Idempotent consolidate minute note",
      text: "Consolidation idempotency key buckets jobs by workspace and UTC minute.",
      actor: owner,
      key: "eval/consol-idem",
    },
    {
      title: "Connector sync loop note",
      text: "connector-sync worker loop reuses enqueue connector sync each interval tick.",
      actor: cursor,
      key: "eval/sync-loop",
    },
    {
      title: "Vault cross process note",
      text: "Shared vault ciphertext lets API OAuth and sync workers share tokens safely.",
      actor: owner,
      key: "eval/vault-cross",
    },
    {
      title: "Hybrid sql vector note",
      text: "SQL hybrid search accepts optional query embedding for vector re-rank.",
      actor: chatgpt,
      key: "eval/sql-hybrid",
    },
    {
      title: "Supersede reason note",
      text: "supersedeMemory stores consolidation reason on superseded candidate memories.",
      actor: owner,
      key: "eval/supersede-reason",
    },
    {
      title: "MCP consolidation tool note",
      text: "MCP consolidation.run plans and applies near-duplicate candidate merges.",
      actor: owner,
      key: "eval/mcp-consol",
    },
    {
      title: "Web consolidation panel note",
      text: "Web control surface exposes Run consolidation for owner subjects.",
      actor: owner,
      key: "eval/web-consol",
    },
    {
      title: "Pull mode auto note",
      text: "MEMORY_OS_CONNECTOR_PULL_MODE auto prefers vault tokens then stub deltas.",
      actor: cursor,
      key: "eval/pull-auto",
    },
    {
      title: "Github issues delta note",
      text: "GitHub vault pull lists repository issues updated since the cursor watermark.",
      actor: chatgpt,
      key: "eval/gh-issues",
    },
    {
      title: "Gmail metadata only note",
      text: "Gmail vault mode stores subject from headers without message bodies.",
      actor: owner,
      key: "eval/gmail-meta",
    },
    {
      title: "Drive files list note",
      text: "Google Drive vault pull lists files ordered by modifiedTime for ingest.",
      actor: cursor,
      key: "eval/drive-list",
    },
    {
      title: "Calendar upcoming note",
      text: "Google Calendar vault pull fetches upcoming events using timeMin bounds.",
      actor: owner,
      key: "eval/cal-up",
    },
    {
      title: "Embed persist capture note",
      text: "Capture path persists embedding jsonb and embedding_vector for hybrid retrieval.",
      actor: chatgpt,
      key: "eval/embed-persist",
    },
    {
      title: "Review queue status note",
      text: "list memories by status powers the candidate review queue in Web.",
      actor: owner,
      key: "eval/review-status",
    },
    {
      title: "Auth bind session note",
      text: "Auth bind maps Supabase auth user id onto Memory OS subjects.",
      actor: owner,
      key: "eval/auth-bind2",
    },
    {
      title: "OAuth peek state note",
      text: "OAuth callback peeks oauth_states before HTTP token exchange into vault.",
      actor: owner,
      key: "eval/oauth-peek",
    },
    {
      title: "Fingerprint exchange note",
      text: "OAuth exchange records code fingerprint without storing access tokens in Postgres.",
      actor: chatgpt,
      key: "eval/fingerprint",
    },
    {
      title: "Dead letter consolidate note",
      text: "Failed consolidation jobs can move to dead_letter after repeated attempts.",
      actor: owner,
      key: "eval/dl-consol",
    },
    {
      title: "Processing jobs consolidate note",
      text: "processing_jobs job_type consolidate is enqueued by the consolidation outbox RPC.",
      actor: cursor,
      key: "eval/pj-consol",
    },
    {
      title: "Handoff project context note",
      text: "Project context assembly includes handoffs Cursor can read under ACL.",
      actor: cursor,
      key: "eval/ctx-handoff",
    },
    {
      title: "Sensitivity internal note",
      text: "Internal sensitivity memories remain readable by ChatGPT under ACL allow entries.",
      actor: chatgpt,
      key: "eval/sens-int",
    },
    {
      title: "Restricted deny cursor note",
      text: "Restricted sensitivity memories stay invisible to Cursor actor searches.",
      actor: cursor,
      key: "eval/restr-deny",
      sensitivity: 'restricted' as const,
    },
    {
      title: "Quarantine artifact note",
      text: "Text capture writes quarantine artifacts with checksum before ingest jobs.",
      actor: owner,
      key: "eval/quarantine2",
    },
    {
      title: "Chunk hash note",
      text: "Ingest jobs create hash chunks linked to candidate memories for provenance.",
      actor: chatgpt,
      key: "eval/chunk-hash",
    },
    {
      title: "Trace id audit note",
      text: "Audit log rows can carry trace_id for cross-agent decision reconstruction.",
      actor: owner,
      key: "eval/trace-audit",
    },
    {
      title: "Workspace member check note",
      text: "API RPCs assert workspace membership before mutating outbox or jobs.",
      actor: owner,
      key: "eval/ws-member",
    },
    {
      title: "Actor key resolve note",
      text: "x-actor-key resolves demo subjects for owner chatgpt and cursor clients.",
      actor: chatgpt,
      key: "eval/actor-key",
    },
    {
      title: "Client id demo note",
      text: "x-client-id demo-chatgpt binds the ChatGPT companion identity headers.",
      actor: chatgpt,
      key: "eval/client-id",
    },
    {
      title: "Project state version note",
      text: "Project state upserts keep a monotonic version for optimistic concurrency.",
      actor: owner,
      key: "eval/state-ver",
    },
    {
      title: "Evidence provenance note",
      text: "Evidence links preserve provenance from source events into memories.",
      actor: cursor,
      key: "eval/evidence",
    },
    {
      title: "Temporal recorded at note",
      text: "Memories store recordedAt temporal fields used by consolidation keepers.",
      actor: owner,
      key: "eval/temporal-recorded",
    },
    {
      title: "Stub embed engine note",
      text: "Stub embed engine hashes text into a fixed thirty-two dimension vector.",
      actor: chatgpt,
      key: "eval/stub-embed",
    },
    {
      title: "Noop embed engine note",
      text: "Noop embed engine returns empty vectors and skips embedding persistence.",
      actor: owner,
      key: "eval/noop-embed",
    },
    {
      title: "OpenAI embed fallback note",
      text: "OpenAI embed engine falls back to stub when API key is missing.",
      actor: owner,
      key: "eval/openai-fb",
    },
    {
      title: "Vault allow fallback note",
      text: "MEMORY_OS_VAULT_ALLOW_API_SECRET_FALLBACK is local-only and disabled in prod.",
      actor: owner,
      key: "eval/vault-fb",
    },
    {
      title: "Ciphertext base64 note",
      text: "Vault put encodes AES-GCM ciphertext as base64 for connector_vault_blobs.",
      actor: cursor,
      key: "eval/cipher-b64",
    },
    {
      title: "Cron hosted next note",
      text: "Hosted cron should call consolidation and connector-sync worker ticks periodically.",
      actor: owner,
      key: "eval/hosted-cron",
    },
  ];

  for (const row of fixtures) {
    store.captureText({
      workspaceId,
      projectId,
      title: row.title,
      text: row.text,
      actorSubjectId: row.actor,
      idempotencyKey: row.key,
      sensitivity: row.sensitivity ?? 'internal',
    });
  }

  expect(fixture.cases.length).toBeGreaterThanOrEqual(200);

  for (const testCase of fixture.cases) {
    it(testCase.id, async () => {
      const authz = authzFor(testCase.actor);
      const canRead = authorize(authz, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'internal',
      });
      expect(canRead).toBe(testCase.must_allow);

      const hits = (
        await searchMemoriesHybrid([...store.memories.values()], testCase.query, {
          projectId,
        })
      ).filter((hit) =>
        authorize(authz, {
          resourceType: 'memory',
          action: 'read',
          projectId: hit.memory.projectId,
          sensitivity: hit.memory.sensitivity,
        }),
      );

      if (testCase.expect_memory_title_includes) {
        expect(
          hits.some((h) =>
            h.memory.title.includes(testCase.expect_memory_title_includes!),
          ),
        ).toBe(true);
      }
      if (testCase.expect_content_includes) {
        expect(
          hits.some((h) =>
            h.memory.content
              .toLowerCase()
              .includes(testCase.expect_content_includes!.toLowerCase()),
          ),
        ).toBe(true);
      }
      if (testCase.expect_empty_or_no_restricted) {
        expect(
          hits.every((h) => h.memory.sensitivity !== 'restricted'),
        ).toBe(true);
      }
      if (testCase.expect_no_sensitivity) {
        expect(
          hits.every((h) => h.memory.sensitivity !== testCase.expect_no_sensitivity),
        ).toBe(true);
      }
    });
  }

  it('keeps personal Gmail and Calendar memories out of default agent retrieval', async () => {
    store.captureText({
      workspaceId,
      projectId,
      title: 'Personal Gmail beta thread',
      text: 'Personal Gmail beta thread about family travel receipts must stay private.',
      actorSubjectId: owner,
      idempotencyKey: 'eval/personal-gmail-beta',
      sensitivity: 'personal',
    });
    store.captureText({
      workspaceId,
      projectId,
      title: 'Personal Calendar beta event',
      text: 'Personal Calendar beta event for a doctor appointment must stay private.',
      actorSubjectId: owner,
      idempotencyKey: 'eval/personal-calendar-beta',
      sensitivity: 'personal',
    });

    const ownerHits = (
      await searchMemoriesHybrid([...store.memories.values()], 'personal beta', {
        projectId,
      })
    ).filter((hit) =>
      authorize(authzFor('owner'), {
        resourceType: 'memory',
        action: 'read',
        projectId: hit.memory.projectId,
        sensitivity: hit.memory.sensitivity,
      }),
    );
    expect(
      ownerHits.some((hit) => hit.memory.title === 'Personal Gmail beta thread'),
    ).toBe(true);
    expect(
      ownerHits.some((hit) => hit.memory.title === 'Personal Calendar beta event'),
    ).toBe(true);

    for (const actor of ['chatgpt', 'cursor', 'roma'] as const) {
      const hits = (
        await searchMemoriesHybrid([...store.memories.values()], 'personal beta', {
          projectId,
        })
      ).filter((hit) =>
        authorize(authzFor(actor), {
          resourceType: 'memory',
          action: 'read',
          projectId: hit.memory.projectId,
          sensitivity: hit.memory.sensitivity,
        }),
      );
      expect(
        hits.some((hit) => hit.memory.title === 'Personal Gmail beta thread'),
      ).toBe(false);
      expect(
        hits.some((hit) => hit.memory.title === 'Personal Calendar beta event'),
      ).toBe(false);
    }
  });
});

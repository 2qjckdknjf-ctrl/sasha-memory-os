import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHATGPT_PILOT_TOOLS,
  DEFAULT_PROJECT_ID,
  DEFAULT_WORKSPACE_ID,
} from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK,
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/first-hour-onboarding/m14-s09-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;

export const FIRST_HOUR_ONBOARDING_REDACTION_SNIPPET =
  'Do not paste tokens, secrets, memory bodies, or raw payloads into this guide.';

const SUSPICIOUS_DOC_PATTERNS = [
  {
    label: 'bearer-token-example',
    pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  },
  {
    label: 'authorization-header-example',
    pattern:
      /authorization\s*:\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
  {
    label: 'token-json-example',
    pattern:
      /"(?:access_token|refresh_token|token|authorization|cookie)"\s*:\s*"[^"]+"/i,
  },
  {
    label: 'payload-json-example',
    pattern: /"(?:payload|body|content|memories)"\s*:\s*(?:\{|\[|")/i,
  },
  {
    label: 'secret-assignment-example',
    pattern:
      /\b(?:service_role|vault_key|refresh_token|access_token)\s*=\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
] as const;

type FirstHourOnboardingStepId =
  (typeof OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps)[number]['id'];

type OnboardingDocSpec = {
  docPath: string;
  requiredSnippets: string[];
};

type RequiredStepSpec = {
  id: FirstHourOnboardingStepId;
  title: string;
  owner: string;
  status: string;
  guideSectionHeading: string;
  requiredSnippets: string[];
};

type FirstHourOnboardingManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  guide: OnboardingDocSpec;
  sliceDoc: OnboardingDocSpec;
  requiredSteps: RequiredStepSpec[];
};

type OnboardingDocSummary = {
  docPath: string;
  docExists: boolean;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

type RequiredStepSummary = {
  id: FirstHourOnboardingStepId;
  title: string;
  owner: string;
  status: string;
  guideSectionExists: boolean;
  ownerLine: string | null;
  statusLine: string | null;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

export const OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION =
  'm14-s09-v1' as const;

export const OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE = {
  version: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.version,
  roadmapSections: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.roadmapSections,
  steps: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map((step) => step.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxSteps: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.length,
  },
  invariants: {
    modeAToolCount:
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
    requireStepOwner: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    allowLiveOnboarding: false,
    allowNewUi: false,
    allowNewVendor: false,
    logPayloadBodies: false,
  },
} as const;

export type FirstHourOnboardingDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedFirstHourOnboardingDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type FirstHourOnboardingDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION;
  config: Pick<
    ResolvedFirstHourOnboardingDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  blockedFallbackProjectIds: string[];
  modeAToolCount: number;
  guide: OnboardingDocSummary;
  sliceDoc: OnboardingDocSummary;
  requiredSteps: RequiredStepSummary[];
  writeActionsAttempted: 0;
  verifiedWritesAttempted: 0;
  assertions: {
    ok: boolean;
    errors: string[];
  };
};

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFixturePath(pathValue: string | null | undefined): string {
  return resolve(trimToNull(pathValue) ?? DEFAULT_FIXTURE_DIR);
}

function readBoundedText(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
  const bytes = statSync(path).size;
  if (bytes > MAX_FIXTURE_BYTES) {
    throw new Error(
      `${label} exceeds bounded fixture size (${bytes} > ${MAX_FIXTURE_BYTES})`,
    );
  }
  return readFileSync(path, 'utf8');
}

function readFixtureJson<T>(path: string, label: string): T {
  return JSON.parse(readBoundedText(path, label)) as T;
}

function resolveDocPath(pathValue: string): string {
  return pathValue.startsWith('/') ? pathValue : resolve(WORKSPACE_ROOT, pathValue);
}

function getSectionBody(doc: string, heading: string): string | null {
  const lines = doc.split('\n');
  const normalizedHeading = heading.trim().toLowerCase();
  const startIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${normalizedHeading}`,
  );
  if (startIndex < 0) return null;
  const body: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

function extractFieldLine(section: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:[ \\t]*(.+)$`, 'mi');
  const match = section.match(pattern);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function suspiciousExampleLabels(doc: string): string[] {
  return SUSPICIOUS_DOC_PATTERNS.flatMap(({ label, pattern }) =>
    pattern.test(doc) ? [label] : [],
  );
}

function buildDocSummary(spec: OnboardingDocSpec, label: string): OnboardingDocSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      docPath,
      docExists: false,
      missingRequiredSnippets: [...spec.requiredSnippets],
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, label);
  return {
    docPath,
    docExists: true,
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !doc.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(doc),
  };
}

function buildRequiredStepSummary(
  guideDocPath: string,
  spec: RequiredStepSpec,
): RequiredStepSummary {
  const guide = readBoundedText(guideDocPath, 'first-hour onboarding guide');
  const section = getSectionBody(guide, spec.guideSectionHeading) ?? '';
  return {
    id: spec.id,
    title: spec.title,
    owner: spec.owner,
    status: spec.status,
    guideSectionExists: Boolean(section),
    ownerLine: extractFieldLine(section, 'Owner'),
    statusLine: extractFieldLine(section, 'Status'),
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !section.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

export function evaluateFirstHourOnboardingReport(
  report: Omit<FirstHourOnboardingDrillReport, 'assertions'>,
): string[] {
  const errors: string[] = [];

  if (
    report.modeAToolCount !==
    OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount
  ) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount})`,
    );
  }
  if (!report.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    errors.push(
      `first-hour onboarding manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  if (!report.guide.docExists) {
    errors.push('first-hour onboarding guide is missing');
  }
  if (report.guide.missingRequiredSnippets.length > 0) {
    errors.push(
      `first-hour onboarding guide is missing required snippets (${report.guide.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.guide.suspiciousExampleLabels.length > 0) {
    errors.push(
      `first-hour onboarding guide includes suspicious examples (${report.guide.suspiciousExampleLabels.join(', ')})`,
    );
  }
  if (!report.sliceDoc.docExists) {
    errors.push('M14 Slice 09 doc is missing');
  }
  if (report.sliceDoc.missingRequiredSnippets.length > 0) {
    errors.push(
      `M14 Slice 09 doc is missing required snippets (${report.sliceDoc.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.sliceDoc.suspiciousExampleLabels.length > 0) {
    errors.push(
      `M14 Slice 09 doc includes suspicious examples (${report.sliceDoc.suspiciousExampleLabels.join(', ')})`,
    );
  }

  const actualIds = report.requiredSteps.map((step) => step.id);
  for (const expectedId of OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map(
    (step) => step.id,
  )) {
    if (!actualIds.includes(expectedId)) {
      errors.push(`first-hour onboarding manifest is missing required step ${expectedId}`);
    }
  }

  for (const step of report.requiredSteps) {
    const expectedStep = OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.find(
      (item) => item.id === step.id,
    );
    if (!step.guideSectionExists) {
      errors.push(`guide section is missing for step ${step.id}`);
    }
    if (!step.owner.trim()) {
      errors.push(`first-hour onboarding manifest owner is missing for step ${step.id}`);
    }
    if (!step.status.trim()) {
      errors.push(`first-hour onboarding manifest status is missing for step ${step.id}`);
    }
    if (!step.ownerLine) {
      errors.push(`guide section is missing Owner for step ${step.id}`);
    } else if (step.ownerLine !== step.owner) {
      errors.push(
        `guide owner mismatch for step ${step.id} (${step.ownerLine} !== ${step.owner})`,
      );
    }
    if (!step.statusLine) {
      errors.push(`guide section is missing Status for step ${step.id}`);
    } else if (step.statusLine !== step.status) {
      errors.push(
        `guide status mismatch for step ${step.id} (${step.statusLine} !== ${step.status})`,
      );
    }
    if (expectedStep && step.owner !== expectedStep.ownerRole) {
      errors.push(
        `guide manifest owner mismatch for step ${step.id} (${step.owner} !== ${expectedStep.ownerRole})`,
      );
    }
    if (step.missingRequiredSnippets.length > 0) {
      errors.push(
        `guide step ${step.id} is missing required snippets (${step.missingRequiredSnippets.join(', ')})`,
      );
    }
    if (step.suspiciousExampleLabels.length > 0) {
      errors.push(
        `guide step ${step.id} includes suspicious examples (${step.suspiciousExampleLabels.join(', ')})`,
      );
    }
  }

  if (report.writeActionsAttempted !== 0) {
    errors.push(
      `first-hour onboarding drill attempted writes (${report.writeActionsAttempted})`,
    );
  }
  if (report.verifiedWritesAttempted !== 0) {
    errors.push(
      `first-hour onboarding drill attempted verified-memory writes (${report.verifiedWritesAttempted})`,
    );
  }

  return errors;
}

export function firstHourOnboardingDrillConfigInputFromEnv(
  env: Record<string, string | undefined>,
): FirstHourOnboardingDrillConfigInput {
  return {
    fixtureDir:
      trimToNull(env.MEMORY_OS_FIRST_HOUR_ONBOARDING_FIXTURE_DIR) ?? undefined,
    manifestPath:
      trimToNull(env.MEMORY_OS_FIRST_HOUR_ONBOARDING_MANIFEST_PATH) ?? undefined,
    projectId:
      trimToNull(env.MEMORY_OS_FIRST_HOUR_ONBOARDING_PROJECT_ID) ??
      trimToNull(env.MEMORY_OS_PROJECT_ID) ??
      undefined,
    workspaceId:
      trimToNull(env.MEMORY_OS_FIRST_HOUR_ONBOARDING_WORKSPACE_ID) ??
      trimToNull(env.MEMORY_OS_WORKSPACE_ID) ??
      DEFAULT_WORKSPACE_ID,
  };
}

export function resolveFirstHourOnboardingDrillConfig(
  input: FirstHourOnboardingDrillConfigInput,
): ResolvedFirstHourOnboardingDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    fixtureDir,
    trimToNull(input.manifestPath) ?? 'onboarding-manifest.json',
  );
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded first-hour onboarding drill; no default project fallback',
    );
  }
  if (projectId === DEFAULT_PROJECT_ID) {
    throw new Error(
      `AISTROYKA fallback project_id ${DEFAULT_PROJECT_ID} is not allowed for the bounded first-hour onboarding drill`,
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolveFirstHourOnboardingDrillConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedFirstHourOnboardingDrillConfig {
  return resolveFirstHourOnboardingDrillConfig(
    firstHourOnboardingDrillConfigInputFromEnv(env),
  );
}

export async function runFirstHourOnboardingDrill(
  input: FirstHourOnboardingDrillConfigInput,
): Promise<FirstHourOnboardingDrillReport> {
  const config = resolveFirstHourOnboardingDrillConfig(input);
  const manifest = readFixtureJson<FirstHourOnboardingManifest>(
    config.manifestPath,
    'first-hour onboarding manifest',
  );
  const manifestErrors: string[] = [];

  if (
    manifest.manifestVersion !== OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION
  ) {
    manifestErrors.push(
      `first-hour onboarding manifest version mismatch (${manifest.manifestVersion} !== ${OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION})`,
    );
  }
  if (manifest.packVersion !== OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.version) {
    manifestErrors.push(
      `first-hour onboarding pack version mismatch (${manifest.packVersion} !== ${OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.version})`,
    );
  }
  if (manifest.source !== 'fixture-local') {
    manifestErrors.push(
      `first-hour onboarding manifest source must stay fixture-local (${manifest.source})`,
    );
  }
  if (
    JSON.stringify(manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.roadmapSections)
  ) {
    manifestErrors.push(
      `first-hour onboarding roadmap sections mismatch (${manifest.roadmapSections.join(', ')} !== ${OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.roadmapSections.join(', ')})`,
    );
  }
  if (!manifest.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    manifestErrors.push(
      `first-hour onboarding manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  const expectedStepIds = OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map(
    (step) => step.id,
  );
  const actualStepIds = manifest.requiredSteps.map((step) => step.id);
  for (const expectedStepId of expectedStepIds) {
    if (!actualStepIds.includes(expectedStepId)) {
      manifestErrors.push(
        `first-hour onboarding manifest is missing required step ${expectedStepId}`,
      );
    }
  }

  const guide = buildDocSummary(manifest.guide, 'first-hour onboarding guide');
  const sliceDoc = buildDocSummary(manifest.sliceDoc, 'M14 Slice 09 doc');
  const guideDocPath = resolveDocPath(manifest.guide.docPath);
  const requiredSteps = existsSync(guideDocPath)
    ? manifest.requiredSteps.map((step) =>
        buildRequiredStepSummary(guideDocPath, step),
      )
    : manifest.requiredSteps.map((step) => ({
        id: step.id,
        title: step.title,
        owner: step.owner,
        status: step.status,
        guideSectionExists: false,
        ownerLine: null,
        statusLine: null,
        missingRequiredSnippets: [...step.requiredSnippets],
        suspiciousExampleLabels: [],
      }));

  const reportBase = {
    recipeVersion: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
    config,
    blockedFallbackProjectIds: manifest.blockedFallbackProjectIds,
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    guide,
    sliceDoc,
    requiredSteps,
    writeActionsAttempted: 0 as const,
    verifiedWritesAttempted: 0 as const,
  };
  const errors = [
    ...manifestErrors,
    ...evaluateFirstHourOnboardingReport(reportBase),
  ];

  return {
    ...reportBase,
    assertions: {
      ok: errors.length === 0,
      errors,
    },
  };
}

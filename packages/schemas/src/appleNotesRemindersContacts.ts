export const OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION = 'm16-s05-v1' as const;

export type PersonalSourceKind = 'notes' | 'reminders' | 'contacts';

export type PersonalSourceAccessPath =
  | 'share_extension'
  | 'manual_export'
  | 'eventkit_selected_lists'
  | 'contacts_selected';

export type PersonalMemoryMapping =
  | 'note'
  | 'task'
  | 'contact_fact'
  | 'reject';

export type PersonalSourceIngestDecision = {
  source: PersonalSourceKind;
  mapping: PersonalMemoryMapping;
  inScope: boolean;
  metadataOnly: boolean;
  tombstone?: boolean;
  reason: string;
};

export const PERSONAL_SOURCE_TYPED_MAPPINGS: Record<
  PersonalSourceKind,
  { defaultMapping: PersonalMemoryMapping; allowedFields: readonly string[] }
> = {
  notes: {
    defaultMapping: 'note',
    allowedFields: ['title', 'text', 'url', 'observed_at', 'source_ref'],
  },
  reminders: {
    defaultMapping: 'task',
    allowedFields: [
      'title',
      'due_at',
      'completed_at',
      'list_id',
      'priority',
      'source_ref',
    ],
  },
  contacts: {
    defaultMapping: 'contact_fact',
    allowedFields: [
      'display_name',
      'organization',
      'email_domain',
      'phone_last4',
      'source_ref',
    ],
  },
} as const;

export const OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK = {
  version: OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION,
  roadmapSections: ['16.5', 'notes-reminders-contacts'],
  sources: ['notes', 'reminders', 'contacts'] as const,
  accessPaths: {
    notes: ['share_extension', 'manual_export'] as const,
    reminders: ['eventkit_selected_lists'] as const,
    contacts: ['contacts_selected'] as const,
  },
  invariants: {
    selectedSourceIngestOnly: true,
    notesNoCloudKitDump: true,
    remindersEventKitDeviceLocalOnly: true,
    contactsMetadataMinimalOptIn: true,
    neverServerSideIcloudScrape: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveDeviceE2EPassFromMocks: false,
  },
  liveDeviceE2E: {
    statusInThisSlice: 'contract_pass_live_device_blocked',
    note: 'Selected-source Notes/Reminders/Contacts contracts PASS; live EventKit/Contacts device E2E blocked until signed companion.',
  },
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

export function decideNotesIngest(input: {
  projectId: string;
  accessPath: PersonalSourceAccessPath;
  userInitiated: boolean;
  deleted?: boolean;
}): PersonalSourceIngestDecision {
  requireExplicitProjectId(input.projectId);

  if (
    input.accessPath !== 'share_extension' &&
    input.accessPath !== 'manual_export'
  ) {
    return {
      source: 'notes',
      mapping: 'reject',
      inScope: false,
      metadataOnly: true,
      reason: 'notes require share extension or manual export; no CloudKit dump',
    };
  }

  if (input.deleted) {
    return {
      source: 'notes',
      mapping: 'note',
      inScope: true,
      metadataOnly: true,
      tombstone: true,
      reason: 'note removal emits idempotent tombstone',
    };
  }

  if (!input.userInitiated) {
    return {
      source: 'notes',
      mapping: 'reject',
      inScope: false,
      metadataOnly: true,
      reason: 'notes ingest must be user-initiated',
    };
  }

  return {
    source: 'notes',
    mapping: 'note',
    inScope: true,
    metadataOnly: false,
    reason: 'user-initiated note mapped to note memory type',
  };
}

export function decideRemindersIngest(input: {
  projectId: string;
  listExplicitlySelected: boolean;
  deleted?: boolean;
}): PersonalSourceIngestDecision {
  requireExplicitProjectId(input.projectId);

  if (input.deleted) {
    return {
      source: 'reminders',
      mapping: 'task',
      inScope: true,
      metadataOnly: true,
      tombstone: true,
      reason: 'completed/deleted reminder emits idempotent tombstone',
    };
  }

  if (!input.listExplicitlySelected) {
    return {
      source: 'reminders',
      mapping: 'reject',
      inScope: false,
      metadataOnly: true,
      reason: 'reminders: only explicitly selected lists are eligible',
    };
  }

  return {
    source: 'reminders',
    mapping: 'task',
    inScope: true,
    metadataOnly: false,
    reason: 'selected EventKit reminder list mapped to task memory type',
  };
}

export function decideContactsIngest(input: {
  projectId: string;
  contactExplicitlySelected: boolean;
  fieldsRequested: string[];
  deleted?: boolean;
}): PersonalSourceIngestDecision {
  requireExplicitProjectId(input.projectId);
  const allowed = new Set(PERSONAL_SOURCE_TYPED_MAPPINGS.contacts.allowedFields);

  if (input.deleted) {
    return {
      source: 'contacts',
      mapping: 'contact_fact',
      inScope: true,
      metadataOnly: true,
      tombstone: true,
      reason: 'contact removal emits idempotent tombstone',
    };
  }

  if (!input.contactExplicitlySelected) {
    return {
      source: 'contacts',
      mapping: 'reject',
      inScope: false,
      metadataOnly: true,
      reason: 'contacts: only explicitly selected contacts are eligible',
    };
  }

  const disallowed = input.fieldsRequested.filter((field) => !allowed.has(field));
  if (disallowed.length > 0) {
    return {
      source: 'contacts',
      mapping: 'reject',
      inScope: false,
      metadataOnly: true,
      reason: `contacts: disallowed fields requested (${disallowed.join(', ')})`,
    };
  }

  return {
    source: 'contacts',
    mapping: 'contact_fact',
    inScope: true,
    metadataOnly: true,
    reason: 'metadata-minimal contact facts only (opt-in fields)',
  };
}

export function personalSourceIdempotencyKey(input: {
  source: PersonalSourceKind;
  sourceRef: string;
}): string {
  const ref = input.sourceRef.trim();
  if (!ref) throw new Error('source_ref is required');
  return `${input.source}:${ref}`;
}

export function mapPersonalSourceFields(
  source: PersonalSourceKind,
  fields: Record<string, unknown>,
): { ok: boolean; allowed: Record<string, unknown>; rejected: string[] } {
  const allowedSet = new Set(PERSONAL_SOURCE_TYPED_MAPPINGS[source].allowedFields);
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowedSet.has(key)) allowed[key] = value;
    else rejected.push(key);
  }
  return { ok: rejected.length === 0, allowed, rejected };
}

import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK,
  OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION,
  decideContactsIngest,
  decideNotesIngest,
  decideRemindersIngest,
  mapPersonalSourceFields,
  personalSourceIdempotencyKey,
} from './appleNotesRemindersContacts.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M16.5 Notes / Reminders / Contacts pack', () => {
  it('publishes pack without live device E2E PASS', () => {
    expect(OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION).toBe('m16-s05-v1');
    expect(OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK.invariants).toMatchObject({
      selectedSourceIngestOnly: true,
      notesNoCloudKitDump: true,
      contactsMetadataMinimalOptIn: true,
      claimLiveDeviceE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('gates notes, reminders, and contacts with typed mappings', () => {
    expect(
      decideNotesIngest({
        projectId,
        accessPath: 'share_extension',
        userInitiated: true,
      }).mapping,
    ).toBe('note');

    expect(
      decideNotesIngest({
        projectId,
        accessPath: 'eventkit_selected_lists' as never,
        userInitiated: true,
      }).mapping,
    ).toBe('reject');

    expect(
      decideRemindersIngest({
        projectId,
        listExplicitlySelected: true,
      }).mapping,
    ).toBe('task');

    expect(
      decideRemindersIngest({
        projectId,
        listExplicitlySelected: false,
      }).mapping,
    ).toBe('reject');

    expect(
      decideContactsIngest({
        projectId,
        contactExplicitlySelected: true,
        fieldsRequested: ['display_name', 'email_domain'],
      }).metadataOnly,
    ).toBe(true);

    expect(
      decideContactsIngest({
        projectId,
        contactExplicitlySelected: true,
        fieldsRequested: ['full_address'],
      }).mapping,
    ).toBe('reject');

    expect(
      personalSourceIdempotencyKey({
        source: 'reminders',
        sourceRef: 'list-1:item-9',
      }),
    ).toBe('reminders:list-1:item-9');

    const mapped = mapPersonalSourceFields('notes', {
      title: 'Meeting',
      text: 'Agenda',
      secret_body: 'nope',
    });
    expect(mapped.ok).toBe(false);
    expect(mapped.rejected).toEqual(['secret_body']);
    expect(mapped.allowed).toEqual({ title: 'Meeting', text: 'Agenda' });

    expect(() =>
      decideNotesIngest({
        projectId: ' ',
        accessPath: 'share_extension',
        userInitiated: true,
      }),
    ).toThrow(/project_id is required/);
  });
});

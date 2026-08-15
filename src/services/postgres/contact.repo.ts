import { getPool } from './pool';

/**
 * Personal contacts stored by the Go API. The Node call engine loads the ones
 * that carry a phone number so it can enrich inbound caller ID: when an external
 * number rings a user, show that user's saved contact name instead of the raw
 * number. Loaded in bulk at startup and refreshed per-owner on the
 * `contacts_changed` NOTIFY (same pattern as the settings/PSTN detail loaders).
 */

export interface ContactPhoneRow {
  owner_extension: string;
  phone: string;
  name: string;
}

// Only rows with a non-empty phone are relevant to caller-ID enrichment.
const SELECT_SQL =
  "SELECT owner_extension, phone, name FROM contacts WHERE phone IS NOT NULL AND phone <> ''";

export async function loadAllContactPhones(): Promise<ContactPhoneRow[]> {
  const { rows } = await getPool().query<ContactPhoneRow>(SELECT_SQL);
  return rows;
}

export async function loadContactPhonesByOwner(owner: string): Promise<ContactPhoneRow[]> {
  const { rows } = await getPool().query<ContactPhoneRow>(
    `${SELECT_SQL} AND owner_extension = $1`,
    [owner],
  );
  return rows;
}

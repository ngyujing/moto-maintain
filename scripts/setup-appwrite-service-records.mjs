/**
 * One-time Appwrite schema setup for ownership cost records.
 *
 * Adds a `recordType` attribute to the `service_records` collection and makes
 * `maintenanceItemId` optional so ownership records (which have no maintenance
 * item) can be stored in the same collection.
 *
 * Run it once with a server API key (Databases scope: read + write):
 *
 *   npm install node-appwrite
 *   APPWRITE_API_KEY=YOUR_SERVER_KEY node scripts/setup-appwrite-service-records.mjs
 *
 * Endpoint / project / database default to the values used by index.html and can
 * be overridden via env vars: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_DATABASE.
 */
import { Client, Databases } from 'node-appwrite';

const ENDPOINT   = process.env.APPWRITE_ENDPOINT   || 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6a0fce4800389b0e9917';
const DATABASE   = process.env.APPWRITE_DATABASE   || 'moto_maintain_db';
const COLLECTION = 'service_records';
const API_KEY    = process.env.APPWRITE_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing APPWRITE_API_KEY. Provide a server API key with Databases read+write scope.');
  process.exit(1);
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const db = new Databases(client);

const isAlreadyExists = (err) =>
  err?.code === 409 || /already exists/i.test(err?.message || '');

async function ensureRecordTypeAttribute() {
  try {
    // key="recordType", size=20, required=false, default="maintenance"
    await db.createStringAttribute(DATABASE, COLLECTION, 'recordType', 20, false, 'maintenance');
    console.log('✅ Created attribute `recordType` (String, optional, default "maintenance").');
  } catch (err) {
    if (isAlreadyExists(err)) {
      console.log('ℹ️  Attribute `recordType` already exists — skipping.');
    } else {
      throw err;
    }
  }
}

async function makeMaintenanceItemIdOptional() {
  let attrs;
  try {
    const res = await db.listAttributes(DATABASE, COLLECTION);
    attrs = res.attributes || [];
  } catch (err) {
    console.warn('⚠️  Could not list attributes to inspect `maintenanceItemId`:', err.message);
    return;
  }

  const attr = attrs.find((a) => a.key === 'maintenanceItemId');
  if (!attr) {
    console.log('ℹ️  No `maintenanceItemId` attribute found — nothing to relax.');
    return;
  }

  if (attr.type === 'relationship') {
    if (attr.required) {
      console.warn(
        '⚠️  `maintenanceItemId` is a REQUIRED relationship. Appwrite cannot relax this via API.\n' +
        '    Please set it to "not required" in the Appwrite console, or ownership-cost writes will fail.'
      );
    } else {
      console.log('ℹ️  `maintenanceItemId` is an optional relationship — ownership records can omit it. OK.');
    }
    return;
  }

  if (!attr.required) {
    console.log('ℹ️  `maintenanceItemId` is already optional. OK.');
    return;
  }

  try {
    // updateStringAttribute(databaseId, collectionId, key, required, default)
    await db.updateStringAttribute(DATABASE, COLLECTION, 'maintenanceItemId', false, null);
    console.log('✅ Made `maintenanceItemId` optional.');
  } catch (err) {
    console.warn(
      '⚠️  Could not make `maintenanceItemId` optional automatically:', err.message,
      '\n    Set it to "not required" in the Appwrite console manually.'
    );
  }
}

(async () => {
  console.log(`→ Configuring ${DATABASE}/${COLLECTION} on ${ENDPOINT} (project ${PROJECT_ID})\n`);
  await ensureRecordTypeAttribute();
  await makeMaintenanceItemIdOptional();
  console.log('\n✔ Done. Existing records default to recordType="maintenance"; ownership records store "ownership".');
})().catch((err) => {
  console.error('❌ Setup failed:', err.code || '', err.message || err);
  process.exit(1);
});

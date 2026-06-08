/**
 * One-time Appwrite schema setup for ownership cost records.
 *
 * Adds a `recordType` attribute to the `service_records` collection and makes
 * `maintenanceItemId` optional so ownership records (which have no maintenance
 * item) can be stored in the same collection.
 *
 * Uses Node's built-in fetch (no SDK) so it runs on any modern Node version
 * without dependencies:
 *
 *   node scripts/setup-appwrite-service-records.js
 *
 * Endpoint / project / database / key default to the values below and can be
 * overridden via env vars: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID,
 * APPWRITE_DATABASE, APPWRITE_API_KEY.
 */
const ENDPOINT   = process.env.APPWRITE_ENDPOINT   || 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6a0fce4800389b0e9917';
const DATABASE   = process.env.APPWRITE_DATABASE   || 'moto_maintain_db';
const COLLECTION = 'service_records';
const API_KEY    = process.env.APPWRITE_API_KEY || 'standard_f14780d317885e010a14afbe2e7a4a852b21de1c2e6577e6a740f8a8fb2e1ac9258cf316356bc50a65ba00110ce365b5953ce50d0e65d5c0c6f2a10c9dadd5bf0d601add207f2513598d29f0565f32204ab5da27b71932771f6f413dafd077bd0054a49c7f0bdda1996e2c89e44b30bc08524c9cc16f771c6735c662737c42ec';

if (!API_KEY) {
  console.error('Missing APPWRITE_API_KEY. Provide a server API key with Databases read+write scope.');
  process.exit(1);
}

const base = `${ENDPOINT}/databases/${DATABASE}/collections/${COLLECTION}`;
const headers = {
  'Content-Type': 'application/json',
  'X-Appwrite-Project': PROJECT_ID,
  'X-Appwrite-Key': API_KEY,
};

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
  return { ok: res.ok, status: res.status, data };
}

async function ensureRecordTypeAttribute() {
  const r = await api('POST', '/attributes/string', { key: 'recordType', size: 20, required: false, default: 'maintenance' });
  if (r.ok) { console.log('Created attribute recordType (String, optional, default "maintenance").'); return; }
  if (r.status === 409) { console.log('Attribute recordType already exists - skipping.'); return; }
  throw new Error(`create recordType failed [${r.status}]: ${r.data?.message || ''}`);
}

async function makeMaintenanceItemIdOptional() {
  const list = await api('GET', '/attributes');
  if (!list.ok) { console.warn(`Could not list attributes [${list.status}]: ${list.data?.message || ''}`); return; }
  const attr = (list.data.attributes || []).find((a) => a.key === 'maintenanceItemId');
  if (!attr) { console.log('No maintenanceItemId attribute found - nothing to relax.'); return; }

  if (attr.type === 'relationship') {
    if (attr.required) console.warn('maintenanceItemId is a REQUIRED relationship - Appwrite cannot relax this via API. Set it to "not required" in the console, or ownership-cost writes will fail.');
    else console.log('maintenanceItemId is an optional relationship - ownership records can omit it. OK.');
    return;
  }
  if (!attr.required) { console.log('maintenanceItemId is already optional. OK.'); return; }

  const r = await api('PATCH', '/attributes/string/maintenanceItemId', { required: false, default: null });
  if (r.ok) console.log('Made maintenanceItemId optional.');
  else console.warn(`Could not make maintenanceItemId optional [${r.status}]: ${r.data?.message || ''}. Set it to "not required" in the Appwrite console manually.`);
}

(async () => {
  console.log(`Configuring ${DATABASE}/${COLLECTION} on ${ENDPOINT} (project ${PROJECT_ID})\n`);
  await ensureRecordTypeAttribute();
  await makeMaintenanceItemIdOptional();
  console.log('\nDone. Existing records default to recordType="maintenance"; ownership records store "ownership".');
})().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exit(1);
});

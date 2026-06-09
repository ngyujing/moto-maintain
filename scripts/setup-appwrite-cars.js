/**
 * One-time Appwrite schema setup for CAR tracking.
 *
 * Creates three collections that mirror the motorcycle trio but are fully
 * isolated, so the existing motorcycle data/collections are never touched:
 *
 *   - cars                  (mirrors `motorcycles`, plus car-specific fields)
 *   - car_maintenance_items (mirrors `maintenance_items`, FK = carId)
 *   - car_service_records   (mirrors `service_records`,   FK = carId)
 *
 * Idempotent: re-running skips anything that already exists (409 responses).
 * Uses Node's built-in fetch (no SDK), like setup-appwrite-service-records.js:
 *
 *   node scripts/setup-appwrite-cars.js
 *
 * Endpoint / project / database / key default to the values below and can be
 * overridden via env vars: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID,
 * APPWRITE_DATABASE, APPWRITE_API_KEY.
 */
const ENDPOINT   = process.env.APPWRITE_ENDPOINT   || 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6a0fce4800389b0e9917';
const DATABASE   = process.env.APPWRITE_DATABASE   || 'moto_maintain_db';
const API_KEY    = process.env.APPWRITE_API_KEY    || 'standard_f14780d317885e010a14afbe2e7a4a852b21de1c2e6577e6a740f8a8fb2e1ac9258cf316356bc50a65ba00110ce365b5953ce50d0e65d5c0c6f2a10c9dadd5bf0d601add207f2513598d29f0565f32204ab5da27b71932771f6f413dafd077bd0054a49c7f0bdda1996e2c89e44b30bc08524c9cc16f771c6735c662737c42ec';

if (!API_KEY) {
  console.error('Missing APPWRITE_API_KEY. Provide a server API key with Databases read+write scope:');
  console.error('  APPWRITE_API_KEY=... node scripts/setup-appwrite-cars.js');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'X-Appwrite-Project': PROJECT_ID,
  'X-Appwrite-Key': API_KEY,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Throttle between attribute creations so we never trip Appwrite's
// attribute-creation rate limit (the original cause of silently-skipped fields).
const THROTTLE_MS = 600;

// One API call with retry/backoff on rate limits (429), server errors (5xx),
// and transient network failures. This is what makes re-running reliable.
async function api(method, path, body, attempt = 0) {
  let res;
  try {
    res = await fetch(`${ENDPOINT}/databases/${DATABASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    if (attempt < 5) { await sleep(1000 * Math.pow(2, attempt)); return api(method, path, body, attempt + 1); }
    return { ok: false, status: 0, data: { message: netErr.message || 'network error' } };
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = 1000 * Math.pow(2, attempt);
    console.log(`  … ${res.status} on ${path} — retrying in ${wait}ms`);
    await sleep(wait);
    return api(method, path, body, attempt + 1);
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
  return { ok: res.ok, status: res.status, data };
}

// Permission model mirrors the app's usage: any authenticated user can CRUD,
// and the app scopes everything by userId in its queries (same posture as the
// existing motorcycle collections).
const USER_PERMS = ['create("users")', 'read("users")', 'update("users")', 'delete("users")'];

// Tracks attributes the script could NOT create, so we can fail loudly at the end.
const failures = [];

async function ensureCollection(id, name) {
  const r = await api('POST', '/collections', {
    collectionId: id, name, permissions: USER_PERMS, documentSecurity: false,
  });
  if (r.ok) { console.log(`Created collection "${id}".`); return; }
  if (r.status === 409) { console.log(`Collection "${id}" already exists - skipping.`); return; }
  throw new Error(`create collection ${id} failed [${r.status}]: ${r.data?.message || ''}`);
}

async function ensureAttr(coll, key, type, payload) {
  const r = await api('POST', `/collections/${coll}/attributes/${type}`, { key, ...payload });
  if (r.ok) console.log(`  + ${coll}.${key}`);
  else if (r.status === 409) console.log(`  = ${coll}.${key} (exists)`);
  else { console.warn(`  ! ${coll}.${key} failed [${r.status}]: ${r.data?.message || ''}`); failures.push(`${coll}.${key}`); }
  await sleep(THROTTLE_MS);
}
const ensureString  = (coll, key, size, required = false) => ensureAttr(coll, key, 'string',  { size, required });
const ensureInteger = (coll, key, required = false)       => ensureAttr(coll, key, 'integer', { required });
const ensureFloat   = (coll, key, required = false)       => ensureAttr(coll, key, 'float',   { required });
const ensureBoolean = (coll, key, required = false)       => ensureAttr(coll, key, 'boolean', { required });

// Wait until the named attributes report status "available" before indexing.
async function waitForAttributes(coll, keys, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const r = await api('GET', `/collections/${coll}/attributes`);
    const list = (r.data?.attributes || []);
    const ready = keys.every(k => { const a = list.find(x => x.key === k); return a && a.status === 'available'; });
    if (ready) return true;
    await sleep(1000);
  }
  console.warn(`  ! Timed out waiting for attributes on ${coll}: ${keys.join(', ')}`);
  return false;
}

async function ensureIndex(coll, key, attributes) {
  const r = await api('POST', `/collections/${coll}/indexes`, {
    key, type: 'key', attributes, orders: attributes.map(() => 'ASC'),
  });
  if (r.ok) console.log(`  idx ${coll}.${key}`);
  else if (r.status === 409) console.log(`  idx ${coll}.${key} (exists)`);
  else console.warn(`  ! idx ${coll}.${key} failed [${r.status}]: ${r.data?.message || ''}`);
  await sleep(THROTTLE_MS);
}

// Final safety net: confirm every attribute the app writes actually exists.
async function verify(coll, expectedKeys) {
  const r = await api('GET', `/collections/${coll}/attributes?limit=100`);
  const have = new Set((r.data?.attributes || []).map(a => a.key));
  const missing = expectedKeys.filter(k => !have.has(k));
  if (missing.length) { console.error(`  ✗ ${coll} is MISSING: ${missing.join(', ')}`); missing.forEach(k => failures.push(`${coll}.${k}`)); }
  else console.log(`  ✓ ${coll}: all ${expectedKeys.length} attributes present`);
}
const CARS_ATTRS = ['userId','make','model','year','currentKm','nickname','color','vin','carType',
  'registrationNumber','iuNumber','fuelType','transmission','engineCapacity','coeCategory',
  'registrationDate','inspectionDate','nextInspectionDate','roadTaxExpiry','insuranceExpiry',
  'coeExpiry','seasonParkingExpiry','warrantyExpiry','insuranceProvider','insurancePolicyNo'];
const CAR_ITEM_ATTRS = ['carId','userId','partType','partLabel','intervalKm','intervalDays',
  'lastServiceKm','nextDueKm','lastServiceDate','nextDueDate','serviceStatus','isCustomInterval','serviceType','remarks'];
const CAR_REC_ATTRS = ['carId','userId','maintenanceItemId','completedBy','partType','partLabel',
  'serviceDate','mileageAtService','cost','notes','recordType'];

async function setupCars() {
  await ensureCollection('cars', 'Cars');
  await ensureString('cars', 'userId', 64, true);
  await ensureString('cars', 'make', 100);
  await ensureString('cars', 'model', 100);
  await ensureInteger('cars', 'year');
  await ensureInteger('cars', 'currentKm');
  await ensureString('cars', 'nickname', 100);
  await ensureString('cars', 'color', 50);
  await ensureString('cars', 'vin', 64);
  await ensureString('cars', 'carType', 30);
  // Singapore / car-specific ownership fields
  await ensureString('cars', 'registrationNumber', 30);
  await ensureString('cars', 'iuNumber', 40);
  await ensureString('cars', 'fuelType', 20);
  await ensureString('cars', 'transmission', 20);
  await ensureString('cars', 'engineCapacity', 30);
  await ensureString('cars', 'coeCategory', 5);
  // Date fields stored as ISO date strings (matches motorcycle collection usage)
  for (const d of ['registrationDate','inspectionDate','nextInspectionDate','roadTaxExpiry',
                   'insuranceExpiry','coeExpiry','seasonParkingExpiry','warrantyExpiry']) {
    await ensureString('cars', d, 30);
  }
  await ensureString('cars', 'insuranceProvider', 100);
  await ensureString('cars', 'insurancePolicyNo', 60);
  await waitForAttributes('cars', ['userId']);
  await ensureIndex('cars', 'idx_userId', ['userId']);
}

async function setupCarItems() {
  await ensureCollection('car_maintenance_items', 'Car Maintenance Items');
  await ensureString('car_maintenance_items', 'carId', 64, true);
  await ensureString('car_maintenance_items', 'userId', 64, true);
  await ensureString('car_maintenance_items', 'partType', 60);
  await ensureString('car_maintenance_items', 'partLabel', 120);
  await ensureInteger('car_maintenance_items', 'intervalKm');
  await ensureInteger('car_maintenance_items', 'intervalDays');
  await ensureInteger('car_maintenance_items', 'lastServiceKm');
  await ensureInteger('car_maintenance_items', 'nextDueKm');
  await ensureString('car_maintenance_items', 'lastServiceDate', 30);
  await ensureString('car_maintenance_items', 'nextDueDate', 30);
  await ensureString('car_maintenance_items', 'serviceStatus', 20);
  await ensureBoolean('car_maintenance_items', 'isCustomInterval');
  await ensureString('car_maintenance_items', 'serviceType', 5);
  await ensureString('car_maintenance_items', 'remarks', 500);
  await waitForAttributes('car_maintenance_items', ['userId','carId']);
  await ensureIndex('car_maintenance_items', 'idx_userId', ['userId']);
  await ensureIndex('car_maintenance_items', 'idx_carId', ['carId']);
}

async function setupCarRecords() {
  await ensureCollection('car_service_records', 'Car Service Records');
  await ensureString('car_service_records', 'carId', 64, true);
  await ensureString('car_service_records', 'userId', 64, true);
  await ensureString('car_service_records', 'maintenanceItemId', 64);
  await ensureString('car_service_records', 'completedBy', 64);
  await ensureString('car_service_records', 'partType', 60);
  await ensureString('car_service_records', 'partLabel', 120);
  await ensureString('car_service_records', 'serviceDate', 30);
  await ensureInteger('car_service_records', 'mileageAtService');
  await ensureFloat('car_service_records', 'cost');
  await ensureString('car_service_records', 'notes', 5000);
  await ensureString('car_service_records', 'recordType', 20);
  await waitForAttributes('car_service_records', ['userId','carId']);
  await ensureIndex('car_service_records', 'idx_userId', ['userId']);
  await ensureIndex('car_service_records', 'idx_carId', ['carId']);
}

(async () => {
  console.log(`Configuring car collections in ${DATABASE} on ${ENDPOINT} (project ${PROJECT_ID})\n`);
  await setupCars();
  await setupCarItems();
  await setupCarRecords();

  console.log('\nVerifying every attribute the app writes exists…');
  await verify('cars', CARS_ATTRS);
  await verify('car_maintenance_items', CAR_ITEM_ATTRS);
  await verify('car_service_records', CAR_REC_ATTRS);

  if (failures.length) {
    console.error('\n✗ Setup INCOMPLETE. Missing/failed: ' + [...new Set(failures)].join(', '));
    console.error('  Re-run this script — it is idempotent and will create only what is missing.');
    process.exit(1);
  }
  console.log('\n✅ Done. All car tracking collections and attributes are ready. You can now add cars.');
})().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exit(1);
});

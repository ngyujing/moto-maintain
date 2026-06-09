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
const API_KEY    = process.env.APPWRITE_API_KEY    || '';

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

async function api(method, path, body) {
  const res = await fetch(`${ENDPOINT}/databases/${DATABASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
  return { ok: res.ok, status: res.status, data };
}

// Permission model mirrors the app's usage: any authenticated user can CRUD,
// and the app scopes everything by userId in its queries (same posture as the
// existing motorcycle collections).
const USER_PERMS = ['create("users")', 'read("users")', 'update("users")', 'delete("users")'];

async function ensureCollection(id, name) {
  const r = await api('POST', '/collections', {
    collectionId: id, name, permissions: USER_PERMS, documentSecurity: false,
  });
  if (r.ok) { console.log(`Created collection "${id}".`); return; }
  if (r.status === 409) { console.log(`Collection "${id}" already exists - skipping.`); return; }
  throw new Error(`create collection ${id} failed [${r.status}]: ${r.data?.message || ''}`);
}

async function ensureString(coll, key, size, required = false) {
  const r = await api('POST', `/collections/${coll}/attributes/string`, { key, size, required });
  logAttr(coll, key, r);
}
async function ensureInteger(coll, key, required = false) {
  const r = await api('POST', `/collections/${coll}/attributes/integer`, { key, required });
  logAttr(coll, key, r);
}
async function ensureFloat(coll, key, required = false) {
  const r = await api('POST', `/collections/${coll}/attributes/float`, { key, required });
  logAttr(coll, key, r);
}
async function ensureBoolean(coll, key, required = false) {
  const r = await api('POST', `/collections/${coll}/attributes/boolean`, { key, required });
  logAttr(coll, key, r);
}
function logAttr(coll, key, r) {
  if (r.ok) console.log(`  + ${coll}.${key}`);
  else if (r.status === 409) console.log(`  = ${coll}.${key} (exists)`);
  else console.warn(`  ! ${coll}.${key} failed [${r.status}]: ${r.data?.message || ''}`);
}

// Wait until the named attributes report status "available" before indexing.
async function waitForAttributes(coll, keys, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const r = await api('GET', `/collections/${coll}/attributes`);
    const list = (r.data?.attributes || []);
    const ready = keys.every(k => { const a = list.find(x => x.key === k); return a && a.status === 'available'; });
    if (ready) return true;
    await new Promise(res => setTimeout(res, 1000));
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
}

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
  console.log('\nDone. Car tracking collections are ready.');
})().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exit(1);
});

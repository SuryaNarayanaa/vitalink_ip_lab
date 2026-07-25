import fs from 'node:fs';
import { OPERATION_IDS as PUBLIC_OPERATION_IDS } from './public-auth-devices/descriptors.js';
import { CLINICAL_OPERATION_IDS } from './clinical/descriptors.js';
import { ADMIN_PLATFORM_OPERATION_IDS } from './admin-platform/descriptors.js';
import { LEGACY_OPERATION_IDS } from './legacy/descriptors.js';

const inventoryPath = new URL('../generated/endpoints.json', import.meta.url);
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

const declared = [
  ...PUBLIC_OPERATION_IDS,
  ...CLINICAL_OPERATION_IDS,
  ...ADMIN_PLATFORM_OPERATION_IDS,
  ...LEGACY_OPERATION_IDS,
];
const duplicates = declared.filter((id, index) => declared.indexOf(id) !== index);
const expected = inventory.explicitEndpoints.map((endpoint) => endpoint.id);
const declaredSet = new Set(declared);
const expectedSet = new Set(expected);
const missing = expected.filter((id) => !declaredSet.has(id));
const extra = declared.filter((id) => !expectedSet.has(id));

const result = {
  mandatoryExplicit: inventory.counts.mandatoryExplicit,
  declared: declared.length,
  publicAuthDevicesOperational: PUBLIC_OPERATION_IDS.length,
  clinical: CLINICAL_OPERATION_IDS.length,
  adminPlatform: ADMIN_PLATFORM_OPERATION_IDS.length,
  legacy: LEGACY_OPERATION_IDS.length,
  missing,
  extra,
  duplicates: [...new Set(duplicates)],
  conditional: inventory.conditionalEndpoints.length,
  derivedProtocolChecks: inventory.derivedProtocolChecks.length,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (
  declared.length !== inventory.counts.mandatoryExplicit
  || missing.length
  || extra.length
  || duplicates.length
) {
  process.exitCode = 1;
}

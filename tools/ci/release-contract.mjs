export const REQUIRED_RELEASE_GATES = [
  'rlsSuite',
  'e2eBuyerJourney',
  'e2eOrderLifecycle',
  'e2eSupplierJourney',
  'e2eConciergeJourney',
  'e2eAdminJourney',
  'storageFlow',
  'mailDelivery',
  'backupRestore',
  'pdResidency',
  'clientEnvironment',
  'liveSupabase',
  'scheduledJobs',
  'authHardening',
];

export function releaseManifestProblems(manifest, strict, expectedSha) {
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) {
    return ['неизвестная или отсутствующая schemaVersion'];
  }
  if (!strict) return [];
  const problems = [];
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? '') || manifest.sourceSha !== expectedSha) {
    problems.push('evidence относится к другому или неизвестному SHA');
  }
  if (manifest.status !== 'ready-for-production') problems.push('статус не ready-for-production');
  for (const key of REQUIRED_RELEASE_GATES) {
    if (manifest.gateSourceShas?.[key] !== expectedSha)
      problems.push(`gate ${key} не привязан к выпускаемому SHA`);
    if (
      typeof manifest.gates?.[key] !== 'string' ||
      !/^passed-(ci|local|staging|production):\s*\S/.test(manifest.gates[key])
    ) {
      problems.push(`не подтверждён обязательный gate ${key}`);
    }
  }
  return problems;
}

export async function isReadyResponse(response, expectedSha) {
  if (
    response.status !== 200 ||
    response.redirected ||
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return false;
  try {
    const body = await response.json();
    return (
      /^[a-f0-9]{40}$/.test(expectedSha ?? '') &&
      body?.ok === true &&
      body?.dependency === 'supabase' &&
      body?.commit === expectedSha
    );
  } catch {
    return false;
  }
}

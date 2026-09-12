const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length === 0) {
  console.log('Live E2E configuration is present.');
  process.exit(0);
}

const message = `Live E2E requires repository secrets: ${missing.join(', ')}.`;
if (process.env.CI) {
  console.error(`::error title=Live E2E is not configured::${message}`);
  console.error(
    'Configure the secrets or keep the always-on public-e2e job as the local smoke check.',
  );
  process.exit(2);
}

console.warn(`Notice: ${message} Running outside CI, so the preflight is non-blocking.`);

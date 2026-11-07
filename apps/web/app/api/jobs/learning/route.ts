import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../lib/cron-auth';
import { completedJobResponse } from '../../../lib/job-response';
import { dispatchLearningEvents } from '../../../lib/learning/dispatcher';
import { logActionFailure } from '../../../lib/server-log';

export const runtime = 'nodejs';

async function run(request: Request) {
  if (!isCronAuthorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await dispatchLearningEvents(10);
    return completedJobResponse('job.learning', result);
  } catch {
    const supportId = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    logActionFailure({
      supportId,
      operation: 'job.learning',
      code: 'internal',
      errorName: 'JobDispatchError',
    });
    return NextResponse.json({ ok: false, error: 'Job failed', supportId }, { status: 503 });
  }
}

export const GET = run;
export const POST = run;

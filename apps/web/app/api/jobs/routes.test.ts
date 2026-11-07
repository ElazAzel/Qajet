import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ learning: vi.fn(), outbox: vi.fn(), log: vi.fn() }));
vi.mock('../../lib/learning/dispatcher', () => ({ dispatchLearningEvents: mocks.learning }));
vi.mock('../../lib/notifications/dispatcher', () => ({ dispatchOutbox: mocks.outbox }));
vi.mock('../../lib/server-log', () => ({ logActionFailure: mocks.log }));

import * as learning from './learning/route';
import * as outbox from './outbox/route';

const PRIVATE = 'E2E-private-provider-payload@example.test';
const request = (job: string, method: string, authorization = 'Bearer E2E-cron-secret') =>
  new Request(`https://E2E-jobs.invalid/api/jobs/${job}`, {
    method,
    headers: { authorization },
  });
const scenarios = [
  { name: 'outbox', route: outbox, dispatch: mocks.outbox, count: 'sent', limit: 20 },
  { name: 'learning', route: learning, dispatch: mocks.learning, count: 'processed', limit: 10 },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CRON_SECRET', 'E2E-cron-secret');
});
afterEach(() => vi.unstubAllEnvs());

for (const job of scenarios) {
  describe(`${job.name} job HTTP boundary`, () => {
    for (const method of ['GET', 'POST'] as const) {
      it.each([
        { name: 'empty', claimed: 0, done: 0, failed: 0 },
        { name: 'success', claimed: 2, done: 2, failed: 0 },
        { name: 'mixed failure', claimed: 2, done: 1, failed: 1 },
        { name: 'all failed', claimed: 2, done: 0, failed: 2 },
      ])(
        `${method} reports $name honestly without requesting a whole-batch retry`,
        async (item) => {
          const errors = Array.from({ length: item.failed }, () => PRIVATE);
          job.dispatch.mockResolvedValue({
            claimed: item.claimed,
            [job.count]: item.done,
            failed: item.failed,
            errors,
            retryUnconfirmed: 0,
            privateUnexpectedField: PRIVATE,
          });
          const response = await job.route[method](request(job.name, method));
          const body = await response.json();
          expect(response.status).toBe(200);
          expect(response.headers.has('retry-after')).toBe(false);
          expect(body).toMatchObject({
            ok: item.failed === 0,
            claimed: item.claimed,
            [job.count]: item.done,
            failed: item.failed,
            retryUnconfirmed: 0,
            errors: errors.map(() => 'job.item_failed'),
          });
          expect(JSON.stringify(body)).not.toContain(PRIVATE);
          expect(body).not.toHaveProperty('privateUnexpectedField');
          expect(job.dispatch).toHaveBeenCalledExactlyOnceWith(job.limit);
          if (item.failed) {
            expect(body.supportId).toMatch(/^[A-F0-9]{8}$/);
            expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
              supportId: body.supportId,
              operation: `job.${job.name}`,
              code: 'batch_failed',
              errorName: 'JobBatchFailure',
            });
          } else {
            expect(mocks.log).not.toHaveBeenCalled();
            expect(body).not.toHaveProperty('supportId');
          }
        },
      );

      it(`${method} rejects unauthorized work before dispatch`, async () => {
        const response = await job.route[method](request(job.name, method, 'Bearer E2E-wrong'));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized' });
        expect(job.dispatch).not.toHaveBeenCalled();
        expect(mocks.log).not.toHaveBeenCalled();
      });

      it(`${method} preserves 503 for an exception without disclosing raw error or retrying`, async () => {
        const failure = new Error(PRIVATE);
        failure.name = PRIVATE;
        job.dispatch.mockRejectedValue(failure);
        const response = await job.route[method](request(job.name, method));
        const body = await response.json();
        expect(response.status).toBe(503);
        expect(response.headers.has('retry-after')).toBe(false);
        expect(body).toMatchObject({ ok: false, error: 'Job failed' });
        expect(body.supportId).toMatch(/^[A-F0-9]{8}$/);
        expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
          supportId: body.supportId,
          operation: `job.${job.name}`,
          code: 'internal',
          errorName: 'JobDispatchError',
        });
        expect(JSON.stringify([body, mocks.log.mock.calls])).not.toContain(PRIVATE);
        expect(job.dispatch).toHaveBeenCalledTimes(1);
      });
    }

    it('fails closed with no configured cron secret', async () => {
      vi.stubEnv('CRON_SECRET', '');
      expect((await job.route.POST(request(job.name, 'POST'))).status).toBe(401);
      expect(job.dispatch).not.toHaveBeenCalled();
    });
  });
}

for (const job of scenarios) {
  for (const method of ['GET', 'POST'] as const) {
    it.each([0, 1])(
      `${job.name} ${method} reports unconfirmed retry even if failed=%i`,
      async (failed) => {
        job.dispatch.mockResolvedValue({
          claimed: 1,
          [job.count]: 0,
          failed,
          retryUnconfirmed: 1,
          errors: [PRIVATE, PRIVATE],
        });
        const response = await job.route[method](request(job.name, method));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(response.headers.has('retry-after')).toBe(false);
        expect(body).toMatchObject({
          ok: false,
          failed,
          retryUnconfirmed: 1,
          errors: ['job.item_failed', 'job.item_failed'],
        });
        expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
          supportId: body.supportId,
          operation: `job.${job.name}`,
          code: 'retry_unconfirmed',
          errorName: 'JobBatchFailure',
        });
        expect(JSON.stringify([body, mocks.log.mock.calls])).not.toContain(PRIVATE);
        expect(job.dispatch).toHaveBeenCalledExactlyOnceWith(job.limit);
      },
    );
  }
}

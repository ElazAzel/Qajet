/** A delayed/hidden browser heartbeat can account for at most one active minute. */
export const MAX_HEARTBEAT_SECONDS = 60;

export function secondsSinceLastHeartbeat(input: {
  startedAt: Date;
  previousEndedAt: Date | null;
  now: Date;
}): number {
  const from = input.previousEndedAt ?? input.startedAt;
  const milliseconds = input.now.getTime() - Math.max(from.getTime(), input.startedAt.getTime());
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;
  return Math.min(MAX_HEARTBEAT_SECONDS, Math.floor(milliseconds / 1000));
}

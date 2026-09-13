/**
 * Public home for the browser heartbeat contract. Keeping the cap and the
 * elapsed-time helper in one module makes it harder for a future client to
 * invent a second, uncapped timer implementation.
 */
export {
  MAX_HEARTBEAT_SECONDS,
  secondsSinceLastHeartbeat,
} from '../active-time';

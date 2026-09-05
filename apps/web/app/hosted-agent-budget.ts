export const HOSTED_CALL_LIMIT = 50;
export const HOSTED_COOLDOWN_MS = 30000;
export const HOSTED_LEASE_MS = 90000;
const budgetId = 'gemini-demo/1';

// Durable, global and atomic across Workers isolates. Failed/uncertain calls are not refunded.
export const RESERVE_SQL = `INSERT INTO agent_budget (id, attempts, next_allowed_at, lease_until)
  VALUES (?, 1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET attempts = attempts + 1,
    next_allowed_at = excluded.next_allowed_at, lease_until = excluded.lease_until
  WHERE attempts < ? AND next_allowed_at <= ? AND lease_until <= ?
  RETURNING attempts, lease_until`;

export async function reserveAgentCall(db: D1Database, now: number) {
  const row = await db.prepare(RESERVE_SQL).bind(budgetId, now + HOSTED_COOLDOWN_MS, now + HOSTED_LEASE_MS, HOSTED_CALL_LIMIT, now, now).first<{ attempts: number; lease_until: number }>();
  if (!row) return null;
  return { remaining: HOSTED_CALL_LIMIT - row.attempts, leaseUntil: row.lease_until };
}
export async function releaseAgentCall(db: D1Database, leaseUntil: number) {
  await db.prepare('UPDATE agent_budget SET lease_until = 0 WHERE id = ? AND lease_until = ?').bind(budgetId, leaseUntil).run();
}
export async function agentCallsRemaining(db: D1Database) {
  const row = await db.prepare('SELECT attempts FROM agent_budget WHERE id = ?').bind(budgetId).first<{ attempts: number }>();
  return Math.max(0, HOSTED_CALL_LIMIT - (row?.attempts ?? 0));
}

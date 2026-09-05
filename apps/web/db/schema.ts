import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// A single durable global budget; no merchant evidence, credentials or user records are stored.
export const agentBudget = sqliteTable('agent_budget', {
  id: text('id').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  nextAllowedAt: integer('next_allowed_at').notNull().default(0),
  leaseUntil: integer('lease_until').notNull().default(0),
});

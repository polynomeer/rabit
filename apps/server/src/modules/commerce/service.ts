/**
 * Commerce service, split by concern (architecture review 2026-10-19). Callers keep
 * importing from here; new code may import the concern's file directly.
 */
export * from './shared.js';
export * from './orders.js';
export * from './events.js';
export * from './refunds.js';
export * from './reconcile.js';
export * from './offers.js';
export * from './subscriptions.js';

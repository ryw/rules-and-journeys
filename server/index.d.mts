// Types for rules-and-journeys/server.
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Anything with node-postgres' query shape, such as a pg Pool or Client. */
export interface Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }
/** The scorer's result (score.json). */
export interface ScoreResult { name?: string; commit?: string | null; scoredAt?: string; score: number; dimensions: Record<string, unknown>; [key: string]: unknown }
type Handler = (req: IncomingMessage & { baseUrl?: string; body?: unknown }, res: ServerResponse, next?: (error?: unknown) => void) => Promise<void>;

/** The tables, in their own schema (default `rj`). Idempotent. */
export function schemaSql(schema?: string): string;
/** Save one scored run; older runs past `keep` (default 500) per project and branch are deleted. */
export function recordRun(db: Queryable, result: ScoreResult, options?: { project?: string; branch?: string; schema?: string; keep?: number }): Promise<{ project: string; branch: string; id: string }>;
/** The reports pages: mount behind your own authentication. */
export function createReports(options: { db: Queryable; schema?: string; defaultBranch?: string; basePath?: string }): Handler;
/** Optional token-protected upload endpoint: POST { project?, branch?, result }. */
export function createIngest(options: { db: Queryable; token: string; schema?: string; maxBytes?: number }): Handler;

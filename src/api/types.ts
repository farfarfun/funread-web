export type SourceType = "book" | "rss";

export interface Source {
  id: number;
  url: string;
  source_type: SourceType;
  source_count: number;
  enabled: boolean;
  consecutive_failures: number;
  last_error: string | null;
  last_success_at: string | null;
  increment_start: number | null;
  increment_stop: number | null;
  last_queried_at: string;
  created_at: string;
  updated_at: string;
}

export interface SourcePage {
  items: Source[];
  total: number;
  limit: number;
  offset: number;
}

export interface CollectReport {
  source_id: number;
  ok: boolean;
  source_count: number;
  error: string | null;
}

-- Security scan results for uploaded research documents. Documents are
-- scanned at upload time: dangerous structures reject the upload outright,
-- while prompt-injection heuristics mark the document as flagged so users see
-- a warning before its text feeds an AI research run.
alter table public.research_documents
  add column if not exists scan_status text not null default 'clean'
    check (scan_status in ('clean', 'flagged')),
  add column if not exists scan_notes text not null default '';

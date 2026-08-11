-- WP-02: required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- pgvector optional until embedding model ADR; enable when local image supports it
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'vector extension unavailable in this environment; continuing without it';
END $$;

CREATE SCHEMA IF NOT EXISTS app;

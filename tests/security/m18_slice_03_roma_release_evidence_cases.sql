\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_refs jsonb;
  v_release jsonb;
  v_formatted text;
BEGIN
  v_refs := app.sanitize_roma_qa_finding_evidence_refs(jsonb_build_array(
    jsonb_build_object(
      'kind', 'release',
      'releaseType', 'pull_request',
      'value', 'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103',
      'url', 'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103',
      'title', 'M18.2 live receipt',
      'citationIds', jsonb_build_array('memory:receipt-1'),
      'privateBody', 'must be removed'
    ),
    jsonb_build_object(
      'kind', 'release',
      'releaseType', 'commit',
      'value', '49d051c436fd2a4fbe9d7f64661edb0b3880aaa0',
      'url', 'javascript:alert(1)',
      'citationIds', jsonb_build_array('memory:receipt-1')
    )
  ));

  IF jsonb_array_length(v_refs) <> 2 THEN
    RAISE EXCEPTION 'expected two bounded release refs, got %', v_refs;
  END IF;

  v_release := v_refs->0;
  IF v_release->>'releaseType' <> 'pull_request'
     OR v_release->>'value' <> 'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103'
     OR v_release->>'url' <> 'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103'
     OR v_release->'citationIds' <> '["memory:receipt-1"]'::jsonb
     OR v_release ? 'privateBody' THEN
    RAISE EXCEPTION 'release ref sanitizer lost required fields or retained private data: %', v_release;
  END IF;

  IF (v_refs->1) ? 'url' THEN
    RAISE EXCEPTION 'unsafe release URL survived sanitizer: %', v_refs->1;
  END IF;

  v_formatted := app.format_roma_qa_finding_evidence_ref(v_release);
  IF v_formatted NOT LIKE '%release pull_request%pull/103%' THEN
    RAISE EXCEPTION 'release ref formatter lost linkage: %', v_formatted;
  END IF;
END;
$$;

ROLLBACK;

\echo m18_slice_03_roma_release_evidence_cases=pass

# M15 Slice 08 - observability and SLOs

Status: implementation slice on top of M15.1–M15.7.

## Goal

Publish the M15 metric catalog (ingestion lag, sync success, routing confidence,
unclassified/duplicate rates, consolidation/search latency, stale projects, dead
letters), suggested production targets, structured-log redaction, and alert
ownership tied to the M14 incident runbook pack.

Official pack version: `m15-s08-v1`

Roadmap sections: `15.8`, `observability-slos`

## In scope

- Metric id catalog + suggested targets
- `evaluateM15Metric` / `evaluateM15MetricSet`
- Metadata-only log field sanitizer (no bodies/tokens)
- Tie-in to M14 runbook pack `m14-s05-v1`
- CURRENT_STATE tip update
- Explicit live dashboard wiring blocker

## Out of scope

- Full production dashboard deployment
- Changing ChatGPT Mode A tools
- Closing live connector credential E2E blockers (remain recorded)

## Definition of Done

- Nine M15 metrics catalogued with suggested targets
- Fixtures evaluate within/without target correctly
- Sensitive fields redact in metric logs
- Live dashboard E2E blocked; catalog PASS
- Mode A remains 7 tools

## Next

`M15-live-e2e-closure` (or M16 if live E2E remains blocked and plan advances)

# M15 Slice 07 - autonomous capture policy

Status: implementation slice on top of M15.1–M15.6.

## Goal

Define what may auto-promote into Memory OS, what must be rejected, and what
requires extraction preview/apply — with optional per-source/per-project
overrides. Fail closed on missing `project_id`.

Official pack version: `m15-s07-v1`

Roadmap sections: `15.7`, `autonomous-capture-policy`

## In scope

- Capture class taxonomy (promote / reject / uncertain)
- `decideCaptureDisposition` + `applyCapturePreview`
- Per-source/project override hooks
- Fixture proofs + CURRENT_STATE tip
- Explicit live chat capture E2E blocker

## Out of scope

- Shipping a full LLM extractor UI
- Live production chat auto-capture E2E
- Observability/SLO pack (M15.8)
- New ChatGPT Mode A tools

## Definition of Done

- High-confidence safe classes auto-promote; secrets/chatter reject
- Uncertain / below-floor cases require preview/apply
- Overrides can force preview for a source/project
- Live E2E blocked; policy fixtures PASS
- Mode A remains 7 tools

## Next

`M15.8-observability-slos`

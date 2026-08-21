# M15 Slice 03 - automatic project / entity routing

Status: implementation slice on top of M15.1–M15.2.

## Goal

Add a deterministic, fail-closed project router: low-confidence or conflicting
signals go to `UNCLASSIFIED` — never a default/`MEMORY_OS_DEFAULT_PROJECT_ID` /
AISTROYKA fallback.

Official pack version: `m15-s03-v1`

Roadmap sections: `15.3`, `automatic-project-entity-routing`

## In scope

- Official routing pack + `resolveProjectRoute`
- Signal kinds: explicit project id, source mapping, collection binding, entity
  alias, recent context
- Confidence threshold + explanation/provenance
- Golden routing fixture (>=20 cases) with precision target >=95%
- CURRENT_STATE / README / drift tip update

## Out of scope

- Full entity graph (M17)
- Live connector auto-learning of bindings from production traffic
- Changing ChatGPT Mode A tool count
- Silent default project writes
- Freshness engine (M15.5)

## Definition of Done

- Conflicting / low-confidence / missing signals route to `UNCLASSIFIED`
- Golden fixture precision >= 0.95
- No default-project fallback advertised or applied by the router
- Mode A remains 7 tools

## Next

`M15.4-canonicalization-dedupe-supersession`

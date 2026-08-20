# M13 Slice 06 - versioned ranking weights

Status: implementation slice on top of M13 Slice 05 personalized importance.

## Goal

Make the learned-ranking feature space explicit as one additive, versioned weight
pack evaluated on the existing golden retrieval dataset, without introducing a
training loop, widening ACL, or writing new verified truth.

## In scope

- Reuse the existing retrieval stack:
  - lexical search + hybrid RRF in `packages/retrieval`
  - existing `POST /v1/search`
  - existing MCP `memory.search`
  - existing golden retrieval eval in `tests/eval/golden_retrieval.*`
- Add one official, versioned ranking-weights pack in `packages/retrieval`:
  - lexical/vector rank mix
  - status authority
  - conflict/dispute penalty
  - importance
  - pin score multiplier
  - recency
- Keep project match, temporal validity, and ACL visibility as hard filters rather
  than score bypasses.
- Bump ranking reproducibility metadata:
  - ranking version `hybrid-rrf+m13-s06-v1`
  - ranking weights version `m13-s06-v1`
- Surface the weights version on existing search responses for reproducibility.
- Prove stability and safety with tests:
  - explicit default pack keeps unpersonalized golden ordering stable
  - alternative packs do not widen ACL or leak hidden memories
  - ChatGPT Mode A stays at exactly 7 tools
  - no AISTROYKA fallback is introduced on bounded agentic retrieval
  - no verified write path is added

## Out of scope

- Training, fitting, or auto-tuning a model
- New ML dependencies
- New UI surfaces
- New ChatGPT Mode A tools
- Graph / Graphiti work
- Calendar / Apple / new connector families
- More personalization scopes or policy changes
- Owner-token bypasses
- Production SQL apply
- New ranking-admin or weight-write APIs

## Notes

- Slice 05 personalization remains the same contract and still applies after ACL.
- Pins remain a post-ACL ordering rule; the new weight pack only makes the score
  features explicit and versioned.
- No SQL migration is required for this slice because the official weight pack is
  code-defined and evaluated offline on the existing golden corpus.

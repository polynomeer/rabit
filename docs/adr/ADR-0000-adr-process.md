# ADR-0000: ADR process and numbering

- Status: Accepted
- Date: 2026-10-04
- Deciders: Tech lead (Claude, delegated by product owner)
- Related: CNF-17, AP-15 §ADR 작성 방식

## Context
The source planning set (AP-15) lists 18 decision topics as `ADR-01..18`, all `proposed`. The playbook expects `docs/adr/ADR-xxxx-*.md` files. The two numbering schemes conflict (CNF-17).

## Decision
- Use four-digit `ADR-NNNN` files in `docs/adr/`. Numbers are assigned in creation order and never reused.
- Keep the source topic ID (`ADR-nn`) in the index and in each ADR's header so traceability to AP-15 is preserved.
- Use the section template and status lifecycle described in [README](README.md).
- A decision that Playbook §9 reserves for humans stays **Proposed** even when an analysis and recommendation exist. Implementations behind such a decision use an abstraction with a provisional default that is documented in the ADR.

## Consequences
Source topics may map to several ADRs, or one ADR may cover parts of several topics; the index records the mapping.

## Revisit trigger
A tooling change (e.g. adopting an ADR tool with its own numbering).

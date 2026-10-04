# ADR-0011: Web reference client for MVP; native platforms pending Q06

- Status: Accepted (web reference client) / **Proposed (production platforms)**
- Date: 2026-10-04
- Related: Q06, A03, PLY-001, NFR-A11Y-*, BRD

## Context
Supported devices and offline scope (Q06) are a product decision. The MVP still needs a client to verify the unified player, mixed library and DIG UX end to end.

## Decision
- Build a **web reference client** (`apps/web`: Vite, React, TypeScript, hls.js; Safari uses native HLS) that consumes only the public API. It is a verification and design-iteration surface, not a platform commitment.
- Apply brand working tokens (BRD §3) as CSS variables and the accessibility NFRs (keyboard operation, non-color status, reduced motion, list alternative for the DIG graph).
- **Proposed**: native iOS/Android, desktop, offline (P2), and whether production web is the same codebase.

## Revisit trigger
Q06 decision.

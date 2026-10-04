# Rabit Roadmap

- 상태: Phase 2 (2026-10-04). 순서는 의존 관계이며 달력 일정이 아닙니다(AP-02).
- 범위 정본: [mvp-scope.md](../01-requirements/mvp-scope.md)

## 1. 트랙

| 트랙 | 내용 | 진행 조건 |
|---|---|---|
| **Build (P0)** | Engineering bootstrap → Private Audio slice → Audio Log → Library/Playlist/Entitlement → DIG MVP → Search → 기본 Integrity | Phase 3–9 설계 문서 완료 |
| **Commercial Gate (P1)** | 카탈로그 계약, 결제 제공자, 가격·세금, 주문·원장, 구매 다운로드, 공개 Studio 릴리스·판매자 | Q02, Q04, Q05, Q07, ADR-06 결정 (사람) |
| **Trust Gate (P1)** | AI 필터 모드, Human Verified 기준, 공개 Trail/Crate 모더레이션 | Q08, CNF-08, OQ-DIG-07 (사람) |
| **Expansion (P2)** | DIG V1–V3, Music Atlas, 위치, Semantic Audio, Studio SaaS, Collection | P0 운영 데이터, Q09–Q13 |
| **Research (P2)** | Personal Acoustic, Adaptive Mastering, Perceptual ABR, Transition, Stems | Q14, 실험 gate |

## 2. Build 트랙 순서 (Playbook Phase 매핑)

| 단계 | Playbook | 산출물 | Exit criteria |
|---|---|---|---|
| B0 설계 | Phase 3–9 | ADR, domain model, ERD, API contract, threat model, rights model, audio pipeline | Gate: AudioObject/Asset/Entitlement/Rights/Visibility/Provenance 독립 개념; P0 threat mitigation 정의 |
| B1 Bootstrap | Phase 10 | 로컬 환경, lint/typecheck/test, migration, storage/queue, logging, health, CI | clean clone에서 전 검사 통과 |
| B2 Private Audio | Phase 11 | upload intent → finalize → processing → library → playback → delete | AC-01, AC-04 negative tests |
| B3 Audio Log | Phase 12 | AudioObject kind=audio_log, 메타데이터, 통합 재생 | LOG-008 |
| B4 Library/Playlist/Entitlement | Phase 13 | 혼합 playlist, catalog fixture, rights/entitlement 재평가, 권리 철회 | 필수 negative tests (entitlement 위조, rights withdrawal, concurrent edit, deleted item) |
| B5 DIG MVP | Phase 14 | Rabbit Hole, Credits Digging, Deep Cut, Trail | P0 exit criterion 5 |
| B6 Search | Phase 15 | 기본 검색 + private owner scope | private 누출 negative test |
| B7 Integrity 기본 | Phase 16 | Passport 기본, 축 분리, 신고 접수 | ML score 비노출, verification 표시 분리 |
| B8 설계 확장 | Phase 17–19 | Atlas spec, 고급 playback 연구, MIR 설계 | 문서만 |
| B9 운영·품질 | Phase 20–22 | SLO, runbook, test strategy, baseline 측정 | baseline 수치 기록 |
| B10 감사 | Phase 23–24 | release readiness, 독립 코드 리뷰 | Blocker 목록 |

## 3. Commercial Gate 해소 시 추가될 작업 (P1)

1. ADR-06 결정 → 결제 제공자 어댑터, webhook 검증, Order/OrderItem/PaymentEvent, 복식부기 원장, outbox 기반 entitlement 발급 (COM-002–008, COM-018)
2. Q05 결정 → download session, 재다운로드 정책 (COM-011)
3. Q02 결정 → 실제 카탈로그 ingest, 국가별 RightsGrant (CAT-001)
4. Q07 결정 → Studio 공개 흐름·심사·판매자 onboarding (STU-003/005–007/009)

## 4. 이 로드맵에서 사람이 결정해야 하는 것

[open-questions.md](../00-product/open-questions.md)의 `open` 항목 전체. 특히 Build 트랙 진행 중 다음은 **잠정값으로 구현하고 ADR에 provisional로 기록**하며, 운영 전 사람이 확정합니다: 무료 한도(Q03), codec ladder(ADR-04), 지원 기기(Q06), 클라우드/CDN 공급자.

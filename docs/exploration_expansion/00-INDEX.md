# Rabit Music Exploration Expansion — 문서 인덱스

상태: **제안 / 승인 전**, 작성일 2026-10-25. 기준: polynomeer/rabit `main`의 README, 기존 DIG/Atlas 명세 및 도메인 경계 검토. 이 패키지는 기존 PRD를 대체하지 않으며 **추가 기능에 관한 변경 제안**입니다. 저장소에 반영하거나 실제 서비스를 변경하지 않았습니다.

## 읽기 순서
1. `01-product-strategy.md` 제품 목표, 기존 기능 연계, 성공 지표
2. `02-prd-requirements.md` 요구사항, 우선순위, 수용 기준
3. `03-ux-flows.md` 정보 구조, 화면/상태, 접근성
4. `04-domain-architecture.md` bounded context, 권한, 데이터 흐름
5. `05-data-model.md` 엔터티·관계·시간적 정확성·마이그레이션
6. `06-api-contract.md` 신규 API 초안, 오류/페이지네이션
7. `07-recommendation-game.md` 탐색·추천·게임화 규칙
8. `08-data-rights.md` 출처, 라이선스, 재생 권한, 개인정보
9. `09-delivery-plan.md` 증분 출시, 이슈 백로그, 테스트 계획
10. `10-decisions-risks.md` ADR 초안, 미결정, 위험 관리
11. `11-validation-research.md` UX 연구, 실험 설계, 분석 이벤트
12. `12-plan-review.md` 현재 코드 기준 검토·추가 기획·결정 권장안 (2026-10-26)
13. `13-technical-design.md` 현재 스키마·모듈에 맞춘 기술 설계 (E0, E1 개요)
14. `14-design-mockups.md` 디자인 캔버스 시안 목록 (웹 라이트·다크, iOS)

## 기존 저장소의 중요 기준
- `docs/01-requirements/prd.md`: 요구사항 ID 체계, 법무/지연/확정 구분.
- `docs/01-requirements/mvp-scope.md`: 기존 P0 MVP 확정. 이 확장안이 이를 자동으로 변경하지 않음.
- `docs/03-architecture/dig.md`: Rabbit Hole, Dig Trail, 근거 기반 관계, Label Timeline, Crate/Blind DIG.
- `docs/03-architecture/music-atlas.md`: Atlas P2 설계, 지역·청취차트 구분, 위치정보 최소화.
- `docs/03-architecture/domain-boundaries.md`: 모듈별 테이블 소유, 공유 정책 `playback.evaluatePolicy`.
- `docs/04-data/erd.md`, `docs/05-api/openapi.yaml`, `apps/server/src/modules/dig/`.
- `apps/web/src/dig.tsx`, `apps/ios/Rabit/Features/DigView.swift` 등 기존 클라이언트.
- 기존 `DIG_music_discovery_PRD.docx` 및 브랜드 가이드 원본은 수정 금지.

## 제안하는 문서 반영 위치
`docs/proposals/music-exploration-vnext/` 아래 본 패키지 파일 배치. 승인 후 PRD ID 등록, ADR Accepted, OpenAPI 변경, migration 순으로 동기화합니다.

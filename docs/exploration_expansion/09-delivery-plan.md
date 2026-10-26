# 실행 로드맵, 이슈 백로그, 테스트

기존 저장소의 P0/P1/P2를 변경하지 않고, 별도 **E0/E1/E2** 실험 레인으로 제안합니다. 실제 우선순위 반영은 PO 승인 이후입니다.

## E0 — 데이터·UX 실험(4–6주 가정, 팀 구성에 따라 변동)
- EX-01: `exploration_context` / date precision 설계 spike 및 ADR; 불확실 날짜 제외 규칙 테스트.
- EX-02: DIG 기존 trail에서 시간/지역 context 저장·복원 설계 및 웹 화면.
- EX-03: Artist Journey read model (앨범 연대기) 및 웹/iOS thin UI.
- EX-04: fixture 기반 Time Radio (licensed demo catalog만) + 공통 재생권 재검사.
- EX-05: UX 비교 실험: 기존 DIG 목록 vs 타임라인, 첫 재생·저장·재방문.
- EX-06: 접근성/국제화/노데이터 상태/권리 negative test.
- EXIT: 미래 발매작 누출 0, rights bypass 0, cohort 내 유효 탐색 지표 수집, 모바일 사용성 확보.

## E1 — 검증된 탐험 확장
- EX-07: 지역 taxonomy/link 모델 및 지도/목록 전환.
- EX-08: 라이선스 확보 후 외부 역사 차트 ingestion + 출처 UI.
- EX-09: 큐레이션 컬렉션과 진척률 계산/도감.
- EX-10: quest engine + proof events + anti-farming, 옵트아웃.
- EX-11: 180일 잊힌 음악 추천 + 나의 음악 타임라인 (동의/삭제).
- EX-12: 당시/현대 정보 모드(공개 시점 메타데이터 확보 후).
- EXIT: 차트 수급·출처 검증, 공개 가능한 분모/버전, XP 중복 없음, 계정 삭제 전파.

## E2 — 장기 확장
- EX-13: 아티스트 병렬 타임라인 + 앨범 A/B 비교.
- EX-14: 지역/시대 실시간 역사 진행 및 상태 캐시.
- EX-15: Relation Graph spatial+temporal filters.
- EX-16: 장기 캠페인/에디토리얼 CMS/분기.
- EXIT: 검색 품질/성능, 역사 정확성 정성 리뷰, 콘텐츠 지속 운영 비용 검증.

## 기존 코드 접점
`apps/server/src/modules/dig/service.ts`, `connections.ts`, `routes.ts`; `catalog` 엔터티; `playback` policy & listening events; `library`; `apps/web/src/dig.tsx`, `labels.tsx`, `route.ts`, `player.tsx`; iOS `DigView.swift`, `DiggingModes.swift`, `LabelTimelineView.swift`, RabitKit `Dig.swift`/`Playback.swift`. DB migration 및 `docs/05-api/openapi.yaml` 계약 업데이트는 각 기능과 같은 PR에서 수행합니다.

## 최소 테스트 행렬
1. 1984-01-01 발매작은 1983-12-31 cutoff에 절대 등장하지 않음.
2. 발매일 연도만 1983인 음반은 1983-06-15 cutoff에서 보수적으로 제외.
3. 미국 origin 아티스트의 일본 차트 등재는 일본 제작자로 잘못 표시되지 않음.
4. 1983 Tokyo 탐색은 사용자의 KR license_country를 변조하지 않음.
5. 라이선스 철회 시 time-radio 후보 캐시가 있어도 신규 플레이 세션 거부.
6. 신뢰할 수 없는 음악 연결은 verified로 승격되지 않음.
7. 본인 탐험 경로/퀘스트/청취 기록만 조회 가능; 타 계정 404.
8. client replay/다중 탭으로 XP 중복 지급 불가.
9. 0건·차트 삭제·공급자 장애 시 허구의 랭킹 대신 명시적 상태.
10. 계정 삭제/export에서 새 데이터 모두 포함; outbox race 테스트.
11. 다국어·VoiceOver·키보드·reduced motion 및 지도 없는 동일 경로.
12. 테스트 fixture 외 상용 음원 없는 환경에서도 탐색 정보와 재생 불가 상태를 구분.

## 검증 명령(코드 변경 후)
`pnpm verify -- --quick` → 서버 테스트(실 Postgres/SeaweedFS) → `pnpm verify` → `pnpm e2e:local` → `pnpm ios:check` 및 Xcode CI. 현재 문서 패키지는 코드 수정이 없으므로 통과를 주장하지 않습니다.

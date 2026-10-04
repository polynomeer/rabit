# Rabit Non-Functional Requirements

- 상태: Phase 1 정규화 초안 (2026-10-04)
- 기능 요구사항은 [prd.md](prd.md), 상태값(Confirmed/Proposed/Open/Legal/Deferred)과 출처 약어도 prd.md §0과 같습니다.
- **수치 목표는 모두 원문의 설계 제안입니다.** 지원 지역·기기·네트워크·공급자·부하가 확정된 뒤 승인합니다(AP-13). 법정 기간이 아닙니다(AP-08).
- ID 형식: `NFR-<CATEGORY>-<NNN>`.

| Category | 범위 |
|---|---|
| SEC | 인증·인가·암호화·입력 신뢰·감사 |
| PRV | 개인정보·위치·동의·보존·삭제 |
| REL | 가용성·SLO·복구·장애 시 동작 |
| PERF | 지연·처리량 목표 |
| DATA | 정합성·멱등성·이벤트·버전 |
| API | API 공통 계약 |
| OBS | 관측성·로그 정책 |
| ARCH | 아키텍처 제약·과설계 금지 |
| COST | 원가 통제 |
| A11Y | 접근성 |
| UX | 브랜드·제품 UI 원칙 |
| QA | 테스트·품질 게이트 |

## 1. SEC — Security

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-SEC-001 | RBAC(역할: Anonymous, Listener, Studio viewer/editor/publisher, Workspace owner, Moderator, Rights operator, Finance, Service worker)에 소유·workspace·visibility·지역·사용권·상태의 ABAC를 결합한다 | AP-08 §접근 통제 | Proposed |
| NFR-SEC-002 | 클라이언트가 user_id·owner·role·권리 검토 상태·소유권·구독·지역·entitlement를 지정하거나 주장할 수 없다 | AP-07, CLAUDE.md | Confirmed |
| NFR-SEC-003 | 업로드된 오디오·metadata·전사는 비신뢰 입력이다. 파일 디코더는 CPU·메모리·시간 제한과 네트워크 차단된 격리 환경에서 실행하고 fuzzing으로 검증한다 | AP-06, AP-08 | Confirmed (CLAUDE.md) / Proposed (방식) |
| NFR-SEC-004 | origin은 public access를 차단하고, 저장·전송 암호화와 KMS key 회전을 제공한다. 개인 source는 최소 workspace별 key scope, 증빙은 분리 key와 제한 role | AP-08 | Proposed |
| NFR-SEC-005 | 서버 semantic 분석을 하는 개인 오디오를 종단간 암호화(E2EE)라고 광고하지 않는다. E2EE·on-device 분석은 별도 ADR | AP-08, ADR-16 | Proposed |
| NFR-SEC-006 | storage key·signed URL을 인가 수단으로 쓰지 않는다. 파일 접근을 단순 public object URL로 만들지 않는다 | PB Phase 6/11, AP-06 | Confirmed (PB) |
| NFR-SEC-007 | MFA는 사용자 옵션, 관리자 필수. 세션 회수·알림·rate limit | AP-08 | Proposed |
| NFR-SEC-008 | public 릴리스 승인과 지급정보 변경에 직무 분리와 높은 권한 MFA를 적용한다 | AP-08, AP-12 | Proposed |
| NFR-SEC-009 | 내부자·정산 변경 대응: 변경 승인, immutable 감사 로그, 정기 권한 검토 | AP-08 | Proposed |
| NFR-SEC-010 | 전사·metadata 내 명령을 따르지 않고 LLM에 tool 권한을 주지 않는다 (음성 prompt injection) | AP-08, AP-10 | Proposed |
| NFR-SEC-011 | auth·권리 검사·검증·rate limit·감사 로그를 테스트 통과 목적으로 약화하지 않는다 | CLAUDE.md | Confirmed |
| NFR-SEC-012 | 결제 webhook은 제공자 서명·timestamp·replay 방지·금액/통화 대사로 보호한다 | AP-07, AP-08 | Proposed |
| NFR-SEC-013 | 인증 공급자: managed OIDC 후보. custom auth 구현 금지 | AP-07, ADR-02, PB §10 | Open (ADR-02) |

## 2. PRV — Privacy, Location, Consent, Retention

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-PRV-001 | 정확한 위치는 민감 정보다. GPS 원본·주변 원음은 서버에 저장하지 않고 기기에서 일시 처리 후 폐기한다 | AP-08, CLAUDE.md, PB 원칙 8 | Confirmed |
| NFR-PRV-002 | region_id와 계정/IP가 결합되면 개인 위치 정보가 될 수 있으므로 "익명"이라고 표현하지 않는다. 지역 조회 접근 로그에 user_id와 region을 함께 오래 보관하지 않는다 | AP-08 | Proposed |
| NFR-PRV-003 | 차트 입력은 집계 목적 pseudonym과 coarse region만. k-anonymity만으로 충분하다고 보지 않고 고정 snapshot·small-cell 억제·조회 제한·필요 시 노이즈 | AP-08, AP-10 | Proposed |
| NFR-PRV-004 | 동의는 목적별로 분리·버전 관리(Consent: purpose, version, granted/withdrawn, precision). OS 권한 ≠ 서비스 동의 | AP-05, AP-08 | Proposed |
| NFR-PRV-005 | 보존 기간 제안: 개인 원본·Audio Log = 계정·보관 정책 유지 동안 / 전사·벡터·파형 = 원본·동의 수명 이하 / 개인 coarse Context = 동의 기간 / 지역 집계 입력 30–90일 / 청취 원시 이벤트 90일 / 보안 로그 30–90일 / 실물 증빙 결정 후 30일 / 주문·세무·원장 = 국가별 법정 기간 / 백업 35일 회전 | AP-08 §보존 | Legal (법정 기간 확정 전 임의 확정 금지) |
| NFR-PRV-006 | 삭제 목표 제안: 접수 즉시 신규 접근 거부, 24시간 이내 active 원본·검색·CDN 삭제, 회전 백업 35일 이내 만료. 백업 복원 시 삭제 목록 재적용, "즉시 완전 삭제" 주장 금지 | AP-08, AP-13 | Proposed |
| NFR-PRV-007 | private 원본·전사를 전체 추천·모델 학습에 쓰지 않는 것이 기본이다. 동의 철회·삭제가 feature store·vector·평가 데이터에 전파된다 | AP-08, AP-10 | Proposed |
| NFR-PRV-008 | 외부 ASR/LLM 사용 시 데이터 지역·재사용 금지·삭제·로그 정책과 계약을 확인한다. 국외 이전은 법률 검토 | AP-08, ADR-17, Q13 | Legal |
| NFR-PRV-009 | 처리 목적·수탁사·국외 이전·보존·삭제·이용자 권리를 고지한다 | AP-08 | Legal |
| NFR-PRV-010 | 개인정보 사고: 자료 격리 → 자격 회수 → 로그 보존 → 영향 평가 → 법정 통지 검토 → 복구 → 재발 방지. 통지 기한은 국가별 법률 확인, 임의 숫자 금지 | AP-08 | Legal |
| NFR-PRV-011 | 미성년자, 건강 관련 acoustic 정보, 타인 녹음 정책을 출시 전 확정한다 | AP-08 | Open (Q01) |
| NFR-PRV-012 | 사용자 통제 데이터는 export·삭제 semantics를 가진다 | PB invariant 12 | Confirmed |

## 3. REL — Reliability & SLO

| ID | Requirement | SLI 정의 | 30일 목표 (제안) | Source | Status |
|---|---|---|---|---|---|
| NFR-REL-001 | 핵심 API 가용성 | 유효 인증·입력의 정상 처리, 시간 초과 포함 | 99.9% (오류 예산 ≈ 43.2분) | AP-13 | Proposed |
| NFR-REL-002 | playback session 발급 | 권한 유효 요청의 성공, 서버 실패 포함 | 99.95% | AP-13 | Proposed |
| NFR-REL-003 | 결제 fulfillment | 검증 webhook 저장 → 권한 활성 | p95 ≤ 60초 | AP-13 | Proposed |
| NFR-REL-004 | 권리 긴급 취소 전파 | 신규 거부 즉시, CDN·활성 세션 차단 | ≤ 60초 | AP-13, ADR-05 | Proposed |
| NFR-REL-005 | 삭제 | 접수 즉시 차단, active 파생물 제거 | 24시간 이내 | AP-13 | Proposed |
| NFR-REL-006 | 지역 차트 갱신 | daily snapshot window와 표시 시각 일치 | 24시간 내 또는 지연 표시 | AP-13 | Proposed |
| NFR-REL-007 | private 유출과 원장 불일치는 백분율 오류 예산으로 허용하지 않는다 (0건 목표) | — | — | AP-13 | Confirmed (AP-00 출시 차단 조건) |
| NFR-REL-008 | RPO: 거래 DB ≤ 5분, 원본은 업로드 확정 전 durable 저장 검증. RTO: 핵심 API ≤ 4시간. 결제 이벤트는 provider 재조회·대사로 누락 복구 | — | — | AP-13 | Proposed |
| NFR-REL-009 | 권한 서비스·결제 확인 실패 시 신규 권한 fail closed. 검색·ML 장애는 기본 검색·Original 재생으로 축소. cache로 오래된 entitlement를 무기한 연장하지 않는다 | — | — | AP-06 | Proposed |
| NFR-REL-010 | 발급된 media 자격 만료는 취소 목표(60초)보다 길 수 없다. 이미 버퍼된 데이터·DRM 없는 구매 파일은 취소 지표에서 별도 한계로 보고 | — | — | AP-13 | Proposed |
| NFR-REL-011 | 원본 checksum 검사와 복원 drill, 삭제 drill, CDN 취소 drill을 정기 실행한다 | — | — | AP-06, AP-13 | Proposed |
| NFR-REL-012 | 오디오 재생 품질과 안정성을 기능 수보다 우선한다 | — | — | PB 원칙 10, invariant 10 | Confirmed |

## 4. PERF — Performance

| ID | Requirement | 목표 (제안) | Source | Status |
|---|---|---|---|---|
| NFR-PERF-001 | 재생 시작(선택 → audible frame, client 측정, 정상 지원망) | p95 ≤ 2초 | AP-13 | Proposed |
| NFR-PERF-002 | rebuffer ratio (stall 시간 / 실제 청취 시간) | ≤ 0.5% | AP-13 | Proposed |
| NFR-PERF-003 | 업로드 처리 (정상 10분 이하 파일 uploaded → ready) | p95 ≤ 5분 | AP-13 | Proposed |
| NFR-PERF-004 | 기본 검색 end-to-end | p95 ≤ 500ms | AP-13 | Proposed |
| NFR-PERF-005 | semantic 검색 (근거 결과 또는 정상 unknown) | p95 ≤ 2초 | AP-13 | Deferred (M2) |
| NFR-PERF-006 | 규모 가정 A04: 10,000 MAU, 1,000 peak 동시 청취, 평균 192kbps → 오디오 egress ≈ 192Mbps. sizing 예시이지 수요 예측이 아니다 | — | AP-06, AP-15 | Proposed (가정) |
| NFR-PERF-007 | 최적화 전 baseline을 측정하고, 가정 사용자 수(10k/100k/1M)를 실제 측정값과 분리해 명시한다 | — | PB Phase 22 | Confirmed (PB) |

## 5. DATA — Data Integrity, Idempotency, Events

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-DATA-001 | 관계형 DB가 주문·권리·계정·삭제·권한의 정본이며 검색 인덱스는 복구 가능한 파생 자료다 | AP-05, AP-06 | Proposed |
| NFR-DATA-002 | 이벤트는 transactional outbox로 발행하고 queue는 at-least-once를 가정한다. handler는 event_id·작업 key로 멱등 처리. 시스템 전반 exactly-once를 약속하지 않는다 | AP-06, ADR-18 | Proposed |
| NFR-DATA-003 | 모든 background job은 idempotency/deduplication과 retry semantics를 가진다. 반복 실패는 지수 backoff 후 DLQ, 운영 콘솔 재처리 | CLAUDE.md, AP-06 | Confirmed (원칙) / Proposed (방식) |
| NFR-DATA-004 | 이벤트 envelope: schema_version, correlation_id, occurred_at, subject_id, workspace_id, privacy_scope. 음성·전사 원문·결제정보를 메시지에 넣지 않는다 | AP-06 | Proposed |
| NFR-DATA-005 | 순서가 필요한 상태는 version 검사로 이전 이벤트가 새 상태를 되돌리지 않게 한다. 소비자는 알려지지 않은 필드를 무시하고 breaking change는 새 버전 | AP-06, AP-07 | Proposed |
| NFR-DATA-006 | 금액은 정수 minor unit + currency. 원장 통화별 균형 | AP-05, AP-07 | Proposed |
| NFR-DATA-007 | 영속 스키마 변경은 migration과 rollback을 고려한다. destructive migration은 명시적 승인 없이 수행하지 않는다 | CLAUDE.md, PB §6 | Confirmed |
| NFR-DATA-008 | 원본 checksum, 변환 도구 버전, 모델 버전, 계약·상품·동의 버전을 기록한다 | AP-05 | Proposed |
| NFR-DATA-009 | `0 <= start_ms < end_ms <= duration_ms`를 검증하고 모델 재분석이 수동 편집본을 덮어쓰지 않는다 | AP-05 | Proposed |
| NFR-DATA-010 | Audio binary는 DB에 넣지 않는다. 원본은 객체 저장소, 텍스트·vector는 파생 인덱스, 청취 집계는 분석 저장소 | AP-05, PB Phase 5 | Proposed |
| NFR-DATA-011 | 대용량 ListeningEvent는 날짜 파티션과 event_id 중복 방지 | AP-05 | Proposed |

## 6. API — Common API Contract

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-API-001 | HTTPS `/v1`, OAuth/OIDC Bearer, JSON UTF-8 | AP-07 | Proposed |
| NFR-API-002 | 시간은 RFC3339 UTC, 사용자 당시 시간대는 별도 필드. ID는 불투명 문자열. 구간은 ms | AP-07 | Proposed |
| NFR-API-003 | 목록은 `limit` 1–100, opaque cursor, `next_cursor` | AP-07 | Proposed |
| NFR-API-004 | 결제·업로드 완료·공개 요청에 `Idempotency-Key`. 사용자·operation 범위로 최소 24시간 보존. 같은 key 다른 body는 409 | AP-07 | Proposed |
| NFR-API-005 | 갱신은 ETag/If-Match로 충돌 검출 | AP-07 | Proposed |
| NFR-API-006 | 오류 envelope `{error:{code, message, request_id, retryable}}`. 내부 계약·개인정보를 message에 노출하지 않는다 | AP-07 | Proposed |
| NFR-API-007 | 상태 코드: 400/401/403(허용 대상의 권한 부족)/404(비공개 존재 보호)/409/413/422/429/503 | AP-07 | Proposed |
| NFR-API-008 | fingerprint·storage key·owner_workspace_id 등 내부 정보는 외부 응답(특히 타 계정 공개 조회)에서 제외 | AP-05 | Proposed |
| NFR-API-009 | 비동기 접수(202)와 작업 완료를 응답에서 명확히 구분한다 | AP-07 | Proposed |
| NFR-API-010 | 새 API는 테스트와 API 문서를 동반하고, public API 변경은 spec을 먼저 갱신한다. breaking public API는 사람이 결정 | CLAUDE.md, PB §3/§9 | Confirmed |
| NFR-API-011 | 엔드포인트별 JSON Schema, OAuth scope, nullable·enum·최대 길이, rate limit, contract test를 구현 전 확정 | AP-07 | Proposed |

## 7. OBS — Observability

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-OBS-001 | request_id·trace_id·job_id·session_id로 API → DB → queue → worker → CDN 발급 → 청취를 연결한다 | AP-13 | Proposed |
| NFR-OBS-002 | 로그에 private 파일명·전사·GPS·signed URL·결제 token을 남기지 않는다. account id는 제한된 가명 | AP-13 | Proposed |
| NFR-OBS-003 | 지역·곡 등 고카디널리티 값을 무제한 metric label로 쓰지 않는다 | AP-13 | Proposed |
| NFR-OBS-004 | 대시보드 영역: 재생(성공·TTFP·buffer·codec fallback), upload(queue·실패·DLQ·원가), search(ACL·index lag), 권리(캐시·취소 lag), 주문·원장·지급 대사, 비용(storage·CDN·GPU), 차트(표본·fraud 제외), moderation(backlog·appeal) | AP-13 | Proposed |
| NFR-OBS-005 | synthetic 계정은 허가된 test 음원만 쓰고 정산·차트에서 제외 | AP-13 | Proposed |
| NFR-OBS-006 | critical path는 metrics/logs/traces와 명시적 실패 동작을 가진다. alert는 사용자 영향과 연결한다 | CLAUDE.md, PB Phase 20 | Confirmed |
| NFR-OBS-007 | 공급자 장애를 임의 제외하지 않고 내부·외부 원인을 구분해 보고. 작은 표본은 백분율과 절대 건수 병기 | AP-13 | Proposed |

## 8. ARCH — Architecture Constraints

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-ARCH-001 | 초기에는 처음부터 microservices를 선택하지 않는다. 모듈형 백엔드 + 별도 비동기 오디오 worker를 제안하며 모듈 경계를 명확히 해 향후 분리 가능하게 한다 | AP-06, ADR-01, PB Phase 3 | Proposed (ADR-01) |
| NFR-ARCH-002 | 일반 API 제어 경로(control plane)와 오디오 바이트 전달 경로(data/media plane)를 분리한다 | AP-06, PB Phase 3 | Proposed |
| NFR-ARCH-003 | graph DB·vector DB는 실제 쿼리·운영비가 정당화되고 Accepted ADR이 있을 때만 도입한다. 그래프는 관계 테이블로 시작 | AP-05, DIG §7, PB Phase 3/14 | Proposed (ADR-08) |
| NFR-ARCH-004 | 과설계 금지: Kafka(증거 없이), 전면 event sourcing/CQRS, 자체 DRM/codec, ingest critical path의 동기 ML, premature multi-region active-active, 근거 없는 sharding | PB §10 | Confirmed (PB) |
| NFR-ARCH-005 | 고급 stem/semantic 분석을 blocking ingest path에 넣지 않는다 | AP-06, PB Phase 9 | Confirmed (PB) |
| NFR-ARCH-006 | Private audio와 licensed catalog의 storage namespace·authorization path를 분리하고 공개·비공개 asset을 같은 CDN namespace에 혼합하지 않는다 | AP-05, PB Phase 9, invariant 4 | Confirmed |
| NFR-ARCH-007 | rights/entitlement를 boolean으로 단순화하지 않는다 | PB Phase 3 | Confirmed (PB) |
| NFR-ARCH-008 | 기술 스택(언어, 프레임워크, DB 제품, 저장소/CDN, queue, transcoding, streaming protocol, client, IaC)은 ADR로 결정 | PB Phase 3, AP-15 | Open |

## 9. COST — Cost Control

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-COST-001 | 무제한 lossless/stems/GPU 분석·무료 저장을 원가 실험 전에 약속하지 않는다 | AP-11 | Proposed |
| NFR-COST-002 | 무료 Studio·보관 비용은 고객 획득·유지 비용으로 추적하고 paid 상품에 숨기지 않는다 | AP-11 | Proposed |
| NFR-COST-003 | 봇 재생 차단, CDN cache, 온디바이스 DSP, 허가 master의 재변환 재사용 | AP-11 | Proposed |
| NFR-COST-004 | 출시 전 계약 입력으로 base/stress/break-even 계산. 변동 공헌이익이 지속 음수인 상품은 가격·범위·계약 재검토 | AP-11 | Proposed |
| NFR-COST-005 | 무료 사용자 비용 상한, MG 부담, 12개월 현금 계획 승인 수치 | AP-11, Q12 | Open (Q12) |
| NFR-COST-006 | 비용을 크게 늘리는 신규 managed infrastructure는 사람이 결정 | PB §9 | Confirmed |

## 10. A11Y — Accessibility

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-A11Y-001 | 텍스트/배경 대비 WCAG AA 최소 | BRD §12 | Proposed |
| NFR-A11Y-002 | 키보드·스크린리더로 재생·대기열·녹음·결제가 가능하다 | AP-04 | Proposed |
| NFR-A11Y-003 | 상태(Streaming/Purchased/Private 등)를 색상만으로 구분하지 않는다 | AP-04, BRD §12 | Proposed |
| NFR-A11Y-004 | 파형·시각화가 유일한 조작 수단이 아니다. 파형은 텍스트 구간 목록, DIG 관계 그래프는 리스트·키보드 탐색 대안을 제공한다. 앨범아트·그래프·provenance badge에 접근성 레이블 | AP-04, BRD §8/§12 | Proposed |
| NFR-A11Y-005 | prefers-reduced-motion 등 움직임 감소 설정, 큰 글자, 대비 설정을 존중한다 | AP-04, BRD §11 | Proposed |
| NFR-A11Y-006 | 전사 대체 기능을 검증한다. 위치 Drop은 장소 방문 강요·운전 중 조작 유도를 피한다 | AP-04 | Proposed |

## 11. UX — Brand & Product UI Principles

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-UX-001 | Content First: 앨범아트·음원·사람·장소가 장식보다 우선. UI 표면은 중립색 비중을 높인다 | BRD §3, §6 | Proposed |
| NFR-UX-002 | Depth on Demand: Credits·Provenance·DIG 관계는 단계적으로 펼친다 | BRD §6 | Proposed |
| NFR-UX-003 | Trust by Design: AI 사용·provenance·권리 상태·위치 사용 여부를 맥락에서 확인 가능 | BRD §6 | Proposed |
| NFR-UX-004 | 영역별 시각 언어: Listen(차분·콘텐츠 중심), DIG(노드·연결·깊이), Atlas(공간·지역), Studio(도구적), Archive(시간성·보존), Trust(명료·검증) | BRD §7 | Proposed |
| NFR-UX-005 | Working palette: Ink #111111, Canvas #F4F1EC, Rabit Purple #7865C8(상호작용 accent), Sunset Orange #EB7B4C(Atlas/발견), Archive Sage #59615B(Archive/Collection). Accent는 선택·포커스·재생·DIG 진입에 우선 사용 | BRD §3 | Proposed (HEX 확정 OQ-BRD-03) |
| NFR-UX-006 | 타이포: 가독성·다국어 우선, 플랫폼 네이티브 산세리프 또는 Noto Sans 후보, 숫자(재생시간·BPM·연도·순위)는 tabular numeral | BRD §4 | Open (OQ-BRD-01) |
| NFR-UX-007 | 로고·앱 아이콘: 앱 아이콘은 심볼 단독(텍스트 없음), Primary=Ink 배경+밝은 심볼; 앱 UI 심볼 ≥20px, 16–32px 픽셀 테스트 | BRD §2, §5 | Proposed |
| NFR-UX-008 | 브랜드 자산은 제품 코드와 분리해 버전 관리 (`brand/logo`, `brand/icon`, `brand/tokens/{color,typography}.json`, `product/icons/...`) | BRD §14 | Proposed |
| NFR-UX-009 | 핵심 조작은 즉시 반응하고 장식 애니메이션으로 지연되지 않는다. Rabbit Hole은 과도한 3D 낙하보다 노드 확장 공간감 | BRD §11 | Proposed |
| NFR-UX-010 | 비공개 자료의 타 계정 접근에서 제목·소유자를 노출하지 않는다 | AP-04 | Proposed |
| NFR-UX-011 | 브랜드 톤: 토끼의 과도한 캐릭터화·상투적 음악 아이콘 결합 지양 | BRD §1 | Proposed |

## 12. QA — Testing & Quality Gates

| ID | Requirement | Source | Status |
|---|---|---|---|
| NFR-QA-001 | 테스트 계층: domain unit(entitlement·금액·grant 기간·state machine), API contract(schema·auth·멱등·하위 호환), integration(DB/outbox/queue/storage/CDN emulator), E2E(AP-04 핵심 5개 흐름), load, chaos, security | AP-13, PB Phase 21 | Proposed |
| NFR-QA-002 | 필수 negative test: 타 사용자 private audio 접근, entitlement 위조, expired URL, malformed media, duplicate webhook/job, concurrent playlist edit, rights withdrawal, deleted/unavailable catalog item, region privacy threshold 위반 | PB Phase 21, AP-13 | Confirmed (PB) |
| NFR-QA-003 | flaky test를 정상 상태로 취급하지 않는다. 실패 테스트를 의도 변경 문서화 없이 삭제하지 않는다. 필수 검사 실패 중 완료를 주장하지 않는다 | PB Phase 21, CLAUDE.md | Confirmed |
| NFR-QA-004 | M1 출시 기준: P0 수용 기준 통과, 치명적 보안·권리·정산 결함 0건, 복원·삭제·CDN 취소 drill 증거, 실제 단가 경제성 승인, 온콜·권리자 대응 연습 | AP-13 | Proposed |
| NFR-QA-005 | error budget 급격 소진 시 기능 배포를 보류한다 | AP-13 | Proposed |
| NFR-QA-006 | 고급 DSP는 별도 실험 gate를 통과한 사용자군에만 활성화 | AP-13 | Proposed |
| NFR-QA-007 | 모델 배포: shadow → 제한 canary → 확대, drift·bias·비용 모니터링, rollback | AP-10 | Proposed |
| NFR-QA-008 | PR마다 관련 요구사항 ID, API 변경, 수용 기준, ADR, 테스트 증거를 첨부 | AP-00, AP-14 | Proposed |

## Appendix. 원 검증 ID 매핑 (AP-13)

| TEST | 연결 REQ | 주 정규화 ID |
|---|---|---|
| TEST-01 | REQ-01/07 | AUD-005–013, NFR-PERF-003 |
| TEST-02 | REQ-02 | PLY-007–010, NFR-REL-004 |
| TEST-03 | REQ-03/17 | COM-002–007/018 |
| TEST-04 | REQ-04/19 | AUD-010, LIB-006/008, LOG-008, SRC-002 |
| TEST-05 | REQ-05/06 | COL-003/004/006 |
| TEST-08 | REQ-08 | SRC-002/004/007/011 |
| TEST-09 | REQ-09/10 | TRU-001–009 |
| TEST-15 | REQ-15/16/24 | ATL-009–012, LOC-002/005 |
| TEST-18 | REQ-18 | STU-002–007 |
| TEST-20 | REQ-20 | NFR-REL-004/008/011, NFR-OBS-002 |
| TEST-AV | REQ-11–14 | ADV-001–006 |
| TEST-CTX | REQ-21/22 | LOC-008/009 |

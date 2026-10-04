# Rabit — Claude Code Development Playbook

> 이 문서는 Rabit 프로젝트를 Claude Code로 개발하기 위한 실행 가이드입니다.
> **한 번에 전체를 구현하지 말고 Phase별 Prompt를 독립 실행한 뒤 Gate를 통과해야 다음 단계로 이동합니다.**

## 0. 프로젝트 컨텍스트

Rabit은 광고 기반 무료 스트리밍을 핵심 모델로 사용하지 않고, 음악과 오디오를 **Listen / Own / Create / Collect / Remember / Trust / Dig**로 통합하는 오디오 플랫폼입니다.

핵심 제품 영역:
- **Listen**: 유료 음악 스트리밍과 고품질 Playback
- **Own**: 앨범 단위 디지털 구매와 영구 Library
- **Studio**: 개인/창작 오디오 업로드, Private/Public/Release
- **Audio Log**: 개인 음성 기록을 AudioObject로 취급
- **Archive**: 음악·구매·Audio Log·Playlist·기억의 장기 축적
- **Collect**: CD/Vinyl 등 Physical Collection
- **Trust**: Music Passport, Credits, AI provenance, rights/integrity
- **DIG**: Rabbit Hole, Credits/Label/Scene/Sound/Sample/Crate Digging
- **Atlas**: Local Top/Gems/Legends/Rising/Made Here

### 제품 불변 원칙
1. 광고로 청취 경험을 훼손하지 않습니다.
2. 상업 음원의 무료 광고 스트리밍을 핵심 BM으로 두지 않습니다.
3. 사용자 오디오와 카탈로그 음원을 하나의 플레이어에서 다룹니다.
4. 데이터 인질형 락인보다 축적 가치에 의한 retention을 지향합니다.
5. AI는 사용자의 선택을 대신하기보다 발견과 이해를 돕습니다.
6. AI-generated, AI-assisted, human-created, spam/fraud를 구분합니다.
7. provenance, credits, rights, ownership, entitlement를 구분합니다.
8. 정확한 위치는 최소 수집합니다.
9. 저작권/라이선스가 불명확한 기능은 구현 전 Review Gate를 둡니다.
10. 오디오 재생 품질과 안정성을 기능 수보다 우선합니다.

---

# 1. 저장소에 둘 `CLAUDE.md`

아래 내용을 프로젝트 루트 `CLAUDE.md`의 기반으로 사용합니다.

```md
# Rabit Engineering Instructions

## Required workflow
Understand → Inspect → State assumptions → Plan → Implement → Test → Review diff → Update docs → Report risks.

## Rules
- Read relevant `/docs` before changing architecture or behavior.
- Never silently resolve an architectural, rights, security, privacy, audio-format, or public-API decision.
- Create/update an ADR before material architectural decisions.
- Keep changes scoped; do not perform unrelated refactoring.
- Prefer explicit domain types for IDs, states, rights, visibility, source type and money.
- Never trust client-supplied ownership, rights, subscription, region or entitlement claims.
- Treat uploaded audio and metadata as untrusted input.
- Treat exact location as sensitive.
- Never infer copyright ownership from file possession.
- CD ownership does not imply entitlement to Rabit's licensed digital master.
- Do not silently deduplicate different users' private copyrighted uploads into one shared entitlement object.
- Distinguish verified factual provenance from ML-inferred relationships.
- Background jobs require idempotency/deduplication and retry semantics.
- Persistent schema changes require migration and rollback consideration.
- Critical paths require metrics/logs/traces and explicit failure behavior.
- New APIs require tests and API documentation.
- Never weaken auth, rights checks, validation, rate limits or audit logging to make tests pass.
- Never delete failing tests without documenting the intentional behavior change.
- Never claim completion while required checks fail.

## Before coding
1. Read the task and relevant docs.
2. Inspect current code and tests.
3. Identify affected bounded contexts.
4. List assumptions/open questions.
5. Produce a small implementation plan.
6. Stop for approval when the task crosses an unresolved ADR, legal gate or destructive migration.

## Definition of Done
- behavior implemented
- relevant tests pass
- typecheck/lint pass
- migration considered
- authorization/rights reviewed
- observability added where required
- docs/API updated
- diff self-reviewed
- unresolved risks reported
```

---

# 2. 권장 문서 구조

```text
docs/
  00-product/{vision,product-principles,glossary,open-questions}.md
  01-requirements/{prd,mvp-scope,user-stories,non-functional-requirements}.md
  02-ux/{information-architecture,core-flows,design-system}.md
  03-architecture/{system-context,container-architecture,domain-boundaries,audio-pipeline,search-recommendation,deployment}.md
  04-data/{domain-model,erd,event-model,retention-policy}.md
  05-api/{api-guidelines,openapi.yaml,events}.md
  06-security/{threat-model,authorization,privacy,abuse-model}.md
  07-rights/{rights-model,ugc-policy,cd-import-risk,takedown-workflow}.md
  08-audio-ai/{universal-audio-object,semantic-audio,playback-engine,music-integrity,provenance-graph}.md
  09-operations/{slo,observability,runbooks,moderation}.md
  10-testing/{test-strategy,quality-gates}.md
  adr/ADR-xxxx-*.md
  plans/{roadmap,backlog}.md
```

---

# Phase 0 — 저장소 초기 진단

## Prompt

```text
당신은 Rabit 프로젝트의 Staff+ Engineer/초기 기술 리드입니다.
지금은 구현하지 마세요.

저장소 전체를 안전하게 조사하세요.

1. 루트 구조와 주요 파일을 확인하세요.
2. README, CLAUDE.md, docs, build manifest, Docker, CI, lint/test/typecheck 설정을 찾으세요.
3. Rabit 기획/디자인/DIG 문서를 모두 식별하고 읽으세요.
4. 현재 기술 스택과 버전을 추출하세요.
5. 실제 build/test/lint/typecheck 명령을 찾고 가능한 범위에서 현재 상태를 검증하세요.
6. 이미 구현된 기능과 스캐폴딩을 구분하세요.
7. 문서 간 충돌/중복/오래된 요구사항을 찾으세요.
8. 이미 결정된 기술사항과 미결정 사항을 구분하세요.
9. 보안, 저작권, 개인정보, 결제, 위치, 오디오 업로드/처리의 위험한 가정을 표시하세요.

파일을 수정하지 마세요.
결과: Repository inventory / Documents / Architecture / Verification status /
Known decisions / Unknown decisions / Conflicts / High-risk areas / Next action.
불확실한 것은 추측하지 말고 Unknown으로 표시하세요.
```

### Gate 0
- 저장소와 문서가 인벤토리화되었습니다.
- 현재 검증 명령이 확인되었습니다.
- 구현은 시작하지 않았습니다.

---

# Phase 1 — 문서 인제스트와 요구사항 정규화

## Prompt

```text
Rabit의 모든 제품/디자인/기술 문서를 읽고 요구사항을 정규화하세요.
코드는 수정하지 마세요.

1. 모든 기능 요구사항을 추출하세요.
2. Domain/Capability별로 그룹화하세요.
3. Confirmed / Proposed / Open Question / Legal Review Required / Deferred로 분류하세요.
4. 충돌하는 요구사항을 찾으세요.
5. MVP와 장기 비전을 분리하세요.
6. 기능/NFR을 분리하세요.
7. glossary를 작성하세요.
8. 안정적인 Requirement ID를 부여하세요. 예: AUD-001, LIB-001, DIG-001.
9. 구현 상세를 제품 요구사항으로 임의 확정하지 마세요.
10. 문서 의미를 임의로 바꾸지 마세요.

작성:
docs/00-product/glossary.md
docs/00-product/open-questions.md
docs/01-requirements/prd.md
docs/01-requirements/mvp-scope.md
docs/01-requirements/non-functional-requirements.md

마지막에 Requirement Coverage Matrix를 보고하세요.
```

### Gate 1
MVP/Deferred/Legal Gate/Open Question이 명시적으로 분리되어야 합니다.

---

# Phase 2 — MVP 절단

## Prompt

```text
정규화된 Rabit PRD를 기준으로 출시 가능한 MVP를 정의하세요.

검증할 핵심 가설:
"사용자는 스트리밍 카탈로그와 자신의 오디오를 하나의 라이브러리/플레이어에서 관리하고,
DIG를 통해 능동적으로 음악을 탐험하는 경험에 가치를 느낀다."

각 기능의 사용자 가치, 구현 난이도, 법률/권리 의존성, 외부 데이터 의존성,
운영비, 선행 기술, MVP 포함/제외 이유를 분석하세요.

P0/P1/P2로 분류하고 docs/01-requirements/mvp-scope.md와 docs/plans/roadmap.md를 갱신하세요.
아직 구현하지 마세요.
```

### 권장 MVP 후보
P0: Auth, Studio Private Upload, Audio Log, Universal AudioObject, Library, Playlist, 기본 Playback, Transcoding, Metadata, Search, Rabbit Hole, Credits Digging, Deep Cut, Digging Trail, 기본 Integrity/rights/audit 구조.

후순위: Stem Streaming, Personal Acoustic Model, Adaptive Mastering, Perceptual ABR, Sound/Instrument Digging, Full Atlas, CD Digital Upgrade.

---

# Phase 3 — ADR과 기술 스택 결정

## Prompt

```text
MVP/NFR을 읽고 기술 선택지를 분석하세요. production 코드는 아직 구현하지 마세요.

처음부터 microservices를 선택하지 마세요.
scale fantasy보다 MVP 운영 가능성과 향후 분리 가능성을 우선하세요.
오디오 data plane과 metadata/control plane을 구분하세요.
rights/entitlement를 boolean으로 단순화하지 마세요.
graph/vector DB를 멋있다는 이유로 도입하지 마세요.

다음 후보를 검토하세요:
- Modular Monolith vs Microservices
- Backend language/framework
- relational DB
- object storage/CDN
- queue/event bus
- search/vector/graph storage
- transcoding
- streaming protocol
- auth
- API style
- client strategy
- IaC/deployment
- observability

각 결정마다 Context / Drivers / Options / Trade-offs / Recommendation /
Consequences / Revisit trigger를 작성하세요.

결정된 것만 Accepted ADR, 불충분한 것은 Proposed ADR로 만드세요.
docs/adr 및 docs/03-architecture/system-context.md를 작성하세요.
```

---

# Phase 4 — 도메인 모델

```text
Accepted ADR과 요구사항을 기준으로 Rabit 도메인 모델을 설계하세요.
ORM entity부터 만들지 말고 도메인 언어와 invariant를 먼저 정의하세요.

반드시 구분:
AudioObject vs AudioAsset(file)
Track vs Recording vs Release/Album
Ownership vs Access vs Subscription Entitlement
UserUpload vs CatalogAsset
Private/Public/Unlisted/Release visibility
RightsClaim vs Provenance
Verified fact vs ML inference
Purchase vs LibraryItem
Physical ownership vs Digital entitlement
Artist identity vs uploader account

Aggregate/Entity/Value Object/Domain Event, 상태 전이와 금지 전이를 정의하세요.
작성: docs/03-architecture/domain-boundaries.md, docs/04-data/domain-model.md, docs/04-data/event-model.md.
ERD로 내려가기 전 모순/Open Question을 보고하세요.
```

**Gate:** AudioObject, AudioAsset, Entitlement, Rights, Visibility, Provenance가 독립 개념이어야 합니다.

# Phase 5 — DB/ERD

```text
확정된 도메인 모델을 persistence model로 변환하세요.
ID 전략, timestamps, 필요한 soft-delete, money 타입, explicit state model,
playlist ordering, listening-event 저장 전략, index/FK/unique/retention을 설계하세요.
Audio binary는 DB에 넣지 마세요.
private object와 catalog object의 storage/authorization 경계를 명시하세요.
migration과 rollback 전략을 포함해 docs/04-data/erd.md를 작성하세요.
migration 생성 전 schema review를 수행하세요.
```

# Phase 6 — API 계약 우선

```text
controller 구현 전에 MVP API 계약을 설계하세요.
대상: users, sessions, audio-objects, uploads, library, playlists, audio-logs,
albums/releases, purchases, entitlements, credits, relations, dig-sessions, search.

각 API의 auth, authorization, schema, validation, pagination, idempotency,
error model, rate-limit, rights/visibility rule을 정의하세요.
파일 접근을 단순 public object URL로 만들지 마세요.
Upload는 direct/presigned 방식을 검토하되 MIME을 신뢰하지 마세요.

작성: docs/05-api/api-guidelines.md, docs/05-api/openapi.yaml.
아직 endpoint는 구현하지 마세요.
```

# Phase 7 — Security/Privacy Threat Model

```text
STRIDE 중심 threat model과 abuse model을 작성하세요.
credential/session theft, IDOR, private audio leakage, signed URL replay,
malicious media, transcoder/parser exploit, oversized upload, metadata injection,
copyright abuse, artist impersonation, stream fraud, entitlement tampering,
location privacy, takedown abuse, AI spam, webhook replay, duplicate jobs를 포함하세요.

각 threat에 asset/attacker/path/impact/mitigation/detection을 기록하세요.
작성: docs/06-security/{threat-model,authorization,privacy,abuse-model}.md.
P0 mitigation이 해결되지 않으면 구현 Gate를 통과시키지 마세요.
```

# Phase 8 — Rights/저작권 모델

```text
제품/기술 관점의 Rights 모델을 설계하세요. 법적 결론은 임의 확정하지 마세요.
Licensed catalog, purchased digital album, user-created private audio,
third-party private upload, public UGC, commercial release, physical collection,
user-local CD rip, platform Digital Upgrade를 구분하세요.

CD 소유만으로 Rabit master entitlement가 생긴다고 가정하지 마세요.
Local Rip + Private Locker와 Platform Master Unlock을 분리하세요.
Public UGC에는 takedown/repeat-infringer/audit workflow를 설계하세요.
fingerprint match는 copyright ownership의 최종 판정이 아닙니다.

작성: docs/07-rights/{rights-model,ugc-policy,cd-import-risk,takedown-workflow}.md.
구현 가능 / 계약 필요 / 법률 검토 필요를 구분하세요.
```

# Phase 9 — Audio Pipeline

```text
ingest → validate → quarantine → transcode → analyze → store → publish → stream을 설계하세요.
original preservation, hash, MIME sniffing, codec/container validation,
duration/size limits, untrusted-media sandbox, waveform, loudness, fingerprint,
codec ladder, lossless source, retry/idempotency, DLQ, partial failure,
object lifecycle, CDN/cache, signed access, deletion/retention을 포함하세요.

Private audio와 licensed catalog의 storage namespace와 authorization path를 분리하세요.
고급 stem/semantic 분석을 blocking ingest path에 넣지 마세요.
작성: docs/03-architecture/audio-pipeline.md,
docs/08-audio-ai/universal-audio-object.md.
```

# Phase 10 — Engineering Bootstrap 구현

```text
이제 처음 구현을 시작합니다. 모든 Accepted ADR/API/threat/domain 문서를 먼저 읽으세요.
목표는 기능이 아니라 engineering foundation입니다.

reproducible local environment, env validation, formatter/linter, strict typecheck,
unit/integration tests, DB migration, 필요한 local storage/queue emulator,
structured logging, correlation ID, health/readiness, config/secret handling,
CI, dependency/security scanning을 구성하세요.

README에 clean clone에서 실행하는 정확한 명령을 기록하세요.
완료 전 clean checkout 기준 bootstrap/build/test/lint/typecheck를 검증하세요.
```

# Phase 11 — Vertical Slice: Private Audio

```text
첫 vertical slice로 Private Audio Upload → Processing → Library → Playback을 구현하세요.
authenticated upload intent, authorized upload, finalize, validation, async processing,
AudioObject creation, status, library listing, authorized playback, delete flow를 포함하세요.

client가 owner_id를 결정하지 않습니다.
storage key를 authorization으로 사용하지 않습니다.
processing job은 idempotent해야 합니다.
실패/retry와 original/derivative 삭제 semantics를 정의하세요.

테스트: happy path, unauthorized, malformed media, duplicate finalize,
job retry, deletion, expired signed access.
작은 변경 단위로 진행하고 문서를 갱신하세요.
```

# Phase 12 — Audio Log

```text
Audio Log를 별도 플레이어가 아니라 Universal AudioObject의 한 타입으로 구현하세요.
private default, recording/upload metadata, title/note/date, playlist 삽입,
일반 Track과 동일 queue 재생, Archive 연결을 지원하세요.
visibility 변경은 권리/공개 정책을 통과해야 합니다.
```

# Phase 13 — Library / Playlist / Entitlement

```text
Library와 Playlist를 구현하세요.
한 playlist에 catalog streaming, purchased item, private upload, Audio Log가 공존해야 합니다.
PlaylistItem이 file URL을 직접 참조하지 않게 하세요.
재생 시 entitlement/visibility를 다시 평가할 수 있어야 합니다.
ordering, concurrent edit, unavailable/deleted item 동작을 정의하고 테스트하세요.
```

# Phase 14 — DIG MVP

```text
Rabbit Hole, Credits Digging, Deep Cut, Digging Trail을 구현하세요.
Accepted ADR 없이 graph DB를 추가하지 마세요.

MusicRelation은 from/to entity, relation_type, provenance/source,
confidence, verification_state를 표현해야 합니다.
Verified factual relation과 ML-inferred relation을 구분하세요.
사용자가 관계 축을 선택하고 시스템은 가능한 edge를 보여주는 모델을 유지하세요.
DigSession/Trail 저장·재개와 empty state를 구현하세요.
```

# Phase 15 — Search

```text
MVP 검색: artist, album/release, track, user private audio, credits/person.
private object는 owner scope 밖 결과에 절대 포함되지 않아야 합니다.
visibility를 application post-filter 하나에 의존하지 마세요.
exact identity와 fuzzy search를 구분하고 popularity만으로 rank하지 마세요.
semantic audio search extension point는 설계하되 과구현하지 마세요.
```

# Phase 16 — Music Integrity

```text
Human-created / AI-assisted / AI-generated / Unknown과
Quality / Spam / Fraud를 서로 다른 축으로 모델링하세요.

Music Passport에 creation declaration, credits, provenance,
verification state, rights metadata, source, AI usage를 포함하세요.
badge는 quality 인증이 아닙니다.
Human Verified는 provenance 근거 없이 부여하지 마세요.
사용자 신고와 automated signal을 구분하고 ML score를 사실 판정처럼 노출하지 마세요.
Search/DIG가 Integrity 정보를 사용할 계약을 정의하세요.
```

# Phase 17 — Music Atlas

```text
Local Top, Local Gems, Local Legends, Rising Here, Made Here를 설계하세요.
'현지에서 많이 듣는 곡'과 '그 지역을 대표하는 음악'을 혼동하지 마세요.

Local Top = 최근 실제 지역 청취량
Gems = global/other-region 대비 Local Affinity
Legends = 장기적인 지역 선호/문화
Rising = 지역 상승 속도
Made Here = 창작/활동/녹음의 지역 관계

raw exact location 장기 저장을 기본값으로 하지 마세요.
client-side/coarse region_id, 최소 집계 기준, privacy threshold를 검토하세요.
데이터가 충분한 geographic level만 공개하세요.
Affinity/Legend score를 테스트 가능한 specification으로 문서화하세요.
```

# Phase 18 — 고급 Playback 연구/설계

```text
아직 구현보다 설계/실험을 우선하세요.
Musical Transition Engine, Adaptive Loudness, Perceptual ABR,
Device-aware playback, Personal Acoustic Model, Adaptive Mastering,
Stem Streaming 각각에 대해:
user value, DSP/ML requirement, latency, battery, bandwidth, rights,
client/server split, fallback, measurable quality metric을 작성하세요.

원음 훼손 가능 기능은 Original mode를 항상 고려하세요.
codec/bitrate 숫자를 근거 없이 확정하지 마세요.
실험 가능한 prototype과 production requirement를 분리하세요.
```

# Phase 19 — Semantic Audio / Sound Digging

```text
Sound Digging을 위한 MIR pipeline을 설계하세요.
track-level과 segment-level 분석을 분리하세요.
section, BPM, key, beat/downbeat, instrumentation, timbre, loudness,
embedding, transcript/lyrics metadata의 provenance를 정의하세요.

vector retrieval만으로 '같은 악기' 같은 사실을 단정하지 마세요.
embedding model/version을 저장하고 re-index 전략을 정의하세요.
offline evaluation dataset과 retrieval quality metric을 먼저 정의한 뒤 구현하세요.
```

# Phase 20 — 관측성/SLO

```text
핵심 user journey 기준 SLI/SLO를 정의하세요:
login, library load, play start, rebuffering, upload finalize,
transcoding latency/failure, search latency, DIG traversal, purchase/entitlement.

metric/log/trace correlation을 설계하고 PII/audio metadata logging policy를 명시하세요.
alert는 원인 없는 metric 나열이 아니라 사용자 영향과 연결하세요.
runbook을 작성하세요.
```

# Phase 21 — 테스트 전략

```text
Rabit 전체 테스트 전략을 작성/적용하세요.
unit / domain invariant / repository integration / API contract /
authorization / media pipeline / queue retry / migration / end-to-end /
load / chaos/failure / security regression을 구분하세요.

가장 중요한 negative tests:
다른 사용자의 private audio 접근
entitlement 위조
expired URL
malformed media
duplicate webhook/job
concurrent playlist edit
rights withdrawal
deleted/unavailable catalog item
region privacy threshold 위반

flaky test를 허용 가능한 정상 상태로 취급하지 마세요.
```

# Phase 22 — 성능/비용 검증

```text
최적화 전에 baseline을 측정하세요.
API p50/p95/p99, play-start latency, rebuffer ratio, transcoding throughput,
storage growth, CDN egress, DB query profile, search latency,
background queue depth를 측정하세요.

10k/100k/1M 사용자 가정은 실제 측정값과 분리해 명시하세요.
premature optimization을 피하고 비용이 큰 경로를 먼저 최적화하세요.
```

# Phase 23 — Release Readiness

```text
release candidate를 코드 작성 없이 먼저 감사하세요.

검토:
requirements coverage
migrations/rollback
security P0/P1
rights/legal gates
privacy
API compatibility
SLO/alerts
backup/restore
object lifecycle
moderation/takedown
feature flags
rate limits
secrets
dependency vulnerabilities
load test
runbooks
support/admin tooling

Blocker / Must fix / Follow-up으로 분류하세요.
Blocker가 있으면 release-ready라고 선언하지 마세요.
```

# Phase 24 — 최종 코드리뷰 프롬프트

```text
현재 branch 전체를 냉정하게 review하세요.
새 기능을 추가하지 마세요.

검토 순서:
1 correctness
2 authorization/rights/privacy
3 data integrity/concurrency/idempotency
4 failure/retry semantics
5 API compatibility
6 performance
7 observability
8 test quality
9 maintainability
10 docs drift

finding마다 severity, file/location, scenario, impact, concrete fix를 작성하세요.
style 취향보다 실제 defect/risk를 우선하세요.
문제가 없다고 판단한 영역도 무엇을 검증했는지 기록하세요.
```

---

# 3. 기능 구현용 공통 Prompt Template

```text
Task: <기능>

먼저 관련 Requirement ID, ADR, API, domain/security/rights 문서를 읽으세요.
바로 수정하지 말고 현재 구현을 조사하세요.

반드시 먼저 보고:
- understood behavior
- affected modules
- invariants
- auth/rights/privacy impact
- migration impact
- failure modes
- test plan
- implementation plan

그 후 구현하세요.

제약:
- scope 밖 refactor 금지
- unresolved ADR/legal gate 발견 시 중단
- public API 변경 시 spec 선행 갱신
- schema 변경 시 migration 포함
- background job은 idempotent
- authorization negative test 필수
- critical path observability 포함

완료 시:
Changed / Tests / Docs / Migration / Security-Rights review / Remaining risks를 보고하세요.
```

# 4. 버그 수정 Prompt

```text
버그를 바로 고치지 말고 먼저 재현하세요.
1. 증상과 기대 동작을 문서/테스트에서 확인
2. 최소 재현 테스트 작성
3. root cause 분석
4. 가장 작은 수정
5. regression test
6. 관련 경로 영향 확인
7. lint/typecheck/tests
8. diff review

증상만 숨기는 fallback이나 validation 제거로 해결하지 마세요.
```

# 5. Refactoring Prompt

```text
이 작업은 behavior-preserving refactor입니다.
먼저 characterization tests가 충분한지 확인하세요.
부족하면 먼저 테스트를 보강하세요.
public contract/schema/event semantics를 바꾸지 마세요.
성능/복잡도 개선을 주장한다면 전후 근거를 제시하세요.
리팩터링과 기능 변경을 같은 diff에 섞지 마세요.
```

# 6. DB Migration Prompt

```text
migration을 작성하기 전 현재 데이터와 compatibility를 분석하세요.
expand/contract가 필요한지 검토하세요.
대규모 table lock, backfill, nullability, index build, rollback,
old/new application version 동시 실행을 고려하세요.
destructive migration은 명시적 승인 없이 수행하지 마세요.
```

# 7. 완료 기준(Definition of Done)

모든 기능은 최소 다음을 만족해야 합니다.

- Requirement ID와 연결됩니다.
- domain invariant가 보존됩니다.
- authorization/rights/privacy를 검토했습니다.
- 성공/실패/권한없음 경로 테스트가 있습니다.
- 필요한 migration이 있습니다.
- background operation은 retry/idempotency가 정의됩니다.
- critical path에 관측성이 있습니다.
- API/architecture 문서가 실제 코드와 일치합니다.
- lint/typecheck/tests가 통과합니다.
- diff를 self-review했습니다.
- 미해결 위험을 숨기지 않았습니다.

---

# 8. Claude Code 세션 운용 권장 순서

한 세션에 모든 Phase를 넣지 않습니다.

1. Phase 0만 실행
2. 결과 검토
3. Phase 1 실행
4. MVP 합의 후 Phase 2
5. ADR은 하나 또는 관련된 작은 묶음씩 처리
6. Domain → ERD → API → Threat/Rights → Audio Pipeline 순으로 설계
7. Bootstrap 구현
8. Vertical Slice 하나씩 구현
9. 매 slice마다 test/review/docs gate
10. DIG/Integrity/Atlas는 기반 모델이 안정된 뒤 추가
11. 고급 DSP/ML은 별도 실험 트랙에서 검증
12. Release 전에 Phase 23/24를 새 컨텍스트에서 다시 수행

**권장:** 구현 세션과 리뷰 세션을 분리합니다. 가능하면 구현하지 않은 새 Claude Code 세션에서 리뷰를 수행합니다.

---

# 9. Claude가 멈추고 사람에게 물어야 하는 조건

다음은 임의 결정하지 않습니다.

- 상업 음원 라이선스 조건
- 로열티 계산/정산 규칙
- CD Digital Upgrade entitlement
- UGC 법적 정책
- 사용자 콘텐츠 보존/삭제 법적 기간
- 결제 환불/소유권 정책
- AI Human Verified의 인증 기준
- 정확한 위치 저장 정책
- 데이터 국외 이전/지역 규제
- breaking public API
- irreversible destructive migration
- 비용을 크게 증가시키는 신규 managed infrastructure
- Accepted ADR을 뒤집는 결정

---

# 10. 프로젝트에서 피해야 할 과설계

- MVP부터 수십 개 microservice
- Kafka가 필요하다는 증거 없이 Kafka 도입
- 단순 관계 조회만 필요한데 graph DB부터 도입
- semantic search가 아직 없는데 별도 vector DB부터 운영
- 모든 이벤트를 event sourcing
- CQRS를 도메인 필요 없이 전면 적용
- custom auth 구현
- 자체 DRM/codec 발명
- ingest critical path에서 모든 ML 분석 동기 실행
- premature multi-region active-active
- 사용자 수 근거 없이 복잡한 sharding

**원칙:** 단순하게 시작하되 domain boundary, event contract, storage abstraction을 명확히 하여 나중에 분리할 수 있게 합니다.

---

# 11. Rabit 개발의 핵심 기술적 불변조건

1. **AudioObject ≠ Audio File**
2. **Ownership ≠ Entitlement ≠ Library membership**
3. **Physical ownership ≠ Digital master entitlement**
4. **Private storage ≠ Public catalog**
5. **Provenance fact ≠ ML inference**
6. **AI-generated ≠ Spam ≠ Low quality**
7. **Recommendation ≠ DIG**
8. **Local popularity ≠ Cultural representation**
9. **Location context ≠ Exact location history**
10. **Playback quality is a product feature**
11. **Rights checks happen at access time, not only ingestion time**
12. **User-controlled data must have export/deletion semantics**

---

# 12. 첫 Claude Code 실행에 사용할 Prompt

```text
Rabit 개발을 시작합니다.

먼저 repository root의 CLAUDE.md와 docs를 읽으세요.
이 프로젝트는 음악 스트리밍만이 아니라 개인 Audio Archive, Studio,
앨범 소유, DIG, Music Integrity, Music Atlas를 통합하는 플랫폼입니다.

오늘은 코드를 구현하지 않습니다.

이 Playbook의 Phase 0만 수행하세요.
저장소/문서/빌드/테스트/기술결정/Open Question/위험요소를 조사하고 보고하세요.
Phase 1 이후로 넘어가지 마세요.
파일도 수정하지 마세요.

특히 문서에 이미 있는 결정을 임의로 재결정하지 말고,
충돌이나 불명확성이 있으면 정확한 파일 위치와 함께 보고하세요.
```

---

## 문서 상태

- 용도: Claude Code 저장소 내 실행 가이드
- 권장 위치: `/docs/RABIT_CLAUDE_CODE_PLAYBOOK.md`
- 루트에는 별도의 `/CLAUDE.md`를 두고 본 문서를 참조하게 합니다.
- 제품/기술 결정이 바뀌면 본 문서의 고정 프롬프트보다 최신 Accepted ADR과 PRD가 우선합니다.

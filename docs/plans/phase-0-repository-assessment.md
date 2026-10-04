# Phase 0 — 저장소 초기 진단 보고서

- 작성일: 2026-10-04
- 기준 커밋: `6134a45` (docs: add CLAUDE.md engineering instructions)
- 범위: Playbook Phase 0. 구현·기존 문서 수정 없음. 이 보고서만 추가합니다.
- 표기: **Known** = 문서에 명시된 사항, **Unknown** = 문서에 근거가 없어 추측하지 않은 사항.

---

## 1. Repository inventory

| 경로 | 종류 | 비고 |
|---|---|---|
| `CLAUDE.md` | 엔지니어링 지침 | Playbook §1 기반 + 커밋 규칙 (이번 세션 추가) |
| `CONTRIBUTING.md` | 커밋 규칙 | Conventional Commits 1.0.0, 영문 (이번 세션 추가) |
| `.gitignore` | 설정 | OS/에디터 파일만 (이번 세션 추가) |
| `docs/RABIT_CLAUDE_CODE_PLAYBOOK.md` | 실행 가이드 | Phase 0–24, 원본은 루트에서 이동 |
| `audio-platform/00–16-*.md` | 플랫폼 기획 세트 v0.1 | 17개 개별 문서 = "편집 정본" |
| `audio-platform/MASTER-FULL.md` | 통합본 | 00–16 단순 연결본 (공백 줄·제목 레벨 외 차이 없음 확인) |
| `DIG_music_discovery_PRD.docx` | DIG 기능 기획서 | 13개 절, MVP/V1–V3 단계 |
| `Rabit_Brand_Design_Guide.docx` | 브랜드·제품 디자인 가이드 | 16개 절 + identity board 이미지 1장 |

존재하지 않는 것: README, 소스 코드, build manifest(package.json/pyproject/go.mod 등), Dockerfile/compose, CI 설정, lint/format/typecheck/test 설정, IaC, `brand/` 자산 디렉터리, ADR 파일, OpenAPI 파일.

Git: `main` 브랜치, 이번 세션 이전에는 커밋 0개였음. 원격(remote) 미설정 — **Unknown**: 호스팅 위치.

## 2. Documents

### 2.1 audio-platform (작성일 2026-10-04, v0.1, "검토 가능한 설계 초안")

| 문서 | 핵심 내용 | 정본 영역 (00-master 기준) |
|---|---|---|
| 00 master | 핵심 결정, 원문 확인 한계, 문서 지도, 출시 차단 조건 | — |
| 01 vision | 6가지 철학(Listen/Own/Create/Collect/Remember/Trust), 고객 가설, 비목표 | — |
| 02 PRD/roadmap | REQ-01–24, 상품 권한 표, M0–M3 단계 | **제품 범위** |
| 03 functional spec | 상태 전이, AC-01–16 | **기능 행동** |
| 04 UX/IA | IA, 5개 핵심 흐름 | — |
| 05 domain/ERD | 엔티티 ~35개, 불변 조건, 인덱스 | **데이터 불변 조건** |
| 06 architecture | 모듈형 백엔드 + 비동기 worker, HLS/CDN, 장애 전략 | — |
| 07 API draft | v1 MVP endpoint ~29개, M2/M3 예약 | 파생 계약 |
| 08 security/privacy | RBAC+ABAC, 위치, 보존 기간 제안, 위협 표 | **권한** |
| 09 legal checklist | 권리별 검토표, CD/Upgrade/UGC/소비자 보호 | — |
| 10 AI/ML/Integrity | Passport 신뢰 수준, AI 필터 모드, 차트 공식 | 지역 차트 집계 정본 |
| 11 unit economics | 상품별 CM 공식, KRW 예시(가정 A05) | — |
| 12 operations | 공개 검토, 신고/권리자 흐름, 정산 상태 | — |
| 13 SLO/tests | SLI/SLO 제안, TEST-xx, RPO/RTO | — |
| 14 backlog | E01–E21, B001–B012 | — |
| 15 ADR/open questions | ADR-01–18(모두 proposed), Q01–Q19, A01–A05, R01–R11 | — |
| 16 traceability | REQ→spec→data/API→test→epic, 외부 출처 | — |

표기 체계(00 §가정과 제안의 해석): `확정 요구` / `설계 제안` / `가정 A` / `미결정 Q` / `검증 R`.
원문 한계(00 §원문 확인 범위): 참조 대화의 최근 6개 턴만 확인됨 → 가격·브랜드·출시 국가·무료 용량·팀 규모는 복원하지 않음(Q19).

### 2.2 DIG PRD (docx)
Recommendation과 구분되는 능동형 탐험. 기능 13개(Rabbit Hole, Digging Trails, Credits/Label/Scene/Time Machine/Sound/Instrument Digging, Sample Archaeology, Blind Digging, Deep Cut, Crate Digging, Dig Session Summary). 데이터 모델(MusicEntity, MusicRelation, AudioSegment, DigSession, DigTrailNode, Crate, Scene). 단계: MVP(Rabbit Hole, Credits Digging, Deep Cut, Digging Trail) → V1 → V2 → V3. Open Questions 7개.

### 2.3 Brand & Product Design Guide (docx)
서비스명 **Rabit 확정**, 7개 축(Listen/Own/Create/Collect/Remember/Trust/**Dig**). Working palette(Ink #111111, Canvas #F4F1EC, Rabit Purple #7865C8, Sunset Orange #EB7B4C, Archive Sage #59615B), UI 원칙 6개, 영역별 시각 언어, 접근성(WCAG AA), 자산 구조 권장안(`brand/...`), 확정/미확정 표.

## 3. Architecture (현재 상태)

- **구현된 기능: 없음. 스캐폴딩: 없음.** 저장소는 문서 전용입니다.
- 문서상 제안 아키텍처(06, 모두 `설계 제안`): 모듈형 백엔드 + 별도 비동기 오디오 worker, 제어 경로/미디어 경로 분리, RDB 정본 + transactional outbox, at-least-once queue + 멱등 handler, 격리 저장소 → worker → 암호화 원본/재생 파생물, 서명된 CDN, ACL 선필터 검색, 관계 테이블 기반 그래프(graph DB 보류).

## 4. Verification status

| 항목 | 명령 | 상태 |
|---|---|---|
| build | 없음 | 해당 없음 (manifest 부재) |
| test | 없음 | 해당 없음 |
| lint/format | 없음 | 해당 없음 |
| typecheck | 없음 | 해당 없음 |
| CI | 없음 | 해당 없음 |
| 문서 내부 상대 링크 | `grep` 기반 존재 확인 | ✅ audio-platform 내 상대 `.md` 링크 전부 해석됨 |
| MASTER-FULL ↔ 개별 문서 일치 | `diff` (제목 레벨 정규화) | ✅ 내용 차이 없음 (통합본 서두 1단락만 추가) |
| docx 판독 | `pandoc` 변환 | ✅ 두 파일 모두 텍스트 추출 가능 |

## 5. Known decisions

문서에 **확정 요구** 또는 **확정**으로 표기된 것만 기재합니다.

| # | 결정 | 출처 |
|---|---|---|
| K1 | 광고 기반 무료 카탈로그 스트리밍 제공 안 함 | 00 §핵심 결정, 01, 11 |
| K2 | 무료 계정 = 개인 오디오·Audio Log·제한된 Studio 업로드·컬렉션 기록 | 00 §핵심 결정 |
| K3 | 유료 구독 = 허가된 카탈로그 스트리밍 | 00 |
| K4 | 앨범 구매 권한은 구독과 별개 | 00, 02 상품 권한 |
| K5 | CD 실물 인증은 디지털 재생 권한으로 자동 전환되지 않음 | 00, 03, 05, 09 |
| K6 | Universal Audio Object는 재생 인터페이스만 통일, 권리·공개 범위는 통일하지 않음 | 00, 05 |
| K7 | MVP·M2 서버는 정확 좌표 저장을 지원하지 않음 | 03 §위치, 08 |
| K8 | 서비스명 Rabit, rabbit-inspired symbol 방향, dark premium visual language 방향 | Brand §15 |
| K9 | 인증·Human 배지·품질 점수를 판매하지 않음 | 03, 11 |
| K10 | 요구사항은 삭제하지 않고 `proposed/approved/deferred/retired`로 관리 | 02 §변경 관리 |

**기술 결정은 Accepted된 것이 없습니다.** 15 문서가 "아래 상태는 모두 제안이며 승인된 ADR로 간주하지 않습니다"라고 명시합니다.

## 6. Unknown decisions

| 영역 | 상태 | 관련 ID |
|---|---|---|
| 백엔드 언어/프레임워크 | Unknown — 어떤 문서에도 없음 | ADR 미등록 |
| 클라이언트 기술(네이티브/크로스플랫폼/웹) | Unknown (A03 "모바일 청취 + 웹 Studio"는 가정) | Q06 |
| 클라우드/호스팅 공급자, IaC | Unknown | ADR 미등록 |
| RDB 제품, 객체 저장소, CDN, queue 제품 | Unknown (범주만 제안) | ADR-01/05/18 |
| 인증 공급자 | Unknown ("managed OIDC 후보") | ADR-02 |
| codec ladder/bitrate/segment 길이 | Unknown (AAC 중심 "검토") | ADR-04 |
| DRM 필요 여부 | Unknown | ADR-05 |
| 결제 공급자 | Unknown | ADR-06 |
| 첫 출시 국가·법인·언어·미성년자 정책 | Unknown (A01 한국은 가정) | Q01 |
| 확보 카탈로그와 권리 | Unknown | Q02 |
| 무료 용량/가격 | Unknown | Q03/Q04 |
| 브랜드 UI 서체, tagline | 미확정 | Brand §15 |
| 저장소 원격·CI 플랫폼 | Unknown | — |

## 7. Conflicts / 중복 / 오래된 요구사항

| # | 충돌 | 위치 | 영향 |
|---|---|---|---|
| C1 | **제품 축 수**: 6개 철학(Dig 없음) vs 7개 축(Dig 포함) | 01 §여섯 가지 철학 vs Brand §1, Playbook §0 | Dig이 핵심 축인지 확장 기능인지 |
| C2 | **DIG가 audio-platform REQ 레지스트리에 없음**. 가장 가까운 것은 REQ-09(Credits Graph M2), REQ-23(크레딧 탐색 M1) | 02 §요구사항 레지스트리 vs DIG PRD §9 | DIG MVP 요구사항 ID 부재 |
| C3 | **Credits 탐색 단계**: Credits Graph = M2 vs Credits Digging = DIG MVP vs Playbook P0 | 02 REQ-09 vs DIG §9 vs Playbook Phase 2 권장 MVP | MVP 범위 |
| C4 | **MVP 정의 자체**: 02는 MVP = M1(유료 구독·앨범 판매·직접 허가 카탈로그·entitlement 포함). Playbook 권장 P0는 결제/카탈로그 대신 Search·DIG 포함, 결제는 명시 없음 | 02 §단계와 종료 조건 vs Playbook Phase 2 | **Phase 2 전 합의 필수** |
| C5 | **단계 명칭 3종**: M0–M3 / MVP·V1–V3 / P0–P2 | 02, DIG §9, Playbook | 로드맵 정규화 필요 |
| C6 | **Requirement ID 체계**: REQ-01–24 vs Playbook 요구 `AUD-001, LIB-001, DIG-001` | 02 vs Playbook Phase 1 | 매핑 표 필요(REQ 보존) |
| C7 | **Provenance 신뢰 수준 명칭 불일치**: `self-declared, distributor-verified, signature-valid, rights-reviewed` vs `self_declared, signature_valid, process_evidence_reviewed, rights_reviewed` | 03 AC-09 vs 10 §Passport | enum 확정 필요 |
| C8 | **Human 인증 명칭**: "Verified Human Performance" vs "Human Verified" | 10 vs Playbook Phase 16, CLAUDE 질문 목록 | 용어 통일 |
| C9 | **재생 판정 순서**: 03은 계정→source/visibility→entitlement→국가·계약→정책, 08은 인증→source→계약 rights→entitlement→capability→세션 | 03 §공통 재생 vs 08 §재생 판단 | 08이 권한 정본(00 규칙)이나 03 갱신 필요 |
| C10 | **Visibility 값**: Playbook `Private/Public/Unlisted/Release` vs 문서는 private/public·release 흐름만, **Unlisted 없음** | Playbook Phase 4 vs 03/05/07 | enum 확정 필요 |
| C11 | **Track 용어**: Playbook "Track vs Recording vs Release/Album" vs 05 `Work/Recording/Release/Edition/ReleaseTrack` (Track 엔티티 없음) | Playbook Phase 4 vs 05 | glossary로 정리 |
| C12 | **DIG 데이터 모델 vs 05**: DIG `AudioObject(source, rights, fingerprint)`는 05의 Object/Version/Source/Asset 분리 및 "fingerprint 외부 응답 제외"와 상충. DIG `MusicRelation(any entity)` vs 05 `AudioRelationship(version↔version)` + `Credit`. Label·Scene·Place 엔티티는 05에 없음 | DIG §6 vs 05 | Phase 4에서 통합 |
| C13 | **"CD Library" 재생**: 플레이리스트에 Streaming/Purchased/Private/**CD Library** 혼합 | Brand §10 vs 09 §CD (리핑은 법적 게이트, 실물≠재생권) | 표현/범위 확인 필요 |
| C14 | **"Physical Verified" 표시**: Brand 상태명 vs 03 `self_declared/evidence_reviewed` | Brand §6/§10 vs 03 | UI 라벨 매핑 |
| C15 | **"Stream without limits"** 카피 | Brand identity board (Listen 카드) vs 02/03 "무제한 약속 금지", 무료 카탈로그 없음 | 카피 검토 |
| C16 | **Atlas 카테고리**: NOW/GEMS/LEGENDS/RISING/MADE HERE + DECADES(03/10) vs Brand는 DECADES 없음; Local Top="NOW" 명칭 | 03 §지역 차트, 10 vs Brand §9 | 명칭 통일 |
| C17 | **ADR 번호 체계**: `ADR-01..18` vs Playbook `adr/ADR-xxxx-*.md` | 15 vs Playbook §2 | 번호 매핑 |
| C18 | **문서 위치**: `audio-platform/` 번호 체계 vs Playbook `docs/00-product/...` 구조 | — | Phase 1에서 새 구조로 정규화, 원본은 보존 |
| C19 | **Stem 정보 사용**: Instrument Digging은 stem 활용 언급(V2) vs stems는 M3·별도 특약 | DIG §3.8 vs 02 REQ-14, 09 | 권리 게이트 |
| C20 | REQ-16 우선순위가 "P0 개인정보, P1 기능"으로 이중 | 02 | 분리 필요 |

중복: 08·13·06에 취소/삭제 SLO와 세션 만료가 중복 기술(값은 일치: 세션 5분, segment 60초, 취소 60초, 삭제 24시간). 오래된 요구사항: 식별되지 않음(모든 문서 동일 날짜 v0.1).

## 8. High-risk areas (위험한 가정 표시)

| 영역 | 위험 | 근거 문서 상태 |
|---|---|---|
| 저작권 | 개인 오디오 클라우드 보관의 적법성 미검토 — "private로 제한하되 적법 자동 인정 금지" | 09: 법령 조문 본문 미조회, 자문 미완료 |
| 저작권 | CD 리핑/matching/Digital Upgrade — 계약 없이는 불가 | 09 체크리스트 전부 미체크 |
| 저작권 | 무료 공개 Studio 재생도 public performance 등 권리 검토 필요 | 09, Q07 |
| 저작권 | DIG의 샘플/영향 관계 외부 데이터 라이선스 | DIG §12 미결 |
| 개인정보 | 개인 오디오 서버 분석 → E2EE 광고 금지, 전사·벡터 유출 | 08, ADR-16 |
| 개인정보 | region_id + 계정/IP 결합은 여전히 개인 위치 정보 | 08 |
| 위치 | 위치정보법 적용·신고 의무 미검토 | 09, 16 |
| 결제 | webhook 위조·중복·역순, 원장 정합성, 앱스토어 결제 정책 | 07, 09, ADR-06 |
| 업로드 | decoder 취약점, zip bomb, MIME 위조, SSRF(외부 URL import 금지) | 06, 07, 08 |
| 업로드 | 계정 간 해시 동일 시 존재 노출 금지(dedup 금지) | 03 AC-01, ADR-03 |
| 오디오 처리 | codec/bitrate 근거 없음 — 확정 금지 | 06 |
| 운영 | 권리 철회 60초 vs 이미 버퍼된/DRM 없는 파일 회수 불가 | 06, 13 |
| 데이터 | 문서가 참조 대화의 일부(6턴)만 근거 — 누락된 과거 결정 가능성 | 00, Q19 |

## 9. Gate 0 판정

| 조건 | 결과 |
|---|---|
| 저장소와 문서가 인벤토리화되었다 | ✅ |
| 현재 검증 명령이 확인되었다 | ✅ (검증 명령 없음을 확인. 문서 링크/통합본 일치만 검증) |
| 구현은 시작하지 않았다 | ✅ |

## 10. Next action

1. **Phase 1** (문서 인제스트·요구사항 정규화): 위 C1–C20을 Open Question/Conflict로 기록하고, REQ-01–24를 보존한 채 도메인별 ID(AUD/LIB/DIG 등)와의 매핑을 만든다. 의미는 바꾸지 않는다.
2. Phase 2 진입 전 사람의 합의가 필요한 항목: **C4(MVP 정의)**, C1/C2(DIG의 위상), C3(Credits 단계).

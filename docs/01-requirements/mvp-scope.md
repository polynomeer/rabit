# Rabit MVP Scope

- 상태: **Phase 2 확정 (2026-10-04).** §0이 결정, §1–5는 Phase 1에서 정리한 원문 비교(근거)입니다.
- 요구사항 ID: [prd.md](prd.md) · 미결정: [open-questions.md](../00-product/open-questions.md) · 로드맵: [roadmap.md](../plans/roadmap.md)

## 0. 결정 (Phase 2)

### 0.1 Product owner 결정 (2026-10-04)
1. **DIG는 핵심 축이다** (CNF-01/02). 제품 축: Listen / Own / Create / Collect / Remember / Trust / **Dig**.
2. **MVP로 간다**: MVP는 PB 가설 중심 범위이며 Credits Digging을 포함한다 (CNF-03/04).
3. **사람 개입이 필요한 결정은 문서로만 남기고, 구현 가능한 것은 구현한다.**

### 0.2 검증 가설
> 사용자는 스트리밍 카탈로그와 자신의 오디오를 하나의 라이브러리/플레이어에서 관리하고, DIG를 통해 능동적으로 음악을 탐험하는 경험에 가치를 느낀다.

### 0.3 MVP 경계 해석
- **카탈로그 스트리밍**은 가설의 일부이므로 *구조*(Catalog source, RightsGrant, Entitlement, Subscription 상태, 접근 시점 검사, 권리 철회)를 MVP에 구현한다. 콘텐츠는 **직접 제작한 fixture 오디오만** 사용한다(CAT-008).
- **Commercial Gate**(사람 결정 필요 — 구현하지 않고 문서·인터페이스만): 실제 카탈로그 계약(Q02), 결제 제공자·가격·세금(Q04, ADR-06), 구매 다운로드 범위(Q05), 실판매 오픈, 공개 UGC 정책(Q07). 이 gate가 열리기 전 MVP는 **내부 알파 / 초대 베타**로만 운영할 수 있다.
- Subscription·purchase entitlement는 MVP에서 **운영자 grant 또는 sandbox 경로**로만 생성한다. 사용자 입력으로 결제 확정이 일어나는 경로는 만들지 않는다(COM-004).

### 0.4 P0 / P1 / P2 (통합 표기, CNF-05)

| 우선순위 | 의미 | 구현 여부 |
|---|---|---|
| **P0** | MVP. 가설 검증에 필요 | 구현 |
| **P1** | MVP 직후. 사람 결정(gate) 해소 또는 P0 안정화 후 | 문서/인터페이스. gate 무관 항목은 여유 시 구현 |
| **P2** | 장기·연구 | 설계 문서만 |

### 0.5 기능별 분석

| 기능 | 사용자 가치 | 난이도 | 법률/권리 의존 | 외부 데이터 의존 | 운영비 | 선행 기술 | 결정 | 이유 |
|---|---|---|---|---|---|---|---|---|
| Auth (OIDC) | 필수 | 중 | 낮음 | OIDC 공급자 | 낮음 | — | **P0** | 모든 권한의 기반 |
| Private Upload + Processing | 높음 (Archive 핵심) | 높음 | 중 (개인 클라우드 보관 적법성은 Legal 문서화) | 없음 | 중 (저장·변환) | UAO, storage, queue | **P0** | 가설의 "자신의 오디오" |
| Audio Log | 높음 | 중 | 낮음 (타인 음성 안내는 문서) | 없음 | 낮음 | Upload | **P0** | AudioObject 통합 검증 |
| Universal AudioObject | 기반 | 높음 | 기반 구조 | 없음 | — | — | **P0** | invariant 1 |
| Library / Archive / Playlist (혼합) | 높음 | 중 | entitlement 재평가 | 없음 | 낮음 | UAO | **P0** | "하나의 라이브러리/플레이어" |
| Playback (HLS, 단기 세션) | 필수 | 높음 | 접근 시점 rights 검사 | 없음 | CDN egress | Transcoding | **P0** | 품질이 제품 기능 |
| Catalog 구조 + RightsGrant + Entitlement | 가설 핵심 | 중 | **실계약은 Gate** | 카탈로그 메타데이터 | 낮음 | UAO | **P0 (fixture)** | 구조 없이 혼합 라이브러리 검증 불가 |
| 권리 철회 전파 | 필수 안전장치 | 중 | — | — | — | Playback | **P0** | 필수 negative test |
| Metadata / Credits | 높음 | 중 | 크레딧 데이터 출처 Legal | 크레딧 소스 | 낮음 | Catalog | **P0** | Credits Digging 기반 |
| Search (기본 + private scope) | 높음 | 중 | 낮음 | 없음 | 낮음 | Metadata | **P0** | 라이브러리 사용성 |
| Rabbit Hole / Credits Digging / Deep Cut / Trail | 핵심 차별화 | 중 | 관계 데이터 라이선스 (OQ-DIG-06) | 관계 데이터 | 낮음 | Credits, 관계 테이블 | **P0** | 가설의 "DIG" |
| 기본 Integrity (Passport 기본, 축 분리, 신고 접수) | 신뢰 | 중 | Human Verified 기준은 사람 결정 | 없음 | 낮음 | Credits | **P0 (구조)** | AI/spam/quality 축 분리를 처음부터 |
| Audit log | 운영 필수 | 낮음 | — | — | 낮음 | — | **P0** | rights/entitlement 변경 추적 |
| Export / Delete | 높음 (반 락인) | 중 | 보존 기간은 Legal | 없음 | 낮음 | UAO | **P0** | invariant 12 |
| Listening events | 중 | 중 | 정산 기준은 계약 | 없음 | 중 | Playback | **P0 (기본)** | Deep Cut 인지도 산출 |
| 주문·결제·원장·구매 다운로드 | 높음 | 높음 | **Gate (Q02/Q04/Q05)** | 결제 공급자 | 중 | Entitlement | **P1** | 사람 결정 필요 |
| Studio 공개 릴리스·심사·판매자 | 중 | 높음 | **Gate (Q07)** | — | 운영 인력 | Integrity | **P1** | 공개 UGC 정책 미정 |
| AI 필터 모드 (Human Only 등) | 중 | 중 | Human Only 기준 Q08 | — | 낮음 | Passport | **P1** | 기준이 사람 결정 |
| Physical Collection 수동 등록 | 중 | 낮음 | 낮음 (등록만) | 판본 DB 라이선스 | 낮음 | Catalog | **P1** | 가설 외 |
| Human curation / Slow Discovery | 중 | 낮음 | 낮음 | 편집 인력 | 인력 | Catalog | **P1** | 가설 외, 인력 필요 |
| Dig Session Summary, 공개 Trail 공유 | 중 | 낮음 | 모더레이션 정책 OQ-DIG-07 | — | 낮음 | Trail | **P1** | 공개 공유는 정책 필요 |
| Crate / Blind / Label / Scene Digging | 중 | 중 | Scene taxonomy 정책 | Scene/Label 데이터 | 낮음 | DIG P0 | **P2** | DIG V1 |
| Music Atlas / Local Charts / 위치 | 높음 (장기) | 높음 | 위치정보법 Legal, privacy threshold Q09 | 충분한 청취 표본 | 중 | Listening events | **P2 (설계)** | 표본·법률 선행 |
| Semantic / Sound / Instrument Digging | 높음 (장기) | 매우 높음 | 분석 허가 (CAT-009) | 모델 | GPU | MIR pipeline | **P2 (설계)** | 평가 데이터 선행 |
| Stem / DSP / Perceptual ABR / Transition | 중 | 매우 높음 | 변형·stem 특약 Q14 | — | 높음 | Playback | **P2 (연구)** | 실험 트랙 |
| CD Digital Upgrade, CD 리핑 | 중 | 중 | **Legal (Q11)** | 권리자 Offer | — | Collection | **P2** | 계약 필요 |

### 0.6 P0 요구사항 집합 (구현 대상)

- ACC-001–005, ACC-009 (ACC-004는 한도 *메커니즘*을 구현하고 수치는 설정값으로 둔다 — 값은 Q03)
- AUD-001–016, AUD-017 (잠정 ladder, ADR로 provisional 명시)
- PLY-001–011, PLY-014–017 (PLY-009·010은 fixture 카탈로그, PLY-012 오프라인 제외, PLY-013은 서버 측 license_country 정책으로 구현하고 실제 국가 판정 규칙은 Legal 문서화)
- LIB-001–010, LIB-012
- LOG-001–005, LOG-008, LOG-009 (LOG-006 ASR은 P2, LOG-007은 안내 문구만 문서화)
- STU-001, STU-002, STU-004
- CAT-002–005, CAT-008 (CAT-001/006/007/009는 Legal 문서)
- COM-009, COM-016 (entitlement 모델·검사), COM-007의 원장 구조는 P1
- TRU-001(기본), TRU-002(검증 수준 enum은 원문 합집합으로 저장), TRU-004, TRU-007, TRU-009(신고 접수), TRU-010
- DIG-001–007, DIG-018–023, DIG-025, DIG-026
- SRC-001–003, SRC-007–009
- DSC-004, DSC-006
- OPS-007(문서·감사 구조), OPS-010
- 모든 Confirmed NFR, 그리고 P0 기능이 의존하는 NFR

### 0.7 P0 출시(내부 알파) 종료 조건
1. 타 계정 private 자료 접근 0건(목록·검색·재생·export·DIG·playlist 경로의 negative test 통과)
2. 업로드 재시도·중복 finalize·job retry가 멱등
3. 삭제가 원본·파생물·검색 인덱스에 전파되고 tombstone이 재생성을 막음
4. 권리 철회 후 신규 재생 세션 거부, 기존 세션 refresh 거부, media 자격 만료 ≤ 60초
5. DIG: 모든 relation에 근거·provenance·verification 표시, 사실/추론 구분, Deep Cut이 인지도 구간을 분리
6. clean clone에서 bootstrap/build/test/lint/typecheck 통과

## 1. 원문별 MVP 정의

### 1.1 audio-platform (AP-02 §단계와 종료 조건)

> "MVP는 M1이며 M0의 기능을 포함합니다."

| 단계 | 포함 범위 | 종료 조건 |
|---|---|---|
| M0 내부 알파 | 계정, 비공개 업로드, Audio Log, 객체 모델, 통합 플레이어, 삭제·내보내기, 운영 콘솔 | 접근 격리·원본 복구·업로드 재시도·삭제 전파 검증 |
| M1 제한 공개 MVP | 직접 허가 카탈로그, 유료 구독, 앨범 판매, entitlement, 기본 Passport/AI 공개, 실물 수동 등록, 사람 큐레이션 | 국가별 계약, 결제·환불·권리 취소·정산, SLO와 운영 준비 승인 |

MVP 비약속(AP-02): 마켓플레이스의 모든 종류, 글로벌 카탈로그, 실물 배송, 자동 CD 업그레이드, 완전한 AI 음악 탐지, 전 지역 차트.

### 1.2 DIG PRD (DIG §9)

| 단계 | 포함 기능 | 목적 |
|---|---|---|
| MVP | Rabbit Hole, Credits Digging, Deep Cut, Digging Trail | 메타데이터/관계 그래프 중심으로 DIG 핵심 UX 검증 |

### 1.3 Playbook (PB Phase 2 권장 MVP 후보)

검증 가설: *"사용자는 스트리밍 카탈로그와 자신의 오디오를 하나의 라이브러리/플레이어에서 관리하고, DIG를 통해 능동적으로 음악을 탐험하는 경험에 가치를 느낀다."*

- P0 후보: Auth, Studio Private Upload, Audio Log, Universal AudioObject, Library, Playlist, 기본 Playback, Transcoding, Metadata, Search, Rabbit Hole, Credits Digging, Deep Cut, Digging Trail, 기본 Integrity/rights/audit 구조
- 후순위: Stem Streaming, Personal Acoustic Model, Adaptive Mastering, Perceptual ABR, Sound/Instrument Digging, Full Atlas, CD Digital Upgrade

## 2. 차이 분석 (결정 아님)

| 영역 | AP-02 MVP(M0+M1) | DIG MVP | PB P0 후보 | 비고 |
|---|---|---|---|---|
| 계정·업로드·Audio Log·UAO·플레이어 | ✅ M0 | — | ✅ | 세 원문 일치 |
| 삭제·내보내기·운영 콘솔 | ✅ M0 | — | 명시 없음 (Integrity/rights/audit 구조에 포함 가능) | |
| Library / Playlist | Archive ✅, Playlist는 API에 존재 | — | ✅ | |
| 허가 카탈로그 스트리밍 | ✅ M1 | — | 가설에 "스트리밍 카탈로그" 포함, P0 목록에 계약·결제 미명시 | **CNF-04 핵심** |
| 유료 구독·앨범 판매·entitlement·원장 | ✅ M1 | — | 미명시 | **CNF-04 핵심** — 권리 계약(Q02)·결제(Q04)가 critical path |
| 기본 Passport / AI 공개 | ✅ M1 | — | "기본 Integrity" | |
| 실물 수동 등록 | ✅ M1 | — | 미명시 | |
| 사람 큐레이션 | ✅ M1 | — | 미명시 | |
| 기본 검색 | M1 (AP-06) | — | ✅ | |
| Rabbit Hole / Credits Digging / Deep Cut / Trail | ❌ (DIG 부재, Credits Graph는 M2) | ✅ | ✅ | **CNF-02, CNF-03** |

## 3. 원문 MVP 후보 요구사항 집합

각 원문의 MVP 정의에 해당하는 정규화 ID입니다. Phase 2에서 이 집합들로부터 최종 MVP를 잘라냅니다.

### 3.1 공통(세 원문 모두 또는 AP M0 + PB P0 일치)

ACC-001–005, ACC-007, ACC-009 · AUD-001–017 · PLY-001–007, PLY-011, PLY-014, PLY-017 · LIB-001–010, LIB-012 · LOG-001–005, LOG-007–009 · STU-001, STU-002, STU-004 · CAT-004, CAT-008 · SRC-002, SRC-007 · OPS-007, OPS-010 · ADV-006(원칙)

### 3.2 AP-02 M1에만 해당(PB P0 목록에는 미명시)

ACC-006, ACC-008, ACC-010 · PLY-008–010, PLY-013, PLY-015, PLY-016 · STU-003, STU-005–007, STU-009 · CAT-001–003, CAT-005–007, CAT-009 · COM-001–013, COM-015–018 · COL-001–003, COL-007 · TRU-001–004, TRU-006–010, TRU-012 · SRC-001, SRC-003, SRC-008–010 · DSC-001, DSC-002, DSC-004, DSC-006 · OPS-001–005, OPS-008, OPS-009, OPS-011, OPS-012

### 3.3 DIG MVP / PB P0에만 해당(AP-02에는 없음)

DIG-001–007, DIG-018–023, DIG-025, DIG-026 (DIG-008은 단계 미지정, OQ-DIG-08)

### 3.4 MVP 후보 요구사항 중 미해결 의존

| 요구사항 | 의존 | 비고 |
|---|---|---|
| ACC-004 | Q03 무료 한도 | M0 설계 시 필요 |
| AUD-017 | ADR-04 codec | 플레이어 구현 전 |
| PLY-001 | Q06 지원 기기 | 플레이어 구현 전 |
| PLY-003 | CNF-09 판정 순서 | API 설계 전 |
| CAT-001, COM-011/012/017 | Q02, Q04, Q05 | M1 경로를 택할 경우 출시 차단 |
| TRU-002/003 | CNF-07/08, Q08 | Passport 설계 전 |
| DIG-003/005/006/023 | OQ-DIG-01/09/10, CNF-03 | DIG MVP를 택할 경우 |
| LIB-005 | CNF-13 | CD 항목 재생 범위 |

## 4. 장기 비전 (원문 단계 기준, MVP 후보 아님)

| 원문 단계 | 범위 | 정규화 ID |
|---|---|---|
| M2 제품 확장 | Semantic 검색·Timeline, provenance graph, Studio SaaS, Creator commerce, Music Atlas, 위치 opt-in·Place Memory, 판본 후보 식별, 오프라인 | SRC-004/005/011, TRU-005/011, STU-008, COM-014, ATL-001–014/017/018, LOC-001–007/011, COL-004/008, PLY-012, LOG-006, DSC-003/005, OPS-006 |
| M3 연구 상품화 | DSP·Perceptual ABR·transition·stems, Audio Memory, Context 기능, Drops, Music Migration, 계약형 Upgrade, 허밍 | ADV-001–005, LIB-011, LOC-008/009, ATL-015/016, COL-006, SRC-006 |
| DIG V1 | Crate, Blind, 기본 Scene/Label, 공개 Trail/Crate 모더레이션 | DIG-009–012, DIG-024 |
| DIG V2 | Sound, Instrument, Semantic Audio Timeline | DIG-013, DIG-014 |
| DIG V3 | Sample Archaeology, Time Machine, Atlas 완전 연동 | DIG-015–017 |
| 연구/승인 대기 | 정확 좌표, CD 리핑 | LOC-010, COL-005 |

M3 기능이라도 비공개 격리·권리 확인 같은 기반 요구는 M0부터 적용합니다(AP-02).

## 5. 원문이 제시한 성공 지표

### 5.1 제품 전체 (AP-01, 설계 제안)
- 북극성: 주간 의미 있는 아카이브 활동 사용자 수(유효 청취 후 저장·구매·직접 재청취, Audio Log 생성·재발견, 컬렉션 관리; 봇 제외)
- 방어 지표: 유료 유지율, 청취자당 공헌이익, 무료 사용자당 비용, 아티스트 정산 정확도, 비공개 자료 유출 건수, 스팸 노출 비율, 접근성 오류

### 5.2 DIG (DIG §10)
Dig Start Rate, Nodes per Dig Session, Discovery Save Rate, New Artist Discovery Rate, Trail Save/Share Rate, Dig-to-Purchase Conversion, 30/90-day Rediscovery, Depth Diversity

## 6. Phase 1 → Phase 2 결정 이력

Phase 1에서 열려 있던 CNF-01/02/03/04/05는 §0에서 결정했습니다. 결정 근거와 날짜는 [open-questions.md](../00-product/open-questions.md) §4에 기록했습니다.

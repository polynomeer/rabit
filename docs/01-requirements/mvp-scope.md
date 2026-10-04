# Rabit MVP Scope

- 상태: **Phase 1 초안 — MVP 미확정.** 이 문서는 원문들이 각각 정의한 MVP와 장기 비전을 분리해 나란히 보여줍니다. MVP 경계 결정은 Playbook Phase 2에서 사람의 합의 후 수행합니다(CNF-04).
- 요구사항 ID: [prd.md](prd.md) · 미결정: [open-questions.md](../00-product/open-questions.md)

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

## 6. Phase 2에서 결정할 것

1. **CNF-04**: MVP에 허가 카탈로그·유료 구독·앨범 판매·entitlement를 포함하는가? (포함 시 Q02·Q04·Q05가 출시 critical path)
2. **CNF-01/02**: DIG를 핵심 축으로 공식화하고 REQ 레지스트리에 편입하는가?
3. **CNF-03**: Credits Digging(관계 테이블 기반)을 MVP에 포함하는가? (AP는 Credits Graph를 M2로 둠)
4. **CNF-05**: 통합 단계 표기(P0/P1/P2와 M0–M3·DIG 단계의 관계)
5. 각 후보 기능의 사용자 가치, 구현 난이도, 법률/권리 의존성, 외부 데이터 의존성(예: credits·샘플 관계 데이터 출처), 운영비, 선행 기술 분석 (PB Phase 2)

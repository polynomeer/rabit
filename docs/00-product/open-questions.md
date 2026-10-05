# Rabit Open Questions

- 상태: Phase 1 정규화 초안 (2026-10-04)
- 이 문서는 **결정하지 않습니다.** 원문의 미결정 사항과 원문 간 충돌을 한곳에 모으고, 어떤 요구사항·단계를 막는지 연결합니다.
- 출처 약어는 [glossary.md](glossary.md) 참조. 요구사항 ID는 [prd.md](../01-requirements/prd.md) 참조.
- 상태값: `open` / `decided` (결정 시 결정 근거 문서·ADR 링크를 함께 기록하고 행을 삭제하지 않습니다).

## 1. 원문 제품·사업 미결정 사항 (AP-15 Q01–Q19, ID 보존)

| ID | 질문 | 담당 역할 | 필요 시점 | 막는 요구사항 | 상태 |
|---|---|---|---|---|---|
| Q01 | 첫 국가·법인·언어·미성년자 정책은? | 제품·법무 | M0 설계, M1 출시 전 | ACC-010, CAT-001, NFR-PRV 전반 | open |
| Q02 | 확보한 카탈로그와 streaming/download/preview/analysis 권리는? | 권리 | M1 계약 전 | CAT-001, PLY-009, COM-011 | open |
| Q03 | 무료 용량·길이·프로젝트·분석 예산·초과 유예는? | 제품·재무 | M0 | ACC-004, ACC-006 | open |
| Q04 | Listen/Studio/Archive 가격·세금·결제·수수료는? | 재무·제품 | M1 결제 전 | COM-008, COM-017 | open |
| Q05 | 구매권의 다운로드·재다운로드·종료·환불 범위는? | 법무·제품 | Offer 출시 전 | COM-011, COM-012 | open |
| Q06 | 지원 모바일·웹·desktop·기기와 offline 범위는? | 기술·제품 | player 구현 전 | PLY-001, PLY-012, ADR(client) | open |
| Q07 | 무료 공개 Studio 재생·공개 릴리스 심사·판매자 자격은? | 제품·권리 | 공개 기능 전 | STU-006, STU-009 | open |
| Q08 | Human Only의 assisted·unknown·증거 충족 기준은? | Trust·제품 | M1 추천 전 | TRU-003, TRU-006 | open |
| Q09 | 지역 차트의 현지인 정의·기여 동의·k threshold는? | 데이터·개인정보 | M2 수집 전 | ATL-010, ATL-012 | open |
| Q10 | Legends·Decades의 적법한 과거 자료 출처는? | 콘텐츠·권리 | M2 공개 전 | ATL-006, ATL-017 | open |
| Q11 | CD 리핑·matching·판본·Upgrade 계약 조건은? | 법무·권리 | 해당 기능 전 | COL-005, COL-006 | open |
| Q12 | MG·선급·무료 비용·GPU·CAC·현금 runway 승인 상한은? | 경영·재무 | 상업 계약 전 | NFR-COST 전반 | open |
| Q13 | 전사·LLM·국외 이전·데이터 삭제 및 보존 기간은? | 개인정보·기술 | 분석 opt-in 전 | LOG-006, SRC-004, NFR-PRV-008 | open |
| Q14 | 상업 음원 DSP·stems·변형·분석을 어디까지 허용? | 권리·오디오 | M3 실험 전 | ADV-001–005, DIG-014 | open |
| Q15 | Creator commerce에 팬 멤버십·후원·실물·티켓 중 무엇을 포함? | 제품·법무 | M2 범위 확정 | COM-014 | open |
| Q16 | curator 유료 홍보·팔로우 공개·알림·분쟁 정책은? | 제품·Trust | 해당 기능 전 | DSC-001, TRU-010 | open |
| Q17 | 정확한 위치 기록·친구 Drop·아동과 안전 정책이 필요한가? | 개인정보·제품 | M3 연구 전 | LOC-009, LOC-010 | open |
| Q18 | 운영 인력·온콜·권리자 response deadline은? | 운영·SRE | 공개 출시 전 | OPS-011 | open |
| Q19 | 이전 대화의 가격·브랜드·기타 결정이 추가로 존재하는가? | 제품 | 원문 확보 시 | 전체 (AP 세트는 참조 대화 최근 6개 턴만 근거) | open — 브랜드명은 BRD로 일부 해소 |

## 2. DIG 미결정 사항 (DIG §12)

| ID | 질문 | 막는 요구사항 | 상태 |
|---|---|---|---|
| OQ-DIG-01 | Knowledge Graph를 관계형 DB로 시작할지, 그래프 DB를 초기부터 도입할지 (AP-05·AP-06·PB는 RDB 우선을 제안) | DIG-023, ADR-08 | open |
| OQ-DIG-02 | segment embedding 기본 길이와 overlapping window 정책 | DIG-013 | open |
| OQ-DIG-03 | Sound Digging을 서버 사전 분석 중심으로 할지, on-device 분석을 허용할지 | DIG-013 | open |
| OQ-DIG-04 | Scene taxonomy를 편집팀이 관리할지 community contribution을 허용할지 | DIG-012 | open |
| OQ-DIG-05 | Crate 생성에서 개인화 추천을 어느 수준까지 허용할지 | DIG-009 | open |
| OQ-DIG-06 | 샘플/영향 관계 데이터의 외부 라이선스와 검증 체계 | DIG-003, DIG-015, DIG-018 | open — **Legal Review Required** |
| OQ-DIG-07 | 공개 Digging Trail/Crate의 신고·모더레이션 정책 | DIG-005, DIG-009, DIG-024 | open |
| OQ-DIG-08 | Dig Session Summary(DIG §3.13)의 단계는? DIG §9 단계표에 없음 | DIG-008 | open |
| OQ-DIG-09 | 공개 Trail 공유가 MVP 범위인가? (DIG §3.2는 공개 Trail 언급, §9 MVP는 "Digging Trail"만 명시) | DIG-005 | open |
| OQ-DIG-10 | Rabbit Hole MVP에서 제공할 관계 축은 어디까지인가? Similar Sound(오디오 유사도)·Local Scene은 V2/V3 기술(semantic, Atlas)에 의존 | DIG-003 | open |

## 3. 브랜드·디자인 미결정 사항 (BRD §15)

| ID | 질문 | 상태 |
|---|---|---|
| OQ-BRD-01 | UI Typeface (플랫폼 네이티브 산세리프 vs Noto Sans 계열) | open |
| OQ-BRD-02 | Tagline (Primary candidate: "Music takes you further.") — 상표·마케팅 검토 필요 | open |
| OQ-BRD-03 | 컬러 HEX 확정 (WCAG 대비·OLED/다크모드 테스트 후) | open |
| OQ-BRD-04 | 서브브랜드 명칭 (DIG / Atlas / Studio / Archive / Trust — Working) | open |
| OQ-BRD-05 | 로고 clear-space 단위·최소 크기 수치 (최종 벡터 확정 후) | open |

## 4. 원문 간 충돌 (Phase 0 C1–C20 → CNF)

해소 전까지 관련 요구사항은 원문 표현을 병기합니다.

| ID | 충돌 | 위치 | 결정 필요 사항 | 막는 단계 | 상태 |
|---|---|---|---|---|---|
| CNF-01 | 제품 축 6개(Dig 없음) vs 7개(Dig 포함) | AP-01 §여섯 가지 철학 vs BRD §1, PB §0 | Dig을 핵심 축으로 공식화할지 | Phase 2 | **decided** 2026-10-04 (product owner): DIG는 핵심 축. 제품 축은 7개 (Listen/Own/Create/Collect/Remember/Trust/Dig) — [mvp-scope §0](../01-requirements/mvp-scope.md) |
| CNF-02 | DIG가 AP-02 REQ 레지스트리에 없음 | AP-02 vs DIG | DIG 요구사항을 REQ 레지스트리에 편입할지 (Phase 1은 `DIG-xxx`로 등록하고 REQ 매핑은 `—`) | Phase 2 | **decided** 2026-10-04: DIG 요구사항을 정규화 레지스트리의 `DIG-xxx`로 공식 편입. AP REQ 레지스트리는 보존(원본 무수정) |
| CNF-03 | Credits 탐색 단계: Credits Graph M2 vs Credits Digging DIG-MVP / PB P0 | AP-02 REQ-09 vs DIG §9 vs PB Phase 2 | Credits Digging(관계 테이블 기반)을 MVP에 포함할지 | Phase 2 | **decided** 2026-10-04: Credits Digging은 MVP(P0). 관계 테이블 기반, graph DB 없음. AP의 Credits Graph(TRU-005, cover/sample 등 확장 관계)는 M2 유지 |
| CNF-04 | **MVP 정의**: AP-02 MVP=M1(유료 구독·앨범 판매·허가 카탈로그·entitlement 포함) vs PB 권장 P0(Auth, Private Upload, Audio Log, UAO, Library, Playlist, Playback, Transcoding, Metadata, Search, DIG MVP, 기본 Integrity/rights/audit — 결제·구독·카탈로그 계약 미언급) | AP-02 §단계 vs PB Phase 2 | MVP 경계와 검증 가설 | **Phase 2 진입 조건** | **decided** 2026-10-04: MVP = PB 가설 중심 범위. 상업 카탈로그 계약·결제 제공자·가격·실판매는 사람 결정이 필요한 **Commercial Gate** 트랙으로 분리하고, entitlement/rights 구조와 접근 시점 검사는 자체 제작 fixture로 MVP에 구현 — [mvp-scope](../01-requirements/mvp-scope.md) |
| CNF-05 | 단계 명칭 3종: M0–M3 / DIG MVP·V1–V3 / P0–P2 | AP-02, DIG §9, PB | 통합 로드맵 표기 | Phase 2 | **decided** 2026-10-04: 통합 표기 P0(MVP)/P1(MVP 직후, gate 해소 시)/P2(장기). M0–M3·DIG 단계는 원문 출처 표기로만 보존 — [roadmap](../plans/roadmap.md) |
| CNF-06 | Requirement ID: REQ-01–24 vs PB의 도메인 ID | AP-02 vs PB Phase 1 | Phase 1에서 도메인 ID를 주 ID로 쓰고 REQ를 보존 매핑함 (제안) | — | **decided** 2026-10-04 (Phase 1): 도메인 ID가 주 ID, REQ는 매핑 보존 |
| CNF-07 | Provenance 검증 수준 enum 불일치 | AP-03 AC-09 vs AP-10 §Passport | 최종 enum (distributor_verified 포함 여부, process_evidence_reviewed 포함 여부) | Phase 4, 16 | open |
| CNF-08 | "Verified Human Performance" vs "Human Verified" | AP-10 vs PB | 공식 명칭 | Phase 16 | open |
| CNF-09 | 재생 판정 순서 불일치 | AP-03 §공통 재생 vs AP-08 §재생 판단 | AP-00 규칙상 권한 정본은 AP-08. AP-03 갱신 여부 확인 | Phase 6–7 | **decided** 2026-10-04 (ADR-0016): 구현은 AP-08 순서를 따름 |
| CNF-10 | Visibility에 `Unlisted` 포함 여부, `Release`를 visibility로 볼지 상태로 볼지 | PB Phase 4 vs AP-03/05/07 | Visibility enum | Phase 4 | open |
| CNF-11 | "Track" 엔티티 부재 | PB Phase 4 vs AP-05 | Track 정의 (glossary 잠정 해석 승인 여부) | Phase 4 | open |
| CNF-12 | DIG 데이터 모델(AudioObject에 rights/fingerprint, 범용 MusicRelation, Label/Scene/Place 엔티티) vs AP-05 모델 | DIG §6 vs AP-05 | 통합 도메인 모델 | Phase 4 | open |
| CNF-13 | 플레이리스트의 "CD Library" 재생 | BRD §10 vs AP-09 §CD | CD 항목의 재생 가능 범위(리핑 private source만? 표시만?) | Phase 8 | open — **Legal Review Required** |
| CNF-14 | UI 라벨 "Physical Verified" vs `self_declared/evidence_reviewed` | BRD §6/§10 vs AP-03 | 라벨 매핑 | UX | open |
| CNF-15 | Identity board 카피 "Stream without limits" vs 무제한 약속 금지·무료 카탈로그 없음 | BRD board vs AP-02/03 | 카피 수정 여부 | 마케팅 | open |
| CNF-16 | Atlas 카테고리: Decades 포함 여부, Local Top 표기 "NOW" | AP-03/10 vs BRD §9 | 카테고리·명칭 | Phase 17 | open |
| CNF-17 | ADR 번호: `ADR-01..18` vs `ADR-xxxx-*.md` | AP-15 vs PB §2 | 번호 매핑 규칙 | Phase 3 | **decided** 2026-10-04 (ADR-0000) |
| CNF-18 | 문서 구조: `audio-platform/` vs `docs/` | — | 원본 보존 + docs/를 정본으로 할지 | — | open |
| CNF-19 | Instrument Digging의 stem 활용(V2) vs stems M3·별도 특약 | DIG §3.8 vs AP-02 REQ-14, AP-09 | 권리 확보 전 stem 미사용 여부 | Phase 19 | open — **Legal Review Required** |
| CNF-20 | REQ-16 우선순위 "P0 개인정보, P1 기능" 이중 표기 | AP-02 | 분리 (Phase 1은 LOC-002/003/004=P0 privacy, 기능=P1로 분리 기록) | Phase 2 | **decided** 2026-10-04: LOC-002/003/004 = P0 privacy 원칙(위치 기능 자체는 P2) |

## 4.1 설계 중 발견된 질문 (Phase 4+)

| ID | 질문 | 출처 | 담당 | 상태 |
|---|---|---|---|---|
| DM-01 | 개인 업로드를 카탈로그 Recording에 연결할 수 있게 할 것인가? (예: 내가 녹음한 X의 라이브) MVP는 Audio Log의 `linked_recording_id`만 허용 | domain-model §5 | 제품 | open |
| DM-02 | 계정 삭제 유예(취소 가능) 기간 | domain-model §5 | 제품·법무 | open |
| DM-04 | Audio Log에 연결된 recording에서 DIG를 시작하는 것을 허용할 것인가 (MVP: 허용) | domain-model §5 | 제품 확인 | open |
| RQ-01 | 계약 종료·테이크다운 시 카탈로그 원본·파생 음원을 **반드시** 삭제해야 하는가, 삭제 기한은, 증거 보존(legal hold)을 위해 원본을 남겨야 하는가, 백업에 남은 원본은 언제까지 지워야 하는가? 구현은 운영자의 명시적 삭제만 제공(R10, `POST /v1/ops/recordings/{id}/audio-removal`)하며 자동 삭제·보존 기간은 정하지 않음 | takedown-workflow §2, release-readiness R10 | 법무·권리 | open |
| CNF-11 | Track 정의 | glossary | 기술 | **decided** 2026-10-04 (Phase 4): Track = ReleaseTrack/Recording의 UI 용어, 별도 aggregate 없음 |
| CNF-12 | DIG 데이터 모델 통합 | DIG §6 vs AP-05 | 기술 | **decided** 2026-10-04 (Phase 4): MusicEntity registry + 타입별 테이블, MusicRelation(저장 edge) + Credit/Release에서 파생되는 axis |

## 4.2 Score-to-Audio 제안에서 나온 질문 (2026-10-05)

[PRD §7.1](../01-requirements/prd.md) STU-010–016이 의존합니다. 결정 전에는 해당 요구사항을 구현하지 않습니다.

| ID | 질문 | 막는 요구사항 | 담당 | 상태 |
|---|---|---|---|---|
| SC-01 | 출판 악보를 촬영해 합성 음원으로 렌더링하는 것이 개인 비공개 재생 범위에서도 허용되는가(복제·2차적 저작물, 국가별 차이, Q01 연동)? 공개·공유를 허용한다면 퍼블릭 도메인·본인 창작을 어떤 근거로 판별하는가(작곡가 보호기간 외에 편곡·판본·출판사 조판의 권리 포함)? | STU-014 | 법무·권리 | open — **Legal Review Required** |
| SC-02 | 합성 연주를 Passport 창작 방식 enum(TRU-001 `human/AI_assisted/AI_generated/unknown`)의 어디에 두는가? 규칙 기반 합성(ML 아님)과 ML 연주 모델을 구분해야 하는가? CNF-07·Q08과 함께 결정 | STU-015 | Trust·제품 | open |
| SC-03 | OMR 엔진과 음원(SoundFont·샘플 라이브러리) 라이선스: copyleft(AGPL 등) 엔진의 서버 사용 가능 여부, 샘플의 서버 렌더링·결과물 배포 허용 여부. 서버 처리 vs on-device 처리 선택. 결정 시 ADR 필요 | STU-010 | 기술·법무 | open — 근거: [OMR spike §7](../08-audio-ai/score-to-audio-omr-spike.md) (사진에서 쓸 만한 엔진 homr는 AGPL-3.0, MIT인 oemer는 사진에 취약) |
| SC-04 | 인식·렌더링 작업의 무료/유료 quota와 비용 상한 (Q03·Q12 연동) | STU-010 | 제품·재무 | open |
| SC-05 | 연주 스타일 프리셋에 실존 연주자·밴드 이름이나 특정 녹음 모방을 허용하는가(퍼블리시티권·오인 위험)? | STU-012 | 제품·법무 | open |
| SC-06 | 단계와 범위: OMR 정확도·교정 비용 스파이크(폰 촬영 인쇄 악보 기준) 결과로 P2 편입 여부를 정한다. 손글씨 악보·다성부 피아노·자동 편곡을 범위에 넣는가? | STU-010, STU-011, STU-013 | 제품·기술 | open — 스파이크 완료: [OMR spike](../08-audio-ai/score-to-audio-omr-spike.md) (인쇄 악보 폰 촬영 기준 100음당 교정 중앙값 1.4–5회, 리듬·셋잇단 오류가 주된 교정 대상). 편입 여부는 제품 결정 |

## 5. Playbook §9: 사람이 결정해야 하는 항목 (재확인)

상업 음원 라이선스 조건, 로열티 정산 규칙, CD Digital Upgrade entitlement, UGC 법적 정책, 사용자 콘텐츠 보존·삭제 법적 기간, 결제 환불·소유권 정책, Human Verified 인증 기준, 정확한 위치 저장 정책, 데이터 국외 이전, breaking public API, 비가역 destructive migration, 비용을 크게 늘리는 managed infra, Accepted ADR 번복. 위 Q·CNF 중 해당 항목은 Claude가 임의 결정하지 않습니다.

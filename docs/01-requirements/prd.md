# Rabit PRD — Normalized Requirements

- 상태: Phase 1 정규화 초안 (2026-10-04). 원문의 의미를 바꾸지 않고 재구성한 문서입니다.
- 원문: `audio-platform/` (AP-00–16), `DIG_music_discovery_PRD.docx` (DIG), `Rabit_Brand_Design_Guide.docx` (BRD), `docs/RABIT_CLAUDE_CODE_PLAYBOOK.md` (PB). 원문 파일은 수정하지 않고 보존합니다.
- 용어: [glossary](../00-product/glossary.md) · 미결정/충돌: [open-questions](../00-product/open-questions.md) · MVP: [mvp-scope](mvp-scope.md) · 비기능: [non-functional-requirements](non-functional-requirements.md)

## 0. 읽는 법

### 0.1 Requirement ID
`<DOMAIN>-<NNN>` 형식의 **안정 ID**입니다. 번호는 재사용하지 않으며 요구사항은 삭제하지 않고 상태를 바꿉니다(AP-02 §변경 관리). 원 ID `REQ-nn`은 `REQ` 열에 보존합니다(CNF-06).

| Prefix | 도메인 / Capability | 주요 REQ |
|---|---|---|
| ACC | Account, Workspace, Plan, Consent | REQ-01 |
| AUD | Universal AudioObject, Upload, Processing | REQ-01, REQ-07 |
| PLY | Playback, Streaming, Listening events | REQ-02, REQ-07 |
| ADV | Advanced playback (DSP/ABR/Transition/Stems) | REQ-11–14 |
| LIB | Library, Archive, Playlist, Export, Deletion, Preservation | REQ-04, REQ-19 |
| LOG | Audio Log | REQ-04 |
| STU | Studio (projects, publishing) | REQ-18 |
| CAT | Catalog & Rights | REQ-02, REQ-20 |
| COM | Commerce: Purchase, Subscription, Entitlement, Ledger, Settlement | REQ-02, REQ-03, REQ-17 |
| COL | Physical Collection & Digital Upgrade | REQ-05, REQ-06 |
| TRU | Trust: Passport, Provenance, Credits, Music Integrity | REQ-09, REQ-10 |
| DIG | DIG music exploration | — (CNF-02) |
| SRC | Search & Semantic Audio | REQ-08 |
| DSC | Human discovery & Recommendation | REQ-23 |
| ATL | Music Atlas & Local Charts | REQ-15, REQ-24 |
| LOC | Location, Context, Personal Memory | REQ-16, REQ-21, REQ-22 |
| OPS | Operations, Moderation, Rights-holder response | REQ-20 |

### 0.2 Status
| Status | 의미 |
|---|---|
| **Confirmed** | 원문이 `확정 요구`/`확정`으로 명시했거나, AP 세트·BRD·PB가 일관되게 불변 원칙으로 선언한 것 |
| **Proposed** | 원문의 `설계 제안`. 제품팀 검토 후 확정 필요 |
| **Open** | 미결정 Q 또는 충돌(CNF)에 의존해 내용이 정해지지 않은 것 |
| **Legal** | Legal Review Required. 법률·계약 검토 전 구현·공개 금지 |
| **Deferred** | 원문 단계가 M3, 연구(R), 또는 조건부로 명시된 것 |

### 0.3 Stage
원문이 부여한 단계를 그대로 적습니다: `M0`–`M3` (AP-02), `DIG-MVP`/`V1`–`V3` (DIG §9), `all` (전 단계 기반 요구). **MVP 확정은 Phase 2에서 합니다(CNF-04).**

---

## 1. ACC — Account, Workspace, Plan, Consent

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| ACC-001 | 무료 계정은 개인 오디오, Audio Log, 제한된 Studio 업로드, 컬렉션 기록을 이용할 수 있다 | AP-00 §핵심 결정 | REQ-01 | M0 | Confirmed |
| ACC-002 | 이메일 등 검증된 계정으로 개인 공간과 Studio 공간을 만든다 | AP-03 §계정 | REQ-01 | M0 | Proposed |
| ACC-003 | Workspace는 `personal`/`studio` 유형이며 Membership(UNIQUE workspace,user)과 역할을 가진다 | AP-05, AP-08 | REQ-01/18 | M0 | Proposed |
| ACC-004 | 무료/유료 한도(저장 바이트, 파일 길이, 동시 처리, 월간 분석 예산, 프로젝트 수)는 서버 측 plan policy로 관리한다. 수치는 미정이며 예시값을 영업 약속으로 쓰지 않는다 | AP-02 §상품 권한, AP-03 | REQ-01 | M0 | Open (Q03) |
| ACC-005 | 상향 요금제도 무제한 분석·배포를 약속하지 않는다 | AP-03 §계정 | REQ-01 | all | Proposed |
| ACC-006 | 구독 종료는 구매 권한과 개인 원본을 자동 삭제하지 않는다. 저장 용량 감소 시 유예·내보내기 절차를 적용한다 | AP-02 §상품 권한 | REQ-01/03 | M1 | Proposed |
| ACC-007 | 위치·마이크·전사 동의를 가입 필수로 묶지 않는다. 동의는 목적별(Place Memory, 차트 기여, 주변 소음, 전사, acoustic 선호)로 분리하며 OS 권한이 서비스 동의를 대신하지 않는다 | AP-04 §가입, AP-08 §위치와 동의 | REQ-16 | M0 | Proposed |
| ACC-008 | 유료 상품 선택 시 가격·갱신일·해지·지역 제한을 먼저 보여준다 | AP-04 §가입 | REQ-02 | M1 | Proposed |
| ACC-009 | 가입 → 계정 검증 → 무료 계정 → (직접 녹음/파일 업로드/허가된 미리듣기) → Archive 첫 항목 저장의 활성화 흐름 | AP-04 §가입 | REQ-01 | M0 | Proposed |
| ACC-010 | 미성년자 정책(가입, 녹음, 위치 허용) | AP-04, AP-08, Q01 | REQ-01/16 | M1 전 | Open (Q01) |

## 2. AUD — Universal AudioObject, Upload, Processing

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| AUD-001 | Universal Audio Object는 재생 인터페이스를 통일하지만 권리와 공개 범위를 통일하지 않는다 | AP-00, AP-05 | REQ-07 | M0 | Confirmed |
| AUD-002 | AudioObject(논리 객체) / AudioVersion / AudioSource / AudioAsset(바이트)을 구분한다. master 교체 시 기존 버전을 보존한다 | AP-05 §객체 의미 | REQ-07 | M0 | Proposed |
| AUD-003 | 접근 판정은 AudioSource(origin, workspace, visibility, rights context) 단위이며, 공유 AudioObject ID만으로 비공개 권한을 판정하지 않는다 | AP-05 | REQ-07 | M0 | Proposed |
| AUD-004 | 개인 녹음은 Work/Recording과 연결되지 않아도 존재할 수 있다 | AP-05 | REQ-04 | M0 | Proposed |
| AUD-005 | 업로드 세션은 서버가 허용 key·크기·MIME 후보·checksum·만료·workspace 용량 예약을 발급하고, 클라이언트는 격리 저장소로 직접 전송한다. storage key는 서버가 선택한다 | AP-06 §업로드, AP-07 §업로드 | REQ-01 | M0 | Proposed |
| AUD-006 | 업로드 상태: `created → uploading → uploaded → quarantined → processing → ready`, 오류 `failed`, 취소 `cancelled` | AP-03 §계정 | REQ-01 | M0 | Proposed |
| AUD-007 | 완료 검증 전 재생 링크를 발급하지 않는다. 부분 업로드는 만료 후 정리한다 | AP-03 | REQ-01 | M0 | Proposed |
| AUD-008 | 완료 호출 시 실제 저장 객체의 크기·해시를 검증하고, 확장자가 아닌 실제 포맷을 확인한다. 위험 파일·디코더 오류는 격리한다 | AP-03, AP-06 | REQ-01 | M0 | Proposed |
| AUD-009 | 이어 올리기, 중복 완료 요청, 용량 경쟁, 파일 손상, 업로드 중 계정 삭제, 작업 실패 후 재시도를 지원·검증한다 (AC-01) | AP-03 | REQ-01 | M0 | Proposed |
| AUD-010 | 서로 다른 계정의 해시가 같아도 비공개 존재 여부나 파일을 공유하지 않는다. 개인 원본의 계정 간 전역 dedup을 하지 않는다 | AP-03 AC-01, AP-06 §저장소, ADR-03 | REQ-01/07 | M0 | Proposed |
| AUD-011 | 처리 순서: 원본 검증 → 포맷·duration → fingerprint → loudness·true peak·파형 → codec 변환 → manifest → 선택적 ML → ready. ML 실패가 기본 재생을 막지 않는다 | AP-06 | REQ-07 | M0 | Proposed |
| AUD-012 | 원본은 불변 저장하고 변환 파생물만 재생성한다. 변환 도구·모델 버전과 checksum을 기록한다 | AP-05 §보존, AP-06 | REQ-07/19 | M0 | Proposed |
| AUD-013 | 오디오별 sample rate와 encoder delay/padding을 유지해 gapless를 검증한다 | AP-06 | REQ-07 | M0 | Proposed |
| AUD-014 | lossless는 허용된 원본과 실제 lossless 경로에서만 표시한다 | AP-06, AP-03 REQ-13 | REQ-07 | all | Proposed |
| AUD-015 | 자유로운 외부 URL 가져오기는 MVP에서 제공하지 않는다 (SSRF 방지) | AP-07 §업로드 | REQ-01 | M0 | Proposed |
| AUD-016 | fingerprint 유사성은 병합 후보일 뿐이며 자동 병합으로 구매 권한·원본·provenance·개인 메타데이터를 덮어쓰지 않는다 | AP-05 §불변 조건 | REQ-07 | all | Proposed |
| AUD-017 | codec ladder(AAC 호환 중심 vs Opus/FLAC 확장), bitrate, segment 길이 | AP-06, ADR-04 | REQ-07 | M0 | Open (ADR-04) |

## 3. PLY — Playback, Streaming, Listening events

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| PLY-001 | 공통 플레이어는 AudioObject를 입력받고 서버가 허용한 capability만 사용한다. 대기열, 재생·일시정지·탐색·반복, 기본 음량 정규화, 앨범 순서 재생을 제공한다 | AP-03 §공통 재생 | REQ-07 | M0 | Proposed |
| PLY-002 | 현재 선택된 source(카탈로그/구매/개인 업로드/녹음)를 표시한다. Streaming/Purchased/Private/Physical 상태를 일관되게 보여준다 | AP-03, BRD §6 Ownership Visible | REQ-07 | M0 | Proposed |
| PLY-003 | 재생 판정 순서를 서버에서 시행하며 backend·search·CDN·export가 같은 policy version을 쓴다. 순서는 AP-08(인증 → source·접근 범위 → 계약 rights → entitlement → capability → 세션·기기)이 정본, AP-03 표기와 불일치 | AP-08 §재생 판단, AP-03 | REQ-02/07 | M0 | Open (CNF-09) |
| PLY-004 | DSP·다운로드·stems는 재생과 별도의 capability다. 재생 권한과 export/download 권한을 혼용하지 않는다 | AP-03, AP-07 | REQ-02/03 | all | Proposed |
| PLY-005 | 재생 불가 시 사유(구독 필요/구매 가능/지역·권리 제한)와 대안을 표시한다. 타 계정 비공개 자료는 "찾을 수 없음"으로 응답하고 제목·소유자를 노출하지 않는다 | AP-04 §재생 권한 흐름 | REQ-02/04 | M0 | Proposed |
| PLY-006 | 대기열에서 재생 불가 곡을 자동 건너뛰면 이유와 원래 위치를 유지한다 | AP-04 | REQ-07 | M0 | Proposed |
| PLY-007 | 재생 세션은 source·rights version·entitlement version·지역·capability를 검증해 단기 발급한다. manifest와 segment 모두 보호한다. 제안 만료: 세션 5분, segment 자격 ≤60초 (실험 후 확정) | AP-06 §스트리밍과 CDN, AP-07 | REQ-02 | M0 | Proposed |
| PLY-008 | 권리 철회 시 신규 세션 즉시 거부, 활성 세션 갱신 차단, CDN invalidation/edge deny, 오프라인 라이선스 만료를 함께 적용한다. 버퍼·DRM 없는 다운로드는 회수 불가임을 계약·약관에 반영한다 | AP-06, AP-13 | REQ-02 | M1 | Proposed |
| PLY-009 | 유료 청취자는 현재 계약 지역에서 허가된 곡을 광고 없이 재생한다. 구독 만료·권리 취소 시 신규 세션을 거부한다 | AP-00, AP-02 §사용자 스토리 | REQ-02 | M1 | Confirmed (광고 없음·유료 카탈로그) / Proposed (세부) |
| PLY-010 | 구독 활성·만료·연체·환불·지역 이동, CDN 만료, 네트워크 전환, 대기열 중 권리 취소, 오프라인 캐시 만료를 검증한다 (AC-02) | AP-03 | REQ-02 | M1 | Proposed |
| PLY-011 | quality 표시는 실제 전달과 일치해야 한다. desired_quality가 불가하면 명시적 fallback 또는 오류를 반환한다 | AP-07 §재생 예시 | REQ-02/13 | M0 | Proposed |
| PLY-012 | 오프라인 재생(기기별 암호화·만료·권리 갱신, 구매 download와 구독 offline 분리) | AP-06 | REQ-02 | M2 후보 | Deferred |
| PLY-013 | 라이선스 지역은 계정·결제국·접속국 정책으로 판단하며 Atlas 지역 입력을 사용하지 않는다 | AP-06 | REQ-02/15 | M1 | Legal |
| PLY-014 | 지속 플레이어는 모든 영역에 유지하되 녹음 중에는 충돌을 방지한다 | AP-04 §정보 구조 | REQ-07 | M0 | Proposed |
| PLY-015 | ListeningEvent(`event_id, session_id, sequence, type, client_time, position_ms, played_ms, event_token`; started/heartbeat/seek/paused/ended)를 batch(최대 100)로 수집하고 서버가 duration·세션 유효성으로 검증하며 중복·역순을 견딘다 | AP-07 §주문과 이벤트 계약 | REQ-20 | M1 | Proposed |
| PLY-016 | 정산용 유효 청취 기준(policy_version)과 UI 재생 로그를 구분하며, 사기 탐지·정산을 클라이언트 단독 지표에 의존하지 않는다 | AP-03, AP-07 | REQ-02/20 | M1 | Proposed |
| PLY-017 | 재생 화면은 차분하게 유지하고 재생 중 불필요한 프로모션·CTA를 배제한다 (Calm Playback) | BRD §6 | — | all | Proposed |

## 4. ADV — Advanced Playback

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| ADV-001 | Personal Acoustic Model / Personal Master: 기본 off, Original/Personal A/B, 청력 진단 주장 금지, 건강 관련 정보 취급 | AP-03 §고급, AP-06 | REQ-11 | M3 검증 | Deferred |
| ADV-002 | Adaptive Mastering: 재생 시 DSP 환경 보상·동적 범위 조정, 원본 보존, gain 제한, 소음 입력 opt-in, 실패 시 Original | AP-03 | REQ-12 | M3 검증 | Deferred |
| ADV-003 | Perceptual ABR: 네트워크 버퍼 안정성 우선, lossless 고정 모드 존중, 실제 codec 표시, 무손실 허위 표시 금지 | AP-03, AP-06 | REQ-13 | M3 검증 | Deferred |
| ADV-004 | Musical Transition Engine / Infinite Mix: beat/key/phrase 전환, 앨범 원형 재생 기본, 부재 시 gapless/crossfade | AP-03, AP-06 | REQ-14 | M3 검증 | Deferred |
| ADV-005 | Stem Streaming: 동일 sample clock·alignment, 하나의 stem 지연 시 전체 mix fallback. 상업 녹음의 자동 stem 분리·변형·배포는 별도 허가 전 공개 금지 | AP-06, AP-09 | REQ-14 | M3 | Legal + Deferred (Q14) |
| ADV-006 | 원음을 변형할 수 있는 모든 기능은 Original 모드를 항상 제공한다 | AP-03, PB Phase 18 | REQ-11–14 | all | Confirmed (PB 원칙) |

## 5. LIB — Library, Archive, Playlist, Export, Deletion, Preservation

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| LIB-001 | Archive는 전체, Purchased, Private Audio, Audio Log, 기억, 여행 하위 화면을 가진다 | AP-04 §정보 구조 | REQ-04 | M0 | 일부 구현 (2026-10-08: 전체·개인 오디오·Audio Log·저장한 곡·저장한 앨범 보기. Purchased는 결제(Commercial Gate) 후, 기억·여행은 위치(P2) 필요) |
| LIB-002 | ArchiveEntry: source/release/log 참조, saved_at, origin, user_note | AP-05, AP-07 | REQ-04/19 | M0 | Proposed |
| LIB-003 | Playlist는 기본 private이며 항목은 source 또는 release-track 참조를 순서대로 가진다. 항목 권한은 별도로 판단한다 | AP-05, AP-07 | REQ-07 | M0 | Proposed |
| LIB-004 | playlist에 private source를 추가해도 다른 구성원에게 공개되지 않는다 | AP-07 | REQ-07 | M0 | Proposed |
| LIB-005 | 한 playlist에 Streaming / Purchased / Private / Audio Log가 섞여도 재생 경험은 통일한다. 재생 시 entitlement·visibility를 다시 평가한다 | BRD §10, PB Phase 13 | REQ-07 | M0–M1 | Proposed ("CD Library" 포함 여부는 Open, CNF-13) |
| LIB-006 | 사용자 export는 원본과 metadata/credits/timeline/구매 증빙 중 허용 범위를 압축해 단기 링크로 제공한다. 카탈로그 원본은 권리 허가 없으면 제외한다 | AP-06 §저장소 | REQ-19 | M0 | Proposed |
| LIB-007 | 사용자는 원본과 기록을 내보낼 수 있어야 하며 아카이브 가치를 잠금 효과로만 쓰지 않는다 | AP-01, PB 원칙 4·invariant 12 | REQ-19 | M0 | Confirmed |
| LIB-008 | 삭제: 접수 즉시 신규 접근 차단, 비동기로 원본·검색·벡터·파형·CDN 제거. 삭제 tombstone을 작업 시작·종료 시 검사해 늦게 생성된 파생물 재노출을 막고, 백업 복원 시 재적용한다 | AP-03 AC-04, AP-05, AP-08 | REQ-04/19 | M0 | Proposed |
| LIB-009 | 원본 checksum·버전·복구 가능한 복제, 정기 무결성 검사·복구 drill. 장기 보존은 운영 약속이지 평생 서비스 보증이 아니다 | AP-03 REQ-19, AP-06 | REQ-19 | M0 | Proposed |
| LIB-010 | 포맷 이전 시 원본을 보존하고 새 파생물 checksum·도구 버전을 기록한다 (Progressive Archive) | AP-06 | REQ-19 | M0 | Proposed |
| LIB-011 | Audio Memory Model: Archive·시각·구간을 인용한 답변, 근거 없으면 unknown | AP-03, AP-10 | REQ-19 | M3 | Deferred |
| LIB-012 | 기기 원본 삭제는 서버 저장 검증과 별도 사용자 확인 후에만 | AP-04 §Audio Log | REQ-04 | M0 | Proposed |

## 6. LOG — Audio Log

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| LOG-001 | Audio Log는 별도 플레이어가 아니라 AudioObject의 한 타입(kind `audio_log`)으로, 일반 트랙과 같은 queue·playlist에서 재생된다. UI에 타입 표기를 둔다 | AP-05, BRD §10, PB Phase 12 | REQ-04 | M0 | Confirmed |
| LOG-002 | Audio Log는 기본 비공개이며 공개 음악 릴리스와 다른 흐름이다 | AP-03 §개인 오디오 | REQ-04 | M0 | Proposed |
| LOG-003 | 개인 FLAC/WAV 등 업로드와 마이크 녹음, 제목·태그·노트·연결 곡·날짜를 지원한다 | AP-03 | REQ-04 | M0 | 구현 (2026-10-08: 업로드·녹음, 제목·태그·노트·날짜, 웹에서 카탈로그 곡 연결·해제) |
| LOG-004 | 녹음 흐름: 마이크 권한 → 녹음·중단 → 미리듣기 → 제목·곡 연결·날짜 → 비공개 저장. 클라이언트 임시 녹음은 저장 완료 확인까지 유지하고 재시도·폐기를 제공한다 | AP-03, AP-04 | REQ-04 | M0 | 구현 (2026-10-08: 웹 마이크 녹음 → 미리듣기 → 비공개 Audio Log 저장. MP4/AAC 또는 Ogg/Opus로 녹음, WebM은 허용 형식이 아니라 사용하지 않음) |
| LOG-005 | 타임스탬프는 UTC와 당시 시간대를 함께 저장한다. 날짜·여행 기록 정정이 원본 provenance를 삭제하지 않는다 | AP-03 | REQ-04 | M0 | Proposed |
| LOG-006 | 전사·의미 분석은 별도 opt-in이다. 인식 결과는 편집 가능하며 원본과 수정본을 구분한다. 분석 실패 시 수동 태그와 기본 재생을 제공한다 | AP-03, AP-04 | REQ-04/08 | M2 (ASR) | Proposed |
| LOG-007 | 타인의 목소리가 담긴 자료의 동의·취급 안내를 제공한다 | AP-03, AP-08 | REQ-04 | M0 | Open (정책 미정) |
| LOG-008 | 마이크 거부·중단·저장 실패, 전사 비동의, 타 계정 검색 차단, 원본·메타데이터 내보내기, 삭제 후 파생물 제거를 검증한다 (AC-04) | AP-03 | REQ-04 | M0 | Proposed |
| LOG-009 | Audio Log의 visibility 변경은 권리·공개 정책을 통과해야 한다 | PB Phase 12 | REQ-04 | M0 | Proposed |

## 7. STU — Studio

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| STU-001 | 무료 계정에 제한된 Studio 업로드를 제공한다 | AP-00 | REQ-01/18 | M0 | Confirmed |
| STU-002 | 비공개 프로젝트와 공개 배포를 구분하며, 업로드 성공만으로 공개·수익화되지 않는다 | AP-02 §사용자 스토리 | REQ-18 | M0 | Proposed |
| STU-003 | 공개 흐름: 비공개 프로젝트 → master 업로드 → credits·AI 사용·권리·배포 지역 입력 → 누락 검증 → 검토 요청 → 승인 → 예약 공개 → 판매 | AP-04 §Studio, AP-12 | REQ-09/17/18 | M1 | Proposed |
| STU-004 | 작업 파일·stems·draft가 공개 릴리스와 함께 자동 노출되지 않는다 | AP-04 | REQ-18 | M0 | Proposed |
| STU-005 | 공동작업자 역할(viewer/editor/publisher/owner)을 구분한다. owner도 권리 검토 배지를 자체 발급할 수 없다 | AP-04, AP-08 §접근 통제 | REQ-18 | M1 | Proposed |
| STU-006 | 상업 판매자는 신원·지급정보·세무 조건을 먼저 확인하고, 검증 상태와 정산 보류 사유를 볼 수 있다 | AP-04, AP-12 | REQ-17 | M1 | Legal (Q07) |
| STU-007 | 공개 전 metadata 변경·master 교체는 새 버전 검토를 유발한다. 이미 구매된 상품의 제공 파일을 조용히 바꾸지 않는다 | AP-12 | REQ-18 | M1 | Proposed |
| STU-008 | Studio SaaS: 프로젝트 버전(immutable source refs)·협업·유료 quota·집계 분석 | AP-02, AP-07 M2 | REQ-18 | M2 | Deferred |
| STU-009 | 공개 제작물의 무료 재생은 업로더와 관련 권리자가 허가한 범위로만 운영한다 | AP-01, AP-09 | REQ-01/18 | M1 | Legal (Q07) |

### 7.1 Score-to-Audio (사진 악보 재생) — 제품 제안

원문(AP/DIG/BRD/PB)에 없는 신규 제안입니다(product owner, 2026-10-05). AP REQ 레지스트리에 없으므로 `REQ` 열은 `—`이고, 원문 단계가 없으므로 `Stage`는 통합 표기 후보(`P2 후보`)로 적습니다. 미결정 사항은 [open-questions §4.2](../00-product/open-questions.md)의 `SC-xx`입니다. OMR 정확도·교정 비용 기술 스파이크 전에는 구현하지 않습니다.

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| STU-010 | 사용자가 촬영·스캔한 악보 이미지를 인식(OMR)해 편집 가능한 악보 데이터로 만들고, 합성 음원을 생성해 기존 AudioObject 재생 인터페이스로 재생한다. 인식·렌더링은 멱등·재시도 가능한 백그라운드 작업이다 | Product proposal 2026-10-05 | — | P2 후보 | Deferred (SC-03, SC-04, SC-06) |
| STU-011 | 렌더링 전 인식 결과(음높이·리듬·조표·박자표·성부)를 사용자가 확인·교정할 수 있다. 인식 결과와 사용자 수정본을 구분해 보존한다 | Product proposal 2026-10-05 | — | P2 후보 | Deferred (SC-06) |
| STU-012 | 연주 스타일을 옵션으로 고른다(템포, 루바토, 다이내믹, 스윙, 아티큘레이션 등 해석 파라미터 프리셋) | Product proposal 2026-10-05 | — | P2 후보 | Deferred (SC-05) |
| STU-013 | 파트별 악기를 바꾸거나 기존 파트를 다른 악기로 추가(더블링)할 수 있다. 악보에 없는 새 성부의 자동 생성(편곡)은 이 요구사항에 포함하지 않는다 | Product proposal 2026-10-05 | — | P2 후보 | Deferred (SC-06) |
| STU-014 | 생성 음원은 기본 private이다. 악보 이미지 보유로 작품 권리를 추론하지 않으며, 공개·공유·판매·Studio 공개 흐름(STU-003) 진입은 권리 기준이 정해지기 전 허용하지 않는다 | Product proposal 2026-10-05, PB 원칙 | — | P2 후보 | Legal (SC-01) |
| STU-015 | 생성 음원의 Passport는 연주가 사람의 연주가 아닌 합성임을 표시하고 Human Only 필터 대상에서 제외한다. 원본 작품(Work) 크레딧과 렌더링 도구 사용을 구분해 기록한다 | Product proposal 2026-10-05, TRU-001 | — | P2 후보 | Proposed (SC-02) |
| STU-016 | 업로드된 악보 이미지는 신뢰할 수 없는 입력으로 검증하고 EXIF 위치 등 메타데이터를 제거한다. 이미지·인식 결과·생성 음원은 계정·항목 삭제 정책(LIB)을 따른다 | Product proposal 2026-10-05, PB 원칙 | — | P2 후보 | Proposed |

## 8. CAT — Catalog & Rights

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| CAT-001 | 권리 계약이 승인된 카탈로그만 연결한다. 출시 국가별 streaming·download·purchase·무료 공개 Studio 재생 권리가 없으면 출시 차단 | AP-00 §출시 차단, AP-09 | REQ-02 | M1 | Legal (Q02) |
| CAT-002 | RightsGrant는 rights_holder·resource·territory·uses(streaming/download/preview/transform/stem/analysis)·기간·상태·contract_version을 가진다 | AP-05 | REQ-02 | M1 | Proposed |
| CAT-003 | entitlement 상태와 계약 권리가 모두 허용해야 재생된다. 구매 계약의 지속 제공 조항은 별도 유효 grant로 명시한다 | AP-05 §불변 조건 | REQ-02/03 | M1 | Proposed |
| CAT-004 | 권리 확인은 ingest 시점만이 아니라 접근 시점마다 수행한다 | PB invariant 11, AP-06 | REQ-02 | all | Confirmed |
| CAT-005 | Credit·RightsGrant의 resource 연결은 타입별 FK 또는 참조 무결성 있는 resource registry로 하며 무검증 polymorphic 문자열 ID를 쓰지 않는다 | AP-05 §핵심 ERD | REQ-02/20 | M1 | Proposed |
| CAT-006 | 가사·전사·artwork는 별도 권리. 라이선스 없으면 비노출 | AP-09 | REQ-08/09 | all | Legal |
| CAT-007 | preview와 무료 창작물 재생도 길이·방식·국가·public performance 등 권리를 검토한다 (무료라고 면제하지 않음) | AP-09 | REQ-02/18 | M1 | Legal |
| CAT-008 | 허가 없는 상업 음원을 시험 데이터로 쓰지 않는다. 오디오 fixture는 직접 제작 또는 시험용 권리 보유 자료 | AP-13, AP-14 | REQ-20 | all | Proposed |
| CAT-009 | ML 분석 허가와 학습 허가를 분리한다 | AP-09 | REQ-08/10 | M1 | Legal |

## 9. COM — Commerce

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| COM-001 | 앨범 구매 권한은 구독과 별개다. 구매자는 구독 없이 해당 상품을 재생한다 | AP-00, AP-02 | REQ-03 | M1 | Confirmed |
| COM-002 | 판매 단위는 release edition에 대응하는 Offer다. 구매 시 트랙 목록·품질·가격·세금·통화·다운로드 여부·제공 범위·판매자·환불 조건을 고정한 snapshot을 저장하며 이후 메타데이터 변경이 주문을 덮어쓰지 않는다 | AP-03 §앨범 구매 | REQ-03 | M1 | Proposed |
| COM-003 | 주문 `pending → paid → fulfilled` 또는 `cancelled/expired`. 환불 `refund_pending → refunded/failed`, 전액·부분 환불에 따라 권한 조정 | AP-03 | REQ-03 | M1 | Proposed |
| COM-004 | 지급 확정은 검증된 결제 제공자 이벤트와 대사로만 한다. 사용자 입력으로 결제 확정 API를 제공하지 않는다. `status=paid`는 검증 이벤트 후에만 | AP-03, AP-07 | REQ-03 | M1 | Proposed |
| COM-005 | 결제 webhook은 제공자 서명·timestamp·replay 검사로 인증하고, 먼저 안전 저장 후 응답, 이후 멱등 처리한다. 금액·통화 불일치는 보류한다 | AP-07 | REQ-03 | M1 | Proposed |
| COM-006 | 결제 이벤트 기록·주문 상태 변경·entitlement 생성·outbox 기록은 동일 DB 트랜잭션. 외부 지급은 별도 대사 | AP-05 §불변 조건 | REQ-03 | M1 | Proposed |
| COM-007 | 원장은 복식부기이며 통화별 차변 합=대변 합, 금액은 정수 minor unit, 통화·세금 snapshot 보존 | AP-05 | REQ-03/20 | M1 | Proposed |
| COM-008 | 구독 checkout은 결제 이벤트 확정 후 활성화한다. 해지는 자동 갱신 중단과 즉시 환불을 구분하고 paid_through까지 권한을 약관에 따라 유지한다 | AP-07 | REQ-02 | M1 | Proposed |
| COM-009 | 구독 취소 API는 구매 고객의 entitlement를 회수하지 않는다 | AP-07 | REQ-02/03 | M1 | Confirmed (COM-001 귀결) |
| COM-010 | 결제 확인 중 앱을 닫아도 주문 화면에서 이어지며 webhook 지연 때 재결제를 유도하지 않는다. 동일 상품 보유자에게 중복 구매 전 확인을 제공한다 | AP-04 §앨범 구매 | REQ-03 | M1 | Proposed |
| COM-011 | 구매 파일 다운로드·재다운로드는 구매 계약별. 환불 후 신규 다운로드 거부. 내려받은 허가 파일의 원격 회수를 약속하지 않는다 | AP-02, AP-03 AC-03 | REQ-03 | M1 | Legal (Q05) |
| COM-012 | "소유"를 저작권 양도나 무기한 서버 제공 보증으로 오인시키지 않는다. 서비스 종료·권리 철회 시 처리 조건을 구매 단계에서 보여준다 | AP-01, AP-04, AP-09 | REQ-03 | M1 | Legal |
| COM-013 | 서버 Offer 가격·지역·판매 상태가 정본이며 클라이언트 계산 가격은 정본이 아니다 | AP-07 | REQ-03 | M1 | Proposed |
| COM-014 | Creator commerce(디지털 보너스, 팬 멤버십, 후원 등) | AP-02, AP-11 | REQ-17 | M2 | Deferred (Q15) |
| COM-015 | 정산 상태 `calculated → reviewed → approved → paid`, `held/disputed`. 정정은 correction entry로 남긴다. 지급 계좌 변경·대규모 환불은 승인 분리 | AP-12 §결제와 정산 | REQ-20 | M1 | Proposed |
| COM-016 | Entitlement는 scope·resource·capabilities·origin(order/subscription)·validity·status를 가지며 Ownership·Library membership과 구분한다 | AP-05, PB invariant 2 | REQ-02/03 | M1 | Proposed |
| COM-017 | 가격·세금·결제 제공자·앱스토어 결제 정책·청약철회 | AP-09, Q04 | REQ-02/03 | M1 | Open (Q04) |
| COM-018 | 웹훅 역순·중복, 결제 성공 뒤 응답 유실, 세금 계산, 구매 중 상품 철회, 환불 후 다운로드 거부, 구독 해지 후 구매 앨범 재생을 검증한다 (AC-03) | AP-03 | REQ-03 | M1 | Proposed |

## 10. COL — Physical Collection & Digital Upgrade

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| COL-001 | 실물 항목: 매체 종류, barcode, 카탈로그 번호, 판본 후보, 사용자 입력 소장 정보, 증빙 | AP-03 | REQ-05 | M1 (수동 등록) | Proposed |
| COL-002 | 수동 등록 `self_declared`, 검토한 증빙 `evidence_reviewed`. 이는 소장 기록 수준이지 저작권 보유 인증이 아니다 | AP-03 | REQ-05 | M1/M2 | Proposed |
| COL-003 | 실물 인증만으로 catalog entitlement가 생성되지 않는다 (FK·trigger로도 자동 연결 금지) | AP-00, AP-03 AC-05, AP-05 | REQ-05 | all | Confirmed |
| COL-004 | disc TOC·fingerprint·metadata로 판본 후보와 confidence를 보여주고 사용자가 정정한다. 확정 식별을 약속하지 않는다 | AP-03 | REQ-05 | M2 | Proposed |
| COL-005 | CD 리핑 파일은 법률 검토 후 허용 범위의 개인 비공개 source로만 취급. 리핑 자동 업로드·matched master 제공은 별도 게이트 | AP-03, AP-09 | REQ-05 | — | Legal (Q11) |
| COL-006 | Digital Upgrade는 권리자가 해당 실물 판본에 제공한 Offer가 있을 때만. offer 부재·국가 제한·중복 증빙·양도 분쟁 시 권한 미발급 (AC-06) | AP-03, AP-09 | REQ-06 | M3 조건부 | Legal + Deferred |
| COL-007 | 화면 문구는 "실물 소장 기록"과 "디지털 재생권"을 구분한다 | AP-04 §실물 컬렉션 | REQ-05 | M1 | Proposed (라벨은 CNF-14) |
| COL-008 | 상세 증빙은 분리 key·제한 role의 보안 저장소에 두고 공개 Passport에는 허용 요약만. 결정 후 예시 30일 보존 | AP-05, AP-08 | REQ-05 | M2 | Proposed |

## 11. TRU — Trust: Passport, Provenance, Credits, Music Integrity

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| TRU-001 | Music Passport는 작곡·작사·보컬·악기·믹싱·마스터링·아트워크별 창작 방식(`human/AI_assisted/AI_generated/unknown`), 크레딧, 출처, 권리 확인 범위, 서명 검증 상태, 이의제기 링크를 제공한다 | AP-03, AP-10 | REQ-09 | M1 기본 | Proposed |
| TRU-002 | 검증 수준을 서로 다른 표시로 제공한다 (enum은 AP-03/AP-10 불일치) | AP-03 AC-09, AP-10 | REQ-09 | M1 | Open (CNF-07) |
| TRU-003 | "검증됨" 하나로 모든 사실을 확정하지 않는다. Human 인증은 제작과정 증거 근거 없이 부여하지 않으며 품질·적법성 인증이 아니다 | AP-04, AP-10, PB Phase 16 | REQ-09/10 | M1 | Open (Q08, CNF-08) |
| TRU-004 | Credit: recording/release, contributor, role, creation_method, evidence_ref | AP-05 | REQ-09 | M1 | Proposed |
| TRU-005 | 관계 그래프: cover/remix/sample/remaster/live/demo/instrumental/derived_from을 증거와 함께 관리. 관계 확인은 권리 허가를 의미하지 않는다 | AP-03 | REQ-09 | M2 | Proposed |
| TRU-006 | AI 필터 모드 Open / Transparent(기본 제안) / Human First / Human Only. 미확인 자료를 인간 제작으로 간주하지 않고, 직접 검색·사용자 선택 재생은 계속 허용하며 별도 검색 필터를 제공한다. 정책 변경은 새 추천에 적용하고 제한 사유와 이의제기를 제공한다 (AC-10) | AP-03, AP-10 | REQ-10 | M1 | Proposed (Human Only 기준 Open Q08) |
| TRU-007 | AI 생성 여부, 기술 품질, 스팸 위험, 권리 상태, 추천 적격성은 별도 축이며 별도 score로 저장한다. 단일 "좋은 음악 점수"를 공개하지 않는다. AI-assisted mastering만으로 AI-generated로 분류하지 않는다 | AP-03, AP-10, PB 원칙 6 | REQ-10 | M1 | Confirmed |
| TRU-008 | AI detector는 보조 신호다. AI 판정만으로 삭제·지급 몰수하지 않고 속도 제한 → 추가 증빙 → 추천 보류 → 운영 검토 → 권리 조치 순서와 appeal을 제공한다 | AP-10, AP-12 | REQ-10 | M1 | Proposed |
| TRU-009 | 잘못된 정보 신고와 이의제기 상태를 제공한다. 사용자 신고와 자동 신호를 구분하고 ML score를 사실 판정처럼 노출하지 않는다 | AP-04, PB Phase 16 | REQ-10 | M1 | Proposed |
| TRU-010 | 유료 홍보는 별도 표시하며 인증·Human 배지·품질 점수를 판매하지 않는다 | AP-03, AP-11 | REQ-10/23 | all | Confirmed |
| TRU-011 | provenance 형식: 내부 claim schema + C2PA 연동 후보. 서명 유효성이 신고 사실·저작권·인간 창작을 자동 증명하지 않는다 | AP-10, ADR-07 | REQ-09 | M2 | Open (ADR-07) |
| TRU-012 | 신인·소수 장르를 낮은 재생량 때문에 제거하지 않는다. 노출 탐색 예산과 불확실성 보정 | AP-03, AP-10 | REQ-10 | M1 | Proposed |

## 12. DIG — Music Exploration

원문 DIG PRD에는 상태 표기가 없으므로 기능은 **Proposed**, 단계는 DIG §9를 따릅니다. AP REQ 레지스트리에는 대응 항목이 없습니다(CNF-02). 가장 가까운 원 REQ: REQ-09(Credits Graph), REQ-23(크레딧 탐색·Album-first).

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| DIG-001 | DIG는 Recommendation과 구분되는 능동형 탐험이다. AI는 목적지를 결정하지 않고 탐험 가능한 길과 근거를 보여준다 | DIG §1, PB invariant 7 | — | DIG-MVP | Confirmed (PB invariant) |
| DIG-002 | 플레이어에서 PLAY와 DIG를 분리한다. DIG는 현재 AudioObject를 중심으로 탐험 인터페이스를 연다 | DIG §4 | — | DIG-MVP | Proposed |
| DIG-003 | Rabbit Hole: 곡/앨범에서 관계 그래프를 열고 사용자가 축(Samples, Influences, Same Producer, Session Musicians, Same Label, Same Scene, Covers, Remixes, Similar Sound, Local Scene 등)을 선택한다 | DIG §3.1 | REQ-09/23 | DIG-MVP | Proposed (MVP 축 범위 Open, OQ-DIG-10) |
| DIG-004 | 모든 연결에 관계 근거('같은 프로듀서', '이 곡을 샘플링함')를 표시한다 | DIG §3.1, §8 | — | DIG-MVP | Proposed |
| DIG-005 | Digging Trails: 경로와 각 이동의 관계 타입·재생·저장·구매를 기록하고 저장·재개·이전 노드 복귀를 지원한다. 공개 Trail은 다른 사용자가 따라갈 수 있다 | DIG §3.2, §4.1, PB Phase 14 | — | DIG-MVP | Proposed (공개 공유 범위 Open, OQ-DIG-09) |
| DIG-006 | Credits Digging: 작곡가·작사가·프로듀서·엔지니어·세션 뮤지션을 탐험 단위로 승격하며 Music Passport Credits와 동일 기반을 쓴다 | DIG §3.3 | REQ-09/23 | DIG-MVP | Proposed (단계 충돌 CNF-03) |
| DIG-007 | Deep Cut Mode: Any / Below Top 50% / Deep Cuts / Obscure 인지도 구간. 절대 재생량과 상대 인지도를 분리해 신인이 불리하지 않게 한다 | DIG §3.11 | — | DIG-MVP | Proposed |
| DIG-008 | Dig Session Summary: 출발/도착점, 관계 수, 새 아티스트/앨범, 건넌 국가·시대·장르, 저장/구매를 Archive에 남긴다 | DIG §3.13 | REQ-19 | 미지정 | Open (OQ-DIG-08) |
| DIG-009 | Crate Digging: Location·Era·Genre·Popularity 조건의 제한된 앨범 Crate, 공개 Crate 탐험 | DIG §3.12 | — | V1 | 일부 구현 (2026-10-08: 개인 Crate, 시대·인기 조건. Location·Genre는 데이터 없음, 공개 Crate는 OQ-DIG-07) |
| DIG-010 | Blind Digging: 아티스트·앨범아트·발매연도·인기를 숨기고 Keep/Pass 후 공개 | DIG §3.10, BRD §8 | — | V1 | 구현 (2026-10-07, dig.md §Blind Digging) |
| DIG-011 | Label Digging (기본): 시대별 작품·장르 변화·아티스트·서브레이블·Scene을 시간축으로 | DIG §3.4 | — | V1 | 일부 구현 (2026-10-07: 연도별 작품·아티스트 활동 기간. 장르·서브레이블·Scene은 데이터 없음) |
| DIG-012 | Scene Digging (기본): Scene = 지역 + 시대 + 장르/문화 + 참여 아티스트, Atlas와 연결 | DIG §3.5 | REQ-15 | V1 | Deferred (OQ-DIG-04) |
| DIG-013 | Sound Digging: 구간 선택 → segment-level embedding 유사 음악 | DIG §3.7 | REQ-08 | V2 | Deferred (OQ-DIG-02/03) |
| DIG-014 | Instrument Digging: 재생 시점 보컬/악기 표시, 악기·음색 기준 탐험 (stem 활용은 권리 게이트) | DIG §3.8 | REQ-08/14 | V2 | Deferred + Legal (CNF-19) |
| DIG-015 | Sample Archaeology: 샘플 계보 양방향 탐험 | DIG §3.9 | REQ-09 | V3 | Deferred + Legal (OQ-DIG-06) |
| DIG-016 | Time Machine Digging: 연도/시대 → 지역 음악 문화 → Scene → 아티스트 → 앨범 → 인물 | DIG §3.6 | REQ-24 | V3 | Deferred |
| DIG-017 | Atlas 연동: Atlas의 모든 결과를 DIG 시작점으로, 세계→지역→도시→시대→Scene→Artist→Album→Credits 방향 | DIG §5 | REQ-15 | V3 (완전 연동) | Deferred |
| DIG-018 | MusicRelation은 from/to entity, relation_type, provenance/source, confidence, verification_state, 유효 기간을 가진다. 검증된 사실 관계와 ML 추론 관계를 UI에서 구분하고, 샘플·커버 관계 표시와 실제 이용허락 상태는 별도 필드로 관리한다 | DIG §6–7, §11, PB Phase 14, invariant 5 | REQ-09 | DIG-MVP | Confirmed (사실/추론 구분) / Proposed (스키마) |
| DIG-019 | 랭킹 원칙: Relevance, Explainability, Novelty, Diversity, Integrity, User Control(인지도·시대·지역·Human/AI 선호). 취향 적합도를 유일 목적함수로 쓰지 않는다 | DIG §8, §11 | — | DIG-MVP | Proposed |
| DIG-020 | Music Integrity의 provenance·spam score를 DIG 후보 랭킹에 적용한다 | DIG §11 | REQ-10 | DIG-MVP | Proposed |
| DIG-021 | DIG 탐험이 현재 재생을 끊지 않도록 playback queue와 exploration state를 분리하고 preview·즉시 전환을 지원한다 | DIG §7 | REQ-07 | DIG-MVP | Proposed |
| DIG-022 | Trail 저장·공유·플레이리스트화 | DIG §4.1 | — | DIG-MVP | Proposed |
| DIG-023 | Knowledge Graph 저장소: 초기에는 관계형 DB edge table 가능, graph DB는 ADR 대상 | DIG §7, §12, AP-05, PB Phase 14 | — | DIG-MVP | Open (OQ-DIG-01, ADR-08) |
| DIG-024 | 공개 Trail/Crate 신고·모더레이션 | DIG §12 | REQ-20 | V1 | Open (OQ-DIG-07) |
| DIG-025 | DigSession/Trail 저장·재개와 empty state | PB Phase 14 | — | DIG-MVP | Proposed |
| DIG-026 | 그래프 시각: 현재 AudioObject 중심 노드, Sound/People/History/Place 큰 축 먼저, 선택 경로만 accent 강조, 지나온 경로 유지 | BRD §8, DIG §4 | — | DIG-MVP | Proposed |

## 13. SRC — Search & Semantic Audio

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| SRC-001 | 기본 검색: 제목·아티스트·앨범·credits | AP-06 §검색 | REQ-08 | M1 | Proposed |
| SRC-002 | 사용자 private audio 검색은 owner scope 안에서만. 검색 실행 전 workspace/visibility/rights scope를 제한하고 결과 반환 때 정본 권한을 재확인한다 (post-filter 단독 의존 금지) | AP-06, PB Phase 15 | REQ-04/08 | M0–M1 | Proposed |
| SRC-003 | 익명 공개 검색에 private workspace를 포함하지 않는다 | AP-07 | REQ-08 | M1 | Proposed |
| SRC-004 | Semantic Timeline: start_ms/end_ms, structure/harmony/rhythm/instrument/acoustic/transcript layer, 모델 버전·confidence 표시. 모델 결과와 수동 수정은 별도 버전 | AP-03, AP-10 | REQ-08 | M2 | Deferred |
| SRC-005 | 개인 Log 문장 검색 → 해당 구간 이동. 결과는 제목·날짜·근거 문장·구간 시작점 | AP-03, AP-04 | REQ-08 | M2 | Deferred |
| SRC-006 | 허밍 검색: 별도 동의, 기본적으로 검색 후 원본 폐기 | AP-03 | REQ-08 | M3 | Deferred |
| SRC-007 | 권한 없는 후보를 LLM이나 reranker에 보내지 않는다. 전사·metadata 내 명령을 따르지 않는다 | AP-06, AP-10 | REQ-08 | all | Proposed |
| SRC-008 | 인덱스 장애 시 허가된 정적 큐레이션으로 fallback, 비공개 semantic 검색은 기본 제목 검색으로 축소 | AP-06 | REQ-08 | M1 | Proposed |
| SRC-009 | exact identity와 fuzzy 검색을 구분하고 popularity만으로 rank하지 않는다. semantic extension point는 설계하되 과구현하지 않는다 | PB Phase 15 | REQ-08 | M1 | Proposed |
| SRC-010 | 음악 가사·전사 공개와 분석은 권리 범위가 확인된 경우만 | AP-03 | REQ-08 | all | Legal |
| SRC-011 | Audio Memory/semantic 답변은 근거 구간만 반환하고 근거 없는 기억 답변을 생성하지 않는다 (AC-08) | AP-03 | REQ-08/19 | M2 | Deferred |

## 14. DSC — Human Discovery & Recommendation

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| DSC-001 | 앨범 페이지, 크레딧 탐색, 큐레이터 팔로우, 오늘의 앨범 하나(Slow Discovery)를 제공한다 | AP-03 REQ-23 | REQ-23 | M1 수동, M2 확장 | Proposed |
| DSC-002 | M1 발견은 사람 큐레이션 중심이다 | AP-02 §단계, AP-06 | REQ-23 | M1 | Proposed |
| DSC-003 | 추천 순서: 허용 카탈로그 후보 → 사용자 AI 정책 → fraud·integrity 적격성 → 선호·다양성·신규 아티스트 탐색 → 표시 순서 | AP-06 | REQ-10 | M2 | Proposed |
| DSC-004 | 개인 자료를 공개 추천·전체 모델 학습에 사용하지 않는다 | AP-06, AP-08, AP-10 | REQ-04/10 | all | Proposed |
| DSC-005 | 구매·재생량을 음악 품질의 절대 기준으로 쓰지 않는다. 단순 CTR 최적화 금지, 저장·자발 재청취·만족을 본다 | AP-01, AP-10 | REQ-10 | M2 | Proposed |
| DSC-006 | 추천/DIG 결과에는 가능한 경우 연결 이유를 표시한다 (Explain Discovery) | BRD §6 | REQ-10 | all | Proposed |

## 15. ATL — Music Atlas & Local Charts

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| ATL-001 | 국가·주·도시를 수동 선택하거나 현재 지역을 사용해 탐색한다. 지도와 동등한 목록 탐색을 제공한다 | AP-03, AP-04 | REQ-15 | M2 | Proposed |
| ATL-002 | 카테고리 NOW(Local Top)/GEMS/LEGENDS/RISING/MADE HERE(+DECADES), 그룹 LIVE/CULTURE/DISCOVER | AP-03, AP-10, BRD §9 | REQ-15 | M2 | Open (CNF-16) |
| ATL-003 | Local Top = 최근(예: 30일) 검증·상한 처리된 관측 청취 순위. 인기와 문화를 구분 | AP-10 | REQ-15 | M2 | Proposed |
| ATL-004 | Local Gems = smoothed 지역 share / 지역 외 share. 작은 분모·표본 억제, confidence·절대량 하한, 파라미터 버전 관리 | AP-10 | REQ-15 | M2 | Proposed |
| ATL-005 | Rising Here = 최근 7일 vs 이전 7일 share 또는 unique-listener 증가, 0 기준 폭증 보정, 봇·캠페인 제외 | AP-10 | REQ-15 | M2 | Proposed |
| ATL-006 | Local Legends = 장기 지속·재청취·지역성·검증 역사 자료·큐레이션. 신생 서비스는 All-time 실측을 주장하지 않으며 editorial을 구분 | AP-10 | REQ-15 | M2 | Proposed (자료 출처 Open Q10) |
| ATL-007 | Made Here = 증거 있는 born/active/recorded 지역 관계, 인기 순위와 별개 | AP-10 | REQ-15 | M2 | Proposed |
| ATL-008 | 기간·집계 기준·자료 출처·표본 한계·마지막 갱신을 표시한다 | AP-03 | REQ-15 | M2 | Proposed |
| ATL-009 | 표본 부족 지역은 숨기거나 상위 지역으로 이동한다. 합성 데이터·가상 차트를 실제 현지 인기처럼 표시하지 않는다 | AP-00, AP-03 AC-15, AP-12 | REQ-15 | M2 | Proposed |
| ATL-010 | 공개 기준(제안): window별 고유 기여자 k≥100, 곡별 기여자≥20. 법적 익명성 보장 아님 | AP-10 | REQ-15 | M2 | Open (Q09) |
| ATL-011 | 고정 일별 snapshot, 조회 제한, small-cell 억제, 필요 시 노이즈로 차분 공격을 줄인다. 조작 의심 snapshot은 보류·새 버전으로 수정 | AP-08, AP-10, AP-12 | REQ-15 | M2 | Proposed |
| ATL-012 | 현지인 차트는 동의받은 stable cohort로만. 자동 장기 위치 추적으로 현지인을 추정하지 않는다. 프런트가 보낸 region은 현지인 증명이 아니다 | AP-10 | REQ-15 | M2 이후 | Open (Q09) |
| ATL-013 | Local popularity ≠ cultural representation. 지역 고정관념을 알고리즘에 심지 않는다 | AP-01, PB invariant 8 | REQ-15 | all | Confirmed |
| ATL-014 | 차트에서 발견해도 청취자의 라이선스 지역에서 재생 불가할 수 있으므로 이유를 표시한다 | AP-03 | REQ-02/15 | M2 | Proposed |
| ATL-015 | Music Migration: 최초 관측·확산 시각화, 문화적 기원을 단정하지 않음 | AP-03, AP-10 | REQ-24 | M2 지도, M3 확산 | Deferred |
| ATL-016 | Historical Listening: 출처 확인된 공연장·스튜디오 이야기 연결 | AP-03, AP-10 | REQ-22 | M3 | Deferred |
| ATL-017 | 차트 데이터·지도·공연장 설명·통계 재사용 이용허가. scraped 차트 재판매 금지 | AP-09 | REQ-15 | M2 | Legal |
| ATL-018 | Atlas는 위치 기반 추측 추천이 아니라 실제 지역 청취 문화와 음악사 탐험이다 | BRD §9 | REQ-15 | M2 | Proposed |

## 16. LOC — Location, Context, Personal Memory

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| LOC-001 | 위치 모드 Off(수동 탐색) / Local(기기에서 region 변환) / Archive(별도 동의, 선택 정밀도 개인 기록) | AP-03, AP-08 | REQ-16 | M2 | Proposed (P1 기능) |
| LOC-002 | Local 모드는 GPS 원본을 API·로그·분석 도구로 보내지 않는다 | AP-08 | REQ-16 | M2 | Proposed (P0 privacy, CNF-20) |
| LOC-003 | MVP·M2 서버는 정확 좌표 저장·지속 백그라운드 추적을 지원하지 않는다 | AP-03, AP-08 | REQ-16 | M0–M2 | Confirmed (P0 privacy) |
| LOC-004 | 지역 차트 집계 기여 동의는 개인 위치 기억 저장 동의와 별개다 | AP-03, AP-08 | REQ-16 | M2 | Proposed (P0 privacy) |
| LOC-005 | 위치 거부 후에도 핵심 재생이 유지되고, 개인 기억을 지워도 구매 권한이 유지된다 (AC-16) | AP-03 | REQ-16 | M2 | Proposed |
| LOC-006 | Place Memory, 곡별 청취 장소, 여행 Soundtrack, Music Map은 사용자가 선택한 기록만 보여준다. 여행 종료 자동 제안도 확인 후 보관 | AP-03, AP-04 | REQ-16 | M2 | Proposed |
| LOC-007 | Place Memory·Music Map에서 장소 삭제 시 관련 Audio Log 원본 삭제 여부를 별도로 선택하게 한다 | AP-04 | REQ-16 | M2 | Proposed |
| LOC-008 | Context Graph, Time Radio/Time Travel/Season/Sunrise·Sunset/Journey: opt-in, 비활성화 가능, 지역 차트보다 우선하는 기본 경험으로 만들지 않음 | AP-03 | REQ-21 | M3 | Deferred |
| LOC-009 | Audio Drop(개인/친구/Artist Location): 수신 동의·차단·만료·안전지역, 운전 중 조작 유도 금지 | AP-03, AP-04 | REQ-22 | M3 조건부 | Deferred (Q17) |
| LOC-010 | 정확 좌표 기록은 원문 아이디어로 보존하되 별도 연구·개인정보 승인 후에만 검토 | AP-03 | REQ-16 | 연구 | Open (Q17) |
| LOC-011 | 개인 coarse Context는 명시 동의 기간, 장소·기간 단위 삭제 지원 | AP-08 | REQ-16/21 | M2 | Proposed |

## 17. OPS — Operations, Moderation, Rights-holder Response

| ID | Requirement | Source | REQ | Stage | Status |
|---|---|---|---|---|---|
| OPS-001 | 신고·권리 요청 흐름: 접수 → 신고자·대상 증거 확인 → 위험·관할 분류 → (지역·기능별 임시 제한 또는 증거 요청) → 업로더 통지·검토 → 결정·근거 기록 → 검색·추천·CDN·정산 반영 → 이의제기·독립 재검토 | AP-12 | REQ-20 | M1 | Proposed |
| OPS-002 | 즉시 차단은 좁게 적용하며 하나의 국가·상품 분쟁을 전체 private 자료 삭제로 확대하지 않는다. 권리자 연락처·비공개 증거를 상대방에게 그대로 공개하지 않는다 | AP-12 | REQ-20 | M1 | Proposed |
| OPS-003 | 국가별 notice/counter-notice, 반복 침해 정책, 보존 의무. 특정 국가 제도(DMCA 등)를 전세계 공통 기한으로 쓰지 않는다 | AP-09 | REQ-20 | M1 | Legal |
| OPS-004 | reason code 분리: 기술 이상, 미신고 AI 사용, near-duplicate 도배, 메타데이터 조작, 스트리밍 사기, 음성 사칭. 판정 근거·정책 버전·reviewer·기간 저장 | AP-12 | REQ-10/20 | M1 | Proposed |
| OPS-005 | 매일 provider 이벤트·주문·entitlement·ledger를 대사한다 | AP-12 | REQ-03/20 | M1 | Proposed |
| OPS-006 | 아티스트 분석은 충분한 집계만 제공하고 팬 개인의 지역 이동·녹음·구매 신원을 기본 제공하지 않는다 | AP-12 | REQ-15/17 | M2 | Proposed |
| OPS-007 | 지원 담당자의 private 오디오 접근은 사유·시간 제한·승인·감사·사용자 지원 동의가 필요하다. 모더레이터는 할당 신고와 최소 증거만 | AP-08, AP-09 | REQ-20 | M0 | Proposed |
| OPS-008 | 사고 runbook: private 유출, 권리 취소 미반영, 결제 중복, 원본 손상, decoder 문제, CDN 장애, 차트 조작, 잘못된 모델 배포 | AP-12 | REQ-20 | M1 | Proposed |
| OPS-009 | 장기 보관 중단·서비스 종료 시 사전 공지·허용 원본 export·구매 download·잔액 정산·법적 보존·개인 삭제 순서를 준비 | AP-12 | REQ-19/20 | M1 | Legal |
| OPS-010 | 운영 콘솔(DLQ 재처리 포함)을 M0에 제공한다 | AP-02 §단계, AP-06 | REQ-20 | M0 | Proposed |
| OPS-011 | 운영 인력·온콜·권리자 response deadline. 내부 목표 제안: 자동 확인 즉시, 분류 1영업일, appeal 1차 5영업일 | AP-12 | REQ-20 | 공개 출시 전 | Open (Q18) |
| OPS-012 | 부당한 Human-only 배제·신인 오탐·장르 편향·appeal reversal을 정기 리뷰한다 | AP-12 | REQ-10 | M1 | Proposed |

---

## Appendix A. Requirement Coverage Matrix

### A.1 AP-02 REQ → 정규화 ID

| REQ | 원 요구사항 | 원 단계/우선순위 | 정규화 ID |
|---|---|---|---|
| REQ-01 | 무료 계정, 제한된 개인 보관 및 Studio 업로드 | M0 P0 | ACC-001–006/009, AUD-005–010/015, STU-001 |
| REQ-02 | 광고 없는 유료 카탈로그 스트리밍 | M1 P0 | PLY-003/007–010/013, CAT-001–004/007, COM-008/016/017 |
| REQ-03 | 앨범 구매, 소유 라이브러리, 계약상 다운로드 | M1 P0 | COM-001–007/009–013/018 |
| REQ-04 | 비공개 개인 오디오, Audio Log, 기록·내보내기 | M0 P0 | LOG-001–009, LIB-001/002/008/012, AUD-004, SRC-002 |
| REQ-05 | CD·Physical Collection 등록·인증·판본 | M1/M2 P1 | COL-001–005/007/008 |
| REQ-06 | 계약 기반 Digital Upgrade | M3 P2 | COL-006 |
| REQ-07 | Universal Audio Object와 Unified Player | M0 P0 | AUD-001–003/011–014/016/017, PLY-001/002/006/011/014, LIB-003–005 |
| REQ-08 | Semantic Audio Timeline/Search, 허밍 검색 | M2/M3 P1 | SRC-001–011, LOG-006 |
| REQ-09 | Provenance/Music Passport/Credits Graph | M1/M2 P0 | TRU-001–005/011, DIG-006/018 |
| REQ-10 | AI 음악 공개·선택권·품질·스팸 대응 | M1 P0 | TRU-006–010/012, DSC-003–006, OPS-004/012 |
| REQ-11 | Personal Acoustic Model/Personal Master | M3 P2 | ADV-001, ADV-006 |
| REQ-12 | Adaptive Mastering/Original 비교 | M3 P2 | ADV-002, ADV-006 |
| REQ-13 | Perceptual ABR/명시적 음질 선택 | M3 P2 | ADV-003, PLY-011 |
| REQ-14 | Transition/Infinite Mix/Stem Streaming | M3 P2 | ADV-004, ADV-005 |
| REQ-15 | Local Charts/Gems/Legends/Rising/Made Here/Atlas | M2 P1 | ATL-001–014/017/018 |
| REQ-16 | 위치 선택권, Place Memory, 여행 기록 | M2 P0/P1 | LOC-001–007/010/011, ACC-007 |
| REQ-17 | Artist/Creator commerce | M1/M2 P1 | COM-014, STU-003/006 |
| REQ-18 | Studio SaaS | M0/M2 P1 | STU-001–009 |
| REQ-19 | Progressive Audio Archive/Audio Memory | M0/M3 P1 | LIB-006–011 |
| REQ-20 | 운영·보안·권리·정산·관측성 | 전 단계 P0 | OPS-001–012, COM-015, PLY-015/016, CAT-005/008, NFR 전반 |
| REQ-21 | Context Graph, Time Radio/Travel, Season, Sunset, Journey | M3 P2 | LOC-008 |
| REQ-22 | Audio Drop/Historical Listening | M3 P2 | LOC-009, ATL-016 |
| REQ-23 | Human Curator/Slow Discovery/Album-first | M1/M2 P1 | DSC-001/002, DIG-003/006 (부분) |
| REQ-24 | Music Migration/지역·시대 탐색/Music Map | M2/M3 P2 | ATL-015, LOC-006, DIG-016 |

모든 REQ-01–24가 최소 1개 이상의 정규화 ID에 매핑되었습니다. 미매핑 REQ: **없음**.

### A.2 DIG PRD → 정규화 ID

| DIG 절 | 정규화 ID |
|---|---|
| §1 제품 정의 | DIG-001 |
| §2 제품 목표 | DIG-001, DIG-004, DIG-005, DIG-008, DIG-022 |
| §3.1 Rabbit Hole | DIG-003, DIG-004 |
| §3.2 Digging Trails | DIG-005 |
| §3.3 Credits Digging | DIG-006 |
| §3.4 Label | DIG-011 |
| §3.5 Scene | DIG-012 |
| §3.6 Time Machine | DIG-016 |
| §3.7 Sound | DIG-013 |
| §3.8 Instrument | DIG-014 |
| §3.9 Sample Archaeology | DIG-015 |
| §3.10 Blind | DIG-010 |
| §3.11 Deep Cut | DIG-007 |
| §3.12 Crate | DIG-009 |
| §3.13 Session Summary | DIG-008 |
| §4 DIG 모드 UX | DIG-002, DIG-005, DIG-022, DIG-026 |
| §5 Atlas 연동 | DIG-017 |
| §6 데이터 모델 | DIG-018 (스키마는 Phase 4, CNF-12) |
| §7 기술 요구사항 | DIG-018, DIG-021, DIG-023, NFR-ARCH-003 |
| §8 랭킹 원칙 | DIG-019 |
| §9 단계 | Stage 열 |
| §10 핵심 지표 | [mvp-scope.md](mvp-scope.md) §5 |
| §11 위험·가드레일 | DIG-007, DIG-018, DIG-019, DIG-020 |
| §12 Open Questions | OQ-DIG-01–07 |
| §13 포지셔닝 | DIG-001, CNF-01 |

### A.3 Brand Guide → 정규화 ID

| BRD 절 | 정규화 ID |
|---|---|
| §1 브랜드 정의 | glossary, CNF-01 |
| §2–5 로고·컬러·타이포·앱 아이콘 | NFR-UX-005–008, OQ-BRD-01–05 |
| §6 UI 원칙 | PLY-002, PLY-017, DSC-006, NFR-UX-001–004 |
| §7 영역별 시각 언어 | NFR-UX-004 |
| §8 DIG/Rabbit Hole | DIG-010, DIG-026 |
| §9 Atlas | ATL-002, ATL-018, LOC-003 |
| §10 Studio/Archive | LOG-001, LIB-005, COL-007, CNF-13/14 |
| §11 모션 | NFR-A11Y-005, NFR-UX-009 |
| §12 접근성 | NFR-A11Y-001–006 |
| §13 카피 | OQ-BRD-02, CNF-15 |
| §14 자산 구조 | NFR-UX-008 |
| §15–16 확정/미확정, 다음 작업 | OQ-BRD-01–05 |

### A.4 상태별 집계

| Status | 건수 (주 상태 기준, 복합 상태는 첫 표기) |
|---|---|
| Confirmed | 17 |
| Proposed | 138 |
| Open | 17 |
| Legal | 17 |
| Deferred | 29 |
| 합계 | 218 |

복합 상태 행(예: `Legal + Deferred`, `Confirmed / Proposed`)은 첫 상태로 집계했습니다. 괄호 안에 Open 의존(Q/CNF)이 붙은 Proposed 행도 Proposed로 집계했습니다. 집계 명령(재현용):

```bash
grep -E '^\| [A-Z]{3}-[0-9]{3} \|' docs/01-requirements/prd.md | awk -F'|' '{s=$(NF-1); gsub(/^ +/,"",s); split(s,a,/[ (\/+]/); print a[1]}' | sort | uniq -c
```

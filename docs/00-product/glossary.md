# Rabit Glossary

- 상태: Phase 1 정규화 초안 (2026-10-04)
- 원칙: 원문 의미를 바꾸지 않고, 원문 간 용어가 다르면 **동의어/충돌**로 표시합니다. 충돌 해소는 [open-questions.md](open-questions.md)에서 결정합니다.
- 출처 약어: `AP-nn` = `audio-platform/nn-*.md`, `DIG` = `DIG_music_discovery_PRD.docx`, `BRD` = `Rabit_Brand_Design_Guide.docx`, `PB` = `docs/RABIT_CLAUDE_CODE_PLAYBOOK.md`.

## 1. 제품 축과 영역

| 용어 | 정의 | 출처 / 비고 |
|---|---|---|
| Rabit | 서비스·브랜드명 (확정). 철자는 `Rabit`, 경험 명칭은 `Rabbit Hole` | BRD §1, §15 |
| Listen | 광고 없는 허가 카탈로그 청취와 재생 | AP-01, BRD §1 |
| Own | 구독과 독립된 앨범 단위 구매·소유 라이브러리 | AP-01 |
| Create / Studio | 개인·창작 오디오 업로드, 프로젝트, 공개 릴리스, 판매 | AP-01, AP-04, BRD §7 |
| Collect | 디지털 앨범과 실물(CD/바이닐) 판본 기록 | AP-01, AP-04 |
| Remember / Archive | 개인 Audio Log, 청취 맥락, 구매·컬렉션을 장기 축적하는 개인 아카이브 | AP-01, BRD §10 |
| Trust | provenance, credits, AI 사용 공개, 권리 상태, 위치 사용 여부의 설명 | AP-01, BRD §6 |
| Dig / DIG | 사용자가 관계를 선택하며 음악을 능동 탐험하는 기능 축. Recommendation과 구분 | DIG §1, BRD §1 — **충돌 CNF-01**: AP-01은 6개 철학(Dig 없음) |
| Atlas / Music Atlas | 지역 청취 문화·음악사 탐험 영역 (Local Top/Gems/Legends/Rising/Made Here) | AP-03, AP-10, BRD §9 |
| Personal Audio Archive | Listen/Own/Create/Collect/Remember/Trust를 통합하는 제품 지향점 | AP-00 |
| PLAY / DIG / ARCHIVE | 최종 구조: 듣기 / 탐험 / 기억과 소유 | DIG §13 |

## 2. 오디오 객체와 카탈로그

| 용어 | 정의 | 출처 / 비고 |
|---|---|---|
| Universal Audio Object (UAO) | 카탈로그·구매·개인 업로드·Audio Log를 동일 재생 인터페이스로 다루는 개념. **재생 인터페이스만 통일하며 권리·공개 범위는 통일하지 않음** | AP-00, AP-05 |
| AudioObject | 재생·분석 가능한 논리 객체. master 교체 시 버전 보존 | AP-05 — DIG §6은 `source, rights, fingerprint` 필드를 직접 가진 단일 객체로 표현(**충돌 CNF-12**) |
| AudioVersion | AudioObject의 버전. recording_id(선택), content_hash | AP-05 |
| AudioSource | 특정 버전이 어떤 유입 경로(origin)·workspace·visibility·rights context로 존재하는지. **접근 판정 단위** | AP-05 |
| Source origin | `catalog` / `private_upload` / `audio_log` / `cd_rip` 등 유입 유형 | AP-05 |
| AudioAsset | 실제 바이트(master/codec/stem/waveform). storage_key, checksum, codec, encryption_key_ref | AP-05. PB: "AudioObject ≠ Audio File" |
| Work | 작곡·작사 등 작품 | AP-05 |
| Recording | 특정 연주·녹음. ISRC(선택) | AP-05 |
| Release | 앨범·싱글 | AP-05 |
| Edition | Release의 판본(판매·실물 대응 단위) | AP-05 |
| ReleaseTrack | Edition 안의 트랙 위치(edition_id, position, recording_id) | AP-05 |
| Track | 원문 AP 세트에는 독립 엔티티 없음. PB Phase 4가 "Track vs Recording vs Release/Album" 구분을 요구 | **충돌 CNF-11** — 잠정 해석: UI 용어 "Track" = ReleaseTrack이 가리키는 Recording의 재생 단위 |
| Album | Release의 UI 용어(대부분 Release/Edition에 대응) | AP-03, DIG |
| Catalog / CatalogAsset | 권리 계약으로 허가된 상업 음원 | AP-02, PB Phase 4 |
| UserUpload / Private upload | 사용자가 업로드한 개인 오디오. 기본 비공개 | AP-03, PB |
| Audio Log | 개인 음성 기록. AudioObject의 한 kind(`audio_log`)이며 기본 비공개 | AP-03, AP-05, BRD §10 |
| Timeline Segment | `start_ms/end_ms`, layer, payload, confidence, model_version을 가진 분석 구간 | AP-05, AP-10 |
| Fingerprint | 음향 지문. 동일성 **후보**일 뿐, 병합·권리·소유 증거가 아님 | AP-05, AP-09 |
| Master | 원본 오디오. 불변 저장, 직접 공개하지 않음 | AP-06 |
| Derivative | 재생용 변환물(codec/manifest/waveform). 재생성 가능 | AP-06 |
| Quarantine | 업로드 직후 검증 전 격리 저장소/상태 | AP-03, AP-06 |
| Codec ladder | 재생용 codec·bitrate 단계. 미확정 | AP-06, ADR-04 |
| Gapless | 트랙 간 무음 없는 연속 재생. encoder delay/padding 보존 필요 | AP-06 |

## 3. 권리·소유·접근

| 용어 | 정의 | 출처 / 비고 |
|---|---|---|
| RightsGrant | 권리자가 resource에 대해 territory·uses(streaming/download/preview/transform/stem/analysis)·기간을 허가한 기록 | AP-05 |
| Rights / RightsClaim | 권리 보유·허가 주장. **Provenance와 별개** | PB Phase 4 |
| Entitlement | 사용자가 특정 resource에 대해 갖는 capability 집합과 유효기간. 주문 또는 구독에서 발생 | AP-05 |
| Ownership (Own) | 앨범 구매의 제품 개념. **저작권 양도나 무기한 서버 제공 보증이 아님** | AP-01, AP-09 |
| Subscription | 유료 Listen 구독(plan, state, paid_through) | AP-05 |
| Library membership | 라이브러리/Archive에 항목이 있다는 사실. Entitlement와 별개 | PB invariant 2 |
| Capability | 재생 세션·source별로 서버가 허용한 동작(play/seek/download/offline/stems/transform/publish/analyze) | AP-03, AP-05, AP-07 |
| Offer | Edition에 대한 판매 조건(지역, 가격 minor unit, 통화, terms_version, capability_set) | AP-05 |
| Offer snapshot | 주문 시점의 상품 조건 고정본. 이후 메타데이터 변경이 주문을 덮어쓰지 않음 | AP-03 |
| Order | 구매 주문. `pending → paid → fulfilled`, `cancelled/expired` | AP-03 |
| Refund | `refund_pending → refunded/failed` | AP-03 |
| Ledger / LedgerEntry | 복식부기 원장. 통화별 차변=대변, 정수 minor unit | AP-05 |
| Purchase vs LibraryItem | 구매(거래 사실)와 라이브러리 항목(표시·정리)은 별개 | PB Phase 4 |
| Territory / License region | 계약상 재생 가능 국가. 계정·결제국·접속국 정책으로 판단하며 Atlas 지역 입력과 무관 | AP-06 |
| Visibility | AudioSource·Playlist의 공개 범위. 원문: `private`, `public`(release 흐름) | AP-03/05/07 — PB는 `Private/Public/Unlisted/Release` 요구(**충돌 CNF-10**) |
| Workspace | 소유 단위. `personal` / `studio` | AP-05 |
| Membership / Role | workspace 구성원 역할(viewer/editor/publisher/owner) | AP-05, AP-08 |
| Physical Item | 사용자가 기록한 CD·바이닐 등 실물 소장 항목 | AP-05 |
| Verification level (physical) | `self_declared` / `evidence_reviewed`. 소장 기록의 수준이며 저작권·재생권 아님 | AP-03 — BRD는 UI 라벨 "Physical Verified"(**충돌 CNF-14**) |
| Digital Upgrade | 권리자가 실물 판본에 제공한 계약형 Offer로만 가능한 디지털 혜택 | AP-03, AP-09 |
| Local Rip / Private Locker | 사용자 로컬 CD 리핑 파일의 개인 비공개 보관. 법률 검토 대상 | AP-03, PB Phase 8 |
| Platform Master Unlock | 실물 기반 플랫폼 master 제공. 계약 없이는 불가 | PB Phase 8 |

## 4. Trust·Provenance·Integrity

| 용어 | 정의 | 출처 / 비고 |
|---|---|---|
| Provenance | 출처·제작 이력에 대한 주장과 증거(ProvenanceClaim) | AP-05, AP-10 |
| Music Passport | 창작 단계별 방식, 크레딧, 출처, 권리 확인 범위, 서명 상태, 이의제기 링크를 보여주는 정보 묶음 | AP-03, AP-10 |
| Creation method | 단계별 `human` / `AI_assisted` / `AI_generated` / `unknown` | AP-10 |
| Verification state (provenance) | AP-03: `self-declared, distributor-verified, signature-valid, rights-reviewed` / AP-10: `self_declared, signature_valid, process_evidence_reviewed, rights_reviewed` | **충돌 CNF-07** |
| Verified Human Performance / Human Verified | 제한된 제작과정 증거 검토 결과. 품질·적법성 인증 아님 | AP-10 / PB — **명칭 충돌 CNF-08** |
| Credits | 기여자·역할·창작 방식·증거 | AP-05 |
| Credits Graph / Provenance graph | cover/remix/sample/remaster/live/demo/instrumental/derived_from 관계와 증거. 관계 확인 ≠ 권리 허가 | AP-03 |
| AI filter mode | `Open` / `Transparent`(기본 제안) / `Human First` / `Human Only` | AP-03, AP-10 |
| Integrity axes | AI 생성 여부, 기술 품질, 스팸 위험, 권리 상태, 추천 적격성은 **서로 다른 축** | AP-03, AP-10 |
| Spam / Fraud | 업로드 도배, near-duplicate, 메타데이터 조작, 청취 조작 등. AI 생성과 별개 | AP-10, AP-12 |
| C2PA | 서명 기반 provenance 참고 표준. 채택 미정 | AP-10, ADR-07 |
| Verified fact vs ML inference | 검증된 사실 관계와 모델 추정 관계. 저장·UI에서 구분 | PB invariant 5, DIG §7 |

## 5. DIG

| 용어 | 정의 | 출처 |
|---|---|---|
| Recommendation | 알고리즘이 취향을 추정해 결과를 제공 (Algorithm → Music → User) | DIG §1 |
| DIG | 사용자가 출발점에서 관계를 선택해 탐험 (User → Connection → Music) | DIG §1 |
| Rabbit Hole | 곡/앨범에서 관계 그래프를 열고 축을 선택하는 핵심 경험 | DIG §3.1 |
| Relation axis | Samples, Influences, Same Producer, Session Musicians, Same Label, Same Scene, Covers, Remixes, Similar Sound, Local Scene 등 | DIG §3.1 |
| MusicEntity | 탐험 가능한 엔터티(artist, album, label, person, scene, place) | DIG §6 |
| MusicRelation | from/to entity, relation type, confidence, provenance (+ verification state, 유효 기간) | DIG §6–7, PB Phase 14 |
| Digging Trail | 탐험 경로(노드·관계 타입·행동)의 기록 | DIG §3.2 |
| DigSession / DigTrailNode | 한 번의 디깅 세션 / 경로의 한 노드 | DIG §6 |
| Credits Digging | 기여자를 탐험 단위로 승격 | DIG §3.3 |
| Deep Cut Mode | 상대적 인지도 구간(Any / Below Top 50% / Deep Cuts / Obscure)으로 유명곡 제외 | DIG §3.11 |
| Crate / Crate Digging | 조건으로 제한된 앨범 묶음을 한 장씩 발견 | DIG §3.12 |
| Scene | 지역 + 시대 + 장르/문화 + 참여 아티스트 | DIG §3.5 |
| Blind Digging | 메타데이터·인기 지표를 숨기고 오디오만 제시 | DIG §3.10 |
| Sound / Instrument Digging | 구간·악기 기반 탐험(segment embedding) | DIG §3.7–3.8 |
| Sample Archaeology | 샘플링 계보의 양방향 탐험 | DIG §3.9 |
| Dig Session Summary | 세션 요약을 Archive에 기록 | DIG §3.13 |

## 6. Atlas·위치

| 용어 | 정의 | 출처 / 비고 |
|---|---|---|
| Local Top (NOW) | 최근(예: 30일) 해당 지역에서 관측된 검증·상한 처리 청취 순위 | AP-10, BRD §9 |
| Local Gems (GEMS) | 지역 외 대비 smoothed 상대 선호(Local Affinity) | AP-10 |
| Local Legends (LEGENDS) | 장기 지속·검증된 역사 자료·큐레이션. 큐레이션임을 명시 | AP-10 |
| Rising Here (RISING) | 지역 내 상승 속도(최근 7일 vs 이전 7일 등) | AP-10 |
| Made Here (MADE HERE) | 증거 있는 born/active/recorded 지역 관계 | AP-10 |
| Decades | 발매 시대 탐색 | AP-03, AP-10 — BRD에는 없음(**CNF-16**) |
| LIVE / CULTURE / DISCOVER | Atlas 그룹: Top·Rising / Legends·Made Here·Decades / Gems | AP-10 |
| Region | 국가·주·도시 계층의 coarse 지역 | AP-05 |
| Location mode | `Off` / `Local`(기기에서 region 변환) / `Archive`(별도 동의 개인 기록) | AP-03, AP-08 |
| Place Memory | 사용자가 선택한 장소별 청취·녹음 기억 | AP-03 |
| Context Graph | 시간·계절·장소 유형 등과 개인 기록의 선택적 연결 (M3) | AP-03 |
| Audio Drop | 장소 기반 오디오 남기기 (M3 조건부) | AP-03 |
| Music Migration | 시점별 최초 관측·확산 시각화. 기원 증명 아님 | AP-03, AP-10 |
| Small-cell suppression | 표본이 작은 지역·곡 집계를 숨기는 프라이버시 조치 | AP-08, AP-10 |

## 7. 고급 재생

| 용어 | 정의 | 출처 |
|---|---|---|
| Original mode | 원음 그대로의 재생. 변형 기능의 기본/복귀점 | AP-03, PB Phase 18 |
| Personal Acoustic Model / Personal Master | 청취 장치·선호 기반 개인화 DSP 설정 | AP-03 |
| Adaptive Mastering / Loudness | 재생 시 DSP로 환경 보상·동적 범위 조정 | AP-03 |
| Perceptual ABR | 네트워크 + 지각 품질 기반 적응형 bitrate | AP-03 |
| Musical Transition Engine / Infinite Mix | beat/key/phrase 기반 곡 전환 | AP-03 |
| Stem Streaming | 허가된 stem 동기 재생 | AP-03 |

## 8. 문서·프로세스 용어

| 용어 | 정의 | 출처 |
|---|---|---|
| M0 / M1 / M2 / M3 | 내부 알파 / 제한 공개 MVP / 제품 확장 / 연구 상품화. 의존 순서이며 일정 아님 | AP-02 |
| MVP / V1 / V2 / V3 (DIG) | DIG 기능 단계 | DIG §9 |
| P0 / P1 / P2 | AP-02: 단계 출시 필수 / 핵심 확장 / 연구·후속. PB Phase 2도 같은 표기 사용 | AP-02, PB |
| 확정 요구 / 설계 제안 / 가정 A / 미결정 Q / 검증 R | AP 세트의 진술 분류 | AP-00 |
| REQ-nn | AP-02의 원 요구사항 ID (보존) | AP-02 |
| ADR-nn | AP-15의 원 ADR 주제 ID (모두 proposed) | AP-15 |
| AC-nn / TEST-nn | 수용 기준 / 검증 ID | AP-03, AP-13 |
| Eₙₙ / Bₙₙₙ | 에픽 / 최초 티켓 | AP-14 |

# 음원 오디오 플랫폼 요구사항 추적표와 출처

이 문서는 현재 요청과 조회된 원문에서 가져온 아이디어가 어디에 반영됐는지 추적합니다. 새 기술 선택과 기간·수치는 설계 제안이며 원문 확정사항으로 표시하지 않았습니다. 원문 전체 확인 한계는 [00](00-master.md)에 기록되어 있습니다.

## 요구사항에서 구현과 검증까지

| 요구사항 | 기능 정본 | 데이터 및 API | 검증 | 에픽 |
|---|---|---|---|---|
| REQ-01 무료 계정·업로드 | 03 계정 | 05 Workspace/Source, 07 upload | AC-01/TEST-01 | E01/E03 |
| REQ-02 유료 스트리밍 | 03 재생 | RightsGrant/Entitlement, playback | AC-02/TEST-02 | E04/E06/E07 |
| REQ-03 앨범 소유 | 03 구매 | Offer/Order/Ledger, orders/download | AC-03/TEST-03 | E07/E10 |
| REQ-04 비공개·Log | 03 개인 | AudioLog/Archive, exports/delete | AC-04/TEST-04 | E05 |
| REQ-05 Physical 인증 | 03 실물 | PhysicalItem/Evidence, verification | AC-05/TEST-05 | E10/E16 |
| REQ-06 Upgrade | 03 실물, 09 조건 | Offer/Entitlement, upgrade-offers | AC-06/TEST-05 | E21 |
| REQ-07 UAO | 03 재생, 06 처리 | Object/Version/Source/Asset | TEST-01/02 | E02/E04 |
| REQ-08 Semantic | 03 semantic, 10 | TimelineSegment, semantic-search | AC-08/TEST-08 | E13 |
| REQ-09 Passport | 03 provenance, 10 | Claim/Credit/Relationship, passports | AC-09/TEST-09 | E08/E16 |
| REQ-10 AI·품질·spam | 03 Integrity, 10 | preference/ModerationCase, reports | AC-10/TEST-09 | E08/E12 |
| REQ-11 Acoustic | 03 고급, 06/10 | device preference, compare 확장 | TEST-AV/R05 | E17 |
| REQ-12 Mastering | 03 고급, 06/10 | DSP config, playback mode | TEST-AV/R06 | E17 |
| REQ-13 Perceptual ABR | 03 고급, 06/10 | device capability·quality | TEST-AV/R07 | E17 |
| REQ-14 Transition·stems | 03 고급, 06/10 | asset alignment, transition-plans | TEST-AV/R08 | E18 |
| REQ-15 Local·Atlas | 03 지역, 10 | Region/ChartSnapshot, charts | AC-15/TEST-15 | E14 |
| REQ-16 위치·Memory | 03 위치, 08 | Consent/Context/Trip | AC-16/TEST-15 | E14/E19 |
| REQ-17 Creator commerce | 03 구매, 04/11 | seller/Offer/ledger | TEST-03 | E10/E15 |
| REQ-18 Studio SaaS | 03 계정, 04/11 | Project/Version/Membership | TEST-18 | E09/E15 |
| REQ-19 Progressive·Memory | 03 고급, 06/10 | hash/export/grounding | TEST-04/08 | E05/E19 |
| REQ-20 보안·운영·권리 | 08/09/12/13 | 감사·case·ledger·metrics | TEST-20 | E12 |
| REQ-21 시간·Context | 03 고급, 04/10 | Context/Trip·동의 | TEST-CTX | E19 |
| REQ-22 Audio Drops | 03 고급, 04/08 | audience/expiry·동의 | TEST-CTX | E20 |
| REQ-23 Human Curator | 01/03/04/10 | curator·release 관계 | UX·노출 정책 검증 | E11 |
| REQ-24 시대·Migration·Map | 03 지역, 10 | snapshots·Trip·Region | TEST-15/CTX | E14/E20 |

문서 번호는 [00 지도](00-master.md)에서 바로 이동하실 수 있습니다. API 확장 예약이 없는 장기 기능은 실제 착수 전 schema·권한 계약을 추가해야 합니다.

## 원문에서 추가 보존한 아이디어

조회된 기술 논의에서는 Universal Audio Object, fingerprint, Semantic Timeline, 구조·악기·허밍 검색, Personal Acoustic Model, Adaptive Mastering, Perceptual ABR, Transition/Infinite Mix, provenance graph, CD 판본, Personal Master, Progressive Archive와 Audio Memory Model을 확인했습니다.

AI 논의에서는 AI 생성·저품질·스팸의 구분, 창작 단계별 Passport, 사용자 Open/Transparent/Human First/Human Only, 의도적 청취·구매 신호, album 중심, credits, Verified Human Performance, Human Curator와 Slow Discovery를 확인했습니다.

시간·장소 논의에서는 Place Memory, 곡별 청취 장소, Local Artist Radar, Time Radio, Time Travel, Season Memory, Sunrise/Sunset Sessions, Journey Soundtrack, 개인·친구·Artist Audio Drop, Historical Listening, Music Map과 Context Graph를 확인했습니다. 현재 요청의 지역 차트 중심 방향을 우선하고 자동 상황 플레이리스트는 후속 opt-in 기능으로 보존했습니다.

지역 차트 논의에서는 Top/Gems/Legends/Rising/Made Here, 기간·시대·도시 계층, Listen Like a Local, Music Migration, 여행 Archive, 위치의 기기 내 region 변환, 최소 집계와 LIVE/CULTURE/DISCOVER 구분 및 Music Atlas를 확인했습니다.

## 외부 출처와 사용 범위

| 출처 | 문서에서 지원하는 내용 | 확인 한계 |
|---|---|---|
| [한국 저작권법 공식 페이지](https://www.law.go.kr/법령/저작권법) | 출시 전 법령 검토 대상 | 조문 본문 자동 조회 불가, 자문 미완료 |
| [개인정보 보호법 공식 페이지](https://www.law.go.kr/법령/개인정보보호법) | 개인정보 검토 대상 | 최신 조문·시행일 검증 대기 |
| [위치정보법 공식 페이지](https://www.law.go.kr/법령/위치정보의보호및이용등에관한법률) | 위치 목적·동의 검토 대상 | 신고·허가·의무 적용 자문 필요 |
| [미국 저작권청 권리 구분](https://www.copyright.gov/register/pa-sr.html) | 음악 작품과 녹음물 권리의 구분 | 미국 설명, 한국 계약 증거 아님 |
| [미국 저작권청 MMA](https://www.copyright.gov/music-modernization/) | 미국의 관련 statutory 제도 | 모든 권리·국가 허가 아님 |
| [HLS RFC 8216](https://www.rfc-editor.org/info/rfc8216/) | manifest/segment 기반 전달 개념 | 최신 모든 기기 지원 보장 아님 |
| [C2PA 공식 규격 목록](https://spec.c2pa.org/specifications/) | provenance 형식 검토 | 채택 버전·audio 구현 시험 필요 |
| [C2PA 공식 초기 규격 설명](https://spec.c2pa.org/specifications/specifications/1.0/specs/C2PA_Specification.html) | 검증이 가치 판단·사실 판정을 대신하지 않음 | 구현은 현재 적합 버전 별도 선정 |
| [Spotify 2025 공식 20-F](https://www.sec.gov/Archives/edgar/data/1639920/000162828026006874/ck0001639920-20251231.htm) | 원가 구조·2025 Premium gross margin | 우리 사업의 원가·마진 forecast 아님 |

외부 출처의 확인일은 2026년 10월 4일입니다. source 내용을 길게 복제하지 않고 핵심 원칙만 적용했습니다. 법률은 검토 목록으로, 기술은 선택 후보로, 경제성 숫자는 가정으로 제시합니다.

## 구현 준비 수준

이 문서 세트는 제품 요구·도메인·아키텍처·API 계약 방향·검증·백로그를 연결한 개발 착수 초안입니다. 실제 권리 계약, 가격, 물리 DDL, 완성 OpenAPI, 화면 디자인, 운영 인력과 연구 성능은 아직 확정되지 않았습니다. 원문 누락 영역이 확보되면 Q19에 따라 차이를 검토하고 기존 문서를 업데이트하십시오.

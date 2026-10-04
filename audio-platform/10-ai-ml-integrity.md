# 음원 오디오 플랫폼 AI ML과 Music Integrity 설계

이 문서는 음악 분석, semantic 검색, 추천, 지역 차트와 신뢰 정책을 분리해 정의합니다. AI 생성 여부, 음악의 품질, 스팸과 권리 적법성은 서로 다른 판단입니다. 모델 출력은 증거 수준과 오차를 가진 추정이며 단독 권리 판정으로 사용하지 않습니다.

## 처리 계층

허가된 source → 기본 MIR 분석 → 선택적 ASR·음악 구조·악기·embedding → source 단위 검색 인덱스 → 권한·정책 적용 retrieval → 사용자 결과 순서입니다. 각 결과는 model_id/version, input asset hash, 생성일, confidence, evidence span과 사용자 수정 여부를 기록합니다. private 입력은 global training에 포함하지 않습니다.

M1은 fingerprint·loudness·기술 오류 분석·수동 Passport부터, M2는 개인 Log ASR와 segment 검색·음악 구조부터 도입합니다. 악기·화자·코드·장르·허밍은 데이터와 평가 확보에 따라 확장합니다. 가사 분석은 라이선스와 전사 이용 범위를 먼저 확인합니다.

## Semantic Timeline과 Search

segment는 structure/harmony/rhythm/instrument/acoustic/transcript layer를 가집니다. 모델 결과와 수동 수정은 별도 버전이며 탐색 위치의 신뢰도를 UI에 표시합니다. 텍스트 검색·시간 필터·vector 후보를 결합하고 사용자 권한을 선필터한 뒤 rerank합니다.

“지난 여름 데이터베이스 설계를 이야기한 녹음”, “마지막에 보컬만 남는 어제 들은 곡”, 허밍으로 기억하는 선율을 지원하는 방향입니다. 음성 특성에서 실제 성별·정체성을 단정하지 않으며 사용자 표현을 음향적 후보 조건으로 해석합니다. Audio Memory 답변은 실제 Archive·시각·구간을 인용하고 자료가 없으면 알 수 없다고 응답합니다. 전사·metadata 내 명령을 따르거나 외부 동작을 실행하지 않습니다.

## Passport와 provenance 신뢰 수준

작곡·작사·보컬·악기·믹싱·마스터링·아트워크마다 `human/AI_assisted/AI_generated/unknown`과 신고자·증빙·확인 범위를 저장합니다. `self_declared`, `signature_valid`, `process_evidence_reviewed`, `rights_reviewed`를 구분합니다. Verified Human Performance는 제한된 제작과정 증거의 검토이지 음악의 우수성이나 법적 적법성 인증이 아닙니다.

C2PA는 source와 history의 서명·무결성을 표현하는 참고 표준입니다. 구현 버전과 오디오 포맷·변환 보존은 ADR에서 시험하십시오. 서명 유효성이 신고 사실·저작권·인간 창작을 자동 증명하지 않습니다. [C2PA 공식 설명과 규격](https://spec.c2pa.org/specifications/specifications/1.0/specs/C2PA_Specification.html), [공식 규격 목록](https://spec.c2pa.org/specifications/)

## AI 필터와 추천

| 모드 | 자동 추천 처리 | 미확인 자료 |
|---|---|---|
| Open | 허용 권리 자료를 방식에 관계없이 후보로 사용 | unknown 표시 |
| Transparent 기본 제안 | Open과 같은 후보, 창작 방식 설명을 더 명확히 표시 | unknown 강조 |
| Human First | 인간 주도 제작을 우선하고 다양성을 유지 | 별도 탐색 예산, 사용자 설명 |
| Human Only | 제품이 정의한 인간 주도 검토 기준을 충족한 후보만 | 자동 추천 제외, 직접 검색 가능 |

Human Only가 AI-assisted mastering을 허용하는지, 신고만으로 기준을 충족하는지는 Q08에서 결정합니다. 이 초안의 보수적 기본은 중요한 창작 단계가 human 또는 허용 assisted이고 미확인 주요 단계가 없는 자료입니다. 직접 검색에는 별도 필터가 없으면 존재를 숨기지 않습니다. 권리 차단은 이 선호와 무관하게 적용합니다.

추천은 선호·앨범 맥락·의도적 재청취·저장·구매·신뢰·장르 다양성·탐색을 결합합니다. 구매는 선호 신호지만 소득·기존 팬·사기 영향을 보정하고 음악 품질의 절대 기준으로 삼지 않습니다. 앨범 완주, credits, 제작 서사와 Human Curator·Slow Discovery를 별도 경험으로 제공합니다.

## 품질과 스팸

기술 품질은 clipping·silence·손상·loudness 이상을, 사용자 만족은 자발적 재청취·저장·신고를, 스팸 위험은 업로드 속도·near-duplicate·계정 그래프·메타데이터 도배·청취 조작을 관찰합니다. 서로 다른 score로 저장하고 단일 “좋은 음악 점수”로 공개하지 않습니다.

AI detector는 codec·리마스터·장르·생성 도구에 따라 오류가 날 수 있는 보조 신호입니다. AI 판정만으로 삭제·지급 몰수하지 않습니다. 속도 제한 → 추가 증빙 → 추천 보류 → 운영 검토 → 권리 조치 순서로 위험을 줄입니다. 고위험 반복 사기는 별도 정책에 따라 제거하고 appeal을 제공합니다. 신인에게 노출 탐색 예산과 불확실성 보정을 적용합니다.

## 지역 차트의 데이터 정의

지역은 국가·주·도시 계층을 사용합니다. 차트 청취 이벤트는 검증된 session, 허용 계약, fraud 제외, 일별 사용자·곡 기여 상한을 통과해야 합니다. 프런트가 보낸 region은 현지인 증명이 아닙니다. 최소 구현은 “해당 지역에서 관측된 참여 계정의 청취”로 표시합니다.

현지인 차트를 별도로 제공하려면 사용자가 선택한 홈 지역 등 허용된 수단으로 정의한 stable cohort를 동의받아 검증하고 여행자·VPN·오류·표본 편향을 공개합니다. 자동 장기 위치 추적으로 현지인을 추정하지 않습니다. 전체 인구의 음악 취향이나 다른 플랫폼 청취까지 대표한다고 주장하지 않습니다.

설계 제안 공개 기준은 window별 고유 기여자 k>=100, 곡별 기여자>=20입니다. 이는 법적 익명성 보장이나 검증된 최적 threshold가 아닙니다. 작은 지역은 상위 지역으로 이동하고 고정 일별 스냅샷·조회 제한으로 차분 공격을 줄입니다. 정확한 기여자 수가 노출 위험이면 범위로 표시합니다.

## 차트 공식 초안

`x(r,t)`는 region r에서 track t의 검증되고 상한 처리된 청취 기여이고 `N(r)=sum_t x(r,t)`입니다. 창구 기간과 처리 버전을 snapshot에 고정합니다.

| 차트 | 제안 계산 | 주의 사항 |
|---|---|---|
| Local Top | 최근 30일 x(r,t) 내림차순 | 실제 count 기반, 재생 상한 공개, 인기와 문화 구분 |
| Local Gems | smoothing한 지역 share / 지역 외 share | 작은 분모·작은 표본 억제, confidence와 절대량 하한 |
| Rising Here | 최근 7일과 이전 7일의 share 또는 unique-listener 증가 | 0 기준 폭증 보정, 최근 가입 봇·캠페인 조작 제외 |
| Local Legends | 장기 지속·재청취·지역성·검증된 역사 자료·큐레이션 | 신생 서비스는 All-time 실측 불가, editorial 구분 |
| Made Here | 증거 있는 born/active/recorded 지역 관계 | 인기 순위와 별개, 관계 종류 표시 |
| Decades | 발매 시대와 적법 확보한 해당 시대 자료의 탐색 | 발매 연도와 당시 실제 인기 순위 구분 |

Gems 계산 예시는 `p_r=(x(r,t)+alpha*p_out)/(N(r)+alpha)`, `p_out`은 r을 제외한 지역의 smoothed share, `affinity=p_r/p_out`입니다. zero floor, alpha, evidence threshold와 score cap은 버전 관리하고 holdout 평가로 정합니다. 양쪽 window·코호트·지역 granularity를 같게 비교합니다. “6배” 표시는 안정적인 표본에서만 가능합니다.

Legends의 구매·Collection 신호는 조작·소득 편향 때문에 보조로만 사용합니다. 세대 간 지속성은 데이터가 없으면 단정하지 않으며 연령 민감정보 수집을 요구하지 않습니다. 사람이 선정한 목록은 큐레이션으로 명시합니다. 전국 인기 곡이 Top에 나타나는 것은 오류가 아니며 지역성은 Gems에서 별도로 제공합니다.

Music Atlas는 LIVE(Top/Rising), CULTURE(Legends/Made Here/Decades), DISCOVER(Gems)를 구분합니다. Music Migration은 시점별 최초 관측·다지역 증가를 시각화하되 실제 전파 인과와 최초 창작지를 증명하지 않습니다. Historical Listening은 검증된 장소·공연·녹음 자료를 연결합니다.

## 연구 기능과 평가

| 기능 | 오프라인 평가 | 출시 실험 |
|---|---|---|
| ASR·semantic retrieval | 언어·억양별 WER, Recall@k, nDCG, 구간 오차 | 찾기 성공·false match·지연 |
| fingerprint·판본 | recording precision/recall, 판본 confusion, abstention | 잘못된 merge·수정 비율 |
| AI·spam | class별 precision/recall, calibration, 신인·장르 FP | 스팸 노출, appeal reversal |
| 추천 | 권리·AI 정책 위반 0 목표, 다양성·신규 아티스트 | 저장·자발 재청취·만족, 단순 CTR 금지 |
| acoustic·mastering | blind loudness-matched A/B, artifact·gain·CPU | 선호, 피로, 배터리, Original 복귀 |
| Perceptual ABR | ABX/MUSHRA 등 설계 적합성 검토, buffer·bitrate | 지각 품질·데이터량·stall |
| transition·stems | beat/phrase alignment, drift·artifact | 전환 만족, skip, 장치 안정성 |
| Audio Memory | groundedness·근거 완전성·ACL canary | 회상 성공·잘못된 단정 |

평가 데이터는 국가·언어·장르·장치·AI 도구·codec별로 나누고 권리·동의 확보와 중복 누출 방지를 확인합니다. 모델은 shadow → 제한 canary → 확대, drift·bias·비용 모니터링 → rollback으로 배포합니다. ASR 동의 철회와 source 삭제가 feature store·vector·평가 데이터에 전파되는지 확인하십시오.

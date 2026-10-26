# Design mockups · Music Exploration Expansion

- Status: **Proposal** (2026-10-26). Canvas: Rabit design canvas (private claude.ai artifact; the owner shares it).
- Pages: **L · 음악 탐험 확장 (웹)** (light), **M · 음악 탐험 확장 (웹 다크)**, **N · 음악 탐험 확장 (iOS)** (dark row, light row).
- Built on design C tokens (ADR-0022): Noto Sans KR, accent `#5A48AA`/`#A898EE`, area colours DIG/Archive/Studio; dark pages reuse the light boards through a theme switch, so both stay identical in content.

## Web (1440, fluid)

| Board | Screen | Requirement | What it shows |
|---|---|---|---|
| XExplore | 탐험 홈 | EXP-001, EXP-006 | Four entry cards (Time Radio, Artist Journey, map, rediscover), trails to resume, curated era × region starts with confirmed-date counts, an opt-in quest strip that can be hidden |
| XTimeSetup | 타임머신 설정 | EXP-001/002/003/007 | Year slider + month/day, optional region, the cutoff instant and time zone in words, modes with the chart mode disabled and its reason, two perspectives, a coverage panel (confirmed / excluded for precision / playable now) with the rights note |
| XTimeRadio | Time Radio | EXP-003/012, EXP-021 | Cutoff banner, now playing with release date + precision + source, upcoming rows with precision badge and playability ("정보만 보기" when not playable), "다음 달로" adding newly released albums |
| XAtlas | 지도로 탐험 (E1) | EXP-008, EXP-025 | Decade chips, abstract map with region pins, map/list toggle, legend by shape (origin, active, recorded, chart-disabled), region panel listing linked artists with link type and source |
| XJourney | Artist Journey | EXP-004/005/013 | Artist header, perspective toggle, timeline of releases (type chip, precision, play) and dated events with sources, pick two to compare, undated group |
| XCompare | 앨범 비교 | EXP-013 | A/B cards with switch-listening, fact table with sources, differences split into "사실" and "편집 해설 (written 2026, not period opinion)" |
| XRelations | 관계 탐색 | EXP-016 | 1-hop graph with breadcrumb history, edge style by evidence (solid/long dash/dotted), selected-edge panel with basis and source, "추정 연결도 보기" toggle |
| XCollection | 도감 (E1) | EXP-010 | Level with "activity, not skill", bounded collections with version and denominator, filled vs not-yet tiles, private badges, hide switch |
| XQuests | 퀘스트 (E1) | EXP-011 | Tabs (진행 중/시작 전/완료), steps marked "서버 확인됨", reward, quit; settings (quests on/off, in-player alerts off by default) and the counting rules |
| XRediscover | 재발견 · 내 음악 타임라인 | EXP-014/015 | Consent strip with off/delete, saved-period chips, two-lane timeline (saved ↔ released), candidates with last-play or "감상 기록 없음 · 저장 날짜 기준", memory notes |
| XNav | Component | — | DIG › 음악 탐험 breadcrumb, "제안 · 승인 전" tag, sub-navigation |

## iOS 26 (402 × 874)

XIExplore, XITimeSetup, XITimeRadio, XIJourney, XIQuests (도감 · 퀘스트), XIRediscover — grouped lists, glass mini player and tab bar as in pages F/G, DIG tab selected. Light versions (`…Light`) use the same boards with the light theme.

## Open design points

- Map visuals are abstract placeholders; a real map needs a licensed tile/boundary source and attribution (08-data-rights).
- Covers are generated stand-ins (ADR-0022) — no real artwork.
- All artist, label and album names are fictional.

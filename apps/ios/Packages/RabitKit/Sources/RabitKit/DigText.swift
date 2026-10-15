/// Korean wording for DIG axes, groups and evidence, matching the web client
/// (apps/web/src/i18n/ko.ts). Unknown codes fall back to what the server sent.
public enum DigText {
  public static func axis(_ axis: DigAxis) -> String {
    [
      "credits": "Credits", "same_producer": "같은 프로듀서", "session_musicians": "세션 뮤지션",
      "artists": "아티스트", "members": "멤버", "member_of": "소속", "tracks": "수록곡", "releases": "릴리스",
      "same_label": "같은 레이블", "samples": "샘플링한 곡", "sampled_by": "이 곡을 샘플링", "covers": "원곡",
      "covered_by": "커버", "remix_of": "원곡(리믹스)", "remixes": "리믹스", "influenced_by": "영향 받음",
      "influences": "영향을 줌",
    ][axis.rawValue] ?? axis.rawValue
  }

  public static func group(_ group: String) -> String {
    ["people": "PEOPLE", "history": "HISTORY", "sound": "SOUND", "place": "PLACE"][group] ?? group.uppercased()
  }

  public static func role(_ role: String) -> String {
    [
      "composer": "작곡", "lyricist": "작사", "producer": "프로듀서", "engineer": "엔지니어",
      "mixing_engineer": "믹싱 엔지니어", "mastering_engineer": "마스터링 엔지니어", "performer": "연주",
      "featured_artist": "피처링", "arranger": "편곡",
    ][role] ?? role
  }

  /// An artist's years on a label: "2019", "2019–2024", or "발매일 미상".
  public static func span(first: Int?, last: Int?) -> String {
    guard let first else { return "발매일 미상" }
    guard let last, last != first else { return String(first) }
    return "\(first)–\(last)"
  }

  public static func tier(_ tier: String) -> String {
    [
      "top": "인기 상위", "upper": "인기 중상위", "deep_cut": "Deep Cut", "obscure": "희귀",
      "unknown": "인기 정보 없음",
    ][tier] ?? tier
  }

  public static func popularity(_ p: PopularityFilter) -> String {
    switch p {
    case .any: "Any"
    case .belowTop50: "Below Top 50%"
    case .deepCuts: "Deep Cuts"
    case .obscure: "Obscure"
    }
  }

  /// The basis label shown on every connection; ML guesses always carry their confidence.
  public static func basis(_ evidence: Evidence) -> String {
    switch evidence.basis {
    case .verifiedFact: "검증된 사실"
    case .declared: "신고된 정보"
    case .mlInferred: "추정 (신뢰도 \(Int(((evidence.confidence ?? 0) * 100).rounded()))%)"
    }
  }

  /// Why the connection exists, from the reason code; the English explanation otherwise.
  public static func reason(_ evidence: Evidence) -> String {
    guard let reason = evidence.reason else { return evidence.explanation }
    let p = reason.params
    let name = p["name"] ?? ""
    let object = p["object"] ?? ""
    if reason.code.hasPrefix("relation.") {
      let axis = String(reason.code.dropFirst("relation.".count))
      let label = [
        "samples": "샘플링한 곡", "sampled_by": "이 곡을 샘플링", "covers": "원곡", "covered_by": "커버",
        "remix_of": "리믹스 원곡", "remixes": "리믹스", "influenced_by": "영향을 준 대상",
        "influences": "영향을 받은 대상", "member_of": "소속", "members": "멤버",
      ][axis]
      return label.map { "\($0): \(object)" } ?? evidence.explanation
    }
    switch reason.code {
    case "credit":
      let role = role(p["role"] ?? "")
      if let instrument = p["instrument"] { return "\(role) (\(instrument)): \(name)" }
      return "\(role): \(name)"
    case "credited_as": return "\(name) — \(role(p["role"] ?? ""))(으)로 참여"
    case "same_producer": return "같은 프로듀서: \(name)"
    case "same_session_player":
      if let instrument = p["instrument"] { return "같은 \(instrument) 연주자: \(name)" }
      return "같은 세션 연주자: \(name)"
    case "main_artist": return "메인 아티스트"
    case "on_release": return "이 앨범의 수록곡"
    case "recording_by_artist": return "이 아티스트의 곡"
    case "appears_on": return "수록 앨범"
    case "released_on_label": return "이 레이블의 발매작"
    case "release_by_artist": return "이 아티스트의 앨범"
    case "same_label": return "같은 레이블: \(name)"
    default: return evidence.explanation
    }
  }
}

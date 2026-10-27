import Foundation

/// How precise a stored release date is (ADR-0033). Open, so a new value does not break decoding.
public enum DatePrecision: String, Codable, Hashable, Sendable, OpenEnum {
  case day, month, year
  case unknown
}

/// A fact's source and how sure it is (catalog facts, credits, relations).
public struct FactEvidence: Codable, Hashable, Sendable {
  public let basis: Evidence.Basis
  public let verificationState: String
  public let source: String
  public let confidence: Double?
}

/// Artist Journey (EX-02): an artist's releases and dated relations in date order.
public struct ArtistJourney: Codable, Hashable, Sendable {
  public struct Release: Codable, Hashable, Sendable, Identifiable {
    public let releaseId: ReleaseID
    public let title: String
    public let releaseType: String
    /// The first day of the period when the precision is a month or a year.
    public let releaseDate: String?
    public let datePrecision: DatePrecision?
    /// `main` when the artist is listed first, `with` otherwise.
    public let role: String
    public let label: EntitySummary?
    public let tracks: Int
    public let durationMs: Int?
    public let artwork: [String: URL]?
    public let evidence: FactEvidence
    public var id: ReleaseID { releaseId }
  }
  public struct Event: Codable, Hashable, Sendable {
    public let relationId: String
    /// `member_of` or `signed_to`.
    public let relationType: String
    /// `outgoing`: the artist is the subject (joined, signed).
    public let direction: String
    public let other: EntitySummary
    public let validFrom: String
    public let validTo: String?
    public let evidence: FactEvidence
  }
  /// A release or an event, in date order.
  public enum Item: Hashable, Sendable, Identifiable {
    case release(Release)
    case event(Event)
    /// Something this build does not know: skipped.
    case other

    public var id: String {
      switch self {
      case .release(let r): "rel:\(r.releaseId.rawValue)"
      case .event(let e): "evt:\(e.relationId)"
      case .other: "other"
      }
    }
    /// The year shown beside the item ("" when unknown).
    public var year: String {
      switch self {
      case .release(let r): String((r.releaseDate ?? "").prefix(4))
      case .event(let e): String(e.validFrom.prefix(4))
      case .other: ""
      }
    }
  }
  public struct Coverage: Codable, Hashable, Sendable {
    public let releases: Int
    public let dated: Int
    public let undated: Int
    public let afterCutoff: Int
    public let undatedEvents: Int
  }
  public let artist: EntitySummary
  /// `modern` (everything) or `historical` (only what was out by `cutoff`).
  public let view: String
  public let cutoff: String?
  public let timeline: [Item]
  public let undated: [Release]
  public let coverage: Coverage
  public let truncated: Bool
}

extension ArtistJourney.Item: Codable {
  private enum Keys: String, CodingKey { case kind, release, event }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "release": self = .release(try c.decode(ArtistJourney.Release.self, forKey: .release))
    case "event": self = .event(try c.decode(ArtistJourney.Event.self, forKey: .event))
    default: self = .other
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case .release(let r):
      try c.encode("release", forKey: .kind)
      try c.encode(r, forKey: .release)
    case .event(let e):
      try c.encode("event", forKey: .kind)
      try c.encode(e, forKey: .event)
    case .other: try c.encode("other", forKey: .kind)
    }
  }
}

/// Two releases of one artist side by side (EX-03): catalog facts with their sources.
public struct ReleaseComparison: Codable, Hashable, Sendable {
  public struct Producer: Codable, Hashable, Sendable {
    public let entity: EntitySummary
    public let evidence: FactEvidence
  }
  public struct Side: Codable, Hashable, Sendable, Identifiable {
    public let releaseId: ReleaseID
    public let title: String
    public let releaseType: String
    public let releaseDate: String?
    public let datePrecision: DatePrecision?
    public let label: EntitySummary?
    public let tracks: Int
    public let durationMs: Int?
    public let producers: [Producer]
    public let guests: [EntitySummary]
    public var id: ReleaseID { releaseId }
  }
  public struct Shared: Codable, Hashable, Sendable {
    public let producers: [EntitySummary]
    public let guests: [EntitySummary]
    public let label: EntitySummary?
  }
  public let artist: EntitySummary
  public let releases: [Side]
  public let shared: Shared
}

/// Releases a cutoff leaves (ADR-0034): out, too coarse to tell, undated, and playable now
/// for the caller (counted among the newest 500 out when `playableSampled`).
public struct TimeMachineCoverage: Codable, Hashable, Sendable {
  public let cutoff: String
  public let releasesOut: Int
  public let releasesUncertain: Int
  public let releasesUndated: Int
  public let playableReleases: Int
  public let playableSampled: Bool
}

/// Rediscover (EX-06, ADR-0035): saved recordings quiet for a while.
public struct Rediscover: Codable, Hashable, Sendable {
  public struct Item: Codable, Hashable, Sendable, Identifiable {
    public let libraryItemId: String
    public let recording: EntitySummary
    public let savedAt: String
    public let note: String?
    /// `played`: the last qualified play is known; `none`: no play recorded since saving.
    public let history: String
    public let lastQualifiedAt: String?
    public let qualifiedPlays: Int
    public let releaseDate: String?
    public let datePrecision: DatePrecision?
    public var id: String { libraryItemId }
  }
  public let inactiveDays: Int
  public let items: [Item]
}

/// Exploration calls (docs/exploration_expansion/13-technical-design.md). Each one is
/// behind a feature flag; while it is off the server answers 404.
public struct ExploreService: Sendable {
  let api: APIClient

  public init(api: APIClient) { self.api = api }

  /// The modern view without `cutoff`; with it, only what was out by the end of that day in `timeZone`.
  public func journey(of artist: EntityID, cutoff: Date? = nil, timeZone: TimeZone = .current) async throws
    -> ArtistJourney
  {
    var query: [URLQueryItem] = []
    if let cutoff {
      query.append(URLQueryItem(name: "cutoff_at", value: ExploreText.iso(cutoff)))
      query.append(URLQueryItem(name: "time_zone", value: timeZone.identifier))
    }
    return try await api.get(CatalogService.path("/v1/dig/artists/\(artist.rawValue)/journey", query))
  }

  /// What a Time Radio cutoff leaves to listen to (setup screen).
  public func timeMachineCoverage(cutoff: Date, timeZone: TimeZone = .current) async throws
    -> TimeMachineCoverage
  {
    try await api.get(
      CatalogService.path(
        "/v1/dig/time-machine/coverage",
        [
          URLQueryItem(name: "cutoff_at", value: ExploreText.iso(cutoff)),
          URLQueryItem(name: "time_zone", value: timeZone.identifier),
        ]))
  }

  /// Saved recordings not played for `inactiveDays` (30–3650), longest quiet first.
  public func rediscover(inactiveDays: Int = 180) async throws -> Rediscover {
    try await api.get(
      CatalogService.path(
        "/v1/me/rediscover", [URLQueryItem(name: "inactive_days", value: String(inactiveDays))]))
  }

  /// Clears the last-played summary; later qualified plays of saved tracks start it again.
  public func clearRediscoverHistory() async throws {
    let _: Empty = try await api.send("DELETE", "/v1/me/rediscover/history", body: Optional<Empty>.none)
  }

  public func compare(artist: EntityID, _ a: ReleaseID, _ b: ReleaseID) async throws -> ReleaseComparison {
    try await api.get(
      CatalogService.path(
        "/v1/dig/artists/\(artist.rawValue)/compare",
        [URLQueryItem(name: "release_a", value: a.rawValue), URLQueryItem(name: "release_b", value: b.rawValue)]))
  }
}

/// Korean wording for exploration, matching the web client (apps/web/src/i18n/ko.ts).
public enum ExploreText {
  /// Never more precise than stored (EXP-024): "2011. 3. 9.", "2021년 6월 (월까지 알려짐)",
  /// "2014년 (연도만 알려짐)", "발매일 미확인".
  public static func date(_ date: String?, _ precision: DatePrecision?) -> String {
    guard let date, let precision, date.count >= 10 else { return "발매일 미확인" }
    let parts = date.prefix(10).split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return "발매일 미확인" }
    switch precision {
    case .year: return "\(parts[0])년 (연도만 알려짐)"
    case .month: return "\(parts[0])년 \(parts[1])월 (월까지 알려짐)"
    case .day: return "\(parts[0]). \(parts[1]). \(parts[2])."
    case .unknown: return "발매일 미확인"
    }
  }

  public static func releaseType(_ type: String) -> String {
    ["album": "정규", "single": "싱글", "ep": "EP", "compilation": "모음집"][type] ?? type
  }

  public static func length(_ ms: Int?) -> String {
    guard let ms else { return "길이 미상" }
    return "\(Int((Double(ms) / 60_000).rounded()))분"
  }

  public static func event(_ e: ArtistJourney.Event, artist: String) -> String {
    if e.relationType == "signed_to" { return "\(e.other.name)와(과) 계약" }
    return e.direction == "outgoing" ? "\(e.other.name)에 합류" : "\(e.other.name)이(가) \(artist)에 합류"
  }

  public static func basis(_ e: FactEvidence) -> String {
    switch e.basis {
    case .verifiedFact: "검증된 사실"
    case .declared: "신고된 정보"
    case .mlInferred: "추정 (신뢰도 \(Int(((e.confidence ?? 0) * 100).rounded()))%)"
    case .unknown: "확인되지 않은 정보"
    }
  }

  /// The end of `day` (in `timeZone`) as an instant.
  public static func endOfDay(_ day: Date, in timeZone: TimeZone = .current) -> Date {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = timeZone
    let start = cal.startOfDay(for: day)
    return cal.date(byAdding: DateComponents(day: 1, second: -1), to: start) ?? day
  }

  static func iso(_ date: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f.string(from: date)
  }
}

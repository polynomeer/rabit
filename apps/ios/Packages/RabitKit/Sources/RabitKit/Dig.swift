import Foundation

/// An exploration axis. Kept open (not an enum) so a new server axis does not break decoding.
public struct DigAxis: RawRepresentable, Codable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(rawValue)
  }
}

/// Why a connection exists and how sure we are. `mlInferred` must never look like a fact
/// (CLAUDE.md: distinguish verified provenance from ML-inferred relationships).
public struct Evidence: Codable, Hashable, Sendable {
  public enum Basis: String, Codable, Sendable, OpenEnum {
    case verifiedFact = "verified_fact"
    case declared
    case mlInferred = "ml_inferred"
    /// A basis this build does not know: never shown as a fact.
    case unknown
  }
  public struct Reason: Codable, Hashable, Sendable {
    public let code: String
    public let params: [String: String]
    public init(code: String, params: [String: String]) {
      self.code = code
      self.params = params
    }
  }
  public let basis: Basis
  public let verificationState: String
  public let source: String
  public let confidence: Double?
  public let licenseStatus: String?
  public let explanation: String
  public let reason: Reason?
}

public struct DigConnection: Codable, Hashable, Sendable {
  public struct Via: Codable, Hashable, Sendable {
    public let relationId: String?
    public let creditId: String?
    public let viaEntity: EntitySummary?
  }
  public let entity: EntitySummary
  public let axis: DigAxis
  public let via: Via
  public let evidence: Evidence
  public let popularityTier: String
  public let playability: Playability?
}

public struct DigAxes: Codable, Hashable, Sendable {
  public struct Entry: Codable, Hashable, Sendable {
    public let axis: DigAxis
    public let group: String
    public let count: Int
  }
  public let entity: EntitySummary
  public let axes: [Entry]
}

public struct DigSession: Codable, Hashable, Sendable {
  public struct Node: Codable, Hashable, Sendable, Identifiable {
    public let seq: Int
    public let parentSeq: Int?
    public let entity: EntitySummary
    public let viaAxis: DigAxis?
    public let evidence: Evidence?
    public let played: Bool
    public let saved: Bool
    public var id: Int { seq }
  }
  public struct EmptyState: Codable, Hashable, Sendable {
    public let reason: String
    public let message: String
  }
  public let digSessionId: DigSessionID
  public let state: String
  public let title: String?
  public let saved: Bool
  public let currentSeq: Int
  public let emptyState: EmptyState?
  /// EX-05: the cutoff this session digs under; nil when none (or from older servers).
  public let context: Context?
  public let trail: [Node]

  /// Only what was out by the end of `cutoff` in `timeZone` (ADR-0033).
  public struct Context: Codable, Hashable, Sendable {
    public let cutoffAt: String
    public let timeZone: String
    /// The calendar date (YYYY-MM-DD).
    public let cutoff: String
  }

  public var current: Node? { trail.first { $0.seq == currentSeq } }
  public var isActive: Bool { state == "active" }
}

/// A Blind Digging round (DIG-010): recordings without artist, release, year or
/// popularity until the user keeps or passes each one.
public struct BlindDig: Codable, Hashable, Sendable {
  public struct Item: Codable, Hashable, Sendable, Identifiable {
    public enum Decision: String, Codable, Sendable { case keep, pass }
    public struct Reveal: Codable, Hashable, Sendable {
      public struct ReleaseRef: Codable, Hashable, Sendable {
        public let releaseId: ReleaseID
        public let title: String
        public let releaseDate: String?
      }
      public let recording: EntitySummary
      public let release: ReleaseRef?
      public let popularityTier: String
    }
    public let itemId: String
    public let position: Int
    public let recordingId: RecordingID
    public let decision: Decision?
    public let reveal: Reveal?
    public var id: String { itemId }
  }
  public let blindDigId: String
  public let items: [Item]

  /// The first item not decided yet.
  public var current: Item? { items.first { $0.decision == nil } }
}

/// One album in a Crate Digging crate (DIG-009); each has a track the caller can play.
public struct CrateItem: Codable, Hashable, Sendable {
  public struct ReleaseRef: Codable, Hashable, Sendable {
    public let releaseId: ReleaseID
    public let title: String
    public let releaseType: String
    public let releaseDate: String?
    /// Signed cover URLs by edge in pixels ("300", "600", "1200"; ADR-0031), if any.
    public let artwork: [String: URL]?
  }
  public let release: ReleaseRef
  public let artists: [EntitySummary]
  public let label: EntitySummary?
  public let playableTracks: Int
  public let popularityTier: String
}

/// Label Digging (DIG-011): a label's releases by year and each artist's span on it.
public struct LabelTimeline: Codable, Hashable, Sendable {
  public struct Release: Codable, Hashable, Sendable, Identifiable {
    public let releaseId: ReleaseID
    public let title: String
    public let releaseType: String
    public let releaseDate: String?
    public let artists: [EntitySummary]
    public var id: ReleaseID { releaseId }
  }
  public struct Year: Codable, Hashable, Sendable {
    /// Nil for undated releases (listed last).
    public let year: Int?
    public let releases: [Release]
  }
  public struct Artist: Codable, Hashable, Sendable {
    public let artist: EntitySummary
    public let firstYear: Int?
    public let lastYear: Int?
    public let releases: Int
  }
  public let label: EntitySummary
  public let years: [Year]
  public let artists: [Artist]
  /// More than 1000 releases: only the first 1000 are listed.
  public let truncated: Bool
}

public enum PopularityFilter: String, CaseIterable, Sendable {
  case any
  case belowTop50 = "below_top_50"
  case deepCuts = "deep_cuts"
  case obscure
}

/// DIG calls (docs/03-architecture/dig.md). Every change returns the whole session.
public struct DigService: Sendable {
  let api: APIClient
  public init(api: APIClient) { self.api = api }

  public func sessions(limit: Int = 20) async throws -> [DigSessionSummary] {
    let page: Page<DigSessionSummary> = try await api.get("/v1/dig-sessions?limit=\(limit)")
    return page.items
  }

  public func start(from entity: EntityID) async throws -> DigSession {
    struct Body: Encodable { let entityId: EntityID }
    return try await api.post("/v1/dig-sessions", body: Body(entityId: entity))
  }

  public func session(_ id: DigSessionID) async throws -> DigSession {
    try await api.get("/v1/dig-sessions/\(id.rawValue)")
  }

  /// Axes with counts; under a session cutoff (EX-05) the counts follow it.
  public func axes(of entity: EntityID, context: DigSession.Context? = nil) async throws -> DigAxes {
    let path = "/v1/dig/entities/\(entity.rawValue)/axes"
    guard let context else { return try await api.get(path) }
    return try await api.get(
      CatalogService.path(
        path,
        [
          URLQueryItem(name: "cutoff_at", value: context.cutoffAt),
          URLQueryItem(name: "time_zone", value: context.timeZone),
        ]))
  }

  public func connections(
    of entity: EntityID, axis: DigAxis, popularity: PopularityFilter = .any, includeInferred: Bool = true,
    limit: Int = 50, context: DigSession.Context? = nil
  ) async throws -> [DigConnection] {
    var query = [
      URLQueryItem(name: "axis", value: axis.rawValue),
      URLQueryItem(name: "popularity", value: popularity.rawValue),
      URLQueryItem(name: "include_inferred", value: includeInferred ? "true" : "false"),
      URLQueryItem(name: "limit", value: String(limit)),
    ]
    // EX-05: leaves out recordings and releases that were not out by the cutoff.
    if let context {
      query.append(URLQueryItem(name: "cutoff_at", value: context.cutoffAt))
      query.append(URLQueryItem(name: "time_zone", value: context.timeZone))
    }
    let page: Page<DigConnection> = try await api.get(
      CatalogService.path("/v1/dig/entities/\(entity.rawValue)/connections", query))
    return page.items
  }

  /// Digs under a cutoff (the end of that day in `timeZone`), or freely again with nil.
  /// The server also refuses later steps while it is set.
  public func setCutoff(_ cutoff: Date?, timeZone: TimeZone = .current, session: DigSessionID) async throws
    -> DigSession
  {
    struct Context: Encodable { let cutoffAt: String; let timeZone: String }
    struct Body: Encodable {
      let context: Context?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(context, forKey: .context)  // null clears it
      }
      enum CodingKeys: String, CodingKey { case context }
    }
    let context = cutoff.map { Context(cutoffAt: ExploreText.iso($0), timeZone: timeZone.identifier) }
    return try await api.send("PATCH", "/v1/dig-sessions/\(session.rawValue)", body: Body(context: context))
  }

  /// Follows a connection from the session cursor.
  public func step(_ session: DigSessionID, along connection: DigConnection) async throws -> DigSession {
    struct Body: Encodable {
      let entityId: EntityID
      let axis: DigAxis
      let relationId: String?
      let creditId: String?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(entityId, forKey: .entityId)
        try c.encode(axis, forKey: .axis)
        try c.encodeIfPresent(relationId, forKey: .relationId)
        try c.encodeIfPresent(creditId, forKey: .creditId)
      }
      enum CodingKeys: String, CodingKey { case entityId, axis, relationId, creditId }
    }
    return try await api.send(
      "POST", "/v1/dig-sessions/\(session.rawValue)/steps",
      body: Body(
        entityId: connection.entity.entityId, axis: connection.axis, relationId: connection.via.relationId,
        creditId: connection.via.creditId),
      headers: ["Idempotency-Key": UUID().uuidString])
  }

  /// Moves back to an earlier node of the trail.
  public func moveCursor(_ session: DigSessionID, to seq: Int) async throws -> DigSession {
    struct Body: Encodable { let seq: Int }
    return try await api.post("/v1/dig-sessions/\(session.rawValue)/cursor", body: Body(seq: seq))
  }

  public enum NodeAction: String, Encodable, Sendable { case played, saved }

  public func record(_ action: NodeAction, session: DigSessionID, seq: Int) async throws -> DigSession {
    struct Body: Encodable { let action: NodeAction }
    return try await api.post("/v1/dig-sessions/\(session.rawValue)/nodes/\(seq)/actions", body: Body(action: action))
  }

  public func setSaved(_ saved: Bool, session: DigSessionID) async throws -> DigSession {
    struct Body: Encodable { let saved: Bool }
    return try await api.send("PATCH", "/v1/dig-sessions/\(session.rawValue)", body: Body(saved: saved))
  }

  public func end(_ session: DigSessionID) async throws -> DigSession {
    try await api.post("/v1/dig-sessions/\(session.rawValue)/end", body: Optional<Empty>.none)
  }

  public func startBlind(from entity: EntityID? = nil, popularity: PopularityFilter) async throws -> BlindDig {
    struct Body: Encodable {
      let startEntityId: EntityID?
      let popularity: String
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(startEntityId, forKey: .startEntityId)
        try c.encode(popularity, forKey: .popularity)
      }
      enum CodingKeys: String, CodingKey { case startEntityId, popularity }
    }
    return try await api.post("/v1/blind-digs", body: Body(startEntityId: entity, popularity: popularity.rawValue))
  }

  /// Keep (saves to the library) or Pass; final. Returns the round with the item revealed.
  public func decide(_ decision: BlindDig.Item.Decision, item: String, in round: String) async throws -> BlindDig {
    struct Body: Encodable { let decision: BlindDig.Item.Decision }
    return try await api.post("/v1/blind-digs/\(round)/items/\(item)/decision", body: Body(decision: decision))
  }

  /// A random crate of albums from the given years (nil: any era).
  public func crate(years: ClosedRange<Int>?, popularity: PopularityFilter, size: Int = 12) async throws -> [CrateItem] {
    var query = [
      URLQueryItem(name: "popularity", value: popularity.rawValue), URLQueryItem(name: "size", value: String(size)),
    ]
    if let years {
      query.append(URLQueryItem(name: "from", value: String(years.lowerBound)))
      query.append(URLQueryItem(name: "to", value: String(years.upperBound)))
    }
    struct Crate: Decodable { let items: [CrateItem] }
    let crate: Crate = try await api.get(CatalogService.path("/v1/dig/crate", query))
    return crate.items
  }

  public func labelTimeline(_ label: EntityID) async throws -> LabelTimeline {
    try await api.get("/v1/dig/labels/\(label.rawValue)/timeline")
  }

  /// A new playlist with the trail's recordings in order.
  public func playlistFromTrail(_ session: DigSessionID) async throws -> Playlist {
    try await api.post("/v1/dig-sessions/\(session.rawValue)/playlist", body: Optional<Empty>.none)
  }
}

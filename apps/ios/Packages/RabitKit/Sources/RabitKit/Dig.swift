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
  public enum Basis: String, Codable, Sendable {
    case verifiedFact = "verified_fact"
    case declared
    case mlInferred = "ml_inferred"
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
  public let trail: [Node]

  public var current: Node? { trail.first { $0.seq == currentSeq } }
  public var isActive: Bool { state == "active" }
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

  public func axes(of entity: EntityID) async throws -> DigAxes {
    try await api.get("/v1/dig/entities/\(entity.rawValue)/axes")
  }

  public func connections(
    of entity: EntityID, axis: DigAxis, popularity: PopularityFilter = .any, includeInferred: Bool = true,
    limit: Int = 50
  ) async throws -> [DigConnection] {
    let page: Page<DigConnection> = try await api.get(
      CatalogService.path(
        "/v1/dig/entities/\(entity.rawValue)/connections",
        [
          URLQueryItem(name: "axis", value: axis.rawValue),
          URLQueryItem(name: "popularity", value: popularity.rawValue),
          URLQueryItem(name: "include_inferred", value: includeInferred ? "true" : "false"),
          URLQueryItem(name: "limit", value: String(limit)),
        ]))
    return page.items
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

  /// A new playlist with the trail's recordings in order.
  public func playlistFromTrail(_ session: DigSessionID) async throws -> Playlist {
    try await api.post("/v1/dig-sessions/\(session.rawValue)/playlist", body: Optional<Empty>.none)
  }
}

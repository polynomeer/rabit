import Foundation

/// Read calls the first iOS screens need (home, release detail).
public struct CatalogService: Sendable {
  let api: APIClient
  public init(api: APIClient) { self.api = api }

  /// Newest first; `refType` narrows to releases, recordings or the user's own audio.
  public func library(refType: LibraryItem.RefType? = nil, limit: Int = 20) async throws -> [LibraryItem] {
    var query = [URLQueryItem(name: "limit", value: String(limit))]
    if let refType { query.append(URLQueryItem(name: "ref_type", value: refType.rawValue)) }
    let page: Page<LibraryItem> = try await api.get(Self.path("/v1/library", query))
    return page.items
  }

  public func playlists(limit: Int = 100) async throws -> [PlaylistSummary] {
    let page: Page<PlaylistSummary> = try await api.get(Self.path("/v1/playlists", [URLQueryItem(name: "limit", value: String(limit))]))
    return page.items
  }

  /// The playlist with its first page of items (up to 100).
  public func playlist(_ id: PlaylistID) async throws -> Playlist {
    try await api.get("/v1/playlists/\(id.rawValue)")
  }

  public func playlistItems(_ id: PlaylistID, after cursor: String, limit: Int = 100) async throws -> Page<PlaylistItem> {
    try await api.get(
      Self.path(
        "/v1/playlists/\(id.rawValue)/items",
        [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "cursor", value: cursor)]))
  }

  static func path(_ path: String, _ query: [URLQueryItem]) -> String {
    var c = URLComponents()
    c.path = path
    c.queryItems = query
    // `+` would read as a space on the server; cursors are opaque and may contain it.
    c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return c.string ?? path
  }

  public func recentDigSessions(limit: Int = 3) async throws -> [DigSessionSummary] {
    let page: Page<DigSessionSummary> = try await api.get("/v1/dig-sessions?limit=\(limit)")
    return page.items
  }

  public func release(_ id: ReleaseID) async throws -> Release {
    try await api.get("/v1/releases/\(id.rawValue)")
  }

  public func search(_ query: String, limit: Int = 30) async throws -> [SearchResult] {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty else { return [] }
    let page: Page<SearchResult> = try await api.get(
      Self.path("/v1/search", [URLQueryItem(name: "q", value: q), URLQueryItem(name: "limit", value: String(limit))]))
    return page.items
  }
}

/// The stand-in cover used across clients: a brand palette and disc offset picked by id,
/// so a release looks the same on web and iOS (apps/web/src/brand.tsx `Cover`).
public struct CoverStyle: Hashable, Sendable {
  public let background: UInt32
  public let disc: UInt32
  public let line: UInt32
  /// Horizontal disc offset in a 100-unit square, −15…14.
  public let shift: Int

  static let palettes: [(UInt32, UInt32, UInt32)] = [
    (0x2B2540, 0xEB7B4C, 0xF4F1EC),
    (0x1F2A26, 0xA9B5AB, 0xEB7B4C),
    (0x3A2219, 0xF4F1EC, 0x7865C8),
    (0xE9E3D8, 0x7865C8, 0x111111),
    (0x18202E, 0xEB7B4C, 0xA9B5AB),
    (0x2E2B27, 0xD8CFC2, 0x59615B),
  ]

  public init(id: String) {
    let p = Self.palettes[Int(Self.hash(id) % Int64(Self.palettes.count))]
    background = p.0
    disc = p.1
    line = p.2
    shift = Int(Self.hash("\(id):x") % 30) - 15
  }

  /// Java-style string hash over UTF-16 units with 32-bit wraparound, then `Math.abs`.
  static func hash(_ text: String) -> Int64 {
    var h: Int32 = 0
    for unit in text.utf16 { h = h &* 31 &+ Int32(unit) }
    return abs(Int64(h))
  }
}

/// A curated Home shelf (ADR-0029), already filtered by the server to releases the
/// caller's region can hear, in the editors' order.
public struct EditorialShelf: Codable, Hashable, Sendable, Identifiable {
  public struct Item: Codable, Hashable, Sendable {
    public let release: CrateItem.ReleaseRef
    public let artists: [EntitySummary]
    public let availableTracks: Int
    public let playableTracks: Int
    /// The editors' line about the pick.
    public let note: String?
  }
  public let shelfId: String
  public let title: String
  public let description: String?
  public let items: [Item]
  public var id: String { shelfId }
}

extension CatalogService {
  public func editorialShelves() async throws -> [EditorialShelf] {
    struct Live: Decodable { let shelves: [EditorialShelf] }
    return try await api.get("/v1/editorial/shelves", as: Live.self).shelves
  }
}

/// Feature flags the app may read (ADR-0028), evaluated for the signed-in user.
public struct FeatureService: Sendable {
  let api: APIClient

  public init(api: APIClient) { self.api = api }

  public func load() async throws -> [String: Bool] {
    struct Flags: Decodable { let features: [String: Bool] }
    let flags = try await api.get("/v1/features", as: Flags.self).features
    // The snake_case key strategy also renames dictionary keys (client_diagnostics →
    // clientDiagnostics); flag keys are lowercase snake_case, so this restores them.
    return Dictionary(uniqueKeysWithValues: flags.map { (Self.snake($0.key), $0.value) })
  }

  static func snake(_ key: String) -> String {
    key.reduce(into: "") { out, c in
      if c.isUppercase {
        out += "_" + c.lowercased()
      } else {
        out.append(c)
      }
    }
  }
}

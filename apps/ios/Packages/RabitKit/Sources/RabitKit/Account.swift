import Foundation

public struct Me: Codable, Hashable, Sendable {
  public struct Quota: Codable, Hashable, Sendable {
    public let maxTotalBytes: Int
    public let usedBytes: Int
  }
  public let userId: String
  public let licenseCountry: String?
  public let subscriptionState: String
  public let quota: Quota
}

public struct Subscription: Codable, Hashable, Sendable {
  public let plan: String
  public let state: String
  public let paidThrough: Date
  public let source: String
  public let autoRenew: Bool?
}

public struct Entitlement: Codable, Hashable, Sendable, Identifiable {
  public let entitlementId: String
  public let scope: String
  public let resourceId: String?
  public let origin: String
  public let status: String
  public let validFrom: Date
  public let validTo: Date?
  public var id: String { entitlementId }
}

/// Integer minor units; KRW has none.
public struct Money: Codable, Hashable, Sendable {
  public let amountMinor: Int
  public let currency: String
  public let taxIncluded: Bool

  public var formatted: String {
    let value = currency == "KRW" ? Decimal(amountMinor) : Decimal(amountMinor) / 100
    return value.formatted(.currency(code: currency).locale(Locale(identifier: "ko_KR")))
  }
}

public struct Order: Codable, Hashable, Sendable, Identifiable {
  public let orderId: String
  public let kind: String
  public let status: String
  public let releaseId: ReleaseID?
  public let releaseTitle: String?
  public let artistNames: [String]
  public let plan: String?
  public let renewal: Bool
  public let price: Money
  public let createdAt: Date
  public var id: String { orderId }
}

/// Read-only account data: subscription, entitlements and orders. Starting or changing a
/// subscription and buying stay on the web (in-app purchase is an open decision).
public struct AccountService: Sendable {
  let api: APIClient
  public init(api: APIClient) { self.api = api }

  public func me() async throws -> Me { try await api.get("/v1/me") }

  public func subscription() async throws -> Subscription? {
    struct Envelope: Decodable { let subscription: Subscription? }
    let e: Envelope = try await api.get("/v1/subscription")
    return e.subscription
  }

  public func entitlements() async throws -> [Entitlement] {
    struct List: Decodable { let items: [Entitlement] }
    let l: List = try await api.get("/v1/entitlements")
    return l.items
  }

  public func orders() async throws -> [Order] {
    struct List: Decodable { let items: [Order] }
    let l: List = try await api.get("/v1/orders")
    return l.items
  }
}

extension CollectionService {
  /// Moves a playlist item to a new 0-based position (If-Match, one retry on 412).
  public func move(_ item: PlaylistItemID, to position: Int, in playlist: PlaylistID) async throws -> Playlist {
    struct Body: Encodable { let position: Int }
    return try await versioned(playlist) { etag in
      try await api.send(
        "POST", "/v1/playlists/\(playlist.rawValue)/items/\(item.rawValue)/move", body: Body(position: max(0, position)),
        headers: ["If-Match": etag])
    }
  }
}

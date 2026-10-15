import Foundation

/// Maps media gateway URLs (`…/media/v1/<token>/<file>`, ADR-0008) to a custom scheme
/// the player loads through a resource loader, so every request can carry the latest
/// media token. Tokens expire within 60 s while a track plays for minutes; the session
/// refresh issues a new token and the next segment request uses it.
public struct MediaLocator: Sendable, Hashable {
  public static let scheme = "rabit-media"
  /// The only files a session serves (mirrors the gateway's whitelist).
  static func isSessionFile(_ name: String) -> Bool {
    if name == "index.m3u8" || name == "init.mp4" { return true }
    guard name.hasPrefix("seg_"), name.hasSuffix(".m4s") else { return false }
    let digits = name.dropFirst(4).dropLast(4)
    return digits.count == 5 && digits.allSatisfy { ("0"..."9").contains($0) }
  }

  /// Gateway origin and path up to (not including) the token: `https://host/media/v1/`.
  public let gatewayPrefix: URL
  public let token: String

  /// Parses a `manifest_url` from a playback session.
  public init?(manifestURL: URL) {
    let parts = manifestURL.pathComponents  // ["/", "media", "v1", token, "index.m3u8"]
    guard parts.count >= 5, parts[parts.count - 4] == "media", parts[parts.count - 3] == "v1",
      var c = URLComponents(url: manifestURL, resolvingAgainstBaseURL: false)
    else { return nil }
    token = parts[parts.count - 2]
    c.path = "/" + parts.dropFirst().dropLast(2).joined(separator: "/") + "/"
    c.query = nil
    guard let prefix = c.url else { return nil }
    gatewayPrefix = prefix
  }

  /// The URL handed to the player; relative segment URIs in the playlist resolve to the
  /// same scheme, so they come back through the resource loader too.
  public var playerURL: URL {
    URL(string: "\(Self.scheme)://session/index.m3u8")!
  }

  /// The gateway URL for a player request, with the current token; nil for anything
  /// that is not one of the session's files.
  public func gatewayURL(for playerRequest: URL) -> URL? {
    guard playerRequest.scheme == Self.scheme else { return nil }
    let file = playerRequest.lastPathComponent
    guard Self.isSessionFile(file) else { return nil }
    return gatewayPrefix.appending(path: token).appending(path: file)
  }

  public func withToken(_ token: String) -> MediaLocator {
    MediaLocator(gatewayPrefix: gatewayPrefix, token: token)
  }

  init(gatewayPrefix: URL, token: String) {
    self.gatewayPrefix = gatewayPrefix
    self.token = token
  }
}

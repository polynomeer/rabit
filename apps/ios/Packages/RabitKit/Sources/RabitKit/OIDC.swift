import CryptoKit
import Foundation

/// Provider sign-in for the iOS app (ADR-0009, ADR-0023): OIDC Authorization Code with
/// PKCE as a public client. The app opens `authorizationURL` in a web authentication
/// session and hands the callback URL to `finish`.
public struct OIDCConfig: Equatable, Sendable {
  public let issuer: URL
  public let clientId: String
  public let redirectURI: URL
  public let scopes: [String]

  public init(issuer: URL, clientId: String, redirectURI: URL, scopes: [String] = ["openid", "email"]) {
    self.issuer = issuer
    self.clientId = clientId
    self.redirectURI = redirectURI
    self.scopes = scopes
  }
}

public struct OIDCDiscovery: Decodable, Equatable, Sendable {
  public let issuer: String
  public let authorizationEndpoint: URL
  public let tokenEndpoint: URL
  public let revocationEndpoint: URL?
}

public struct OIDCTokens: Equatable, Sendable {
  public let accessToken: String
  public let refreshToken: String?
}

public enum OIDCError: Error, Equatable, Sendable {
  case issuerMismatch
  case stateMismatch
  case provider(String)
  case missingCode
  case tokenEndpoint(status: Int)
  case invalidIDToken(String)
}

/// One sign-in attempt: what to open and what to check when the browser comes back.
public struct AuthorizationRequest: Sendable {
  public let url: URL
  public let state: String
  public let nonce: String
  public let codeVerifier: String
}

public struct OIDCClient: Sendable {
  public let config: OIDCConfig
  let transport: any HTTPTransport

  public init(config: OIDCConfig, transport: any HTTPTransport = URLSession.shared) {
    self.config = config
    self.transport = transport
  }

  public func discover() async throws -> OIDCDiscovery {
    let url = config.issuer.appending(path: ".well-known/openid-configuration")
    let (data, response) = try await transport.data(for: URLRequest(url: url))
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw OIDCError.tokenEndpoint(status: 0) }
    let d = try APIClient.decoder.decode(OIDCDiscovery.self, from: data)
    // The document must describe the issuer we trust, not another one.
    guard d.issuer == config.issuer.absoluteString else { throw OIDCError.issuerMismatch }
    return d
  }

  public func authorization(_ d: OIDCDiscovery) -> AuthorizationRequest {
    let verifier = Self.randomURLSafe(bytes: 48)
    let state = Self.randomURLSafe(bytes: 24)
    let nonce = Self.randomURLSafe(bytes: 24)
    var c = URLComponents(url: d.authorizationEndpoint, resolvingAgainstBaseURL: false)!
    c.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: config.clientId),
      URLQueryItem(name: "redirect_uri", value: config.redirectURI.absoluteString),
      URLQueryItem(name: "scope", value: config.scopes.joined(separator: " ")),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
    ]
    return AuthorizationRequest(url: c.url!, state: state, nonce: nonce, codeVerifier: verifier)
  }

  /// Checks the callback and exchanges the code for tokens.
  public func finish(_ callback: URL, for request: AuthorizationRequest, discovery d: OIDCDiscovery, now: Date = Date())
    async throws -> OIDCTokens
  {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    guard value("state") == request.state else { throw OIDCError.stateMismatch }
    if let error = value("error") { throw OIDCError.provider(error) }
    guard let code = value("code"), !code.isEmpty else { throw OIDCError.missingCode }

    let body = try await tokenRequest(
      d,
      [
        "grant_type": "authorization_code", "client_id": config.clientId, "code": code,
        "code_verifier": request.codeVerifier, "redirect_uri": config.redirectURI.absoluteString,
      ])
    guard let idToken = body.idToken else { throw OIDCError.invalidIDToken("missing") }
    try Self.checkIDToken(idToken, issuer: d.issuer, clientId: config.clientId, nonce: request.nonce, now: now)
    return OIDCTokens(accessToken: body.accessToken, refreshToken: body.refreshToken)
  }

  public func refresh(_ refreshToken: String, discovery d: OIDCDiscovery) async throws -> OIDCTokens {
    let body = try await tokenRequest(
      d, ["grant_type": "refresh_token", "client_id": config.clientId, "refresh_token": refreshToken])
    return OIDCTokens(accessToken: body.accessToken, refreshToken: body.refreshToken)
  }

  /// Best effort: the provider forgets the refresh token (and its access tokens).
  public func revoke(_ refreshToken: String, discovery d: OIDCDiscovery) async {
    guard let endpoint = d.revocationEndpoint else { return }
    _ = try? await transport.data(
      for: Self.form(endpoint, ["token": refreshToken, "client_id": config.clientId]))
  }

  // MARK: Helpers

  private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
  }

  private func tokenRequest(_ d: OIDCDiscovery, _ params: [String: String]) async throws -> TokenResponse {
    let (data, response) = try await transport.data(for: Self.form(d.tokenEndpoint, params))
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw OIDCError.tokenEndpoint(status: status) }
    return try APIClient.decoder.decode(TokenResponse.self, from: data)
  }

  static func form(_ url: URL, _ params: [String: String]) -> URLRequest {
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    req.httpBody = Data(
      params.sorted { $0.key < $1.key }
        .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
        .joined(separator: "&").utf8)
    return req
  }

  static func randomURLSafe(bytes count: Int) -> String {
    var g = SystemRandomNumberGenerator()
    return base64URL(Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &g) }))
  }

  static func challenge(for verifier: String) -> String {
    base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
  }

  static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// The ID token comes straight from the token endpoint over TLS, so its claims are
  /// checked without the signature (OIDC Core 3.1.3.7); the API verifies the access token.
  static func checkIDToken(_ token: String, issuer: String, clientId: String, nonce: String, now: Date) throws {
    let parts = token.split(separator: ".")
    guard parts.count == 3 else { throw OIDCError.invalidIDToken("format") }
    var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
    guard let data = Data(base64Encoded: b64),
      let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw OIDCError.invalidIDToken("payload") }
    guard claims["iss"] as? String == issuer else { throw OIDCError.invalidIDToken("iss") }
    let aud = (claims["aud"] as? [String]) ?? [claims["aud"] as? String].compactMap { $0 }
    guard aud.contains(clientId) else { throw OIDCError.invalidIDToken("aud") }
    guard claims["nonce"] as? String == nonce else { throw OIDCError.invalidIDToken("nonce") }
    guard let exp = claims["exp"] as? Double, Date(timeIntervalSince1970: exp + 60) > now else {
      throw OIDCError.invalidIDToken("exp")
    }
  }
}

/// Renews the access token with the stored refresh token: one renewal at a time,
/// concurrent 401s wait for it (same behaviour as the web client).
public actor TokenRefresher {
  let oidc: OIDCClient
  let tokens: any TokenStore
  private var discovery: OIDCDiscovery?
  private var inflight: Task<Bool, Never>?

  public init(oidc: OIDCClient, tokens: any TokenStore) {
    self.oidc = oidc
    self.tokens = tokens
  }

  public func refresh() async -> Bool {
    if let inflight { return await inflight.value }
    guard let refreshToken = tokens.refreshToken else { return false }
    let task = Task { [oidc, tokens, discovery] () -> (Bool, OIDCDiscovery?) in
      do {
        let d: OIDCDiscovery
        if let discovery { d = discovery } else { d = try await oidc.discover() }
        let fresh = try await oidc.refresh(refreshToken, discovery: d)
        tokens.accessToken = fresh.accessToken
        // Rotated refresh tokens replace the old one.
        if let next = fresh.refreshToken { tokens.refreshToken = next }
        return (true, d)
      } catch {
        return (false, discovery)
      }
    }
    inflight = Task { await task.value.0 }
    let (ok, d) = await task.value
    discovery = d
    inflight = nil
    return ok
  }
}

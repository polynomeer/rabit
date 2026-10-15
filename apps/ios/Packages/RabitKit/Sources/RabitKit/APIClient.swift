import Foundation

/// An error answer from the API (`{ "error": { "code", "message" } }`), or a transport failure.
public enum APIError: Error, Equatable, Sendable {
  case server(status: Int, code: String, message: String)
  case unauthorized
  case invalidResponse

  public var code: String? {
    if case .server(_, let code, _) = self { return code }
    return nil
  }
}

/// Sends requests to the Rabit API (docs/05-api/openapi.yaml) with the stored access token.
public final class APIClient: Sendable {
  public let baseURL: URL
  private let tokens: any TokenStore
  let transport: any HTTPTransport
  /// Called when the API rejects the token; the app shows sign-in again.
  private let onUnauthorized: @Sendable () -> Void
  /// Renews the access token once on a 401 (provider sign-in only).
  private let refresher: TokenRefresher?

  public init(
    baseURL: URL, tokens: any TokenStore, transport: any HTTPTransport = URLSession.shared,
    refresher: TokenRefresher? = nil, onUnauthorized: @escaping @Sendable () -> Void = {}
  ) {
    self.baseURL = baseURL
    self.tokens = tokens
    self.transport = transport
    self.refresher = refresher
    self.onUnauthorized = onUnauthorized
  }

  public static let decoder: JSONDecoder = {
    let d = JSONDecoder()
    d.keyDecodingStrategy = .convertFromSnakeCase
    d.dateDecodingStrategy = .custom { decoder in
      let text = try decoder.singleValueContainer().decode(String.self)
      if let date = parseTimestamp(text) { return date }
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Bad timestamp \(text)"))
    }
    return d
  }()

  public static let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.keyEncodingStrategy = .convertToSnakeCase
    e.dateEncodingStrategy = .custom { date, encoder in
      var c = encoder.singleValueContainer()
      try c.encode(formatTimestamp(date))
    }
    return e
  }()

  public func get<T: Decodable>(_ path: String, as: T.Type = T.self) async throws -> T {
    try await send("GET", path, body: Optional<Empty>.none)
  }

  public func post<T: Decodable, B: Encodable>(_ path: String, body: B?, as: T.Type = T.self)
    async throws -> T
  {
    try await send("POST", path, body: body)
  }

  public func send<T: Decodable, B: Encodable>(
    _ method: String, _ path: String, body: B?, headers: [String: String] = [:]
  ) async throws -> T {
    try await sendWithETag(method, path, body: body, headers: headers).value
  }

  /// Like `send`, also returning the response's ETag (versioned resources such as playlists).
  public func sendWithETag<T: Decodable, B: Encodable>(
    _ method: String, _ path: String, body: B?, headers: [String: String] = [:]
  ) async throws -> (value: T, etag: String?) {
    guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidResponse }
    let payload = try body.map { try Self.encoder.encode($0) }
    func request() -> URLRequest {
      var req = URLRequest(url: url)
      req.httpMethod = method
      if let token = tokens.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
      if let payload {
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = payload
      }
      for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
      return req
    }

    var (data, response) = try await transport.data(for: request())
    // A 401 is answered before the request is processed, so one retry is safe.
    if (response as? HTTPURLResponse)?.statusCode == 401, tokens.accessToken != nil, let refresher,
      await refresher.refresh()
    {
      (data, response) = try await transport.data(for: request())
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    if http.statusCode == 401 {
      if tokens.accessToken != nil {
        tokens.clear()
        onUnauthorized()
      }
      throw APIError.unauthorized
    }
    guard (200..<300).contains(http.statusCode) else {
      let envelope = try? Self.decoder.decode(ErrorEnvelope.self, from: data)
      throw APIError.server(
        status: http.statusCode, code: envelope?.error.code ?? "UNKNOWN",
        message: envelope?.error.message ?? "Request failed (\(http.statusCode))")
    }
    let etag = http.value(forHTTPHeaderField: "etag")
    if T.self == Empty.self { return (Empty() as! T, etag) }
    return (try Self.decoder.decode(T.self, from: data), etag)
  }

  /// Development sign-in against the built-in dev issuer (ADR-0009); never in production builds.
  public func devSignIn(subject: String) async throws {
    struct Body: Encodable { let subject: String }
    struct Token: Decodable { let accessToken: String }
    tokens.clear()
    let token: Token = try await post("/dev/token", body: Body(subject: subject))
    tokens.accessToken = token.accessToken
  }
}

public struct Empty: Codable, Sendable { public init() {} }

struct ErrorEnvelope: Decodable {
  struct Body: Decodable {
    let code: String?
    let message: String?
  }
  let error: Body
}

/// The network seam: `URLSession` in the app, a stub in tests.
public protocol HTTPTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, URLResponse)
  /// Sends a file as the body without loading it into memory.
  func upload(for request: URLRequest, fromFile file: URL) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPTransport {
  public func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    try await data(for: request, delegate: nil)
  }
  public func upload(for request: URLRequest, fromFile file: URL) async throws -> (Data, URLResponse) {
    try await upload(for: request, fromFile: file, delegate: nil)
  }
}

/// RFC 3339 timestamps as the server writes them (`toISOString`, with milliseconds).
private let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

func parseTimestamp(_ text: String) -> Date? {
  (try? fractional.parse(text)) ?? (try? Date.ISO8601FormatStyle().parse(text))
}

func formatTimestamp(_ date: Date) -> String { fractional.format(date) }

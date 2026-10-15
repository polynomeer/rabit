import Foundation
import RabitKit

/// Build- and launch-time settings. The API address comes from the `RabitAPIBaseURL`
/// Info.plist value (build setting `RABIT_API_BASE_URL`); the `RABIT_API_BASE`
/// environment variable of the Xcode scheme overrides it for local runs on other ports.
struct AppConfig: Equatable {
  static let fallbackBaseURL = URL(string: "http://localhost:8080")!

  static let redirectURI = URL(string: "app.rabit.ios://auth/callback")!

  let apiBaseURL: URL
  /// Development sign-in against the built-in dev issuer (ADR-0009): debug builds only.
  let devSignIn: Bool
  /// Provider sign-in (Cognito user pool, iOS client); nil when not configured.
  let oidc: OIDCConfig?

  static func load(
    info: [String: Any] = Bundle.main.infoDictionary ?? [:],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> AppConfig {
    func setting(_ env: String, _ key: String) -> String? {
      [environment[env], info[key] as? String].lazy
        .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
        .first { !$0.isEmpty }
    }
    let url = setting("RABIT_API_BASE", "RabitAPIBaseURL").flatMap(Self.httpURL) ?? fallbackBaseURL
    #if DEBUG
      let dev = true
    #else
      let dev = false
    #endif
    var oidc: OIDCConfig?
    if let issuer = setting("RABIT_OIDC_ISSUER", "RabitOIDCIssuer").flatMap(Self.issuerURL),
      let client = setting("RABIT_OIDC_CLIENT_ID", "RabitOIDCClientID")
    {
      oidc = OIDCConfig(issuer: issuer, clientId: client, redirectURI: redirectURI)
    }
    return AppConfig(apiBaseURL: url, devSignIn: dev, oidc: oidc)
  }

  /// HTTPS, or plain HTTP only for the local mock provider on this machine.
  private static func issuerURL(_ text: String) -> URL? {
    guard let url = httpURL(text) else { return nil }
    if url.scheme == "https" { return url }
    return ["localhost", "127.0.0.1"].contains(url.host() ?? "") ? url : nil
  }

  private static func httpURL(_ text: String) -> URL? {
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    guard let url = URL(string: trimmed), let scheme = url.scheme, ["http", "https"].contains(scheme),
      url.host() != nil
    else { return nil }
    return url
  }
}

/// A random per-install id sent with playback sessions (`^[A-Za-z0-9_-]{8,64}$`), like the
/// web client's `web-…` id.
enum DeviceID {
  private static let key = "rabit.deviceId"
  static var current: String {
    if let id = UserDefaults.standard.string(forKey: key) { return id }
    let id = "ios-\(UUID().uuidString.lowercased())"
    UserDefaults.standard.set(id, forKey: key)
    return id
  }
}

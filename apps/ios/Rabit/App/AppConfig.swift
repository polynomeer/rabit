import Foundation

/// Build- and launch-time settings. The API address comes from the `RabitAPIBaseURL`
/// Info.plist value (build setting `RABIT_API_BASE_URL`); the `RABIT_API_BASE`
/// environment variable of the Xcode scheme overrides it for local runs on other ports.
struct AppConfig: Equatable {
  static let fallbackBaseURL = URL(string: "http://localhost:8080")!

  let apiBaseURL: URL
  /// Development sign-in against the built-in dev issuer (ADR-0009): debug builds only.
  let devSignIn: Bool

  static func load(
    info: [String: Any] = Bundle.main.infoDictionary ?? [:],
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> AppConfig {
    let candidates = [environment["RABIT_API_BASE"], info["RabitAPIBaseURL"] as? String]
    let url = candidates.lazy.compactMap { $0.flatMap(Self.httpURL) }.first ?? fallbackBaseURL
    #if DEBUG
      let dev = true
    #else
      let dev = false
    #endif
    return AppConfig(apiBaseURL: url, devSignIn: dev)
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

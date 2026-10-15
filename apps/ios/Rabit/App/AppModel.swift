import Foundation
import RabitKit

nonisolated extension Notification.Name {
  /// The API rejected the access token (expired or revoked).
  static let rabitSignedOut = Notification.Name("app.rabit.signedOut")
}

/// App-wide state: configuration, the API client, the sign-in state and the player.
@Observable
final class AppModel {
  let config: AppConfig
  let catalog: CatalogService
  let dig: DigService
  let uploads: UploadService
  let player: PlayerController
  private(set) var signedIn: Bool

  private let api: APIClient
  private let tokens: any TokenStore
  private let oidc: OIDCClient?

  init(config: AppConfig = .load(), tokens: any TokenStore = KeychainTokenStore()) {
    self.config = config
    self.tokens = tokens
    let oidc = config.oidc.map { OIDCClient(config: $0) }
    self.oidc = oidc
    let api = APIClient(
      baseURL: config.apiBaseURL, tokens: tokens,
      refresher: oidc.map { TokenRefresher(oidc: $0, tokens: tokens) },
      onUnauthorized: { NotificationCenter.default.post(name: .rabitSignedOut, object: nil) })
    self.api = api
    catalog = CatalogService(api: api)
    dig = DigService(api: api)
    uploads = UploadService(api: api)
    player = PlayerController(playback: PlaybackService(api: api, deviceId: DeviceID.current))
    signedIn = tokens.accessToken != nil
  }

  func devSignIn(subject: String) async throws {
    guard config.devSignIn else { return }
    try await api.devSignIn(subject: subject)
    signedIn = true
  }

  var providerSignIn: Bool { oidc != nil }

  /// Provider sign-in: `authenticate` opens the URL in a web authentication session
  /// and returns the callback URL.
  func signIn(authenticate: (URL) async throws -> URL) async throws {
    guard let oidc else { return }
    let discovery = try await oidc.discover()
    let request = oidc.authorization(discovery)
    let callback = try await authenticate(request.url)
    let result = try await oidc.finish(callback, for: request, discovery: discovery)
    tokens.accessToken = result.accessToken
    tokens.refreshToken = result.refreshToken
    signedIn = true
  }

  func signOut() {
    player.stop()
    if let oidc, let refresh = tokens.refreshToken {
      Task.detached {
        guard let discovery = try? await oidc.discover() else { return }
        await oidc.revoke(refresh, discovery: discovery)
      }
    }
    tokens.clear()
    signedIn = false
  }
}

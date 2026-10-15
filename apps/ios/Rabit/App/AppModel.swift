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

  init(config: AppConfig = .load(), tokens: any TokenStore = KeychainTokenStore()) {
    self.config = config
    self.tokens = tokens
    let api = APIClient(
      baseURL: config.apiBaseURL, tokens: tokens,
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

  func signOut() {
    player.stop()
    tokens.accessToken = nil
    signedIn = false
  }
}

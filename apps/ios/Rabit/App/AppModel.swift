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
  let explore: ExploreService
  let uploads: UploadService
  let collection: CollectionService
  let account: AccountService
  let player: PlayerController
  let store: StoreController
  let diagnostics: Diagnostics
  /// Feature flags for this user (ADR-0028); empty until loaded, then defaults apply.
  private(set) var features: [String: Bool] = [:]
  private(set) var signedIn: Bool

  private let api: APIClient
  private let tokens: any TokenStore
  private let oidc: OIDCClient?

  init(
    config: AppConfig = .load(), tokens: any TokenStore = KeychainTokenStore(),
    transport: any HTTPTransport = URLSession.shared
  ) {
    self.config = config
    self.tokens = tokens
    let oidc = config.oidc.map { OIDCClient(config: $0) }
    self.oidc = oidc
    let api = APIClient(
      baseURL: config.apiBaseURL, tokens: tokens, transport: transport,
      refresher: oidc.map { TokenRefresher(oidc: $0, tokens: tokens) },
      onUnauthorized: { NotificationCenter.default.post(name: .rabitSignedOut, object: nil) })
    self.api = api
    catalog = CatalogService(api: api)
    dig = DigService(api: api)
    explore = ExploreService(api: api)
    uploads = UploadService(api: api)
    collection = CollectionService(api: api)
    account = AccountService(api: api)
    store = StoreController(account: account)
    player = PlayerController(
      playback: PlaybackService(api: api, deviceId: DeviceID.current), queue: QueueService(api: api))
    diagnostics = Diagnostics(service: DiagnosticsService(api: api))
    signedIn = tokens.accessToken != nil
    if signedIn { didSignIn() }
  }

  func devSignIn(subject: String) async throws {
    guard config.devSignIn else { return }
    try await api.devSignIn(subject: subject)
    signedIn = true
    didSignIn()
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
    didSignIn()
  }

  private func didSignIn() {
    store.listen()
    player.restore()
    Task {
      await refreshFeatures()
      diagnostics.flush()
    }
  }

  /// Reads the flags again (sign-in, back to the foreground). A failed read keeps the
  /// last values; a flag never read uses its built-in default.
  func refreshFeatures() async {
    guard signedIn else { return }
    if let flags = try? await FeatureService(api: api).load() { features = flags }
    // Kill switch for client reports (ADR-0027); on unless the server says otherwise.
    diagnostics.enabled = signedIn && (features["client_diagnostics"] ?? true)
  }

  /// A flag that is off unless the server turns it on (exploration, ADR-0028).
  func isOn(_ key: String) -> Bool { features[key] ?? false }

  func signOut() {
    diagnostics.enabled = false
    features = [:]
    player.stop()
    store.stop()
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

import Foundation
import Security
import Synchronization

/// Where the access token lives. The app uses the Keychain; tests use memory.
public protocol TokenStore: AnyObject, Sendable {
  var accessToken: String? { get set }
  /// Present after provider sign-in; never for the development issuer.
  var refreshToken: String? { get set }
}

extension TokenStore {
  public func clear() {
    accessToken = nil
    refreshToken = nil
  }
}

public final class InMemoryTokenStore: TokenStore {
  private let access: Mutex<String?>
  private let refresh: Mutex<String?>
  public init(_ token: String? = nil, refresh: String? = nil) {
    access = Mutex(token)
    self.refresh = Mutex(refresh)
  }
  public var accessToken: String? {
    get { access.withLock { $0 } }
    set { access.withLock { $0 = newValue } }
  }
  public var refreshToken: String? {
    get { refresh.withLock { $0 } }
    set { refresh.withLock { $0 = newValue } }
  }
}

/// Keeps the tokens in the Keychain, readable only while the device is unlocked and
/// never synced or restored to another device.
public final class KeychainTokenStore: TokenStore {
  private let access: KeychainItem
  private let refresh: KeychainItem

  public init(service: String = "app.rabit.ios.auth") {
    access = KeychainItem(service: service, account: "access-token")
    refresh = KeychainItem(service: service, account: "refresh-token")
  }

  public var accessToken: String? {
    get { access.value }
    set { access.value = newValue }
  }

  public var refreshToken: String? {
    get { refresh.value }
    set { refresh.value = newValue }
  }
}

final class KeychainItem: Sendable {
  private let service: String
  private let account: String
  private let cache = Mutex<String??>(nil)

  init(service: String, account: String) {
    self.service = service
    self.account = account
  }

  var value: String? {
    get {
      if let cached = cache.withLock({ $0 }) { return cached }
      let value = read()
      cache.withLock { $0 = .some(value) }
      return value
    }
    set {
      delete()
      if let newValue { write(newValue) }
      cache.withLock { $0 = .some(newValue) }
    }
  }

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
     kSecAttrAccount as String: account]
  }

  private func read() -> String? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func write(_ token: String) {
    var q = query
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }

  private func delete() { SecItemDelete(query as CFDictionary) }
}

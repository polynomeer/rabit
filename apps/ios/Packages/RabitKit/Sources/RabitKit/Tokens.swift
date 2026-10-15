import Foundation
import Security
import Synchronization

/// Where the access token lives. The app uses the Keychain; tests use memory.
public protocol TokenStore: AnyObject, Sendable {
  var accessToken: String? { get set }
}

public final class InMemoryTokenStore: TokenStore {
  private let value: Mutex<String?>
  public init(_ token: String? = nil) { value = Mutex(token) }
  public var accessToken: String? {
    get { value.withLock { $0 } }
    set { value.withLock { $0 = newValue } }
  }
}

/// Keeps the access token in the Keychain, readable only while the device is unlocked
/// and never synced or restored to another device.
public final class KeychainTokenStore: TokenStore {
  private let service: String
  private let account = "access-token"
  private let cache = Mutex<String??>(nil)

  public init(service: String = "app.rabit.ios.auth") { self.service = service }

  public var accessToken: String? {
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

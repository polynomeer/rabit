import RabitKit
import StoreKit

/// The Listen subscription through the App Store (ADR-0024). The server issues the
/// account token set on the purchase and applies Apple's signed transaction; a
/// transaction is finished only after the server accepted it, so nothing is lost if
/// the app or the network stops halfway (StoreKit redelivers unfinished ones).
@Observable
final class StoreController {
  private(set) var status: AppStoreStatus?
  private(set) var product: Product?
  private(set) var busy = false
  private(set) var message: String?

  @ObservationIgnored private let account: AccountService
  @ObservationIgnored private var updates: Task<Void, Never>?

  init(account: AccountService) {
    self.account = account
  }

  /// The subscription is priced in KRW for KR accounts (ADR-0024): an Apple ID from
  /// another country's App Store would be charged in another currency, which the
  /// server cannot apply. Nil until StoreKit reports the storefront.
  private(set) var storefrontCountry: String?
  var isKoreanStorefront: Bool { storefrontCountry == "KOR" }

  /// Can the purchase be offered now? Only when the server says so, the product
  /// loaded and the Apple ID buys in the Korean App Store.
  var canPurchase: Bool {
    status?.available == true && product != nil && isKoreanStorefront && !busy
  }
  var isAppStoreSubscription: Bool { status?.subscription?.source == "app_store" }

  /// Loads the server status and the product. Call after sign-in and when the account opens.
  func refresh() async {
    do {
      let s = try await account.appStoreStatus()
      status = s
      storefrontCountry = await Storefront.current?.countryCode
      if product?.id != s.productId {
        product = try await Product.products(for: [s.productId]).first
      }
    } catch APIError.server(503, _, _) {
      status = nil  // in-app purchase is off on this server
    } catch {
      message = "구독 정보를 불러오지 못했어요."
    }
  }

  /// Applies renewals, restores and purchases completed elsewhere (other devices,
  /// Ask to Buy approvals) for as long as the app runs.
  func listen() {
    guard updates == nil else { return }
    updates = Task { [weak self] in
      for await result in Transaction.updates {
        await self?.deliver(result)
      }
    }
    Task { [weak self] in
      for await result in Transaction.unfinished { await self?.deliver(result) }
    }
  }

  func stop() {
    updates?.cancel()
    updates = nil
    status = nil
  }

  func purchase() async {
    guard let product, let token = status?.appAccountToken, status?.available == true else { return }
    guard isKoreanStorefront else {
      message = "한국 App Store 계정에서만 구독할 수 있어요."
      return
    }
    busy = true
    message = nil
    defer { busy = false }
    do {
      switch try await product.purchase(options: [.appAccountToken(token)]) {
      case .success(let result):
        await deliver(result)
      case .pending:
        message = "승인을 기다리고 있어요. 승인되면 자동으로 시작돼요."
      case .userCancelled:
        break
      @unknown default:
        break
      }
    } catch {
      message = "구매하지 못했어요. 잠시 후 다시 시도해 주세요."
    }
    await refresh()
  }

  /// Asks the App Store for this Apple ID's purchases, then sends them again.
  func restore() async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      try await AppStore.sync()
      for await result in Transaction.currentEntitlements { await deliver(result) }
      await refresh()
    } catch {
      message = "구매를 복원하지 못했어요."
    }
  }

  /// Sends a verified transaction to the server and finishes it once accepted. An
  /// unverified one is never sent. Only a permanent refusal — the purchase belongs to
  /// another account (403, 409) — is finished without being applied. Anything else
  /// (rate limited, signed out, not applicable yet) stays unfinished so StoreKit
  /// delivers it again: Apple has already charged, so it must not be dropped.
  private func deliver(_ result: VerificationResult<Transaction>) async {
    guard case .verified(let transaction) = result else {
      message = "App Store 거래를 확인하지 못했어요."
      return
    }
    do {
      try await account.submitAppStoreTransaction(result.jwsRepresentation)
      await transaction.finish()
    } catch APIError.server(let status, _, let text) where status == 403 || status == 409 {
      message = text
      await transaction.finish()
    } catch APIError.server(422, _, _) {
      // The server recorded it for support (charged but not applicable here).
      message = "구독을 반영하지 못했어요. 고객센터에서 확인해 드릴게요."
    } catch {
      // Network or server trouble: leave it unfinished; StoreKit delivers it again.
      message = "구독을 반영하지 못했어요. 연결되면 자동으로 다시 시도해요."
    }
  }
}

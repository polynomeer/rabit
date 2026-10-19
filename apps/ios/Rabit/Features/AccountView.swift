import RabitKit
import StoreKit
import SwiftUI

/// The account sheet (from the home toolbar): subscription (bought in-app through the
/// App Store, ADR-0024) and entitlements, purchases, storage, theme, server and sign-out.
/// Albums are not sold in the app.
struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @AppStorage(ThemeChoice.storageKey) private var theme: ThemeChoice = .system
  @State private var me: Me?
  @State private var subscription: Subscription?
  @State private var entitlements: [Entitlement] = []
  @State private var managing = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          LabeledContent("구독", value: subscriptionText)
          if let s = subscription, s.state == "active" || s.state == "past_due" {
            Text(renewalText(s)).font(.footnote).foregroundStyle(s.state == "past_due" ? Palette.warn : Palette.muted)
          }
          ForEach(entitlements) { e in
            LabeledContent(AccountText.scope(e.scope), value: "\(AccountText.origin(e.origin)) · \(AccountText.status(e.status))")
          }
          NavigationLink("구매 내역") { OrdersView() }
        } header: {
          Text("구독과 이용권")
        }
        storeSection
        if let me {
          Section("계정") {
            LabeledContent("라이선스 지역", value: me.licenseCountry ?? "미설정")
            VStack(alignment: .leading, spacing: 6) {
              LabeledContent(
                "저장 공간",
                value: "\(Int64(me.quota.usedBytes).formatted(.byteCount(style: .file))) / \(Int64(me.quota.maxTotalBytes).formatted(.byteCount(style: .file)))")
              ProgressView(value: Double(me.quota.usedBytes), total: Double(max(me.quota.maxTotalBytes, 1)))
            }
            LabeledContent("지원 문의 ID") {
              Text(me.userId).font(.footnote.monospaced()).textSelection(.enabled)
            }
          }
        }
        Section("화면 테마") {
          Picker("화면 테마", selection: $theme) {
            ForEach(ThemeChoice.allCases) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
        }
        Section("서버") {
          LabeledContent("API", value: model.config.apiBaseURL.absoluteString)
        }
        Section {
          Button("로그아웃", role: .destructive) {
            dismiss()
            model.signOut()
          }
        }
      }
      .task {
        await load()
        await model.store.refresh()
      }
      .manageSubscriptionsSheet(isPresented: $managing)
      .navigationTitle("계정")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}

extension AccountView {
  /// Buy, restore or manage the in-app subscription. Shown only when the server sells it.
  @ViewBuilder private var storeSection: some View {
    let store = model.store
    if let status = store.status {
      Section {
        if store.isAppStoreSubscription {
          Button("App Store에서 구독 관리") { managing = true }
        } else if status.available, store.storefrontCountry != nil, !store.isKoreanStorefront {
          Text("한국 App Store 계정에서만 구독할 수 있어요. 기기의 Apple ID 국가를 확인해 주세요.")
            .font(.footnote).foregroundStyle(Palette.muted)
        } else if status.available, let product = store.product {
          Button {
            Task {
              await store.purchase()
              await load()
            }
          } label: {
            HStack {
              Text("Listen 구독하기").font(.headline)
              Spacer()
              Text("\(product.displayPrice) / 월")
            }
          }
          .disabled(!store.canPurchase)
        } else if status.unavailableReason == "subscribed_elsewhere" {
          Text("웹에서 구독 중이에요. 같은 계정으로는 구독을 하나만 유지해요.")
            .font(.footnote).foregroundStyle(Palette.muted)
        } else if status.unavailableReason == "region" {
          Text("이 지역에서는 아직 구독할 수 없어요.").font(.footnote).foregroundStyle(Palette.muted)
        }
        Button("구매 복원") {
          Task {
            await store.restore()
            await load()
          }
        }
        .disabled(store.busy)
        if let message = store.message {
          Text(message).font(.footnote).foregroundStyle(Palette.warn)
        }
      } footer: {
        Text(
          "매달 자동으로 결제되고 Apple ID로 청구돼요. 다음 결제 24시간 전까지 App Store 설정에서 언제든 해지할 수 있고, 해지해도 결제한 기간까지는 들을 수 있어요. 구매한 앨범은 구독과 상관없이 계속 재생돼요."
        )
      }
    }
  }

  private var subscriptionText: String {
    guard let s = subscription else { return "구독 없음" }
    return "\(AccountText.plan(s.plan)) · \(AccountText.subscriptionState(s.state))"
  }

  private func renewalText(_ s: Subscription) -> String {
    let date = s.paidThrough.formatted(date: .long, time: .omitted)
    if s.state == "past_due" {
      return s.source == "app_store"
        ? "App Store 결제에 실패했어요. App Store에서 결제 정보를 확인해 주세요."
        : "갱신 결제에 실패했어요. 웹에서 다시 결제하면 바로 이용할 수 있어요."
    }
    if s.source == "operator" { return "\(date)까지 (운영자가 설정)" }
    return s.autoRenew == true ? "\(date)에 자동으로 갱신돼요." : "자동 갱신이 꺼져 있어요. \(date)까지 이용할 수 있어요."
  }

  private func load() async {
    async let m = model.account.me()
    async let s = model.account.subscription()
    async let e = model.account.entitlements()
    me = try? await m
    subscription = (try? await s) ?? nil
    entitlements = (try? await e) ?? []
  }
}

/// Orders, newest first (read-only).
struct OrdersView: View {
  @Environment(AppModel.self) private var model
  @State private var orders: [Order]?

  var body: some View {
    List(orders ?? []) { o in
      VStack(alignment: .leading, spacing: 3) {
        Text(o.kind == "subscription" ? AccountText.plan(o.plan ?? "") : (o.releaseTitle ?? "앨범"))
          .font(.body.weight(.medium))
        Text(
          [o.artistNames.joined(separator: ", ").nilIfEmpty, o.price.formatted, AccountText.orderStatus(o.status),
           o.createdAt.formatted(date: .abbreviated, time: .omitted)]
            .compactMap { $0 }.joined(separator: " · ")
        )
        .font(.footnote).foregroundStyle(Palette.muted)
      }
    }
    .overlay {
      if orders == nil {
        ProgressView()
      } else if orders?.isEmpty == true {
        ContentUnavailableView("구매 내역이 없어요", systemImage: "bag")
      }
    }
    .navigationTitle("구매 내역")
    .task { orders = (try? await model.account.orders()) ?? [] }
  }
}

/// Korean labels for account values (web `account.*` messages).
enum AccountText {
  static func plan(_ p: String) -> String { p == "listen_sandbox" ? "Listen (테스트 요금제)" : p }
  static func subscriptionState(_ s: String) -> String {
    ["active": "이용 중", "past_due": "결제 지연", "cancelled": "해지됨", "expired": "만료됨"][s] ?? s
  }
  static func scope(_ s: String) -> String { ["catalog_all": "전체 카탈로그", "release": "앨범", "recording": "곡"][s] ?? s }
  static func origin(_ o: String) -> String { ["subscription": "구독", "purchase": "구매", "grant": "부여"][o] ?? o }
  static func status(_ s: String) -> String {
    ["active": "유효", "suspended": "일시 중지", "revoked": "취소됨", "expired": "만료됨"][s] ?? s
  }
  static func orderStatus(_ s: String) -> String {
    [
      "pending": "결제 대기", "paid": "결제됨", "fulfilled": "완료", "cancelled": "취소됨", "expired": "만료됨",
      "refund_pending": "환불 대기", "refunded": "환불됨",
    ][s] ?? s
  }
}

import AuthenticationServices
import SwiftUI

/// Sign-in: the provider (Cognito hosted sign-in, OIDC + PKCE in a web authentication
/// session) when configured; debug builds also offer the development issuer (ADR-0009).
struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuth
  @State private var subject = "ios-dev"
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 28) {
      Spacer()
      RabitSymbol()
        .fill(Palette.accent)
        .frame(width: 88, height: 88)
        .accessibilityLabel("Rabit")
      VStack(spacing: 8) {
        Text("좋은 음악은\n더 멀리 데려가요.")
          .font(.largeTitle.weight(.bold))
          .multilineTextAlignment(.center)
        Text(model.config.apiBaseURL.absoluteString)
          .font(.footnote.monospaced())
          .foregroundStyle(Palette.muted)
      }
      Spacer()
      if model.providerSignIn {
        Button {
          Task { await providerSignIn() }
        } label: {
          Text(busy ? "로그인 중…" : "로그인")
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy)
      }
      if model.config.devSignIn {
        VStack(spacing: 12) {
          TextField("개발용 사용자 ID", text: $subject)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 18)
            .frame(height: 52)
            .glassEffect(.regular, in: .capsule)
          Button {
            Task { await signIn() }
          } label: {
            Text(busy ? "로그인 중…" : "개발용으로 로그인")
              .font(.headline)
              .frame(maxWidth: .infinity, minHeight: 36)
          }
          .buttonStyle(.glass)
          .disabled(busy || subject.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      } else if !model.providerSignIn {
        Text("이 빌드에는 로그인 설정이 없어요.")
          .foregroundStyle(Palette.muted)
      }
      if let error {
        Text(error).font(.footnote).foregroundStyle(Palette.warn)
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Palette.background)
  }

  private func providerSignIn() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await model.signIn { url in
        // Ephemeral: no cookies shared with Safari, and no extra consent prompt.
        try await webAuth.authenticate(
          using: url, callback: .customScheme("app.rabit.ios"), preferredBrowserSession: .ephemeral,
          additionalHeaderFields: [:])
      }
    } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
    } catch {
      self.error = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요."
    }
  }

  private func signIn() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await model.devSignIn(subject: subject.trimmingCharacters(in: .whitespaces))
    } catch {
      self.error = "로그인하지 못했어요. 로컬 서버(pnpm dev)가 켜져 있는지 확인해 주세요."
    }
  }
}

import SwiftUI

/// The account sheet (from the home toolbar): theme, server and sign-out.
struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @AppStorage(ThemeChoice.storageKey) private var theme: ThemeChoice = .system

  var body: some View {
    NavigationStack {
      Form {
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

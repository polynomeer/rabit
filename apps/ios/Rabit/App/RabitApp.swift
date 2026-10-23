import SwiftUI

@main
struct RabitApp: App {
  @State private var model = AppModel()
  /// Colour theme (ADR-0022): follow the device, or force dark or light. Per device.
  @AppStorage(ThemeChoice.storageKey) private var theme: ThemeChoice = .system
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .environment(model.player)
        .tint(Palette.accent)
        .preferredColorScheme(theme.colorScheme)
    }
    // Pending diagnostics go out when the app leaves the screen (ADR-0027).
    .onChange(of: scenePhase) { _, phase in
      if phase == .background { model.diagnostics.flush() }
      if phase == .active { Task { await model.refreshFeatures() } }
    }
  }
}

enum ThemeChoice: String, CaseIterable, Identifiable {
  case system, dark, light
  static let storageKey = "rabit.theme"
  var id: String { rawValue }
  var label: LocalizedStringKey {
    switch self {
    case .system: "기기 설정"
    case .dark: "다크"
    case .light: "라이트"
    }
  }
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .dark: .dark
    case .light: .light
    }
  }
}

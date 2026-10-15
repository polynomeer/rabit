import RabitKit
import SwiftUI

enum AppTab: Hashable {
  case home, dig, archive, studio, search
}

struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      if model.signedIn { MainTabs() } else { SignInView() }
    }
    .onReceive(NotificationCenter.default.publisher(for: .rabitSignedOut)) { _ in model.signOut() }
  }
}

/// iOS 26 tab bar: four areas plus the search tab, the player as the bottom accessory.
/// Playlists live under the archive and the account opens as a sheet (design page F/G).
struct MainTabs: View {
  @State private var tab: AppTab = .home
  @State private var nowPlaying = false
  @State private var account = false

  var body: some View {
    TabView(selection: $tab) {
      Tab("홈", systemImage: "house", value: AppTab.home) {
        HomeView(openAccount: { account = true })
      }
      Tab("DIG", systemImage: "point.3.connected.trianglepath.dotted", value: AppTab.dig) {
        ComingSoonView(title: "DIG", systemImage: "point.3.connected.trianglepath.dotted")
      }
      Tab("보관함", systemImage: "archivebox", value: AppTab.archive) {
        ComingSoonView(title: "보관함", systemImage: "archivebox")
      }
      Tab("Studio", systemImage: "slider.vertical.3", value: AppTab.studio) {
        ComingSoonView(title: "Studio", systemImage: "slider.vertical.3")
      }
      Tab(value: AppTab.search, role: .search) {
        SearchView()
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .tabViewBottomAccessory {
      MiniPlayer(open: { nowPlaying = true })
    }
    .sheet(isPresented: $nowPlaying) { NowPlayingView() }
    .sheet(isPresented: $account) { AccountView() }
  }
}

/// Areas that arrive in the next steps of the iOS client.
struct ComingSoonView: View {
  let title: LocalizedStringKey
  let systemImage: String

  var body: some View {
    NavigationStack {
      ContentUnavailableView(
        title, systemImage: systemImage, description: Text("iOS에서는 다음 단계에서 열려요. 지금은 웹에서 쓸 수 있어요."))
        .navigationTitle(title)
    }
  }
}

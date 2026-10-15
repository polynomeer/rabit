// swift-tools-version: 6.2
import PackageDescription

// UI-free core of the iOS client: API models and client, token storage, playback
// sessions and media URLs. Builds and tests on macOS too (`swift test`), so it runs
// without the iOS SDK.
let package = Package(
  name: "RabitKit",
  platforms: [.iOS("26.0"), .macOS(.v15)],
  products: [.library(name: "RabitKit", targets: ["RabitKit"])],
  targets: [
    .target(name: "RabitKit"),
    .testTarget(name: "RabitKitTests", dependencies: ["RabitKit"]),
  ]
)

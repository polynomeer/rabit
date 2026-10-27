import RabitKit
import SwiftUI

/// Where a DIG screen starts: a new exploration from an entity, or an earlier session.
nonisolated enum DigRoute: Hashable {
  case start(EntityID)
  case session(DigSessionID)
  /// Blind Digging, from an entity's connections or from the whole catalog.
  case blind(EntityID?)
  case crate
  /// Label Digging: a label's releases by year and its artists' spans.
  case label(EntityID)
  /// Artist Journey (EX-02) and two of the artist's releases side by side (EX-03).
  case journey(EntityID)
  case compare(EntityID, ReleaseID, ReleaseID)
  /// Time Radio setup (ADR-0034).
  case timeMachine
  /// Rediscover (EX-06): saved tracks not played for a while.
  case rediscover
}

extension View {
  /// Album and DIG pages can open from any tab's navigation stack.
  func rabitDestinations() -> some View {
    navigationDestination(for: ReleaseID.self) { ReleaseView(id: $0) }
      .navigationDestination(for: DigRoute.self) { route in
        switch route {
        case .start, .session: DigSessionView(route: route)
        case .blind(let entity): BlindDigView(start: entity)
        case .crate: CrateDigView()
        case .label(let label): LabelTimelineView(label: label)
        case .journey(let artist): JourneyView(artist: artist)
        case .compare(let artist, let a, let b): CompareView(artist: artist, a: a, b: b)
        case .timeMachine: TimeMachineSetupView()
        case .rediscover: RediscoverView()
        }
      }
  }
}

/// The picture for a catalog entity: a cover for recordings and releases, an initial otherwise.
struct EntityMark: View {
  let entity: EntitySummary

  var body: some View {
    switch entity.entityType {
    case "recording": CoverView(id: entity.primaryReleaseId?.rawValue ?? entity.entityId.rawValue, corner: 8)
    case "release": CoverView(id: entity.entityId.rawValue, corner: 8)
    default:
      Circle()
        .fill(Palette.surface)
        .overlay { Text(entity.name.prefix(1).uppercased()).font(.headline) }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
  }
}

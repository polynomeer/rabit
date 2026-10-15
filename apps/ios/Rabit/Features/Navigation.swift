import RabitKit
import SwiftUI

/// Where a DIG screen starts: a new exploration from an entity, or an earlier session.
nonisolated enum DigRoute: Hashable {
  case start(EntityID)
  case session(DigSessionID)
  /// Blind Digging, from an entity's connections or from the whole catalog.
  case blind(EntityID?)
  case crate
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

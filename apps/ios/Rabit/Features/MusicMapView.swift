import MapKit
import SwiftUI

/// How close the DIG map may go (ADR-0038): city level, as on the web (zoom 10). Pure, so
/// the cap and the zoom buttons are tested without a map.
enum MapZoom {
  /// The closest camera distance in metres: a city fills the screen, a neighbourhood never does.
  static let cityDistance: CLLocationDistance = 60_000
  static let farthestDistance: CLLocationDistance = 30_000_000
  /// East Asia, where the catalog starts.
  static let start = MKCoordinateRegion(
    center: CLLocationCoordinate2D(latitude: 35.5, longitude: 129.0),
    span: MKCoordinateSpan(latitudeDelta: 22, longitudeDelta: 22))

  static var bounds: MapCameraBounds {
    MapCameraBounds(minimumDistance: cityDistance, maximumDistance: farthestDistance)
  }

  /// One zoom button step: halves (in) or doubles (out) the distance, within the bounds.
  static func step(_ distance: CLLocationDistance, zoomIn: Bool) -> CLLocationDistance {
    min(max(zoomIn ? distance / 2 : distance * 2, cityDistance), farthestDistance)
  }

  static func atCityLevel(_ distance: CLLocationDistance) -> Bool { distance <= cityDistance * 1.01 }
}

/// The DIG map (ADR-0038): Apple Maps, muted, without points of interest, traffic,
/// rotation or tilt, and never closer than a city. The app never asks for or sends the
/// device's location. Every map has an equivalent list (ATL-001).
struct MusicMapView: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var position = MapCameraPosition.region(MapZoom.start)
  @State private var camera: MapCamera?

  var body: some View {
    List {
      Section {
        Map(position: $position, bounds: MapZoom.bounds, interactionModes: [.pan, .zoom])
          .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
          .accessibilityLabel("지도 화면")
          .onMapCameraChange { context in camera = context.camera }
          // The zoom buttons stay their own accessibility elements, outside the map's.
          .overlay(alignment: .topTrailing) { zoomButtons.padding(10) }
          .frame(height: 420)
          .clipShape(RoundedRectangle(cornerRadius: 20))
          .listRowInsets(EdgeInsets())
      } footer: {
        Text("세계에서 도시까지 확대해 볼 수 있어요. 도시보다 더 가까이는 보지 않아요. 내 위치는 쓰지 않아요.")
      }
      Section("목록으로 보기") {
        Text("아직 지도에 올릴 도시가 없어요. 아티스트와 앨범의 지역 정보가 준비되면 지도와 같은 내용을 여기에도 보여 줘요.")
          .font(.footnote).foregroundStyle(Palette.muted)
      }
    }
    .navigationTitle("음악 지도")
  }

  private var zoomButtons: some View {
    VStack(spacing: 0) {
      zoomButton(zoomIn: true)
      Divider().frame(width: 28)
      zoomButton(zoomIn: false)
    }
    .glassEffect(.regular, in: .rect(cornerRadius: 14))
  }

  private func zoomButton(zoomIn: Bool) -> some View {
    let distance = camera?.distance
    let disabled = zoomIn ? distance.map(MapZoom.atCityLevel) ?? false : distance.map { $0 >= MapZoom.farthestDistance } ?? false
    return Button(zoomIn ? "확대" : "축소", systemImage: zoomIn ? "plus" : "minus") { zoom(in: zoomIn) }
      .labelStyle(.iconOnly)
      .font(.body.weight(.semibold))
      .frame(width: 44, height: 44)
      .disabled(disabled)
  }

  private func zoom(in zoomIn: Bool) {
    guard let camera else { return }
    let next = MapCamera(centerCoordinate: camera.centerCoordinate, distance: MapZoom.step(camera.distance, zoomIn: zoomIn))
    if reduceMotion {
      position = .camera(next)
    } else {
      withAnimation(.easeInOut(duration: 0.3)) { position = .camera(next) }
    }
  }
}

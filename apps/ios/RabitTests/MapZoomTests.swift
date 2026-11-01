import Testing

@testable import Rabit

/// The DIG map's zoom cap (ADR-0038): never closer than a city.
@MainActor
struct MapZoomTests {
  @Test func zoomButtonsStopAtCityLevel() {
    #expect(MapZoom.step(200_000, zoomIn: true) == 100_000)
    #expect(MapZoom.step(100_000, zoomIn: true) == MapZoom.cityDistance)
    #expect(MapZoom.step(MapZoom.cityDistance, zoomIn: true) == MapZoom.cityDistance)
    #expect(MapZoom.atCityLevel(MapZoom.cityDistance))
    #expect(!MapZoom.atCityLevel(100_000))
  }

  @Test func zoomOutStopsAtTheWorld() {
    #expect(MapZoom.step(MapZoom.farthestDistance, zoomIn: false) == MapZoom.farthestDistance)
    #expect(MapZoom.step(1_000_000, zoomIn: false) == 2_000_000)
  }
}

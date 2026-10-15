import Foundation
import RabitKit
import Testing

@testable import Rabit

@MainActor
struct AppConfigTests {
  @Test func environmentOverridesInfoPlist() {
    let c = AppConfig.load(
      info: ["RabitAPIBaseURL": "http://localhost:8080"], environment: ["RABIT_API_BASE": "http://localhost:28080"])
    #expect(c.apiBaseURL.absoluteString == "http://localhost:28080")
  }

  @Test func blankOrInvalidValuesFallBack() {
    let c = AppConfig.load(info: ["RabitAPIBaseURL": ""], environment: ["RABIT_API_BASE": "not a url"])
    #expect(c.apiBaseURL == AppConfig.fallbackBaseURL)
    let ftp = AppConfig.load(info: ["RabitAPIBaseURL": "ftp://example.com"], environment: [:])
    #expect(ftp.apiBaseURL == AppConfig.fallbackBaseURL)
  }

  @Test func debugBuildsOfferDevSignIn() {
    #expect(AppConfig.load(info: [:], environment: [:]).devSignIn)
  }

  @Test func libraryReleasesOpenTheirAlbumInsteadOfPlaying() throws {
    let json = """
      {"library_item_id":"lib_1","ref_type":"release","ref_id":"rel_1","origin":"saved","title":"Harbour Lights",
       "subtitle":"Velvet Quasar","note":null,"saved_at":"2026-10-15T09:00:00.000Z","ownership":"streaming",
       "playability":{"playable":true,"reason":null}}
      """
    let item = try APIClient.decoder.decode(LibraryItem.self, from: Data(json.utf8))
    #expect(QueueEntry(item: item) == nil)
  }

  @Test func ownAudioSearchHitsPlayAsAudioSources() throws {
    let json = #"{"kind":"audio_log","id":"aus_1","title":"한강 새벽","subtitle":null,"match":"text","scope":"mine"}"#
    let hit = try APIClient.decoder.decode(SearchResult.self, from: Data(json.utf8))
    let entry = try #require(QueueEntry(result: hit))
    #expect(entry.target == .audioSource(AudioSourceID("aus_1")))
    #expect(entry.coverId == nil)
  }
}

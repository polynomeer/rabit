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

  @Test func providerSignInNeedsIssuerAndClient() throws {
    #expect(AppConfig.load(info: ["RabitOIDCIssuer": "", "RabitOIDCClientID": ""], environment: [:]).oidc == nil)
    let cognito = try #require(
      AppConfig.load(
        info: [
          "RabitOIDCIssuer": "https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_x",
          "RabitOIDCClientID": "abc",
        ], environment: [:]
      ).oidc)
    #expect(cognito.clientId == "abc")
    #expect(cognito.redirectURI.absoluteString == "app.rabit.ios://auth/callback")
    // Plain HTTP only for the local mock provider.
    let mock = AppConfig.load(
      info: [:], environment: ["RABIT_OIDC_ISSUER": "http://localhost:8090/rabit", "RABIT_OIDC_CLIENT_ID": "rabit-ios"])
    #expect(mock.oidc?.issuer.absoluteString == "http://localhost:8090/rabit")
    let plain = AppConfig.load(
      info: [:], environment: ["RABIT_OIDC_ISSUER": "http://idp.example/pool", "RABIT_OIDC_CLIENT_ID": "x"])
    #expect(plain.oidc == nil)
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

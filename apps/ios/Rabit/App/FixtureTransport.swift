#if DEBUG
  import Foundation
  import RabitKit

  /// Canned API answers for UI tests (launch argument `-RabitUITesting`): the app runs
  /// without a server, so its screens can be driven in the simulator in CI. Anything not
  /// listed answers 404, which the screens already handle. Debug builds only.
  nonisolated struct FixtureTransport: HTTPTransport {
    static let launchArgument = "-RabitUITesting"
    static var isActive: Bool { ProcessInfo.processInfo.arguments.contains(launchArgument) }

    static let releaseId = "rel_01HZZZZZZZZZZZZZZZZZZZZZZZ"

    private static let routes: [String: (Int, String)] = [
      "POST /dev/token": (200, #"{"access_token":"ui-test"}"#),
      "GET /v1/features": (200, #"{"features":{"client_diagnostics":false}}"#),
      "GET /v1/library": (200, #"{"items":[],"next_cursor":null}"#),
      "GET /v1/dig-sessions": (200, #"{"items":[],"next_cursor":null}"#),
      "GET /v1/queue": (
        200,
        #"{"mode":"queue","autoplay":true,"include_inferred":false,"current_item_id":null,"version":0,"items":[]}"#
      ),
      "GET /v1/editorial/shelves": (
        200,
        """
        {"shelves":[{"shelf_id":"eds_01HZZZZZZZZZZZZZZZZZZZZZZZ","title":"이번 주의 발견","description":null,
          "items":[{"release":{"release_id":"\(releaseId)","title":"Harbour Lights","release_type":"album",
            "release_date":"2024-03-01"},
            "artists":[{"entity_id":"art_01HZZZZZZZZZZZZZZZZZZZZZZZ","entity_type":"artist",
              "name":"Velvet Quasar","subtitle":null,"primary_release_id":null}],
            "label":null,"available_tracks":2,"playable_tracks":2,"note":"밤바다를 닮은 앨범"}]}]}
        """
      ),
      "GET /v1/releases/\(releaseId)": (
        200,
        """
        {"release_id":"\(releaseId)","title":"Harbour Lights","release_type":"album",
         "artists":[{"entity_id":"art_01HZZZZZZZZZZZZZZZZZZZZZZZ","name":"Velvet Quasar"}],
         "label":null,"release_date":"2024-03-01",
         "tracks":[
          {"disc_no":1,"position":1,"recording_id":"rec_01HZZZZZZZZZZZZZZZZZZZZZZZ","title":"Midnight Harbour",
           "duration_ms":214000,"playability":{"playable":true,"reason":null}},
          {"disc_no":1,"position":2,"recording_id":"rec_01HZZZZZZZZZZZZZZZZZZZZZZY","title":"Morning Tide",
           "duration_ms":180000,"playability":{"playable":true,"reason":null}}]}
        """
      ),
      "POST /v1/client-diagnostics": (204, ""),
    ]

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
      let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
      let (status, body) =
        Self.routes[key]
        ?? (404, #"{"error":{"code":"NOT_FOUND","message":"Not in the UI test fixtures."}}"#)
      let response = HTTPURLResponse(
        url: request.url ?? URL(string: "http://localhost")!, statusCode: status, httpVersion: nil,
        headerFields: ["content-type": "application/json"])!
      return (Data(body.utf8), response)
    }

    func upload(for request: URLRequest, fromFile file: URL) async throws -> (Data, URLResponse) {
      try await data(for: request)
    }
  }
#endif

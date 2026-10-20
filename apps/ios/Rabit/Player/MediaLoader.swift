import AVFoundation
import RabitKit
import Synchronization
import UniformTypeIdentifiers

/// Serves the player's `rabit-media://` requests (ADR-0023). Playlists are fetched here
/// so its relative segment URIs stay on the custom scheme; each segment request is then
/// redirected to the media gateway with the newest media token, which the session
/// refresh rotates every 40 s (tokens live ≤ 60 s, ADR-0008).
nonisolated final class MediaLoader: NSObject, AVAssetResourceLoaderDelegate, Sendable {
  let queue = DispatchQueue(label: "app.rabit.media-loader")
  private let locator: Mutex<MediaLocator>
  private let session = URLSession(configuration: .ephemeral)

  init(locator: MediaLocator) {
    self.locator = Mutex(locator)
  }

  func update(token: String) {
    locator.withLock { $0 = $0.withToken(token) }
  }

  func resourceLoader(
    _ resourceLoader: AVAssetResourceLoader,
    shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
  ) -> Bool {
    guard let url = loadingRequest.request.url,
      let target = locator.withLock({ $0.gatewayURL(for: url) })
    else { return false }

    // Playlists (master and per rendition) are served here so their relative URIs stay
    // on the custom scheme; segments are redirected to the gateway.
    if url.pathExtension == "m3u8" {
      let pending = Pending(request: loadingRequest)
      session.dataTask(with: target) { data, response, error in
        let request = pending.request
        guard let data, (response as? HTTPURLResponse)?.statusCode == 200 else {
          request.finishLoading(with: error ?? URLError(.badServerResponse))
          return
        }
        if let info = request.contentInformationRequest {
          info.contentType = UTType.m3uPlaylist.identifier
          info.contentLength = Int64(data.count)
          info.isByteRangeAccessSupported = false
        }
        request.dataRequest?.respond(with: data)
        request.finishLoading()
      }.resume()
      return true
    }

    loadingRequest.redirect = URLRequest(url: target)
    loadingRequest.response = HTTPURLResponse(
      url: target, statusCode: 302, httpVersion: nil, headerFields: ["Location": target.absoluteString])
    loadingRequest.finishLoading()
    return true
  }
}

/// AVFoundation hands the request to one callback at a time; it is only touched there.
nonisolated private struct Pending: @unchecked Sendable {
  let request: AVAssetResourceLoadingRequest
}

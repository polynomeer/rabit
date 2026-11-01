import XCTest

/// UI tests (CQ-IOS-3) against canned API answers (`FixtureTransport`): sign in, the
/// editors' shelf on Home, an album from it, the account's playback settings and the DIG map.
final class RabitUITests: XCTestCase {
  @MainActor
  private func signedIn() -> XCUIApplication {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-RabitUITesting"]
    app.launch()
    let field = app.textFields["개발용 사용자 ID"]
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    field.typeText("ui-tester")
    app.buttons["개발용으로 로그인"].tap()
    return app
  }

  @MainActor
  func testSignInShowsTheEditorsShelf() {
    let app = signedIn()
    XCTAssertTrue(app.staticTexts["이번 주의 발견"].waitForExistence(timeout: 15))
  }

  @MainActor
  func testAnAlbumOpensFromTheShelfWithItsTracks() {
    let app = signedIn()
    let album = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Harbour Lights")).firstMatch
    XCTAssertTrue(album.waitForExistence(timeout: 15))
    album.tap()
    XCTAssertTrue(app.staticTexts["Midnight Harbour"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["Morning Tide"].exists)
  }

  @MainActor
  func testAccountShowsPlaybackSettings() {
    let app = signedIn()
    let account = app.buttons["계정"]
    XCTAssertTrue(account.waitForExistence(timeout: 15))
    account.tap()
    let settings = app.staticTexts["재생 방식"]
    let list = app.collectionViews.firstMatch
    for _ in 0..<6 where !settings.exists {
      list.swipeUp()
    }
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
  }

  @MainActor
  func testDigMapOpensWithItsList() {
    let app = signedIn()
    let dig = app.buttons["DIG"]
    XCTAssertTrue(dig.waitForExistence(timeout: 15))
    dig.tap()
    let link = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "음악 지도")).firstMatch
    XCTAssertTrue(link.waitForExistence(timeout: 15))
    link.tap()
    XCTAssertTrue(app.navigationBars["음악 지도"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.buttons["확대"].exists)
    XCTAssertTrue(app.staticTexts["목록으로 보기"].waitForExistence(timeout: 5))
  }
}

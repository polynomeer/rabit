import XCTest

/// UI tests (CQ-IOS-3) against canned API answers (`FixtureTransport`): sign in, the
/// editors' shelf on Home, an album from it, and the account's playback settings.
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
}

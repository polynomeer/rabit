import RabitKit
import SwiftUI

/// Label Digging (DIG-011): the label's releases by year (undated last) and how long each
/// artist released on it. Starts a DIG exploration from the label too.
struct LabelTimelineView: View {
  @Environment(AppModel.self) private var model
  let label: EntityID

  @State private var timeline: LabelTimeline?
  @State private var failed = false

  var body: some View {
    List {
      if let timeline {
        if timeline.truncated {
          Text("발매작이 많아 처음 1000개만 보여 줘요.").font(.footnote).foregroundStyle(Palette.muted)
        }
        ForEach(timeline.years, id: \.year) { year in
          Section(year.year.map(String.init) ?? "발매일 미상") {
            ForEach(year.releases) { release in
              NavigationLink(value: release.releaseId) { ReleaseLine(release: release) }
            }
          }
        }
        if !timeline.artists.isEmpty {
          Section("이 레이블의 아티스트") {
            ForEach(timeline.artists, id: \.artist.entityId) { a in
              NavigationLink(value: DigRoute.start(a.artist.entityId)) {
                HStack(spacing: 12) {
                  EntityMark(entity: a.artist).frame(width: 40, height: 40)
                  VStack(alignment: .leading, spacing: 2) {
                    Text(a.artist.name).font(.body.weight(.medium))
                    Text("\(DigText.span(first: a.firstYear, last: a.lastYear)) · 발매작 \(a.releases)개")
                      .font(.footnote).foregroundStyle(Palette.muted)
                  }
                }
              }
              .accessibilityHint("이 아티스트에서 DIG 시작")
            }
          }
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("타임라인을 불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if timeline == nil {
        ProgressView()
      } else if timeline?.years.isEmpty == true {
        ContentUnavailableView("발매작이 없어요", systemImage: "calendar")
      }
    }
    .navigationTitle(timeline?.label.name ?? "레이블 타임라인")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        NavigationLink(value: DigRoute.start(label)) {
          Image(systemName: "point.3.connected.trianglepath.dotted")
        }
        .accessibilityLabel("이 레이블에서 DIG 시작")
      }
    }
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    failed = false
    do {
      timeline = try await model.dig.labelTimeline(label)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }
}

private struct ReleaseLine: View {
  let release: LabelTimeline.Release

  var body: some View {
    HStack(spacing: 12) {
      CoverView(id: release.releaseId.rawValue, corner: 8).frame(width: 48, height: 48)
      VStack(alignment: .leading, spacing: 2) {
        Text(release.title).font(.body.weight(.medium)).lineLimit(1)
        Text(
          ([release.artists.map(\.name).joined(separator: ", ")] + [kind]).filter { !$0.isEmpty }
            .joined(separator: " · ")
        )
        .font(.footnote).foregroundStyle(Palette.muted).lineLimit(1)
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var kind: String {
    switch release.releaseType {
    case "album": "앨범"
    case "single": "싱글"
    case "ep": "EP"
    case "compilation": "컴필레이션"
    default: release.releaseType
    }
  }
}

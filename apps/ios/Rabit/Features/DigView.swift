import RabitKit
import SwiftUI

/// The DIG tab: earlier explorations to resume. New ones start from search or an album.
struct DigHomeView: View {
  @Environment(AppModel.self) private var model
  @State private var sessions: [DigSessionSummary]?
  @State private var failed = false

  var body: some View {
    NavigationStack {
      List {
        Section {
          NavigationLink(value: DigRoute.blind(nil)) {
            Label {
              VStack(alignment: .leading, spacing: 2) {
                Text("Blind Digging").font(.body.weight(.semibold))
                Text("정보를 가린 채 듣고 Keep 또는 Pass").font(.footnote).foregroundStyle(Palette.muted)
              }
            } icon: {
              Image(systemName: "eye.slash")
            }
          }
          NavigationLink(value: DigRoute.crate) {
            Label {
              VStack(alignment: .leading, spacing: 2) {
                Text("Crate Digging").font(.body.weight(.semibold))
                Text("시대와 인기로 앨범 상자 뒤지기").font(.footnote).foregroundStyle(Palette.muted)
              }
            } icon: {
              Image(systemName: "shippingbox")
            }
          }
        }
        Section("이전 탐험") {
          if sessions?.isEmpty == true {
            Text("아직 탐험이 없어요. 검색에서 아티스트를 고르거나 앨범의 DIG 버튼으로 시작해 보세요.")
              .font(.footnote).foregroundStyle(Palette.muted)
          }
          ForEach(sessions ?? []) { s in
            NavigationLink(value: DigRoute.session(s.digSessionId)) {
              HStack(spacing: 12) {
                if let entity = s.startEntity { EntityMark(entity: entity).frame(width: 44, height: 44) }
                VStack(alignment: .leading, spacing: 2) {
                  Text(s.title ?? s.startEntity?.name ?? "이름 없는 탐험").font(.body.weight(.medium))
                  Text("\(s.nodes)곳 · \(s.state == "active" ? "진행 중" : "끝남")")
                    .font(.footnote).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                if s.saved {
                  Image(systemName: "bookmark.fill").foregroundStyle(Palette.accent).accessibilityLabel("저장됨")
                }
              }
            }
          }
        }
      }
      .overlay {
        if failed {
          ContentUnavailableView("불러오지 못했어요", systemImage: "exclamationmark.triangle")
        } else if sessions == nil {
          ProgressView()
        }
      }
      .navigationTitle("DIG")
      .rabitDestinations()
      .task { await load() }
      .refreshable { await load() }
    }
  }

  private func load() async {
    failed = false
    do {
      sessions = try await model.dig.sessions()
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }
}

/// One exploration: the current node, the trail, axes and the connections to follow.
struct DigSessionView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  let route: DigRoute

  @State private var session: DigSession?
  @State private var axes: [DigAxes.Entry] = []
  @State private var axis: DigAxis?
  @State private var connections: [DigConnection]?
  @State private var popularity: PopularityFilter = .any
  @State private var includeInferred = true
  @State private var busy = false
  @State private var message: String?
  @State private var notice: String?
  @State private var blindFrom: EntityID?
  var body: some View {
    ScrollView {
      if let session {
        VStack(alignment: .leading, spacing: 18) {
          if let node = session.current { header(node, session: session) }
          if session.trail.count > 1 { trail(session) }
          if let empty = session.emptyState {
            Label(empty.message, systemImage: "info.circle").foregroundStyle(Palette.muted)
          }
          if !axes.isEmpty { axisPicker }
          connectionList
          if let message {
            Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(Palette.warn)
          }
          if let notice {
            Label(notice, systemImage: "checkmark.circle").foregroundStyle(Palette.ok)
          }
        }
        .padding(20)
      } else if let message {
        ContentUnavailableView(message, systemImage: "exclamationmark.triangle").padding(.top, 120)
      } else {
        ProgressView("탐험을 준비하는 중…").padding(.top, 160)
      }
    }
    .background(Palette.background)
    .navigationTitle("DIG")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbar }
    .navigationDestination(item: $blindFrom) { BlindDigView(start: $0) }
    .disabled(busy)
    .task { await open() }
    .onChange(of: popularity) { Task { await loadConnections() } }
    .onChange(of: includeInferred) { Task { await loadConnections() } }
  }

  // MARK: Parts

  private func header(_ node: DigSession.Node, session: DigSession) -> some View {
    HStack(spacing: 14) {
      EntityMark(entity: node.entity).frame(width: 72, height: 72)
      VStack(alignment: .leading, spacing: 2) {
        Text("지금 파는 곳").font(.caption.weight(.semibold)).foregroundStyle(Palette.accent)
        Text(node.entity.name).font(.title3.bold())
        if let subtitle = node.entity.subtitle {
          Text(subtitle).font(.footnote).foregroundStyle(Palette.muted)
        }
      }
      Spacer(minLength: 0)
      if node.entity.entityType == "recording" {
        Button {
          play(node, in: session)
        } label: {
          Image(systemName: "play.fill").frame(width: 28, height: 28)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .accessibilityLabel("\(node.entity.name) 재생")
      }
    }
  }

  private func trail(_ session: DigSession) -> some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(session.trail) { node in
          ChoiceButton(title: node.entity.name, selected: node.seq == session.currentSeq) {
            Task { await change { try await model.dig.moveCursor(session.digSessionId, to: node.seq) } }
          }
          .disabled(node.seq == session.currentSeq || !session.isActive)
          .accessibilityLabel("\(node.seq + 1)번째: \(node.entity.name)")
        }
      }
    }
    .scrollIndicators(.hidden)
    .accessibilityLabel("Trail")
  }

  private var axisPicker: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(axes, id: \.axis) { entry in
          ChoiceButton(title: "\(DigText.axis(entry.axis)) \(entry.count)", selected: entry.axis == axis) {
            axis = entry.axis
            Task { await loadConnections() }
          }
          .disabled(entry.count == 0)
          .accessibilityAddTraits(entry.axis == axis ? .isSelected : [])
        }
      }
    }
    .scrollIndicators(.hidden)
  }

  @ViewBuilder private var connectionList: some View {
    if let connections {
      if connections.isEmpty {
        Text("이 축으로는 이어지는 곳이 없어요.").foregroundStyle(Palette.muted)
      }
      ForEach(Array(connections.enumerated()), id: \.offset) { _, c in
        Button {
          follow(c)
        } label: {
          ConnectionCard(connection: c)
        }
        .buttonStyle(.plain)
        .disabled(session?.isActive != true)
      }
    } else if axis != nil {
      ProgressView().frame(maxWidth: .infinity)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if let session {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Task { await change { try await model.dig.setSaved(!session.saved, session: session.digSessionId) } }
        } label: {
          Image(systemName: session.saved ? "bookmark.fill" : "bookmark")
        }
        .accessibilityLabel(session.saved ? "탐험 저장 취소" : "탐험 저장")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker("인기도", selection: $popularity) {
            ForEach(PopularityFilter.allCases, id: \.self) { Text(Self.popularityText($0)).tag($0) }
          }
          Toggle("추정 연결 포함", isOn: $includeInferred)
          if let entity = session.current?.entity.entityId {
            Button("여기서 Blind Digging", systemImage: "eye.slash") { blindFrom = entity }
          }
          Divider()
          Button("Trail로 플레이리스트 만들기", systemImage: "music.note.list") {
            Task { await makePlaylist(session) }
          }
          if session.isActive {
            Button("탐험 끝내기", systemImage: "flag.checkered") {
              Task { await change { try await model.dig.end(session.digSessionId) } }
            }
          }
        } label: {
          Image(systemName: "ellipsis")
        }
        .accessibilityLabel("더 보기")
      }
    }
  }

  // MARK: Actions

  private func open() async {
    guard session == nil else { return }
    do {
      switch route {
      case .start(let entity): session = try await model.dig.start(from: entity)
      case .session(let id): session = try await model.dig.session(id)
      case .blind, .crate: return  // routed to their own screens
      }
      await loadAxes()
    } catch {
      message = "DIG를 시작하지 못했어요."
    }
  }

  private func loadAxes() async {
    guard let entity = session?.current?.entity.entityId else { return }
    axes = (try? await model.dig.axes(of: entity).axes) ?? []
    if !axes.contains(where: { $0.axis == axis && $0.count > 0 }) {
      axis = axes.first(where: { $0.count > 0 })?.axis
    }
    await loadConnections()
  }

  private func loadConnections() async {
    guard let entity = session?.current?.entity.entityId, let axis else {
      connections = []
      return
    }
    connections = nil
    do {
      connections = try await model.dig.connections(
        of: entity, axis: axis, popularity: popularity, includeInferred: includeInferred)
    } catch is CancellationError {
    } catch {
      connections = []
      message = "연결을 불러오지 못했어요."
    }
  }

  private func follow(_ c: DigConnection) {
    guard let id = session?.digSessionId else { return }
    Task { await change { try await model.dig.step(id, along: c) } }
  }

  /// Applies one session change at a time and reloads axes when the node moved.
  private func change(_ op: () async throws -> DigSession) async {
    busy = true
    message = nil
    defer { busy = false }
    let before = session?.currentSeq
    do {
      session = try await op()
      if session?.currentSeq != before { await loadAxes() }
    } catch {
      message = "바꾸지 못했어요. 다시 시도해 주세요."
    }
  }

  private func play(_ node: DigSession.Node, in session: DigSession) {
    player.play(
      [
        QueueEntry(
          target: .recording(RecordingID(node.entity.entityId.rawValue)), title: node.entity.name,
          artist: node.entity.subtitle ?? "", coverId: node.entity.primaryReleaseId?.rawValue ?? node.entity.entityId.rawValue)
      ], startAt: 0)
    Task { await change { try await model.dig.record(.played, session: session.digSessionId, seq: node.seq) } }
  }

  private func makePlaylist(_ session: DigSession) async {
    do {
      let playlist = try await model.dig.playlistFromTrail(session.digSessionId)
      message = nil
      notice = "‘\(playlist.title)’ 플레이리스트를 만들었어요."
    } catch {
      message = "플레이리스트를 만들지 못했어요."
    }
  }

  static func popularityText(_ p: PopularityFilter) -> String {
    switch p {
    case .any: "Any"
    case .belowTop50: "Below Top 50%"
    case .deepCuts: "Deep Cuts"
    case .obscure: "Obscure"
    }
  }
}

/// One connection: why it exists, where it leads, and how sure we are. ML guesses get a
/// dashed outline and their confidence, so they never look like verified facts.
private struct ConnectionCard: View {
  let connection: DigConnection

  var body: some View {
    let inferred = connection.evidence.basis == .mlInferred
    HStack(alignment: .top, spacing: 12) {
      EntityMark(entity: connection.entity).frame(width: 48, height: 48)
      VStack(alignment: .leading, spacing: 4) {
        Text(DigText.reason(connection.evidence)).font(.caption).foregroundStyle(Palette.muted)
        Text(connection.entity.name).font(.body.weight(.semibold))
        if let subtitle = connection.entity.subtitle {
          Text(subtitle).font(.footnote).foregroundStyle(Palette.muted)
        }
        HStack(spacing: 6) {
          Badge(text: DigText.basis(connection.evidence), style: badgeStyle)
          if connection.evidence.licenseStatus == "licensed" { Badge(text: "라이선스", style: .neutral) }
          if connection.playability?.playable == false, let reason = connection.playability?.reason {
            Text(reason.text).font(.caption2).foregroundStyle(Palette.muted)
          }
        }
        .padding(.top, 2)
      }
      Spacer(minLength: 0)
      Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Palette.muted)
    }
    .padding(14)
    .background {
      RoundedRectangle(cornerRadius: 20)
        .fill(inferred ? Color.clear : Palette.surface)
    }
    .overlay {
      RoundedRectangle(cornerRadius: 20)
        .strokeBorder(
          inferred ? Palette.muted : Palette.line,
          style: StrokeStyle(lineWidth: 1, dash: inferred ? [5, 4] : []))
    }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
    .accessibilityHint("이 연결을 따라가요")
  }

  private var badgeStyle: Badge.Style {
    switch connection.evidence.basis {
    case .verifiedFact: .verified
    case .declared: .neutral
    case .mlInferred: .inferred
    }
  }
}

private struct Badge: View {
  enum Style { case verified, neutral, inferred }
  let text: String
  let style: Style

  var body: some View {
    Text(text)
      .font(.caption2.weight(.bold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(style == .verified ? Palette.ok : style == .inferred ? Palette.muted : Palette.text)
      .background {
        Capsule().fill(style == .verified ? Palette.ok.opacity(0.14) : style == .neutral ? Palette.line : .clear)
      }
      .overlay {
        if style == .inferred {
          Capsule().strokeBorder(Palette.muted, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
        }
      }
  }
}

/// A glass capsule that shows its selection with the prominent (tinted) glass.
private struct ChoiceButton: View {
  let title: String
  let selected: Bool
  let action: () -> Void

  var body: some View {
    if selected {
      Button(action: action) { Text(title).lineLimit(1) }.buttonStyle(.glassProminent)
    } else {
      Button(action: action) { Text(title).lineLimit(1) }.buttonStyle(.glass)
    }
  }
}

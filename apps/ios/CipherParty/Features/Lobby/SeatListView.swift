import SwiftUI

struct LobbySeatPresentation: Equatable, Identifiable, Sendable {
    let id: String
    let displayName: String
    let teamLabel: String
    let roleLabel: String
    let connectionLabel: String
    let isConnected: Bool

    init(seat: SeatSummary) {
        id = seat.playerId
        displayName = seat.displayName
        teamLabel = seat.teamId.map { "\($0.displayName) team" } ?? "No team"
        roleLabel = seat.role.displayName
        isConnected = seat.connected
        connectionLabel = seat.connected ? "Connected" : "Disconnected"
    }

    var accessibilityLabel: String {
        "\(displayName), \(teamLabel), \(roleLabel), \(connectionLabel)"
    }
}

extension TeamID {
    var displayName: String {
        switch self {
        case .red: return "Red"
        case .blue: return "Blue"
        }
    }
}

extension SeatRole {
    var displayName: String {
        switch self {
        case .unassigned: return "Unassigned"
        case .clueGiver: return "Clue-giver"
        case .operative: return "Operative"
        case .spectator: return "Spectator"
        }
    }
}

struct SeatListView: View {
    let seats: [SeatSummary]

    private var rows: [LobbySeatPresentation] {
        seats.map(LobbySeatPresentation.init)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Players")
                    .font(.title3.bold())
                Spacer()
                Text("\(seats.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(seats.count) players")
            }

            if rows.isEmpty {
                Text("Waiting for friends to join…")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(rows) { row in
                        SeatListRow(row: row)
                    }
                }
            }
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lobby.seats")
    }
}

private struct SeatListRow: View {
    let row: LobbySeatPresentation

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(row.isConnected ? Color.green : Color.gray)
                .frame(width: 10, height: 10)
                .padding(.top, 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.displayName)
                    .font(.body.weight(.semibold))
                Text("\(row.teamLabel) · \(row.roleLabel)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(row.connectionLabel)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(row.isConnected ? .green : .secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("lobby.seat.\(row.id)")
        .accessibilityLabel(row.accessibilityLabel)
    }
}

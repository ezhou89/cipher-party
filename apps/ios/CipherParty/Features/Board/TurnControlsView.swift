import SwiftUI

struct TurnControlsView: View {
    let controls: BoardControlsPresentation
    let nomination: Nomination?
    let nominatedCardLabel: String?
    let isCommandPending: Bool
    let onClearNomination: () -> Void
    let onConfirmReveal: (String) -> Void
    let onEndTurn: () -> Void
    let onPause: () -> Void
    let onResume: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let nomination {
                Text("Nominated: " + (nominatedCardLabel ?? nomination.cardId))
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("board.nomination")
            }

            HStack {
                if controls.canNominate, nomination != nil {
                    Button("Clear nomination", systemImage: "xmark.circle") {
                        onClearNomination()
                    }
                    .buttonStyle(.bordered)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.clearNomination")
                }

                if controls.canConfirmReveal, let nomination {
                    Button("Reveal " + (nominatedCardLabel ?? nomination.cardId), systemImage: "eye") {
                        onConfirmReveal(nomination.cardId)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.confirmReveal")
                }

                if controls.canEndTurn {
                    Button("End turn", systemImage: "arrow.turn.down.left") {
                        onEndTurn()
                    }
                    .buttonStyle(.bordered)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.endTurn")
                }
            }

            HStack {
                if controls.canPause {
                    Button("Pause game", systemImage: "pause.fill") {
                        onPause()
                    }
                    .buttonStyle(.bordered)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.pauseGame")
                }

                if controls.canResume {
                    Button("Resume game", systemImage: "play.fill") {
                        onResume()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.resumeControls")
                }
            }

        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.turnControls")
    }
}

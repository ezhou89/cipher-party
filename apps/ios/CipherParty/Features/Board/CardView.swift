import SwiftUI

struct CardView: View {
    let card: BoardCardPresentation
    let onTap: (() -> Void)?

    init(card: BoardCardPresentation, onTap: (() -> Void)? = nil) {
        self.card = card
        self.onTap = onTap
    }

    @ViewBuilder
    var body: some View {
        if let onTap, card.isSelectable {
            Button(action: onTap) {
                cardContent
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("board.card.\(card.id)")
        } else {
            cardContent
                .accessibilityIdentifier("board.card.\(card.id)")
        }
    }

    private var cardContent: some View {
        VStack(spacing: 8) {
            if let owner = card.owner {
                Text(owner.glyph)
                    .font(.title2)
                    .accessibilityHidden(true)
            } else if let keyOwner = card.keyOwner {
                Text(keyOwner.glyph)
                    .font(.title2)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: card.isRevealed ? "checkmark" : "rectangle")
                    .font(.title3)
                    .accessibilityHidden(true)
            }

            Text(card.label)
                .font(.body.weight(.semibold))
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.75)

            if let owner = card.owner {
                Text(owner.displayName)
                    .font(.caption.weight(.medium))
            } else if let keyOwner = card.keyOwner {
                Text(keyOwner.displayName)
                    .font(.caption.weight(.medium))
            } else if card.isNominated {
                Text("Nominated")
                    .font(.caption.weight(.medium))
            }
        }
        .foregroundStyle(foregroundColor)
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(10)
        .background(backgroundColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            if let ownership = card.owner ?? card.keyOwner {
                OwnershipTexture(ownership: ownership)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(borderColor, lineWidth: card.isNominated ? 3 : 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.accessibilityLabel)
        .accessibilityHint(card.isSelectable ? "Double tap to nominate or clear this card." : "")
    }

    private var foregroundColor: Color {
        if card.owner != nil || card.keyOwner != nil {
            return .primary
        }
        return .primary
    }

    private var backgroundColor: Color {
        if let owner = card.owner {
            return owner.color.opacity(0.24)
        }
        if let keyOwner = card.keyOwner {
            return keyOwner.color.opacity(0.2)
        }
        if card.isNominated {
            return Color.accentColor.opacity(0.14)
        }
        return Color.primary.opacity(0.06)
    }

    private var borderColor: Color {
        if let owner = card.owner {
            return owner.color.opacity(0.7)
        }
        if let keyOwner = card.keyOwner {
            return keyOwner.color.opacity(0.75)
        }
        if card.isNominated {
            return .accentColor
        }
        return Color.secondary.opacity(0.35)
    }
}

private struct OwnershipTexture: View {
    let ownership: Ownership

    var body: some View {
        Canvas { context, size in
            let textureColor = Color.primary.opacity(0.18)
            switch ownership {
            case .red:
                for x in stride(from: -size.height, through: size.width, by: 14) {
                    var path = Path()
                    path.move(to: CGPoint(x: x, y: size.height))
                    path.addLine(to: CGPoint(x: x + size.height, y: 0))
                    context.stroke(path, with: .color(textureColor), lineWidth: 2)
                }
            case .blue:
                for x in stride(from: 6, through: size.width, by: 12) {
                    for y in stride(from: 6, through: size.height, by: 12) {
                        context.fill(
                            Path(ellipseIn: CGRect(x: x - 1.5, y: y - 1.5, width: 3, height: 3)),
                            with: .color(textureColor)
                        )
                    }
                }
            case .neutral:
                for x in stride(from: 0, through: size.width, by: 14) {
                    var path = Path()
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    context.stroke(path, with: .color(textureColor), lineWidth: 1)
                }
                for y in stride(from: 0, through: size.height, by: 14) {
                    var path = Path()
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    context.stroke(path, with: .color(textureColor), lineWidth: 1)
                }
            case .hazard:
                for x in stride(from: -size.height, through: size.width, by: 16) {
                    var path = Path()
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x + size.height, y: size.height))
                    context.stroke(path, with: .color(textureColor), lineWidth: 3)
                }
            }
        }
    }
}

private extension Ownership {
    var glyph: String {
        switch self {
        case .red: return "♥"
        case .blue: return "✦"
        case .neutral: return "—"
        case .hazard: return "☠"
        }
    }

    var color: Color {
        switch self {
        case .red: return .red
        case .blue: return .blue
        case .neutral: return .gray
        case .hazard: return .purple
        }
    }

    var displayName: String {
        switch self {
        case .red: return "Ruby"
        case .blue: return "Cobalt"
        case .neutral: return "Neutral"
        case .hazard: return "Hazard"
        }
    }
}

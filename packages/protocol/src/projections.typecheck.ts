import type {
  ClueGiverProjection,
  OperativeProjection,
  ProjectionBase,
  PublicCard,
} from "./projections";

export function assertProjectionDiscriminants(base: ProjectionBase): void {
  const operative: OperativeProjection = {
    ...base,
    viewRole: "operative",
  };

  const operativeWithKey: OperativeProjection = {
    ...operative,
    // @ts-expect-error Operative projections cannot represent an ownership key.
    key: Object.create(null) as Record<string, "red">,
  };

  // @ts-expect-error Clue-giver projections require a complete ownership key.
  const clueGiverWithoutKey: ClueGiverProjection = {
    ...base,
    viewRole: "clue-giver",
  };

  void operativeWithKey;
  void clueGiverWithoutKey;
}

export function assertPublicCardDiscriminant(): void {
  const unrevealedWithOwner: PublicCard = {
    id: "hidden",
    label: "Hidden",
    revealed: false,
    // @ts-expect-error Unrevealed public cards cannot represent hidden ownership.
    owner: "hazard",
  };

  // @ts-expect-error Revealed public cards must include their public owner.
  const revealedWithoutOwner: PublicCard = {
    id: "revealed",
    label: "Revealed",
    revealed: true,
  };

  void unrevealedWithOwner;
  void revealedWithoutOwner;
}

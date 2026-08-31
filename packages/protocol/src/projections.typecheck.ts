import type {
  ClueGiverProjection,
  OperativeProjection,
  ProjectionBase,
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

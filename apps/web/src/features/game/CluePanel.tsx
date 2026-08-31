import {
  ClientCommandSchema,
  type ClientCommand,
  type ClientProjection,
} from "@cipher-party/protocol";
import { useState, type FormEvent } from "react";

const CLUE_TOKEN_PATTERN = /^[\p{L}\p{M}\p{N}'’-]+$/u;

function validClueToken(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ).length <= 40 &&
    CLUE_TOKEN_PATTERN.test(value)
  );
}

interface CluePanelProps {
  board: NonNullable<ClientProjection["board"]>;
  submitAllowed: boolean;
  challengeAllowed: boolean;
  disabled: boolean;
  maxCount?: number;
  ownTeam?: "red" | "blue";
  send(command: ClientCommand): void;
}

export function CluePanel({
  board,
  submitAllowed,
  challengeAllowed,
  disabled,
  maxCount,
  ownTeam,
  send,
}: CluePanelProps) {
  const [word, setWord] = useState("");
  const [count, setCount] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedWord = word.trim().normalize("NFC");
    const numericCount = Number(count);
    if (!validClueToken(normalizedWord)) {
      setError(
        "Enter one word using letters, numbers, apostrophes, or hyphens.",
      );
      return;
    }
    if (
      !Number.isInteger(numericCount) ||
      numericCount < 1 ||
      numericCount > 9
    ) {
      setError("Enter a whole clue count from 1 through 9.");
      return;
    }
    const parsed = ClientCommandSchema.safeParse({
      type: "submit_clue",
      word: normalizedWord,
      count: numericCount,
    });
    if (!parsed.success || parsed.data.type !== "submit_clue") {
      setError("Check the clue word and count, then try again.");
      return;
    }
    if (maxCount !== undefined && parsed.data.count > maxCount) {
      const teamLabel = ownTeam === "blue" ? "Blue" : "Red";
      setError(
        `Count cannot exceed your ${maxCount} unrevealed ${teamLabel} targets.`,
      );
      return;
    }
    setError("");
    send(parsed.data);
  };

  if (!submitAllowed && !challengeAllowed) {
    return null;
  }

  return (
    <section className="game-control-panel" aria-label="Clue controls">
      <p className="card-index">Clue desk</p>
      {submitAllowed ? (
        <form className="clue-form" noValidate onSubmit={submit}>
          <label htmlFor="clue-word">Clue word</label>
          <input
            id="clue-word"
            value={word}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setWord(event.currentTarget.value)}
          />
          <label htmlFor="clue-count">Clue count</label>
          <input
            id="clue-count"
            type="number"
            inputMode="numeric"
            min="1"
            max={maxCount ?? 9}
            step="1"
            value={count}
            disabled={disabled}
            onChange={(event) => setCount(event.currentTarget.value)}
          />
          {error === "" ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={disabled}>
            Submit clue
          </button>
        </form>
      ) : null}
      {challengeAllowed && board.clue !== null ? (
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={() => send({ type: "challenge_clue" })}
        >
          Challenge clue
        </button>
      ) : null}
    </section>
  );
}

import { useState, type FormEvent } from "react";
import type { PlayPhase, TeamId } from "@cipher-party/protocol";

export interface CluePanelProps {
  activeTeam: TeamId;
  phase: PlayPhase;
  canSubmitClue: boolean;
  canChallengeClue: boolean;
  currentClue: { word: string; count: number } | null;
  onSubmitClue: (word: string, count: number) => void;
  onChallengeClue: () => void;
  isCommandPending?: boolean;
}

const graphemeCount = (value: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)
  ).length;

const CLUE_WORD_REGEX = /^[\p{L}\p{M}\p{N}'’-]+$/u;

export function CluePanel({
  activeTeam,
  phase,
  canSubmitClue,
  canChallengeClue,
  currentClue,
  onSubmitClue,
  onChallengeClue,
  isCommandPending = false
}: CluePanelProps) {
  const [word, setWord] = useState("");
  const [count, setCount] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  if (!canSubmitClue && !canChallengeClue) {
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalizedWord = word.trim().normalize("NFC");

    if (!normalizedWord) {
      setError("Clue word cannot be empty");
      return;
    }

    if (graphemeCount(normalizedWord) > 40) {
      setError("Clue must be at most 40 graphemes");
      return;
    }

    if (!CLUE_WORD_REGEX.test(normalizedWord)) {
      setError(
        "Clue word can only contain letters, numbers, apostrophes, and hyphens (no spaces)"
      );
      return;
    }

    if (!Number.isInteger(count) || count < 1 || count > 9) {
      setError("Clue count must be an integer between 1 and 9");
      return;
    }

    setError(null);
    onSubmitClue(normalizedWord, count);
  }

  return (
    <div className="clue-panel">
      {canSubmitClue && phase === "clue" && (
        <form onSubmit={handleSubmit} className="clue-form" noValidate>
          <h3 className="clue-form-title">
            Give a Clue for{" "}
            {activeTeam === "red" ? "Ruby (Red)" : "Cobalt (Blue)"}
          </h3>

          {error && (
            <div role="alert" className="error-summary">
              {error}
            </div>
          )}

          <div className="clue-inputs-row">
            <div className="form-group form-group-word">
              <label htmlFor="clue-word">Clue Word</label>
              <input
                id="clue-word"
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="e.g. OCEAN"
                maxLength={40}
                disabled={isCommandPending}
                required
              />
            </div>

            <div className="form-group form-group-count">
              <label htmlFor="clue-count">Clue Count</label>
              <input
                id="clue-count"
                type="number"
                min={1}
                max={9}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
                disabled={isCommandPending}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-submit-clue"
              disabled={isCommandPending}
            >
              {isCommandPending ? "Submitting..." : "Give Clue"}
            </button>
          </div>
        </form>
      )}

      {canChallengeClue && currentClue && (
        <div className="clue-challenge-action">
          <button
            type="button"
            className="btn btn-warning"
            onClick={onChallengeClue}
            disabled={isCommandPending}
          >
            Challenge Clue
          </button>
        </div>
      )}
    </div>
  );
}

import React from "react";
import PredictionStatusPill from "./PredictionStatusPill";
import type { Fixture } from "../../api/football";
import { scorePrediction } from "../../utils/scoring";
import { timeUK } from "../../utils/dates";

export interface Prediction {
  predHome: number | null;
  predAway: number | null;
  locked?: boolean;
}

interface Props {
  fixture: Fixture;
  prediction: Prediction | null;
  onChangePrediction: (p: Prediction) => void;
  gameweekLocked: boolean;
  required?: boolean;
  cardRef?: (node: HTMLDivElement | null) => void;
}

const FixtureCard: React.FC<Props> = ({
  fixture,
  prediction,
  onChangePrediction,
  gameweekLocked,
  required = false,
  cardRef,
}) => {
  const ko = timeUK(fixture.kickoff);
  const [editing, setEditing] = React.useState(false);

  const locked   = prediction?.locked ?? false;
  const predHome = prediction?.predHome ?? null;
  const predAway = prediction?.predAway ?? null;

  const hasActual = fixture.homeGoals != null && fixture.awayGoals != null;
  const isLive    = fixture.statusShort !== "NS" && fixture.statusShort !== "FT" && hasActual;
  const isFT      = fixture.statusShort === "FT";
  const preKO     = fixture.statusShort === "NS";
  const canEdit   = preKO && !gameweekLocked;

  const hasPrediction = predHome != null && predAway != null;

  // Local editing values
  const [editHome, setEditHome] = React.useState<string>(predHome?.toString() ?? "");
  const [editAway, setEditAway] = React.useState<string>(predAway?.toString() ?? "");

  // Keep inputs synced when Firestore updates
  React.useEffect(() => {
    if (!editing) {
      setEditHome(predHome?.toString() ?? "");
      setEditAway(predAway?.toString() ?? "");
    }
  }, [predHome, predAway, editing]);

  const parseEdit = () => {
    const h = editHome === "" ? null : Math.max(0, parseInt(editHome, 10) || 0);
    const a = editAway === "" ? null : Math.max(0, parseInt(editAway, 10) || 0);
    return { h, a };
  };
  const hasEditPrediction = (() => {
    const { h, a } = parseEdit();
    return h !== null && a !== null;
  })();

  const saveEdits = () => {
    const { h, a } = parseEdit();
    // Automatically lock on save
    onChangePrediction({
      predHome: h,
      predAway: a,
      locked: true,
    });
    setEditing(false);
  };

  // Single-click edit: unlock if needed and open editing
  const startEditing = () => {
    if (!canEdit) return;
    setEditing(true);
    if (locked) {
      onChangePrediction({ predHome, predAway, locked: false });
    }
  };

  // Close any open editor if the fixture or gameweek locks while editing
  React.useEffect(() => {
    if (editing && !canEdit) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  const { status } = scorePrediction(
    predHome, predAway, fixture.homeGoals, fixture.awayGoals
  );

  const borderColor =
    hasActual && status === "exact"
      ? "var(--green)"
      : hasActual && status === "result"
      ? "var(--blue)"
      : hasActual && status === "wrong"
      ? "var(--red)"
      : required && !hasPrediction
      ? "rgba(239, 68, 68, 0.6)"
      : "var(--card-border)";

  const badge = isLive ? "LIVE" : isFT ? "Full time" : `KO ${ko}`;

  return (
    <div
      ref={cardRef}
      className={`fx-card card ${required && !hasPrediction ? "fx-card--required" : ""}`}
      style={{ borderColor }}
    >
      {/* Header */}
      <div className="fx-header">
        <div className="fx-team fx-team--home">
          <img className="fx-logo" src={fixture.homeLogo} alt={fixture.homeTeam} />
          <span className="fx-tla">{fixture.homeShort}</span>
        </div>

        <div className={`fx-badge ${isLive ? "fx-badge--live" : isFT ? "fx-badge--ft" : "fx-badge--ko"}`}>
          {badge}
        </div>

        <div className="fx-team fx-team--away">
          <span className="fx-tla">{fixture.awayShort}</span>
          <img className="fx-logo" src={fixture.awayLogo} alt={fixture.awayTeam} />
        </div>
      </div>

      {/* Actual score */}
      <div className="fx-scoreline">
        <span className="fx-score">{hasActual ? fixture.homeGoals : "–"}</span>
        <span className="fx-colon">:</span>
        <span className="fx-score">{hasActual ? fixture.awayGoals : "–"}</span>
      </div>

      {/* Prediction section */}
      <div className="fx-prediction" style={{ gridTemplateColumns: editing ? "1fr auto" : "1fr auto" }}>
        {editing ? (
          <>
            <div className="fx-inputs">
              <input
                className="input-score fx-input"
                type="number"
                inputMode="numeric"
                min={0}
                value={editHome}
                onChange={(e) => setEditHome(e.target.value)}
                aria-label="Home prediction"
              />
              <span className="fx-sep">–</span>
              <input
                className="input-score fx-input"
                type="number"
                inputMode="numeric"
                min={0}
                value={editAway}
                onChange={(e) => setEditAway(e.target.value)}
                aria-label="Away prediction"
              />
            </div>
            <button
              className="fx-btn"
              onClick={saveEdits}
              title="Save prediction"
              disabled={!canEdit || !hasEditPrediction}
            >
              Save ✓
            </button>
          </>
        ) : (
          <>
            <div className="fx-pred-summary" title={locked ? "Prediction locked" : "Prediction"}>
              <span className="fx-label">Prediction</span>
              <span className="fx-pred">{hasPrediction ? predHome : "—"}</span>
              <span className="fx-sep">–</span>
              <span className="fx-pred">{hasPrediction ? predAway : "—"}</span>
            </div>

            {canEdit && (
              <button className="fx-btn" onClick={startEditing} title="Edit prediction">
                Edit ✎
              </button>
            )}
          </>
        )}
      </div>

      {/* Live/FT status */}
      {(isLive || isFT) && (
        <div className="fx-meta" style={{ marginTop: 6, justifyContent: "center" }}>
          {hasPrediction && <PredictionStatusPill status={status} />}
        </div>
      )}

      {!hasPrediction && (
        <div className="fx-meta fx-meta--required" style={{ marginTop: 10 }}>
          <span className="fx-required-pill">Required</span>
          {canEdit ? (
            <span className="fx-required-note">Add a score to save and clear this card.</span>
          ) : (
            <span className="fx-required-note">Predictions are locked for this fixture.</span>
          )}
        </div>
      )}
    </div>
  );
};

export default FixtureCard;

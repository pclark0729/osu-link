type BattleScoreModalProps = {
  relativePp: boolean;
  scoreDraft: string;
  uiLocked: boolean;
  onScoreDraftChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BattleScoreModal({
  relativePp,
  scoreDraft,
  uiLocked,
  onScoreDraftChange,
  onCancel,
  onConfirm,
}: BattleScoreModalProps) {
  return (
    <div
      className="battles-panel__modal-backdrop battles-panel__modal-backdrop--animate"
      role="presentation"
      onClick={() => !uiLocked && onCancel()}
    >
      <div
        className="battles-panel__modal battles-panel__modal--animate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="battles-score-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="battles-score-modal-title" className="battles-panel__modal-title">
          Enter score
        </h4>
        <p className="hint battles-panel__modal-hint">
          {relativePp
            ? "Honor system — manual entries are raw and rank below osu! submits in relative battles."
            : "Honor system — use your best score on this map."}
        </p>
        <label className="field">
          <span>Score</span>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={scoreDraft}
            onChange={(e) => onScoreDraftChange(e.target.value)}
            placeholder="e.g. 1234567"
            onKeyDown={(e) => {
              if (e.key === "Enter") void onConfirm();
            }}
          />
        </label>
        <div className="battles-panel__modal-actions">
          <button type="button" className="secondary" disabled={uiLocked} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={uiLocked} onClick={() => void onConfirm()}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

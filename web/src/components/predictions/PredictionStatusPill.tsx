import React from "react";
import type { PredictionStatus } from "../../utils/scoring";

interface Props {
  status: PredictionStatus;
}

const PredictionStatusPill: React.FC<Props> = ({ status }) => {
  let label = "No prediction";
  let cls = "status-pill status-pill--pending";

  if (status === "exact") {
    label = "20 pts";
    cls = "status-pill status-pill--exact";
  } else if (status === "result") {
    label = "6 pts";
    cls = "status-pill status-pill--result";
  } else if (status === "wrong") {
    label = "0 pts";
    cls = "status-pill status-pill--wrong";
  }

  return <span className={cls}>{label}</span>;
};

export default PredictionStatusPill;

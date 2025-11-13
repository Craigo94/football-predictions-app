import React from "react";
import type { PredictionStatus } from "../../utils/scoring";

interface Props {
  status: PredictionStatus;
  isLive: boolean;
}

const PredictionStatusPill: React.FC<Props> = ({ status, isLive }) => {
  let label = "No prediction";
  let cls = "status-pill status-pill--pending";

  if (status === "exact") {
    label = isLive ? "On for 20 pts" : "20 pts exact";
    cls = "status-pill status-pill--exact";
  } else if (status === "result") {
    label = isLive ? "On for 6 pts" : "6 pts correct result";
    cls = "status-pill status-pill--result";
  } else if (status === "wrong") {
    label = isLive ? "Off target" : "0 pts";
    cls = "status-pill status-pill--wrong";
  }

  return <span className={cls}>{label}</span>;
};

export default PredictionStatusPill;

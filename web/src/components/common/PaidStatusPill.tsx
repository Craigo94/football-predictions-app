import React from "react";
import { ENTRY_FEE_GBP } from "../../config/football";
import { formatCurrencyGBP } from "../../utils/currency";

interface Props {
  hasPaid: boolean;
  /** Compact variant for tight rows (navbar, tables). */
  small?: boolean;
  /** Append the entry fee, e.g. "Not paid · £5.00". */
  showFee?: boolean;
  /** Overrides the default "Paid"/"Not paid" wording. */
  label?: string;
  className?: string;
}

/**
 * The single source of truth for how a player's entry-fee status looks. The
 * admin toggles `hasPaid` on the user document; every screen renders it through
 * this pill so paid and unpaid always read the same way.
 */
const PaidStatusPill: React.FC<Props> = ({
  hasPaid,
  small = false,
  showFee = false,
  label,
  className,
}) => {
  const text = label ?? (hasPaid ? "Paid" : "Not paid");
  const fee = showFee ? ` · ${formatCurrencyGBP(ENTRY_FEE_GBP)}` : "";

  const classes = [
    "paid-pill",
    hasPaid ? "paid-pill--paid" : "paid-pill--unpaid",
    small ? "paid-pill--sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      title={
        hasPaid
          ? "Entry fee received"
          : `Entry fee of ${formatCurrencyGBP(ENTRY_FEE_GBP)} still to pay`
      }
    >
      <span className="paid-pill__icon" aria-hidden="true">
        {hasPaid ? "✓" : "✗"}
      </span>
      {text}
      {fee}
    </span>
  );
};

export default PaidStatusPill;

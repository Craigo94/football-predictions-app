import React from "react";
import { ENTRY_FEE_GBP } from "../../config/football";
import { formatCurrencyGBP } from "../../utils/currency";
import { formatDayMonthYear } from "../../utils/timestamps";
import PaidStatusPill from "./PaidStatusPill";

interface Props {
  hasPaid: boolean;
  /** When the admin marked the player as paid, if it was recorded. */
  paidAt?: string | null;
  className?: string;
}

/**
 * Tells the signed-in player whether their entry fee is settled. Only the admin
 * can change it, so the copy points at them rather than offering an action.
 */
const PaymentStatusBanner: React.FC<Props> = ({ hasPaid, paidAt, className }) => {
  const fee = formatCurrencyGBP(ENTRY_FEE_GBP);
  const paidOn = hasPaid ? formatDayMonthYear(paidAt) : null;

  return (
    <section
      className={`card payment-banner payment-banner--${
        hasPaid ? "paid" : "unpaid"
      }${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="payment-banner__text">
        <p className="eyebrow">Your entry fee</p>
        <strong>{hasPaid ? "You're paid up" : `${fee} still to pay`}</strong>
        <p className="payment-banner__detail">
          {hasPaid
            ? `${fee} received${paidOn ? ` · marked paid on ${paidOn}` : ""}. You're in the prize pot for the season.`
            : `Pay the admin your ${fee} entry fee and they'll mark you as paid — this updates here as soon as they do.`}
        </p>
      </div>
      <PaidStatusPill hasPaid={hasPaid} />
    </section>
  );
};

export default PaymentStatusBanner;

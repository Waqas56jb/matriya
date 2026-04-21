import React from 'react';
import { labelDecisionStatus } from '../../utils/decisionLabels';

export default function DecisionHeader({ decisionStatus, answer }) {
  const status = decisionStatus ?? '';
  const text = answer ?? '';
  const label = labelDecisionStatus(status);
  return (
    <header className="ac-decision-header" data-decision-status={status}>
      <div className="ac-decision-header__bar" aria-hidden="true" />
      <div className="ac-decision-header__body">
        <div className="ac-decision-header__status-row">
          <span className="ac-decision-header__label">Decision Status</span>
          <span className="ac-decision-header__status" title={status || undefined}>
            {label}
          </span>
        </div>
        <div className="ac-decision-header__answer">{text}</div>
      </div>
    </header>
  );
}

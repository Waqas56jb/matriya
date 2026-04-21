import React from 'react';

export default function ConstraintRulesBlock({ items }) {
  const list = Array.isArray(items) ? items.filter((x) => x && x.matched) : [];
  if (!list.length) return null;

  return (
    <section className="ac-constraint-block" aria-labelledby="ac-constraint-heading">
      <h3 id="ac-constraint-heading" className="ac-block-title">
        Suggested Experiments (Constraint Engine)
      </h3>
      <p className="ac-constraint-disclaimer">
        Analytical recommendations only — these do not change the decision status and are not part of the verified evidence package.
      </p>
      <ul className="ac-constraint-list">
        {list.map((rule) => (
          <li key={rule.rule_id} className="ac-constraint-item">
            <div className="ac-constraint-ruleid">
              <span className="ac-constraint-label">Rule</span>{' '}
              <strong className="ac-rule-name">{String(rule.rule_id)}</strong>
              {typeof rule.confidence === 'number' && (
                <span className="ac-constraint-confidence"> · match score {rule.confidence}</span>
              )}
            </div>
            {rule.hypothesis && (
              <p className="ac-constraint-hypothesis">Hypothesis: {String(rule.hypothesis)}</p>
            )}
            {Array.isArray(rule.recommended_experiments) && rule.recommended_experiments.length > 0 && (
              <div className="ac-constraint-experiments">
                <div className="ac-constraint-subtitle">Recommended Experiments</div>
                <ul>
                  {rule.recommended_experiments.map((ex) => (
                    <li key={ex.id != null ? ex.id : ex.line}>
                      {typeof ex.line === 'string' ? ex.line : JSON.stringify(ex)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rule.expected_failure_pattern && (
              <div className="ac-constraint-pattern">
                <div className="ac-constraint-subtitle">Expected Failure Pattern</div>
                <p className="ac-constraint-pattern-text">{String(rule.expected_failure_pattern)}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

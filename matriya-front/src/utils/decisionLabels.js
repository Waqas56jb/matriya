/** English display labels for composeAnswer decision_status (UI only). */
export function labelDecisionStatus(status) {
  const s = String(status || '');
  const map = {
    VALID_CONCLUSION:       'Valid Conclusion',
    INCONCLUSIVE:           'Inconclusive',
    INSUFFICIENT_DATA:      'Insufficient Data',
    NO_CHANGE:              'No Change',
    REFERENCE_ONLY:         'Reference Only',
    INVALID_EXPERIMENT:     'Invalid Experiment',
    STRUCTURAL_INCOMPLETE:  'Structurally Incomplete',
  };
  return map[s] || s || '—';
}

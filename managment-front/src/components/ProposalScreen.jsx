import React from 'react';
import { proposals as proposalsApi, projectFiles as projectFilesApi } from '../api';
import './ProposalScreen.css';

// ── HELPERS ───────────────────────────────────────────────────────────────────

const STATE_CONFIG = {
  READY:        { cls: 'state-ready',        label: 'READY',         approveLabel: 'Approve Structure',    approveDisabled: false },
  NEEDS_REVIEW: { cls: 'state-needs-review', label: 'NEEDS REVIEW',  approveLabel: 'Review Before Approve', approveDisabled: false },
  INSUFFICIENT: { cls: 'state-insufficient', label: 'INSUFFICIENT',  approveLabel: 'Add More Documents',   approveDisabled: true  },
  APPROVED:     { cls: 'state-approved',     label: 'APPROVED',      approveLabel: 'Approved ✓',           approveDisabled: true  },
};

function confidence(level) {
  if (level === 'HIGH' || level === 'USER_VERIFIED') return { cls: 'conf-high',   icon: '●' };
  if (level === 'MEDIUM') return { cls: 'conf-medium', icon: '◐' };
  return                         { cls: 'conf-low',    icon: '○' };
}

// ── CONFLICT MODAL ─────────────────────────────────────────────────────────────

function ConflictModal({ conflict, onResolve, onClose }) {
  const [customValue, setCustomValue] = React.useState('');

  if (!conflict) return null;

  return (
    <div className="prop-modal-overlay" onClick={onClose}>
      <div className="prop-modal" onClick={e => e.stopPropagation()}>
        <h3 className="prop-modal-title">
          Conflict: <span className="prop-modal-field">{conflict.field}</span>
          {conflict.experiment_id && <span className="prop-modal-exp"> — {conflict.experiment_id}</span>}
        </h3>
        <div className="prop-modal-divider" />
        {(conflict.values_found || []).map((v, i) => (
          <button
            key={i}
            className="prop-modal-option"
            onClick={() => onResolve({ field: conflict.field, experiment_id: conflict.experiment_id, chosen_value: v.value, source_or_custom: v.source })}
          >
            <span className="prop-modal-option-value">{v.value}</span>
            <span className="prop-modal-option-source">(from {v.source})</span>
            <span className="prop-modal-select-btn">Select</span>
          </button>
        ))}
        <div className="prop-modal-custom">
          <span>Enter custom value:</span>
          <input
            type="number"
            className="prop-modal-custom-input"
            value={customValue}
            onChange={e => setCustomValue(e.target.value)}
            placeholder="0"
          />
          <button
            className="prop-modal-save-btn"
            disabled={customValue === ''}
            onClick={() => onResolve({ field: conflict.field, experiment_id: conflict.experiment_id, chosen_value: parseFloat(customValue), source_or_custom: 'custom' })}
          >
            Save
          </button>
        </div>
        <div className="prop-modal-divider" />
        <button className="prop-modal-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── BLOCK COMPONENTS ──────────────────────────────────────────────────────────

function ProjectTypeBlock({ projectType, onEdit, disabled }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const conf = confidence(projectType?.confidence);

  function startEdit() {
    setDraft(projectType?.value || '');
    setEditing(true);
  }

  function saveEdit() {
    onEdit({ value: draft.trim(), confidence: 'USER_VERIFIED' });
    setEditing(false);
  }

  return (
    <div className="prop-block">
      <div className="prop-block-header">
        <span className="prop-block-title">Project Type</span>
        <span className={`prop-conf-badge ${conf.cls}`} title={`Confidence: ${projectType?.confidence}`}>{conf.icon} {projectType?.confidence}</span>
      </div>
      {editing ? (
        <div className="prop-edit-row">
          <input className="prop-edit-input" value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <button className="prop-btn-save" onClick={saveEdit}>Save</button>
          <button className="prop-btn-cancel" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="prop-block-value-row">
          <span className="prop-project-type-value">{projectType?.value || <em className="prop-empty">Not detected</em>}</span>
          {!disabled && <button className="prop-btn-edit" onClick={startEdit}>Edit</button>}
        </div>
      )}
      {projectType?.sources?.length > 0 && (
        <div className="prop-sources">Sources: {projectType.sources.join(', ')}</div>
      )}
    </div>
  );
}

function MaterialsBlock({ materials, onAdd, onRemove, disabled }) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  function saveAdd() {
    if (!draft.trim()) return;
    onAdd({ name: draft.trim(), confidence: 'USER_VERIFIED', sources: [] });
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="prop-block">
      <div className="prop-block-header">
        <span className="prop-block-title">Materials</span>
        <span className="prop-block-count">{materials?.length || 0}</span>
      </div>
      <div className="prop-tags-row">
        {(materials || []).map((m, i) => {
          const conf = confidence(m.confidence);
          return (
            <span key={i} className={`prop-tag ${conf.cls}`} title={`Confidence: ${m.confidence}\nSources: ${(m.sources||[]).join(', ')}`}>
              {m.name}
              {m.confidence !== 'HIGH' && m.confidence !== 'USER_VERIFIED' && (
                <span className="prop-tag-warn" title="Low/Medium confidence">⚠</span>
              )}
              {!disabled && (
                <button className="prop-tag-remove" onClick={() => onRemove(m.name)} title="Remove">×</button>
              )}
            </span>
          );
        })}
        {!disabled && !adding && (
          <button className="prop-add-btn" onClick={() => setAdding(true)}>+ Add</button>
        )}
      </div>
      {adding && (
        <div className="prop-edit-row">
          <input className="prop-edit-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Material name" autoFocus />
          <button className="prop-btn-save" onClick={saveAdd}>Add</button>
          <button className="prop-btn-cancel" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function MetricsBlock({ metrics, onAdd, onRemove, disabled }) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  function saveAdd() {
    if (!draft.trim()) return;
    onAdd({ name: draft.trim(), confidence: 'USER_VERIFIED', sources: [] });
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="prop-block">
      <div className="prop-block-header">
        <span className="prop-block-title">Metrics</span>
        <span className="prop-block-count">{metrics?.length || 0}</span>
      </div>
      <div className="prop-tags-row">
        {(metrics || []).map((m, i) => {
          const conf = confidence(m.confidence);
          return (
            <span key={i} className={`prop-tag ${conf.cls}`} title={`Confidence: ${m.confidence}`}>
              {m.name}
              {m.confidence !== 'HIGH' && m.confidence !== 'USER_VERIFIED' && (
                <span className="prop-tag-warn">⚠</span>
              )}
              {!disabled && (
                <button className="prop-tag-remove" onClick={() => onRemove(m.name)}>×</button>
              )}
            </span>
          );
        })}
        {!disabled && !adding && (
          <button className="prop-add-btn" onClick={() => setAdding(true)}>+ Add</button>
        )}
      </div>
      {adding && (
        <div className="prop-edit-row">
          <input className="prop-edit-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Metric name" autoFocus />
          <button className="prop-btn-save" onClick={saveAdd}>Add</button>
          <button className="prop-btn-cancel" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function ExperimentsBlock({ experiments, onRemove, disabled }) {
  const [expanded, setExpanded] = React.useState(null);

  return (
    <div className="prop-block">
      <div className="prop-block-header">
        <span className="prop-block-title">Detected Experiments</span>
        <span className="prop-block-count">{experiments?.length || 0}</span>
      </div>
      {(experiments || []).length === 0 && <p className="prop-empty">No experiments detected</p>}
      {(experiments || []).map((exp, i) => {
        const conf = confidence(exp.confidence);
        const isOpen = expanded === i;
        return (
          <div key={i} className={`prop-exp-row ${conf.cls}`}>
            <div className="prop-exp-header">
              <span className="prop-exp-id">{exp.experiment_id}</span>
              <span className={`prop-conf-badge ${conf.cls}`}>{exp.confidence}</span>
              <span className="prop-exp-source">{(exp.sources || []).map(s => s.split(':')[0]).join(', ')}</span>
              <div className="prop-exp-actions">
                <button className="prop-btn-view" onClick={() => setExpanded(isOpen ? null : i)}>
                  {isOpen ? 'Hide' : 'View'}
                </button>
                {!disabled && (
                  <button className="prop-btn-remove-sm" onClick={() => onRemove(exp.experiment_id)}>Remove</button>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="prop-exp-fields">
                {Object.entries(exp.fields || {}).map(([k, v]) => (
                  <span key={k} className="prop-exp-field-chip">{k}: <strong>{v}</strong></span>
                ))}
                <div className="prop-sources" style={{ marginTop: 4 }}>Sources: {(exp.sources || []).join(', ')}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MilestonesBlock({ milestones, onRemove, disabled }) {
  return (
    <div className="prop-block">
      <div className="prop-block-header">
        <span className="prop-block-title">Milestones</span>
        <span className="prop-block-count">{milestones?.length || 0}</span>
      </div>
      {(milestones || []).map((ms, i) => {
        const conf = confidence(ms.confidence);
        return (
          <div key={i} className="prop-milestone-row">
            <span className="prop-milestone-num">{i + 1}</span>
            <div className="prop-milestone-info">
              <span className="prop-milestone-name">{ms.name}</span>
              {ms.description && <span className="prop-milestone-desc">{ms.description}</span>}
            </div>
            <span className={`prop-conf-badge ${conf.cls}`}>{ms.confidence}</span>
            {!disabled && (
              <button className="prop-btn-remove-sm" onClick={() => onRemove(ms.name)}>Remove</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── CONFLICTS PANEL ───────────────────────────────────────────────────────────

function ConflictsPanel({ conflicts, onClickConflict }) {
  const unresolved = (conflicts || []).filter(c => c.resolution === 'USER_REQUIRED');
  const resolved   = (conflicts || []).filter(c => c.resolution === 'RESOLVED');

  if (!conflicts?.length) return null;

  return (
    <div className="prop-conflicts-panel">
      <div className="prop-conflicts-header">
        <span className="prop-conflicts-icon">⚠</span>
        <strong>Conflicts Detected ({unresolved.length} require resolution)</strong>
      </div>
      {unresolved.map((c, i) => (
        <div key={i} className="prop-conflict-row prop-conflict-unresolved" onClick={() => onClickConflict(c)}>
          <span className="prop-conflict-field">{c.field}</span>
          {c.experiment_id && <span className="prop-conflict-exp">{c.experiment_id}</span>}
          <span className="prop-conflict-values">
            {(c.values_found || []).map(v => v.value).join(' vs ')}
          </span>
          <span className="prop-conflict-action">Resolve →</span>
        </div>
      ))}
      {resolved.map((c, i) => (
        <div key={i} className="prop-conflict-row prop-conflict-resolved">
          <span className="prop-conflict-field">{c.field}</span>
          {c.experiment_id && <span className="prop-conflict-exp">{c.experiment_id}</span>}
          <span className="prop-conflict-chosen">Chosen: {c.chosen_value}</span>
          <span className="prop-conflict-resolved-badge">✓ Resolved</span>
        </div>
      ))}
    </div>
  );
}

// ── FAILED FILES BANNER ───────────────────────────────────────────────────────

function FailedFilesBanner({ scanStatus, onSkip }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!scanStatus?.documents_failed) return null;

  return (
    <div className="prop-failed-banner">
      <div className="prop-failed-banner-header" onClick={() => setExpanded(x => !x)}>
        <span>
          {scanStatus.documents_processed} documents processed,{' '}
          <strong>{scanStatus.documents_failed} failed</strong>. {expanded ? '▲' : '▼'} See details.
        </span>
      </div>
      {expanded && (
        <div className="prop-failed-list">
          {(scanStatus.failed_files || []).map((f, i) => (
            <div key={i} className="prop-failed-file-row">
              <span className="prop-failed-filename">{f.name}</span>
              <span className={`prop-failed-reason reason-${f.reason}`}>{f.reason}</span>
              <div className="prop-failed-actions">
                {f.reason === 'OCR_REQUIRED' && (
                  <button className="prop-btn-ocr" disabled title="OCR pipeline not yet implemented — detection complete">Run OCR</button>
                )}
                <button className="prop-btn-skip" onClick={() => onSkip(f.name)}>Skip</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MAIN ProposalScreen ───────────────────────────────────────────────────────

export default function ProposalScreen({ project }) {
  const projectId = project?.id;

  const [proposal, setProposal]       = React.useState(null);
  const [loading, setLoading]         = React.useState(false);
  const [generating, setGenerating]   = React.useState(false);
  const [approving, setApproving]     = React.useState(false);
  const [error, setError]             = React.useState(null);
  const [activeConflict, setActiveConflict] = React.useState(null);
  const [approveResult, setApproveResult]   = React.useState(null);
  const [projectFiles, setProjectFiles]     = React.useState([]);
  const [selectedDocs, setSelectedDocs]     = React.useState([]);

  // Load latest proposal + project files on mount
  React.useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      proposalsApi.latest(projectId).catch(() => null),
      projectFilesApi.list(projectId).then(r => r.files || []).catch(() => []),
    ]).then(([prop, files]) => {
      if (prop) setProposal(prop);
      setProjectFiles(files);
      setSelectedDocs([]);
    }).finally(() => setLoading(false));
  }, [projectId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const prop = await proposalsApi.generate(projectId, selectedDocs.length ? selectedDocs : []);
      setProposal(prop);
      setApproveResult(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePatch(block, action, payload) {
    if (!proposal) return;
    setError(null);
    try {
      const updated = await proposalsApi.patch(proposal.proposal_id, { block, action, payload });
      setProposal(updated);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleResolveConflict(resolution) {
    if (!proposal || !activeConflict) return;
    setActiveConflict(null);
    setError(null);
    try {
      const updated = await proposalsApi.resolveConflict(proposal.proposal_id, resolution);
      setProposal(updated);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleApprove() {
    if (!proposal) return;
    setApproving(true);
    setError(null);
    try {
      const result = await proposalsApi.approve(proposal.proposal_id);
      setApproveResult(result);
      setProposal(prev => ({ ...prev, proposal_state: 'APPROVED' }));
    } catch (e) {
      const msg = e.response?.data?.reason || e.response?.data?.error || e.message;
      setError(`Approve failed: ${msg}`);
    } finally {
      setApproving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="prop-loading">Loading proposal...</div>;

  const stateConf = proposal ? (STATE_CONFIG[proposal.proposal_state] || STATE_CONFIG.INSUFFICIENT) : null;
  const conflicts = proposal?.scan_status?.conflicts_detected || [];
  const unresolvedCount = conflicts.filter(c => c.resolution === 'USER_REQUIRED').length;
  const isApproved = proposal?.proposal_state === 'APPROVED';
  const approveDisabled =
    approving ||
    isApproved ||
    !proposal ||
    stateConf?.approveDisabled ||
    (proposal?.proposal_state === 'NEEDS_REVIEW' && unresolvedCount > 0);

  return (
    <div className="prop-screen" dir="ltr">
      {/* Header */}
      <div className="prop-header">
        <div className="prop-header-left">
          <h2 className="prop-title">Project Initialization Proposal</h2>
          {proposal && (
            <span className="prop-id-badge">{proposal.proposal_id}</span>
          )}
        </div>
        <div className="prop-header-right">
          {proposal && stateConf && (
            <span className={`prop-state-badge ${stateConf.cls}`}>{stateConf.label}</span>
          )}
          <button
            className="prop-btn-generate"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating...' : proposal ? '↺ Regenerate' : 'Generate Proposal'}
          </button>
        </div>
      </div>

      {/* Document selector */}
      {!proposal && projectFiles.length > 0 && (
        <div className="prop-doc-selector">
          <p className="prop-doc-selector-label">
            Select documents to include (leave blank for all {projectFiles.length} files):
          </p>
          <div className="prop-doc-checkboxes">
            {projectFiles.map(f => (
              <label key={f.id} className="prop-doc-checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedDocs.includes(f.id)}
                  onChange={e => {
                    setSelectedDocs(prev =>
                      e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id)
                    );
                  }}
                />
                {f.display_name || f.storage_path?.split('/').pop() || f.id}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Approve result banner */}
      {approveResult && (
        <div className="prop-approve-success">
          ✓ Project initialized successfully! All blocks written to database.
          <a className="prop-approve-link" href={approveResult.redirect_to}>Go to Lab →</a>
        </div>
      )}

      {/* Error */}
      {error && <div className="prop-error">{error}</div>}

      {!proposal && !generating && (
        <div className="prop-empty-state">
          <p>No proposal generated yet.</p>
          <p>Upload documents in the Documents section, then click <strong>Generate Proposal</strong>.</p>
        </div>
      )}

      {proposal && (
        <>
          {/* Failed files banner */}
          <FailedFilesBanner
            scanStatus={proposal.scan_status}
            onSkip={(name) => {
              setProposal(prev => ({
                ...prev,
                scan_status: {
                  ...prev.scan_status,
                  failed_files: (prev.scan_status?.failed_files || []).filter(f => f.name !== name),
                  documents_failed: Math.max(0, (prev.scan_status?.documents_failed || 1) - 1),
                },
              }));
            }}
          />

          {/* Conflicts panel (shown at top for NEEDS_REVIEW) */}
          {proposal.proposal_state === 'NEEDS_REVIEW' && (
            <ConflictsPanel
              conflicts={conflicts}
              onClickConflict={setActiveConflict}
            />
          )}

          {/* INSUFFICIENT banner */}
          {proposal.proposal_state === 'INSUFFICIENT' && (
            <div className="prop-insufficient-banner">
              Insufficient data to initialize project. Add at least one missing block or edit manually.
            </div>
          )}

          {/* 5 Blocks */}
          <ProjectTypeBlock
            projectType={proposal.project_type}
            disabled={isApproved}
            onEdit={(payload) => handlePatch('project_type', 'edit', payload)}
          />

          <MaterialsBlock
            materials={proposal.materials}
            disabled={isApproved}
            onAdd={(payload) => handlePatch('materials', 'add', payload)}
            onRemove={(name) => handlePatch('materials', 'remove', { name })}
          />

          <MetricsBlock
            metrics={proposal.metrics}
            disabled={isApproved}
            onAdd={(payload) => handlePatch('metrics', 'add', payload)}
            onRemove={(name) => handlePatch('metrics', 'remove', { name })}
          />

          <ExperimentsBlock
            experiments={proposal.experiments}
            disabled={isApproved}
            onRemove={(id) => handlePatch('experiments', 'remove', { experiment_id: id })}
          />

          <MilestonesBlock
            milestones={proposal.milestones}
            disabled={isApproved}
            onRemove={(name) => handlePatch('milestones', 'remove', { name })}
          />

          {/* Approve bar */}
          <div className="prop-approve-bar">
            <div className="prop-approve-info">
              {approveDisabled && !isApproved && proposal?.proposal_state === 'NEEDS_REVIEW' && unresolvedCount > 0 && (
                <span className="prop-approve-hint">
                  {unresolvedCount} conflict{unresolvedCount > 1 ? 's' : ''} must be resolved before approve
                </span>
              )}
              {approveDisabled && !isApproved && proposal?.proposal_state === 'INSUFFICIENT' && (
                <span className="prop-approve-hint">Add missing blocks to enable approve</span>
              )}
            </div>
            <button
              className={`prop-approve-btn ${stateConf?.cls || ''}`}
              disabled={approveDisabled}
              onClick={handleApprove}
              title={approveDisabled && !isApproved ? 'Resolve all issues before approving' : ''}
            >
              {approving ? 'Approving...' : (stateConf?.approveLabel || 'Approve')}
            </button>
          </div>
        </>
      )}

      {/* Conflict resolution modal */}
      <ConflictModal
        conflict={activeConflict}
        onResolve={handleResolveConflict}
        onClose={() => setActiveConflict(null)}
      />
    </div>
  );
}

import React from 'react';
import './AnswerEvidenceSection.css';

/**
 * Shows file_search / RAG excerpts, or science-query row evidence (content + lab metadata).
 * RAG: document_name, filename, preview | excerpt | text
 * Science (lab engine): content + metadata.experiment_id / source
 */
function AnswerEvidenceSection({ sources, title, hint }) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    return (
        <section className="matriya-evidence" aria-label={title}>
            <h4 className="matriya-evidence__title">{title}</h4>
            {hint ? <p className="matriya-evidence__hint">{hint}</p> : null}
            <ul className="matriya-evidence__list">
                {sources.map((s, i) => {
                    const isLab = s?.metadata?.source === 'lab_data' || s?.metadata?.routing === 'science_query_engine';
                    const expId = s?.metadata?.experiment_id;
                    const label = s.document_name || s.filename
                        || (isLab && expId ? `Lab · ${expId}` : null)
                        || (isLab ? 'Lab data' : null)
                        || '—';
                    const body = s.preview || s.excerpt || s.text || s.content || '';
                    const key = s.source_id != null ? String(s.source_id) : `${label}-${i}`;
                    return (
                        <li key={key} className="matriya-evidence__card">
                            <div className="matriya-evidence__file">
                                <span key={`file-${key}`}>{label}</span>
                            </div>
                            <blockquote className="matriya-evidence__quote">
                                <span key={`quote-${key}`}>{body}</span>
                            </blockquote>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default AnswerEvidenceSection;

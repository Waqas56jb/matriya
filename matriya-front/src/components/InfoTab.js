import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './InfoTab.css';

function InfoTab() {
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadCollectionInfo();
    }, []);

    const loadCollectionInfo = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await api.get('/collection/info', {
                timeout: 15000
            });
            setInfo(response.data);
        } catch (err) {
            setError(err.response?.data?.detail || err.message || 'Error loading collection info');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="info-tab">
            <div className="card">
                <h2>Collection Info</h2>
                {loading && <div className="loading">Loading info…</div>}
                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}
                {info && (
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Collection name:</span>
                            <span className="info-value">
                                <span key={info.collection_name || 'na'}>{info.collection_name || 'N/A'}</span>
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Document count:</span>
                            <span className="info-value">
                                <span key={info.document_count ?? '0'}>{info.document_count || 0}</span>
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Database path:</span>
                            <span className="info-value">
                                <span key={info.db_path || 'na'}>{info.db_path || 'N/A'}</span>
                            </span>
                        </div>
                    </div>
                )}
                <button
                    onClick={loadCollectionInfo}
                    disabled={loading}
                    className={`refresh-button ${loading ? 'loading' : ''}`}
                >
                    {loading ? (
                        <span key="loading" className="btn-inner">
                            <span className="spinner"></span>
                            <span>Loading…</span>
                        </span>
                    ) : (
                        <span key="idle" className="btn-inner">
                            <span>Refresh Info</span>
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}

export default InfoTab;

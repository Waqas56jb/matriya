import React, { useState } from 'react';
import api from '../utils/api';
import { toast } from 'react-toastify';
import { formatApiErrorForUser } from '../utils/openAiFriendlyError';
import './RachelUpload.css';

/**
 * Lab Experiment Upload form (Rachel) — POST /api/experiments/upload
 * Fields: experiment ID, date, formulation, results
 */
export default function RachelUpload() {
    const [experimentName, setExperimentName] = useState('');
    const [date, setDate] = useState('');
    const [formulation, setFormulation] = useState('');
    const [results, setResults] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await api.post('/api/experiments/upload', {
                experiment_id: experimentName.trim(),
                date: date.trim(),
                formulation: formulation.trim(),
                results: results.trim()
            });
            if (res.data?.success && res.data?.experiment_id) {
                toast.success(`Experiment saved: ${res.data.experiment_id}`);
                setExperimentName('');
                setDate('');
                setFormulation('');
                setResults('');
            } else {
                toast.error('Unexpected response from server');
            }
        } catch (err) {
            toast.error(formatApiErrorForUser(err, 'Submission failed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section className="rachel-upload">
            <h2 className="rachel-upload__title">Upload Lab Experiment</h2>
            <p className="rachel-upload__hint">
                The experiment ID, date, formulation and results are saved to the experiments table (Supabase).
            </p>
            <form className="rachel-upload__form" onSubmit={handleSubmit}>
                <label className="rachel-upload__label">
                    <span className="rachel-upload__label-text">Experiment Name / ID</span>
                    <input
                        className="rachel-upload__input"
                        type="text"
                        name="experiment_id"
                        value={experimentName}
                        onChange={(ev) => setExperimentName(ev.target.value)}
                        placeholder="e.g. EXP-2026-042"
                        autoComplete="off"
                        required
                    />
                </label>
                <label className="rachel-upload__label">
                    <span className="rachel-upload__label-text">Date</span>
                    <input
                        className="rachel-upload__input"
                        type="date"
                        name="date"
                        value={date}
                        onChange={(ev) => setDate(ev.target.value)}
                        required
                    />
                </label>
                <label className="rachel-upload__label">
                    <span className="rachel-upload__label-text">Formulation</span>
                    <textarea
                        className="rachel-upload__textarea"
                        name="formulation"
                        rows={4}
                        value={formulation}
                        onChange={(ev) => setFormulation(ev.target.value)}
                        placeholder="Describe the formulation or ingredients"
                        required
                    />
                </label>
                <label className="rachel-upload__label">
                    <span className="rachel-upload__label-text">Results</span>
                    <textarea
                        className="rachel-upload__textarea"
                        name="results"
                        rows={5}
                        value={results}
                        onChange={(ev) => setResults(ev.target.value)}
                        placeholder="Measurement results or summary"
                        required
                    />
                </label>
                <button type="submit" className="rachel-upload__submit" disabled={submitting}>
                    {submitting ? 'Submitting…' : 'Submit'}
                </button>
            </form>
        </section>
    );
}

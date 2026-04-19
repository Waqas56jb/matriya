import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Auth.css';

export default function ResetPassword() {
  const [step, setStep]         = useState(1); // 1=email, 2=success
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const base = import.meta.env.VITE_ADMIN_API_URL || 'http://localhost:9000';
      const res  = await fetch(`${base}/api/admin/auth/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Request failed');
      }
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />
      </div>

      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">M</div>
          <div>
            <div className="auth-logo-name">MATRIYA</div>
            <div className="auth-logo-sub">Admin Command Center</div>
          </div>
        </div>

        <div className="auth-tabs">
          <Link to="/login" className="auth-tab">Sign In</Link>
          <div className="auth-tab active">Reset Password</div>
        </div>

        {step === 1 ? (
          <form onSubmit={handleSubmit}>
            <p className="auth-description">
              Enter your admin email address and we'll send a reset link to your inbox.
            </p>

            <div className="input-group">
              <label className="input-label">Email Address</label>
              <div className="input-icon-wrap">
                <span className="input-icon">✉</span>
                <input
                  type="email"
                  className="input-field"
                  placeholder="admin@matriya.io"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && <div className="auth-error">⚠ {error}</div>}

            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
              {loading ? <><span className="btn-spinner" /> Sending…</> : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <div className="auth-success-state">
            <div className="auth-success-icon">✓</div>
            <h3>Check your inbox</h3>
            <p>A reset link has been sent to <strong>{email}</strong>. It expires in 30 minutes.</p>
          </div>
        )}

        <div className="auth-footer-link">
          Remember your password?{' '}
          <Link to="/login">Sign in here</Link>
        </div>
      </div>
    </div>
  );
}

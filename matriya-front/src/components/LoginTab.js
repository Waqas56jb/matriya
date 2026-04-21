import React, { useState } from 'react';
import { toast } from 'react-toastify';
import {
    HiEye, HiEyeSlash,
    HiOutlineLockClosed, HiOutlineUser, HiOutlineEnvelope,
    HiOutlineIdentification, HiArrowRight
} from 'react-icons/hi2';
import api from '../utils/api';
import './LoginTab.css';

/**
 * Combined Sign In / Sign Up form for Matriya.
 * Public signup is enabled by default; admin can disable via MATRIYA_DISABLE_PUBLIC_SIGNUP env var.
 */
function LoginTab({ onLogin }) {
    const [mode, setMode] = useState('login'); // 'login' | 'signup'
    const [formData, setFormData] = useState({ username: '', email: '', password: '', full_name: '' });
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [signupDone, setSignupDone] = useState(false);

    const isLogin = mode === 'login';

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setError(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        const endpoint = isLogin ? '/auth/login' : '/auth/signup';
        const payload = isLogin
            ? { username: formData.username, password: formData.password }
            : { username: formData.username, email: formData.email, password: formData.password, full_name: formData.full_name };

        try {
            const response = await api.post(endpoint, payload, { timeout: 15000 });

            if (!isLogin) {
                // After signup, show success and switch to login
                setSignupDone(true);
                toast.success('Account created! You can now sign in.');
                setFormData({ username: formData.username, email: '', password: '', full_name: '' });
                setMode('login');
                return;
            }

            localStorage.setItem('token', response.data.access_token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            if (onLogin) onLogin(response.data.user, response.data.access_token);
            toast.success(`Welcome back, ${response.data.user?.username || 'there'}!`);
        } catch (err) {
            console.error('Auth error:', { status: err.response?.status, data: err.response?.data });
            const errorText =
                err.response?.data?.error ||
                err.response?.data?.detail ||
                err.message ||
                'Authentication failed. Please try again.';
            // Surface signup-disabled message clearly
            if (errorText.toLowerCase().includes('signup') && errorText.toLowerCase().includes('disabled')) {
                setError('Public registration is disabled on this server. Contact your administrator for access.');
            } else {
                setError(errorText);
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-tab">
            <div className="login-card">

                {/* Mode switcher */}
                <div className="login-mode-bar">
                    <button
                        type="button"
                        className={`login-mode-btn ${isLogin ? 'login-mode-btn--active' : ''}`}
                        onClick={() => { setMode('login'); setError(null); setSignupDone(false); }}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        className={`login-mode-btn ${!isLogin ? 'login-mode-btn--active' : ''}`}
                        onClick={() => { setMode('signup'); setError(null); }}
                    >
                        Create Account
                    </button>
                </div>

                {/* Header */}
                <div className="login-card__header">
                    <div className="login-card__logo">
                        <HiOutlineLockClosed size={26} aria-hidden />
                    </div>
                    <h2 className="login-card__title">
                        {isLogin ? 'Sign In to Matriya' : 'Create Your Account'}
                    </h2>
                    <p className="login-card__sub">
                        {isLogin
                            ? 'Access your research workspace'
                            : 'Join the Matriya research platform'}
                    </p>
                    {signupDone && isLogin && (
                        <div className="login-success-banner">
                            ✓ Account created — sign in below with your new credentials.
                        </div>
                    )}
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="login-form" noValidate>

                    {/* Username */}
                    <div className="login-field">
                        <label className="login-field__label" htmlFor="auth-username">Username</label>
                        <div className="login-field__input-wrap">
                            <HiOutlineUser className="login-field__icon" aria-hidden />
                            <input
                                id="auth-username"
                                type="text"
                                name="username"
                                value={formData.username}
                                onChange={handleChange}
                                required
                                placeholder={isLogin ? 'Your username' : 'Choose a username'}
                                className="login-field__input login-field__input--icon"
                                autoComplete="username"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Sign-up only: email + full name */}
                    {!isLogin && (
                        <>
                            <div className="login-field">
                                <label className="login-field__label" htmlFor="auth-email">
                                    Email <span className="login-field__required">*</span>
                                </label>
                                <div className="login-field__input-wrap">
                                    <HiOutlineEnvelope className="login-field__icon" aria-hidden />
                                    <input
                                        id="auth-email"
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        required
                                        placeholder="you@example.com"
                                        className="login-field__input login-field__input--icon"
                                        autoComplete="email"
                                    />
                                </div>
                            </div>
                            <div className="login-field">
                                <label className="login-field__label" htmlFor="auth-fullname">
                                    Full Name <span className="login-field__optional">(optional)</span>
                                </label>
                                <div className="login-field__input-wrap">
                                    <HiOutlineIdentification className="login-field__icon" aria-hidden />
                                    <input
                                        id="auth-fullname"
                                        type="text"
                                        name="full_name"
                                        value={formData.full_name}
                                        onChange={handleChange}
                                        placeholder="Your full name"
                                        className="login-field__input login-field__input--icon"
                                        autoComplete="name"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Password */}
                    <div className="login-field">
                        <label className="login-field__label" htmlFor="auth-password">Password</label>
                        <div className="login-field__input-wrap">
                            <HiOutlineLockClosed className="login-field__icon" aria-hidden />
                            <input
                                id="auth-password"
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                required
                                placeholder={isLogin ? 'Your password' : 'Create a strong password'}
                                autoComplete={isLogin ? 'current-password' : 'new-password'}
                                className="login-field__input login-field__input--icon login-field__input--pw"
                            />
                            <button
                                type="button"
                                className="login-field__toggle"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                aria-pressed={showPassword}
                            >
                                {showPassword
                                    ? <HiEyeSlash size={19} aria-hidden />
                                    : <HiEye size={19} aria-hidden />}
                            </button>
                        </div>
                        {!isLogin && (
                            <p className="login-field__hint">
                                Use at least 8 characters with a mix of letters and numbers.
                            </p>
                        )}
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="login-error" role="alert">
                            <span className="login-error__icon" aria-hidden>⚠</span>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Submit */}
                    <button type="submit" disabled={isLoading} className="login-submit">
                        {isLoading ? (
                            <span className="login-submit__inner">
                                <span className="login-submit__spinner" aria-hidden />
                                {isLogin ? 'Signing in…' : 'Creating account…'}
                            </span>
                        ) : (
                            <span className="login-submit__inner">
                                {isLogin ? 'Sign In' : 'Create Account'}
                                <HiArrowRight size={18} aria-hidden />
                            </span>
                        )}
                    </button>
                </form>

                {/* Mode switch link */}
                <div className="login-card__footer">
                    {isLogin ? (
                        <p>
                            Don&apos;t have an account?{' '}
                            <button type="button" className="login-link" onClick={() => { setMode('signup'); setError(null); }}>
                                Create one free
                            </button>
                        </p>
                    ) : (
                        <p>
                            Already have an account?{' '}
                            <button type="button" className="login-link" onClick={() => { setMode('login'); setError(null); }}>
                                Sign in instead
                            </button>
                        </p>
                    )}
                </div>
            </div>

            {/* Info panel — only on wider screens */}
            <div className="login-info-panel" aria-hidden>
                <div className="login-info-panel__inner">
                    <div className="login-info-brand">
                        <span className="login-info-logo">✦</span>
                        <span className="login-info-name">Matriya</span>
                    </div>
                    <h3 className="login-info-headline">Research. Evidence. Decisions.</h3>
                    <p className="login-info-desc">
                        Upload documents, query indexed knowledge, and run structured lab decision workflows — built for research teams.
                    </p>
                    <ul className="login-info-features">
                        <li>
                            <span className="login-info-check">✓</span>
                            Evidence-based document queries
                        </li>
                        <li>
                            <span className="login-info-check">✓</span>
                            Lab research &amp; comparison workflows
                        </li>
                        <li>
                            <span className="login-info-check">✓</span>
                            Transparent decision audit trail
                        </li>
                        <li>
                            <span className="login-info-check">✓</span>
                            WhatsApp finance signal monitoring
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default LoginTab;

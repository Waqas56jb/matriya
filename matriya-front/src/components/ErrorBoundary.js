import React from 'react';

/**
 * ErrorBoundary catches JavaScript errors anywhere in their child component tree,
 * logs those errors, and displays a fallback UI instead of the component tree that crashed.
 * 
 * Specifically useful for catching React DOM reconciliation errors (insertBefore/removeChild)
 * caused by browser extensions like Google Translate or Grammarly.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error('[ErrorBoundary caught an error]', error, errorInfo);
  }

  handleReset = () => {
    // Clear error state and redirect or reload to recover
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          background: 'rgba(239, 68, 68, 0.08)',
          color: '#fca5a5',
          borderRadius: '12px',
          margin: '20px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <h2 style={{ marginBottom: '12px', color: '#f0f6ff' }}>Something went wrong</h2>
          <p style={{ marginBottom: '16px', color: '#8baac8' }}>
            A browser extension (such as Google Translate) may have modified the page and caused a render error.
          </p>
          <pre style={{ 
            textAlign: 'left', 
            background: '#0b1630', 
            padding: '12px', 
            fontSize: '12px',
            overflow: 'auto',
            maxHeight: '200px',
            borderRadius: '8px',
            color: '#8baac8',
            border: '1px solid #1e3a5f'
          }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <button 
            onClick={this.handleReset}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              marginTop: '16px'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;

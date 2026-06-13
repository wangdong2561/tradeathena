import React from 'react'

interface Props { children: React.ReactNode }
interface State { hasError: boolean; error: string }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: '' }

  static getDerivedStateFromError(e: Error) {
    return { hasError: true, error: e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n') }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 20, background: '#0d0e12', color: '#f24453', height: '100%',
          fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
        }}>
          <h2 style={{ color: '#f24453', marginBottom: 8 }}>⚠️ React Error</h2>
          <div>{this.state.error}</div>
          <button onClick={() => this.setState({ hasError: false, error: '' })}
            style={{ marginTop: 12, padding: '6px 16px', background: '#23272e', color: '#d1d4dc', border: '1px solid #363a45', borderRadius: 4, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

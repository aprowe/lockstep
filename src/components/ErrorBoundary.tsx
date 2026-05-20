import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
    componentStack: string | null;
}

/**
 * Top-level error boundary. Without one, an uncaught render error unmounts the
 * whole React tree in production and leaves the Tauri window showing nothing
 * but the chrome — users read that as "app went fullscreen" / "frontend died".
 *
 * Hooks can't catch render errors, so this stays a class component.
 */
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null, componentStack: null };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Log to the console so production DevTools (or tauri log capture) can
        // surface it alongside the fallback UI for copy/paste.
        console.error("ErrorBoundary caught:", error, info.componentStack);
        this.setState({ componentStack: info.componentStack ?? null });
    }

    handleReload = () => {
        window.location.reload();
    };

    handleReset = () => {
        this.setState({ error: null, componentStack: null });
    };

    render() {
        const { error, componentStack } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="error-boundary">
                <div className="error-boundary__card">
                    <h1 className="error-boundary__title">Something broke</h1>
                    <p className="error-boundary__message">{error.message || String(error)}</p>
                    <pre className="error-boundary__stack">
                        {error.stack ?? ""}
                        {componentStack ?? ""}
                    </pre>
                    <div className="error-boundary__actions">
                        <button type="button" onClick={this.handleReset}>
                            Try again
                        </button>
                        <button type="button" onClick={this.handleReload}>
                            Reload app
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

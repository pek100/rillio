import React from 'react';

type Props = {
    children: React.ReactNode,
};

type State = {
    error: Error | null,
};

// Last-resort boundary around a whole app surface: a render crash in any child
// shows a minimal recovery screen instead of white-screening the shell. "Try
// again" clears the error and re-renders the children.
class ErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught a render error:', error, info.componentStack);
    }

    private reset = () => {
        this.setState({ error: null });
    };

    render() {
        if (this.state.error === null) {
            return this.props.children;
        }

        return (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
                <div className="text-lg font-semibold text-fg">Something went wrong</div>
                <div className="max-w-md text-sm text-fg-muted">{this.state.error.message || String(this.state.error)}</div>
                <button
                    type="button"
                    className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:brightness-110 active:scale-[0.98]"
                    onClick={this.reset}
                >
                    Try again
                </button>
            </div>
        );
    }
}

export default ErrorBoundary;

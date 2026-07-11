import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// Close handler for modal ROUTES (routes flagged `modal: true` in routerPaths).
// Normally the modal floats over the page you came from, so closing means going
// back. On a deep link the modal IS the first history entry and navigate(-1)
// is a no-op, which would leave an undismissable dialog over a void, so fall
// back to replacing the entry with the board. React Router keeps the in-app
// entry index in history.state.idx (0 = first entry of this session).
const useCloseModalRoute = (): (() => void) => {
    const navigate = useNavigate();

    return useCallback(() => {
        const idx = window.history.state?.idx;
        if (typeof idx === 'number' && idx > 0) {
            navigate(-1);
        } else {
            navigate('/', { replace: true });
        }
    }, [navigate]);
};

export default useCloseModalRoute;

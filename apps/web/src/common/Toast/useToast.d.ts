type ToastOptions = {
    type: string,
    title: string,
    message?: string,
    timeout: number,
    action?: {
        label: string,
        onSelect: () => void,
    },
};

declare const useToast: () => {
    show: (options: ToastOptions) => void,
};

export = useToast;

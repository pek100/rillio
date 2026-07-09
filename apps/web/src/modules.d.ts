declare module '@rillio/core-web/bridge';

declare module '*.less' {
    const resource: Record<string, string>;
    export = resource;
}

declare module 'rillio-router';
declare module 'rillio/components/NavBar';
declare module 'rillio/components/ModalDialog';

import React, { ChangeEvent, createContext, useContext, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { isFileType, isFileTypeSupported } from './utils';

export type FileType = string;
export type FileDropListener = (file: File, buffer: ArrayBuffer, supported: boolean) => void;

type FileDropContext = {
    on: (type: FileType, listener: FileDropListener) => void,
    off: (type: FileType, listener: FileDropListener) => void,
};

const FileDropContext = createContext({} as FileDropContext);

type Props = {
    children: React.ReactNode,
};

const FileDropProvider = ({ children }: Props) => {
    const listeners = useRef<[FileType, FileDropListener][]>([]);
    const [active, setActive] = useState(false);

    const on = (type: FileType, listener: FileDropListener) => {
        listeners.current = [...listeners.current, [type, listener]];
    };

    const off = (type: FileType, listener: FileDropListener) => {
        listeners.current = listeners.current.filter(([key, value]) => key !== type && value !== listener);
    };

    const onChange = (event: ChangeEvent) => {
        event.preventDefault();

        const input = event.target as HTMLInputElement;

        if (input.files && input.files.length > 0) {
            const file = input.files[0];

            file
                .arrayBuffer()
                .then((buffer) => {
                    listeners.current
                        .filter(([type]) => type === '*')
                        .forEach(([, listener]) => listener(file, buffer, isFileTypeSupported(buffer)));
                    listeners.current
                        .filter(([type]) => type !== '*' && (file.type ? type === file.type : isFileType(buffer, type)))
                        .forEach(([, listener]) => listener(file, buffer, true));
                })
                .catch(console.error);
        }

        setActive(false);
        input.files = new DataTransfer().files;
    };

    useEffect(() => {
        const onDragStart = (event: DragEvent) => {
            event.preventDefault();
        };

        const onDragOver = (event: DragEvent) => {
            event.preventDefault();
            setActive(true);
        };

        const onDragLeave = (event: DragEvent) => {
            event.preventDefault();
            setActive(false);
        };

        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);

        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
        };
    }, []);

    return (
        <FileDropContext.Provider value={{ on, off }}>
            { children }
            <div
                className={classNames(
                    'pointer-events-none fixed inset-0 rounded-2xl border-[0.5rem] border-dashed border-transparent transition-[border-color] duration-[250ms] ease-out',
                    { 'pointer-events-auto border-accent': active },
                )}
            >
                <input type={'file'} className={'absolute inset-0 opacity-0'} onChange={onChange} />
            </div>
        </FileDropContext.Provider>
    );
};

const useFileDrop = () => {
    return useContext(FileDropContext);
};

export {
    FileDropProvider,
    useFileDrop,
};

// Copyright (C) 2017-2024 Smart code 203358507

/**
 * Intro - the full-screen auth surface (signup / login / guest).
 *
 * Clean-room view rewrite: every piece of behaviour is reused verbatim - the
 * useReducer form machine, the Facebook/Apple login hooks, the core Authenticate /
 * Register dispatch, the UserAuthenticated event/error listeners, email/password
 * validation and the terms gating. Only the markup + styling are new (foundation-kit
 * Button / Input / Checkbox / Dialog on our semantic tokens). NOT a modal route: a
 * full-screen page with a blurred dual-SVG backdrop.
 */

import React, { useCallback, useEffect, useReducer, useRef, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CircleUser } from 'lucide-react';
import { Facebook, Apple } from 'rillio/components/ui/brand-icons';
import Modal from 'rillio/router/Modal';
import { useCore } from 'rillio/core';
import { useBinaryState } from 'rillio/common';
import useRouteFocused from 'rillio/common/useRouteFocused';
import Logo from 'rillio/common/Logo/Logo';
import { Button, Input, Checkbox, cn } from 'rillio/components/ui';
import CredentialsTextInput from './CredentialsTextInput';
import PasswordResetModal from './PasswordResetModal';
import useFacebookLogin from './useFacebookLogin';
import useAppleLogin from './useAppleLogin';

const SIGNUP_FORM = 'signup';
const LOGIN_FORM = 'login';

type FormType = typeof SIGNUP_FORM | typeof LOGIN_FORM;

type State = {
    form: FormType;
    email: string;
    password: string;
    confirmPassword: string;
    termsAccepted: boolean;
    privacyPolicyAccepted: boolean;
    marketingAccepted: boolean;
    error: string;
};

type Action =
    | { type: 'set-form'; form: FormType }
    | { type: 'change-credentials'; name: string; value: string }
    | { type: 'toggle-checkbox'; name: string }
    | { type: 'error'; error: string };

// Shared pill-button geometry: full-width, 3.5rem tall, transitions filter (for
// hover brightness) and transform (for the active press). Colour comes per-button.
const FORM_BUTTON = 'w-full h-14 px-6 gap-3 text-base active:scale-[0.97] transition-[background-color,color,filter,opacity,transform]';

// A checkbox row (box + label + optional inline TOS/privacy link). Forwards its ref
// to the underlying Radix checkbox button so the form machine can focus it.
const IntroCheckbox = forwardRef<HTMLButtonElement, {
    id: string;
    label: string;
    link?: string;
    href?: string;
    checked: boolean;
    onToggle: () => void;
}>(function IntroCheckbox({ id, label, link, href, checked, onToggle }, ref) {
    return (
        <label htmlFor={id} className="flex flex-row items-center gap-3 py-1 cursor-pointer">
            <Checkbox
                id={id}
                ref={ref}
                checked={checked}
                onCheckedChange={onToggle}
                className="shrink-0 bg-surface-hover"
            />
            <span className="text-sm text-fg-muted">
                {label}
                {
                    href && link ?
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            tabIndex={-1}
                            className="ml-2 text-accent hover:underline"
                        >
                            {link}
                        </a>
                        :
                        null
                }
            </span>
        </label>
    );
});

const Intro = () => {
    const [queryParams, setQueryParams] = useSearchParams();
    const navigate = useNavigate();
    const core = useCore();
    const { t } = useTranslation();
    const routeFocused = useRouteFocused();
    const [startFacebookLogin, stopFacebookLogin] = useFacebookLogin();
    const [startAppleLogin, stopAppleLogin] = useAppleLogin();
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmPasswordRef = useRef<HTMLInputElement>(null);
    const termsRef = useRef<HTMLButtonElement>(null);
    const privacyPolicyRef = useRef<HTMLButtonElement>(null);
    const marketingRef = useRef<HTMLButtonElement>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const [passwordRestModalOpen, openPasswordRestModal, closePasswordResetModal] = useBinaryState(false);
    const [loaderModalOpen, openLoaderModal, closeLoaderModal] = useBinaryState(false);
    const [state, dispatch] = useReducer(
        (state: State, action: Action): State => {
            switch (action.type) {
                case 'set-form':
                    if (state.form !== action.form) {
                        return {
                            form: action.form,
                            email: '',
                            password: '',
                            confirmPassword: '',
                            termsAccepted: false,
                            privacyPolicyAccepted: false,
                            marketingAccepted: false,
                            error: ''
                        };
                    }
                    return state;
                case 'change-credentials':
                    return {
                        ...state,
                        error: '',
                        [action.name]: action.value
                    };
                case 'toggle-checkbox':
                    return {
                        ...state,
                        error: '',
                        [action.name]: !state[action.name as keyof State]
                    };
                case 'error':
                    return {
                        ...state,
                        error: action.error
                    };
                default:
                    return state;
            }
        },
        {
            form: ([LOGIN_FORM, SIGNUP_FORM] as string[]).includes(queryParams.get('form') || '') ? (queryParams.get('form') as FormType) : SIGNUP_FORM,
            email: '',
            password: '',
            confirmPassword: '',
            termsAccepted: false,
            privacyPolicyAccepted: false,
            marketingAccepted: false,
            error: ''
        }
    );
    const loginWithFacebook = useCallback(() => {
        openLoaderModal();
        startFacebookLogin()
            .then(({ email, password }: { email: string; password: string }) => {
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'Authenticate',
                        args: {
                            type: 'Login',
                            email,
                            password,
                            facebook: true
                        }
                    }
                });
            })
            .catch((error: Error) => {
                closeLoaderModal();
                dispatch({ type: 'error', error: error.message });
            });
    }, []);
    const loginWithApple = useCallback(() => {
        openLoaderModal();
        startAppleLogin()
            .then(({ token, sub, email, name }) => {
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'Authenticate',
                        args: {
                            type: 'Apple',
                            token,
                            sub,
                            email,
                            name
                        }
                    }
                });
            })
            .catch((error: Error) => {
                closeLoaderModal();
                dispatch({ type: 'error', error: error.message });
            });
    }, []);
    const cancelLogin = useCallback(() => {
        stopFacebookLogin();
        stopAppleLogin();
        closeLoaderModal();
    }, []);
    const loginWithEmail = useCallback(() => {
        if (typeof state.email !== 'string' || state.email.length === 0 || !emailRef.current!.validity.valid) {
            dispatch({ type: 'error', error: t('INVALID_EMAIL') });
            return;
        }
        if (typeof state.password !== 'string' || state.password.length === 0) {
            dispatch({ type: 'error', error: t('INVALID_PASSWORD') });
            return;
        }
        openLoaderModal();
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'Authenticate',
                args: {
                    type: 'Login',
                    email: state.email,
                    password: state.password
                }
            }
        });
    }, [state.email, state.password]);
    const loginAsGuest = useCallback(() => {
        if (!state.termsAccepted) {
            dispatch({ type: 'error', error: t('MUST_ACCEPT_TERMS') });
            return;
        }
        navigate('/');
    }, [state.termsAccepted]);
    const signup = useCallback(() => {
        if (typeof state.email !== 'string' || state.email.length === 0 || !emailRef.current!.validity.valid) {
            dispatch({ type: 'error', error: t('INVALID_EMAIL') });
            return;
        }
        if (typeof state.password !== 'string' || state.password.length === 0) {
            dispatch({ type: 'error', error: t('INVALID_PASSWORD') });
            return;
        }
        if (state.password !== state.confirmPassword) {
            dispatch({ type: 'error', error: t('PASSWORDS_NOMATCH') });
            return;
        }
        if (!state.termsAccepted) {
            dispatch({ type: 'error', error: t('MUST_ACCEPT_TERMS') });
            return;
        }
        if (!state.privacyPolicyAccepted) {
            dispatch({ type: 'error', error: t('MUST_ACCEPT_PRIVACY_POLICY') });
            return;
        }
        openLoaderModal();
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'Authenticate',
                args: {
                    type: 'Register',
                    email: state.email,
                    password: state.password,
                    gdpr_consent: {
                        tos: state.termsAccepted,
                        privacy: state.privacyPolicyAccepted,
                        marketing: state.marketingAccepted,
                        from: 'web'
                    }
                }
            }
        });
    }, [state.email, state.password, state.confirmPassword, state.termsAccepted, state.privacyPolicyAccepted, state.marketingAccepted]);
    const emailOnChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch({
            type: 'change-credentials',
            name: 'email',
            value: event.currentTarget.value
        });
    }, []);
    const emailOnSubmit = useCallback(() => {
        passwordRef.current!.focus();
    }, []);
    const passwordOnChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch({
            type: 'change-credentials',
            name: 'password',
            value: event.currentTarget.value
        });
    }, []);
    const passwordOnSubmit = useCallback(() => {
        if (state.form === SIGNUP_FORM) {
            confirmPasswordRef.current!.focus();
        } else {
            loginWithEmail();
        }
    }, [state.form, loginWithEmail]);
    const confirmPasswordOnChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch({
            type: 'change-credentials',
            name: 'confirmPassword',
            value: event.currentTarget.value
        });
    }, []);
    const confirmPasswordOnSubmit = useCallback(() => {
        termsRef.current!.focus();
    }, []);
    const toggleTermsAccepted = useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'termsAccepted' });
    }, []);
    const togglePrivacyPolicyAccepted = useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'privacyPolicyAccepted' });
    }, []);
    const toggleMarketingAccepted = useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'marketingAccepted' });
    }, []);
    const switchFormOnClick = useCallback(() => {
        const nextQueryParams = new URLSearchParams([['form', state.form === SIGNUP_FORM ? LOGIN_FORM : SIGNUP_FORM]]);
        setQueryParams(nextQueryParams);
    }, [state.form]);
    useEffect(() => {
        if (([LOGIN_FORM, SIGNUP_FORM] as string[]).includes(queryParams.get('form') || '')) {
            dispatch({ type: 'set-form', form: queryParams.get('form') as FormType });
        }
    }, [queryParams]);
    useEffect(() => {
        if (routeFocused && typeof state.error === 'string' && state.error.length > 0) {
            errorRef.current!.scrollIntoView();
        }
    }, [state.error]);
    useEffect(() => {
        if (routeFocused) {
            emailRef.current!.focus();
        }
    }, [state.form, routeFocused]);
    useEffect(() => {
        const onCoreEvent = (name: string) => {
            if (name === 'UserAuthenticated') {
                closeLoaderModal();
                if (routeFocused) {
                    navigate('/');
                }
            }
        };
        const onCoreError = (source: { event: string }) => {
            if (source.event === 'UserAuthenticated') {
                closeLoaderModal();
            }
        };
        core.on('event', onCoreEvent);
        core.on('error', onCoreError);
        return () => {
            core.off('event', onCoreEvent);
            core.off('error', onCoreError);
        };
    }, [routeFocused]);
    return (
        <div className="relative flex flex-col items-center justify-center h-full overflow-y-auto max-[1000px]:justify-start max-[1000px]:px-6 max-[1000px]:py-12">
            <div
                className="fixed -inset-4 -z-10 bg-no-repeat blur-[6rem]"
                style={{
                    backgroundImage: "url('/assets/images/background_1.svg'), url('/assets/images/background_2.svg')",
                    backgroundColor: 'var(--color-bg)',
                    backgroundPosition: 'bottom left, top right',
                    backgroundSize: '53%, 54%'
                }}
            />
            <div className="flex-none flex flex-col items-center justify-center mb-20 max-[1000px]:items-start max-[1000px]:mb-16 animate-in fade-in slide-in-from-bottom-3 duration-700">
                <Logo className="flex-none mb-12 h-20 w-auto opacity-90 max-[1000px]:h-16" size={78} />
                <div className="text-fg text-5xl font-semibold mb-2 max-[1000px]:text-[2.5rem]">
                    {t('WEBSITE_SLOGAN_NEW_NEW')}
                </div>
                <div className="text-2xl font-normal lowercase text-fg-muted first-letter:uppercase">
                    {t('WEBSITE_SLOGAN_ALL')}
                </div>
            </div>
            <div className="flex-none flex flex-row items-start justify-center w-full gap-16 max-[1000px]:flex-col-reverse max-[1000px]:items-center animate-in fade-in duration-700">
                <div className="flex-none flex flex-col gap-4 w-88 max-[1000px]:w-1/2 max-[640px]:w-full">
                    <CredentialsTextInput
                        ref={emailRef}
                        className="h-14 px-4 text-base"
                        type="email"
                        placeholder={t('EMAIL')}
                        value={state.email}
                        onChange={emailOnChange}
                        onSubmit={emailOnSubmit}
                    />
                    <CredentialsTextInput
                        ref={passwordRef}
                        className="h-14 px-4 text-base"
                        type="password"
                        placeholder={t('PASSWORD')}
                        value={state.password}
                        onChange={passwordOnChange}
                        onSubmit={passwordOnSubmit}
                    />
                    {
                        state.form === SIGNUP_FORM ?
                            <React.Fragment>
                                <CredentialsTextInput
                                    ref={confirmPasswordRef}
                                    className="h-14 px-4 text-base"
                                    type="password"
                                    placeholder={t('PASSWORD_CONFIRM')}
                                    value={state.confirmPassword}
                                    onChange={confirmPasswordOnChange}
                                    onSubmit={confirmPasswordOnSubmit}
                                />
                                <IntroCheckbox
                                    ref={termsRef}
                                    id="intro-terms"
                                    label="I agree to the Terms of Service."
                                    checked={state.termsAccepted}
                                    onToggle={toggleTermsAccepted}
                                />
                                <IntroCheckbox
                                    ref={privacyPolicyRef}
                                    id="intro-privacy"
                                    label="I agree to the Privacy Policy."
                                    checked={state.privacyPolicyAccepted}
                                    onToggle={togglePrivacyPolicyAccepted}
                                />
                                <IntroCheckbox
                                    ref={marketingRef}
                                    id="intro-marketing"
                                    label={t('MARKETING_AGREE')}
                                    checked={state.marketingAccepted}
                                    onToggle={toggleMarketingAccepted}
                                />
                            </React.Fragment>
                            :
                            <div className="flex flex-row justify-end">
                                <Button
                                    variant="link"
                                    className="px-4 py-2 text-fg-muted hover:text-fg"
                                    onClick={openPasswordRestModal}
                                >
                                    {t('FORGOT_PASSWORD')}
                                </Button>
                            </div>
                    }
                    {
                        state.error && state.error.length > 0 ?
                            <div ref={errorRef} className="px-4 text-center text-danger">{state.error}</div>
                            :
                            null
                    }
                    <Button
                        className={FORM_BUTTON}
                        onClick={state.form === SIGNUP_FORM ? signup : loginWithEmail}
                    >
                        <span>{state.form === SIGNUP_FORM ? t('SIGN_UP') : t('LOG_IN')}</span>
                    </Button>
                </div>
                <div className="flex-none flex flex-col gap-4 w-88 max-[1000px]:w-1/2 max-[640px]:w-full">
                    <Button
                        className={cn(FORM_BUTTON, 'bg-[var(--color-facebook)] text-fg hover:brightness-110')}
                        onClick={loginWithFacebook}
                    >
                        <Facebook className="size-6" />
                        <span>{t('FB_LOGIN')}</span>
                    </Button>
                    <Button
                        className={cn(FORM_BUTTON, 'bg-fg text-bg hover:brightness-110')}
                        onClick={loginWithApple}
                    >
                        <Apple className="size-6" />
                        <span>{t('APPLE_LOGIN')}</span>
                    </Button>
                    {
                        state.form === SIGNUP_FORM ?
                            <Button
                                className={cn(FORM_BUTTON, 'bg-surface text-fg hover:brightness-110')}
                                onClick={switchFormOnClick}
                            >
                                <span>{t('LOG_IN')}</span>
                            </Button>
                            :
                            null
                    }
                    {
                        state.form === LOGIN_FORM ?
                            <Button
                                className={cn(FORM_BUTTON, 'bg-surface text-fg hover:brightness-110')}
                                onClick={switchFormOnClick}
                            >
                                <span>{t('SIGN_UP_EMAIL')}</span>
                            </Button>
                            :
                            null
                    }
                    {
                        state.form === SIGNUP_FORM ?
                            <Button
                                className={cn(FORM_BUTTON, 'bg-surface text-fg hover:brightness-110')}
                                onClick={loginAsGuest}
                            >
                                <span>{t('GUEST_LOGIN')}</span>
                            </Button>
                            :
                            null
                    }
                </div>
            </div>
            {
                passwordRestModalOpen ?
                    <PasswordResetModal email={state.email} onCloseRequest={closePasswordResetModal} />
                    :
                    null
            }
            {
                loaderModalOpen ?
                    <Modal className="flex items-center justify-center bg-black/40">
                        <div className="flex-none flex flex-col items-center justify-center gap-4 p-10 rounded-card bg-surface-hover shadow-elevated">
                            <CircleUser className="size-20 text-fg animate-pulse" />
                            <div className="text-2xl text-fg animate-pulse">{t('AUTHENTICATING')}</div>
                            <Button
                                className={cn(FORM_BUTTON, 'mt-8 bg-surface text-fg hover:brightness-110')}
                                onClick={cancelLogin}
                            >
                                <span>{t('BUTTON_CANCEL')}</span>
                            </Button>
                        </div>
                    </Modal>
                    :
                    null
            }
        </div>
    );
};

export default Intro;

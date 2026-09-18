import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GlassButton } from '../ui/GlassButton';
import { GlassCard } from '../ui/GlassCard';
import { apiService } from '../../lib/api';
import { useModalPointerPolicy } from '../../lib/useModalPointerPolicy';
import { getLocaleLabel, useUiLocale, type UiLocale } from '../../lib/uiLocale';
import type { AuthUser } from '../../types/curation';

interface AuthOverlayProps {
  onToast: (type: 'success' | 'error' | 'info', message: string) => void;
  onChange: (user: AuthUser | null) => void;
  onOpenCuratorWorkspace?: () => void;
  variant?: 'floating' | 'dock';
  actions?: ReactNode;
  showTriggerButton?: boolean;
  loginPromptMessage?: string | null;
  loginPromptRequestId?: number;
  toggleRequestId?: number;
  forceOpen?: boolean;
}

type AuthMode = 'login' | 'register';
type RegisterRole = 'visitor' | 'curator' | 'writer';

const getRoleDisplayLabel = (locale: UiLocale, role: string | undefined, roles: string[] | undefined) => {
  if (locale === 'ko') {
    if (roles?.includes('admin')) return '관리자';
    if (roles?.includes('paid_curator')) return '큐레이터';
    if (roles?.includes('writer')) return '작가';
    if (role === 'admin') return '관리자';
    if (role === 'paid_curator') return '큐레이터';
    if (role === 'writer') return '작가';
    return '관람객';
  }

  if (roles?.includes('admin')) return 'Admin';
  if (roles?.includes('paid_curator')) return 'Curator';
  if (roles?.includes('writer')) return 'Writer';
  if (role === 'admin') return 'Admin';
  if (role === 'paid_curator') return 'Curator';
  if (role === 'writer') return 'Writer';
  return 'Visitor';
};

const getRegisterRoleLabel = (locale: UiLocale, role: RegisterRole) => {
  if (locale === 'ko') {
    if (role === 'visitor') return '관람객';
    if (role === 'curator') return '큐레이터';
    return '작가';
  }

  if (role === 'visitor') return 'Visitor';
  if (role === 'curator') return 'Curator';
  return 'Writer';
};

export const AuthOverlay = ({
  onToast,
  onChange,
  onOpenCuratorWorkspace,
  variant = 'floating',
  actions,
  showTriggerButton = true,
  loginPromptMessage = null,
  loginPromptRequestId = 0,
  toggleRequestId = 0,
  forceOpen = false,
}: AuthOverlayProps) => {
  const { locale, setLocale } = useUiLocale();
  const isKorean = locale === 'ko';
  const [bootstrapping, setBootstrapping] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(() => apiService.getStoredAuthUserSnapshot());
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPasswordConfirmation, setRegisterPasswordConfirmation] = useState('');
  const [registerRole, setRegisterRole] = useState<RegisterRole>('visitor');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activePromptMessage, setActivePromptMessage] = useState<string | null>(null);

  const primaryRole = useMemo(() => getRoleDisplayLabel(locale, user?.primaryRole, user?.roles), [locale, user]);
  const workspaceShortcutLabel = useMemo(() => {
    const roles = user?.roles ?? [];
    const isCurator = roles.includes('paid_curator') || user?.primaryRole === 'paid_curator' || roles.includes('admin') || user?.primaryRole === 'admin';
    const isWriter = roles.includes('writer') && !isCurator;

    if (locale === 'ko') {
      if (isCurator) return '큐레이터 작업공간';
      if (isWriter) return '작업공간';
      return '작업공간';
    }

    if (isCurator) return 'Curator Workspace';
    if (isWriter) return 'Workspace';
    return 'Workspace';
  }, [locale, user]);
  const copy = useMemo(
    () => ({
      account: isKorean ? '계정' : 'Account',
      authTitle: isKorean ? '로그인 / 회원가입' : 'Login / Sign up',
      close: isKorean ? '닫기' : 'Close',
      checking: isKorean ? '확인 중' : 'Checking',
      language: isKorean ? '언어' : 'Language',
      quickAccess: isKorean ? '빠른 이동' : 'Quick access',
      quickAccessDesc: isKorean
        ? '로그인 전후에 자주 쓰는 화면으로 바로 이동합니다.'
        : 'Jump to the screens you use most before or after sign in.',
      loginRequired: isKorean ? '로그인이 필요합니다.' : 'Login is required.',
      loginTab: isKorean ? '로그인' : 'Log in',
      registerTab: isKorean ? '회원가입' : 'Sign up',
      loginIntro: isKorean ? '아이디 또는 이메일로 로그인할 수 있습니다.' : 'You can log in with your username or email.',
      identifier: isKorean ? '아이디 또는 이메일' : 'Username or email',
      password: isKorean ? '비밀번호' : 'Password',
      loginButton: isKorean ? '로그인' : 'Log in',
      registerIntro: isKorean
        ? '회원가입은 관람객, 큐레이터, 작가 계정만 가능합니다. 관리자 계정은 가입할 수 없습니다.'
        : 'Signups are available for visitor, curator, or writer accounts. Admin accounts cannot be created.',
      username: isKorean ? '아이디' : 'Username',
      email: isKorean ? '이메일' : 'Email',
      passwordConfirm: isKorean ? '비밀번호 확인' : 'Confirm password',
      roleSelection: isKorean ? '역할 선택' : 'Role selection',
      signUpButton: isKorean ? '회원가입' : 'Sign up',
      logout: isKorean ? '로그아웃' : 'Log out',
      openMenu: isKorean ? '계정 메뉴 열기' : 'Open account menu',
      planLabel: isKorean ? '플랜' : 'Plan',
      storyLabel: isKorean ? '스토리' : 'Story',
      loginHint: isKorean ? '아이디 또는 이메일과 비밀번호를 입력해 주세요.' : 'Enter your username or email and password.',
      registerHint: isKorean ? '아이디, 이메일, 비밀번호를 모두 입력해 주세요.' : 'Enter your username, email, and password.',
      passwordMismatch: isKorean ? '비밀번호와 비밀번호 확인이 일치하지 않습니다.' : 'Password and confirmation do not match.',
      loginSuccess: (name: string) => (isKorean ? `${name}님으로 로그인되었습니다.` : `Signed in as ${name}.`),
      registerSuccess: (name: string) => (isKorean ? `${name}님 회원가입이 완료되었습니다.` : `Signed up as ${name}.`),
      loginError: isKorean ? '로그인에 실패했습니다.' : 'Login failed.',
      registerError: isKorean ? '회원가입에 실패했습니다.' : 'Sign up failed.',
      logoutError: isKorean ? '로그아웃에 실패했습니다.' : 'Logout failed.',
      logoutSuccess: isKorean ? '로그아웃되었습니다.' : 'You have been logged out.',
      currentPrefix: isKorean ? '현재' : 'Current',
    }),
    [isKorean]
  );
  const dockMode = variant === 'dock';
  const triggerPositionClass = dockMode ? 'right-4 top-4' : 'right-5 top-20';
  const triggerButtonClass = 'h-[54px] w-[54px] rounded-[18px]';
  const isOpen = forceOpen || expanded;
  const isForcedLogin = forceOpen;

  useEffect(() => {
    const bootstrap = async () => {
      if (!apiService.hasAuthTokens()) {
        setBootstrapping(false);
        return;
      }

      try {
        const response = await apiService.restoreSession();
        if (!response) {
          setUser(null);
          onChange(null);
          return;
        }
        setUser(response.user);
        onChange(response.user);
      } catch {
        apiService.clearAuthTokens();
        setUser(null);
        onChange(null);
      } finally {
        setBootstrapping(false);
      }
    };

    void bootstrap();
  }, [onChange]);

  useEffect(() => {
    if (!dockMode || !isOpen || isForcedLogin) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dockMode, isForcedLogin, isOpen]);

  useEffect(() => {
    if (!forceOpen) {
      return;
    }

    setMode('login');
    setActivePromptMessage(loginPromptMessage ?? copy.loginRequired);
    setExpanded(true);
  }, [copy.loginRequired, forceOpen, loginPromptMessage]);

  useEffect(() => {
    if (!loginPromptRequestId) {
      return;
    }

    setMode('login');
    setActivePromptMessage(loginPromptMessage);
    setExpanded(true);
  }, [loginPromptMessage, loginPromptRequestId]);

  useEffect(() => {
    if (!toggleRequestId) {
      return;
    }

    setExpanded((currentExpanded) => {
      const nextExpanded = !currentExpanded;
      if (nextExpanded && loginPromptMessage) {
        setMode('login');
        setActivePromptMessage(loginPromptMessage);
      }
      return nextExpanded;
    });
  }, [loginPromptMessage, toggleRequestId]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setActivePromptMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!user) {
      return;
    }

    setActivePromptMessage(null);
  }, [user]);

  useModalPointerPolicy(isOpen);

  const handleLogin = async () => {
    const identifier = loginIdentifier.trim();
    const password = loginPassword;
    if (!identifier || !password) {
      onToast('error', copy.loginHint);
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await apiService.login({ identifier, password });
      setUser(session.user);
      onChange(session.user);
      setActivePromptMessage(null);
      setExpanded(false);
      onToast('success', copy.loginSuccess(session.user.displayName));
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : copy.loginError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async () => {
    const username = registerUsername.trim();
    const email = registerEmail.trim();
    const password = registerPassword;
    const passwordConfirmation = registerPasswordConfirmation;

    if (!username || !email || !password || !passwordConfirmation) {
      onToast('error', copy.registerHint);
      return;
    }

    if (password !== passwordConfirmation) {
      onToast('error', copy.passwordMismatch);
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await apiService.register({
        username,
        email,
        password,
        passwordConfirmation,
        role: registerRole,
      });
      setUser(session.user);
      onChange(session.user);
      setActivePromptMessage(null);
      setExpanded(false);
      onToast('success', copy.registerSuccess(session.user.displayName));
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : copy.registerError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setIsSubmitting(true);
    let logoutError: unknown = null;
    try {
      await apiService.logout();
    } catch (error) {
      logoutError = error;
    } finally {
      apiService.clearAuthTokens();
      setUser(null);
      onChange(null);
      setExpanded(false);
      window.location.hash = '#/';
      setIsSubmitting(false);
    }

    if (logoutError) {
      onToast('error', logoutError instanceof Error ? logoutError.message : copy.logoutError);
      return;
    }

    onToast('info', copy.logoutSuccess);
  };

  const renderCollapsedTrigger = () => (
    <div className={`fixed ${triggerPositionClass} z-[220]`}>
      <button
        type="button"
        data-testid="auth-overlay-trigger"
        aria-expanded={expanded}
        aria-label={copy.openMenu}
        onClick={() => setExpanded(true)}
        className={`group relative flex cursor-pointer items-center justify-center border border-white/10 bg-white/[0.04] text-stone-100 shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-all duration-300 hover:border-[#7f9b5a]/30 hover:bg-white/[0.08] hover:shadow-[0_14px_50px_rgba(0,0,0,0.34)] focus:outline-none focus:ring-2 focus:ring-[#7f9b5a]/35 focus:ring-offset-0 ${triggerButtonClass}`}
      >
        <span className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/10 to-transparent opacity-80" />
        <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
        <span className="relative flex h-5 w-5 flex-col justify-between">
          <span className="block h-[1.5px] w-full rounded-full bg-[#f4efe7] transition-transform duration-300 group-hover:translate-y-[0.5px]" />
          <span className="block h-[1.5px] w-full rounded-full bg-[#f4efe7] transition-transform duration-300 group-hover:scale-x-90" />
          <span className="block h-[1.5px] w-full rounded-full bg-[#f4efe7] transition-transform duration-300 group-hover:-translate-y-[0.5px]" />
        </span>
      </button>
    </div>
  );

  const renderAuthForm = () => {
    if (user) {
      return (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-sm font-medium text-white">{user.displayName}</p>
            <p className="mt-1 text-xs text-stone-400">
              {user.username} · {user.email}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-300">
                {getRoleDisplayLabel(locale, user.primaryRole, user.roles)}
              </span>
              {onOpenCuratorWorkspace ? (
                <button
                  type="button"
                  onClick={onOpenCuratorWorkspace}
                  className="cursor-pointer rounded-full border border-[#7f9b5a]/24 bg-[#7f9b5a]/12 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#e8f0d5] transition hover:bg-[#7f9b5a]/18"
                >
                  {workspaceShortcutLabel}
                </button>
              ) : null}
            </div>
          </div>
          <GlassButton variant="forest" size="sm" fullWidth isLoading={isSubmitting} onClick={() => void handleLogout()}>
            {copy.logout}
          </GlassButton>
        </div>
      );
    }

    return (
      <div className="mt-4 space-y-4">
        {!isForcedLogin ? (
          <div className="grid grid-cols-2 gap-2 rounded-full border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`cursor-pointer rounded-full px-3 py-2 text-sm font-medium transition ${
                mode === 'login'
                  ? 'bg-white/10 text-white'
                  : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
              }`}
            >
              {copy.loginTab}
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`cursor-pointer rounded-full px-3 py-2 text-sm font-medium transition ${
                mode === 'register'
                  ? 'bg-white/10 text-white'
                  : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
              }`}
            >
              {copy.registerTab}
            </button>
          </div>
        ) : null}

        {mode === 'login' || isForcedLogin ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleLogin();
            }}
          >
            <p className="text-xs text-stone-400">{copy.loginIntro}</p>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.identifier}</span>
              <input
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="curator_1"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.password}</span>
              <input
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                type="password"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>
            <GlassButton type="submit" variant="primary" size="sm" fullWidth isLoading={isSubmitting}>
              {copy.loginButton}
            </GlassButton>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRegister();
            }}
          >
            <p className="text-xs text-stone-400">{copy.registerIntro}</p>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.username}</span>
              <input
                value={registerUsername}
                onChange={(event) => setRegisterUsername(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="writer_1"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.email}</span>
              <input
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                type="email"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="writer_1@digital-twin.local"
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.password}</span>
              <input
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                type="password"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">{copy.passwordConfirm}</span>
              <input
                value={registerPasswordConfirmation}
                onChange={(event) => setRegisterPasswordConfirmation(event.target.value)}
                type="password"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-stone-500 focus:border-cyan-400/50"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </label>
            <div className="space-y-2">
              <p className="text-xs text-stone-400">{copy.roleSelection}</p>
              <div className="grid grid-cols-2 gap-2">
                {(['visitor', 'curator', 'writer'] as const).map((role) => {
                  const active = registerRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRegisterRole(role)}
                      className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        active
                          ? 'border-cyan-400/45 bg-cyan-400/12 text-white'
                          : 'border-white/10 bg-black/20 text-stone-300 hover:bg-white/5'
                      }`}
                    >
                      {getRegisterRoleLabel(locale, role)}
                    </button>
                  );
                })}
              </div>
            </div>
            <GlassButton type="submit" variant="primary" size="sm" fullWidth isLoading={isSubmitting}>
              {copy.signUpButton}
            </GlassButton>
          </form>
        )}
      </div>
    );
  };

  const renderExpandedPanel = () => (
    <div data-testid="auth-overlay-panel" className="fixed inset-0 z-[220]">
      {isForcedLogin ? (
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] cursor-default" />
      ) : (
        <button
          type="button"
          aria-label={copy.close}
          onClick={() => setExpanded(false)}
          className="absolute inset-0 cursor-pointer bg-black/55 backdrop-blur-[2px]"
        />
      )}

      <div className="pointer-events-none relative flex min-h-full items-start justify-end p-4 sm:p-6">
        <div className="pointer-events-auto w-full max-w-[min(460px,calc(100vw-2rem))]">
          <GlassCard
            variant="default"
            padding="md"
            className="border-white/15 bg-stone-950/82 text-stone-100 shadow-[0_30px_90px_rgba(0,0,0,0.62)] backdrop-blur-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">{copy.account}</p>
                <h3 className="mt-1 text-base font-semibold text-white">{copy.authTitle}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-stone-300">
                  {bootstrapping && !user ? copy.checking : primaryRole}
                </span>
                {!isForcedLogin ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-stone-300 transition hover:bg-white/10 hover:text-white"
                  >
                    {copy.close}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                  {copy.language}
                </p>
                <div className="flex rounded-full border border-white/10 bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setLocale('ko')}
                    className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${
                      locale === 'ko' ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'
                    }`}
                    aria-pressed={locale === 'ko'}
                  >
                    한국어
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale('en')}
                    className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${
                      locale === 'en' ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'
                    }`}
                    aria-pressed={locale === 'en'}
                  >
                    EN
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-stone-500">
                {copy.currentPrefix}: {getLocaleLabel(locale)}
              </p>
            </div>

            {activePromptMessage ? (
              <div
                data-testid="auth-login-prompt"
                className="mt-4 rounded-2xl border border-[#7f9b5a]/25 bg-[#7f9b5a]/10 px-4 py-3 text-sm text-[#f4efe7] shadow-[0_0_0_1px_rgba(127, 155, 90,0.08)]"
              >
                {activePromptMessage}
              </div>
            ) : null}

            {user && actions ? (
              <div className={`${activePromptMessage ? 'mt-3' : 'mt-4'} rounded-2xl border border-white/10 bg-black/20 px-4 py-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                      {copy.quickAccess}
                    </p>
                    <p className="mt-1 text-xs text-stone-500">{copy.quickAccessDesc}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">{actions}</div>
              </div>
            ) : null}

            {renderAuthForm()}
          </GlassCard>
        </div>
      </div>
    </div>
  );

  if (!isOpen) {
    if (!showTriggerButton) {
      return null;
    }
    return renderCollapsedTrigger();
  }

  return renderExpandedPanel();
};

export default AuthOverlay;

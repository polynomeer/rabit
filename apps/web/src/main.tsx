import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { SIGNED_OUT, devSignIn, get, hasToken, setToken } from './api';
import { completeSignIn, oidcEnabled, operatorSignInEnabled, startSignIn } from './auth';
import { EntityDetail, RecordingDetail, ReleaseDetail } from './details';
import { DigHome, DigSessionView, DigStart } from './dig';
import { OpsConsole } from './ops';
import { PlayerProvider } from './player';
import {
  digHref,
  navigate,
  opsHref,
  PRIMARY_TABS,
  SECONDARY_TABS,
  tabHref,
  useRoute,
  type Tab,
} from './route';
import { Archive } from './archive';
import { Icon, RabitSymbol, type IconName } from './brand';
import { Home } from './home';
import { NowPlaying } from './nowplaying';
import { Studio } from './studio';
import { t } from './i18n';
import { Account, Playlists, Search } from './views';
import './styles.css';

const TAB_ICON: Record<Tab, IconName> = {
  Home: 'home',
  Search: 'search',
  DIG: 'dig',
  Archive: 'archive',
  Studio: 'studio',
  Playlists: 'playlists',
  Account: 'account',
};

function TabButton({ tab, current }: { tab: Tab; current: boolean }) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={() => {
        navigate(tabHref(tab));
      }}
    >
      <Icon name={TAB_ICON[tab]} size={20} />
      <span className="tab-label">{tab}</span>
    </button>
  );
}

/** The brand panel beside sign-in (identity board, BRD §2): symbol, wordmark, tagline. */
function SignInShell({ children }: { children: ReactNode }) {
  return (
    <main className="signin">
      <div className="signin-hero">
        <p className="signin-words" aria-hidden="true">
          <span>Music</span>
          <span>People</span>
          <span>Places</span>
          <span>Stories</span>
        </p>
        <h1>
          <RabitSymbol size={120} />
          <span className="wordmark">Rabit</span>
        </h1>
        <p className="signin-tagline">{t('signin.tagline')}</p>
      </div>
      <div className="signin-panel">{children}</div>
    </main>
  );
}

function SignIn({ onDone, error }: { onDone: () => void; error: string | null }) {
  const [err, setErr] = useState<string | null>(error);
  if (oidcEnabled)
    return (
      <SignInShell>
        <h2>{t('signin.heading')}</h2>
        <p className="muted">{t('signin.lede')}</p>
        <button
          type="button"
          className="primary wide"
          onClick={() => {
            startSignIn().catch((x: unknown) => {
              setErr((x as Error).message);
            });
          }}
        >
          {t('signin.submit')}
        </button>
        {operatorSignInEnabled ? (
          <button
            type="button"
            className="link"
            onClick={() => {
              startSignIn('operator').catch((x: unknown) => {
                setErr((x as Error).message);
              });
            }}
          >
            {t('signin.operatorSubmit')}
          </button>
        ) : null}
        {err ? <p className="warn">{t('signin.failed', { reason: err })}</p> : null}
      </SignInShell>
    );
  return (
    <SignInShell>
      <h2>{t('signin.heading')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements;
          const subject = (f.namedItem('subject') as HTMLInputElement).value;
          const operator = (f.namedItem('operator') as HTMLInputElement).checked;
          devSignIn(subject, operator).then(onDone, (x: unknown) => {
            setErr((x as Error).message);
          });
        }}
      >
        <label className="field">
          {t('signin.subject')}
          <input name="subject" required maxLength={64} autoComplete="username" />
        </label>
        <label className="small check">
          <input type="checkbox" name="operator" /> {t('signin.operator')}
        </label>
        <button type="submit" className="wide">
          {t('signin.submit')}
        </button>
        <p className="small muted">{t('signin.devNote')}</p>
        {err ? <p className="warn">{err}</p> : null}
      </form>
    </SignInShell>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(hasToken());
  // Returning from the provider: exchange the code before showing anything.
  const [completing, setCompleting] = useState(
    oidcEnabled && /[?&](code|error)=/.test(location.search),
  );
  const [signInError, setSignInError] = useState<string | null>(null);
  const [operator, setOperator] = useState(false);
  const route = useRoute();
  useEffect(() => {
    if (!completing) return;
    completeSignIn().then(
      (ok) => {
        setSignedIn(ok || hasToken());
        setCompleting(false);
      },
      (x: unknown) => {
        setSignInError((x as Error).message);
        setCompleting(false);
      },
    );
  }, [completing]);
  // An expired or revoked token signs the user out (the API answered 401).
  useEffect(() => {
    const onSignedOut = () => {
      setSignedIn(false);
    };
    window.addEventListener(SIGNED_OUT, onSignedOut);
    return () => {
      window.removeEventListener(SIGNED_OUT, onSignedOut);
    };
  }, []);
  // The console entry is shown to operators only; the server checks the role on every call.
  useEffect(() => {
    if (!signedIn) {
      setOperator(false);
      return;
    }
    void get<{ is_operator: boolean }>('/v1/me').then(
      (me) => {
        setOperator(me.is_operator);
      },
      () => undefined,
    );
  }, [signedIn]);
  if (completing)
    return (
      <SignInShell>
        <p role="status">{t('signin.completing')}</p>
      </SignInShell>
    );
  if (!signedIn)
    return (
      <SignIn
        error={signInError}
        onDone={() => {
          setSignedIn(true);
        }}
      />
    );
  // Detail pages belong to no tab; a DIG session belongs to the DIG tab.
  const tab = route.kind === 'tab' ? route.tab : route.kind === 'dig-session' ? 'DIG' : null;
  return (
    <PlayerProvider>
      <header className="top">
        <h1 className="brand">
          <a href={tabHref('Home')} aria-label={t('nav.home')}>
            <RabitSymbol size={28} />
            <span className="wordmark">Rabit</span>
          </a>
        </h1>
        {/* One menu landmark: the primary list becomes the bottom bar on phones. */}
        <nav aria-label={t('nav.main')} className="menu">
          <ul className="tabs">
            {PRIMARY_TABS.map((entry) => (
              <li key={entry}>
                <TabButton tab={entry} current={tab === entry} />
              </li>
            ))}
          </ul>
          <ul className="tabs-secondary">
            {SECONDARY_TABS.map((entry) => (
              <li key={entry}>
                <TabButton tab={entry} current={tab === entry} />
              </li>
            ))}
            {operator ? (
              <li>
                <button
                  type="button"
                  aria-current={route.kind === 'ops' ? 'page' : undefined}
                  onClick={() => {
                    navigate(opsHref('users'));
                  }}
                >
                  <Icon name="ops" size={20} />
                  <span className="tab-label">Ops</span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
        <button
          type="button"
          className="link logout"
          onClick={() => {
            setToken(null);
            setSignedIn(false);
          }}
        >
          {t('nav.logout')}
        </button>
      </header>
      <main>
        {route.kind === 'recording' ? <RecordingDetail id={route.id} /> : null}
        {route.kind === 'release' ? <ReleaseDetail id={route.id} /> : null}
        {route.kind === 'entity' ? <EntityDetail id={route.id} /> : null}
        {route.kind === 'now' ? <NowPlaying /> : null}
        {tab === 'Home' ? <Home /> : null}
        {tab === 'Studio' ? <Studio /> : null}
        {tab === 'Archive' ? <Archive /> : null}
        {tab === 'Playlists' ? <Playlists /> : null}
        {tab === 'Search' ? (
          <Search
            query={route.kind === 'tab' ? route.query : ''}
            onDig={(id) => {
              navigate(digHref(id));
            }}
          />
        ) : null}
        {route.kind === 'tab' && route.tab === 'DIG' ? (
          route.digStart ? (
            <DigStart entityId={route.digStart} />
          ) : (
            <DigHome />
          )
        ) : null}
        {route.kind === 'dig-session' ? <DigSessionView id={route.id} /> : null}
        {route.kind === 'ops' ? <OpsConsole section={route.section} /> : null}
        {tab === 'Account' ? <Account /> : null}
      </main>
    </PlayerProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

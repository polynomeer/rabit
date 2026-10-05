import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { devSignIn, get, hasToken, setToken } from './api';
import { EntityDetail, RecordingDetail, ReleaseDetail } from './details';
import { DigHome, DigSessionView, DigStart } from './dig';
import { OpsConsole } from './ops';
import { PlayerProvider } from './player';
import { digHref, navigate, opsHref, tabHref, TABS, useRoute } from './route';
import { Archive } from './archive';
import { t } from './i18n';
import { Account, Playlists, Search } from './views';
import './styles.css';

function SignIn({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="signin">
      <h1>Rabit</h1>
      <p className="muted">{t('signin.tagline')}</p>
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
        <label>
          {t('signin.subject')}{' '}
          <input name="subject" required maxLength={64} autoComplete="username" />
        </label>
        <label className="small">
          <input type="checkbox" name="operator" /> {t('signin.operator')}
        </label>
        <button type="submit">{t('signin.submit')}</button>
        <p className="small muted">{t('signin.devNote')}</p>
        {err ? <p className="warn">{err}</p> : null}
      </form>
    </main>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(hasToken());
  const [operator, setOperator] = useState(false);
  const route = useRoute();
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
  if (!signedIn)
    return (
      <SignIn
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
        <span className="logo" aria-hidden="true">
          ◖
        </span>
        <strong>Rabit</strong>
        <nav aria-label={t('nav.main')}>
          {TABS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-current={tab === entry ? 'page' : undefined}
              onClick={() => {
                navigate(tabHref(entry));
              }}
            >
              {entry}
            </button>
          ))}
          {operator ? (
            <button
              type="button"
              aria-current={route.kind === 'ops' ? 'page' : undefined}
              onClick={() => {
                navigate(opsHref('users'));
              }}
            >
              Ops
            </button>
          ) : null}
        </nav>
        <button
          type="button"
          className="link"
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

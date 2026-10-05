import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { devSignIn, hasToken, setToken } from './api';
import { EntityDetail, RecordingDetail, ReleaseDetail } from './details';
import { Dig } from './dig';
import { PlayerProvider } from './player';
import { digHref, navigate, tabHref, TABS, useRoute } from './route';
import { Archive } from './archive';
import { Account, Playlists, Search } from './views';
import './styles.css';

function SignIn({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="signin">
      <h1>Rabit</h1>
      <p className="muted">Music takes you further.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const subject = (e.currentTarget.elements.namedItem('subject') as HTMLInputElement).value;
          devSignIn(subject).then(onDone, (x: unknown) => {
            setErr((x as Error).message);
          });
        }}
      >
        <label>
          개발용 로그인 ID <input name="subject" required maxLength={64} autoComplete="username" />
        </label>
        <button type="submit">로그인</button>
        <p className="small muted">
          로컬 개발용 발급기입니다(ADR-0009). 운영에서는 OIDC 공급자를 사용합니다.
        </p>
        {err ? <p className="warn">{err}</p> : null}
      </form>
    </main>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(hasToken());
  const route = useRoute();
  if (!signedIn)
    return (
      <SignIn
        onDone={() => {
          setSignedIn(true);
        }}
      />
    );
  // Detail pages belong to no tab; the menu keeps the tab the user came from unhighlighted.
  const tab = route.kind === 'tab' ? route.tab : null;
  return (
    <PlayerProvider>
      <header className="top">
        <span className="logo" aria-hidden="true">
          ◖
        </span>
        <strong>Rabit</strong>
        <nav aria-label="주 메뉴">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => {
                navigate(tabHref(t));
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="link"
          onClick={() => {
            setToken(null);
            setSignedIn(false);
          }}
        >
          로그아웃
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
        {tab === 'DIG' && route.kind === 'tab' ? <Dig start={route.digStart} /> : null}
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

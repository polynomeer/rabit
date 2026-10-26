import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RabitSymbol } from '../brand';
import { t } from '../i18n';
import { applyTheme, storedTheme } from '../theme';
import { COPY, pickVariant, type Variant } from './variants';
import {
  FIELD_ERROR,
  SEGMENT_LABEL,
  SEGMENTS,
  SERVICES,
  submitWaitlist,
  validate,
  type Segment,
  type Service,
  type WaitlistField,
} from './waitlist';
import '@fontsource-variable/noto-sans-kr';
import '../styles.css';
import './landing.css';

applyTheme(storedTheme());

// Service names are brand labels, shown as they are (i18n/ko.ts header).
const SERVICE_LABEL: Readonly<Record<Exclude<Service, 'other' | 'none'>, string>> = {
  melon: '멜론',
  youtube_music: 'YouTube Music',
  spotify: 'Spotify',
  genie: '지니',
  flo: 'FLO',
  vibe: 'VIBE',
  apple_music: 'Apple Music',
  bugs: '벅스',
  soundcloud: 'SoundCloud',
};

const serviceLabel = (s: Service) =>
  s === 'other'
    ? t('landing.form.service.other')
    : s === 'none'
      ? t('landing.form.service.none')
      : SERVICE_LABEL[s];

function WaitlistForm({ variant }: { variant: Variant }) {
  const [errors, setErrors] = useState<WaitlistField[]>([]);
  const [notice, setNotice] = useState(false);
  const has = (f: WaitlistField) => errors.includes(f);
  const describe = (f: WaitlistField) => (has(f) ? `waitlist-${f}-error` : undefined);
  const error = (f: WaitlistField) =>
    has(f) ? (
      <p id={`waitlist-${f}-error`} className="warn">
        {t(FIELD_ERROR[f])}
      </p>
    ) : null;

  return (
    <form
      noValidate
      aria-labelledby="waitlist-heading"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const text = (name: string) => data.getAll(name).filter((v) => typeof v === 'string');
        const entry = {
          email: text('email').at(0) ?? '',
          segments: text('segment') as Segment[],
          services: text('service') as Service[],
          adult: data.has('adult'),
          consent: data.has('consent'),
          variant,
        };
        const found = validate(entry);
        setErrors(found);
        setNotice(false);
        if (found.length > 0) return;
        void submitWaitlist(entry).then(() => {
          setNotice(true);
        });
      }}
    >
      <label className="field">
        {t('landing.form.email')}
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={has('email') || undefined}
          aria-describedby={describe('email')}
        />
      </label>
      {error('email')}
      <fieldset aria-describedby={describe('segments')}>
        <legend>{t('landing.form.segments')}</legend>
        {SEGMENTS.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" name="segment" value={s} /> {t(SEGMENT_LABEL[s])}
          </label>
        ))}
      </fieldset>
      {error('segments')}
      <fieldset aria-describedby={describe('services')}>
        <legend>{t('landing.form.services')}</legend>
        <div className="landing-services">
          {SERVICES.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" name="service" value={s} /> {serviceLabel(s)}
            </label>
          ))}
        </div>
      </fieldset>
      {error('services')}
      <label className="check">
        <input type="checkbox" name="adult" aria-describedby={describe('adult')} />{' '}
        {t('landing.form.adult')}
      </label>
      {error('adult')}
      <label className="check">
        <input
          type="checkbox"
          name="consent"
          aria-describedby={['waitlist-consent-detail', describe('consent')]
            .filter(Boolean)
            .join(' ')}
        />{' '}
        {t('landing.form.consent')}
      </label>
      <p id="waitlist-consent-detail" className="small muted">
        {t('landing.form.consentDetail')}
      </p>
      {error('consent')}
      <button type="submit" className="wide">
        {t('landing.form.submit')}
      </button>
      {notice ? (
        <p role="status" className="landing-notice">
          {t('landing.form.notConnected')}
        </p>
      ) : null}
    </form>
  );
}

function Landing({ variant }: { variant: Variant }) {
  const copy = COPY[variant];
  return (
    <>
      <p className="landing-draft" role="note">
        {t('landing.draftBanner')}
      </p>
      <main className="landing" data-variant={variant}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-brand">
            <RabitSymbol size={40} />
            <span className="wordmark">Rabit</span>
          </p>
          <h1 id="landing-title">{t(copy.title)}</h1>
          <p className="landing-lede">{t(copy.lede)}</p>
          <a className="landing-cta" href="#waitlist">
            {t('landing.cta')}
          </a>
        </section>
        <section aria-labelledby="landing-points">
          <h2 id="landing-points">{t('landing.points.heading')}</h2>
          <ul className="landing-points">
            {copy.points.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="landing-principles">
          <h2 id="landing-principles">{t('landing.principles.heading')}</h2>
          <ul className="landing-principles">
            <li>{t('landing.principles.noAds')}</li>
            <li>{t('landing.principles.export')}</li>
            <li>{t('landing.principles.private')}</li>
          </ul>
          <p className="muted">{t('landing.status')}</p>
        </section>
        <section id="waitlist" className="landing-waitlist" aria-labelledby="waitlist-heading">
          <h2 id="waitlist-heading">{t('landing.form.heading')}</h2>
          <p className="muted">{t('landing.form.lede')}</p>
          <WaitlistForm variant={variant} />
        </section>
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Landing variant={pickVariant(location.search)} />
    </StrictMode>,
  );
}

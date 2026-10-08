import { useState } from 'react';
import { Upload } from './archive';
import { t } from './i18n';
import { tabHref } from './route';

/** `#/studio`: private uploads and Audio Log recordings (Create, BRD §7). */
export function Studio() {
  const [added, setAdded] = useState(0);
  return (
    <section className="studio" aria-labelledby="studio-h">
      <h2 id="studio-h">Studio</h2>
      <p className="lede">{t('studio.intro')}</p>
      <Upload
        onDone={() => {
          setAdded((n) => n + 1);
        }}
      />
      <p className="note">{t('studio.rightsNote')}</p>
      {added > 0 ? (
        <p>
          <a href={tabHref('Archive')}>{t('studio.toArchive')}</a>
        </p>
      ) : null}
    </section>
  );
}

import { getUiLocale, setUiLocale, t } from '../i18n/i18n.js';
import './LanguageSwitcher.css';

export default function LanguageSwitcher({ className = '' }) {
  const value = getUiLocale();

  const onChange = (e) => {
    const next = e.target.value;
    if (next === value) return;
    setUiLocale(next);
    window.location.reload();
  };

  return (
    <label className={`lang-switcher ${className}`.trim()}>
      <span className="lang-switcher-label">{t('lang.label')}</span>
      <select className="lang-switcher-select" value={value} onChange={onChange} aria-label={t('lang.label')}>
        <option value="en">{t('lang.en')}</option>
        <option value="he">{t('lang.he')}</option>
      </select>
    </label>
  );
}

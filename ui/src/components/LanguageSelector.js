import { LANGUAGE_OPTIONS } from '../i18n/languageOptions';

function LanguageSelector({ lang, onChange }) {
  return (
    <div className="lang-toggle-group" role="group" aria-label="Language selector">
      {LANGUAGE_OPTIONS.map((option) => (
        <button
          key={option.code}
          type="button"
          className={`lang-toggle ${lang === option.code ? 'active' : ''}`}
          onClick={() => onChange(option.code)}
          aria-label={option.label}
          title={option.label}
          aria-pressed={lang === option.code}
        >
          {option.shortLabel}
        </button>
      ))}
    </div>
  );
}

export default LanguageSelector;

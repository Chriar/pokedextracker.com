import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useRef } from 'react';

import { ImportFromDexesButton } from './ImportFromDexesButton';
import { MarkDuplicatesButton } from './MarkDuplicatesButton';
import { ReactGA } from '../../../utils/analytics';

import type { ChangeEvent, Dispatch, SetStateAction } from 'react';

interface Props {
  hideCaught: boolean;
  hideDuplicateForms: boolean;
  hideDuplicates: boolean;
  query: string;
  setHideCaught: Dispatch<SetStateAction<boolean>>;
  setHideDuplicateForms: Dispatch<SetStateAction<boolean>>;
  setHideDuplicates: Dispatch<SetStateAction<boolean>>;
  setQuery: Dispatch<SetStateAction<string>>;
}

export function SearchBar ({
  hideCaught,
  hideDuplicateForms,
  hideDuplicates,
  query,
  setHideCaught,
  setHideDuplicateForms,
  setHideDuplicates,
  setQuery,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyup = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.tagName.toLowerCase() !== 'input' && e.key === '/') {
        ReactGA.event({ action: 'used shortcut', category: 'Search' });
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keyup', handleKeyup);

    return () => document.removeEventListener('keyup', handleKeyup);
  }, [inputRef.current]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value);
  const handleHideCaughtChange = (e: ChangeEvent<HTMLInputElement>) => setHideCaught(e.target.checked);
  const handleHideDuplicatesChange = (e: ChangeEvent<HTMLInputElement>) => {
    setHideDuplicates(e.target.checked);
    if (!e.target.checked) {
      setHideDuplicateForms(false);
    }
  };
  const handleHideDuplicateFormsChange = (e: ChangeEvent<HTMLInputElement>) => setHideDuplicateForms(e.target.checked);

  const handleClearClick = () => {
    setQuery('');
    inputRef.current && inputRef.current.focus();
  };

  return (
    <div className="dex-search-bar">
      <div className="wrapper">
        <div className="form-group">
          <FontAwesomeIcon icon={faSearch} />
          <input
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="form-control"
            id="search"
            name="search"
            onChange={handleInputChange}
            placeholder="Search by name or # (use / to quick search)"
            ref={inputRef}
            spellCheck="false"
            type="text"
            value={query}
          />
          {query.length > 0 ?
            <a className="clear-btn" onClick={handleClearClick}>
              <FontAwesomeIcon className="input-icon" icon={faTimes} />
            </a> :
            null
          }
        </div>
        <div className="dex-search-bar-filters">
          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  checked={hideCaught}
                  id="hide-caught"
                  name="hide-caught"
                  onChange={handleHideCaughtChange}
                  type="checkbox"
                />
                <span className="checkbox-custom"><span /></span>Hide Caught Pokémon
              </label>
            </div>
          </div>
          <div className="form-group">
            <div className="checkbox">
              <label>
                <input
                  checked={hideDuplicates}
                  id="hide-duplicates"
                  name="hide-duplicates"
                  onChange={handleHideDuplicatesChange}
                  type="checkbox"
                />
                <span className="checkbox-custom"><span /></span>Hide Duplicate Pokémon
              </label>
            </div>
          </div>
          {hideDuplicates ?
            <div className="form-group">
              <div className="checkbox">
                <label>
                  <input
                    checked={hideDuplicateForms}
                    id="hide-duplicate-forms"
                    name="hide-duplicate-forms"
                    onChange={handleHideDuplicateFormsChange}
                    type="checkbox"
                  />
                  <span className="checkbox-custom"><span /></span>Also Hide Duplicate Forms
                </label>
              </div>
            </div> :
            null
          }
          {hideDuplicates ?
            <div className="form-group">
              <MarkDuplicatesButton hideDuplicateForms={hideDuplicateForms} />
            </div> :
            null
          }
          <ImportFromDexesButton />
        </div>
      </div>
    </div>
  );
}

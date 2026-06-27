(() => {
  const STORAGE_KEYS = {
    progress: 'vocab-game-progress-v1',
    customWords: 'vocab-game-custom-words-v1',
    settings: 'vocab-game-settings-v1',
    dictionaryCache: 'vocab-game-dictionary-cache-v2',
    definitionDatabase: 'vocab-game-definition-database-v1'
  };

  const defaultSettings = {
    unit: 'all',
    mode: 'meaningCard',
    targetCorrect: 2,
    includeMastered: false,
    autoSpeak: true
  };

  const state = {
    baseWords: Array.isArray(window.BASE_WORDS) ? window.BASE_WORDS : [],
    customWords: [],
    progress: {},
    settings: { ...defaultSettings },
    currentQuestion: null,
    session: { correct: 0, wrong: 0, answered: 0, streak: 0 },
    dictionaryCache: {},
    definitionDatabase: {},
    reviewWeakOnly: false,
    lastWordId: null,
    run: createEmptyRunState()
  };

  let autoNextTimer = null;
  let runAutoTimer = null;

  function createEmptyRunState() {
    return {
      active: false,
      unit: 'all',
      total: 20,
      index: 0,
      queue: [],
      current: null,
      answered: 0,
      correct: 0,
      wrong: 0,
      learnedIds: new Set(),
      strengthenedIds: new Set(),
      reviewIds: new Set()
    };
  }

  const $ = (id) => document.getElementById(id);

  const els = {
    totalWordsStat: $('totalWordsStat'),
    activeWordsStat: $('activeWordsStat'),
    masteredWordsStat: $('masteredWordsStat'),
    sessionAccuracyStat: $('sessionAccuracyStat'),
    unitSelect: $('unitSelect'),
    modeSelect: $('modeSelect'),
    targetCorrect: $('targetCorrect'),
    includeMastered: $('includeMastered'),
    autoSpeak: $('autoSpeak'),
    poolPercent: $('poolPercent'),
    poolProgress: $('poolProgress'),
    poolSummary: $('poolSummary'),
    resetProgressBtn: $('resetProgressBtn'),
    questionModeBadge: $('questionModeBadge'),
    wordMeta: $('wordMeta'),
    questionArea: $('questionArea'),
    optionsArea: $('optionsArea'),
    feedbackArea: $('feedbackArea'),
    hintBtn: $('hintBtn'),
    speakBtn: $('speakBtn'),
    nextBtn: $('nextBtn'),
    newGameBtn: $('newGameBtn'),
    reviewBtn: $('reviewBtn'),
    sessionCorrect: $('sessionCorrect'),
    sessionWrong: $('sessionWrong'),
    sessionStreak: $('sessionStreak'),
    addWordForm: $('addWordForm'),
    bulkInput: $('bulkInput'),
    importCsvBtn: $('importCsvBtn'),
    exportCustomBtn: $('exportCustomBtn'),
    exportProgressBtn: $('exportProgressBtn'),
    copyWordsBtn: $('copyWordsBtn'),
    searchInput: $('searchInput'),
    scoreUnitFilter: $('scoreUnitFilter'),
    scoreSortSelect: $('scoreSortSelect'),
    scoreTableBody: $('scoreTableBody'),
    toast: $('toast'),
    runUnitSelect: $('runUnitSelect'),
    runLengthSelect: $('runLengthSelect'),
    startRunBtn: $('startRunBtn'),
    runPercent: $('runPercent'),
    runProgress: $('runProgress'),
    runCounter: $('runCounter'),
    runCorrect: $('runCorrect'),
    runWrong: $('runWrong'),
    runLearned: $('runLearned'),
    runLearnedTotal: $('runLearnedTotal'),
    runActiveTotal: $('runActiveTotal'),
    runModeBadge: $('runModeBadge'),
    runWordMeta: $('runWordMeta'),
    runQuestionArea: $('runQuestionArea'),
    runOptionsArea: $('runOptionsArea'),
    runFeedbackArea: $('runFeedbackArea'),
    runHintBtn: $('runHintBtn'),
    runSpeakBtn: $('runSpeakBtn'),
    runNextBtn: $('runNextBtn'),
    runQuitBtn: $('runQuitBtn'),
    runResultsPanel: $('runResultsPanel'),
    runResultsContent: $('runResultsContent'),
    replayRunBtn: $('replayRunBtn'),
    runReviewWeakBtn: $('runReviewWeakBtn')
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`Could not load ${key}`, error);
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeWord(raw, index = 0) {
    const english = String(raw.english || raw.word || '').trim();
    const unitNumber = Number(raw.unit || 99);
    return {
      id: raw.id || `custom-${slugify(english)}-${Date.now()}-${index}`,
      english,
      partOfSpeech: String(raw.partOfSpeech || raw.part || '').trim(),
      phonetics: String(raw.phonetics || raw.phonetic || '').trim(),
      example: String(raw.example || raw.sentence || '').trim(),
      definition: String(raw.definition || '').trim(),
      unit: Number.isFinite(unitNumber) ? unitNumber : 99,
      sourcePage: raw.sourcePage || null,
      source: raw.source || 'Custom'
    };
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'word';
  }

  function allWords() {
    const custom = state.customWords.map(normalizeWord).filter(w => w.english && w.example);
    return [...state.baseWords, ...custom];
  }

  function getProgress(wordId) {
    if (!state.progress[wordId]) {
      state.progress[wordId] = { correct: 0, wrong: 0, streak: 0, lastSeen: 0 };
    }
    return state.progress[wordId];
  }

  function isMastered(word) {
    return getProgress(word.id).correct >= state.settings.targetCorrect;
  }

  function currentUnitWords() {
    const unit = state.settings.unit;
    return allWords().filter(word => unit === 'all' || String(word.unit) === String(unit));
  }

  function playableWords() {
    let words = currentUnitWords();
    if (state.reviewWeakOnly) {
      words = words.filter(word => {
        const p = getProgress(word.id);
        return p.wrong > 0 || (p.correct > 0 && !isMastered(word));
      });
      if (words.length < 4) words = currentUnitWords().filter(word => !isMastered(word));
    }
    if (!state.settings.includeMastered) {
      words = words.filter(word => !isMastered(word));
    }
    return words;
  }

  function chooseWeighted(words) {
    if (!words.length) return null;
    const candidates = words.length > 1 ? words.filter(w => w.id !== state.lastWordId) : words;
    const weighted = [];
    candidates.forEach(word => {
      const p = getProgress(word.id);
      const ageBoost = p.lastSeen ? Math.min(5, (Date.now() - p.lastSeen) / 60000) : 5;
      const weight = Math.max(1, 8 + p.wrong * 2 - p.correct * 2 + ageBoost);
      for (let i = 0; i < Math.round(weight); i += 1) weighted.push(word);
    });
    return weighted[Math.floor(Math.random() * weighted.length)] || candidates[0];
  }

  function sample(array, count, excludeIds = []) {
    const pool = array.filter(item => !excludeIds.includes(item.id));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function normalizeMode(mode) {
    const legacyMap = {
      mixed: 'meaningCard',
      flashcard: 'meaningCard',
      wordMeaning: 'wordMeaning',
      listen: 'typeWord',
      wordExample: 'wordMeaning',
      sentenceMatch: 'wordMeaning',
      gap: 'wordMeaning',
      sentenceGap: 'wordMeaning'
    };
    const normalized = legacyMap[mode] || mode;
    return ['meaningCard', 'typeWord', 'wordMeaning'].includes(normalized) ? normalized : 'meaningCard';
  }

  function pickMode() {
    return normalizeMode(state.settings.mode);
  }

  function nextQuestion() {
    clearTimeout(autoNextTimer);
    clearFeedback();
    const words = playableWords();
    if (!words.length) {
      renderFinishedState();
      renderStats();
      return;
    }

    const word = chooseWeighted(words);
    const mode = pickMode();
    state.lastWordId = word.id;

    if (mode === 'meaningCard' || mode === 'typeWord' || mode === 'sentenceGap') {
      state.currentQuestion = { mode, word, answered: false, revealed: false };
    } else {
      const options = shuffle([word, ...getConfusingOptions(word, 3)]);
      state.currentQuestion = { mode, word, options, answered: false };
    }

    renderQuestion();
    renderStats();
    if (state.settings.autoSpeak) {
      setTimeout(() => speak(word.english), 350);
    }
  }

  function renderQuestion() {
    const q = state.currentQuestion;
    if (!q) return;
    els.feedbackArea.innerHTML = '';
    els.wordMeta.textContent = `Unit ${q.word.unit} · ${q.word.partOfSpeech || 'word'} ${q.word.phonetics || ''}`;
    els.questionModeBadge.textContent = modeLabel(q.mode);
    els.hintBtn.disabled = false;
    els.speakBtn.disabled = false;

    if (q.mode === 'meaningCard') renderMeaningCard(q);
    if (q.mode === 'wordMeaning') renderWordMeaningQuestion(q);
    if (q.mode === 'typeWord') renderTypeWordQuestion(q);
    if (q.mode === 'sentenceGap') renderSentenceGapQuestion(q);
    if (q.mode === 'sentenceMatch') renderSentenceMatchQuestion(q);
  }

  function modeLabel(mode) {
    return {
      meaningCard: 'Smart Meaning Card',
      wordMeaning: 'Word → Choose the meaning',
      typeWord: 'Definition → Type the word',
      sentenceGap: 'Sentence Gap Mode',
      sentenceMatch: 'Sentence Match'
    }[mode] || 'Game';
  }

  function renderMeaningCard(q) {
    els.questionArea.innerHTML = `
      <div class="question-label">Do you know this word?</div>
      <p class="question-text">${escapeHtml(q.word.english)}</p>
      <p class="question-subtext"><span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span> ${escapeHtml(q.word.partOfSpeech || '')}</p>
    `;
    els.optionsArea.innerHTML = `
      <button class="primary-button" id="revealCardBtn">Reveal meaning</button>
      <button class="ghost-button" id="knowCardBtn">I knew it</button>
      <button class="ghost-button" id="dontKnowCardBtn">I didn't know it</button>
    `;
    $('revealCardBtn').addEventListener('click', () => revealMeaningCard());
    $('knowCardBtn').addEventListener('click', () => markMeaningCard(true));
    $('dontKnowCardBtn').addEventListener('click', () => markMeaningCard(false));
  }

  function renderWordMeaningQuestion(q) {
    els.questionArea.innerHTML = `
      <div class="question-label">Choose the meaning</div>
      <p class="question-text">${escapeHtml(q.word.english)}</p>
      <p class="question-subtext"><span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span> ${escapeHtml(q.word.partOfSpeech || '')}</p>
    `;
    els.optionsArea.innerHTML = `<div class="option-loading">Preparing answer choices...</div>`;
    prepareMeaningOptionDefinitions(q, els.optionsArea, () => state.currentQuestion, (selectedId) => answer(selectedId));
  }

  function renderTypeWordQuestion(q) {
    els.questionArea.innerHTML = `
      <div class="question-label">Type the word</div>
      <p class="question-text type-clue-text">${escapeHtml(explanationText(q.word))}</p>
      <p class="question-subtext">Write the English word or phrase. Pronunciation: <span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span></p>
    `;
    els.optionsArea.innerHTML = `
      <form id="typeAnswerForm" class="type-answer-form">
        <input id="typeAnswerInput" autocomplete="off" spellcheck="false" placeholder="Type the word here..." />
        <button class="primary-button" type="submit">Check answer</button>
      </form>
    `;
    $('typeAnswerInput').focus();
    $('typeAnswerForm').addEventListener('submit', answerTypedWord);
  }

  function renderSentenceGapQuestion(q) {
    const gap = makeGapSentence(q.word.example, q.word.english);
    q.gap = gap;
    els.questionArea.innerHTML = `
      <div class="question-label">Complete the sentence</div>
      <p class="question-text type-clue-text">${escapeHtml(gap.text)}</p>
      <p class="question-subtext">Type the missing English word or phrase. Pronunciation: <span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span></p>
    `;
    els.optionsArea.innerHTML = `
      <form id="sentenceGapForm" class="type-answer-form">
        <input id="sentenceGapInput" autocomplete="off" spellcheck="false" placeholder="Type the missing word here..." />
        <button class="primary-button" type="submit">Check answer</button>
      </form>
    `;
    $('sentenceGapInput').focus();
    $('sentenceGapForm').addEventListener('submit', answerSentenceGap);
  }

  function renderSentenceMatchQuestion(q) {
    els.questionArea.innerHTML = `
      <div class="question-label">Choose the suitable sentence</div>
      <p class="question-text">${escapeHtml(q.word.english)}</p>
      <p class="question-subtext"><span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span> ${escapeHtml(q.word.partOfSpeech || '')}</p>
    `;
    els.optionsArea.innerHTML = q.options.map(option => `
      <button class="option-button sentence-option" data-id="${option.id}">${escapeHtml(option.example)}</button>
    `).join('');
    els.optionsArea.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => answer(btn.dataset.id));
    });
  }

  function renderWordOptions(options) {
    els.optionsArea.innerHTML = options.map(option => `
      <button class="option-button" data-id="${option.id}">${escapeHtml(option.english)}</button>
    `).join('');
    els.optionsArea.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => answer(btn.dataset.id));
    });
  }

  async function revealMeaningCard() {
    const q = state.currentQuestion;
    if (!q || q.mode !== 'meaningCard') return;
    q.revealed = true;
    const wordId = q.word.id;
    els.feedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary meaning</strong>
        <p class="example-reveal muted">Preparing the English definition...</p>
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(explanationText(q.word))}</p>
        <p class="example-reveal"><strong>Example:</strong> ${escapeHtml(q.word.example)}</p>
      </div>
    `;
    $('revealCardBtn').disabled = true;

    const dictionaryEntry = await getDictionaryEntry(q.word);
    if (!state.currentQuestion || state.currentQuestion.word.id !== wordId) return;
    els.feedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary meaning</strong>
        ${dictionaryDefinitionHtml(dictionaryEntry, q.word)}
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(explanationText(q.word))}</p>
        <p class="example-reveal"><strong>Example:</strong> ${escapeHtml(q.word.example)}</p>
      </div>
    `;
  }

  function markMeaningCard(knewIt) {
    const q = state.currentQuestion;
    if (!q || q.answered) return;
    q.answered = true;
    recordAnswer(q.word, knewIt);
    renderFeedback(knewIt, q.word, q.word.id);
    disableOptions();
    if (knewIt) scheduleNextQuestion(1000);
  }

  function scheduleNextQuestion(delay = 750) {
    clearTimeout(autoNextTimer);
    autoNextTimer = setTimeout(() => {
      if (state.currentQuestion?.answered) {
        state.reviewWeakOnly = false;
        nextQuestion();
      }
    }, delay);
  }

  function answerTypedWord(event) {
    event.preventDefault();
    const q = state.currentQuestion;
    if (!q || q.answered || q.mode !== 'typeWord') return;
    const input = $('typeAnswerInput');
    const typed = input.value.trim();
    if (!typed) {
      toast('Please type an answer first.');
      return;
    }
    q.answered = true;
    const correct = isAcceptedTypedAnswer(typed, q.word);
    recordAnswer(q.word, correct);
    input.disabled = true;
    input.classList.add(correct ? 'correct-input' : 'wrong-input');
    $('typeAnswerForm').querySelector('button').disabled = true;
    renderFeedback(correct, q.word, q.word.id);
    if (correct) scheduleNextQuestion(1000);
  }

  function answerSentenceGap(event) {
    event.preventDefault();
    const q = state.currentQuestion;
    if (!q || q.answered || q.mode !== 'sentenceGap') return;
    const input = $('sentenceGapInput');
    const typed = input.value.trim();
    if (!typed) {
      toast('Please type an answer first.');
      return;
    }
    q.answered = true;
    const correct = isAcceptedTypedAnswer(typed, q.word);
    recordAnswer(q.word, correct);
    input.disabled = true;
    input.classList.add(correct ? 'correct-input' : 'wrong-input');
    $('sentenceGapForm').querySelector('button').disabled = true;
    renderFeedback(correct, q.word, q.word.id);
    if (correct) scheduleNextQuestion(1000);
  }

  function answer(selectedId) {
    const q = state.currentQuestion;
    if (!q || q.answered) return;
    q.answered = true;
    const correct = selectedId === q.word.id;
    recordAnswer(q.word, correct);
    markOptionButtons(selectedId, q.word.id);
    renderFeedback(correct, q.word, selectedId);
    renderStats();
    if (correct) scheduleNextQuestion(1000);
  }

  function recordAnswer(word, correct) {
    const p = getProgress(word.id);
    p.lastSeen = Date.now();
    state.session.answered += 1;
    if (correct) {
      p.correct += 1;
      p.streak += 1;
      state.session.correct += 1;
      state.session.streak += 1;
    } else {
      p.wrong += 1;
      p.streak = 0;
      state.session.wrong += 1;
      state.session.streak = 0;
    }
    saveJson(STORAGE_KEYS.progress, state.progress);
    renderStats();
  }

  function markOptionButtons(selectedId, correctId) {
    els.optionsArea.querySelectorAll('button').forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.id === correctId) btn.classList.add('correct');
      if (btn.dataset.id === selectedId && selectedId !== correctId) btn.classList.add('wrong');
    });
  }

  function disableOptions() {
    els.optionsArea.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
  }

  function renderFeedback(correct, word) {
    const p = getProgress(word.id);
    const masteredNow = isMastered(word);
    els.feedbackArea.innerHTML = `
      <div class="feedback-box ${correct ? 'success' : 'danger'}">
        <strong>${correct ? 'Correct!' : 'Not yet.'} ${masteredNow ? 'Mastered 🎉' : ''}</strong>
        <div>${escapeHtml(word.english)} ${word.phonetics ? `<span class="muted">${escapeHtml(word.phonetics)}</span>` : ''}</div>
        <p class="example-reveal">${escapeHtml(word.example)}</p>
        ${word.definition ? `<p class="example-reveal"><strong>Definition:</strong> ${escapeHtml(word.definition)}</p>` : ''}
        <p class="muted">Progress: ${p.correct}/${state.settings.targetCorrect} correct · ${p.wrong} wrong</p>
      </div>
    `;
  }

  function clearFeedback() {
    els.feedbackArea.innerHTML = '';
  }

  function explanationText(word) {
    const definition = String(word.definition || '').trim();
    if (definition) return definition;
    const gap = makeGapSentence(word.example, word.english);
    if (gap.found) return `Used in context: “${gap.text}”`;
    const type = word.partOfSpeech ? `${word.partOfSpeech} ` : '';
    return `A ${type}word or phrase from Unit ${word.unit}. Example context: “${hideWordInText(word.example, word.english)}”`;
  }

  async function getDictionaryEntry(word) {
    const cacheKey = dictionaryCacheKey(word);
    const cached = state.dictionaryCache[cacheKey];
    if (cached && !cached.unavailable && cached.source === 'api') return cached;

    const saved = state.definitionDatabase[word.id];
    if (saved && saved.source === 'local' && saved.apiTried) return saved;

    const apiEntry = await fetchDictionaryApiEntry(word);
    if (apiEntry) {
      storeDictionaryEntry(word, apiEntry);
      return apiEntry;
    }

    const localEntry = getLocalDefinitionEntry(word);
    if (localEntry) {
      localEntry.apiTried = true;
      state.definitionDatabase[word.id] = localEntry;
      saveJson(STORAGE_KEYS.definitionDatabase, state.definitionDatabase);
      return localEntry;
    }
    return { unavailable: true };
  }

  async function fetchDictionaryApiEntry(word) {
    const lookupTerms = buildDictionaryLookupTerms(word.english);
    for (const term of lookupTerms) {
      try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
        if (!response.ok) continue;
        const data = await response.json();
        const entry = extractDictionaryEntry(data, word.partOfSpeech, term);
        if (entry) return { ...entry, source: 'api' };
      } catch (error) {
        console.warn('Dictionary lookup failed', error);
        break;
      }
    }
    return null;
  }

  function storeDictionaryEntry(word, entry) {
    const cacheKey = dictionaryCacheKey(word);
    state.dictionaryCache[cacheKey] = entry;
    state.definitionDatabase[word.id] = entry;
    saveJson(STORAGE_KEYS.dictionaryCache, state.dictionaryCache);
    saveJson(STORAGE_KEYS.definitionDatabase, state.definitionDatabase);
  }

  function dictionaryCacheKey(word) {
    return slugify(`${word.english}-${word.partOfSpeech || ''}`);
  }

  function getLocalDefinitionEntry(word) {
    const saved = state.definitionDatabase[word.id];
    if (saved && !saved.unavailable) return saved;

    const localDefinition = String(word.definition || '').trim();
    if (!localDefinition) return null;

    const localEntry = {
      term: word.english,
      partOfSpeech: expandedPartOfSpeech(word.partOfSpeech) || word.partOfSpeech || '',
      definitions: [localDefinition],
      example: word.example || '',
      source: 'local',
      apiTried: false
    };
    state.definitionDatabase[word.id] = localEntry;
    saveJson(STORAGE_KEYS.definitionDatabase, state.definitionDatabase);
    return localEntry;
  }

  function seedLocalDefinitionDatabase() {
    let changed = false;
    allWords().forEach(word => {
      if (state.definitionDatabase[word.id]) return;
      const localDefinition = String(word.definition || '').trim();
      if (!localDefinition) return;
      state.definitionDatabase[word.id] = {
        term: word.english,
        partOfSpeech: expandedPartOfSpeech(word.partOfSpeech) || word.partOfSpeech || '',
        definitions: [localDefinition],
        example: word.example || '',
        source: 'local',
        apiTried: false
      };
      changed = true;
    });
    if (changed) saveJson(STORAGE_KEYS.definitionDatabase, state.definitionDatabase);
  }

  function startDictionaryDatabaseWarmup() {
    const queue = allWords().filter(word => {
      const cached = state.dictionaryCache[dictionaryCacheKey(word)];
      const saved = state.definitionDatabase[word.id];
      return !(cached && cached.source === 'api') && !(saved && saved.source === 'local' && saved.apiTried);
    });
    let index = 0;
    const tick = async () => {
      if (index >= queue.length) return;
      if (document.hidden) {
        setTimeout(tick, 2500);
        return;
      }
      const word = queue[index];
      index += 1;
      const existing = state.dictionaryCache[dictionaryCacheKey(word)];
      if (!existing || existing.source !== 'api') {
        const apiEntry = await fetchDictionaryApiEntry(word);
        if (apiEntry) {
          storeDictionaryEntry(word, apiEntry);
        } else {
          const localEntry = getLocalDefinitionEntry(word);
          if (localEntry) {
            localEntry.apiTried = true;
            state.definitionDatabase[word.id] = localEntry;
            saveJson(STORAGE_KEYS.definitionDatabase, state.definitionDatabase);
          }
        }
      }
      setTimeout(tick, 1200);
    };
    setTimeout(tick, 2500);
  }

  function buildDictionaryLookupTerms(text) {
    const raw = String(text || '').trim().toLowerCase();
    const withoutParentheses = raw.replace(/\s*\([^)]*\)/g, '').trim();
    const parenthetical = Array.from(raw.matchAll(/\(([^)]+)\)/g)).map(match => match[1].trim());
    const slashParts = raw.split('/').map(item => item.trim());
    const phraseWithoutSomeone = raw
      .replace(/\bsomeone\b/g, '')
      .replace(/\bsomebody\b/g, '')
      .replace(/\byour\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return [raw, withoutParentheses, ...parenthetical, ...slashParts, phraseWithoutSomeone]
      .map(term => term.replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((term, index, array) => array.indexOf(term) === index);
  }

  function extractDictionaryEntry(data, partOfSpeech, lookupTerm) {
    if (!Array.isArray(data)) return null;
    const targetPart = expandedPartOfSpeech(partOfSpeech);
    for (const item of data) {
      const meanings = Array.isArray(item.meanings) ? item.meanings : [];
      const preferred = meanings.find(meaning => targetPart && meaning.partOfSpeech === targetPart) || meanings[0];
      if (!preferred || !Array.isArray(preferred.definitions)) continue;
      const definitions = preferred.definitions
        .map(definition => String(definition.definition || '').trim())
        .filter(Boolean)
        .slice(0, 2);
      if (!definitions.length) continue;
      const example = preferred.definitions
        .map(definition => String(definition.example || '').trim())
        .find(Boolean);
      return {
        term: item.word || lookupTerm,
        partOfSpeech: preferred.partOfSpeech || targetPart || '',
        definitions,
        example: example || ''
      };
    }
    return null;
  }

  function expandedPartOfSpeech(partOfSpeech) {
    const part = String(partOfSpeech || '').toLowerCase().trim();
    if (part.includes('phr v')) return 'verb';
    if (part.includes('phrase') || part === 'phr') return '';
    if (part.includes('n')) return 'noun';
    if (part.includes('v')) return 'verb';
    if (part.includes('adj')) return 'adjective';
    if (part.includes('adv')) return 'adverb';
    if (part.includes('prep')) return 'preposition';
    if (part.includes('conj')) return 'conjunction';
    if (part.includes('pron')) return 'pronoun';
    return '';
  }

  function dictionaryDefinitionHtml(entry, word, options = {}) {
    const hideTerm = Boolean(options.hideTerm);
    const hideExample = Boolean(options.hideExample);
    const sanitizeTarget = Boolean(options.sanitizeTarget);
    const cleanText = text => sanitizeTarget ? maskTargetWord(text, word.english) : String(text || '');

    if (!entry || entry.unavailable) {
      return `
        <p class="example-reveal"><strong>Dictionary definition:</strong> Not available for this exact word or phrase right now.</p>
        <p class="example-reveal"><strong>Study clue:</strong> ${escapeHtml(cleanText(explanationText(word)))}</p>
      `;
    }

    const definitions = entry.definitions.map(definition => `<li>${escapeHtml(cleanText(definition))}</li>`).join('');
    const termLine = hideTerm
      ? `<p class="example-reveal"><strong>Definition</strong>${entry.partOfSpeech ? ` <span class="muted">${escapeHtml(entry.partOfSpeech)}</span>` : ''}</p>`
      : `<p class="example-reveal"><strong>${escapeHtml(entry.term)}</strong>${entry.partOfSpeech ? ` <span class="muted">${escapeHtml(entry.partOfSpeech)}</span>` : ''}</p>`;
    const exampleLine = !hideExample && entry.example
      ? `<p class="example-reveal"><strong>Dictionary example:</strong> ${escapeHtml(cleanText(entry.example))}</p>`
      : '';

    return `
      <div class="dictionary-definition">
        ${termLine}
        <ol class="dictionary-definition-list">${definitions}</ol>
        ${exampleLine}
      </div>
    `;
  }

  function storedDefinitionEntry(word) {
    const cached = state.dictionaryCache[dictionaryCacheKey(word)];
    if (cached && !cached.unavailable) return cached;
    const saved = state.definitionDatabase[word.id];
    if (saved && !saved.unavailable) return saved;
    return getLocalDefinitionEntry(word);
  }

  function meaningChoiceText(word, entry = storedDefinitionEntry(word)) {
    const definitions = entry && Array.isArray(entry.definitions)
      ? entry.definitions.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    if (definitions.length) return definitions.slice(0, 2).join(' ');
    const localDefinition = String(word.definition || '').trim();
    if (localDefinition) return localDefinition;
    return 'Meaning is not available yet.';
  }

  async function prepareMeaningOptionDefinitions(question, container, currentQuestionGetter, onSelect) {
    const options = Array.isArray(question.options) ? question.options : [];
    const entries = {};

    await Promise.all(options.map(async option => {
      entries[option.id] = await getDictionaryEntry(option);
    }));

    if (currentQuestionGetter() !== question || question.answered) return;

    container.innerHTML = options.map(option => `
      <button class="option-button explanation-option" data-id="${option.id}">${escapeHtml(meaningChoiceText(option, entries[option.id]))}</button>
    `).join('');

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => onSelect(btn.dataset.id));
    });
  }

  function getConfusingOptions(word, count) {
    const all = allWords().filter(candidate => candidate.id !== word.id);
    const sameType = candidate => String(candidate.partOfSpeech || '').trim() === String(word.partOfSpeech || '').trim();
    const sameUnit = candidate => String(candidate.unit) === String(word.unit);
    const groups = [
      all.filter(candidate => sameUnit(candidate) && sameType(candidate)),
      all.filter(candidate => sameType(candidate)),
      all.filter(candidate => sameUnit(candidate)),
      all
    ];
    const picked = [];
    const seen = new Set([word.id]);
    groups.forEach(group => {
      shuffle(group).forEach(candidate => {
        if (picked.length < count && !seen.has(candidate.id)) {
          picked.push(candidate);
          seen.add(candidate.id);
        }
      });
    });
    return picked;
  }

  function isAcceptedTypedAnswer(typed, word) {
    const answer = normalizeTypedText(typed);
    const accepted = buildSearchTerms(word.english)
      .concat(String(word.english || '').split('/'))
      .map(normalizeTypedText)
      .filter(Boolean);
    return accepted.some(item => item === answer);
  }

  function normalizeTypedText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function hideWordInText(example, word) {
    const terms = buildSearchTerms(word).filter(Boolean).sort((a, b) => b.length - a.length);
    let output = String(example || '');
    terms.forEach(term => {
      const regex = new RegExp(escapeRegExp(term).replace(/\s+/g, '\\s+'), 'ig');
      output = output.replace(regex, '______');
    });
    return output;
  }

  function maskTargetWord(text, word) {
    return hideWordInText(String(text || ''), word);
  }

  async function showHint() {
    const q = state.currentQuestion;
    if (!q) return;
    const word = q.word;
    const wordId = word.id;
    const hint = `${explanationText(word)} · Part of speech: ${word.partOfSpeech || 'word'} · Unit ${word.unit}`;
    els.feedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary hint</strong>
        <p class="example-reveal muted">Preparing the English definition...</p>
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(maskTargetWord(hint, word.english))}</p>
      </div>
    `;

    const dictionaryEntry = await getDictionaryEntry(word);
    if (!state.currentQuestion || state.currentQuestion.word.id !== wordId) return;
    els.feedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary hint</strong>
        ${dictionaryDefinitionHtml(dictionaryEntry, word, { hideTerm: true, hideExample: true, sanitizeTarget: true })}
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(maskTargetWord(hint, word.english))}</p>
      </div>
    `;
  }

  function renderFinishedState() {
    els.questionModeBadge.textContent = 'Finished';
    els.wordMeta.textContent = 'All active words are mastered';
    els.questionArea.innerHTML = `
      <div class="question-label">Great job</div>
      <p class="question-text">All selected words are mastered.</p>
      <p class="question-subtext">Change the unit, raise the target, or include mastered words to continue.</p>
    `;
    els.optionsArea.innerHTML = '';
    els.feedbackArea.innerHTML = '';
  }

  function makeGapSentence(example, word) {
    const terms = buildSearchTerms(word).filter(Boolean);
    for (const term of terms) {
      const regex = new RegExp(escapeRegExp(term).replace(/\s+/g, '\\s+'), 'i');
      if (regex.test(example)) {
        return { text: example.replace(regex, '______'), found: true };
      }
    }
    return { text: `Unit ${state.currentQuestion?.word?.unit || ''} · ${state.currentQuestion?.word?.partOfSpeech || ''} · ${state.currentQuestion?.word?.phonetics || ''}`, found: false };
  }

  function buildSearchTerms(word) {
    const base = String(word);
    return [
      base,
      base.replace(/\((.*?)\)/g, '$1'),
      base.replace(/\s*\([^)]*\)/g, ''),
      base.replace(/someone/g, 'me'),
      base.replace(/your/g, 'my'),
      base.split(' (')[0]
    ].map(t => t.replace(/\s+/g, ' ').trim());
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      toast('This browser does not support speech synthesis.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  function renderStats() {
    const words = currentUnitWords();
    const target = state.settings.targetCorrect;
    const mastered = words.filter(isMastered).length;
    const active = state.settings.includeMastered ? words.length : words.length - mastered;
    const completedSteps = words.reduce((sum, word) => {
      const p = getProgress(word.id);
      return sum + Math.min(p.correct, target);
    }, 0);
    const totalSteps = words.length * target;
    const percent = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;
    const accuracy = state.session.answered ? Math.round((state.session.correct / state.session.answered) * 100) : 0;

    els.totalWordsStat.textContent = allWords().length;
    els.activeWordsStat.textContent = Math.max(0, active);
    els.masteredWordsStat.textContent = mastered;
    els.sessionAccuracyStat.textContent = `${accuracy}%`;
    els.poolPercent.textContent = `${percent}%`;
    els.poolProgress.style.width = `${percent}%`;
    els.poolSummary.textContent = `${completedSteps}/${totalSteps} correct-answer steps completed. ${mastered}/${words.length} words mastered. Target: ${target} correct.`;
    els.sessionCorrect.textContent = state.session.correct;
    els.sessionWrong.textContent = state.session.wrong;
    els.sessionStreak.textContent = state.session.streak;
    renderRunProgress();
    renderScoreTable();
  }

  function renderScoreTable() {
    const query = els.searchInput.value.trim().toLowerCase();
    const selectedUnit = els.scoreUnitFilter?.value || 'all';
    const sortMode = els.scoreSortSelect?.value || 'wrongDesc';
    const rows = allWords()
      .filter(word => selectedUnit === 'all' || String(word.unit) === String(selectedUnit))
      .filter(word => !query || word.english.toLowerCase().includes(query) || word.example.toLowerCase().includes(query))
      .sort((a, b) => sortScoreRows(a, b, sortMode))
      .slice(0, 350);

    els.scoreTableBody.innerHTML = rows.map(word => {
      const p = getProgress(word.id);
      const status = isMastered(word) ? 'mastered' : (p.correct || p.wrong ? 'learning' : 'new');
      const statusText = status === 'mastered' ? 'Mastered' : status === 'learning' ? 'Learning' : 'New';
      return `
        <tr>
          <td><strong>${escapeHtml(word.english)}</strong><br><span class="muted">${escapeHtml(word.example.slice(0, 100))}${word.example.length > 100 ? '…' : ''}</span></td>
          <td>${word.unit}</td>
          <td>${escapeHtml(word.partOfSpeech || '')}</td>
          <td>${p.correct}</td>
          <td>${p.wrong}</td>
          <td><span class="status-pill ${status}">${statusText}</span></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6">No results.</td></tr>';
    updateSortHeaderState();
  }

  function sortScoreRows(a, b, sortMode) {
    const pa = getProgress(a.id);
    const pb = getProgress(b.id);
    const alphabetical = a.english.localeCompare(b.english);
    const typeCompare = String(a.partOfSpeech || '').localeCompare(String(b.partOfSpeech || '')) || alphabetical;
    const statusCompare = statusRank(a) - statusRank(b) || alphabetical;
    if (sortMode === 'wrongAsc') return (pa.wrong - pb.wrong) || (pb.correct - pa.correct) || alphabetical;
    if (sortMode === 'correctDesc') return (pb.correct - pa.correct) || (pb.wrong - pa.wrong) || alphabetical;
    if (sortMode === 'correctAsc') return (pa.correct - pb.correct) || (pb.wrong - pa.wrong) || alphabetical;
    if (sortMode === 'unitAsc') return (a.unit - b.unit) || alphabetical;
    if (sortMode === 'unitDesc') return (b.unit - a.unit) || alphabetical;
    if (sortMode === 'typeAsc') return typeCompare;
    if (sortMode === 'typeDesc') return -typeCompare;
    if (sortMode === 'statusAsc') return statusCompare;
    if (sortMode === 'statusDesc') return -statusCompare;
    if (sortMode === 'az') return alphabetical;
    if (sortMode === 'za') return -alphabetical;
    return (pb.wrong - pa.wrong) || (pa.correct - pb.correct) || alphabetical;
  }

  function statusRank(word) {
    const p = getProgress(word.id);
    if (isMastered(word)) return 2;
    if (p.correct || p.wrong) return 1;
    return 0;
  }

  function nextHeaderSort(key, currentSort) {
    const next = {
      word: currentSort === 'az' ? 'za' : 'az',
      unit: currentSort === 'unitAsc' ? 'unitDesc' : 'unitAsc',
      type: currentSort === 'typeAsc' ? 'typeDesc' : 'typeAsc',
      correct: currentSort === 'correctDesc' ? 'correctAsc' : 'correctDesc',
      wrong: currentSort === 'wrongDesc' ? 'wrongAsc' : 'wrongDesc',
      status: currentSort === 'statusDesc' ? 'statusAsc' : 'statusDesc'
    };
    return next[key] || currentSort;
  }

  function updateSortHeaderState() {
    const currentSort = els.scoreSortSelect?.value || 'wrongDesc';
    const activeMap = {
      az: 'word', za: 'word',
      unitAsc: 'unit', unitDesc: 'unit',
      typeAsc: 'type', typeDesc: 'type',
      correctDesc: 'correct', correctAsc: 'correct',
      wrongDesc: 'wrong', wrongAsc: 'wrong',
      statusDesc: 'status', statusAsc: 'status'
    };
    document.querySelectorAll('[data-score-sort]').forEach(button => {
      const active = button.dataset.scoreSort === activeMap[currentSort];
      button.classList.toggle('active', active);
      button.setAttribute('aria-sort', active ? (currentSort.endsWith('Asc') || currentSort === 'az' ? 'ascending' : 'descending') : 'none');
    });
  }

  function setupUnitSelect() {
    const units = [...new Set(allWords().map(w => w.unit))].sort((a, b) => a - b);
    const unitOptions = '<option value="all">All units</option>' + units.map(unit => `<option value="${unit}">Unit ${unit}</option>`).join('');
    els.unitSelect.innerHTML = unitOptions;
    if (els.scoreUnitFilter) {
      const previous = els.scoreUnitFilter.value || 'all';
      els.scoreUnitFilter.innerHTML = unitOptions;
      els.scoreUnitFilter.value = [...els.scoreUnitFilter.options].some(option => option.value === previous) ? previous : 'all';
    }
    if (els.runUnitSelect) {
      const previousRunUnit = els.runUnitSelect.value || state.settings.unit || 'all';
      els.runUnitSelect.innerHTML = unitOptions;
      els.runUnitSelect.value = [...els.runUnitSelect.options].some(option => option.value === previousRunUnit) ? previousRunUnit : 'all';
    }
  }


  function runPoolWords(unit = 'all') {
    const words = allWords().filter(word => unit === 'all' || String(word.unit) === String(unit));
    const active = words.filter(word => !isMastered(word));
    return active.length ? active : words;
  }

  function buildRunQueue(words, total) {
    const queue = [];
    let pool = shuffle(words);
    while (queue.length < total && words.length) {
      if (!pool.length) pool = shuffle(words);
      queue.push(pool.shift());
    }
    return queue;
  }

  function pickRunMode() {
    const modes = ['meaningCard', 'typeWord', 'wordMeaning'];
    return modes[Math.floor(Math.random() * modes.length)];
  }

  function startRun() {
    clearTimeout(runAutoTimer);
    const unit = els.runUnitSelect?.value || state.settings.unit || 'all';
    const pool = runPoolWords(unit);
    if (!pool.length) {
      toast('No words are available for this run.');
      return;
    }
    const selectedLength = Number(els.runLengthSelect?.value || 20);
    const total = Math.min(selectedLength, pool.length);
    state.run = createEmptyRunState();
    state.run.active = true;
    state.run.unit = unit;
    state.run.total = total;
    state.run.queue = buildRunQueue(pool, total);
    if (els.runResultsPanel) els.runResultsPanel.classList.add('hidden');
    renderRunProgress();
    nextRunQuestion();
    showPage('run');
  }

  function nextRunQuestion() {
    clearTimeout(runAutoTimer);
    const run = state.run;
    if (!run.active) {
      renderRunIdle();
      return;
    }
    if (run.index >= run.total) {
      finishRun();
      return;
    }
    const word = run.queue[run.index];
    const mode = pickRunMode();
    run.current = {
      mode,
      word,
      answered: false,
      revealed: false,
      beforeCorrect: getProgress(word.id).correct,
      beforeMastered: isMastered(word)
    };
    renderRunQuestion();
    renderRunProgress();
    if (state.settings.autoSpeak) {
      setTimeout(() => speak(word.english), 250);
    }
  }

  function renderRunIdle() {
    if (!els.runQuestionArea) return;
    els.runModeBadge.textContent = 'Unit Run';
    els.runWordMeta.textContent = 'Choose a run to begin';
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Ready</div>
      <p class="question-text">Start a Unit Run</p>
      <p class="question-subtext">Pick one unit or all units. You will play a quick challenge and get a clear result screen at the end.</p>
    `;
    els.runOptionsArea.innerHTML = '';
    els.runFeedbackArea.innerHTML = '';
    renderRunProgress();
  }

  function renderRunQuestion() {
    const q = state.run.current;
    if (!q) return;
    els.runFeedbackArea.innerHTML = '';
    els.runModeBadge.textContent = modeLabel(q.mode);
    els.runWordMeta.textContent = `Word ${state.run.index + 1}/${state.run.total} · Unit ${q.word.unit} · ${q.word.partOfSpeech || 'word'} ${q.word.phonetics || ''}`;
    if (q.mode === 'meaningCard') renderRunMeaningCard(q);
    if (q.mode === 'typeWord') renderRunTypeWord(q);
    if (q.mode === 'wordMeaning') renderRunWordMeaning(q);
    if (q.mode === 'sentenceGap') renderRunSentenceGap(q);
  }

  function renderRunMeaningCard(q) {
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Do you know this word?</div>
      <p class="question-text">${escapeHtml(q.word.english)}</p>
      <p class="question-subtext"><span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span> ${escapeHtml(q.word.partOfSpeech || '')}</p>
    `;
    els.runOptionsArea.innerHTML = `
      <button class="ghost-button" id="runRevealBtn">Reveal meaning</button>
      <button class="primary-button" id="runKnowBtn">I knew it</button>
      <button class="ghost-button" id="runDontKnowBtn">I didn't know it</button>
    `;
    $('runRevealBtn').addEventListener('click', () => revealRunMeaning());
    $('runKnowBtn').addEventListener('click', () => answerRunCurrent(true));
    $('runDontKnowBtn').addEventListener('click', () => answerRunCurrent(false));
  }

  function renderRunWordMeaning(q) {
    const options = shuffle([q.word, ...getConfusingOptions(q.word, 3)]);
    q.options = options;
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Choose the meaning</div>
      <p class="question-text">${escapeHtml(q.word.english)}</p>
      <p class="question-subtext"><span class="phonetic">${escapeHtml(q.word.phonetics || '')}</span> ${escapeHtml(q.word.partOfSpeech || '')}</p>
    `;
    els.runOptionsArea.innerHTML = `<div class="option-loading">Preparing answer choices...</div>`;
    prepareMeaningOptionDefinitions(q, els.runOptionsArea, () => state.run.current, (selectedId) => {
      if (q.answered) return;
      const correct = selectedId === q.word.id;
      markRunOptionButtons(selectedId, q.word.id);
      answerRunCurrent(correct);
    });
  }

  function markRunOptionButtons(selectedId, correctId) {
    els.runOptionsArea.querySelectorAll('button').forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.id === correctId) btn.classList.add('correct');
      if (btn.dataset.id === selectedId && selectedId !== correctId) btn.classList.add('wrong');
    });
  }

  function renderRunTypeWord(q) {
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Definition → Type the word</div>
      <p class="question-text type-clue-text">${escapeHtml(explanationText(q.word))}</p>
      <p class="question-subtext">Write the English word or phrase.</p>
    `;
    els.runOptionsArea.innerHTML = `
      <form id="runTypeForm" class="type-answer-form">
        <input id="runTypeInput" autocomplete="off" spellcheck="false" placeholder="Type the word here..." />
        <button class="primary-button" type="submit">Submit</button>
      </form>
    `;
    $('runTypeInput').focus();
    $('runTypeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('runTypeInput');
      const typed = input.value.trim();
      if (!typed) {
        toast('Please type an answer first.');
        return;
      }
      const correct = isAcceptedTypedAnswer(typed, q.word);
      input.disabled = true;
      input.classList.add(correct ? 'correct-input' : 'wrong-input');
      $('runTypeForm').querySelector('button').disabled = true;
      answerRunCurrent(correct);
    });
  }

  function renderRunSentenceGap(q) {
    const gap = makeGapSentence(q.word.example, q.word.english);
    q.gap = gap;
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Sentence Gap Mode</div>
      <p class="question-text type-clue-text">${escapeHtml(gap.text)}</p>
      <p class="question-subtext">Type the missing English word or phrase.</p>
    `;
    els.runOptionsArea.innerHTML = `
      <form id="runGapForm" class="type-answer-form">
        <input id="runGapInput" autocomplete="off" spellcheck="false" placeholder="Type the missing word here..." />
        <button class="primary-button" type="submit">Submit</button>
      </form>
    `;
    $('runGapInput').focus();
    $('runGapForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('runGapInput');
      const typed = input.value.trim();
      if (!typed) {
        toast('Please type an answer first.');
        return;
      }
      const correct = isAcceptedTypedAnswer(typed, q.word);
      input.disabled = true;
      input.classList.add(correct ? 'correct-input' : 'wrong-input');
      $('runGapForm').querySelector('button').disabled = true;
      answerRunCurrent(correct);
    });
  }

  async function revealRunMeaning() {
    const q = state.run.current;
    if (!q || q.answered) return;
    q.revealed = true;
    const wordId = q.word.id;
    els.runFeedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary meaning</strong>
        <p class="example-reveal muted">Preparing the English definition...</p>
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(explanationText(q.word))}</p>
        <p class="example-reveal"><strong>Example:</strong> ${escapeHtml(q.word.example)}</p>
      </div>
    `;
    const button = $('runRevealBtn');
    if (button) button.disabled = true;
    const dictionaryEntry = await getDictionaryEntry(q.word);
    if (!state.run.current || state.run.current.word.id !== wordId) return;
    els.runFeedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Dictionary meaning</strong>
        ${dictionaryDefinitionHtml(dictionaryEntry, q.word)}
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(explanationText(q.word))}</p>
        <p class="example-reveal"><strong>Example:</strong> ${escapeHtml(q.word.example)}</p>
      </div>
    `;
  }

  function answerRunCurrent(correct) {
    const q = state.run.current;
    if (!q || q.answered) return;
    q.answered = true;
    const word = q.word;
    const beforeMastered = q.beforeMastered;
    recordAnswer(word, correct);
    state.run.answered += 1;
    if (correct) {
      state.run.correct += 1;
      if (!beforeMastered && isMastered(word)) {
        state.run.learnedIds.add(word.id);
      } else {
        state.run.strengthenedIds.add(word.id);
      }
    } else {
      state.run.wrong += 1;
      state.run.reviewIds.add(word.id);
    }
    renderRunFeedback(correct, word);
    disableRunOptions();
    state.run.index += 1;
    renderRunProgress();
    if (correct) {
      runAutoTimer = setTimeout(() => nextRunQuestion(), 1000);
    }
  }

  function disableRunOptions() {
    els.runOptionsArea.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
  }

  function renderRunFeedback(correct, word) {
    const p = getProgress(word.id);
    const masteredNow = isMastered(word);
    els.runFeedbackArea.innerHTML = `
      <div class="feedback-box ${correct ? 'success' : 'danger'}">
        <strong>${correct ? 'Good recall!' : 'Keep this word in review.'} ${masteredNow ? 'Mastered 🎉' : ''}</strong>
        <div>${escapeHtml(word.english)} ${word.phonetics ? `<span class="muted">${escapeHtml(word.phonetics)}</span>` : ''}</div>
        <p class="example-reveal">${escapeHtml(word.example)}</p>
        <p class="example-reveal"><strong>Meaning:</strong> ${escapeHtml(explanationText(word))}</p>
        <p class="muted">Progress: ${p.correct}/${state.settings.targetCorrect} correct · ${p.wrong} wrong</p>
      </div>
    `;
  }

  async function showRunHint() {
    const q = state.run.current;
    if (!q || q.answered) return;
    const wordId = q.word.id;
    els.runFeedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Hint</strong>
        <p class="example-reveal muted">Preparing the English definition...</p>
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(maskTargetWord(explanationText(q.word), q.word.english))}</p>
      </div>
    `;
    const dictionaryEntry = await getDictionaryEntry(q.word);
    if (!state.run.current || state.run.current.word.id !== wordId) return;
    els.runFeedbackArea.innerHTML = `
      <div class="feedback-box">
        <strong>Hint</strong>
        ${dictionaryDefinitionHtml(dictionaryEntry, q.word, { hideTerm: true, hideExample: true, sanitizeTarget: true })}
        <p class="example-reveal"><strong>Context clue:</strong> ${escapeHtml(maskTargetWord(explanationText(q.word), q.word.english))}</p>
      </div>
    `;
  }

  function renderRunProgress() {
    if (!els.runCounter) return;
    const run = state.run;
    const answered = run.answered || 0;
    const total = run.total || Number(els.runLengthSelect?.value || 20);
    const hasRunData = answered > 0 || run.queue.length > 0;
    const percent = hasRunData && total ? Math.round((answered / total) * 100) : 0;
    els.runPercent.textContent = `${percent}%`;
    els.runProgress.style.width = `${percent}%`;
    els.runCounter.textContent = hasRunData ? `${answered}/${total} questions answered.` : 'No run started yet.';
    els.runCorrect.textContent = run.correct || 0;
    els.runWrong.textContent = run.wrong || 0;
    els.runLearned.textContent = run.learnedIds?.size || 0;
    const selectedRunUnit = state.run.active ? state.run.unit : (els.runUnitSelect?.value || state.settings.unit || 'all');
    const all = allWords().filter(word => selectedRunUnit === 'all' || String(word.unit) === String(selectedRunUnit));
    const mastered = all.filter(isMastered).length;
    els.runLearnedTotal.textContent = mastered;
    els.runActiveTotal.textContent = Math.max(0, all.length - mastered);
  }

  function finishRun() {
    clearTimeout(runAutoTimer);
    state.run.active = false;
    const accuracy = state.run.answered ? Math.round((state.run.correct / state.run.answered) * 100) : 0;
    const learnedWords = idsToWords(state.run.learnedIds);
    const strengthenedWords = idsToWords(state.run.strengthenedIds);
    const reviewWords = idsToWords(state.run.reviewIds);
    els.runModeBadge.textContent = 'Run complete';
    els.runWordMeta.textContent = `${state.run.answered}/${state.run.total} questions answered`;
    els.runQuestionArea.innerHTML = `
      <div class="question-label">Run Complete</div>
      <p class="question-text">You learned ${learnedWords.length} new ${learnedWords.length === 1 ? 'word' : 'words'}.</p>
      <p class="question-subtext">Accuracy: ${accuracy}% · Strengthened: ${strengthenedWords.length} · Needs review: ${reviewWords.length}</p>
    `;
    els.runOptionsArea.innerHTML = '';
    els.runFeedbackArea.innerHTML = '';
    if (els.runResultsPanel) {
      els.runResultsPanel.classList.remove('hidden');
      els.runResultsContent.innerHTML = `
        <div class="run-result-grid">
          <article><strong>${state.run.answered}</strong><span>Words studied</span></article>
          <article><strong>${learnedWords.length}</strong><span>New mastered</span></article>
          <article><strong>${strengthenedWords.length}</strong><span>Strengthened</span></article>
          <article><strong>${reviewWords.length}</strong><span>Need review</span></article>
        </div>
        ${renderRunWordList('New mastered words', learnedWords)}
        ${renderRunWordList('Words to review', reviewWords)}
      `;
    }
    renderRunProgress();
    renderStats();
  }

  function idsToWords(ids) {
    const idSet = ids instanceof Set ? ids : new Set(ids || []);
    return allWords().filter(word => idSet.has(word.id));
  }

  function renderRunWordList(title, words) {
    if (!words.length) return `<div class="run-word-list"><strong>${title}</strong><p class="muted">None in this run.</p></div>`;
    return `
      <div class="run-word-list">
        <strong>${title}</strong>
        <ul>${words.slice(0, 12).map(word => `<li>${escapeHtml(word.english)} <span class="muted">Unit ${word.unit}</span></li>`).join('')}</ul>
      </div>
    `;
  }

  function endRun() {
    if (!state.run.active) return;
    const ok = confirm('End this run now?');
    if (!ok) return;
    finishRun();
  }

  function loadState() {
    state.customWords = loadJson(STORAGE_KEYS.customWords, []);
    state.progress = loadJson(STORAGE_KEYS.progress, {});
    state.dictionaryCache = loadJson(STORAGE_KEYS.dictionaryCache, {});
    state.definitionDatabase = loadJson(STORAGE_KEYS.definitionDatabase, {});
    state.settings = { ...defaultSettings, ...loadJson(STORAGE_KEYS.settings, {}) };
    state.settings.mode = normalizeMode(state.settings.mode);
    seedLocalDefinitionDatabase();
  }

  function syncSettingsToUi() {
    els.unitSelect.value = state.settings.unit;
    state.settings.mode = normalizeMode(state.settings.mode);
    els.modeSelect.value = state.settings.mode;
    els.targetCorrect.value = state.settings.targetCorrect;
    els.includeMastered.checked = state.settings.includeMastered;
    els.autoSpeak.checked = state.settings.autoSpeak;
  }

  function saveSettingsFromUi() {
    state.settings.unit = els.unitSelect.value;
    state.settings.mode = normalizeMode(els.modeSelect.value);
    state.settings.targetCorrect = clamp(Number(els.targetCorrect.value) || 2, 1, 10);
    state.settings.includeMastered = els.includeMastered.checked;
    state.settings.autoSpeak = els.autoSpeak.checked;
    saveJson(STORAGE_KEYS.settings, state.settings);
    renderStats();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function addCustomWord(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(els.addWordForm).entries());
    const word = normalizeWord({ ...data, source: 'Custom' }, state.customWords.length);
    if (!word.english || !word.example) {
      toast('English word and example sentence are required.');
      return;
    }
    state.customWords.push(word);
    saveJson(STORAGE_KEYS.customWords, state.customWords);
    setupUnitSelect();
    syncSettingsToUi();
    els.addWordForm.reset();
    renderStats();
    toast('Word added and included in the game.');
  }

  function importBulk() {
    const raw = els.bulkInput.value.trim();
    if (!raw) return;
    let imported = [];
    try {
      if (raw.startsWith('[')) {
        imported = JSON.parse(raw).map(normalizeWord);
      } else {
        imported = parseCsv(raw).map((row, index) => normalizeWord(row, index));
      }
    } catch (error) {
      toast('Import failed. Please check the CSV/JSON format.');
      console.error(error);
      return;
    }
    imported = imported.filter(w => w.english && w.example);
    state.customWords.push(...imported);
    saveJson(STORAGE_KEYS.customWords, state.customWords);
    els.bulkInput.value = '';
    setupUnitSelect();
    syncSettingsToUi();
    renderStats();
    toast(`${imported.length} words imported.`);
  }

  function parseCsv(text) {
    const rows = csvRows(text);
    if (!rows.length) return [];
    const headers = rows.shift().map(h => h.trim());
    return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
  }

  function csvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell.trim()); cell = '';
        if (row.some(Boolean)) rows.push(row);
        row = [];
        continue;
      }
      cell += char;
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function exportCustomWords() {
    downloadJson('custom-words.json', state.customWords);
  }

  function exportProgress() {
    downloadJson('vocabulary-progress.json', {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      progress: state.progress,
      session: state.session
    });
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyWordsJson() {
    const text = JSON.stringify(allWords(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('Word JSON copied to the clipboard.');
    } catch {
      els.bulkInput.value = text;
      toast('Copying was blocked; JSON was placed in the bulk-add field.');
    }
  }

  function resetProgress() {
    const ok = confirm('Do you want to reset all word progress?');
    if (!ok) return;
    state.progress = {};
    saveJson(STORAGE_KEYS.progress, state.progress);
    state.session = { correct: 0, wrong: 0, answered: 0, streak: 0 };
    renderStats();
    nextQuestion();
    toast('Progress reset.');
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[char]));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function showPage(page) {
    const safePage = ['game', 'run', 'about'].includes(page) ? page : 'game';
    document.querySelectorAll('.page-view').forEach(view => {
      view.classList.toggle('active', view.id === `${safePage}Page`);
    });
    document.querySelectorAll('.page-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.page === safePage);
    });
    if (location.hash !== `#${safePage}`) {
      history.replaceState(null, '', `#${safePage}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindEvents() {
    [els.unitSelect, els.modeSelect, els.targetCorrect, els.includeMastered, els.autoSpeak].forEach(el => {
      el.addEventListener('change', () => { saveSettingsFromUi(); nextQuestion(); });
    });
    els.nextBtn.addEventListener('click', () => { state.reviewWeakOnly = false; nextQuestion(); });
    els.newGameBtn.addEventListener('click', () => { state.reviewWeakOnly = false; nextQuestion(); });
    els.reviewBtn.addEventListener('click', () => { state.reviewWeakOnly = true; nextQuestion(); toast('Weak words are now prioritised.'); });
    els.hintBtn.addEventListener('click', showHint);
    els.speakBtn.addEventListener('click', () => state.currentQuestion && speak(state.currentQuestion.word.english));
    els.resetProgressBtn.addEventListener('click', resetProgress);
    els.addWordForm.addEventListener('submit', addCustomWord);
    els.importCsvBtn.addEventListener('click', importBulk);
    els.exportCustomBtn.addEventListener('click', exportCustomWords);
    els.exportProgressBtn.addEventListener('click', exportProgress);
    els.copyWordsBtn.addEventListener('click', copyWordsJson);
    els.searchInput.addEventListener('input', renderScoreTable);
    els.scoreUnitFilter.addEventListener('change', renderScoreTable);
    els.scoreSortSelect.addEventListener('change', renderScoreTable);
    document.querySelectorAll('[data-score-sort]').forEach(button => {
      button.addEventListener('click', () => {
        els.scoreSortSelect.value = nextHeaderSort(button.dataset.scoreSort, els.scoreSortSelect.value);
        renderScoreTable();
      });
    });
    els.startRunBtn.addEventListener('click', startRun);
    els.runUnitSelect.addEventListener('change', renderRunProgress);
    els.runLengthSelect.addEventListener('change', renderRunProgress);
    els.runHintBtn.addEventListener('click', showRunHint);
    els.runSpeakBtn.addEventListener('click', () => state.run.current && speak(state.run.current.word.english));
    els.runNextBtn.addEventListener('click', () => {
      if (state.run.current?.answered) {
        nextRunQuestion();
      } else {
        toast('Answer this question first.');
      }
    });
    els.runQuitBtn.addEventListener('click', endRun);
    els.replayRunBtn.addEventListener('click', startRun);
    els.runReviewWeakBtn.addEventListener('click', () => {
      showPage('game');
      state.reviewWeakOnly = true;
      nextQuestion();
      toast('Weak words are now prioritised.');
    });
    document.querySelectorAll('.page-tab').forEach(tab => {
      tab.addEventListener('click', () => showPage(tab.dataset.page));
    });
    $('actFooterLink').addEventListener('click', (event) => {
      event.preventDefault();
      showPage('about');
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && state.currentQuestion?.answered) nextQuestion();
      if (event.key >= '1' && event.key <= '4') {
        const buttons = [...els.optionsArea.querySelectorAll('.option-button:not(:disabled)')];
        const target = buttons[Number(event.key) - 1];
        if (target) target.click();
      }
    });
  }

  function init() {
    loadState();
    setupUnitSelect();
    syncSettingsToUi();
    bindEvents();
    renderStats();
    renderRunIdle();
    nextQuestion();
    startDictionaryDatabaseWarmup();
    showPage(location.hash.replace('#', '') || 'game');
  }

  init();
})();

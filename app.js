(() => {
  'use strict';

  const STORAGE_KEY = 'today-organizer-v1';
  const WEATHER_CACHE_KEY = 'leila-weather-v1';
  const HOLIDAY_CACHE_KEY = 'leila-holidays-kr-v1';
  const TZ = 'Asia/Seoul';
  const categoryLabels = { work: '업무', personal: '개인', family: '아이·가족' };
  const typeLabels = { event: '일정', task: '할 일', someday: '언젠가', shopping: '쇼핑' };
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const googleWeekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const defaultState = { items: [], books: [], settings: { googleClientId: '', lastDigest: '' } };
  let state = loadState();
  let previews = [];
  let weekCursor = startOfWeek(new Date());
  let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let taskFilter = 'open';
  let shopFilter = 'all';
  let googleToken = null;
  let tokenClient = null;
  let toastTimer = null;
  let editingItemId = null;
  let bookSearchResults = [];
  const holidayDates = new Map();
  const holidayLoadingYears = new Set();
  try {
    Object.entries(JSON.parse(localStorage.getItem(HOLIDAY_CACHE_KEY)) || {}).forEach(([date, name]) => holidayDates.set(date, name));
  } catch {}

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const pad = value => String(value).padStart(2, '0');
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const parseKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function startOfWeek(date) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - offset);
    return result;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && Array.isArray(saved.items)
        ? { items: saved.items, books: Array.isArray(saved.books) ? saved.books : [], settings: { ...defaultState.settings, ...(saved.settings || {}) } }
        : structuredClone(defaultState);
    } catch { return structuredClone(defaultState); }
  }

  function migrateExistingDateRanges() {
    let moved = 0;
    state.items.forEach(item => {
      if (!item.date || item.endDate || !item.title) return;
      const match = item.title.match(/^\s*(?:~|～|–|—|-)\s*(\d{1,2})일(?:까지)?\s*/);
      if (!match) return;
      const start = parseKey(item.date);
      let end = new Date(start.getFullYear(), start.getMonth(), Number(match[1]));
      if (end < start) end = new Date(start.getFullYear(), start.getMonth() + 1, Number(match[1]));
      item.endDate = dateKey(end);
      item.title = item.title.replace(match[0], '').trim() || item.title;
      moved += 1;
    });
    if (moved) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return moved;
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
  }

  function formatDate(key, includeYear = false) {
    if (!key) return '날짜 없음';
    const date = parseKey(key);
    const options = includeYear ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' } : { month: 'long', day: 'numeric', weekday: 'short' };
    return new Intl.DateTimeFormat('ko-KR', options).format(date);
  }

  function parseDateRangeFromText(text) {
    const now = new Date();
    const match = text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*(?:~|～|–|—|-|부터)\s*(?:(?:(\d{4})년\s*)?(\d{1,2})월\s*)?(\d{1,2})일(?:까지)?/);
    if (!match) return { start: null, end: null };
    let startYear = match[1] ? Number(match[1]) : now.getFullYear();
    const start = new Date(startYear, Number(match[2]) - 1, Number(match[3]));
    if (!match[1] && start < new Date(now.getFullYear(), now.getMonth(), now.getDate())) start.setFullYear(++startYear);
    const endYear = match[4] ? Number(match[4]) : startYear;
    const endMonth = match[5] ? Number(match[5]) : Number(match[2]);
    let end = new Date(endYear, endMonth - 1, Number(match[6]));
    if (!match[4] && end < start) {
      end = match[5]
        ? new Date(endYear + 1, endMonth - 1, Number(match[6]))
        : new Date(startYear, Number(match[2]), Number(match[6]));
    }
    return { start, end };
  }
  function parseDateFromText(text) {
    const now = new Date();
    if (/오늘/.test(text)) return now;
    if (/모레/.test(text)) return addDays(now, 2);
    if (/내일/.test(text)) return addDays(now, 1);
    let match = text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
    if (match) {
      let year = match[1] ? Number(match[1]) : now.getFullYear();
      const result = new Date(year, Number(match[2]) - 1, Number(match[3]));
      if (!match[1] && result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) result.setFullYear(year + 1);
      return result;
    }
    match = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:일)?\b/);
    if (match) {
      const result = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]));
      if (result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) result.setFullYear(now.getFullYear() + 1);
      return result;
    }
    const relativeWeek = text.match(/(저번|지난|이번|다음|다다음)\s*주(?:\s*(월|화|수|목|금|토|일)요일)?/);
    if (relativeWeek) {
      const prefix = relativeWeek[1];
      const target = relativeWeek[2] ? weekdays.indexOf(relativeWeek[2]) : 1;
      const weekOffset = /저번|지난/.test(prefix) ? -1 : /다다음/.test(prefix) ? 2 : /다음/.test(prefix) ? 1 : 0;
      return addDays(startOfWeek(now), ((target + 6) % 7) + weekOffset * 7);
    }    const dayMatch = text.match(/(다다음\s*주|다음\s*주|이번\s*주)?\s*(월|화|수|목|금|토|일)요일/);
    if (dayMatch) {
      const target = ['일', '월', '화', '수', '목', '금', '토'].indexOf(dayMatch[2]);
      const prefix = dayMatch[1] || '';
      const weekOffset = /다다음\s*주/.test(prefix) ? 2 : /다음\s*주/.test(prefix) ? 1 : 0;
      let result = addDays(startOfWeek(now), ((target + 6) % 7) + weekOffset * 7);
      if (!prefix && result < new Date(now.getFullYear(), now.getMonth(), now.getDate())) result = addDays(result, 7);
      return result;
    }
    return null;
  }

  function clockTime(period, hourValue, minuteValue = 0) {
    let hour = Number(hourValue);
    const minute = Number(minuteValue || 0);
    if (period === '오후' && hour < 12) hour += 12;
    if (period === '오전' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return '';
    return pad(hour) + ':' + pad(minute);
  }

  function parseTimeDetails(text) {
    const range = text.match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2})|\s*시(?!간)(?:\s*(\d{1,2})\s*분)?)\s*(?:~|～|–|—|부터)\s*(오전|오후)?\s*(\d{1,2})(?::(\d{2})|\s*시(?!간)(?:\s*(\d{1,2})\s*분)?)/);
    if (range) {
      const startPeriod = range[1] || '';
      const endPeriod = range[5] || startPeriod;
      return {
        start: clockTime(startPeriod, range[2], range[3] || range[4]),
        end: clockTime(endPeriod, range[6], range[7] || range[8])
      };
    }
    let match = text.match(/(오전|오후)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분)?/);
    if (match) return { start: clockTime(match[1], match[2], match[3]), end: '' };
    match = text.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})\b/);
    return match ? { start: clockTime(match[1], match[2], match[3]), end: '' } : { start: '', end: '' };
  }

  function parseRecurrenceFromText(text, parsedDate) {
    if (/매\s*(?:년|해)/.test(text)) {
      const base = parsedDate || new Date();
      return { recurrence: 'yearly', recurrenceDay: null, recurrenceMonth: base.getMonth() + 1, recurrenceDate: base.getDate() };
    }
    if (/매\s*일/.test(text)) return { recurrence: 'daily', recurrenceDay: null, recurrenceMonth: null, recurrenceDate: null };
    const weekly = text.match(/매\s*주(?:\s*(월|화|수|목|금|토|일)요일)?/);
    if (weekly) {
      const recurrenceDay = weekly[1] ? weekdays.indexOf(weekly[1]) : (parsedDate || new Date()).getDay();
      return { recurrence: 'weekly', recurrenceDay, recurrenceMonth: null, recurrenceDate: null };
    }
    const monthly = text.match(/매\s*(?:달|월)(?:\s*(\d{1,2})일)?/);
    if (monthly) return { recurrence: 'monthly', recurrenceDay: null, recurrenceMonth: null, recurrenceDate: Number(monthly[1]) || (parsedDate || new Date()).getDate() };
    return { recurrence: '', recurrenceDay: null, recurrenceMonth: null, recurrenceDate: null };
  }

  function firstRecurrenceDate(recurrence) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (recurrence.recurrence === 'daily') return today;
    if (recurrence.recurrence === 'weekly') return addDays(today, (Number(recurrence.recurrenceDay) - today.getDay() + 7) % 7);
    if (recurrence.recurrence === 'monthly') {
      const targetDay = Number(recurrence.recurrenceDate);
      for (let offset = 0; offset < 24; offset += 1) {
        const candidate = new Date(today.getFullYear(), today.getMonth() + offset, targetDay);
        if (candidate.getDate() === targetDay && candidate >= today) return candidate;
      }
    }
    if (recurrence.recurrence === 'yearly') {
      const targetMonth = Number(recurrence.recurrenceMonth) - 1;
      const targetDay = Number(recurrence.recurrenceDate);
      for (let offset = 0; offset < 8; offset += 1) {
        const candidate = new Date(today.getFullYear() + offset, targetMonth, targetDay);
        if (candidate.getMonth() === targetMonth && candidate.getDate() === targetDay && candidate >= today) return candidate;
      }
    }
    return null;
  }

  function addMinutes(time, minutes) {
    if (!time) return '';
    const [hour, minute] = time.split(':').map(Number);
    const total = hour * 60 + minute + minutes;
    return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  }

  function detectCategory(text) {
    if (/(?:로아|남편)/.test(text)) return 'family';
    if (/^(?:아이(?:·가족)?|가족)\s*[:：]/.test(text) || /(아이|가족|어린이집|유치원|학교|학원|체험학습|준비물|엄마|아빠|아들|딸)/.test(text)) return 'family';
    if (/^업무\s*[:：]/.test(text) || /(고객|보고서|회의|미팅|팀|사내|결재|프로젝트|업무|제출|교육 신청)/.test(text)) return 'work';
    return 'personal';
  }

  function detectType(text, parsedDate, parsedTime) {
    if (/^(?:쇼핑|장보기)\s*[:：]/.test(text) || /(사기|구매|장보기|쇼핑리스트)/.test(text)) return 'shopping';
    if (/^(?:언젠가|나중에)\s*[:：]/.test(text) || /(언젠가|나중에|기한\s*없)/.test(text)) return 'someday';
    if (/^(?:할\s*일)\s*[:：]/.test(text) || /(까지|마감|제출|신청|해야|준비하기|챙기기)/.test(text)) return 'task';
    if (parsedTime || /(회의|미팅|약속|식사|병원|치과|학원|행사|여행|운동)/.test(text)) return 'event';
    return parsedDate ? 'task' : 'someday';
  }

  function detectMealSlot(text) {
    if (/(점심\s*약속|점약|점심|런치|오찬)/.test(text)) return 'lunch';
    if (/(저녁\s*약속|저약|저녁|디너|석식)/.test(text)) return 'dinner';
    return '';
  }

  function migrateExistingMealSlots() {
    let moved = 0;
    state.items.forEach(item => {
      if (item.type !== 'event' || item.mealSlot) return;
      const mealSlot = detectMealSlot(item.title || '');
      if (!mealSlot) return;
      item.mealSlot = mealSlot;
      if (!item.time) {
        item.time = mealSlot === 'lunch' ? '12:00' : '18:00';
        item.endTime = addMinutes(item.time, 60);
      }
      moved += 1;
    });
    if (moved) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return moved;
  }
  function migrateExistingRecurrences() {
    let moved = 0;
    state.items.forEach(item => {
      if (item.recurrence || !item.title || !/매\s*(?:주|일|달|월)/.test(item.title)) return;
      const parsedDate = item.date ? parseKey(item.date) : null;
      const recurrence = parseRecurrenceFromText(item.title, parsedDate);
      if (!recurrence.recurrence) return;
      item.recurrence = recurrence.recurrence;
      item.recurrenceDay = recurrence.recurrenceDay;
      item.recurrenceMonth = recurrence.recurrenceMonth;
      item.recurrenceDate = recurrence.recurrenceDate;
      if (!item.date) {
        const firstDate = firstRecurrenceDate(recurrence);
        if (firstDate) item.date = dateKey(firstDate);
      }
      if (item.type === 'someday') item.type = 'task';
      item.title = item.title
        .replace(/매\s*(?:년|해)/g, '')
      .replace(/매\s*(?:달|월)\s*\d{1,2}일/g, '')
        .replace(/매\s*(?:주|일|달|월)/g, '')
        .replace(/(?:월|화|수|목|금|토|일)요일/g, '')
        .replace(/\s+/g, ' ').trim() || item.title;
      moved += 1;
    });
    if (moved) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return moved;
  }
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  }

  function normalizeLocationCandidate(value) {
    return value
      .replace(/^(업무|개인|아이(?:·가족)?|가족)\s*[:：]\s*/, '')
      .replace(/(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일\s*(?:~|～|–|—|-|부터)\s*(?:(?:(?:\d{4})년\s*)?\d{1,2}월\s*)?\d{1,2}일(?:까지)?/g, '')
      .replace(/(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일/g, '')
      .replace(/\b\d{1,2}[./-]\d{1,2}(?:일)?\b/g, '')
      .replace(/(오늘|내일|모레|다다음\s*주|다음\s*주|이번\s*주)/g, '')
      .replace(/매\s*(?:년|해)/g, '')
      .replace(/매\s*(?:달|월)\s*\d{1,2}일/g, '')
      .replace(/매\s*(?:주|일|달|월)/g, '')
      .replace(/(?:월|화|수|목|금|토|일)요일/g, '')
      .replace(/(?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)\s*(?:~|～|–|—|부터)\s*(?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)/g, '')
      .replace(/(오전|오후)?\s*\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분)?/g, '')
      .replace(/(?:오전|오후)?\s*\d{1,2}:\d{2}\b/g, '')
      .replace(/^.+?(?:와|과|랑|하고)\s+/, '')
      .replace(/^(?:점심|저녁|런치|디너|오찬|석식)\s*(?:약속|식사|미팅)?\s*/, '')
      .replace(/^(?:약속|미팅|회의)\s+/, '')
      .replace(/\s+/g, ' ').trim();
  }

  function parseLocationFromText(text) {
    const explicit = text.match(/(?:장소|위치)\s*[:：]\s*([^,;]+)/);
    if (explicit) return explicit[1].trim();
    const atLocation = text.match(/(?:^|\s)@([^\s,;]+)/);
    if (atLocation) return atLocation[1].trim();
    const atPhrase = text.match(/(.{1,60}?)에서(?:\s|$)/);
    if (atPhrase) {
      const candidate = normalizeLocationCandidate(atPhrase[1]);
      if (candidate) return candidate;
    }
    const normalizedText = normalizeLocationCandidate(text);
    const branchPlace = normalizedText.match(/((?:[가-힣A-Za-z0-9·.-]+\s+)?[가-힣A-Za-z0-9·.-]+(?:지점|점)(?:\s+[가-힣A-Za-z0-9·.-]+(?:실|룸|관))?)/);
    if (branchPlace) return branchPlace[1].trim();
    const commonPlace = normalizedText.match(/((?:[가-힣A-Za-z0-9·.-]+\s+){0,5}[가-힣A-Za-z0-9·.-]*(?:역|병원|치과|학교|학원|회사|회의실|카페|식당|공원|마트|백화점|공항|호텔|센터|도서관|출구|스튜디오|체육관|미술관|박물관|공연장|극장|놀이터|수영장|운동장|웨딩홀|교회|성당|은행|약국)(?:\s+[가-힣A-Za-z0-9·.-]+(?:실|룸|관))?)/);
    return commonPlace ? commonPlace[1].trim() : '';
  }
  function cleanTitle(text, type, location = '') {
    let source = text;
    if (location) {
      const escapedLocation = escapeRegExp(location);
      source = source
        .replace(new RegExp('(?:장소|위치)\\s*[:：]\\s*' + escapedLocation, 'g'), '')
        .replace(new RegExp('@' + escapedLocation, 'g'), '')
        .replace(new RegExp(escapedLocation + '\\s*에서', 'g'), '')
        .replace(new RegExp(escapedLocation, 'g'), '');
    }
    let title = source
      .replace(/^(업무|개인|아이(?:·가족)?|가족|언젠가|나중에|쇼핑|장보기|할\s*일)\s*[:：]\s*/, '')
      .replace(/(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일\s*(?:~|～|–|—|-|부터)\s*(?:(?:(?:\d{4})년\s*)?\d{1,2}월\s*)?\d{1,2}일(?:까지)?/g, '')
      .replace(/(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일/g, '')
      .replace(/\b\d{1,2}[./-]\d{1,2}(?:일)?\b/g, '')
      .replace(/(오늘|내일|모레|다다음\s*주|다음\s*주|이번\s*주)/g, '')
      .replace(/매\s*(?:년|해)/g, '')
      .replace(/매\s*(?:달|월)\s*\d{1,2}일/g, '')
      .replace(/매\s*(?:주|일|달|월)/g, '')
      .replace(/(?:월|화|수|목|금|토|일)요일/g, '')
      .replace(/(?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)\s*(?:~|～|–|—|부터)\s*(?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)/g, '')
      .replace(/(오전|오후)?\s*\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분)?/g, '')
      .replace(/(?:오전|오후)?\s*\d{1,2}:\d{2}\b/g, '')
      .replace(/\d+(?:\.\d+)?\s*시간/g, '')
      .replace(/\d+\s*분\s*전\s*알림|\d+\s*분\s*전에\s*알려줘/g, '')
      .replace(/(까지|마감)/g, '')
      .replace(/\s+/g, ' ').trim();
    if (type === 'shopping') title = title.replace(/\s*(사기|구매하기|구매)\s*$/, '').trim();
    if (type === 'someday') title = title.replace(/^(언젠가|나중에)\s*/, '').trim();
    return title || text.trim();
  }

  function parseLine(text) {
    const category = detectCategory(text);
    const dateRange = parseDateRangeFromText(text);
    let parsedDate = dateRange.start || parseDateFromText(text);
    const recurrence = parseRecurrenceFromText(text, parsedDate);
    if (!parsedDate && recurrence.recurrence) parsedDate = firstRecurrenceDate(recurrence);
    const timeDetails = parseTimeDetails(text);
    const mealSlot = detectMealSlot(text);
    const time = timeDetails.start || (mealSlot === 'lunch' ? '12:00' : mealSlot === 'dinner' ? '18:00' : '');
    let type = detectType(text, parsedDate, time);
    if (dateRange.end && !['shopping', 'someday'].includes(type)) type = 'event';
    const location = parseLocationFromText(text);

    const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*시간/);
    const duration = durationMatch ? Number(durationMatch[1]) * 60 : 60;
    const reminderMatch = text.match(/(\d+)\s*분\s*전/);
    const item = {
      id: uid(), title: cleanTitle(text, type, location), location, type, category,
      date: parsedDate && !['someday', 'shopping'].includes(type) ? dateKey(parsedDate) : '',
      endDate: dateRange.end && !['someday', 'shopping'].includes(type) ? dateKey(dateRange.end) : '',
      time: type === 'event' ? time : '', endTime: type === 'event' && time ? (timeDetails.end || addMinutes(time, duration)) : '',
      recurrence: recurrence.recurrence, recurrenceDay: recurrence.recurrenceDay, recurrenceMonth: recurrence.recurrenceMonth, recurrenceDate: recurrence.recurrenceDate,
      mealSlot: type === 'event' ? mealSlot : '',
      reminder: reminderMatch ? Number(reminderMatch[1]) : 30, done: false, selected: true,
      createdAt: new Date().toISOString(), googleEventId: ''
    };
    if (type === 'shopping') {
      const parts = item.title.split(/\s*(?:,|그리고|하고|랑|와|과)\s*/).map(value => value.trim()).filter(Boolean);
      if (parts.length > 1) return parts.map(part => ({ ...item, id: uid(), title: part }));
    }
    return [item];
  }

  function parseInput(value) {
    return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(parseLine);
  }

  function renderPreview() {
    const section = $('#preview-section');
    if (!previews.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    $('#preview-list').innerHTML = previews.map((item, index) => `
      <article class="preview-card">
        <input type="checkbox" data-preview-index="${index}" data-field="selected" ${item.selected ? 'checked' : ''} aria-label="${escapeHtml(item.title)} 등록">
        <div class="preview-fields">
          <label>제목<input type="text" value="${escapeHtml(item.title)}" data-preview-index="${index}" data-field="title"></label>
          <label>위치<input type="text" value="${escapeHtml(item.location || '')}" data-preview-index="${index}" data-field="location" placeholder="장소 없음"></label>
          <label>종류<select data-preview-index="${index}" data-field="type">${Object.entries(typeLabels).map(([key,label]) => `<option value="${key}" ${item.type === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label>구분<select data-preview-index="${index}" data-field="category">${Object.entries(categoryLabels).map(([key,label]) => `<option value="${key}" ${item.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label>날짜<input type="date" value="${item.date}" data-preview-index="${index}" data-field="date"></label>
          <label>종료일<input type="date" value="${item.endDate || ''}" data-preview-index="${index}" data-field="endDate"></label>
          <label>시작<input type="time" value="${item.time}" data-preview-index="${index}" data-field="time"></label>
          <label>종료<input type="time" value="${item.endTime || ''}" data-preview-index="${index}" data-field="endTime"></label>
          <p class="preview-note">${typeLabels[item.type]} · ${categoryLabels[item.category]}${item.date ? ` · ${formatDate(item.date)}` : ' · 날짜 없음'}${item.time ? ` ${item.time}` : ''}</p>
        </div>
      </article>`).join('');
    $('#preview-list').querySelectorAll('.preview-card').forEach((card, index) => {
      const item = previews[index];
      if (item.endDate) card.querySelector('.preview-note').append(' · 종료 ' + formatDate(item.endDate));
      if (item.recurrence === 'daily') card.querySelector('.preview-note').append(' · 매일');
      if (item.recurrence === 'weekly') card.querySelector('.preview-note').append(' · 매주 ' + weekdays[item.recurrenceDay] + '요일');
      if (item.recurrence === 'monthly') card.querySelector('.preview-note').append(' · 매달 ' + item.recurrenceDate + '일');
      if (item.recurrence === 'yearly') card.querySelector('.preview-note').append(' · 매년 ' + item.recurrenceMonth + '월 ' + item.recurrenceDate + '일');
      if (item.mealSlot === 'lunch') card.querySelector('.preview-note').append(' · 점심 약속 칸');
      if (item.mealSlot === 'dinner') card.querySelector('.preview-note').append(' · 저녁 약속 칸');
    });
    updatePreviewCount();
  }

  function updatePreviewCount() {
    const count = previews.filter(item => item.selected).length;
    $('#preview-count').textContent = `${count}개 선택됨`;
    $('#confirm-items').disabled = count === 0;
    $('#confirm-items').textContent = `확인한 ${count}개 등록`;
  }

  function showView(name) {
    $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
    $$('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function compose(prefix) {
    showView('home');
    const input = $('#quick-input');
    input.value = `${input.value.trimEnd()}${input.value.trim() ? '\n' : ''}${prefix}`;
    input.focus();
  }

  function addFixedKoreanHolidays(year) {
    const fixed = [
      ['01-01', 'New Year'], ['03-01', 'Independence Movement Day'],
      ['05-05', "Children's Day"], ['06-06', 'Memorial Day'],
      ['08-15', 'Liberation Day'], ['10-03', 'National Foundation Day'],
      ['10-09', 'Hangul Day'], ['12-25', 'Christmas Day']
    ];
    fixed.forEach(([suffix, name]) => holidayDates.set(year + '-' + suffix, name));
  }

  function saveHolidayCache() {
    try { localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(Object.fromEntries(holidayDates))); } catch {}
  }

  function ensureHolidayYears(years) {
    [...new Set(years)].forEach(yearValue => {
      const year = Number(yearValue);
      if (!Number.isInteger(year) || holidayLoadingYears.has(year)) return;
      addFixedKoreanHolidays(year);
      holidayLoadingYears.add(year);
      fetch('https://date.nager.at/api/v4/Holidays/KR/' + year)
        .then(response => { if (!response.ok) throw new Error('holiday response'); return response.json(); })
        .then(holidays => {
          holidays.filter(holiday => holiday.nationalHoliday !== false && (!Array.isArray(holiday.holidayTypes) || holiday.holidayTypes.includes('Public')))
            .forEach(holiday => holidayDates.set(holiday.date, holiday.name || 'Holiday'));
          saveHolidayCache();
        })
        .catch(() => {})
        .finally(() => { renderWeek(); renderMonth(); });
    });
  }

  function paydayKey(year, monthIndex) {
    const payday = new Date(year, monthIndex, 21);
    if (payday.getDay() === 6) payday.setDate(20);
    if (payday.getDay() === 0) payday.setDate(19);
    return dateKey(payday);
  }

  function dDayKey(year, monthIndex) {
    return dateKey(addDays(startOfWeek(new Date(year, monthIndex, 21)), 4));
  }

  function specialDayHtml(day, compact = false) {
    const key = dateKey(day);
    const labels = [];
    if (key === paydayKey(day.getFullYear(), day.getMonth())) labels.push('💸 월급날');
    if (key === dDayKey(day.getFullYear(), day.getMonth())) labels.push('✨ D-day');
    return labels.length ? '<div class="special-day-labels ' + (compact ? 'compact' : '') + '">' + labels.map(label => '<span>' + label + '</span>').join('') + '</div>' : '';
  }

  function itemsOn(key) {
    const day = parseKey(key);
    return state.items.filter(item => {
      if (item.done || !['event', 'task'].includes(item.type)) return false;
      if (item.recurrence === 'daily') return Boolean(item.date) && key >= item.date;
      if (item.recurrence === 'weekly') return Boolean(item.date) && key >= item.date && day.getDay() === Number(item.recurrenceDay);
      if (item.recurrence === 'monthly') return Boolean(item.date) && key >= item.date && day.getDate() === Number(item.recurrenceDate);
      if (item.recurrence === 'yearly') return Boolean(item.date) && key >= item.date && day.getMonth() + 1 === Number(item.recurrenceMonth || parseKey(item.date).getMonth() + 1) && day.getDate() === Number(item.recurrenceDate);
      return Boolean(item.date) && item.date <= key && key <= (item.endDate || item.date);
    });
  }

  function renderWeek() {
    const end = addDays(weekCursor, 6);
    ensureHolidayYears([weekCursor.getFullYear(), end.getFullYear()]);
    $('#week-title').textContent = (weekCursor.getMonth() + 1) + '월 ' + weekCursor.getDate() + '일 ~ ' + (end.getMonth() + 1) + '월 ' + end.getDate() + '일';
    $('#week-strip').innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekCursor, index);
      const key = dateKey(day);
      const items = itemsOn(key).sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
      const eventButton = item => '<button type="button" class="week-event ' + item.category + '" data-action="edit" data-id="' + escapeHtml(item.id) + '" data-occurrence="' + key + '">' + (item.time ? item.time + ' ' : '') + escapeHtml(item.title) + '</button>';
      const todoItems = items.filter(item => item.type === 'task' && !item.done);
      const generalItems = items.filter(item => item.type !== 'task' && !item.mealSlot);
      const lunchItems = items.filter(item => item.mealSlot === 'lunch');
      const dinnerItems = items.filter(item => item.mealSlot === 'dinner');
      const generalHtml = generalItems.length ? generalItems.slice(0,5).map(eventButton).join('') : '<span class="empty-day">일정 없음</span>';
      const todoHtml = todoItems.length ? '<div class="week-todos" aria-label="오늘 할 일"><span class="week-todo-title"><span aria-hidden="true">🚩</span> TO-DO</span>' + todoItems.map(item => '<label class="week-todo-check"><input type="checkbox" data-action="toggle" data-id="' + escapeHtml(item.id) + '"><span>' + escapeHtml(item.title) + '</span></label>').join('') + '</div>' : '';
      const mealHtml = (label, icon, slotItems) => '<div class="meal-slot"><span class="meal-label">' + icon + ' ' + label + '</span>' + (slotItems.length ? slotItems.map(eventButton).join('') : '<span class="meal-empty">약속 없음</span>') + '</div>';
      const holidayClass = holidayDates.has(key) ? ' holiday' : '';
      return '<div class="week-day ' + (key === todayKey() ? 'today' : '') + holidayClass + '"><div class="week-day-head"><span>' + weekdays[day.getDay()] + '</span><span>' + day.getDate() + '</span></div>' + specialDayHtml(day) + '<div class="week-general">' + generalHtml + '</div>' + todoHtml + '<div class="meal-slots">' + mealHtml('점심', '☕', lunchItems) + mealHtml('저녁', '🌙', dinnerItems) + '</div></div>';
    }).join('');
  }

  function renderMonth() {
    $('#month-title').textContent = monthCursor.getFullYear() + '년 ' + (monthCursor.getMonth() + 1) + '월';
    const first = startOfWeek(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1));
    const last = addDays(first, 41);
    ensureHolidayYears([first.getFullYear(), last.getFullYear()]);
    $('#month-grid').innerHTML = Array.from({ length: 42 }, (_, index) => {
      const day = addDays(first, index);
      const key = dateKey(day);
      const items = itemsOn(key);
      const itemHtml = items.slice(0,3).map(item => '<button type="button" class="month-item ' + item.category + '" data-action="edit" data-id="' + escapeHtml(item.id) + '" data-occurrence="' + key + '">' + (item.time || '') + ' ' + escapeHtml(item.title) + '</button>').join('');
      const holidayClass = holidayDates.has(key) ? 'holiday ' : '';
      return '<div class="month-day ' + holidayClass + (day.getMonth() !== monthCursor.getMonth() ? 'other-month ' : '') + (key === todayKey() ? 'today' : '') + '"><span class="day-number">' + day.getDate() + '</span>' + specialDayHtml(day, true) + itemHtml + '</div>';
    }).join('');
  }

  function itemMeta(item) {
    const parts = [categoryLabels[item.category], typeLabels[item.type]];
    if (item.location) parts.push('📍 ' + item.location);
    if (item.date) parts.push(item.endDate ? formatDate(item.date) + '–' + formatDate(item.endDate) : formatDate(item.date));
    if (item.time) parts.push(item.time + (item.endTime ? `–${item.endTime}` : ''));
    if (item.recurrence === 'daily') parts.push('매일');
    if (item.recurrence === 'weekly') parts.push('매주 ' + weekdays[item.recurrenceDay] + '요일');
    if (item.recurrence === 'monthly') parts.push('매달 ' + item.recurrenceDate + '일');
    if (item.recurrence === 'yearly') parts.push('매년 ' + item.recurrenceMonth + '월 ' + item.recurrenceDate + '일');
    if (item.mealSlot === 'lunch') parts.push('점심 약속');
    if (item.mealSlot === 'dinner') parts.push('저녁 약속');
    return parts.join(' · ');
  }

  function renderItem(item, options = {}) {
    const checked = item.done ? 'checked' : '';
    const googleButton = item.type === 'event' && item.date ? `<button class="mini-button" type="button" data-action="google" data-id="${item.id}">${item.googleEventId ? 'Google 등록됨' : 'Google에 추가'}</button>` : '';
    const scheduleButton = item.type === 'someday' ? `<button class="mini-button" type="button" data-action="schedule" data-id="${item.id}">이번 주에 하기</button>` : '';
    const checkbox = ['task','shopping'].includes(item.type) ? `<input type="checkbox" data-action="toggle" data-id="${item.id}" ${checked} aria-label="${escapeHtml(item.title)} 완료">` : `<span class="dot ${item.category}" aria-hidden="true"></span>`;
    return `<article class="list-item">${checkbox}<div class="item-copy"><strong class="${item.done ? 'done' : ''}">${escapeHtml(item.title)}</strong><span class="item-meta">${itemMeta(item)}</span></div><div class="item-actions">${scheduleButton}${googleButton}${options.noDelete ? '' : `<button class="mini-button" type="button" data-action="delete" data-id="${item.id}">삭제</button>`}</div></article>`;
  }

  function empty(message) { return `<div class="empty-state">${message}</div>`; }

  function renderToday() {
    const items = itemsOn(todayKey());
    $('#today-list').innerHTML = items.length ? items.map(renderItem).join('') : empty('오늘 등록된 일정이나 할 일이 없습니다.');
    const events = items.filter(item => item.type === 'event').length;
    const tasks = state.items.filter(item => item.type === 'task' && !item.done && (!item.date || item.date <= todayKey())).length;
    $('#daily-summary').textContent = events || tasks ? `오늘 일정 ${events}개, 오늘 확인할 할 일 ${tasks}개가 있습니다.` : '오늘은 비어 있습니다. 생각나는 일을 편하게 적어보세요.';
  }

  function renderMobileWidget() {
    const widget = $('.mobile-widget');
    if (!widget) return;
    const key = todayKey();
    const today = parseKey(key);
    const items = itemsOn(key);
    const events = items.filter(item => item.type === 'event').sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    const todos = items.filter(item => item.type === 'task' && !item.done);
    const specials = [];
    if (key === paydayKey(today.getFullYear(), today.getMonth())) specials.push('💸 월급날');
    if (key === dDayKey(today.getFullYear(), today.getMonth())) specials.push('✨ D-day');
    items.forEach(item => { if (/생일|생신|기념일/.test(item.title)) specials.push('🎂 ' + item.title.trim()); });
    const special = $('#widget-special');
    special.innerHTML = specials.map(label => '<span>' + escapeHtml(label) + '</span>').join('');
    special.classList.toggle('hidden', specials.length === 0);
    $('#widget-date').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(today);
    $('#widget-events').innerHTML = events.length
      ? events.map(item => '<div class="widget-item"><span class="widget-time">' + (item.time || '종일') + '</span><span>' + escapeHtml(item.title.trim()) + '</span></div>').join('')
      : '<div class="widget-empty">오늘 일정 없음</div>';
    $('#widget-todos').innerHTML = todos.length
      ? todos.map(item => '<label class="widget-todo"><input type="checkbox" data-action="toggle" data-id="' + escapeHtml(item.id) + '"><span>' + escapeHtml(item.title.trim()) + '</span></label>').join('')
      : '<div class="widget-empty">할 일 없음</div>';
  }

  function renderTasks() {
    let items = state.items.filter(item => item.type === 'task');
    if (taskFilter === 'open') items = items.filter(item => !item.done);
    if (taskFilter === 'done') items = items.filter(item => item.done);
    if (taskFilter === 'overdue') items = items.filter(item => !item.done && item.date && item.date < todayKey());
    items.sort((a,b) => (a.done - b.done) || (a.date || '9999').localeCompare(b.date || '9999'));
    $('#task-list').innerHTML = items.length ? items.map(renderItem).join('') : empty('이 조건에 맞는 할 일이 없습니다.');
  }

  function renderSomeday() {
    const items = state.items.filter(item => item.type === 'someday' && !item.done);
    const summaryItems = items.slice(0, 4);
    $('#someday-list').innerHTML = items.length ? items.map(renderItem).join('') : empty('언젠가 하고 싶은 일을 적어두세요.');
    $('#someday-summary-count').textContent = items.length + '개';
    $('#someday-summary-list').innerHTML = summaryItems.length
      ? summaryItems.map(item => `<button class="someday-summary-item" type="button" data-action="show-someday"><span>${escapeHtml(item.title)}</span><small>${categoryLabels[item.category] || '기타'}</small></button>`).join('') + (items.length > summaryItems.length ? `<button class="someday-summary-item someday-more" type="button" data-action="show-someday">+${items.length - summaryItems.length}개 더 보기</button>` : '')
      : '<div class="empty-state">기한은 없지만 잊고 싶지 않은 일을 적어보세요.</div>';
  }

  function renderFamily() {
    const events = state.items.filter(item => item.category === 'family' && item.type === 'event' && !item.done && (Boolean(item.recurrence) || !item.date || item.date >= todayKey())).sort((a,b) => (a.date || '').localeCompare(b.date || ''));
    const preparations = state.items.filter(item => item.category === 'family' && ['task','shopping'].includes(item.type) && !item.done);
    $('#family-event-list').innerHTML = events.length ? events.map(renderItem).join('') : empty('다가오는 가족 일정이 없습니다.');
    $('#family-task-list').innerHTML = preparations.length ? preparations.map(item => renderItem(item, { noDelete: true })).join('') : empty('가족 준비 목록이 비어 있습니다.');
  }

  function renderShopping() {
    let items = state.items.filter(item => item.type === 'shopping');
    if (shopFilter !== 'all') items = items.filter(item => item.category === shopFilter);
    items.sort((a,b) => a.done - b.done);
    $('#shopping-list').innerHTML = items.length ? items.map(renderItem).join('') : empty('사야 할 물건을 자유 입력창에 적어보세요.');
  }

  function bookFromVolume(volume) {
    const info = volume.volumeInfo || {};
    const thumbnail = String(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:');
    return {
      googleId: volume.id || '',
      title: info.title || '제목 없음',
      authors: Array.isArray(info.authors) ? info.authors : [],
      publisher: info.publisher || '',
      publishedDate: info.publishedDate || '',
      pageCount: Number(info.pageCount) || null,
      thumbnail,
      infoLink: info.infoLink || ''
    };
  }

  function bookFromOpenLibrary(document) {
    const key = String(document.key || '').replace(/^\/works\//, '');
    const coverId = Number(document.cover_i) || null;
    return {
      googleId: key ? 'openlibrary:' + key : '',
      title: document.title || '제목 없음',
      authors: Array.isArray(document.author_name) ? document.author_name : [],
      publisher: Array.isArray(document.publisher) ? (document.publisher[0] || '') : '',
      publishedDate: document.first_publish_year ? String(document.first_publish_year) : '',
      pageCount: Number(document.number_of_pages_median) || null,
      thumbnail: coverId ? 'https://covers.openlibrary.org/b/id/' + coverId + '-M.jpg?default=false' : '',
      infoLink: key ? 'https://openlibrary.org/works/' + key : ''
    };
  }
  function bookCardHtml(book, options = {}) {
    const meta = [book.authors?.join(', '), book.publisher, book.publishedDate, book.pageCount ? book.pageCount + '쪽' : ''].filter(Boolean).join(' · ');
    const cover = book.thumbnail
      ? '<img class="book-cover" src="' + escapeHtml(book.thumbnail) + '" alt="' + escapeHtml(book.title) + ' 표지" loading="lazy">'
      : '<div class="book-cover-placeholder" aria-hidden="true">📖</div>';
    const action = options.readonly ? '' : options.result
      ? '<button class="mini-button" type="button" data-action="add-book" data-book-index="' + options.index + '">읽은 책에 추가</button>'
      : '<button class="mini-button" type="button" data-action="delete-book" data-id="' + escapeHtml(book.id) + '">삭제</button>';
    const finished = !options.result && book.finishedAt ? '<span class="book-finished">읽은 날 ' + escapeHtml(formatDate(book.finishedAt)) + '</span>' : '';
    return '<article class="book-item">' + cover + '<div class="book-copy"><strong>' + escapeHtml(book.title) + '</strong><span>' + escapeHtml(meta || '도서 정보 없음') + '</span>' + finished + '</div>' + action + '</article>';
  }

  function renderBookSearchResults() {
    const element = $('#book-search-results');
    if (!bookSearchResults.length) {
      element.innerHTML = '';
      element.classList.add('hidden');
      return;
    }
    element.classList.remove('hidden');
    element.innerHTML = '<p class="book-result-title">검색 결과에서 맞는 책을 골라주세요.</p>' + bookSearchResults.map((book, index) => bookCardHtml(book, { result: true, index })).join('');
  }

  function renderBooks() {
    const books = Array.isArray(state.books) ? state.books : [];
    const monthKey = todayKey().slice(0, 7);
    const monthBooks = books.filter(book => String(book.finishedAt || '').startsWith(monthKey));
    const cutoff = dateKey(addDays(new Date(), -6));
    const recentBooks = books.filter(book => book.finishedAt && book.finishedAt >= cutoff);
    $('#book-count').textContent = '이번 달 ' + monthBooks.length + '권 · 총 ' + books.length + '권';
    $('#book-list').innerHTML = books.length
      ? books.map(book => bookCardHtml(book)).join('')
      : '<div class="empty-state">읽은 책 제목을 입력해 첫 기록을 남겨보세요.</div>';
    $('#book-recent-count').textContent = '이번 달 ' + monthBooks.length + '권 · 총 ' + books.length + '권';
    $('#book-recent-list').innerHTML = recentBooks.length
      ? recentBooks.map(book => bookCardHtml(book, { readonly: true })).join('')
      : '<div class="empty-state">최근 7일 동안 읽은 책이 없습니다.</div>';
  }

  async function searchBooks(event) {
    event?.preventDefault();
    const input = $('#book-title-input');
    const query = input.value.trim();
    if (!query) return toast('책 제목을 입력해 주세요.');
    const button = $('#book-search-button');
    button.disabled = true;
    button.textContent = '찾는 중…';
    try {
      let results = [];
      try {
        const googleParams = new URLSearchParams({ q: 'intitle:"' + query + '"', maxResults: '5', printType: 'books', projection: 'lite' });
        const googleResponse = await fetch('https://www.googleapis.com/books/v1/volumes?' + googleParams);
        if (googleResponse.ok) {
          const googleData = await googleResponse.json();
          results = (googleData.items || []).map(bookFromVolume);
        }
      } catch {}
      if (!results.length) {
        const openParams = new URLSearchParams({
          title: query,
          limit: '5',
          fields: 'key,title,author_name,publisher,first_publish_year,cover_i,number_of_pages_median'
        });
        const openResponse = await fetch('https://openlibrary.org/search.json?' + openParams);
        if (openResponse.ok) {
          const openData = await openResponse.json();
          results = (openData.docs || []).map(bookFromOpenLibrary);
        }
      }
      const normalizedQuery = query.replace(/\s+/g, '').toLowerCase();
      bookSearchResults = results.sort((a, b) => {
        const aExact = a.title.replace(/\s+/g, '').toLowerCase() === normalizedQuery ? 0 : 1;
        const bExact = b.title.replace(/\s+/g, '').toLowerCase() === normalizedQuery ? 0 : 1;
        return aExact - bExact;
      }).slice(0, 3);
      if (!bookSearchResults.length) {
        bookSearchResults = [{ googleId: '', title: query, authors: [], publisher: '', publishedDate: '', pageCount: null, thumbnail: '', infoLink: '' }];
        toast('도서 정보를 찾지 못해 제목만 기록할 수 있게 준비했어요.');
      }
      renderBookSearchResults();
    } catch {
      bookSearchResults = [{ googleId: '', title: query, authors: [], publisher: '', publishedDate: '', pageCount: null, thumbnail: '', infoLink: '' }];
      renderBookSearchResults();
      toast('도서 정보 연결이 원활하지 않아 제목만 기록할 수 있어요.');
    } finally {
      button.disabled = false;
      button.textContent = '책 찾기';
    }
  }

  function addBookFromSearch(index) {
    const book = bookSearchResults[index];
    if (!book) return;
    const duplicate = state.books.some(saved => (book.googleId && saved.googleId === book.googleId) || (saved.title === book.title && (saved.authors || []).join('|') === (book.authors || []).join('|')));
    if (duplicate) return toast('이미 읽은 책 목록에 있어요.');
    state.books.unshift({ ...book, id: uid(), finishedAt: todayKey(), addedAt: new Date().toISOString() });
    bookSearchResults = [];
    $('#book-title-input').value = '';
    saveState();
    renderBookSearchResults();
    toast('읽은 책에 추가했습니다.');
  }

  function deleteBook(id) {
    const book = state.books.find(entry => entry.id === id);
    if (!book || !confirm('“' + book.title + '” 기록을 삭제할까요?')) return;
    state.books = state.books.filter(entry => entry.id !== id);
    saveState();
    toast('책 기록을 삭제했습니다.');
  }
  function renderSettings() {
    $('#google-client-id').value = state.settings.googleClientId || '';
    $('#google-state').textContent = googleToken ? 'Google Calendar에 연결되었습니다.' : '아직 연결되지 않았습니다.';
    $('#sync-status').textContent = googleToken ? 'Google Calendar 연결됨' : '이 기기에 저장 중';
  }

  function renderAll() { renderWeek(); renderMonth(); renderToday(); renderMobileWidget(); renderTasks(); renderSomeday(); renderFamily(); renderShopping(); renderBooks(); renderSettings(); }

  function openEditDialog(item) {
    editingItemId = item.id;
    $('#edit-title').value = item.title || '';
    $('#edit-location').value = item.location || '';
    $('#edit-category').value = item.category || 'personal';
    $('#edit-meal-slot').value = item.mealSlot || '';
    $('#edit-date').value = item.date || todayKey();
    $('#edit-end-date').value = item.endDate || '';
    $('#edit-time').value = item.time || '';
    $('#edit-end-time').value = item.endTime || '';
    $('#edit-recurrence').value = item.recurrence || '';
    $('#edit-reminder').value = Number.isFinite(Number(item.reminder)) ? Number(item.reminder) : 30;
    $('#edit-series-note').classList.toggle('hidden', !item.recurrence);
    const dialog = $('#edit-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeEditDialog() {
    editingItemId = null;
    const dialog = $('#edit-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function updateItemFromEdit(item, values) {
    item.title = values.title.trim();
    item.location = values.location.trim();
    item.category = values.category;
    item.mealSlot = values.mealSlot;
    item.date = values.date;
    item.endDate = values.endDate || '';
    const resolvedTime = values.time || (values.mealSlot === 'lunch' ? '12:00' : values.mealSlot === 'dinner' ? '18:00' : '');
    item.time = resolvedTime;
    item.endTime = resolvedTime ? (values.endTime || addMinutes(resolvedTime, 60)) : '';
    item.recurrence = values.recurrence;
    item.recurrenceDay = values.recurrence === 'weekly' ? parseKey(values.date).getDay() : null;
    item.recurrenceMonth = values.recurrence === 'yearly' ? parseKey(values.date).getMonth() + 1 : null;
    item.recurrenceDate = ['monthly','yearly'].includes(values.recurrence) ? parseKey(values.date).getDate() : null;
    item.reminder = Math.max(0, Number(values.reminder) || 0);
    item.googleEventId = '';
    return item;
  }

  function saveEditedItem(event) {
    event.preventDefault();
    const item = state.items.find(entry => entry.id === editingItemId);
    if (!item) return closeEditDialog();
    const values = {
      title: $('#edit-title').value,
      location: $('#edit-location').value,
      category: $('#edit-category').value,
      mealSlot: $('#edit-meal-slot').value,
      date: $('#edit-date').value,
      endDate: $('#edit-end-date').value,
      time: $('#edit-time').value,
      endTime: $('#edit-end-time').value,
      recurrence: $('#edit-recurrence').value,
      reminder: $('#edit-reminder').value
    };
    if (!values.title.trim() || !values.date) return toast('제목과 날짜를 확인해 주세요.');
    if (values.endDate && values.endDate < values.date) return toast('종료일은 시작일보다 빠를 수 없어요.');
    const wasGoogleEvent = Boolean(item.googleEventId);
    updateItemFromEdit(item, values);
    saveState();
    closeEditDialog();
    toast(wasGoogleEvent ? '수정했습니다. Google에 등록한 일정은 Google Calendar에서도 확인해 주세요.' : '일정을 수정했습니다.');
  }
  function handleListAction(button) {
    if (button.dataset.action === 'show-someday') { showView('someday'); return; }
    if (button.dataset.action === 'add-book') return addBookFromSearch(Number(button.dataset.bookIndex));
    if (button.dataset.action === 'delete-book') return deleteBook(button.dataset.id);
    const id = button.dataset.id;
    const item = state.items.find(entry => entry.id === id);
    if (!item) return;
    if (button.dataset.action === 'edit') { openEditDialog(item); return; }
    if (button.dataset.action === 'toggle') { item.done = !item.done; saveState(); }
    if (button.dataset.action === 'delete' && confirm(`“${item.title}”을 삭제할까요?`)) { state.items = state.items.filter(entry => entry.id !== id); saveState(); }
    if (button.dataset.action === 'schedule') { item.type = 'task'; item.date = todayKey(); saveState(); toast('오늘 할 일로 옮겼습니다.'); }
    if (button.dataset.action === 'google') addToGoogle(item);
  }

  function recurrenceRule(item) {
    if (item.recurrence === 'daily') return 'FREQ=DAILY';
    if (item.recurrence === 'weekly') return 'FREQ=WEEKLY;BYDAY=' + googleWeekdays[item.recurrenceDay];
    if (item.recurrence === 'monthly') return 'FREQ=MONTHLY;BYMONTHDAY=' + item.recurrenceDate;
    if (item.recurrence === 'yearly') return 'FREQ=YEARLY;BYMONTH=' + item.recurrenceMonth + ';BYMONTHDAY=' + item.recurrenceDate;
    return '';
  }
  function googleCalendarUrl(item) {
    const finalDate = item.endDate || item.date;
    const start = item.time ? item.date.replaceAll('-','') + 'T' + item.time.replace(':','') + '00' : item.date.replaceAll('-','');
    let end;
    if (item.time) end = finalDate.replaceAll('-','') + 'T' + (item.endTime || addMinutes(item.time,60)).replace(':','') + '00';
    else end = dateKey(addDays(parseKey(finalDate), 1)).replaceAll('-','');
    const params = new URLSearchParams({ action: 'TEMPLATE', text: item.title, dates: start + '/' + end, ctz: TZ });
    if (item.location) params.set('location', item.location);
    const rule = recurrenceRule(item);
    if (rule) params.set('recur', 'RRULE:' + rule);
    return 'https://calendar.google.com/calendar/render?' + params;
  }

  async function addToGoogle(item) {
    if (item.googleEventId) return toast('이미 Google Calendar에 등록되어 있습니다.');
    if (!googleToken) {
      window.open(googleCalendarUrl(item), '_blank', 'noopener');
      return toast('Google Calendar의 최종 등록 화면을 열었습니다.');
    }
    try {
      const body = { summary: item.title, ...(item.location ? { location: item.location } : {}), reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: item.reminder || 30 }] } };
      const rule = recurrenceRule(item);
      if (rule) body.recurrence = ['RRULE:' + rule];
      if (item.time) {
        body.start = { dateTime: `${item.date}T${item.time}:00+09:00`, timeZone: TZ };
        body.end = { dateTime: (item.endDate || item.date) + 'T' + (item.endTime || addMinutes(item.time,60)) + ':00+09:00', timeZone: TZ };
      } else {
        body.start = { date: item.date };
        body.end = { date: dateKey(addDays(parseKey(item.endDate || item.date),1)) };
      }
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('Google Calendar 등록 실패');
      const result = await response.json();
      item.googleEventId = result.id;
      saveState();
      toast('Google Calendar에 등록했습니다.');
    } catch (error) { toast(error.message || 'Google 연결을 다시 확인해 주세요.'); }
  }

  function connectGoogle() {
    const clientId = $('#google-client-id').value.trim();
    if (!clientId) return toast('OAuth 클라이언트 ID를 먼저 입력해 주세요.');
    state.settings.googleClientId = clientId; saveState();
    if (!window.google?.accounts?.oauth2) return toast('Google 로그인 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: response => {
        if (response.error) return toast('Google 계정 연결에 실패했습니다.');
        googleToken = response.access_token; renderSettings(); toast('Google Calendar에 연결했습니다.');
      }
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function weatherDescription(code) {
    if (code === 0) return { label: '맑음', icon: '☀️' };
    if (code <= 2) return { label: '구름 조금', icon: '🌤️' };
    if (code === 3) return { label: '흐림', icon: '☁️' };
    if ([45, 48].includes(code)) return { label: '안개', icon: '🌫️' };
    if (code >= 51 && code <= 57) return { label: '이슬비', icon: '🌦️' };
    if (code >= 61 && code <= 67) return { label: '비', icon: '🌧️' };
    if (code >= 71 && code <= 77) return { label: '눈', icon: '🌨️' };
    if (code >= 80 && code <= 82) return { label: '소나기', icon: '🌦️' };
    if (code >= 85 && code <= 86) return { label: '눈 소나기', icon: '🌨️' };
    if (code >= 95) return { label: '뇌우', icon: '⛈️' };
    return { label: '날씨 변화', icon: '🌤️' };
  }

  function buildWeatherAdvice(weather) {
    const code = Number(weather.code);
    const rainLikely = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 || weather.precipitation > 0 || weather.rainChance >= 40;
    if (rainLikely) return '☂️ 비가 올 수 있어요. 우산을 챙기세요.';
    if (code >= 71 && code <= 86) return '🧤 눈길에 미끄럽지 않은 신발을 신으세요.';
    if (weather.temperature >= 28 || weather.apparent >= 30) return '🥤 더운 날이에요. 물과 자외선 차단제를 챙기세요.';
    if (weather.apparent <= 5) return '🧥 체감온도가 낮아요. 따뜻한 겉옷을 챙기세요.';
    if (weather.wind >= 30) return '🍃 바람이 강해요. 가벼운 물건과 옷차림을 확인하세요.';
    if (weather.max - weather.min >= 10) return '🧣 일교차가 커요. 얇은 겉옷을 챙기세요.';
    if (code <= 1) return '🕶️ 햇빛이 좋아요. 선글라스나 모자를 챙겨도 좋아요.';
    return '🌷 무난한 날씨예요. 일정에 맞게 가볍게 준비하세요.';
  }

  function renderWeather(weather) {
    const condition = weatherDescription(Number(weather.code));
    const inlineWeather = $('#weather-inline');
    if (inlineWeather) inlineWeather.textContent = ' · ' + condition.icon + ' ' + Math.round(weather.temperature) + '° · ' + condition.label;
    const widgetWeather = $('#widget-weather');
    if (widgetWeather) widgetWeather.textContent = condition.icon + ' ' + Math.round(weather.temperature) + '°';
    $('#weather-location').textContent = weather.location;
    $('#weather-icon').textContent = condition.icon;
    $('#weather-temp').textContent = `${Math.round(weather.temperature)}°`;
    $('#weather-condition').textContent = condition.label;
    $('#weather-range').textContent = `최고 ${Math.round(weather.max)}° · 최저 ${Math.round(weather.min)}° · 체감 ${Math.round(weather.apparent)}°`;
    $('#weather-advice').textContent = buildWeatherAdvice(weather);
  }

  function requestCoordinates() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('위치를 지원하지 않음'));
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, label: '현재 위치' }),
        reject,
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  async function loadWeather(forceLocation = false) {
    const refresh = $('#weather-refresh');
    refresh.disabled = true;
    $('#weather-location').textContent = forceLocation ? '현재 위치 확인 중' : '날씨 업데이트 중';
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); } catch {}
    if (!forceLocation && cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) renderWeather(cached);
    try {
      let place;
      try { place = await requestCoordinates(); }
      catch { place = { latitude: 37.5665, longitude: 126.9780, label: '서울 · 기본 위치' }; }
      const params = new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
        timezone: 'auto',
        forecast_days: '1'
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!response.ok) throw new Error('날씨 응답 오류');
      const data = await response.json();
      const current = data.current || {};
      const daily = data.daily || {};
      const weather = {
        location: place.label,
        temperature: Number(current.temperature_2m),
        apparent: Number(current.apparent_temperature),
        code: Number(current.weather_code),
        precipitation: Number(current.precipitation || 0),
        wind: Number(current.wind_speed_10m || 0),
        max: Number(daily.temperature_2m_max?.[0] ?? current.temperature_2m),
        min: Number(daily.temperature_2m_min?.[0] ?? current.temperature_2m),
        rainChance: Number(daily.precipitation_probability_max?.[0] || 0),
        fetchedAt: Date.now()
      };
      if ([weather.temperature, weather.apparent, weather.max, weather.min].some(value => Number.isNaN(value))) throw new Error('날씨 데이터 오류');
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
      renderWeather(weather);
    } catch {
      if (cached) renderWeather(cached);
      else {
        $('#weather-location').textContent = '날씨 연결 안 됨';
        $('#weather-condition').textContent = '잠시 후 다시 확인해 주세요';
        $('#weather-advice').textContent = '날씨를 불러오지 못했어요. 새로고침 버튼을 눌러보세요.';
      }
    } finally { refresh.disabled = false; }
  }
  async function requestNotifications() {
    if (!('Notification' in window)) return toast('이 브라우저는 알림을 지원하지 않습니다.');
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? '브라우저 알림을 켰습니다.' : '알림 권한이 허용되지 않았습니다.');
    updateNotificationButton();
  }

  function updateNotificationButton() {
    if (!('Notification' in window)) return $('#notification-button').classList.add('hidden');
    $('#notification-button').textContent = Notification.permission === 'granted' ? '브라우저 알림 켜짐' : '브라우저 알림 켜기';
  }

  function maybeSendDigest() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date(); const key = todayKey();
    if (now.getHours() < 9 || state.settings.lastDigest === key) return;
    new Notification('Leila Portal', { body: $('#daily-summary').textContent, icon: 'icon.svg' });
    state.settings.lastDigest = key; localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `오늘정리-${todayKey()}.json`; link.click(); URL.revokeObjectURL(url);
  }

  async function importData(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.items)) throw new Error();
      state = { items: parsed.items, books: Array.isArray(parsed.books) ? parsed.books : [], settings: { ...defaultState.settings, ...(parsed.settings || {}) } };
      migrateExistingMealSlots();
      migrateExistingDateRanges();
      migrateExistingRecurrences();
      saveState(); toast('백업 데이터를 가져왔습니다.');
    } catch { toast('올바른 백업 파일이 아닙니다.'); }
  }

  function bindEvents() {
    $$('.nav-button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    $$('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
    $$('[data-compose]').forEach(button => button.addEventListener('click', () => compose(button.dataset.compose)));
    $$('[data-prefix]').forEach(button => button.addEventListener('click', () => compose(button.dataset.prefix)));
    $('#book-search-form').addEventListener('submit', searchBooks);
    $('#parse-button').addEventListener('click', () => {
      const items = parseInput($('#quick-input').value).map(item => ({ ...item, selected: undefined }));
      if (!items.length) return toast('한 줄 이상 입력해 주세요.');
      state.items.push(...items);
      saveState();
      $('#quick-input').value = '';
      toast(items.length + '개를 바로 등록했습니다.');
    });
    $('#cancel-preview').addEventListener('click', () => { previews = []; renderPreview(); });
    $('#preview-list').addEventListener('input', event => {
      const target = event.target; const index = Number(target.dataset.previewIndex); const field = target.dataset.field;
      if (!Number.isInteger(index) || !field || !previews[index]) return;
      previews[index][field] = target.type === 'checkbox' ? target.checked : target.value;
      if (field === 'time' && target.value) previews[index].endTime = addMinutes(target.value, 60);
      updatePreviewCount();
    });
    $('#confirm-items').addEventListener('click', () => {
      const selected = previews.filter(item => item.selected && item.title.trim()).map(item => ({ ...item, selected: undefined }));
      state.items.push(...selected); saveState(); previews = []; renderPreview(); $('#quick-input').value = ''; toast(`${selected.length}개를 등록했습니다.`);
    });
    document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleListAction(button); });
    $$('[data-task-filter]').forEach(button => button.addEventListener('click', () => { taskFilter = button.dataset.taskFilter; $$('[data-task-filter]').forEach(item => item.classList.toggle('active', item === button)); renderTasks(); }));
    $$('[data-shop-filter]').forEach(button => button.addEventListener('click', () => { shopFilter = button.dataset.shopFilter; $$('[data-shop-filter]').forEach(item => item.classList.toggle('active', item === button)); renderShopping(); }));
    $('#week-prev').addEventListener('click', () => { weekCursor = addDays(weekCursor,-7); renderWeek(); });
    $('#week-next').addEventListener('click', () => { weekCursor = addDays(weekCursor,7); renderWeek(); });
    $('#week-today').addEventListener('click', () => { weekCursor = startOfWeek(new Date()); renderWeek(); });
    $('#month-prev').addEventListener('click', () => { monthCursor = new Date(monthCursor.getFullYear(),monthCursor.getMonth()-1,1); renderMonth(); });
    $('#month-next').addEventListener('click', () => { monthCursor = new Date(monthCursor.getFullYear(),monthCursor.getMonth()+1,1); renderMonth(); });
    $('#month-today').addEventListener('click', () => { monthCursor = new Date(new Date().getFullYear(),new Date().getMonth(),1); renderMonth(); });
    $('#weather-refresh').addEventListener('click', () => loadWeather(true));
    $('#notification-button').addEventListener('click', requestNotifications);
    $('#google-connect').addEventListener('click', connectGoogle);
    $('#google-client-id').addEventListener('change', event => { state.settings.googleClientId = event.target.value.trim(); saveState(); });
    $('#export-data').addEventListener('click', exportData);
    $('#import-data').addEventListener('change', event => { if (event.target.files[0]) importData(event.target.files[0]); });
    $('#edit-form').addEventListener('submit', saveEditedItem);
    $('#edit-close').addEventListener('click', closeEditDialog);
    $('#edit-cancel').addEventListener('click', closeEditDialog);
    $('#edit-dialog').addEventListener('cancel', () => { editingItemId = null; });
    $('#edit-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) closeEditDialog(); });
    $('#edit-recurrence').addEventListener('change', event => $('#edit-series-note').classList.toggle('hidden', !event.target.value));
    $('#edit-time').addEventListener('change', event => {
      if (event.target.value && !$('#edit-end-time').value) $('#edit-end-time').value = addMinutes(event.target.value, 60);
    });
  }

  function init() {
    $('#today-label').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
    const movedMeals = migrateExistingMealSlots();
    const movedRanges = migrateExistingDateRanges();
    const movedRecurrences = migrateExistingRecurrences();
    bindEvents(); renderAll(); updateNotificationButton(); maybeSendDigest(); loadWeather();
    if (movedMeals || movedRanges || movedRecurrences) toast('기존 일정 ' + (movedMeals + movedRanges + movedRecurrences) + '개를 새 형식으로 정리했어요.');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();
